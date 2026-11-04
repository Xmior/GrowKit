#!/usr/bin/env python3
"""Rebuilds assets/data/gtarchive from Caferius' spreadsheet and the Growtopia Iceberg wiki. Standard library only."""
import datetime, html, json, os, re, urllib.parse, urllib.request, zipfile, io
import xml.etree.ElementTree as ET

SHEET = "https://docs.google.com/spreadsheets/d/1sSW3Rgs0CWurHbl2FsktvkuNb-xyC6FTYsOOeuxLNaw/export?format=xlsx"
WIKI = "https://growtopia-iceberg.fandom.com"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "data", "gtarchive")
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
# Caferius' Internet Archive items, by spreadsheet column
ARCHIVE_ITEMS = {"Android": "growtopia-apk", "iOS": "growtopia-ipa", "Windows": "GrowtopiaEXE", "MacOS": "Growtopia_MacOS_Clients"}
UA = {"User-Agent": "GrowKit-archive-builder"}
STATUS = {'{"theme": "7"}': "found", '{"theme": "6"}': "unsure", '{"theme": "5"}': "lost", '{"rgb": "FF434343"}': "none"}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def read_sheets(data):
    book = zipfile.ZipFile(io.BytesIO(data))
    strings = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(book.read("xl/sharedStrings.xml"))]
    styles = ET.fromstring(book.read("xl/styles.xml"))
    fills = []
    for fill in styles.find(M + "fills"):
        color = fill.find(f"{M}patternFill/{M}fgColor")
        fills.append(json.dumps(dict(color.attrib)) if color is not None else "{}")
    formats = [fills[int(x.get("fillId", 0))] for x in styles.find(M + "cellXfs")]
    names = [s.get("name") for s in ET.fromstring(book.read("xl/workbook.xml")).find(M + "sheets")]
    sheets = {}
    for i, name in enumerate(names, 1):
        sheet = ET.fromstring(book.read(f"xl/worksheets/sheet{i}.xml"))
        rel_path = f"xl/worksheets/_rels/sheet{i}.xml.rels"
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(book.read(rel_path))} if rel_path in book.namelist() else {}
        links = {h.get("ref"): rels.get(h.get(R)) for h in sheet.iter(M + "hyperlink")}
        cells = {}
        for c in sheet.iter(M + "c"):
            v = c.find(M + "v")
            text = "" if v is None else strings[int(v.text)] if c.get("t") == "s" else v.text
            cells[c.get("r")] = {"text": text or "", "fill": formats[int(c.get("s", 0))], "number": c.get("t") != "s", "link": links.get(c.get("r"))}
        sheets[name] = cells
    return sheets


def clean(cell):
    text = cell["text"].strip()
    if cell["number"] and re.fullmatch(r"\d+(\.0+)?", text):
        value = int(float(text))
        # Spreadsheet dates are day counts; version codes stay far below this
        if value > 30000:
            return (datetime.date(1899, 12, 30) + datetime.timedelta(days=value)).isoformat()
        return str(value)
    return "" if text.startswith("---N/A") else text


def compact(number):
    """2.98.2, as the sheet writes it, and 2.982, as the stores write it, are the same version."""
    head, *rest = number.split(".")
    return f"{head}.{''.join(rest)}"


def version_keys(label):
    """Every number a sheet label can go by: "v2.99 (v2.99.0)" is both 2.99 and 2.99.0."""
    return [compact(n) for n in re.findall(r"\d+\.\d+(?:\.\d+)?", label)]


def lookup(table, label):
    for key in version_keys(label):
        if key in table:
            return table[key]
    return None


def file_facts(stem):
    """What a file name records: (MM DD YYYY) dates and bracketed numbers, shortest first being the build."""
    facts = {}
    date = re.search(r"\((\d{2}) (\d{2}) (\d{4})\)", stem)
    if date:
        facts["date"] = f"{date[3]}-{date[1]}-{date[2]}"
    for number in re.findall(r"\((\d+)\)", stem):
        facts["store" if len(number) >= 6 else "build"] = number
    return facts


def steam_depots():
    """Current depots only: the public API keeps no history, and SteamDB refuses scripts."""
    try:
        app = json.loads(fetch("https://api.steamcmd.net/v1/info/866020"))["data"]["866020"]
    except (OSError, ValueError, KeyError):
        return None
    depots = app["depots"]
    rows = []
    for depot, info in depots.items():
        manifest = info.get("manifests", {}).get("public", {}) if isinstance(info, dict) else {}
        if depot.isdigit() and manifest:
            rows.append({"name": f"Depot {depot}", "builds": [{"status": "found", "text": manifest["gid"]}]})
    build = depots.get("branches", {}).get("public", {}).get("buildid")
    return {"title": f"Steam depots, current build {build} (app 866020)", "columns": ["Public manifest"], "rows": rows}


def steam_notes():
    """Update posts from Steam's official news API, keyed by version title and by date for untitled posts."""
    url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=866020&count=1000&maxlength=0&feeds=steam_community_announcements"
    try:
        items = json.loads(fetch(url))["appnews"]["newsitems"]
    except (OSError, ValueError, KeyError):
        return {}, {}
    by_version, by_date = {}, {}
    for item in items:
        text = re.sub(r"\[/?[a-z0-9*]+(=[^\]]*)?\]", "", item["contents"]).strip()
        date = datetime.datetime.fromtimestamp(item["date"], datetime.timezone.utc).date().isoformat()
        note = {"notes": text, "date": date}
        title = re.fullmatch(r"\s*v?(\d+\.\d+(?:\.\d+)?)\s*", item["title"])
        if title:
            by_version.setdefault(compact(title[1]), note)
        else:
            by_date.setdefault(date, note)
    return by_version, by_date


def iso_date(text):
    for pattern in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            pass
    return ""


def archive_files():
    files = {}
    for platform, item in ARCHIVE_ITEMS.items():
        result = json.loads(fetch(f"https://archive.org/metadata/{item}/files"))["result"]
        for f in result:
            name = f["name"]
            if f.get("source") != "original" or not re.search(r"\.(apk|ipa|exe|zip|dmg|rar|7z|pkg)$", name, re.I):
                continue
            # The first dotted number in a file name, without its extension, is its version
            stem = re.sub(r"(\.ipa)?\.[a-z0-9]+$", "", name, flags=re.I)
            match = re.search(r"(?<![\d.])(\d+\.\d+(?:\.\d+)?)(?![\d.])", stem)
            if match:
                url = f"https://archive.org/download/{item}/{urllib.parse.quote(name)}"
                files.setdefault((platform, compact(match[1])), []).append({"name": name, "url": url, **file_facts(stem)})
    return files


def build_clients(cells):
    files = archive_files()
    platforms = [(column, clean(cells.get(f"{column}3", {"text": "", "number": False}))) for column in "BCDEFG"]
    rows = []
    row = 4
    while f"A{row}" in cells and cells[f"A{row}"]["text"].strip():
        entry = {"version": cells[f"A{row}"]["text"].strip(), "builds": {}}
        for column, name in platforms:
            cell = cells.get(f"{column}{row}")
            if not cell:
                continue
            info = {"status": STATUS.get(cell["fill"], "unknown"), "text": clean(cell)}
            if cell["link"]:
                info["link"] = cell["link"]
            found = next((files[(name, key)] for key in version_keys(entry["version"]) if (name, key) in files), None)
            if found:
                info["files"] = found
            entry["builds"][name] = info
        rows.append(entry)
        row += 1
    updated = cells.get("G1", {}).get("text", "")
    details = version_details()
    with open(os.path.join(HERE, "appstore-notes.json"), encoding="utf-8") as source:
        appstore = {compact(note["version"]): note for note in json.load(source)}
    with open(os.path.join(HERE, "old-version-list.json"), encoding="utf-8") as source:
        old_list = {compact(number): value for number, value in json.load(source).items()}
    with open(os.path.join(HERE, "playstore-notes.json"), encoding="utf-8") as source:
        playstore = {compact(note["version"]): note for note in json.load(source)}
    steam_by_version, steam_by_date = steam_notes()
    store_ids_known, store_ids_unknown = appstore_ids()
    rows = [entry for entry in rows if entry["version"] not in SKIPPED_VERSIONS]
    for entry in rows:
        found = lookup(details, entry["version"])
        store = lookup(appstore, entry["version"])
        if store:
            found = found or {"notes": {}}
            found["notes"]["App Store"] = store["notes"]
        steam_cell = entry["builds"].get("Steam (Win)", {}).get("text", "")
        steam = lookup(steam_by_version, entry["version"]) or steam_by_date.get(iso_date(first_date(steam_cell)))
        if steam:
            found = found or {"notes": {}}
            found["notes"]["Steam"] = steam["notes"]
            found["notes"].pop("Steam & Ubisoft", None)
        play = lookup(playstore, entry["version"])
        # Early Play entries hold the store description instead of update notes
        if play and play["notes"] and not play["notes"].startswith("BE AWARE!"):
            found = found or {"notes": {}}
            found["notes"]["Google Play"] = play["notes"]
        if found:
            entry["details"] = found
        fields = platform_fields(entry, old_list, appstore, playstore, store_ids_known)
        if fields:
            entry["fields"] = fields
        # Being on a store proves a release, so without a file it counts as lost
        for name, note in (("Android", play), ("iOS", store)):
            build = entry["builds"].get(name)
            if note and build and build["status"] in ("none", "unknown", "unsure") and not build.get("files"):
                build["status"] = "lost"
        if found:
            found.pop("dates", None)
    for entry in rows:
        entry["version"] = display_version(entry["version"])
        # An empty sheet cell hasn't been researched: a known file proves it exists, otherwise it might
        for name in ARCHIVED_PLATFORMS:
            build = entry["builds"].setdefault(name, {"status": "unknown", "text": ""})
            if build["status"] == "unknown":
                build["status"] = "found" if build.get("files") else "unsure"
    # A platform isn't shown on versions from before its first known build
    for name in (*ARCHIVED_PLATFORMS, "Steam (Win)"):
        wanted = ("found", "lost") if name != "Steam (Win)" else ("found", "lost", "unsure")
        for entry in rows:
            build = entry["builds"].get(name, {})
            if build.get("status") in wanted or build.get("text"):
                break
            entry.setdefault("notReleased", []).append(name)
    unmatched = {"title": "App Store update IDs without a known version", "columns": ["AppStore Version ID"], "rows": [{"name": str(i + 1), "builds": [{"status": "unknown", "text": value}]} for i, value in enumerate(store_ids_unknown)]}
    return {"platforms": [p[1] for p in platforms], "updated": updated.replace("Last Updated:", "").strip(), "rows": rows, "sideTables": build_side_tables(cells) + [t for t in [steam_depots()] if t] + [unmatched]}


# Smaller tables beside the main list: title cell, label column, value columns, first and last row
SIDE_TABLES = [
    ("Console: PlayStation 4", "I", "JKL", 4, 8), ("Console: Nintendo Switch", "I", "J", 10, 15), ("Console: Xbox", "K", "L", 13, 18),
    ("Android Beta (com.ubisoft.growtopia.test)", "I", "J", 17, 24), ("Known ADMIN Clients", "I", "J", 26, 30), ("Buildo With Cheese (before release)", "K", "L", 22, 29),
]


def build_side_tables(cells):
    blank = {"text": "", "number": False, "fill": "{}", "link": None}
    tables = []
    for title, label, values, first, last in SIDE_TABLES:
        columns = [clean(cells.get(f"{c}{first}", blank)) for c in values]
        rows = []
        for row in range(first + 1, last + 1):
            name = clean(cells.get(f"{label}{row}", blank))
            if not name:
                continue
            builds = []
            for c in values:
                cell = cells.get(f"{c}{row}", blank)
                build = {"status": STATUS.get(cell["fill"], "unknown"), "text": clean(cell)}
                if cell["link"]:
                    build["link"] = cell["link"]
                    build["text"] = re.sub(r"\s*(HOW TO DOWNLOAD.*|https?://\S+)$", "", build["text"]).strip()
                builds.append(build)
            rows.append({"name": name, "builds": builds})
        tables.append({"title": title, "columns": columns, "rows": rows})
    return tables


def templates(text):
    """Finds {{Name|key=value|...}} calls, keeping nested links and templates inside their values."""
    found = []
    start = 0
    while True:
        start = text.find("{{", start)
        if start < 0:
            return found
        depth, i, parts, piece = 0, start, [], start + 2
        while i < len(text):
            pair = text[i:i + 2]
            if pair in ("{{", "[["):
                depth += 1
                i += 2
            elif pair in ("}}", "]]"):
                depth -= 1
                i += 2
                if depth == 0:
                    break
            else:
                if text[i] == "|" and depth == 1:
                    parts.append(text[piece:i])
                    piece = i + 1
                i += 1
        parts.append(text[piece:i - 2])
        fields = {}
        for part in parts[1:]:
            key, sep, value = part.partition("=")
            if sep:
                fields[key.strip()] = value.strip()
        found.append((parts[0].strip(), fields))
        start = i


def plain_wiki(text):
    text = re.sub(r"\[\[File:[^\]]*\]\]", "", text)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[(https?://\S+) ([^\]]*)\]", r"\2 (\1)", text)
    text = re.sub(r"'{2,}", "", text)
    return re.sub(r"<[^>]+>", "", text).strip()


NOTE_SOURCES = [("Version History", "All platforms"), ("Version History/Android", "Google Play"), ("Version History/iOS", "App Store"), ("Version History/Ubisoft Connect", "Steam & Ubisoft")]


def version_details():
    """Version facts and per-store update notes from the wiki's version templates."""
    details = {}
    for title, store in NOTE_SOURCES:
        text = wiki_api(action="parse", page=title, prop="wikitext")["parse"]["wikitext"]
        for name, fields in templates(text):
            if not name.endswith("Version") and name != "VersionLost":
                continue
            match = re.search(r"\d+\.\d+(?:\.\d+)?", fields.get("VersionNameAndCode", ""))
            if not match:
                continue
            entry = details.setdefault(compact(match[0]), {"notes": {}, "dates": {}})
            if fields.get("UpdateDate"):
                entry["dates"].setdefault(store, plain_wiki(fields["UpdateDate"]))
            if fields.get("WhatsNew"):
                entry["notes"][store] = plain_wiki(fields["WhatsNew"])
            icon = re.search(r"\[\[File:([^\]|]+)", fields.get("Icon", ""))
            if icon:
                entry.setdefault("icon", f"{WIKI}/wiki/Special:FilePath/{urllib.parse.quote(icon[1].strip().replace(' ', '_'))}")
            for key, target in (("UpdateDate", "date"), ("APKVersionCode", "android"), ("IPAVersionCode", "ios"), ("DMGVersionCode", "macos"), ("OperatingSystems", "systems"), ("ExtraInfo", "extra"), ("AndroidDownloadLink", "androidLink")):
                value = plain_wiki(fields.get(key, ""))
                if value and value not in ("UNK", "No Info", "No Info."):
                    entry.setdefault(target, value)
            if fields.get("VersionCode") and fields["VersionCode"] != "UNK":
                entry.setdefault("android" if store == "Google Play" else "ios" if store == "App Store" else "code", fields["VersionCode"])
    return details


HERE = os.path.dirname(__file__)
DATE = r"\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|\d{2} \d{2} \d{4}|\d{1,2} [A-Z][a-z]+,? \d{4}|[A-Z][a-z]{2,8} \d{1,2},? \d{4}"


def first_date(text):
    match = re.search(DATE, text or "")
    return match[0] if match else ""


def old_extra(old, pattern):
    match = re.search(pattern, old.get("extra") or "")
    return match[1] if match else ""


def file_fact(row, platform, key):
    for file in row["builds"].get(platform, {}).get("files", []):
        if file.get(key):
            return file[key]
    return ""


def platform_fields(row, old_list, appstore, playstore, store_ids_known):
    """The facts each platform has, from the sheet's cell, the App Store history, the wiki and the old list."""
    old = lookup(old_list, row["version"]) or {}
    app_entry = lookup(appstore, row["version"]) or {}
    play_entry = lookup(playstore, row["version"]) or {}
    details = row.get("details", {})
    dates = details.get("dates", {})
    fields = {}

    def known_date(value):
        return value if value and value != "Unknown" else ""

    cell = row["builds"].get("iOS", {}).get("text", "")
    build = re.search(r"\|\s*(\d+)\s*$", cell)
    store_ids = re.search(r"\((\d{6,}(?:,\s*\d{6,})*)\)", cell)
    ios = {
        "iOS Build ID": build[1] if build else file_fact(row, "iOS", "build") or old_extra(old.get("ios", {}), r"Bundle Version\s*:\s*(\d+)"),
        "AppStore Version ID": store_ids[1] if store_ids else file_fact(row, "iOS", "store") or lookup(store_ids_known, row["version"]) or old_extra(old.get("ios", {}), r"AppID\s*:\s*(\d+)"),
        "iOS Release Date": app_entry.get("date") or first_date(cell) or file_fact(row, "iOS", "date") or dates.get("App Store") or known_date(old.get("ios", {}).get("date")),
    }
    cell = row["builds"].get("Android", {}).get("text", "")
    android = {
        "Android Version Identifier": cell if cell.isdigit() else file_fact(row, "Android", "build") or old_extra(old.get("android", {}), r"Version Code\s*:\s*(\d+)") or details.get("android", ""),
        "Android Release Date": play_entry.get("date") or dates.get("Google Play") or known_date(old.get("android", {}).get("date")),
    }
    cell = row["builds"].get("MacOS", {}).get("text", "")
    macos = {"MacOS Version Identifier": cell if cell.isdigit() else file_fact(row, "MacOS", "build") or details.get("macos", ""), "MacOS Release Date": known_date(old.get("macos", {}).get("date"))}
    cell = row["builds"].get("Windows", {}).get("text", "")
    windows = {"Windows Release Date": first_date(cell) or file_fact(row, "Windows", "date") or known_date(old.get("windows", {}).get("date"))}
    for name, values in (("iOS", ios), ("Android", android), ("MacOS", macos), ("Windows", windows)):
        kept = {k: v for k, v in values.items() if v}
        # Store history proves a release even where the sheet has no build listed
        listed = (name == "Android" and play_entry) or (name == "iOS" and app_entry)
        has_file = bool(row["builds"].get(name, {}).get("files"))
        if kept and (listed or has_file or row["builds"].get(name, {}).get("status") != "none"):
            fields[name] = kept
    for name in ("Steam (Win)", "UbiConnect (Win)"):
        cell = row["builds"].get(name, {}).get("text", "")
        if cell:
            date = first_date(cell)
            note = re.sub(r"\s*\|?\s*" + re.escape(date), "", cell).strip(" |") if date else cell
            kept = {k: v for k, v in (("Release Date", date), ("Build", note)) if v}
            fields[name] = kept
    return fields


ARCHIVED_PLATFORMS = ("Android", "iOS", "Windows", "MacOS")
# Not real releases, by Caferius' decision
SKIPPED_VERSIONS = {"v5.62", "v0.90", "v0.91"}
# Written with their dots in-game, so they keep their sheet name
KEEP_DOTTED = {"3.20.1", "3.30.1", "3.30.2", "3.30.3"}


def display_version(label):
    """v2.99.1 is shown as v2.991 (v2.99.1), the way the stores number it."""
    match = re.fullmatch(r"v\.?(\d+\.\d+\.\d+(?:\.\d+)?)", label)
    if not match:
        return label
    # The same buggy client posted again: v2.99.7.4 is the fourth upload of 2.997
    repost = re.fullmatch(r"(\d+\.\d+)\.(\d+)\.(\d+)", match[1])
    if repost:
        return f"v{compact(repost[1] + '.' + repost[2])}-{repost[3]}"
    return f"v{match[1]}" if match[1] in KEEP_DOTTED else f"v{compact(match[1])} (v{match[1]})"


def appstore_ids():
    """tools/appstore-version-ids.txt, from Growtopia_iOS/Ver.txt on the Internet Archive: ID, then version if known."""
    known, unknown = {}, []
    with open(os.path.join(HERE, "appstore-version-ids.txt"), encoding="utf-8") as source:
        for line in source:
            parts = line.split()
            if len(parts) > 1:
                known[compact(parts[1])] = parts[0]
            elif parts:
                unknown.append(parts[0])
    return known, unknown


def build_commands(cells):
    groups = []
    row = 1
    last = max(int(re.sub(r"\D", "", key)) for key in cells)
    get = lambda col, n: cells.get(f"{col}{n}", {"text": ""})["text"].strip()
    while row <= last:
        name, info, usage, extra = (get(c, row) for c in "ABCD")
        if info == "Info":
            groups.append({"name": name, "commands": []})
        elif groups and name:
            groups[-1]["commands"].append({"name": name, "info": info, "usage": re.sub(r"^Usage( is)?\s*[:;]\s*", "", usage), "extra": extra})
        row += 1
    return groups


def wiki_api(**params):
    params.update(format="json", formatversion=2)
    return json.loads(fetch(f"{WIKI}/api.php?{urllib.parse.urlencode(params)}"))


def slug(title):
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def build_wiki():
    titles = [p["title"] for p in wiki_api(action="query", list="allpages", aplimit=500)["query"]["allpages"]]
    skip = {"/Assettest", "Assettest", "Blank", "Growtopia Wiki:Sandbox", "ItemsNav"}
    titles = [t for t in titles if t not in skip]
    known = {t: slug(t) for t in titles}
    os.makedirs(os.path.join(OUT, "wiki"), exist_ok=True)
    index = []
    for title in titles:
        page = wiki_api(action="parse", page=title, prop="text", redirects=1, disableeditsection=1, disabletoc=1)["parse"]["text"]
        page = re.sub(r"<(script|style|noscript)\b.*?</\1>", "", page, flags=re.S | re.I)
        page = re.sub(r"<!--.*?-->", "", page, flags=re.S)
        page = re.sub(r'\son\w+="[^"]*"', "", page)
        # Lazy-loaded images keep their real address in data-src
        page = re.sub(r'<img\b([^>]*?)\ssrc="data:[^"]*"([^>]*?)\sdata-src="([^"]+)"', r'<img\1 src="\3"\2', page)

        def link(match):
            target = html.unescape(urllib.parse.unquote(match[1])).replace("_", " ")
            page_part, _, anchor = target.partition("#")
            if page_part in known:
                return f'href="wiki.html?page={known[page_part]}{"#" + slug(anchor) if anchor else ""}"'
            return f'href="{WIKI}/wiki/{match[1]}" rel="noopener"'

        page = re.sub(r'href="/wiki/([^"]+)"', link, page)
        with open(os.path.join(OUT, "wiki", f"{known[title]}.html"), "w", encoding="utf-8") as out:
            out.write(page)
        index.append({"title": title, "slug": known[title], "source": f"{WIKI}/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"})
    return index


def main():
    os.makedirs(OUT, exist_ok=True)
    sheets = read_sheets(fetch(SHEET))
    outputs = {"clients": build_clients(sheets["Versions"]), "commands": build_commands(sheets["Commands"]), "wiki-index": build_wiki()}
    for name, value in outputs.items():
        with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
