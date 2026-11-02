const results = [];
const list = document.getElementById("results");
const empty = document.getElementById("empty");
const zipButton = document.getElementById("download_zip");
const clearButton = document.getElementById("clear_results");
const selectButton = document.getElementById("select_mode");
const removeButton = document.getElementById("remove_selected");
let selecting = false;

function refreshToolbar() {
  const has = results.length > 0;
  empty.hidden = has;
  if (!has) selecting = false;
  const selected = results.filter((r) => r.selected).length;
  clearButton.disabled = !has;
  selectButton.disabled = !has;
  selectButton.hidden = selecting;
  removeButton.hidden = !selecting;
  zipButton.hidden = !selecting;
  removeButton.disabled = false;
  zipButton.disabled = selected === 0;
  zipButton.classList.toggle("btn-zip", selected > 1);
  zipButton.textContent = selected > 1 ? `Download Selected as ZIP (${selected})` : "Download Selected";
  list.classList.toggle("is-selecting", selecting);
  document.getElementById("result_count").textContent = has ? `(${results.length})` : "";
}

function addResult(file, texture) {
  // Textures are padded to a power of two in the file; only the real image is kept
  const full = RT.textureToCanvas(texture);
  const canvas = document.createElement("canvas");
  canvas.width = texture.originalWidth || texture.width;
  canvas.height = texture.originalHeight || texture.height;
  canvas.getContext("2d").drawImage(full, 0, 0);
  canvas.style.width = `calc(${canvas.width}px * var(--tex-scale))`;
  const name = GK.baseName(file.name) + ".png";
  const card = document.createElement("article");
  card.className = "tex-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Download ${name}`);
  card.title = name;
  const stage = document.createElement("div");
  stage.className = "checker tex-stage";
  stage.appendChild(canvas);
  const title = document.createElement("h3");
  title.textContent = name;
  const meta = document.createElement("p");
  meta.textContent = `${canvas.width}×${canvas.height} · ${texture.hasAlpha ? "RGBA" : "RGB"} · ${GK.formatSize(file.size)}`;
  card.append(stage, title, meta);
  const result = { name, canvas, card, selected: false };
  const save = async () => {
    if (selecting) {
      result.selected = !result.selected;
      card.classList.toggle("is-selected", result.selected);
      card.setAttribute("aria-pressed", result.selected);
      refreshToolbar();
    } else {
      GK.download(await RT.canvasToBlob(canvas), name);
    }
  };
  card.addEventListener("click", save);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      save();
    }
  });
  list.appendChild(card);
  results.push(result);
}

GK.bindDrop(document.getElementById("rttex_drop"), async (files) => {
  for (const file of files) {
    try {
      addResult(file, RT.decodeTexture(RT.unpack(new Uint8Array(await file.arrayBuffer()))));
    } catch (error) {
      GK.toast(`${file.name}: ${error.message}`, "error");
    }
  }
  refreshToolbar();
});

zipButton.addEventListener("click", async () => {
  const chosen = results.filter((r) => r.selected);
  if (chosen.length === 1) {
    GK.download(await RT.canvasToBlob(chosen[0].canvas), chosen[0].name);
    setSelecting(false);
    return;
  }
  const zip = new JSZip();
  const used = new Set();
  for (const { name, canvas } of chosen) {
    let unique = name;
    for (let n = 2; used.has(unique); n++) unique = `${GK.baseName(name)}-${n}.png`;
    used.add(unique);
    zip.file(unique, await RT.canvasToBlob(canvas));
  }
  GK.download(await zip.generateAsync({ type: "blob" }), "growkit-png.zip");
  setSelecting(false);
});

function setSelecting(on) {
  selecting = on;
  for (const r of results) {
    r.selected = false;
    r.card.classList.remove("is-selected");
    if (on) r.card.setAttribute("aria-pressed", "false");
    else r.card.removeAttribute("aria-pressed");
    r.card.setAttribute("aria-label", on ? `Select ${r.name}` : `Download ${r.name}`);
  }
  refreshToolbar();
}

selectButton.addEventListener("click", () => setSelecting(true));

removeButton.addEventListener("click", () => setSelecting(false));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selecting) setSelecting(false);
});

clearButton.addEventListener("click", () => {
  results.length = 0;
  list.replaceChildren();
  refreshToolbar();
});

GK.bindDrop(document.getElementById("image_drop"), async (files) => {
  const encoded = document.getElementById("encoded_list");
  for (const file of files) {
    try {
      const packed = RT.pack(RT.encodeTexture(await RT.loadImage(file)));
      const name = GK.baseName(file.name) + ".rttex";
      GK.download(packed, name);
      const row = document.createElement("li");
      row.textContent = `${name} · hash ${GK.protonHash(packed)}`;
      encoded.appendChild(row);
    } catch (error) {
      GK.toast(`${file.name}: ${error.message}`, "error");
    }
  }
});

// Quick Look promo: stays closed once dismissed
const promo = document.getElementById("promo_toast");
let promoClosed = false;
try {
  promoClosed = localStorage.getItem("growkit-promo-quicklook") === "closed";
} catch {}
promo.hidden = promoClosed;
document.getElementById("promo_close").addEventListener("click", () => {
  promo.classList.add("is-closing");
  promo.addEventListener("animationend", () => { promo.hidden = true; }, { once: true });
  if (!promo.getAnimations().length) promo.hidden = true; // reduced motion has no animation to end
  try {
    localStorage.setItem("growkit-promo-quicklook", "closed");
  } catch {}
});

const sizeSlider = document.getElementById("tex_size");
function applyTextureSize() {
  list.style.setProperty("--tex-scale", sizeSlider.value / 100);
  document.getElementById("tex_size_value").textContent = `${sizeSlider.value}%`;
}
sizeSlider.addEventListener("input", applyTextureSize);
applyTextureSize();
