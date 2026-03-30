// Auto-generated from flow: C:\\Users\\aravi\\Desktop\\auto_moat\\recipes\\withoutContinue.json
require('dotenv').config();
const { chromium } = require('playwright');
const { getTOTPForPayer } = require('../utils/totp');
const { handlePageInterruptions } = require('../utils/interruptionHandler');

async function run() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const flowPath = 'C:\\Users\\aravi\\Desktop\\auto_moat\\recipes\\withoutContinue.json';

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
      "description": "Open the without continue page",
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
  await page.goto('https://arihara-sudhan.github.io/some-rpa/with-continue.html', { waitUntil: 'load' });
    }
  );
  await runStep(
    {
      "id": "step-2",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after opening the page",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-3",
      "action": "click",
      "description": "Focus the first textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-4",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after focusing the first textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-5",
      "action": "press",
      "description": "Turn CapsLock on for the first textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').press('CapsLock');
    }
  );
  await runStep(
    {
      "id": "step-6",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after turning CapsLock on for the first textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-7",
      "action": "fill",
      "description": "Enter ARI in the first textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "ARI"
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').fill('');
  await page.locator('role=textbox[name=\'Type here...\']').fill('ARI');
    }
  );
  await runStep(
    {
      "id": "step-8",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after entering ARI in the first textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-9",
      "action": "press",
      "description": "Turn CapsLock off for the first textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').press('CapsLock');
    }
  );
  await runStep(
    {
      "id": "step-10",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after turning CapsLock off for the first textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-11",
      "action": "click",
      "description": "Click Next",
      "role": "",
      "name": "",
      "selector": "role=button[name='Next']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=button[name=\'Next\']').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-12",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after clicking Next",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-13",
      "action": "click",
      "description": "Focus the second textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').click({ force: true });
    }
  );
  await runStep(
    {
      "id": "step-14",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after focusing the second textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-15",
      "action": "press",
      "description": "Turn CapsLock on for the second textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').press('CapsLock');
    }
  );
  await runStep(
    {
      "id": "step-16",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after turning CapsLock on for the second textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-17",
      "action": "fill",
      "description": "Enter I in the second textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "I"
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').fill('');
  await page.locator('role=textbox[name=\'Type here...\']').fill('I');
    }
  );
  await runStep(
    {
      "id": "step-18",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after entering I in the second textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-19",
      "action": "press",
      "description": "Turn CapsLock off for the second textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').press('CapsLock');
    }
  );
  await runStep(
    {
      "id": "step-20",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after turning CapsLock off for the second textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-21",
      "action": "fill",
      "description": "Enter the final text in the second textbox",
      "role": "",
      "name": "",
      "selector": "role=textbox[name='Type here...']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": true,
      "totpFrom": "",
      "value": "It's fine"
    },
    async () => {
  await page.locator('role=textbox[name=\'Type here...\']').fill('');
  await page.locator('role=textbox[name=\'Type here...\']').fill('It\'s fine');
    }
  );
  await runStep(
    {
      "id": "step-22",
      "action": "waitForTimeout",
      "description": "Wait 3 seconds after entering the final text in the second textbox",
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
  await page.waitForTimeout(1000);
    }
  );
  await runStep(
    {
      "id": "step-23",
      "action": "click",
      "description": "Click Finish",
      "role": "",
      "name": "",
      "selector": "role=button[name='Finish']",
      "fallbackSelectors": [],
      "waitForNavigation": "",
      "waitForURL": "",
      "waitForLoadState": "",
      "clearFirst": false,
      "totpFrom": ""
    },
    async () => {
  await page.locator('role=button[name=\'Finish\']').click({ force: true });
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
