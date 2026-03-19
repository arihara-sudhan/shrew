// Auto-generated from flow: recipes\\availity.json
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
      "description": "Open login page",
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
  await page.goto('https://essentials.availity.com/static/public/onb/onboarding-ui-apps/availity-fr-ui/#/login', { waitUntil: 'load' });
    }
  );
  await runStep(
    {
      "id": "step-2",
      "action": "fill",
      "description": "Enter User ID",
      "role": "textbox",
      "name": "User ID",
      "selector": "role=textbox[name='User ID']",
      "fallbackSelectors": [
        "input[aria-label='User ID']",
        "input[placeholder='User ID']"
      ],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "tanishqmoative"
    },
    async () => {
  try {
    await page.locator('role=textbox[name=\'User ID\']').fill('tanishqmoative');
  } catch (error) {
          await page.fill('input[aria-label=\'User ID\']', 'tanishqmoative');
          await page.fill('input[placeholder=\'User ID\']', 'tanishqmoative');
  }
    }
  );
  await runStep(
    {
      "id": "step-3",
      "action": "fill",
      "description": "Enter Password",
      "role": "textbox",
      "name": "Password",
      "selector": "role=textbox[name='Password']",
      "fallbackSelectors": [
        "input[aria-label='Password']",
        "input[placeholder='Password']"
      ],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "RCS#pass002"
    },
    async () => {
  try {
    await page.locator('role=textbox[name=\'Password\']').fill('RCS#pass002');
  } catch (error) {
          await page.fill('input[aria-label=\'Password\']', 'RCS#pass002');
          await page.fill('input[placeholder=\'Password\']', 'RCS#pass002');
  }
    }
  );
  await runStep(
    {
      "id": "step-4",
      "action": "click",
      "description": "Click Sign In",
      "role": "",
      "name": "",
      "selector": "button:has-text('Sign In')",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "**/authenticate**",
      "waitForLoadState": "networkidle",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('button:has-text(\'Sign In\')').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-5",
      "action": "click",
      "description": "Select Authenticator app option",
      "role": "radio",
      "name": "Authenticate me using my",
      "selector": "input[type='radio'][value='Authenticate me using my Authenticator app']",
      "fallbackSelectors": [
        "role=radio[name='Authenticate me using my']",
        "label:has-text('Authenticate me using my Authenticator app')",
        "input[type='radio'][name='choice']"
      ],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  try {
    await page.locator('input[type=\'radio\'][value=\'Authenticate me using my Authenticator app\']').click({ force: true });
  } catch (error) {
          await page.click('role=radio[name=\'Authenticate me using my\']');
          await page.click('label:has-text(\'Authenticate me using my Authenticator app\')');
          await page.click('input[type=\'radio\'][name=\'choice\']');
  }
    }
  );
  await runStep(
    {
      "id": "step-6",
      "action": "click",
      "description": "Click Continue after choosing authenticator app",
      "role": "",
      "name": "",
      "selector": "button:has-text('Continue')",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "**/verify",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('button:has-text(\'Continue\')').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-7",
      "action": "fill",
      "description": "Enter authenticator OTP code",
      "role": "",
      "name": "",
      "selector": "input[name='code']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": "availity"
    },
    async () => {
  const otp = await getTOTPForPayer('availity');
  await page.locator('input[name=\'code\']').fill(otp);
    }
  );
  await runStep(
    {
      "id": "step-8",
      "action": "click",
      "description": "Click Continue after entering OTP",
      "role": "",
      "name": "",
      "selector": "button:has-text('Continue')",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('button:has-text(\'Continue\')').click({ force: true });
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
