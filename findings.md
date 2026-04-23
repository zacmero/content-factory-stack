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

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Keep Gemini only where image/video generation needs it | Preserves existing media generation path |
| Route normal text tasks to Bonsai | Matches user preference and local OpenAI-style serving |
| Investigate Temporal from compose/logs before changing DB data | Safer than blind resets |
| Use `host.docker.internal` for Bonsai base URL in containers | Docker container must reach host service, not its own loopback |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Planning files did not exist | Created `task_plan.md`, `findings.md`, `progress.md` |
| Unrelated local modification in `readme.md` | Left untouched |
| Node child-process spawn to `sqlite3` failed | Switched to shell SQLite + file-only Node transforms |

## Resources
- `/home/zacmero/projects/content-factory-stack/docker-compose.yml`
- `/home/zacmero/projects/content-factory-stack/postiz-stable/docker-compose.yaml`
- `/home/zacmero/projects/content-factory-stack/postiz-source/libraries/nestjs-libraries/src/openai/openai.service.ts`
- `/home/zacmero/projects/content-factory-stack/n8n_data/database.sqlite`
- `/home/zacmero/projects/content-factory-stack/n8n_data/config`

## Visual/Browser Findings
- None yet.

---
*Update this file after every 2 view/browser/search operations*
