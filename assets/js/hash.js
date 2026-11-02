const body = document.getElementById("hash_rows");

GK.bindDrop(document.getElementById("hash_drop"), async (files) => {
  document.getElementById("hash_panel").hidden = false;
  for (const file of files) {
    const hash = GK.protonHash(await file.arrayBuffer());
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = file.name;
    const size = document.createElement("td");
    size.className = "hide-sm";
    size.textContent = GK.formatSize(file.size);
    const signed = document.createElement("td");
    signed.className = "mono";
    signed.textContent = hash;
    const hex = document.createElement("td");
    hex.className = "mono hide-sm";
    hex.textContent = "0x" + (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
    const action = document.createElement("td");
    action.className = "cell-end";
    const copy = document.createElement("button");
    copy.className = "btn-sm";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(hash));
        GK.toast("Hash copied.");
      } catch {
        GK.toast("Clipboard access was blocked.", "error");
      }
    });
    action.appendChild(copy);
    row.append(name, size, signed, hex, action);
    body.prepend(row);
  }
});
