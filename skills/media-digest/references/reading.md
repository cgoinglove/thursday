# Reading something long

## What the scripts give you

`yt.mjs transcript` prints the title, channel, date, length, views, which captions it read
(`auto` ones mishear names and numbers; a person's are exact), the chapters, and the
transcript's size in parts. The `.json` beside it holds the same and the description.
`text.mjs` prints the title, site, author, date, reading time and parts. A file of one part
is read with `cat`; longer ones with `part.mjs <file> <n>`.

## A question about one thing

"What did they say about X", "when do they talk about Y": search before reading.

1. `grep -n -i -E 'word|other word|…' <file> | cut -c1-300` with the words the speaker would
   use, in the transcript's language, and their spelled-out forms (auto captions write
   "gpt 4" and "GPT-4" alike). The line numbers say which part each hit is in: parts start
   at the `## Part` lines (`grep -n '^## Part' <file>`).
2. Read only the parts with hits: one `part.mjs` call each, all sent in the same step.
3. Nothing found is an answer too: say it is not in there, and what it does cover.

## A summary, key points, notes

A summary reads every part; skipping parts is how a summary misses the point made in the
last twenty minutes.

- Start from the chapters and description: they are the author's own outline.
- Read every part, one bash call each, the calls for several parts sent in the same step.
  Note as you go: a claim, a number, a name or a quote, with its `[m:ss]`. Copy a quote
  exactly.
- Then write the answer from the notes: the few points that matter most, not one per part.
  A point is a claim someone could disagree with ("Scaling alone keeps working"), not a topic
  ("Scaling").

## Which videos to watch

1. `yt.mjs search` with the topic as people title videos, `--within` for "recent", and
   `--length long` for talks and podcasts; a second search in another wording or language
   when the first is thin. The filters narrow what a search by relevance found, so for what
   is new put the year or the event in the words too. Rows show views a day, which says more
   than views for new videos.
2. Pick the three to five that look best from the rows, then
   `yt.mjs transcript <id> <id> <id> --out <scratch>` in one call, and read the first part of
   each (`part.mjs <file> 1`, one call each, sent together) to judge: is it about the topic, does it say something, who is
   speaking. A title is a promise, not a summary.
3. One pick with the reason and where to start watching; the rest in a line each. Recommend
   against a popular one when it deserves it.

## A podcast

A podcast episode is usually on YouTube too, with captions: search its title there first.
Some shows publish transcripts on their own site (`text.mjs`). Only when neither exists,
the audio: `no-captions.md`.

## Spoken length

About 150 words a minute. "In three minutes" is about 450 words; a spoken answer on the
call is a few sentences.
