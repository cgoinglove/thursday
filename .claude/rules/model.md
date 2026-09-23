---
paths:
  - "features/ai/**"
  - "features/memory/**"
  - "skills/**/SKILL.md"
---

# What the model sees

```
features/ai/
  tools/tool-name.ts        Every tool name a model sees.
  tools/<d>.tool.ts         One subject's tools (memory, bot, workspace, routine, skills, search, look,
                            studio, signin, mcp, call, deck). Execute calls the domain query; the thread_*
                            executes are in load-tools, send_message's in bot.run.
  tools/connected.ts        What stands behind tool_search / tool_call: MCP servers and the app's studio.
  load-tools.ts             Which runtime holds which tools: the call, a bot, a memory edit.
  prompts/live.prompt.ts          The Live voice: identity, persona, `## Always`, what she knows about the
                                  user, earlier calls as reading. No procedures, threads or tool names.
  prompts/thursday.prompt.ts      The call's Responses backend: identity, memory with ids, roster and
                                  threads, this computer, what to return, earlier calls.
  prompts/call-standing.ts        The threads standing as a call opens, put into the backend's
                                  conversation once. The voice never reads it.
  prompts/persona.ts              The styles a user picks from: character only, read by whoever talks.
  prompts/bot.prompt.ts           Everything a bot hears. Shares no text with the call prompts.
  prompts/memory-edit.prompt.ts   What an edit typed on the Memory screen hears.
  prompts/prompt-helper.ts        Row formatters, clock stamps, the prompt budget, and the two blocks both
                                  call prompts share (`thursdayIdentity`, `styleLines`).
  model.ts / model.schema.ts  Providers, the models on each shelf, how a model is built and how hard it thinks.
  chatgpt.ts                The GPT Subscription provider.
  live.schema.ts            Live voices and the call's settings.
  words.ts                  A stretch of conversation as its words alone, rebuilt as plain messages.
  guide.ts                  The user's guide (`guide/`): installed at boot, one line in each prompt that reads it.
  components/               Model picker and browser, effort switch, provider marks, ChatGPT sign-in.
```

## Tools

- **Tool names come from `tools/tool-name.ts`.** Tools, prompts and code that reads stored calls back
  (`thread.query`, `tool-line`) import it; nobody types a tool name as a string.
- **Which runtime holds which tool is `load-tools.ts`, split by time, not capability.** What
  presupposes waiting (MCP, studio, a browser) is a bot's. Only the call and a memory edit write
  memory; a bot reads it. `routine` is the call's alone. A skill crosses back to the call only with
  `readSkills`.
- **A switch reaches the prompt and the tool set together.** `readSkills`, `phone` and `written` pass
  through both `loadTools` and `loadThursdayPrompt`. A tool that cannot work here is left out, not
  disabled (`look_at`, search, studio kinds, `thread_recall`, `tool_search`).
- **A tool for the call does one thing, with its arguments required.** The backend is a cheap model,
  and a tool with an action and optional fields is where it fills the wrong field or sends a
  follow-up as new work. So threads are a family (`thread_start`, `thread_tell`, `thread_answer`,
  `thread_status`, `thread_cancel`, `thread_show`, `thread_seen`), the server finds what it can
  (which question an answer belongs to), and every return names the next step. To a model it is a
  thread; to the user, a label and a bot.
- **A failure a model can fix is one line it can act on**, naming the next tool. A tool never throws
  at a model: a `publicError` becomes that line (`load-tools`).
- **A tool two runtimes share names no tool in what it returns.** `memory_recall` answers the call and
  a bot, so past `MEMORY_LIMITS.factsPerNote` it says to ask the user what to drop, never how.
- **What has a look the model keeps getting wrong is a typed tool, and the app draws it.** A deck is
  `make_deck`: layouts with fields and character caps, drawn and fitted by `skills/deck`, never
  HTML a model writes. It is the one tool whose schema is large, and it rides every step of every
  bot, so a second of its kind waits for a way to hold a tool back until a job needs it.
- **A picture reaches a model through `look_at`.** `execute` returns a small record — the path, never
  the bytes — which is what is stored and drawn, and `toModelOutput` turns it into the picture for
  the run that asked; a step is stored as what `execute` returned (`bot.run` `storedMessages`). A bot
  holds it only when its provider carries an image inside a tool result (`seesToolImages`); a call
  in writing holds it, a spoken call cannot. `generate_image` takes pictures by path the same way.

## Prompts

- **Split by runtime, not by chapter.** A loader is its prompt's table of contents: one function per
  chapter, an empty chapter returns `""`, the user's own text comes last, and it ends in
  `logPromptSize` against `PROMPT_BUDGET`. Prompts are assembled per session, never cached.
- Helpers format rows and do not decide what to say, except the blocks both call prompts share
  (`thursdayIdentity`, `styleLines`).
- Tool descriptions say what a tool is; prompts say when to use it.
- Every time a model reads is local, through `clockNow`, `callStamp` or `saidStamp`, never UTC.

## Writing for a model

This covers everything a model reads: prompts, tool descriptions, `.describe()`, the lines put into
a call, a shipped `SKILL.md`.

- **Short, and left to the model.** A prompt forces nothing but the app's own rules (where files go,
  asking through a question message). One or two lines that matter beat a list. What loses to the
  model three times becomes structure — a tool set, a cap, a `config.ts` knob.
- **Each thing is said once, where it is acted on.** What a tool's schema says comes out of the prompt.
  A role prompt holds the role; how to sign in or pay lives in the skill read while doing it. When a
  new rule would contradict a role prompt, the role prompt's sentence comes out.
- **No order of tools.** A prompt that puts one method first leaves a model using only it.
- **Nothing the user can switch off is a path.** A system prompt never routes through a named skill, a
  connector or a tool that hangs on a setting.
- **A prohibition makes no capability.** Before deleting a sentence, check whether it stated a
  capability: with it gone, the model's habit of refusing takes its place. State capabilities as
  facts and leave the judgement to the model.
- **The end is the thing asked for.** Asked to act, a run ends with the act done, not a report on it.
- **Claude Code's own style**: short imperative English, a `.describe()` on every field, optional
  fields `.nullish()` (`.nullable()` fails when the key is left out, and a cheap model pays for it in
  retries). No line stamped `IMPORTANT`: stamping many weakens them all.
- **One mistake in one conversation is no reason.** No sentence, example or structure aims at it: this
  ships to everyone and every call pays for it. A local database is evidence only when it shows a
  general principle is wrong.
- **Thursday hides nothing.** No line tells her to keep something from the user or to avoid a word.
- **The voice already knows how to talk** — how long a turn, what to say when she missed something.
  The exceptions are the guide's lines under `## Always`.
- **A taste the model keeps refusing is the user's to write**, in Settings › Thursday › Style › Your
  own, not a harder prompt. What to call them is a fact about them, kept in memory.
- **A model's habits do not move with prompt text**; the lever is which model runs. Before blaming a
  model for never filling a field, check that the test gave it the case the field is for.

## Memory

- What the call is told about writing memory stays short: a list of rules makes the voice careful,
  and a careful voice saves nothing.
- **A note is found by its path and its line, and nothing else** — no aliases, no pins. The line says
  what a note is about, never what is in it, capped at `MEMORY_LIMITS.descriptionChars`.
- **Writes are three tools with every argument required**: `memory_create`, `memory_remember`,
  `memory_describe`. A write to a path not on the listing is refused and names the tool that makes
  it. Merging happens as the call writes (`replaces`).
- `profile` and `preferences` are read whole by both call prompts, bounded by `factsPerNote`; every
  other note is a line in the listing.
- No memory pass after a call. One earns its place only once duplicates are counted surviving the
  in-call merge, and it holds `memory_remember`, never `memory_forget`.

## Providers

- `model.schema.ts` holds the providers and each shelf's models with their context and effort steps.
  `buildTextModel` (`model.ts`) is the one place a text model is built, with keys passed from config,
  never read from the environment. A new provider also takes a `seesToolImages` entry and its own
  search tool where it has one. Media providers are their own list (`MEDIA_MODEL_PROVIDERS`).
- **An expensive feature has no fallback provider.** Images, video, voice, search on the user's
  behalf: with no model picked for it, the feature is absent. The bots' default model is the one
  exception, since without it no bot runs.
- **Effort steps are asked, written down, or left alone.** The gateway answers at run time
  (`reasoning_options`); a direct provider carries its steps on its shelf row (`efforts`), read off
  its own SDK, never guessed. A model nobody has checked runs on its own default (`runEffort`).
  Picking another model gives up a step it does not have (`effort-switch`).
- **No borrowed subscription but ChatGPT's.** Claude's terms forbid a third party keeping its tokens,
  and Gemini's consumer sign-in from a third-party app puts the account at risk. Read the terms again
  before building near them.
