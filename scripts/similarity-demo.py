"""
What the similarity document would actually produce, read off the live catalogue.

Read-only. Every number here comes from napstr.sqlite3: nothing is invented and
nothing is fetched. The point is to see the thing rather than to trust the prose,
so the output is a JSON file the mocked page draws.

Signals and weights are copied from docs/SIMILARITY.md §4:

    score(c) = 1.00*album + 0.55*artist + 0.90*co_hat + 0.35*words
             + 0.12*genre + 0.04*decade
"""

import json
import math
import os
import re
import sqlite3
import time
from collections import defaultdict

DB = os.path.join(os.environ["APPDATA"], "social.deadwax.desktop", "napstr.sqlite3")
OUT = os.path.join("docs", "similarity-data.json")

NOW = int(time.time())
WEIGHTS = {"album": 1.00, "artist": 0.55, "co": 0.90, "words": 0.35, "genre": 0.12, "decade": 0.04}
FLOOR = 0.30
MMR_LAMBDA = 0.7
PER_ARTIST = 6
STATION_SIZE = 24

WORD_RE = re.compile(r"[a-z0-9']+")
STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by",
    "vol", "cd", "disc", "disk", "remaster", "remastered", "edition", "deluxe",
    "mix", "version", "feat", "ft", "lp", "ep", "ost", "bonus", "track", "unknown",
}


def norm(value):
    return (value or "").strip().lower()


def tokens(*values):
    words = set()
    for value in values:
        for word in WORD_RE.findall(norm(value)):
            if len(word) > 2 and word not in STOP and not word.isdigit():
                words.add(word)
    return words


def decade(year):
    text = (year or "").strip()
    if not text.isdigit():
        return ""
    value = int(text)
    if value < 1900 or value > 2100:
        return ""
    return "%ds" % (value // 10 * 10)


def genre_of(value):
    text = norm(value).replace("&", "and")
    text = re.sub(r"[\s\-_]+", " ", text).strip()
    aliases = {"hip hop": "hip hop", "hiphop": "hip hop", "r and b": "rnb", "rhythm and blues": "rnb"}
    return aliases.get(text, text)


def main():
    connection = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    connection.row_factory = sqlite3.Row

    rows = connection.execute(
        "SELECT file_id, title, artist, album, tags, format, size FROM remote_catalogue"
    ).fetchall()
    # One announcement per file is enough: several authors announcing the same
    # bytes say the same thing about them.
    files = {}
    for row in rows:
        files.setdefault(row["file_id"], dict(row))

    live = {
        row[0]
        for row in connection.execute(
            "SELECT DISTINCT file_id FROM catalogue_seeder WHERE expires_at > ?", (NOW,)
        )
    }
    blocked = {row[0] for row in connection.execute("SELECT file_id FROM blocked_files")}
    local = {row[0] for row in connection.execute("SELECT file_id FROM files")}

    # Genre and year live on 30427 claims, keyed artist|album exactly as cover_key
    # builds them. Several claims may answer for one album; the most recent wins.
    claims = defaultdict(list)
    for row in connection.execute(
        "SELECT cover_key, genre, year FROM album_covers WHERE deleted = 0"
    ):
        claims[row["cover_key"]].append((genre_of(row["genre"]), decade(row["year"])))
    album_meta = {key: value[0] for key, value in claims.items()}

    # Playlists: the members of each, so co-occurrence is a dictionary lookup.
    members = defaultdict(set)
    sizes = {}
    for row in connection.execute("SELECT playlist_id, author, file_id FROM playlist_tracks"):
        members[(row["author"], row["playlist_id"])].add(row["file_id"])
    for key, value in members.items():
        sizes[key] = len(value)
    in_playlist = defaultdict(list)
    for key, value in members.items():
        for file_id in value:
            in_playlist[file_id].append(key)

    # Document frequency for the word signal, over the catalogue's own titles.
    title_tokens = {}
    df = defaultdict(int)
    for file_id, row in files.items():
        words = tokens(row["title"]) - tokens(row["artist"], row["album"])
        title_tokens[file_id] = words
        for word in words:
            df[word] += 1
    total_docs = max(1, len(files))
    idf = {word: math.log(total_docs / count) for word, count in df.items()}

    catalogue = [file_id for file_id in files if file_id in live and file_id not in blocked]

    def album_key(row):
        return norm(row["artist"]), norm(row["album"])

    def score_of(seed_id, candidate_id):
        seed = files[seed_id]
        candidate = files[candidate_id]
        parts = {}
        if album_key(seed) == album_key(candidate) and album_key(seed) != ("", ""):
            parts["album"] = WEIGHTS["album"]
        elif norm(seed["artist"]) and norm(seed["artist"]) == norm(candidate["artist"]):
            parts["artist"] = WEIGHTS["artist"]
        shared = set(in_playlist[seed_id]) & set(in_playlist[candidate_id])
        if shared:
            co = sum(1.0 / (2 + sizes[key]) for key in shared)
            parts["co"] = WEIGHTS["co"] * (co / (1 + co))
        seed_words = title_tokens[seed_id]
        if seed_words:
            shared_words = seed_words & title_tokens[candidate_id]
            bottom = sum(idf.get(word, 0) for word in seed_words)
            if shared_words and bottom > 0:
                parts["words"] = WEIGHTS["words"] * (sum(idf.get(word, 0) for word in shared_words) / bottom)
        key = "%s|%s" % (norm(seed["artist"]), norm(seed["album"]))
        mine, theirs = album_meta.get(key, ("", "")), album_meta.get(
            "%s|%s" % (norm(candidate["artist"]), norm(candidate["album"])), ("", "")
        )
        if mine[0] and mine[0] == theirs[0]:
            parts["genre"] = WEIGHTS["genre"]
        if mine[1] and mine[1] == theirs[1]:
            parts["decade"] = WEIGHTS["decade"]
        return parts, round(sum(parts.values()), 4)

    def station(seed_id):
        scored = []
        for candidate_id in catalogue:
            if candidate_id == seed_id:
                continue
            parts, total = score_of(seed_id, candidate_id)
            if total >= FLOOR:
                scored.append((candidate_id, parts, total))
        scored.sort(key=lambda item: -item[2])
        raw = [{"fileId": c[0], "parts": c[1], "score": c[2]} for c in scored[:STATION_SIZE]]
        artists_above = {norm(files[c[0]]["artist"]) for c in scored}
        artists_above.discard("")
        # MMR: the first pick is the best score, and every pick after it has to be
        # good without being the same record again.
        chosen = []
        pool = scored[:]
        counts = defaultdict(int)
        while pool and len(chosen) < STATION_SIZE:
            best = None
            for candidate in pool:
                candidate_id, parts, total = candidate
                penalty = 0.0
                for taken in chosen:
                    taken_id = taken[0]
                    if album_key(files[candidate_id]) == album_key(files[taken_id]):
                        penalty = max(penalty, 1.0)
                    elif norm(files[candidate_id]["artist"]) and norm(files[candidate_id]["artist"]) == norm(files[taken_id]["artist"]):
                        penalty = max(penalty, 0.5)
                value = MMR_LAMBDA * total - (1 - MMR_LAMBDA) * penalty
                if best is None or value > best[0]:
                    best = (value, candidate)
            candidate = best[1]
            pool.remove(candidate)
            artist = norm(files[candidate[0]]["artist"])
            if artist and counts[artist] >= PER_ARTIST:
                continue
            counts[artist] += 1
            chosen.append(candidate)
        return [{"fileId": c[0], "parts": c[1], "score": c[2]} for c in chosen], len(scored), raw, len(artists_above)

    # Seeds chosen to show the best case, the middle and the honest worst case.
    def pick(predicate, order=None):
        for file_id in (order or catalogue):
            if predicate(files[file_id]):
                return file_id
        return None

    most_playlists = sorted(catalogue, key=lambda f: -len(in_playlist.get(f, [])))
    with_genre = [
        file_id
        for file_id in catalogue
        if album_meta.get("%s|%s" % (norm(files[file_id]["artist"]), norm(files[file_id]["album"])), ("", ""))[0]
    ]
    seeds = []
    candidates = [
        ("in the most playlists", most_playlists[0] if most_playlists else None),
        ("an album with a genre claim", with_genre[0] if with_genre else None),
        ("this computer's own file", next(iter(sorted(local & set(catalogue))), None)),
        ("longest title", max(catalogue, key=lambda f: len(files[f]["title"] or ""), default=None)),
        ("no album at all", pick(lambda row: not norm(row["album"]), most_playlists[1:])),
    ]
    seen = set()
    for label, file_id in candidates:
        if not file_id or file_id in seen:
            continue
        seen.add(file_id)
        rows_out, above, raw, artist_count = station(file_id)
        row = files[file_id]
        seeds.append(
            {
                "label": label,
                "fileId": file_id,
                "title": row["title"],
                "artist": row["artist"],
                "album": row["album"],
                "format": row["format"],
                "local": file_id in local,
                "playlists": len(in_playlist.get(file_id, [])),
                "genre": album_meta.get("%s|%s" % (norm(row["artist"]), norm(row["album"])), ("", ""))[0],
                "candidatesAboveFloor": above,
                "artistsAboveFloor": artist_count,
                "raw": [
                    {
                        **item,
                        "title": files[item["fileId"]]["title"],
                        "artist": files[item["fileId"]]["artist"],
                        "album": files[item["fileId"]]["album"],
                        "format": files[item["fileId"]]["format"],
                        "local": item["fileId"] in local,
                    }
                    for item in raw
                ],
                "station": [
                    {
                        **item,
                        "title": files[item["fileId"]]["title"],
                        "artist": files[item["fileId"]]["artist"],
                        "album": files[item["fileId"]]["album"],
                        "format": files[item["fileId"]]["format"],
                        "local": item["fileId"] in local,
                    }
                    for item in rows_out
                ],
            }
        )

    payload = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M"),
        "weights": WEIGHTS,
        "floor": FLOOR,
        "mmr": MMR_LAMBDA,
        "inventory": {
            "announcements": len(rows),
            "distinctFiles": len(files),
            "withHeartbeat": len(live),
            "candidates": len(catalogue),
            "playlists": len(members),
            "playlistMembers": sum(sizes.values()),
            "albumClaims": sum(len(value) for value in claims.values()),
            "albumsWithGenre": sum(1 for value in album_meta.values() if value[0]),
            "localFiles": len(local),
            "authors": connection.execute(
                "SELECT COUNT(DISTINCT source_pubkey) FROM remote_catalogue"
            ).fetchone()[0],
        },
        "seeds": seeds,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    print("wrote", OUT, len(json.dumps(payload)) // 1024, "KB")
    for seed in seeds:
        print("%-30s %-40s above-floor %4d  station %2d" % (
            seed["label"], (seed["title"] or "")[:38], seed["candidatesAboveFloor"], len(seed["station"])))


if __name__ == "__main__":
    main()
