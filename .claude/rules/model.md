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

## What breaks
- The call's cheap backend model fills the wrong field of a many-purpose tool or sends a follow-up as new work, so a tool the call holds does one thing with its arguments required (`routine` is the exception, not the template); a model leaves optional keys out, which `.nullable()` fails and `.nullish()` takes.
- A thrown error reaches the model bare, and it relays that to the user as a failure or retries blind; a failure it can fix comes back as one line naming what exists or the tool to call next.
- A tool's description and the prompt are both read on every step: what one says, repeated in the other or restating a schema, is paid for twice and drifts apart. A description says what the tool is, the prompt when to use it.
- A model falls back on refusing what its text does not say it can do: a deleted sentence that stated a capability brings the refusal back.
- Model text ships to every user and every call pays for it: a sentence, example or `IMPORTANT` added for one slip in one conversation costs them all, and stamps weaken each other.
- A tool in `TOOL_NAMES` with no glyph in `features/bot/components/bot-tool.tsx` `TOOL_ICONS` draws as a wrench, and one the call can use with no line in `features/thursday/tool-line.ts` shows as its bare name on the call screen and a phone; that line names what it touched, read or wrote, not the tool.
- A note is found by its path and its line: a second way to find one is a field the cheap model fills and never reads, and a list of rules about saving memory makes the voice too careful to save anything.

## Check
`pnpm test:memory` runs memory's tools on a real database in an empty home. After a prompt or tool change, `pnpm test:live` checks the call prompts and `pnpm test:bot` a bot's prompt and the call's tool set; then read the assembled text, not the file:

```
THURSDAY_HOME=$(mktemp -d) node --import tsx --input-type=module -e '
await (await import("./database/migrate.ts")).migrateDatabase();
const { loadThursdayPrompt } = await import("./features/ai/prompts/thursday.prompt.ts");
console.log(await loadThursdayPrompt({})); process.exit(0);'
```

In dev, every assembly logs its tokens by chapter (`logPromptSize`) and the tool set's (`logToolSize`).
