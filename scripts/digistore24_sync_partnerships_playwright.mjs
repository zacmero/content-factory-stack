#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';

const outPath = 'content_factory/reddit_quora/digistore24_partnerships.raw.json';
const userDataDir = process.env.DIGISTORE24_USER_DATA_DIR || '/tmp/digistore24-playwright-profile';
const appHome = process.env.DIGISTORE24_APP_URL || 'https://www.digistore24-app.com/en/home';
const headless = process.env.DIGISTORE24_HEADLESS === 'true';
const maxPromolinks = Number(process.env.DIGISTORE24_PROMOLINK_LIMIT || 250);
const rl = readline.createInterface({ input, output });

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

async function waitForUser(message) {
  const answer = await rl.question(`${message}\nPress Enter to continue or type "abort" to stop: `);
  if (answer.trim().toLowerCase() === 'abort') {
    throw new Error('User aborted Digistore24 session setup');
  }
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

async function ensureLoggedIn(page) {
  await page.goto(appHome, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/login|sign in|log in|register now|passwort|password/i.test(bodyText) || /login|signin/i.test(page.url())) {
    await waitForUser('Digistore24 login is required for the partnership sync. Complete the login in the opened browser window.');
    await page.goto(appHome, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
  }
  await ensureAffiliateView(page);
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
  await gotoSection(page, [/Content links/i, /Content Links/i]);
  await clickByText(page, [/Show promolink/i, /Show Promolink/i, /Promolink/i]);
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
  await gotoSection(page, [/Vendor partnerships/i, /Vendor Partnerships/i, /Partnerships/i]);
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

const context = await chromium.launchPersistentContext(userDataDir, {
  headless,
  viewport: { width: 1440, height: 1200 }
});

try {
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  const networkBucket = [];
  await captureJsonResponses(context, networkBucket);
  await ensureLoggedIn(page);

  const approvedProducts = await scrapePromolinkOptions(page);
  const partnershipRows = await scrapePartnershipRows(page);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        synced_at: new Date().toISOString(),
        source: 'affiliate_ui_playwright',
        app_url: page.url(),
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
} finally {
  await context.close();
  rl.close();
}
