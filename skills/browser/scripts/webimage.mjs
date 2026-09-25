#!/usr/bin/env node
/**
 * Saves the picture a web page shares itself with (og:image, else twitter:image),
 * and with --all the large pictures in its body too, through the session's browser
 * so a picture behind its sign-in loads. Prints each file with its size and the
 * credit line to put on the slide; with --json, for a script, one line of JSON instead:
 * { "files": [{ "path", "w", "h", "alt" }], "credit" }.
 *
 *   node webimage.mjs <page url> --out <dir> [--all] [--min 600] [--json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { imageSize } from "./image-size.mjs";
import { fail, inPage, orFail, parseArgs } from "./session.mjs";

const opts = parseArgs();
const url = opts._[0];
if (!url || !opts.out)
  fail(
    "usage: node webimage.mjs <page url> --out <dir> [--all] [--min 600] [--json]",
  );
const out = resolve(opts.out);
mkdirSync(out, { recursive: true });

const got = orFail(
  await inPage(
    async (page, { url, all, min }) => {
      const res = await page.request.get(url, { timeout: 30000 });
      const html = await res.text();
      // Read as a document in a tab of its own, blank: none of the page's scripts run, and
      // no policy of the session's page stands between it and a string of HTML
      const tab = await page.context().newPage();
      const wanted = [];
      let site;
      let title;
      try {
        const read = await tab.evaluate(
          ([html, base]) => {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const meta = (key) =>
              doc
                .querySelector(`meta[property="${key}"], meta[name="${key}"]`)
                ?.getAttribute("content")
                ?.trim() || null;
            const absolute = (src) => {
              try {
                return new URL(src, base).href;
              } catch {
                return null;
              }
            };
            return {
              site: meta("og:site_name") ?? new URL(base).host,
              title: meta("og:title") ?? doc.title,
              image: [meta("og:image"), meta("twitter:image")]
                .map((src) => src && absolute(src))
                .find(Boolean),
            };
          },
          [html, url],
        );
        site = read.site;
        title = read.title;
        if (read.image) wanted.push({ src: read.image, alt: "og:image" });
        if (all) {
          await tab.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          // Pictures still arriving after the load, up to a slow page's worth of waiting
          await tab
            .waitForFunction(
              () => [...document.images].every((i) => i.complete),
              null,
              { timeout: 10000 },
            )
            .catch(() => {});
          const found = await tab.evaluate(
            (min) =>
              [...document.images]
                .filter((i) => i.naturalWidth >= min)
                .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || "" })),
            min,
          );
          for (const f of found)
            if (!wanted.some((w) => w.src === f.src)) wanted.push(f);
        }
      } finally {
        await tab.close();
      }
      const files = [];
      for (const w of wanted.slice(0, 8)) {
        try {
          const r = await page.request.get(w.src, {
            headers: { referer: url },
            timeout: 30000,
          });
          if (!r.ok()) continue;
          const type = r.headers()["content-type"] ?? "";
          if (!type.startsWith("image/")) continue;
          files.push({ ...w, type, data: (await r.body()).toString("base64") });
        } catch {}
      }
      return { site, title, files, status: res.status() };
    },
    { url, all: Boolean(opts.all), min: Number(opts.min ?? 600) },
  ),
);

if (!got.files.length)
  fail(
    `No picture came back from ${url} (page answered ${got.status}). Open it in the browser and take one from the page, or try --all.`,
  );
const ext = (type) =>
  ({
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  })[type.split(";")[0]] ?? "jpg";
const saved = got.files.map((f, i) => {
  const path = `${out}/web-${String(i + 1).padStart(2, "0")}.${ext(f.type)}`;
  writeFileSync(path, Buffer.from(f.data, "base64"));
  const size = imageSize(path);
  return { path, w: size?.w, h: size?.h, type: f.type, alt: f.alt ?? "" };
});
const credit = `${got.site} — ${got.title.trim().slice(0, 100)}`;
if (opts.json)
  console.log(
    JSON.stringify({
      files: saved.map(({ path, w, h, alt }) => ({ path, w, h, alt })),
      credit,
    }),
  );
else {
  for (const { path, w, h, type, alt } of saved)
    console.log(
      `${path} ${w ? `${w}x${h}` : type} ${alt ? `(${alt.slice(0, 60)})` : ""}`,
    );
  console.log(`Credit: ${credit}`);
}
