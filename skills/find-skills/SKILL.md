---
name: find-skills
description: "Find and install a skill from the open registry. Use when a job needs a method you don't have yet."
---

# Find skills

`npx skills` is the package manager for the open skill registry
(https://skills.sh). Search it, install what this job needs, and use it.

## In this app

Everything the app has to say about installing skills is here; the prompts do
not repeat it.

**Install into the workspace, never globally.** Your shell already runs in the
workspace, and the app reads skills from `.agents/skills/` under it. A plain
`add` puts them there:

```bash
npx skills add <owner>/<repo>@<skill> -y
```

Never `-g`. That installs to the machine's own user directory, where this app
never looks — the command reports success and the skill is nowhere.

**A skill you install now is loadable next job, not this one.** Your skill list
was built when this run started, so `load_skill` does not know the new name
yet. For the rest of this job, read it yourself — the folder is the one the
install printed:

```bash
cat .agents/skills/<skill>/SKILL.md
```

**Install it, do not offer it.** The user is not at this screen; you are inside
a job someone else is holding. Pick one, install it, use it, and name it in
your report. Go back to them only when nothing fits and the job is stuck
without it.

## Finding one

```bash
npx skills find <query>              # search the registry
npx skills find <query> --owner vercel-labs
npx skills add <owner>/<repo> -l     # list what a repo holds, install nothing
npx skills list                      # what is already installed
```

Search the domain and the task together — `react performance`, `pr review`,
`invoice pdf` — not one broad word. Nothing found is an answer: say so and do
the job with what you have.

## Judge it before you install

An installed skill runs with your permissions, and nothing in the registry is
reviewed by anyone.

- **Who published it.** The vendors on https://skills.sh/official publish their
  own tools — `anthropics`, `vercel-labs`, `microsoft` and the rest. An unknown
  owner with a handful of installs is a stranger's shell script.
- **How many installs.** Thousands means it has been run by other people.
  Under a hundred means you are the one testing it.
- **What it needs to work.** Most vendor skills wrap that vendor's CLI and want
  an API key. Read its SKILL.md before you build a plan on top of it — a skill
  you cannot authenticate is no use in this job.

Writing one instead of installing one is the `skill-creator` skill, and it is
worth the steps only when the user asked for a skill.
