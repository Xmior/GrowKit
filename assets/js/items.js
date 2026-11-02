const PAGE_SIZE = 50;

const panel = document.getElementById("editor_panel");
const tbody = document.getElementById("items_body");
const search = document.getElementById("item_search");
let filtered = [];
let page = 0;

function renderTable() {
  const start = page * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE).map((index) => {
    const item = data_json.items[index];
    const row = document.createElement("tr");
    const id = document.createElement("td");
    id.textContent = item.item_id;
    const name = document.createElement("td");
    const label = document.createElement("span");
    label.className = "item-name";
    const icon = document.createElement("canvas");
    icon.className = "item-icon";
    ItemIcons.draw(icon, item);
    label.append(icon, item.name);
    name.appendChild(label);
    const texture = document.createElement("td");
    texture.className = "hide-sm mono";
    texture.textContent = item.texture;
    const action = document.createElement("td");
    action.className = "cell-end";
    const button = document.createElement("button");
    button.className = "btn-sm";
    button.textContent = "Edit";
    button.addEventListener("click", () => editItems(index));
    action.appendChild(button);
    row.append(id, name, texture, action);
    return row;
  });
  tbody.replaceChildren(...rows);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  document.getElementById("page_info").textContent = `${page + 1} / ${pages} · ${filtered.length} items`;
  renderPageNumbers(pages);
  document.getElementById("page_prev").disabled = page === 0;
  document.getElementById("page_next").disabled = page >= pages - 1;
}

// Up to five page buttons around the current page; larger jumps use the page field
function renderPageNumbers(pages) {
  const first = Math.max(0, Math.min(page - 2, pages - 5));
  const buttons = [];
  for (let i = first; i < Math.min(first + 5, pages); i++) {
    const button = document.createElement("button");
    button.className = "btn-sm";
    button.textContent = i + 1;
    if (i === page) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => goToPage(i));
    buttons.push(button);
  }
  document.getElementById("page_numbers").replaceChildren(...buttons);
  document.getElementById("page_jump_wrap").hidden = pages <= 5;
  const jump = document.getElementById("page_jump");
  jump.max = pages;
  jump.value = page + 1;
}

function goToPage(target) {
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(Math.max(target, 0), pages - 1);
  renderTable();
}

function applySearch() {
  const query = search.value.trim().toLowerCase();
  filtered = [];
  const showSeeds = document.getElementById("show_seeds").checked;
  data_json.items.forEach((item, index) => {
    if (!showSeeds && Number(item.action_type) === 19) return;
    if (!query || String(item.item_id) === query || String(item.name).toLowerCase().includes(query)) filtered.push(index);
  });
  page = 0;
  renderTable();
}

window.onItemsDecoded = (data) => {
  const byId = new Map(data.items.map((item) => [Number(item.item_id), item]));
  ItemIcons.setLookup((id) => byId.get(id));
  document.getElementById("items_summary").textContent = `Version ${data.version} · ${data.item_count} items`;
  panel.hidden = false;
  search.value = "";
  applySearch();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.onItemEdited = () => {
  renderTable();
  GK.toast("Change applied. Download items.dat to save it to a file.");
};

search.addEventListener("input", applySearch);
document.getElementById("show_seeds").addEventListener("change", applySearch);
document.getElementById("page_prev").addEventListener("click", () => goToPage(page - 1));
document.getElementById("page_next").addEventListener("click", () => goToPage(page + 1));
document.getElementById("page_jump").addEventListener("change", (e) => goToPage(Number(e.target.value) - 1));
document.getElementById("close_edit").addEventListener("click", () => document.getElementById("modal-editItems").close());
document.getElementById("edit_form").addEventListener("submit", (e) => e.preventDefault());
document.getElementById("save_items").addEventListener("click", () => item_encoder(null, true));

GK.bindDrop(document.getElementById("edit_drop"), ([file]) => item_decoder(file, true));
GK.bindDrop(document.getElementById("decode_drop"), ([file]) => item_decoder(file));
GK.bindDrop(document.getElementById("encode_drop"), ([file]) => item_encoder(file));
