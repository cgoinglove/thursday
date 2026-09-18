# Keys, models, skills, services, files

## Keys

**Settings › Keys** holds them, and they stay on this machine. One OpenAI key is all a call
needs — it pays for both the voice and the model behind it. Bots can run on that same key or
on Anthropic, Google, xAI, the Vercel AI Gateway, or a ChatGPT sign-in.

A search key (Exa) is optional. With it, calls and bots both search through Exa, which is
cheaper per search and comes with free credits every month. Without it, a call uses OpenAI's
own search and a bot its model's own; a bot on the Vercel AI Gateway or a ChatGPT sign-in has
no search of its own, so it opens pages in its browser instead.

## Models

**Settings › Models** picks the model bots use when their own page says nothing, and the
models for images, video, speech and transcription. A kind with no model picked simply is not
there — a bot that needs it says so rather than guessing. The call's own two models are in
Settings › Thursday instead.

## Skills

A skill is a written-down way of doing something that a bot reads before it starts. Some ship
with the app — the browser, this Mac, finding more skills, building a page or a chart, and
writing a new skill. **Settings › Skills** lists them, switches one off, uploads one, or
writes one. A bot can also install one from the open registry while it works.

## Connected services

**Settings › Connectors** connects MCP servers, by picking one from the list or pasting its
details. Once connected, its tools are there for bots to search and call, and up to ten of
them can be pinned to one bot so they are always in front of it. Signing in happens in a
popup window; a server that needs it again turns red on that screen.

## Where the files are

Everything is on this computer, in one folder: `.thursday` in their home folder when the app
was started with `npx thursday-agent`, or the folder it was started from otherwise. It holds
the database with calls, memory, bots and keys, and the workspace with finished results,
projects, each bot's folder and the skills that were installed. The folder her shell opens in
is that workspace, so the exact place is one command away when they ask. Updating the app
never touches it. Nothing is sent anywhere but the model providers that were set up
and the services that were connected. The app listens only to this machine and has no account
and no login.

## What it costs

The user brings their own keys, so the cost is whatever those providers charge: the call is
billed per minute it is open, silence included, and everything else by how much text the
models read and write. A long job on a large model is what adds up fastest.
