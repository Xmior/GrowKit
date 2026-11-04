// Version cards from assets/data/gtarchive/clients.json, newest first. The full grid is on clients-table.html.
const cardsBox = document.getElementById("version_cards");
const moreMark = document.getElementById("versions_more");
const BATCH = 25; // cards are added while scrolling, as all 500 at once would be slow
const listBox = document.getElementById("versions_list");
const IMAGES = "../assets/img/archive/";
const DOWNLOADS = [
  { platform: "Android", image: "download-android.webp", label: "Download for Android" },
  { platform: "iOS", image: "download-ios.png", label: "Download for iPhone/iPad" },
  { platform: "Windows", image: "download-windows.png", label: "Download for Windows" },
  { platform: "MacOS", image: "download-macos.png", label: "Download for MacOS" },
];
// Item sprites for each line, as in the wiki's version template: sheet, cell x, cell y
const SPRITES = {
  version: ["tiles_page4", 6, 1], android: ["tiles_page3", 3, 3], ios: ["player_hair", 4, 6], macos: ["tiles_page15", 20, 9],
  date: ["tiles_page2", 27, 22], whatsNew: ["tiles_page2", 28, 18], systems: ["tiles_page14", 31, 26],
};
const PLATFORM_SPRITES = { iOS: "ios", Android: "android", MacOS: "macos", Windows: "version", "Steam (Win)": "systems", "UbiConnect (Win)": "systems" };
const STATUS_NAMES = { found: "Found", lost: "Lost", unsure: "Might Exist", none: "Doesn't Exist" };
const STATUS_PLATFORMS = ["Android", "iOS", "Windows", "MacOS"];
// Stretches where no client came out and the numbers jumped ahead, newest and oldest version of each
const VERSION_SKIPS = [
  { name: "Version Skip 3", from: "v4.74", to: "v4.99" },
  { name: "Version Skip 2", from: "v3.21", to: "v3.30" },
  { name: "Version Skip 1", from: "v3.03", to: "v3.19" },
];
let data = null;
let shown = [];
let drawn = 0;

const selected = () => decodeURIComponent(location.hash.slice(1));

// Newest first, with each skipped stretch folded into one entry
function buildItems() {
  const rows = data.rows;
  const items = [];
  let i = rows.length - 1;
  while (i >= 0) {
    const skip = VERSION_SKIPS.find((s) => s.to === rows[i].version);
    if (!skip) {
      items.push({ row: rows[i] });
      i--;
      continue;
    }
    const group = [];
    while (i >= 0) {
      group.push(rows[i]);
      i--;
      if (group[group.length - 1].version === skip.from) break;
    }
    items.push({ skip: skip.name, rows: group });
  }
  return items;
}

const versionLink = (row) => {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `#${encodeURIComponent(row.version)}`;
  link.textContent = row.version;
  if (row.version === selected()) link.setAttribute("aria-current", "true");
  item.append(link);
  return item;
};

function renderList() {
  listBox.replaceChildren(...shown.map((entry) => {
    if (entry.row) return versionLink(entry.row);
    const item = document.createElement("li");
    const fold = document.createElement("details");
    fold.open = entry.rows.some((row) => row.version === selected());
    const summary = document.createElement("summary");
    summary.textContent = entry.skip;
    const inner = document.createElement("ul");
    inner.append(...entry.rows.map(versionLink));
    fold.append(summary, inner);
    item.append(fold);
    return item;
  }));
}

function sprite(name) {
  const [sheet, x, y] = SPRITES[name];
  const canvas = document.createElement("canvas");
  canvas.className = "version-sprite";
  canvas.width = canvas.height = 32;
  const image = new Image();
  image.onload = () => canvas.getContext("2d").drawImage(image, x * 32, y * 32, 32, 32, 0, 0, 32, 32);
  image.src = `../assets/game/${sheet}.png`;
  return canvas;
}

function fact(label, value, icon) {
  const line = document.createElement("p");
  line.className = "version-fact";
  if (icon) line.append(sprite(icon));
  const name = document.createElement("strong");
  name.textContent = `${label}: `;
  line.append(name, value);
  return line;
}

// Every card lists these, with Unknown for what the archive doesn't have yet
const PLATFORM_BOXES = [
  { platform: "iOS", icon: "ios", fields: ["iOS Build ID", "AppStore Version ID", "iOS Release Date"] },
  { platform: "Android", icon: "android", fields: ["Android Version Identifier", "Android Release Date"] },
  { platform: "MacOS", icon: "macos", fields: ["MacOS Version Identifier"] },
  { platform: "Windows", icon: "version", fields: ["Windows Release Date"] },
  { platform: "Steam (Win)", icon: "systems", fields: ["Release Date"] },
];

function platformFields(row) {
  const boxes = PLATFORM_BOXES.filter(({ platform }) => !row.notReleased?.includes(platform)).map(({ platform, icon, fields }) => {
    const values = row.fields?.[platform] || {};
    const box = document.createElement("section");
    box.className = "version-platform";
    const title = document.createElement("h3");
    title.append(sprite(icon), platform);
    box.append(title);
    const names = [...fields, ...Object.keys(values).filter((name) => !fields.includes(name))];
    for (const label of names) box.append(fact(label, values[label] || "Unknown"));
    return box;
  });
  // Ubisoft Connect only had a few builds, so its box appears only for those
  const ubisoft = row.fields?.["UbiConnect (Win)"];
  if (ubisoft) {
    const box = document.createElement("section");
    box.className = "version-platform";
    const title = document.createElement("h3");
    title.append(sprite("systems"), "Ubisoft Connect (Win)");
    box.append(title, ...Object.entries(ubisoft).map(([label, value]) => fact(label, value)));
    boxes.push(box);
  }
  return boxes;
}

function whatsNew(notes) {
  const box = document.createElement("details");
  box.className = "version-notes";
  const summary = document.createElement("summary");
  summary.append(sprite("whatsNew"), "What's New");
  box.append(summary);
  const stores = Object.keys(notes);
  if (!stores.length) {
    const none = document.createElement("p");
    none.textContent = "No update notes yet.";
    box.append(none);
    return box;
  }
  const tabs = document.createElement("div");
  tabs.className = "version-tabs";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Store");
  const text = document.createElement("div");
  text.className = "version-notes-text";
  const show = (store) => {
    text.textContent = notes[store];
    for (const tab of tabs.children) tab.setAttribute("aria-pressed", tab.textContent === store);
  };
  for (const store of stores) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "btn-sm";
    tab.textContent = store;
    tab.addEventListener("click", () => show(store));
    tabs.append(tab);
  }
  box.append(tabs, text);
  show(stores[0]);
  return box;
}

function downloads(row) {
  const box = document.createElement("div");
  box.className = "version-downloads";
  for (const { platform, image, label } of DOWNLOADS) {
    const build = row.builds[platform];
    const files = build?.files?.length ? build.files : platform === "Android" && row.details?.androidLink ? [{ url: row.details.androidLink, name: label }] : [];
    files.forEach((file, i) => {
      const link = document.createElement("a");
      link.href = file.url;
      link.rel = "noopener";
      link.title = file.name;
      const picture = document.createElement("img");
      picture.src = IMAGES + image;
      picture.loading = "lazy";
      picture.alt = files.length > 1 ? `${label} (${i + 1})` : label;
      link.append(picture);
      box.append(link);
    });
  }
  return box;
}

function statusLines(row) {
  const box = document.createElement("div");
  box.className = "version-status";
  for (const platform of STATUS_PLATFORMS) {
    if (row.notReleased?.includes(platform)) continue;
    const status = row.builds[platform]?.status || "unsure";
    const chip = document.createElement("span");
    chip.className = `version-chip is-${status}`;
    chip.textContent = `${platform}: ${STATUS_NAMES[status]}`;
    box.append(chip);
  }
  return box;
}

function card(row) {
  const box = document.createElement("article");
  box.className = "version-card";
  box.id = row.version;
  const d = row.details || {};
  const head = document.createElement("header");
  head.className = "version-head";
  const icon = document.createElement("img");
  icon.src = d.icon || "../assets/img/favicon_hd.png";
  icon.alt = "";
  icon.loading = "lazy";
  icon.addEventListener("error", () => { icon.src = "../assets/img/favicon_hd.png"; }, { once: true });
  const title = document.createElement("h2");
  title.textContent = `Growtopia Version ${row.version}`;
  head.append(icon, title);
  const parts = [head, fact("Version", row.version, "version")];
  if (d.date) parts.push(fact("Update Date", d.date, "date"));
  const platforms = document.createElement("div");
  platforms.className = "version-platforms";
  platforms.append(...platformFields(row));
  parts.push(statusLines(row), platforms, whatsNew(d.notes || {}));
  if (d.systems) parts.push(fact("Operating System(s)", d.systems, "systems"));
  if (d.extra) parts.push(fact("Extra Info", d.extra));
  parts.push(downloads(row));
  box.append(...parts);
  return box;
}

function skipSection(entry) {
  const fold = document.createElement("details");
  fold.className = "version-skip";
  fold.dataset.skip = entry.skip;
  const summary = document.createElement("summary");
  summary.textContent = `${entry.skip} (${entry.rows[entry.rows.length - 1].version} - ${entry.rows[0].version})`;
  const inner = document.createElement("div");
  inner.className = "version-cards";
  fold.append(summary, inner);
  // The cards inside are only built the first time it opens
  fold.addEventListener("toggle", () => {
    if (fold.open && !inner.children.length) inner.append(...entry.rows.map(card));
  });
  return fold;
}

function drawMore(until = drawn + BATCH) {
  const next = shown.slice(drawn, until);
  cardsBox.append(...next.map((entry) => (entry.row ? card(entry.row) : skipSection(entry))));
  drawn += next.length;
}

function goToSelected() {
  const version = selected();
  const index = shown.findIndex((entry) => entry.row?.version === version || entry.rows?.some((row) => row.version === version));
  if (index < 0) return;
  if (index >= drawn) drawMore(index + 1);
  const entry = shown[index];
  if (entry.skip) {
    const fold = cardsBox.querySelector(`[data-skip="${entry.skip}"]`);
    const inner = fold.querySelector(".version-cards");
    if (!inner.children.length) inner.append(...entry.rows.map(card));
    fold.open = true;
  }
  document.getElementById(version)?.scrollIntoView();
}

addEventListener("hashchange", () => {
  renderList();
  goToSelected();
});
function drawIfNear() {
  if (!data || drawn >= shown.length) return;
  if (moreMark.getBoundingClientRect().top < innerHeight + 800) {
    drawMore();
    requestAnimationFrame(drawIfNear);
  }
}
document.addEventListener("scroll", drawIfNear, { capture: true, passive: true });
addEventListener("resize", drawIfNear);

(async () => {
  const info = document.getElementById("versions_info");
  try {
    data = await fetch("../assets/data/gtarchive/clients.json").then((r) => r.json());
    info.textContent = `${data.rows.length} versions. List by Caferius, last updated ${data.updated}.`;
    shown = buildItems();
    renderList();
    drawMore();
    goToSelected();
    drawIfNear();
  } catch (error) {
    info.textContent = `The version list could not be loaded: ${error.message}`;
  }
})();
