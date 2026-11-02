// Draws text with a game RTFONT: glyph positions from the file, colours from its format table.
const GameFont = {
  async load(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} was not found.`);
    const bytes = RT.unpack(new Uint8Array(await response.arrayBuffer()));
    if (RT.magic(bytes) !== "RTFONT") throw new Error("Not a valid RTFONT file.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lineHeight = view.getUint16(10, true);
    const first = view.getUint16(18, true);
    const last = view.getUint16(20, true);
    const blank = view.getUint16(22, true);
    const stateCount = view.getUint16(24, true);
    const kerningCount = view.getUint16(26, true);
    let pos = 152;
    const glyphs = new Map();
    for (let code = first; code < last; code++) {
      glyphs.set(code, { x: view.getUint16(pos, true), y: view.getUint16(pos + 2, true), w: view.getUint16(pos + 4, true), h: view.getUint16(pos + 6, true),
        ox: view.getInt16(pos + 8, true), oy: view.getInt16(pos + 10, true), adv: view.getUint16(pos + 28, true) });
      pos += 32;
    }
    pos += kerningCount * 6;
    const colors = {};
    for (let i = 0; i < stateCount; i++) {
      colors[String.fromCharCode(bytes[pos + 4])] = `rgb(${bytes[pos + 1]},${bytes[pos + 2]},${bytes[pos + 3]})`;
      pos += 8;
    }
    const atlas = RT.textureToCanvas(RT.decodeTexture(RT.unpack(bytes.subarray(pos))));
    const tints = new Map();
    const tinted = (color) => {
      if (!color) return atlas;
      if (!tints.has(color)) {
        const layer = document.createElement("canvas");
        layer.width = atlas.width;
        layer.height = atlas.height;
        const g = layer.getContext("2d");
        g.drawImage(atlas, 0, 0);
        g.globalCompositeOperation = "multiply";
        g.fillStyle = color;
        g.fillRect(0, 0, layer.width, layer.height);
        g.globalCompositeOperation = "destination-in";
        g.drawImage(atlas, 0, 0);
        tints.set(color, layer);
      }
      return tints.get(color);
    };
    const advance = (code) => (code === 32 ? blank : glyphs.get(code)?.adv ?? 0);

    return {
      lineHeight,
      // Word wraps text into lines of { code, color } and keeps colour codes across lines
      layout(text, scale, maxWidth, defaultCode = null) {
        const base = defaultCode && colors[defaultCode] ? colors[defaultCode] : null;
        let color = base;
        const lines = [];
        let line = { chars: [], width: 0 };
        const limit = maxWidth / scale;
        const source = [...text.replaceAll("<CR>", "\n").replaceAll("\\n", "\n")];
        let word = [];
        let wordWidth = 0;
        const flush = () => {
          if (line.width + wordWidth > limit && line.chars.length) {
            lines.push(line);
            line = { chars: [], width: 0 };
          }
          line.chars.push(...word);
          line.width += wordWidth;
          word = [];
          wordWidth = 0;
        };
        for (let i = 0; i < source.length; i++) {
          const ch = source[i];
          if (ch === "`" && i + 1 < source.length) {
            const code = source[++i];
            color = code === "`" ? base : colors[code] || color;
          } else if (ch === "\n") {
            flush();
            lines.push(line);
            line = { chars: [], width: 0 };
          } else {
            const code = ch.codePointAt(0);
            word.push({ code, color });
            wordWidth += advance(code);
            if (code === 32) flush();
          }
        }
        flush();
        lines.push(line);
        lines.forEach((l) => { l.width *= scale; });
        return lines;
      },
      drawLine(ctx, line, x, y, scale) {
        ctx.imageSmoothingEnabled = true;
        let at = 0;
        for (const { code, color } of line.chars) {
          const g = glyphs.get(code);
          if (g && code !== 32 && g.w && g.h) {
            ctx.drawImage(tinted(color), g.x, g.y, g.w, g.h, x + (at + g.ox) * scale, y + g.oy * scale, g.w * scale, g.h * scale);
          }
          at += advance(code);
        }
      },
    };
  },
};
