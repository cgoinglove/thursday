# What the user likes

A brief is only as good as what it knows about its reader. Keep it in one file in your own
memory folder, `preferences.md`, and read it before gathering anything.

```markdown
Brief preferences: topics, edition, size, glance, sources, audio, time. Updated 2026-09-20.

## Topics
- AI = AI OR OpenAI OR Anthropic OR "language model"
- Startups = startup funding OR "raises" OR "Series A"
- Home = "<the reader's country>" economy OR politics -"<a name that drags in the wrong stories>"

## Edition
en, US (page in English)

## Size
Lead and 5

## Glance
Weather: Lisbon. Markets: S&P 500:^GSPC, Nasdaq:^IXIC, EUR/USD:EURUSD=X

## Sources
Prefer: techcrunch.com, reuters.com
Avoid: coindesk.com

## Audio
No

## Time
07:30 every day (a routine the user set up with Thursday)

## Feedback
- 2026-09-21: "less crypto" — dropped crypto from AI, BTC-USD from the glance.
```

- **Topics are queries.** When the user says "less crypto", "more about chips" or "not so
  much sport", change the query (`-crypto`, add a name), not just a note, so the next
  `news.mjs` call already follows it. Log the change under Feedback with the date and their
  words.
- **A source they complain about goes under Avoid**, one they praise under Prefer; both are
  domains, passed as `--avoid` and `--prefer`.
- Fix what proved wrong rather than add beside it. The file stays one screen long.

## The first brief

No `preferences.md` yet means nobody has told you what they like. Before gathering, send
Thursday **one** question holding all of it, with a default for every part so a one-word
answer is enough:

> For your daily brief — which topics? (Default: world news, technology and your country's
> business.) In which language? Weather for which city, and any markets or currencies to
> watch? A lead and five stories, or shorter? Should it also come as audio? And what time
> should it be ready each morning?

Options: `Use the defaults` and `I'll tell you`. Whatever they answer, write
`preferences.md` from it before gathering. What Thursday's memory of the user already says
(their city, their work, their language) fills the defaults — look there first, and ask only
what it leaves open.

## Every morning, by itself

A brief that starts by itself is a routine, and only the user sets one up, through Thursday.
After the first brief, when no routine starts your threads yet, end your final text with the
time they asked for and the request the routine should carry, in their words — for example:
"Want this ready at 07:30 every day? Ask Thursday to make it a daily routine:
'Make today's brief.'" Never ask about it again once a routine has started a brief.
