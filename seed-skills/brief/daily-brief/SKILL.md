---
name: daily-brief
description: "A daily news brief on the user's own topics: scripts that gather fresh stories from Google News and publisher feeds, fetch each chosen story's own words and photo, fetch weather and market numbers, and lay it all out as one phone-first page with a 60-second spoken version."
---

# Daily brief

Four scripts do everything but choosing and writing. Run them from this skill's folder with
`node`; nothing to install, no browser, no key. `$SCRATCH` is this job's scratch folder.

```bash
S=<this skill's folder>/scripts
# 1. Candidates: one "<label>=<query>" per topic, in the edition the user reads
node $S/news.mjs "AI=AI OR OpenAI OR Anthropic" "Startups=startup funding" \
  --lang en --country US --hours 30 --out $SCRATCH/cand.json [--avoid a.com] [--prefer b.com]
# ...and the glance, in the same call when the user wants one
node $S/glance.mjs --weather "<their city>" --markets "S&P 500:^GSPC,EUR/USD:EURUSD=X,BTC-USD" --out $SCRATCH/glance.json
# 2. The chosen stories, read from their publishers, photos saved
node $S/story.mjs $SCRATCH/cand.json a1 a4 b2 c1 c3 --out $SCRATCH/stories
# 3. Write $SCRATCH/brief.json, then the page and one picture of it
node $S/page.mjs $SCRATCH/brief.json --look $SCRATCH/look
```

- **The ids are all you pass between steps.** `news.mjs` prints an id per story (`a1`, `b3`);
  `story.mjs` takes those ids and prints each story's own title, description and opening
  paragraphs; `brief.json` names the same ids. A url, a photo path or a number is never typed:
  the page takes them from the scripts' files.
- **What the scripts print is what you read.** `cand.json` and `stories.json` are for the
  next script; opening one costs tens of thousands of tokens and says nothing the printout
  does not. Choose by reading the list yourself — never with a script that scores it.
- **A story `news.mjs` did not print is not in the brief**, and one already in a brief of the
  last four days is left out before you see it. One marked `[closed]` is from a publisher that
  refuses to be read: pick another outlet's story on the same news. A story `story.mjs` prints
  with no text was refused too: drop it for one of your spares; with `NO PICTURE`, keep it or
  swap it.

`references/brief.md` is the format: what `brief.json` holds, how to choose, how to write a
summary and the spoken version. `references/preferences.md` is what to keep about the user and
the one question a first brief asks.
