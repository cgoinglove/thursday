// One headless look at a page: node look.cjs <url> <out.png> [width] [height]
// Copy this file to script more steps; keep the browser headless and always close it.
const { createRequire } = require("node:module");
const { execSync } = require("node:child_process");
const root = execSync("git rev-parse --show-toplevel", { cwd: __dirname })
  .toString()
  .trim();
const { chromium } = createRequire(`${root}/package.json`)("playwright");

(async () => {
  const [url, out, width = "1440", height = "900"] = process.argv.slice(2);
  if (!url || !out) {
    console.error("usage: node look.cjs <url> <out.png> [width] [height]");
    process.exit(2);
  }
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: Number(width), height: Number(height) },
    });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on(
      "console",
      (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)),
    );
    // The app keeps an event stream open, so wait for the page, then a beat, not for a quiet network
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out });
    console.log(JSON.stringify({ screenshot: out, errors }));
  } finally {
    await browser.close();
  }
})();
