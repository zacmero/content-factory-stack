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
- `listProducts`: list products in the account.
- `listMarketplaceEntries`: find possible products to promote.
- `getMarketplaceEntry`: inspect one marketplace entry.
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

1. Sync useful Digistore24 products into `product_catalog.json`.
2. n8n drafts Reddit and Quora replies using that local catalog.
3. The draft includes a product link only when the product is directly relevant.
4. You manually post the answer.
5. Later, we can replace the static catalog with live API lookup once credentials are present and tested.
