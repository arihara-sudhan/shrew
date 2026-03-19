const fs = require('fs');
const path = require('path');

// Example codegen snippet: page.fill('input[name="email"]', 'test@example.com');
// This tool is not full parser; it handles simple page.fill/page.click/page.locator for text input.

if (process.argv.length < 4) {
  console.log('Usage: node scripts/codegen-to-json.js <recipes-json-path> <codegen-snippet-file>');
  process.exit(1);
}

const recipesPath = path.resolve(process.cwd(), process.argv[2]);
const snippetPath = path.resolve(process.cwd(), process.argv[3]);

const jsonText = fs.readFileSync(recipesPath, 'utf-8');
const flow = JSON.parse(jsonText);
const snippet = fs.readFileSync(snippetPath, 'utf-8');

function extractSteps(code) {
  const lines = code.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const actions = [];

  for (const line of lines) {
    const fillMatch = line.match(/page\.fill\((['\"])(.+?)\1\s*,\s*(['\"])(.*?)\3\)/);
    if (fillMatch) {
      actions.push({ action: 'fill', selector: fillMatch[2], value: fillMatch[4] });
      continue;
    }

    const clickMatch = line.match(/page\.click\((['\"])(.+?)\1\)/);
    if (clickMatch) {
      actions.push({ action: 'click', selector: clickMatch[2] });
      continue;
    }

    const gotoMatch = line.match(/page\.goto\((['\"])(.+?)\1/);
    if (gotoMatch) {
      actions.push({ action: 'navigate', url: gotoMatch[2] });
      continue;
    }
  }

  return actions;
}

const actions = extractSteps(snippet);
if (!actions.length) {
  console.error('No supported actions found in snippet.');
  process.exit(1);
}

const existingSteps = flow.steps || [];

// Append as fallback steps (if exact `id` exists, update; else append)
actions.forEach((a, idx) => {
  let target = existingSteps[idx];
  if (!target) {
    target = { id: `step-gen-${Date.now()}-${idx}` };
    existingSteps.push(target);
  }

  if (a.action === 'fill') {
    target.action = 'fill';
    target.description = target.description || 'Auto inserted from codegen';
    target.selector = a.selector;
    target.fallbackSelectors = Array.from(new Set([...(target.fallbackSelectors || []), a.selector]));
    target.value = target.value || a.value || '{{inputText}}';
    target.clearFirst = target.clearFirst !== undefined ? target.clearFirst : true;
  } else if (a.action === 'click') {
    target.action = 'click';
    target.description = target.description || 'Auto inserted from codegen';
    target.selector = a.selector;
  } else if (a.action === 'navigate') {
    target.action = 'navigate';
    target.url = a.url;
    target.description = target.description || 'Auto inserted from codegen';
  }
});

flow.steps = existingSteps;
fs.writeFileSync(recipesPath, JSON.stringify(flow, null, 2), 'utf-8');
console.log(`Updated ${recipesPath} with ${actions.length} actions from ${snippetPath}`);
