// Auction and Leaderboard: reads the public pages through api/page.php and redraws them here.
async function fetchPage(page) {
  const response = await fetch(`api/page.php?page=${page}`, { cache: "no-store" });
  if (!response.ok) throw new Error("The page could not be loaded right now.");
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

function setText(el, text) {
  el.textContent = text;
  return el;
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const clean = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

// Loads once, the first time a box is opened
function loadOnOpen(box, load) {
  let started = false;
  box.addEventListener("toggle", () => {
    if (box.open && !started) {
      started = true;
      load();
    }
  });
}

/* Auction ------------------------------------------------------------ */
const AUCTION_PAGE = 20;
const auction = {
  rows: [],
  limit: AUCTION_PAGE,
  loadedAt: 0,
  list: document.getElementById("auction_list"),
  status: document.getElementById("auction_status"),
  search: document.getElementById("auction_search"),
  sort: document.getElementById("auction_sort"),
  more: document.getElementById("auction_more"),
  byName: new Map(),
  byId: new Map(),
};

async function loadItemIndex() {
  ItemIcons.setLookup((id) => auction.byId.get(id));
  if (auction.byName.size) return;
  const response = await fetch("assets/data/items.json");
  if (!response.ok) return;
  for (const row of (await response.json()).items) {
    const [item_id, name, texture, texture_x, texture_y, spread_type, action_type, clothing_type, seed_base, seed_overlay, c1, c2, item_kind, item_category] = row;
    const item = { item_id, name, texture, texture_x, texture_y, spread_type, action_type, clothing_type, seed_base, seed_overlay, item_kind, item_category,
      seed_color: { r: c1[0], g: c1[1], b: c1[2] }, seed_overlay_color: { r: c2[0], g: c2[1], b: c2[2] } };
    auction.byId.set(item_id, item);
    const key = name.toLowerCase();
    if (!auction.byName.has(key)) auction.byName.set(key, item);
  }
}

function findItem(name) {
  const byId = name.match(/^Item #(\d+)$/i);
  return byId ? auction.byId.get(Number(byId[1])) : auction.byName.get(name.toLowerCase());
}

function formatRemaining(seconds) {
  if (seconds <= 0) return "Expired!";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const elapsed = () => Math.floor((Date.now() - auction.loadedAt) / 1000);

function auctionRow(row) {
  const el = make("li", "auction-row");
  const icon = make("canvas", "item-icon");
  ItemIcons.draw(icon, row.item || { texture: "", action_type: 0 });
  const main = make("div", "auction-main");
  main.append(make("div", "auction-name", row.item && /^Item #/i.test(row.name) ? row.item.name : row.name), make("div", "auction-sub", row.owner));
  const bid = make("div", "auction-stat");
  bid.append(make("span", "", "Current Bid"), make("strong", "", row.bidText));
  const world = make("div", "auction-stat");
  const copy = make("button", "btn-sm", row.world);
  copy.type = "button";
  copy.title = "Copy world name";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(row.world);
      GK.toast(`${row.world} copied.`);
    } catch {
      GK.toast("Clipboard access was blocked.", "error");
    }
  });
  world.append(make("span", "", "World"), copy);
  const timer = make("div", "auction-stat");
  row.timer = make("strong", "", formatRemaining(row.remaining - elapsed()));
  timer.append(make("span", "", "Expires in"), row.timer);
  el.append(icon, main, bid, world, timer);
  return el;
}

function renderAuction() {
  const query = auction.search.value.trim().toLowerCase();
  const matches = auction.rows.filter((r) => !query || r.search.includes(query));
  const compare = {
    "time-asc": (a, b) => a.remaining - b.remaining,
    "time-desc": (a, b) => b.remaining - a.remaining,
    "bid-desc": (a, b) => b.bid - a.bid,
    "bid-asc": (a, b) => a.bid - b.bid,
  }[auction.sort.value];
  matches.sort(compare);
  auction.rows.forEach((r) => { r.timer = null; });
  const shown = matches.slice(0, auction.limit);
  auction.list.replaceChildren(...shown.map(auctionRow));
  setText(auction.status, `Showing ${shown.length} of ${matches.length} auctions.`);
  auction.more.hidden = shown.length >= matches.length;
}

async function loadAuction() {
  setText(auction.status, "Loading auctions...");
  try {
    const [doc] = await Promise.all([fetchPage("auction"), loadItemIndex()]);
    auction.loadedAt = Date.now();
    auction.rows = [...doc.querySelectorAll(".gtauc-row")].map((el) => {
      const name = clean(el.querySelector(".gtauc-name"));
      const owner = clean(el.querySelector(".gtauc-sub"));
      const world = el.querySelector(".gtauc-world-btn")?.dataset.world || "";
      return { name, owner, world, bid: Number(el.dataset.bid) || 0, bidText: clean(el.querySelector(".gtauc-bid-amount")),
        remaining: Number(el.dataset.remaining) || 0, item: findItem(name), search: `${name} ${owner} ${world}`.toLowerCase() };
    });
    if (!auction.rows.length) throw new Error("No auctions were found on the page.");
    auction.limit = AUCTION_PAGE;
    renderAuction();
  } catch (error) {
    auction.list.replaceChildren();
    auction.more.hidden = true;
    setText(auction.status, error.message);
  }
}

auction.search.addEventListener("input", () => { auction.limit = AUCTION_PAGE; renderAuction(); });
auction.sort.addEventListener("change", renderAuction);
auction.more.addEventListener("click", () => { auction.limit += AUCTION_PAGE; renderAuction(); });
document.getElementById("auction_refresh").addEventListener("click", loadAuction);
setInterval(() => {
  auction.rows.forEach((r) => { if (r.timer) r.timer.textContent = formatRemaining(r.remaining - elapsed()); });
}, 1000);
loadOnOpen(document.getElementById("auction_box"), loadAuction);

/* Leaderboard --------------------------------------------------------- */
const board = {
  tabs: document.getElementById("leaderboard_tabs"),
  table: document.getElementById("leaderboard_rows"),
  title: document.getElementById("leaderboard_title"),
  status: document.getElementById("leaderboard_status"),
  panel: document.getElementById("leaderboard_panel"),
  data: [],
};

function showBoard(index) {
  [...board.tabs.children].forEach((tab, i) => tab.setAttribute("aria-pressed", i === index));
  const current = board.data[index];
  setText(board.title, current.title);
  board.table.replaceChildren(...current.rows.map((row) => {
    const tr = document.createElement("tr");
    tr.append(make("td", "", row.rank), make("td", "", row.name), make("td", "hide-sm", row.league), make("td", "cell-end", row.score));
    return tr;
  }));
}

async function loadLeaderboard() {
  setText(board.status, "Loading leaderboard...");
  board.panel.hidden = true;
  try {
    const doc = await fetchPage("leaderboard");
    board.data = [...doc.querySelectorAll(".gtlb-board")].map((section) => {
      const podium = [...section.querySelectorAll(".gtlb-podium-slot")].map((slot) => ({
        rank: Number(clean(slot.querySelector(".gtlb-medal"))), name: clean(slot.querySelector(".gtlb-podium-name")),
        score: clean(slot.querySelector(".gtlb-podium-score")), league: clean(slot.querySelector(".gtlb-podium-league")),
      }));
      const list = [...section.querySelectorAll(".gtlb-list-row")].map((row) => ({
        rank: Number(clean(row.querySelector(".gtlb-rank"))), name: clean(row.querySelector(".gtlb-name")),
        score: clean(row.querySelector(".gtlb-score")), league: "",
      }));
      return { title: clean(section.querySelector(".gtlb-board-title")), rows: [...podium, ...list].sort((a, b) => a.rank - b.rank) };
    });
    if (!board.data.length) throw new Error("No leaderboards were found on the page.");
    board.tabs.replaceChildren(...board.data.map((item, index) => {
      const tab = make("button", "btn-sm", item.title);
      tab.type = "button";
      tab.addEventListener("click", () => showBoard(index));
      return tab;
    }));
    showBoard(0);
    board.panel.hidden = false;
    setText(board.status, "");
  } catch (error) {
    setText(board.status, error.message);
  }
}

document.getElementById("leaderboard_refresh").addEventListener("click", loadLeaderboard);
loadOnOpen(document.getElementById("leaderboard_box"), loadLeaderboard);
