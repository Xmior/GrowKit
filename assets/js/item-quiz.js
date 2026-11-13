// GrowQuiz: a game show on the latest items.dat. Name Board is hangman with hint cards, Sprite Zoom shows a piece
// of the icon. Both share one pool of lives: every solved item gives two back.
// Seeds and null_items never come up. Items with the Mod or Beta category flag only do when the setting is on.

const ACTION = { seed: 19, clothes: 20, artifact: 107 };
const BIT = { flippable: 1, editable: 2, seedless: 4, permanent: 8, worldLocked: 128 };
const CATEGORY = { beta: 1, mod: 4, public: 16, untradeable: 128 };
const ELEMENTS = { 0: { id: 6018, name: "Earth" }, 1: { id: 6020, name: "Fire" }, 2: { id: 6022, name: "Wind" }, 3: { id: 6024, name: "Water" } };
const BODY_PARTS = ["Hat", "Shirt", "Pants", "Shoes", "Face", "Hand", "Back", "Hair", "Chest"];
const ARTIFACT_PART = "artifacts";
// Sprite mode: the side of the visible square, in pixels of the 32px icon, for each wrong guess
const SPRITE_STEPS = [4, 6, 8, 11, 14, 18, 24, 32];
const START_LIVES = 7;
const SOLVE_BONUS = 2;
const WRONG_SOLVE_COST = 2;
const HINT_COST = 1;
const FREE_HINTS = 2;
const MODE_HELP = {
  hangman: `Pick letters to fill the board. A wrong letter costs a life, a wrong full answer costs ${WRONG_SOLVE_COST}, and every extra hint costs ${HINT_COST}. Two hints are open at the start. Solving an item gives ${SOLVE_BONUS} lives back.`,
  sprite: `A tiny piece of the item's icon. Every wrong guess costs a life and shows more of it. Solving an item gives ${SOLVE_BONUS} lives back.`,
};

const $ = (id) => document.getElementById(id);
let all = [];
let byId = new Map();
let elements = {};
let emptyIcon = "";
let mode = "hangman";
let pool = [];
let round = null;
let score = 0;
let lives = START_LIVES;
let gameOver = false;

const plain = (text) => String(text || "").replace(/`./g, "").replaceAll("<CR>", "\n").replaceAll("\\n", "\n").trim();
const normal = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
const seedOf = (item) => byId.get(item.item_id + 1);
const elementOf = (item) => ELEMENTS[elements[item.item_id]];
const isLetter = (ch) => /[a-z0-9]/i.test(ch);

function hasProperty(item, property) {
  const seed = seedOf(item);
  const recipe = Boolean(seed && seed.ingredient1 && seed.ingredient2);
  if (property === "recipe") return recipe;
  if (property === "norecipe") return !recipe;
  if (property === "untradeable") return Boolean(item.item_category & CATEGORY.untradeable);
  if (property === "public") return Boolean(item.item_category & CATEGORY.public);
  return Boolean(item.editable_type & BIT[property]);
}

// ==============================
// POOL
// ==============================

const isDev = (item) => Boolean(item.item_category & (CATEGORY.mod | CATEGORY.beta));
const playable = (item) => item.name && item.action_type !== ACTION.seed && !/^null_item/i.test(item.name) && !/ seed$/i.test(item.name);

function buildPool() {
  const type = $("quiz_type").value;
  const part = $("quiz_part").value;
  const property = $("quiz_property").value;
  const dev = $("quiz_dev").checked;
  pool = all.filter((item) => {
    if (!playable(item)) return false;
    if (!dev && isDev(item)) return false;
    if (type && item.action_type !== Number(type)) return false;
    if (part === ARTIFACT_PART && item.action_type !== ACTION.artifact) return false;
    if (part && part !== ARTIFACT_PART && (item.action_type === ACTION.artifact || item.clothing_type !== Number(part))) return false;
    if (property && !hasProperty(item, property)) return false;
    if (mode === "hangman" && item.name.replace(/[^a-z0-9]/gi, "").length < 3) return false;
    return true;
  });
  $("pool_info").textContent = pool.length ? `${pool.length} items can come up with these settings.` : "No items match these settings.";
}

// ==============================
// ROUNDS
// ==============================

async function iconOf(item) {
  const canvas = document.createElement("canvas");
  await ItemIcons.draw(canvas, item);
  return canvas;
}

const bestKey = () => `growquiz-best-${mode}`;
function readBest() {
  try { return Number(localStorage.getItem(bestKey())) || 0; } catch { return 0; }
}
function saveBest() {
  try { if (score > readBest()) localStorage.setItem(bestKey(), String(score)); } catch { /* storage blocked */ }
}

function renderScore() {
  $("score").textContent = score;
  $("lives").textContent = lives;
  $("best").textContent = Math.max(readBest(), score);
  const hearts = $("hearts");
  hearts.replaceChildren(...Array.from({ length: Math.min(lives, 20) }, () => {
    const heart = document.createElement("span");
    heart.className = "heart";
    return heart;
  }));
}

function loseLives(count, message) {
  lives = Math.max(0, lives - count);
  const board = document.querySelector(".scoreboard");
  board.classList.remove("hit");
  void board.offsetWidth;
  board.classList.add("hit");
  $("feedback").textContent = message;
  $("feedback").className = "show-feedback bad";
  renderScore();
  if (!lives) {
    finish(false);
    return true;
  }
  return false;
}

function newGame() {
  score = 0;
  lives = START_LIVES;
  gameOver = false;
  $("restart").hidden = true;
  renderScore();
  newRound();
}

async function newRound() {
  $("answer").hidden = true;
  $("next").hidden = true;
  $("feedback").textContent = "";
  $("feedback").className = "show-feedback";
  $("guess").value = "";
  document.querySelector(".show-actions").hidden = false;
  $("buy_hint").hidden = mode !== "hangman";
  if (!pool.length) {
    $("clue").hidden = false;
    $("clue").textContent = "Change the studio settings so at least one item can come up.";
    return;
  }
  // Sprite Zoom needs an icon that isn't the empty placeholder
  for (let attempt = 0; attempt < 40; attempt++) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    round = { item, wrong: 0, guessed: new Set(), hints: FREE_HINTS, over: false };
    if (mode !== "sprite") break;
    round.icon = await iconOf(item);
    if (round.icon.toDataURL() !== emptyIcon) break;
  }
  if (mode === "sprite") {
    // A piece of the opaque part of the icon, chosen once per round
    const data = round.icon.getContext("2d").getImageData(0, 0, 32, 32).data;
    const solid = [];
    for (let i = 0; i < 32 * 32; i++) if (data[i * 4 + 3] > 200) solid.push(i);
    const pick = solid.length ? solid[Math.floor(Math.random() * solid.length)] : 16 * 32 + 16;
    round.center = [pick % 32, Math.floor(pick / 32)];
  }
  render();
  if (mode === "sprite") $("guess").focus();
}

function render() {
  $("clue").hidden = mode !== "sprite";
  $("hints").hidden = mode !== "hangman";
  $("word").hidden = mode !== "hangman";
  $("keys").hidden = mode !== "hangman";
  if (mode === "sprite") $("clue").replaceChildren(spriteClue(), spriteSide());
  if (mode === "hangman") {
    renderHints();
    renderWord();
    renderKeys();
    $("buy_hint").disabled = round.over || round.hints >= HINTS.length;
  }
}

// Wrong guesses show their own icon next to the screen, so you can compare
let lightChecker = false;
try { lightChecker = localStorage.getItem("growquiz-light-checker") === "1"; } catch { /* storage blocked */ }

function spriteSide() {
  const side = document.createElement("div");
  side.className = "sprite-side";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "show-btn checker-toggle";
  toggle.textContent = lightChecker ? "Dark background" : "Light background";
  toggle.setAttribute("aria-pressed", String(lightChecker));
  toggle.addEventListener("click", () => {
    lightChecker = !lightChecker;
    try { localStorage.setItem("growquiz-light-checker", lightChecker ? "1" : "0"); } catch { /* storage blocked */ }
    render();
  });
  const list = document.createElement("ul");
  list.className = "miss-list";
  list.setAttribute("aria-label", "Wrong guesses");
  for (const miss of round.misses || []) {
    const li = document.createElement("li");
    li.className = "miss";
    const icon = document.createElement("canvas");
    icon.className = `miss-icon${lightChecker ? " light" : ""}`;
    if (miss.item) ItemIcons.draw(icon, miss.item);
    const name = document.createElement("span");
    name.textContent = miss.item ? miss.item.name : miss.text;
    li.append(icon, name);
    list.append(li);
  }
  side.append(toggle, list);
  return side;
}

function spriteClue() {
  const step = SPRITE_STEPS[Math.min(round.wrong, SPRITE_STEPS.length - 1)];
  const size = round.over ? 32 : step;
  const [cx, cy] = round.center;
  const x = Math.max(0, Math.min(32 - size, cx - Math.floor(size / 2)));
  const y = Math.max(0, Math.min(32 - size, cy - Math.floor(size / 2)));
  const view = document.createElement("canvas");
  view.width = view.height = 256;
  view.className = `sprite-view${lightChecker ? " light" : ""}`;
  const ctx = view.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(round.icon, x, y, size, size, 0, 0, 256, 256);
  return view;
}

// Hint cards, weakest first. The first two are open when a round starts.
const HINTS = [
  { label: "Block type", value: (item) => item.action_type === ACTION.clothes
    ? `Clothes, worn on the ${BODY_PARTS[item.clothing_type] || "body"}`
    : item.action_type === ACTION.artifact ? "Artifact" : ACTION_TYPES[item.action_type] || "Unknown" },
  { label: "Rarity", value: (item) => (!item.rarity || item.rarity === 999 ? "None" : String(item.rarity)) },
  { label: "Element", value: (item) => elementOf(item)?.name || "None" },
  { label: "Seed", value: (item) => {
    const seed = seedOf(item);
    if (!seed) return "None";
    const canvas = document.createElement("canvas");
    canvas.className = "hint-seed";
    ItemIcons.draw(canvas, seed);
    return canvas;
  } },
  { label: "Description", wide: true, value: (item) => {
    const text = plain(item.str_version_22);
    if (!text) return "No description";
    // The name sometimes appears in its own description
    return text.replace(new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "???");
  } },
];

function renderHints() {
  const wall = $("hints");
  wall.replaceChildren(...HINTS.map((hint, i) => {
    const open = round.over || i < round.hints;
    const card = document.createElement("div");
    card.className = `hint-card${open ? " open" : ""}${hint.wide ? " wide" : ""}${i === round.justOpened ? " just" : ""}`;
    const front = document.createElement("div");
    front.className = "hint-front";
    front.textContent = i + 1;
    const back = document.createElement("div");
    back.className = "hint-back";
    const label = document.createElement("span");
    label.className = "hint-label";
    label.textContent = hint.label;
    const value = document.createElement("span");
    value.className = "hint-value";
    if (open) value.append(hint.value(round.item));
    back.append(label, value);
    card.append(front, back);
    return card;
  }));
}

function renderWord() {
  const word = $("word");
  word.replaceChildren(...round.item.name.split(" ").map((part) => {
    const group = document.createElement("span");
    group.className = "board-word";
    for (const ch of part) {
      const cell = document.createElement("span");
      if (!isLetter(ch)) {
        cell.className = "board-tile board-mark";
        cell.textContent = ch;
      } else {
        const show = round.guessed.has(ch.toLowerCase());
        cell.className = `board-tile${show ? " lit" : ""}${round.over && !show ? " missed" : ""}`;
        cell.textContent = show || round.over ? ch.toUpperCase() : "";
      }
      group.append(cell);
    }
    return group;
  }));
}

function renderKeys() {
  const keys = $("keys");
  const name = round.item.name.toLowerCase();
  keys.replaceChildren(...[..."abcdefghijklmnopqrstuvwxyz0123456789"].map((ch) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key";
    if (round.guessed.has(ch)) button.classList.add(name.includes(ch) ? "hit" : "miss");
    button.textContent = ch.toUpperCase();
    button.disabled = round.over || round.guessed.has(ch);
    button.addEventListener("click", () => guessLetter(ch));
    return button;
  }));
}

// ==============================
// GUESSING
// ==============================

function guessName(text) {
  if (!round || round.over || !text.trim()) return;
  if (normal(text) === normal(round.item.name)) return finish(true);
  $("guess").value = "";
  round.wrong++;
  const guessed = all.find((item) => playable(item) && normal(item.name) === normal(text));
  (round.misses ||= []).unshift({ text: text.trim(), item: guessed });
  if (loseLives(mode === "hangman" ? WRONG_SOLVE_COST : 1, `Not ${text.trim()}.`)) return;
  render();
}

function guessLetter(ch) {
  if (!round || round.over || round.guessed.has(ch)) return;
  round.guessed.add(ch);
  const name = round.item.name.toLowerCase();
  if (!name.includes(ch)) {
    if (loseLives(1, `No ${ch.toUpperCase()} on the board.`)) return;
  } else {
    $("feedback").textContent = `${ch.toUpperCase()} is on the board!`;
    $("feedback").className = "show-feedback good";
  }
  if ([...name].every((c) => !isLetter(c) || round.guessed.has(c))) return finish(true);
  round.justOpened = -1;
  render();
}

function buyHint() {
  if (!round || round.over || round.hints >= HINTS.length) return;
  round.hints++;
  round.justOpened = round.hints - 1;
  if (loseLives(HINT_COST, `Hint ${round.hints} is open.`)) return;
  render();
}

async function finish(won) {
  round.over = true;
  if (won) {
    score++;
    lives += SOLVE_BONUS;
    saveBest();
  }
  gameOver = !lives;
  renderScore();
  $("feedback").textContent = won ? `Solved! +${SOLVE_BONUS} lives` : gameOver ? "Out of lives. Game over!" : "Better luck on the next one.";
  $("feedback").className = `show-feedback ${won ? "good" : "bad"}`;
  if (gameOver) saveBest();
  render();
  const { item } = round;
  await ItemIcons.draw($("answer_icon"), item);
  $("answer_label").textContent = won ? "You got it" : "The answer was";
  $("answer_name").textContent = item.name;
  $("answer_desc").textContent = plain(item.str_version_22);
  $("answer").hidden = false;
  $("answer").classList.toggle("won", won);
  document.querySelector(".show-actions").hidden = true;
  $("next").hidden = gameOver;
  $("restart").hidden = !gameOver;
  (gameOver ? $("restart") : $("next")).focus();
}

// ==============================
// SETTINGS
// ==============================

function setMode(next) {
  mode = next;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("mode_help").textContent = MODE_HELP[mode];
  buildPool();
  newGame();
}

function settingsChanged() {
  buildPool();
  newGame();
}

function bind() {
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("quiz_type").addEventListener("change", () => {
    const clothes = $("quiz_type").value === String(ACTION.clothes);
    $("quiz_part_wrap").hidden = !clothes;
    if (!clothes) $("quiz_part").value = "";
    settingsChanged();
  });
  $("quiz_part").addEventListener("change", settingsChanged);
  $("quiz_property").addEventListener("change", settingsChanged);
  // Turning the developer items on asks first; turning them off doesn't
  $("quiz_dev").addEventListener("change", (event) => {
    if (!event.target.checked) return settingsChanged();
    event.target.checked = false;
    $("dev_confirm").showModal();
  });
  $("dev_yes").addEventListener("click", () => {
    $("dev_confirm").close();
    $("quiz_dev").checked = true;
    settingsChanged();
  });
  $("dev_no").addEventListener("click", () => $("dev_confirm").close());
  $("guess_form").addEventListener("submit", (event) => {
    event.preventDefault();
    guessName($("guess").value);
  });
  $("buy_hint").addEventListener("click", buyHint);
  $("give_up").addEventListener("click", () => {
    if (!round || round.over) return;
    if (!loseLives(SOLVE_BONUS, "Skipped.")) finish(false);
  });
  $("next").addEventListener("click", newRound);
  $("restart").addEventListener("click", newGame);
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector("dialog[open]")) return;
    if (event.key === "Enter" && round?.over && !event.target.closest("form")) return gameOver ? newGame() : newRound();
    if (mode !== "hangman" || event.target.matches("input, select, textarea")) return;
    if (/^[a-z0-9]$/i.test(event.key)) guessLetter(event.key.toLowerCase());
  });
}

window.onItemsDecoded = async (data) => {
  all = data.items.filter((item) => item.name);
  byId = new Map(all.map((item) => [item.item_id, item]));
  ItemIcons.setLookup((id) => byId.get(id));

  const types = [...new Set(all.filter(playable).map((item) => item.action_type))].filter((type) => ACTION_TYPES[type]);
  types.sort((a, b) => ACTION_TYPES[a].localeCompare(ACTION_TYPES[b]));
  $("quiz_type").append(...types.map((type) => new Option(ACTION_TYPES[type], type)));
  $("quiz_part").append(...BODY_PARTS.map((name, value) => new Option(name, value)), new Option("Artifacts", ARTIFACT_PART));
  $("item_names").replaceChildren(...[...new Set(all.filter(playable).map((item) => item.name))].sort().map((name) => new Option(name)));
  // What an item without art looks like, so sprite mode can skip those
  const blank = document.createElement("canvas");
  await ItemIcons.draw(blank, { item_id: -1, name: "x", texture: "../img/empty.png", texture_x: 0, texture_y: 0, spread_type: 1, action_type: 17 });
  emptyIcon = blank.toDataURL();
  $("quiz_info").textContent = `${pool.length || all.filter(playable).length} items from the latest items.dat (version ${data.version}) are in the studio tonight.`;
  bind();
  setMode("hangman");
};

(async () => {
  try {
    const boxes = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = "assets/game/gui_itembox.png";
    });
    if (boxes) ItemIcons.loadBoxFrames(boxes);
    const [elementData, dat] = await Promise.all([
      fetch("assets/data/elements.json").then((r) => (r.ok ? r.json() : {})),
      fetch("assets/data/items.dat").then((r) => { if (!r.ok) throw new Error("items.dat was not found."); return r.blob(); }),
    ]);
    elements = elementData;
    item_decoder(dat, true);
  } catch (error) {
    $("quiz_info").textContent = `The item list could not be loaded: ${error.message}`;
  }
})();
