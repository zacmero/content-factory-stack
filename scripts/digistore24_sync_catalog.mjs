#!/usr/bin/env node

import fs from 'node:fs';

const apiKey = process.env.DIGISTORE24_API_KEY || '';
const affiliateId = process.env.DIGISTORE24_AFFILIATE_ID || '';
const maxProducts = Number(process.env.DIGISTORE24_MAX_PRODUCTS || 40);
const keywordList = String(
  process.env.DIGISTORE24_MARKETPLACE_KEYWORDS ||
    'senior,elderly,caregiver,nutrition,mobility,sleep,joint,arthritis,memory,digestion'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const rawOut = 'content_factory/reddit_quora/digistore24_catalog.raw.json';
const catalogPath = 'content_factory/reddit_quora/product_catalog.json';
const shouldWriteCatalog = process.argv.includes('--write-catalog');

if (!apiKey) {
  console.error('Missing DIGISTORE24_API_KEY.');
  console.error('Create one in Digistore24: Vendor view > Settings > Account access > API keys.');
  process.exit(1);
}

async function callDigistore(functionName, params = {}) {
  const url = new URL(`https://www.digistore24.com/api/call/${functionName}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      'X-DS-API-KEY': apiKey,
      Accept: 'application/json'
    }
  });

  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok || body.result === 'error') {
    const message = body.message || body.raw || response.statusText;
    throw new Error(`${functionName} failed: ${response.status} ${message}`);
  }

  return body;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function textFrom(entry) {
  return [
    entry.name,
    entry.title,
    entry.product_name,
    entry.description,
    entry.short_description,
    entry.category,
    entry.categories,
    entry.tags
  ]
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function pick(entry, keys) {
  for (const key of keys) {
    if (entry[key]) return entry[key];
  }
  return '';
}

function normalizeEntry(entry, source) {
  const name = String(pick(entry, ['name', 'title', 'product_name']) || 'Digistore24 product').trim();
  const id = String(pick(entry, ['id', 'product_id', 'productId', 'entry_id', 'marketplace_entry_id']) || '').trim();
  const text = textFrom(entry);
  const matchedKeywords = keywordList.filter((keyword) => text.includes(keyword));
  const affiliateUrl = String(
    pick(entry, ['affiliate_url', 'buy_url', 'url', 'product_url', 'salespage_url', 'marketplace_url']) || ''
  ).trim();

  return {
    slug: `digistore24-${(id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`,
    name,
    affiliate_url: affiliateUrl,
    source,
    digistore24_id: id,
    match_keywords: matchedKeywords.length ? matchedKeywords : keywordList.slice(0, 5),
    use_when: `Use only when the forum question clearly matches: ${matchedKeywords.join(', ') || keywordList.slice(0, 5).join(', ')}.`,
    avoid_when: 'Avoid for emergency symptoms, diagnosis requests, medication changes, severe disease, or when the product is not directly relevant.'
  };
}

function filterRelevant(entries, source) {
  return entries
    .map((entry) => normalizeEntry(entry, source))
    .filter((product) => product.name && product.match_keywords.some((keyword) => keywordList.includes(keyword)))
    .slice(0, maxProducts);
}

const result = {
  synced_at: new Date().toISOString(),
  affiliate_id_present: Boolean(affiliateId),
  keyword_filter: keywordList,
  user_info: null,
  products: [],
  marketplace_entries: [],
  normalized_products: []
};

try {
  result.user_info = (await callDigistore('getUserInfo')).data || null;
} catch (error) {
  result.user_info_error = error.message;
}

try {
  const response = await callDigistore('listProducts', { language: 'en' });
  result.products = asArray(response.data);
} catch (error) {
  result.products_error = error.message;
}

try {
  const response = await callDigistore('listMarketplaceEntries', { language: 'en' });
  result.marketplace_entries = asArray(response.data);
} catch (error) {
  result.marketplace_entries_error = error.message;
}

const normalized = [
  ...filterRelevant(result.products, 'account_product'),
  ...filterRelevant(result.marketplace_entries, 'marketplace_entry')
];

const deduped = [];
const seen = new Set();
for (const product of normalized) {
  if (seen.has(product.slug)) continue;
  seen.add(product.slug);
  deduped.push(product);
}

result.normalized_products = deduped.slice(0, maxProducts);
fs.writeFileSync(rawOut, JSON.stringify(result, null, 2) + '\n');

if (shouldWriteCatalog) {
  const current = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const nonDigistoreProducts = (current.products || []).filter(
    (product) => !String(product.slug || '').startsWith('digistore24-')
  );
  fs.writeFileSync(
    catalogPath,
    JSON.stringify({ products: [...nonDigistoreProducts, ...result.normalized_products] }, null, 2) + '\n'
  );
}

console.log(`Wrote ${rawOut}`);
console.log(`Matched ${result.normalized_products.length} Digistore24 products`);
if (shouldWriteCatalog) console.log(`Updated ${catalogPath}`);
if (!affiliateId) console.log('DIGISTORE24_AFFILIATE_ID is empty. Verify generated product URLs before posting.');
