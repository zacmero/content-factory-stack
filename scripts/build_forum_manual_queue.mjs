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

const workflow = {
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
      jsCode: `const config = ${JSON.stringify(pipelineConfig, null, 2)};\nconst products = ${JSON.stringify(productCatalog.products, null, 2)};\nconst body = $json.body || $json || {};\nconst defaultReddit = {\n  platform: 'reddit',\n  title: 'Caregiver asking how to help an older parent eat enough protein',\n  body: 'My elderly mother has very little appetite and I am worried she is losing strength. What are simple ways to help without making meals complicated?',\n  url: '',\n  subreddit: 'AgingParents'\n};\nconst defaultQuora = {\n  platform: 'quora',\n  title: 'What are easy nutrition habits that help elderly people keep their strength?',\n  body: 'Looking for practical advice for older adults who do not eat much and get tired easily.',\n  url: ''\n};\nfunction cleanCandidate(input, fallback, platform) {\n  const value = input && typeof input === 'object' ? input : fallback;\n  return {\n    platform,\n    title: String(value.title || fallback.title || '').trim(),\n    body: String(value.body || value.text || fallback.body || '').trim(),\n    url: String(value.url || value.permalink || '').trim(),\n    subreddit: String(value.subreddit || '').trim()\n  };\n}\nfunction normalize(text) {\n  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();\n}\nfunction tokenize(text) {\n  return normalize(text)\n    .split(' ')\n    .filter((token) => token.length > 2 && !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have'].includes(token));\n}\nfunction scoreProductForCandidate(product, candidate) {\n  const haystack = normalize([candidate.title, candidate.body, candidate.subreddit, candidate.url].join(' '));\n  const tokens = new Set(tokenize(haystack));\n  const keywordHits = [];\n  let score = 0;\n  const family = normalize(product.family_name || product.name || '');\n  if (family && haystack.includes(family)) {\n    score += 6;\n    keywordHits.push(product.family_name || product.name);\n  }\n  for (const keyword of product.match_keywords || []) {\n    const normalizedKeyword = normalize(keyword);\n    if (!normalizedKeyword) continue;\n    const keywordTokens = tokenize(normalizedKeyword);\n    const fullPhraseHit = normalizedKeyword.length > 4 && haystack.includes(normalizedKeyword);\n    const tokenHit = keywordTokens.length > 0 && keywordTokens.every((token) => tokens.has(token));\n    if (fullPhraseHit || tokenHit) {\n      score += normalizedKeyword.split(' ').length > 1 ? 4 : 2;\n      keywordHits.push(keyword);\n    }\n  }\n  const catalogScore = Number(product.total_score || product.score_breakdown?.total || 0);\n  return {\n    ...product,\n    question_match_score: Number((score + catalogScore * 0.5).toFixed(4)),\n    question_match_hits: [...new Set(keywordHits)].slice(0, 8)\n  };\n}\nfunction rankProductsForCandidate(candidate) {\n  return (products || [])\n    .filter((product) => product.affiliate_url)\n    .map((product) => scoreProductForCandidate(product, candidate))\n    .sort((a, b) => {\n      const matchDelta = (b.question_match_score || 0) - (a.question_match_score || 0);\n      if (matchDelta) return matchDelta;\n      return Number(b.total_score || 0) - Number(a.total_score || 0);\n    })\n    .slice(0, 8);\n}\nconst reddit = cleanCandidate(body.reddit, defaultReddit, 'reddit');\nconst quora = cleanCandidate(body.quora, defaultQuora, 'quora');\nreturn [{ json: { brand: config.brand, config, products, trackedAffiliateUrls, reddit, quora, redditProducts: rankProductsForCandidate(reddit), quoraProducts: rankProductsForCandidate(quora), intakeNotes: String(body.notes || '').trim() } }];`
    }),
    node('build-reddit-prompt', 'Build Reddit Prompt', 'n8n-nodes-base.code', 2, [-480, -60], {
      jsCode: `const products = ($json.redditProducts || $json.products || []).filter((p) => p.affiliate_url).map((p) => ({ slug: p.slug, name: p.name, match_keywords: p.match_keywords, question_match_score: p.question_match_score, question_match_hits: p.question_match_hits, use_when: p.use_when, avoid_when: p.avoid_when, affiliate_url: p.affiliate_url, source: p.source || 'manual_catalog' }));\nconst question = $json.reddit;\nconst prompt = ${JSON.stringify(redditPrompt)} + '\\n\\nManual posting mode: draft one copy/paste-ready Reddit comment. Be brief and human. Use 1 short paragraph or 2 short sentences max. Keep it under 90 words. Do not mention automation. Do not lead with the product. Do not use numbered lists or \"here are five tips\" language. If the product fits, mention it once at the end in one short sentence. If you include an affiliate link, include the disclosure. Product selection rule: question relevance comes first. The catalog below is pre-ranked for this question; use score only as a tiebreaker among clearly relevant products.\\n\\nReddit question context:\\n' + JSON.stringify(question, null, 2) + '\\n\\nPre-ranked product shortlist for this question:\\n' + JSON.stringify(products, null, 2) + '\\n\\nReturn strict JSON only.';\nreturn [{ json: { ...$json, products, redditPrompt: prompt } }];`
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
      jsCode: `const source = $node['Build Reddit Prompt'].json;\nconst raw = String($json.text || '').trim();\nfunction parseJson(text) {\n  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);\n  const body = fenced ? fenced[1] : text;\n  const first = body.indexOf('{');\n  const last = body.lastIndexOf('}');\n  if (first < 0 || last < first) throw new Error('Bonsai Reddit draft was not JSON: ' + text.slice(0, 300));
  function repairJson(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (const ch of text) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = !inString;
        continue;
      }
      if (inString && (ch === '\n' || ch === '\r')) {
        out += '\\n';
        continue;
      }
      out += ch;
    }
    return out;
  }
  return JSON.parse(repairJson(body.slice(first, last + 1)));\n}\nfunction normalize(text) {\n  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();\n}\nfunction normalizeSafety(value, text) {\n  const safety = String(value || '').toLowerCase();\n  if (['answer', 'human_review', 'emergency', 'skip'].includes(safety)) return safety;\n  if (safety.includes('emergency')) return 'emergency';\n  if (safety.includes('human')) return 'human_review';\n  if (safety.includes('skip')) return 'skip';\n  return String(text || '').trim() ? 'answer' : 'human_review';\n}\nfunction productMentioned(product, text) {\n  const normalizedText = normalize(text);\n  const productName = normalize(product.name).replace(/ bottles?\\b/g, '').trim();\n  if (productName && normalizedText.includes(productName)) return true;\n  return (product.match_keywords || [])\n    .filter((keyword) => String(keyword).length > 4)\n    .some((keyword) => normalizedText.includes(normalize(keyword)));\n}\nfunction finalize(parsed, textKey) {\n  const products = source.products || [];\n  let text = String(parsed[textKey] || '').trim();\n  const safety = normalizeSafety(parsed.safety, text);\n  let product = products.find((p) => p.slug === parsed.selected_product_slug && p.affiliate_url) || null;\n  if (!product) product = products.find((p) => p.affiliate_url && productMentioned(p, text)) || null;\n  const allowProduct = safety === 'answer' && product && text.length > 50 && (parsed.affiliate_allowed === true || productMentioned(product, text));\n  const trackedUrl = source.trackedAffiliateUrls?.[product.slug] || product.affiliate_url;\n  if (allowProduct && !text.includes(trackedUrl)) {\n    text += '\\n\\nHelpful resource: ' + product.name + ' - ' + trackedUrl;\n    text += '\\n' + source.config.default_disclosure;\n  }\n  return { text, safety, product, affiliateAllowed: Boolean(allowProduct) };\n}\nconst parsed = parseJson(raw);\nconst final = finalize(parsed, 'reply');\nreturn [{ json: { ...source, redditDraft: { raw, text: final.text, safety: final.safety, affiliateAllowed: final.affiliateAllowed, selectedProductSlug: final.product ? final.product.slug : '', selectedProductName: final.product ? final.product.name : '', reason: parsed.reason || '' } } }];`
    }),
    node('build-quora-prompt', 'Build Quora Prompt', 'n8n-nodes-base.code', 2, [240, -60], {
      jsCode: `const products = ($json.quoraProducts || $json.products || []).filter((p) => p.affiliate_url).map((p) => ({ slug: p.slug, name: p.name, match_keywords: p.match_keywords, question_match_score: p.question_match_score, question_match_hits: p.question_match_hits, use_when: p.use_when, avoid_when: p.avoid_when, affiliate_url: p.affiliate_url, source: p.source || 'manual_catalog' }));\nconst question = $json.quora;\nconst prompt = ${JSON.stringify(quoraPrompt)} + '\\n\\nManual posting mode: draft one copy/paste-ready Quora answer. Be brief and human. Use 2 short paragraphs max or 3 short bullets max. Keep it under 120 words. Do not mention automation. Do not mention a product by name unless you set selected_product_slug to that exact product slug. If you include an affiliate link, include the disclosure in one short closing sentence. Product selection rule: question relevance comes first. The catalog below is pre-ranked for this question; use score only as a tiebreaker among clearly relevant products. Do not label ordinary tinnitus/ringing-ears sleep questions as emergencies unless the question includes a real emergency symptom from the block list.\\n\\nQuora question context:\\n' + JSON.stringify(question, null, 2) + '\\n\\nPre-ranked product shortlist for this question:\\n' + JSON.stringify(products, null, 2) + '\\n\\nReturn strict JSON only.';\nreturn [{ json: { ...$json, products, quoraPrompt: prompt } }];`
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
      jsCode: `const source = $node['Build Quora Prompt'].json;\nconst raw = String($json.text || '').trim();\nfunction parseJson(text) {\n  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);\n  const body = fenced ? fenced[1] : text;\n  const first = body.indexOf('{');\n  const last = body.lastIndexOf('}');\n  if (first < 0 || last < first) throw new Error('Bonsai Quora draft was not JSON: ' + text.slice(0, 300));
  function repairJson(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (const ch of text) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = !inString;
        continue;
      }
      if (inString && (ch === '\n' || ch === '\r')) {
        out += '\\n';
        continue;
      }
      out += ch;
    }
    return out;
  }
  return JSON.parse(repairJson(body.slice(first, last + 1)));\n}\nfunction normalize(text) {\n  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();\n}\nfunction normalizeSafety(value, text) {\n  const safety = String(value || '').toLowerCase();\n  if (['answer', 'human_review', 'emergency', 'skip'].includes(safety)) return safety;\n  if (safety.includes('emergency')) return 'emergency';\n  if (safety.includes('human')) return 'human_review';\n  if (safety.includes('skip')) return 'skip';\n  return String(text || '').trim() ? 'answer' : 'human_review';\n}\nfunction productMentioned(product, text) {\n  const normalizedText = normalize(text);\n  const productName = normalize(product.name).replace(/ bottles?\\b/g, '').trim();\n  if (productName && normalizedText.includes(productName)) return true;\n  return (product.match_keywords || [])\n    .filter((keyword) => String(keyword).length > 4)\n    .some((keyword) => normalizedText.includes(normalize(keyword)));\n}\nfunction hasExplicitEmergency(text) {\n  const normalizedText = normalize(text);\n  return (source.config.safety.block_if_contains || []).some((term) => normalizedText.includes(normalize(term)));\n}\nconst parsed = parseJson(raw);\nconst products = source.products || [];\nlet text = String(parsed.answer || '').trim();\nlet safety = normalizeSafety(parsed.safety, text);\nconst topicText = [source.quora.title, source.quora.body, source.quora.url].join(' ');
if (safety === 'emergency' && !hasExplicitEmergency(topicText) && /tinnitus|ringing ears|ear ringing|night ringing/i.test(topicText)) {
  safety = 'answer';
}\nlet product = products.find((p) => p.slug === parsed.selected_product_slug && p.affiliate_url) || null;\nif (!product) product = products.find((p) => p.affiliate_url && productMentioned(p, text)) || null;\nconst allowProduct = safety === 'answer' && product && text.length > 80 && (parsed.affiliate_allowed === true || productMentioned(product, text));\nconst trackedUrl = source.trackedAffiliateUrls?.[product.slug] || product.affiliate_url;\nif (allowProduct && !text.includes(trackedUrl)) {\n  text += '\\n\\nHelpful resource: ' + product.name + ' - ' + trackedUrl;\n  text += '\\n' + source.config.default_disclosure;\n}\nreturn [{ json: { ...source, quoraDraft: { raw, text, safety, affiliateAllowed: Boolean(allowProduct), selectedProductSlug: product ? product.slug : '', selectedProductName: product ? product.name : '', reason: parsed.reason || '' } } }];`
    }),
    node('build-discord-packets', 'Build Discord Packets', 'n8n-nodes-base.code', 2, [960, -60], {
      jsCode: `const data = $json;\nfunction clip(text, limit) {\n  const value = String(text || '');\n  return value.length > limit ? value.slice(0, limit - 3) + '...' : value;\n}\nfunction firstUrl(text) {\n  const match = String(text || '').match(/https?:\/\/\S+/);\n  return match ? match[0] : '';\n}\nconst redditMessage = [\n  'Sarah Nutri Reddit review',\n  '',\n  (data.reddit.subreddit ? 'r/' + data.reddit.subreddit : 'unknown subreddit'),\n  data.reddit.title,\n  'URL: ' + (data.reddit.url || 'manual/source search'),\n  'Safety: ' + data.redditDraft.safety,\n  'Affiliate: ' + (data.redditDraft.affiliateAllowed ? 'yes - ' + data.redditDraft.selectedProductName : 'no'),\n  'Reason: ' + data.redditDraft.reason,\n  '',\n  'Reply:',\n  clip(data.redditDraft.text, 700)\n].join('\\n');\nconst quoraMessage = [\n  'Sarah Nutri Quora review',\n  '',\n  data.quora.title,\n  'URL: ' + (data.quora.url || 'manual/source search'),\n  'Safety: ' + data.quoraDraft.safety,\n  'Affiliate: ' + (data.quoraDraft.affiliateAllowed ? 'yes - ' + data.quoraDraft.selectedProductName : 'no'),\n  'Reason: ' + data.quoraDraft.reason,\n  '',\n  'Answer:',\n  clip(data.quoraDraft.text, 900)\n].join('\\n');\nconst telegramRedditMessage = [\n  'Sarah Nutri Reddit',\n  data.reddit.title,\n  'Post: ' + (data.reddit.url || 'manual/source search'),\n  'Tracked link: ' + (data.redditDraft.affiliateAllowed ? firstUrl(data.redditDraft.text) || 'none' : 'none'),\n  'Paste: ' + clip(data.redditDraft.text, 600)\n].join('\\n');\nconst telegramQuoraMessage = [\n  'Sarah Nutri Quora',\n  data.quora.title,\n  'Post: ' + (data.quora.url || 'manual/source search'),\n  'Tracked link: ' + (data.quoraDraft.affiliateAllowed ? firstUrl(data.quoraDraft.text) || 'none' : 'none'),\n  'Paste: ' + clip(data.quoraDraft.text, 750)\n].join('\\n');\nreturn [\n  { json: { ok: true, platform: 'reddit', discordMessage: redditMessage, telegramMessage: telegramRedditMessage, candidate: data.reddit, draft: data.redditDraft } },\n  { json: { ok: true, platform: 'quora', discordMessage: quoraMessage, telegramMessage: telegramQuoraMessage, candidate: data.quora, draft: data.quoraDraft } }\n];`,
    }),
    node('prepare-telegram-review', 'Prepare Telegram Review', 'n8n-nodes-base.code', 2, [1040, 100], {
      jsCode: `const token = String($env.TELEGRAM_BOT_TOKEN || '').trim();\nconst chatId = String($env.TELEGRAM_CHAT_ID || '').trim();\nif (!token || !chatId) return [];\nreturn $input.all().map((item) => ({\n  json: {\n    ...item.json,\n    telegramBotToken: token,\n    telegramChatId: chatId,\n    telegramMessage: String(item.json.telegramMessage || item.json.discordMessage || '').trim()\n  }\n}));`
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

fs.writeFileSync('workflow_sarah_nutri_forum_manual_queue.json', JSON.stringify(workflow, null, 2) + '\n');
console.log('Wrote workflow_sarah_nutri_forum_manual_queue.json');
