---
name: skill-creator
description: "Create a new skill or fix an existing one. Reach for this whenever the user is describing a repeatable way of working rather than a one-off task — even if the word 'skill' never comes up."
---

# Skill Creator

A skill is a folder with a SKILL.md in it. The model reads every skill's name
and description when a call starts, and reads the body only when it calls
`load_skill`. So a skill is two things written for two different moments: a
description that has to survive being skimmed in a list, and a body that only
has to be right once it is opened.

Everything below follows from that.

## Where a new skill goes

`.agents/skills/<name>/` — relative to your working directory, the workspace.
The user's own skills live there and only there (it is also where
`npx skills add` downloads to).

`../skills/` ships with the app and is under git. Do not write there. When a
name collides, the app's skill wins — a user skill with the same name is not
listed at all. To change a shipped skill, make one under a different name, and
copy the original folder as a starting point if that helps.

`bash` runs in the workspace, so a new skill's path is simply
`.agents/skills/<name>/` and a shipped skill's is `../skills/<name>/`. If
`load_skill` handed you an absolute path, use that.

## Who does the writing

Writing a skill is not one turn of a conversation. It is reading, drafting,
rewriting, and checking — minutes of work, not a sentence.

**If you are Thursday**: do the interview yourself, out loud. That part is
conversation and it is the part you are good at — one question per turn, no
lists read aloud. Then hand the whole brief to a bot with `delegate`. The bot
cannot hear the call, so the request has to carry all of the answers, the exact
target path, and the fact that it must validate before reporting. If no bot
fits, write it yourself — but say first that you are going quiet for a moment.

**If you are a bot**: the brief is in your hands. Write the files, run the
validator, and report the path and the description line you settled on — to the
user that line is the whole skill, because later it is what makes it trigger.

## The interview

Four questions are enough, and needing more is rare:

1. What should this let you do?
2. When should it trigger — what will you be saying at that moment?
3. What should come out at the end?
4. Do you already have a way in mind, or is that mine to decide?

If the procedure is already in the conversation — the user just walked through
something and said "do it like that from now on" — you already have most of
the answers. Play it back in one sentence and ask only about the gaps. Do not
interview someone who has just finished explaining.

## The description is the skill

Nothing else about a skill is loaded until it triggers, and triggering happens
on the description alone. A perfect body behind a vague description is a skill
that never runs.

Write both halves: what it does, and when to reach for it. Put in the words the
user would actually say — in the language they actually speak, not only
English. Lean toward eager. The common failure is not a skill that fires too
often; it is a skill that sits still while the model makes a mess of the job
from scratch.

Weak: `Helps with meeting notes.`
Better: `Turns a raw meeting transcript into the user's note format — decisions
first, then owners, then open questions. Use whenever the user mentions a
meeting, minutes, or a standup, or hands over a transcript and asks what to do
with it, even if they never say the word notes.`

## Writing the body

Imperative, and explain why. A model that understands the reason handles the
cases you did not think of; a model handed only a rule pushes that rule to its
end. If you are writing ALWAYS or NEVER in capitals, the reason is missing from
that sentence — write the reason instead.

Keep it under 500 lines. It is read in full every time, and a call is a live
conversation waiting on it. When it grows past that, the fix is not to cut
content but to move it:

```
<name>/
  SKILL.md          the workflow, and signposts to the rest
  references/       detail read when needed — one file per variant
  scripts/          deterministic work. Executed, not read
  assets/           templates, files that go into the output
```

Of the three, `scripts/` is the strongest. If the procedure has a step that is
the same every time, a script does it identically for free — no tokens, no
drift. Write it here once instead of having the model reinvent it every call.
Node is guaranteed (the app runs on it). Anything else may be missing.

Remember that `load_skill` returns up to 50 file paths along with the body. A
tree bigger than that is a tree with files nobody will open.

## Fixing a skill that already exists

`write_file` replaces the whole file, so read it first unless you mean to lose
what is there. Leave the name and the folder name alone — they are what the
user's earlier requests and other skills pointing here refer to. Do not edit
skills that ship with the app (`../skills/`) — make a copy under a different
name in `.agents/skills/` and edit that.

## Before you report

```bash
node ../skills/skill-creator/scripts/validate.mjs .agents/skills/<name>
```

It checks the things that fail silently: frontmatter the app cannot parse, a
name that does not match the folder, a name another skill already owns. A
folder that does not pass is not a broken skill — it is a skill the app skips
without telling anyone, which looks exactly like one that was never written.

## Not alive until the next call

The skill list is read when a session opens, so a skill written during a call
does not exist yet in this one — it is not in the list and `load_skill` cannot
find it. Do not try it and report a failure; say so plainly: it is there, it is
valid, and it is usable from the next call on.

## What this app does not do

There is no eval harness here — no A/B runs against a baseline, no benchmark
viewer, no bundling into a distributable file. When the user asks whether the
skill actually works, the honest answer is to use it on a real request in the
next call and fix it from what happens there. One real use tells you more than
assertions written with the same head that wrote the skill.

---
Adapted from Anthropic's skill-creator for this app (Apache-2.0, see LICENSE.txt).
