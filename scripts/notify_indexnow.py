#!/usr/bin/env python3
"""Tells Bing (and other IndexNow search engines) that the site's pages changed.

Run after a deploy has gone live:   python3 scripts/notify_indexnow.py
Pass specific URLs to send only those:
    python3 scripts/notify_indexnow.py https://safemergefiles.com/compress-pdf/
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_pages import INDEXNOW_KEY, ROOT, SITE_URL  # noqa: E402

def main():
    urls = sys.argv[1:] or re.findall(r"<loc>(.*?)</loc>", (ROOT / "sitemap.xml").read_text())
    host = SITE_URL.split("://", 1)[1]
    body = json.dumps({"host": host, "key": INDEXNOW_KEY,
                       "keyLocation": f"{SITE_URL}/{INDEXNOW_KEY}.txt", "urlList": urls}).encode()
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"IndexNow accepted {len(urls)} URLs (HTTP {r.status}).")
    except urllib.error.HTTPError as e:
        print(f"IndexNow refused the request: HTTP {e.code} {e.read()[:200]!r}")
        sys.exit(1)

if __name__ == "__main__":
    main()
