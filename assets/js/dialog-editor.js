// Editor for the game's "command|value|value|" dialog files. Command names come from the game client.
// The client does not name their parameters, so templates follow news.txt, rules.txt and common use.
const PARTS = {
  "Text": {
    add_textbox: ["add_textbox|`oText here``|left|", "Text, alignment"],
    add_smalltext: ["add_smalltext|`oSmall text``|left|", "Text, alignment"],
    add_label: ["add_label|small|`oLabel``|left|", "Size (big or small), text, alignment"],
    add_label_with_icon: ["add_label_with_icon|small|`oText``|left|18|", "Size, text, alignment, item ID"],
    add_label_with_icon_button: ["add_label_with_icon_button|small|`oText``|left|18|name|", "Size, text, alignment, item ID, button name (the last two are not confirmed)"],
    add_label_with_ele_icon: ["add_label_with_ele_icon|big|`wAbout Dirt``|left|2|0|", "Size, text, alignment, item ID, element (the element is not confirmed)"],
    add_spacer: ["add_spacer|small|", "Size: small or big"],
    text_scaling_string: ["text_scaling_string|aaaaaaaaaaaaaaa|", "Sample text used to size the dialog"],
  },
  "Buttons": {
    add_button: ["add_button|name|`wButton``|noflags|0|0|", "Name, text, flags, then two numbers"],
    add_small_font_button: ["add_small_font_button|name|`wButton``|noflags|0|0|", "Name, text, flags, then two numbers"],
    add_url_button: ["add_url_button|comment|`wLink``|noflags|https://www.growtopiagame.com|Open this link?|0|0|", "Name, text, flags, URL, confirmation text, then two numbers"],
    add_button_with_icon: ["add_button_with_icon|name|`wItem``|staticBlueFrame|18||", "Name, text, frame (staticBlueFrame, staticGreyFrame, staticPurpleFrame or noflags), item ID. Use END_ROW or END_LIST as the text to end a row"],
    add_image_button: ["add_image_button|banner|interface/large/news_banner.rttex|noflags|||", "Name, image file, flags"],
    add_quick_exit: ["add_quick_exit|", "Adds the close cross"],
    end_dialog: ["end_dialog|popup||Continue|", "Dialog name, cancel text, OK text"],
  },
  "Achievements and pickers": {
    add_achieve: ["add_achieve|name|Earned for doing something|left|1|", "At least four values. Name, description, alignment, achievement ID (order is a best reading of the server)"],
    add_achieve_button: ["add_achieve_button|name|Earned for doing something|left|1|noflags|", "At least four values. Same as add_achieve, then flags (order is a best reading)"],
    add_checkbox: ["add_checkbox|checkbox_name|`oOption``|0|", "Name, text, 0 or 1"],
    add_checkicon: ["add_checkicon|name|`oOption``|noflags|18||0|", "Name, text, flags, item ID, then checked state (order not confirmed)"],
    add_text_input: ["add_text_input|name|Label||32|", "Name, label, default text, max length"],
    add_item_picker: ["add_item_picker|name|`wPick an item``|Choose an item!|", "Name, button text, hint"],
    add_player_picker: ["add_player_picker|playerNetID|`wChoose a player``|", "Name, button text"],
    add_player_info: ["add_player_info|Name|1|100|100|", "Name, level, current, max (order not confirmed)"],
  },
  "Dialog settings": {
    set_default_color: ["set_default_color|`o", "Default text colour code"],
    set_bg_color: ["set_bg_color|0,0,0,180|", "Background R,G,B,A"],
    set_border_color: ["set_border_color|255,255,255,255|", "Border R,G,B,A"],
    disable_resize: ["disable_resize|", "Keeps the dialog size fixed"],
    embed_data: ["embed_data|name|value|", "Hidden data sent back with the dialog"],
  },
};

const source = document.getElementById("dialog_source");
const partSelect = document.getElementById("dialog_part");
const hint = document.getElementById("part_hint");
const finder = document.getElementById("item_find");
const items = new Map();
const byName = new Map();
let fileName = "untitled.txt";
let pending = false;
let lineEnding = "\n";

for (const [group, parts] of Object.entries(PARTS)) {
  const el = document.createElement("optgroup");
  el.label = group;
  el.append(...Object.keys(parts).map((name) => new Option(name, name)));
  partSelect.appendChild(el);
}
const partOf = (name) => Object.values(PARTS).find((group) => group[name])[name];
function showHint() {
  hint.textContent = partOf(partSelect.value)[1];
}
partSelect.addEventListener("change", showHint);
showHint();

function insertLine(text) {
  const at = source.selectionStart;
  const before = source.value.slice(0, at);
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  source.setRangeText(`${lead}${text}\n`, at, source.selectionEnd, "end");
  source.focus();
  refresh();
}

document.getElementById("dialog_insert").addEventListener("click", () => insertLine(partOf(partSelect.value)[0]));
document.getElementById("item_use").addEventListener("click", () => {
  const item = byName.get(finder.value.trim().toLowerCase());
  if (!item) return GK.toast("Pick an item from the list first.", "error");
  source.setRangeText(String(item.item_id), source.selectionStart, source.selectionEnd, "end");
  source.focus();
  refresh();
});

/* Preview: a canvas layout using the game's own font and gui_box. Sizes are matched by eye to the game. */
const canvas = document.getElementById("dialog_canvas");
const WIDTH = 640;
const MARGIN = 26;
const INNER = WIDTH - MARGIN * 2;
const SIZE = { big: 0.5, normal: 0.3, small: 0.24 };
const LINE_GAP = 1.12;
const BUTTON_COLOR = "rgb(135 184 204)"; // 0xCCB887FF in the client
const BUTTON_PADDING = 18;
const ICON = { big: 64, small: 32 };
let drawToken = 0;
let font = null;
let boxes = null;

const loadPicture = (path) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = path;
});

// gui_box's stretchable centre is columns and rows 9 to 21
function nineSlice(ctx, image, x, y, w, h) {
  const START = 9;
  const END = 22;
  const tail = image.width - END;
  const slices = (at, size) => [[0, START, at, START], [START, END - START, at + START, Math.max(0, size - START - tail)], [END, tail, at + size - tail, tail]];
  ctx.imageSmoothingEnabled = false; // the font turns smoothing on, which bleeds the border into the stretched centre
  for (const [sy, sh, dy, dh] of slices(y, h)) {
    for (const [sx, sw, dx, dw] of slices(x, w)) ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}

// Each block has a height and a paint(ctx, y) step, so the canvas can be sized before drawing
function textBlockOf(text, scale, width = INNER, x = MARGIN, color = null) {
  const lines = font.layout(text, scale, width, color);
  const line = font.lineHeight * scale * LINE_GAP;
  return { height: lines.length * line, paint: (ctx, y) => lines.forEach((l, i) => font.drawLine(ctx, l, x, y + i * line, scale)) };
}

function iconBlock(id, size, text, defaultColor) {
  const px = ICON[size === "big" ? "big" : "small"];
  const scale = size === "big" ? SIZE.big : SIZE.normal;
  const block = textBlockOf(text, scale, INNER - px - 10, MARGIN + px + 10, defaultColor);
  const icon = document.createElement("canvas");
  const item = items.get(Number(id));
  const ready = ItemIcons.draw(icon, item || { texture: "", action_type: 0 });
  const height = Math.max(px + 4, block.height) + 4;
  return { ready, height, paint: (ctx, y) => {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(icon, MARGIN, y + (height - px) / 2, (icon.width / 32) * px, (icon.height / 32) * px);
    block.paint(ctx, y + (height - block.height) / 2);
  } };
}

// gui_box_upwhite is a solid white box, so the client's colour tints all of it
const buttonTints = new Map();
function tintedButton(color) {
  if (!buttonTints.has(color)) {
    const layer = document.createElement("canvas");
    layer.width = boxes.button.width;
    layer.height = boxes.button.height;
    const g = layer.getContext("2d");
    g.drawImage(boxes.button, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = color;
    g.fillRect(0, 0, layer.width, layer.height);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(boxes.button, 0, 0);
    buttonTints.set(color, layer);
  }
  return buttonTints.get(color);
}

// Client buttons: filled with their colour, bordered with gui_box_upwhite, sized to the text and on the left
function buttonBlock(text, fill = BUTTON_COLOR, scale = SIZE.normal) {
  const lines = font.layout(text, scale, INNER - BUTTON_PADDING * 2);
  const line = font.lineHeight * scale * LINE_GAP;
  const width = Math.min(INNER, Math.max(...lines.map((l) => l.width)) + BUTTON_PADDING * 2);
  const height = Math.max(48, lines.length * line + 22);
  const box = tintedButton(fill);
  return { height: height + 6, paint: (ctx, y) => {
    nineSlice(ctx, box, MARGIN, y, width, height);
    lines.forEach((l, i) => font.drawLine(ctx, l, MARGIN + BUTTON_PADDING, y + (height - lines.length * line) / 2 + i * line, scale));
  } };
}

function checkBlock(text, checked, color) {
  const px = 32;
  const block = textBlockOf(text, SIZE.normal, INNER - px - 10, MARGIN + px + 10, color);
  const height = Math.max(px, block.height) + 4;
  return { height, paint: (ctx, y) => {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(boxes.check, checked ? 32 : 0, 0, 32, 32, MARGIN, y + (height - px) / 2, px, px);
    block.paint(ctx, y + (height - block.height) / 2);
  } };
}

function inputBlock(label, value, color) {
  const title = label ? textBlockOf(label, SIZE.normal, INNER, MARGIN, color) : { height: 0, paint() {} };
  const lines = font.layout(`\`b${value}`, SIZE.normal, INNER - 24);
  const box = tintedButton("rgb(255 255 255)");
  const height = 44;
  return { height: title.height + height + 6, paint: (ctx, y) => {
    title.paint(ctx, y);
    nineSlice(ctx, box, MARGIN, y + title.height, INNER, height);
    if (lines[0]) font.drawLine(ctx, lines[0], MARGIN + 12, y + title.height + 9, SIZE.normal);
  } };
}

// Achievements draw a gold tile from tiles_achieve, then their name and description
function achieveBlock(name, text, id, color) {
  const px = 48;
  const title = textBlockOf(`\`w${name}\`\``, SIZE.normal, INNER - px - 10, MARGIN + px + 10);
  const body = textBlockOf(text, SIZE.small, INNER - px - 10, MARGIN + px + 10, color);
  const index = Math.max(0, Number(id) || 0);
  const height = Math.max(px, title.height + body.height) + 6;
  return { height, paint: (ctx, y) => {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(boxes.achieve, (index % 8) * 32, (Math.floor(index / 8) % 8) * 32, 32, 32, MARGIN, y + 3, px, px);
    title.paint(ctx, y + 3);
    body.paint(ctx, y + 3 + title.height);
  } };
}

// add_button_with_icon tiles flow in a row until END_ROW, END_LIST or another part
const FRAME_TINTS = { staticBlueFrame: BUTTON_COLOR, staticGreyFrame: "rgb(150 150 150)", staticPurpleFrame: "rgb(165 115 205)" };
const TILE = 76;
function iconTile(p, state) {
  if (p[2] === "END_ROW" || p[2] === "END_LIST" || p[1] === "END_ROW" || p[1] === "END_LIST") {
    state.row = null;
    return null;
  }
  if (!state.row || state.row.tiles.length >= Math.floor(INNER / (TILE + 6))) {
    state.row = { tiles: [] };
    const row = state.row;
    state.pendingRow = { height: TILE + 6, get ready() { return Promise.all(row.tiles.map((t) => t.ready)); }, paint: (ctx, y) => {
      row.tiles.forEach((t, i) => t.paint(ctx, MARGIN + i * (TILE + 6), y));
    } };
  }
  const icon = document.createElement("canvas");
  const item = items.get(Number(p[4]));
  const ready = ItemIcons.draw(icon, item || { texture: "", action_type: 0 });
  const box = tintedButton(FRAME_TINTS[p[3]] || BUTTON_COLOR);
  state.row.tiles.push({ ready, paint: (ctx, x, y) => {
    nineSlice(ctx, box, x, y, TILE, TILE);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(icon, x + (TILE - 64) / 2 - 2, y + (TILE - 64) / 2 - 2, (icon.width / 32) * 64, (icon.height / 32) * 64);
  } });
  const fresh = state.pendingRow;
  state.pendingRow = null;
  return fresh || null;
}

function blockFor(line, state) {
  const p = line.split("|");
  const cmd = p[0].trim();
  const color = state.color;
  switch (cmd) {
    case "set_default_color": state.color = (p[1] || "").replace("`", ""); return null;
    case "set_bg_color": state.bg = p[1]; return null;
    case "set_border_color": state.border = p[1]; return null;
    case "add_quick_exit": state.exit = true; return null;
    case "end_dialog": state.end = p; return null;
    case "disable_resize": case "embed_data": return null;
    case "add_spacer": return { height: p[1] === "big" ? 32 : 14, paint() {} };
    case "add_textbox": case "add_custom_textbox": return textBlockOf(p[1] || "", SIZE.normal, INNER, MARGIN, color);
    case "add_smalltext": case "add_smalltext_forced": return textBlockOf(p[1] || "", SIZE.small, INNER, MARGIN, color);
    case "add_label": return textBlockOf(p[2] || "", p[1] === "big" ? SIZE.big : SIZE.normal, INNER, MARGIN, color);
    case "add_label_with_icon": return iconBlock(p[4], p[1], p[2] || "", color);
    case "add_label_with_icon_button": case "add_label_with_ele_icon": return iconBlock(p[4], p[1], p[2] || "", color);
    case "add_achieve": case "add_achieve_button": return achieveBlock(p[1] || "", p[2] || "", p[4], color);
    case "add_button": case "add_url_button": case "add_item_picker": case "add_player_picker": return buttonBlock(p[2] || "");
    case "add_small_font_button": return buttonBlock(p[2] || "", BUTTON_COLOR, SIZE.small);
    case "add_button_with_icon": return iconTile(p, state);
    case "add_image_button": return buttonBlock(`\`7${p[2] || "image"}\`\``, "rgb(60 75 100)");
    case "add_checkbox": return checkBlock(p[2] || "", p[3] === "1", color);
    case "add_checkicon": return iconBlock(p[4], "small", p[2] || "", color);
    case "add_text_input": return inputBlock(p[2] || "", p[3] || "", color);
    case "add_player_info": return textBlockOf(`\`w${p[1] || ""}\`\` (Level ${p[2] || "?"}, ${p[3] || 0}/${p[4] || 0})`, SIZE.normal, INNER, MARGIN, color);
    case "text_scaling_string": return null;
  }
  // Anything else stays in the file and is marked here
  return textBlockOf(`\`6${line}\`\``, SIZE.small, INNER, MARGIN);
}

async function draw() {
  pending = false;
  const token = ++drawToken;
  if (!font) return;
  const state = { color: null, bg: null, border: null, exit: false, end: null };
  const blocks = [];
  for (const raw of source.value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (!line.startsWith("add_button_with_icon")) state.row = null;
    const block = blockFor(line, state);
    if (block) blocks.push(block);
  }
  if (state.end || state.exit) {
    const labels = state.end ? [state.end[2], state.end[3]].filter(Boolean) : ["Close"];
    blocks.push({ height: 12, paint() {} });
    for (const label of labels) blocks.push(buttonBlock(label));
  }
  await Promise.all(blocks.map((b) => b.ready));
  if (token !== drawToken) return;
  const height = Math.max(200, blocks.reduce((sum, b) => sum + b.height + 4, MARGIN * 2));
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  nineSlice(ctx, boxes.panel, 0, 0, WIDTH, height);
  let y = MARGIN;
  for (const block of blocks) {
    block.paint(ctx, y);
    y += block.height + 4;
  }
}

function refresh() {
  if (pending) return;
  pending = true;
  setTimeout(draw, 30);
}
source.addEventListener("input", refresh);

// Files are single-byte text: read and write them byte for byte
GK.bindDrop(document.getElementById("dialog_drop"), async ([file]) => {
  const loaded = new TextDecoder("latin1").decode(await file.arrayBuffer());
  // Text boxes turn CRLF into LF, so the file's line ending is restored on save
  lineEnding = loaded.includes("\r\n") ? "\r\n" : "\n";
  source.value = loaded;
  fileName = file.name;
  document.getElementById("dialog_name").textContent = fileName;
  document.getElementById("dialog_hash").textContent = "";
  refresh();
});

document.getElementById("dialog_save").addEventListener("click", () => {
  const text = source.value.replace(/\r?\n/g, lineEnding);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255) return GK.toast(`This character can't be saved in the file: ${text[i]}`, "error");
    bytes[i] = code;
  }
  GK.download(bytes, fileName);
  document.getElementById("dialog_hash").textContent = `${fileName} · hash ${GK.protonHash(bytes)}`;
});

async function loadItems() {
  const response = await fetch("assets/data/items.json");
  if (!response.ok) return;
  const list = document.createDocumentFragment();
  for (const row of (await response.json()).items) {
    const [item_id, name, texture, texture_x, texture_y, spread_type, action_type, clothing_type, seed_base, seed_overlay, c1, c2, item_kind, item_category] = row;
    const item = { item_id, name, texture, texture_x, texture_y, spread_type, action_type, clothing_type, seed_base, seed_overlay, item_kind, item_category,
      seed_color: { r: c1[0], g: c1[1], b: c1[2] }, seed_overlay_color: { r: c2[0], g: c2[1], b: c2[2] } };
    items.set(item_id, item);
    if (action_type === 19) continue;
    byName.set(name.toLowerCase(), item);
    const option = document.createElement("option");
    option.value = name;
    list.appendChild(option);
  }
  document.getElementById("item_names").appendChild(list);
  ItemIcons.setLookup((id) => items.get(id));
  refresh();
}
(async () => {
  const [panel, button, check, achieve] = await Promise.all(["gui_box", "gui_box_upwhite", "checkbox_game", "tiles_achieve"].map((n) => loadPicture(`assets/img/${n}.png`)));
  boxes = { panel, button, check, achieve };
  await loadItems();
  try {
    font = await GameFont.load("assets/interface/font_century_gothic_bigx2.rtfont");
    refresh();
  } catch (error) {
    GK.toast(`The preview font could not be loaded: ${error.message}`, "error");
  }
})();
