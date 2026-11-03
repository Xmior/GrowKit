#!/usr/bin/env python3
"""Saves public Growtopia pages for GitHub Pages, which cannot run the PHP relays."""
import json, os, time, urllib.request

OUT = "data/live"
AGENT = {"User-Agent": "Mozilla/5.0 GrowKit"}
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=30).read()

os.makedirs(OUT, exist_ok=True)
for page in ("auction", "leaderboard"):
    with open(f"{OUT}/{page}.html", "wb") as f:
        f.write(get(f"https://www.growtopiagame.com/{page}"))
online = json.loads(get("https://www.growtopiagame.com/detail"))["online_user"]
json.dump({"online_user": int(online)}, open(f"{OUT}/online.json", "w"))
json.dump({"fetched_at": int(time.time())}, open(f"{OUT}/meta.json", "w"))
