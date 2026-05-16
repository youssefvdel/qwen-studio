# 🧠 MEMORY Quick Reference

> **Keep this visible. Use every session.**  
> Based on [obsidian-memory-for-ai v3](https://github.com/jrcruciani/obsidian-memory-for-ai)

---

## ⚡ Session-End Ritual (MANDATORY)

**EVERY AI session MUST end with:**

```typescript
// 1. Update working context
write_file({ path: "MEMORY/working-context.md", content: "..." })

// 2. Append to log
edit_file({ path: "MEMORY/log.md", oldText: "...", newText: "..." })

// 3. File insights (if any)
write_file({ path: "MEMORY/insights/{slug}.md", content: "..." })
```

**NEVER skip this.** Your next session depends on it.

---

## 📁 File Locations

| File | Purpose | Update Pattern |
|------|---------|----------------|
| `MEMORY/working-context.md` | What matters NOW | **Rewrite every session** |
| `MEMORY/log.md` | Operations history | **Append every session** |
| `MEMORY/facts/{entity}/{predicate}.md` | Atomic facts | Create as discovered |
| `MEMORY/events/{YYYY-MM-DD}/{slug}.md` | Session events | Append-only |
| `MEMORY/decisions/DEC-*.md` | Decisions with rationale | When decisions made |
| `MEMORY/insights/{slug}.md` | Conversation insights | File valuable insights |

---

## 📝 working-context.md Template

```markdown
# Qwen Studio Working Context

**Last Updated:** 2026-05-15
**Session:** Brief description

## Active Focus
- Priority 1
- Priority 2

## Current State
- ✅ Completed
- ⚠️ In progress
- ❌ Blocked

## Recent Changes
1. Change with file:line
2. Change with file:line

## Next Steps
- Action 1
- Action 2

---
*Keep under 40 lines. Facts, not narrative.*
```

---

## 🧩 Fact File Format

```yaml
---
type: fact
entity: qwen-studio
predicate: version
value: "2.1.0"
recorded_at: 2026-05-15T00:00:00Z
confidence: high
sources: ["package.json"]
valid_from: 2026-05-15
valid_to: null
last_reviewed: 2026-05-15
---

# Human-readable description (optional)
```

---

## 🔄 When to Update

| Trigger | Action |
|---------|--------|
| **End of EVERY session** | `working-context.md` + `log.md` |
| Learn new fact | `facts/{entity}/{predicate}.md` |
| Complete task | Update `working-context.md` |
| Make decision | `decisions/DEC-YYYYMMDD-XXX.md` |
| Discover insight | `insights/{slug}.md` |
| Read new doc | Ingest → `facts/` |
| Weekly | Lint: schema, links, stale facts |

---

## ⚠️ Golden Rules

```
1. ALWAYS update MEMORY at session end
2. NEVER skip working-context.md rewrite
3. NEVER edit past log.md entries (append-only)
4. ONE fact per file (atomic)
5. SOURCES required for every fact
6. working-context.md is ONLY mutable file
7. Events are append-only (never edit)
```

---

## 🔧 Quick Commands

```bash
# View current state
cat MEMORY/working-context.md

# View facts about entity
ls MEMORY/facts/{entity}/

# Search facts
rg --type yaml "entity: qwen-studio" MEMORY/facts/

# Check recent log
tail -20 MEMORY/log.md

# List all entities
cat MEMORY/entities.md
```

---

## ✅ Session-End Checklist

Before ending session:

- [ ] Updated `MEMORY/working-context.md` with current state
- [ ] Appended to `MEMORY/log.md` with timestamp
- [ ] Filed any insights to `MEMORY/insights/`
- [ ] Created facts for new knowledge in `MEMORY/facts/`
- [ ] Git commit with message including "MEMORY"

**Example commit:**
```bash
git add MEMORY/
git commit -m "MEMORY: Update session 2026-05-15 — CSP fix progress"
```

---

## 🎨 Message Format

```
🧠 [MEMORY Update] Session end

**Updated:**
- `MEMORY/working-context.md` — Added CSP implementation
- `MEMORY/log.md` — Appended 2026-05-15 entry
- `MEMORY/facts/security-audit/status.md` — New fact

**Insights Filed:**
- `MEMORY/insights/csp-implementation.md`
```

---

*MEMORY is your project's persistent brain. Treat it well.* 🚀
