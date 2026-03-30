require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');
const { ensureCompiledFlow } = require('./flowCompiler');
const { getTOTPForPayer } = require('./totp');
const { handlePageInterruptions } = require('./interruptionHandler');
const {
  executeStepActivity,
  executeStepActivityStrict,
  healStepSelector,
  supportsHealingForAction,
} = require('./activities');

function getInterruptionAwareStep(step = {}) {
  if (step && step.action === 'captureClaimResult' && !step.selector && step.resultsReadySelector) {
    return {
      ...step,
      selector: step.resultsReadySelector,
    };
  }
  return step;
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
          await handlePageInterruptions(page, getInterruptionAwareStep(step), flowPath);
          await executeStepActivity(page, step, flowPath, flow, failedSelectorsHistory);
          break;
        } catch (error) {
          if (step.selector) {
            failedSelectorsHistory.push(step.selector);
          }

          if (supportsHealingForAction(step.action)) {
            console.warn(`[flowRunner] ${step.action} step failed, trying healing (selector) for step ${step.id}: ${error.message}`);
            const reselected = await healStepSelector(page, step, flowPath, flow, failedSelectorsHistory);
            if (reselected) {
              attempts += 1;
              continue;
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
        await handlePageInterruptions(page, getInterruptionAwareStep(currentStep), flowPath);
        await executeStepActivityStrict(page, currentStep, flow);
      } catch (replayError) {
        const replayFailedSelectorsHistory = [];
        if (currentStep.selector) {
          replayFailedSelectorsHistory.push(currentStep.selector);
        }

        console.warn(`[flowRunner] Replay failed on prerequisite step ${currentStep.id}: ${replayError.message}`);
        const replayHealedSelector = await healStepSelector(page, {
          ...currentStep,
          failedSelectorsHistory: replayFailedSelectorsHistory,
        }, flowPath, flow, replayFailedSelectorsHistory);

        if (!replayHealedSelector) {
          throw replayError;
        }

        console.log(`[flowRunner] Healed prerequisite step ${currentStep.id} with selector ${replayHealedSelector}. Re-running compiled script.`);
        return replayHealedSelector;
      }
    }

    const healedSelector = await healStepSelector(page, {
      ...step,
      ...failedStep,
    }, flowPath, flow, failedSelectorsHistory);

    if (!healedSelector) {
      throw new Error(`AI could not heal selector for step ${step.id}`);
    }

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
  console.log('[flowRunner] Running interpreted flow activities');
  await executeFlow(flowPath);
}

if (require.main === module) {
  runFlow(process.argv[2]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runFlow,
  executeFlow,
  getTOTPForPayer,
};
