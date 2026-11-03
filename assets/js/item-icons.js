// Draws an item's inventory icon the way the game client picks it. Falls back to empty.png.
const ItemIcons = (() => {
  const TILE = 32;
  const SEED_CELL = 16;
  const SHADOW_OFFSET = 2;
  const SHADOW_ALPHA = 110;
  const sheets = new Map();

  function loadSheet(path) {
    if (!sheets.has(path)) {
      sheets.set(path, new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = path;
      }));
    }
    return sheets.get(path);
  }

  const sheetPath = (texture) => `assets/game/${String(texture).replace(/\.rttex$/i, ".png")}`;

  // Same mapping as the client's icon lookup
  function iconCell(item) {
    const x = Number(item.texture_x);
    const y = Number(item.texture_y);
    let cell;
    switch (Number(item.spread_type)) {
      case 1: case 6: cell = [x, y]; break;
      case 2: case 5: cell = [x + 4, y + 1]; break;
      case 3: case 7: case 8: case 9: case 10: cell = [x + 3, y]; break;
      case 4: cell = [x + 4, y]; break;
      default: cell = [0, 0];
    }
    if (Number(item.action_type) === 20 && Number(item.clothing_type) === 3) cell[1] *= 2;
    return cell;
  }

  function drawEmpty(ctx, empty) {
    ctx.clearRect(0, 0, TILE, TILE);
    if (empty) ctx.drawImage(empty, 0, 0, TILE, TILE);
  }

  function drawTinted(ctx, sheet, index, row, color) {
    const layer = document.createElement("canvas");
    layer.width = layer.height = TILE;
    const g = layer.getContext("2d");
    g.imageSmoothingEnabled = false;
    const cell = () => g.drawImage(sheet, index * SEED_CELL, row * SEED_CELL, SEED_CELL, SEED_CELL, 0, 0, TILE, TILE);
    cell();
    g.globalCompositeOperation = "multiply";
    g.fillStyle = `rgb(${Number(color.r)},${Number(color.g)},${Number(color.b)})`;
    g.fillRect(0, 0, TILE, TILE);
    g.globalCompositeOperation = "destination-in";
    cell();
    ctx.drawImage(layer, 0, 0);
  }

  function isBlank(ctx) {
    try {
      const pixels = ctx.getImageData(0, 0, TILE, TILE).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return false;
      return true;
    } catch {
      return false; // pixels can't be read when the page is opened from file://
    }
  }

  // Layer names and rules below follow the client's icon routine
  const LAYERED_KINDS = new Set([20, 22, 27, 38, 39]); // second cell at x+1, both tinted from the seed
  const GUILD_PATTERNS = { "(Filigree)": 4, "(Harlequin)": 6, "(Plaid)": 8, "(Cross)": 10, "(Slant)": 12, "(Panel)": 14, "(Stripe)": 16, "(Flame)": 18, "(Division)": 20 };
  const NOT_DRAWN_AS_SEEDS = new Set([611, 4455]);
  let findItem = () => null;

  function drawCell(ctx, sheet, x, y, color) {
    if ((x + 1) * TILE > sheet.width || (y + 1) * TILE > sheet.height) return;
    if (!color) {
      ctx.drawImage(sheet, x * TILE, y * TILE, TILE, TILE, 0, 0, TILE, TILE);
      return;
    }
    const layer = document.createElement("canvas");
    layer.width = layer.height = TILE;
    const g = layer.getContext("2d");
    const cell = () => g.drawImage(sheet, x * TILE, y * TILE, TILE, TILE, 0, 0, TILE, TILE);
    cell();
    g.globalCompositeOperation = "multiply";
    g.fillStyle = `rgb(${Number(color.r)},${Number(color.g)},${Number(color.b)})`;
    g.fillRect(0, 0, TILE, TILE);
    g.globalCompositeOperation = "destination-in";
    cell();
    ctx.drawImage(layer, 0, 0);
  }

  function drawIndexed(ctx, sheet, index, color) {
    const columns = Math.floor(sheet.width / TILE);
    drawCell(ctx, sheet, index % columns, Math.floor(index / columns), color);
  }

  // Guild flags and banners are stacked white sprites coloured from the item's seed
  function drawGuild(ctx, sheet, item, x, y, seed) {
    const id = Number(item.item_id);
    const columns = Math.floor(sheet.width / TILE);
    if (id === 5814) {
      drawCell(ctx, sheet, 4, 0);
      drawCell(ctx, sheet, 7, 0);
    } else if (id >= 5834 && id <= 5932 && id % 2 === 0) {
      drawCell(ctx, sheet, 8, 12);
      drawCell(ctx, sheet, 15, 15);
      const index = columns * y + x;
      drawIndexed(ctx, sheet, index, seed.seed_color);
      drawIndexed(ctx, sheet, index + 1, seed.seed_color);
      const suffix = String(item.name).match(/\([A-Za-z]+\)$/);
      const pattern = index + ((suffix && GUILD_PATTERNS[suffix[0]]) || 2);
      drawIndexed(ctx, sheet, pattern, seed.seed_overlay_color);
      drawIndexed(ctx, sheet, pattern + 1, seed.seed_overlay_color);
    } else if (id >= 5822 && id <= 5828) {
      const index = columns * y;
      drawIndexed(ctx, sheet, index + 12, seed.seed_color);
      drawIndexed(ctx, sheet, index + 13, seed.seed_color);
      drawIndexed(ctx, sheet, index + 14, seed.seed_overlay_color);
      drawIndexed(ctx, sheet, index + 15, seed.seed_overlay_color);
    }
  }

  // Dinosaur pets have a placeholder cell in items.dat. The client's PetRenderer::RenderDinoIcon
  // builds them from petleo.rttex: every ID picks a body and a head, tinted from the seed.
  const DINO = { first: 3952, last: 4078, scale: 0.75, x: 2, y: 8, headX: [6, 12, 8, 7], headY: [-14, -23, -22, -9], headDrop: 16 };
  const isDino = (item) => {
    const id = Number(item.item_id);
    return id >= DINO.first && id <= DINO.last && id % 2 === 0 && Number(item.action_type) === 20;
  };

  // [x, y] sheet cells: body colour, body shading, head colour, head shading
  function dinoCells(item) {
    const index = (Number(item.item_id) - DINO.first) / 2;
    const body = index % 4;
    const head = Math.floor(index / 4) % 4;
    const frame = body === 0 ? 1 : 0;
    return { body, cells: [[frame, body], [frame + 3, body], [6, head], [7, head]] };
  }

  function drawDino(ctx, sheet, item, color) {
    const { body, cells } = dinoCells(item);
    const size = TILE * DINO.scale;
    const headX = DINO.x + DINO.headX[body] * DINO.scale;
    const headY = DINO.y + (DINO.headY[body] + DINO.headDrop) * DINO.scale;
    const places = [[DINO.x, DINO.y], [DINO.x, DINO.y], [headX, headY], [headX, headY]];
    cells.forEach(([x, y], i) => {
      const layer = document.createElement("canvas");
      layer.width = layer.height = TILE;
      drawCell(layer.getContext("2d"), sheet, x, y, i % 2 ? null : color);
      ctx.drawImage(layer, places[i][0], places[i][1], size, size);
    });
  }

  async function drawItem(ctx, item) {
    const empty = await loadSheet("assets/img/empty.png");
    const id = Number(item.item_id);
    if (isDino(item)) {
      const sheet = await loadSheet("assets/game/petleo.png");
      const seed = findItem(id + 1);
      if (!sheet || !seed) return drawEmpty(ctx, empty);
      return drawDino(ctx, sheet, item, seed.seed_color);
    }
    const action = Number(item.action_type);
    if (action === 19 && !NOT_DRAWN_AS_SEEDS.has(id)) {
      const seeds = await loadSheet("assets/game/seed.png");
      if (!seeds) return drawEmpty(ctx, empty);
      drawTinted(ctx, seeds, Number(item.seed_base), 0, item.seed_color);
      drawTinted(ctx, seeds, Number(item.seed_overlay), 1, item.seed_overlay_color);
      return;
    }
    const seed = findItem(id + 1);
    if (action === 129 && seed) {
      const roots = await loadSheet("assets/game/rts.png");
      if (!roots) return drawEmpty(ctx, empty);
      drawCell(ctx, roots, Number(seed.seed_base), 0, seed.seed_color);
      drawCell(ctx, roots, Number(seed.seed_overlay), 1, seed.seed_overlay_color);
      return;
    }
    // A texture's _icon sheet always wins over the texture itself
    const texture = String(item.texture);
    const sheet = (await loadSheet(sheetPath(texture.replace(/\.rttex$/i, "_icon.rttex")))) || (await loadSheet(sheetPath(texture)));
    let [x, y] = iconCell(item);
    if (sheet && sheet.width === TILE && sheet.height === TILE) x = y = 0; // single-icon sheet
    if (!sheet || (x + 1) * TILE > sheet.width || (y + 1) * TILE > sheet.height) return drawEmpty(ctx, empty);

    const kind = Number(item.item_kind);
    if (LAYERED_KINDS.has(kind) && seed) {
      drawCell(ctx, sheet, x, y, seed.seed_color);
      drawCell(ctx, sheet, x + 1, y, kind === 38 || kind === 39 ? null : seed.seed_overlay_color);
    } else {
      if (kind === 26) drawCell(ctx, sheet, x, y + 1);
      if (id === 5830 || id === 5832) x += 4;
      drawCell(ctx, sheet, x, y, kind === 36 && seed ? seed.seed_overlay_color : null);
      if (action === 20 && Number(item.clothing_type) === 6 && Number(item.item_category) & 0x20) drawCell(ctx, sheet, x + 1, y);
      if (seed) drawGuild(ctx, sheet, item, x, y, seed);
    }
    if (action === 69 || action === 71) {
      const gear = findItem(3260);
      const gearSheet = gear && (await loadSheet(sheetPath(gear.texture)));
      if (gearSheet) drawCell(ctx, gearSheet, 12, 1);
    }
    if (isBlank(ctx)) drawEmpty(ctx, empty);
  }

  // Hard pixel shadow: every visible pixel casts one solid pixel, with no blur
  function addShadow(ctx, layer) {
    try {
      const source = layer.getContext("2d").getImageData(0, 0, TILE, TILE).data;
      const shadow = ctx.createImageData(TILE, TILE);
      for (let i = 3; i < source.length; i += 4) shadow.data[i] = source[i] ? SHADOW_ALPHA : 0;
      ctx.putImageData(shadow, SHADOW_OFFSET, SHADOW_OFFSET);
    } catch {
      // pixels can't be read when the page is opened from file://
    }
  }

  async function draw(canvas, item) {
    const layer = document.createElement("canvas");
    layer.width = layer.height = TILE;
    const layerCtx = layer.getContext("2d");
    layerCtx.imageSmoothingEnabled = false;
    await drawItem(layerCtx, item);
    canvas.width = canvas.height = TILE + SHADOW_OFFSET;
    const ctx = canvas.getContext("2d");
    addShadow(ctx, layer);
    ctx.drawImage(layer, 0, 0);
  }

  // Frame by action type, as a cell number of gui_itembox.png read left to right; anything else is 0.
  // 0 blue blocks, 1 beige backgrounds, 3 green seeds, 5 purple consumables, 6 orange locks, 7 grey components, 8 white clothes, 9 pink artifacts
  const BOX_COLOR = { 3: 6, 8: 5, 18: 1, 19: 3, 20: 8, 22: 1, 23: 1, 28: 1, 37: 7, 64: 7, 107: 9, 129: 7 };
  const BOX_CELL = 40;

  function loadBoxFrames(sheet) {
    for (const color of new Set([0, ...Object.values(BOX_COLOR)])) {
      const cell = document.createElement("canvas");
      cell.width = cell.height = BOX_CELL;
      cell.getContext("2d").drawImage(sheet, (color % 3) * BOX_CELL, Math.floor(color / 3) * BOX_CELL, BOX_CELL, BOX_CELL, 0, 0, BOX_CELL, BOX_CELL);
      document.documentElement.style.setProperty(`--item-box-${color}`, `url(${cell.toDataURL()})`);
    }
  }

  const boxClass = (item) => ` item-box item-box-${BOX_COLOR[item.action_type] || 0}`;

  // The icon alone at 32x32, without the shadow
  async function render(item) {
    const layer = document.createElement("canvas");
    layer.width = layer.height = TILE;
    const ctx = layer.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    await drawItem(ctx, item);
    return layer;
  }

  // lookup(id) gives the item with that ID; many icons take their colours from the next item, the seed
  return { draw, render, loadSheet, sheetPath, isDino, dinoCells, loadBoxFrames, boxClass, setLookup: (lookup) => { findItem = lookup; } };
})();
