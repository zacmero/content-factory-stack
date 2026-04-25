# Digistore24 Integration Notes

## Recommended Path

Use the Digistore24 HTTP API for n8n workflows.

Use the Digistore24 MCP server only for interactive agent exploration, because n8n needs deterministic scheduled calls and simple credential handling.

## Credentials Needed

Create one read-only API key first.

Digistore24 dashboard path:

```text
Vendor view > Settings > Account access > API keys > New API key
```

Recommended settings:

- Name: `content-factory-read`
- Permissions: `Read access`
- Allowed IPs: leave empty unless you know the fixed outbound IP
- Active: yes
- Only allow secure authentication: yes

Add it to the root `.env`:

```bash
DIGISTORE24_API_KEY=
DIGISTORE24_AFFILIATE_ID=
DIGISTORE24_MARKETPLACE_KEYWORDS=senior,elderly,caregiver,nutrition,mobility,sleep,joint,arthritis,memory,digestion
DIGISTORE24_MAX_PRODUCTS=40
```

## API Basics

Base URL:

```text
https://www.digistore24.com/api/call/FUNCTION
```

Required headers:

```text
X-DS-API-KEY: your_api_key
Accept: application/json
```

Useful functions for this project:

- `getUserInfo`: verify the key works.
- `listProducts`: vendor-owned products only.
- `listMarketplaceEntries`: vendor marketplace entries only, not the affiliate marketplace browser.
- `getMarketplaceEntry`: inspect one marketplace entry if you already have an `entry_id`.
- `createBuyUrl`: generate a personalized buy URL when needed.
- `listBuyUrls`: inspect existing buy URLs.

## MCP Basics

Remote server:

```text
https://mcp.digistore24.com/
```

Authentication:

```text
Authorization: Bearer YOUR_DIGISTORE24_API_KEY
```

MCP exposes the same core actions, including `listMarketplaceEntries`, `getMarketplaceEntry`, and `createBuyUrl`.

## Current Workflow Strategy

1. Sync approved affiliate products into `product_catalog.json`.
2. Normalize product variants into product families so bottle-count SKUs do not flood the catalog.
3. Pre-rank products by direct question relevance inside the workflow, then use family score only as a tiebreaker.
4. Score families by relevance + earnings per sale + conversion + cancellation + newness, with approval state as a gate.
5. n8n drafts Reddit and Quora replies using that local family catalog.
6. The draft includes a product link only when the product is directly relevant.
7. You manually post the answer.

## Dub Tracking

Use Dub.co as the short-link tracking layer for approved live families.

Policy:

- one Dub link per product family
- reuse by stable `externalId`
- no blind per-reply link creation
- stay under the free-plan `25 links/month` cap
- write access is required on the Dub API key; read-only keys will return `403` on link creation
- stable link mappings are cached in `content_factory/reddit_quora/dub_links.json`

Refresh command:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/dub_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

The Dub sync writes tracked links back into `product_catalog.json` and keeps the raw Digistore destination in `raw_affiliate_url` for later recovery.

If Digistore returns a blacklist or trust failure for a product redirect, that product is written to `content_factory/reddit_quora/digistore24_blacklist.json` and removed from the live catalog until the block clears.

## Partnership Source

The correct source of truth for "all products I am affiliated with" is Digistore24's affiliate UI, not affiliate sales history.

Two affiliate UI views matter:

- `Sales & partners > Vendor partnerships`: all partnerships and their status, commission, support page, and promolink in the detail view.
- `Sales & partners > Content links`: all products for which you already have an affiliate partnership, with a promolink generator.

This repo now includes a browser-backed sync helper:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_partnerships_playwright.mjs
```

It writes:

```text
content_factory/reddit_quora/digistore24_partnerships.raw.json
```

Then merge it into the live catalog:

```bash
cd /home/zacmero/projects/content-factory-stack
node scripts/digistore24_sync_catalog.mjs --write-catalog
node scripts/build_forum_manual_queue.mjs
```

If the partnership snapshot exists, the sync prefers exact UI promolinks from that file over reconstructed history-only links.

The manual forum queue also checks Reddit and Quora thread URLs before drafting. Dead or unreachable posts are marked `skip` instead of pretending they are live.

## Confirmed API Behavior In This Repo

- `statsMarketplace` confirms the marketplace exists globally.
- `listMarketplaceEntries` returns `0` entries for this affiliate account across all documented `sort_by` values.
- Digistore24's OpenAPI description for `listMarketplaceEntries` explicitly describes vendor marketplace data, not affiliate-side marketplace browsing.
- `getMarketplaceEntry` exposes the scoring fields we want:
  - `stats_affiliate_profit_sale`
  - `stats_conversion_rate`
  - `stats_cancel_rate`
  - `product_created_at`
  - `stats_count_orders_w_aff`
  - `stats_stars`
- That means the HTTP API can score marketplace entries once we have `entry_id`s, but it does not currently give this affiliate account a documented way to enumerate new marketplace offers.

## Current Catalog Buckets

- `approved_live_families`: usable now, already approved, affiliate URL present
- `marketplace_candidate_families`: discovered but not yet approved/live
- `manual_approval_families`: ignore for live posting until approved

The workflow only uses `approved_live_families` for suggestions.

## Current Gap

The remaining discovery gap is affiliate-side marketplace enumeration for brand-new marketplace products you are not yet affiliated with.

Current best options:

1. Use the affiliate partnership/content-link UI as the source for all currently approved products.
2. Keep using approved live families immediately.
3. Add MCP-based marketplace discovery if MCP exposes affiliate-side listing better than the HTTP API.
4. If MCP does not solve it, add a separate marketplace discovery source instead of overloading the live posting workflow.
