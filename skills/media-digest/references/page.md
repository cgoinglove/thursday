# The answer and the page

## What the answer is

- **Spoken first.** Your final text opens with the answer the way you would say it: two to
  five sentences, no markdown, no list. It is often read aloud. Then the page's path.
- **A page when there is more than a few points**: key points with their moments, a watch
  list, notes on a talk. One page, never a page and a markdown file beside it.
- **Audio when asked** ("read it to me", "something to listen to"): write the script for the
  ear — short sentences, no timestamps or links, numbers said the way a person says them —
  and `generate_speech` through `tool_call` on `studio`, at most 4,000 characters a call.
  Put the file in the page's `audio` too. When `generate_speech` is neither among your own
  tools nor under `studio` in the `## Connected tools` chapter of your prompt, no speech
  model is picked: say so and give the text.
- In the user's language, whatever language the source is in. A quote stays as it was said,
  with a translation after it when the languages differ.

## The JSON `digest.mjs` reads

Write it to your scratch folder, then `node $S/digest.mjs <file> --name <page-name>`. Every
field but `title` may be left out.

```json
{
  "title": "The finding, not the topic",
  "lede": "One or two sentences: the answer.",
  "lang": "en",
  "source": "<scratch>/<id>.json",
  "summary": "A paragraph or two. [12:03] links to that moment. **bold** works.",
  "points": [
    { "at": "12:03", "title": "A claim, not a topic", "text": "What was said and why it matters." }
  ],
  "quotes": [{ "at": "41:10", "who": "Speaker", "text": "Exactly as said." }],
  "videos": [
    { "id": "…", "title": "…", "channel": "…", "length": "1:08:28", "views": 36100,
      "age": "2 weeks ago", "pick": true, "why": "Why this one; start at [12:00]." }
  ],
  "sections": [{ "heading": "…", "text": "…", "items": ["…"] }],
  "audio": "<path of the speech file>",
  "note": "A line at the foot: what it was made from, what is unsure."
}
```

- `source` is the `.json` that `yt.mjs transcript` wrote: title, channel, date, length,
  thumbnail and chapters come from it, and every `at` becomes a link to that second of the
  video. For an article, a PDF or a podcast write the object itself:
  `{ "kind": "article", "url": "…", "title": "…", "by": "…", "date": "…", "image": "<og image url>" }`,
  with `"pages": 15` for a PDF (then `"at": "p. 3"` links to the page) or `"length": "1:12:00"`
  for audio.
- `points` in the order they come in the source, each with its `at` from the transcript
  line it rests on — including an estimated one, `"at": "~24:10"`, which keeps its `~` on
  the page and still opens the source at that second. Five to seven, unless asked for a
  number. The page draws them on a line across the video's length.
- `videos` is a watch list, one `pick` at most; the rows from `yt.mjs search --out` carry
  every field but `why` and `pick`, their picture among them — a row written by hand has
  none. `[m:ss]` inside a video's `why` links into that video.
- Headings default to "Key points", "In their words", "Videos" and "Chapters"; for a page
  in another language set `pointsHeading`, `quotesHeading`, `videosHeading`,
  `chaptersHeading` and `note` in it.
