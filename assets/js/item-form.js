// Item edit form. The inputs named by field id are what items-codec.js reads and writes;
// lists, checkboxes and colour bars only sync with them. Values come from ITEMS_DAT_NOTES.md.
const list = (entries) => Object.fromEntries(entries.map(([value, label]) => [value, label]));
const ENUMS = {
  action_type: Object.fromEntries(ACTION_TYPES.map((name, value) => [value, name])),
  hit_sound_type: list([[0, "Wood"], [1, "Glass"], [2, "Rock"], [3, "Metal"]]),
  item_kind: list(["None", "Flame Lick", "Smoking", "Glow Tint", "Animated", "Bubbles", "Pet", "Pet Animated", "No Arms", "Wavey", "Wavey Animated", "Both Arms", "Low Hair", "Under Face", "Skin Tint", "Mask", "Animated Mask", "Low Hair Mask", "Ghost", "Pulse", "Colorize", "Colorize To Shirt", "Colorize Animated", "High Face", "High Face Animated", "Rainbow Shift", "Back and Front", "Colorize With Skin", "No Render", "Spin", "Off Hand", "Winged", "Sink", "Darkness", "Light Source", "Light If On", "Discolor", "Step Spin", "Pet Colored", "Silk Foot", "Tilty", "Tilty Dark", "Next Frame If On", "Wobble", "Scroll", "Light Source Pulse", "Bubble Machine", "Very Low Hair", "Very Low Hair Mask"].map((label, value) => [value, label])),
  spread_type: list(["Single Frame (Alone)", "Single Frame", "Smart Edge", "Smart Edge Horizontal", "Smart Cling", "Smart Edge Outer", "Random", "Smart Edge Vertical", "Smart Edge Horizontal Cave", "Smart Cling 2", "Smart Edge Diagonal"].map((label, value) => [value, label])),
  collision_type: list(["None", "Solid", "Jump Through", "Gateway", "If Off", "One Way", "VIP", "Jump Down", "Adventure", "If On", "Faction", "Guild", "Cloud", "Friends Entrance"].map((label, value) => [value, label])),
  clothing_type: list([[0, "Hat"], [1, "Shirt"], [2, "Pants"], [3, "Shoes"], [4, "Face"], [5, "Hand"], [6, "Back"], [7, "Hair"], [8, "Chest"]]),
};
const FLAGS = {
  editable_type: ["Flippable", "Editable", "Seedless", "Permanent", "Dropless", "No Self", "No Shadow", "World Locked"],
  item_category: ["Beta", "Auto Pickup", "Mod", "Random Grow", "Public", "Foreground", "Holiday", "Untradeable"],
  val2: ["Multi Anim", "Ping Pong Anim", "Overlay Object", "Offset Up", "Dual Layer", "Multi Anim 2", "Ping Pong Anim 2", "Use Skin Tint", "Seed Tint Layer 1", "Seed Tint Layer 2", "Rainbow Tint Layer 1", "Rainbow Tint Layer 2", "Glow", "No Arms", "Front Arm Punch", "Render Off Hand"],
  is_rayman: ["Slow Fall Object", "Replacement Sprite", "Orb Float", "Cape Foreground", "Variant Version"],
};
const FIELD_LABELS = {
  name: "Name", action_type: "Item Type", rarity: "Rarity", max_amount: "Max Stack",
  editable_type: "Item Flags", item_category: "Category Flags",
  texture: "Texture", texture_x: "Texture X", texture_y: "Texture Y", spread_type: "Tile Storage", item_kind: "Visual Effect",
  extra_file: "Extra File", audio_volume: "Animation (ms)",
  hit_sound_type: "Material", collision_type: "Collision", break_hits: "HP", drop_chance: "Healing Time (seconds)",
  clothing_type: "Body Part", val1: "Cook Time (seconds)",
  seed_base: "Seed Base Frame", seed_overlay: "Seed Overlay Frame", seed_color: "Seed Color", seed_overlay_color: "Pattern Color",
  tree_base: "Tree Base Frame", tree_leaves: "Tree Overlay Frame", grow_time: "Seconds To Bloom", ingredient1: "Ingredient 1", ingredient2: "Ingredient 2",
  pet_name: "Pet Name", pet_prefix: "Pet Prefix", pet_suffix: "Pet Suffix", pet_ability: "Pet Ability",
  item_id: "Item ID", texture_hash: "Texture Hash", is_stripey_wallpaper: "Layer", extra_file_hash: "Extra File Hash",
  val2: "Render Flags", is_rayman: "Render Flags 2", extra_options: "Animation Frames", texture2: "Secondary Texture", extra_options2: "Animation Frames 2",
  pos_80_data: "Layer 2, Flags, Client Data (raw)", punch_options: "Custom Punch Info", data_version_12: "Extra Slots (raw)", int_version_13: "Light Range", int_version_14: "Original Item ID",
  data_version_15: "Chair Info (raw)", str_version_15: "Chair Arm Sprite", str_version_16: "Config File", int_version_17: "v17", int_version_18: "Config File Hash",
  int_version_19: "Random Sprite (raw)", int_version_21: "Hide Parts / Transform", str_version_22: "Description", int_version_24: "v24", str_version_25: "v25 String",
  int_version_25: "v25", int_version_26: "v26", str_version_27: "v27 String",
};
// eItemInfoFlags2: a little-endian u32 at byte 8 of the 80-byte block
const SPECIAL_FLAGS = ["Robot Deadly", "Robot Shoot Left", "Robot Shoot Right", "Robot Shoot Down", "Robot Shoot Up", "Robot Can Shoot", "Robot Lava", "Robot Pointy", "Robot Shoot Deadly", "Guild Item", "Guild Flag", "Starship Helm", "Starship Reactor", "Starship Viewscreen", "Super Mod", "Deadly If On", "Long Hand Item", "Gemless", "Clothes Transmutable", "Illegal", "Illegal Inventory Float", "Illegal World", "Unused", "One In World", "Only For World Owner", "No Upgrade", "Extinguish Fire", "Extinguish Fire No Damage", "Need Reception Desk", "Use Paint"];
const DATA_KEYS = { pos_80_data: "data_position_80" };
const PREVIEW_FIELDS = ["action_type", "texture", "texture_x", "texture_y", "spread_type", "item_kind", "clothing_type", "seed_base", "seed_overlay", "seed_color", "seed_overlay_color", "item_category", "name"];

const ItemForm = (() => {
  const root = document.getElementById("edit_fields");
  const controls = {};
  const wrappers = {};
  let current = null;

  const SECTIONS = ["Basics", "Flags", "Clothing", "Seed", "Food", "Pet", "Block", "Texture", "Render"];
  const groups = {};
  for (const title of SECTIONS) {
    const section = document.createElement("section");
    section.className = "edit-section";
    section.innerHTML = `<h3>${title}</h3><div class="field-grid"></div>`;
    root.appendChild(section);
    groups[title] = section;
  }
  const advanced = document.createElement("details");
  advanced.className = "edit-section edit-advanced";
  advanced.innerHTML = '<summary><h3>Advanced</h3></summary><div class="field-grid"></div>';
  root.appendChild(advanced);

  const syncers = {};

  function enumField(id, input, wrapper) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", FIELD_LABELS[id]);
    wrapper.appendChild(select);
    select.addEventListener("change", () => { input.value = select.value; changed(id); });
    syncers[id] = () => {
      const options = { ...ENUMS[id] };
      if (input.value !== "" && !(input.value in options)) options[input.value] = `Unknown (${input.value})`;
      select.replaceChildren(...Object.entries(options).map(([value, label]) => new Option(id === "action_type" ? `${label} (${value})` : label, value)));
      select.value = input.value;
    };
  }

  function flagsField(id, input, wrapper) {
    const grid = document.createElement("div");
    grid.className = "flag-grid";
    const boxes = FLAGS[id].map((label, bit) => {
      const check = document.createElement("label");
      check.className = "flag-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        const value = Number(input.value) || 0;
        input.value = box.checked ? value | (1 << bit) : value & ~(1 << bit);
        changed(id);
      });
      check.append(box, label);
      grid.appendChild(check);
      return box;
    });
    wrapper.appendChild(grid);
    syncers[id] = () => boxes.forEach((box, bit) => { box.checked = Boolean((Number(input.value) >> bit) & 1); });
  }

  function colorField(id, input, wrapper) {
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "color-bar";
    picker.setAttribute("aria-label", FIELD_LABELS[id]);
    wrapper.appendChild(picker);
    picker.addEventListener("input", () => {
      const alpha = input.value.split(",")[0] || 255;
      const rgb = [1, 3, 5].map((i) => parseInt(picker.value.slice(i, i + 2), 16));
      input.value = [alpha, ...rgb].join(",");
      changed(id);
    });
    syncers[id] = () => {
      const [, ...rgb] = input.value.split(",").map(Number);
      picker.value = "#" + rgb.map((v) => (v || 0).toString(16).padStart(2, "0")).join("");
    };
  }

  for (const [id, label] of Object.entries(FIELD_LABELS)) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const title = document.createElement("label");
    title.textContent = label;
    title.htmlFor = id;
    const input = document.createElement("input");
    input.id = id;
    input.autocomplete = "off";
    input.spellcheck = false;
    wrapper.append(title, input);
    const friendly = ENUMS[id] || FLAGS[id] || id === "seed_color" || id === "seed_overlay_color";
    if (friendly) input.type = "hidden";
    if (ENUMS[id]) enumField(id, input, wrapper);
    if (FLAGS[id]) {
      flagsField(id, input, wrapper);
      wrapper.classList.add("field-wide");
    }
    if (id === "seed_color" || id === "seed_overlay_color") colorField(id, input, wrapper);
    if (!friendly) input.addEventListener("input", () => changed(id));
    if (id === "break_hits") input.title = "Add r for a raw value, for example 184r";
    controls[id] = input;
    wrappers[id] = wrapper;
  }

  const specialWrapper = document.createElement("div");
  specialWrapper.className = "field field-wide";
  specialWrapper.innerHTML = "<label>Special Flags</label>";
  const specialGrid = document.createElement("div");
  specialGrid.className = "flag-grid";
  specialWrapper.appendChild(specialGrid);
  const FLAG_BYTES = 8;
  const hexBytes = () => controls.pos_80_data.value.trim().split(/\s+/);
  const specialBoxes = SPECIAL_FLAGS.map((label, bit) => {
    const check = document.createElement("label");
    check.className = "flag-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      const bytes = hexBytes();
      const index = FLAG_BYTES + (bit >> 3);
      const mask = 1 << (bit & 7);
      const old = parseInt(bytes[index], 16) || 0;
      bytes[index] = (box.checked ? old | mask : old & ~mask).toString(16).toUpperCase().padStart(2, "0");
      controls.pos_80_data.value = bytes.join(" ");
    });
    check.append(box, label);
    specialGrid.appendChild(check);
    return box;
  });
  syncers.special_flags = () => {
    const bytes = hexBytes();
    const usable = bytes.length >= FLAG_BYTES + 4;
    specialWrapper.hidden = !usable;
    specialBoxes.forEach((box, bit) => {
      box.checked = usable && Boolean((parseInt(bytes[FLAG_BYTES + (bit >> 3)], 16) >> (bit & 7)) & 1);
    });
  };
  wrappers.special_flags = specialWrapper;

  // items-codec.js fills the inputs by id before open(), so they must always be in the document
  advanced.querySelector(".field-grid").append(...Object.values(wrappers));

  const value = (id) => controls[id].value;

  function placement() {
    const action = Number(value("action_type"));
    const place = {
      Basics: ["name", "action_type", "rarity", "max_amount", "str_version_22"],
      Flags: ["editable_type", "item_category", "special_flags"],
      Render: ["val2", "is_rayman"],
      Texture: ["texture", "texture_x", "texture_y", "spread_type", "item_kind", "extra_file", "audio_volume"],
    };
    if (action === 20) place.Clothing = ["clothing_type"];
    else if (action === 19) place.Seed = ["seed_base", "seed_overlay", "seed_color", "seed_overlay_color", "tree_base", "tree_leaves", "grow_time", "ingredient1", "ingredient2"];
    if (action !== 20) place.Block = ["hit_sound_type", "collision_type", "break_hits", "drop_chance"];
    if (action === 8 || Number(value("val1")) > 0) place.Food = ["val1"];
    if (value("pet_name") || value("pet_ability")) place.Pet = ["pet_name", "pet_prefix", "pet_suffix", "pet_ability"];
    return place;
  }

  function layout() {
    const place = placement();
    const used = new Set();
    for (const title of SECTIONS) {
      const fields = place[title] || [];
      groups[title].hidden = fields.length === 0;
      const grid = groups[title].querySelector(".field-grid");
      grid.replaceChildren(...fields.map((id) => wrappers[id]));
      fields.forEach((id) => used.add(id));
    }
    // Everything else stays reachable; fields this file version doesn't have are hidden
    const rest = Object.keys(FIELD_LABELS).filter((id) => !used.has(id));
    advanced.querySelector(".field-grid").replaceChildren(...rest.map((id) => wrappers[id]));
    for (const id of Object.keys(FIELD_LABELS)) {
      if (id in FLAGS && current && current[id] === undefined) groups.Render.hidden = true;
      wrappers[id].hidden = current && current[DATA_KEYS[id] || id] === undefined;
    }
  }

  function formItem() {
    const color = (id) => {
      const [a, r, g, b] = value(id).split(",");
      return { a, r, g, b };
    };
    return { ...current, name: value("name"), action_type: value("action_type"), texture: value("texture"), texture_x: value("texture_x"), texture_y: value("texture_y"),
      spread_type: value("spread_type"), item_kind: value("item_kind"), clothing_type: value("clothing_type"), item_category: value("item_category"),
      seed_base: value("seed_base"), seed_overlay: value("seed_overlay"), seed_color: color("seed_color"), seed_overlay_color: color("seed_overlay_color") };
  }

  function header() {
    document.getElementById("edit_name").textContent = value("name") || "Unnamed item";
    const type = ENUMS.action_type[value("action_type")] || `Unknown (${value("action_type")})`;
    document.getElementById("edit_meta").textContent = `ID ${value("item_id")} · ${type}`;
    ItemIcons.draw(document.getElementById("edit_icon"), formItem());
  }

  function changed(id) {
    if (id === "action_type") layout();
    if (id === "item_id" || PREVIEW_FIELDS.includes(id)) header();
  }

  return {
    open(index) {
      current = data_json.items[index];
      Object.values(syncers).forEach((sync) => sync());
      layout();
      advanced.open = false;
      header();
      root.scrollTop = 0;
    },
  };
})();

window.onItemEditOpened = (index) => ItemForm.open(index);
