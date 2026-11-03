// Lists the items in assets/data/items.dat. To update the site, replace that one file.
// Modal lines and their order come from the game server's item info text.
const results = document.getElementById("item_results");
const search = document.getElementById("item_search");
const showSeeds = document.getElementById("show_seeds");
const modal = document.getElementById("item_modal");
const PAGE_SIZE = { grid: 120, list: 50 };
const BIT = { flippable: 1, editable: 2, seedless: 4, permanent: 8, dropless: 16, noSelf: 32, worldLocked: 128 };
const CATEGORY = { randomGrow: 8, public: 16, untradeable: 128 };
const ACTION = { lock: 3, seed: 19, component: 37, fish: 64 };
const TILE = 32;
// Keys match elements.json; art comes from the "Element - X" items
const ELEMENTS = { 0: { id: 6018, name: "Earth" }, 1: { id: 6020, name: "Fire" }, 2: { id: 6022, name: "Wind" }, 3: { id: 6024, name: "Water" } };
const BUTTON_COLOR = "rgb(135 184 204)";
let all = [];
let byId = new Map();
let filtered = [];
let page = 0;
let view = "grid";
let current = null;
let button = null;
let elements = {};

function itemLines(item) {
  if (item.action_type === ACTION.seed) return [];
  const seed = byId.get(item.item_id + 1);
  const flags = item.editable_type;
  const category = item.item_category;
  const has = (bit) => Boolean(flags & bit);
  const lines = [];
  const add = (text) => lines.push(`\`1${text}\`\``);
  if (seed && !seed.ingredient1 && !seed.ingredient2 && !has(BIT.permanent)) lines.push("\`1This item can't be spliced.\`\`");
  if (item.action_type === ACTION.component) add("This item has no use... by itself.");
  if (item.action_type === ACTION.fish) add("This is a fish. It can only be placed in a Fish Tank. You can't divide fish into pieces.");
  if (has(BIT.seedless)) add("This item never drops any seeds.");
  if (has(BIT.noSelf)) add("This item can't be used on yourself.");
  if (has(BIT.worldLocked)) add("This item can only be used in World-Locked worlds.");
  if (category & CATEGORY.randomGrow) add("A tree of this type can bear surprising fruit!");
  if (category & CATEGORY.untradeable) add("This item cannot be dropped or traded.");
  if (has(BIT.permanent)) add("This item can't be destroyed - smashing it will return it to your backpack if you have room!");
  if (has(BIT.flippable)) add("This item can be placed in two directions, depending on the direction you're facing.");
  if (has(BIT.editable)) add("This item has special properties you can adjust with the Wrench.");
  if (category & CATEGORY.public) add("This item is PUBLIC: Even if it's locked, anyone can smash it.");
  return lines;
}

function tintedButton() {
  const layer = document.createElement("canvas");
  layer.width = button.width;
  layer.height = button.height;
  const g = layer.getContext("2d");
  g.drawImage(button, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = BUTTON_COLOR;
  g.fillRect(0, 0, layer.width, layer.height);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(button, 0, 0);
  return layer;
}

// Colour codes such as `1 only exist in the game; the page styles each block itself
const plain = (text) => String(text).replace(/`./g, "").replaceAll("<CR>", "\n").replaceAll("\\n", "\n");

function drawSprite(target, source, sx, sy, size) {
  target.width = target.height = size;
  const ctx = target.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, TILE, TILE, 0, 0, size, size);
}

// A seed has the element of the item it grows, which is the ID before it
const elementOf = (item) => ELEMENTS[elements[item.action_type === ACTION.seed ? item.item_id - 1 : item.item_id]];

async function openItem(item) {
  current = item;
  document.getElementById("about_title").textContent = `About ${item.name}`;
  const icon = document.getElementById("about_icon");
  await ItemIcons.draw(icon, item);
  const about = document.getElementById("about_text");
  about.textContent = plain(item.str_version_22 || "");
  if (item.action_type === ACTION.seed) {
    const tree = document.createElement("span");
    tree.className = "about-white";
    tree.textContent = `${item.name.replace(/ Seed$/, "")} Tree.`;
    about.replaceChildren("Plant this seed to grow a ", tree);
  }
  const elementIcon = document.getElementById("about_element");
  elementIcon.hidden = true;
  const info = elementOf(item);
  const source = info && byId.get(info.id);
  const elementSheet = source && (await ItemIcons.loadSheet(ItemIcons.sheetPath(source.texture)));
  if (elementSheet) {
    drawSprite(elementIcon, elementSheet, source.texture_x * TILE, source.texture_y * TILE, TILE);
    elementIcon.title = info.name;
    elementIcon.hidden = false;
  }
  const rarity = document.getElementById("about_rarity");
  rarity.hidden = !item.rarity || item.rarity === 999;
  rarity.textContent = `Rarity: ${item.rarity}`;
  const extra = item.action_type === ACTION.lock ? ["A lock makes it so only you (and designated friends) can edit an area."] : [];
  document.getElementById("about_props").replaceChildren(...[...extra, ...itemLines(item)].map((text) => {
    const line = document.createElement("p");
    line.textContent = plain(text);
    return line;
  }));
  document.getElementById("sprite_panel").hidden = true;
  document.getElementById("about_sprites").setAttribute("aria-expanded", "false");
  modal.showModal();
}

const safeName = (name) => name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");

// items.dat gives each item's first cell and its Tile Storage. Other frames aren't listed anywhere
// (the client hard-codes them per item), so they can be added by clicking the sheet.
const sheetMaps = new Map();

async function sheetMap(texture) {
  if (sheetMaps.has(texture)) return sheetMaps.get(texture);
  const sheet = await ItemIcons.loadSheet(ItemIcons.sheetPath(texture));
  if (!sheet) return null;
  const columns = Math.floor(sheet.width / TILE);
  const rows = Math.floor(sheet.height / TILE);
  const layer = document.createElement("canvas");
  layer.width = sheet.width;
  layer.height = sheet.height;
  const ctx = layer.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sheet, 0, 0);
  const pixels = ctx.getImageData(0, 0, sheet.width, sheet.height).data;
  const filled = new Set();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      search: for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          if (pixels[((y * TILE + py) * sheet.width + x * TILE + px) * 4 + 3]) {
            filled.add(`${x},${y}`);
            break search;
          }
        }
      }
    }
  }
  const map = { sheet, filled, columns, rows };
  sheetMaps.set(texture, map);
  return map;
}

// Cells taken by each Tile Storage type, wide by tall, measured on the game's sheets
const STORAGE_BOX = { 2: [8, 6], 3: [4, 1], 4: [5, 1], 5: [8, 2], 6: [4, 1], 7: [4, 1], 8: [10, 1], 9: [4, 1], 10: [4, 1] };
const PICKER = { wide: 12, tall: 6 };

// Same row rule as the client's icon lookup: shoes are stored at twice their row
function firstCell(item) {
  const y = item.action_type === 20 && item.clothing_type === 3 ? item.texture_y * 2 : item.texture_y;
  return [item.texture_x, y];
}

function itemCells(map, item) {
  const [startX, startY] = firstCell(item);
  const [wide, tall] = STORAGE_BOX[item.spread_type] || [1, 1];
  const cells = [];
  for (let y = startY; y < Math.min(startY + tall, map.rows); y++) {
    for (let x = startX; x < Math.min(startX + wide, map.columns); x++) {
      if (map.filled.has(`${x},${y}`)) cells.push([x, y]);
    }
  }
  return cells;
}

function cellPart(map, x, y) {
  const [startX, startY] = firstCell(current);
  const col = x - startX + 1;
  const row = y - startY + 1;
  return { label: `Frame ${col}, ${row}`, source: map.sheet, sx: x * TILE, sy: y * TILE, file: `frame_${col}_${row}`.replaceAll("-", "m"), cell: `${x},${y}` };
}

async function spriteParts(item) {
  const parts = [{ label: "Icon", source: await ItemIcons.render(item), sx: 0, sy: 0, file: "icon" }];
  if (item.action_type === 19) return parts; // seeds are drawn only from the seed sheet
  if (ItemIcons.isDino(item)) {
    const sheet = await ItemIcons.loadSheet("assets/game/petleo.png");
    if (!sheet) return parts;
    const names = ["Body", "Body shading", "Head", "Head shading"];
    ItemIcons.dinoCells(item).cells.forEach(([x, y], i) => {
      parts.push({ label: names[i], source: sheet, sx: x * TILE, sy: y * TILE, file: names[i].toLowerCase().replace(" ", "_") });
    });
    return parts;
  }
  const map = await sheetMap(item.texture);
  if (!map) return parts;
  for (const [x, y] of itemCells(map, item)) parts.push(cellPart(map, x, y));
  return parts;
}

const picker = document.getElementById("sprite_picker");
let pickerMap = null;

function pickerOrigin() {
  const [x, y] = firstCell(current);
  return [Math.max(0, Math.min(x, pickerMap.columns - PICKER.wide)), Math.max(0, Math.min(y, pickerMap.rows - PICKER.tall))];
}

function drawPicker() {
  const [ox, oy] = pickerOrigin();
  picker.width = PICKER.wide * TILE;
  picker.height = PICKER.tall * TILE;
  const ctx = picker.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pickerMap.sheet, ox * TILE, oy * TILE, picker.width, picker.height, 0, 0, picker.width, picker.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffe14d";
  for (const part of parts) {
    if (part.cell) ctx.strokeRect(part.sx - ox * TILE + 1, part.sy - oy * TILE + 1, TILE - 2, TILE - 2);
  }
}

picker.addEventListener("click", (event) => {
  const box = picker.getBoundingClientRect();
  const [ox, oy] = pickerOrigin();
  const x = ox + Math.floor(((event.clientX - box.left) / box.width) * PICKER.wide);
  const y = oy + Math.floor(((event.clientY - box.top) / box.height) * PICKER.tall);
  const cell = `${x},${y}`;
  const index = parts.findIndex((part) => part.cell === cell);
  if (index >= 0) parts.splice(index, 1);
  else if (pickerMap.filled.has(cell)) parts.push(cellPart(pickerMap, x, y));
  spriteRows.replaceChildren(...parts.map(spriteRow));
  parts.forEach((part) => { part.box.checked = Boolean(part.picked); });
  refreshSprites();
  drawPicker();
});

function partBlob(part, scale) {
  const out = document.createElement("canvas");
  drawSprite(out, part.source, part.sx, part.sy, TILE * scale);
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

const spriteScale = document.getElementById("sprite_scale");
const spriteRows = document.getElementById("sprite_rows");
const zipSprites = document.getElementById("sprite_zip");
let parts = [];

function refreshSprites() {
  const scale = Number(spriteScale.value);
  const size = `${TILE * scale}×${TILE * scale}`;
  spriteRows.querySelectorAll(".sprite-size").forEach((cell) => { cell.textContent = size; });
  const picked = parts.filter((p) => p.picked).length;
  zipSprites.disabled = picked === 0;
  zipSprites.textContent = picked > 1 ? `Download selected as ZIP (${picked})` : "Download selected";
}

function spriteRow(part) {
  const row = document.createElement("tr");
  const pick = document.createElement("input");
  pick.type = "checkbox";
  pick.setAttribute("aria-label", `Select ${part.label}`);
  pick.addEventListener("change", () => { part.picked = pick.checked; refreshSprites(); });
  part.box = pick;
  const preview = document.createElement("canvas");
  preview.className = "sprite-preview";
  drawSprite(preview, part.source, part.sx, part.sy, TILE);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "game-btn";
  save.textContent = "PNG";
  save.addEventListener("click", async () => {
    const scale = Number(spriteScale.value);
    GK.download(await partBlob(part, scale), `${safeName(current.name)}_${part.file}_${scale}x.png`);
  });
  const cells = [pick, preview, part.label, "", save].map((content) => {
    const cell = document.createElement("td");
    cell.append(content);
    return cell;
  });
  cells[3].className = "sprite-size";
  row.append(...cells);
  return row;
}

document.getElementById("about_sprites").addEventListener("click", async (event) => {
  const panel = document.getElementById("sprite_panel");
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute("aria-expanded", !panel.hidden);
  if (panel.hidden) return;
  parts = await spriteParts(current);
  spriteRows.replaceChildren(...parts.map(spriteRow));
  refreshSprites();
  pickerMap = current.action_type === 19 || ItemIcons.isDino(current) ? null : await sheetMap(current.texture);
  document.getElementById("sprite_picker_wrap").hidden = !pickerMap;
  if (pickerMap) drawPicker();
});
spriteScale.replaceChildren(...[1, 2, 3, 4].map((scale) => new Option(`${scale}x (${TILE * scale}×${TILE * scale})`, scale)));
spriteScale.addEventListener("change", refreshSprites);
document.getElementById("sprite_all").addEventListener("click", () => {
  const on = !parts.every((p) => p.picked);
  parts.forEach((p) => { p.picked = on; p.box.checked = on; });
  refreshSprites();
});
zipSprites.addEventListener("click", async () => {
  const scale = Number(spriteScale.value);
  const chosen = parts.filter((p) => p.picked);
  const base = safeName(current.name);
  if (chosen.length === 1) {
    GK.download(await partBlob(chosen[0], scale), `${base}_${chosen[0].file}_${scale}x.png`);
    return;
  }
  const zip = new JSZip();
  for (const part of chosen) zip.file(`${part.file}_${scale}x.png`, await partBlob(part, scale));
  GK.download(await zip.generateAsync({ type: "blob" }), `${base}_sprites_${scale}x.zip`);
});

document.getElementById("about_ok").addEventListener("click", () => modal.close());
modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.close();
});

// The game's item label: the name, then the rarity when the item has one
const tip = document.createElement("div");
tip.className = "item-tip";
tip.hidden = true;
document.body.append(tip);
let selectedId = null;

function showTip(el, item) {
  tip.textContent = item.name;
  if (item.rarity && item.rarity !== 999) {
    const rarity = document.createElement("span");
    rarity.className = "item-tip-rarity";
    rarity.textContent = item.rarity;
    tip.append(" (Rarity: ", rarity, ")");
  }
  tip.hidden = false;
  const box = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.left + box.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8));
  const top = box.top - tip.offsetHeight - 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${top < 8 ? box.bottom + 6 : top}px`;
}

function hideTip() {
  tip.hidden = true;
}

function itemElement(item) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `${view === "grid" ? "item-tile" : "item-row"}${ItemIcons.boxClass(item)}`;
  if (view === "grid") {
    el.addEventListener("pointerenter", () => showTip(el, item));
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("focus", () => showTip(el, item));
    el.addEventListener("blur", hideTip);
    if (item.item_id === selectedId) el.classList.add("is-selected");
  } else {
    el.title = `${item.name} [${item.item_id}]`;
  }
  el.setAttribute("aria-label", `${item.name}, ID ${item.item_id}`);
  const icon = document.createElement("canvas");
  icon.className = "item-icon";
  // Each frame leaves exactly 32x32 inside, which grid icons fill; seeds keep their own size
  const fill = view === "grid" && item.action_type !== ACTION.seed;
  if (fill) {
    icon.classList.add("item-icon-fill");
    ItemIcons.render(item).then((layer) => {
      icon.width = icon.height = TILE;
      icon.getContext("2d").drawImage(layer, 0, 0);
    });
  } else {
    ItemIcons.draw(icon, item);
  }
  el.append(icon);
  if (view === "list") {
    const name = document.createElement("span");
    name.className = "item-row-name";
    name.textContent = item.name;
    const type = document.createElement("span");
    type.className = "item-row-fact";
    type.textContent = ACTION_TYPES[item.action_type] || `Type ${item.action_type}`;
    const rarity = document.createElement("span");
    rarity.className = "item-row-fact";
    rarity.textContent = item.rarity === 999 ? "No rarity" : `Rarity ${item.rarity}`;
    const element = document.createElement("span");
    element.className = "item-row-fact about-element";
    const info = elementOf(item);
    if (info) {
      const art = document.createElement("canvas");
      const source = byId.get(info.id);
      if (source) ItemIcons.loadSheet(ItemIcons.sheetPath(source.texture)).then((sheet) => {
        if (sheet) drawSprite(art, sheet, source.texture_x * TILE, source.texture_y * TILE, TILE);
      });
      element.append(art, info.name);
    }
    const id = document.createElement("span");
    id.className = "item-row-fact";
    id.textContent = `ID ${item.item_id}`;
    el.append(name, type, rarity, element, id);
  }
  el.addEventListener("click", () => {
    selectedId = item.item_id;
    results.querySelector(".is-selected")?.classList.remove("is-selected");
    if (view === "grid") el.classList.add("is-selected");
    hideTip();
    openItem(item);
  });
  return el;
}

function render() {
  const size = PAGE_SIZE[view];
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  page = Math.min(Math.max(page, 0), pages - 1);
  results.className = view === "grid" ? "item-grid" : "item-list";
  results.replaceChildren(...filtered.slice(page * size, (page + 1) * size).map(itemElement));
  document.getElementById("page_info").textContent = `${page + 1} / ${pages} · ${filtered.length} items`;
  const first = Math.max(0, Math.min(page - 2, pages - 5));
  const numbers = [];
  for (let i = first; i < Math.min(first + 5, pages); i++) {
    const b = document.createElement("button");
    b.className = "btn-sm";
    b.textContent = i + 1;
    if (i === page) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => { page = i; render(); });
    numbers.push(b);
  }
  document.getElementById("page_numbers").replaceChildren(...numbers);
  document.getElementById("page_prev").disabled = page === 0;
  document.getElementById("page_next").disabled = page >= pages - 1;
  document.getElementById("page_jump_wrap").hidden = pages <= 5;
  const jump = document.getElementById("page_jump");
  jump.max = pages;
  jump.value = page + 1;
}

function applyFilter() {
  const query = search.value.trim().toLowerCase();
  filtered = all.filter((item) => {
    if (!showSeeds.checked && item.action_type === 19) return false;
    return !query || String(item.item_id) === query || item.name.toLowerCase().includes(query);
  });
  page = 0;
  render();
}

function setView(next) {
  view = next;
  document.getElementById("view_grid").setAttribute("aria-pressed", next === "grid");
  document.getElementById("view_list").setAttribute("aria-pressed", next === "list");
  page = 0;
  render();
}

search.addEventListener("input", applyFilter);
showSeeds.addEventListener("change", applyFilter);
document.getElementById("view_grid").addEventListener("click", () => setView("grid"));
document.getElementById("view_list").addEventListener("click", () => setView("list"));
document.getElementById("page_prev").addEventListener("click", () => { page--; render(); });
document.getElementById("page_next").addEventListener("click", () => { page++; render(); });
document.getElementById("page_jump").addEventListener("change", (e) => { page = Number(e.target.value) - 1; render(); });

const picture = (path) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = path;
});

window.onItemsDecoded = (data) => {
  all = data.items.filter((item) => item.name);
  byId = new Map(all.map((item) => [item.item_id, item]));
  ItemIcons.setLookup((id) => byId.get(id));
  document.getElementById("search_info").textContent = `${all.length} items from the latest items.dat (version ${data.version}). Click an item to open it.`;
  applyFilter();
};

(async () => {
  try {
    button = await picture("assets/img/gui_box_upwhite.png");
    if (button) document.documentElement.style.setProperty("--game-button", `url(${tintedButton().toDataURL()})`);
    const boxes = await picture("assets/game/gui_itembox.png");
    if (boxes) ItemIcons.loadBoxFrames(boxes);
    const [elementData, dat] = await Promise.all([
      fetch("assets/data/elements.json").then((r) => (r.ok ? r.json() : {})),
      fetch("assets/data/items.dat").then((r) => { if (!r.ok) throw new Error("items.dat was not found."); return r.blob(); }),
    ]);
    elements = elementData;
    item_decoder(dat, true);
  } catch (error) {
    document.getElementById("search_info").textContent = `The item list could not be loaded: ${error.message}`;
  }
})();
