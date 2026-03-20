require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
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

async function requestInterruptionDecisionFromAI(context, currentStep = {}, existingConditionals = []) {
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
Existing conditionals: ${JSON.stringify(existingConditionals)}
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

async function persistConditional(flowPath, decision) {
  const raw = await fs.readFile(flowPath, 'utf8');
  const flow = JSON.parse(raw);
  flow.conditionals = Array.isArray(flow.conditionals) ? flow.conditionals : [];

  const duplicate = flow.conditionals.find((conditional) =>
    conditional?.then?.selector === decision.selector
    && conditional?.when?.urlIncludes === (decision.condition?.urlIncludes || '')
    && conditional?.when?.titleIncludes === (decision.condition?.titleIncludes || '')
    && conditional?.when?.textIncludes === (decision.condition?.textIncludes || '')
  );

  if (!duplicate) {
    flow.conditionals.push({
      id: `conditional-${Date.now()}`,
      when: {
        urlIncludes: decision.condition?.urlIncludes || '',
        titleIncludes: decision.condition?.titleIncludes || '',
        textIncludes: decision.condition?.textIncludes || '',
      },
      then: {
        action: decision.action || 'click',
        description: decision.description || 'Handle unexpected page interruption',
        selector: decision.selector,
      },
    });

    await fs.writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
    console.log(`[flowRunner] Added learned conditional to ${flowPath} for selector ${decision.selector}`);
    await ensureCompiledFlow(flowPath);
  }
}

async function executeConditionalAction(page, conditional) {
  const action = conditional?.then?.action || conditional?.action || 'click';
  const selector = conditional?.then?.selector || conditional?.selector;
  if (!selector) return false;

  const locator = await getLocator(page, selector);
  if (!locator) return false;

  if (action === 'click') {
    await locator.click({ force: true });
    return true;
  }

  return false;
}

async function applyKnownConditionals(page, flowPath) {
  const raw = await fs.readFile(flowPath, 'utf8');
  const flow = JSON.parse(raw);
  const conditionals = Array.isArray(flow.conditionals) ? flow.conditionals : [];
  if (!conditionals.length) return false;

  const snapshot = await pageSnapshot(page);

  for (const conditional of conditionals) {
    if (!conditionMatches(snapshot, conditional.when || {})) continue;
    const selector = conditional?.then?.selector || conditional?.selector;
    if (!selector || !(await elementExists(page, selector))) continue;

    console.log(`[flowRunner] Applying learned conditional ${conditional.id || '(unknown)'} using ${selector}`);
    await executeConditionalAction(page, conditional);
    return true;
  }

  return false;
}

async function handlePageInterruptions(page, currentStep, flowPath) {
  if (!currentStep || !flowPath) return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const appliedKnownConditional = await applyKnownConditionals(page, flowPath);
    if (appliedKnownConditional) {
      await page.waitForTimeout(500);
      continue;
    }

    if (!currentStep.selector) {
      return false;
    }

    if (await elementExists(page, currentStep.selector)) {
      return false;
    }

    const flowRaw = await fs.readFile(flowPath, 'utf8');
    const flow = JSON.parse(flowRaw);
    const existingConditionals = Array.isArray(flow.conditionals) ? flow.conditionals : [];
    const context = await buildInterruptionContext(page, currentStep);
    const decision = await requestInterruptionDecisionFromAI(context, currentStep, existingConditionals);

    if (!decision || !decision.shouldAct || decision.action !== 'click' || !decision.selector) {
      return false;
    }

    if (!(await elementExists(page, decision.selector))) {
      console.warn(`[flowRunner] AI interruption selector does not exist: ${decision.selector}`);
      return false;
    }

    console.log(`[flowRunner] AI interruption decision before step ${currentStep.id}: ${JSON.stringify(decision)}`);
    await executeConditionalAction(page, decision);
    await persistConditional(flowPath, decision);
    await page.waitForTimeout(500);
  }

  return false;
}

module.exports = {
  handlePageInterruptions,
};
