// player_tribute.dat: four records, each a little-endian u16 length followed by Latin-1 text.
// Titles and descriptions come from the game client's Player Tribute screen.
const SECTIONS = [
  { title: "Epic Players", about: "All epic quests completed and item sponsored." },
  { title: "Exceptional Mentors", about: "2,000 apprentices level 20 mentored." },
  { title: "Charity Champions", about: "Grow4Good Top Donors" },
  { title: "Grow Pass Leaders", about: "Top 3 players on the Grow Pass leaderboard" },
];

const editor = document.getElementById("tribute_editor");
const hashOutput = document.getElementById("tribute_hash");
let fileName = "player_tribute";

function parseTribute(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = [];
  let pos = 0;
  while (pos < bytes.length) {
    if (pos + 2 > bytes.length) throw new Error("The file ends in the middle of a record.");
    const length = view.getUint16(pos, true);
    pos += 2;
    if (pos + length > bytes.length) throw new Error("A record is longer than the file.");
    records.push(new TextDecoder("latin1").decode(bytes.subarray(pos, pos + length)));
    pos += length;
  }
  if (records.length !== SECTIONS.length) throw new Error(`Expected ${SECTIONS.length} sections, found ${records.length}.`);
  return records;
}

function buildTribute(records) {
  const size = records.reduce((sum, text) => sum + 2 + text.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let pos = 0;
  records.forEach((text, index) => {
    if (text.length > 65535) throw new Error(`${SECTIONS[index].title} is too long (65,535 characters at most).`);
    view.setUint16(pos, text.length, true);
    pos += 2;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 255) throw new Error(`${SECTIONS[index].title} has a character the file can't store: ${text[i]}`);
      bytes[pos++] = code;
    }
  });
  return bytes;
}

editor.innerHTML = SECTIONS.map(
  (s, i) => `<section class="font-section">
    <h3>${s.title}</h3><p class="section-about">${s.about}</p>
    <div class="split"><textarea id="tribute_${i}" rows="10" spellcheck="false" aria-label="${s.title} source"></textarea>
    <div class="tribute-preview" id="tribute_preview_${i}"></div></div></section>`
).join("");

const fields = SECTIONS.map((_, i) => document.getElementById(`tribute_${i}`));
const previews = SECTIONS.map((_, i) => document.getElementById(`tribute_preview_${i}`));
fields.forEach((field, i) => field.addEventListener("input", () => GameText.render(previews[i], field.value)));

function load(records, name) {
  fileName = GK.baseName(name);
  records.forEach((text, i) => {
    fields[i].value = text;
    GameText.render(previews[i], text);
  });
  hashOutput.textContent = "";
  document.getElementById("tribute_panel").hidden = false;
}

GK.bindDrop(document.getElementById("tribute_drop"), async ([file]) => {
  try {
    if (file.name.toLowerCase().endsWith(".json")) {
      const data = JSON.parse(await file.text());
      load(SECTIONS.map((s) => {
        if (typeof data[s.title] !== "string") throw new Error(`The JSON has no "${s.title}" text.`);
        return data[s.title];
      }), file.name);
    } else {
      load(parseTribute(await file.arrayBuffer()), file.name);
    }
  } catch (error) {
    GK.toast(`${file.name}: ${error.message}`, "error");
  }
});

document.getElementById("save_tribute").addEventListener("click", () => {
  try {
    const bytes = buildTribute(fields.map((f) => f.value));
    GK.download(bytes, `${fileName}.dat`);
    hashOutput.textContent = `${fileName}.dat · hash ${GK.protonHash(bytes)}`;
  } catch (error) {
    GK.toast(error.message, "error");
  }
});

document.getElementById("export_tribute").addEventListener("click", () => {
  const data = Object.fromEntries(SECTIONS.map((s, i) => [s.title, fields[i].value]));
  GK.download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${fileName}.json`);
});
