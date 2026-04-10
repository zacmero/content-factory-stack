import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const email = process.env.META_EMAIL || '';
const password = process.env.META_PASSWORD || '';
const appId = process.env.META_APP_ID || '';
const otpCode = process.env.META_OTP_CODE || '';
const userDataDir = process.env.META_USER_DATA_DIR || '/tmp/meta-playwright-profile';

if (!email || !password || !appId) {
  console.error('Missing META_EMAIL, META_PASSWORD, or META_APP_ID');
  process.exit(1);
}

const rl = readline.createInterface({ input, output });

async function waitForUser(message) {
  const answer = await rl.question(`${message}\nPress Enter to continue or type "abort" to stop: `);
  if (answer.trim().toLowerCase() === 'abort') {
    throw new Error('User aborted interactive step');
  }
}

async function dumpState(page, label) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${page.url()}`);
  console.log(`Title: ${await page.title().catch(() => 'N/A')}`);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log(bodyText.slice(0, 4000));
  const clickables = await page
    .locator('a, button, [role="button"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 40)
    )
    .catch(() => []);
  if (clickables.length) {
    console.log('Clickables:', clickables.join(' | '));
  }
  const inputs = await page
    .locator('input')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        type: node.getAttribute('type'),
        name: node.getAttribute('name'),
        id: node.getAttribute('id'),
        placeholder: node.getAttribute('placeholder'),
        autocomplete: node.getAttribute('autocomplete'),
        inputmode: node.getAttribute('inputmode'),
        ariaLabel: node.getAttribute('aria-label'),
      }))
    )
    .catch(() => []);
  if (inputs.length) {
    console.log('Inputs:', JSON.stringify(inputs));
  }
  const forms = await page
    .locator('form')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        action: node.getAttribute('action'),
        method: node.getAttribute('method'),
        text: (node.textContent || '').trim().slice(0, 400),
      }))
    )
    .catch(() => []);
  if (forms.length) {
    console.log('Forms:', JSON.stringify(forms));
  }
  const passwordHtml = await page
    .locator('input[type="password"]')
    .first()
    .evaluate((node) => node.outerHTML)
    .catch(() => '');
  if (passwordHtml) {
    console.log('Password input HTML:', passwordHtml);
  }
  const shotName = `/tmp/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  await page.screenshot({ path: shotName, fullPage: true }).catch(() => {});
  console.log(`Screenshot: ${shotName}`);
}

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  viewport: { width: 1440, height: 1200 },
});

try {
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(`https://developers.facebook.com/apps/${appId}/settings/basic/`, {
    waitUntil: 'domcontentloaded',
  });

  const businessLoginButton = page
    .locator('a, button, [role="button"]')
    .filter({ hasText: /Entrar com o Facebook|Log In with Facebook|Login with Facebook|Entrar no Meta for Developers/i });
  if (await businessLoginButton.count()) {
    await businessLoginButton.first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
  }

  let emailInput = page.locator('input[name="email"]:visible, input[id="email"]:visible');
  if (await emailInput.count()) {
    await emailInput.fill(email);
    await page.locator('input[name="pass"], input[id="pass"]').fill(password);
    const loginButton = page.locator('button[name="login"], input[name="login"]');
    if (await loginButton.count()) {
      await loginButton.first().click({ force: true });
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(8000);
  }

  const passwordOnlyInput = page.locator('input[name="pass"]:visible, input[id="pass"]:visible, input[type="password"]:visible');
  if (!(await emailInput.count()) && await passwordOnlyInput.count()) {
    console.log('Password-only login detected.');
    await passwordOnlyInput.first().fill(password);
    await passwordOnlyInput.first().press('Enter').catch(() => {});
    const form = page.locator('form').first();
    if (await form.count()) {
      await form.evaluate((node) => node.submit()).catch(() => {});
    }
    await page.waitForTimeout(8000);
  }

  const quickContinueButton = page
    .locator('a, button, [role="button"], div[role="button"]')
    .filter({ hasText: /^Continuar$|^Continue$/i });
  if (!(await emailInput.count()) && await quickContinueButton.count()) {
    await quickContinueButton.first().click({ force: true });
    await page.waitForTimeout(8000);
  }

  await page.waitForTimeout(4000);
  await dumpState(page, 'After Login Attempt');

  const settledPasswordInput = page.locator('input[type="password"]').first();
  if (page.url().includes('/login/') && (await settledPasswordInput.count())) {
    console.log('Settled password form detected.');
    await settledPasswordInput.fill(password);
    await settledPasswordInput.press('Enter').catch(() => {});
    const settledForm = page.locator('form').first();
    if (await settledForm.count()) {
      await settledForm.evaluate((node) => node.submit()).catch(() => {});
    }
    await page.waitForTimeout(12000);
    await dumpState(page, 'After Settled Password Submit');
  }

  const codeLocator = page.locator(
    'input[name="approvals_code"], input[autocomplete="one-time-code"], input[name="code"], input[placeholder="Código"], input[inputmode="numeric"], input[type="text"]'
  );
  const needsCode = (await codeLocator.count()) > 0;
  if (needsCode) {
    console.log('2FA code input detected.');
    const code = otpCode || await rl.question('Meta requested a verification code. Enter the code: ');
    const codeInput = codeLocator.first();
    await codeInput.fill(code.trim());
    const continueButton = page.locator(
      'button:has-text("Continue"), button:has-text("Continuar"), button:has-text("Submit"), div[role="button"]:has-text("Continue"), div[role="button"]:has-text("Continuar")'
    );
    if (await continueButton.count()) {
      await continueButton.first().click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(12000);
    if (page.url().includes('/two_step_verification/')) {
      await page.waitForTimeout(12000);
    }
    await dumpState(page, 'After Code Submission');
  }

  const checkpointText = await page.locator('body').innerText().catch(() => '');
  if (/checkpoint|confirm.*identity|suspicious|review your recent login/i.test(checkpointText)) {
    await dumpState(page, 'Checkpoint Detected');
    await waitForUser('Meta is asking for a manual checkpoint or approval outside the browser.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await dumpState(page, 'After Manual Checkpoint');
  }

  await page.goto(`https://developers.facebook.com/apps/${appId}/settings/basic/`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(4000);
  await dumpState(page, 'App Settings');
} finally {
  await context.close();
  rl.close();
}
