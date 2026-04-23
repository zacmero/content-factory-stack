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
