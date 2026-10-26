#!/usr/bin/env python3
"""Download the arXiv paper PDFs listed in this folder.

This script is intentionally conservative:
- arXiv PDF URLs are downloaded as .pdf files
- HTML pages (like transformer-circuits) are skipped by default because they are not PDFs
- failed downloads are reported without aborting the full batch

Usage:
    python download_papers.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

OUTPUT_DIR = Path(__file__).resolve().parent

PAPERS = [
    "https://arxiv.org/pdf/2209.10652",
    "https://arxiv.org/pdf/2209.11895",
    "https://arxiv.org/pdf/2211.00593",
    "https://arxiv.org/pdf/2304.14997",
    "https://arxiv.org/pdf/2301.05217",
    "https://arxiv.org/pdf/2309.08600",
    "https://arxiv.org/pdf/2310.02207",
    "https://transformer-circuits.pub/2021/framework/index.html",
    "https://arxiv.org/pdf/2403.19647",
    "https://arxiv.org/pdf/2409.14507",
    "https://arxiv.org/pdf/2406.17969",
    "https://arxiv.org/pdf/2610.20139",
    "https://arxiv.org/pdf/2606.06333",
    "https://arxiv.org/pdf/2609.15533",
    "https://arxiv.org/pdf/2610.15850",
    "https://arxiv.org/pdf/2606.08292",
    "https://arxiv.org/pdf/2606.08365",
    "https://arxiv.org/pdf/2605.31518",
    "https://arxiv.org/pdf/2605.03160",
    "https://arxiv.org/pdf/2406.17969",
    "https://arxiv.org/pdf/2403.19647",
    "https://arxiv.org/pdf/2309.08600",
    "https://arxiv.org/pdf/2409.14507",
    "https://arxiv.org/pdf/2304.14997",
    "https://arxiv.org/pdf/2209.10652",
    "https://arxiv.org/pdf/2209.11895",
    "https://arxiv.org/pdf/2211.00593",
    "https://arxiv.org/pdf/2301.05217",
    "https://arxiv.org/pdf/2403.19647",
    "https://arxiv.org/pdf/2409.14507",
    "https://arxiv.org/pdf/2606.06333",
    "https://arxiv.org/pdf/2609.15533",
    "https://arxiv.org/pdf/2610.15850",
    "https://arxiv.org/pdf/2606.08292",
    "https://arxiv.org/pdf/2606.08365",
    "https://arxiv.org/pdf/2605.31518",
    "https://arxiv.org/pdf/2605.03160",
    "https://arxiv.org/pdf/2406.17969",
    "https://arxiv.org/pdf/2403.19647",
    "https://arxiv.org/pdf/2309.08600",
    "https://arxiv.org/pdf/2409.14507",
    "https://arxiv.org/pdf/2610.20139",
    "https://arxiv.org/pdf/2606.06333",
    "https://arxiv.org/pdf/2609.15533",
    "https://arxiv.org/pdf/2610.15850",
    "https://arxiv.org/pdf/2606.08292",
    "https://arxiv.org/pdf/2606.08365",
    "https://arxiv.org/pdf/2605.31518",
    "https://arxiv.org/pdf/2605.03160",
    "https://arxiv.org/pdf/2403.19647",
    "https://arxiv.org/pdf/2209.10652",
    "https://arxiv.org/pdf/2309.08600",
    "https://arxiv.org/pdf/2403.19647",
    "https://arxiv.org/pdf/2406.17969",
    "https://arxiv.org/pdf/2409.14507",
    "https://arxiv.org/pdf/2610.20139",
    "https://arxiv.org/pdf/2606.06333",
    "https://arxiv.org/pdf/2609.15533",
    "https://arxiv.org/pdf/2606.08292",
    "https://arxiv.org/pdf/2610.15850",
]


def to_safe_filename(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")

    # arXiv PDF names usually look like /pdf/<id>.pdf or /pdf/<id>
    if "arxiv.org" in parsed.netloc:
        match = re.search(r"/(?:pdf|abs)/([A-Za-z0-9.-]+)(?:\.pdf)?(?:/)?$", path)
        if match:
            return f"arxiv_{match.group(1)}.pdf"

    # Fallback for non-arXiv or HTML pages
    name = path.split("/")[-1] or "paper"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name or "paper"


def download_url(url: str, output_dir: Path) -> bool:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        print(f"[skip] invalid URL: {url}")
        return False

    # Skip the HTML page in the list because it is not a PDF.
    if "transformer-circuits.pub" in parsed.netloc:
        print(f"[skip] non-PDF page (manual download recommended): {url}")
        return False

    if "arxiv.org" not in parsed.netloc:
        print(f"[skip] unsupported host: {parsed.netloc} :: {url}")
        return False

    pdf_url = url
    if not pdf_url.endswith(".pdf"):
        pdf_url = f"https://arxiv.org/pdf/{re.search(r'/pdf/([A-Za-z0-9.-]+)', url).group(1)}.pdf"

    filename = to_safe_filename(pdf_url)
    dest = output_dir / filename

    try:
        response = requests.get(pdf_url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"[error] {url} -> {exc}")
        return False

    if "application/pdf" not in response.headers.get("Content-Type", "").lower():
        print(f"[warn] unexpected content type for {url}: {response.headers.get('Content-Type')}")

    with dest.open("wb") as handle:
        handle.write(response.content)

    print(f"[saved] {dest.name}")
    return True


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    success = 0
    failures = 0

    for url in PAPERS:
        key = url.rstrip("/")
        if key in seen:
            continue
        seen.add(key)

        if not download_url(url, OUTPUT_DIR):
            failures += 1
            continue
        success += 1

    print(f"\nCompleted: {success} downloaded, {failures} skipped/failed.")
    return 0 if success > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
