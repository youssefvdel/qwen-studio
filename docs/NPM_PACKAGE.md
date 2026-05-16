# 📦 qwen-core npm Package

**qwen-core** is now available as an npm package!

https://www.npmjs.com/package/qwen-core

---

## Installation

### Global Install (Recommended)

```bash
npm install -g qwen-core
```

### Local Install

```bash
npm install qwen-core
```

---

## MCP Configuration

### Minimal Config (Recommended)

```json
{
  "mcpServers": {
    "qwen-core": {
      "command": "npx",
      "args": ["-y", "qwen-core"]
    }
  }
}
```

That's it! Defaults handle everything:
- **Allowed dirs:** `~`, `~/Projects`, `/tmp`
- **Timeout:** 60s (auto-adjusts per tool)

---

## Comparison with Other MCP Servers

| Server | Config |
|--------|--------|
| **qwen-core** | `npx -y qwen-core` |
| word-document-server | `uvx --from office-word-mcp-server word_mcp_server` |
| fetch | `npx -y @modelcontextprotocol/server-fetch` |

All use the same simple pattern: `command` + `args`.

---

## Testing

```bash
# Test global install
npx -y qwen-core

# Expected output:
# 🌐 qwen-core v2.0.0 starting...
# ✅ Ready - 39 tools + 3 prompts loaded
```

---

## Package Info

- **Name:** qwen-core
- **Version:** 2.0.3
- **Size:** 60KB (228KB unpacked)
- **Tools:** 39 tools + 3 prompts
- **Dependencies:** 8 packages
- **License:** MIT
- **Repository:** https://github.com/youssefvdel/qwen-core
- **npm:** https://www.npmjs.com/package/qwen-core
- **Features:** Dynamic timeout, path validation, skill loading

---

## Updating

```bash
# Update global package
npm update -g qwen-core

# Or force latest
npm install -g qwen-core@latest
```

---

## Defaults

| Setting | Default | Configurable |
|---------|---------|--------------|
| **Timeout** | Dynamic per operation | `MCP_TIMEOUT` (global cap) |
| **Allowed dirs** | `~`, `~/Projects`, `/tmp` | `MCP_ALLOWED_DIRS` |

### Timeout Estimation

Each operation gets a smart timeout based on:

| Operation | Base Timeout | Factors |
|-----------|-------------|---------|
| File read/write | 5s | Content size (1x-3x) |
| File edit | 5s | Content size (1x-3x) |
| Bash (quick: ls, cat) | 7.5s | Command type |
| Bash (build: npm run build) | 45s | Command type |
| Bash (install: npm install) | 60s | Command type |
| Bash (test: npm test) | 30s | Command type |
| Grep search | 15s | Search depth (1x-3x) |
| Glob search | 10s | Recursive (1x-3x) |
| Web fetch | 15s | URL type (1x-3x) |
| Git operations | 20s | Fixed |

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `MCP_ALLOWED_DIRS` | Override allowed directories | `/home/user,/tmp` |
| `MCP_TIMEOUT` | Global timeout cap (ms) | `60000` |

**Example config with env vars:**

```json
{
  "mcpServers": {
    "qwen-core": {
      "command": "npx",
      "args": ["-y", "qwen-core"],
      "env": {
        "MCP_ALLOWED_DIRS": "/home/youssefvdel,/tmp",
        "MCP_TIMEOUT": "60000"
      }
    }
  }
}
```

---

## Troubleshooting

### Error: "command not found"

```bash
# Verify global install
npm list -g qwen-core

# Reinstall if needed
npm install -g qwen-core
```

### Error: "timeout"

Timeouts are handled dynamically per tool. If a specific operation needs more time, the tool will auto-adjust.

### Check Logs

```bash
# View qwen-studio logs
tail -f ~/.config/qwen-studio/logs/main.log | grep MCP
```

---

**Created:** 2026-05-15  
**Updated:** 2026-05-15 (v2.0.1)  
**Author:** youssefvdel
