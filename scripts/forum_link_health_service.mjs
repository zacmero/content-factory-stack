#!/usr/bin/env node

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const host = process.env.FORUM_LINK_HEALTH_HOST || '0.0.0.0';
const port = Number(process.env.FORUM_LINK_HEALTH_PORT || 8791);
const browserName = String(process.env.FORUM_LINK_HEALTH_BROWSER || 'firefox').trim().toLowerCase();
const require = createRequire(import.meta.url);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectGlobalNodeModuleRoots() {
  const roots = new Set();
  const cliCandidates = unique([
    process.env.PLAYWRIGHT_CLI,
    path.join(process.env.HOME || '', '.local', 'bin', 'playwright'),
    'playwright'
  ]);
  try {
    roots.add(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim());
  } catch {}
  const npxDir = path.join(process.env.HOME || '', '.npm', '_npx');
  if (fs.existsSync(npxDir)) {
    for (const entry of fs.readdirSync(npxDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const packageName of ['playwright', 'playwright-core']) {
        const packageRoot = path.join(npxDir, entry.name, 'node_modules', packageName);
        if (fs.existsSync(path.join(packageRoot, 'package.json'))) {
          roots.add(path.dirname(packageRoot));
        }
      }
    }
  }
  for (const cliPath of cliCandidates) {
    try {
      const listOutput = execFileSync(cliPath, ['install', '--list'], { encoding: 'utf8' });
      for (const line of listOutput.split('\n')) {
        const indented = line.match(/^\s+(\/.+node_modules\/playwright(?:-core)?)\s*$/);
        if (indented?.[1]) roots.add(path.dirname(indented[1].trim()));
      }
      break;
    } catch {}
  }
  return [...roots].filter(Boolean);
}

async function loadPlaywright() {
  for (const specifier of ['playwright', 'playwright-core']) {
    try {
      const mod = await import(specifier);
      return mod;
    } catch {}
  }
  for (const root of detectGlobalNodeModuleRoots()) {
    for (const specifier of ['playwright', 'playwright-core']) {
      try {
        const resolved = require.resolve(specifier, { paths: [root] });
        return await import(pathToFileURL(resolved).href);
      } catch {}
    }
  }
  throw new Error('Could not resolve Playwright for forum link health service');
}

function normalizeUrl(input) {
  try {
    return new URL(String(input || '').trim()).toString();
  } catch {
    return '';
  }
}

function deadReason(platform, haystack, status) {
  const phrases = [
    'page not found',
    'post not found',
    'thread not found',
    'content not found',
    'this page is unavailable',
    'doesn’t exist',
    'does not exist',
    'not available'
  ];
  if (platform === 'quora') phrases.push('we could not find that page', '404');
  if (platform === 'reddit') phrases.push('sorry, nobody on reddit goes by that name', 'removed by reddit');
  const phrase = phrases.find((value) => haystack.includes(value));
  if (phrase) return phrase.replace(/\s+/g, '_');
  if (typeof status === 'number' && status >= 400) return `http_${status}`;
  return '';
}

let browserPromise;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const playwright = await loadPlaywright();
      const launcher = browserName === 'chromium'
        ? (playwright.chromium || playwright.default?.chromium)
        : (playwright.firefox || playwright.default?.firefox || playwright.chromium || playwright.default?.chromium);
      if (!launcher) throw new Error(`No Playwright launcher available for ${browserName}`);
      return launcher.launch({
        headless: true,
        args: browserName === 'chromium' ? ['--no-sandbox'] : []
      });
    })();
  }
  return browserPromise;
}

async function checkUrl(url, platform) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return { live: false, status: 'missing', finalUrl: '', reason: 'missing_url', platform };
  }

  const browser = await getBrowser();
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0'
  });

  try {
    const response = await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200).catch(() => {});
    const status = response?.status?.() ?? 0;
    const finalUrl = page.url() || normalized;
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const haystack = [title, finalUrl, bodyText.slice(0, 4000)].join(' ').toLowerCase();
    const reason = deadReason(platform, haystack, status);
    const live = !reason && (status === 0 || (status >= 200 && status < 400));
    return {
      live,
      status: status || 0,
      finalUrl,
      reason: live ? 'reachable' : reason || 'unreachable',
      platform
    };
  } catch (error) {
    return {
      live: false,
      status: 0,
      finalUrl: normalized,
      reason: error?.name === 'TimeoutError' ? 'timeout' : 'navigation_failed',
      platform
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (url.pathname === '/health') return sendJson(res, 200, { ok: true });
  if (url.pathname === '/forum-link-checks') {
    try {
      const redditUrl = url.searchParams.get('reddit_url') || '';
      const quoraUrl = url.searchParams.get('quora_url') || '';
      const [reddit, quora] = await Promise.all([
        checkUrl(redditUrl, 'reddit'),
        checkUrl(quoraUrl, 'quora')
      ]);
      return sendJson(res, 200, { reddit, quora });
    } catch (error) {
      return sendJson(res, 500, { error: String(error?.message || error) });
    }
  }
  return sendJson(res, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`Forum link health service listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      const browser = await browserPromise;
      await browser.close().catch(() => {});
    } catch {}
    server.close(() => process.exit(0));
  });
}
