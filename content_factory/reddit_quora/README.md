# Sarah Nutri Reddit and Quora Pipeline

This package is isolated from the existing Instagram, Facebook, Postiz, and video workflows.

## Current Build

- Manual Reddit + Quora queue workflow export: `workflow_sarah_nutri_forum_manual_queue.json`
- Reddit collector and drafter workflow export: `workflow_sarah_nutri_reddit_research_main.json`
- Reddit approval/post callback export: `workflow_sarah_nutri_reddit_approval_callback.json`
- Quora draft intake workflow export: `workflow_sarah_nutri_quora_draft_intake.json`
- Config: `content_factory/reddit_quora/config.json`
- Product catalog: `content_factory/reddit_quora/product_catalog.json`
- Digistore24 notes: `content_factory/reddit_quora/digistore24.md`
- Digistore24 catalog sync helper: `scripts/digistore24_sync_catalog.mjs`
- Manual queue builder: `scripts/build_forum_manual_queue.mjs`
- Reddit OAuth helper: `scripts/reddit_oauth_setup.mjs`
- n8n import helper: `scripts/import_social_response_workflows.mjs`

## Operating Rules

- Human approval is required before posting.
- The current fast path is manual posting: n8n drafts, Discord delivers, the user posts.
- Max approved Reddit replies per day: 5.
- Product links are gated by relevance and must include disclosure.
- Quora remains draft/manual-review only until a separate posting flow is explicitly approved.
- Emergency or high-risk medical cases are blocked or sent to human review.

## Fast Manual Queue

This is the active validation path while Reddit API access is blocked.

Webhook:

```bash
http://localhost:8080/webhook/sarah-nutri-forum-candidates
```

Payload shape:

```json
{
  "reddit": {
    "title": "Question title",
    "body": "Question body",
    "url": "https://www.reddit.com/r/example/comments/...",
    "subreddit": "AgingParents"
  },
  "quora": {
    "title": "Question title",
    "body": "Question body",
    "url": "https://www.quora.com/..."
  },
  "notes": "optional context"
}
```

The workflow sends two Discord messages in one run:

- Reddit copy/paste reply.
- Quora copy/paste answer.

No Reddit or Quora posting API is used.

## Bonsai Container Access

Docker containers cannot reach a host service that is bound only to `127.0.0.1`. LLMero's `serve.sh` supports host binding through the underlying `llama-server --host` option, but the current Bonsai profile hardcodes `127.0.0.1`.

Current working service command:

```bash
systemctl --user stop llmero-bonsai
systemd-run --user --unit=llmero-bonsai \
  --working-directory=/home/zacmero/projects/LLMero \
  --setenv=LD_LIBRARY_PATH=/home/zacmero/projects/LLMero/.llmero/build/llmero-bonsai/cuda/bin:/opt/cuda-12.9/targets/x86_64-linux/lib \
  /home/zacmero/projects/LLMero/.llmero/build/llmero-bonsai/cuda/bin/llama-server \
  --host 0.0.0.0 --port 8081 --alias bonsai-8b -c 4096 -ngl 99 \
  -m /home/zacmero/projects/LLMero/models/llmero-bonsai/Bonsai-8B.gguf \
  --temp 0.5 --top-p 0.85 --top-k 20
```

Verify from n8n:

```bash
docker exec n8n node -e "fetch('http://host.docker.internal:8081/v1/models',{headers:{Authorization:'Bearer local'}}).then(async r=>{console.log(r.status); console.log(await r.text())})"
```

## Digistore24

Use Digistore24 API first, MCP second.

Create a read-only key in:

```text
Vendor view > Settings > Account access > API keys > New API key
```

Add this to `.env`:

```bash
DIGISTORE24_API_KEY=
DIGISTORE24_AFFILIATE_ID=
DIGISTORE24_MARKETPLACE_KEYWORDS=senior,elderly,caregiver,nutrition,mobility,sleep,joint,arthritis,memory,digestion
DIGISTORE24_MAX_PRODUCTS=40
```

Sync possible products into the local catalog:

```bash
cd /home/zacmero/projects/content-factory-stack
export DIGISTORE24_API_KEY=your_key_here
node scripts/digistore24_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

Sync all currently affiliated Digistore24 products from the affiliate UI:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_partnerships_playwright.mjs
node scripts/digistore24_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

Affiliate links in Discord are only suggested if `product_catalog.json` contains a real `affiliate_url`. For Digistore24 products with a product ID and no URL, the sync helper generates a Promolink in this format:

```text
https://www.checkout-ds24.com/redir/PRODUCT-ID/sarah_nutri/sarahnutri_forum
```

Digistore API behavior observed for this affiliate account:

- `listProducts` returns vendor-owned products; this affiliate-only account has `0`.
- `listMarketplaceEntries` returns vendor marketplace entries, not the public affiliate marketplace browser; this account has `0`.
- `statsMarketplace` confirms marketplace data exists globally, but does not return product details.
- `listPurchases` and `listTransactions` expose historic affiliate sales with product IDs/names.
- `validateAffiliate` confirms whether `sarah_nutri` is approved for each product ID.

The sync helper now supports two sources:

- `affiliate_partnership_ui`: Digistore24 affiliate UI snapshot from `Vendor partnerships` / `Content links`
- `affiliate_sales_history`: historic affiliate sales fallback

If the UI snapshot exists, it is preferred because it reflects all currently approved affiliations, including products you have not sold yet.

The live catalog is now family-based, not bottle-SKU-based. Example: `NeuroQuiet (1 Bottle)`, `NeuroQuiet (3 Bottles)`, and `NeuroQuiet 3 More Bottles` are collapsed into one `NeuroQuiet` family so the drafting workflow works with real product families instead of pack variants.

Current family-scoring factors:

- relevance
- earnings per sale
- conversion
- cancellation
- newness
- sales volume
- recency
- approval state

Only approved live families with a valid affiliate URL are allowed into the workflow's suggestion pool.

The drafting workflow now pre-ranks the product shortlist by direct question relevance before it calls Bonsai. Catalog score is only a tiebreaker among already relevant products.

Important API limitation confirmed in this repo:

- `statsMarketplace` shows the global marketplace count.
- `listMarketplaceEntries` returns zero for this affiliate account and Digistore's OpenAPI describes it as vendor marketplace data.
- `getMarketplaceEntry` exposes rich scoring fields, but only if an `entry_id` is already known.

So the current workflow is fully live for approved families, but new affiliate marketplace discovery still needs a second path.

To add a Digistore24 product manually when you know the product ID:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/add_digistore24_product.mjs id=PRODUCT_ID name="Product name" keywords="senior,nutrition,mobility"
node scripts/build_forum_manual_queue.mjs
```

## Required Reddit Access

Reddit external Data API access is currently approval-gated. This pipeline does not use Devvit because it is an external n8n workflow, not a Reddit-hosted subreddit app.

First check whether the Sarah Nutri account can still create a legacy OAuth app:

```bash
https://www.reddit.com/prefs/apps
```

If the legacy app form is unavailable or redirects toward Devvit, submit Reddit's API access request first:

```bash
https://support.reddithelp.com/hc/en-us/requests/new?tf_14867328473236=api_request_type_enterprise&ticket_form_id=14868593862164
```

Request details to use:

- External n8n workflow operated by one Sarah Nutri Reddit account.
- Human approval before posting.
- Max 5 approved replies per day.
- Scopes needed after approval: `identity`, `read`, `submit`.
- No voting, DMs, resale of Reddit data, model training on Reddit data, or high-volume automation.
- Health replies are general education only; emergency or diagnosis-seeking posts are blocked or escalated to human review.
- Affiliate links must be disclosed if used.

## Required Reddit Credentials

Set these in the root `.env` only after Reddit approves API access or if the legacy OAuth app form is already available:

```bash
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_REFRESH_TOKEN=
REDDIT_USERNAME=sarah_nutri
REDDIT_USER_AGENT=linux:content-factory-sarah-nutri:0.1.0 by /u/sarah_nutri
```

Use `scripts/reddit_oauth_setup.mjs` to get the refresh token.

## Reddit App Type

Use a legacy Reddit OAuth app for external automation. Devvit is not required for this pipeline and will not replace the cross-subreddit API search/post flow.

Recommended redirect URI:

```bash
http://127.0.0.1:8765/callback
```

## Deploy

Rebuild n8n after adding Reddit env vars:

```bash
cd /home/zacmero/projects/content-factory-stack
docker-compose up -d --build n8n
```

Import the new workflows inactive:

```bash
cd /home/zacmero/projects/content-factory-stack
N8N_API_KEY=your_n8n_api_key node scripts/import_social_response_workflows.mjs
```

By default the import helper imports only the manual queue and Quora draft workflow.

Only import the blocked Reddit API workflows after Reddit approves OAuth API access:

```bash
INCLUDE_REDDIT_API_WORKFLOWS=true N8N_API_KEY=your_n8n_api_key node scripts/import_social_response_workflows.mjs
```
