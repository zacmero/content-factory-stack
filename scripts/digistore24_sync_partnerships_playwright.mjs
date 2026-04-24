#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pathToFileURL } from 'node:url';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const outPath = 'content_factory/reddit_quora/digistore24_partnerships.raw.json';
const loginEntryUrl = process.env.DIGISTORE24_LOGIN_URL || 'https://www.digistore24.com/de/login';
const appHome = process.env.DIGISTORE24_APP_URL || '';
const headless = process.env.DIGISTORE24_HEADLESS === 'true';
const maxPromolinks = Number(process.env.DIGISTORE24_PROMOLINK_LIMIT || 250);
const browserName = String(process.env.DIGISTORE24_BROWSER || 'firefox').trim().toLowerCase();
const browserExecutablePath = process.env.DIGISTORE24_BROWSER_PATH || '';
const requestedUserDataDir = process.env.DIGISTORE24_USER_DATA_DIR || '';
const affiliateId = process.env.DIGISTORE24_AFFILIATE_ID || '';
const digistoreEmail = process.env.DIGISTORE24_EMAIL || '';
const digistorePassword = process.env.DIGISTORE24_PASSWORD || '';
const validateOnly =
  process.argv.includes('--check-playwright') || process.env.DIGISTORE24_VALIDATE_ONLY === 'true';
const probeOnly =
  process.argv.includes('--probe-start') || process.env.DIGISTORE24_PROBE_START === 'true';
const dumpAppStateOnly =
  process.argv.includes('--dump-app-state') || process.env.DIGISTORE24_DUMP_APP_STATE === 'true';
const rl = readline.createInterface({ input, output });
const require = createRequire(import.meta.url);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectGlobalNodeModuleRoots() {
  const roots = new Set();
  const cliCandidates = unique([
    process.env.PLAYWRIGHT_CLI,
    path.join(process.env.HOME || '', '.local', 'bin', 'playwright'),
    'playwright'
  ]);
  if (process.env.PLAYWRIGHT_PACKAGE_ROOT) roots.add(process.env.PLAYWRIGHT_PACKAGE_ROOT);
  if (process.env.PLAYWRIGHT_NODE_MODULES) roots.add(process.env.PLAYWRIGHT_NODE_MODULES);
  if (process.env.npm_config_prefix) roots.add(path.join(process.env.npm_config_prefix, 'lib', 'node_modules'));
  try {
    roots.add(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim());
  } catch {}
  for (const cliPath of cliCandidates) {
    try {
      const listOutput = execFileSync(cliPath, ['install', '--list'], { encoding: 'utf8' });
      for (const line of listOutput.split('\n')) {
        const match = line.match(/References:\s*(.+)$/i);
        if (match?.[1]) roots.add(path.dirname(match[1].trim()));
        const indented = line.match(/^\s+(\/.+node_modules\/playwright(?:-core)?)\s*$/);
        if (indented?.[1]) roots.add(path.dirname(indented[1].trim()));
      }
      break;
    } catch {}
  }
  const npxDir = path.join(process.env.HOME || '', '.npm', '_npx');
  if (fs.existsSync(npxDir)) {
    for (const entry of fs.readdirSync(npxDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const packageName of ['playwright', 'playwright-core']) {
        const packageRoot = path.join(npxDir, entry.name, 'node_modules', packageName);
        if (fs.existsSync(path.join(packageRoot, 'package.json'))) {
          roots.add(path.dirname(packageRoot));
        }
      }
    }
  }
  roots.add(path.join(process.env.HOME || '', '.npm-global', 'lib', 'node_modules'));
  return [...roots].filter(Boolean);
}

async function loadPlaywright() {
  const attempts = [];
  for (const specifier of ['playwright', 'playwright-core']) {
    try {
      const mod = await import(specifier);
      return { module: mod, source: specifier };
    } catch (error) {
      attempts.push(`${specifier}: ${error.code || error.message}`);
    }
  }

  for (const root of detectGlobalNodeModuleRoots()) {
    for (const specifier of ['playwright', 'playwright-core']) {
      try {
        const resolved = require.resolve(specifier, { paths: [root] });
        const mod = await import(pathToFileURL(resolved).href);
        return { module: mod, source: resolved };
      } catch (error) {
        attempts.push(`${specifier} via ${root}: ${error.code || error.message}`);
      }
    }
  }

  throw new Error(
    'Could not resolve Playwright. Tried local imports and global npm roots.\n' + attempts.join('\n')
  );
}

const { module: playwrightModule, source: playwrightSource } = await loadPlaywright();
const chromium = playwrightModule.chromium || playwrightModule.default?.chromium;
const firefox = playwrightModule.firefox || playwrightModule.default?.firefox;

if (!chromium && !firefox) {
  throw new Error(`Resolved Playwright from ${playwrightSource} but no browser launchers were available`);
}

if (validateOnly) {
  console.log(`Resolved Playwright from ${playwrightSource}`);
  rl.close();
  process.exit(0);
}

function detectExecutablePath(name) {
  if (!browserExecutablePath) return '';
  return browserExecutablePath;
}

function resolveUserDataDir(name) {
  if (requestedUserDataDir) return requestedUserDataDir;
  return `/tmp/digistore24-playwright-${name}-profile`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parsePromolink(value) {
  const url = normalize(value);
  if (!url) return { url: '', product_id: '', content_link_id: '' };
  const redir = url.match(/\/redir\/(\d+)\//i);
  if (redir) return { url, product_id: redir[1], content_link_id: '' };
  const content = url.match(/\/content\/(\d+)\/(\d+)\//i);
  if (content) return { url, product_id: content[1], content_link_id: content[2] };
  return { url, product_id: '', content_link_id: '' };
}

function buildAffiliateUrl(productId) {
  if (!affiliateId || !productId) return '';
  return `https://www.checkout-ds24.com/redir/${encodeURIComponent(productId)}/${encodeURIComponent(affiliateId)}/sarahnutri_forum`;
}

async function waitForUser(message) {
  const answer = await rl.question(`${message}\nPress Enter to continue or type "abort" to stop: `);
  if (answer.trim().toLowerCase() === 'abort') {
    throw new Error('User aborted Digistore24 session setup');
  }
}

async function readPageText(page) {
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return `${title}\n${bodyText}`;
}

function getLoginFrame(page) {
  return (
    page.frames().find((frame) => /\/login\/login_iframe\//i.test(frame.url())) ||
    null
  );
}

async function clickByText(page, patterns) {
  for (const pattern of patterns) {
    const locator = page.getByText(pattern, { exact: false }).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ force: true }).catch(() => {});
      await sleep(1500);
      return true;
    }
  }
  return false;
}

async function ensureAffiliateView(page) {
  await clickByText(page, [/Affiliate view/i, /Affiliate View/i, /Affiliate/i]);
  await sleep(1200);
}

async function pageLooksMissing(page) {
  return /page not found|404|not found/i.test(await readPageText(page));
}

async function pageShowsLoggedInNavigation(page) {
  const frame = getLoginFrame(page);
  const text = await readPageText(page);
  const url = page.url();
  if (/\/login\b/i.test(url) || frame) return false;
  const appHost = /digistore24-app\.com/i.test(url);
  const authenticatedUi =
    /sales\s*&\s*partners|vendor partnerships|content links|view\s+affiliate|view\s+vendor|berichte|marktplatz|konto|partnerschaften/i.test(
      text
    );
  const publicHomepageMarkers =
    /hall of fame awards|trusted partner programm|presseportal|newsroom|umzugsservice|affiliate marketing academy|1:1 service/i.test(
      text
    );
  return Boolean((appHost || authenticatedUi) && !publicHomepageMarkers);
}

async function pageShowsLoginState(page) {
  const text = await readPageText(page);
  if (/login|sign in|log in|register now|passwort|password|anmelden|einloggen/i.test(text)) return true;
  const frame = getLoginFrame(page);
  if (!frame) return false;
  const frameText = await frame.locator('body').innerText().catch(() => '');
  return /login|passwort|anmelden|einloggen|e-mail/i.test(frameText);
}

async function openLoginEntry(page) {
  await page.goto(loginEntryUrl, { waitUntil: 'commit', timeout: 30000 });
  await sleep(2500);
  if (await pageLooksMissing(page)) {
    throw new Error(`Digistore24 login entry returned a missing page at ${page.url()}`);
  }
}

async function clickLoginEntry(page) {
  if (/\/login\b/i.test(page.url())) return true;
  const loginLocators = [
    page.getByRole('link', { name: /login/i }).first(),
    page.getByRole('button', { name: /login/i }).first(),
    page.getByText(/login/i, { exact: false }).first(),
    page.getByRole('link', { name: /anmelden|einloggen/i }).first(),
    page.getByRole('button', { name: /anmelden|einloggen/i }).first(),
    page.getByText(/anmelden|einloggen/i, { exact: false }).first()
  ];
  for (const locator of loginLocators) {
    if (await locator.count().catch(() => 0)) {
      await locator.click({ force: true }).catch(() => {});
      await sleep(2000);
      return true;
    }
  }
  return false;
}

async function waitForLoginCompletion(page) {
  const timeoutMs = Number(process.env.DIGISTORE24_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);
  const start = Date.now();
  console.log('Waiting for Digistore24 login to complete in the opened Firefox window...');
  while (Date.now() - start < timeoutMs) {
    if (await pageShowsLoggedInNavigation(page)) return true;
    await sleep(2000);
  }
  return false;
}

async function tryAutoLogin(page) {
  if (!digistoreEmail || !digistorePassword) return false;
  const frame = getLoginFrame(page);
  const scope = frame || page;
  const emailSelectors = [
    'input[name="login_username"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[autocomplete="username"]'
  ];
  const passwordSelectors = [
    'input[name="login_password"]',
    'input[type="password"]',
    'input[name="password"]',
    'input[autocomplete="current-password"]'
  ];
  let emailField = null;
  for (const selector of emailSelectors) {
    const locator = scope.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      emailField = locator;
      break;
    }
  }
  let passwordField = null;
  for (const selector of passwordSelectors) {
    const locator = scope.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      passwordField = locator;
      break;
    }
  }
  if (!emailField || !passwordField) return false;

  await emailField.fill(digistoreEmail).catch(() => {});
  await passwordField.fill(digistorePassword).catch(() => {});

  const submitLocators = [
    scope.locator('button[name="login_login"]').first(),
    scope.getByRole('button', { name: /login|sign in|log in|anmelden|einloggen/i }).first(),
    scope.locator('button[type="submit"]').first(),
    scope.locator('input[type="submit"]').first()
  ];
  for (const locator of submitLocators) {
    if (await locator.count().catch(() => 0)) {
      await locator.click({ force: true }).catch(() => {});
      await sleep(3000);
      return true;
    }
  }

  await passwordField.press('Enter').catch(() => {});
  await sleep(3000);
  return true;
}

async function ensureLoggedIn(page) {
  await openLoginEntry(page);
  const clickedLogin = await clickLoginEntry(page);
  if (await pageShowsLoggedInNavigation(page)) {
    await ensureAffiliateView(page);
    return;
  }
  if (clickedLogin || (await pageShowsLoginState(page)) || /login|signin/i.test(page.url()) || true) {
    const autoLoginTried = await tryAutoLogin(page);
    let loggedIn = await waitForLoginCompletion(page);
    if (!loggedIn && !autoLoginTried && !headless) {
      await waitForUser(
        'Digistore24 login is required. Log in inside the opened Firefox window, wait until the backoffice appears, then press Enter here.'
      );
      loggedIn = await pageShowsLoggedInNavigation(page);
    }
    if (!loggedIn) {
      throw new Error('Timed out waiting for Digistore24 login to complete');
    }
    if (appHome) {
      await page.goto(appHome, { waitUntil: 'commit', timeout: 30000 });
      await sleep(2500);
    }
  }
  if (await pageLooksMissing(page)) {
    await page.goto(loginEntryUrl, { waitUntil: 'commit', timeout: 30000 });
    await sleep(2500);
  }
  await ensureAffiliateView(page);
  if (!(await pageShowsLoggedInNavigation(page))) {
    throw new Error(`Digistore24 still not in authenticated app after login flow. Current URL: ${page.url()}`);
  }
}

async function captureJsonResponses(context, bucket) {
  context.on('response', async (response) => {
    try {
      const url = response.url();
      const headers = response.headers();
      const contentType = String(headers['content-type'] || '');
      if (!/json/i.test(contentType)) return;
      if (!/digistore24/i.test(url)) return;
      const text = await response.text();
      if (!text) return;
      if (!/promo|partner|vendor|affiliate|content link|content_link|product/i.test(text)) return;
      bucket.push({
        url,
        status: response.status(),
        content_type: contentType,
        body_preview: text.slice(0, 4000)
      });
    } catch {}
  });
}

async function gotoSection(page, labels) {
  for (const label of labels) {
    const link = page.getByRole('link', { name: label }).first();
    if (await link.count().catch(() => 0)) {
      await link.click({ force: true }).catch(() => {});
      await sleep(2000);
      return true;
    }
  }
  return clickByText(page, labels);
}

async function scrapePromolinkOptions(page) {
  const approvedProducts = [];
  await gotoSection(page, [/Content links/i, /Content Links/i, /Contentlinks/i, /Content Links anzeigen/i]);
  await clickByText(page, [/Show promolink/i, /Show Promolink/i, /Promolink/i, /Promolink anzeigen/i]);
  await sleep(1500);

  const nativeSelect = page.locator('select').filter({ has: page.locator('option') }).first();
  if (await nativeSelect.count().catch(() => 0)) {
    const optionData = await nativeSelect
      .locator('option')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => ({ value: node.getAttribute('value') || '', label: (node.textContent || '').trim() }))
          .filter((entry) => entry.value && entry.label)
      )
      .catch(() => []);

    for (const option of optionData.slice(0, maxPromolinks)) {
      await nativeSelect.selectOption(option.value).catch(() => {});
      await sleep(1200);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const promolinkMatch = bodyText.match(/https?:\/\/[^\s]*checkout-ds24\.com\/(?:redir|content)\/[^\s]+/i);
      const supportMatch = bodyText.match(/https?:\/\/[^\s]+/gi) || [];
      const promolink = parsePromolink(promolinkMatch?.[0] || '');
      approvedProducts.push({
        product_label: option.label,
        product_name: option.label,
        promolink: promolink.url,
        product_id: promolink.product_id,
        content_link_id: promolink.content_link_id,
        affiliate_support_url: supportMatch.find((url) => !url.includes('checkout-ds24.com')) || '',
        status: promolink.url ? 'approved' : 'unknown',
        synced_at: new Date().toISOString()
      });
    }
  }

  return approvedProducts;
}

async function scrapePartnershipRows(page) {
  const rows = [];
  await gotoSection(page, [/Vendor partnerships/i, /Vendor Partnerships/i, /Partnerships/i, /Partnerschaften/i]);
  await sleep(2000);
  const tableRows = await page
    .locator('table tbody tr')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        Array.from(node.querySelectorAll('td,th'))
          .map((cell) => (cell.textContent || '').trim())
          .filter(Boolean)
      )
    )
    .catch(() => []);

  for (const cells of tableRows) {
    if (!cells.length) continue;
    rows.push({
      raw_cells: cells,
      vendor_name: cells[0] || '',
      product_name: cells[1] || '',
      status: cells.find((cell) => /approved|pending|rejected/i.test(cell)) || '',
      commission_text: cells.find((cell) => /%|commission|€/i.test(cell)) || ''
    });
  }

  return rows;
}

async function fetchAffiliationProductsFromApi(context) {
  const items = [];
  const pageSize = 250;
  for (let pageNo = 1; pageNo <= 40; pageNo += 1) {
    const response = await context.request.get(
      `https://analytics.digistore24.com/api/generic/products/options?types=affiliation&query=&page=${pageNo}&itemsPerPage=${pageSize}`
    );
    if (!response.ok()) {
      throw new Error(`Affiliation products API failed: ${response.status()} page ${pageNo}`);
    }
    const batch = await response.json().catch(() => []);
    if (!Array.isArray(batch) || !batch.length) break;
    items.push(...batch);
    if (batch.length < pageSize) break;
  }
  return items;
}

function normalizeAffiliationApiProducts(items) {
  return items.map((item) => {
    const productId = String(item.value || '').trim();
    const label = String(item.label || '').trim();
    const group = String(item.group || '').trim();
    const vendorName = group.replace(/\s*-\s*products\s*$/i, '').trim();
    return {
      product_label: label,
      product_name: label,
      product_id: productId,
      vendor_name: vendorName,
      product_group: group,
      promolink: buildAffiliateUrl(productId),
      content_link_id: '',
      affiliate_support_url: '',
      status: 'approved',
      source: 'affiliate_products_api',
      synced_at: new Date().toISOString()
    };
  });
}

async function writeDebugDump(page, label) {
  const safe = String(label || 'debug').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const screenshotPath = `/tmp/digistore24-${safe}.png`;
  const textPath = `/tmp/digistore24-${safe}.txt`;
  const frame = getLoginFrame(page);
  const topText = await readPageText(page);
  const frameText = frame ? await frame.locator('body').innerText().catch(() => '') : '';
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  fs.writeFileSync(
    textPath,
    [
      `URL: ${page.url()}`,
      '',
      '=== TOP PAGE ===',
      topText,
      '',
      '=== LOGIN IFRAME ===',
      frameText
    ].join('\n')
  );
  console.error(`Debug dump: ${screenshotPath}`);
  console.error(`Debug text: ${textPath}`);
}

async function writeAppStateDump(page, networkBucket, label = 'app-state') {
  const safe = String(label).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const textPath = `/tmp/digistore24-${safe}.json`;
  const buttons = await page
    .locator('button, a, [role="button"], [role="menuitem"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          tag: node.tagName,
          text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
          href: node.getAttribute('href') || '',
          aria: node.getAttribute('aria-label') || ''
        }))
        .filter((entry) => entry.text || entry.href || entry.aria)
        .slice(0, 400)
    )
    .catch(() => []);
  const frame = getLoginFrame(page);
  const payload = {
    url: page.url(),
    top_text: await readPageText(page),
    login_iframe_text: frame ? await frame.locator('body').innerText().catch(() => '') : '',
    controls: buttons,
    captured_json_responses: networkBucket.slice(0, 200)
  };
  fs.writeFileSync(textPath, JSON.stringify(payload, null, 2));
  console.error(`App state dump: ${textPath}`);
}

const browserType =
  browserName === 'chromium'
    ? chromium
    : firefox || chromium;

if (!browserType) {
  throw new Error(`Requested browser "${browserName}" is not available in the resolved Playwright package`);
}

const launchOptions = {
  headless,
  viewport: { width: 1440, height: 1200 }
};
const executablePath = detectExecutablePath(browserName);
if (executablePath) launchOptions.executablePath = executablePath;
if (browserName === 'firefox') {
  launchOptions.firefoxUserPrefs = {
    'signon.rememberSignons': true
  };
}

async function launchContext() {
  const primaryUserDataDir = resolveUserDataDir(browserName);
  try {
    const context = await browserType.launchPersistentContext(primaryUserDataDir, launchOptions);
    return { context, userDataDir: primaryUserDataDir };
  } catch (error) {
    if (
      !requestedUserDataDir &&
      /profile was last used with a newer version/i.test(String(error?.message || ''))
    ) {
      const fallbackUserDataDir = `${primaryUserDataDir}-fresh`;
      const context = await browserType.launchPersistentContext(fallbackUserDataDir, launchOptions);
      return { context, userDataDir: fallbackUserDataDir };
    }
    throw error;
  }
}

const { context, userDataDir } = await launchContext();
let keepBrowserOpenForInspection = false;

try {
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  const networkBucket = [];
  await captureJsonResponses(context, networkBucket);
  if (probeOnly) {
    console.log(`Playwright source: ${playwrightSource}`);
    console.log(`Browser: ${browserName}`);
    console.log(`Executable: ${executablePath || 'bundled/default'}`);
    console.log(`Navigating to: ${loginEntryUrl}`);
    await openLoginEntry(page);
    console.log(`URL: ${page.url()}`);
    console.log(`Title: ${await page.title().catch(() => '')}`);
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
    process.exit(0);
  }
  await ensureLoggedIn(page);
  if (dumpAppStateOnly) {
    await writeAppStateDump(page, networkBucket);
    process.exit(0);
  }

  let approvedProducts = [];
  let partnershipRows = [];
  let affiliationApiError = '';
  try {
    const apiProducts = await fetchAffiliationProductsFromApi(context);
    approvedProducts = normalizeAffiliationApiProducts(apiProducts);
    partnershipRows = approvedProducts.map((product) => ({
      raw_cells: [product.vendor_name, product.product_name, product.status],
      vendor_name: product.vendor_name,
      product_name: product.product_name,
      status: product.status,
      commission_text: ''
    }));
  } catch (error) {
    affiliationApiError = String(error?.message || error);
  }
  if (!approvedProducts.length) approvedProducts = await scrapePromolinkOptions(page);
  if (!partnershipRows.length) partnershipRows = await scrapePartnershipRows(page);
  if (!approvedProducts.length && !partnershipRows.length) {
    await writeDebugDump(page, 'no-partnership-data');
    if (!(await pageShowsLoggedInNavigation(page))) {
      throw new Error(`No Digistore24 partnership data found and page not authenticated. Current URL: ${page.url()}`);
    }
    throw new Error(
      `No Digistore24 partnership data found after login. Current URL: ${page.url()}${
        affiliationApiError ? ` | API error: ${affiliationApiError}` : ''
      }`
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        synced_at: new Date().toISOString(),
        source: 'affiliate_ui_playwright',
        app_url: page.url(),
        affiliation_api_error: affiliationApiError,
        approved_products: approvedProducts,
        partnership_rows: partnershipRows,
        captured_json_responses: networkBucket.slice(0, 80)
      },
      null,
      2
    ) + '\n'
  );

  console.log(`Wrote ${outPath}`);
  console.log(`Approved products captured: ${approvedProducts.length}`);
  console.log(`Partnership rows captured: ${partnershipRows.length}`);
} catch (error) {
  if (!headless && !probeOnly && !validateOnly) {
    console.error(String(error?.message || error));
    keepBrowserOpenForInspection = true;
    if (process.stdin.isTTY) {
      await waitForUser('Digistore24 sync hit error. Inspect Firefox window, then press Enter so script can close.');
    } else {
      console.error('No TTY. Keeping Firefox open 5 minutes for inspection.');
      await sleep(5 * 60 * 1000);
    }
  }
  throw error;
} finally {
  if (!keepBrowserOpenForInspection) await context.close();
  rl.close();
}
