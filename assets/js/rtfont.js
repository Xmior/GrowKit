const editor = document.getElementById("editor");
const txtField = document.getElementById("txt_file");
const fntField = document.getElementById("fnt_file");
const imageCanvas = document.getElementById("image_rtfont");
const hashOutput = document.getElementById("rtfont_hash");
let currentName = "font";
let originalTexture = null; // reused on save until the image is replaced, so pixels stay exact

async function readFont(file) {
  return RT.decodeFont(RT.unpack(new Uint8Array(await file.arrayBuffer())));
}

function drawToEditor(source) {
  imageCanvas.width = source.width;
  imageCanvas.height = source.height;
  imageCanvas.getContext("2d").drawImage(source, 0, 0);
  FontTables.drawPreviews();
  FontTest.reset();
}

function saveFont(bytes, name) {
  GK.download(bytes, name);
  hashOutput.textContent = `${name} · hash ${GK.protonHash(bytes)}`;
}

GK.bindDrop(document.getElementById("open_drop"), async ([file]) => {
  try {
    const font = await readFont(file);
    currentName = GK.baseName(file.name);
    originalTexture = font.texture;
    txtField.value = font.txt;
    fntField.value = font.fnt;
    drawToEditor(font.canvas);
    FontTables.reset();
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    GK.toast(`${file.name}: ${error.message}`, "error");
  }
});

GK.bindDrop(document.getElementById("image_change_drop"), async ([file]) => {
  try {
    drawToEditor(await RT.loadImage(file));
    originalTexture = null;
  } catch (error) {
    GK.toast(error.message, "error");
  }
});

document.getElementById("save_rtfont").addEventListener("click", () => {
  try {
    const texture = originalTexture || RT.encodeTexture(imageCanvas);
    saveFont(RT.encodeFont(txtField.value, fntField.value, texture), `${currentName}.rtfont`);
  } catch (error) {
    GK.toast(error.message, "error");
  }
});

GK.bindDrop(document.getElementById("unpack_drop"), async ([file]) => {
  try {
    const font = await readFont(file);
    const zip = new JSZip();
    zip.file("rtfont.txt", font.txt);
    zip.file("rtfont.fnt", font.fnt);
    zip.file("rtfont.png", await RT.canvasToBlob(font.canvas));
    GK.download(await zip.generateAsync({ type: "blob" }), `${GK.baseName(file.name)}.zip`);
  } catch (error) {
    GK.toast(`${file.name}: ${error.message}`, "error");
  }
});

GK.bindDrop(document.getElementById("pack_drop"), async ([file]) => {
  try {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const find = (ext) => entries.find((f) => f.name.toLowerCase().endsWith(ext));
    const txt = find(".txt");
    const fnt = find(".fnt");
    const rttex = find(".rttex");
    const png = find(".png");
    if (!txt || !fnt || !(rttex || png)) throw new Error("The ZIP must contain .txt, .fnt and .png or .rttex files.");
    const texture = rttex
      ? await rttex.async("uint8array")
      : RT.encodeTexture(await RT.loadImage(await png.async("blob")));
    saveFont(RT.encodeFont(await txt.async("string"), await fnt.async("string"), texture), `${GK.baseName(file.name)}.rtfont`);
  } catch (error) {
    GK.toast(`${file.name}: ${error.message}`, "error");
  }
});
