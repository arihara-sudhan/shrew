require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');
const { ensureCompiledFlow } = require('./flowCompiler');
const { getTOTPForPayer } = require('./totp');
const { buildRepairContext, flattenSelectorsFromContext, summarizeRepairContext, summarizeRepairContextForLog } = require('./repairContext');

async function requestSelectorFromAI(repairContext, hint, step = {}) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const knownSelectors = flattenSelectorsFromContext(repairContext);
  const compactContext = summarizeRepairContext(repairContext);
  const compactLogContext = summarizeRepairContextForLog(repairContext);
  console.log(`[flowRunner] Failed step description: ${step.description || '(none)'}`);
  console.log(`[flowRunner] Failed step payload: ${JSON.stringify(step)}`);
  console.log(`[flowRunner] Candidate elements received for step ${step.id || '(unknown)'}:\n${compactLogContext}`);

  const prompt = `You are a automation healing agent who will pick the apt element.
Here are the candidate elements.
Pick the apt one and give us the selector.
Here is the description of the step where the automation failed and also the full failed step.
Get context from this and decide which selector is apt.
Return only selector.
Prefer to be unique selector.

Description: ${hint}
Failed step: ${JSON.stringify(step)}
Previously failed selectors: ${JSON.stringify(step.failedSelectorsHistory || [])}
Known selectors: ${knownSelectors.length ? knownSelectors.join(' | ') : 'none'}
Candidate elements:
${compactContext}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful agent.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.2,
    }),
  });

  const payload = await res.json();
  const suggestion = payload?.choices?.[0]?.message?.content || '';
  const selector = suggestion
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || null;
  console.log(`[flowRunner] AI suggested selector for step ${step.id || '(unknown)'}: ${selector || '(none)'}`);
  return selector;
}

function normalizeSelectorString(selector) {
  if (!selector || typeof selector !== 'string') return [];
  return selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRoleSelector(input) {
  // format: role=textbox[name='User ID'] or role=button
  if (!input.startsWith('role=')) return null;
  const qr = input.slice(5);
  const m = qr.match(/^([^\[]+)(\[name='(.+)'\])?$/);
  if (!m) return null;
  const role = m[1];
  const name = m[3];
  return { role, name };
}

async function getLocator(page, selector) {
  if (typeof selector !== 'string') return null;

  const roleOps = parseRoleSelector(selector);
  if (roleOps) {
    const roleOptions = roleOps.name ? { name: roleOps.name, exact: false } : {};
    return page.getByRole(roleOps.role, roleOptions);
  }

  return page.locator(selector);
}

async function elementExists(page, selector) {
  if (!selector || typeof selector !== 'string') return false;
  const sels = normalizeSelectorString(selector);
  for (const sel of sels) {
    const locator = await getLocator(page, sel);
    if (!locator) continue;
    try {
      if ((await locator.count()) > 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function detectSelectorWithAI(page, step, hint) {
  try {
    const repairContext = await buildRepairContext(page, step);
    const aiCandidate = await requestSelectorFromAI(repairContext, hint, step);
    if (aiCandidate && await elementExists(page, aiCandidate)) {
      return aiCandidate;
    }
    if (aiCandidate) {
      console.warn(`[flowRunner] AI suggested selector does not exist for step ${step.id}: ${aiCandidate}`);
    }
  } catch (err) {
    console.warn('[flowRunner] AI fallback failed:', err.message || err);
  }

  return null;
}

async function autoDetectSelector(page, step, options = {}) {
  const hint = step.description || step.action || 'input field';
  const stepForHealing = {
    ...step,
    failedSelectorsHistory: options.failedSelectorsHistory || step.failedSelectorsHistory || [],
  };

  if (stepForHealing.selector) {
    for (const sel of normalizeSelectorString(stepForHealing.selector)) {
      if (await elementExists(page, sel)) return sel;
    }
  }

  return detectSelectorWithAI(page, stepForHealing, hint);
}

async function persistSelector(flowPath, flow, step, selector) {
  if (!selector || selector === step.selector) return;
  step.selector = selector;
  await fs.writeFile(flowPath, JSON.stringify(flow, null, 2), 'utf-8');
  console.log(`[flowRunner] Updated ${flowPath} step ${step.id} selector to ${selector}`);
  await ensureCompiledFlow(flowPath);
}

async function performFill(page, step, flowPath, flow) {
  const value = await resolveStepValue(step, flow);

  let selector = step.selector;
  if (selector && !(await elementExists(page, selector))) {
    selector = null; // fallback to auto-detect
  }

  if (!selector) {
    selector = await autoDetectSelector(page, step);
    if (!selector) throw new Error(`Could not resolve selector for step ${step.id}`);
    await persistSelector(flowPath, flow, step, selector);
  }

  const locator = await getLocator(page, selector);
  if (!locator) {
    throw new Error(`Could not resolve locator for step ${step.id}`);
  }

  if (step.clearFirst) {
    await locator.fill('');
  }
  await locator.fill(value);
}

async function performHover(page, step, flowPath, flow) {
  let selector = step.selector;
  if (selector && !(await elementExists(page, selector))) {
    selector = null;
  }

  if (!selector) {
    selector = await autoDetectSelector(page, step);
    if (!selector) throw new Error(`Could not resolve selector for step ${step.id}`);
    await persistSelector(flowPath, flow, step, selector);
  }

  const locator = await getLocator(page, selector);
  if (!locator) {
    throw new Error(`Could not resolve locator for step ${step.id}`);
  }

  await locator.hover();
}

async function performFillStrict(page, step, flow) {
  const value = await resolveStepValue(step, flow);
  if (!step.selector) {
    throw new Error(`Strict replay requires selector for step ${step.id}`);
  }

  const locator = await getLocator(page, step.selector);
  if (!locator) {
    throw new Error(`Could not resolve strict replay locator for step ${step.id}`);
  }

  if (step.clearFirst) {
    await locator.fill('');
  }
  await locator.fill(value);
}

async function tryClickSelector(page, selector, timeout) {
  const locator = await getLocator(page, selector);
  if (!locator) {
    throw new Error(`Could not resolve click locator for selector ${selector}`);
  }

  await locator.click({ force: true, timeout });
}

async function tryFallbackClick(page, selector, timeout) {
  try {
    await page.click(selector, { timeout });
  } catch (error) {
    const locator = await getLocator(page, selector);
    if (!locator) throw error;
    await locator.click({ timeout });
  }
}

async function performClick(page, step, flowPath, flow) {
  const timeout = flow.config?.timeout || 30000;
  if (step.selector && await elementExists(page, step.selector)) {
    try {
      await tryClickSelector(page, step.selector, timeout);
      return;
    } catch (error) {
      console.warn(`[flowRunner] primary click failed for step ${step.id} using ${step.selector}: ${error.message}`);
    }
  }

  if (Array.isArray(step.fallbackSelectors) && step.fallbackSelectors.length > 0) {
    let lastSuccessfulFallback = null;

    for (const candidate of step.fallbackSelectors) {
      if (!(await elementExists(page, candidate))) continue;

      try {
        await tryFallbackClick(page, candidate, timeout);
        lastSuccessfulFallback = candidate;
      } catch (error) {
        console.warn(`[flowRunner] fallback click failed for step ${step.id} using ${candidate}: ${error.message}`);
      }
    }

    if (lastSuccessfulFallback) {
      await persistSelector(flowPath, flow, step, lastSuccessfulFallback);
      return;
    }
  }

  const healedSelector = await autoDetectSelector(page, step);
  if (!healedSelector) {
    throw new Error(`Could not resolve click selector for step ${step.id}`);
  }

  await persistSelector(flowPath, flow, step, healedSelector);
  await tryClickSelector(page, healedSelector, timeout);
}

async function performClickStrict(page, step, flow) {
  const timeout = flow.config?.timeout || 30000;

  if (step.selector) {
    try {
      await tryClickSelector(page, step.selector, timeout);
      return;
    } catch (error) {
      if (!Array.isArray(step.fallbackSelectors) || step.fallbackSelectors.length === 0) {
        throw error;
      }
    }
  }

  if (Array.isArray(step.fallbackSelectors)) {
    let lastError = null;
    for (const candidate of step.fallbackSelectors) {
      try {
        await tryFallbackClick(page, candidate, timeout);
      } catch (error) {
        lastError = error;
      }
    }
    if (!lastError) return;
    throw lastError;
  }

  throw new Error(`Strict replay could not click step ${step.id}`);
}

async function performSelectOptionStrict(page, step, flow) {
  if (!step.selector) {
    throw new Error(`Strict replay requires selector for step ${step.id}`);
  }

  const locator = await getLocator(page, step.selector);
  if (!locator) {
    throw new Error(`Could not resolve strict replay locator for step ${step.id}`);
  }

  const value = resolveTemplate(step.value ?? '', { ...(flow.config || {}), ...(flow.variables || {}) });
  await locator.selectOption(value);
}

async function performHoverStrict(page, step) {
  if (!step.selector) {
    throw new Error(`Strict replay requires selector for step ${step.id}`);
  }

  const locator = await getLocator(page, step.selector);
  if (!locator) {
    throw new Error(`Could not resolve strict replay locator for step ${step.id}`);
  }

  await locator.hover();
}

async function resolveStepValue(step, flow) {
  if (step.totpFrom) {
    const payer = step.totpFrom;
    const totp = await getTOTPForPayer(payer);
    return totp;
  }
  return resolveTemplate(step.value ?? flow.variables?.inputText ?? '', { ...(flow.config || {}), ...(flow.variables || {}) });
}

function resolveTemplate(value, context) {
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([^}\s]+)\s*}}/g, (match, key) => {
    if (context && context[key] !== undefined) {
      return context[key];
    }
    return match;
  });
}

function normalizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  let uri = rawUrl.trim();
  if (!uri) return uri;

  if (/^(https?:|file:)/i.test(uri)) return uri;
  uri = uri.replace(/\\/g, '/');

  if (/^[a-zA-Z]:\//.test(uri)) {
    const normalized = uri.replace(/^([a-zA-Z]):\//, '/$1/');
    return `file://${normalized}`;
  }

  if (uri.startsWith('/')) return `file://${uri}`;

  const absolute = path.resolve(process.cwd(), uri).replace(/\\/g, '/');
  return `file://${absolute}`;
}

function extractUrlTokens(pattern) {
  if (typeof pattern !== 'string') return [];
  return pattern
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4);
}

function urlLooksLikeMatch(currentUrl, pattern) {
  if (typeof currentUrl !== 'string' || typeof pattern !== 'string') return false;
  const normalizedUrl = currentUrl.toLowerCase();
  const tokens = extractUrlTokens(pattern);
  return tokens.length > 0 && tokens.every((token) => normalizedUrl.includes(token));
}

async function executeFlow(flowPath) {
  const flowJson = await fs.readFile(flowPath, 'utf-8');
  const flow = JSON.parse(flowJson);
  const browser = await chromium.launch({ headless: flow.config?.headless !== false });
  const page = await browser.newPage();

  try {
    for (const step of flow.steps || []) {
      let attempts = 0;
      const failedSelectorsHistory = [];

      while (attempts < 5) {
        try {
          if (step.action === 'navigate') {
            const context = { ...(flow.config || {}), ...(flow.variables || {}) };
            const rawUrl = resolveTemplate(step.url || `${flow.config?.baseUrl || ''}`, context);
            const url = normalizeUrl(rawUrl);
            console.log(`[flowRunner] navigate: ${url}`);
            await page.goto(url, { waitUntil: step.waitUntil || 'load', timeout: flow.config?.timeout || 30000 });
          } else if (step.action === 'fill') {
            await performFill(page, step, flowPath, flow);
          } else if (step.action === 'hover') {
            await performHover(page, step, flowPath, flow);
          } else if (step.action === 'press') {
            let selector = step.selector;
            if (selector && !(await elementExists(page, selector))) {
              selector = null;
            }

            if (!selector) {
              selector = await autoDetectSelector(page, step, { failedSelectorsHistory });
              if (!selector) throw new Error(`Could not resolve selector for step ${step.id}`);
              await persistSelector(flowPath, flow, step, selector);
            }

            const locator = await getLocator(page, selector);
            if (!locator) {
              throw new Error(`Could not resolve locator for step ${step.id}`);
            }

            await locator.press(step.key);
          } else if (step.action === 'selectOption') {
            let selector = step.selector;
            if (selector && !(await elementExists(page, selector))) {
              selector = null;
            }

            if (!selector) {
              selector = await autoDetectSelector(page, step, { failedSelectorsHistory });
              if (!selector) throw new Error(`Could not resolve selector for step ${step.id}`);
              await persistSelector(flowPath, flow, step, selector);
            }

            const locator = await getLocator(page, selector);
            if (!locator) {
              throw new Error(`Could not resolve locator for step ${step.id}`);
            }

            const value = resolveTemplate(step.value ?? '', { ...(flow.config || {}), ...(flow.variables || {}) });
            await locator.selectOption(value);
          } else if (step.action === 'click') {
            await performClick(page, step, flowPath, flow);

            // page-two scenario: wait for navigation or URL match (tolerant)
            if (step.waitForNavigation) {
              try {
                await page.waitForNavigation({ waitUntil: step.waitForNavigation, timeout: flow.config?.timeout || 30000 });
              } catch (waitNavError) {
                console.warn(`[flowRunner] waitForNavigation failed for step ${step.id}: ${waitNavError.message}`);
              }
            }
            if (step.waitForURL) {
              try {
                await page.waitForURL(step.waitForURL, { timeout: flow.config?.timeout || 30000 });
              } catch (waitUrlError) {
                const currentUrl = page.isClosed() ? '' : page.url();
                if (urlLooksLikeMatch(currentUrl, step.waitForURL)) {
                  console.warn(`[flowRunner] waitForURL pattern ${step.waitForURL} did not match literally, but current URL looks correct: ${currentUrl}`);
                } else {
                console.warn(`[flowRunner] waitForURL failed for step ${step.id}: ${waitUrlError.message}`);
                }
              }
            }
            if (step.waitForLoadState) {
              try {
                await page.waitForLoadState(step.waitForLoadState, { timeout: flow.config?.timeout || 30000 });
              } catch (waitStateError) {
                console.warn(`[flowRunner] waitForLoadState failed for step ${step.id}: ${waitStateError.message}`);
              }
            }
          } else if (step.action === 'waitForTimeout') {
            await page.waitForTimeout(Number(step.ms || 0));
          } else {
            console.warn(`[flowRunner] Unsupported action: ${step.action}`);
          }
          break;
        } catch (error) {
          if (step.selector) {
            failedSelectorsHistory.push(step.selector);
          }

          if (step.action === 'fill' || step.action === 'click' || step.action === 'selectOption' || step.action === 'press' || step.action === 'hover') {
            console.warn(`[flowRunner] ${step.action} step failed, trying healing (selector) for step ${step.id}: ${error.message}`);
            const reselected = await autoDetectSelector(page, step, { failedSelectorsHistory });
            if (reselected) {
              await persistSelector(flowPath, flow, step, reselected);
              attempts += 1;
              continue; // retry only this step
            }
          }
          throw error;
        }
      }

      if (attempts >= 5) {
        throw new Error(`Healing loop exceeded 5 attempts for step ${step.id}`);
      }
    }
  } finally {
    await browser.close();
  }
}

async function runCompiledScript(scriptPath) {
  delete require.cache[require.resolve(scriptPath)];
  const compiledRunner = require(scriptPath);

  if (typeof compiledRunner === 'function') {
    await compiledRunner();
    return;
  }

  if (compiledRunner && typeof compiledRunner.run === 'function') {
    await compiledRunner.run();
    return;
  }

  throw new Error(`Compiled script at ${scriptPath} has no runnable export`);
}

async function healStepFromCompiledFailure(flowPath, failedStep, failedSelectorsHistory) {
  const flowJson = await fs.readFile(flowPath, 'utf-8');
  const flow = JSON.parse(flowJson);
  const step = (flow.steps || []).find((candidate) => candidate.id === failedStep?.id);

  if (!step) {
    throw new Error(`Could not find failed step ${failedStep?.id || '(unknown)'} in ${flowPath}`);
  }

  const browser = await chromium.launch({ headless: flow.config?.headless !== false });
  const page = await browser.newPage();

  try {
    for (const currentStep of flow.steps || []) {
      if (currentStep.id === step.id) break;

      try {
        if (currentStep.action === 'navigate') {
          const context = { ...(flow.config || {}), ...(flow.variables || {}) };
          const rawUrl = resolveTemplate(currentStep.url || `${flow.config?.baseUrl || ''}`, context);
          const url = normalizeUrl(rawUrl);
          await page.goto(url, { waitUntil: currentStep.waitUntil || 'load', timeout: flow.config?.timeout || 30000 });
      } else if (currentStep.action === 'fill') {
        await performFillStrict(page, currentStep, flow);
      } else if (currentStep.action === 'hover') {
        await performHoverStrict(page, currentStep);
      } else if (currentStep.action === 'click') {
        await performClickStrict(page, currentStep, flow);
        } else if (currentStep.action === 'selectOption') {
          await performSelectOptionStrict(page, currentStep, flow);
        } else if (currentStep.action === 'waitForTimeout') {
          await page.waitForTimeout(Number(currentStep.ms || 0));
        }
      } catch (replayError) {
        const replayFailedSelectorsHistory = [];
        if (currentStep.selector) {
          replayFailedSelectorsHistory.push(currentStep.selector);
        }

        console.warn(`[flowRunner] Replay failed on prerequisite step ${currentStep.id}: ${replayError.message}`);
        const replayHealedSelector = await autoDetectSelector(page, {
          ...currentStep,
          failedSelectorsHistory: replayFailedSelectorsHistory,
        }, { failedSelectorsHistory: replayFailedSelectorsHistory });

        if (!replayHealedSelector) {
          throw replayError;
        }

        await persistSelector(flowPath, flow, currentStep, replayHealedSelector);
        console.log(`[flowRunner] Healed prerequisite step ${currentStep.id} with selector ${replayHealedSelector}. Re-running compiled script.`);
        return replayHealedSelector;
      }
    }

    const healedSelector = await autoDetectSelector(page, {
      ...step,
      ...failedStep,
    }, { failedSelectorsHistory });

    if (!healedSelector) {
      throw new Error(`AI could not heal selector for step ${step.id}`);
    }

    await persistSelector(flowPath, flow, step, healedSelector);
    console.log(`[flowRunner] Healed step ${step.id} with selector ${healedSelector}. Re-running compiled script.`);
    return healedSelector;
  } finally {
    await browser.close();
  }
}

async function runFlow(flowPathArg) {
  let flowPath;

  if (flowPathArg) {
    flowPath = path.resolve(process.cwd(), flowPathArg);
  } else if (process.env.FLOW_DIR) {
    flowPath = path.join(process.cwd(), process.env.FLOW_DIR, 'greenInput.json');
  } else {
    const candidateRecipe = path.join(__dirname, '../recipes/greenInput.json');
    const candidateFlow = path.join(__dirname, '../flows/greenInput.json');
    flowPath = require('fs').existsSync(candidateRecipe) ? candidateRecipe : candidateFlow;
  }

  const { updated, scriptPath } = await ensureCompiledFlow(flowPath);
  console.log(`[flowCompiler] ${updated ? 'Flow changed or script missing. Re-generated' : 'Script is in sync'}: ${scriptPath}`);
  console.log('[flowRunner] Running compiled flow with healing loop');

  const failedSelectorsHistory = [];

  for (let iteration = 1; iteration <= 10; iteration += 1) {
    try {
      console.log(`[flowRunner] Compiled run iteration ${iteration}`);
      await runCompiledScript(scriptPath);
      return;
    } catch (error) {
      const failedStep = error?.step;
      if (!failedStep || !['fill', 'click', 'selectOption'].includes(failedStep.action)) {
        throw error;
      }

      if (failedStep.selector) {
        failedSelectorsHistory.push(failedStep.selector);
      }

      console.warn(`[flowRunner] Compiled run failed on step ${failedStep.id}: ${error.message}`);
      await healStepFromCompiledFailure(flowPath, failedStep, failedSelectorsHistory);
      await ensureCompiledFlow(flowPath);
    }
  }

  throw new Error('Healing loop exceeded 10 iterations without success');
}

if (require.main === module) {
  runFlow(process.argv[2]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runFlow,
  getTOTPForPayer,
};
