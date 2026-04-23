#!/usr/bin/env node

import http from 'node:http';
import net from 'node:net';

const listenHost = process.env.BONSAI_PROXY_HOST || '0.0.0.0';
const listenPort = Number(process.env.BONSAI_PROXY_PORT || 8082);
const targetHost = process.env.BONSAI_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.BONSAI_TARGET_PORT || 8081);

const server = http.createServer((req, res) => {
  const target = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers
    },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    }
  );

  target.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bonsai_proxy_upstream_error', message: error.message }));
  });

  req.pipe(target);
});

server.on('connect', (req, clientSocket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.on('error', () => clientSocket.end());
});

server.listen(listenPort, listenHost, () => {
  console.log(`Bonsai host proxy listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
});
