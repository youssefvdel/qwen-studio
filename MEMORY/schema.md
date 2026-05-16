# MEMORY Schema

**Version:** 3.0-lite (adapted for qwen-studio)  
**Based on:** [obsidian-memory-for-ai SPEC-v3](https://github.com/jrcruciani/obsidian-memory-for-ai/blob/main/SPEC-v3.md)

## File Types

### `fact`

Atomic factual statements about an entity.

```yaml
type: fact
entity: string (slug-case)
predicate: string (slug-case)
value: string | number | boolean
recorded_at: ISO 8601 datetime
confidence: high | medium | low
sources: [string]
valid_from: ISO 8601 date (optional)
valid_to: ISO 8601 date (optional, null = ongoing)
last_reviewed: ISO 8601 date
```

### `event`

Append-only episodic memory (sessions, decisions, actions).

```yaml
type: event
occurred_at: ISO 8601 datetime
summary: string
kind: conversation | decision | action | observation
entities: [string]
sources: [string]
```

### `decision`

Durable decisions with rationale.

```yaml
type: decision
id: DEC-YYYYMMDD-XXX
date: ISO 8601 date
context: string
decision: string
rationale: string
alternatives: string
consequences: string
```

## Path Conventions

- `MEMORY/facts/{entity}/{predicate}.md` — One fact per file
- `MEMORY/events/{YYYY-MM-DD}/{slug}.md` — Append-only events
- `MEMORY/decisions/{id}.md` — Decision records
- `MEMORY/insights/{slug}.md` — Conversation insights

## Operations

| Operation | Description | Trigger |
|-----------|-------------|---------|
| **Ingest** | Process new source → extract facts → update MEMORY | After reading docs/code |
| **Update** | Rewrite working-context.md, append to log.md | End of each AI session |
| **Lint** | Check schema validity, broken links, stale facts | Weekly or before commits |
| **Archive** | Move facts with `valid_to < today` to `_archive/` | Monthly |

## Rules

1. **One fact, one file** — Each `.md` in `facts/` contains exactly one fact
2. **Path is primary key** — `facts/{entity}/{predicate}.md` is canonical
3. **Append-only events** — Never edit past event files
4. **Working context is mutable** — Only `working-context.md` is rewritten each session
5. **Log is append-only** — Never edit `log.md` past entries
6. **Sources required** — Every fact must cite its source file(s)

---

*Schema version frozen. Changes require migration doc.*
