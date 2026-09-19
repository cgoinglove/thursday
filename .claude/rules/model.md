---
paths:
  - "features/ai/**"
  - "features/memory/memory.edit.ts"
---

# What the model sees

```
features/ai/              Everything the model sees. Composes domain query/schema into prompts and tools.
  tools/<d>.tool.ts       The tools one domain answers (memory, bot, workspace, mcp, …): name, description,
                          args, execute. Execute calls the domain query.
  tools/tool-name.ts      Every name the model sees. Tools and prompts both import from here.
  prompts/live.prompt.ts         What the Live voice hears: who Thursday is; under `## Always` the ending
                                 rule, the guide's backchannel and interruption policies and a short
                                 delegation policy (everything but conversation goes to the backend,
                                 what they say about themselves included); what she knows about the user.
                                 No capabilities, procedures, earlier calls, or tool names but `end_call`.
  prompts/thursday.prompt.ts     What the call's Responses backend hears: who Thursday is, memory with ids,
                                 roster and threads, the machine, what to return (on a call in writing,
                                 an answer to read instead), earlier calls with their jobs.
  prompts/bot.prompt.ts          Everything a bot hears. Shares no text with the call prompt.
  prompts/memory-edit.prompt.ts  Everything an edit typed on the Memory screen hears.
  prompts/call-standing.ts       The jobs open as a call starts, put into the conversation once rather
                                 than into a prompt: what is true only at that moment, in facts.
  prompts/call-last.ts           The call before this one — when, how long, its last words — put in the
                                 same way but ahead of the greeting: the voice's prompt holds no earlier
                                 calls, and this is what lets her open as someone who remembers.
  prompts/prompt-helper.ts       Row-to-line formatters, a few thresholds, and the identity both call
                                 prompts open with.
  load-tools.ts           Which runtime holds which tools (ToolRun: the call, a bot, a memory edit).
  model.ts / model.schema.ts   Which model runs, and how it is built.
  components/             The model's own controls: model picker and browser, provider icons.
```

- **Tool names come from one file.** `features/ai/tools/tool-name.ts` is the source. Tools and prompts
  import it, and so does code that reads stored tool calls back (`thread.query`, the call screen's
  `tool-line`); nobody types a tool name as a string.
- **Prompts are split by runtime, not by chapter.** Each prompt file loads its own data and exports
  one function. Shared helpers only format rows; they never decide what to say. Tool descriptions say
  *what* a tool is; prompts say *when* to use it. Prompts are assembled per session, never cached.
- **A call tool does one thing and every argument is required.** The backend model is a cheap one: a
  tool with an action and optional fields is where it put text in the wrong field or sent a
  follow-up as new work. So the call's hands on threads are a family (`thread_start`, `thread_tell`,
  `thread_answer`, `thread_status`, `thread_cancel`, `thread_show`, `thread_seen`), what the server
  can find it finds (which question a bot's answer belongs to), and what a tool returns names the
  next step. To a model it is a *thread* everywhere; to the user it is a label and a bot.
- **A tool two runtimes share names no tool in what it returns.** `memory_recall` answers the call
  and a bot. Past `MEMORY_LIMITS.factsPerNote` it says the note has outgrown its size and to ask the
  user what to drop — the ask, which both can act on, never the mechanism: how to settle it with the
  user is the call prompt's to say.
- **A picture reaches a model through one tool.** `look_at` (`tools/look.tool`) answers with the
  image itself: `execute` returns a small record — the path, never the bytes — which is what
  is stored and drawn, and `toModelOutput` turns it into the picture for the run that asked.
  So a row stays a line, and a resumed thread reads that a picture was looked at rather than
  carrying it again. A bot holds it only when its provider carries an image inside a tool
  result (`model.ts` `seesToolImages`); a call in writing holds it too, a spoken one cannot —
  its backend is answered through the page, in text. Past `LOOK.maxBytes` it says how to make
  a smaller copy instead of sending one.
