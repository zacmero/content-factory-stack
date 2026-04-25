#!/usr/bin/env node

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , workflowFile, workflowId] = process.argv;

if (!workflowFile || !workflowId) {
  console.error('Usage: node scripts/sync_n8n_workflow_sqlite.mjs <workflow.json> <workflowId>');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
const versionId = randomUUID();
const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return '\'' + String(value).replace(/'/g, "''") + '\'';
}

const sql = [
  'BEGIN;',
  'UPDATE workflow_entity SET',
  `  name=${sqlString(workflow.name)},`,
  `  active=${workflow.active ? 1 : 0},`,
  `  nodes=${sqlString(JSON.stringify(workflow.nodes))},`,
  `  connections=${sqlString(JSON.stringify(workflow.connections))},`,
  `  settings=${sqlString(JSON.stringify(workflow.settings ?? {}))},`,
  `  staticData=${workflow.staticData === null ? 'NULL' : sqlString(JSON.stringify(workflow.staticData))},`,
  `  pinData=${workflow.pinData === null ? 'NULL' : sqlString(JSON.stringify(workflow.pinData))},`,
  `  versionId=${sqlString(versionId)},`,
  `  activeVersionId=${sqlString(versionId)},`,
  `  updatedAt=${sqlString(now)},`,
  '  versionCounter=versionCounter+1',
  `WHERE id=${sqlString(workflowId)};`,
  `INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description) VALUES (${sqlString(versionId)}, ${sqlString(workflowId)}, ${sqlString('Zac Mero')}, ${sqlString(now)}, ${sqlString(now)}, ${sqlString(JSON.stringify(workflow.nodes))}, ${sqlString(JSON.stringify(workflow.connections))}, ${sqlString(workflow.name)}, 0, ${workflow.description === null || workflow.description === undefined ? 'NULL' : sqlString(workflow.description)});`,
  'COMMIT;'
].join('\n');

const sqlPath = join(tmpdir(), `sync-n8n-${versionId}.sql`);
fs.writeFileSync(sqlPath, sql, 'utf8');
execFileSync('sqlite3', ['n8n_data/database.sqlite', `.read ${sqlPath}`], { encoding: 'utf8' });
fs.unlinkSync(sqlPath);
console.log(`Updated workflow ${workflowId} to version ${versionId}`);
