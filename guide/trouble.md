# When something does not work

Say what happened and the one thing that fixes it. Most of these are a setting or a key, and the app
has already said which: a provider's own words are shown as they came, never hidden.

## A call will not open, or ended

- **"Call failed"** shows the provider's reason. A refused key or no credit left is fixed in
  **Settings › API keys**; a model the key cannot use is changed in **Settings › Thursday › Models**.
- **She cannot be heard** on a call that opened by itself (she called back): the browser holds the
  sound until the page is touched. A tap anywhere lets it through.
- **She does not hear them**: the browser asks for the microphone on the first call. If that was
  refused, it is allowed again from the site's settings in the address bar.
- **The call ended by itself**: the line under her face says why — *40s of quiet* (nothing was said
  for 40 seconds; the last 10 count down on screen), *Thursday hung up*, *Live closed the call*, or
  *the connection dropped*. Work already handed to a bot is not affected.

## "Hey thursday" does nothing

The wake phrase is off until it is switched on in **Settings › Thursday › Starting a call**, and it
may have been rewritten there. It uses the browser's own speech recognition, which not every browser
has, and needs the microphone while no call is open and the app's tab open. When it cannot start,
the screen says "Wake word off" with the reason. Tapping her face always works, and so does the
shortcut once it is switched on.

## A job stopped

A job never fails for good; it pauses and waits.

- **It asked something**: the question is in its thread, in the corner at the bottom right and in
  the card above the pill. Answering it, on screen or through her, carries it on.
- **The model broke or the provider refused**: a broken model call is tried once more by itself;
  after that the thread says why. Fix the key or pick another model on the bot's page, then
  **Continue**.
- **The GPT Subscription ran out of its plan's usage**: the job stops and says when the plan resets;
  its row in **Settings › API keys** shows *N% used* or *Limit reached*, and when it resets.
- **The server stopped while it was running** — the terminal was quit or the machine restarted: the
  job waits, and **Continue** picks it up. Closing every tab is not this: jobs run on with nothing
  open, and a machine that slept carries on when it wakes.
- **It reached its step limit**: a long job stops to check in after many steps without word from the
  user. **Continue** gives it another run.
- **They stopped it**: writing to the thread picks it up again.

## A bot says it cannot do something

- **Make an image, a video, a voice, or transcribe**: no model is picked for that kind. **Settings ›
  Models** has one slot for each, under Studio.
- **Open a web page**: the bots' browser is downloaded in the background the first time the app
  starts, a few hundred megabytes. Until that finishes, a bot cannot browse.
- **Use this Mac's apps and windows**: macOS has to allow it. The bot says which two permissions are
  missing, Screen Recording and Accessibility, and only the user can grant them in System Settings.
- **Sign in or pay**: by design. The bot opens the page and waits for them. A sign-in is kept for
  next time (`setup.md`, Sites they signed in to); paying is always theirs to press. A site that asks
  again on every job although they signed in is refusing a sign-in carried between browsers: the
  same section says how a bot works in their own Chrome instead.
- **Search the web**: only OpenAI, Claude, Gemini and xAI models search by themselves, and only on
  their own keys. A bot on anything else — the GPT Subscription and the Gateway included — opens
  pages instead. A search key (Exa) in **Settings › API keys** gives every bot search.
- **Reach a connected service**: a server that needs signing in again turns red in **Settings ›
  Connectors**; **Reconnect** there signs in again.
- **Take a file**: at most 8 files go with one message, 25 MB each.

## Starting over

Deleting a single call, thread or note is on its own screen. **Settings › Thursday › History ›
Reset history** deletes every call, every job and everything she remembers, for good; keys, bots and
connectors stay. Wiping everything, keys included, is removing the data folder (`setup.md` says
where).
