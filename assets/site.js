// Turns index.html into the whole site: works out which page was asked for
// (?page=api), fetches that Markdown file, renders it with marked, then adds the
// "on this page" list, heading anchors, scrollable tables and copy buttons.

(async function () {
  const main = document.getElementById("content");
  const navLinks = [...document.querySelectorAll(".site-nav a[data-page]")];
  const pages = navLinks.map((a) => a.dataset.page);
  const siteTitle = document.title;

  const pageUrl = (page, hash = "") => (page === "index" ? "./" : "?page=" + page) + hash;
  const showMessage = (html) => { main.innerHTML = `<p class="status-message">${html}</p>`; };

  // --- Which page? Only the pages listed in the nav can be loaded. ---------
  const page = new URLSearchParams(location.search).get("page") || "index";
  const current = navLinks.find((a) => a.dataset.page === page);
  if (!current) {
    showMessage('There is no page with that name. <a href="./">Go to the overview</a>.');
    return;
  }
  current.setAttribute("aria-current", "page");
  document.title = page === "index" ? siteTitle : `${current.textContent} · ${siteTitle}`;

  // --- Fetch and render the Markdown ---------------------------------------
  let markdown;
  try {
    const res = await fetch(page + ".md");
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    markdown = await res.text();
  } catch (err) {
    showMessage(location.protocol === "file:"
      ? "Browsers do not let a page opened straight from disk read other files. " +
        "Serve this folder instead, for example with VS Code's Live Server or " +
        "<code>python3 -m http.server</code>, and open the address it gives you."
      : `Could not load <code>${page}.md</code> (${err.message}).`);
    return;
  }
  main.innerHTML = marked.parse(markdown, { gfm: true });

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = current.textContent;
  main.prepend(eyebrow);

  // --- Heading ids, in the same form GitHub uses for Markdown headings ------
  const used = new Map();
  for (const h of main.querySelectorAll("h1, h2, h3, h4")) {
    const base = h.textContent.trim().toLowerCase()
      .replace(/[^\p{L}\p{N}_\- ]/gu, "").replace(/ /g, "-");
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  }

  // --- Links between Markdown files become links between pages -------------
  for (const a of main.querySelectorAll("a[href]")) {
    const match = a.getAttribute("href").match(/^([\w-]+)\.md(#.*)?$/);
    if (match && pages.includes(match[1])) a.setAttribute("href", pageUrl(match[1], match[2]));
  }

  // --- Heading anchors and the "on this page" list -------------------------
  const tocList = document.querySelector(".toc ul");
  const headings = [...main.querySelectorAll("h2[id], h3[id]")];
  const links = new Map();
  for (const h of headings) {
    const text = h.textContent.trim();
    const anchor = document.createElement("a");
    anchor.className = "anchor";
    anchor.href = "#" + h.id;
    anchor.textContent = "#";
    anchor.setAttribute("aria-label", "Link to this section: " + text);
    h.append(anchor);

    const li = document.createElement("li");
    if (h.tagName === "H3") li.className = "sub";
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = text;
    li.append(a);
    tocList.append(li);
    links.set(h, a);
  }

  // Highlight the section currently at the top of the viewport.
  if (links.size) {
    const mark = () => {
      let active = headings[0];
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 96) active = h;
      }
      for (const [h, a] of links) a.classList.toggle("active", h === active);
    };
    let queued = false;
    window.addEventListener("scroll", () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; mark(); });
    }, { passive: true });
    mark();
  }

  // --- Tables scroll sideways inside their own box on narrow screens --------
  for (const table of main.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }

  // --- Code blocks get a copy button ---------------------------------------
  for (const pre of main.querySelectorAll("pre")) {
    const block = document.createElement("div");
    block.className = "codeblock";
    pre.replaceWith(block);
    block.append(pre);
    if (!navigator.clipboard) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent.trimEnd());
        button.textContent = "Copied";
      } catch (e) {
        button.textContent = "Failed";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    });
    block.append(button);
  }

  // --- The content arrived after the browser's own jump to #section --------
  // Jump once now, and again when the diagrams have loaded and pushed the text down.
  const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) {
    target.scrollIntoView({ behavior: "instant" });
    const images = [...main.querySelectorAll("img")].filter((img) => !img.complete);
    await Promise.all(images.map((img) => new Promise((done) => { img.onload = img.onerror = done; })));
    target.scrollIntoView({ behavior: "instant" });
  }
})();
