// Client list from assets/data/gtarchive/clients.json, built by tools/build-archive.py from the spreadsheet.
const head = document.getElementById("clients_head");
const body = document.getElementById("clients_rows");
const searchBox = document.getElementById("clients_search");
const platformBox = document.getElementById("clients_platform");
const statusBox = document.getElementById("clients_status");
const STATUS_NAMES = { found: "Found", lost: "Lost", unsure: "Might Exist", none: "Doesn't Exist", unknown: "Unknown" };
const NOT_ARCHIVED = new Set(["Steam (Win)", "UbiConnect (Win)"]);
let data = null;

function buildCell(build, name) {
  const cell = document.createElement("td");
  if (!build) return cell;
  cell.className = `client-cell is-${build.status}`;
  cell.title = STATUS_NAMES[build.status];
  if (name && NOT_ARCHIVED.has(name) && build.status !== "none") {
    cell.className = "client-cell is-outside";
    cell.title = "Not in archiving project";
  }
  if (build.text) {
    const text = document.createElement("span");
    text.textContent = build.link ? build.text.replace(build.link, "").trim() : build.text;
    cell.append(text);
  }
  if (build.link) {
    const source = document.createElement("a");
    source.href = build.link;
    source.rel = "noopener";
    source.textContent = "Source";
    cell.append(source);
  }
  for (const file of build.files || []) {
    const download = document.createElement("a");
    download.href = file.url;
    download.rel = "noopener";
    download.title = file.name;
    download.textContent = "Download";
    cell.append(download);
  }
  return cell;
}

function sideTable(table) {
  const section = document.createElement("section");
  section.className = "box";
  const title = document.createElement("h2");
  title.textContent = table.title;
  const wrap = document.createElement("div");
  wrap.className = "clients-scroll";
  const grid = document.createElement("table");
  grid.className = "clients-table";
  const top = grid.createTHead().insertRow();
  for (const name of ["Version", ...table.columns]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = name;
    top.append(th);
  }
  const rows = grid.createTBody();
  for (const row of table.rows) {
    const line = rows.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = row.name;
    line.append(name, ...row.builds.map((build) => buildCell(build)));
  }
  wrap.append(grid);
  section.append(title, wrap);
  return section;
}

function render() {
  const query = searchBox.value.trim().toLowerCase().replace(/^v/, "");
  const platforms = platformBox.value ? [platformBox.value] : data.platforms;
  const status = statusBox.value;
  const rows = data.rows.filter((row) => {
    if (query && !row.version.toLowerCase().replace(/^v/, "").includes(query)) return false;
    return !status || platforms.some((name) => row.builds[name]?.status === status);
  });
  const top = document.createElement("tr");
  for (const name of ["Version", ...platforms]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = name;
    top.append(th);
  }
  head.replaceChildren(top);
  body.replaceChildren(...rows.map((row) => {
    const line = document.createElement("tr");
    const version = document.createElement("th");
    version.scope = "row";
    version.textContent = row.version;
    line.append(version, ...platforms.map((name) => buildCell(row.builds[name], name)));
    return line;
  }));
  document.getElementById("clients_count").textContent = `${rows.length} of ${data.rows.length} versions`;
}

[searchBox, platformBox, statusBox].forEach((box) => box.addEventListener("input", render));

(async () => {
  const info = document.getElementById("clients_info");
  try {
    data = await fetch("../assets/data/gtarchive/clients.json").then((r) => r.json());
    platformBox.append(...data.platforms.map((name) => new Option(name)));
    const found = data.rows.reduce((sum, row) => sum + Object.values(row.builds).filter((b) => b.status === "found").length, 0);
    info.textContent = `${data.rows.length} versions and ${found} found builds. List by Caferius, last updated ${data.updated}.`;
    document.getElementById("side_tables").append(...data.sideTables.map(sideTable));
    render();
  } catch (error) {
    info.textContent = `The client list could not be loaded: ${error.message}`;
  }
})();
