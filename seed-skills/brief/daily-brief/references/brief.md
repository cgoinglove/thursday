# The brief

One page the user reads in two minutes over coffee and trusts: a lead story, 3 to 7 more
grouped by their topic, each with its photo, two lines and why it matters, and a 60-second
version to hear. Four bash calls, no more: gather, read the chosen stories, write, lay out.

## Gather

One `news.mjs` call holds every topic, and `glance.mjs` rides in the same bash call.

- A topic's query is what Google News would be searched with: `OR` between names, quotes for
  a phrase, `-word` to leave something out, `site:` for one outlet. Keep the label short —
  it heads the topic's section on the page.
- The edition is the language the user reads news in: `--lang en --country US` searches
  American outlets in English, `--lang de --country DE` German ones in German. A topic about
  another country is still searched in the reader's edition, by its name in that language.
- `--hours` is the freshness window: 30 for a daily brief, so yesterday morning's story is
  still in; 72 after a weekend. Publisher feeds come in with `--feed "<label>=<rss url>"`.
- The glance takes Yahoo Finance symbols: `^GSPC` S&P 500, `^IXIC` Nasdaq, `^FTSE` FTSE 100,
  `^N225` Nikkei, `EURUSD=X` a currency pair, `BTC-USD`, `AAPL` or `005930.KS` one listing
  anywhere. `Label:symbol` names one; the weather wants a city's name.

## Choose

Read the printed list and pick the stories yourself, then pass their ids to `story.mjs` in the
order the page will show them, lead first. Every topic the user chose gets at least one story.

- **One story, one line.** Several candidates on the same news with different headlines (the
  script folds only near-identical titles): keep the one with the most outlets (`+6`) or
  from a preferred source.
- **News, not noise.** Leave out listicles, stock-pick columns, opinion, press releases
  dressed as news, "how to" pieces and anything the user said they are tired of. A number of
  outlets is a signal of weight; a single small site is worth a place only when it has
  something nobody else does.
- **The lead** is the story that matters most to this user today — not the loudest one — and
  it should have a photo.
- **Size** comes from their preferences; without one, a lead and five.
- Pass a spare for each topic too: a publisher that refuses leaves a gap, and the spare
  fills it without another call.

## Write brief.json

Write it after reading what `story.mjs` printed — the article's own words are the only
source for a summary. Never state a fact the printout does not hold.

```json
{
  "title": "Morning Brief",
  "lede": "One sentence on what today is about.",
  "lang": "en",
  "stories": "stories/stories.json",
  "glance": "glance.json",
  "lead": { "id": "a1", "kicker": "AI", "headline": "…", "summary": "…", "why": "…" },
  "items": [{ "id": "b2", "headline": "…", "summary": "…", "why": "…" }],
  "spoken": "The 60-second version, as it will be read aloud.",
  "audio": null,
  "labels": {}
}
```

`title` is the paper's name — the page prints the date above it. Paths are relative to
`brief.json`. Leave out `glance` when there is none. `items` group into
sections by the topic they were found under, in your order; `"section": "…"` on an item moves
it to another. `lang` sets dates and numbers; for a page that is not in English, `labels`
gives the page's own words in that language: `title`, `why` ("Why it matters"), `listen`
("The 60-second version"), `photo`, `made` (keep `{time}` and `{count}` in it).

- **headline** — the news in plain words, under about 70 characters. Rewrite the publisher's
  when it is a tease ("You won't believe…", a question, "Here's why"). The subject does
  something: "Samsung cuts memory output by 10%", not "Samsung's memory move".
- **summary** — two sentences at most, under 280 characters, that a person could repeat at
  lunch: what happened, with the one number or name that makes it concrete, then the most
  important detail. No adjectives the article did not earn, no "could", "may" or "sparks"
  unless the article says it is uncertain.
- **why** — one sentence on what it changes for this reader and their interests; leave it
  empty rather than write a platitude ("This could have big implications").
- **lede** — the day in one sentence, naming two or three of the stories.
- **spoken** — the whole brief as it sounds, about 150 words for 60 seconds: a greeting, the
  lead in two sentences, then one sentence a story, the glance in one line when there is one,
  and a close. Written to be heard: short sentences, no parentheses, no urls, numbers as
  they are said.

## Lay it out, look once

`page.mjs` writes `brief-<date>.html` into your folder under `artifacts/`, one file with the
photos inside it, and says what it is missing. It refuses a summary that runs long or an id
it does not know; fix `brief.json` and run it again. With `--look` it also renders the top of
the page at phone width and prints the PNG's path.

`look_at` that PNG once, and only once — the photos are what can be wrong (a logo, a stock
picture of another thing, the wrong person). A wrong photo: set `"image": null` on that
story in `brief.json`, or swap the story, and lay it out again without `--look`.

## Audio

Only when the user's preferences ask for it: `generate_speech` through `tool_call` on the
studio server with `spoken` as the text, the same voice every day, then the path it returns
as `audio` in `brief.json` — the page carries the player. No speech model (the tool is not
found or answers that it cannot make audio) means no audio today: say so in one line and
hand back the page.

## Hand back

Your final text holds the page's path, then the spoken version exactly as written, so
Thursday can read it aloud, then one line on anything left out (a refused publisher, no
glance).
