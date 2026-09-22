# Marketer's kit

Six skills the Marketer seed is born with, copied into `.agents/skills/` in its own folder
when it is created. They are listed to that bot alone.

A trimmed copy of [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
at `5b2c0007766c6a1cf1d53fd8fc73e979e0821022` (MIT, see [LICENSE](LICENSE)). Update it by copying
upstream again and repeating the cuts below, not by editing it here.

| Skill | Upstream |
|---|---|
| `product-marketing` | `skills/product-marketing` |
| `copywriting` | `skills/copywriting` |
| `launch` | `skills/launch` |
| `social` | `skills/social` |
| `emails` | `skills/emails` |
| `seo-audit` | `skills/seo-audit` |

## What was cut or changed

- **Descriptions** rewritten to two sentences: what the skill is, in under 90 characters that stand
  alone, then when to use it. A bot's prompt carries each in full on every step. `social` says "plan
  the calendar" rather than "schedule" — nothing here posts on a schedule.
- **The product brief** moved from `.agents/product-marketing.md` to `memory/product-<product>.md`
  in the bot's own folder, one file per product, its first line naming the product. The workspace
  root is not writable by a bot, one person may market more than one thing, and a file in the
  bot's memory is listed in its prompt on every job, so a later job sees the brief is there
  without being told to look. Every "check for product marketing context" line points there,
  and `product-marketing` drafts from public pages rather than a codebase.
- **Pointers to skills that do not ship here** removed: the *Related Skills* lists keep only kit
  members, and inline mentions of `copy-editing` and `ai-seo` are gone. A named skill a bot cannot
  load sends it looking for one to install.
- **Tool registries** removed (`emails` *Tool Integrations*, the Introw link in `launch`): they
  link to files outside the skill.
- **Social listening** removed (`social/references/listening.md` and its sources template): it is
  written for another agent's browser and folder layout.
- Not taken: `evals/` folders, and the `ads`, `ad-creative` and `competitor-profiling` skills,
  which assume ad-platform accounts or paid data APIs.

## Changed for this app

The bodies are upstream's. These lines are where upstream assumed something this app does not have;
repeat each one after a fresh copy.

- **Tools the bot holds.** `seo-audit` named `web_fetch` and a "Browser tool". A bot here has a web
  search that returns text excerpts and never markup, `bash`, and the browser through
  `playwright-cli` in that shell. The schema-detection section and the note beside the tool list say
  that, and the check is one `playwright-cli --raw eval` command.
- **One question, not an interview.** A question reaches the user through Thursday and the bot runs
  nothing until it is answered, so `product-marketing`'s "one section at a time" is gone: read what
  the public pages say, then ask what only the user knows in one question with the sections as its
  parts. The other five keep their question lists with one line saying the same, and the second list
  at the end of `social`, `emails` and `seo-audit` is marked as parts of that one question rather
  than a second round.
- **Collecting posts.** `social`'s reverse-engineering step asked for 500-1000+ posts through Apify
  or Phantom Buster. It reads what the browser can reach instead — the latest 20-30 posts on each of
  10-20 accounts — and writes down how many posts, how many accounts and what period, which the
  checklist asks for too. The method after collection is unchanged.
- **Named services are sites, not tools.** `launch` keeps SparkToro, Listen Notes and Navattic as
  pages to open and search, or as a step for the user where an account is needed.
- **The memory listing is a switch.** The five skills that point at `memory/product-<product>.md` say
  to look in `memory/`, because the listing they relied on is drawn only while the user keeps bot
  memory on.
- **No pointer into another skill's folder.** `copywriting/references/natural-transitions.md` ended
  by sending the bot to a file of `seo-audit`'s; `load_skill` lists only the files of the skill that
  was called.
