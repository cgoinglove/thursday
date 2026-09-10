---
name: thursday
description: Conventions for this repo (thursday, a local-first voice agent) beyond what CLAUDE.md states. Load before changing a prompt, a tool, the bot run loop or memory (references/ai.md); a settings section, the task room or a file screen (references/ui.md); the schema or anything that writes to SQLite (references/data.md); or packaging and releases (references/ship.md).
---

# thursday internals

CLAUDE.md carries what holds everywhere — the layout, the data flow, the rules. This carries what
only matters once you are inside one area. Read the one file your change touches; do not read all four.

| Changing | Read |
|---|---|
| a prompt, a tool description, the bot loop, memory, skills a bot reads | `references/ai.md` |
| a settings section, the task room, Artifacts or Workspace | `references/ui.md` |
| `database/tables.ts`, a migration, anything writing from two places | `references/data.md` |
| `scripts/pack.mts`, `bin/`, what npm ships, a release | `references/ship.md` |

Each entry there is a decision that was made once and cost something to learn. If your change
contradicts one, that is the thing to discuss — not to quietly work around.

## Keep this true

A decision recorded here is only worth reading while it matches the code. When a change makes one
wrong, fix it in the same commit: correct the entry, or delete it if the reason is gone. A new
decision of the same kind — non-obvious, learned the hard way, costly to rediscover — is added the
same way. Do not add what the code already says plainly, and do not record a preference; these are
constraints and measurements, not taste.
