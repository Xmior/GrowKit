#!/usr/bin/env python3
"""Saves public Growtopia pages for GitHub Pages, which cannot run the PHP relays.
growtopiagame.com sometimes refuses GitHub's runners (HTTP 403); a page that fails
keeps its last saved copy instead of failing the whole job."""
import json, os, time, urllib.request

OUT = "data/live"
AGENT = {"User-Agent": "Mozilla/5.0 GrowKit"}
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=30).read()

os.makedirs(OUT, exist_ok=True)
ok = 0
for page in ("auction", "leaderboard"):
    try:
        body = get(f"https://www.growtopiagame.com/{page}")
        with open(f"{OUT}/{page}.html", "wb") as f:
            f.write(body)
        ok += 1
    except Exception as e:
        print(f"::warning::{page}: {e} (kept the last saved copy)")
try:
    online = json.loads(get("https://www.growtopiagame.com/detail"))["online_user"]
    json.dump({"online_user": int(online)}, open(f"{OUT}/online.json", "w"))
    ok += 1
except Exception as e:
    print(f"::warning::detail: {e} (kept the last saved count)")
if ok:
    json.dump({"fetched_at": int(time.time())}, open(f"{OUT}/meta.json", "w"))
