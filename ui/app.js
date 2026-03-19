const state = {
  recipes: [],
  selectedRecipe: null,
  running: false,
  editingStepId: null,
};

const elements = {
  recipeList: document.getElementById('recipeList'),
  refreshButton: document.getElementById('refreshButton'),
  addButton: document.getElementById('addButton'),
  runButton: document.getElementById('runButton'),
  recipeTitle: document.getElementById('recipeTitle'),
  actionSummary: document.getElementById('actionSummary'),
  stepList: document.getElementById('stepList'),
  runOutput: document.getElementById('runOutput'),
  runStatus: document.getElementById('runStatus'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  closeModalButton: document.getElementById('closeModalButton'),
  recipeNameInput: document.getElementById('recipeNameInput'),
  codegenInput: document.getElementById('codegenInput'),
  createRecipeButton: document.getElementById('createRecipeButton'),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setRunStatus(label, kind) {
  elements.runStatus.textContent = label;
  elements.runStatus.className = `status-pill ${kind}`;
}

async function readApiResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function summarizeStep(step) {
  if (step.selector) return `selector: ${step.selector}`;
  if (step.url) return `url: ${step.url}`;
  if (step.value) return `value: ${step.value}`;
  if (step.ms) return `wait: ${step.ms}ms`;
  return 'No extra detail';
}

function getEditableFields(step) {
  const fields = [
    ['id', step.id || ''],
    ['action', step.action || ''],
    ['description', step.description || ''],
    ['selector', step.selector || ''],
  ];

  const optionalKeys = [
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
  ];

  for (const key of optionalKeys) {
    if (step[key] !== undefined && step[key] !== null) {
      fields.push([key, step[key]]);
    }
  }

  return fields;
}

function formatFieldLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function formatStepId(stepId) {
  const match = String(stepId || '').match(/^step-(\d+)$/i);
  if (match) {
    return `STEP ${match[1]}`;
  }
  return String(stepId || 'STEP');
}

function renderStepEditor(step) {
  const fields = getEditableFields(step);

  return `
    <li class="step-item editing" data-step-id="${escapeHtml(step.id || '')}">
      <header>
        <strong class="step-id">${escapeHtml(formatStepId(step.id || 'step'))}</strong>
        <button class="step-edit-toggle saving" type="button" data-step-toggle="${escapeHtml(step.id || '')}" aria-label="Save step">&#10003;</button>
      </header>
      <div class="step-edit-grid">
        ${fields.map(([key, value]) => `
          <label class="step-field">
            <span>${escapeHtml(formatFieldLabel(key))}</span>
            ${String(value).length > 60 || key === 'description' || key === 'selector' || key === 'url'
              ? `<textarea data-field="${escapeHtml(key)}" rows="2">${escapeHtml(value)}</textarea>`
              : `<input data-field="${escapeHtml(key)}" type="text" value="${escapeHtml(value)}" />`}
          </label>
        `).join('')}
      </div>
      <div class="step-edit-hint">Click the tick to save.</div>
    </li>
  `;
}

function renderRecipeList() {
  if (!state.recipes.length) {
    elements.recipeList.innerHTML = '<p>No recipes found.</p>';
    return;
  }

  elements.recipeList.innerHTML = state.recipes.map((recipe) => `
    <button
      type="button"
      class="recipe-card ${state.selectedRecipe?.fileName === recipe.fileName ? 'active' : ''}"
      data-file="${escapeHtml(recipe.fileName)}"
    >
      <strong>${escapeHtml(recipe.name)}</strong>
      <p>${escapeHtml(recipe.description || 'No description yet.')}</p>
      <footer>
        <span class="chip">${recipe.stepCount} steps</span>
        <span class="chip">${Object.keys(recipe.actions || {}).length} actions</span>
      </footer>
    </button>
  `).join('');

  for (const button of elements.recipeList.querySelectorAll('.recipe-card')) {
    button.addEventListener('click', () => {
      const recipe = state.recipes.find((item) => item.fileName === button.dataset.file);
      selectRecipe(recipe);
    });
  }
}

function renderRecipeDetail() {
  const recipe = state.selectedRecipe;

  if (!recipe) {
    elements.recipeTitle.textContent = 'No recipe selected';
    elements.actionSummary.innerHTML = '';
    elements.stepList.innerHTML = '';
    elements.runButton.disabled = true;
    return;
  }

  elements.recipeTitle.textContent = recipe.name;
  elements.runButton.disabled = state.running;

  elements.actionSummary.innerHTML = Object.entries(recipe.actions || {})
    .map(([action, count]) => `<span class="chip">${escapeHtml(action)} x${count}</span>`)
    .join('');

  elements.stepList.innerHTML = (recipe.steps || []).map((step) => {
    if (state.editingStepId === step.id) {
      return renderStepEditor(step);
    }

    return `
    <li class="step-item" data-step-id="${escapeHtml(step.id || '')}">
      <header>
        <strong class="step-id">${escapeHtml(formatStepId(step.id || 'step'))}</strong>
        <div class="step-header-actions">
          <span class="chip">${escapeHtml(step.action || 'unknown')}</span>
          <button class="step-edit-toggle" type="button" data-step-toggle="${escapeHtml(step.id || '')}" aria-label="Edit step">&#9998;</button>
        </div>
      </header>
      <p class="step-description">${escapeHtml(step.description || 'No description')}</p>
      <div class="step-detail">${escapeHtml(summarizeStep(step))}</div>
    </li>
  `;
  }).join('');

  for (const button of elements.stepList.querySelectorAll('[data-step-toggle]')) {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const stepId = button.dataset.stepToggle;
      if (!stepId) return;

      if (state.editingStepId === stepId) {
        await saveEditedStep(stepId);
        return;
      }

      state.editingStepId = stepId;
      renderRecipeDetail();
    });
  }
}

function selectRecipe(recipe) {
  state.selectedRecipe = recipe;
  state.editingStepId = null;
  renderRecipeList();
  renderRecipeDetail();
}

function openAddModal() {
  elements.modalBackdrop.classList.remove('hidden');
  elements.recipeNameInput.focus();
}

function closeAddModal() {
  elements.modalBackdrop.classList.add('hidden');
}

async function loadRecipes() {
  elements.runOutput.textContent = 'Loading recipes...';
  const response = await fetch('/api/recipes');
  const payload = await readApiResponse(response);
  state.recipes = payload.recipes || [];

  if (!state.selectedRecipe && state.recipes.length) {
    state.selectedRecipe = state.recipes[0];
  } else if (state.selectedRecipe) {
    state.selectedRecipe = state.recipes.find((item) => item.fileName === state.selectedRecipe.fileName) || state.recipes[0] || null;
  }

  renderRecipeList();
  renderRecipeDetail();
  elements.runOutput.textContent = 'Pick a recipe to inspect it here.';
  setRunStatus('Idle', 'idle');
}

async function saveEditedStep(stepId) {
  if (!state.selectedRecipe) return;

  const stepItem = elements.stepList.querySelector(`.step-item[data-step-id="${CSS.escape(stepId)}"]`);
  if (!stepItem) return;

  const updates = {};
  for (const field of stepItem.querySelectorAll('[data-field]')) {
    updates[field.dataset.field] = field.value;
  }

  setRunStatus('Running', 'running');
  elements.runOutput.textContent = `Saving ${stepId} in ${state.selectedRecipe.fileName}...\n`;

  try {
    const response = await fetch('/api/recipes/update-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipeFile: state.selectedRecipe.fileName,
        stepId,
        updates,
      }),
    });
    const payload = await readApiResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || 'Step update failed.');
    }

    state.editingStepId = null;
    await loadRecipes();
    const refreshed = state.recipes.find((item) => item.fileName === state.selectedRecipe.fileName);
    if (refreshed) {
      state.selectedRecipe = refreshed;
      renderRecipeList();
      renderRecipeDetail();
    }
    elements.runOutput.textContent = `Saved ${stepId} to ${state.selectedRecipe.fileName} and recompiled the flow.`;
    setRunStatus('Success', 'success');
  } catch (error) {
    elements.runOutput.textContent = error.message || 'Step update failed.';
    setRunStatus('Failed', 'error');
  }
}

async function runSelectedRecipe() {
  if (!state.selectedRecipe || state.running) return;

  state.running = true;
  elements.runButton.disabled = true;
  setRunStatus('Running', 'running');
  elements.runOutput.textContent = `Running ${state.selectedRecipe.fileName}...\n`;

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipeFile: state.selectedRecipe.fileName }),
    });
    const payload = await readApiResponse(response);
    const output = [payload.stdout, payload.stderr].filter(Boolean).join('\n');
    elements.runOutput.textContent = output || 'Run completed with no output.';
    setRunStatus(payload.ok ? 'Success' : `Failed (${payload.code})`, payload.ok ? 'success' : 'error');
  } catch (error) {
    elements.runOutput.textContent = error.message || 'Run failed.';
    setRunStatus('Failed', 'error');
  } finally {
    state.running = false;
    elements.runButton.disabled = false;
  }
}

async function createRecipeFromCodegen() {
  const name = elements.recipeNameInput.value.trim();
  const snippet = elements.codegenInput.value.trim();

  if (!name || !snippet) {
    elements.runOutput.textContent = 'Recipe name and Playwright codegen are both required.';
    setRunStatus('Failed', 'error');
    return;
  }

  elements.createRecipeButton.disabled = true;
  setRunStatus('Running', 'running');
  elements.runOutput.textContent = `Creating recipe ${name} from codegen...\n`;

  try {
    const response = await fetch('/api/recipes/create-from-codegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, snippet }),
    });
    const payload = await readApiResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || 'Recipe creation failed.');
    }

    await loadRecipes();
    const created = state.recipes.find((item) => item.fileName === payload.fileName);
    if (created) {
      selectRecipe(created);
    }
    closeAddModal();
    elements.recipeNameInput.value = '';
    elements.codegenInput.value = '';
    elements.runOutput.textContent = `Created ${payload.fileName} and compiled its flow successfully.`;
    setRunStatus('Success', 'success');
  } catch (error) {
    elements.runOutput.textContent = error.message || 'Recipe creation failed.';
    setRunStatus('Failed', 'error');
  } finally {
    elements.createRecipeButton.disabled = false;
  }
}

elements.refreshButton.addEventListener('click', loadRecipes);
elements.runButton.addEventListener('click', runSelectedRecipe);
elements.addButton.addEventListener('click', openAddModal);
elements.closeModalButton.addEventListener('click', closeAddModal);
elements.createRecipeButton.addEventListener('click', createRecipeFromCodegen);
elements.modalBackdrop.addEventListener('click', (event) => {
  if (event.target === elements.modalBackdrop) {
    closeAddModal();
  }
});

loadRecipes().catch((error) => {
  elements.runOutput.textContent = error.message || 'Failed to load recipes.';
  setRunStatus('Failed', 'error');
});
