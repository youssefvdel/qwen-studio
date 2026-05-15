# MCP Server Setup for qwen-studio

## Overview

qwen-studio comes with **qwen-core** MCP server pre-configured with 40 tools including:

- Filesystem operations (read, write, list, search, delete)
- Git operations (status, diff, commit, add, log)
- Web access (fetch, search)
- System commands
- Sequential thinking (official MCP implementation)
- And more...

## Automatic Configuration

On first launch, qwen-studio automatically creates the MCP configuration at:

```
~/.config/qwen-studio/settings.json
```

## Manual Setup (If Needed)

If you need to manually add the MCP server:

1. **Open qwen-studio Settings**
   - Click on Settings (gear icon)
   - Navigate to "MCP Servers" section

2. **Add MCP Server**
   - Click "Add MCP Server"
   - Copy the following configuration:

```json
{
  "mcpServers": {
    "qwen-core": {
      "name": "qwen-core",
      "command": "npx",
      "args": ["tsx", "/opt/qwen-studio/resources/qwen-core/src/index.ts"],
      "cwd": "/opt/qwen-studio/resources/qwen-core",
      "env": {
        "HOME": "/home/<user>",
        "USER": "<user>",
        "PATH": "/opt/qwen-studio/resources/resources/bun/linux-x64:/opt/qwen-studio/resources/resources/uv/linux-x64:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/snap/bin:/home/<user>/.local/bin",
        "MCP_ALLOWED_DIRS": "/home/<user>,/home/<user>/Projects,/tmp",
        "MCP_TIMEOUT": "60000"
      },
      "transportType": "stdio"
    }
  }
}
```

3. **Paste and Save**
   - Paste the configuration in the MCP server editor
   - Click "Save" or "Add"

4. **Verify Connection**
   - The server should show as "connected"
   - You should see 40 tools available

## Available Tools

After setup, you'll have access to these tool categories:

| Category   | Tools                                               | Examples                 |
| ---------- | --------------------------------------------------- | ------------------------ |
| File (15)  | read_file, write_file, list_directory, search_files | Read configs, write code |
| Git (5)    | git_status, git_diff, git_commit, git_add           | Version control          |
| Web (2)    | fetch_url, web_search                               | Get web content          |
| System (3) | execute_command, list_processes                     | Run shell commands       |
| Search (2) | grep_search, regex_search                           | Find text in files       |
| Time (2)   | get_current_time, parse_datetime                    | Time operations          |
| PDF (1)    | read_pdf                                            | Extract PDF text         |
| Skills (3) | list_skills, load_skill, create_skill               | Manage skills            |
| Agent (7)  | todo_write, sequential_thinking, etc.               | Planning & reasoning     |
| **Total**  | **40 tools**                                        |                          |

## Sequential Thinking Tool

The **sequential_thinking** tool is now the official MCP implementation from:
https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking

### Features:

- Dynamic thought adjustment (can increase/decrease total thoughts)
- Revision support (revisit previous thoughts)
- Branching support (explore alternative paths)
- Structured output with thought history
- Beautiful formatted console output

### Usage Example:

```
Use sequential_thinking to solve this problem:

Thought 1/5: "First, I need to understand the problem..."
Thought 2/5: "Now I'll analyze the requirements..."
Thought 3/5 (revision): "Actually, let me reconsider thought 2..."
Thought 4/5 (branch from 2, ID: alt-approach): "Alternative approach..."
Thought 5/5: "Final solution based on analysis..."
```

## Troubleshooting

### MCP Server Not Connecting

1. Check if Node.js and npx are installed:

   ```bash
   node --version
   npx --version
   ```

2. Verify qwen-core dependencies:

   ```bash
   cd /opt/qwen-studio/resources/qwen-core
   npm install
   ```

3. Test qwen-core manually:
   ```bash
   cd /opt/qwen-studio/resources/qwen-core
   npx tsx src/index.ts
   ```
   Should show: "✅ Ready - 40 tools + 3 prompts loaded"

### Tools Not Appearing

1. Restart qwen-studio completely
2. Check MCP server status in settings
3. Verify settings.json exists and contains qwen-core config

### Network Error on MCP Page

The MCP settings page may show a network error - this is expected. The web app tries to connect to the cloud backend, but our local Electron implementation handles everything. **Tools will still work** even if the page shows an error.

## Configuration File Location

```
~/.config/qwen-studio/settings.json
```

This file contains your MCP server configuration and is automatically managed by qwen-studio.

## Security Notes

- `MCP_ALLOWED_DIRS`: Controls which directories MCP tools can access
- `MCP_TIMEOUT`: Maximum execution time for tools (in milliseconds)
- Modify these values in settings.json if needed

## Updates

qwen-core is bundled with qwen-studio and updates automatically when you update the app.

---

**Need Help?**

Check the logs at:

```bash
tail -f /tmp/qwen-studio-debug.log
```

Or report issues at: https://github.com/<user>>/qwen-studio/issues

## Autonomous Agent Capabilities

qwen-core now includes **autonomous agent** capabilities similar to Claude Code and opencode.

### Available Agent Tools

| Tool                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `autonomous_agent`    | Execute dev tasks with auto build/test/fix cycles |
| `error_memory_status` | View learned errors and fixes                     |
| `clear_error_memory`  | Clear error memory (resets learnings)             |

### How It Works

1. **Task Planning**: Uses sequential thinking to plan approach
2. **Build & Test**: Automatically runs build and test commands
3. **Error Detection**: Catches and analyzes build/test failures
4. **Fix Attempts**: Generates and applies fix suggestions
5. **Error Memory**: Remembers all errors to never repeat mistakes
6. **Max Effort**: Uses comprehensive analysis for complex problems

### Usage Example

```
Use autonomous_agent to fix failing tests:

{
  "tool": "autonomous_agent",
  "arguments": {
    "task": "Fix all failing tests in the project",
    "workspaceRoot": "/home/user/project",
    "buildCommand": "npm run build",
    "testCommand": "npm test",
    "maxIterations": 10
  }
}
```

### Error Memory System

The agent maintains a memory of all encountered errors:

- **Never repeats failed fixes** - If a fix didn't work before, it tries a different approach
- **Learns from patterns** - Similar errors trigger recall of past solutions
- **Persistent across sessions** - Error memory persists until cleared

### Max Effort Mode

When enabled (default), the agent:

- Runs comprehensive code analysis
- Searches codebase for similar issues
- Reviews git history for recent changes
- Uses multiple debugging strategies
- Never gives up until all options exhausted

### Agent Workflow

```
🤖 [Autonomous Agent] Starting task: Fix failing tests
📁 Workspace: /path/to/project
🔄 Max iterations: 10
⚡ Max effort: true

📋 [Planning Phase]
Task: Fix failing tests
⚠️ [Warning] Found 2 similar past errors
💡 Learnings from past attempts...

🔁 [Iteration 1/10]
🔨 [Running Build]
Command: npm run build
✅ Build successful

🧪 [Running Tests]
Command: npm test
❌ Tests failed: 3 tests failing
📝 [Error Recorded] Total: 1

🔧 [Attempting Fix]
Error type: test
💡 [Fix Suggestions]: 5 options
1. Review test expectations vs implementation
2. Check for async/await issues
3. Increase timeout...
✅ Fix applied successfully

🔁 [Iteration 2/10]
... (continues until success or max iterations)

✅ [Task Completed Successfully]
```

### Configuration

The agent can be configured with:

- `workspaceRoot`: Project directory
- `buildCommand`: Custom build command
- `testCommand`: Custom test command
- `maxIterations`: Maximum fix attempts (1-50)
- `enableMaxEffort`: Enable comprehensive analysis (default: true)

---

**Note:** The autonomous agent works best when combined with other qwen-core tools like `sequential_thinking`, `read_file`, `write_file`, and `execute_command`.
