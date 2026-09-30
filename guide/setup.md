# Keys, models, skills, services, files

## The first run

The first time the app opens, six steps run on the call screen itself: her voice, the
microphone, which bots come along, what they think with, her style, and the first call. In a narrow
window each step sits under her face. She talks through it in a recorded English voice; her
real voice starts with the first call. The speaker button at the top right mutes it.

The first step offers her voice two ways, one above the other: **GPT Subscription** first, with
**Sign in** (it opens ChatGPT's sign-in window), and **OpenAI API key**, whose
**Paste a key** opens the key field under both. Either one wakes her. Both rows stay once one is
set, a key given before included: each then shows a check and what runs on it, and the sign-in row
the plan it is on, so the plan can still be signed in to. The call screen's **Set up** and
**Settings › Thursday** ask the same way.

Every step can be skipped and done later in Settings. On the microphone step the main button turns
the microphone on (the browser asks first, by its address bar), and with it the wake phrase, and
goes on to the next step; the line under it goes on without either. On the bots step her face gives
way to their office, one desk for each bot switched on, with a job already under way that ends a
few seconds in: each bot hands its part back and the report comes in. The bots picked
there are set up when it ends; they work once there is a model to run on.
The models step ends on **Exa**, a key for web search: without it a bot searches only when its own
model can. The style step shows one of her four characters at a time, with a line on how she talks;
**Previous** and **Next** move between them, and the one showing is the one set.
With a sign-in or a key the last button is **Call her**; without either it is **Look around**.

Once it has been left, by any of its buttons, it does not show again, and **Reset history** does not
bring it back. Adding `?intro` to the address shows it again; leaving it that way sets up no bots.

## Around the screen

The buttons at the top right of the call screen open **Thursday**, **Memory** and **Bots**, and
**Settings** opens everything; each carries a dot when something there needs the user. The Settings
list is Thursday, Memory, Bots, Threads, Routines, Files, Skills, Connectors, Sign-ins, Models,
API keys and Phone. ⌘K (Ctrl+K) jumps to a section's filter, and ⌘ (Ctrl) with a number from 1 to 9
opens one of the first nine sections. Under community are **Ask on Discord** and **GitHub**. The
theme — **System**, **Light** or **Dark**, Light until one is picked — is at the foot of the list.

## Keys

**Settings › API keys** holds them, and they stay on this computer. A call needs one of two: a GPT
Subscription sign-in on a paid plan, or an OpenAI key. Either pays for both her voice and the model behind it. The
key is checked when it is saved, and one OpenAI refuses is not kept. Bots can run on the same key.

Two easier ways for bots come next:

- **GPT Subscription**: sign in with ChatGPT, and bots run on the ChatGPT plan with no key: they
  think, search the web and, on a paid plan, draw on it. On a paid plan a spoken call runs on it
  too, in the plan's own voice, **GPT-Live 1 Codex**, the one the Codex CLI's `/voice` uses. The row names the plan
  (such as **Pro**), and a bar and a percentage show how much of it is used, with when it resets.
  The **Free** plan runs bots and calls in writing but has no spoken calls: ChatGPT does not open
  one on it. Signed in on Free, the screens that ask for a voice say so and offer the OpenAI key.
- **Vercel AI Gateway**: one key for every model; its row shows what credit is left.
- **OpenRouter**: the same, one key for every model it carries, free ones among them; its row
  shows what credit is left.

Under them, every other provider (Claude, Gemini, xAI and more, some behind **More**) is a mark to
tap and paste a key into, with a link to the page that makes one.

A search key (Exa) is optional. With it, calls and bots all search through Exa, which is cheap and
has free monthly credits. Without it, a call uses OpenAI's own search, and a bot uses its model's
own search: the GPT Subscription, OpenAI, Claude, Gemini, xAI and OpenRouter have one. A bot on
the Gateway or any other provider has no search of its own, so it opens pages in its browser
instead.

## Models

**Settings › Models** has two groups.

- **Bots** holds the **Default model**, which a bot uses when its own page picks none, and its
  effort. Left unset it shows *auto* and names what bots run on now: the GPT Subscription when
  signed in, else OpenAI, else xAI, else the first provider with a key. If the default picked here
  loses its key, bots stop and say so rather than switch to another provider. **App default** at
  the top of a bot's model list puts that bot back on it.
- **Studio** holds the **Image model**, **Video model**, **Speech model** and **Transcription
  model**. One left unpicked shows *off*, and bots cannot do that kind of work until one is picked.
  The Image model is the exception: left unpicked while someone is signed in to the GPT Subscription
  on a paid plan, it shows *auto* and bots draw with **GPT Image 2** on the ChatGPT plan, under a
  limit of its own that a refusal names. The Free plan does not draw. Picking a model uses that one
  instead. The GPT Subscription has nothing for video, speech or transcription.

The call's own two models are in **Settings › Thursday**, under Models.

**Effort** is how hard a model thinks, shown as a row of buttons: **auto**, then the steps that
model offers (such as none, low, medium, high, xhigh). Higher is slower and costs more; **auto**
lets the model decide. A bot's own page and the call's backend have the same control.

## Skills

A skill is a written-down way of doing something that a bot reads before it starts. The ones that
ship with the app are shared by every bot: using the browser; using this Mac's apps (on a Mac only);
making documents, slides, pages and small apps with charts; reading videos, podcasts, articles and
PDFs; reports built on published numbers; a daily news brief; finding more skills; and writing a new
one. **Writer** and **Concierge** also carry skills of their own, for marketing a product and for
trips, that no other bot sees.

**Settings › Skills** lists them in groups: **Custom** (the user's own), one group for each bot that
has its own (such as **Writer's own**), and **Default** (the ones that ship, read-only). There a
skill can be switched off, uploaded (a `.md`, `.zip` or `.skill` file up to 20 MB), written from
scratch, or deleted when it is the user's own. In one of the user's own, **Edit** on a file
changes it in place.

A bot can also find a skill in the open registry while it works, or write a new one. Before it
installs one from the registry it asks, saying who published it, its license and what its security
checks found. Its report says whether it kept the skill for itself or for every bot.

Unasked, a bot writes a skill only for a kind of job that comes back — a routine's, or one it has
done before — and only for itself, improving the one it has before adding another. Its report says
which, in one line; it shows under that bot's group in **Settings › Skills**, where it can be
switched off or deleted. The skills that ship and the user's own are never changed unasked.

## Connected services

**Settings › Connectors** connects MCP servers, picked from the list or added by pasting their
details. The list starts with everyday services (to-dos, the house, flights, and Zapier for Gmail,
Google Calendar and many other apps) and the tools for developers come after. Once connected, a
server's tools are there for bots to use, and up to ten can be pinned to one bot on its page in
**Settings › Bots**. She does not use them on a call herself; she hands that work to a bot.

Opening a server lists its tools, with **Reconnect** and **Delete**. A server that needs signing in
again turns red, and **Reconnect** fixes it. Home Assistant asks for the address of their Home
Assistant and a long-lived access token made on their profile page there; its Model Context Protocol
Server integration has to be added in Home Assistant too.

## Sites they signed in to

When a bot needs them signed in to a website, to post, read mail or order, it opens a window of the
bots' own browser (Google Chrome for Testing, not their Chrome) and asks. They sign in there
themselves, and the app keeps that sign-in so later work does not ask again.

**Settings › Sign-ins** lists each one: the site, the account, and the bots that may use it. What is
kept is the site's session, never a password, and it stays on this computer.

- The bot that asked for a sign-in may use it. Another bot that needs it asks first; the list then
  shows *… asks* with **Allow**. The **×** on a bot's name takes that back.
- A site can keep more than one account: ask a bot to sign in to the other one, and it opens a
  window for it. Each account is its own sign-in, with its own bots and **Sign out**, listed under
  the site. A bot uses the account the work is for, and asks which one when it cannot tell. On a
  site that shows no account name, the bot asks what to call the second one.
- Some sites, Google among them, sign the bot out again on every job however often they sign in.
  For those, a bot can work in a tab of their own Chrome instead, signed in as they already are —
  to every site their Chrome is signed in to, not only that one. That needs the Playwright
  extension installed in their Chrome once and Chrome open: the last row, **Your own Chrome**, has
  **Get the extension**. Each time a bot connects, a page opens in their Chrome and asks them to
  allow it and pick the tab the bot gets; a bot asked to work in the browser they have open
  connects the same way.
- **Sign out** removes what is kept for that account, and the site's other accounts stay; the next
  job that needs it asks again. On a lost or shared computer, also sign out on the site itself.

## Its own window

The app runs in a browser tab, and a closed tab takes the wake phrase, the shortcut and her calls
with it. Chrome and Edge can install it as its own window with its own icon. The call screen offers
this once (**Install** or **Not now**), and **Install app** stays at the foot of the Settings list
until it is installed. In Safari on a Mac it is **File › Add to Dock**; Firefox cannot do it.

The window only shows what the server serves, and the server is started with `npx
thursday-agent`. On a Mac, the first start in a terminal asks once whether to keep it running in
the background. Yes, and no terminal is needed: it starts again when they log in, and comes back
by itself if it stops. `npx thursday-agent start` does the same later, and moves the background to
the version it was run as; if that version does not come up, the one before is started again, and
when nothing can run in the background, it runs in that terminal instead. When the Node it was
started with is removed, by a version manager or an upgrade, it starts on another Node it finds and
says which in its log, which keeps to about 10 MB with the one before beside it.
`npx thursday-agent stop` stops it, and it no longer starts at login; `npx thursday-agent status`
says whether it runs, where, and where its log is. **Settings › Thursday › Running** shows the same
and the command to change it, to copy; the app never stops or moves itself. The copy that runs in
the background is kept in `~/.thursday/app`. On Linux and Windows it runs in a terminal; add it to
the programs that start at login.

The app uses the same address every time: port 4747 by default. If that port is taken one day, it
says so and uses the next free one for that run, and the browser shows different settings there.
`--port` with a number moves it for good (in the background, `start` with it). `--home` uses another
data folder, `--no-open` starts without opening a browser, and `--help` lists everything.

Starting it again while it already runs on the same data folder opens the running one in the
browser instead of starting a second, and says how to stop it. It needs Node 22.18 or newer; on an
older one it prints the commands that update it and start it again.
Closing the terminal it runs in stops it like Ctrl+C: running jobs pause and wait for **Continue**;
in the background, closing the terminal changes nothing.

## Updating

Thursday does not update by itself. When the app is opened in a browser it asks npm, at most once
a day, whether a newer version is out. When one is, a dark card under the Settings buttons says
so: **Update** moves to it, and **Not today** hides the card for a day. **Settings › Thursday ›
Running** shows the version that runs, and keeps saying a newer one is out after that.

- Running in the background, started through `npx`: **Update** installs the new version, starts
  Thursday again on the same address and loads the page again on it, in a minute or so. A call
  that is open ends with the restart and running jobs pause on **Continue** (a routine's run
  ends), so it asks first when either is open. If the new version does not come up, the one
  before runs again, and the row says why with the line to run by hand.
- Running in a terminal, or installed with `npm install -g`: the row shows the line to run
  instead of a button.
- A bare `npx thursday-agent` does not update a copy that is already running: it opens that one.
- Run from source, it says nothing: a checkout moves with git.
- When npm cannot be reached, the row says so, and npm is asked again later.

## Where the files are

Everything is on this computer, in one folder: `.thursday` in their home folder when started with
`npx thursday-agent` or installed, or the folder it was started from otherwise; every start prints
it. It holds the database (calls, memory, bots, keys, her settings), a `.env` with the key the saved
keys are sealed with, the kept sign-ins, and the workspace with finished work, each bot's folder and
installed skills. Updating the app never touches any of these. On a Mac that keeps it running in the
background, `app` in it is the copy that runs there, which `start` replaces with each version.
Nothing is sent anywhere except to the model providers and services they set up. The app listens
only to this computer and has no account.

The bots' browser is the one thing outside it: a download of a few hundred megabytes in the
computer's cache folder.

To back up, copy that folder with the app stopped; moving to another computer is the same folder
put in the same place, and `app` need not come along: `start` there installs a copy for that
computer. The database alone is not a whole copy: the keys saved in it open only with the `.env`
beside it, and without it each is entered again. If the app ever cannot open the database, the
terminal asks whether to set it aside and start fresh; the old file is kept beside the new one, with
`.corrupt-` in its name.

## What it costs

The user brings their own keys, so the cost is whatever those providers charge: a spoken call by the
minute it is open, silence included, and everything else by how much text the models read and
write, a call in writing included. On the GPT Subscription, calls and bots use the ChatGPT plan
instead. A long job on a large model adds up fastest.
