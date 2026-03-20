const fs = require('fs').promises;
const path = require('path');

function getScriptPathFromFlowPath(flowPath) {
  const flowName = path.basename(flowPath, '.json');
  const normalizedFlowPath = path.normalize(flowPath);
  const flowDir = path.dirname(normalizedFlowPath);

  if (process.env.SCRIPT_DIR) {
    return path.join(process.cwd(), process.env.SCRIPT_DIR, `${flowName}.js`);
  }

  // New layout: recipe JSON under recipes/, generated script under flows/
  if (flowDir.endsWith(`${path.sep}recipes`) || flowDir.endsWith('recipes')) {
    return path.join(path.dirname(flowDir), 'flows', `${flowName}.js`);
  }

  // Legacy layout: JSON under flows/, generated script under scripts/
  if (flowDir.endsWith(`${path.sep}flows`) || flowDir.endsWith('flows')) {
    return path.join(path.dirname(flowDir), 'scripts', `${flowName}.js`);
  }

  // Generic fallback: sibling directories in project root
  return path.join(path.dirname(flowDir), 'flows', `${flowName}.js`);
}

function resolveTemplate(value, context) {
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([^}\s]+)\s*}}/g, (_, key) => {
    if (context[key] !== undefined) return context[key];
    return '';
  });
}

function normalizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  let uri = rawUrl.trim();
  if (!uri) return uri;

  // Already a web URL
  if (/^(https?:|file:)/i.test(uri)) {
    return uri;
  }

  // Normalize separators for path handling, including mixed separators
  uri = uri.replace(/\\/g, '/');

  // Fix cases where base URL is a file path and additional route has been appended, e.g. "C:/.../index.html/green_input.html"
  const fileWithPathMatch = uri.match(/^(.+?\.[a-z0-9]+)(\/.*)$/i);
  if (fileWithPathMatch) {
    const candidateFile = fileWithPathMatch[1];
    const appendPath = fileWithPathMatch[2];
    // If the candidate looks like a file path, use its directory
    if (/^([a-zA-Z]:\/|\/)/.test(candidateFile) || candidateFile.split('/').length > 1) {
      uri = path.posix.join(path.posix.dirname(candidateFile), appendPath);
    }
  }

  // Windows absolute path - convert to file://
  if (/^[a-zA-Z]:\//.test(uri) || uri.startsWith('/')) {
    let normalized = uri;
    if (/^[a-zA-Z]:\//.test(normalized)) {
      normalized = normalized.replace(/^([a-zA-Z]):\//, '/$1/');
    }
    return `file://${normalized}`;
  }

  // Relative path
  const absolute = path.resolve(process.cwd(), uri).replace(/\\/g, '/');
  return `file://${absolute}`;
}

function toSingleQuotedString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function renderLocator(step, context) {
  // Prefer explicit selector from flow JSON if provided (over role), for predictable output.
  if (step.selector) {
    const selector = toSingleQuotedString(resolveTemplate(step.selector, context));
    return `page.locator('${selector}')`;
  }

  if (step.role) {
    const role = toSingleQuotedString(step.role);
    if (step.name) {
      const name = toSingleQuotedString(resolveTemplate(step.name, context));
      return `page.getByRole('${role}', { name: '${name}' })`;
    }
    return `page.getByRole('${role}')`;
  }

  return null;
}

function renderFallbacks(step, context, action, value) {
  if (!Array.isArray(step.fallbackSelectors)) return '';
  const lines = step.fallbackSelectors.map((s) => {
    const sel = toSingleQuotedString(resolveTemplate(s, context));
    if (action === 'fill') {
      return `          await page.fill('${sel}', '${value}');`;
    }
    if (action === 'click') {
      return `          await page.click('${sel}');`;
    }
    return '';
  });
  return lines.join('\n');
}

function renderStep(step, context) {
  switch (step.action) {
    case 'navigate': {
      const rawUrl = resolveTemplate(step.url || '', context);
      const url = toSingleQuotedString(normalizeUrl(rawUrl));
      const waitUntil = toSingleQuotedString(step.waitUntil ? step.waitUntil : 'load');
      return `  await page.goto('${url}', { waitUntil: '${waitUntil}' });`;
    }
    case 'fill': {
      const locatorCode = renderLocator(step, context);
      if (!locatorCode) {
        return `  // Unsupported fill step (no selector): ${JSON.stringify(step)}`;
      }

      const isTOTP = Boolean(step.totpFrom);
      const valueStr = isTOTP ? 'await getTOTPForPayer(\'' + step.totpFrom + '\')' : `\'${toSingleQuotedString(resolveTemplate(step.value || '', context))}\'`;

      let fillCode;
      if (step.clearFirst) {
        fillCode = `  await ${locatorCode}.fill('');\n`;
      } else {
        fillCode = '';
      }

      if (isTOTP) {
        fillCode += `  const otp = ${valueStr};\n  await ${locatorCode}.fill(otp);`;
      } else {
        fillCode += `  await ${locatorCode}.fill(${valueStr});`;
      }

      const fallback = renderFallbacks(step, context, 'fill', isTOTP ? 'otp' : toSingleQuotedString(resolveTemplate(step.value || '', context)));
      if (fallback) {
        if (isTOTP) {
          fillCode = `  try {\n    const otp = ${valueStr};\n    await ${locatorCode}.fill(otp);\n  } catch (error) {\n${fallback}\n  }`;
        } else {
          fillCode = `  try {\n    await ${locatorCode}.fill(${valueStr});\n  } catch (error) {\n${fallback}\n  }`;
        }
      }

      return fillCode;
    }
    case 'click': {
      const locatorCode = renderLocator(step, context);
      if (!locatorCode) {
        return `  // Unsupported click step (no selector): ${JSON.stringify(step)}`;
      }

      let clickCode = `  await ${locatorCode}.click({ force: true });`;
      const fallback = renderFallbacks(step, context, 'click');
      if (fallback) {
        clickCode = `  try {
    await ${locatorCode}.click({ force: true });
  } catch (error) {
${fallback}
  }`;
      }

      return clickCode;
    }
    case 'hover': {
      const locatorCode = renderLocator(step, context);
      if (!locatorCode) {
        return `  // Unsupported hover step (no selector): ${JSON.stringify(step)}`;
      }

      return `  await ${locatorCode}.hover();`;
    }
    case 'selectOption': {
      const locatorCode = renderLocator(step, context);
      if (!locatorCode) {
        return `  // Unsupported selectOption step (no selector): ${JSON.stringify(step)}`;
      }

      const optionValue = toSingleQuotedString(resolveTemplate(step.value || '', context));
      return `  await ${locatorCode}.selectOption('${optionValue}');`;
    }
    case 'press': {
      const locatorCode = renderLocator(step, context);
      if (!locatorCode) {
        return `  // Unsupported press step (no selector): ${JSON.stringify(step)}`;
      }

      const key = toSingleQuotedString(resolveTemplate(step.key || '', context));
      return `  await ${locatorCode}.press('${key}');`;
    }
    case 'waitForTimeout': {
      const ms = Number(step.ms || 0);
      return `  await page.waitForTimeout(${ms});`;
    }
    default:
      return `  // Unsupported action: ${step.action}`;
  }
}

function buildResolvedStepMeta(step, context) {
  return {
    id: step.id || '',
    action: step.action || '',
    description: step.description || '',
    role: step.role || '',
    name: step.name ? resolveTemplate(step.name, context) : '',
    selector: step.selector ? resolveTemplate(step.selector, context) : '',
    fallbackSelectors: Array.isArray(step.fallbackSelectors)
      ? step.fallbackSelectors.map((selector) => resolveTemplate(selector, context))
      : [],
    waitForNavigation: step.waitForNavigation || '',
    waitForURL: step.waitForURL || '',
    waitForLoadState: step.waitForLoadState || '',
    clearFirst: Boolean(step.clearFirst),
    totpFrom: step.totpFrom || '',
    value: typeof step.value === 'string' ? resolveTemplate(step.value, context) : step.value,
  };
}

function renderScriptFromFlow(flow, flowPath) {
  const context = {
    ...flow.config,
    ...flow.variables,
  };

  const headless = flow.config && flow.config.headless === false ? false : true;

  const stepsCode = (flow.steps || [])
    .map((step) => {
      const stepCode = renderStep(step, context);
      const stepMeta = JSON.stringify(buildResolvedStepMeta(step, context), null, 2)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');

      return `  await runStep(
${stepMeta},
    async () => {
${stepCode}
    }
  );`;
    })
    .join('\n');

  const quotedFlowPath = flowPath.replace(/\\/g, '\\\\');

  return `// Auto-generated from flow: ${quotedFlowPath}
require('dotenv').config();
const { chromium } = require('playwright');
const { getTOTPForPayer } = require('../utils/totp');
const { handlePageInterruptions } = require('../utils/interruptionHandler');

async function run() {
  const browser = await chromium.launch({ headless: ${headless} });
  const page = await browser.newPage();
  const flowPath = '${quotedFlowPath}';

  async function runStep(step, fn) {
    try {
      await handlePageInterruptions(page, step, flowPath);
      await fn();
    } catch (error) {
      error.step = step;
      throw error;
    }
  }

  try {
${stepsCode}
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Flow run failed:', error);
    process.exit(1);
  });
}

module.exports = run;
`;
}

async function syncFlowToScript(flowPath) {
  const scriptPath = getScriptPathFromFlowPath(flowPath);

  const flowRaw = await fs.readFile(flowPath, 'utf-8');
  let flow;
  try {
    flow = JSON.parse(flowRaw);
  } catch (error) {
    throw new Error(`Unable to parse flow JSON at ${flowPath}: ${error.message}`);
  }

  const expectedContent = renderScriptFromFlow(flow, flowPath);

  let currentContent = null;
  try {
    currentContent = await fs.readFile(scriptPath, 'utf-8');
  } catch {
    // file does not exist
  }

  if (currentContent !== expectedContent) {
    await fs.writeFile(scriptPath, expectedContent, 'utf-8');
    return { updated: true, scriptPath };
  }

  return { updated: false, scriptPath };
}

async function ensureCompiledFlow(flowPath) {
  const { updated, scriptPath } = await syncFlowToScript(flowPath);
  return { updated, scriptPath };
}

module.exports = {
  getScriptPathFromFlowPath,
  resolveTemplate,
  renderStep,
  renderScriptFromFlow,
  syncFlowToScript,
  ensureCompiledFlow,
};
