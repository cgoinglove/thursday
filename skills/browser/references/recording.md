# Recording the screen

A recording shows the user what happened — a form filled, a flow walked — where a
screenshot shows one moment. Record when they ask to see it, or when a page changes too
fast for pictures to tell it.

```bash
playwright-cli video-start artifacts/<bot>/<name>.webm --cursor   # from the open page on
playwright-cli video-chapter "Checkout" --description="Cart to payment"   # a marker, optional
… goto, click, fill as usual …
playwright-cli video-stop
```

- `--cursor` draws a mouse that travels to each action and paces actions so it can; without
  it the recording is bare.
- `video-show-actions` adds a callout naming each action, a marker at the click point and a
  frame around the target; `video-hide-actions` turns them off again.
- The file is written when `video-stop` runs, at the path `video-start` was given: a result
  goes under `artifacts/`, a check for yourself under `scratch/`. Name the path in your answer
  when it is for the user.
- A recording is a `.webm`; when the user needs another format, convert it in the shell.
