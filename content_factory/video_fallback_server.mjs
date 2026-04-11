#!/usr/bin/env node

import http from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.VIDEO_FALLBACK_PORT || 8787);
const HOST = process.env.VIDEO_FALLBACK_HOST || '0.0.0.0';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function runDockerFallback(payload) {
  const args = [
    'exec',
    'n8n',
    'node',
    '/files/video_fallback_upload.mjs',
    `--source-image-url=${payload.sourceImageUrl || ''}`,
    `--source-video-url=${payload.sourceVideoUrl || ''}`,
    `--source-title=${payload.sourceTitle || ''}`,
    `--source-link=${payload.sourceLink || ''}`,
  ];

  return new Promise((resolve, reject) => {
    execFile('docker', args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      const output = String(stdout || '').trim();
      if (!output) {
        reject(new Error('No output from video fallback generator'));
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch (parseError) {
        reject(new Error(`Failed to parse generator output: ${parseError.message}\n${output}`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/generate-video') {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    raw += chunk;
  });

  req.on('end', async () => {
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (error) {
      sendJson(res, 400, { ok: false, error: `Invalid JSON body: ${error.message}` });
      return;
    }

    try {
      const result = await runDockerFallback(payload);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`video fallback helper listening on http://${HOST}:${PORT}`);
});
