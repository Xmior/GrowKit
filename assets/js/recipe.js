// Splice recipes from assets/data/items.dat: a seed's ingredients are the two seeds spliced to get it.
const searchBox = document.getElementById("recipe_search");
const statusLine = document.getElementById("recipe_status");
const treeRoot = document.getElementById("recipe_tree");
const stage = document.getElementById("recipe_stage");
const lines = document.getElementById("recipe_lines");
const SEED_ACTION = 19;
const MAX_LAYERS = 3; // deeper layers open on click; otherwise Dirt alone would list almost every recipe
const USES_PER_LAYER = 200;
const SVG_NS = "http://www.w3.org/2000/svg";
let byId = new Map();
let byName = new Map();
let root = null;
let currentId = null;
let mode = "make";
const usedIn = new Map();

function ingredientsOf(id) {
  const seed = byId.get(id + 1);
  if (!seed || !seed.ingredient1 || !seed.ingredient2) return [];
  return [seed.ingredient1 - 1, seed.ingredient2 - 1].filter((part) => byId.has(part));
}

// path holds the items above this one, so a recipe that loops back on itself stops there
function makeNode(id, path) {
  const inPath = path.includes(id);
  const parts = inPath ? [] : ingredientsOf(id);
  return { id, path: [...path, id], parts, kids: null, open: false, looped: inPath };
}

function openNode(node) {
  if (!node.kids) node.kids = node.parts.map((part) => makeNode(part, node.path));
  node.open = true;
}

function openLayers(node, layers) {
  if (!layers || !node.parts.length) return;
  openNode(node);
  node.kids.forEach((kid) => openLayers(kid, layers - 1));
}

// Items within MAX_LAYERS of this one, each listed once at its closest layer
function usesByLayer(id) {
  const seen = new Set([id]);
  const layers = [];
  let current = [id];
  for (let layer = 0; layer < MAX_LAYERS && current.length; layer++) {
    const next = [];
    for (const part of current) {
      for (const user of usedIn.get(part) || []) {
        if (seen.has(user)) continue;
        seen.add(user);
        next.push(user);
      }
    }
    layers.push(next);
    current = next;
  }
  return layers;
}

function usesCard(id) {
  const item = byId.get(id);
  const card = document.createElement("button");
  card.type = "button";
  card.className = "recipe-card";
  card.addEventListener("click", () => {
    searchBox.value = item.name;
    showItem(id, "make");
  });
  const tile = document.createElement("span");
  tile.className = `item-tile${ItemIcons.boxClass(item)}`;
  const icon = document.createElement("canvas");
  icon.className = "item-icon item-icon-fill";
  ItemIcons.render(item).then((layer) => {
    icon.width = icon.height = 32;
    icon.getContext("2d").drawImage(layer, 0, 0);
  });
  tile.append(icon);
  const name = document.createElement("span");
  name.className = "recipe-name";
  name.textContent = item.name;
  card.append(tile, name);
  return card;
}

function renderUses(id) {
  const box = document.getElementById("recipe_uses");
  const layers = usesByLayer(id);
  const total = layers.reduce((sum, list) => sum + list.length, 0);
  statusLine.textContent = total ? `${total} items use ${byId.get(id).name} within ${MAX_LAYERS} layers of their recipe. Click one to see how it's made.` : `Nothing uses ${byId.get(id).name} in its recipe.`;
  box.replaceChildren(...layers.filter((list) => list.length).map((list) => {
    const section = document.createElement("section");
    const title = document.createElement("h2");
    const number = layers.indexOf(list) + 1;
    title.textContent = `${number === 1 ? "Direct ingredient" : `Layer ${number}`} (${list.length})`;
    const grid = document.createElement("div");
    grid.className = "recipe-use-grid";
    grid.append(...list.slice(0, USES_PER_LAYER).map(usesCard));
    section.append(title, grid);
    if (list.length > USES_PER_LAYER) {
      const note = document.createElement("p");
      note.textContent = `Showing the first ${USES_PER_LAYER}.`;
      section.append(note);
    }
    return section;
  }));
}

function nodeElement(node) {
  const item = byId.get(node.id);
  const wrap = document.createElement("div");
  wrap.className = "recipe-node";
  const card = document.createElement(node.parts.length ? "button" : "div");
  card.className = "recipe-card";
  if (node.parts.length) {
    card.type = "button";
    card.setAttribute("aria-expanded", node.open);
    card.addEventListener("click", () => {
      if (node.open) node.open = false;
      else openNode(node);
      render();
    });
  }
  const tile = document.createElement("span");
  tile.className = `item-tile${ItemIcons.boxClass(item)}`;
  const icon = document.createElement("canvas");
  icon.className = "item-icon item-icon-fill";
  ItemIcons.render(item).then((layer) => {
    icon.width = icon.height = 32;
    icon.getContext("2d").drawImage(layer, 0, 0);
  });
  tile.append(icon);
  const name = document.createElement("span");
  name.className = "recipe-name";
  name.textContent = item.name;
  card.append(tile, name);
  wrap.append(card);
  if (node.parts.length && !node.open) {
    const more = document.createElement("a");
    more.className = "recipe-more";
    more.href = `recipe.html#${node.id}`;
    more.target = "_blank";
    more.rel = "noopener";
    more.textContent = "+ Show recipe";
    wrap.append(more);
  }
  if (node.open) {
    const kids = document.createElement("div");
    kids.className = "recipe-kids";
    kids.append(...node.kids.map(nodeElement));
    wrap.append(kids);
  }
  return wrap;
}

function drawLines() {
  const box = stage.getBoundingClientRect();
  lines.setAttribute("width", stage.scrollWidth);
  lines.setAttribute("height", stage.scrollHeight);
  const paths = [];
  for (const wrap of treeRoot.querySelectorAll(".recipe-node")) {
    const kids = wrap.querySelector(":scope > .recipe-kids");
    if (!kids) continue;
    const from = wrap.querySelector(":scope > .recipe-card").getBoundingClientRect();
    const x1 = from.left + from.width / 2 - box.left;
    const y1 = from.bottom - box.top;
    for (const kid of kids.children) {
      const to = kid.querySelector(":scope > .recipe-card").getBoundingClientRect();
      const x2 = to.left + to.width / 2 - box.left;
      const y2 = to.top - box.top;
      const mid = (y1 + y2) / 2;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`);
      paths.push(path);
    }
  }
  lines.replaceChildren(...paths);
}

function render() {
  treeRoot.replaceChildren(root ? nodeElement(root) : "");
  drawLines();
}

function showItem(id, nextMode = mode) {
  const item = byId.get(id);
  currentId = id;
  mode = nextMode;
  document.getElementById("mode_make").setAttribute("aria-pressed", mode === "make");
  document.getElementById("mode_uses").setAttribute("aria-pressed", mode === "uses");
  document.getElementById("recipe_scroll").hidden = mode !== "make";
  document.getElementById("recipe_uses").hidden = mode !== "uses";
  if (mode === "uses") {
    renderUses(id);
    history.replaceState(null, "", `#uses-${id}`);
    return;
  }
  root = makeNode(id, []);
  openLayers(root, MAX_LAYERS);
  statusLine.textContent = root.parts.length ? `Recipe for ${item.name}, ${MAX_LAYERS} layers deep. Click an item to open or close its part of the tree.` : `${item.name} has no splice recipe in items.dat.`;
  render();
  history.replaceState(null, "", `#${id}`);
}

function findItem(text) {
  const query = text.trim().toLowerCase();
  if (!query) return null;
  if (/^\d+$/.test(query)) {
    const number = Number(query);
    const item = byId.get(number);
    if (!item) return null;
    return item.action_type === SEED_ACTION ? number - 1 : number;
  }
  return byName.get(query) ?? null;
}

searchBox.addEventListener("change", () => {
  const id = findItem(searchBox.value);
  if (id !== null) showItem(id);
  else if (searchBox.value.trim()) statusLine.textContent = `No item called "${searchBox.value.trim()}".`;
});
document.getElementById("mode_make").addEventListener("click", () => {
  if (currentId !== null) showItem(currentId, "make");
});
document.getElementById("mode_uses").addEventListener("click", () => {
  if (currentId !== null) showItem(currentId, "uses");
});
new ResizeObserver(drawLines).observe(treeRoot);

window.onItemsDecoded = (data) => {
  const items = data.items.filter((item) => item.name);
  byId = new Map(items.map((item) => [item.item_id, item]));
  ItemIcons.setLookup((id) => byId.get(id));
  const blocks = items.filter((item) => item.action_type !== SEED_ACTION);
  byName = new Map(blocks.map((item) => [item.name.toLowerCase(), item.item_id]));
  const withRecipe = blocks.filter((item) => ingredientsOf(item.item_id).length);
  document.getElementById("recipe_names").replaceChildren(...withRecipe.map((item) => new Option(item.name)));
  document.getElementById("recipe_info").textContent = `${withRecipe.length} splice recipes from the latest items.dat (version ${data.version}).`;
  for (const item of withRecipe) {
    for (const part of ingredientsOf(item.item_id)) {
      if (!usedIn.has(part)) usedIn.set(part, []);
      usedIn.get(part).push(item.item_id);
    }
  }
  const hash = location.hash.match(/^#(uses-)?(\d+)$/);
  const start = hash && Number(hash[2]);
  const first = byId.has(start) ? start : byName.get("pickaxe");
  if (first !== undefined) {
    searchBox.value = byId.get(first).name;
    showItem(first, hash && hash[1] ? "uses" : "make");
  }
};

(async () => {
  try {
    const sheet = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = "assets/game/gui_itembox.png";
    });
    if (sheet) ItemIcons.loadBoxFrames(sheet);
    const response = await fetch("assets/data/items.dat");
    if (!response.ok) throw new Error("items.dat was not found.");
    item_decoder(await response.blob(), true);
  } catch (error) {
    document.getElementById("recipe_info").textContent = `The recipes could not be loaded: ${error.message}`;
  }
})();
