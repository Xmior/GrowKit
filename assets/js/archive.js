// Old items.dat files live gzipped in assets/data/archive and are listed, oldest first, in archive.json.
const ROWS_PER_COLUMN = 30;
const COLUMN_WIDTH = 460; // keep in step with #diff_list in style.css
const SEED_ACTION = 19;
const FIELDS = [
  ["name", "Name"], ["str_version_22", "Description"], ["rarity", "Rarity"], ["action_type", "Block type"],
  ["texture", "Texture"], ["texture_x", "Texture X"], ["texture_y", "Texture Y"], ["spread_type", "Tile storage"],
  ["clothing_type", "Body part"], ["item_kind", "Visual effect"], ["collision_type", "Collision"], ["break_hits", "Hits to break"],
  ["drop_chance", "Healing time"], ["grow_time", "Grow time"], ["max_amount", "Stack size"], ["editable_type", "Item flags"],
  ["item_category", "Category flags"], ["ingredient1", "Recipe seed 1"], ["ingredient2", "Recipe seed 2"],
  ["seed_color", "Seed colour"], ["seed_overlay_color", "Seed overlay colour"], ["seed_base", "Seed shape"],
  ["seed_overlay", "Seed overlay"], ["tree_base", "Tree trunk"], ["tree_leaves", "Tree leaves"],
];
// "Meaning (number)" for numbers that stand for something
function described(key, value) {
  if (value === undefined || value === null || value === "") return value;
  if (key === "rarity" && Number(value) === 999) return "No rarity (999)";
  if (FLAGS[key]) {
    const names = FLAGS[key].filter((_, bit) => Number(value) & (1 << bit));
    return `${names.length ? names.join(", ") : "None"} (${value})`;
  }
  const name = ENUMS[key]?.[value];
  return name ? `${name} (${value})` : value;
}
// What each Changed filter looks for in an item's list of changes
const FILTERS = {
  name: ["Name"], desc: ["Description"], rarity: ["Rarity"],
  texture: ["Texture", "Texture X", "Texture Y"],
  seed: ["Seed: Seed colour", "Seed: Seed overlay colour"],
};
const filter = document.getElementById("diff_filter");
const filterWrap = document.getElementById("diff_filter_wrap");
const SEED_FIELDS = new Set(["Seed colour", "Seed overlay colour", "Seed shape", "Seed overlay", "Tree trunk", "Tree leaves", "Grow time"]);
// Colours come decoded as {a, r, g, b}; they are compared and shown as #RRGGBB
const asHex = (value) => value && typeof value === "object"
  ? `#${[value.r, value.g, value.b].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase()}`
  : value;
const LATEST = { label: "Latest (site)", name: "items.dat", path: "assets/data/items.dat" };
const pickA = document.getElementById("archive_a");
const pickB = document.getElementById("archive_b");
const statusText = document.getElementById("archive_status");
const list = document.getElementById("diff_list");
const search = document.getElementById("diff_search");
const decoded = new Map();
let versions = [];
let latestById = new Map();
let diff = { added: [], changed: [], nulls: [] };
let kind = "added";
let page = 0;

let queue = Promise.resolve();
// item_decoder keeps its state in one global, so files are decoded one at a time
function decode(blob) {
  const job = queue.then(() => new Promise((resolve, reject) => {
    window.onItemsDecoded = resolve;
    try {
      item_decoder(blob, true);
    } catch (error) {
      reject(error);
    }
  }));
  queue = job.catch(() => {});
  return job;
}

async function fileBytes(entry) {
  if (entry.local) return new Uint8Array(await entry.local.arrayBuffer());
  const response = await fetch(entry.path || `assets/data/archive/${entry.file}`);
  if (!response.ok) throw new Error(`${entry.name} was not found.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return entry.file ? pako.ungzip(bytes) : bytes;
}

async function loadVersion(entry) {
  if (!decoded.has(entry)) decoded.set(entry, decode(new Blob([await fileBytes(entry)])));
  return decoded.get(entry);
}

function changesOf(oldItem, newItem) {
  const out = [];
  for (const [key, label] of FIELDS) {
    const before = asHex(oldItem[key]);
    const after = asHex(newItem[key]);
    if (before === undefined || after === undefined || before === after) continue;
    // Newer formats add fields that older files can only leave empty
    if (key === "str_version_22" && !before) continue;
    out.push({ label, before: described(key, before), after: described(key, after) });
  }
  return out;
}

function buildDiff(oldData, newData) {
  const oldById = new Map(oldData.items.map((item) => [item.item_id, item]));
  const newById = new Map(newData.items.map((item) => [item.item_id, item]));
  const result = { added: [], changed: [], nulls: [] };
  const isSeed = (item) => item.action_type === SEED_ACTION;
  const changedById = new Map();
  for (const item of newData.items) {
    if (isSeed(item)) continue;
    const previous = oldById.get(item.item_id);
    if (!previous) {
      result.added.push({ item });
    } else {
      const changes = changesOf(previous, item);
      const entry = { item, changes };
      // A sprite that moved is drawn from its old cell and its new one
      if (changes.some((change) => /^Texture/.test(change.label))) entry.sprite = { before: previous, after: item };
      changedById.set(item.item_id, entry);
      if (changes.length) result.changed.push(entry);
    }
  }
  // A seed is the item one ID above its block; its changes are listed on the block
  for (const seed of newData.items) {
    const previous = oldById.get(seed.item_id);
    const entry = changedById.get(seed.item_id - 1);
    if (!isSeed(seed) || !previous || !entry) continue;
    // A seed copies its block's other fields, so only what is its own is listed
    const changes = changesOf(previous, seed).filter((change) => SEED_FIELDS.has(change.label));
    if (!changes.length) continue;
    // Only a change to how the seed looks gets the two seeds drawn
    if (changes.some((change) => change.label !== "Grow time")) entry.seed = { before: previous, after: seed };
    entry.changes.push(...changes.map((change) => ({ ...change, label: `Seed: ${change.label}` })));
    if (!result.changed.includes(entry)) result.changed.push(entry);
  }
  result.changed.sort((a, b) => a.item.item_id - b.item.item_id);
  // Placeholders that later became real items get their own list instead of crowding Changed
  const isNull = (item) => /^null_item/i.test(String(item.name));
  result.nulls = result.changed.filter(({ item }) => isNull(oldById.get(item.item_id)) && !isNull(item));
  result.changed = result.changed.filter((entry) => !result.nulls.includes(entry));
  return result;
}

function row({ item, changes, seed, sprite }) {
  const wrap = document.createElement(changes ? "details" : "div");
  wrap.className = `diff-row diff-${kind}`;
  const head = document.createElement(changes ? "summary" : "div");
  head.className = "diff-head";
  const icon = document.createElement("canvas");
  icon.className = "item-icon";
  // Sheets are current, so the current item gives the right cell when it still exists
  ItemIcons.draw(icon, latestById.get(item.item_id) || item);
  const name = document.createElement("span");
  name.className = "item-row-name";
  name.textContent = item.name;
  const id = document.createElement("span");
  id.textContent = changes ? `ID ${item.item_id} · ${changes.length} changed` : `ID ${item.item_id}`;
  head.append(icon, name, id);
  wrap.append(head);
  if (changes) {
    const table = document.createElement("table");
    table.className = "diff-table";
    for (const change of changes) {
      const line = table.insertRow();
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = change.label;
      line.append(label);
      for (const value of [change.before, change.after]) {
        const cell = line.insertCell();
        if (/^#[0-9A-F]{6}$/.test(value)) {
          const swatch = document.createElement("span");
          swatch.className = "diff-swatch";
          swatch.style.background = value;
          cell.append(swatch);
        }
        cell.append(value);
      }
    }
    for (const [title, pair] of [["Sprite", sprite], ["Seed", seed]]) {
      if (!pair) continue;
      // Old and new drawn side by side, each from its own fields
      const line = table.insertRow();
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = title;
      line.append(label);
      for (const version of [pair.before, pair.after]) {
        const canvas = document.createElement("canvas");
        canvas.className = "item-icon";
        ItemIcons.draw(canvas, version);
        line.insertCell().append(canvas);
      }
    }
    wrap.append(table);
  }
  return wrap;
}

function renderDiff() {
  const query = search.value.trim().toLowerCase();
  const only = FILTERS[filter.value];
  filterWrap.hidden = kind === "added";
  const rows = diff[kind].filter(({ item, changes }) => {
    if (only && kind !== "added" && !changes.some((change) => only.includes(change.label))) return false;
    return !query || String(item.item_id) === query || String(item.name).toLowerCase().includes(query);
  });
  // Wide screens show the next rows beside these instead of on another page
  const columns = Math.max(1, Math.floor(list.clientWidth / COLUMN_WIDTH));
  const PAGE = ROWS_PER_COLUMN * columns;
  list.style.columnCount = columns;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  page = Math.min(Math.max(page, 0), pages - 1);
  list.replaceChildren(...rows.slice(page * PAGE, (page + 1) * PAGE).map(row));
  document.getElementById("diff_info").textContent = `${page + 1} / ${pages} · ${rows.length} items`;
  document.getElementById("diff_prev").disabled = page === 0;
  document.getElementById("diff_next").disabled = page >= pages - 1;
  for (const name of ["added", "changed", "nulls"]) {
    const button = document.getElementById(`diff_${name}`);
    const count = diff[name].length;
    button.textContent = `${name === "nulls" ? "Null_items" : name[0].toUpperCase() + name.slice(1)} (${count})`;
    button.setAttribute("aria-pressed", name === kind);
  }
}

async function compare() {
  const a = versions[pickA.value];
  const b = versions[pickB.value];
  if (a === b) {
    statusText.textContent = "Pick two different versions.";
    return;
  }
  statusText.textContent = "Loading both versions...";
  try {
    const [oldData, newData] = [await loadVersion(a), await loadVersion(b)];
    diff = buildDiff(oldData, newData);
    kind = "added";
    page = 0;
    statusText.textContent = `${a.label} (v${oldData.version}) → ${b.label} (v${newData.version})`;
    document.getElementById("diff_panel").hidden = false;
    renderDiff();
  } catch (error) {
    statusText.textContent = `Could not compare: ${error.message}`;
  }
}

function fillTable() {
  const rows = versions.filter((entry) => entry.file).reverse().map((entry) => {
    const line = document.createElement("tr");
    for (const text of [entry.label, `v${entry.version}`, entry.items, GK.formatSize(entry.size)]) line.insertCell().textContent = text;
    if (entry.credit) {
      const credit = document.createElement("small");
      credit.className = "archive-credit";
      credit.textContent = entry.credit;
      line.cells[0].append(credit);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-sm";
    button.textContent = "Download";
    button.setAttribute("aria-label", `Download ${entry.label}`);
    button.addEventListener("click", async () => {
      try {
        GK.download(await fileBytes(entry), entry.name);
      } catch (error) {
        GK.toast(error.message, "error");
      }
    });
    const open = document.createElement("a");
    open.className = "btn-sm";
    open.href = `search.html?archive=${encodeURIComponent(entry.file)}`;
    open.textContent = "Search";
    open.setAttribute("aria-label", `Search the items in ${entry.label}`);
    line.insertCell().append(open, " ", button);
    return line;
  });
  document.getElementById("archive_rows").replaceChildren(...rows);
}

document.getElementById("archive_compare").addEventListener("click", compare);
// A file of the user's own joins the pickers as one more version
for (const [id, pick] of [["own_a", pickA], ["own_b", pickB]]) {
  document.getElementById(id).addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    versions.push({ label: `Your file: ${file.name}`, name: file.name, local: file });
    const index = versions.length - 1;
    for (const p of [pickA, pickB]) p.prepend(new Option(versions[index].label, index));
    pick.value = index;
    event.target.value = "";
    const other = pick === pickA ? pickB : pickA;
    if (versions[other.value]?.local) compare();
  });
}
document.getElementById("archive_swap").addEventListener("click", () => {
  [pickA.value, pickB.value] = [pickB.value, pickA.value];
});
search.addEventListener("input", () => { page = 0; renderDiff(); });
filter.addEventListener("change", () => { page = 0; renderDiff(); });
for (const name of ["added", "changed", "nulls"]) {
  document.getElementById(`diff_${name}`).addEventListener("click", () => { kind = name; page = 0; renderDiff(); });
}
new ResizeObserver(() => {
  if (!document.getElementById("diff_panel").hidden && list.clientWidth) renderDiff();
}).observe(document.getElementById("archive_compare").parentElement);
document.getElementById("diff_prev").addEventListener("click", () => { page--; renderDiff(); });
document.getElementById("diff_next").addEventListener("click", () => { page++; renderDiff(); });

(async () => {
  const info = document.getElementById("archive_info");
  try {
    const manifest = await fetch("assets/data/archive.json").then((r) => r.json());
    versions = [...manifest, LATEST];
    const options = () => versions.map((entry, i) => new Option(entry.file ? `${entry.label} (v${entry.version}, ${entry.items})` : entry.label, i)).reverse();
    pickA.append(...options());
    pickB.append(...options());
    pickB.value = versions.length - 1;
    pickA.value = versions.length - 2;
    fillTable();
    const latest = await loadVersion(LATEST);
    latestById = new Map(latest.items.map((item) => [item.item_id, item]));
    ItemIcons.setLookup((id) => latestById.get(id));
    info.textContent = `${manifest.length} archived versions, from ${manifest[0].items} items to ${manifest[manifest.length - 1].items}. Listed by item count, since file dates aren't reliable.`;
  } catch (error) {
    info.textContent = `The archive could not be loaded: ${error.message}`;
  }
})();
