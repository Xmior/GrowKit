// Draws the test text with the open font: glyphs from the image, metrics from FNT, colors from TXT.
const FontTest = (() => {
  const input = document.getElementById("test_input");
  const output = document.getElementById("test_canvas");
  const original = document.getElementById("test_original");
  const missing = document.getElementById("test_missing");
  const image = document.getElementById("image_rtfont");
  const txtSource = document.getElementById("txt_file");
  const fntSource = document.getElementById("fnt_file");
  const scratch = document.createElement("canvas");
  const boxToggle = document.getElementById("test_box");
  const boxImage = new Image();
  boxImage.src = "assets/img/gui_box.png";
  let pending = false;

  // Nine-slice: gui_box's centre is only columns and rows 9 to 21, the rest is border and shadow
  function drawBox(ctx, w, h) {
    const START = 9;
    const END = 22;
    const tail = boxImage.naturalWidth - END;
    const slices = (size) => [[0, START, 0, START], [START, END - START, START, size - START - tail], [END, tail, size - tail, tail]];
    ctx.imageSmoothingEnabled = false;
    for (const [sy, sh, dy, dh] of slices(h)) {
      for (const [sx, sw, dx, dw] of slices(w)) ctx.drawImage(boxImage, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }

  function readFont() {
    const font = new XMLParser(RT.XML_OPTIONS).parse(fntSource.value).font;
    const list = font.chars.char === undefined ? [] : [].concat(font.chars.char);
    const chars = new Map(list.map((c) => [Number(c["@_id"]), c]));
    const kerning = new Map();
    if (font.kernings && font.kernings.kerning) {
      for (const k of [].concat(font.kernings.kerning)) kerning.set(`${k["@_first"]}:${k["@_second"]}`, Number(k["@_amount"]));
    }
    const colors = new Map();
    let blank = null;
    for (const line of txtSource.value.split(/\r?\n/)) {
      const parts = line.split("|");
      if (parts[0] === "add_format_color") colors.set(parts[1], `rgb(${parts[2]})`);
      if (parts[0] === "blank_space_width") blank = Number(parts[1]);
    }
    return { chars, kerning, colors, blank, lineHeight: Number(font.common["@_lineHeight"]) || 16 };
  }

  // Splits text into positioned glyphs; ` + code changes the color, `` resets it.
  function layout(font, text) {
    const glyphs = [];
    const absent = new Set();
    let x = 0, y = 0, width = 1, color = null, previous = null;
    const codes = [...text];
    for (let i = 0; i < codes.length; i++) {
      const ch = codes[i];
      if (ch === "`" && i + 1 < codes.length) {
        const next = codes[++i];
        color = next === "`" ? null : font.colors.get(next) || color;
        continue;
      }
      if (ch === "\n") {
        x = 0;
        y += font.lineHeight;
        previous = null;
        continue;
      }
      const id = ch.codePointAt(0);
      const glyph = font.chars.get(id);
      if (id === 32 && font.blank !== null) {
        x += font.blank;
      } else if (glyph) {
        x += font.kerning.get(`${previous}:${id}`) || 0;
        glyphs.push({ glyph, x: x + Number(glyph["@_xoffset"]), y: y + Number(glyph["@_yoffset"]), color });
        x += Number(glyph["@_xadvance"]);
      } else {
        absent.add(ch);
      }
      previous = id;
      width = Math.max(width, x);
    }
    return { glyphs, absent, width, height: y + font.lineHeight };
  }

  function drawGlyph(ctx, { glyph, x, y, color }) {
    const w = Number(glyph["@_width"]);
    const h = Number(glyph["@_height"]);
    if (!w || !h) return;
    const sx = Number(glyph["@_x"]);
    const sy = Number(glyph["@_y"]);
    if (!color) {
      ctx.drawImage(image, sx, sy, w, h, x, y, w, h);
      return;
    }
    scratch.width = w;
    scratch.height = h;
    const tint = scratch.getContext("2d");
    tint.drawImage(image, sx, sy, w, h, 0, 0, w, h);
    tint.globalCompositeOperation = "multiply";
    tint.fillStyle = color;
    tint.fillRect(0, 0, w, h);
    tint.globalCompositeOperation = "destination-in";
    tint.drawImage(image, sx, sy, w, h, 0, 0, w, h);
    ctx.drawImage(scratch, x, y);
  }

  function draw() {
    pending = false;
    original.textContent = input.value;
    if (!image.width) return;
    try {
      const font = readFont();
      const { glyphs, absent, width, height } = layout(font, input.value);
      const boxed = boxToggle.checked && boxImage.complete && boxImage.naturalWidth;
      const pad = boxed ? 14 : 4;
      output.width = width + pad * 2;
      output.height = height + pad * 2;
      const ctx = output.getContext("2d");
      if (boxed) drawBox(ctx, output.width, output.height);
      ctx.translate(pad, pad);
      glyphs.forEach((g) => drawGlyph(ctx, g));
      missing.textContent = absent.size ? `Not in this font: ${[...absent].join(" ")}` : "";
    } catch {
      missing.textContent = "Fix the FNT source to see the text test.";
    }
  }

  function render() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  }

  [input, txtSource, fntSource].forEach((el) => el.addEventListener("input", render));
  boxToggle.addEventListener("change", render);
  boxImage.addEventListener("load", render);
  document.getElementById("test_save").addEventListener("click", () => {
    output.toBlob((blob) => GK.download(blob, "text_test.png"), "image/png");
  });
  return { render };
})();
