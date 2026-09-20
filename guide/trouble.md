# When something does not work

Say what happened and the one thing that fixes it. Most of these are a setting or a key, and
the app has already said which: a provider's own words are shown as they came, never hidden.

## A call will not open, or drops

- **"Call failed"** shows the provider's reason. A refused key, no credit left, or a model the
  key cannot use are all fixed in **Settings › API keys**, where a refused key is marked
  red and one running low is marked in the colour the app uses for anything that wants them.
- **She cannot be heard** on a call that opened by itself (she called back): the browser holds
  the sound until the page is touched. A tap anywhere lets it through.
- **She does not hear them**: the browser asks for the microphone on the first call. If that
  was refused, it is allowed again from the site's settings in the address bar.
- **The call ended by itself**: nothing was said for 20 seconds. Work already handed to a bot
  is not affected.

## "Hey thursday" does nothing

The wake phrase uses the browser's own speech recognition, which not every browser has, and
it needs the microphone while no call is open. When it cannot start, the screen says
"Wake word off" with the reason. Tapping her face and the shortcut always work.

## A job stopped

A job never fails for good; it pauses and waits.

- **It asked something**: the question is in its thread, in the corner at the bottom right.
  Answering it, on screen or through her, carries it on.
- **The model broke or the provider refused**: the thread says why. Fix the key or pick
  another model on the bot's page, then **Continue**.
- **A ChatGPT sign-in ran out of its plan's usage**: the job stops and says when the plan
  resets; Settings › API keys shows how much is left.
- **Every tab was closed**: jobs pause within seconds and pick up when the app is opened
  again. **Settings › Bots › Work while the app is closed** keeps them running instead.
- **It reached its step limit**: long jobs stop to check in. **Continue** gives it another run.

## A bot says it cannot do something

- **Make an image, a video, a voice, or transcribe**: no model is picked for that kind.
  **Settings › Models** has one slot for each.
- **Open a web page**: the bots' browser is downloaded in the background the first time the
  app starts, a few hundred megabytes. Until that finishes, a bot cannot browse.
- **Use this Mac's apps and windows**: macOS has to allow it. The bot says which two
  permissions are missing, Screen Recording and Accessibility, and only the user can grant
  them in System Settings.
- **Sign in or pay**: by design. The bot opens the page and waits for them. A sign-in is
  kept for next time (`setup.md`, Sites they signed in to); paying is always theirs to press.
- **Search the web**: only OpenAI, Anthropic, Google and xAI models search by themselves. A
  bot on anything else opens pages instead. A search key in Settings › API keys gives every bot
  search.
- **Reach a connected service**: a server that needs signing in again turns red in
  **Settings › Connectors**.

## Starting over

Deleting a call, a thread or a note is on its own screen. Wiping everything is not in the app:
it is removing the data folder (`setup.md` says where), which also removes the keys.
