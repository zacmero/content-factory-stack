# Content Factory Stack Runbook

This repo runs Sarah Nutri social automation. Current stable stack:

- n8n at `http://localhost:8080`
- Postiz at `http://localhost:4007`
- Source puller helper at `http://192.168.1.59:8788`
- Video fallback helper at `http://localhost:8787`

## What Works Now

- Facebook posting works.
- Instagram posting works.
- Human approval loop works.
- Reject + new post loop works.
- Video source pull works from rolling Instagram page list.
- Source media is rehosted to a public URL before Postiz gets it.

## Current Live Workflows

- `Sarah Nutri - Video -> Discord -> Postiz (LOOP v3)`
- `Sarah Nutri - Video Approval Callback`
- `Sarah Nutri - Video Review Page`
- Image workflows remain separate and untouched.

Main workflow id:

- `gYJCczNloTbqWo1q`

Callback workflow id:

- `TEtc2C3vW5mEDQYD`

Review page workflow id:

- `M7WmkDgaD3zSCeTe`

## Video Pipeline

1. Trigger `Sarah Nutri - Video -> Discord -> Postiz (LOOP v3)`.
2. The workflow picks one source page from the rolling pool.
3. It pulls one real post from that page, not just the page home.
4. The source media is rehosted to a public URL.
5. Gemini rewrites the post for Sarah Nutri.
6. The Discord approval message shows:
   - source title
   - source link
   - source media preview
   - draft text
   - video prompt or media fallback note
   - review link
7. Approve sends the draft to Postiz.
8. Reject sends feedback back into the workflow and requests a fresh source post.

## Source Pool

Current rolling source list:

- `https://www.instagram.com/healthh.hacksss/?g=5`
- `https://www.instagram.com/grandma.healer/`
- `https://www.instagram.com/popular/elderly-health/`

The puller selects one real post from one of these sources and rehosts its media before rewrite.

## Postiz Routing

Approved drafts currently route to:

- Facebook
- Instagram

The post text keeps the original source credit at the end as `@handle`.

## YouTube Status

YouTube is the remaining reliability problem.

What happened:

- Approved video drafts did not always queue YouTube cleanly.
- Postiz returned token errors like:
  - `Token expired or invalid, please reconnect your YouTube account.`

Current state:

- YouTube is routed again in the approval path.
- If the Postiz YouTube token is broken, YouTube can still fail while Facebook and Instagram keep working.

What to do when YouTube is needed again:

1. Reconnect the YouTube account inside Postiz.
2. Confirm the integration is active.
3. Re-enable YouTube routing in the video approval callback.
4. Run one approved draft and verify Postiz queues all three networks.

## Reject Loop

Reject flow now works.

- Discord reject sends feedback back into n8n.
- The main workflow reruns with that feedback.
- The old source post is added to the exclude list.
- Next run picks a different source post.

## Media Notes

- Meta fetches fail on local-only media URLs.
- Instagram/Facebook need a public fetchable media URL.
- The source puller and video fallback helper both rehost media to public URLs before Postiz gets them.
- That is why the pipeline now posts reliably.

## Known Failure Modes

- If n8n boots and logs `Cannot read properties of undefined (reading 'endsWith')`, check for stale workflow refs from deleted video workflows.
- If Postiz shows YouTube token errors, reconnect the account before expecting YouTube queueing.
- If source media stops resolving, check the helper at `:8788` first.

## Recovery Commands

Start Postiz:

```bash
cd /home/zacmero/projects/content-factory-stack/postiz-stable
docker-compose up -d
```

Stop Postiz:

```bash
cd /home/zacmero/projects/content-factory-stack/postiz-stable
docker-compose down
```

Start n8n:

```bash
cd /home/zacmero/projects/content-factory-stack
docker-compose up -d
```

Stop n8n:

```bash
cd /home/zacmero/projects/content-factory-stack
docker-compose stop
```

Verify containers:

```bash
docker ps
```

## Meta / Instagram Credentials

These credentials were used to connect the accounts:

- Facebook login: `manuel_melo81@hotmail.com`
- Facebook password: `2202@2202@nuk`
- Instagram login: `sarahsmithnutri@gmail.com`
- Instagram password: `2202@2202@nuk`

## Meta / Postiz Connection Record

What was done to connect the Facebook Page and Instagram account:

1. Opened Meta Business Suite for the Facebook Page owner account.
2. Used the Page control to connect Instagram.
3. Accepted Instagram inbox / messaging permission prompts.
4. Completed any Meta verification or checkpoint prompt.
5. Created the Sarah Nutri Instagram business account.
6. Linked that Instagram business account to the Facebook Page.
7. Added the Instagram integration in Postiz.
8. Published a real test post in Postiz to verify the integration.
9. Confirmed the Instagram integration appears in Postiz integrations API.
10. Re-ran the n8n approval webhook and confirmed it routes to Facebook and Instagram.

## Global Master Credentials

For both n8n and Postiz:

- Email / Username: `z4cmero@gmail.com`
- Password: `Nuk@2202`

## n8n API Notes

The project uses direct API control of n8n.

- n8n URL: `http://localhost:8080`
- Workflows API: `http://localhost:8080/api/v1/workflows`
- API key header: `X-N8N-API-KEY`

The workflow source files live in the repo root and are the authoritative record for future edits:

- `workflow_sarah_nutri_video_rebuilt_main.json`
- `workflow_sarah_nutri_video_approval_callback.json`
- `workflow_sarah_nutri_video_review_page.json`
- `workflow_sarah_nutri_live_fix.json`
- `workflow_sarah_nutri_approval_callback.json`
- `workflow_sarah_nutri_review_page.json`
