#!/usr/bin/env node

import http from 'node:http';
import crypto from 'node:crypto';

const clientId = process.env.REDDIT_CLIENT_ID || '';
const clientSecret = process.env.REDDIT_CLIENT_SECRET || '';
const redirectUri = process.env.REDDIT_REDIRECT_URI || 'http://127.0.0.1:8765/callback';
const userAgent = process.env.REDDIT_USER_AGENT || 'linux:content-factory-sarah-nutri:0.1.0';
const port = Number(new URL(redirectUri).port || 8765);

if (!clientId || !clientSecret) {
  console.error('Missing REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET.');
  console.error('Create a normal Reddit OAuth app and set redirect URI to:', redirectUri);
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl = new URL('https://www.reddit.com/api/v1/authorize');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('duration', 'permanent');
authUrl.searchParams.set('scope', 'identity read submit');

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', redirectUri);
  if (reqUrl.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const returnedState = reqUrl.searchParams.get('state');
  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');

  if (error || returnedState !== state || !code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('OAuth failed. Check terminal.');
    console.error({ error, returnedState, expectedState: state, hasCode: Boolean(code) });
    server.close();
    return;
  }

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });
    const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent
      },
      body
    });
    const tokenJson = await tokenResponse.json();

    res.writeHead(tokenResponse.ok ? 200 : 500, { 'Content-Type': 'text/plain' });
    res.end(tokenResponse.ok ? 'Reddit token received. Return to terminal.' : 'Token exchange failed. Check terminal.');

    if (!tokenResponse.ok) {
      console.error(tokenJson);
      server.close();
      return;
    }

    console.log('\nAdd this to /home/zacmero/projects/content-factory-stack/.env:\n');
    console.log(`REDDIT_REFRESH_TOKEN=${tokenJson.refresh_token}`);
    console.log('\nScopes:', tokenJson.scope);
    server.close();
  } catch (exchangeError) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Token exchange crashed. Check terminal.');
    console.error(exchangeError);
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Open this URL while logged in as the Sarah Nutri Reddit account:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for Reddit callback on', redirectUri);
});
