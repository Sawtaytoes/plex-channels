#!/usr/bin/env python3
"""Generate the SYNTHETIC engine-parity corpus + its sets.yaml (decision 2026-08-07: CI's
engine-parity oracle is synthetic, never real library data — docs/d3-engine-parity-corpus.md).

Writes fake Plex responses into the same on-disk scheme plex.py record/replay uses
(`<dir>/get/<alias>/<sha1(path)[:16]>.json`, payload `{"data": {"MediaContainer": …}}`), so
BOTH engines replay it: the Python engine via PLEX_REPLAY_DIR, the Node engine via
server/src/engine/plex-replay.js. Covers the deterministic unwatched-buckets core: per-account
library views, the content-rating cap, history→watched filtering, a manual start floor, a
multi-season show, Season-0 specials/extras (which unwatched_buckets KEEPS — the curated path
is what drops them), a fully-watched show (no bucket), a shorts item section, and the
collection-expansion blocklist (a bare-ratingKey block AND a "Collection: <name>" block that
find_collection/collection_children expand to every member).

Run: python3 e2e/gen-synthetic-corpus.py <out_dir>   (default e2e/fixtures/engine-corpus)
It also writes <out_dir>/../engine.sets.yaml next to it. Idempotent.
"""
import hashlib
import json
import os
import sys
import urllib.parse

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "fixtures", "engine-corpus")

# --- accounts / tokens ------------------------------------------------------- #
YK_UUID, OK_UUID = "yk-uuid", "ok-uuid"
YK_ACCT, OK_ACCT = 700001, 700002

# --- the synthetic library --------------------------------------------------- #
# section 5 = Shows (type=2), section 15 = Shorts (type=1).
# Each show: (ratingKey, title, contentRating, [leaves]); leaf = (rk, index, season, title, type, extraType)
SHOWS = [
    # Alpha: younger-rated, multi-item, one watched-by-YK episode, a real special + a trailer extra.
    ("1001", "Alpha", "TV-Y", [
        ("11", 1, 1, "Alpha S1E1", "episode", None),
        ("12", 2, 1, "Alpha S1E2", "episode", None),   # YK watched this one
        ("13", 3, 1, "Alpha S1E3", "episode", None),
        ("14", 5, 0, "Alpha OAD",  "episode", None),    # S0 index 5 = real special → KEPT
        ("15", 250, 0, "Alpha Trailer", "episode", None),  # S0 index 250 = extra → still in bucket
    ]),
    # Beta: PG only → visible to OLDER, filtered out for YOUNGER. Two seasons → multi_season.
    ("1002", "Beta", "TV-PG", [
        ("21", 1, 1, "Beta S1E1", "episode", None),
        ("22", 1, 2, "Beta S2E1", "episode", None),
    ]),
    # Gamma: younger-rated but FULLY watched by YK → no bucket.
    ("1003", "Gamma", "TV-Y", [
        ("31", 1, 1, "Gamma S1E1", "episode", None),
        ("32", 2, 1, "Gamma S1E2", "episode", None),
    ]),
    # Delta: younger-rated, used to exercise a manual START floor (begin at S1E2).
    ("1004", "Delta", "TV-G", [
        ("41", 1, 1, "Delta S1E1", "episode", None),
        ("42", 2, 1, "Delta S1E2", "episode", None),
        ("43", 3, 1, "Delta S1E3", "episode", None),
    ]),
    # Epsilon: younger-rated with an unwatched episode — would produce a bucket, BUT it's a
    # member of the "Blocked Toons" collection, so the "Collection: …" blocklist entry drops it.
    ("1005", "Epsilon", "TV-Y", [
        ("51", 1, 1, "Epsilon S1E1", "episode", None),
    ]),
    # Zeta: younger-rated with an unwatched episode — dropped by a BARE-ratingKey blocklist entry.
    ("1006", "Zeta", "TV-Y", [
        ("61", 1, 1, "Zeta S1E1", "episode", None),
    ]),
]
# Collections (type=18) per section, for the collection-expansion blocklist. Section 5 holds
# "Blocked Toons" → Epsilon (show 1005); blocklisting "Collection: Blocked Toons" expands to
# every child ratingKey, so episodic_shows drops the whole show. (crk, name, section, [(child_rk, type)])
COLLECTIONS = [
    ("9001", "Blocked Toons", 5, [("1005", "show")]),
]
SHORTS = [  # (ratingKey, title, contentRating)
    ("1501", "Short One", "TV-G"),
    ("1502", "Short Two", "TV-Y7"),
    ("1503", "Short Three (watched)", "TV-G"),
]
# Movies (section 1, type=1) — the rewatch pool. (ratingKey, title, contentRating)
MOVIES = [
    ("2001", "Movie A", "G"),    # younger-visible
    ("2002", "Movie B", "PG"),   # older-visible
    ("2003", "Movie C", "G"),    # younger-visible
]
# History rows: (account, section, ratingKey) — one row per completed view. Repeats = rewatches.
HISTORY = [
    (YK_ACCT, 5, "12"),                 # YK watched Alpha S1E2
    (YK_ACCT, 5, "31"), (YK_ACCT, 5, "32"),  # YK watched all of Gamma
    (YK_ACCT, 15, "1503"),              # YK watched Short Three
    (OK_ACCT, 5, "21"),                 # OK watched Beta S1E1
    # Movie rewatch history (section 1): YK saw Movie A twice + Movie C once; OK saw Movie B x3.
    (YK_ACCT, 1, "2001"), (YK_ACCT, 1, "2001"), (YK_ACCT, 1, "2003"),
    (OK_ACCT, 1, "2002"), (OK_ACCT, 1, "2002"), (OK_ACCT, 1, "2002"),
]

RATINGS = {  # what each account's token can see (the account's own restricted view)
    YK_UUID: {"TV-Y", "TV-Y7", "TV-G", "G"},
    OK_UUID: {"TV-PG", "PG"},
}


def _alias(token):
    return "admin" if token is None else f"acct:{token}"


def _write(kind, path, token, data):
    h = hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]
    p = os.path.join(OUT, kind, _alias(token), h + ".json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"kind": kind, "path": path, "alias": _alias(token), "data": data}, f, ensure_ascii=False)


def _mc(**kw):
    return {"MediaContainer": kw}


def gen():
    # Shows listing (type=2) per ACCOUNT token — the account's own view, rating-capped later.
    for uuid in (YK_UUID, OK_UUID):
        meta = [{"ratingKey": rk, "title": t, "contentRating": cr,
                 "leafCount": len(leaves), "type": "show"}
                for (rk, t, cr, leaves) in SHOWS if cr in RATINGS[uuid]]
        _write("get", "/library/sections/5/all?type=2&X-Plex-Container-Size=5000", uuid, _mc(Metadata=meta))
        # Shorts listing (type=1, section 15)
        shorts = [{"ratingKey": rk, "title": t, "contentRating": cr, "type": "movie"}
                  for (rk, t, cr) in SHORTS if cr in RATINGS[uuid]]
        _write("get", "/library/sections/15/all?type=1&X-Plex-Container-Size=10000", uuid, _mc(Metadata=shorts))
        # Movies listing (type=1, section 1) — the rewatch pool source
        movies = [{"ratingKey": rk, "title": t, "contentRating": cr, "type": "movie"}
                  for (rk, t, cr) in MOVIES if cr in RATINGS[uuid]]
        _write("get", "/library/sections/1/all?type=1&X-Plex-Container-Size=10000", uuid, _mc(Metadata=movies))
        # allLeaves per show the account can see
        for (rk, t, cr, leaves) in SHOWS:
            if cr not in RATINGS[uuid]:
                continue
            eps = [{"ratingKey": lrk, "title": lt, "grandparentTitle": t,
                    "parentIndex": season, "index": idx, "duration": 1200000,
                    "type": typ, "extraType": extra, "viewCount": 0, "viewOffset": 0}
                   for (lrk, idx, season, lt, typ, extra) in leaves]
            _write("get", f"/library/metadata/{rk}/allLeaves", uuid, _mc(Metadata=eps))
        # Collection-expansion blocklist source, per account: each section's collection listing
        # (find_collection reads it) + each collection's children (collection_children reads it).
        # Recorded under the account alias because _expanded_blocklist passes the account token.
        by_section = {}
        for (crk, cname, sec, children) in COLLECTIONS:
            by_section.setdefault(sec, []).append(
                {"ratingKey": crk, "title": cname, "type": "collection"})
            child_meta = [{"ratingKey": ch_rk, "type": ch_type} for (ch_rk, ch_type) in children]
            _write("get", f"/library/collections/{crk}/children", uuid, _mc(Metadata=child_meta))
        for (sec, colls) in by_section.items():
            _write("get", f"/library/sections/{sec}/collections?X-Plex-Container-Size=1000",
                   uuid, _mc(Metadata=colls))
    # section_kind source: /library/sections Directory (admin token). section 1 = movie library.
    _write("get", "/library/sections", None, _mc(Directory=[
        {"key": "1", "type": "movie"}, {"key": "5", "type": "show"}, {"key": "15", "type": "movie"},
    ]))
    # History per (account, section) — fetched with the ADMIN token (alias "admin").
    for acct in (YK_ACCT, OK_ACCT):
        for sec in (1, 5, 15):
            rows = [{"ratingKey": rk} for (a, s, rk) in HISTORY if a == acct and s == sec]
            q = urllib.parse.urlencode({
                "accountID": acct, "X-Plex-Container-Start": 0,
                "X-Plex-Container-Size": 500, "sort": "viewedAt:desc", "librarySectionID": sec,
            })
            _write("get", "/status/sessions/history/all?" + q, None,
                   _mc(Metadata=rows, totalSize=len(rows), size=len(rows)))

    # The sets.yaml the engines load (config._load_sets_yaml / routing.loadSets). One rotation
    # set with two profile bindings + a manual start floor on Delta.
    sets_yaml = f"""# SYNTHETIC engine-parity sets.yaml (generated by e2e/gen-synthetic-corpus.py). Do not hand-edit.
global:
  excluded_sections: []
sets:
- id: kids
  label: Kids
  source: rotation
  behavior: progress
  sections: [5]
  item_sections: [15]
  blocklist:
  - "1006"                         # bare ratingKey → Zeta dropped directly
  - "Collection: Blocked Toons"    # collection → expanded to Epsilon via find_collection/children
  starts:
    "1004": {{ season: 1, episode: 2 }}   # Delta begins at S1E2 (skip S1E1, don't mark it watched)
  profiles:
  - plex_user: "Younger"
    account_id: {YK_ACCT}
    user_uuid: {YK_UUID}
    watch_count_accounts: [{YK_ACCT}]
    allowed_ratings: [TV-Y, TV-Y7, TV-G, G]
    movie_ratings: [G]
  - plex_user: "Older"
    account_id: {OK_ACCT}
    user_uuid: {OK_UUID}
    watch_count_accounts: [{OK_ACCT}]
    allowed_ratings: [TV-PG, PG]
    movie_ratings: [PG]
"""
    sets_path = os.path.join(os.path.dirname(OUT), "engine.sets.yaml")
    with open(sets_path, "w", encoding="utf-8") as f:
        f.write(sets_yaml)
    n = sum(len(files) for _, _, files in os.walk(OUT))
    print(f"[gen] wrote {n} corpus files → {OUT}")
    print(f"[gen] wrote {sets_path}")


if __name__ == "__main__":
    gen()
