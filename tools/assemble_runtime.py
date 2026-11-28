#!/usr/bin/env python3
"""Assemble and verify the bundled offline Python runtime (Windows wheels).

Why: the repository ships every wheel needed to install the engine's Python
dependencies on Windows 64-bit (CPython 3.12) WITHOUT internet. The torch
wheel (109 MB) is over GitHub's 100 MiB per-file limit, so it is stored
split into < 100 MB pieces under `runtime/wheels/chunks/`. This script glues
it back together and verifies every wheel (byte size + SHA-256) against
`runtime/MANIFEST.txt`.

Usage (run from anywhere, paths resolve relative to this file):
    python tools/assemble_runtime.py            # assemble + verify
    python tools/assemble_runtime.py --check    # verify only, exit 1 on bad
    python tools/assemble_runtime.py --force    # rebuild even if present

Exit codes: 0 = all wheels present & valid, 1 = failure (with message).
"""

from __future__ import annotations

import hashlib
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHEELS_DIR = os.path.join(REPO_ROOT, "runtime", "wheels")
CHUNKS_DIR = os.path.join(WHEELS_DIR, "chunks")
MANIFEST = os.path.join(REPO_ROOT, "runtime", "MANIFEST.txt")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def parse_manifest() -> list[tuple[str, int, str]]:
    entries: list[tuple[str, int, str]] = []
    with open(MANIFEST, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, size, digest = line.split()
            entries.append((name, int(size), digest))
    return entries


def chunk_names(name: str) -> list[str]:
    """Ordered chunk file paths for a split wheel (.00, .01, ...)."""
    names = []
    i = 0
    while True:
        candidate = os.path.join(CHUNKS_DIR, f"{name}.{i:02d}")
        if not os.path.isfile(candidate):
            break
        names.append(candidate)
        i += 1
    return names


def main() -> int:
    check_only = "--check" in sys.argv
    force = "--force" in sys.argv

    if not os.path.isfile(MANIFEST):
        print(f"[ERROR] manifest not found: {MANIFEST}")
        return 1

    entries = parse_manifest()
    if not entries:
        print("[ERROR] manifest is empty")
        return 1

    failed = False
    for name, size, digest in entries:
        target = os.path.join(WHEELS_DIR, name)
        chunks = chunk_names(name)
        needs_build = force or not os.path.isfile(target) or os.path.getsize(target) != size

        if needs_build:
            if not chunks:
                print(f"[MISSING] {name} - not stored whole and no chunks available")
                failed = True
                continue
            if check_only:
                print(f"[MISSING] {name} ({size} bytes) - run without --check to assemble")
                failed = True
                continue
            print(f"[ASSEMBLE] {name}: joining {len(chunks)} chunk(s) ...")
            with open(target, "wb") as out:
                for chunk in chunks:
                    with open(chunk, "rb") as src:
                        for block in iter(lambda: src.read(1024 * 1024), b""):
                            out.write(block)

        actual_size = os.path.getsize(target)
        if actual_size != size:
            print(f"[BAD SIZE] {name}: expected {size}, got {actual_size}")
            failed = True
            continue

        print(f"[VERIFY] {name} ({size} bytes) sha256 ...", end=" ", flush=True)
        if sha256_file(target) == digest:
            print("OK")
        else:
            print("FAILED")
            failed = True

    if failed:
        print("\nResult: FAILED - at least one runtime wheel is missing or corrupt.")
        return 1
    print("\nResult: offline runtime wheels present and verified (win_amd64, CPython 3.12).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
