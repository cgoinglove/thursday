---
name: checkup
description: Monthly checkup of how Claude Code is set up and used in this repo - what each session loads, what it costs at API prices, what drifted from the code, and what changed in Claude Code in the last month. Use when asked for a checkup of the agent setup or what the sessions cost, or when the monthly checkup reminder is due.
---

The setup only stays small if something takes things out on a schedule. This is that pass.

1. Measure: `python3 .claude/skills/checkup/measure.py` (last 30 days by default, `--days N` to change). It prints context per turn, session length, sessions editing one tree at once, where edits went, the API list-price estimate by model, and the lines every session loads. The prices are a table inside the script: check them against https://platform.claude.com/docs/en/about-claude/pricing first and fix the table if they moved.
2. Drift: `python3 .claude/skills/checkup/drift.py` lists backticked names in `AGENTS.md` and `.claude/rules/` that no longer exist in the code. Each one is a rule that will be followed confidently and wrongly: fix or delete it.
3. Trim: read `AGENTS.md` and every `.claude/rules/` file against the code. Cut what the code already answers, what repeats another file, and what describes something removed. `AGENTS.md` stays a contract for contributors, in English.
4. What loads: list project and user skills, enabled plugins (`claude plugin list`) and connectors (`claude mcp list`). Anything unused for a month is a candidate to turn off in this project (`claude plugin disable -s local <name>`), not to uninstall.
5. What changed outside: one subagent reads the Claude Code changelog and docs for the last month, and what practitioners report working, and returns only what would change this setup, with dates and links.
6. Report in the user's language: this month's numbers next to the last checkup's when the user has them, each proposed removal or addition with its reason, and nothing applied until the user picks.
7. Record the run: `python3 .claude/hooks/stamp.py checkup`.
