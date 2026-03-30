require('dotenv').config();
const fs = require('fs').promises;
const { ensureCompiledFlow } = require('./flowCompiler');
const { buildRepairContext, flattenSelectorsFromContext, summarizeRepairContext, summarizeRepairContextForLog } = require('./repairContext');

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseRoleSelector(input) {
  if (!input || !input.startsWith('role=')) return null;
  const qr = input.slice(5);
  const match = qr.match(/^([^\[]+)(\[name='(.+)'\])?$/);
  if (!match) return null;
  return { role: match[1], name: match[3] };
}

async function getLocator(page, selector) {
  if (typeof selector !== 'string' || !selector) return null;

  const roleOps = parseRoleSelector(selector);
  if (roleOps) {
    const roleOptions = roleOps.name ? { name: roleOps.name, exact: false } : {};
    return page.getByRole(roleOps.role, roleOptions);
  }

  return page.locator(selector);
}

async function elementExists(page, selector) {
  const locator = await getLocator(page, selector);
  if (!locator) return false;

  try {
    return (await locator.count()) > 0;
  } catch {
    return false;
  }
}

async function elementIsVisible(page, selector) {
  const locator = await getLocator(page, selector);
  if (!locator) return false;

  try {
    if ((await locator.count()) === 0) return false;
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function buildInterruptionContext(page, currentStep = {}) {
  const context = await buildRepairContext(page, {
    id: `interrupt-before-${currentStep.id || 'unknown-step'}`,
    action: 'click',
    description: `Unexpected page before ${currentStep.description || currentStep.action || 'step'}`,
    selector: '',
    fallbackSelectors: [],
  }, { maxCandidates: 12 });

  return {
    ...context,
    currentStep: {
      id: currentStep.id || '',
      action: currentStep.action || '',
      description: currentStep.description || '',
      selector: currentStep.selector || '',
    },
  };
}

function summarizeInterruptionContextForPrompt(context) {
  const lines = [];
  lines.push(`Page title: ${normalizeText(context.page?.title) || '(none)'}`);
  lines.push(`Page URL: ${normalizeText(context.page?.url) || '(unknown)'}`);
  lines.push(`Visible text snippet: ${normalizeText(context.page?.visibleText).slice(0, 700) || '(none)'}`);
  lines.push(`Current step: ${JSON.stringify(context.currentStep || {})}`);
  lines.push('Clickable candidates:');

  for (const [index, candidate] of (context.candidates || []).entries()) {
    lines.push(
      `${index + 1}. ${JSON.stringify({
        tag: candidate.tag,
        type: candidate.type,
        id: candidate.id,
        role: candidate.role,
        text: candidate.text,
        label: candidate.label,
        nearbyText: candidate.nearbyText,
        bestSelector: candidate.bestSelector,
        selectors: candidate.selectors.slice(0, 3),
      })}`
    );
  }

  return lines.join('\n');
}

async function requestInterruptionDecisionFromAI(context, currentStep = {}, existingExceptionalScenarios = []) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const knownSelectors = flattenSelectorsFromContext(context);
  console.log(`[flowRunner] Unexpected page candidate context before step ${currentStep.id || '(unknown)'}:\n${summarizeRepairContextForLog(context)}`);

  const prompt = `You are an automation interruption handling agent.
The current expected step is blocked by an unexpected page, modal, interstitial, or update screen.
Decide whether the automation should act on this page right now.

Return valid JSON only with this shape:
{
  "shouldAct": true,
  "action": "click",
  "selector": "unique selector",
  "description": "short reasoned description",
  "condition": {
    "urlIncludes": "short stable token",
    "titleIncludes": "optional short token",
    "textIncludes": "optional short token"
  }
}

Rules:
- If there is no clear blocking page, return {"shouldAct":false}.
- Prefer only unique selectors from the provided candidates.
- Only choose actions that unblock the main flow.
- Prefer dismiss, continue, skip, close, not now, or update later type actions when appropriate.
- Keep condition values short and stable.
- Return JSON only.

Current step: ${JSON.stringify(currentStep)}
Known selectors: ${knownSelectors.length ? knownSelectors.join(' | ') : 'none'}
Existing exceptional scenarios: ${JSON.stringify(existingExceptionalScenarios)}
Context:
${summarizeInterruptionContextForPrompt(context)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You return JSON decisions for browser automation interruptions.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
    }),
  });

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !content) {
    throw new Error(payload?.error?.message || 'AI interruption decision failed.');
  }

  const normalized = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(normalized);
}

function getExceptionalScenarios(flow = {}) {
  if (Array.isArray(flow.exceptionalScenarios)) return flow.exceptionalScenarios;
  if (Array.isArray(flow.exceptionalCases)) return flow.exceptionalCases;
  return [];
}

function getScenarioCondition(scenario = {}) {
  return scenario.when || scenario.condition || {
    urlIncludes: scenario.urlIncludes || '',
    titleIncludes: scenario.titleIncludes || '',
    textIncludes: scenario.textIncludes || '',
  };
}

function scenarioUsesAI(scenario = {}) {
  if (scenario.ai && typeof scenario.ai.enabled === 'boolean') return scenario.ai.enabled;
  if (typeof scenario.useAI === 'boolean') return scenario.useAI;
  return true;
}

function getScenarioSelector(scenario = {}) {
  return scenario?.then?.selector || scenario?.selector || '';
}

function getScenarioName(scenario = {}, fallback = 'exceptional scenario') {
  return scenario.name || scenario.description || scenario.id || fallback;
}

function getScenarioAction(scenario = {}) {
  return scenario?.then?.action || scenario?.action || 'click';
}

function getScenarioSteps(scenario = {}) {
  const steps = scenario?.then?.steps || scenario?.steps;
  return Array.isArray(steps) ? steps : [];
}

function getScenarioInstruction(scenario = {}) {
  return scenario.instruction || scenario.prompt || scenario.description || '';
}

async function requestScenarioDecisionFromAI(context, currentStep = {}, scenario = {}) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const knownSelectors = flattenSelectorsFromContext(context);
  const prompt = `You are an automation exceptional-scenario handling agent.
The current page matches a known exceptional scenario in the recipe.
Pick the best selector to unblock the flow.

Return valid JSON only with this shape:
{
  "shouldAct": true,
  "action": "click",
  "selector": "unique selector",
  "description": "short reason"
}

Rules:
- If this is not clearly actionable, return {"shouldAct":false}.
- Action must be "click" for now.
- Prefer dismiss/continue/close/update later type controls when applicable.
- Use only selectors from available candidates.
- Return JSON only.

Current step: ${JSON.stringify(currentStep)}
Scenario: ${JSON.stringify({
  id: scenario.id || '',
  name: getScenarioName(scenario),
  when: getScenarioCondition(scenario),
  instruction: getScenarioInstruction(scenario),
})}
Known selectors: ${knownSelectors.length ? knownSelectors.join(' | ') : 'none'}
Context:
${summarizeInterruptionContextForPrompt(context)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You return JSON decisions for exceptional browser scenarios.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 250,
    }),
  });

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !content) {
    throw new Error(payload?.error?.message || 'AI exceptional-scenario decision failed.');
  }

  const normalized = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(normalized);
}

async function pageSnapshot(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title || '',
    visibleText: (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
  }));
}

function conditionMatches(snapshot, condition = {}) {
  const url = (snapshot.url || '').toLowerCase();
  const title = (snapshot.title || '').toLowerCase();
  const text = (snapshot.visibleText || '').toLowerCase();
  const checks = [];

  if (condition.urlIncludes) checks.push(url.includes(String(condition.urlIncludes).toLowerCase()));
  if (condition.titleIncludes) checks.push(title.includes(String(condition.titleIncludes).toLowerCase()));
  if (condition.textIncludes) checks.push(text.includes(String(condition.textIncludes).toLowerCase()));

  return checks.length > 0 && checks.every(Boolean);
}

function hasConditionValues(condition = {}) {
  return Boolean(
    String(condition.urlIncludes || '').trim()
    || String(condition.titleIncludes || '').trim()
    || String(condition.textIncludes || '').trim()
  );
}

async function persistScenarioLearning(flowPath, scenario, decision) {
  if (!scenario?.id || !decision?.selector) return;

  const raw = await fs.readFile(flowPath, 'utf8');
  const flow = JSON.parse(raw);
  const scenarios = getExceptionalScenarios(flow);
  const index = scenarios.findIndex((candidate) => candidate?.id === scenario.id);
  if (index < 0) return;

  scenarios[index].then = {
    ...(scenarios[index].then || {}),
    action: decision.action || getScenarioAction(scenario) || 'click',
    description: decision.description || scenarios[index].then?.description || `Handle ${getScenarioName(scenario)}`,
    selector: decision.selector,
  };

  if (Array.isArray(flow.exceptionalScenarios)) {
    flow.exceptionalScenarios = scenarios;
  } else if (Array.isArray(flow.exceptionalCases)) {
    flow.exceptionalCases = scenarios;
  } else {
    flow.exceptionalScenarios = scenarios;
  }

  await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
  console.log(`[flowRunner] Updated exceptional scenario ${scenario.id} selector to ${decision.selector}`);
  await ensureCompiledFlow(flowPath);
}

async function persistLearnedExceptionalScenario(flowPath, currentStep, decision) {
  if (!decision?.selector || !hasConditionValues(decision.condition || {})) return;

  const raw = await fs.readFile(flowPath, 'utf8');
  const flow = JSON.parse(raw);
  const scenarios = getExceptionalScenarios(flow);
  const normalizedCondition = {
    urlIncludes: String(decision.condition?.urlIncludes || ''),
    titleIncludes: String(decision.condition?.titleIncludes || ''),
    textIncludes: String(decision.condition?.textIncludes || ''),
  };

  const duplicate = scenarios.find((scenario) => {
    const when = getScenarioCondition(scenario);
    return (
      String(when.urlIncludes || '') === normalizedCondition.urlIncludes
      && String(when.titleIncludes || '') === normalizedCondition.titleIncludes
      && String(when.textIncludes || '') === normalizedCondition.textIncludes
      && getScenarioSelector(scenario) === decision.selector
    );
  });

  if (duplicate) return;

  const learnedScenario = {
    id: `scenario-learned-${Date.now()}`,
    name: `Learned interruption for ${currentStep?.id || 'step'}`,
    description: decision.description || 'Learned exceptional interruption scenario',
    instruction: 'Apply only when this condition matches and click the stored selector.',
    useAI: true,
    when: normalizedCondition,
    then: {
      action: decision.action || 'click',
      description: decision.description || 'Handle interruption',
      selector: decision.selector,
    },
  };

  scenarios.push(learnedScenario);

  if (Array.isArray(flow.exceptionalScenarios)) {
    flow.exceptionalScenarios = scenarios;
  } else if (Array.isArray(flow.exceptionalCases)) {
    flow.exceptionalCases = scenarios;
  } else {
    flow.exceptionalScenarios = scenarios;
  }

  await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
  console.log(`[flowRunner] Added learned exceptional scenario ${learnedScenario.id} for selector ${decision.selector}`);
  await ensureCompiledFlow(flowPath);
}

async function executeConditionalAction(page, conditional) {
  const steps = getScenarioSteps(conditional);
  const normalizedSteps = steps.length
    ? steps
    : [{
      action: conditional?.then?.action || conditional?.action || 'click',
      selector: conditional?.then?.selector || conditional?.selector || '',
      value: conditional?.then?.value || conditional?.value || '',
    }];

  let anyStepApplied = false;

  for (const step of normalizedSteps) {
    const action = step?.action || 'click';
    const selector = step?.selector || '';
    if (!selector) return false;

    const locator = await getLocator(page, selector);
    if (!locator) return false;

    if (action === 'fill') {
      const value = String(step?.value ?? '');
      try {
        await locator.fill(value);
        anyStepApplied = true;
      } catch {
        return false;
      }
      continue;
    }

    if (action === 'click') {
      try {
        await locator.click({ force: true });
        anyStepApplied = true;
      } catch {
        // Common modal pattern: button remains disabled until confirm text is entered.
        if (await elementExists(page, '#confirmInput')) {
          const confirmLocator = await getLocator(page, '#confirmInput');
          if (!confirmLocator) return false;
          try {
            await confirmLocator.fill('CONFIRM');
            await locator.click({ force: true });
            anyStepApplied = true;
          } catch {
            return false;
          }
        } else {
          return false;
        }
      }
      continue;
    }

    return false;
  }

  return anyStepApplied;
}

async function applyExceptionalScenarios(page, currentStep, flowPath) {
  const raw = await fs.readFile(flowPath, 'utf8');
  const flow = JSON.parse(raw);
  const scenarios = getExceptionalScenarios(flow);
  if (!scenarios.length) return false;

  const snapshot = await pageSnapshot(page);
  const context = await buildInterruptionContext(page, currentStep);

  for (const scenario of scenarios) {
    const when = getScenarioCondition(scenario);
    if (!conditionMatches(snapshot, when)) continue;

    const scenarioName = getScenarioName(scenario);
    const scenarioSteps = getScenarioSteps(scenario);
    if (scenarioSteps.length > 0) {
      const applied = await executeConditionalAction(page, scenario);
      if (applied) {
        console.log(`[flowRunner] Applying exceptional scenario ${scenarioName} using step sequence`);
        return true;
      }
    }

    const existingSelector = getScenarioSelector(scenario);
    if (existingSelector && await elementIsVisible(page, existingSelector)) {
      console.log(`[flowRunner] Applying exceptional scenario ${scenarioName} using ${existingSelector}`);
      const applied = await executeConditionalAction(page, scenario);
      if (applied) return true;
    }

    if (!scenarioUsesAI(scenario)) continue;

    const decision = await requestScenarioDecisionFromAI(context, currentStep, scenario);
    if (!decision || !decision.shouldAct || decision.action !== 'click' || !decision.selector) {
      continue;
    }

    if (!(await elementIsVisible(page, decision.selector))) {
      console.warn(`[flowRunner] AI exceptional-scenario selector does not exist: ${decision.selector}`);
      continue;
    }

    console.log(`[flowRunner] AI exceptional-scenario decision for ${scenarioName}: ${JSON.stringify(decision)}`);
    await executeConditionalAction(page, decision);
    await persistScenarioLearning(flowPath, scenario, decision);
    return true;
  }

  return false;
}

async function handlePageInterruptions(page, currentStep, flowPath) {
  if (!currentStep || !flowPath) return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!currentStep.selector) {
      return false;
    }

    if (await elementIsVisible(page, currentStep.selector)) {
      return false;
    }

    // Reuse learned selectors only inside explicitly defined exceptional scenarios.
    const appliedExceptionalScenario = await applyExceptionalScenarios(page, currentStep, flowPath);
    if (appliedExceptionalScenario) {
      await page.waitForTimeout(500);
      continue;
    }

    const flowRaw = await fs.readFile(flowPath, 'utf8');
    const flow = JSON.parse(flowRaw);
    const existingExceptionalScenarios = getExceptionalScenarios(flow);
    const context = await buildInterruptionContext(page, currentStep);
    const decision = await requestInterruptionDecisionFromAI(context, currentStep, existingExceptionalScenarios);

    if (!decision || !decision.shouldAct || decision.action !== 'click' || !decision.selector) {
      return false;
    }

    if (!(await elementIsVisible(page, decision.selector))) {
      console.warn(`[flowRunner] AI interruption selector does not exist: ${decision.selector}`);
      return false;
    }

    console.log(`[flowRunner] AI interruption decision before step ${currentStep.id}: ${JSON.stringify(decision)}`);
    await executeConditionalAction(page, decision);
    await persistLearnedExceptionalScenario(flowPath, currentStep, decision);
    await page.waitForTimeout(500);
  }

  return false;
}

module.exports = {
  handlePageInterruptions,
};
