---
name: find-skills
description: "Finds skills in the open skills registry and installs the one the user agrees to. Use it when a job needs a specialized method no listed skill covers, or the user asks for a skill."
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem. Here you find the one the job needs, decide who gets it, ask the user before installing it, and use it.

If you are Thursday: finding and installing is a bot's work. Hand it with `thread_start` to the bot whose work the skill is for, or to any bot, with anything the user said about who should have it; that bot asks the user before it installs anything.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

And when a job you hold needs a specialized method that no skill on your Skills list covers.

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query] [--owner <owner>]` - Search for skills by keyword, optionally scoped to a GitHub owner
- `npx skills add <package> -a universal -y` - Install a skill from GitHub or other sources (Step 7 says from which folder)
- `npx skills add <owner/repo> --list` - List the skills a repository holds, without installing any

To update an installed skill, when the user asked for it or said yes as Step 6 asks, run its `add` command again from the same folder; it replaces the copy there. Not `npx skills update`: it reinstalls without `-a universal`, which can spread links into other agents' folders (Step 7).

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Check the Makers' Own Skills First

Before a broad search, check whether the maker of the tool the job is about publishes skills for it. https://skills.sh/official lists the companies and organizations that publish skills for their own products (`anthropics`, `vercel-labs`, `microsoft`, `cloudflare` and many more), and `--owner` narrows a search to one of them:

```bash
npx skills find theme --owner anthropics
```

### Step 3: Search for Skills

If the makers' own skills don't cover the need, run the find command:

```bash
npx skills find [query] [--owner <owner>]
```

For example:

- User asks "how do I make my React app faster?" → `npx skills find react performance`
- User asks "can you help me with PR reviews?" → `npx skills find pr review`
- User asks "I need to create a changelog" → `npx skills find changelog`

Each result prints as `<owner/repo@skill>` with its install count, and under it the link to its page on skills.sh.

### Step 4: Verify Quality Before Installing

**Do not install a skill based solely on search results.** An installed skill runs with your permissions on the user's computer. Always verify:

1. **Who published it.** The vendors on https://skills.sh/official publish their own tools. An unknown owner is a stranger's shell script until its repository says otherwise.
2. **Its page and its repository, not its install count.** The skill's page on skills.sh (the link under its search result) shows its repository, the repository's GitHub stars and three automated security audits: high or critical risk is a no, a warning is a reason to read closer. Then open the repository: the last commit, and what `SKILL.md` and its scripts actually do. A count of installs says only that it was fetched — one skill had half a million installs and five stars.
3. **What it needs to work.** Most vendor skills wrap that vendor's CLI and want an API key. Read its `SKILL.md` before you build a plan on top of it — a skill you cannot authenticate is no use in this job.
4. **Its license.** Open the `LICENSE` in its folder. A license that allows use only inside one company's own product is not one to install here — Anthropic's `docx`, `pptx`, `xlsx` and `pdf` skills are licensed that way, while its other skills are Apache-2.0.

Pick the one that fits best.

### Step 5: Decide Who Gets It

This is yours to decide; the request decides it when it says.

- **Only this bot:** installed in your own folder (the Environment names it), listed to you alone. Pick it when the skill serves your own line of work, and when you are unsure.
- **Every bot:** installed at the workspace root, listed to every bot and to the call. Pick it when any bot would use the skill whatever its work (a file format, a service or a tool the user meets in every kind of job), or when the user said it is for everyone.

Narrow comes first because a skill's description is read by every bot that has it on every step, and a stranger's skill runs wherever it is loaded. A skill kept to one bot moves to the workspace root later with one `mv`.

### Step 6: Ask Before Installing

An installed skill is someone else's instructions and scripts, run with your permissions on the user's computer, and public registries have carried skills that steal keys or install malware. So the user says yes to each install. Unless the user named this exact skill and asked for it to be installed, send Thursday one `send_message` with kind `question` before you install anything: what the skill does and why this job needs it, who published it, its license, what its audits found, what it needs to run (a key, a CLI), and who you decided gets it and why, with the options "Install" and "Don't install". Then end your turn. The user is not at your screen; their answer brings you back.

Example question:

```
To lay the slides out in a set of ready themes, I'd like to install "theme-factory" from anthropics/skills: Anthropic's own skill for applying a theme to a deck or a page. Apache-2.0, its three audits pass, and it needs no key. I'd keep it to myself, since only deck work uses it. Install it?
Options: Install · Don't install
```

A yes installs it where the question said; an answer that names the other place ("for every bot") installs it there. A no, or anything else such as not now or a different skill, is what you do instead; without the skill, the job goes on with what you have, and the report says what you would have installed.

### Step 7: Install It and Use It

Install where Step 5 and the answer put it, with `-a universal -y` either way:

- **Only this bot:** from your own folder.

  ```bash
  (cd <your own folder> && npx skills add <owner/repo@skill> -a universal -y)
  ```

- **Every bot:** from the workspace root, where your shell starts.

  ```bash
  npx skills add <owner/repo@skill> -a universal -y
  ```

`-a universal` installs into `.agents/skills/` under the folder the command runs from, which is where this app reads skills. Without it, `add -y` also links the skill into other agents' folders, such as `.claude/skills` when Claude Code is on this machine, which this app never reads. `-y` skips the confirmation prompts. Never `-g`: that installs into this machine's user directory, where this app never looks, so the command reports success and the skill is nowhere.

Load it as soon as it is installed: `load_skill` with the installed name finds it on disk, though your Skills list was read before the install; the list shows it from your next turn. Use it for the job, and name it in your report: what you installed, from where, and who has it and why.

## Common Skill Categories

When searching, consider these common categories:

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |
| Everyday        | recipes, budget, fitness, travel, email  |

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"

## When No Skills Are Found

If no relevant skills exist:

1. Say in your report that none was found, and what you searched for
2. Do the job with what you have, rather than asking whether to
3. Writing a skill instead is the `skill-creator` skill, worth its steps when the user asked for a skill

---

Adapted from vercel-labs/skills find-skills (MIT) at 7407f38: a bot here looks at the makers' own skills rather than the leaderboard, judges a skill by publisher, repository and audits rather than installs, decides who gets it, asks the user before installing, installs it with `-a universal` into this app's skill folders rather than globally, and uses it rather than suggesting it to the user.
