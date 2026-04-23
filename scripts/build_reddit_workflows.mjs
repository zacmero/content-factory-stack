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
const pipelineConfig = JSON.parse(fs.readFileSync('content_factory/reddit_quora/config.json', 'utf8'));
const redditPrompt = fs.readFileSync('content_factory/reddit_quora/prompts/reddit_reply_system.md', 'utf8');
const quoraPrompt = fs.readFileSync('content_factory/reddit_quora/prompts/quora_reply_system.md', 'utf8');

const mainWorkflow = {
  name: 'Sarah Nutri - Reddit Research -> Discord Review',
  nodes: [
    node('manual-trigger', 'Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, [-1240, 40], { notice: '' }),
    node('schedule-trigger', 'Daily Schedule', 'n8n-nodes-base.scheduleTrigger', 1.2, [-1240, -160], {
      rule: { interval: [{ field: 'hours', hoursInterval: 6 }] }
    }),
    node('api-trigger', 'API Trigger', 'n8n-nodes-base.webhook', 1, [-1240, 240], {
      httpMethod: 'GET',
      path: 'sarah-nutri-reddit-run',
      responseMode: 'lastNode',
      responseData: 'firstEntryJson',
      options: {}
    }, { webhookId: 'sarah-nutri-reddit-run' }),
    node('build-config', 'Build Config', 'n8n-nodes-base.code', 2, [-1000, 40], {
      jsCode: `const config = ${JSON.stringify(pipelineConfig, null, 2)};\nconst catalog = ${JSON.stringify(productCatalog.products, null, 2)};\nreturn [{ json: { ...config, products: catalog } }];`
    }),
    node('build-reddit-auth', 'Build Reddit Auth', 'n8n-nodes-base.code', 2, [-760, 40], {
      jsCode: `const clientId = $env.REDDIT_CLIENT_ID || '';\nconst clientSecret = $env.REDDIT_CLIENT_SECRET || '';\nconst refreshToken = $env.REDDIT_REFRESH_TOKEN || '';\nconst userAgent = $env.REDDIT_USER_AGENT || 'linux:content-factory-sarah-nutri:0.1.0 by /u/sarah_nutri';\nif (!clientId || !clientSecret || !refreshToken) {\n  throw new Error('Missing Reddit OAuth env vars: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN');\n}\nconst subredditQuery = ($json.reddit.target_subreddits || []).map((sub) => 'subreddit:' + sub).join(' OR ');\nconst redditSearchQuery = '(' + subredditQuery + ') ' + ($json.reddit.search_query || '');\nreturn [{ json: { ...$json, redditSearchQuery, redditBasicAuth: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'), redditRefreshToken: refreshToken, userAgent } }];`
    }),
    node('get-reddit-token', 'Get Reddit Token', 'n8n-nodes-base.httpRequest', 4.1, [-520, 40], {
      curlImport: '',
      method: 'POST',
      url: 'https://www.reddit.com/api/v1/access_token',
      authentication: 'none',
      provideSslCertificates: false,
      sendQuery: false,
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '={{ $json.redditBasicAuth }}' },
          { name: 'User-Agent', value: '={{ $json.userAgent }}' },
          { name: 'Content-Type', value: 'application/x-www-form-urlencoded' }
        ]
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/x-www-form-urlencoded',
      body: "={{ 'grant_type=refresh_token&refresh_token=' + encodeURIComponent($json.redditRefreshToken) }}",
      options: {},
      infoMessage: ''
    }),
    node('search-reddit', 'Search Reddit', 'n8n-nodes-base.httpRequest', 4.1, [-280, 40], {
      curlImport: '',
      method: 'GET',
      url: "={{ 'https://oauth.reddit.com/search?sort=new&t=day&limit=' + encodeURIComponent($node['Build Reddit Auth'].json.reddit.search_limit || 15) + '&q=' + encodeURIComponent($node['Build Reddit Auth'].json.redditSearchQuery || '') }}",
      authentication: 'none',
      provideSslCertificates: false,
      sendQuery: false,
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: "={{ 'Bearer ' + $json.access_token }}" },
          { name: 'User-Agent', value: "={{ $node['Build Reddit Auth'].json.userAgent }}" }
        ]
      },
      options: {},
      infoMessage: ''
    }),
    node('select-candidate', 'Select Candidate', 'n8n-nodes-base.code', 2, [-40, 40], {
      jsCode: `const config = $node['Build Reddit Auth'].json;\nconst children = (($input.first().json.data || {}).children || []).map((child) => child.data || {});\nconst blockedSubs = new Set((config.reddit.blocked_subreddits || []).map((s) => s.toLowerCase()));\nconst targetSubs = new Set((config.reddit.target_subreddits || []).map((s) => s.toLowerCase()));\nconst hardBlocks = (config.safety.block_if_contains || []).map((s) => s.toLowerCase());\nconst reviewTerms = (config.safety.requires_human_review || []).map((s) => s.toLowerCase());\nfunction score(post) {\n  const text = ((post.title || '') + ' ' + (post.selftext || '')).toLowerCase();\n  if (!post.name || post.over_18 || blockedSubs.has(String(post.subreddit || '').toLowerCase())) return -1;\n  if (!targetSubs.has(String(post.subreddit || '').toLowerCase())) return -1;\n  if (hardBlocks.some((term) => text.includes(term))) return -1;\n  let value = 0;\n  if (post.is_self) value += 3;\n  if ((post.selftext || '').length > 120) value += 3;\n  if (reviewTerms.some((term) => text.includes(term))) value -= 1;\n  if ((post.num_comments || 0) < 50) value += 1;\n  if ((post.score || 0) < 1000) value += 1;\n  return value;\n}\nconst ranked = children.map((post) => ({ post, score: score(post) })).filter((x) => x.score >= 0).sort((a, b) => b.score - a.score);\nif (!ranked.length) {\n  return [{ json: { hasCandidate: false, skipReason: 'No target Reddit questions passed filters this run.' } }];\n}\nconst p = ranked[0].post;\nreturn [{ json: {\n  hasCandidate: true,\n  platform: 'reddit',\n  redditThingId: p.name,\n  subreddit: p.subreddit,\n  title: p.title || '',\n  body: p.selftext || '',\n  author: p.author || '',\n  permalink: 'https://www.reddit.com' + (p.permalink || ''),\n  createdUtc: p.created_utc || null,\n  score: p.score || 0,\n  commentCount: p.num_comments || 0,\n  products: config.products,\n  affiliateLinkProbability: config.affiliate_link_probability,\n  dailyApprovedPostLimit: config.daily_approved_post_limit,\n  defaultDisclosure: config.default_disclosure,\n  safety: config.safety\n} }];`
    }),
    node('if-candidate', 'If Candidate?', 'n8n-nodes-base.if', 2.2, [200, 40], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'candidate-check',
            leftValue: '={{ $json.hasCandidate }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true }
          }
        ],
        combinator: 'and'
      },
      options: {}
    }),
    node('build-no-candidate-message', 'Build No Candidate Message', 'n8n-nodes-base.code', 2, [440, 180], {
      jsCode: `return [{ json: { ok: true, message: 'Sarah Nutri Reddit scan finished: ' + ($json.skipReason || 'No usable candidate found.') } }];`
    }),
    node('build-prompt', 'Build Prompt', 'n8n-nodes-base.code', 2, [440, -60], {
      jsCode: `const products = ($json.products || []).map((p) => ({ slug: p.slug, name: p.name, match_keywords: p.match_keywords, use_when: p.use_when, avoid_when: p.avoid_when, affiliate_url: p.affiliate_url }));\nconst randomGate = Math.random() < Number($json.affiliateLinkProbability || 0);\nconst prompt = ${JSON.stringify(redditPrompt)} + '\\n\\nReddit question context:\\n' + JSON.stringify({ subreddit: $json.subreddit, title: $json.title, body: $json.body, permalink: $json.permalink }, null, 2) + '\\n\\nProduct catalog:\\n' + JSON.stringify(products, null, 2) + '\\n\\nAffiliate link random gate for this run: ' + randomGate + '. If false, affiliate_allowed must be false even if a product fits. Disclosure text: ' + $json.defaultDisclosure;\nreturn [{ json: { ...$json, affiliateRandomGate: randomGate, prompt } }];`
    }),
    node('bonsai-draft', 'Bonsai Draft Reply', '@n8n/n8n-nodes-langchain.chainLlm', 1.4, [680, -60], {
      notice: '',
      promptType: 'define',
      text: '={{ $json.prompt }}',
      hasOutputParser: false,
      needsFallback: false,
      messages: {}
    }),
    node('bonsai-model', 'Bonsai Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [600, 140], {
      model: { mode: 'id', value: 'bonsai-8b' },
      options: {}
    }, { credentials: bonsaiCredential }),
    node('parse-draft', 'Parse Draft', 'n8n-nodes-base.code', 2, [920, -60], {
      jsCode: `const source = $node['Build Prompt'].json;\nconst raw = String($json.text || '').trim();\nfunction parseJson(text) {\n  const fenced = text.match(/\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\\`\\\`\\\`/i);\n  const body = fenced ? fenced[1] : text;\n  const first = body.indexOf('{');\n  const last = body.lastIndexOf('}');\n  if (first < 0 || last < first) throw new Error('Bonsai did not return JSON: ' + text.slice(0, 300));\n  return JSON.parse(body.slice(first, last + 1));\n}\nconst parsed = parseJson(raw);\nlet reply = String(parsed.reply || '').trim();\nconst product = (source.products || []).find((p) => p.slug === parsed.selected_product_slug) || null;\nconst allowProduct = parsed.affiliate_allowed === true && source.affiliateRandomGate === true && product && reply.length > 80 && parsed.safety === 'answer';\nif (allowProduct && !reply.includes(product.affiliate_url)) {\n  reply += '\\n\\nResource that may help: ' + product.name + ' - ' + product.affiliate_url;\n  reply += '\\n' + source.defaultDisclosure;\n}\nif (!allowProduct) {\n  parsed.affiliate_allowed = false;\n  parsed.selected_product_slug = null;\n}\nreturn [{ json: { ...source, draftRaw: raw, safetyDecision: parsed.safety || 'human_review', affiliateAllowed: parsed.affiliate_allowed === true, selectedProductSlug: parsed.selected_product_slug || '', selectedProductName: product ? product.name : '', replyText: reply, draftReason: parsed.reason || '' } }];`
    }),
    node('assemble-review', 'Assemble Review', 'n8n-nodes-base.set', 3.4, [1160, -60], {
      mode: 'manual',
      duplicateItem: false,
      assignments: {
        assignments: [
          { id: 'platform', name: 'platform', value: 'reddit', type: 'string' },
          { id: 'redditThingId', name: 'redditThingId', value: '={{ $json.redditThingId }}', type: 'string' },
          { id: 'subreddit', name: 'subreddit', value: '={{ $json.subreddit }}', type: 'string' },
          { id: 'title', name: 'title', value: '={{ $json.title }}', type: 'string' },
          { id: 'body', name: 'body', value: '={{ $json.body }}', type: 'string' },
          { id: 'permalink', name: 'permalink', value: '={{ $json.permalink }}', type: 'string' },
          { id: 'replyText', name: 'replyText', value: '={{ $json.replyText }}', type: 'string' },
          { id: 'safetyDecision', name: 'safetyDecision', value: '={{ $json.safetyDecision }}', type: 'string' },
          { id: 'affiliateAllowed', name: 'affiliateAllowed', value: '={{ $json.affiliateAllowed }}', type: 'boolean' },
          { id: 'selectedProductSlug', name: 'selectedProductSlug', value: '={{ $json.selectedProductSlug }}', type: 'string' },
          { id: 'draftReason', name: 'draftReason', value: '={{ $json.draftReason }}', type: 'string' },
          { id: 'dailyApprovedPostLimit', name: 'dailyApprovedPostLimit', value: '={{ $json.dailyApprovedPostLimit }}', type: 'number' },
          {
            id: 'discordMessage',
            name: 'discordMessage',
            value: "={{ `Sarah Nutri Reddit review\\n\\nSubreddit: r/${$json.subreddit}\\nQuestion: ${$json.title}\\nPost: <${$json.permalink}>\\nSafety: ${$json.safetyDecision}\\nAffiliate: ${$json.affiliateAllowed ? 'yes - ' + $json.selectedProductSlug : 'no'}\\nReason: ${$json.draftReason}\\n\\nDraft reply:\\n${($json.replyText || '').substring(0, 1400)}${($json.replyText || '').length > 1400 ? '...' : ''}\\n\\nApprove post:\\n<http://192.168.1.59:8080/webhook/sarah-nutri-reddit-approval?action=approve&executionId=${$execution.id}>\\n\\nReject:\\n<http://192.168.1.59:8080/webhook/sarah-nutri-reddit-approval?action=reject&executionId=${$execution.id}>` }}",
            type: 'string'
          }
        ]
      },
      includeOtherFields: false,
      options: {}
    }),
    node('discord-notify', 'Discord Notify', 'n8n-nodes-base.discord', 2, [1400, -60], {
      authentication: 'webhook',
      operation: 'sendLegacy',
      content: '={{ $json.discordMessage || $json.message }}',
      options: {},
      embeds: {},
      files: {}
    }, { credentials: discordCredential, webhookId: 'sarah-discord-reddit-main' })
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Build Config', type: 'main', index: 0 }]] },
    'Daily Schedule': { main: [[{ node: 'Build Config', type: 'main', index: 0 }]] },
    'API Trigger': { main: [[{ node: 'Build Config', type: 'main', index: 0 }]] },
    'Build Config': { main: [[{ node: 'Build Reddit Auth', type: 'main', index: 0 }]] },
    'Build Reddit Auth': { main: [[{ node: 'Get Reddit Token', type: 'main', index: 0 }]] },
    'Get Reddit Token': { main: [[{ node: 'Search Reddit', type: 'main', index: 0 }]] },
    'Search Reddit': { main: [[{ node: 'Select Candidate', type: 'main', index: 0 }]] },
    'Select Candidate': { main: [[{ node: 'If Candidate?', type: 'main', index: 0 }]] },
    'If Candidate?': {
      main: [
        [{ node: 'Build Prompt', type: 'main', index: 0 }],
        [{ node: 'Build No Candidate Message', type: 'main', index: 0 }]
      ]
    },
    'Build No Candidate Message': { main: [[{ node: 'Discord Notify', type: 'main', index: 0 }]] },
    'Build Prompt': { main: [[{ node: 'Bonsai Draft Reply', type: 'main', index: 0 }]] },
    'Bonsai Model': { ai_languageModel: [[{ node: 'Bonsai Draft Reply', type: 'ai_languageModel', index: 0 }]] },
    'Bonsai Draft Reply': { main: [[{ node: 'Parse Draft', type: 'main', index: 0 }]] },
    'Parse Draft': { main: [[{ node: 'Assemble Review', type: 'main', index: 0 }]] },
    'Assemble Review': { main: [[{ node: 'Discord Notify', type: 'main', index: 0 }]] }
  },
  settings: { callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
  staticData: null,
  pinData: null
};

const callbackWorkflow = {
  name: 'Sarah Nutri - Reddit Approval Callback',
  nodes: [
    node('approval-webhook', 'Approval Webhook', 'n8n-nodes-base.webhook', 1, [-1120, 0], {
      httpMethod: 'GET',
      path: 'sarah-nutri-reddit-approval',
      responseMode: 'lastNode',
      responseData: 'firstEntryJson',
      options: {}
    }, { webhookId: 'sarah-nutri-reddit-approval' }),
    node('get-source-execution', 'Get Source Execution', 'n8n-nodes-base.httpRequest', 4.1, [-880, 0], {
      curlImport: '',
      method: 'GET',
      url: "={{ `http://localhost:5678/api/v1/executions/${$node['Approval Webhook'].json.query.executionId}?includeData=true` }}",
      authentication: 'none',
      provideSslCertificates: false,
      sendQuery: false,
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'X-N8N-API-KEY', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTg0YTliYi1mMmM5LTRjMTUtYmY3NC1jZDVmZDVjYmQ1YWQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzU5Nzk1MTg2fQ.7ui0fuFgZ0zm5xew5COKoLVbYDNl49G6Iy2M2IUtj-g' }
        ]
      },
      sendBody: false,
      options: {},
      infoMessage: ''
    }),
    node('extract-review', 'Extract Review', 'n8n-nodes-base.code', 2, [-640, 0], {
      jsCode: `const action = String($node['Approval Webhook'].json.query.action || '').toLowerCase();\nconst execution = $input.first().json;\nconst runData = execution.data?.resultData?.runData || {};\nconst review = runData['Assemble Review']?.[0]?.data?.main?.[0]?.[0]?.json;\nif (!review) throw new Error('Could not find Assemble Review output in source execution');\nreturn [{ json: { action, ...review } }];`
    }),
    node('if-approved', 'If Approved?', 'n8n-nodes-base.if', 2.2, [-400, 0], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { id: 'approved-check', leftValue: '={{ $json.action }}', rightValue: 'approve', operator: { type: 'string', operation: 'equals' } },
          { id: 'safety-check', leftValue: '={{ $json.safetyDecision }}', rightValue: 'answer', operator: { type: 'string', operation: 'equals' } }
        ],
        combinator: 'and'
      },
      options: {}
    }),
    node('daily-limit-guard', 'Daily Limit Guard', 'n8n-nodes-base.code', 2, [-160, -120], {
      jsCode: `const staticData = $getWorkflowStaticData('global');\nconst today = new Date().toISOString().slice(0, 10);\nif (staticData.day !== today) {\n  staticData.day = today;\n  staticData.approvedCount = 0;\n}\nconst limit = Number($json.dailyApprovedPostLimit || 5);\nif ((staticData.approvedCount || 0) >= limit) {\n  return [{ json: { ...$json, blockedByDailyLimit: true, message: 'Daily Reddit approval limit reached: ' + staticData.approvedCount + '/' + limit } }];\n}\nreturn [{ json: { ...$json, blockedByDailyLimit: false, approvedCount: staticData.approvedCount || 0, dailyLimit: limit } }];`
    }),
    node('if-limit-ok', 'If Limit OK?', 'n8n-nodes-base.if', 2.2, [80, -120], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { id: 'limit-check', leftValue: '={{ $json.blockedByDailyLimit }}', rightValue: false, operator: { type: 'boolean', operation: 'false', singleValue: true } }
        ],
        combinator: 'and'
      },
      options: {}
    }),
    node('build-reddit-auth', 'Build Reddit Auth', 'n8n-nodes-base.code', 2, [320, -180], {
      jsCode: `const clientId = $env.REDDIT_CLIENT_ID || '';\nconst clientSecret = $env.REDDIT_CLIENT_SECRET || '';\nconst refreshToken = $env.REDDIT_REFRESH_TOKEN || '';\nconst userAgent = $env.REDDIT_USER_AGENT || 'linux:content-factory-sarah-nutri:0.1.0 by /u/sarah_nutri';\nif (!clientId || !clientSecret || !refreshToken) throw new Error('Missing Reddit OAuth env vars');\nreturn [{ json: { ...$json, redditBasicAuth: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'), redditRefreshToken: refreshToken, userAgent } }];`
    }),
    node('get-reddit-token', 'Get Reddit Token', 'n8n-nodes-base.httpRequest', 4.1, [560, -180], {
      curlImport: '',
      method: 'POST',
      url: 'https://www.reddit.com/api/v1/access_token',
      authentication: 'none',
      provideSslCertificates: false,
      sendQuery: false,
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '={{ $json.redditBasicAuth }}' },
          { name: 'User-Agent', value: '={{ $json.userAgent }}' },
          { name: 'Content-Type', value: 'application/x-www-form-urlencoded' }
        ]
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/x-www-form-urlencoded',
      body: "={{ 'grant_type=refresh_token&refresh_token=' + encodeURIComponent($json.redditRefreshToken) }}",
      options: {},
      infoMessage: ''
    }),
    node('post-reddit-comment', 'Post Reddit Comment', 'n8n-nodes-base.httpRequest', 4.1, [800, -180], {
      curlImport: '',
      method: 'POST',
      url: 'https://oauth.reddit.com/api/comment',
      authentication: 'none',
      provideSslCertificates: false,
      sendQuery: false,
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: "={{ 'Bearer ' + $json.access_token }}" },
          { name: 'User-Agent', value: "={{ $node['Build Reddit Auth'].json.userAgent }}" },
          { name: 'Content-Type', value: 'application/x-www-form-urlencoded' }
        ]
      },
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/x-www-form-urlencoded',
      body: "={{ 'api_type=json&thing_id=' + encodeURIComponent($node['Build Reddit Auth'].json.redditThingId) + '&text=' + encodeURIComponent($node['Build Reddit Auth'].json.replyText) }}",
      options: { response: { response: { neverError: true } } },
      infoMessage: ''
    }),
    node('build-approve-response', 'Build Approve Response', 'n8n-nodes-base.code', 2, [1040, -180], {
      jsCode: `const response = $input.first().json;\nconst draft = $node['Build Reddit Auth'].json;\nconst staticData = $getWorkflowStaticData('global');\nconst today = new Date().toISOString().slice(0, 10);\nif (staticData.day !== today) {\n  staticData.day = today;\n  staticData.approvedCount = 0;\n}\nconst errors = response?.json?.errors || [];\nconst posted = Array.isArray(errors) ? errors.length === 0 : true;\nif (posted) staticData.approvedCount = (staticData.approvedCount || 0) + 1;\nreturn [{ json: { ok: posted, action: 'approve', message: posted ? 'Reddit comment posted for r/' + draft.subreddit + '. Daily count: ' + staticData.approvedCount + '/' + (draft.dailyLimit || draft.dailyApprovedPostLimit || 5) : 'Reddit API rejected the comment. Daily count was not incremented.', permalink: draft.permalink, response } }];`
    }),
    node('build-blocked-response', 'Build Blocked Response', 'n8n-nodes-base.code', 2, [320, 40], {
      jsCode: `return [{ json: { ok: false, action: $json.action || 'blocked', message: $json.message || 'Rejected or blocked. No Reddit comment was posted.', safetyDecision: $json.safetyDecision, permalink: $json.permalink } }];`
    })
  ],
  connections: {
    'Approval Webhook': { main: [[{ node: 'Get Source Execution', type: 'main', index: 0 }]] },
    'Get Source Execution': { main: [[{ node: 'Extract Review', type: 'main', index: 0 }]] },
    'Extract Review': { main: [[{ node: 'If Approved?', type: 'main', index: 0 }]] },
    'If Approved?': {
      main: [
        [{ node: 'Daily Limit Guard', type: 'main', index: 0 }],
        [{ node: 'Build Blocked Response', type: 'main', index: 0 }]
      ]
    },
    'Daily Limit Guard': { main: [[{ node: 'If Limit OK?', type: 'main', index: 0 }]] },
    'If Limit OK?': {
      main: [
        [{ node: 'Build Reddit Auth', type: 'main', index: 0 }],
        [{ node: 'Build Blocked Response', type: 'main', index: 0 }]
      ]
    },
    'Build Reddit Auth': { main: [[{ node: 'Get Reddit Token', type: 'main', index: 0 }]] },
    'Get Reddit Token': { main: [[{ node: 'Post Reddit Comment', type: 'main', index: 0 }]] },
    'Post Reddit Comment': { main: [[{ node: 'Build Approve Response', type: 'main', index: 0 }]] }
  },
  settings: { callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
  staticData: null,
  pinData: null
};

const quoraDraftWorkflow = {
  name: 'Sarah Nutri - Quora Draft Intake -> Discord Review',
  nodes: [
    node('manual-trigger', 'Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, [-980, 120], { notice: '' }),
    node('quora-webhook', 'Quora Draft Webhook', 'n8n-nodes-base.webhook', 1, [-980, -80], {
      httpMethod: 'POST',
      path: 'sarah-nutri-quora-draft',
      responseMode: 'lastNode',
      responseData: 'firstEntryJson',
      options: {}
    }, { webhookId: 'sarah-nutri-quora-draft' }),
    node('build-quora-prompt', 'Build Quora Prompt', 'n8n-nodes-base.code', 2, [-720, 0], {
      jsCode: `const products = ${JSON.stringify(productCatalog.products, null, 2)};\nconst input = $json.body || $json;\nconst title = input.title || 'How can an older adult improve daily nutrition safely?';\nconst url = input.url || '';\nconst body = input.body || input.text || 'General senior nutrition question.';\nconst prompt = ${JSON.stringify(quoraPrompt)} + '\\n\\nQuora question context:\\n' + JSON.stringify({ title, url, body }, null, 2) + '\\n\\nProduct catalog:\\n' + JSON.stringify(products, null, 2) + '\\n\\nReturn strict JSON only.';\nreturn [{ json: { platform: 'quora', title, url, body, products, prompt } }];`
    }),
    node('bonsai-draft', 'Bonsai Quora Draft', '@n8n/n8n-nodes-langchain.chainLlm', 1.4, [-480, 0], {
      notice: '',
      promptType: 'define',
      text: '={{ $json.prompt }}',
      hasOutputParser: false,
      needsFallback: false,
      messages: {}
    }),
    node('bonsai-model', 'Bonsai Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [-560, 200], {
      model: { mode: 'id', value: 'bonsai-8b' },
      options: {}
    }, { credentials: bonsaiCredential }),
    node('parse-quora-draft', 'Parse Quora Draft', 'n8n-nodes-base.code', 2, [-240, 0], {
      jsCode: `const source = $node['Build Quora Prompt'].json;\nconst raw = String($json.text || '').trim();\nfunction parseJson(text) {\n  const fenced = text.match(/\\\`\\\`\\\`(?:json)?\\s*([\\s\\S]*?)\\\`\\\`\\\`/i);\n  const body = fenced ? fenced[1] : text;\n  const first = body.indexOf('{');\n  const last = body.lastIndexOf('}');\n  if (first < 0 || last < first) throw new Error('Bonsai did not return JSON: ' + text.slice(0, 300));\n  return JSON.parse(body.slice(first, last + 1));\n}\nconst parsed = parseJson(raw);\nconst product = (source.products || []).find((p) => p.slug === parsed.selected_product_slug) || null;\nreturn [{ json: { ...source, draftRaw: raw, safetyDecision: parsed.safety || 'human_review', affiliateAllowed: parsed.affiliate_allowed === true, selectedProductSlug: parsed.selected_product_slug || '', selectedProductName: product ? product.name : '', answerText: String(parsed.answer || '').trim(), draftReason: parsed.reason || '' } }];`
    }),
    node('assemble-quora-review', 'Assemble Quora Review', 'n8n-nodes-base.set', 3.4, [0, 0], {
      mode: 'manual',
      duplicateItem: false,
      assignments: {
        assignments: [
          { id: 'platform', name: 'platform', value: 'quora', type: 'string' },
          { id: 'title', name: 'title', value: '={{ $json.title }}', type: 'string' },
          { id: 'url', name: 'url', value: '={{ $json.url }}', type: 'string' },
          { id: 'answerText', name: 'answerText', value: '={{ $json.answerText }}', type: 'string' },
          { id: 'safetyDecision', name: 'safetyDecision', value: '={{ $json.safetyDecision }}', type: 'string' },
          { id: 'affiliateAllowed', name: 'affiliateAllowed', value: '={{ $json.affiliateAllowed }}', type: 'boolean' },
          { id: 'selectedProductSlug', name: 'selectedProductSlug', value: '={{ $json.selectedProductSlug }}', type: 'string' },
          { id: 'draftReason', name: 'draftReason', value: '={{ $json.draftReason }}', type: 'string' },
          {
            id: 'discordMessage',
            name: 'discordMessage',
            value: "={{ `Sarah Nutri Quora draft review\\n\\nQuestion: ${$json.title}\\nURL: ${$json.url || 'manual intake'}\\nSafety: ${$json.safetyDecision}\\nAffiliate: ${$json.affiliateAllowed ? 'yes - ' + $json.selectedProductSlug : 'no'}\\nReason: ${$json.draftReason}\\n\\nDraft answer:\\n${($json.answerText || '').substring(0, 1800)}${($json.answerText || '').length > 1800 ? '...' : ''}\\n\\nStatus: manual posting only for now.` }}",
            type: 'string'
          }
        ]
      },
      includeOtherFields: false,
      options: {}
    }),
    node('discord-notify', 'Discord Notify', 'n8n-nodes-base.discord', 2, [240, 0], {
      authentication: 'webhook',
      operation: 'sendLegacy',
      content: '={{ $json.discordMessage }}',
      options: {},
      embeds: {},
      files: {}
    }, { credentials: discordCredential, webhookId: 'sarah-discord-quora-draft' })
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Build Quora Prompt', type: 'main', index: 0 }]] },
    'Quora Draft Webhook': { main: [[{ node: 'Build Quora Prompt', type: 'main', index: 0 }]] },
    'Build Quora Prompt': { main: [[{ node: 'Bonsai Quora Draft', type: 'main', index: 0 }]] },
    'Bonsai Model': { ai_languageModel: [[{ node: 'Bonsai Quora Draft', type: 'ai_languageModel', index: 0 }]] },
    'Bonsai Quora Draft': { main: [[{ node: 'Parse Quora Draft', type: 'main', index: 0 }]] },
    'Parse Quora Draft': { main: [[{ node: 'Assemble Quora Review', type: 'main', index: 0 }]] },
    'Assemble Quora Review': { main: [[{ node: 'Discord Notify', type: 'main', index: 0 }]] }
  },
  settings: { callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
  staticData: null,
  pinData: null
};

fs.writeFileSync('workflow_sarah_nutri_reddit_research_main.json', JSON.stringify(mainWorkflow, null, 2) + '\n');
fs.writeFileSync('workflow_sarah_nutri_reddit_approval_callback.json', JSON.stringify(callbackWorkflow, null, 2) + '\n');
fs.writeFileSync('workflow_sarah_nutri_quora_draft_intake.json', JSON.stringify(quoraDraftWorkflow, null, 2) + '\n');
console.log('Wrote Reddit and Quora workflow exports');
