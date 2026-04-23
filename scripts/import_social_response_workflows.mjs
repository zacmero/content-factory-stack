#!/usr/bin/env node

import fs from 'node:fs';

const n8nBaseUrl = process.env.N8N_BASE_URL || 'http://localhost:8080';
const apiKey = process.env.N8N_API_KEY || '';
const workflowFiles = [
  'workflow_sarah_nutri_forum_manual_queue.json',
  'workflow_sarah_nutri_quora_draft_intake.json'
];

if (process.env.INCLUDE_REDDIT_API_WORKFLOWS === 'true') {
  workflowFiles.push(
    'workflow_sarah_nutri_reddit_research_main.json',
    'workflow_sarah_nutri_reddit_approval_callback.json'
  );
}

if (!apiKey) {
  console.error('Missing N8N_API_KEY. Create/copy one from n8n Settings > API, then rerun.');
  process.exit(1);
}

for (const file of workflowFiles) {
  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete workflow.id;
  workflow.active = false;

  const response = await fetch(`${n8nBaseUrl}/api/v1/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey
    },
    body: JSON.stringify(workflow)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Failed importing ${file}`, response.status, body);
    process.exitCode = 1;
    continue;
  }

  console.log(`Imported ${workflow.name}: ${n8nBaseUrl}/workflow/${body.id}`);
}
