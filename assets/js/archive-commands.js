// Commands from assets/data/gtarchive/commands.json, built by tools/build-archive.py from the spreadsheet.
const listBox = document.getElementById("commands_list");
const searchBox = document.getElementById("commands_search");
const groupBox = document.getElementById("commands_group");
let groups = [];

function commandRow(command) {
  const row = document.createElement("article");
  row.className = "command-row";
  const name = document.createElement("code");
  name.textContent = command.name;
  row.append(name);
  for (const [text, className] of [[command.info, "command-info"], [command.usage && `Usage: ${command.usage}`, "command-usage"], [command.extra, "command-extra"]]) {
    if (!text) continue;
    const line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    row.append(line);
  }
  return row;
}

function render() {
  const query = searchBox.value.trim().toLowerCase();
  const sections = groups.filter((group) => !groupBox.value || group.name === groupBox.value).map((group) => {
    const commands = group.commands.filter((c) => !query || `${c.name} ${c.info} ${c.usage} ${c.extra}`.toLowerCase().includes(query));
    if (!commands.length) return null;
    const section = document.createElement("section");
    const title = document.createElement("h2");
    title.textContent = `${group.name.replace(" Commands", "")} (${commands.length})`;
    section.append(title, ...commands.map(commandRow));
    return section;
  }).filter(Boolean);
  listBox.replaceChildren(...sections);
  if (!sections.length) listBox.textContent = "No commands match.";
}

[searchBox, groupBox].forEach((box) => box.addEventListener("input", render));

(async () => {
  const info = document.getElementById("commands_info");
  try {
    groups = await fetch("../assets/data/gtarchive/commands.json").then((r) => r.json());
    groupBox.append(...groups.map((group) => new Option(group.name.replace(" Commands", ""), group.name)));
    info.textContent = `${groups.reduce((sum, group) => sum + group.commands.length, 0)} commands in ${groups.length} groups. List by Caferius.`;
    render();
  } catch (error) {
    info.textContent = `The commands could not be loaded: ${error.message}`;
  }
})();
