# A deck

A deck is the `make_deck` tool: each slide a layout whose fields you fill, drawn and fitted by the
app into one HTML file that presents full screen, prints a slide a page, and keeps a picture of
every slide and one of all of them beside it. Its fields say what each takes; this page is how to
fill them well.

- **The titles are the argument.** Someone who reads only the titles follows the deck: each says
  what the slide shows ("Rent rose faster than pay"), in one grammar from the first to the last,
  never the topic ("Rent").
- **One idea a slide.** A statement beats a list; three parallel points are `cards`; one number
  that carries the point is `number`; the same questions asked of several things are a `table`;
  someone's own words are a `quote` with who said it. More than a slide holds is two slides — the
  app never shrinks words to fit.
- **Open with a `cover` and end with a `close`** that says what to do or remember, not "Thank you".
- **Nothing invented.** A figure you were not given is a visible `[FIGURE]`; a number carries its
  source in the slide's footer.
- **Pictures come off the pages you read** (`webimage.mjs`, SKILL.md) and go in an `image` slide
  with their credit; a picture that only decorates is left out.
- **Notes are speech**: what the presenter says over the slide, in their voice, never the slide's
  words again.
- **Changing a deck** is sending the whole deck again with the `revision` the last call answered
  with. The user can edit its words, notes, order and palette in the app; when they have, nothing
  is written and the tool answers with the deck as it stands — make your change on those slides.
