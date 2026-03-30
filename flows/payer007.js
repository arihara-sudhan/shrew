// Auto-generated from flow: C:\\Users\\aravi\\Desktop\\auto_moat\\recipes\\payer007.json
require('dotenv').config();
const { chromium } = require('playwright');
const { getTOTPForPayer } = require('../utils/totp');
const { handlePageInterruptions } = require('../utils/interruptionHandler');

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const flowPath = 'C:\\Users\\aravi\\Desktop\\auto_moat\\recipes\\payer007.json';

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
  await runStep(
    {
      "id": "step-1",
      "action": "navigate",
      "description": "Open payer 007 page",
      "role": "",
      "name": "",
      "selector": "",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": "",
      "mode": "",
      "once": true,
      "messageIncludes": ""
    },
    async () => {
  await page.goto('https://arihara-sudhan.github.io/some-rpa/payer_007_.html', { waitUntil: 'load' });
    }
  );
  await runStep(
    {
      "id": "step-2",
      "action": "fill",
      "description": "Enter Username",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Username']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "mode": "",
      "once": true,
      "messageIncludes": "",
      "value": "payer_07"
    },
    async () => {
  await page.locator('role=textbox[name=\'Username\']').fill('');
  await page.locator('role=textbox[name=\'Username\']').fill('payer_07');
    }
  );
  await runStep(
    {
      "id": "step-3",
      "action": "fill",
      "description": "Enter Password",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Password']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "mode": "",
      "once": true,
      "messageIncludes": "",
      "value": "payer7127"
    },
    async () => {
  await page.locator('role=textbox[name=\'Password\']').fill('');
  await page.locator('role=textbox[name=\'Password\']').fill('payer7127');
    }
  );
  await runStep(
    {
      "id": "step-4",
      "action": "click",
      "description": "Click Sign In",
      "role": "",
      "name": "",
      "selector": "role=button[name='Sign In']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": "",
      "mode": "",
      "once": true,
      "messageIncludes": ""
    },
    async () => {
  await page.locator('role=button[name=\'Sign In\']').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-5",
      "action": "forEach",
      "description": "Fill claim form for each record",
      "role": "",
      "name": "",
      "selector": "",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": "",
      "mode": "",
      "once": true,
      "messageIncludes": ""
    },
    async () => {
  // Unsupported action: forEach
    }
  );
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
