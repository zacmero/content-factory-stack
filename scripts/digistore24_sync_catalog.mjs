#!/usr/bin/env node

import fs from 'node:fs';

const apiKey = process.env.DIGISTORE24_API_KEY || '';
const affiliateId = process.env.DIGISTORE24_AFFILIATE_ID || '';
const maxProducts = Number(process.env.DIGISTORE24_MAX_PRODUCTS || 40);
const includeInactive = process.env.DIGISTORE24_INCLUDE_INACTIVE === 'true';
const marketplaceDetailLimit = Number(process.env.DIGISTORE24_MARKETPLACE_DETAIL_LIMIT || maxProducts * 3 || 120);
const keywordList = String(
  process.env.DIGISTORE24_MARKETPLACE_KEYWORDS ||
    'senior,elderly,caregiver,nutrition,mobility,sleep,joint,arthritis,memory,digestion'
)
  .split(',')
  .map((value) => value.trim().toLowerCase().replace(/[_-]+/g, ' '))
  .filter(Boolean);

const rawOut = 'content_factory/reddit_quora/digistore24_catalog.raw.json';
const partnershipRawPath = 'content_factory/reddit_quora/digistore24_partnerships.raw.json';
const catalogPath = 'content_factory/reddit_quora/product_catalog.json';
const shouldWriteCatalog = process.argv.includes('--write-catalog');
const marketplaceSorts = ['rank', 'revenue', 'profit', 'conversion', 'created', 'name', 'stars', 'cancel'];
const scoreWeights = {
  relevance: 0.35,
  earnings_per_sale: 0.18,
  conversion: 0.14,
  cancellation: 0.08,
  newness: 0.07,
  sales: 0.08,
  recency: 0.05,
  approval: 0.05
};
const genericTokens = new Set([
  'bottle',
  'bottles',
  'more',
  'pack',
  'packs',
  'bundle',
  'bonus',
  'trial',
  'offer',
  'free',
  'the',
  'and'
]);

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

function pick(entry, keys) {
  for (const key of keys) {
    if (entry?.[key] !== undefined && entry?.[key] !== null && entry?.[key] !== '') return entry[key];
  }
  return '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(/%/g, '');
  if (text.includes('.') && text.includes(',')) text = text.replace(/,/g, '');
  else if (text.includes(',') && !text.includes('.')) text = text.replace(/,/g, '.');
  text = text.replace(/[^0-9.-]+/g, '');
  if (!text || text === '-' || text === '.') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toMoney(value) {
  return toNumber(value) ?? 0;
}

function toFlag(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(normalized)) return true;
  if (['n', 'no', 'false', '0'].includes(normalized)) return false;
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function textFrom(entry) {
  return [
    entry.name,
    entry.title,
    entry.headline,
    entry.product_name,
    entry.product_name_en,
    entry.main_product_name,
    entry.product_type_name,
    entry.vendor_name,
    entry.merchant_name,
    entry.description,
    entry.short_description,
    entry.product_category,
    entry.category,
    entry.categories,
    entry.tags
  ]
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function inferMatchedKeywords(...values) {
  const text = normalizeText(values.join(' '));
  return keywordList.filter((keyword) => text.includes(normalizeText(keyword)));
}

function inferNameKeywords(name) {
  const normalized = normalizeText(name);
  const pieces = normalized.split(' ').filter((part) => part.length > 3 && !genericTokens.has(part));
  const extras = [];
  if (/(quiet|ring|echo|neuro)/i.test(name)) {
    extras.push('tinnitus', 'ringing ears', 'ear ringing', 'hearing', 'ear comfort', 'night ringing');
  }
  if (/(nerv|nerve)/i.test(name)) {
    extras.push('nerve', 'neuropathy', 'tingling', 'nerve discomfort');
  }
  if (/(sleep|slumber|night)/i.test(name)) {
    extras.push('sleep', 'night waking', 'rest');
  }
  if (/(joint|mobility|move)/i.test(name)) {
    extras.push('mobility', 'joint comfort', 'stiffness');
  }
  return unique([...pieces, ...extras]).slice(0, 16);
}

function cleanFamilyName(name) {
  const original = String(name || '').trim();
  let family = original;
  family = family.replace(/\(\s*\d+\s*(?:more\s*)?(?:bottle|bottles|pack|packs)\s*\)/gi, ' ');
  family = family.replace(/\b\d+\s*(?:more\s*)?(?:bottle|bottles|pack|packs)\b/gi, ' ');
  family = family.replace(/\b(?:starter|trial|bundle|bonus)\b/gi, ' ');
  family = family.replace(/\s+/g, ' ').trim();
  return family || original;
}

function buildFamilyKey(name, vendorName) {
  const familyName = cleanFamilyName(name);
  const vendorSlug = slugify(vendorName || 'unknown-vendor');
  return {
    familyName: titleCase(familyName),
    familySlug: slugify(`${vendorSlug}-${familyName}`),
    familyKey: `${vendorSlug}:${normalizeText(familyName) || normalizeText(name)}`
  };
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isRecent(value, days = 120) {
  const iso = parseDate(value);
  if (!iso) return null;
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs <= days * 24 * 60 * 60 * 1000;
}

function buildAffiliateUrl(productId) {
  return `https://www.checkout-ds24.com/redir/${encodeURIComponent(productId)}/${encodeURIComponent(affiliateId)}/sarahnutri_forum`;
}

function parsePromolink(value) {
  const text = String(value || '').trim();
  if (!text) return { url: '', productId: '', contentLinkId: '' };
  const redirMatch = text.match(/\/redir\/(\d+)\//i);
  if (redirMatch) {
    return { url: text, productId: redirMatch[1], contentLinkId: '' };
  }
  const contentMatch = text.match(/\/content\/(\d+)\/(\d+)\//i);
  if (contentMatch) {
    return { url: text, productId: contentMatch[1], contentLinkId: contentMatch[2] };
  }
  return { url: text, productId: '', contentLinkId: '' };
}

function readPartnershipSnapshot() {
  if (!fs.existsSync(partnershipRawPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(partnershipRawPath, 'utf8'));
  } catch (error) {
    return { read_error: error.message, approved_products: [], partnership_rows: [] };
  }
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
    current.total_affiliate_amount += toMoney(
      purchase.total_affiliate_amount || purchase.affiliate_amount || purchase.earned_amount || 0
    );
    current.latest_sale_at =
      [current.latest_sale_at, purchase.created_at || purchase.transaction_created_at || ''].sort().at(-1) || '';
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

async function validateAffiliateProduct(productId) {
  if (!affiliateId || !productId) return { status: 'missing_affiliate_or_product' };
  try {
    const response = await callDigistore('validateAffiliate', {
      affiliate_name: affiliateId,
      product_ids: productId
    });
    return response.data || { status: 'unknown' };
  } catch (error) {
    return { status: 'validation_error', message: error.message };
  }
}

function normalizeHistoryCandidate(product, validation) {
  const family = buildFamilyKey(product.name, product.vendor_name);
  const earningsPerSale = product.sales_count > 0 ? product.total_affiliate_amount / product.sales_count : null;
  const matchKeywords = unique([...inferMatchedKeywords(product.name, product.vendor_name), ...inferNameKeywords(product.name)]);

  return {
    variant_slug: `digistore24-${product.product_id}`,
    variant_name: product.name,
    family_key: family.familyKey,
    family_slug: family.familySlug,
    family_name: family.familyName,
    digistore24_id: String(product.product_id),
    marketplace_entry_id: '',
    vendor_name: product.vendor_name || '',
    product_type_name: product.product_type_name || '',
    source: 'affiliate_sales_history',
    discovery_state: 'approved_live',
    approval_state: validation.affiliation_status || 'approved',
    auto_approval: false,
    affiliate_url: buildAffiliateUrl(product.product_id),
    match_keywords: matchKeywords,
    signals: {
      earnings_per_sale: earningsPerSale,
      conversion_rate: null,
      cancellation_rate: null,
      sales_count: product.sales_count,
      created_at: null,
      latest_activity_at: parseDate(product.latest_sale_at),
      is_new: null,
      stars: null
    },
    sales_count: product.sales_count,
    total_affiliate_amount: Number(product.total_affiliate_amount.toFixed(2)),
    latest_sale_at: parseDate(product.latest_sale_at),
    affiliation_status: validation.affiliation_status || 'approved'
  };
}

function normalizePartnershipCandidate(product, validation = {}) {
  const promolink = parsePromolink(product.promolink || product.affiliate_url || '');
  const productId = String(product.product_id || promolink.productId || '').trim();
  const vendorName = String(product.vendor_name || '').trim();
  const variantName = String(product.product_name || product.name || `Digistore24 product ${productId || 'unknown'}`).trim();
  const family = buildFamilyKey(variantName, vendorName);
  const matchKeywords = unique([
    ...inferMatchedKeywords(variantName, vendorName, product.commission_text, product.product_label),
    ...inferNameKeywords(variantName)
  ]);
  const approvedByUi = String(product.status || '').toLowerCase() === 'approved';
  const approvedByApi = validation.have_affiliation === 'Y' && validation.affiliation_status === 'approved';
  const affiliateUrl = promolink.url || (productId ? buildAffiliateUrl(productId) : '');

  return {
    variant_slug: `digistore24-partnership-${slugify([vendorName, variantName, productId].filter(Boolean).join('-'))}`,
    variant_name: variantName,
    family_key: family.familyKey,
    family_slug: family.familySlug,
    family_name: family.familyName,
    digistore24_id: productId,
    marketplace_entry_id: '',
    vendor_name: vendorName,
    product_type_name: String(product.product_type_name || '').trim(),
    source: 'affiliate_partnership_ui',
    discovery_state: approvedByUi || approvedByApi ? 'approved_live' : 'manual_approval',
    approval_state:
      validation.affiliation_status ||
      String(product.status || '').trim().toLowerCase() ||
      (approvedByUi ? 'approved' : 'unknown'),
    auto_approval: false,
    affiliate_url: affiliateUrl,
    affiliate_support_url: String(product.affiliate_support_url || '').trim(),
    commission_text: String(product.commission_text || '').trim(),
    match_keywords: matchKeywords,
    signals: {
      earnings_per_sale: null,
      conversion_rate: null,
      cancellation_rate: null,
      sales_count: 0,
      created_at: null,
      latest_activity_at: parseDate(product.synced_at || ''),
      is_new: null,
      stars: null
    },
    sales_count: 0,
    total_affiliate_amount: 0,
    latest_sale_at: null,
    affiliation_status: validation.affiliation_status || (approvedByUi ? 'approved' : 'unknown')
  };
}

function extractAutoApproval(entry) {
  const allow = [
    'is_affiliate_auto_accepted',
    'affiliate_auto_accept',
    'affiliate_auto_approved',
    'auto_approve_affiliates',
    'auto_affiliate_approval',
    'approval_mode_auto',
    'auto_approval'
  ];
  const block = ['requires_manual_approval', 'manual_approval_required', 'approval_mode_manual'];

  if (allow.some((key) => toFlag(entry?.[key]) === true)) return { autoApproval: true, manualApproval: false };
  if (block.some((key) => toFlag(entry?.[key]) === true)) return { autoApproval: false, manualApproval: true };

  const status = String(pick(entry, ['approval_status', 'approval_mode', 'approval_status_msg']) || '')
    .trim()
    .toLowerCase();
  if (status.includes('auto')) return { autoApproval: true, manualApproval: false };
  if (status.includes('manual') || status.includes('request')) return { autoApproval: false, manualApproval: true };
  return { autoApproval: null, manualApproval: null };
}

function normalizeMarketplaceCandidate(entry, validation) {
  const variantName = String(
    pick(entry, ['headline', 'name', 'title', 'product_name', 'main_product_name']) || 'Digistore24 marketplace entry'
  ).trim();
  const vendorName = String(pick(entry, ['vendor_name', 'merchant_name']) || '').trim();
  const family = buildFamilyKey(variantName, vendorName);
  const digistore24Id = String(pick(entry, ['main_product_id', 'product_id']) || '').trim();
  const marketplaceEntryId = String(pick(entry, ['id', 'entry_id', 'marketplace_entry_id']) || '').trim();
  const approval = extractAutoApproval(entry);
  const approved = validation.have_affiliation === 'Y' && validation.affiliation_status === 'approved';
  const discoveryState = approved
    ? 'approved_live'
    : approval.autoApproval === true
      ? 'auto_approvable'
      : approval.manualApproval === true
        ? 'manual_approval'
        : 'marketplace_candidate';
  const matchKeywords = unique([...inferMatchedKeywords(textFrom(entry)), ...inferNameKeywords(variantName)]);

  return {
    variant_slug: `digistore24-market-${marketplaceEntryId || digistore24Id || slugify(variantName)}`,
    variant_name: variantName,
    family_key: family.familyKey,
    family_slug: family.familySlug,
    family_name: family.familyName,
    digistore24_id: digistore24Id,
    marketplace_entry_id: marketplaceEntryId,
    vendor_name: vendorName,
    product_type_name: String(pick(entry, ['product_category', 'product_type_name']) || '').trim(),
    source: 'marketplace_entry',
    discovery_state: discoveryState,
    approval_state: validation.affiliation_status || pick(entry, ['approval_status', 'approval_status_msg']) || 'unknown',
    auto_approval: approval.autoApproval,
    affiliate_url: approved && digistore24Id ? buildAffiliateUrl(digistore24Id) : '',
    match_keywords: matchKeywords,
    signals: {
      earnings_per_sale: toNumber(pick(entry, ['stats_affiliate_profit_sale', 'affiliate_profit_sale'])),
      conversion_rate: toNumber(pick(entry, ['stats_conversion_rate', 'conversion_rate'])),
      cancellation_rate: toNumber(pick(entry, ['stats_cancel_rate', 'cancel_rate'])),
      sales_count: toNumber(pick(entry, ['stats_count_orders_w_aff', 'stats_count_orders'])),
      created_at: parseDate(pick(entry, ['product_created_at', 'created_at'])),
      latest_activity_at: parseDate(pick(entry, ['stats_updated_at', 'updated_at'])),
      is_new: isRecent(pick(entry, ['product_created_at', 'created_at']), 120),
      stars: toNumber(pick(entry, ['stats_stars']))
    }
  };
}

function normalizePositive(value, maxValue, fallback = 0.5) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  if (!maxValue || maxValue <= 0) return fallback;
  return Math.max(0, Math.min(1, value / maxValue));
}

function normalizeInverse(value, maxValue, fallback = 0.5) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  if (!maxValue || maxValue <= 0) return fallback;
  return Math.max(0, Math.min(1, 1 - value / maxValue));
}

function scoreCandidates(candidates) {
  const maxima = {
    earnings_per_sale: 0,
    conversion_rate: 0,
    cancellation_rate: 0,
    sales_count: 0
  };
  const dated = [];

  for (const candidate of candidates) {
    maxima.earnings_per_sale = Math.max(maxima.earnings_per_sale, candidate.signals.earnings_per_sale || 0);
    maxima.conversion_rate = Math.max(maxima.conversion_rate, candidate.signals.conversion_rate || 0);
    maxima.cancellation_rate = Math.max(maxima.cancellation_rate, candidate.signals.cancellation_rate || 0);
    maxima.sales_count = Math.max(maxima.sales_count, candidate.signals.sales_count || 0);
    const ts = pick(candidate.signals, ['latest_activity_at', 'created_at']);
    const parsed = ts ? new Date(ts).getTime() : NaN;
    if (Number.isFinite(parsed)) dated.push(parsed);
  }

  const newest = dated.length ? Math.max(...dated) : null;
  const oldest = dated.length ? Math.min(...dated) : null;
  const span = newest && oldest && newest > oldest ? newest - oldest : 0;

  return candidates.map((candidate) => {
    const relevanceScore = Math.min((candidate.match_keywords?.length || 0) / 4, 1);
    const earningsScore = normalizePositive(candidate.signals.earnings_per_sale, maxima.earnings_per_sale, 0.5);
    const conversionScore = normalizePositive(candidate.signals.conversion_rate, maxima.conversion_rate, 0.5);
    const cancellationScore = normalizeInverse(candidate.signals.cancellation_rate, maxima.cancellation_rate, 0.5);
    const newnessScore =
      candidate.signals.is_new === null || candidate.signals.is_new === undefined
        ? 0.5
        : candidate.signals.is_new
          ? 1
          : 0;
    const salesScore = normalizePositive(candidate.signals.sales_count, maxima.sales_count, 0.5);
    const activityAt = pick(candidate.signals, ['latest_activity_at', 'created_at']);
    const activityTs = activityAt ? new Date(activityAt).getTime() : NaN;
    const recencyScore =
      Number.isFinite(activityTs) && span > 0 ? Math.max(0, Math.min(1, (activityTs - oldest) / span)) : 0.5;
    const approvalScore =
      candidate.discovery_state === 'approved_live'
        ? 1
        : candidate.discovery_state === 'auto_approvable'
          ? 0.75
          : candidate.discovery_state === 'manual_approval'
            ? 0
            : 0.35;

    const total =
      relevanceScore * scoreWeights.relevance +
      earningsScore * scoreWeights.earnings_per_sale +
      conversionScore * scoreWeights.conversion +
      cancellationScore * scoreWeights.cancellation +
      newnessScore * scoreWeights.newness +
      salesScore * scoreWeights.sales +
      recencyScore * scoreWeights.recency +
      approvalScore * scoreWeights.approval;

    const reasonParts = [];
    if (relevanceScore >= 0.75) reasonParts.push('strong keyword relevance');
    if (earningsScore >= 0.7) reasonParts.push('high earnings per sale');
    if (conversionScore >= 0.7) reasonParts.push('strong conversion');
    if (cancellationScore >= 0.7) reasonParts.push('low cancellation');
    if (newnessScore === 1) reasonParts.push('new offer');
    if (candidate.discovery_state === 'approved_live') reasonParts.push('already approved');
    if (candidate.discovery_state === 'auto_approvable') reasonParts.push('likely auto-approvable');

    return {
      ...candidate,
      score_breakdown: {
        relevance: Number(relevanceScore.toFixed(4)),
        earnings_per_sale: Number(earningsScore.toFixed(4)),
        conversion: Number(conversionScore.toFixed(4)),
        cancellation: Number(cancellationScore.toFixed(4)),
        newness: Number(newnessScore.toFixed(4)),
        sales: Number(salesScore.toFixed(4)),
        recency: Number(recencyScore.toFixed(4)),
        approval: Number(approvalScore.toFixed(4)),
        total: Number(total.toFixed(4))
      },
      scoring_reason: reasonParts.length ? reasonParts.join(', ') : 'neutral signal mix'
    };
  });
}

function sortCandidates(a, b) {
  const approvedDelta = Number(b.discovery_state === 'approved_live') - Number(a.discovery_state === 'approved_live');
  if (approvedDelta) return approvedDelta;
  const scoreDelta = (b.score_breakdown?.total || 0) - (a.score_breakdown?.total || 0);
  if (scoreDelta) return scoreDelta;
  const salesDelta = (b.signals?.sales_count || 0) - (a.signals?.sales_count || 0);
  if (salesDelta) return salesDelta;
  return (b.signals?.earnings_per_sale || 0) - (a.signals?.earnings_per_sale || 0);
}

function aggregateFamilies(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const current = groups.get(candidate.family_key) || [];
    current.push(candidate);
    groups.set(candidate.family_key, current);
  }

  return [...groups.values()]
    .map((variants) => {
      variants.sort(sortCandidates);
      const approvedVariants = variants.filter((variant) => variant.discovery_state === 'approved_live');
      const representative = approvedVariants[0] || variants[0];
      const discoveryState = approvedVariants.length
        ? 'approved_live'
        : variants.some((variant) => variant.discovery_state === 'auto_approvable')
          ? 'auto_approvable'
          : variants.some((variant) => variant.discovery_state === 'manual_approval')
            ? 'manual_approval'
            : 'marketplace_candidate';
      const keywordFrequency = new Map();
      for (const variant of variants) {
        for (const keyword of variant.match_keywords || []) {
          keywordFrequency.set(keyword, (keywordFrequency.get(keyword) || 0) + 1);
        }
      }
      const familyKeywords = unique([
        ...(representative.match_keywords || []),
        ...[...keywordFrequency.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([keyword]) => keyword)
      ]).slice(0, 14);

      const liveVariant =
        approvedVariants.find((variant) => variant.source === 'affiliate_partnership_ui' && variant.affiliate_url) ||
        approvedVariants[0] ||
        null;
      const familyProduct = {
        slug: `digistore24-family-${representative.family_slug}`,
        name: representative.family_name,
        family_name: representative.family_name,
        affiliate_url: liveVariant?.affiliate_url || '',
        source: liveVariant ? liveVariant.source : representative.source,
        digistore24_id: liveVariant?.digistore24_id || representative.digistore24_id || '',
        vendor_name: representative.vendor_name,
        product_type_name: representative.product_type_name,
        discovery_state: discoveryState,
        match_keywords: familyKeywords,
        variant_count: variants.length,
        approved_variant_count: approvedVariants.length,
        variant_names: variants.map((variant) => variant.variant_name),
        score_breakdown: representative.score_breakdown,
        total_score: representative.score_breakdown.total,
        scoring_reason: representative.scoring_reason,
        use_when: `Use only when the forum question clearly matches ${representative.family_name} or these themes: ${familyKeywords.join(', ')}.`,
        avoid_when:
          discoveryState === 'approved_live'
            ? 'Avoid for emergency symptoms, diagnosis requests, medication changes, severe disease, or when the product is not directly relevant.'
            : 'Do not use in live suggestions until affiliate approval exists. Ignore for emergency symptoms, diagnosis requests, medication changes, severe disease, or weak relevance.'
      };

      return {
        ...familyProduct,
        variants: variants.map((variant) => ({
          variant_name: variant.variant_name,
          digistore24_id: variant.digistore24_id,
          marketplace_entry_id: variant.marketplace_entry_id,
          source: variant.source,
          discovery_state: variant.discovery_state,
          approval_state: variant.approval_state,
          auto_approval: variant.auto_approval,
          affiliate_url: variant.affiliate_url,
          match_keywords: variant.match_keywords,
          signals: variant.signals,
          score_breakdown: variant.score_breakdown,
          scoring_reason: variant.scoring_reason
        }))
      };
    })
    .sort((a, b) => {
      const approvedDelta = Number(b.discovery_state === 'approved_live') - Number(a.discovery_state === 'approved_live');
      if (approvedDelta) return approvedDelta;
      return (b.total_score || 0) - (a.total_score || 0);
    });
}

async function fetchAffiliatePurchases() {
  const pageSize = 250;
  const items = [];
  for (let page = 1; page <= 8; page += 1) {
    const response = await callDigistore('listPurchases', {
      from: 'start',
      to: 'now',
      page_no: page,
      page_size: pageSize,
      load_transactions: 'true',
      'search[role]': 'affiliate'
    });
    const batch = asArray(response.data?.purchase_list);
    items.push(...batch);
    if (batch.length < pageSize) {
      return {
        count: Number(response.data?.item_count || items.length),
        items
      };
    }
  }
  return { count: items.length, items };
}

async function fetchAffiliateTransactions() {
  const pageSize = 250;
  const items = [];
  for (let page = 1; page <= 8; page += 1) {
    const response = await callDigistore('listTransactions', {
      from: 'start',
      to: 'now',
      page_no: page,
      page_size: pageSize,
      'search[role]': 'affiliate'
    });
    const batch = asArray(response.data?.transaction_list);
    items.push(...batch);
    if (batch.length < pageSize) {
      return {
        count: Number(response.data?.summary?.count || items.length),
        items
      };
    }
  }
  return { count: items.length, items };
}

async function fetchMarketplaceEntries() {
  const byKey = new Map();
  const attempts = [];

  for (const sort of marketplaceSorts) {
    try {
      const response = await callDigistore('listMarketplaceEntries', {
        sort_by: sort,
        language: 'en'
      });
      const entries = asArray(response.data?.entries || response.data);
      attempts.push({
        sort,
        count: Number(response.data?.count || entries.length || 0)
      });
      for (const entry of entries) {
        const key = String(pick(entry, ['id', 'entry_id', 'marketplace_entry_id', 'main_product_id', 'product_id']) || '');
        if (key && !byKey.has(key)) byKey.set(key, entry);
      }
    } catch (error) {
      attempts.push({ sort, error: error.message });
    }
  }

  return {
    entries: [...byKey.values()],
    attempts
  };
}

async function hydrateMarketplaceEntries(entries) {
  const hydrated = [];
  for (const entry of entries.slice(0, marketplaceDetailLimit)) {
    const entryId = String(pick(entry, ['id', 'entry_id', 'marketplace_entry_id']) || '').trim();
    if (!entryId) continue;
    try {
      const response = await callDigistore('getMarketplaceEntry', { entry_id: entryId });
      const detailed = response.data || response;
      hydrated.push({ ...entry, ...detailed });
    } catch (error) {
      hydrated.push({ ...entry, detail_error: error.message });
    }
  }
  return hydrated;
}

const result = {
  synced_at: new Date().toISOString(),
  affiliate_id_present: Boolean(affiliateId),
  keyword_filter: keywordList,
  score_weights: scoreWeights,
  user_info: null,
  marketplace_stats: null,
  partnership_snapshot_present: false,
  partnership_snapshot_error: '',
  partnership_rows_count: 0,
  approved_partnership_products_count: 0,
  approved_partnership_candidates_count: 0,
  marketplace_entry_fetch_attempts: [],
  raw_marketplace_entries_count: 0,
  hydrated_marketplace_entries_count: 0,
  affiliate_purchases_count: 0,
  affiliate_transactions_count: 0,
  affiliate_history_products_count: 0,
  excluded_inactive_or_deleted_count: 0,
  excluded_unapproved_affiliation_count: 0,
  approved_live_families: [],
  marketplace_candidate_families: [],
  manual_approval_families: [],
  normalized_products: []
};

const partnershipSnapshot = readPartnershipSnapshot();
if (partnershipSnapshot) {
  result.partnership_snapshot_present = true;
  result.partnership_snapshot_error = partnershipSnapshot.read_error || '';
  result.partnership_rows_count = Array.isArray(partnershipSnapshot.partnership_rows)
    ? partnershipSnapshot.partnership_rows.length
    : 0;
  result.approved_partnership_products_count = Array.isArray(partnershipSnapshot.approved_products)
    ? partnershipSnapshot.approved_products.length
    : 0;
}

try {
  result.user_info = (await callDigistore('getUserInfo')).data || null;
} catch (error) {
  result.user_info_error = error.message;
}

try {
  result.marketplace_stats = (await callDigistore('statsMarketplace')).data || null;
} catch (error) {
  result.marketplace_stats_error = error.message;
}

let affiliatePurchases = [];
let affiliateTransactions = [];
try {
  const response = await fetchAffiliatePurchases();
  result.affiliate_purchases_count = response.count;
  affiliatePurchases = response.items;
} catch (error) {
  result.affiliate_purchases_error = error.message;
}

try {
  const response = await fetchAffiliateTransactions();
  result.affiliate_transactions_count = response.count;
  affiliateTransactions = response.items;
} catch (error) {
  result.affiliate_transactions_error = error.message;
}

let marketplaceEntries = [];
try {
  const response = await fetchMarketplaceEntries();
  marketplaceEntries = response.entries;
  result.marketplace_entry_fetch_attempts = response.attempts;
  result.raw_marketplace_entries_count = marketplaceEntries.length;
} catch (error) {
  result.marketplace_entries_error = error.message;
}

let hydratedMarketplaceEntries = [];
if (marketplaceEntries.length) {
  hydratedMarketplaceEntries = await hydrateMarketplaceEntries(marketplaceEntries);
}
result.hydrated_marketplace_entries_count = hydratedMarketplaceEntries.length;

const historyProducts = extractAffiliateProducts(affiliatePurchases, affiliateTransactions).sort((a, b) => {
  const byEarnings = b.total_affiliate_amount - a.total_affiliate_amount;
  if (byEarnings) return byEarnings;
  return b.sales_count - a.sales_count;
});
result.affiliate_history_products_count = historyProducts.length;

const historyCandidates = [];
for (const product of historyProducts) {
  if (!includeInactive && (product.active === 'N' || product.deleted === 'Y')) {
    result.excluded_inactive_or_deleted_count += 1;
    continue;
  }
  const validation = await validateAffiliateProduct(product.product_id);
  if (validation.have_affiliation !== 'Y' || validation.affiliation_status !== 'approved') {
    result.excluded_unapproved_affiliation_count += 1;
    continue;
  }
  historyCandidates.push(normalizeHistoryCandidate(product, validation));
}

const partnershipCandidates = [];
for (const product of partnershipSnapshot?.approved_products || []) {
  const promolink = parsePromolink(product.promolink || product.affiliate_url || '');
  const productId = String(product.product_id || promolink.productId || '').trim();
  const validation = productId ? await validateAffiliateProduct(productId) : { status: 'missing_product_id' };
  const candidate = normalizePartnershipCandidate(product, validation);
  if (candidate.discovery_state === 'approved_live' && candidate.affiliate_url) {
    partnershipCandidates.push(candidate);
  }
}
result.approved_partnership_candidates_count = partnershipCandidates.length;

const marketplaceCandidates = [];
for (const entry of hydratedMarketplaceEntries) {
  const productId = String(pick(entry, ['main_product_id', 'product_id']) || '').trim();
  const validation = productId ? await validateAffiliateProduct(productId) : { status: 'missing_product_id' };
  marketplaceCandidates.push(normalizeMarketplaceCandidate(entry, validation));
}

const scoredCandidates = scoreCandidates([...partnershipCandidates, ...historyCandidates, ...marketplaceCandidates]);
const familyRecords = aggregateFamilies(scoredCandidates);
const approvedLiveFamilies = familyRecords.filter((family) => family.discovery_state === 'approved_live');
const marketplaceCandidateFamilies = familyRecords.filter((family) =>
  ['auto_approvable', 'marketplace_candidate'].includes(family.discovery_state)
);
const manualApprovalFamilies = familyRecords.filter((family) => family.discovery_state === 'manual_approval');

result.approved_live_families = approvedLiveFamilies;
result.marketplace_candidate_families = marketplaceCandidateFamilies;
result.manual_approval_families = manualApprovalFamilies;
result.normalized_products = approvedLiveFamilies.slice(0, maxProducts).map((family) => ({
  slug: family.slug,
  name: family.name,
  family_name: family.family_name,
  affiliate_url: family.affiliate_url,
  source: family.source,
  digistore24_id: family.digistore24_id,
  vendor_name: family.vendor_name,
  product_type_name: family.product_type_name,
  discovery_state: family.discovery_state,
  variant_count: family.variant_count,
  variant_names: family.variant_names,
  match_keywords: family.match_keywords,
  score_breakdown: family.score_breakdown,
  total_score: family.total_score,
  scoring_reason: family.scoring_reason,
  use_when: family.use_when,
  avoid_when: family.avoid_when
}));

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
console.log(`Approved live Digistore24 families: ${result.approved_live_families.length}`);
console.log(`Marketplace candidate families: ${result.marketplace_candidate_families.length}`);
console.log(`Manual-approval families: ${result.manual_approval_families.length}`);
if (shouldWriteCatalog) console.log(`Updated ${catalogPath}`);
if (!affiliateId) console.log('DIGISTORE24_AFFILIATE_ID is empty. Verify generated product URLs before posting.');
