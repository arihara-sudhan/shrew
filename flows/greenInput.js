// Auto-generated from flow: C:\\Users\\aravi\\Desktop\\auto_moat\\recipes\\greenInput.json
require('dotenv').config();
const { chromium } = require('playwright');
const { getTOTPForPayer } = require('../utils/totp');

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  async function runStep(step, fn) {
    try {
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
      "description": "Open the green input page",
      "role": "",
      "name": "",
      "selector": "",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.goto('https://arihara-sudhan.github.io/some-rpa/green_input.html', { waitUntil: 'load' });
    }
  );
  await runStep(
    {
      "id": "step-2",
      "action": "fill",
      "description": "Type into the input field — resilient to dynamic ID changes",
      "role": "",
      "name": "",
      "selector": "#hemanInput",
      "fallbackSelectors": [
        "#userInput"
      ],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "Hello, Shrewd!"
    },
    async () => {
  try {
    await page.locator('#hemanInput').fill('Hello, Shrewd!');
  } catch (error) {
          await page.fill('#userInput', 'Hello, Shrewd!');
  }
    }
  );
  await runStep(
    {
      "id": "step-3",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds before closing",
      "role": "",
      "name": "",
      "selector": "",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.waitForTimeout(3000);
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
