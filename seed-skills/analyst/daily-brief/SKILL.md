---
name: daily-brief
description: "Builds a daily news brief: today's stories, weather and markets on one phone-first page. Use it whenever the user asks for their brief, or a routine opens a thread for one."
---

# Daily brief

Four scripts do everything but choosing and writing. They sit in this skill's `scripts/` folder and
`node` runs them; nothing to install, no key. `<scratch>` is this job's own folder under `scratch/`:
write it out in full, and set `S=` again in every bash call — each call is a new shell.

```bash
S=<this skill's folder>/scripts
# Gather, one call: every topic as "<label>=<query>", in the edition the user reads, with the
# glance beside it when they want one
node $S/news.mjs "AI=AI OR OpenAI OR Anthropic" "Startups=startup funding" \
  --lang en --country US --hours 30 --out <scratch>/cand.json [--avoid a.com] [--prefer b.com]
node $S/glance.mjs --weather "<their city>" \
  --markets "S&P 500:^GSPC,EUR/USD:EURUSD=X,BTC-USD" --out <scratch>/glance.json
# Read, one call: the stories you chose, from their publishers, photos saved
node $S/story.mjs <scratch>/cand.json a1 a4 b2 c1 c3 --out <scratch>/stories
# Their words, one call a file: story.mjs prints the `cat` line for each
cat <scratch>/stories/text-1.md
# Lay out, one call: after you have written <scratch>/brief.json yourself
node $S/page.mjs <scratch>/brief.json --look <scratch>/look
```

- **The ids are all you pass between steps.** `news.mjs` prints an id per story (`a1`, `b3`);
  `story.mjs` takes those ids; `brief.json` names the same ids. A url, a photo path or a number is
  never typed: the page takes them from the scripts' files.
- **What the scripts print is what you read — except the stories' own words.** `cand.json` and
  `stories.json` are for the next script; opening one costs tens of thousands of tokens and says
  nothing the printout does not. The articles' text is the one thing too long to print: `story.mjs`
  writes it into `text-<n>.md` files that each fit one read, and prints the `cat` line for each.
  Those files are the only source for a summary. Choose by reading the list yourself — never with a
  script that scores it.
- **A story `news.mjs` did not print is not in the brief**, and one already in a brief of the last
  four days is left out before you see it. One marked `[closed: cannot be read]` is from a publisher
  that refuses to be read: pick another outlet's story on the same news. A story `story.mjs` prints
  as `NO TEXT` was refused too: drop it for one of your spares; with `NO PICTURE`, keep it or swap it.
- **A brief is remade, not added to.** Run the whole thing again the same day and today's own page
  does not count as already told, so the same stories come up again and `page.mjs` writes over it.
- **The browser opens itself where a step needs it.** A Google News link does not hold the
  publisher's address, so `story.mjs` follows the chosen stories' links in this job's browser, and
  `--look` renders the page there. Nothing else in the kit needs one.

`references/brief.md` is the format: what `brief.json` holds, how to choose, how to write a
summary and the spoken version. `references/preferences.md` is what to keep about the user and
the one question a first brief asks.
