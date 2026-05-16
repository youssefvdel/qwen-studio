/**
 * MCP Proxy Server - Uses official @ali/spark-mcp package
 * Starts an HTTP server that Rust communicates with
 * Usage: node mcp-proxy-server.js <port> [resource_dir]
 */

// Resolve @ali/spark-mcp from resource directory
const path = require('path');
const resourceDir = process.argv[3] || process.env.MCP_RESOURCE_DIR || __dirname;

let Proxy;
try {
  // Try resource_dir/node_modules/@ali/spark-mcp (production)
  const sparkMcpPath = path.join(resourceDir, 'node_modules', '@ali', 'spark-mcp');
  const sparkMcp = require(sparkMcpPath);
  Proxy = sparkMcp.Proxy;
  process.stderr.write(`[MCP Proxy] Loaded from: ${sparkMcpPath}\n`);
} catch (e) {
  try {
    // Fallback: try direct require (works if script is in node_modules context)
    const sparkMcp = require('@ali/spark-mcp');
    Proxy = sparkMcp.Proxy;
    process.stderr.write(`[MCP Proxy] Loaded via direct require\n`);
  } catch (e2) {
    try {
      // Fallback: try parent directory (dev mode: src-tauri -> project root)
      const parentDir = path.resolve(resourceDir, '..');
      const sparkMcpPath = path.join(parentDir, 'node_modules', '@ali', 'spark-mcp');
      const sparkMcp = require(sparkMcpPath);
      Proxy = sparkMcp.Proxy;
      process.stderr.write(`[MCP Proxy] Loaded from parent: ${sparkMcpPath}\n`);
    } catch (e3) {
      process.stderr.write(`[MCP Proxy] Failed to load @ali/spark-mcp: ${e3.message}\n`);
      process.exit(1);
    }
  }
}

const http = require('http');

const port = process.argv[2] || 3000;
const mcpProxy = new Proxy();

// Extend the proxy with config management endpoints
const app = mcpProxy.app;

app.post('/setConfig', (req, res) => {
  const config = req.body;
  mcpProxy.setMCPServers(config)
    .then(() => res.json({ success: true, servers: Object.keys(config).length }))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/getConfig', (req, res) => {
  res.json(mcpProxy.getMCPServers());
});

app.post('/connect', async (req, res) => {
  try {
    const config = req.body.config || {};
    await mcpProxy.setMCPServers(config);
    res.json({ connected: Object.keys(config).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/close', (req, res) => {
  mcpProxy.clients = {};
  res.json({ closed: true });
});

// Override listTools to handle serverName via POST body as well
app.post('/listTools', async (req, res) => {
  try {
    const { serverName } = req.body;
    const result = await mcpProxy.listTools({ serverName });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// callTool is already handled by the proxy's app.post('/callTool')

const server = http.createServer(app);
server.listen(port, () => {
  process.stderr.write(`[MCP Proxy] Listening on port ${port}\n`);
  // Signal ready by writing to stdout
  process.stdout.write(JSON.stringify({ ready: true, port }) + '\n');
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
