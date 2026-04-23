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
3. Score families by relevance + earnings per sale + conversion + cancellation + newness, with approval state as a gate.
4. n8n drafts Reddit and Quora replies using that local family catalog.
5. The draft includes a product link only when the product is directly relevant.
6. You manually post the answer.

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

The remaining discovery gap is affiliate-side marketplace enumeration for new products.

Current best options:

1. Keep using approved live families immediately.
2. Add MCP-based marketplace discovery if MCP exposes affiliate-side listing better than the HTTP API.
3. If MCP does not solve it, add a separate marketplace discovery source instead of overloading the live posting workflow.
