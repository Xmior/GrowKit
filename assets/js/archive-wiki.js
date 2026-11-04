// Pages copied from the Growtopia Iceberg wiki by tools/build-archive.py. Images still load from the wiki.
const pageBox = document.getElementById("wiki_page");
const pagesBox = document.getElementById("wiki_pages");
const search = document.getElementById("wiki_search");
const DEFAULT = "main-page";
let index = [];

function renderList() {
  const query = search.value.trim().toLowerCase();
  const current = new URLSearchParams(location.search).get("page") || DEFAULT;
  pagesBox.replaceChildren(...index.filter((p) => p.title.toLowerCase().includes(query)).map((p) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `wiki.html?page=${p.slug}`;
    link.textContent = p.title;
    if (p.slug === current) link.setAttribute("aria-current", "page");
    item.append(link);
    return item;
  }));
}

(async () => {
  try {
    index = await fetch("../assets/data/gtarchive/wiki-index.json").then((r) => r.json());
    renderList();
    const wanted = new URLSearchParams(location.search).get("page") || DEFAULT;
    const entry = index.find((p) => p.slug === wanted) || index.find((p) => p.slug === DEFAULT);
    const response = await fetch(`../assets/data/gtarchive/wiki/${entry.slug}.html`);
    if (!response.ok) throw new Error(`${entry.title} was not found.`);
    pageBox.innerHTML = await response.text();
    document.getElementById("wiki_title").textContent = entry.title;
    document.title = `${entry.title} · GrowKit`;
    const source = document.getElementById("wiki_info");
    source.textContent = "From the Growtopia Iceberg wiki on Fandom, available under CC BY-SA. ";
    const link = document.createElement("a");
    link.href = entry.source;
    link.rel = "noopener";
    link.textContent = "See the original page";
    source.append(link);
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (error) {
    pageBox.textContent = `This page could not be loaded: ${error.message}`;
  }
})();
search.addEventListener("input", renderList);
