// Gmail on the web, driven from inside the signed-in browser.
//
// Everything that breaks when Gmail changes is in `urls` and `sel`; `seen` is the day they
// last worked. Each step runs inside the browser (mail.mjs serializes it), so a step uses
// only its arguments, `r` (this object) and the other steps as `r.steps.<name>`.
//
// What costs what: `unread` and `read` are plain requests on the session's cookies and draw
// no page. `list`, `draft` and `reply` drive the Gmail app itself; the first of them loads it
// (5-6 s), the ones after it only change the address after `#`.
export default {
  seen: "2026-09-19",
  defaultQuery: "in:inbox",
  base: "https://mail.google.com/mail/u/0/",
  urls: {
    // Unread mail only, the newest 20, and a count of all of it. Reading it marks nothing.
    feed: "feed/atom/",
    // A whole thread as plain HTML. `th` takes a thread id or the id of any message in it.
    print: "?view=pt&search=all&th=",
    // Full-page compose; the fields are prefilled from the address.
    compose: "?view=cm&fs=1&tf=1",
    search: "#search/",
    thread: "#all/",
  },
  sel: {
    // The pane showing now: Gmail keeps earlier views in the page, hidden.
    main: "div[role=main]",
    row: "tr.zA",
    unreadRow: "zE",
    id: "[data-legacy-thread-id]",
    sender: ".yW [email]",
    count: ".bx0",
    subject: ".bog",
    snippet: ".y2",
    date: ".xW span[title]",
    // "1–50 of 243": first, last, total.
    counter: ".Dj .ts",
    // The "No matches" panel of an empty search.
    empty: ".HBrgMb, td.TC",
    // A free-text search opens sorted by relevance; the list wants newest first.
    // Words on the sort button and in its menu, in the account's display language.
    relevance: "most relevant",
    newest: "Most recent",
    // Print view.
    printMessage: "table.message",
    printSubject: ".maincontent font[size='+1'] b",
    quoted: ".gmail_quote, blockquote[type=cite]",
    // Compose and reply. `draft` holds the draft's id once Gmail has saved it.
    composeBody: "div[role=textbox][contenteditable=true]",
    composeSubject: "input[name=subjectbox]",
    draftId: "input[name=draft]",
    threadOpen: "h2.hP",
    replyButton: ".ams.bkH",
    replyAllButton: ".ams.bkI",
  },

  steps: {
    /** The Gmail app on screen, signed in; loads it only when another page is showing. */
    async app(page, _args, r) {
      // The app is the bare address plus a `#view`; compose and print pages carry a `?`.
      const inApp = () =>
        page.url().startsWith(r.base) &&
        !page.url().split("#")[0].includes("?");
      if (!inApp()) {
        await page.goto(r.base, { waitUntil: "domcontentloaded" });
      }
      await page
        .waitForFunction(
          (main) =>
            /accounts\.google\.com|workspace\.google\.com/.test(
              location.host,
            ) ||
            [...document.querySelectorAll(main)].some((m) => m.offsetParent),
          r.sel.main,
          { timeout: 30_000 },
        )
        .catch(() => {
          throw new Error(
            `Layout changed: no ${r.sel.main} on ${page.url()} after 30 s. Update sel.main in the recipe.`,
          );
        });
      if (!page.url().startsWith(r.base))
        throw new Error(
          "Signed out of Gmail. Load the kept sign-in for google.com, then run this again.",
        );
    },

    /** Waits for the pane after `hash` to show, then returns its rows as fields. */
    async show(page, { hash }, r) {
      const sel = r.sel;
      const same = await page.evaluate(
        ({ hash, row }) => {
          document.querySelectorAll(row).forEach((x) => {
            x.dataset.mailKitOld = "1";
          });
          if (location.hash === hash) return true;
          location.hash = hash;
          return false;
        },
        { hash, row: sel.row },
      );
      if (same) {
        await page.evaluate((row) => {
          document.querySelectorAll(row).forEach((x) => {
            delete x.dataset.mailKitOld;
          });
        }, sel.row);
      }
      await page
        .waitForFunction(
          (sel) => {
            const main = [...document.querySelectorAll(sel.main)].find(
              (m) => m.offsetParent,
            );
            if (!main) return false;
            const rows = [...main.querySelectorAll(sel.row)];
            if (rows.length) return rows.every((x) => !x.dataset.mailKitOld);
            return !!main.querySelector(sel.empty);
          },
          sel,
          { timeout: 20_000 },
        )
        .catch(() => {
          throw new Error(
            `Layout changed: after ${hash} neither rows (${sel.row}) nor the empty panel (${sel.empty}) showed in 20 s. Update the recipe.`,
          );
        });
      return page.evaluate((sel) => {
        const main = [...document.querySelectorAll(sel.main)].find(
          (m) => m.offsetParent,
        );
        const pad = (n) => String(n).padStart(2, "0");
        const when = (title) => {
          const d = new Date(title);
          return Number.isNaN(d.getTime())
            ? title
            : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };
        const rows = [...main.querySelectorAll(sel.row)].map((x) => {
          const senders = [...x.querySelectorAll(sel.sender)];
          const last = senders.at(-1);
          return {
            id: x.querySelector(sel.id)?.getAttribute("data-legacy-thread-id"),
            unread: x.classList.contains(sel.unreadRow),
            date: when(x.querySelector(sel.date)?.getAttribute("title") ?? ""),
            from: [
              ...new Set(
                senders.map((s) => s.getAttribute("name") || s.textContent),
              ),
            ].join(", "),
            email: last?.getAttribute("email") ?? "",
            subject: x.querySelector(sel.subject)?.textContent ?? null,
            count: Number(
              x.querySelector(sel.count)?.textContent.replace(/\D/g, "") || 1,
            ),
            snippet: (x.querySelector(sel.snippet)?.textContent ?? "").replace(
              /^\s*[-–]\s*/,
              "",
            ),
          };
        });
        const counter = [...main.querySelectorAll(sel.counter)].map((t) =>
          t.textContent.trim(),
        );
        const missing = rows.length
          ? ["id", "subject", "from"].filter((k) => rows.some((x) => !x[k]))
          : [];
        return {
          rows,
          missing,
          total: counter[2] ?? String(rows.length),
          more:
            counter.length === 3 &&
            (!/^\d[\d,.]*$/.test(counter[2]) ||
              Number(counter[1].replace(/\D/g, "")) <
                Number(counter[2].replace(/\D/g, ""))),
        };
      }, sel);
    },

    async list(page, { query, max }, r) {
      await r.steps.app(page, {}, r);
      const hash = `${r.urls.search}${encodeURIComponent(query)}`;
      let shown = await r.steps.show(page, { hash }, r);
      const sortButton = page
        .locator(`${r.sel.main} button:visible`)
        .filter({ hasText: r.sel.relevance })
        .first();
      if (shown.rows.length && (await sortButton.count())) {
        await sortButton.click();
        const newest = page
          .locator("[role=menuitemradio]:visible")
          .filter({ hasText: r.sel.newest })
          .first();
        if ((await newest.getAttribute("aria-checked")) === "true") {
          await page.keyboard.press("Escape");
        } else {
          await newest.click();
          await sortButton.waitFor({ state: "detached", timeout: 10_000 });
          // The sorted rows replace the old ones in the same pane.
          await page.waitForTimeout(1500);
          shown = await r.steps.show(page, { hash }, r);
        }
      }
      const rows = [...shown.rows];
      for (let p = 2; rows.length < max && shown.more && p <= 10; p++) {
        shown = await r.steps.show(page, { hash: `${hash}/p${p}` }, r);
        rows.push(...shown.rows);
      }
      if (shown.missing.length)
        throw new Error(
          `Layout changed: rows came back without ${shown.missing.join(", ")}. Update sel in the recipe.`,
        );
      return { rows: rows.slice(0, max), total: shown.total };
    },

    async unread(page, { label }, r) {
      const res = await page
        .context()
        .request.get(`${r.base}${r.urls.feed}${encodeURIComponent(label)}`);
      if (res.status() === 401)
        throw new Error(
          "Signed out of Gmail. Load the kept sign-in for google.com, then run this again.",
        );
      if (!res.ok())
        throw new Error(`The unread feed answered ${res.status()}.`);
      const xml = await res.text();
      return page.evaluate((xml) => {
        // Gmail enforces Trusted Types: a raw string is refused by DOMParser.
        const tt = window.trustedTypes;
        const policy =
          tt &&
          (window.mailKitPolicy ??= tt.createPolicy("mailKit", {
            createHTML: (s) => s,
          }));
        const doc = new DOMParser().parseFromString(
          policy ? policy.createHTML(xml) : xml,
          "text/xml",
        );
        const fullcount = doc.querySelector("fullcount");
        if (!fullcount)
          throw new Error(
            "Layout changed: the unread feed has no <fullcount>. Update the recipe.",
          );
        const pad = (n) => String(n).padStart(2, "0");
        const when = (iso) => {
          const d = new Date(iso);
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };
        const rows = [...doc.querySelectorAll("entry")].map((e) => {
          const text = (s) => e.querySelector(s)?.textContent ?? "";
          const link = e.querySelector("link")?.getAttribute("href") ?? "";
          return {
            id: new URL(link).searchParams.get("message_id") ?? "",
            unread: true,
            date: when(text("issued") || text("modified")),
            from: text("author name"),
            email: text("author email"),
            subject: text("title"),
            count: 1,
            snippet: text("summary"),
          };
        });
        return { total: Number(fullcount.textContent), rows };
      }, xml);
    },

    async read(page, { id }, r) {
      if (!/^[0-9a-f]{10,20}$/i.test(id))
        throw new Error(
          `${id} is not a Gmail id: take the id column from list or unread.`,
        );
      const res = await page
        .context()
        .request.get(`${r.base}${r.urls.print}${id}`);
      if (!res.url().startsWith(r.base))
        throw new Error(
          "Signed out of Gmail. Load the kept sign-in for google.com, then run this again.",
        );
      if (!res.ok())
        throw new Error(`The print view answered ${res.status()} for ${id}.`);
      const html = await res.text();
      return page.evaluate(
        ({ html, sel }) => {
          // Gmail enforces Trusted Types: a raw string is refused by DOMParser.
          const tt = window.trustedTypes;
          const policy =
            tt &&
            (window.mailKitPolicy ??= tt.createPolicy("mailKit", {
              createHTML: (s) => s,
            }));
          const doc = new DOMParser().parseFromString(
            policy ? policy.createHTML(html) : html,
            "text/html",
          );
          const tables = [...doc.querySelectorAll(sel.printMessage)];
          if (!tables.length)
            throw new Error(
              `Layout changed or no such thread: the print view has no ${sel.printMessage}. Check the id; if it is right, update the recipe.`,
            );
          const BLOCK =
            /^(P|DIV|BR|TR|LI|H[1-6]|TABLE|BLOCKQUOTE|PRE|UL|OL|HR|SECTION|ARTICLE|HEADER|FOOTER)$/;
          const text = (node) => {
            let out = "";
            const walk = (n) => {
              if (n.nodeType === 3) out += n.textContent.replace(/\s+/g, " ");
              if (n.nodeType !== 1) return;
              if (/^(STYLE|SCRIPT|HEAD|TITLE)$/.test(n.tagName)) return;
              const block = BLOCK.test(n.tagName);
              if (block) out += "\n";
              if (n.tagName === "TD") out += " ";
              for (const c of n.childNodes) walk(c);
              if (block) out += "\n";
            };
            walk(node);
            return out
              .split("\n")
              .map((l) => l.trim())
              .join("\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
          };
          const unwrap = (href) => {
            try {
              const u = new URL(href);
              return u.hostname === "www.google.com" && u.pathname === "/url"
                ? (u.searchParams.get("q") ?? href)
                : href;
            } catch {
              return href;
            }
          };
          const messages = tables.map((t) => {
            const rows = [...t.querySelectorAll(":scope > tbody > tr")];
            const cells = rows[0]?.querySelectorAll(":scope > td") ?? [];
            const bodyCell = rows.at(-1);
            bodyCell
              ?.querySelectorAll(sel.quoted)
              .forEach((q) =>
                q.replaceWith(doc.createTextNode("[quoted text cut]")),
              );
            const links = [
              ...new Set(
                [...(bodyCell?.querySelectorAll("a[href]") ?? [])]
                  .map((a) => unwrap(a.getAttribute("href")))
                  .filter((h) => /^https?:/.test(h)),
              ),
            ];
            return {
              from: text(cells[0] ?? doc.createElement("i")),
              date: text(cells[1] ?? doc.createElement("i")),
              to: rows.length > 2 ? text(rows[1]) : "",
              body: bodyCell ? text(bodyCell) : "",
              links,
            };
          });
          return {
            subject: doc.querySelector(sel.printSubject)?.textContent ?? "",
            messages,
          };
        },
        { html, sel: r.sel },
      );
    },

    /** Waits for the open compose to be saved as a draft, and says what it holds. */
    async saved(page, _args, r) {
      await page
        .waitForFunction(
          (input) =>
            [...document.querySelectorAll(input)].some((i) =>
              /^#?msg-/.test(i.value),
            ),
          r.sel.draftId,
          { timeout: 20_000 },
        )
        .catch(() => {
          throw new Error(
            `The draft was not saved in 20 s (no id in ${r.sel.draftId}). Take a snapshot and look; update the recipe if the compose changed.`,
          );
        });
      return "Saved in Drafts, not sent. The compose stays open in this browser.";
    },

    async draft(page, { to, cc, subject, body }, r) {
      // run-code has no URLSearchParams.
      const q = Object.entries({ to, cc, su: subject, body })
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      await page.goto(`${r.base}${r.urls.compose}&${q}`, {
        waitUntil: "domcontentloaded",
      });
      if (!page.url().startsWith(r.base))
        throw new Error(
          "Signed out of Gmail. Load the kept sign-in for google.com, then run this again.",
        );
      await page
        .locator(r.sel.composeSubject)
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {
          throw new Error(
            `Layout changed: no ${r.sel.composeSubject} in the compose. Update the recipe.`,
          );
        });
      // An untouched prefilled compose is not saved until something is typed into it.
      const box = page.locator(r.sel.composeBody).first();
      await box.click();
      await page.keyboard.press("End");
      await page.keyboard.insertText(" ");
      await page.keyboard.press("Backspace");
      return r.steps.saved(page, {}, r);
    },

    async reply(page, { id, all, body }, r) {
      await r.steps.app(page, {}, r);
      await page.evaluate((h) => {
        location.hash = h;
      }, `${r.urls.thread}${id}`);
      await page
        .locator(r.sel.threadOpen)
        .first()
        .waitFor({ timeout: 20_000 })
        .catch(() => {
          throw new Error(
            `Layout changed or no such thread: ${r.sel.threadOpen} did not show for ${id}.`,
          );
        });
      const button = page
        .locator(all ? r.sel.replyAllButton : r.sel.replyButton)
        .last();
      await button.click({ timeout: 10_000 }).catch(() => {
        throw new Error(
          `Layout changed: no reply button (${all ? r.sel.replyAllButton : r.sel.replyButton}). Update the recipe.`,
        );
      });
      const box = page.locator(r.sel.composeBody).last();
      await box.waitFor({ timeout: 10_000 });
      await box.click();
      const lines = body.replace(/\r/g, "").split("\n");
      for (const [i, line] of lines.entries()) {
        if (i) await page.keyboard.press("Enter");
        if (line) await page.keyboard.insertText(line);
      }
      return r.steps.saved(page, {}, r);
    },
  },
};
