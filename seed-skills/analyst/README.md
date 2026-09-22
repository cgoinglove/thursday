# Analyst's kit

Four skills the Analyst seed is born with, copied into `.agents/skills/` in its own folder when it
is created. They are listed to that bot alone.

| Skill | What it adds |
|---|---|
| `data-report` | Seven report forms, each with its structure and a filled example; `fetch.mjs`, which pulls a published series (FRED, World Bank, Frankfurter, SEC filings, Wikipedia pageviews) into a CSV that names its source |
| `media-digest` | Scripts that read a YouTube video's transcript, chapters and search results through yt-dlp, read an article or a PDF into clean text, cut audio with no transcript into pieces for the studio's transcription model, and draw the result as one page with clickable moments |
| `daily-brief` | Scripts that gather the day's stories on the user's topics from Google News feeds, read each one's own words and photo, add the weather and the markets they watch, and lay out one page with a version to hear |
| `travel` | Weather (Open-Meteo) and exchange rates (Frankfurter) with no key, and `itinerary.mjs`, which writes a trip as one offline page with a photo and a map link per stop; flights and stays are read from the search pages through the browser skill |

Written for this app. The report forms borrow their shape from answer-first business writing and
from the report outlines in [anthropics/financial-services](https://github.com/anthropics/financial-services)
and [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins)
(Apache-2.0); no text is copied from either. Transcripts, chapters and search come from
[yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), fetched as its release build into the
workspace the first time it is needed; a PDF is read through `pdftotext` when the machine has it,
else pypdf installed into the workspace; audio is cut with ffmpeg, or a portable build installed
into the workspace. No code is copied from any of them.

Charts are drawn by the shipped `interactive-page` skill's `chart.mjs` into its quick page, and
the pages take its base style. Web pages are read through the job's own browser session
(`$THURSDAY_SKILLS/browser/scripts/session.mjs`). The scripts need Node and no packages; every
source they call answers without a key, and `data-report/references/sources.md` names the ones
that need one.
