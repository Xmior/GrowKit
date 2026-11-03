// Same rule as the official site: a count of 0 or less means maintenance.
const statusBox = document.getElementById("server_status");
const REFRESH_MS = 60000;

async function refreshServerStatus() {
  try {
    let response = await fetch("data/live/online.json", { cache: "no-store" });
    if (!response.ok) response = await fetch("api/online.php", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const online = Number((await response.json()).online_user);
    if (!Number.isFinite(online)) throw new Error();
    statusBox.hidden = false;
    statusBox.classList.toggle("is-down", online <= 0);
    statusBox.replaceChildren();
    if (online <= 0) {
      statusBox.textContent = "Server is down for maintenance!";
    } else {
      const count = document.createElement("span");
      count.className = "counter";
      count.textContent = online.toLocaleString("en-US");
      statusBox.append("Server is up | ", count, " Players online!");
    }
  } catch {
    statusBox.hidden = true; // no count is better than a wrong one
  }
}

refreshServerStatus();
setInterval(refreshServerStatus, REFRESH_MS);
