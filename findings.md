# Findings & Decisions

## Requirements
- Use Bonsai as main text model.
- Keep Gemini for image generation and future video generation.
- Repair Temporal container and identify root cause.
- Create persistent planning files for milestones and tasks.

## Research Findings
- Root n8n workflows in repo still use `@n8n/n8n-nodes-langchain.lmChatGoogleGemini` for text rewrites.
- Postiz source has an OpenAI client path in `postiz-source/libraries/nestjs-libraries/src/openai/openai.service.ts`.
- Postiz compose already defines `OPENAI_API_KEY` in `postiz-stable/docker-compose.yaml`.
- Temporal stack for Postiz lives in `postiz-stable/docker-compose.yaml` with `temporal`, `temporal-postgresql`, and `temporal-elasticsearch`.
- The repo root `docker-compose.yml` currently only defines n8n and does not yet wire Bonsai env vars.
- Live n8n DB had 5 workflows still pointing at Gemini chat nodes: `Sarah Nutri - Approval Callback`, `Sarah Nutri - MINIMAL TEST`, `Sarah Nutri - RSS -> Discord -> Postiz (LOOP)`, `Sarah Nutri - Video Approval Callback`, and `Sarah Nutri - Video -> Discord -> Postiz (LOOP v3)`.
- The OpenAI-compatible n8n node is `@n8n/n8n-nodes-langchain.lmChatOpenAi` and it uses the `openAiApi` credential.
- n8n's `openAiApi` credential accepts `apiKey`, `organizationId`, `url`, and optional custom headers.
- Temporal failure was a stop/shutdown event, not a broken schema. Logs show `received fast shutdown request`, then the stack was simply restarted.
- n8n now has a Bonsai OpenAI credential in SQLite using `http://host.docker.internal:8081/v1`, and the live workflows were rewired to use `bonsai-8b` for text tasks.
- Postiz backend startup was flaky because PM2 expects `ps` inside the container and the upstream image did not provide it.
- The durable stack fix is a local Postiz wrapper image that installs `procps`, plus a Temporal health gate so the backend starts only after Temporal is ready.
- The Reddit/Quora package is isolated under `content_factory/reddit_quora/` and new workflow exports; no existing Sarah Nutri production workflow was edited.
- Reddit external Data API access is approval-gated under Reddit's Responsible Builder Policy; OAuth credentials are only available after approval or if the account still has legacy app creation enabled.
- Devvit is not used for this external n8n pipeline because the built workflow needs cross-subreddit API search and reply endpoints from n8n, not a Reddit-hosted subreddit app.
- Quora is draft intake only for now. Posting is intentionally not automated until account behavior and review rules are settled.
- Reddit API app creation is blocked for the Sarah Nutri account, so the fast path is now an API-free manual posting queue.
- Digistore24 API keys are created in vendor view under `Settings > Account access > API keys`; read access is enough for product/catalog lookup.
- Digistore24 API calls use `https://www.digistore24.com/api/call/FUNCTION` with `X-DS-API-KEY` and `Accept: application/json` headers.
- Digistore24 MCP is available at `https://mcp.digistore24.com/` with `Authorization: Bearer YOUR_DIGISTORE24_API_KEY`, but the direct HTTP API is better for n8n scheduled workflows.
- The configured Digistore24 key works. `listProducts` returns `0` because it lists vendor-owned products, and this account is affiliate-only.
- `listMarketplaceEntries` returns `0` because it exposes vendor marketplace entries, not the public affiliate marketplace browser. Valid `sort_by` values are `name`, `stars`, `created`, `rank`, `profit`, `cancel`, `conversion`, and `revenue`.
- `statsMarketplace` returns global marketplace stats including count `13830`, but not product details.
- Affiliate product discovery works through sales history: `listPurchases` returned 121 purchases, `listTransactions` returned 132 transactions, and `listCommissions` returned 264 commission rows.
- `validateAffiliate` works for historic product IDs and reports `have_affiliation: Y` plus `affiliation_status: approved` when `sarah_nutri` is approved.
- The active Digistore catalog now contains 12 approved, active affiliate products generated from historic sales and validated affiliations.
- Digistore24 Promolink format is `https://www.checkout-ds24.com/redir/PRODUCT-ID/AFFILIATE/CAMPAIGNKEY`.
- n8n could not reach Bonsai because `llama-server` was bound only to `127.0.0.1:8081`. The current working service now runs Bonsai directly on `0.0.0.0:8081`, so the proxy is no longer required.
- Postiz and n8n are split across two compose projects. Restarting only the repo-root compose project leaves the Postiz stack untouched.
- Temporal was not actually dead after the latest restart. It was listening on the container IP at `172.20.x.x:7233`, but the compose healthcheck probed `localhost:7233`, so Docker kept it unhealthy and blocked Postiz startup.
- Once Temporal healthcheck was corrected and the `postiz` app container was restarted against a healthy Temporal instance, Postiz returned `401 Unauthorized` on `/api/user/self`, confirming the blank-UI `502` state was cleared.
- The recurring error was operational plus one compose bug, not data corruption from powering off the machine.
- Digistore24 OpenAPI confirms `listMarketplaceEntries` is vendor marketplace data, not affiliate marketplace browsing.
- `getMarketplaceEntry` exposes the exact commercial fields needed for ranking new offers: affiliate profit per sale, conversion rate, cancellation rate, created date, stars, and order counts.
- The live family catalog now collapses pack-size variants into product families such as `NeuroQuiet`, `EchoXen`, `Ring Quiet Plus`, and `Nervix`.
- The current scoring model combines relevance + earnings per sale + conversion + cancellation + newness, then adds lighter weighting for sales volume, recency, and approval state.
- The remaining marketplace-expansion gap is not ranking logic anymore; it is affiliate-side discovery of new `entry_id`s.
- Digistore24's MCP documentation lists `listMarketplaceEntries` and `getMarketplaceEntry`, but it explicitly links both tools to the same API references already inspected. That strongly suggests MCP does not add a separate affiliate-side marketplace enumeration capability by itself.
- Digistore24's affiliate marketplace help page confirms that affiliates can browse products in the web UI, request partnerships, and receive affiliate links there. That UI capability is broader than the currently documented HTTP/MCP marketplace listing surface.
- Vendor mode does not solve third-party discovery: the vendor marketplace docs describe listing your own products so affiliates can find them. With no vendor products of your own, vendor-mode marketplace listing remains empty by design.
- Digistore24's help docs explicitly identify two affiliate UI views that matter for this project: `Sales & partners > Vendor partnerships` and `Sales & partners > Content links`. Those pages cover status, commission, support page, and promolinks for approved products.
- The repo now has a browser-backed sync helper, `scripts/digistore24_sync_partnerships_playwright.mjs`, which captures approved promolinks and partnership rows into `content_factory/reddit_quora/digistore24_partnerships.raw.json`.
- The catalog sync now prefers `affiliate_partnership_ui` entries when present and falls back to `affiliate_sales_history` only when the UI snapshot is absent.
- The forum manual-queue workflow no longer passes a flat score-sorted product list to Bonsai. It now computes a question-specific shortlist first, using direct keyword/family hits, then uses the existing family score only as a tiebreaker.
- The local machine's `playwright` command is a Python-installed CLI shim at `/home/zacmero/.local/bin/playwright`, not a local npm dependency. The Digistore sync script now resolves Playwright dynamically from the CLI's own reference path (`playwright install --list`) and from cached npx installs.
- The Digistore sync script now defaults to Playwright `firefox` and enters through `https://www.digistore24.com/`. The previous hardcoded `https://www.digistore24-app.com/en/home` path was the source of the page-not-found behavior.
- `playwright install firefox` from the Python CLI was not enough because the script was loading a different Node Playwright package that expected Firefox revision `1511`. Installing the exact browser revision for the resolved Node package fixed that mismatch.
- A reused `/tmp/digistore24-playwright-profile` created by a newer system Firefox caused Playwright Firefox to refuse startup. The script now isolates the default profile path by browser and auto-falls back to a fresh profile when versions conflict.
- After login, Digistore24's authenticated affiliate app exposes a product-options API at `https://analytics.digistore24.com/api/generic/products/options?types=affiliation...`. That endpoint returns the current affiliated products directly, including products never sold.
- The Playwright sync now uses the authenticated affiliate API path first and captures 100 affiliated products into `content_factory/reddit_quora/digistore24_partnerships.raw.json`, instead of relying only on brittle table scraping.
- Rebuilding the catalog from the full affiliated-product pool produced 101 approved live product families in `content_factory/reddit_quora/product_catalog.json`.
- The live forum workflow failed after the catalog expansion only because a stale host `llama-server` was still bound to `127.0.0.1:8081`; Docker could not reach it through `host.docker.internal`.
- The durable Bonsai fix is a user `systemd` service at `/home/zacmero/.config/systemd/user/llmero-bonsai.service` plus `LLAMA_SERVER_HOST=\"0.0.0.0\"` in `LLMero/profiles/llmero-bonsai.env`.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Keep Gemini only where image/video generation needs it | Preserves existing media generation path |
| Route normal text tasks to Bonsai | Matches user preference and local OpenAI-style serving |
| Investigate Temporal from compose/logs before changing DB data | Safer than blind resets |
| Use `host.docker.internal` for Bonsai base URL in containers | Docker container must reach host service, not its own loopback |
| Build a local Postiz wrapper image with `procps` | PM2 needs `ps` inside the container to supervise backend restarts |
| Gate Postiz on Temporal health | Prevents the backend from starting before Temporal is ready |
| Use Reddit OAuth refresh-token flow | Works for external n8n automation after Reddit API access approval |
| Store products in a separate catalog | Keeps affiliate links auditable and easy to change |
| Use low default affiliate probability | Keeps answers help-first and reduces platform risk |
| Pivot to manual posting queue | Delivers immediate validation without Playwright auto-posting or Reddit API approval wait |
| Use Digistore24 read-only key first | Least-privilege product discovery and catalog sync |
| Keep Digistore24 products cached locally for drafting | Prevents live API instability from blocking forum draft generation |
| Do not use placeholder product links | Prevents Discord drafts from suggesting fake `example.com` affiliate links |
| Generate Digistore24 Promolinks only from real product IDs | Ensures suggested links include `sarah_nutri` and valid tracking shape |
| Discover affiliate products through purchase/transaction history | Correct API path for an affiliate-only Digistore24 account |
| Validate every product with `validateAffiliate` before catalog inclusion | Ignores restricted/unapproved products |
| Exclude inactive/deleted products by default | Avoids recommending products that may no longer sell |
| Start Bonsai on `0.0.0.0:8081` | Lets n8n reach the local OpenAI-compatible endpoint through `host.docker.internal` without a proxy |
| Change Temporal healthcheck from `localhost` to `$(hostname -i)` | Matches how Temporal binds in this container and prevents false unhealthy status |
| Add unified start/stop helper scripts | Reduces operator error across the split n8n/Postiz compose projects |
| Keep the workflow suggestion pool restricted to approved live product families | Prevents non-approved marketplace candidates from leaking into affiliate links |
| Prefer Digistore's authenticated affiliate product-options API over UI scraping | It exposes the full affiliated-product pool, including unsold products, with less DOM fragility |
| Run Bonsai as an enabled user `systemd` service | Makes the OpenAI-compatible endpoint survive reboots and keeps the bind reachable from Docker |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Planning files did not exist | Created `task_plan.md`, `findings.md`, `progress.md` |
| Unrelated local modification in `readme.md` | Left untouched |
| Node child-process spawn to `sqlite3` failed | Switched to shell SQLite + file-only Node transforms |
| Semantic code search returned 429 | Fell back to direct `rg`, JSON inspection, and existing workflow exports |

## Resources
- `/home/zacmero/projects/content-factory-stack/docker-compose.yml`
- `/home/zacmero/projects/content-factory-stack/postiz-stable/docker-compose.yaml`
- `/home/zacmero/projects/content-factory-stack/postiz-source/libraries/nestjs-libraries/src/openai/openai.service.ts`
- `/home/zacmero/projects/content-factory-stack/n8n_data/database.sqlite`
- `/home/zacmero/projects/content-factory-stack/n8n_data/config`
- `https://dev.digistore24.com/hc/en-us/articles/32479630493585-API-basics`
- `https://help.digistore24.com/hc/en-us/articles/23658595845009`
- `https://help.digistore24.com/hc/en-us/articles/39566135622929-Digistore24-Model-Context-Protocol-MCP-Server`

## Visual/Browser Findings
- None yet.

---
*Update this file after every 2 view/browser/search operations*
