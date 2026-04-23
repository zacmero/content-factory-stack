# Task Plan: Bonsai routing + Temporal repair

## Goal
Wire Bonsai as the default text model for the content-factory pipeline, keep Gemini for image generation and future video work, repair Temporal so Postiz boots cleanly again, and document the root cause and current milestones.

## Current Phase
Phase 5

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
- [ ] Summarize changes
- [ ] Summarize Temporal problem
- [ ] Leave milestone/state files updated
- **Status:** in_progress

## Key Questions
1. Which files currently control text interpretation vs image/video generation?
2. Is Bonsai already reachable from containers, or do we need to add env/proxy plumbing?
3. What specifically caused Temporal to fail, and what reset is safe?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use planning files in repo root | Keeps milestones and findings persistent across sessions |
| Use Bonsai OpenAI credential for n8n text nodes | Keeps text routing local while leaving image/video paths untouched |
| Keep Gemini nodes only for media-specific paths | Preserves image/video generation behavior |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Docker socket blocked on `docker stop` | 1 | Retried with elevated permission and paused n8n safely |
| `sqlite3` spawn blocked inside Node child_process | 1 | Split work into shell SQL steps and file-only Node transforms |

## Notes
- Update phase status as work progresses.
- Log every discovery and every error.
- Do not touch unrelated user changes.
