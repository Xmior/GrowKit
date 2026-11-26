// CDN Mapping: one cache at a time. A card sums up the upload, and an explorer browses its folders
// and shows how each file differs from the cache uploaded before it.
const { el } = CDN;
const $ = (id) => document.getElementById(id);
const IMAGES = "../assets/img/archive/";
const state = { cache: null, folder: "cache", path: [], view: "all", filter: "", sort: { key: "name", dir: 1 }, open: null };

// ---------------------------------------------------------------- left: caches by year
function renderNav() {
  const years = new Map();
  for (const c of [...CDN.caches].reverse()) {
    const y = new Date(c.uploaded).getUTCFullYear();
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(c);
  }
  const currentYear = state.locked || state.host || state.installers ? null : new Date(state.cache.uploaded).getUTCFullYear();
  const locked = CDN.map.locked || [];
  const hosts = otherHosts();
  $("cache_nav").replaceChildren(
    el("a", { class: "cdn-nav-special", href: "#installers", "aria-current": state.installers ? "page" : null },
      el("span", { class: "cdn-nav-marks" }, el("span", { class: "is-download", text: "⬇" })), el("strong", { text: `Installers (${installerList().length})` })),
    el("p", { class: "cdn-nav-title", text: `${CDN.caches.length} caches` }),
    ...[...years].map(([y, list]) => el("details", { open: y === currentYear },
      el("summary", { text: `${y} (${list.length})` }),
      el("ul", {}, list.map((c) => {
        const s = c.stats.cache;
        const marks = el("span", { class: "cdn-nav-marks" },
          s.new ? el("span", { class: "is-new", text: `+${s.new}`, title: `${s.new} new files` }) : null,
          s.changed ? el("span", { class: "is-changed", text: `~${s.changed}`, title: `${s.changed} changed files` }) : null,
          Object.keys(c.installers).length ? el("span", { class: "is-download", text: "⬇", title: Object.keys(c.installers).join(", ") }) : null,
          c.hasBeta ? el("span", { class: "is-beta", text: "β", title: "Has a /cachebeta/ folder" }) : null);
        return el("li", {}, el("a", { href: `#${c.id}`, "aria-current": c === state.cache ? "page" : null },
          c.banner ? el("img", { class: "cdn-nav-banner", src: CDN.banner(c, true), alt: "", loading: "lazy" }) : null,
          el("span", { class: "cdn-nav-id", text: c.id }),
          el("span", { class: "cdn-nav-sub" }, el("small", { text: CDN.day(c.uploaded) }), marks)));
      })))),
    locked.length ? el("details", { open: !!state.locked },
      el("summary", { text: `Locked (${locked.length})`, title: "Folders the server refuses with 403" }),
      el("ul", {}, locked.map((id) => el("li", {}, el("a", { href: `#${id}`, "aria-current": state.locked === id ? "page" : null },
        el("span", { class: "cdn-nav-id", text: id }),
        el("span", { class: "cdn-nav-sub" }, el("small", { text: "no date" }), el("span", { class: "cdn-nav-marks" }, el("span", { class: "is-locked", text: "403" })))))))) : null,
    hosts.size ? el("details", { open: !!state.host },
      el("summary", { text: `Other hosts (${hosts.size})`, title: "Files outside ubistatic-a.akamaihd.net/0098" }),
      el("ul", {}, [...hosts].map(([host, files]) => el("li", {}, el("a", { href: `#host:${host}`, "aria-current": state.host === host ? "page" : null },
        el("span", { class: "cdn-nav-id", text: host }),
        el("span", { class: "cdn-nav-sub" }, el("small", { text: `${files.length} files` }), el("span", { class: "cdn-nav-marks" }, el("span", { class: "is-download", text: "⬇" })))))))) : null);
  $("cache_nav").querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------- cache card
function fact(label, ...value) {
  return el("p", { class: "version-fact" }, el("strong", { text: `${label}: ` }), ...value);
}

function renderCard() {
  const c = state.cache;
  const prev = CDN.caches[c.i - 1], next = CDN.caches[c.i + 1];
  const s = c.stats[state.folder];
  const nav = el("div", { class: "cdn-step" },
    el("a", { class: "btn-sm cdn-step-btn", href: prev ? `#${prev.id}` : null, "aria-disabled": prev ? null : "true", text: "‹ Older" }),
    el("a", { class: "btn-sm cdn-step-btn", href: next ? `#${next.id}` : null, "aria-disabled": next ? null : "true", text: "Newer ›" }));

  const chips = el("div", { class: "version-status" },
    CDN.chip(`${s.files.toLocaleString("en")} files`), CDN.chip(CDN.size(s.bytes)),
    prev ? [
      CDN.chip(`${s.new} new`, s.new ? "new" : "", "Files that were not in the previous cache"),
      CDN.chip(`${s.changed} changed`, s.changed ? "changed" : "", "Files whose size changed since the previous cache"),
      CDN.chip(`${s.gone} gone`, s.gone ? "gone" : "", "Files the previous cache had and this one does not"),
    ] : CDN.chip("Oldest known cache"),
    c.hasBeta ? CDN.chip("has /cachebeta/", "beta") : null,
    c.complete ? null : CDN.chip("scan unfinished", "gone"));

  const tops = Object.entries(s.tops).sort(([a], [b]) => a.localeCompare(b)).map(([top, t]) =>
    el("button", { type: "button", class: "version-platform cdn-top", onclick: () => go(top ? [top] : []) },
      el("h3", { text: top ? `${top}/` : "(top level)" }),
      el("p", { class: "version-fact", text: `${t.files.toLocaleString("en")} files · ${CDN.size(t.bytes)}` }),
      prev ? el("p", { class: "version-fact", text: t.changes ? `${t.changes} new or changed` : "No changes" }) : null));

  const downloads = Object.entries(c.installers).map(([name, [size, created]]) => {
    const img = /\.dmg$/i.test(name) ? "download-macos.png" : "download-windows.png";
    return el("a", { class: "cdn-download", href: `${CDN.map.cdn}${c.id}/${name}`, rel: "noopener", title: `Uploaded ${CDN.time(created)}` },
      el("img", { src: IMAGES + img, alt: "" }), el("span", { text: name }), el("small", { text: CDN.size(size) }));
  });

  const folderSwitch = c.hasBeta ? el("div", { class: "version-tabs" }, ["cache", "cachebeta"].map((f) =>
    el("button", { type: "button", class: "btn-sm", "aria-pressed": String(state.folder === f), text: `/${f}/`, onclick: () => { state.folder = f; state.path = []; render(); } }))) : null;

  const banner = c.banner ? el("a", { class: "cdn-banner", href: CDN.url(c.id, "cache", "interface/large/news_banner.rttex"), rel: "noopener", title: "interface/large/news_banner.rttex in this cache" },
    el("img", { src: CDN.banner(c), alt: `News banner in cache ${c.id}` })) : null;
  $("cache_card").replaceChildren(...[
    banner,
    el("header", { class: "version-head" }, el("h2", { text: `Cache ${c.id}` }), nav),
    fact("Uploaded", CDN.time(c.uploaded)),
    prev ? fact("Previous cache", el("a", { href: `#${prev.id}`, text: prev.id }), ` (${CDN.ago(prev.uploaded, c.uploaded)} earlier)`) : null,
    fact("Address", el("a", { href: `${CDN.map.cdn}${c.id}/${state.folder}/game/tiles_page1.rttex`, rel: "noopener", text: `ubistatic-a.akamaihd.net/0098/${c.id}/${state.folder}/` })),
    folderSwitch, chips,
    el("div", { class: "version-platforms" }, tops),
    downloads.length ? el("div", { class: "cdn-downloads" }, downloads) : null].flat().filter(Boolean));
}

// ---------------------------------------------------------------- explorer
function go(path) {
  history.replaceState(null, "", `#${[state.cache.id, ...path].map(encodeURIComponent).join("/")}`);
  state.path = path;
  state.open = null;
  renderExplorer();
}

function listing() {
  const c = state.cache;
  const prefix = state.path.length ? state.path.join("/") + "/" : "";
  let files = CDN.files(state.folder, c.i).filter((f) => f.name.startsWith(prefix));
  if (state.view === "changes") files = files.filter((f) => f.change).concat(CDN.gone(state.folder, c.i).filter((f) => f.name.startsWith(prefix)));
  const q = state.filter;
  // A search or the changes view lists matches from every subfolder; otherwise this folder only.
  const flat = Boolean(q) || state.view === "changes";
  if (q) files = files.filter((f) => f.name.toLowerCase().includes(q));
  const folders = new Map();
  const here = [];
  for (const f of files) {
    const rest = f.name.slice(prefix.length);
    if (!flat && rest.includes("/")) {
      const d = rest.split("/")[0];
      const agg = folders.get(d) || { name: d, files: 0, bytes: 0, changes: 0 };
      agg.files++; agg.bytes += f.v ? f.v.size : 0; if (f.change) agg.changes++;
      folders.set(d, agg);
    } else here.push({ ...f, label: rest });
  }
  return { folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)), files: here, flat };
}

const firstSeen = (f) => (f.v ? CDN.caches[f.v.idx[0]].uploaded : 0);
const changeSize = (f) => (f.change === "new" ? Infinity : f.change === "gone" ? -Infinity : f.change ? f.v.size - f.before.size : 0);
const SORTS = {
  name: (a, b) => a.label.localeCompare(b.label, "en", { numeric: true }),
  size: (a, b) => (a.v?.size ?? -1) - (b.v?.size ?? -1),
  change: (a, b) => (changeSize(a) === changeSize(b) ? 0 : changeSize(a) < changeSize(b) ? -1 : 1),
  first: (a, b) => firstSeen(a) - firstSeen(b),
};

function changeCell(f) {
  if (f.change === "new") return CDN.chip("New", "new");
  if (f.change === "gone") return CDN.chip("Gone", "gone", `Was ${CDN.size(f.before.size)}`);
  if (f.change === "changed") return CDN.chip(CDN.delta(f.v.size - f.before.size), "changed", `${CDN.size(f.before.size)} → ${CDN.size(f.v.size)}`);
  return el("span", { class: "cdn-muted", text: "-" });
}

function fileRow(f, child) {
  const open = state.open === f.name;
  const first = f.v ? CDN.caches[f.v.idx[0]] : null;
  const row = el("tr", { class: `cdn-row${child ? " is-child" : ""}${open ? " is-open" : ""}${f.change ? " is-" + f.change : ""}`, tabindex: "0", "aria-expanded": String(open),
    onclick: () => { state.open = open ? null : f.name; renderExplorer(); },
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); } } },
  el("td", { class: "cdn-name-cell" }, CDN.typeBadge(f.name), el("span", { class: "cdn-file-name", text: f.label, title: f.name }), CDN.isBeta(f.name) ? CDN.chip("beta", "beta") : null),
  el("td", { class: "cell-end", text: f.v ? CDN.size(f.v.size) : "-" }),
  el("td", {}, changeCell(f)),
  el("td", { text: first ? CDN.day(first.uploaded) : "-", title: first ? `This exact file first appeared in ${first.id}` : "" }),
  el("td", { class: "cell-end", text: f.v ? f.v.idx.length : "-", title: "How many caches have this exact file" }));
  return open ? [row, detailRow(f)] : [row];
}

function detailRow(f) {
  const c = state.cache;
  const vs = CDN.map[state.folder][f.name];
  const from = f.v ? c : CDN.caches[f.before.idx.at(-1)];
  const preview = el("div", { class: "cdn-detail-preview checker" }, el("small", { text: "Loading preview..." }));
  if (CDN.kind(f.name) === "rttex") CDN.thumb(preview, from.id, state.folder, f.name, 320);
  else if (CDN.kind(f.name) === "audio") preview.replaceChildren(el("audio", { controls: true, preload: "none", src: CDN.relay(from.id, state.folder, f.name) }));
  else preview.replaceChildren(CDN.typeBadge(f.name));

  const history = el("ol", { class: "cdn-history" }, vs.map((v) => {
    const a = CDN.caches[v.idx[0]], b = CDN.caches[v.idx.at(-1)];
    const here = v === f.v;
    return el("li", { class: here ? "is-here" : "" },
      el("strong", { text: `#${v.k + 1} · ${CDN.size(v.size)}` }),
      el("span", { text: v.idx.length > 1 ? ` ${CDN.day(a.uploaded)} → ${CDN.day(b.uploaded)}` : ` ${CDN.day(a.uploaded)}` }),
      el("small", { text: ` · ${v.idx.length} cache${v.idx.length > 1 ? "s" : ""}` }),
      here ? CDN.chip("this cache", "here") : null);
  }));

  const links = el("p", { class: "cdn-detail-links" },
    el("a", { href: `cdn-files.html?file=${encodeURIComponent(CDN.baseOf(f.name))}&cache=${encodeURIComponent(from.id)}`, text: "Open in Files Archive" }),
    el("a", { href: CDN.url(from.id, state.folder, f.name), rel: "noopener", text: "Download" }));

  return el("tr", { class: "cdn-detail" }, el("td", { colspan: 5 },
    el("div", { class: "cdn-detail-grid" }, preview,
      el("div", {},
        el("h4", { text: f.name }),
        el("p", { class: "cdn-muted", text: f.v ? `This version first seen in ${CDN.caches[f.v.idx[0]].id}` : `Not in this cache; last seen in ${from.id}` }),
        el("h5", { text: `${vs.length} version${vs.length > 1 ? "s" : ""}, told apart by size` }), history, links))));
}

function sortHead(key, label, end) {
  const on = state.sort.key === key;
  return el("th", { scope: "col", class: end ? "cell-end" : "", "aria-sort": on ? (state.sort.dir > 0 ? "ascending" : "descending") : null },
    el("button", { type: "button", class: "cdn-sort", text: `${label}${on ? (state.sort.dir > 0 ? " ▲" : " ▼") : ""}`,
      onclick: () => { state.sort = { key, dir: on ? -state.sort.dir : key === "name" ? 1 : -1 }; renderExplorer(); } }));
}

function renderExplorer() {
  const c = state.cache;
  const { folders, files, flat } = listing();
  const sorter = SORTS[state.sort.key];
  // A _beta.rttex follows its base file when both are listed.
  const byName = new Map(files.map((f) => [f.name, f]));
  const roots = files.filter((f) => !(CDN.isBeta(f.name) && byName.has(CDN.baseOf(f.name)))).sort((a, b) => sorter(a, b) * state.sort.dir || a.label.localeCompare(b.label));
  const rows = [];
  for (const f of roots) {
    rows.push(...fileRow(f, false));
    const beta = byName.get(CDN.betaOf(f.name));
    if (beta && beta !== f) rows.push(...fileRow(beta, true));
  }

  const crumbs = el("nav", { class: "cdn-crumbs", "aria-label": "Folder" },
    el("button", { type: "button", class: "cdn-crumb", text: `${c.id}/${state.folder}`, onclick: () => go([]) }),
    state.path.map((p, k) => [el("span", { text: "/" }), el("button", { type: "button", class: "cdn-crumb", text: p, onclick: () => go(state.path.slice(0, k + 1)) })]));

  const search = el("input", { class: "search cdn-filter", type: "search", placeholder: "Find files in this folder and below...", value: state.filter, "aria-label": "Find files",
    oninput: (e) => { state.filter = e.target.value.trim().toLowerCase(); clearTimeout(renderExplorer.t); renderExplorer.t = setTimeout(() => { renderExplorer(); const s = $("explorer").querySelector(".cdn-filter"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 180); } });
  const views = el("div", { class: "version-tabs", role: "group", "aria-label": "Show" }, [["all", "All files"], ["changes", "Changes only"]].map(([v, label]) =>
    el("button", { type: "button", class: "btn-sm", "aria-pressed": String(state.view === v), disabled: v === "changes" && c.i === 0, text: label, onclick: () => { state.view = v; state.open = null; renderExplorer(); } })));

  const dirRow = (label, onclick, cells) => el("tr", { class: "cdn-row cdn-dir", tabindex: "0", onclick, onkeydown: (e) => { if (e.key === "Enter") onclick(); } },
    el("td", { class: "cdn-name-cell" }, el("span", { class: "cdn-type is-dir", text: label === ".." ? "up" : "dir" }), el("span", { class: "cdn-file-name", text: label })), ...cells);
  const up = state.path.length && !flat ? [dirRow("..", () => go(state.path.slice(0, -1)), [el("td"), el("td"), el("td"), el("td")])] : [];
  const folderRows = flat ? [] : folders.map((d) => dirRow(`${d.name}/`, () => go([...state.path, d.name]), [
    el("td", { class: "cell-end", text: CDN.size(d.bytes) }),
    el("td", {}, d.changes ? CDN.chip(`${d.changes} changes`, "changed") : el("span", { class: "cdn-muted", text: "-" })),
    el("td", { class: "cdn-muted", text: `${d.files} files` }), el("td")]));

  const where = state.path.length ? state.path.join("/") + "/" : "the whole cache";
  $("explorer").replaceChildren(
    el("div", { class: "cdn-toolbar" }, crumbs, views),
    search,
    el("p", { class: "cdn-muted cdn-count", text: flat ? `${files.length.toLocaleString("en")} files in ${where}` : `${folders.length} folders and ${files.length.toLocaleString("en")} files` }),
    files.length || folders.length ? el("div", { class: "cdn-table-wrap" }, el("table", { class: "cdn-table" },
      el("thead", {}, el("tr", {}, sortHead("name", "Name"), sortHead("size", "Size", true), sortHead("change", "Since previous"), sortHead("first", "First seen"), el("th", { scope: "col", class: "cell-end", text: "Caches", title: "How many caches have this exact file" }))),
      el("tbody", {}, up, folderRows, rows)))
      : el("p", { class: "empty", text: state.view === "changes" ? "Nothing changed here." : "Nothing matches." }));
}

// ---------------------------------------------------------------- routing
// A folder the origin answers with 403 on every path. Missing IDs answer 404, so the folder exists,
// but nothing inside it and no date can be read.
function renderLocked(id) {
  $("cache_card").replaceChildren(
    el("header", { class: "version-head" }, el("h2", { text: `Folder ${id}` })),
    el("div", { class: "version-status" }, CDN.chip("locked (403)", "gone"), CDN.chip("no date"), CDN.chip("no files readable")),
    fact("Address", el("a", { href: `${CDN.map.cdn}${id}/`, rel: "noopener", text: `ubistatic-a.akamaihd.net/0098/${id}/` })),
    el("p", { class: "version-fact", text: "Every path in this folder, the folder itself, /cache/ and the installers, is answered with 403 Forbidden by the origin (static.ubi.com). IDs that do not exist answer 404, so the folder is there but closed. The 403 answer carries no upload date." }));
  $("explorer").hidden = true;
}

// Files on other hosts (CDNMapping/mapper/hosts.js): [url, size, uploaded ms, modified ms, file's own date ms (S3)].
function otherHosts() {
  const hosts = new Map();
  for (const f of CDN.map.other || []) {
    const host = new URL(f[0]).host;
    if (!hosts.has(host)) hosts.set(host, []);
    hosts.get(host).push(f);
  }
  return hosts;
}
const HOST_NOTES = {
  "cdn.growtopiagame.com": "An Amazon S3 bucket with the installers from 2017 to 2022, one folder per game version. Its HTTPS certificate does not match the name, so the files are read over http. Listing is off and a missing file also answers 403, so only known paths can be checked. \"File date\" is the date the upload tool stored for the file itself.",
  "static.growtopiagame.com": "The same server as ubistatic-a.akamaihd.net/0098 (the same upload times come back), so its caches are already in the list on the left. Only files outside the cache folders are listed here.",
};

function renderHost(host) {
  const files = otherHosts().get(host) || [];
  const bytes = files.reduce((t, f) => t + f[1], 0);
  const dates = files.map((f) => f[2]).filter(Boolean);
  const rows = files.map(([url, size, uploaded, , own]) => {
    const p = new URL(url).pathname.slice(1);
    const name = p.split("/").pop();
    const img = /\.dmg$/i.test(name) ? "download-macos.png" : /\.exe$/i.test(name) ? "download-windows.png" : null;
    return el("tr", {},
      el("td", {}, el("a", { href: url, rel: "noopener", class: "cdn-host-file" }, img ? el("img", { src: IMAGES + img, alt: "" }) : null, el("span", { text: p }))),
      el("td", { class: "cell-end", text: CDN.size(size) }),
      el("td", { text: CDN.time(uploaded) }),
      el("td", { text: own ? CDN.time(own) : "-" }));
  });
  $("cache_card").replaceChildren(
    el("header", { class: "version-head" }, el("h2", { text: host })),
    el("div", { class: "version-status" }, CDN.chip(`${files.length} files`), CDN.chip(CDN.size(bytes)),
      dates.length ? CDN.chip(`${CDN.day(Math.min(...dates))} to ${CDN.day(Math.max(...dates))}`) : null),
    HOST_NOTES[host] ? el("p", { class: "version-fact", text: HOST_NOTES[host] }) : null,
    el("div", { class: "cdn-table-wrap" }, el("table", { class: "cdn-table" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Path" }), el("th", { scope: "col", class: "cell-end", text: "Size" }),
        el("th", { scope: "col", text: "Uploaded" }), el("th", { scope: "col", text: "File date", title: "Stored by the S3 upload tool" }))),
      el("tbody", {}, rows))));
  $("explorer").hidden = true;
}

// Every .exe and .dmg seen anywhere: the caches' /0098/<id>/ installers and the other hosts.
// The same file is copied into many caches, so files of the same name and size count as one installer.
function installerList() {
  if (installerList.memo) return installerList.memo;
  const byKey = new Map();
  const add = (name, size, uploaded, where) => {
    const key = `${name}|${size}`;
    if (!byKey.has(key)) byKey.set(key, { name, size, places: [] });
    byKey.get(key).places.push({ uploaded, ...where });
  };
  for (const c of CDN.caches) for (const [name, [size, created]] of Object.entries(c.installers)) add(name, size, created || c.uploaded, { cache: c.id, url: `${CDN.map.cdn}${c.id}/${name}` });
  for (const [url, size, uploaded] of CDN.map.other || []) {
    const name = url.split("/").pop();
    if (/\.(exe|dmg)$/i.test(name)) add(name, size, uploaded, { host: new URL(url).host, folder: new URL(url).pathname.split("/").slice(1, -1).join("/") || "(top level)", url });
  }
  const list = [...byKey.values()].map((it) => {
    it.places.sort((a, b) => (a.uploaded || 0) - (b.uploaded || 0));
    it.first = it.places[0];
    it.mac = /\.dmg$/i.test(it.name);
    return it;
  });
  return (installerList.memo = list.sort((a, b) => (b.first.uploaded || 0) - (a.first.uploaded || 0)));
}

function renderInstallers() {
  const list = installerList().filter((it) => state.platform === "all" || (state.platform === "mac") === it.mac);
  const where = (p) => (p.cache ? el("a", { href: `#${p.cache}`, text: p.cache }) : el("span", { text: `${p.host} › ${p.folder}` }));
  const rows = list.map((it) => {
    const caches = it.places.filter((p) => p.cache).length;
    const hosts = it.places.filter((p) => p.host);
    return el("tr", {},
      el("td", {}, el("a", { href: it.first.url, rel: "noopener", class: "cdn-host-file" },
        el("img", { src: IMAGES + (it.mac ? "download-macos.png" : "download-windows.png"), alt: "" }), el("span", { text: it.name }))),
      el("td", { class: "cell-end", text: CDN.size(it.size), title: `${it.size.toLocaleString("en")} bytes` }),
      el("td", { text: CDN.time(it.first.uploaded) }),
      el("td", {}, where(it.first)),
      el("td", { class: "cell-end", text: [caches ? `${caches} cache${caches > 1 ? "s" : ""}` : "", hosts.length ? hosts.map((p) => p.folder).join(", ") : ""].filter(Boolean).join(" · "),
        title: it.places.map((p) => p.cache || `${p.host}/${p.folder}`).join("\n") }));
  });
  const tabs = el("div", { class: "version-tabs", role: "group", "aria-label": "Platform" }, [["all", "All"], ["win", "Windows"], ["mac", "macOS"]].map(([k, t]) =>
    el("button", { type: "button", class: "btn-sm", "aria-pressed": String(state.platform === k), text: t, onclick: () => { state.platform = k; renderInstallers(); } })));
  const all = installerList();
  $("cache_card").replaceChildren(
    el("header", { class: "version-head" }, el("h2", { text: "Installers" }), tabs),
    el("div", { class: "version-status" }, CDN.chip(`${all.length} different files`), CDN.chip(`${all.filter((i) => !i.mac).length} Windows`), CDN.chip(`${all.filter((i) => i.mac).length} macOS`)),
    el("p", { class: "version-fact", text: "Every GrowtopiaInstaller.exe and Growtopia.dmg found on ubistatic (next to the caches), static.growtopiagame.com and the old cdn.growtopiagame.com bucket. Files with the same name and size are one installer: Uploaded and First seen in are its earliest copy, the last column says where else it is." }),
    el("div", { class: "cdn-table-wrap" }, el("table", { class: "cdn-table" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "File" }), el("th", { scope: "col", class: "cell-end", text: "Size" }),
        el("th", { scope: "col", text: "Uploaded" }), el("th", { scope: "col", text: "First seen in" }), el("th", { scope: "col", class: "cell-end", text: "Also in" }))),
      el("tbody", {}, rows))));
  $("explorer").hidden = true;
}

function render() {
  $("explorer").hidden = false;
  renderNav();
  renderCard();
  renderExplorer();
}

function route() {
  const [id, ...path] = location.hash.slice(1).split("/").map(decodeURIComponent);
  state.installers = id === "installers";
  if (state.installers) {
    state.host = state.locked = null;
    state.platform ??= "all";
    renderNav();
    renderInstallers();
    return;
  }
  state.host = id.startsWith("host:") ? id.slice(5) : null;
  if (state.host) {
    state.locked = null;
    renderNav();
    renderHost(state.host);
    return;
  }
  if ((CDN.map.locked || []).includes(id)) {
    state.locked = id;
    renderNav();
    renderLocked(id);
    return;
  }
  state.locked = null;
  const c = CDN.caches.find((x) => x.id === id) || CDN.caches.at(-1);
  if (c !== state.cache) {
    state.cache = c;
    state.open = null;
    if (!c.hasBeta) state.folder = "cache";
    if (c.i === 0) state.view = "all";
  }
  state.path = path.filter(Boolean);
  render();
}

(async () => {
  try {
    await CDN.load();
  } catch {
    $("cdn_info").textContent = "Could not load the CDN map.";
    return;
  }
  const cs = CDN.caches;
  $("cdn_info").textContent = `${cs.length} caches, ${CDN.day(cs[0].uploaded)} to ${CDN.day(cs.at(-1).uploaded)}. File versions are told apart by size.`;
  window.addEventListener("hashchange", route);
  route();
})();
