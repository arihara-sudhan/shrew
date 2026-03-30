const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { ensureCompiledFlow } = require('../utils/flowCompiler');

const ROOT_DIR = path.resolve(__dirname, '..');
const UI_DIR = path.join(ROOT_DIR, 'ui');
const UI_STATIC_DIR = path.join(UI_DIR, 'static');
const RECIPES_DIR = path.join(ROOT_DIR, 'recipes');
const PORT = Number(process.env.PORT || 3010);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function summarizeRecipe(recipe, fileName) {
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const actions = steps.reduce((acc, step) => {
    const key = step.action || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    fileName,
    id: recipe.id || fileName.replace(/\.json$/i, ''),
    name: recipe.name || fileName.replace(/\.json$/i, ''),
    description: recipe.description || '',
    version: recipe.version || '',
    baseUrl: recipe.config?.baseUrl || '',
    stepCount: steps.length,
    actions,
    variables: Object.keys(recipe.variables || {}),
    steps,
    config: recipe.config || {},
  };
}

async function loadRecipes() {
  const entries = await fsp.readdir(RECIPES_DIR, { withFileTypes: true });
  const recipes = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const recipePath = path.join(RECIPES_DIR, entry.name);
    const raw = await fsp.readFile(recipePath, 'utf8');
    const recipe = JSON.parse(raw);
    recipes.push(summarizeRecipe(recipe, entry.name));
  }

  recipes.sort((a, b) => a.name.localeCompare(b.name));
  return recipes;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function runFlow(recipeFile) {
  const recipePath = path.join('recipes', recipeFile);

  return new Promise((resolve) => {
    const child = spawn('node', ['utils/runFlow.js', recipePath], {
      cwd: ROOT_DIR,
      shell: false,
      windowsHide: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

function slugifyRecipeName(input) {
  return String(input || 'shrew-flow')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'shrew-flow';
}

async function requestRecipeFromAI(name, snippet) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY is required to create recipes from codegen.');
  }

  const prompt = `Convert this Playwright codegen snippet into the Shrew recipe JSON format.

Return valid JSON only.
Do not wrap it in markdown.
Use this schema:
{
  "id": string,
  "name": string,
  "version": "1.0.0",
  "description": string,
  "config": {
    "baseUrl": string,
    "timeout": 30000,
    "retries": 1,
    "headless": false,
    "viewport": { "width": 1280, "height": 720 },
    "video": false
  },
  "variables": object,
  "steps": array,
  "teardown": []
}

Rules:
- Preserve Playwright order exactly.
- Supported actions: navigate, click, fill, hover, press, selectOption, waitForTimeout, handleDialog, forEach, captureClaimResult.
- Use step ids like "step-1", "step-2", etc.
- For goto use action "navigate" and field "url".
- For fill use "selector", "value", and "clearFirst": true.
- For click/hover/press/selectOption use "selector".
- For press use field "key".
- For selectOption use field "value".
- For dialog handling use action "handleDialog" with "mode" as "dismiss" or "accept", optional "once", and optional "messageIncludes".
- For looping use action "forEach" with "source" (JSON array path), optional "item", and nested "steps".
- For results scraping use action "captureClaimResult" with optional "requiredText", "checkDateSelector", "statusSelector", and output path fields.
- Derive descriptions from the code intent.
- Put literal values into variables when they look reusable, otherwise preserve them directly.
- Infer config.baseUrl from the first goto URL origin when possible.
- Keep selectors as close as possible to the original code.

Recipe name: ${name}

Playwright snippet:
${snippet}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You convert Playwright codegen snippets into clean Shrew automation recipe JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 2200,
    }),
  });

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content?.trim();

  if (!response.ok || !content) {
    throw new Error(payload?.error?.message || 'AI recipe generation failed.');
  }

  const normalized = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(normalized);
}

async function createRecipeFromSnippet(name, snippet) {
  const recipe = await requestRecipeFromAI(name, snippet);
  const fileName = `${slugifyRecipeName(name)}.json`;
  const recipePath = path.join(RECIPES_DIR, fileName);

  await fsp.writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, 'utf8');
  await ensureCompiledFlow(path.join('recipes', fileName));

  return {
    fileName,
    recipe: summarizeRecipe(recipe, fileName),
  };
}

async function updateRecipeStep(recipeFile, stepId, updates) {
  const recipePath = path.join(RECIPES_DIR, recipeFile);
  const raw = await fsp.readFile(recipePath, 'utf8');
  const recipe = JSON.parse(raw);
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const stepIndex = steps.findIndex((step) => step.id === stepId);

  if (stepIndex === -1) {
    throw new Error(`Step ${stepId} not found in ${recipeFile}.`);
  }

  const allowedKeys = new Set([
    'id',
    'action',
    'description',
    'selector',
    'url',
    'value',
    'ms',
    'key',
    'role',
    'name',
    'totpFrom',
    'waitUntil',
    'waitForURL',
    'waitForLoadState',
    'waitForNavigation',
    'mode',
    'once',
    'messageIncludes',
    'source',
    'item',
    'steps',
    'maxItems',
    'requiredText',
    'checkDateSelector',
    'statusSelector',
    'outputCheckDatePath',
    'outputStatusPath',
  ]);

  for (const [key, value] of Object.entries(updates || {})) {
    if (!allowedKeys.has(key)) continue;
    steps[stepIndex][key] = value;
  }

  recipe.steps = steps;
  await fsp.writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, 'utf8');
  await ensureCompiledFlow(path.join('recipes', recipeFile));

  return summarizeRecipe(recipe, recipeFile);
}

async function serveStatic(req, res, urlPath) {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const baseDir = safePath === '/logo.png' ? UI_STATIC_DIR : UI_DIR;
  const filePath = path.normalize(path.join(baseDir, safePath));

  if (!filePath.startsWith(baseDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const content = await fsp.readFile(filePath);
  res.writeHead(200, { 'Content-Type': getContentType(filePath) });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/recipes') {
      const recipes = await loadRecipes();
      sendJson(res, 200, { recipes });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readRequestBody(req);
      const payload = body ? JSON.parse(body) : {};
      const recipeFile = payload.recipeFile;

      if (!recipeFile || recipeFile.includes('/') || recipeFile.includes('\\')) {
        sendJson(res, 400, { error: 'Valid recipeFile is required.' });
        return;
      }

      const recipePath = path.join(RECIPES_DIR, recipeFile);
      if (!fs.existsSync(recipePath)) {
        sendJson(res, 404, { error: 'Recipe not found.' });
        return;
      }

      const result = await runFlow(recipeFile);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/recipes/create-from-codegen') {
      const body = await readRequestBody(req);
      const payload = body ? JSON.parse(body) : {};
      const name = String(payload.name || '').trim();
      const snippet = String(payload.snippet || '').trim();

      if (!name) {
        sendJson(res, 400, { error: 'Recipe name is required.' });
        return;
      }

      if (!snippet) {
        sendJson(res, 400, { error: 'Playwright codegen snippet is required.' });
        return;
      }

      const result = await createRecipeFromSnippet(name, snippet);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/recipes/update-step') {
      const body = await readRequestBody(req);
      const payload = body ? JSON.parse(body) : {};
      const recipeFile = String(payload.recipeFile || '').trim();
      const stepId = String(payload.stepId || '').trim();
      const updates = payload.updates || {};

      if (!recipeFile || recipeFile.includes('/') || recipeFile.includes('\\')) {
        sendJson(res, 400, { error: 'Valid recipeFile is required.' });
        return;
      }

      if (!stepId) {
        sendJson(res, 400, { error: 'stepId is required.' });
        return;
      }

      const recipePath = path.join(RECIPES_DIR, recipeFile);
      if (!fs.existsSync(recipePath)) {
        sendJson(res, 404, { error: 'Recipe not found.' });
        return;
      }

      const recipe = await updateRecipeStep(recipeFile, stepId, updates);
      sendJson(res, 200, { recipe });
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res, url.pathname);
      return;
    }

    sendText(res, 405, 'Method not allowed');
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Unknown server error' });
  }
});

server.listen(PORT, () => {
  console.log(`[shrew-ui] http://localhost:${PORT}`);
});
