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
- The current fast path is manual posting: n8n drafts, Discord delivers, and Telegram is an optional extra review channel only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set.
- Draft tone should stay brief, personal, warm, and human. No AI-slab paragraph dumps.
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

The workflow sends two review packets in one run:

- Reddit copy/paste reply.
- Quora copy/paste answer.

If Telegram credentials are set, the same review packet is also sent to Telegram with the post URL and tracked affiliate link. Otherwise, Discord is the review path.

No Reddit or Quora posting API is used.

## Bonsai Container Access

Docker containers cannot reach a host service that is bound only to `127.0.0.1`.

The durable fix is now in place:

- `LLMero/profiles/llmero-bonsai.env` binds Bonsai to `0.0.0.0`
- a persistent user service exists at `~/.config/systemd/user/llmero-bonsai.service`

Use:

```bash
systemctl --user status llmero-bonsai.service --no-pager
systemctl --user restart llmero-bonsai.service
```

Important:

- binding to `0.0.0.0:8081` does not remove local access through `127.0.0.1:8081`
- local CLI usage stays valid:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8081/v1
```

- browser/UI checks stay valid:

```bash
http://127.0.0.1:8081
```

Verify from n8n:

```bash
docker exec n8n node -e "fetch('http://host.docker.internal:8081/v1/models',{headers:{Authorization:'Bearer local'}}).then(async r=>{console.log(r.status); console.log(await r.text())})"
```

## Digistore24

Use Digistore24 API first, MCP second.

## Digistore24 Operations

Main refresh sequence:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_partnerships_playwright.mjs
node scripts/digistore24_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

Helper checks:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_partnerships_playwright.mjs --check-playwright
DIGISTORE24_HEADLESS=true node scripts/digistore24_sync_partnerships_playwright.mjs --probe-start
```

What each step does:

- `digistore24_sync_partnerships_playwright.mjs`
  - logs into Digistore24
  - reads current affiliated products from the authenticated affiliate source
  - writes `content_factory/reddit_quora/digistore24_partnerships.raw.json`
- `digistore24_sync_catalog.mjs --write-catalog`
  - merges affiliated products with fallback sales history
  - normalizes families
  - writes `content_factory/reddit_quora/product_catalog.json`
- `build_forum_manual_queue.mjs`
  - rebuilds the workflow export with the latest catalog

When to run it:

- after adding new affiliations
- after changing product-selection logic
- after a Digistore login/session reset

Create a read-only key in:

```text
Vendor view > Settings > Account access > API keys > New API key
```

Add this to `.env`:

```bash
DIGISTORE24_API_KEY=
DIGISTORE24_AFFILIATE_ID=
DIGISTORE24_MARKETPLACE_KEYWORDS=senior,elderly,caregiver,nutrition,mobility,sleep,joint,arthritis,memory,digestion
DIGISTORE24_MAX_PRODUCTS=250
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

Track approved affiliate links with Dub.co:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/dub_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

Full refresh sequence for this pipeline:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_partnerships_playwright.mjs
node scripts/digistore24_sync_catalog.mjs --write-catalog
node scripts/dub_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

Dub plan guardrails:

- reuse existing short links by stable `externalId`
- only create new links for approved product families
- keep new-link creation under `DUB_MAX_NEW_LINKS` per month, default `25`
- if a product has no Dub link yet, the workflow still falls back to the raw affiliate URL
- the Dub API key must have write permission for `links`; read-only keys will not create short links
- the local cache lives at `content_factory/reddit_quora/dub_links.json`
- blocked Digistore redirects are moved into `content_factory/reddit_quora/digistore24_blacklist.json` and removed from the live catalog

Playwright loader check:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_partnerships_playwright.mjs --check-playwright
```

Digistore start-page probe:

```bash
cd /home/zacmero/projects/content-factory-stack
DIGISTORE24_HEADLESS=true node scripts/digistore24_sync_partnerships_playwright.mjs --probe-start
```

This repo does not require a local `node_modules/playwright`. The sync script can resolve Playwright from:

- local Node package installs
- global npm roots
- the Playwright CLI reference path reported by `playwright install --list`
- cached `~/.npm/_npx/*/node_modules/playwright*` installs

The Digistore sync now defaults to Playwright `firefox`, not Chromium. It starts from `https://www.digistore24.com/` and only uses a custom browser executable if `DIGISTORE24_BROWSER_PATH` is explicitly set.

The manual forum queue also checks whether Reddit and Quora URLs are still reachable before drafting. If the thread is dead, the workflow marks it as `skip` instead of pretending it is a live post.

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

If a Digistore checkout or redirect page reports a blacklist / trust failure such as `DSB-289081`, that product is blocked, written to `digistore24_blacklist.json`, and excluded from the live catalog until the blacklist is cleared.

Current working affiliated-product discovery path:

- log into Digistore24 once with the Playwright Firefox sync
- the script uses the authenticated affiliate app/API product-options endpoint
- that endpoint returns current affiliated products directly, including unsold approvals

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
