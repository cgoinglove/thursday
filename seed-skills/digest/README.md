# Digest's kit

One skill the Digest seed is born with, copied into `.agents/skills/` in its own folder when it
is created. It is listed to that bot alone.

| Skill | What it adds |
|---|---|
| `media-digest` | Scripts that read a YouTube video's transcript with timestamps and its chapters, search YouTube, read an article or a PDF into clean text, cut audio with no transcript into pieces for the studio's transcription model, and draw the result as one page with clickable moments; references on reading a long file in parts and on the page's shape |

Written for this app. Transcripts come from YouTube's own caption tracks through the app
clients' player endpoint, the route [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api)
takes; when that stops answering, and for audio, the scripts fall back to
[yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), fetched as its release build into the
workspace the first time it is needed. No code is copied from either.

The scripts need Node and no packages. A web article is read through the job's own browser
session (`$THURSDAY_SKILLS/browser/scripts/session.mjs`); a PDF through `pdftotext` when the
machine has it, else pypdf installed into the workspace; audio is cut with ffmpeg, or a portable
build installed into the workspace. The page takes its base style from the shipped
`interactive-page` skill's quick page.
