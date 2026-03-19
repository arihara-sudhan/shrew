// Auto-generated from flow: C:\\Users\\aravi\\Desktop\\auto_moat\\recipes\\wayStar.json
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
      "description": "Open Waystar login page",
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
  await page.goto('https://login.zirmed.com/UI/Login', { waitUntil: 'load' });
    }
  );
  await runStep(
    {
      "id": "step-2",
      "action": "fill",
      "description": "Enter login name",
      "role": "",
      "name": "",
      "selector": "#loginName",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "TanMoative"
    },
    async () => {
  await page.locator('#loginName').fill('');
  await page.locator('#loginName').fill('TanMoative');
    }
  );
  await runStep(
    {
      "id": "step-3",
      "action": "fill",
      "description": "Enter password",
      "role": "",
      "name": "",
      "selector": "#password",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "Rcs@moative46483"
    },
    async () => {
  await page.locator('#password').fill('');
  await page.locator('#password').fill('Rcs@moative46483');
    }
  );
  await runStep(
    {
      "id": "step-4",
      "action": "click",
      "description": "Click Log in",
      "role": "",
      "name": "",
      "selector": "role=button[name='Log in']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=button[name=\'Log in\']').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-5",
      "action": "navigate",
      "description": "Open Claims page directly",
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
  await page.goto('https://claims.zirmed.com/Claims/Listing/Index?appid=1', { waitUntil: 'load' });
    }
  );
  await runStep(
    {
      "id": "step-6",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after opening Claims page",
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
  await runStep(
    {
      "id": "step-7",
      "action": "selectOption",
      "description": "Set claim status to all",
      "role": "",
      "name": "",
      "selector": "#SearchCriteria_Status",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": "",
      "value": "-1"
    },
    async () => {
  await page.locator('#SearchCriteria_Status').selectOption('-1');
    }
  );
  await runStep(
    {
      "id": "step-8",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after setting claim status",
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
  await runStep(
    {
      "id": "step-9",
      "action": "selectOption",
      "description": "Set transaction date range to two years",
      "role": "",
      "name": "",
      "selector": "#SearchCriteria_TransDate",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": "",
      "value": "2 years"
    },
    async () => {
  await page.locator('#SearchCriteria_TransDate').selectOption('2 years');
    }
  );
  await runStep(
    {
      "id": "step-10",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after setting transaction date",
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
  await runStep(
    {
      "id": "step-11",
      "action": "click",
      "description": "Run claim search",
      "role": "",
      "name": "",
      "selector": "#ClaimListingSearchButtonBottom",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('#ClaimListingSearchButtonBottom').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-10",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after setting transaction date",
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
  await page.waitForTimeout(9000);
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
