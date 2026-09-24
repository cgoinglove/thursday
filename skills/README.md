# Skills that ship with the app

A skill is a folder with a `SKILL.md`. Its name and description are listed to every bot, and to
the call when Settings › Thursday › Read skills is on; its body is read when a bot loads it.
Settings › Skills lists them and switches one off. A method only one ready-made bot's trade needs
ships beside this folder instead, in `seed-skills/<that bot's name>/`, listed to that bot alone
and read where it ships; `seed-skills/retired.json` names the copies older versions made in a
bot's folder, which are not listed while they are unchanged.

What the user keeps and looks at — a document, a canvas, a picture book, a deck — is one skill,
`artifact`, the way Claude's own Docs, Design and Slides are one kind of thing with a runtime
behind them: a bot writes the content, and what draws it is the skill's `runtime/` folder — the
shell every page wears (its head, its theme, how an edit is kept, how a bot writes into it), the
document, canvas, book and deck drawings, and the camera that shoots them. `load_skill` does not
list a `runtime/` folder: a bot never opens it. `make_deck` draws with `artifact/runtime/deck`.

Scripts reach one another through `$THURSDAY_SKILLS`, which names this folder in a bot's shell. A
path under it is a promise to every skill a user or a bot installed: `browser/scripts/session.mjs`,
`serve.mjs`, `render.mjs`, `webimage.mjs`, `sheet.mjs` and `image-size.mjs`, and
`interactive-page/scripts/chart.mjs` and `page.mjs`, stay where they are. `browser/scripts/render.mjs`
and `interactive-page/scripts/page.mjs` now only run the camera and the document script the
artifact skill holds.

## Where outside work came from

- **`artifact/references/craft.md`** is adapted from Anthropic's `frontend-design` skill
  (anthropics/skills at 34040c9, Apache-2.0, terms in `artifact/LICENSE.txt`); the file's head says
  what changed. The rest of `artifact` is this app's own.
- **`artifact/runtime/vendor/marked.mjs`** is marked 16.4.2 (MIT, `marked.LICENSE.md` beside it),
  unchanged: it turns a document's Markdown into its body.
- **`interactive-page`'s app kit** (`runtime/kit`, `runtime/page`, `scripts/app.mjs`) follows Anthropic's
  `web-artifacts-builder` (Apache-2.0, `interactive-page/LICENSE.txt`): React, TypeScript, Tailwind
  CSS and shadcn/ui, bundled into one HTML file. Changed from it: vite with vite-plugin-singlefile
  builds it instead of Parcel, which could not resolve Radix's `development` export condition;
  every version is pinned by the kit's lockfile; the kit is installed once in the workspace and
  shared by every app; recharts and react-markdown are in it.
- **`interactive-page/scripts/archify`** is a trimmed copy of archify (MIT); its README says what
  was cut.
- **`find-skills`** is adapted from vercel-labs/skills' find-skills at 7407f38 (MIT, `LICENSE` in
  the folder), and **`skill-creator`** from Anthropic's skill-creator at anthropics/skills 34040c9
  (Apache-2.0, `LICENSE.txt`); each ends with a line saying what changed. Both ask who a new skill
  is for before installing or writing it: only the bot at work, or every bot.
- **`seed-skills/marketer/marketing`** is a trimmed copy of six skills of
  [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) —
  `product-marketing`, `copywriting`, `launch`, `social`, `emails` and `seo-audit` — at
  `5b2c0007766c6a1cf1d53fd8fc73e979e0821022` (MIT, `LICENSE` in the folder), merged into one skill
  that ships for the Marketer alone. Update it by copying upstream again and repeating the changes
  below, not by editing it here.
- **`data-report`**'s report forms borrow their shape from answer-first business writing and from
  the report outlines in [anthropics/financial-services](https://github.com/anthropics/financial-services)
  and [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
  (Apache-2.0); no text is copied from either.
- **`media-digest`** reads transcripts, chapters and search through
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), fetched as its release build into the
  workspace the first time it is needed; a PDF through `pdftotext` when the machine has it, else
  pypdf installed into the workspace; audio is cut with ffmpeg, or a portable build installed into
  the workspace. No code is copied from any of them.
- **`daily-brief`, `travel` and `data-report`** call sources that answer without a key (Google News
  feeds, Open-Meteo, Frankfurter and the series `data-report/references/sources.md` lists); that
  file names the ones that need one. Their scripts need Node and no packages.

### Marketing: what was cut or changed from upstream

- **Six skills merged into one, for one bot.** Every bot paid for six marketing descriptions on
  every step, and one bot uses them. `SKILL.md` holds what every job shares — the product brief
  first, one question, every claim grounded, untrusted pages, the thing itself as the end — and a
  table of which reference to read for which job. Each skill's body is `references/<skill>.md`
  and its own references `references/<skill>-<file>.md`, one level deep, each linked from
  `SKILL.md`; the five "check for product marketing context" paragraphs are that first basic.
  The description says what the six do, in under 90 characters first. `social` says "plan the
  calendar" rather than "schedule": nothing here posts on a schedule.
- **The product brief** moved from `.agents/product-marketing.md` to `memory/product-<product>.md`
  in the bot's own folder, one file per product, its first line naming the product. The workspace
  root is not writable by a bot, one person may market more than one thing, and a file in the
  bot's memory is listed in its prompt, so a later job sees the brief is there. Every "check for
  product marketing context" line points there, and `product-marketing` drafts from public pages
  rather than a codebase. The five skills that point at it say to look in `memory/` as well, because
  the listing they relied on is drawn only while the user keeps bot memory on.
- **Pointers to skills that do not ship here** removed: the *Related Skills* lists keep only these
  six, and inline mentions of `copy-editing` and `ai-seo` are gone. A named skill a bot cannot load
  sends it looking for one to install. No pointer goes into another skill's folder either
  (`copywriting/references/natural-transitions.md` ended by sending the bot to a file of
  `seo-audit`'s): `load_skill` lists only the files of the skill that was called.
- **Tool registries** removed (`emails` *Tool Integrations*, the Introw link in `launch`): they link
  to files outside the skill.
- **Social listening** removed (`social/references/listening.md` and its sources template): it is
  written for another agent's browser and folder layout.
- **Tools a bot holds.** `seo-audit` named `web_fetch` and a "Browser tool". A bot here has a web
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
  3-5 accounts chosen with the user, or posts the user pastes — and writes down how many posts, how
  many accounts and what period, which the checklist asks for too. The method after collection is
  unchanged.
- **Named services are sites, not tools.** `launch` keeps SparkToro, Listen Notes and Navattic as
  pages to open and search, or as a step for the user where an account is needed.
- Not taken: `evals/` folders, and the `ads`, `ad-creative` and `competitor-profiling` skills,
  which assume ad-platform accounts or paid data APIs.
