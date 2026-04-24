# Task Plan: Bonsai routing + Temporal repair

## Goal
Wire Bonsai as the default text model for the content-factory pipeline, keep Gemini for image generation and future video work, repair Temporal so Postiz boots cleanly again, and document the root cause and current milestones.

## Current Phase
Phase 10

## Phases

### Phase 1: Requirements & Discovery
- [ ] Confirm where text-model selection is implemented
- [ ] Confirm where Gemini image/video calls are implemented
- [ ] Inspect Temporal startup path and current failure mode
- [ ] Record findings in findings.md
- **Status:** complete

### Phase 2: Planning & Structure
- [ ] Decide which files/workflows need edits
- [ ] Decide whether Bonsai should be wired via env only or code changes
- [ ] Decide Temporal recovery path
- **Status:** complete

### Phase 3: Implementation
- [ ] Patch model routing for text tasks
- [ ] Preserve Gemini for image/video paths
- [ ] Fix or reset Temporal stack/config
- **Status:** complete

### Phase 4: Testing & Verification
- [ ] Rebuild/restart affected containers
- [ ] Verify Bonsai is used for text paths
- [ ] Verify Temporal is healthy
- [ ] Capture exact error/root cause
- **Status:** complete

### Phase 5: Delivery
- [x] Summarize changes
- [x] Summarize Temporal problem
- [x] Leave milestone/state files updated
- **Status:** complete

### Phase 6: Reddit/Quora Response Pipeline
- [x] Create isolated config and product catalog
- [x] Create Reddit OAuth helper
- [x] Create Reddit collector/drafter workflow export
- [x] Create Reddit approval/post callback workflow export
- [x] Create Quora draft intake workflow export
- [x] Create n8n import helper
- [ ] Wait for Reddit OAuth app credentials and refresh token
- **Status:** in_progress

### Phase 7: Manual Forum Queue + Digistore24
- [x] Pivot around Reddit API approval block with a manual posting queue
- [x] Create combined Reddit + Quora candidate intake workflow export
- [x] Add Digistore24 credential docs
- [x] Add Digistore24 catalog sync helper
- [x] Wire Digistore24 env vars into n8n compose
- [x] Add Digistore24 read-only API key
- [x] Import and activate manual queue in n8n
- [x] Smoke-test Reddit + Quora candidate pair
- [x] Sync approved active Digistore products from affiliate sales history
- [x] Validate products through Digistore `validateAffiliate`
- [x] Confirm relevant product links include `sarah_nutri`
- [x] Normalize approved products into family-level catalog entries
- [x] Add family scoring based on relevance/commercial signals
- [x] Investigate whether MCP exposes affiliate-side marketplace enumeration beyond the HTTP API docs
- [x] Add affiliate partnership UI as a first-class Digistore24 source path
- [x] Change forum drafting to pre-rank products by post relevance before model selection
- [x] Pull all currently affiliated Digistore24 products from the authenticated affiliate UI/API path
- [x] Rebuild the live family catalog from full affiliated-product coverage
- [x] Repair Bonsai availability with a persistent host service so the live forum workflow passes again
- **Status:** complete

### Phase 8: Postiz Startup Hardening
- [x] Reproduce the Postiz blank-screen failure after restart
- [x] Isolate whether Temporal, Postiz, or the backend port was the actual blocker
- [x] Patch the Temporal healthcheck in `postiz-stable/docker-compose.yaml`
- [x] Verify Postiz returns HTTP auth responses instead of `502`
- [x] Add unified start/stop helper scripts for both compose projects
- [x] Document the root cause and the corrected operational path
- **Status:** complete

### Phase 9: Dub.co Link Tracking
- [x] Confirm Dub API link model and retrieval endpoints
- [x] Add a stable link-cache strategy so product families reuse the same short link
- [ ] Sync Dub links for the approved Digistore catalog
- [ ] Write tracked URLs back into the live forum workflow export
- [x] Document the 25-link/month free-plan guardrail and reuse policy
- **Status:** in_progress

### Phase 10: Persona Tightening + Telegram Handoff
- [x] Make Reddit/Quora drafts brief, personal, and caring
- [ ] Add a Telegram delivery path for the manual review packet
- [x] Run a full end-to-end test with a tracked affiliate link and a post URL
- **Status:** in_progress

## Key Questions
1. Which files currently control text interpretation vs image/video generation?
2. Is Bonsai already reachable from containers, or do we need to add env/proxy plumbing?
3. What specifically caused Temporal to fail, and what reset is safe?
4. Does Digistore24 MCP expose public marketplace search beyond affiliate history?
5. Does Digistore24 MCP expose affiliate marketplace listing where the HTTP API currently does not?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use planning files in repo root | Keeps milestones and findings persistent across sessions |
| Use Bonsai OpenAI credential for n8n text nodes | Keeps text routing local while leaving image/video paths untouched |
| Keep Gemini nodes only for media-specific paths | Preserves image/video generation behavior |
| Keep Reddit/Quora workflows isolated | Avoids affecting current production video/RSS workflows |
| Require human approval for Reddit posting | Reduces medical and platform risk |
| Keep Quora draft-only for now | Avoids brittle direct posting before account and source behavior are settled |
| Use manual posting queue while Reddit API is blocked | Validates answer format without waiting for Reddit approval or bypassing platform controls |
| Use Digistore24 HTTP API for n8n | Simpler and more deterministic than MCP for scheduled workflows |
| Use Digistore24 MCP for interactive exploration only | Good for agent-assisted browsing, less suitable as the workflow runtime path |
| Start/stop the full stack with root helper scripts | Avoids leaving Postiz running without its Temporal services |
| Collapse Digistore24 variants into family-level products | Matches the real sales-page decision unit and avoids bottle-count noise in prompts |
| Treat Digistore24 MCP marketplace actions as the same capability boundary as the HTTP API unless proven otherwise | MCP docs link directly to the same API references for marketplace tools |
| Use Dub short links once per product family and cache them by stable external ID | Reuse avoids burning the 25-link/month free-plan cap |
| Keep the Sarah Nutri voice brief, personal, and caring | Cuts AI slop and makes the drafts feel human |
| Add Telegram delivery once bot credentials are available | User wants the final review packet in Telegram |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Docker socket blocked on `docker stop` | 1 | Retried with elevated permission and paused n8n safely |
| `sqlite3` spawn blocked inside Node child_process | 1 | Split work into shell SQL steps and file-only Node transforms |
| Dub `POST /links` returned `403 Forbidden` | 1 | Documented that the API key needs write permission for `links`; integration now falls back to raw affiliate URLs until a writable key or reset is available |
| Telegram delivery path not yet wired | 1 | Need a bot token and chat ID before sending review packets to Telegram |

## Notes
- Update phase status as work progresses.
- Log every discovery and every error.
- Do not touch unrelated user changes.
