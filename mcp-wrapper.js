
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8081;
const MCP_SERVER_PATH = path.join(__dirname, 'n8n-mcp-server', 'build', 'index.js');

// Environment variables for the MCP server process
const mcpEnv = {
    ...process.env,
    N8N_API_URL: 'http://localhost:5678/api/v1',
    N8N_API_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OTg0YTliYi1mMmM5LTRjMTUtYmY3NC1jZDVmZDVjYmQ1YWQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzU5Nzk1MTg2fQ.7ui0fuFgZ0zm5xew5COKoLVbYDNl49G6Iy2M2IUtj-g',
    N8N_WEBHOOK_USERNAME: 'z4cmero@gmail.com',
    N8N_WEBHOOK_PASSWORD: 'Nuk@2202'
};

console.log('Starting MCP Wrapper...');

// Spawn the n8n-mcp-server
const mcpProcess = spawn('node', [MCP_SERVER_PATH], {
    env: mcpEnv,
    stdio: ['pipe', 'pipe', 'pipe'] // Use pipes for stdin, stdout, stderr
});

console.log(`MCP Server process spawned with PID: ${mcpProcess.pid}`);

// Log server's stdout and stderr to the wrapper's console
mcpProcess.stdout.on('data', (data) => {
    console.log(`[MCP Server STDOUT]: ${data.toString().trim()}`);
});

mcpProcess.stderr.on('data', (data) => {
    console.error(`[MCP Server STDERR]: ${data.toString().trim()}`);
});

mcpProcess.on('close', (code) => {
    console.log(`MCP Server process exited with code ${code}`);
});

mcpProcess.on('error', (err) => {
    console.error('Failed to start MCP Server process.', err);
});

// Create an HTTP server to act as a proxy
const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        console.log(`[Wrapper] Received request. Piping to MCP stdin: ${body}`);

        // Write the request body to the MCP server's stdin
        mcpProcess.stdin.write(body + '\n');

        // Pipe the MCP server's stdout back to the HTTP response
        mcpProcess.stdout.once('data', (data) => {
            console.log(`[Wrapper] Received data from MCP stdout. Sending as HTTP response.`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
        });
    });
});

server.listen(PORT, () => {
    console.log(`MCP Wrapper server listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down wrapper and MCP server...');
    server.close();
    mcpProcess.kill();
    process.exit();
});
