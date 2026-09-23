---
checked: 2026-09-24
paths:
  - "features/ai/prompts/**"
  - "features/ai/tools/**"
  - "features/ai/{load-tools,words}.ts"
  - "features/memory/**"
  - "app/api/memory/**"
  - "scripts/memory-tools.test.mts"
---

# Model text and memory

Thursday and her bots work from short instructions and single-purpose tools, and what the user tells her is kept as notes she finds again on the next call.

## Start here
- `features/ai/load-tools.ts` — which runtime holds which tool (the call, a bot, a Memory-screen edit); the thread tools' executes.
- `features/ai/tools/tool-name.ts` — every tool name a model sees; tools, prompts and stored-call readers import it.
- `features/ai/prompts/thursday.prompt.ts` — the call backend's prompt; `live.prompt.ts` beside it is the voice's, `bot.prompt.ts` a bot's.
- `features/ai/prompts/prompt-helper.ts` — row and time formatters, the size log against the prompt budget, the identity both call prompts open with.
- `features/ai/tools/memory.tool.ts` — memory's read and writes as a model calls them.
- `features/memory/memory.schema.ts` — where a note may live, which notes are always listed, who wrote a fact.
- `features/memory/memory.query.ts` — notes and facts in the database, for the tools and the Memory screen alike.
- `features/memory/memory.edit.ts` — an edit typed on the Memory screen: one streamed run with memory's tools.

## How it fits
A spoken call's voice reads `live.prompt.ts`; the call's backend reads `thursday.prompt.ts` and holds the tools. Only what runs a model imports a prompt loader or `loadTools` — `thursday.action`, the tool-call route and `thursday.text` for a call, `bot.run` and `bot.runner` for a bot, `memory.edit` for an edit — while `persona.ts` and `tool-name.ts` are vocabulary any file may import. A tool that cannot work in a run is left out of the set, not disabled. Memory is merged as the call writes it (`replaces`), so no pass runs after a call. A time a model reads is local, from the `prompt-helper.ts` stamps or `whenOf`, never a `Date`, which serialises as UTC.

## Rules
- A tool the call holds does one thing with its arguments required, and an optional argument in any tool is `.nullish()`; `routine` is the exception, not the template — the cheap backend model fills the wrong field of a many-purpose tool or sends a follow-up as new work, and `.nullable()` fails whenever it leaves a key out.
- A failure the model can fix comes back as one line naming what exists or the tool to call next, never a throw — a bare error is relayed to the user as a failure, or retried blind.
- Say each thing once, where it is acted on: a tool's description says what it is, the prompt says when to use it, and what a schema already says comes out of the prompt — two copies drift apart, and every step pays for both.
- State what a model can do as a fact, and before deleting a sentence check whether it stated a capability — with it gone, the model's habit of refusing takes its place.
- One slip in one conversation earns no sentence, example or `IMPORTANT`; what keeps losing to the model becomes structure (a tool set, a cap, a `config.ts` constant) — model text ships to every user, every call pays for it, and stamps weaken each other.
- A tool added to `TOOL_NAMES` gets its glyph in `features/bot/components/bot-tool.tsx` `TOOL_ICONS`, and one the call can use gets its line in `features/thursday/tool-line.ts`, naming what it touched, read or wrote rather than the tool — without them its glyph is a wrench and the call screen and a phone show the bare tool name.
- A note is found by its path and its line, nothing else, and what the call is told about saving memory stays short — a second way to find a note is a field the cheap model fills and never reads, and a list of rules makes the voice too careful to save anything.

## Check
`pnpm test:memory` runs memory's tools on a real database in an empty home. After a prompt or tool change, `pnpm test:live` checks the call prompts and `pnpm test:bot` a bot's prompt and the call's tool set; then read the assembled text, not the file:

```
THURSDAY_HOME=$(mktemp -d) node --import tsx --input-type=module -e '
await (await import("./database/migrate.ts")).migrateDatabase();
const { loadThursdayPrompt } = await import("./features/ai/prompts/thursday.prompt.ts");
console.log(await loadThursdayPrompt({})); process.exit(0);'
```

In dev, every assembly logs its tokens by chapter (`logPromptSize`) and the tool set's (`logToolSize`).
