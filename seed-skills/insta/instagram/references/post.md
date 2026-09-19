# A post, made the way the accounts that do well make it

## 1. Find the reference accounts

```bash
node <skill>/scripts/search.mjs "<niche word>" --out <scratch>/search.json
```

One word or a `#tag` finds more than a phrase. The last line lists the accounts behind the
results by the likes they drew. For the three or four that fit the niche:

```bash
node <skill>/scripts/profile.mjs <handle> --out <scratch>/<handle>.json --sheet <scratch>/<handle>.png
```

Posts marked `pinned` are old ones kept on top; judge the pattern by the rest.

## 2. Study how they post

`profile` prints the numbers: types, ratio, slides per carousel, caption length, hashtag
count, cadence, and which posts did best. What the numbers cannot tell is how the slides
look — `look_at` the covers sheet once, then the best post's slides:

```bash
node <skill>/scripts/sheet.mjs --out <scratch>/best.png <scratch>/<handle>.json --post 3
```

Write the pattern down before building, one line each: ratio and slide count; the cover
(hook length, type size and weight, where the text sits, the photo or not); the inner
slides (text alone, photo with a line, photo over its own blur); the background treatment
(darkened, blurred, a gradient at the bottom, a flat colour); the source credit; the
caption (first line, body, call to action, hashtags). Keep it in your memory with the
accounts and the date, and read it next time instead of studying again.

## 3. Pictures

- **Something that happened**: the real picture. `node $THURSDAY_SKILLS/browser/scripts/webimage.mjs <article url> --out <post dir>`
  saves the page's own picture and prints the credit line; `--all` adds the large pictures
  in the article. A person in the story: their photo from the article or an official page.
  Put the credit on the slide.
- **An idea or a mood**: `generate_image` from the studio. It draws 1:1, 3:4, 4:3, 9:16 or
  16:9 and saves to your artifacts; take the closest ratio (3:4 for a 4:5 slide), copy the
  file into the post folder, and let the slide crop it (`object-fit: cover`). A drawn
  picture is never passed off as the event. Posting one that looks real takes `--ai-label`.

## 4. Slides

Copy `<skill>/templates/carousel.html` into the post folder beside the pictures. Set
`--w`/`--h` to the size, keep one `<section data-slide>` per slide, and write each slide
from the pattern. Feed is 1080x1350 (4:5) or 1080x1080 (1:1); every slide of a carousel is
the same size.

```bash
node $THURSDAY_SKILLS/browser/scripts/render.mjs <post dir>/carousel.html --size 1080x1350 --out <post dir>/png \
  && node <skill>/scripts/sheet.mjs --out <post dir>/check.png <post dir>/png/*.png
```

`look_at` the check sheet once: text inside the slide, readable over the picture. Fonts come
from the network; a slide in a language the machine has no font for renders as boxes.

## 5. The composer

Write the caption to a file, then:

```bash
node <skill>/scripts/compose.mjs --ratio 4:5 --caption <post dir>/caption.txt --shot <post dir>/last.png <post dir>/png/*.png
```

It stops on the last screen with the draft open and prints what it set; `last.png` shows it.
The web composer has no music for a photo post. To post: snapshot, and click Share, the
link at the right of that screen's header. Not posting: `compose.mjs --discard`.

Once it is up, `profile.mjs <the account's handle> --posts 1` shows the new post's ratio and
size: a ratio other than the one built means it went up cut.
