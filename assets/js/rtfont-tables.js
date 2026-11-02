// Table views for the RTFONT editor. The textareas stay the source of truth: every table edit writes back to them.
const FontTables = (() => {
  const CHAR_COLUMNS = [["@_x", "X"], ["@_y", "Y"], ["@_width", "W"], ["@_height", "H"], ["@_xoffset", "X off"], ["@_yoffset", "Y off"], ["@_xadvance", "Advance"]];
  const txtSource = document.getElementById("txt_file");
  const fntSource = document.getElementById("fnt_file");
  const txtTable = document.getElementById("txt_table");
  const fntTable = document.getElementById("fnt_table");
  const fontImage = document.getElementById("image_rtfont");
  const marker = document.getElementById("glyph_marker");
  const views = { txt: "source", fnt: "source" };
  let fontData = null;
  let previews = [];

  const toHex = (v) => Number(v || 0).toString(16).padStart(2, "0");

  function numberInput(value, label, onInput) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  function cell(...children) {
    const td = document.createElement("td");
    td.append(...children);
    return td;
  }

  function buildTable(headers, rows) {
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    for (const text of headers) {
      const th = document.createElement("th");
      th.textContent = text;
      head.appendChild(th);
    }
    table.createTBody().append(...rows);
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.appendChild(table);
    return wrap;
  }

  // TXT ---------------------------------------------------------------
  function parseTxt() {
    const lines = txtSource.value.split(/\r?\n/).filter((l) => l !== "");
    const blank = lines.find((l) => l.startsWith("blank_space_width|"));
    const colors = lines
      .filter((l) => l.startsWith("add_format_color|"))
      .map((l) => {
        const parts = l.split("|");
        const [r, g, b] = (parts[2] || "").split(",");
        return { code: parts[1] || "", r, g, b };
      });
    return {
      other: lines.filter((l) => !l.startsWith("blank_space_width|") && !l.startsWith("add_format_color|")),
      blank: blank ? blank.split("|")[1] : "0",
      colors,
    };
  }

  function writeTxt(data) {
    txtSource.value =
      [...data.other, `blank_space_width|${data.blank}`, ...data.colors.map((c) => `add_format_color|${c.code}|${c.r},${c.g},${c.b}|`)].join("\n") + "\n";
    FontTest.render();
  }

  function renderTxt() {
    const data = parseTxt();
    const blankField = document.createElement("label");
    blankField.className = "field blank-field";
    blankField.innerHTML = "<span>Blank space width</span>";
    blankField.appendChild(numberInput(data.blank, "Blank space width", (v) => { data.blank = v; writeTxt(data); }));

    const rows = data.colors.map((color, index) => {
      const row = document.createElement("tr");
      const code = document.createElement("input");
      code.value = color.code;
      code.maxLength = 1;
      code.setAttribute("aria-label", "Color code");
      code.addEventListener("input", () => { color.code = code.value; writeTxt(data); });
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
      picker.setAttribute("aria-label", "Color");
      picker.addEventListener("input", () => {
        ["r", "g", "b"].forEach((key, i) => {
          color[key] = parseInt(picker.value.slice(1 + i * 2, 3 + i * 2), 16);
        });
        writeTxt(data);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-sm";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        data.colors.splice(index, 1);
        writeTxt(data);
        renderTxt();
      });
      const end = cell(remove);
      end.className = "cell-end";
      row.append(cell(code), cell(picker), end);
      return row;
    });

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Add Color";
    add.addEventListener("click", () => {
      data.colors.push({ code: "", r: 255, g: 255, b: 255 });
      writeTxt(data);
      renderTxt();
    });
    txtTable.replaceChildren(blankField, buildTable(["Code", "Color", ""], rows), add);
  }

  // FNT ---------------------------------------------------------------
  function writeFnt() {
    fntSource.value = new XMLBuilder(RT.XML_OPTIONS).build(fontData);
    FontTest.render();
  }

  function drawPreview({ canvas, char }) {
    const width = Number(char["@_width"]) || 0;
    const height = Number(char["@_height"]) || 0;
    canvas.width = Math.max(width, 1);
    canvas.height = Math.max(height, 1);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (width && height && fontImage.width) ctx.drawImage(fontImage, Number(char["@_x"]) || 0, Number(char["@_y"]) || 0, width, height, 0, 0, width, height);
  }

  // Red frame on the full image for the row being looked at
  function showMarker(char) {
    marker.hidden = false;
    marker.style.left = `${Number(char["@_x"]) || 0}px`;
    marker.style.top = `${Number(char["@_y"]) || 0}px`;
    marker.style.width = `${Number(char["@_width"]) || 0}px`;
    marker.style.height = `${Number(char["@_height"]) || 0}px`;
  }

  function renderFnt() {
    fontData = new XMLParser(RT.XML_OPTIONS).parse(fntSource.value);
    if (!fontData.font || !fontData.font.chars) throw new Error("Could not read the FNT content.");
    const raw = fontData.font.chars.char;
    const chars = raw === undefined || raw === "" ? [] : Array.isArray(raw) ? raw : [raw];
    previews = [];
    const rows = chars.map((char) => {
      const row = document.createElement("tr");
      const stage = document.createElement("div");
      stage.className = "checker glyph";
      const canvas = document.createElement("canvas");
      stage.appendChild(canvas);
      const preview = { canvas, char };
      previews.push(preview);
      drawPreview(preview);
      const id = Number(char["@_id"]);
      const label = cell(`${id > 32 ? String.fromCodePoint(id) + " " : ""}(${id})`);
      label.className = "glyph-id";
      const inputs = CHAR_COLUMNS.map(([key, title]) =>
        cell(numberInput(char[key], `${title} of character ${id}`, (v) => {
          char[key] = v;
          drawPreview(preview);
          showMarker(char);
          writeFnt();
        }))
      );
      row.append(cell(stage), label, ...inputs);
      row.addEventListener("mouseenter", () => showMarker(char));
      row.addEventListener("focusin", () => showMarker(char));
      row.addEventListener("mouseleave", () => { if (!row.contains(document.activeElement)) marker.hidden = true; });
      return row;
    });
    fntTable.replaceChildren(buildTable(["Texture", "Char", ...CHAR_COLUMNS.map((c) => c[1])], rows));
  }

  // Source / Table switch ----------------------------------------------
  function setView(section, mode) {
    const kind = section.dataset.editor;
    const source = kind === "txt" ? txtSource : fntSource;
    const table = kind === "txt" ? txtTable : fntTable;
    if (mode === "table") {
      try {
        (kind === "txt" ? renderTxt : renderFnt)();
      } catch (error) {
        GK.toast(`Fix the source first: ${error.message}`, "error");
        return;
      }
    }
    views[kind] = mode;
    source.hidden = mode === "table";
    table.hidden = mode !== "table";
    section.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  }

  const sections = document.querySelectorAll(".font-section");
  sections.forEach((section) => {
    section.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setView(section, button.dataset.mode)));
  });

  return {
    drawPreviews() {
      if (views.fnt === "table") previews.forEach(drawPreview);
      FontTest.render();
    },
    reset() {
      sections.forEach((section) => setView(section, "source"));
    },
  };
})();
