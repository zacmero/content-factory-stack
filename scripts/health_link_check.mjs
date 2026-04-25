#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const urls = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const jsonMode = process.argv.includes('--json');

if (urls.length === 0) {
  console.error('Usage: node scripts/health_link_check.mjs [--json] <url> [url...]');
  process.exit(1);
}

function normalizeUrl(input) {
  try {
    return new URL(String(input).trim()).toString();
  } catch {
    return '';
  }
}

function checkUrl(input) {
  const url = normalizeUrl(input);
  if (!url) {
    return { input, live: false, status: null, finalUrl: '', reason: 'invalid_url' };
  }

  const args = [
    '-I',
    '-s',
    '-L',
    '--max-time', '12',
    '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    url
  ];

  let output = '';
  try {
    output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 200_000 });
  } catch (error) {
    const stdout = String(error?.stdout || '');
    const stderr = String(error?.stderr || '');
    output = stdout || stderr || '';
    if (!output) {
      return {
        input: url,
        live: false,
        status: null,
        finalUrl: '',
        reason: String(error?.message || error)
      };
    }
  }

  const statusMatch = output.match(/^HTTP\/[0-9.]+\s+(\d{3})/m);
  const finalMatch = output.match(/^location:\s*(.+)$/im);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  const finalUrl = finalMatch ? finalMatch[1].trim() : url;
  const live = typeof status === 'number' && status >= 200 && status < 400;

  return {
    input: url,
    live,
    status,
    finalUrl,
    reason: status === 404 ? 'status_404' : status && status >= 400 ? `status_${status}` : 'ok'
  };
}

const results = [];
for (const url of urls) {
  results.push(checkUrl(url));
}

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const result of results) {
    const status = result.live ? 'live' : 'dead';
    const finalUrl = result.finalUrl ? ` -> ${result.finalUrl}` : '';
    console.log(`${status} ${result.status ?? 'n/a'} ${result.input}${finalUrl} (${result.reason})`);
  }
}
