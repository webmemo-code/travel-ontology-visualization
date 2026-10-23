#!/usr/bin/env python3
"""Download each article's featured-image thumbnail for the dome mosaic.

Reads post ids from public/graph.json, asks the site's public WP REST API for
each post's featured media, and saves WordPress's own 150x150 'thumbnail'
crop to .cache/thumbs/{site}/{post_id}.{ext}. Resumable: files already on disk
are skipped. Writes .cache/thumbs/{site}/manifest.json mapping post id to the
thumbnail file and a larger 'src' URL the article panel can hot-link.

Read-only and public: no credentials. Uses curl_cffi with Chrome's TLS
fingerprint because travelmemo's Cloudflare holds plain python-requests
connections for ~43 s (pip install curl_cffi):

  python scripts/fetch_thumbs.py --site reisememo
  python scripts/fetch_thumbs.py --site travelmemo --limit 3
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from curl_cffi import requests

ROOT = Path(__file__).resolve().parent.parent
SITES = {"travelmemo": "https://travelmemo.com", "reisememo": "https://reisememo.ch"}
HEADERS = {"User-Agent": "travel-ontology-visualization/1.0"}
BATCH = 50  # WP caps per_page at 100; 50 keeps URLs short for the WAF


def get_json(url: str, params: dict, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, impersonate="chrome120", timeout=60)
            if r.status_code == 200:
                return r.json()
            print(f"  HTTP {r.status_code} on {url} (attempt {attempt + 1})", file=sys.stderr)
        except Exception as exc:  # network errors: retry, then give up loudly
            print(f"  {type(exc).__name__}: {exc} (attempt {attempt + 1})", file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"giving up on {url}")


def pick_sizes(media: dict) -> tuple[str | None, str | None]:
    sizes = (media.get("media_details") or {}).get("sizes") or {}
    thumb = (sizes.get("thumbnail") or {}).get("source_url")
    src = next((sizes[k]["source_url"] for k in ("medium_large", "medium", "large") if k in sizes), None)
    full = media.get("source_url")
    return thumb or src or full, src or full


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True, choices=sorted(SITES))
    ap.add_argument("--limit", type=int, default=0, help="only the first N posts (smoke test)")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between requests")
    args = ap.parse_args()

    base = SITES[args.site]
    graph = json.loads((ROOT / "public" / "graph.json").read_text(encoding="utf-8"))
    ids = sorted(p["id"] for p in graph["posts"] if p["site"] == args.site)
    if args.limit:
        ids = ids[: args.limit]
    out = ROOT / ".cache" / "thumbs" / args.site
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}

    featured: dict[int, int] = {}
    for i in range(0, len(ids), BATCH):
        chunk = ids[i : i + BATCH]
        posts = get_json(f"{base}/wp-json/wp/v2/posts", {"include": ",".join(map(str, chunk)), "per_page": BATCH, "_fields": "id,featured_media"})
        featured.update({p["id"]: p.get("featured_media") or 0 for p in posts})
        time.sleep(args.delay)
    print(f"{args.site}: {len(featured)}/{len(ids)} posts answered, {sum(1 for m in featured.values() if m)} with a featured image")

    media_ids = sorted({m for m in featured.values() if m})
    media: dict[int, dict] = {}
    for i in range(0, len(media_ids), BATCH):
        chunk = media_ids[i : i + BATCH]
        rows = get_json(f"{base}/wp-json/wp/v2/media", {"include": ",".join(map(str, chunk)), "per_page": BATCH, "_fields": "id,source_url,media_details"})
        media.update({m["id"]: m for m in rows})
        time.sleep(args.delay)

    downloaded = skipped = failed = 0
    for pid in ids:
        mid = featured.get(pid)
        m = media.get(mid) if mid else None
        if not m:
            manifest[str(pid)] = None
            continue
        thumb, src = pick_sizes(m)
        ext = Path(thumb.split("?")[0]).suffix.lower() or ".jpg"
        target = out / f"{pid}{ext}"
        if target.exists() and target.stat().st_size > 0:
            skipped += 1
        else:
            # The 150px crop is sometimes missing on disk (404) while the larger
            # sizes exist; fall back to them rather than lose the tile's photo.
            for url in dict.fromkeys(u for u in (thumb, src, m.get("source_url")) if u):
                try:
                    r = requests.get(url, headers=HEADERS, impersonate="chrome120", timeout=60)
                    r.raise_for_status()
                    target = out / f"{pid}{Path(url.split('?')[0]).suffix.lower() or '.jpg'}"
                    target.write_bytes(r.content)
                    downloaded += 1
                    break
                except Exception as exc:
                    print(f"  post {pid}: {type(exc).__name__}: {exc} ({url})", file=sys.stderr)
            else:
                failed += 1
                continue
            time.sleep(args.delay)
        manifest[str(pid)] = {"file": target.name, "src": src, "media": mid}

    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    have = sum(1 for v in manifest.values() if v)
    print(f"{args.site}: downloaded {downloaded}, already had {skipped}, failed {failed}, manifest {have}/{len(ids)} with image")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
