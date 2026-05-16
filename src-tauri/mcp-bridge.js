/**
 * MCP Bridge - Uses official @ali/spark-mcp package
 * Communicates with Tauri via stdin/stdout JSON-RPC
 */
const { Proxy } = require('@ali/spark-mcp');
const mcpProxy = new Proxy();

function sendResponse(id, result) {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${response.length}\r\n\r\n${response}`);
}

function sendError(id, message) {
  const response = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } });
  process.stdout.write(`Content-Length: ${response.length}\r\n\r\n${response}`);
}

async function handleMessage(message) {
  try {
    const { id, method, params } = JSON.parse(message);
    
    switch (method) {
      case 'mcp_client_connect': {
        const config = params.config || {};
        await mcpProxy.setMCPServers(config);
        sendResponse(id, { connected: Object.keys(config).length });
        break;
      }
      
      case 'mcp_client_close': {
        mcpProxy.clients = {};
        sendResponse(id, { closed: true });
        break;
      }
      
      case 'mcp_client_get_config': {
        const config = mcpProxy.getMCPServers();
        sendResponse(id, config);
        break;
      }
      
      case 'mcp_client_update_config': {
        const config = params.config || {};
        await mcpProxy.setMCPServers(config);
        sendResponse(id, mcpProxy.getMCPServers());
        break;
      }
      
      case 'mcp_client_tool_list': {
        const { serverName } = params;
        const result = await mcpProxy.listTools({ serverName });
        sendResponse(id, result);
        break;
      }
      
      case 'mcp_client_tool_call': {
        const { serverName, toolName, toolArguments } = params;
        const result = await mcpProxy.callTool({ serverName, toolName, toolArguments });
        sendResponse(id, result);
        break;
      }
      
      default:
        sendError(id, `Unknown method: ${method}`);
    }
  } catch (error) {
    process.stderr.write(`[MCP Bridge] Error: ${error.message}\n`);
    sendError(id || 0, error.message);
  }
}

let buffer = '';
let contentLength = 0;
let readingBody = false;

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  
  while (buffer.length > 0) {
    if (!readingBody) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      
      const header = buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.substring(headerEnd + 4);
        continue;
      }
      
      contentLength = parseInt(match[1], 10);
      buffer = buffer.substring(headerEnd + 4);
      readingBody = true;
    }
    
    if (buffer.length >= contentLength) {
      const body = buffer.substring(0, contentLength);
      buffer = buffer.substring(contentLength);
      readingBody = false;
      contentLength = 0;
      
      handleMessage(body).catch(err => {
        process.stderr.write(`[MCP Bridge] Unhandled: ${err.message}\n`);
      });
    } else {
      break;
    }
  }
});

process.stderr.write('[MCP Bridge] Started\n');
