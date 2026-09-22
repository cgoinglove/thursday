---
paths:
  - "features/ai/**"
  - "features/memory/**"
  - "features/config/**"
  - "features/thursday/open-work.ts"
  - "skills/*/SKILL.md"
---

# What the model sees

```
features/ai/              Everything the model sees. Composes domain query/schema into prompts and tools.
  tools/<d>.tool.ts       The tools one domain answers (memory, bot, workspace, mcp, …): name, description,
                          args, execute. Execute calls the domain query.
  tools/tool-name.ts      Every name the model sees. Tools and prompts both import from here.
  prompts/live.prompt.ts         What the Live voice hears: who Thursday is and who she is to talk to
                                 (persona); under `## Always` the guide's backchannel and interruption
                                 policies and a short delegation policy (everything but conversation
                                 goes to the backend, ending the call and what they say about themselves
                                 included); what she knows about the user; what was said on the last
                                 calls, as reading, without the tool lines. No capabilities, procedures,
                                 threads, or tool names.
  prompts/persona.ts             Who Thursday is to talk to: the guide's Personality lines, character
                                 only, several kept to try against each other and one in use. Read by
                                 whoever talks — the voice, or the backend on a call in writing.
  prompts/thursday.prompt.ts     What the call's Responses backend hears: who Thursday is, memory with ids,
                                 roster and threads, the machine, what to return (on a call in writing,
                                 an answer to read instead), earlier calls with their jobs.
  prompts/bot.prompt.ts          Everything a bot hears. Shares no text with the call prompt.
  prompts/memory-edit.prompt.ts  Everything an edit typed on the Memory screen hears.
  prompts/call-standing.ts       The jobs open as a call starts, put into the backend's conversation once
                                 rather than into a prompt: what is true only at that moment, in facts.
                                 The voice never reads it.
  prompts/prompt-helper.ts       Row-to-line formatters, a few thresholds, and the identity both call
                                 prompts open with.
  load-tools.ts           Which runtime holds which tools (ToolRun: the call, a bot, a memory edit).
  model.ts / model.schema.ts   Which model runs, and how it is built.
  words.ts                A stretch of conversation as its words alone, rebuilt as plain messages: what
                          a long transcript is cut down to without parting a thought from its call.
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
  carrying it again. That split takes one step of its own: the sdk fills `response.messages`
  with what each tool sent the model, so a step is stored as what `execute` returned instead
  (`bot.run` `storedMessages`) — otherwise a tool answering with bytes writes them into the
  transcript and carries them into every resume. The screen draws the record through the file
  route, so a picture whose file has been swept draws as nothing (`bot-tool` `Shot`). A bot
  holds the tool only when its provider carries an image inside a tool result (`model.ts`
  `seesToolImages`); a call in writing holds it too, a spoken one cannot — its backend is
  answered through the page, in text. Past `LOOK.maxBytes` it says how to make a smaller copy
  instead of sending one. An image call works from pictures by the same rule
  (`tools/studio.tool` `generate_image`, `images`): paths in, bytes read where the tool runs,
  so what a bot changed a picture into costs its transcript a path and not a picture.

# Writing for a model

This covers everything a model reads: prompts, tool descriptions, `.describe()`, the lines put into
a call, a shipped `SKILL.md`.

- **Short, and left to the model.** A prompt forces nothing but the app's own rules (where files go,
  asking through a question message). A long explanation, or one that opens a single path, makes a
  weak model simpler and a strong one lazier. One or two lines that matter beat a list; what loses
  to the model three times becomes structure instead — a tool set, a cap, a `config.ts` knob.
- **Each thing is said once, where it is acted on.** What a tool's schema already says comes out of
  the prompt. A role prompt (Thursday, a bot) holds the role; how to sign in or pay lives in the
  skill read while doing it (`skills/browser/SKILL.md`). When a new rule would contradict a role
  prompt, the role prompt's sentence comes out rather than a rule going in.
- **No order of tools.** A prompt that said to search the web before opening a browser left a bot
  that only searched.
- **Nothing the user can switch off is a path.** A system prompt never routes through a named
  skill, a connector or a tool that hangs on a setting.
- **A prohibition makes no capability.** Before deleting a sentence, look at what it did: remove one
  that stated a capability and the model's habit of refusing takes its place (a bot turned down a
  payment four times). State capabilities as facts and leave the judgement to the bot.
- **The end is the thing asked for.** Asked to act, a run ends with the act done, not with a
  report about it.
- **The style is Claude Code's own**: short imperative English and a full `.describe()` on every
  field. No line is stamped `IMPORTANT`: the one that was (the call's ending rule) changed nothing
  the numbers could see, and marking many weakens them all.
- **Optional fields are `.nullish()`.** `.nullable()` fails hard when the key is left out, and a
  cheap model pays for it in retries (four failed tool calls in ten).
- **One mistake in one conversation is no reason.** No sentence, example or structure aims at it:
  this ships to everyone, and every call pays for it. A local database is evidence only when it
  shows a general principle is wrong.
- **Thursday hides nothing.** No line tells her to keep something from the user or to avoid a
  word: she is candid, an assistant who does what she is asked. Point out a line like that rather
  than adding another.
- **The voice already knows how to talk.** How long a turn, what to say when she did not catch
  something: GPT-Live does these on its own. The only exceptions are the guide's lines under
  `## Always`, one of them on language: the one the user is speaking, never the browser's (a first
  call opened in the browser's language kept an English speaker in Korean).
- **A taste the model keeps refusing is the user's line to write.** The character they want goes
  in Settings › Thursday › Personality — their own persona, read over the picked one and last in
  the prompt; the prompt is not pushed harder. What to call them is not a manner but a fact about
  them, so it is asked for and kept in memory, which both models read whole and which she can put
  right herself when it changes.

## Memory

- **What the call is told about writing memory is one paragraph.** A list of rules makes the voice
  careful, and a careful voice saves nothing.
- **A note is found by its path and its line, and nothing else.** No aliases, no pins: a model
  reads the listing rather than looking anything up, so a second name is a field it fills and
  never uses (30 writes sent aliases, 0 reads used one), and a fact pinned into every call is
  one that belongs under profile or preferences, which every call already reads whole. The line
  says what a note is about, never what is inside — the facts do that — and is capped
  (`MEMORY_LIMITS.descriptionChars`) because a line rewritten on every write grew into a list
  of the facts (36 to 118 characters in eight writes).
- **Memory's writes are three tools with every argument required.** `memory_create` starts a
  note with its line and first facts, `memory_remember` adds facts to one that exists,
  `memory_describe` changes a line — where one tool with optional fields had a cheap model
  filling every field it was shown. A write to a path that is not on the listing is refused
  and names the tool that makes it; nothing is filed elsewhere.
- **Profile and preferences are whole in both call prompts.** A rule is followed only when it
  is in front of the voice, and the ten newest lines with the rest counted hid the oldest
  rules first — the ones about how to speak to them. `factsPerNote` bounds those chapters.
- **No memory pass after a call, yet.** Merging is done as the call writes (`replaces`, 10 of 46
  writes), and the one pass that was tried rebuilt a note around the turn's subject and dropped
  the old lines. A pass earns its place when duplicates are counted surviving the in-call merge,
  and then it holds `memory_remember` and never `memory_forget`: the model that just worked says
  what to change, a separate call does the rewrite, and one queue keeps them in order.

# Providers

- **An expensive feature has no fallback provider.** Images, video, voice, a pass that re-reads a
  separate context, search on the user's behalf: with no model picked for it, the feature is not
  there — absent beats slow or costly. The one exception is the bots' default model, without which
  no bot runs.
- **Which steps of thinking a model takes is asked, written down, or left alone.** The gateway
  answers at run time (`reasoning_options` on its catalog row); a provider used directly carries
  its steps on its shelf row (`model.schema` `efforts`), read off that provider's own sdk — the
  table it checks a model against, the map it folds a step through — and never guessed. Unknown
  is not empty: a step a provider hands straight to its API fails the whole call, so a model
  nobody has checked runs on its own default (`runEffort`), and a step it quietly folds into
  another comes back as an sdk warning rather than an error. A step belongs to the ladder it came
  from: pick another model and the control gives it up where that model has no such step
  (`effort-switch`), so what is stored is never a step the run would drop.
- **A model's habits do not move with prompt text.** One that never writes a note on its own does
  not start because a sentence asks it to; the lever is which model runs. Before blaming a model
  for never filling a tool field, check that the test gave it the case the field is for.
- **No borrowed subscription but ChatGPT's.** Claude's terms forbid a third party keeping its tokens,
  and running on a Claude subscription at all means handing the loop to a harness or the Claude
  Code provider. Gemini's consumer sign-in from a third-party app puts the account at risk. These
  terms change often: read them again before building near them.
