// Shared page shell, toasts, drop zones and download helpers.
const GK = {
  tools: [
    { href: "rttex.html", label: "RTTEX" },
    { href: "rtfont.html", label: "RTFONT" },
    { href: "items.html", label: "items.dat" },
    { href: "search.html", label: "Item Search" },
    { href: "extras.html", label: "Extras" },
  ],

  // Pages in archive/ sit one folder down from the rest of the site
  weatherEnabled: false, // backgrounds are switched off for now; set to true to bring the picker back
  root: location.pathname.includes("/archive/") ? "../" : "",

  renderShell() {
    const page = location.pathname.split("/").pop() || "index.html";
    const inArchive = Boolean(this.root);
    const current = (t) => (inArchive ? t.href === "extras.html" : t.href === page);
    const links = this.tools
      .map((t) => `<a href="${this.root}${t.href}"${current(t) ? ' aria-current="page"' : ""}>${t.label.replace("&", "&amp;")}</a>`)
      .join("<span aria-hidden=\"true\"> - </span>");
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<a class="skip" href="#main">Skip to content</a>
      <div class="sun" aria-hidden="true"></div>
      <div class="cloud" aria-hidden="true"></div><div class="cloud" aria-hidden="true"></div><div class="cloud" aria-hidden="true"></div>
      <header class="topbar">
        <div class="topbar-tools">
          <button class="dark-mode-button" id="dark_toggle" aria-label="Toggle dark mode"></button>
          <label class="topbar-weather"><span>Weather</span><select id="weather_pick"><option value="">Default</option></select></label>
          <label class="check check-left topbar-antilag"><input type="checkbox" id="anti_lag"> <span>Anti-lag</span></label>
        </div>
        <nav class="info-bar" aria-label="Tools"><a href="${this.root}index.html"${!inArchive && page === "index.html" ? ' aria-current="page"' : ""}>GrowKit</a><span aria-hidden="true"> - </span>${links}</nav>
      </header>`
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<footer class="footer wrap">
        <p>Your files are processed in your browser and never uploaded.</p>
        <p>Unofficial community tool, not affiliated with Growtopia. Made by 
        <a href="https://github.com/Xmior/" rel="noopener">Xmior aka Caferius</a></p>
      </footer>
      <div class="toasts" id="toasts" role="status" aria-live="polite"></div>`
    );
    let dark = false;
    try {
      dark = localStorage.getItem("growkit-dark") === "1";
    } catch {}
    document.body.classList.toggle("dark-mode", dark);
    document.getElementById("dark_toggle").addEventListener("click", () => {
      const on = document.body.classList.toggle("dark-mode");
      try {
        localStorage.setItem("growkit-dark", on ? "1" : "0");
      } catch {}
    });
    this.setupLook();
  },

  // Saved looks may be blocked by the browser, in which case they just last for this page
  remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },

  recall(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  },

  applyLook() {
    const weather = document.getElementById("weather_pick").value;
    const antiLag = document.getElementById("anti_lag").checked;
    document.body.classList.toggle("anti-lag", antiLag);
    document.body.classList.toggle("has-weather", Boolean(weather) && !antiLag);
    document.body.style.backgroundImage = weather && !antiLag ? `url("${this.root}assets/weather/${weather}")` : "";
    document.dispatchEvent(new Event("growkit-look"));
  },

  setupLook() {
    const picker = document.getElementById("weather_pick");
    const antiLag = document.getElementById("anti_lag");
    picker.closest("label").hidden = !this.weatherEnabled;
    if (this.weatherEnabled) for (const { name, file } of GK_WEATHERS) picker.add(new Option(name, file));
    picker.value = this.weatherEnabled ? this.recall("growkit-weather") : "";
    if (picker.selectedIndex < 0) picker.value = "";
    antiLag.checked = this.recall("growkit-anti-lag") === "1";
    picker.addEventListener("change", () => {
      this.remember("growkit-weather", picker.value);
      this.applyLook();
    });
    antiLag.addEventListener("change", () => {
      this.remember("growkit-anti-lag", antiLag.checked ? "1" : "0");
      this.applyLook();
    });
    this.applyLook();
  },

  toast(message, type = "ok") {
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.getElementById("toasts").appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 7000 : 3500);
  },

  // Click and drag-and-drop file area: <label class="drop"><input type="file"></label>
  bindDrop(label, onFiles) {
    const input = label.querySelector("input[type=file]");
    input.addEventListener("change", () => {
      if (input.files.length) onFiles([...input.files]);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((n) =>
      label.addEventListener(n, (e) => {
        e.preventDefault();
        label.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((n) =>
      label.addEventListener(n, (e) => {
        e.preventDefault();
        label.classList.remove("is-over");
      })
    );
    label.addEventListener("drop", (e) => {
      const files = [...e.dataTransfer.files];
      if (files.length) onFiles(input.multiple ? files : files.slice(0, 1));
    });
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
  },

  download(data, name) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  baseName(name) {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
  },

  formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  },

  // Proton hash: same loop as GrowTools, with the result fixed to 32 bits.
  protonHash(buffer) {
    const bytes = new Uint8Array(buffer);
    let hash = 0x55555555;
    for (let i = 0; i < bytes.length; i++) hash = ((hash >>> 27) + (hash << 5) + bytes[i]) | 0;
    return hash;
  },
};

GK.renderShell();
