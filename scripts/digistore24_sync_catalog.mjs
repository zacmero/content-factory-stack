#!/usr/bin/env node

import fs from 'node:fs';

const apiKey = process.env.DIGISTORE24_API_KEY || '';
const affiliateId = process.env.DIGISTORE24_AFFILIATE_ID || '';
const maxProducts = Number(process.env.DIGISTORE24_MAX_PRODUCTS || 40);
const includeInactive = process.env.DIGISTORE24_INCLUDE_INACTIVE === 'true';
const keywordList = String(
  process.env.DIGISTORE24_MARKETPLACE_KEYWORDS ||
    'senior,elderly,caregiver,nutrition,mobility,sleep,joint,arthritis,memory,digestion'
)
  .split(',')
  .map((value) => value.trim().toLowerCase().replace(/[_-]+/g, ' '))
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
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.entries)) return value.entries;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function textFrom(entry) {
  return [
    entry.name,
    entry.title,
    entry.product_name,
    entry.product_name_en,
    entry.main_product_name,
    entry.product_type_name,
    entry.vendor_name,
    entry.merchant_name,
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
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const name = String(pick(entry, ['name', 'title', 'product_name']) || 'Digistore24 product').trim();
  const id = String(pick(entry, ['id', 'product_id', 'productId', 'entry_id', 'marketplace_entry_id']) || '').trim();
  const text = textFrom(entry);
  const matchedKeywords = keywordList.filter((keyword) => text.includes(keyword));
  let affiliateUrl = String(
    pick(entry, ['affiliate_url', 'buy_url', 'url', 'product_url', 'salespage_url', 'marketplace_url']) || ''
  ).trim();
  if (!affiliateUrl && id && affiliateId) {
    affiliateUrl = `https://www.checkout-ds24.com/redir/${encodeURIComponent(id)}/${encodeURIComponent(affiliateId)}/sarahnutri_forum`;
  }

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

function buildAffiliateUrl(productId) {
  return `https://www.checkout-ds24.com/redir/${encodeURIComponent(productId)}/${encodeURIComponent(affiliateId)}/sarahnutri_forum`;
}

function toMoney(value) {
  const number = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function extractAffiliateProducts(purchases = [], transactions = []) {
  const byId = new Map();

  function addProduct(product, purchase = {}) {
    const productId = String(product.product_id || product.main_product_id || purchase.main_product_id || '').trim();
    if (!productId) return;

    const name = String(
      product.product_name_en ||
        product.product_name ||
        product.product_name_intern ||
        purchase.main_product_name ||
        `Digistore24 product ${productId}`
    ).trim();
    const active = String(product.product_is_active || purchase.product_is_active || '').toUpperCase();
    const deleted = String(product.product_is_deleted || purchase.product_is_deleted || '').toUpperCase();
    const current = byId.get(productId) || {
      product_id: productId,
      name,
      vendor_name: purchase.vendor_name || purchase.merchant_name || '',
      vendor_id: purchase.vendor_id || '',
      product_type_name: product.product_type_name || '',
      active,
      deleted,
      sales_count: 0,
      total_affiliate_amount: 0,
      latest_sale_at: '',
      currencies: new Set()
    };

    current.sales_count += Number(product.quantity || product.count || 1) || 1;
    current.total_affiliate_amount += toMoney(purchase.total_affiliate_amount || purchase.affiliate_amount || purchase.earned_amount || 0);
    current.latest_sale_at = [current.latest_sale_at, purchase.created_at || purchase.transaction_created_at || ''].sort().at(-1) || '';
    if (purchase.currency) current.currencies.add(purchase.currency);
    if (!current.name && name) current.name = name;
    if (!current.vendor_name && (purchase.vendor_name || purchase.merchant_name)) {
      current.vendor_name = purchase.vendor_name || purchase.merchant_name;
    }
    if (!current.product_type_name && product.product_type_name) current.product_type_name = product.product_type_name;
    if (!current.active && active) current.active = active;
    if (!current.deleted && deleted) current.deleted = deleted;
    byId.set(productId, current);
  }

  for (const purchase of [...purchases, ...transactions]) {
    if (String(purchase.affiliate_name || '').toLowerCase() !== affiliateId.toLowerCase()) continue;
    if (Array.isArray(purchase.items) && purchase.items.length) {
      for (const item of purchase.items) addProduct(item, purchase);
      continue;
    }
    addProduct({ product_id: purchase.main_product_id, product_name: purchase.main_product_name }, purchase);
  }

  return [...byId.values()].map((product) => ({
    ...product,
    currencies: [...product.currencies]
  }));
}

async function validateAffiliateProduct(product) {
  if (!affiliateId || !product.product_id) return { status: 'missing_affiliate_or_product' };
  try {
    const response = await callDigistore('validateAffiliate', {
      affiliate_name: affiliateId,
      product_ids: product.product_id
    });
    return response.data || { status: 'unknown' };
  } catch (error) {
    return { status: 'validation_error', message: error.message };
  }
}

function normalizeAffiliateHistoryProduct(product, validation) {
  const text = textFrom({
    product_name: product.name,
    product_type_name: product.product_type_name,
    vendor_name: product.vendor_name
  });
  const matchedKeywords = keywordList.filter((keyword) => text.includes(keyword));
  const productTokens = String(product.name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !['bottle', 'bottles', 'more'].includes(word));
  const nicheKeywords = [];
  if (/(quiet|ring|echo|neuro)/i.test(product.name)) {
    nicheKeywords.push('tinnitus', 'ringing ears', 'ear ringing', 'hearing', 'ear comfort', 'night ringing');
  }
  if (/(nerv|nerve)/i.test(product.name)) {
    nicheKeywords.push('nerve', 'neuropathy', 'tingling', 'nerve discomfort');
  }
  const safeKeywords = [...new Set([...matchedKeywords, ...productTokens, ...nicheKeywords])].slice(0, 14);

  return {
    slug: `digistore24-${product.product_id}`,
    name: product.name,
    affiliate_url: buildAffiliateUrl(product.product_id),
    source: 'affiliate_sales_history',
    digistore24_id: product.product_id,
    vendor_name: product.vendor_name,
    product_type_name: product.product_type_name,
    sales_count: product.sales_count,
    total_affiliate_amount: Number(product.total_affiliate_amount.toFixed(2)),
    latest_sale_at: product.latest_sale_at,
    affiliation_status: validation.affiliation_status || 'unknown',
    match_keywords: safeKeywords,
    use_when: `Use only when the forum question clearly matches ${product.name} or these themes: ${safeKeywords.join(', ')}.`,
    avoid_when: 'Avoid for emergency symptoms, diagnosis requests, medication changes, severe disease, inactive/deleted products, or when the product is not directly relevant.'
  };
}

function filterRelevant(entries, source) {
  return entries
    .map((entry) => normalizeEntry(entry, source))
    .filter(Boolean)
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
  affiliate_purchases_count: 0,
  affiliate_transactions_count: 0,
  affiliate_history_products_count: 0,
  excluded_inactive_or_deleted_count: 0,
  excluded_unapproved_affiliation_count: 0,
  affiliate_history_products: [],
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
  const response = await callDigistore('listMarketplaceEntries', { sort_by: 'rank', language: 'en' });
  result.marketplace_entries = asArray(response.data);
} catch (error) {
  result.marketplace_entries_error = error.message;
}

try {
  const response = await callDigistore('listPurchases', {
    from: 'start',
    to: 'now',
    page_no: 1,
    page_size: 1000,
    load_transactions: 'true',
    'search[role]': 'affiliate'
  });
  result.affiliate_purchases_count = Number(response.data?.item_count || 0);
  result.affiliate_purchases = asArray(response.data?.purchase_list);
} catch (error) {
  result.affiliate_purchases_error = error.message;
  result.affiliate_purchases = [];
}

try {
  const response = await callDigistore('listTransactions', {
    from: 'start',
    to: 'now',
    page_no: 1,
    page_size: 1000,
    'search[role]': 'affiliate'
  });
  result.affiliate_transactions_count = Number(response.data?.summary?.count || response.data?.transaction_list?.length || 0);
  result.affiliate_transactions = asArray(response.data?.transaction_list);
} catch (error) {
  result.affiliate_transactions_error = error.message;
  result.affiliate_transactions = [];
}

const historyProducts = extractAffiliateProducts(result.affiliate_purchases, result.affiliate_transactions)
  .sort((a, b) => {
    const byEarnings = b.total_affiliate_amount - a.total_affiliate_amount;
    if (byEarnings) return byEarnings;
    return b.sales_count - a.sales_count;
  });
result.affiliate_history_products_count = historyProducts.length;

const approvedHistoryProducts = [];
for (const product of historyProducts) {
  if (!includeInactive && (product.active === 'N' || product.deleted === 'Y')) {
    result.excluded_inactive_or_deleted_count += 1;
    continue;
  }
  const validation = await validateAffiliateProduct(product);
  if (validation.have_affiliation !== 'Y' || validation.affiliation_status !== 'approved') {
    result.excluded_unapproved_affiliation_count += 1;
    continue;
  }
  approvedHistoryProducts.push(normalizeAffiliateHistoryProduct(product, validation));
  if (approvedHistoryProducts.length >= maxProducts) break;
}
result.affiliate_history_products = approvedHistoryProducts;

const normalized = [
  ...filterRelevant(result.products, 'account_product'),
  ...filterRelevant(result.marketplace_entries, 'marketplace_entry'),
  ...approvedHistoryProducts
];

const deduped = [];
const seen = new Set();
for (const product of normalized) {
  if (seen.has(product.slug)) continue;
  seen.add(product.slug);
  deduped.push(product);
}

result.normalized_products = deduped.slice(0, maxProducts);
delete result.affiliate_purchases;
delete result.affiliate_transactions;
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
