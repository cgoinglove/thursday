---
checked: 2026-09-26
paths:
  - "features/ai/{model,model.schema,chatgpt,openrouter}.ts"
  - "features/ai/components/**"
  - "features/config/**"
  - "features/connectors/**"
  - "features/ai/tools/{mcp.tool,studio.tool,search.tool,connected}.ts"
  - "app/api/{llm-model,mcp,config}/**"
---

# Models, keys and connectors

The user runs bots on the keys, ChatGPT sign-in or catalog key (the Vercel AI Gateway, OpenRouter)
they already have, picks the models that draw, film, speak and transcribe for them, and connects
MCP servers for them to use.

## Start here
- `features/ai/model.schema.ts` — text and media providers, their shelves with context and effort steps.
- `features/ai/model.ts` — a model built from a ref and a key; the default and media picks; the catalogs (`readCatalog`).
- `features/ai/chatgpt.ts` — GPT Subscription: sign-in, renewal, plan usage, the Codex request shape.
- `features/ai/openrouter.ts` — OpenRouter's list read into the gateway's words, and its key's credit.
- `features/config/config.const.ts` — every key and app-wide model pick, grouped as Settings draws them.
- `features/connectors/mcp.manager.ts` — MCP sessions, their OAuth, reconnects.
- `features/ai/tools/connected.ts` — what answers `tool_search` and `tool_call`: MCP and the studio.
- `features/ai/tools/studio.tool.ts` — image, video, speech, transcription; each once a model is picked.
- `features/ai/components/model-picker.tsx` — the model field: providers, shelves, a catalog's browser.

## How it fits
Keys, the ChatGPT sign-in and the app-wide model picks are rows of the `config` table, read through
`readConfig`, where `.env` wins. The provider records in `model.schema.ts` are the source: Settings'
key rows, the save's allow list, the picker's providers and the default-model fallback all derive
from them. Bots, a call in writing and a memory edit get their model from `model.ts`; a spoken call,
its backend included, opens on the OpenAI key through `lib/live` instead. Only a bot reaches
connected tools: its pinned ones as tools of their own, the rest through `tool_search` and
`tool_call` (`mcp.tool.ts`).

## What breaks
- A subscription sign-in other than ChatGPT's gets the user's own account closed: Claude's terms
  forbid using a Free, Pro or Max sign-in in any other product, and Google suspends accounts whose
  Gemini CLI sign-in a third-party app borrows.
- A default for a feature that costs per use (a picture, a film, speech, a transcript, a web
  search) spends a key added for one thing on a model nobody chose: such a feature runs on what the
  user picked for it or on the run's own model, and is otherwise absent. Only the model a bot or a
  call thinks with is chosen for the user (`resolveDefaultModel`, `runsOnOf` in `thursday.text.ts`).
- A text provider added to `model.schema.ts` alone saves fine, then fails on first use or quietly
  goes without search, `look_at` or its prompt cache: it also takes a case in `buildTextModel`
  (whose `default` refuses it at run time, not at compile time), its native search in
  `searchTools` where its SDK has one, a `seesToolImages` entry where its driver carries a picture
  inside a tool result, and a `promptCacheOptions` case where it caches only when asked. A media
  provider without its case in each `build…Model` for the kinds it lists goes without its studio
  tool.
- A key or token outside `CONFIG_GROUPS` (read with `readConfig`) cannot be set in Settings, and
  one named so `shellEnv` in `lib/sandbox.ts` does not strip it (`…_API_KEY`, `…_TOKEN`) reaches
  every command a bot runs once it is in `.env`.

## Check
No suite is this area's own: `pnpm test:bot` and `pnpm test:reach` fake `getTextModel`, and
`pnpm test:live` fakes `connected.ts`, so run them when those exports change. To see it, serve a
scratch copy (AGENTS.md › Running the app) and open Settings › API keys, Models and Connectors: a
model field browses a catalog provider's shelf without a key, and a preset that needs no account
connects.
