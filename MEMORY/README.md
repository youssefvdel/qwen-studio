# 🧠 Qwen Studio MEMORY

> **Persistent AI Memory for qwen-studio**  
> Based on [obsidian-memory-for-ai v3](https://github.com/jrcruciani/obsidian-memory-for-ai)

---

## Purpose

This MEMORY folder provides **persistent context** for AI agents working on qwen-studio.

**Problem:** AI assistants forget everything between sessions. Every conversation starts from zero.

**Solution:** A system of Markdown files that AI agents read at session start and update at session end. The memory gets richer with every session.

---

## Quick Start

### For AI Agents

**At session START:**
1. Read `MEMORY/working-context.md` — current state
2. Read `MEMORY/entities.md` — known entities
3. Read relevant `MEMORY/facts/{entity}/` — specific knowledge

**At session END (MANDATORY):**
1. Rewrite `MEMORY/working-context.md` — new current state
2. Append to `MEMORY/log.md` — what you did
3. File insights to `MEMORY/insights/` — valuable knowledge
4. Create facts in `MEMORY/facts/` — new durable knowledge

**See:** [[QUICK_REFERENCE.md]] for detailed protocol.

### For Humans

```bash
# View current project state
cat MEMORY/working-context.md

# See what changed recently
tail -30 MEMORY/log.md

# View all known facts
find MEMORY/facts -name "*.md" | head -20

# Search memory
rg "pattern" MEMORY/
```

---

## Structure

```
MEMORY/
├── schema.md              # Operating manual (READ FIRST)
├── entities.md            # Entity catalog
├── working-context.md     # Current state (rewritten each session)
├── log.md                 # Operations log (append-only)
├── QUICK_REFERENCE.md     # Quick start guide
│
├── schema/                # Schema definitions
│   ├── fact.schema.yaml
│   ├── event.schema.yaml
│   ├── decision.schema.yaml
│   ├── insight.schema.yaml
│   ├── predicates.yaml    # Controlled vocabulary
│   └── version.yaml       # Schema version marker
│
├── facts/                 # Atomic facts (one per file)
│   └── {entity}/
│       └── {predicate}.md
│
├── events/                # Append-only events
│   └── {YYYY-MM-DD}/
│       └── {slug}.md
│
├── decisions/             # Durable decisions
│   └── DEC-YYYYMMDD-XXX.md
│
├── insights/              # Conversation insights
│   └── {slug}.md
│
├── _views/                # Generated rollups (.gitignore'd)
├── _inbox/                # Agent write staging (.gitignore'd)
├── _ops/                  # Operation receipts (.gitignore'd)
├── _claims/               # Advisory claims (.gitignore'd)
└── _archive/              # Time-bounded facts (.gitignore'd)
```

---

## Core Principles

1. **One fact, one file** — Each `facts/{entity}/{predicate}.md` is atomic
2. **Path is primary key** — Filesystem is the index
3. **Append-only events** — Never edit past event files
4. **Working context is mutable** — Only `working-context.md` is rewritten
5. **Log is append-only** — Never edit past log entries
6. **Sources required** — Every fact cites its source file(s)

---

## File Formats

### Fact File

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

### Event File

```yaml
---
type: event
occurred_at: 2026-05-15T00:00:00Z
summary: "MEMORY system setup"
kind: action
entities: ["qwen-studio", "opencode"]
sources: ["https://github.com/..."]
---

# What happened (narrative)
```

### Working Context

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

## Operations

| Operation | Description | Frequency |
|-----------|-------------|-----------|
| **Ingest** | Read source → extract facts → `facts/` | As needed |
| **Update** | Rewrite `working-context.md`, append `log.md` | **EVERY session** |
| **Lint** | Schema validation, broken links | Weekly |
| **Archive** | Move expired facts to `_archive/` | Monthly |

---

## Git Strategy

### What to Commit

- ✅ `facts/` — Durable knowledge
- ✅ `events/` — Historical record
- ✅ `decisions/` — Decision history
- ✅ `insights/` — Valuable insights
- ✅ `working-context.md` — Current state (shows evolution)
- ✅ `log.md` — Operations history
- ✅ `schema/` — Schema definitions
- ❌ `_views/`, `_inbox/`, `_ops/`, `_claims/`, `_archive/` — In `.gitignore`

### Commit Messages

```bash
git add MEMORY/
git commit -m "MEMORY: Update session 2026-05-15 — CSP implementation progress"
git commit -m "MEMORY: Add fact — qwen-studio security-audit score"
git commit -m "MEMORY: File insight — Electron CSP patterns"
```

---

## When to Update MEMORY

| Trigger | Action |
|---------|--------|
| **End of EVERY session** | `working-context.md` + `log.md` |
| Learn new fact | `facts/{entity}/{predicate}.md` |
| Complete task | Update `working-context.md` |
| Make decision | `decisions/DEC-YYYYMMDD-XXX.md` |
| Discover insight | `insights/{slug}.md` |
| Read new doc | Ingest facts → `facts/` |
| Weekly | Lint: schema, links, stale facts |

---

## Tools (Future)

```bash
# Lint schema (TODO: implement)
python tools/lint.py

# Rebuild views (TODO: implement)
bash tools/rebuild-views.sh

# Compact inbox (TODO: implement)
bash tools/compact.sh

# Query facts (TODO: implement)
bash tools/query.sh facts --entity qwen-studio
```

---

## Examples

### View Current State

```bash
cat MEMORY/working-context.md
```

### List Facts About Entity

```bash
ls MEMORY/facts/qwen-studio/
```

### Search All Facts

```bash
rg --type yaml "entity: qwen-studio" MEMORY/facts/
```

### Recent Log Entries

```bash
tail -20 MEMORY/log.md
```

### All Entities

```bash
cat MEMORY/entities.md
```

---

## Related Documentation

- [[AGENTS.md]] — AI agent guide (includes MEMORY protocol)
- `docs/ARCHITECTURE.md` — System architecture
- `docs/SECURITY_AUDIT.md` — Security status
- `MEMORY/QUICK_REFERENCE.md` — Quick reference card

---

## Version

**Schema:** v3.0-lite (see `MEMORY/schema/version.yaml`)  
**Based on:** [obsidian-memory-for-ai](https://github.com/jrcruciani/obsidian-memory-for-ai) v3.1  
**Created:** 2026-05-15

---

*MEMORY is your project's persistent brain. Treat it well.* 🚀
