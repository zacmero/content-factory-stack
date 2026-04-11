#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_TMPFILES_UPLOAD_URL = 'https://tmpfiles.org/api/v1/upload';
const DEFAULT_TMPFILES_RAW_BASE = 'https://tmpfiles.org/dl';

function getArg(name, fallback = '') {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  if (!found) {
    return fallback;
  }
  const value = found.slice(prefix.length);
  if (!value || value === '""' || value === "''") {
    return fallback;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isVideoUrl(url) {
  return /\.(mp4|mov|webm|mkv)(?:$|\?)/i.test(String(url || ''));
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
    });
  });
}

async function download(url, targetPath) {
  if (!url) {
    throw new Error('Missing source URL');
  }
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: '*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
  return buffer;
}

function toPublicTmpfilesUrl(value) {
  const url = String(value || '').trim();
  if (!url) return url;
  if (url.startsWith('https://tmpfiles.org/dl/')) {
    return url;
  }
  if (url.startsWith('http://tmpfiles.org/dl/')) {
    return url.replace('http://', 'https://');
  }
  if (url.startsWith('http://tmpfiles.org/')) {
    return url.replace('http://tmpfiles.org/', `${DEFAULT_TMPFILES_RAW_BASE}/`);
  }
  if (url.startsWith('https://tmpfiles.org/')) {
    return url.replace('https://tmpfiles.org/', `${DEFAULT_TMPFILES_RAW_BASE}/`);
  }
  return url;
}

async function uploadFileToTmpfiles(filePath, uploadName, uploadMimeType) {
  const uploadUrl = process.env.TMPFILES_UPLOAD_URL || DEFAULT_TMPFILES_UPLOAD_URL;
  const uploadBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([uploadBuffer], { type: uploadMimeType }), uploadName);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tmpfiles upload failed: ${response.status} ${response.statusText}: ${text}`);
  }

  const uploaded = await response.json();
  const rawUrl = toPublicTmpfilesUrl(uploaded?.data?.url || uploaded?.url || '');
  if (!rawUrl) {
    throw new Error('Tmpfiles upload returned no public URL');
  }
  return {
    id: uploaded?.data?.id || uploaded?.id || rawUrl,
    path: rawUrl,
    url: rawUrl,
    name: uploadName,
  };
}

async function main() {
  const sourceImageUrl = getArg('--source-image-url');
  const sourceVideoUrl = getArg('--source-video-url');
  const sourceTitle = getArg('--source-title');
  const sourceLink = getArg('--source-link');

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sarah-nutri-video-'));
  const inputImagePath = path.join(workDir, 'source-image.jpg');
  const inputVideoPath = path.join(workDir, 'source-video.mp4');
  const outputVideoPath = path.join(workDir, 'sarah-nutri-fallback.mp4');

  let generatedMode = 'generated-mp4-from-image';
  let finalUploadSource = '';
  let uploadName = 'sarah-nutri-fallback.mp4';
  let uploadMimeType = 'video/mp4';

  if (sourceVideoUrl && isVideoUrl(sourceVideoUrl)) {
    await download(sourceVideoUrl, inputVideoPath);
    finalUploadSource = inputVideoPath;
    generatedMode = 'rehosted-source-video';
    uploadName = path.basename(new URL(sourceVideoUrl).pathname) || uploadName;
  } else if (sourceVideoUrl) {
    await download(sourceVideoUrl, inputVideoPath);
    finalUploadSource = inputVideoPath;
    generatedMode = 'rehosted-source-video';
    uploadName = path.basename(new URL(sourceVideoUrl).pathname) || uploadName;
  } else {
    if (!sourceImageUrl) {
      throw new Error('No source image or video URL available to synthesize a fallback video');
    }
    await download(sourceImageUrl, inputImagePath);
    await runCommand('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      inputImagePath,
      '-t',
      '8',
      '-r',
      '25',
      '-vf',
      'scale=1280:-2:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputVideoPath,
    ], workDir);
    finalUploadSource = outputVideoPath;
    uploadName = 'sarah-nutri-fallback.mp4';
  }

  const uploaded = await uploadFileToTmpfiles(finalUploadSource, uploadName, uploadMimeType);

  console.log(
    JSON.stringify({
      generatedMediaId: uploaded.id || uploaded.path || 'generated-video',
      generatedMediaPath: uploaded.path,
      generatedMediaUrl: uploaded.url,
      generatedMediaName: uploaded.name || uploadName,
      generatedMediaMode: generatedMode,
      sourceTitle,
      sourceLink,
    })
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
