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
const trackedAffiliateUrls = Object.fromEntries((dubLinks.links || []).map((link) => [link.product_slug, link.shortLink || link.url]));
const pipelineConfig = JSON.parse(fs.readFileSync('content_factory/reddit_quora/config.json', 'utf8'));
const redditPrompt = fs.readFileSync('content_factory/reddit_quora/prompts/reddit_reply_system.md', 'utf8');
const quoraPrompt = fs.readFileSync('content_factory/reddit_quora/prompts/quora_reply_system.md', 'utf8');

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

async function validateThreadUrl(url, platform) {
  const value = normalizeUrl(url);
  if (!value) return { live: false, status: 'missing', finalUrl: '', reason: 'missing_url', platform };
  if (typeof fetch !== 'function') {
    return { live: false, status: 'unavailable', finalUrl: value, reason: 'fetch_not_available', platform };
  }

  const deadPhrases = [
    'thread not found',
    'post not found',
    'page not found',
    'content not found',
    'removed',
    'deleted',
    'sorry, this page is unavailable',
    'not available',
    'quora not found',
    'reddit thread not found'
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const headers = {
    'user-agent': 'Mozilla/5.0 (compatible; SarahNutriBot/1.0)',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  try {
    const response = await fetch(value, { method: 'GET', redirect: 'follow', signal: controller.signal, headers });
    const text = await response.text().catch(() => '');
    const haystack = [response.status, response.url, text.slice(0, 4000), value].join(' ').toLowerCase();
    const deadPhrase = deadPhrases.find((phrase) => haystack.includes(phrase)) || '';
    if (!response.ok || deadPhrase) {
      return {
        live: false,
        status: response.status,
        finalUrl: response.url || value,
        reason: deadPhrase || 'http_' + response.status,
        platform
      };
    }
    return {
      live: true,
      status: response.status,
      finalUrl: response.url || value,
      reason: 'reachable',
      platform
    };
  } catch (error) {
    return {
      live: false,
      status: 0,
      finalUrl: value,
      reason: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
      platform
    };
  } finally {
    clearTimeout(timer);
  }
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
const [redditUrlCheck, quoraUrlCheck] = await Promise.all([
  validateThreadUrl(reddit.url, 'reddit'),
  validateThreadUrl(quora.url, 'quora')
]);
const redditWithCheck = { ...reddit, urlCheck: redditUrlCheck };
const quoraWithCheck = { ...quora, urlCheck: quoraUrlCheck };

return [{
  json: {
    brand: config.brand,
    config,
    products,
    trackedAffiliateUrls,
    reddit: redditWithCheck,
    quora: quoraWithCheck,
    redditProducts: rankProductsForCandidate(redditWithCheck),
    quoraProducts: rankProductsForCandidate(quoraWithCheck),
    intakeNotes: String(body.notes || '').trim()
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
function productMentioned(product, text) {
  const normalizedText = normalize(text);
  const productName = normalize(product.name).replace(/ bottles?\\b/g, '').trim();
  if (productName && normalizedText.includes(productName)) return true;
  return (product.match_keywords || [])
    .filter((keyword) => String(keyword).length > 4)
    .some((keyword) => normalizedText.includes(normalize(keyword)));
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
const products = source.products || [];
const urlCheck = source.reddit.urlCheck || {};
let text = String(parsed.reply || '').trim();
let safety = normalizeSafety(parsed.safety, text);
const topicText = [source.reddit.title, source.reddit.body, source.reddit.url].join(' ');

if (urlCheck.live === false) {
  safety = 'skip';
  text = 'Thread no longer reachable. Pick a live Reddit post before drafting a reply.';
}

if (safety === 'emergency' && !hasExplicitEmergency(topicText) && /tinnitus|ringing ears|ear ringing|night ringing/i.test(topicText)) {
  safety = 'answer';
}

let product = products.find((p) => p.slug === parsed.selected_product_slug && p.affiliate_url) || null;
if (!product) product = products.find((p) => p.affiliate_url && productMentioned(p, text)) || null;

const allowProduct = safety === 'answer' && product && text.length > 80 && (parsed.affiliate_allowed === true || productMentioned(product, text));
const trackedUrl = product ? (source.trackedAffiliateUrls?.[product.slug] || product.affiliate_url) : '';
if (allowProduct && trackedUrl && !text.includes(trackedUrl)) {
  text += '\\n\\nHelpful resource: ' + product.name + ' - ' + trackedUrl;
  text += '\\n' + source.config.default_disclosure;
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
      selectedProductName: product ? product.name : '',
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
function productMentioned(product, text) {
  const normalizedText = normalize(text);
  const productName = normalize(product.name).replace(/ bottles?\\b/g, '').trim();
  if (productName && normalizedText.includes(productName)) return true;
  return (product.match_keywords || [])
    .filter((keyword) => String(keyword).length > 4)
    .some((keyword) => normalizedText.includes(normalize(keyword)));
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
const products = source.products || [];
const urlCheck = source.quora.urlCheck || {};
let text = String(parsed.answer || '').trim();
let safety = normalizeSafety(parsed.safety, text);
const topicText = [source.quora.title, source.quora.body, source.quora.url].join(' ');

if (urlCheck.live === false) {
  safety = 'skip';
  text = 'Thread no longer reachable. Pick a live Quora question before drafting an answer.';
}

if (safety === 'emergency' && !hasExplicitEmergency(topicText) && /tinnitus|ringing ears|ear ringing|night ringing/i.test(topicText)) {
  safety = 'answer';
}

let product = products.find((p) => p.slug === parsed.selected_product_slug && p.affiliate_url) || null;
if (!product) product = products.find((p) => p.affiliate_url && productMentioned(p, text)) || null;

const allowProduct = safety === 'answer' && product && text.length > 80 && (parsed.affiliate_allowed === true || productMentioned(product, text));
const trackedUrl = product ? (source.trackedAffiliateUrls?.[product.slug] || product.affiliate_url) : '';
if (allowProduct && trackedUrl && !text.includes(trackedUrl)) {
  text += '\\n\\nHelpful resource: ' + product.name + ' - ' + trackedUrl;
  text += '\\n' + source.config.default_disclosure;
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
      selectedProductName: product ? product.name : '',
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
  const status = check.live ? 'live' : 'dead';
  const reason = check.reason ? ' (' + check.reason + ')' : '';
  return status + reason;
}

const redditMessage = [
  'Sarah Nutri Reddit review',
  '',
  (data.reddit.subreddit ? 'r/' + data.reddit.subreddit : 'unknown subreddit'),
  data.reddit.title,
  'URL: ' + (data.reddit.url || 'manual/source search'),
  'URL check: ' + urlSummary(data.reddit.urlCheck),
  'Safety: ' + data.redditDraft.safety,
  'Affiliate: ' + (data.redditDraft.affiliateAllowed ? 'yes - ' + data.redditDraft.selectedProductName : 'no'),
  'Reason: ' + data.redditDraft.reason,
  '',
  'Reply:',
  clip(data.redditDraft.text, 700)
].join('\\n');

const quoraMessage = [
  'Sarah Nutri Quora review',
  '',
  data.quora.title,
  'URL: ' + (data.quora.url || 'manual/source search'),
  'URL check: ' + urlSummary(data.quora.urlCheck),
  'Safety: ' + data.quoraDraft.safety,
  'Affiliate: ' + (data.quoraDraft.affiliateAllowed ? 'yes - ' + data.quoraDraft.selectedProductName : 'no'),
  'Reason: ' + data.quoraDraft.reason,
  '',
  'Answer:',
  clip(data.quoraDraft.text, 900)
].join('\\n');

const telegramRedditMessage = [
  'Sarah Nutri Reddit',
  data.reddit.title,
  'Post: ' + (data.reddit.url || 'manual/source search'),
  'Tracked link: ' + (data.redditDraft.affiliateAllowed ? firstUrl(data.redditDraft.text) || 'none' : 'none'),
  'Paste: ' + clip(data.redditDraft.text, 600)
].join('\\n');

const telegramQuoraMessage = [
  'Sarah Nutri Quora',
  data.quora.title,
  'Post: ' + (data.quora.url || 'manual/source search'),
  'Tracked link: ' + (data.quoraDraft.affiliateAllowed ? firstUrl(data.quoraDraft.text) || 'none' : 'none'),
  'Paste: ' + clip(data.quoraDraft.text, 750)
].join('\\n');

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
      'Normalize Candidate Pair': { main: [[{ node: 'Build Reddit Prompt', type: 'main', index: 0 }]] },
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
