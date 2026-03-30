require('dotenv').config();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { ensureCompiledFlow } = require('../flowCompiler');
const { getTOTPForPayer } = require('../totp');
const { buildRepairContext, flattenSelectorsFromContext, summarizeRepairContext, summarizeRepairContextForLog } = require('../repairContext');
const { handlePageInterruptions } = require('../interruptionHandler');

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

function resolveTemplate(value, context) {
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([^}\s]+)\s*}}/g, (match, rawKey) => {
    const key = String(rawKey || '').trim();
    const pathParts = key.split('.').filter(Boolean);
    let current = context;

    for (const part of pathParts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        current = undefined;
        break;
      }
    }

    if (current !== undefined && current !== null) {
      return String(current);
    }

    if (context && context[key] !== undefined && context[key] !== null) {
      return String(context[key]);
    }
    return match;
  });
}

async function resolveStepValue(step, flow) {
  if (step.totpFrom) {
    const payer = step.totpFrom;
    const totp = await getTOTPForPayer(payer);
    return totp;
  }
  return resolveTemplate(step.value ?? flow.variables?.inputText ?? '', { ...(flow.config || {}), ...(flow.variables || {}), ...(step._templateContext || {}) });
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

async function performFill(page, step, flowPath, flow) {
  const value = await resolveStepValue(step, flow);

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

async function healStepSelector(page, step, flowPath, flow, failedSelectorsHistory = []) {
  const reselected = await autoDetectSelector(page, step, { failedSelectorsHistory });
  if (!reselected) return null;
  await persistSelector(flowPath, flow, step, reselected);
  return reselected;
}

function getPostStepDelayMs(flow = {}) {
  const configured = Number(flow?.config?.stepDelayMs);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 1000;
}

function setByPath(target, rawPath, value) {
  if (!target || typeof target !== 'object') return;
  const parts = String(rawPath || '').split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return;

  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[parts[parts.length - 1]] = value;
}

async function readTextFromSelector(page, selector) {
  if (!selector) return '';
  const locator = await getLocator(page, selector);
  if (!locator) return '';

  try {
    return (await locator.first().innerText()).trim();
  } catch {
    return '';
  }
}

async function pageContainsVisibleText(page, text) {
  const target = String(text || '').trim();
  if (!target) return true;

  const heading = page.getByRole('heading', { name: target, exact: false }).first();
  try {
    if (await heading.count()) {
      await heading.waitFor({ state: 'visible', timeout: 8000 });
      return true;
    }
  } catch {
    // fall through
  }

  const body = page.locator('body');
  try {
    await body.waitFor({ state: 'visible', timeout: 5000 });
    const bodyText = (await body.innerText()).toLowerCase();
    return bodyText.includes(target.toLowerCase());
  } catch {
    return false;
  }
}

function extractCheckDateFromText(content) {
  const text = String(content || '');
  const dateMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (dateMatch) return dateMatch[0];

  const monthDayMatch = text.match(/\b\d{2}-\d{2}\b/);
  if (monthDayMatch) return monthDayMatch[0];
  return '';
}

function extractStatusFromText(content) {
  const text = String(content || '');
  const statuses = ['Partially Paid', 'Pending Review', 'Paid', 'Denied', 'Pending', 'Rejected', 'Approved'];
  const normalized = text.toLowerCase();
  for (const status of statuses) {
    if (normalized.includes(status.toLowerCase())) return status;
  }
  return '';
}

async function persistLoopRecord(step, checkDate, status) {
  const loopMeta = step?._templateContext?.__loopMeta;
  if (!loopMeta || !Array.isArray(loopMeta.records) || typeof loopMeta.index !== 'number' || !loopMeta.sourcePath) {
    throw new Error(`captureClaimResult requires forEach loop context`);
  }

  const record = loopMeta.records[loopMeta.index];
  if (!record || typeof record !== 'object') {
    throw new Error(`captureClaimResult could not find loop record at index ${loopMeta.index}`);
  }

  const checkDatePath = step.outputCheckDatePath || `${loopMeta.itemName}.claim_result.check_date`;
  const statusPath = step.outputStatusPath || `${loopMeta.itemName}.claim_result.status`;
  const normalizedCheckDatePath = checkDatePath.replace(new RegExp(`^${loopMeta.itemName}\\.`), '');
  const normalizedStatusPath = statusPath.replace(new RegExp(`^${loopMeta.itemName}\\.`), '');

  setByPath(record, normalizedCheckDatePath, checkDate);
  setByPath(record, normalizedStatusPath, status);

  await fs.writeFile(loopMeta.sourcePath, `${JSON.stringify(loopMeta.records, null, 2)}\n`, 'utf8');
}

async function executeStepActivityCore(page, step, flowPath, flow, failedSelectorsHistory = []) {
  const templateContext = { ...(flow.config || {}), ...(flow.variables || {}), ...(step._templateContext || {}) };
  if (step.action === 'navigate') {
    const rawUrl = resolveTemplate(step.url || `${flow.config?.baseUrl || ''}`, templateContext);
    const url = normalizeUrl(rawUrl);
    console.log(`[flowRunner] navigate: ${url}`);
    await page.goto(url, { waitUntil: step.waitUntil || 'load', timeout: flow.config?.timeout || 30000 });
    return;
  }

  if (step.action === 'fill') {
    await performFill(page, step, flowPath, flow);
    return;
  }

  if (step.action === 'hover') {
    await performHover(page, step, flowPath, flow);
    return;
  }

  if (step.action === 'press') {
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
    return;
  }

  if (step.action === 'selectOption') {
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

    const value = resolveTemplate(step.value ?? '', templateContext);
    await locator.selectOption(value);
    return;
  }

  if (step.action === 'click') {
    await performClick(page, step, flowPath, flow);

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
    return;
  }

  if (step.action === 'waitForTimeout') {
    await page.waitForTimeout(Number(step.ms || 0));
    return;
  }

  if (step.action === 'forEach') {
    const sourceRaw = resolveTemplate(step.source || '', templateContext);
    if (!sourceRaw) {
      throw new Error(`forEach step ${step.id || '(unknown)'} requires a source path`);
    }

    const absoluteFromCwd = path.resolve(process.cwd(), sourceRaw);
    const absoluteFromFlow = path.resolve(path.dirname(flowPath), sourceRaw);
    const sourcePath = fsSync.existsSync(absoluteFromCwd) ? absoluteFromCwd : absoluteFromFlow;

    const raw = await fs.readFile(sourcePath, 'utf8');
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
      throw new Error(`forEach source ${sourceRaw} must resolve to a JSON array`);
    }

    const itemName = String(step.item || 'item').trim() || 'item';
    const childSteps = Array.isArray(step.steps) ? step.steps : [];
    const maxItems = Number.isFinite(Number(step.maxItems)) ? Number(step.maxItems) : records.length;
    const limit = Math.max(0, Math.min(records.length, maxItems));

    for (let index = 0; index < limit; index += 1) {
      const record = records[index];
      const loopContext = {
        ...templateContext,
        [itemName]: record,
        index,
        __loopMeta: {
          sourcePath,
          records,
          index,
          itemName,
        },
      };

      for (const childStepRaw of childSteps) {
        const childStep = {
          ...childStepRaw,
          _templateContext: loopContext,
        };
        await executeStepActivity(page, childStep, flowPath, flow, failedSelectorsHistory);
      }
    }
    return;
  }

  if (step.action === 'captureClaimResult') {
    const timeout = flow.config?.timeout || 30000;
    const requiredText = resolveTemplate(step.requiredText || 'Claim Results', templateContext);
    const resultsReadySelector = resolveTemplate(step.resultsReadySelector || '#backBtn', templateContext);
    const quickReadyTimeout = Number(step.resultsReadyTimeoutMs || 1500);

    let hasRequiredText = await pageContainsVisibleText(page, requiredText);
    if (!hasRequiredText && resultsReadySelector) {
      console.warn(`[flowRunner] Results marker missing for step ${step.id}; invoking interruption handling immediately.`);
      await handlePageInterruptions(page, { ...step, selector: resultsReadySelector }, flowPath);
      hasRequiredText = await pageContainsVisibleText(page, requiredText);
    }
    if (!hasRequiredText) {
      throw new Error(`captureClaimResult could not verify results page text: ${requiredText}`);
    }

    if (resultsReadySelector) {
      const resultsReadyLocator = await getLocator(page, resultsReadySelector);
      if (!resultsReadyLocator) {
        throw new Error(`captureClaimResult could not resolve resultsReadySelector: ${resultsReadySelector}`);
      }
      try {
        await resultsReadyLocator.first().waitFor({ state: 'visible', timeout: quickReadyTimeout });
      } catch {
        console.warn(`[flowRunner] Results ready selector ${resultsReadySelector} still not visible; invoking interruption handling.`);
        await handlePageInterruptions(page, { ...step, selector: resultsReadySelector }, flowPath);
        await resultsReadyLocator.first().waitFor({ state: 'visible', timeout });
      }
    }

    const rawCheckDate = await readTextFromSelector(page, step.checkDateSelector || '');
    const rawStatus = await readTextFromSelector(page, step.statusSelector || '');
    const pageText = await page.locator('body').innerText();

    const checkDate = extractCheckDateFromText(rawCheckDate || pageText);
    const status = extractStatusFromText(rawStatus || pageText);

    await persistLoopRecord(step, checkDate, status);
    console.log(`[flowRunner] Captured claim result for loop index ${step?._templateContext?.index}: check_date='${checkDate}', status='${status}'`);

    const backToFormSelector = resolveTemplate(step.backToFormSelector || '', templateContext);
    if (backToFormSelector) {
      const backButton = await getLocator(page, backToFormSelector);
      if (!backButton) {
        throw new Error(`captureClaimResult could not resolve backToFormSelector: ${backToFormSelector}`);
      }
      await backButton.first().waitFor({ state: 'visible', timeout });
      await backButton.click({ force: true, timeout });
      const waitForFormSelector = resolveTemplate(step.waitForFormSelector || "role=combobox[name='Provider Selection']", templateContext);
      if (waitForFormSelector) {
        const formLocator = await getLocator(page, waitForFormSelector);
        if (formLocator) {
          await formLocator.first().waitFor({ state: 'visible', timeout });
        }
      }
    }
    return;
  }

  if (step.action === 'handleDialog') {
    const mode = step.mode === 'accept' ? 'accept' : 'dismiss';
    const useOnce = step.once !== false;
    const messageIncludes = String(step.messageIncludes || '').trim().toLowerCase();
    const handler = async (dialog) => {
      const message = String(dialog.message ? dialog.message() : '');
      if (messageIncludes && !message.toLowerCase().includes(messageIncludes)) {
        return;
      }

      console.log(`[flowRunner] Dialog message: ${message}`);
      try {
        if (mode === 'accept') {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
      } catch {
        // Ignore dialog handling race conditions.
      }
    };

    if (useOnce) {
      page.once('dialog', handler);
    } else {
      page.on('dialog', handler);
    }
    return;
  }

  console.warn(`[flowRunner] Unsupported action: ${step.action}`);
}

async function executeStepActivity(page, step, flowPath, flow, failedSelectorsHistory = []) {
  await executeStepActivityCore(page, step, flowPath, flow, failedSelectorsHistory);
  const stepDelayMs = getPostStepDelayMs(flow);
  if (stepDelayMs > 0) {
    await page.waitForTimeout(stepDelayMs);
  }
}

async function executeStepActivityStrictCore(page, step, flow) {
  const templateContext = { ...(flow.config || {}), ...(flow.variables || {}), ...(step._templateContext || {}) };
  if (step.action === 'navigate') {
    const rawUrl = resolveTemplate(step.url || `${flow.config?.baseUrl || ''}`, templateContext);
    const url = normalizeUrl(rawUrl);
    await page.goto(url, { waitUntil: step.waitUntil || 'load', timeout: flow.config?.timeout || 30000 });
    return;
  }

  if (step.action === 'fill') {
    await performFillStrict(page, step, flow);
    return;
  }

  if (step.action === 'hover') {
    await performHoverStrict(page, step);
    return;
  }

  if (step.action === 'click') {
    await performClickStrict(page, step, flow);
    return;
  }

  if (step.action === 'selectOption') {
    await performSelectOptionStrict(page, step, flow);
    return;
  }

  if (step.action === 'waitForTimeout') {
    await page.waitForTimeout(Number(step.ms || 0));
    return;
  }

  if (step.action === 'handleDialog') {
    const mode = step.mode === 'accept' ? 'accept' : 'dismiss';
    const useOnce = step.once !== false;
    const messageIncludes = String(step.messageIncludes || '').trim().toLowerCase();
    const handler = async (dialog) => {
      const message = String(dialog.message ? dialog.message() : '');
      if (messageIncludes && !message.toLowerCase().includes(messageIncludes)) {
        return;
      }

      try {
        if (mode === 'accept') {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
      } catch {
        // Ignore dialog handling race conditions.
      }
    };

    if (useOnce) {
      page.once('dialog', handler);
    } else {
      page.on('dialog', handler);
    }
  }
}

async function executeStepActivityStrict(page, step, flow) {
  await executeStepActivityStrictCore(page, step, flow);
  const stepDelayMs = getPostStepDelayMs(flow);
  if (stepDelayMs > 0) {
    await page.waitForTimeout(stepDelayMs);
  }
}

function supportsHealingForAction(action) {
  return ['fill', 'click', 'selectOption', 'press', 'hover'].includes(action);
}

module.exports = {
  executeStepActivity,
  executeStepActivityStrict,
  healStepSelector,
  supportsHealingForAction,
};
