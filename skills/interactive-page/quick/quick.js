// What a document draws for itself once it is written: an address on every heading, so
// a link can point into it; its contents list, from those headings; and its tabs. Nothing
// here is content — a page with no contents list and no tabs runs this and shows no change.
(() => {
  const slug = (text) =>
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
  const headings = [...document.querySelectorAll("h2, h3")];
  const taken = new Set();
  for (const heading of headings) {
    if (!heading.id) {
      let id = slug(heading.textContent) || "section";
      for (let n = 2; taken.has(id); n++)
        id = `${slug(heading.textContent)}-${n}`;
      heading.id = id;
    }
    taken.add(heading.id);
  }

  // The contents: h2s as the list, each with its h3s under it. Headings inside a tab
  // panel or a card are left out — they are not the document's spine.
  const contents = document.querySelector("nav.contents");
  if (contents && !contents.children.length) {
    const list = document.createElement("ol");
    let last = null;
    for (const heading of headings) {
      if (heading.closest(".tabs, .card, .note, nav")) continue;
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      item.append(link);
      if (heading.tagName === "H2") {
        list.append(item);
        last = item;
      } else if (last) {
        const sub = last.querySelector("ol") ?? document.createElement("ol");
        sub.append(item);
        last.append(sub);
      }
    }
    if (list.children.length) contents.append(list);
    else contents.remove();
  }

  // Tabs: a `.tabs` block whose children are <section data-tab="Name">. One is shown at
  // a time; printing shows them all, one under another, so nothing is lost on paper.
  for (const tabs of document.querySelectorAll(".tabs")) {
    const panels = [...tabs.querySelectorAll(":scope > [data-tab]")];
    if (panels.length < 2) continue;
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    const pick = (n) => {
      panels.forEach((panel, i) => {
        panel.hidden = i !== n;
        bar.children[i].setAttribute("aria-selected", String(i === n));
      });
    };
    panels.forEach((panel, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.textContent = panel.dataset.tab;
      tab.addEventListener("click", () => pick(i));
      bar.append(tab);
      panel.setAttribute("role", "tabpanel");
    });
    tabs.prepend(bar);
    pick(0);
  }
})();
