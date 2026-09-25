# No transcript: from the audio

`yt.mjs` says "No captions on this video" when YouTube has none — music, some new or
non-speech videos. A podcast off YouTube arrives the same way, and so does a recording of their
own — a meeting, a lecture, a voice memo, in the `inbox` folder when they sent it with a message. The words then come from the
studio's transcription model, which costs by the minute of audio: past an hour, send
Thursday one `send_message` question with the length before transcribing it.

1. Check it is there: `transcribe` under `studio`, either among your own tools or in the
   `## Connected tools` chapter of your prompt. In neither means no transcription model is
   picked; say so in your answer (Settings › Models) and give what the title, description
   and chapters tell.
2. `node $S/audio.mjs cut <url|file> --out <scratch>/audio` downloads the audio (any page
   yt-dlp knows, a direct mp3 url, or a file) and cuts it into ten-minute pieces,
   `<name>-000.mp3` onwards; `--minutes` makes them shorter or longer. It installs yt-dlp
   and ffmpeg into `projects/` the first time, once.
3. `transcribe` each piece through `tool_call` on `studio`, every piece in the same step.
   Each answers with a file path.
4. `node $S/audio.mjs join <scratch>/audio/<name>.pieces.json <file> <file>…` with those
   files in the pieces' order writes `<name>.txt` in the same shape as a caption transcript.
   A time marked `~` is estimated from where the words fall in its piece; cite it with the
   `~`, which the page links like any other.

The transcribe files land in your artifacts folder; once joined, delete them.
