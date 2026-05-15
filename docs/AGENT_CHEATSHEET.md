# ⚡ Agent Quick Reference Card

> **Print this. Keep it visible. Use it constantly.**  
> For: qwen-core v2.0.0 autonomous agents

---

## 🎯 Golden Rules (MEMORIZE)

```
1. NEVER explain what you'll do — USE TOOLS IMMEDIATELY
2. ALWAYS read_file before edit_file
3. ALWAYS verify after every change
4. Use sequential_thinking BEFORE complex actions
5. Track progress with todo_write
6. Ask_user when ambiguous — don't guess
7. Git: status → diff → add → commit (in that order)
8. Max 3 retry attempts before asking for help
```

---

## 🔧 Tool Cheat Sheet

### File Ops
```
read_file({path})                    # Read content
edit_file({path, oldText, newText})  # Search-replace (READ FIRST!)
write_file({path, content})          # Create/overwrite (makes dirs)
list_directory({path})               # See what's in folder
```

### Search
```
glob_search({pattern:"**/*.ts"})     # Find files by pattern
grep_search({pattern:"function"})    # Find content by regex
```

### Git (ALWAYS this order)
```
git_status({repoPath:"."})           # 1. See changes
git_diff({repoPath:"."})             # 2. Review
git_add({repoPath:".", files:[...]}) # 3. Stage
git_commit({repoPath:".", message:"fix: ..."}) # 4. Commit
```

### Thinking & Planning
```
sequential_thinking({                # BEFORE complex actions
  thought: "...",
  thoughtNumber: 1,
  totalThoughts: 5,
  nextThoughtNeeded: true
})

todo_write({todos:[                  # Track progress
  {content:"Step 1", status:"pending"}
]})
```

### Debugging
```
autonomous_agent({                   # Build/test/fix cycles
  task:"Fix failing tests",
  maxIterations:10
})

error_memory_status({})              # See what's been tried
clear_error_memory({})               # Reset for fresh approach
```

### System
```
execute_command({                    # Run shell commands
  command:"npm run build",
  cwd:"/project/path",
  timeout:30000
})
```

---

## 🔄 Execution Loop Template

```typescript
// 1. UNDERSTAND
glob_search({pattern:"**/*relevant*.ts"})
read_file({path:"src/main.ts"})

// 2. THINK
sequential_thinking({
  thought:"Analyzing the issue...",
  thoughtNumber:1, totalThoughts:4, nextThoughtNeeded:true
})

// 3. PLAN
todo_write({todos:[
  {content:"Identify root cause", status:"in_progress"},
  {content:"Implement fix", status:"pending"},
  {content:"Verify", status:"pending"}
]})

// 4. ACT (USE TOOLS — don't describe!)
edit_file({path:"src/main.ts", oldText:"...", newText:"..."})

// 5. VERIFY
read_file({path:"src/main.ts"})              // Confirm change
execute_command({command:"npm run typecheck"}) // Type check
execute_command({command:"npm test"})          // Run tests

// 6. COMMIT (if applicable)
git_diff({repoPath:"."})
git_add({repoPath:".", files:["src/main.ts"]})
git_commit({repoPath:".", message:"fix: ..."})

// 7. REPORT
// "✅ Fixed null pointer in auth.ts:42 — tests passing"
```

---

## 🚨 Error Handling Protocol

```
Error occurs
  ↓
sequential_thinking({thought:"Why did this fail?"})
  ↓
Check: error_memory_status({})
  ↓
If similar error before → Apply learned fix
If new error → Generate new strategy
  ↓
Attempt fix with tools
  ↓
Verify result
  ↓
If still failing (after 3 attempts) → ask_user({question:"..."})
```

---

## 🎨 Message Format (ADHD-Optimized)

```
🎯 [Phase] One-line summary
• Bullet point 1
• Bullet point 2
✅ Result / Next action
```

**Examples**:
```
🔍 [Search] Finding auth files
• Found: src/auth.ts, src/middleware/auth.ts
✅ Ready to examine implementations

🔧 [Fix] Adding null check
• Modified: src/auth.ts:42
• Added: user?.id validation
✅ Change applied — running tests...

✅ [Complete] Auth fix deployed
• Tests: 15/15 passing
• Commit: abc123 fix: add null check
• Next: Monitor logs for 24h
```

---

## ⚠️ Safety Checks (ALWAYS)

```typescript
// Before deleting:
get_file_info({path:"file.txt"})  // Verify size, dates
list_directory({path:"folder/"})   // Confirm contents
// Then: delete_file({path:"file.txt"})

// Before editing:
read_file({path:"config.json"})    // ALWAYS read first
// Then: edit_file({...})

// Before committing:
git_status({repoPath:"."})
git_diff({repoPath:"."})
// Then: git_add + git_commit

// Before killing process:
list_processes({filter:"my-app"})  // Find correct PID
// Then: kill_process({pid:12345})
```

---

## 🧩 Skills Quick Load

```typescript
// List available
list_skills({})

// Load workflow
load_skill({name:"tdd"})        // Test-driven development
load_skill({name:"git"})        // Git best practices
load_skill({name:"security-review"}) // Security audit

// Skill locations (checked in order):
// 1. ~/.agents/skills/{name}/SKILL.md
// 2. ./skills/{name}/SKILL.md
// 3. ./.qwen/skills/{name}/SKILL.md
```

---

## 📦 Production Path Helpers

```typescript
// NEVER hardcode paths — use these:
getBunPath()      // → /path/to/bun runtime
getUvxPath()      // → /path/to/uv Python manager
getQwenCorePath() // → /path/to/qwen-core server

// MCP config example:
{
  "command": getBunPath(),
  "args": ["run", getQwenCorePath()],
  "env": {"MCP_ALLOWED_DIRS": "/home/user,/tmp"}
}
```

---

## 🆘 When Truly Stuck

```markdown
🚨 [Need Input] Brief issue summary

**What I tried**:
1. ✅ [Action 1]
2. ✅ [Action 2]
3. ❌ [Action 3] — failed because: [reason]

**Options**:
A. [Option 1] — pros/cons
B. [Option 2] — pros/cons

**My recommendation**: [A or B] because [reason]

Awaiting your direction to proceed.
```

---

## ✅ Completion Checklist

```
[ ] Searched codebase (glob/grep/read)
[ ] Used sequential_thinking for planning
[ ] Tracked steps with todo_write
[ ] Used tools (not just described actions)
[ ] Verified each change (read/typecheck/test)
[ ] Git workflow complete (if applicable)
[ ] Documented changes (README/docs if needed)
[ ] Reported with file:line references
```

---

## 🧠 Mantra (Repeat Before Every Task)

```
THINK → PLAN → ACT (TOOLS) → OBSERVE → CORRECT

Tools are my hands.
No tool call = task not started.
Users want results, not explanations.
```

---

*Keep this card visible. Update as you learn. Ship with confidence.* 🚀
