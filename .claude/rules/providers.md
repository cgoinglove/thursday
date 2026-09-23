---
checked: 2026-09-24
paths:
  - "features/ai/{model,model.schema,chatgpt}.ts"
  - "features/ai/components/**"
  - "features/config/**"
  - "features/connectors/**"
  - "features/ai/tools/{mcp.tool,studio.tool,search.tool,connected}.ts"
  - "app/api/{llm-model,mcp,config}/**"
---

# Models, keys and connectors

The user runs bots on the keys, ChatGPT sign-in or gateway they already have, picks the models that
draw, film, speak and transcribe for them, and connects MCP servers for them to use.

## Start here
- `features/ai/model.schema.ts` — text and media providers, their shelves with context and effort steps.
- `features/ai/model.ts` — a model built from a ref and a key; the default and media picks; the gateway catalog.
- `features/ai/chatgpt.ts` — GPT Subscription: sign-in, renewal, plan usage, the Codex request shape.
- `features/config/config.const.ts` — every key and app-wide model pick, grouped as Settings draws them.
- `features/connectors/mcp.manager.ts` — MCP sessions, their OAuth, reconnects.
- `features/ai/tools/connected.ts` — what answers `tool_search` and `tool_call`: MCP and the studio.
- `features/ai/tools/studio.tool.ts` — image, video, speech, transcription; each once a model is picked.
- `features/ai/components/model-picker.tsx` — the model field: providers, shelves, the gateway's browser.

## How it fits
Keys, the ChatGPT sign-in and the app-wide model picks are rows of the `config` table, read through
`readConfig`, where `.env` wins. The provider records in `model.schema.ts` are the source: Settings'
key rows, the save's allow list, the picker's providers and the default-model fallback all derive
from them. Bots, a call in writing and a memory edit get their model from `model.ts`; a spoken call,
its backend included, opens on the OpenAI key through `lib/live` instead. Only a bot reaches
connected tools: its pinned ones as tools of their own, the rest through `tool_search` and
`tool_call` (`mcp.tool.ts`).

## Rules
- No subscription sign-in but ChatGPT's: Claude's terms forbid using a Free, Pro or Max sign-in in
  any other product, and Google suspends accounts whose Gemini CLI sign-in a third-party app
  borrows; read a provider's terms again before building near one — else the user's own account is
  what gets closed.
- A feature that costs per use (a picture, a film, speech, a transcript, a web search) runs on what
  the user picked for it or on the run's own model, and is otherwise absent; only the model a bot or
  a call thinks with is chosen for the user (`resolveDefaultModel`, `runsOnOf` in
  `thursday.text.ts`) — else a key added for one thing is spent on a model nobody chose.
- A new text provider also takes its case in `buildTextModel` (the `default` refuses it at run time,
  not at compile time), its native search in `searchTools` where its SDK has one, and a
  `seesToolImages` entry where its driver carries a picture inside a tool result; a media provider
  takes its case in each `build…Model` for the kinds it lists — else it saves fine, then fails on
  first use or quietly goes without search, `look_at` or its studio tool.
- A new key or token is a `CONFIG_GROUPS` entry read with `readConfig`, named so `shellEnv` in
  `lib/sandbox.ts` strips it (`…_API_KEY`, `…_TOKEN`) — else it cannot be set in Settings, or, once
  it is in `.env`, it reaches every command a bot runs.

## Check
No suite is this area's own: `pnpm test:bot` and `pnpm test:reach` fake `getTextModel`, and
`pnpm test:live` fakes `connected.ts`, so run them when those exports change. To see it, serve a
scratch copy (AGENTS.md › Running the app) and open Settings › API keys, Models and Connectors: a
model field browses the gateway's shelf without a key, and a preset that needs no account connects.
