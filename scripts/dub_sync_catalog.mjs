#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

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

const apiKey = process.env.DUB_API_KEY || '';
const baseUrl = String(process.env.DUB_BASE_URL || 'https://api.dub.co').replace(/\/+$/, '');
const dubDomain = String(process.env.DUB_DOMAIN || '').trim();
const dubCampaign = String(process.env.DUB_CAMPAIGN || 'content-factory').trim();
const dubTagNames = String(process.env.DUB_TAG_NAMES || 'content-factory,digistore24,affiliate')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const maxNewLinks = Number(process.env.DUB_MAX_NEW_LINKS || 25);
const cachePath = 'content_factory/reddit_quora/dub_links.json';
const catalogPath = 'content_factory/reddit_quora/product_catalog.json';
const writeCatalog = process.argv.includes('--write-catalog');
const dryRun = process.argv.includes('--dry-run');

if (!apiKey) {
  console.error('Missing DUB_API_KEY.');
  console.error('Create one in Dub.co > API keys.');
  process.exit(1);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDubLink(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.includes('dub.co') || text.includes('dub.sh') || text.includes('dub.link');
}

function getProductKey(product) {
  return [
    product.family_key || '',
    product.slug || '',
    product.digistore24_id || '',
    product.name || ''
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join('|');
}

function getExternalId(product) {
  return `content-factory:digistore24:${slugify(product.slug || product.family_key || product.digistore24_id || product.name)}`;
}

function getKey(product) {
  return `cf-${slugify(product.slug || product.family_key || product.digistore24_id || product.name)}`.slice(0, 190);
}

function getRawUrl(product) {
  const raw = String(product.raw_affiliate_url || '').trim();
  if (raw) return raw;
  const current = String(product.affiliate_url || '').trim();
  if (current && !isDubLink(current)) return current;
  return '';
}

function eligibleForTracking(product) {
  return (
    String(product.discovery_state || '') === 'approved_live' &&
    Boolean(
      String(product.raw_affiliate_url || '').trim() ||
        (String(product.affiliate_url || '').trim() && !isDubLink(product.affiliate_url)) ||
        String(product.tracked_affiliate_url || '').trim() ||
        String(product.dub_short_url || '').trim()
    )
  );
}

function scoreValue(product) {
  return Number(product.total_score || product.score_breakdown?.total || 0);
}

async function callDub(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const parsed = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = parsed?.message || parsed?.raw || response.statusText;
    const error = new Error(`${method} ${pathname} failed: ${response.status} ${message}`);
    error.status = response.status;
    throw error;
  }

  return parsed;
}

async function getDubLinkByExternalId(externalId) {
  try {
    return await callDub(`/links/info?externalId=${encodeURIComponent(`ext_${externalId}`)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function createDubLink(product, externalId) {
  const rawUrl = getRawUrl(product);
  const body = {
    url: rawUrl,
    externalId,
    key: getKey(product),
  };

  if (dubDomain) body.domain = dubDomain;

  return callDub('/links', { method: 'POST', body });
}

async function updateDubLink(linkIdOrExternalId, product, existingLink) {
  const rawUrl = getRawUrl(product);
  const body = {
    url: rawUrl,
  };

  if (dubDomain) body.domain = dubDomain;

  return callDub(`/links/${encodeURIComponent(linkIdOrExternalId)}`, { method: 'PATCH', body });
}

function loadCache() {
  const cache = readJson(cachePath, {
    workspace: 'content-factory',
    month_key: new Date().toISOString().slice(0, 7),
    max_new_links: maxNewLinks,
    created_this_month: 0,
    links: []
  });

  const currentMonth = new Date().toISOString().slice(0, 7);
  if (cache.month_key !== currentMonth) {
    cache.month_key = currentMonth;
    cache.created_this_month = 0;
  }
  cache.max_new_links = Number(cache.max_new_links || maxNewLinks);
  cache.links = Array.isArray(cache.links) ? cache.links : [];
  return cache;
}

function saveCache(cache) {
  writeJson(cachePath, cache);
}

function cacheLinkRecord(cache, externalId, linkRecord, product) {
  const record = {
    externalId,
    id: linkRecord.id || '',
    shortLink: linkRecord.shortLink || linkRecord.short_link || '',
    url: linkRecord.url || getRawUrl(product),
    domain: linkRecord.domain || '',
    key: linkRecord.key || '',
    createdAt: linkRecord.createdAt || '',
    updatedAt: linkRecord.updatedAt || '',
    title: linkRecord.title || product.name || '',
    description: linkRecord.description || '',
    comments: linkRecord.comments || '',
    raw_affiliate_url: getRawUrl(product),
    product_slug: product.slug || '',
    family_name: product.family_name || '',
    digistore24_id: product.digistore24_id || '',
    source: product.source || 'digistore24',
    month_key: cache.month_key
  };

  const index = cache.links.findIndex((entry) => String(entry.externalId || '') === externalId);
  if (index >= 0) cache.links[index] = record;
  else cache.links.push(record);

  return record;
}

function stripInternalFields(product) {
  return Object.fromEntries(
    Object.entries(product).filter(([key]) => !key.startsWith('_') && key !== 'tracked_affiliate_url' && key !== 'dub_short_url')
  );
}

function mergeCatalogLink(product, linkRecord) {
  if (!linkRecord) return { ...product, raw_affiliate_url: getRawUrl(product) };
  return {
    ...product,
    raw_affiliate_url: getRawUrl(product),
    tracked_affiliate_url: linkRecord.shortLink || linkRecord.short_link || '',
    dub_short_url: linkRecord.shortLink || linkRecord.short_link || '',
    dub_link_id: linkRecord.id || '',
    dub_external_id: linkRecord.externalId || getExternalId(product),
    dub_domain: linkRecord.domain || '',
    dub_key: linkRecord.key || '',
    dub_track_conversion: Boolean(linkRecord.trackConversion),
    dub_created_at: linkRecord.createdAt || '',
    dub_updated_at: linkRecord.updatedAt || '',
    affiliate_url: linkRecord.shortLink || linkRecord.short_link || getRawUrl(product),
    tracking_source: 'dub'
  };
}

function buildCandidates(products) {
  return [...products]
    .filter(eligibleForTracking)
    .sort((a, b) => scoreValue(b) - scoreValue(a))
    .map((product) => ({
      ...product,
      _dub_external_id: getExternalId(product),
      _dub_key: getKey(product),
      _raw_affiliate_url: getRawUrl(product),
      _product_key: getProductKey(product)
    }));
}

async function syncDubLinks(products) {
  const cache = loadCache();
  const cacheByExternalId = new Map(cache.links.map((link) => [String(link.externalId || '').trim(), link]));
  const enrichedBySlug = new Map();
  const candidates = buildCandidates(products);
  let createdCount = 0;
  let reusedCount = 0;
  let skippedForLimit = 0;
  let updatedCount = 0;
  let writeBlocked = null;

  for (const product of candidates) {
    const externalId = product._dub_external_id;
    const cached = cacheByExternalId.get(externalId);
    let linkRecord = cached || null;

    if (writeBlocked && !linkRecord) {
      skippedForLimit += 1;
      enrichedBySlug.set(product.slug, { ...product, raw_affiliate_url: product._raw_affiliate_url });
      continue;
    }

    if (!linkRecord) {
      try {
        linkRecord = await getDubLinkByExternalId(externalId);
      } catch (error) {
        if ([403, 429].includes(Number(error.status))) {
          writeBlocked = error.status;
          skippedForLimit += 1;
          enrichedBySlug.set(product.slug, { ...product, raw_affiliate_url: product._raw_affiliate_url });
          continue;
        }
        linkRecord = null;
      }
    }

    if (linkRecord) {
      reusedCount += 1;
      const needsUrlUpdate = String(linkRecord.url || '').trim() !== product._raw_affiliate_url;
      if (needsUrlUpdate && !dryRun) {
        try {
          linkRecord = await updateDubLink(linkRecord.id || `ext_${externalId}`, product, linkRecord);
          updatedCount += 1;
        } catch (error) {
          console.error(`Dub update failed for ${product.name}: ${error.message}`);
          if ([403, 429].includes(Number(error.status))) {
            writeBlocked = error.status;
          }
        }
      }
      cacheLinkRecord(cache, externalId, linkRecord, product);
      enrichedBySlug.set(product.slug, mergeCatalogLink(product, linkRecord));
      continue;
    }

    if (cache.created_this_month >= cache.max_new_links) {
      skippedForLimit += 1;
      enrichedBySlug.set(product.slug, { ...product, raw_affiliate_url: product._raw_affiliate_url });
      continue;
    }

    if (dryRun) {
      skippedForLimit += 1;
      enrichedBySlug.set(product.slug, { ...product, raw_affiliate_url: product._raw_affiliate_url });
      continue;
    }

    try {
      linkRecord = await createDubLink(product, externalId);
      cache.created_this_month += 1;
      createdCount += 1;
      cacheLinkRecord(cache, externalId, linkRecord, product);
      enrichedBySlug.set(product.slug, mergeCatalogLink(product, linkRecord));
    } catch (error) {
      skippedForLimit += 1;
      console.error(`Dub create failed for ${product.name}: ${error.message}`);
      if ([403, 429].includes(Number(error.status))) {
        writeBlocked = error.status;
      }
      enrichedBySlug.set(product.slug, { ...product, raw_affiliate_url: product._raw_affiliate_url });
    }
  }

  const enrichedProducts = products.map((product) => {
    const enriched = enrichedBySlug.get(product.slug);
    if (enriched) return stripInternalFields(enriched);
    if (isDubLink(product.affiliate_url) && product.raw_affiliate_url) return stripInternalFields(product);
    return stripInternalFields({ ...product, raw_affiliate_url: getRawUrl(product) });
  });

  if (!dryRun) saveCache(cache);

  return {
    products: enrichedProducts,
    summary: {
      total_products: products.length,
      eligible_for_tracking: candidates.length,
      reused_links: reusedCount,
      created_links: createdCount,
      updated_links: updatedCount,
      skipped_for_limit: skippedForLimit,
      monthly_budget_remaining: Math.max(0, cache.max_new_links - cache.created_this_month)
    }
    ,
    write_blocked_status: writeBlocked
  };
}

const catalog = readJson(catalogPath, { products: [] });
const products = Array.isArray(catalog.products) ? catalog.products : [];
const result = await syncDubLinks(products);

if (writeCatalog && !dryRun) {
  writeJson(catalogPath, { ...catalog, products: result.products });
}

console.log(`Dub workspace: ${dubCampaign}`);
console.log(`Eligible products: ${result.summary.eligible_for_tracking}`);
console.log(`Dub links reused: ${result.summary.reused_links}`);
console.log(`Dub links created: ${result.summary.created_links}`);
console.log(`Dub links updated: ${result.summary.updated_links}`);
console.log(`Dub links skipped due to monthly cap: ${result.summary.skipped_for_limit}`);
console.log(`Monthly budget remaining: ${result.summary.monthly_budget_remaining}`);
if (writeCatalog && !dryRun) console.log(`Updated ${catalogPath}`);
