#!/usr/bin/env node
/**
 * Saves the picture a web page shares itself with (og:image, else twitter:image),
 * and with --all the large pictures in its body too, through the session's browser
 * so a site that refuses curl still answers. Prints each file with its size and
 * the credit line to put on the slide.
 *
 *   node webimage.mjs <page url> --out <dir> [--all] [--min 600]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { imageSize } from "./image-size.mjs";
import { fail, inPage, orFail, parseArgs } from "./session.mjs";

const opts = parseArgs();
const url = opts._[0];
if (!url || !opts.out)
  fail("usage: node webimage.mjs <page url> --out <dir> [--all] [--min 600]");
const out = resolve(opts.out);
mkdirSync(out, { recursive: true });

const got = orFail(
  await inPage(
    async (page, { url, all, min }) => {
      const res = await page.request.get(url, { timeout: 30000 });
      const html = await res.text();
      const meta = (key) => {
        const tag = html.match(
          new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"),
        )?.[0];
        return tag?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
      };
      const decode = (s) => s?.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/");
      // The VM has no URL class
      const origin = url.match(/^https?:\/\/[^/]+/)[0];
      const absolute = (src) =>
        src.startsWith("//")
          ? `https:${src}`
          : src.startsWith("/")
            ? origin + src
            : src;
      const site =
        decode(meta("og:site_name")) ?? origin.replace(/^https?:\/\//, "");
      const title =
        decode(meta("og:title")) ?? html.match(/<title>([^<]*)/i)?.[1] ?? "";
      const wanted = [decode(meta("og:image")) ?? decode(meta("twitter:image"))]
        .filter(Boolean)
        .map((src) => ({ src: absolute(src), alt: "og:image" }));
      if (all) {
        const tab = await page.context().newPage();
        try {
          await tab.goto(url, { waitUntil: "load", timeout: 45000 });
          await tab.waitForTimeout(1500);
          const found = await tab.evaluate(
            (min) =>
              [...document.images]
                .filter((i) => i.naturalWidth >= min)
                .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt || "" })),
            min,
          );
          for (const f of found)
            if (!wanted.some((w) => w.src === f.src)) wanted.push(f);
        } finally {
          await tab.close();
        }
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
got.files.forEach((f, i) => {
  const path = `${out}/web-${String(i + 1).padStart(2, "0")}.${ext(f.type)}`;
  writeFileSync(path, Buffer.from(f.data, "base64"));
  const size = imageSize(path);
  console.log(
    `${path} ${size ? `${size.w}x${size.h}` : f.type} ${f.alt ? `(${f.alt.slice(0, 60)})` : ""}`,
  );
});
console.log(`Credit: ${got.site} — ${got.title.trim().slice(0, 100)}`);
