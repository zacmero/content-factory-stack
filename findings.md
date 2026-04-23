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
