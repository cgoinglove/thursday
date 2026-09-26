# When something does not work

Say what happened and the one thing that fixes it; most problems are a setting or a key.

## A call will not open, or ended

- **"Call failed"** shows the provider's reason. A refused key or no credit is fixed in **Settings ›
  API keys**; a model the key cannot use is changed in **Settings › Thursday**, under Models.
- **"One call at a time"**: another tab of the app has a spoken call on. Hang up there first.
- **She cannot be heard** on a call she opened herself: the browser holds sound until the page is
  touched. A tap anywhere fixes it.
- **She does not hear them**: the microphone was refused, or another app is using it. Allow it again
  from the site's settings in the address bar.
- **The call ended by itself**: the line under her face says why, such as *25s of quiet* (nothing
  said for 25 seconds), *Thursday hung up* or *the connection dropped*.

## "Hey thursday" does nothing

The wake phrase is off until it is switched on in **Settings › Thursday › Starting a call**, where
the phrase can also be changed. It needs a browser with speech recognition, the microphone, and the
app's tab open. When it cannot start, the screen says "Wake word off" with the reason. Tapping her
face always works.

## A job stopped

A job does not fail for good; it pauses and waits.

- **It asked something**: the question is in its thread, in the corner at the bottom right.
  Answering it, on screen or through her, carries it on.
- **The model failed or the provider refused**: the thread says why. Fix the key or pick another
  model on the bot's page, then press **Continue**.
- **The GPT Subscription ran out**: the job says when the plan resets; its row in **Settings › API
  keys** shows *Limit reached*. A call in writing, on screen or from a phone, goes on on the OpenAI
  key when one is set (`calls.md`); a job does not.
- **The app stopped while it ran** (terminal closed, computer restarted), or **it reached its step
  limit**: **Continue** picks it up. Closing the browser tab does not stop jobs.
- **They stopped it**: writing to the thread starts it again.

## A bot says it cannot do something

- **Make an image, a video, speech, or a transcript**: pick a model for it in **Settings › Models**,
  under Studio.
- **Open a web page**: the bots' browser downloads in the background on first start, a few hundred
  megabytes. On a Linux server it may also need `npx playwright install-deps chromium`, run once
  with administrator rights.
- **Use this Mac's apps**: macOS must allow Screen Recording and Accessibility in System Settings.
- **Sign in or pay**: on purpose. The bot opens the page and waits; paying is always theirs to
  press. A site that asks for a sign-in on every job can be used through their own Chrome
  (`setup.md`, Sites they signed in to).
- **Search the web**: a bot on the Vercel AI Gateway or a provider without its own search opens
  pages instead. A search key (Exa) in **Settings › API keys** gives every bot search.
- **Reach a connected service**: one that needs signing in again turns red in **Settings ›
  Connectors**; **Reconnect** fixes it.
- **Take a file**: at most 8 files go with one message, 25 MB each.

## Starting over

**Settings › Thursday › History › Reset history** deletes every call, every job and everything she
remembers, for good; keys, bots and connectors stay, and so does what each bot keeps for itself.
Wiping everything, keys included, means deleting the data folder (`setup.md`, Where the files are).

## Still stuck

**Ask on Discord**, under community in the Settings list, opens the app's community. A bug that
happens again the same way goes to **GitHub**, just below it, as an issue with the steps that bring
it back.
