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

- **Descriptions** shortened to one or two sentences. A bot's prompt carries each in full on every step.
- **The product brief** moved from `.agents/product-marketing.md` to `products/<product>.md` in the
  bot's own folder, one file per product. The workspace root is not writable by a bot, and one
  person may market more than one thing. Every "check for product marketing context" line points
  there, and `product-marketing` drafts from public pages rather than a codebase.
- **Pointers to skills that do not ship here** removed: the *Related Skills* lists keep only kit
  members, and inline mentions of `copy-editing` and `ai-seo` are gone. A named skill a bot cannot
  load sends it looking for one to install.
- **Tool registries** removed (`emails` *Tool Integrations*, the Introw link in `launch`): they
  link to files outside the skill.
- **Social listening** removed (`social/references/listening.md` and its sources template): it is
  written for another agent's browser and folder layout.
- Not taken: `evals/` folders, and the `ads`, `ad-creative` and `competitor-profiling` skills,
  which assume ad-platform accounts or paid data APIs.
