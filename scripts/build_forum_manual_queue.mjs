#!/usr/bin/env node

import fs from 'node:fs';

const discordCredential = {
  discordWebhookApi: {
    id: '7i15uQZ2xyb2Y3zH',
    name: 'Discord Webhook account'
  }
};

const bonsaiCredential = {
  openAiApi: {
    id: 'b0nsa1OpenAi8081',
    name: 'Bonsai OpenAI account'
  }
};

function node(id, name, type, typeVersion, position, parameters = {}, extra = {}) {
  return { parameters, id, name, type, typeVersion, position, ...extra };
}

const productCatalog = JSON.parse(fs.readFileSync('content_factory/reddit_quora/product_catalog.json', 'utf8'));
const dubLinks = JSON.parse(fs.readFileSync('content_factory/reddit_quora/dub_links.json', 'utf8'));
const forumLinkHealthUrl = process.env.FORUM_LINK_HEALTH_URL || 'http://host.docker.internal:8791';
const pipelineConfig = JSON.parse(fs.readFileSync('content_factory/reddit_quora/config.json', 'utf8'));
const redditPrompt = fs.readFileSync('content_factory/reddit_quora/prompts/reddit_reply_system.md', 'utf8');
const quoraPrompt = fs.readFileSync('content_factory/reddit_quora/prompts/quora_reply_system.md', 'utf8');

function normalizeSimple(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function cleanCatalogLabel(value) {
  return String(value || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\b(main|up|down)\s*\d+(\.\d+)?\b/gi, ' ')
    .replace(/[-–—:]/g, ' ')
    .replace(/\b\d+\s*bottles?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseCanonicalProduct(products, labelKey) {
  const group = products.filter((product) => {
    const label = cleanCatalogLabel(product.family_name || product.name || product.slug || '');
    return normalizeSimple(label) === labelKey;
  });
  group.sort((a, b) => {
    const aName = normalizeSimple(a.name || a.family_name || '');
    const bName = normalizeSimple(b.name || b.family_name || '');
    const aCanonical = aName === labelKey;
    const bCanonical = bName === labelKey;
    if (aCanonical !== bCanonical) return aCanonical ? -1 : 1;
    return String(a.slug || '').length - String(b.slug || '').length;
  });
  return group[0] || null;
}

const trackedAffiliateUrls = (() => {
  const direct = Object.fromEntries((dubLinks.links || []).map((link) => [link.product_slug, link.shortLink || link.url]));
  const products = productCatalog.products || [];
  const canonicalByLabel = new Map();
  for (const product of products) {
    const labelKey = normalizeSimple(cleanCatalogLabel(product.family_name || product.name || product.slug || ''));
    if (!labelKey) continue;
    if (!canonicalByLabel.has(labelKey)) {
      canonicalByLabel.set(labelKey, chooseCanonicalProduct(products, labelKey));
    }
  }
  return Object.fromEntries(products.map((product) => {
    const labelKey = normalizeSimple(cleanCatalogLabel(product.family_name || product.name || product.slug || ''));
    const canonical = labelKey ? canonicalByLabel.get(labelKey) : null;
    const canonicalUrl = canonical ? direct[canonical.slug] || canonical.affiliate_url : '';
    const ownUrl = direct[product.slug] || product.affiliate_url || '';
    return [product.slug, canonicalUrl || ownUrl];
  }));
})();

function buildNormalizePairJs() {
  return `const config = ${JSON.stringify(pipelineConfig, null, 2)};
const products = ${JSON.stringify(productCatalog.products, null, 2)};
const trackedAffiliateUrls = ${JSON.stringify(trackedAffiliateUrls, null, 2)};
const body = $json.body || $json || {};
const defaultReddit = {
  platform: 'reddit',
  title: 'Caregiver asking how to help an older parent eat enough protein',
  body: 'My elderly mother has very little appetite and I am worried she is losing strength. What are simple ways to help without making meals complicated?',
  url: '',
  subreddit: 'AgingParents'
};
const defaultQuora = {
  platform: 'quora',
  title: 'What are easy nutrition habits that help elderly people keep their strength?',
  body: 'Looking for practical advice for older adults who do not eat much and get tired easily.',
  url: ''
};

function cleanCandidate(input, fallback, platform) {
  const value = input && typeof input === 'object' ? input : fallback;
  return {
    platform,
    title: String(value.title || fallback.title || '').trim(),
    body: String(value.body || value.text || fallback.body || '').trim(),
    url: String(value.url || value.permalink || '').trim(),
    subreddit: String(value.subreddit || '').trim()
  };
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length > 2 && !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have'].includes(token));
}

function normalizeUrl(value) {
  return String(value || '').trim();
}

function scoreProductForCandidate(product, candidate) {
  const haystack = normalize([candidate.title, candidate.body, candidate.subreddit, candidate.url].join(' '));
  const tokens = new Set(tokenize(haystack));
  const keywordHits = [];
  let score = 0;
  const family = normalize(product.family_name || product.name || '');
  if (family && haystack.includes(family)) {
    score += 6;
    keywordHits.push(product.family_name || product.name);
  }
  for (const keyword of product.match_keywords || []) {
    const normalizedKeyword = normalize(keyword);
    if (!normalizedKeyword) continue;
    const keywordTokens = tokenize(normalizedKeyword);
    const fullPhraseHit = normalizedKeyword.length > 4 && haystack.includes(normalizedKeyword);
    const tokenHit = keywordTokens.length > 0 && keywordTokens.every((token) => tokens.has(token));
    if (fullPhraseHit || tokenHit) {
      score += normalizedKeyword.split(' ').length > 1 ? 4 : 2;
      keywordHits.push(keyword);
    }
  }
  const catalogScore = Number(product.total_score || product.score_breakdown?.total || 0);
  return {
    ...product,
    question_match_score: Number((score + catalogScore * 0.5).toFixed(4)),
    question_match_hits: [...new Set(keywordHits)].slice(0, 8)
  };
}

function rankProductsForCandidate(candidate) {
  return (products || [])
    .filter((product) => product.affiliate_url)
    .map((product) => scoreProductForCandidate(product, candidate))
    .sort((a, b) => {
      const matchDelta = (b.question_match_score || 0) - (a.question_match_score || 0);
      if (matchDelta) return matchDelta;
      return Number(b.total_score || 0) - Number(a.total_score || 0);
    })
    .slice(0, 8);
}

const reddit = cleanCandidate(body.reddit, defaultReddit, 'reddit');
const quora = cleanCandidate(body.quora, defaultQuora, 'quora');

return [{
  json: {
    brand: config.brand,
    config,
    products,
    trackedAffiliateUrls,
    reddit,
    quora,
    redditProducts: rankProductsForCandidate(reddit),
    quoraProducts: rankProductsForCandidate(quora),
    intakeNotes: String(body.notes || '').trim()
  }
}];`;
}

function buildMergeLinkChecksJs() {
  return `const source = $node['Normalize Candidate Pair'].json;
const checks = $json || {};
const redditCheck = checks.reddit || { live: null, status: 'unvalidated', finalUrl: source.reddit?.url || '', reason: 'missing_health_response', platform: 'reddit' };
const quoraCheck = checks.quora || { live: null, status: 'unvalidated', finalUrl: source.quora?.url || '', reason: 'missing_health_response', platform: 'quora' };

return [{
  json: {
    ...source,
    reddit: { ...source.reddit, urlCheck: redditCheck },
    quora: { ...source.quora, urlCheck: quoraCheck }
  }
}];`;
}

function buildRedditPromptJs() {
  const promptLines = [
    'You are Sarah Nutri. Write like a real person: brief, warm, specific, and caring.',
    'Start with empathy. No AI fluff, no lecture tone, no "here are five tips".',
    'Opening examples: "Oh, I know how annoying this can be." "I\'ve seen this help a lot for older adults." "I\'ve been looking into this, and one thing that stands out is..."',
    'Closing examples: "You\'re not alone in this, and there are practical ways to make it easier." "If you want, I can help you narrow down the next best step." "Small changes can really add up here, and you don\'t have to figure it out alone."',
    'Hard rules: do not diagnose, prescribe, or change medications. No product unless directly relevant. If the thread is dead, unavailable, or unverified, return safety skip.',
    'If you mention a product, use the short family name only, not pack counts or variant labels.',
    'Manual posting mode: draft one copy/paste-ready Reddit comment. Use 1 short paragraph or 2 short sentences max. Keep it under 90 words. Do not mention automation. Do not lead with the product. If the product fits, mention it once at the end and include the affiliate disclosure.'
  ];
  return String.raw`const products = ($json.redditProducts || $json.products || []).filter((p) => p.affiliate_url).map((p) => ({
  slug: p.slug,
  name: p.name,
  match_keywords: p.match_keywords,
  question_match_score: p.question_match_score,
  question_match_hits: p.question_match_hits,
  use_when: p.use_when,
  avoid_when: p.avoid_when,
  affiliate_url: p.affiliate_url,
  source: p.source || 'manual_catalog'
}));
const question = $json.reddit;
const prompt = [
  ${promptLines.map((line) => JSON.stringify(line)).join(',\n  ')},
  'Reddit question context:',
  JSON.stringify(question, null, 2),
  'Thread URL check:',
  JSON.stringify(question.urlCheck || {}, null, 2),
  'Pre-ranked product shortlist for this question:',
  JSON.stringify(products, null, 2),
  'Return strict JSON only.'
].join('\n\n');
return [{ json: { ...$json, products, redditPrompt: prompt } }];`;
}

function buildQuoraPromptJs() {
  const promptLines = [
    'You are Sarah Nutri. Write like a real person: brief, warm, specific, and caring.',
    'Start with empathy. No AI fluff, no lecture tone.',
    'Opening examples: "Oh, I know how frustrating this can be." "I\'ve been looking into this, and one thing that keeps coming up is..." "For a lot of families, this tends to help more than people expect."',
    'Closing examples: "You\'re not alone in this, and there are many ways to manage it with support and care." "If you\'d like, I can help narrow this down to the most practical next step."',
    'Hard rules: general education only, not diagnosis. No product unless directly relevant. If the thread is dead, unavailable, or unverified, return safety skip.',
    'If you mention a product, use the short family name only, not pack counts or variant labels.',
    'Manual posting mode: draft one copy/paste-ready Quora answer. Use 2 short paragraphs max or 3 short bullets max. Keep it under 120 words. Do not mention automation. If you include an affiliate link, include the disclosure in one short closing sentence.'
  ];
  return String.raw`const products = ($json.quoraProducts || $json.products || []).filter((p) => p.affiliate_url).map((p) => ({
  slug: p.slug,
  name: p.name,
  match_keywords: p.match_keywords,
  question_match_score: p.question_match_score,
  question_match_hits: p.question_match_hits,
  use_when: p.use_when,
  avoid_when: p.avoid_when,
  affiliate_url: p.affiliate_url,
  source: p.source || 'manual_catalog'
}));
const question = $json.quora;
const prompt = [
  ${promptLines.map((line) => JSON.stringify(line)).join(',\n  ')},
  'Quora question context:',
  JSON.stringify(question, null, 2),
  'Thread URL check:',
  JSON.stringify(question.urlCheck || {}, null, 2),
  'Pre-ranked product shortlist for this question:',
  JSON.stringify(products, null, 2),
  'Return strict JSON only.'
].join('\n\n');
return [{ json: { ...$json, products, quoraPrompt: prompt } }];`;
}
function buildParseRedditJs() {
  return String.raw`const source = $node['Build Reddit Prompt'].json;
const raw = String($json.text || '').trim();
function parseJson(text) {
  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
  const body = fenced ? fenced[1] : text;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('Bonsai Reddit draft was not JSON: ' + text.slice(0, 300));
  function repairJson(value) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (const ch of value) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = !inString;
        continue;
      }
      if (inString && ch.charCodeAt(0) < 32) {
        if (ch === '\n') out += '\\\\n';
        else if (ch === '\r') out += '\\\\r';
        else if (ch === '\t') out += '\\\\t';
        else if (ch === '\b') out += '\\\\b';
        else if (ch === '\f') out += '\\\\f';
        else out += '\\\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
    }
    return out;
  }
  return JSON.parse(repairJson(body.slice(first, last + 1)));
}
function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizeSafety(value, text) {
  const safety = String(value || '').toLowerCase();
  if (['answer', 'human_review', 'emergency', 'skip'].includes(safety)) return safety;
  if (safety.includes('emergency')) return 'emergency';
  if (safety.includes('human')) return 'human_review';
  if (safety.includes('skip')) return 'skip';
  return String(text || '').trim() ? 'answer' : 'human_review';
}
function escapeRegExp(value) {
  const pattern = new RegExp('[.*+?^' + '$' + '{}()|[\\]\\\\]', 'g');
  return String(value || '').replace(pattern, '\\$&');
}
function productMentioned(product, text) {
  const normalizedText = normalize(text);
  const productName = normalize(product.name).replace(/ bottles?\\b/g, '').trim();
  if (productName && normalizedText.includes(productName)) return true;
  return (product.match_keywords || [])
    .filter((keyword) => String(keyword).length > 4)
    .some((keyword) => normalizedText.includes(normalize(keyword)));
}
function cleanProductLabel(product) {
  const raw = String(product?.family_name || product?.name || product?.slug || product?.digistore24_id || '');
  return raw
    .replace(new RegExp('\\[[^\\]]+\\]', 'g'), ' ')
    .replace(new RegExp('\\b(main|up|down)\\s*\\d+(\\.\\d+)?\\b', 'gi'), ' ')
    .replace(/[-–—:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || String(product?.name || 'product');
}
function normalizeSimple(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function canonicalizeProduct(product, pool) {
  if (!product) return null;
  const labelKey = normalizeSimple(cleanProductLabel(product));
  const canonical = (pool || []).find((candidate) => {
    if (!candidate?.affiliate_url) return false;
    return normalizeSimple(cleanProductLabel(candidate)) === labelKey && normalizeSimple(candidate.name || candidate.family_name || '') === labelKey;
  });
  return canonical || product;
}
function stripVariantNoise(value) {
  return String(value || '')
    .replace(new RegExp('\\[[^\\]]+\\]', 'g'), ' ')
    .replace(new RegExp('\\b(main|up|down)\\s*\\d+(\\.\\d+)?\\b', 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeProductAliases(text, product, pool, displayName) {
  if (!product || !displayName) return String(text || '');
  const labelKey = normalizeSimple(cleanProductLabel(product));
  const aliases = new Set();
  for (const candidate of pool || []) {
    if (normalizeSimple(cleanProductLabel(candidate)) !== labelKey) continue;
    for (const value of [candidate.name, candidate.family_name, ...(candidate.variant_names || [])]) {
      const clean = String(value || '').trim();
      if (clean) aliases.add(clean);
    }
  }
  let output = String(text || '');
  for (const alias of aliases) {
    if (normalizeSimple(alias) === normalizeSimple(displayName)) continue;
    output = output.replace(new RegExp(escapeRegExp(alias), 'gi'), displayName);
  }
  return output;
}
function hasExplicitEmergency(text) {
  const normalizedText = normalize(text);
  return (source.config.safety.block_if_contains || []).some((term) => normalizedText.includes(normalize(term)));
}
function buildFallbackReply(candidate, product) {
  const topic = String(candidate.title || '').trim();
  const body = String(candidate.body || '').trim();
  const label = product ? cleanProductLabel(product) : '';
  const lines = [
    'Oh, I know how frustrating this can be, especially at night.',
    'A few things people often find helpful are keeping the room steady and calm, using a little background sound if silence makes the ringing feel louder, and getting a hearing check if it keeps hanging on.',
    'You\'re not alone in this, and there are practical ways to make it easier.'
  ];
  if (/tinnitus|ring|ear/i.test([topic, body].join(' ')) && product && product.name) {
    lines.splice(2, 0, 'I found a product match that may be worth a look: ' + (label || product.name) + '.');
  }
  return lines.join(' ');
}

let parsed;
try {
  parsed = parseJson(raw);
} catch (error) {
  return [{
    json: {
      ...source,
      redditDraft: {
        raw,
        text: 'Draft parsing failed. Please retry the Reddit run.',
        safety: 'skip',
        affiliateAllowed: false,
        selectedProductSlug: '',
        selectedProductName: '',
        reason: String(error?.message || error),
        urlCheck: source.reddit.urlCheck || {}
      }
    }
  }];
}
const products = source.redditProducts || source.products || [];
const urlCheck = source.reddit.urlCheck || {};
let text = String(parsed.reply || '').trim();
let safety = normalizeSafety(parsed.safety, text);
const topicText = [source.reddit.title, source.reddit.body, source.reddit.url].join(' ');

if (urlCheck.live === false) {
  if (urlCheck.status !== 'missing' && urlCheck.status !== 'unvalidated') {
    safety = 'skip';
    text = 'Thread no longer reachable. Pick a live Reddit post before drafting a reply.';
  }
}

if (safety === 'emergency' && !hasExplicitEmergency(topicText) && /tinnitus|ringing ears|ear ringing|night ringing/i.test(topicText)) {
  safety = 'answer';
}
if (safety === 'human_review' && !hasExplicitEmergency(topicText)) {
  safety = 'answer';
}

let product = products.find((p) => p.slug === parsed.selected_product_slug && p.affiliate_url) || null;
if (!product) product = products.find((p) => p.affiliate_url && productMentioned(p, text)) || null;
if (!product) product = products.find((p) => p.affiliate_url && Array.isArray(p.question_match_hits) && p.question_match_hits.length > 0) || null;
product = canonicalizeProduct(product, products);
const displayName = product ? cleanProductLabel(product) : '';
const trackedUrl = product ? (source.trackedAffiliateUrls?.[product.slug] || product.affiliate_url) : '';
if (product && displayName && product.name && displayName !== product.name) {
  text = text.replace(new RegExp(escapeRegExp(product.name), 'g'), displayName);
}
text = normalizeProductAliases(text, product, products, displayName);
text = stripVariantNoise(text);
if (product && displayName && trackedUrl) {
  text = text.replace(/Helpful resource:[^\n]*/i, 'Helpful resource: ' + displayName + ' - ' + trackedUrl);
}
if (!text || text.length < 40) {
  text = buildFallbackReply(source.reddit, product);
}

const allowProduct = safety !== 'skip' && safety !== 'emergency' && product && text.length > 80 && (parsed.affiliate_allowed === true || productMentioned(product, text) || (Array.isArray(product.question_match_hits) && product.question_match_hits.length > 0));
if (allowProduct && trackedUrl && !text.includes(trackedUrl)) {
  text += '\n\nHelpful resource: ' + (displayName || product.name) + ' - ' + trackedUrl;
  text += '\n' + source.config.default_disclosure;
}

return [{
  json: {
    ...source,
    redditDraft: {
      raw,
      text,
      safety,
      affiliateAllowed: Boolean(allowProduct),
      selectedProductSlug: product ? product.slug : '',
      selectedProductName: displayName || (product ? product.name : ''),
      reason: parsed.reason || (urlCheck.live === false ? urlCheck.reason || 'thread_unreachable' : ''),
      urlCheck
    }
  }
}];`;
}

function buildParseQuoraJs() {
  return String.raw`const source = $node['Build Quora Prompt'].json;
const raw = String($json.text || '').trim();
function parseJson(text) {
  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
  const body = fenced ? fenced[1] : text;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('Bonsai Quora draft was not JSON: ' + text.slice(0, 300));
  function repairJson(value) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (const ch of value) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = !inString;
        continue;
      }
      if (inString && ch.charCodeAt(0) < 32) {
        if (ch === '\n') out += '\\\\n';
        else if (ch === '\r') out += '\\\\r';
        else if (ch === '\t') out += '\\\\t';
        else if (ch === '\b') out += '\\\\b';
        else if (ch === '\f') out += '\\\\f';
        else out += '\\\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
    }
    return out;
  }
  return JSON.parse(repairJson(body.slice(first, last + 1)));
}
function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizeSafety(value, text) {
  const safety = String(value || '').toLowerCase();
  if (['answer', 'human_review', 'emergency', 'skip'].includes(safety)) return safety;
  if (safety.includes('emergency')) return 'emergency';
  if (safety.includes('human')) return 'human_review';
  if (safety.includes('skip')) return 'skip';
  return String(text || '').trim() ? 'answer' : 'human_review';
}
function escapeRegExp(value) {
  const pattern = new RegExp('[.*+?^' + '$' + '{}()|[\\]\\\\]', 'g');
  return String(value || '').replace(pattern, '\\$&');
}
function productMentioned(product, text) {
  const normalizedText = normalize(text);
  const productName = normalize(product.name).replace(/ bottles?\\b/g, '').trim();
  if (productName && normalizedText.includes(productName)) return true;
  return (product.match_keywords || [])
    .filter((keyword) => String(keyword).length > 4)
    .some((keyword) => normalizedText.includes(normalize(keyword)));
}
function cleanProductLabel(product) {
  const raw = String(product?.family_name || product?.name || product?.slug || product?.digistore24_id || '');
  return raw
    .replace(new RegExp('\\[[^\\]]+\\]', 'g'), ' ')
    .replace(new RegExp('\\b(main|up|down)\\s*\\d+(\\.\\d+)?\\b', 'gi'), ' ')
    .replace(/[-–—:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || String(product?.name || 'product');
}
function normalizeSimple(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function canonicalizeProduct(product, pool) {
  if (!product) return null;
  const labelKey = normalizeSimple(cleanProductLabel(product));
  const canonical = (pool || []).find((candidate) => {
    if (!candidate?.affiliate_url) return false;
    return normalizeSimple(cleanProductLabel(candidate)) === labelKey && normalizeSimple(candidate.name || candidate.family_name || '') === labelKey;
  });
  return canonical || product;
}
function stripVariantNoise(value) {
  return String(value || '')
    .replace(new RegExp('\\[[^\\]]+\\]', 'g'), ' ')
    .replace(new RegExp('\\b(main|up|down)\\s*\\d+(\\.\\d+)?\\b', 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeProductAliases(text, product, pool, displayName) {
  if (!product || !displayName) return String(text || '');
  const labelKey = normalizeSimple(cleanProductLabel(product));
  const aliases = new Set();
  for (const candidate of pool || []) {
    if (normalizeSimple(cleanProductLabel(candidate)) !== labelKey) continue;
    for (const value of [candidate.name, candidate.family_name, ...(candidate.variant_names || [])]) {
      const clean = String(value || '').trim();
      if (clean) aliases.add(clean);
    }
  }
  let output = String(text || '');
  for (const alias of aliases) {
    if (normalizeSimple(alias) === normalizeSimple(displayName)) continue;
    output = output.replace(new RegExp(escapeRegExp(alias), 'gi'), displayName);
  }
  return output;
}
function hasExplicitEmergency(text) {
  const normalizedText = normalize(text);
  return (source.config.safety.block_if_contains || []).some((term) => normalizedText.includes(normalize(term)));
}

let parsed;
try {
  parsed = parseJson(raw);
} catch (error) {
  return [{
    json: {
      ...source,
      quoraDraft: {
        raw,
        text: 'Draft parsing failed. Please retry the Quora run.',
        safety: 'skip',
        affiliateAllowed: false,
        selectedProductSlug: '',
        selectedProductName: '',
        reason: String(error?.message || error),
        urlCheck: source.quora.urlCheck || {}
      }
    }
  }];
}
const products = source.quoraProducts || source.products || [];
const urlCheck = source.quora.urlCheck || {};
let text = String(parsed.answer || '').trim();
let safety = normalizeSafety(parsed.safety, text);
const topicText = [source.quora.title, source.quora.body, source.quora.url].join(' ');

if (urlCheck.live === false) {
  if (urlCheck.status !== 'missing' && urlCheck.status !== 'unvalidated') {
    safety = 'skip';
    text = 'Thread no longer reachable. Pick a live Quora question before drafting an answer.';
  }
}

if (safety === 'emergency' && !hasExplicitEmergency(topicText) && /tinnitus|ringing ears|ear ringing|night ringing/i.test(topicText)) {
  safety = 'answer';
}
if (safety === 'human_review' && !hasExplicitEmergency(topicText)) {
  safety = 'answer';
}

let product = products.find((p) => p.slug === parsed.selected_product_slug && p.affiliate_url) || null;
if (!product) product = products.find((p) => p.affiliate_url && productMentioned(p, text)) || null;
if (!product) product = products.find((p) => p.affiliate_url && Array.isArray(p.question_match_hits) && p.question_match_hits.length > 0) || null;
product = canonicalizeProduct(product, products);
const displayName = product ? cleanProductLabel(product) : '';
const trackedUrl = product ? (source.trackedAffiliateUrls?.[product.slug] || product.affiliate_url) : '';
if (product && displayName && product.name && displayName !== product.name) {
  text = text.replace(new RegExp(escapeRegExp(product.name), 'g'), displayName);
}
text = normalizeProductAliases(text, product, products, displayName);
text = stripVariantNoise(text);
if (product && displayName && trackedUrl) {
  text = text.replace(/Helpful resource:[^\n]*/i, 'Helpful resource: ' + displayName + ' - ' + trackedUrl);
}
if (!text || text.length < 40) {
  text = buildFallbackReply(source.quora, product);
}

const allowProduct = safety !== 'skip' && safety !== 'emergency' && product && text.length > 80 && (parsed.affiliate_allowed === true || productMentioned(product, text) || (Array.isArray(product.question_match_hits) && product.question_match_hits.length > 0));
if (allowProduct && trackedUrl && !text.includes(trackedUrl)) {
  text += '\n\nHelpful resource: ' + (displayName || product.name) + ' - ' + trackedUrl;
  text += '\n' + source.config.default_disclosure;
}

return [{
  json: {
    ...source,
    quoraDraft: {
      raw,
      text,
      safety,
      affiliateAllowed: Boolean(allowProduct),
      selectedProductSlug: product ? product.slug : '',
      selectedProductName: displayName || (product ? product.name : ''),
      reason: parsed.reason || (urlCheck.live === false ? urlCheck.reason || 'thread_unreachable' : ''),
      urlCheck
    }
  }
}];`;
}

function buildDiscordPacketsJs() {
  return String.raw`const data = $json;
function clip(text, limit) {
  const value = String(text || '');
  return value.length > limit ? value.slice(0, limit - 3) + '...' : value;
}
function firstUrl(text) {
  const match = String(text || '').match(new RegExp('https?:\\/\\/\\S+'));
  return match ? match[0] : '';
}
function urlSummary(check) {
  if (!check) return 'unknown';
  const status = check.live === true ? 'live' : check.live === false ? 'dead' : 'unvalidated';
  const reason = check.reason ? ' (' + check.reason + ')' : '';
  return status + reason;
}
function sourceUrlDisplay(candidate, check) {
  const rawLiveUrl = String(check?.finalUrl || candidate?.url || '').trim();
  const liveUrl = rawLiveUrl.replace(/[?#].*$/, '');
  if (check?.live === true && liveUrl) return liveUrl;
  if (check?.status === 'missing') return 'manual/source search';
  if (check?.live === false) return 'dead link removed';
  return candidate?.url ? candidate.url : 'manual/source search';
}
function message(lines) {
  return lines.filter((line) => line !== '').join('\n');
}
function normalizeSimple(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function cleanPacketLabel(product) {
  const raw = String(product?.family_name || product?.name || product?.slug || product?.digistore24_id || '');
  return raw
    .replace(new RegExp('\\[[^\\]]+\\]', 'g'), ' ')
    .replace(new RegExp('\\b(main|up|down)\\s*\\d+(\\.\\d+)?\\b', 'gi'), ' ')
    .replace(/[-–—:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || String(product?.name || 'product');
}
function pickPacketProduct(candidate, draft) {
  const pool = candidate?.platform === 'quora'
    ? (data.quoraProducts || data.products || [])
    : (data.redditProducts || data.products || []);
  const bySlug = draft?.selectedProductSlug ? pool.find((product) => product.slug === draft.selectedProductSlug && product.affiliate_url) : null;
  if (bySlug) {
    const labelKey = normalizeSimple(cleanPacketLabel(bySlug));
    return pool.find((product) => product.affiliate_url && normalizeSimple(cleanPacketLabel(product)) === labelKey && normalizeSimple(product.name || product.family_name || '') === labelKey) || bySlug;
  }
  if (draft?.safety === 'skip' || draft?.safety === 'emergency') return null;
  const matches = pool.filter((product) => product.affiliate_url && Array.isArray(product.question_match_hits) && product.question_match_hits.length > 0);
  matches.sort((a, b) => {
    const aLabel = cleanPacketLabel(a);
    const bLabel = cleanPacketLabel(b);
    const aCanonical = normalizeSimple(a.name) === normalizeSimple(aLabel);
    const bCanonical = normalizeSimple(b.name) === normalizeSimple(bLabel);
    if (aCanonical !== bCanonical) return aCanonical ? -1 : 1;
    if (aLabel.length !== bLabel.length) return aLabel.length - bLabel.length;
    const scoreDelta = Number(b.question_match_score || 0) - Number(a.question_match_score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return normalizeSimple(a.name).localeCompare(normalizeSimple(b.name));
  });
  return matches[0] || null;
}
function draftFields(candidate, draft) {
  const product = pickPacketProduct(candidate, draft);
  const trackedUrl = product ? (data.trackedAffiliateUrls?.[product.slug] || product.affiliate_url || '') : '';
  const displayName = product ? cleanPacketLabel(product) : '';
  return {
    affiliate: product ? 'yes - ' + displayName : 'no',
    trackedUrl,
    selectedProductName: displayName,
    reason: draft.reason || '',
    safety: draft.safety || 'skip'
  };
}
function copyBlock(label, text) {
  return [label + ':', clip(text, 1200)].join('\n');
}

const reddit = draftFields(data.reddit, data.redditDraft);
const quora = draftFields(data.quora, data.quoraDraft);
const redditHasResource = /Helpful resource:/i.test(String(data.redditDraft.text || ''));
const quoraHasResource = /Helpful resource:/i.test(String(data.quoraDraft.text || ''));

const redditMessage = message([
  'Sarah Nutri Reddit manual post',
  'Subreddit: ' + (data.reddit.subreddit ? 'r/' + data.reddit.subreddit : 'unknown subreddit'),
  'Question: ' + data.reddit.title,
  'URL: ' + sourceUrlDisplay(data.reddit, data.reddit.urlCheck),
  'URL check: ' + urlSummary(data.reddit.urlCheck),
  'Safety: ' + reddit.safety,
  'Affiliate: ' + reddit.affiliate,
  'Reason: ' + reddit.reason,
  '',
  copyBlock('Copy/paste reply', data.redditDraft.text),
  !redditHasResource && reddit.trackedUrl ? 'Helpful resource: ' + reddit.selectedProductName + ' - ' + reddit.trackedUrl : '',
  !redditHasResource && reddit.trackedUrl ? 'Disclosure: ' + data.config.default_disclosure : ''
]);

const quoraMessage = message([
  'Sarah Nutri Quora manual post',
  'Question: ' + data.quora.title,
  'URL: ' + sourceUrlDisplay(data.quora, data.quora.urlCheck),
  'URL check: ' + urlSummary(data.quora.urlCheck),
  'Safety: ' + quora.safety,
  'Affiliate: ' + quora.affiliate,
  'Reason: ' + quora.reason,
  '',
  copyBlock('Copy/paste answer', data.quoraDraft.text),
  !quoraHasResource && quora.trackedUrl ? 'Helpful resource: ' + quora.selectedProductName + ' - ' + quora.trackedUrl : '',
  !quoraHasResource && quora.trackedUrl ? 'Disclosure: ' + data.config.default_disclosure : ''
]);

const telegramRedditMessage = message([
  'Sarah Nutri Reddit',
  data.reddit.title,
  'Post: ' + (data.reddit.url || 'manual/source search'),
  'Tracked link: ' + (reddit.trackedUrl || 'none'),
  'Paste: ' + clip(data.redditDraft.text, 600)
]);

const telegramQuoraMessage = message([
  'Sarah Nutri Quora',
  data.quora.title,
  'Post: ' + (data.quora.url || 'manual/source search'),
  'Tracked link: ' + (quora.trackedUrl || 'none'),
  'Paste: ' + clip(data.quoraDraft.text, 750)
]);

return [
  { json: { ok: true, platform: 'reddit', discordMessage: redditMessage, telegramMessage: telegramRedditMessage, candidate: data.reddit, draft: data.redditDraft } },
  { json: { ok: true, platform: 'quora', discordMessage: quoraMessage, telegramMessage: telegramQuoraMessage, candidate: data.quora, draft: data.quoraDraft } }
];`;
}

function buildForumWorkflow() {
  return {
    name: 'Sarah Nutri - Forum Manual Queue -> Discord Review',
    nodes: [
      node('manual-trigger', 'Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, [-980, 40], { notice: '' }),
      node('forum-intake-webhook', 'Forum Intake Webhook', 'n8n-nodes-base.webhook', 1, [-980, -160], {
        httpMethod: 'POST',
        path: 'sarah-nutri-forum-candidates',
        responseMode: 'lastNode',
        responseData: 'firstEntryJson',
        options: {}
      }, { webhookId: 'sarah-nutri-forum-candidates' }),
      node('normalize-pair', 'Normalize Candidate Pair', 'n8n-nodes-base.code', 2, [-720, -60], {
        jsCode: buildNormalizePairJs()
      }),
      node('check-forum-links', 'Check Forum Links', 'n8n-nodes-base.httpRequest', 4.1, [-500, -220], {
        method: 'GET',
        url: `={{ ${JSON.stringify(forumLinkHealthUrl + '/forum-link-checks')} + '?reddit_url=' + encodeURIComponent($json.reddit?.url || '') + '&quora_url=' + encodeURIComponent($json.quora?.url || '') }}`,
        authentication: 'none',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'accept', value: 'application/json' }
          ]
        },
        options: {
          timeout: 30000,
          response: {
            response: {
              neverError: true
            }
          }
        }
      }),
      node('merge-link-checks', 'Merge Link Checks', 'n8n-nodes-base.code', 2, [-280, -60], {
        jsCode: buildMergeLinkChecksJs()
      }),
      node('build-reddit-prompt', 'Build Reddit Prompt', 'n8n-nodes-base.code', 2, [-480, -60], {
        jsCode: buildRedditPromptJs()
      }),
      node('bonsai-reddit-draft', 'Bonsai Reddit Draft', '@n8n/n8n-nodes-langchain.chainLlm', 1.4, [-240, -60], {
        notice: '',
        promptType: 'define',
        text: '={{ $json.redditPrompt }}',
        hasOutputParser: false,
        needsFallback: false,
        messages: {}
      }),
      node('bonsai-model-reddit', 'Bonsai Model Reddit', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [-320, 140], {
        model: { mode: 'id', value: 'bonsai-8b' },
        options: {}
      }, { credentials: bonsaiCredential }),
      node('parse-reddit-draft', 'Parse Reddit Draft', 'n8n-nodes-base.code', 2, [0, -60], {
        jsCode: buildParseRedditJs()
      }),
      node('build-quora-prompt', 'Build Quora Prompt', 'n8n-nodes-base.code', 2, [240, -60], {
        jsCode: buildQuoraPromptJs()
      }),
      node('bonsai-quora-draft', 'Bonsai Quora Draft', '@n8n/n8n-nodes-langchain.chainLlm', 1.4, [480, -60], {
        notice: '',
        promptType: 'define',
        text: '={{ $json.quoraPrompt }}',
        hasOutputParser: false,
        needsFallback: false,
        messages: {}
      }),
      node('bonsai-model-quora', 'Bonsai Model Quora', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [400, 140], {
        model: { mode: 'id', value: 'bonsai-8b' },
        options: {}
      }, { credentials: bonsaiCredential }),
      node('parse-quora-draft', 'Parse Quora Draft', 'n8n-nodes-base.code', 2, [720, -60], {
        jsCode: buildParseQuoraJs()
      }),
      node('build-discord-packets', 'Build Discord Packets', 'n8n-nodes-base.code', 2, [960, -60], {
        jsCode: buildDiscordPacketsJs()
      }),
      node('prepare-telegram-review', 'Prepare Telegram Review', 'n8n-nodes-base.code', 2, [1040, 100], {
        jsCode: `const token = String($env.TELEGRAM_BOT_TOKEN || '').trim();
const chatId = String($env.TELEGRAM_CHAT_ID || '').trim();
if (!token || !chatId) return [];
return $input.all().map((item) => ({
  json: {
    ...item.json,
    telegramBotToken: token,
    telegramChatId: chatId,
    telegramMessage: String(item.json.telegramMessage || item.json.discordMessage || '').trim()
  }
}));`
      }),
      node('telegram-notify', 'Telegram Notify', 'n8n-nodes-base.httpRequest', 4.1, [1260, 100], {
        method: 'POST',
        url: '={{ "https://api.telegram.org/bot" + $json.telegramBotToken + "/sendMessage" }}',
        authentication: 'none',
        provideSslCertificates: false,
        sendQuery: false,
        sendHeaders: false,
        sendBody: true,
        contentType: 'raw',
        rawContentType: 'application/json',
        body: '={{ JSON.stringify({ chat_id: $json.telegramChatId, text: $json.telegramMessage, disable_web_page_preview: false }) }}',
        options: {},
        infoMessage: ''
      }),
      node('discord-notify', 'Discord Notify', 'n8n-nodes-base.discord', 2, [1200, -60], {
        authentication: 'webhook',
        operation: 'sendLegacy',
        content: '={{ $json.discordMessage }}',
        options: {},
        embeds: {},
        files: {}
      }, { credentials: discordCredential, webhookId: 'sarah-discord-forum-manual-queue' }),
    ],
    connections: {
      'Manual Trigger': { main: [[{ node: 'Normalize Candidate Pair', type: 'main', index: 0 }]] },
      'Forum Intake Webhook': { main: [[{ node: 'Normalize Candidate Pair', type: 'main', index: 0 }]] },
      'Normalize Candidate Pair': { main: [[{ node: 'Check Forum Links', type: 'main', index: 0 }]] },
      'Check Forum Links': { main: [[{ node: 'Merge Link Checks', type: 'main', index: 0 }]] },
      'Merge Link Checks': { main: [[{ node: 'Build Reddit Prompt', type: 'main', index: 0 }]] },
      'Build Reddit Prompt': { main: [[{ node: 'Bonsai Reddit Draft', type: 'main', index: 0 }]] },
      'Bonsai Model Reddit': { ai_languageModel: [[{ node: 'Bonsai Reddit Draft', type: 'ai_languageModel', index: 0 }]] },
      'Bonsai Reddit Draft': { main: [[{ node: 'Parse Reddit Draft', type: 'main', index: 0 }]] },
      'Parse Reddit Draft': { main: [[{ node: 'Build Quora Prompt', type: 'main', index: 0 }]] },
      'Build Quora Prompt': { main: [[{ node: 'Bonsai Quora Draft', type: 'main', index: 0 }]] },
      'Bonsai Model Quora': { ai_languageModel: [[{ node: 'Bonsai Quora Draft', type: 'ai_languageModel', index: 0 }]] },
      'Bonsai Quora Draft': { main: [[{ node: 'Parse Quora Draft', type: 'main', index: 0 }]] },
      'Parse Quora Draft': { main: [[{ node: 'Build Discord Packets', type: 'main', index: 0 }]] },
      'Build Discord Packets': { main: [[{ node: 'Discord Notify', type: 'main', index: 0 }], [{ node: 'Prepare Telegram Review', type: 'main', index: 0 }]] },
      'Prepare Telegram Review': { main: [[{ node: 'Telegram Notify', type: 'main', index: 0 }]] }
    },
    settings: { callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
    staticData: null,
    pinData: null
  };
}

const workflow = buildForumWorkflow();
fs.writeFileSync('workflow_sarah_nutri_forum_manual_queue.json', JSON.stringify(workflow, null, 2) + '\n');
console.log('Wrote workflow_sarah_nutri_forum_manual_queue.json');
