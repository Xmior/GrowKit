// Files Archive: pick a file, see every version of it (told apart by size) with thumbnails, and view any
// version full size. Files are fetched from the CDN through the site's relay and RTTEX is converted here.
const { el } = CDN;
const $ = (id) => document.getElementById(id);
const LIST_LIMIT = 250;
const state = { name: null, variant: null, k: 0, compare: false, zoom: "fit", hidden: "off", fromCache: null };
let names = [];

// ---------------------------------------------------------------- left: search
// Every file once; a _beta.rttex is listed under its base file when the base exists.
function collectNames() {
  const all = new Set([...Object.keys(CDN.map.cache), ...Object.keys(CDN.map.cachebeta)]);
  return [...new Set([...all].map((n) => (all.has(CDN.baseOf(n)) ? CDN.baseOf(n) : n)))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}
// Every place a file shows up: [label, folder, name]
function variantsOf(name) {
  return [["Normal", "cache", name], ["Beta", "cache", CDN.betaOf(name)], ["cachebeta", "cachebeta", name], ["cachebeta beta", "cachebeta", CDN.betaOf(name)]]
    .filter(([label, folder, n], k) => (k % 2 === 0 || n !== name) && CDN.map[folder][n]);
}
const versionCount = (name) => variantsOf(name).reduce((t, [, f, n]) => t + CDN.map[f][n].length, 0);

function renderList() {
  const q = $("file_search").value.trim().toLowerCase();
  const top = $("file_folder").value;
  const changed = $("only_changed").checked;
  const hits = names.filter((n) => (!top || n.startsWith(top + "/")) && (!q || n.toLowerCase().includes(q)) && (!changed || versionCount(n) > variantsOf(n).length));
  $("file_count").textContent = hits.length > LIST_LIMIT ? `${hits.length.toLocaleString("en")} files, showing ${LIST_LIMIT}` : `${hits.length.toLocaleString("en")} files`;
  $("file_list").replaceChildren(...hits.slice(0, LIST_LIMIT).map((n) => {
    const count = versionCount(n);
    const hasBeta = variantsOf(n).some(([, , x]) => CDN.isBeta(x));
    return el("li", {}, el("a", { href: `?file=${encodeURIComponent(n)}`, "aria-current": n === state.name ? "page" : null, title: n,
      onclick: (e) => { e.preventDefault(); select(n); } },
    CDN.typeBadge(n), el("span", { class: "cdn-nav-id", text: n.split("/").pop() }),
    hasBeta ? el("span", { class: "cdn-nav-marks" }, el("span", { class: "is-beta", text: "β" })) : null,
    el("small", { text: `${count}×`, title: `${count} versions` })));
  }));
}

// ---------------------------------------------------------------- file card
function fact(label, ...value) {
  return el("p", { class: "version-fact" }, el("strong", { text: `${label}: ` }), ...value);
}

function select(name, fromCache) {
  state.name = name;
  const vars = variantsOf(name);
  state.variant = vars[0];
  state.fromCache = fromCache || null;
  const vs = CDN.map[state.variant[1]][state.variant[2]];
  const hit = fromCache ? vs.find((v) => v.idx.some((i) => CDN.caches[i].id === fromCache)) : null;
  state.k = hit ? hit.k : vs.length - 1;
  state.compare = false;
  history.replaceState(null, "", `?file=${encodeURIComponent(name)}`);
  renderList();
  renderCard();
  renderViewer();
}

function renderCard() {
  const [label, folder, file] = state.variant;
  const vs = CDN.map[folder][file];
  const caches = vs.flatMap((v) => v.idx);
  const first = CDN.caches[Math.min(...caches)], last = CDN.caches[Math.max(...caches)];
  const vars = variantsOf(state.name);

  const tabs = vars.length > 1 ? el("div", { class: "version-tabs", role: "group", "aria-label": "Variant" }, vars.map((v) =>
    el("button", { type: "button", class: "btn-sm", "aria-pressed": String(v === state.variant), text: `${v[0]} (${CDN.map[v[1]][v[2]].length})`,
      onclick: () => { state.variant = v; state.k = CDN.map[v[1]][v[2]].length - 1; state.compare = false; renderCard(); renderViewer(); } }))) : null;

  const tiles = vs.map((v) => {
    const a = CDN.caches[v.idx[0]], b = CDN.caches[v.idx.at(-1)];
    const prev = vs[v.k - 1];
    const thumb = el("div", { class: "cdn-version-thumb checker" }, el("small", { text: "..." }));
    const png = file === "interface/large/news_banner.rttex" && folder === "cache" && b.banner === v.size ? CDN.banner(b, true) : null;
    if (png) thumb.replaceChildren(el("img", { src: png, alt: "", loading: "lazy" }));
    else if (CDN.kind(file) === "rttex") CDN.thumb(thumb, b.id, folder, file, 96);
    else thumb.replaceChildren(CDN.typeBadge(file));
    return el("button", { type: "button", class: `cdn-version${state.compare && v.k === state.k - 1 ? " is-compare" : ""}`, "aria-pressed": String(v.k === state.k),
      onclick: () => { state.k = v.k; renderCard(); renderViewer(); } },
    thumb,
    el("strong", { text: `#${v.k + 1} · ${CDN.size(v.size)}` }),
    prev ? CDN.chip(CDN.delta(v.size - prev.size), "changed") : CDN.chip("first", "new"),
    el("small", { text: v.idx.length > 1 ? `${CDN.day(a.uploaded)} → ${CDN.day(b.uploaded)}` : CDN.day(a.uploaded) }),
    el("small", { text: `${v.idx.length} cache${v.idx.length > 1 ? "s" : ""}: ${a.id}${v.idx.length > 1 ? " … " + b.id : ""}` }));
  });

  $("file_card").replaceChildren(...[
    el("header", { class: "version-head" }, CDN.typeBadge(file), el("h2", { text: file.split("/").pop() }), CDN.isBeta(file) ? CDN.chip("beta", "beta") : null),
    fact("Path", el("code", { text: `/${folder}/${file}` })),
    fact("Seen", `${CDN.day(first.uploaded)} (`, el("a", { href: `cdn.html#${first.id}/${file.split("/").slice(0, -1).join("/")}`, text: first.id }), `) to ${CDN.day(last.uploaded)} (`,
      el("a", { href: `cdn.html#${last.id}/${file.split("/").slice(0, -1).join("/")}`, text: last.id }), ")"),
    el("div", { class: "version-status" },
      CDN.chip(`${vs.length} version${vs.length > 1 ? "s" : ""}`),
      CDN.chip(`in ${caches.length} of ${CDN.caches.length} caches`),
      CDN.chip(`${CDN.size(Math.min(...vs.map((v) => v.size)))}${vs.length > 1 ? " to " + CDN.size(Math.max(...vs.map((v) => v.size))) : ""}`)),
    tabs,
    el("div", { class: "cdn-versions" }, tiles)].filter(Boolean));
}

// ---------------------------------------------------------------- viewer
async function stage(folder, file, v, label) {
  const c = CDN.caches[v.idx.at(-1)];
  const view = el("div", { class: `cdn-stage-view checker${state.zoom === "fit" ? " is-fit" : ""}` }, el("p", { class: "status", text: "Loading..." }));
  const info = el("span", { class: "cdn-stage-label", text: `${label} · #${v.k + 1} · ${CDN.size(v.size)} · from ${c.id}` });
  const box = el("div", { class: "cdn-stage" }, info, view);
  try {
    const bytes = await CDN.fetchBytes(c.id, folder, file);
    const kind = CDN.kind(file);
    const canvas = kind === "rttex" || kind === "other" ? CDN.toCanvas(bytes, state.hidden) : null;
    if (canvas) {
      if (state.zoom !== "fit") { canvas.style.width = `${canvas.width * Number(state.zoom)}px`; }
      const packed = RT.magic(bytes) === "RTPACK";
      info.textContent += ` · ${canvas.width}×${canvas.height} · ${packed ? "RTPACK" : "RTTXTR"}`;
      box.dataset.png = "1";
      box._canvas = canvas;
      view.replaceChildren(canvas);
    } else if (kind === "audio") {
      view.classList.remove("checker");
      view.replaceChildren(el("audio", { controls: true, src: URL.createObjectURL(new Blob([bytes], { type: `audio/${CDN.ext(file) === "mp3" ? "mpeg" : CDN.ext(file)}` })) }));
    } else if (kind === "rttex") {
      throw new Error("this is not a texture the converter can read");
    } else if (kind === "text" || bytes.slice(0, 512).every((b) => b === 9 || b === 10 || b === 13 || b >= 32)) {
      view.classList.remove("checker");
      view.replaceChildren(el("pre", { class: "cdn-text", text: new TextDecoder().decode(bytes.subarray(0, 300000)) }));
    } else {
      view.classList.remove("checker");
      view.replaceChildren(el("p", { text: "No preview for this file type. Use Download." }));
    }
  } catch (e) {
    // news_banner.rttex has a pre-converted PNG that works without the relay.
    if (file === "interface/large/news_banner.rttex" && folder === "cache" && c.banner === v.size) {
      view.replaceChildren(el("img", { src: CDN.banner(c), alt: "" }));
      info.textContent += " · 985×256 (pre-converted PNG)";
    } else view.replaceChildren(el("p", { class: "status", text: `Could not load it: ${e.message}` }));
  }
  return box;
}

async function renderViewer() {
  const [label, folder, file] = state.variant;
  const vs = CDN.map[folder][file];
  const v = vs[state.k];
  const prev = vs[state.k - 1];
  const viewer = $("viewer");
  viewer.hidden = false;
  const token = (renderViewer.token = {});
  const isImage = CDN.kind(file) === "rttex";
  const c = CDN.caches[v.idx.at(-1)];

  const zooms = isImage ? el("div", { class: "version-tabs", role: "group", "aria-label": "Zoom" }, ["fit", "1", "2", "4"].map((z) =>
    el("button", { type: "button", class: "btn-sm", "aria-pressed": String(state.zoom === z), text: z === "fit" ? "Fit" : `${z}×`, onclick: () => { state.zoom = z; renderViewer(); } }))) : null;
  const hidden = isImage ? el("div", { class: "version-tabs", role: "group", "aria-label": "Hidden pixels",
    title: "Pixels with alpha 0 can still hold colour (leftover PSD pixels). White and black ones are left out, as in the RTTEX tool." },
    [["off", "Normal"], ["reveal", "Reveal hidden"], ["only", "Hidden only"]].map(([m, t]) =>
      el("button", { type: "button", class: "btn-sm", "aria-pressed": String(state.hidden === m), text: t, onclick: () => { state.hidden = m; renderViewer(); } }))) : null;
  const compare = prev ? el("button", { type: "button", class: "btn-sm", "aria-pressed": String(state.compare), text: `Compare with #${prev.k + 1}`,
    onclick: () => { state.compare = !state.compare; renderCard(); renderViewer(); } }) : null;
  const save = isImage ? el("button", { type: "button", class: "btn-sm btn-save", text: "Save PNG",
    onclick: async () => { const s = viewer.querySelector(".cdn-stage:last-child"); if (s?._canvas) GK.download(await RT.canvasToBlob(s._canvas), file.split("/").pop().replace(/\.rttex$/i, `_v${v.k + 1}.png`)); } }) : null;
  const download = el("a", { class: "btn-sm cdn-step-btn", href: CDN.url(c.id, folder, file), rel: "noopener", text: "Download original" });

  viewer.replaceChildren(el("div", { class: "cdn-viewer-bar" }, el("h3", { class: "grow", text: `Version #${v.k + 1}` }), zooms, hidden, compare, save, download),
    el("p", { class: "status", text: "Loading from the CDN..." }));
  const stages = await Promise.all(state.compare && prev ? [stage(folder, file, prev, "Before"), stage(folder, file, v, "After")] : [stage(folder, file, v, label)]);
  if (token !== renderViewer.token) return; // a newer pick replaced this one
  const diff = stages.length === 2 ? differences(stages[0]._canvas, stages[1]._canvas) : null;
  viewer.lastChild.replaceWith(el("div", { class: `cdn-stages${stages.length > 1 ? " is-split" : ""}` }, stages), diff);
}

// Changed pixels in red over a faded copy of the newer texture, read from the raw file pixels.
// Normal mode compares what the game shows (two alpha 0 pixels are equal whatever colour they hold);
// with hidden pixels on, a change in a hidden colour counts too and is drawn in yellow.
function differences(a, b) {
  if (!a || !b) return null;
  if (a.width !== b.width || a.height !== b.height) {
    return el("p", { class: "cdn-muted", text: `The texture size changed: ${a.width}×${a.height} → ${b.width}×${b.height}.` });
  }
  const w = a.width, h = a.height;
  const pa = a._rgba, pb = b._rgba;
  const out = new ImageData(w, h);
  let visible = 0, hidden = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const exact = pa[i] === pb[i] && pa[i + 1] === pb[i + 1] && pa[i + 2] === pb[i + 2] && pa[i + 3] === pb[i + 3];
    const bothClear = pa[i + 3] === 0 && pb[i + 3] === 0;
    if (exact || bothClear) {
      if (!exact && (CDN.isHidden(pa, i) || CDN.isHidden(pb, i))) {
        hidden++;
        if (state.hidden !== "off") { out.data[i] = 255; out.data[i + 1] = 200; out.data[i + 2] = 0; out.data[i + 3] = 255; continue; }
      }
      const shown = state.hidden !== "off" && CDN.isHidden(pb, i) ? 255 : pb[i + 3];
      const g = (pb[i] + pb[i + 1] + pb[i + 2]) / 3;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
      out.data[i + 3] = shown * 0.25;
    } else {
      visible++;
      out.data[i] = 255; out.data[i + 1] = 40; out.data[i + 2] = 40; out.data[i + 3] = 255;
    }
  }
  const canvas = el("canvas", { width: w, height: h });
  canvas.getContext("2d").putImageData(out, 0, 0);
  if (state.zoom !== "fit") canvas.style.width = `${w * Number(state.zoom)}px`;
  const pct = (n) => `${((n / (w * h)) * 100).toFixed(2)}%`;
  const fmt = (n) => n.toLocaleString("en");
  let text;
  if (!visible && !hidden) text = "Differences · the pixels are identical, hidden ones included";
  else if (!visible) text = `Differences · the visible pixels are identical; only ${fmt(hidden)} hidden pixels changed (${pct(hidden)})` +
    (state.hidden === "off" ? ". Turn on Reveal hidden to see them." : ", in yellow");
  else text = `Differences · ${fmt(visible)} visible pixels changed (${pct(visible)})` +
    (hidden ? `, plus ${fmt(hidden)} hidden${state.hidden === "off" ? "" : " in yellow"}` : "");
  return el("div", { class: "cdn-stage" },
    el("span", { class: "cdn-stage-label", text }),
    el("div", { class: `cdn-stage-view checker${state.zoom === "fit" ? " is-fit" : ""}` }, canvas));
}

// ---------------------------------------------------------------- start
(async () => {
  try {
    await CDN.load();
  } catch {
    $("files_info").textContent = "Could not load the CDN map.";
    return;
  }
  names = collectNames();
  const tops = [...new Set(names.filter((n) => n.includes("/")).map((n) => n.split("/")[0]))].sort();
  $("file_folder").append(...tops.map((t) => el("option", { value: t, text: `${t}/` })));
  const multi = names.filter((n) => versionCount(n) > variantsOf(n).length).length;
  $("files_info").textContent = `${names.length.toLocaleString("en")} files, ${multi.toLocaleString("en")} of them changed at least once, across ${CDN.caches.length} caches.`;
  let t;
  $("file_search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(renderList, 150); });
  $("file_folder").addEventListener("change", renderList);
  $("only_changed").addEventListener("change", renderList);
  const p = new URLSearchParams(location.search);
  const wanted = p.get("file") && CDN.baseOf(p.get("file"));
  if (wanted) $("file_search").value = wanted.split("/").pop();
  renderList();
  if (wanted && names.includes(wanted)) select(wanted, p.get("cache"));
})();
