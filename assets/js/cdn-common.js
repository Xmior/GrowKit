// Shared by CDN Mapping and Files Archive: loads assets/data/cdn/cdn-map.json (built by CDNMapping/mapper/build.js).
// A file's "version" changes when its size on the CDN changes. Caches are full copies of the game files,
// so the date a version first appeared is the upload date of the first cache that has it.
const CDN = {
  map: null,
  caches: [],   // { i, id, uploaded, count, bytes, installers, hasBeta, complete, stats }
  at: {},       // folder -> name -> Int16Array(caches): version index in that cache, -1 when absent

  async load() {
    this.map = await (await fetch(`${GK.root}assets/data/cdn/cdn-map.json`)).json();
    this.caches = this.map.caches.map(([id, uploaded, count, bytes, installers, hasBeta, complete, banner], i) => ({ i, id, uploaded, count, bytes, installers, hasBeta, complete, banner }));
    for (const folder of ["cache", "cachebeta"]) {
      this.at[folder] = {};
      for (const [name, vs] of Object.entries(this.map[folder])) {
        const at = new Int16Array(this.caches.length).fill(-1);
        this.map[folder][name] = vs.map(([size, r, created, modified], k) => {
          const idx = this.unrange(r);
          for (const i of idx) at[i] = k;
          return { k, size, idx, created, modified };
        });
        this.at[folder][name] = at;
      }
    }
    for (const c of this.caches) c.stats = { cache: this.stats("cache", c.i), cachebeta: c.hasBeta ? this.stats("cachebeta", c.i) : null };
    return this;
  },

  unrange(s) {
    return s.split(",").flatMap((p) => {
      const [a, b] = p.split("-").map(Number);
      return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, k) => a + k);
    });
  },

  // The version of a file in cache i, or null.
  version(folder, name, i) {
    const k = this.at[folder][name]?.[i] ?? -1;
    return k < 0 ? null : this.map[folder][name][k];
  },

  // Files of cache i in a folder, each with how it differs from the cache before.
  files(folder, i) {
    const out = [];
    for (const [name, at] of Object.entries(this.at[folder])) {
      if (at[i] < 0) continue;
      const v = this.map[folder][name][at[i]];
      const before = i > 0 && at[i - 1] >= 0 ? this.map[folder][name][at[i - 1]] : null;
      const change = i === 0 ? null : !before ? "new" : before !== v ? "changed" : null;
      out.push({ name, v, before, change });
    }
    return out;
  },
  // Files that were in the previous cache and are not in cache i.
  gone(folder, i) {
    if (i === 0) return [];
    const out = [];
    for (const [name, at] of Object.entries(this.at[folder])) {
      if (at[i] < 0 && at[i - 1] >= 0) out.push({ name, v: null, before: this.map[folder][name][at[i - 1]], change: "gone" });
    }
    return out;
  },

  stats(folder, i) {
    const s = { files: 0, bytes: 0, new: 0, changed: 0, gone: this.gone(folder, i).length, tops: {} };
    for (const f of this.files(folder, i)) {
      const top = f.name.includes("/") ? f.name.split("/")[0] : "";
      const t = (s.tops[top] ??= { files: 0, bytes: 0, changes: 0 });
      s.files++; s.bytes += f.v.size; t.files++; t.bytes += f.v.size;
      if (f.change) { s[f.change]++; t.changes++; }
    }
    return s;
  },

  isBeta: (name) => /_beta\.rttex$/i.test(name),
  baseOf: (name) => name.replace(/_beta(\.rttex)$/i, "$1"),
  betaOf: (name) => name.replace(/\.rttex$/i, "_beta.rttex"),
  ext: (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : ""),
  kind(name) {
    const e = this.ext(name);
    if (e === "rttex") return "rttex";
    if (["wav", "ogg", "mp3"].includes(e)) return "audio";
    if (["txt", "json", "xml", "js", "csv", "ini", "rtfont"].includes(e)) return e === "rtfont" ? "font" : "text";
    return "other";
  },

  url(id, folder, name) {
    return `${this.map.cdn}${id}/${folder}/${name}`;
  },
  // The CDN sends no CORS headers, so the pages read files through the site's relay.
  relay(id, folder, name) {
    return `${GK.root}api/cdn.php?path=${encodeURIComponent(`0098/${id}/${folder}/${name}`)}`;
  },
  // Re-renders ask for the same files again, so the last fetches are kept in memory.
  memo: new Map(),
  fetchBytes(id, folder, name) {
    const key = `${id}/${folder}/${name}`;
    if (this.memo.has(key)) {
      const hit = this.memo.get(key);
      this.memo.delete(key);
      this.memo.set(key, hit);
      return hit;
    }
    const p = this.fetchFresh(id, folder, name);
    p.catch(() => this.memo.delete(key));
    this.memo.set(key, p);
    if (this.memo.size > 80) this.memo.delete(this.memo.keys().next().value);
    return p;
  },
  async fetchFresh(id, folder, name) {
    const res = await fetch(this.relay(id, folder, name));
    if (!res.ok) throw new Error(`the CDN answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A server without PHP hands back the relay's source instead of running it.
    if (this.RELAY_DOWN.some((m) => bytes.length >= m.length && m.every((b, k) => bytes[k] === b))) {
      throw new Error("the preview relay is not running on this server (api/cdn.php needs PHP, or restart dev-server.py)");
    }
    return bytes;
  },
  RELAY_DOWN: ["<?php", "<!doctype", "<!DOCTYPE", "<html"].map((s) => [...s].map((c) => c.charCodeAt(0))),

  // news_banner.rttex of a cache, pre-converted to PNG by CDNMapping/mapper/banners.js. small: list size.
  banner(c, small) {
    return c.banner ? `${GK.root}assets/data/cdn/banners/${c.banner}${small ? "-s" : ""}.png` : null;
  },
  // RTTEX bytes -> canvas, or null when they are not a texture. The file's raw RGBA stays on canvas._rgba:
  // a canvas drops the colour of fully transparent pixels, and those are what "hidden" mode shows.
  toCanvas(bytes, hidden = "off") {
    const m = RT.magic(bytes);
    if (m !== "RTPACK" && m !== "RTTXTR") return null;
    const t = RT.decodeTexture(RT.unpack(bytes));
    const canvas = document.createElement("canvas");
    canvas.width = t.width;
    canvas.height = t.height;
    canvas.getContext("2d").putImageData(new ImageData(this.hiddenPixels(t.rgba, hidden), t.width, t.height), 0, 0);
    canvas._rgba = t.rgba;
    return canvas;
  },
  // Same rules as the RTTEX tool's defaults (Increase alpha 0 only, Remove white, Remove black):
  // "reveal" makes alpha 0 pixels that still hold a colour opaque (leftover PSD pixels), "only" shows just those.
  hiddenPixels(rgba, mode) {
    if (mode === "off") return rgba;
    const out = new Uint8ClampedArray(rgba);
    for (let i = 0; i < out.length; i += 4) {
      const hidden = this.isHidden(out, i);
      if (hidden) out[i + 3] = 255;
      else if (mode === "only") out[i + 3] = 0;
    }
    return out;
  },
  isHidden(p, i) {
    if (p[i + 3] !== 0) return false;
    const white = p[i] === 255 && p[i + 1] === 255 && p[i + 2] === 255;
    const black = p[i] === 0 && p[i + 1] === 0 && p[i + 2] === 0;
    return !white && !black;
  },

  size(b) {
    const a = Math.abs(b);
    const s = a >= 1048576 ? `${(a / 1048576).toFixed(2)} MB` : a >= 1024 ? `${(a / 1024).toFixed(1)} KB` : `${a} B`;
    return b < 0 ? `-${s}` : s;
  },
  delta(b) {
    return b === 0 ? "same size" : `${b > 0 ? "+" : ""}${this.size(b)}`;
  },
  day(ms) {
    return ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-";
  },
  time(ms) {
    return ms ? `${this.day(ms)}, ${new Date(ms).toISOString().slice(11, 16)} UTC` : "-";
  },
  ago(ms, from) {
    const d = Math.round((from - ms) / 86400000);
    if (d < 1) return "the same day";
    if (d < 60) return `${d} day${d > 1 ? "s" : ""}`;
    const m = Math.round(d / 30.4);
    return m < 24 ? `${m} months` : `${(d / 365).toFixed(1)} years`;
  },

  el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k in e && !k.includes("-")) e[k] = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
    return e;
  },
  chip(text, kind, title) {
    return this.el("span", { class: `version-chip cdn-chip${kind ? " is-" + kind : ""}`, text, title });
  },
  typeBadge(name) {
    const k = this.kind(name);
    return this.el("span", { class: `cdn-type is-${k}`, text: this.ext(name) || "file" });
  },
  // Lazily loads a small RTTEX thumbnail into box when it scrolls into view.
  thumb(box, id, folder, name, maxSide = 96) {
    const load = async () => {
      try {
        const canvas = this.toCanvas(await this.fetchBytes(id, folder, name));
        if (!canvas) { box.replaceChildren(this.el("small", { text: "not a texture" })); return; }
        const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
        canvas.style.width = `${Math.max(1, Math.round(canvas.width * s))}px`;
        box.replaceChildren(canvas);
      } catch (e) {
        box.replaceChildren(this.el("small", { class: "cdn-thumb-error", text: "No preview", title: e.message }));
      }
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: "200px" });
    io.observe(box);
  },
};
