// RTPACK / RTTEX / RTFONT binary formats. Layout taken from GrowTools rtconverter.js and the daydun RTTEX tool.
const RT = {
  HEADER_SIZE: 0x7c,

  magic(bytes, length = 6) {
    return String.fromCharCode(...bytes.subarray(0, length));
  },

  unpack(bytes) {
    if (bytes.length >= 32 && this.magic(bytes) === "RTPACK") return pako.inflate(bytes.subarray(32));
    return bytes;
  },

  pack(bytes) {
    const deflated = pako.deflate(bytes);
    const out = new Uint8Array(32 + deflated.length);
    out.set([0x52, 0x54, 0x50, 0x41, 0x43, 0x4b]);
    const view = new DataView(out.buffer);
    view.setUint32(8, deflated.length, true);
    view.setUint32(12, bytes.length, true);
    out[16] = 1;
    out.set(deflated, 32);
    return out;
  },

  // Turns unpacked RTTXTR data into plain RGBA pixels, top row first.
  decodeTexture(bytes) {
    if (bytes.length < this.HEADER_SIZE || this.magic(bytes) !== "RTTXTR") throw new Error("Not a valid RTTEX file.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const height = view.getInt32(8, true);
    const width = view.getInt32(12, true);
    const originalHeight = view.getInt32(20, true);
    const originalWidth = view.getInt32(24, true);
    const hasAlpha = bytes[0x1c] !== 0;
    const channels = hasAlpha ? 4 : 3;
    if (width <= 0 || height <= 0 || bytes.length < this.HEADER_SIZE + width * height * channels) {
      throw new Error("RTTEX data is incomplete or in an unsupported format.");
    }
    const rgba = new Uint8ClampedArray(width * height * 4);
    let src = this.HEADER_SIZE;
    for (let y = height - 1; y >= 0; y--) {
      let dst = y * width * 4;
      for (let x = 0; x < width; x++) {
        rgba[dst++] = bytes[src++];
        rgba[dst++] = bytes[src++];
        rgba[dst++] = bytes[src++];
        rgba[dst++] = hasAlpha ? bytes[src++] : 255;
      }
    }
    return { width, height, originalWidth, originalHeight, hasAlpha, rgba };
  },

  // Builds uncompressed RTTXTR from anything a canvas can draw.
  encodeTexture(image, width = image.width, height = image.height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.scale(1, -1);
    ctx.drawImage(image, 0, -height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const out = new Uint8Array(this.HEADER_SIZE + pixels.length);
    out.set([0x52, 0x54, 0x54, 0x58, 0x54, 0x52]);
    const view = new DataView(out.buffer);
    view.setUint32(8, height, true);
    view.setUint32(12, width, true);
    view.setUint32(16, 5121, true);
    view.setUint32(20, height, true);
    view.setUint32(24, width, true);
    out[28] = 1;
    view.setUint32(32, 1, true);
    view.setUint32(100, height, true);
    view.setUint32(104, width, true);
    view.setUint32(108, pixels.length, true);
    out.set(pixels, this.HEADER_SIZE);
    return out;
  },

  textureToCanvas(texture) {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.getContext("2d").putImageData(new ImageData(texture.rgba, texture.width, texture.height), 0, 0);
    return canvas;
  },

  canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  },

  loadImage(source) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(source instanceof Blob ? source : new Blob([source]));
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read the image."));
      };
      img.src = url;
    });
  },

  XML_OPTIONS: { format: true, ignoreAttributes: false },

  // RTFONT -> { txt, fnt, canvas }
  decodeFont(bytes, imageName = "rtfont.png") {
    if (this.magic(bytes) !== "RTFONT") throw new Error("Not a valid RTFONT file.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lineHeight = view.getUint16(10, true);
    let pos = 18;
    const firstChar = view.getUint16(pos, true);
    const lastChar = view.getUint16(pos + 2, true);
    const blankWidth = view.getUint16(pos + 4, true);
    const stateCount = view.getUint16(pos + 6, true);
    const kerningCount = view.getUint16(pos + 8, true);
    pos += 10 + 124;

    const chars = [];
    for (let i = 0; i < lastChar - firstChar; i++) {
      chars.push({
        "@_id": firstChar + i,
        "@_x": view.getUint16(pos, true),
        "@_y": view.getUint16(pos + 2, true),
        "@_width": view.getUint16(pos + 4, true),
        "@_height": view.getUint16(pos + 6, true),
        "@_xoffset": view.getInt16(pos + 8, true),
        "@_yoffset": view.getInt16(pos + 10, true),
        "@_xadvance": view.getUint16(pos + 28, true),
        "@_rtbase": view.getUint16(pos + 30, true), // purpose unknown, kept so fonts survive a round trip
        "@_page": 0,
        "@_chnl": 15,
      });
      pos += 32;
    }

    const kernings = [];
    for (let i = 0; i < kerningCount; i++) {
      kernings.push({
        "@_first": view.getInt16(pos, true),
        "@_second": view.getInt16(pos + 2, true),
        "@_amount": view.getInt8(pos + 4),
      });
      pos += 6;
    }

    let txt = `image|${imageName}\nfnt_file|rtfont.fnt\nblank_space_width|${blankWidth}\n`;
    for (let i = 0; i < stateCount; i++) {
      txt += `add_format_color|${String.fromCharCode(bytes[pos + 4])}|${bytes[pos + 1]},${bytes[pos + 2]},${bytes[pos + 3]}|\n`;
      pos += 8;
    }

    const fnt = new XMLBuilder(this.XML_OPTIONS).build({
      font: {
        common: { "@_lineHeight": lineHeight },
        chars: { "@_count": chars.length, char: chars },
        kernings: { "@_count": kernings.length, kerning: kernings },
      },
    });
    const texture = bytes.slice(pos);
    const canvas = this.textureToCanvas(this.decodeTexture(this.unpack(texture)));
    return { txt, fnt, canvas, texture };
  },

  // txt + fnt + ready RTTXTR/RTPACK texture -> RTFONT inside RTPACK
  encodeFont(txt, fnt, textureBytes) {
    const parsed = new XMLParser(this.XML_OPTIONS).parse(fnt);
    if (!parsed.font || !parsed.font.common || !parsed.font.chars) throw new Error("Could not read the FNT content.");
    const asList = (v) => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);
    const chars = asList(parsed.font.chars.char);
    const kernings = parsed.font.kernings ? asList(parsed.font.kernings.kerning) : [];
    const lines = txt.split(/\r?\n/);
    const blankLine = lines.find((l) => l.startsWith("blank_space_width|"));
    if (!blankLine) throw new Error("TXT has no blank_space_width line.");
    const states = lines.filter((l) => l.startsWith("add_format_color|")).map((l) => l.split("|"));

    const headerSize = 18 + 10 + 124;
    const size = headerSize + chars.length * 32 + kernings.length * 6 + states.length * 8 + textureBytes.length;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    out.set([0x52, 0x54, 0x46, 0x4f, 0x4e, 0x54]);
    const lineHeight = Number(parsed.font.common["@_lineHeight"]);
    view.setUint16(10, lineHeight, true);
    view.setUint16(12, lineHeight, true);
    view.setUint16(18, 32, true);
    view.setUint16(20, 32 + chars.length, true);
    view.setUint16(22, Number(blankLine.split("|")[1]), true);
    view.setUint16(24, states.length, true);
    view.setUint16(26, kernings.length, true);

    let pos = headerSize;
    for (const c of chars) {
      view.setUint16(pos, Number(c["@_x"]), true);
      view.setUint16(pos + 2, Number(c["@_y"]), true);
      view.setUint16(pos + 4, Number(c["@_width"]), true);
      view.setUint16(pos + 6, Number(c["@_height"]), true);
      view.setInt16(pos + 8, Number(c["@_xoffset"]), true);
      view.setInt16(pos + 10, Number(c["@_yoffset"]), true);
      view.setUint16(pos + 28, Number(c["@_xadvance"]), true);
      view.setUint16(pos + 30, Number(c["@_rtbase"]) || 0, true);
      pos += 32;
    }
    for (const k of kernings) {
      view.setInt16(pos, Number(k["@_first"]), true);
      view.setInt16(pos + 2, Number(k["@_second"]), true);
      view.setInt8(pos + 4, Number(k["@_amount"]));
      pos += 6;
    }
    for (const s of states) {
      const [r, g, b] = s[2].split(",").map(Number);
      out.set([0, r, g, b, s[1].charCodeAt(0)], pos);
      pos += 8;
    }
    out.set(textureBytes, pos);
    return this.pack(out);
  },
};
