# Analyst's kit

One skill the Analyst seed is born with, copied into `.agents/skills/` in its own folder when it is
created. It is listed to that bot alone.

| Skill | What it adds |
|---|---|
| `data-report` | Seven report forms, each with its structure and a filled example; `fetch.mjs`, which pulls a published series (FRED, World Bank, Yahoo Finance, ECB rates, SEC filings, Wikipedia pageviews) into a CSV that names its source |

Written for this app. The forms borrow their shape from answer-first business writing and from the
report outlines in [anthropics/financial-services](https://github.com/anthropics/financial-services)
and [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
(Apache-2.0); no text is copied from either. Those skills write Word, PowerPoint and Excel files and
read paid data connectors, which is why they are not taken whole.

Charts are drawn by the shipped `interactive-page` skill's `chart.mjs` into its quick page. The
scripts need Node and no packages. Every source they call answers without a key; `references/sources.md` names the
ones that need one.
