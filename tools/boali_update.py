#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Boali in-app updater — delta updates over the GitHub release zip.

Only the files that actually CHANGED are downloaded: the release zip is
mounted remotely via HTTP Range requests (GitHub's CDN supports them),
its central directory is read first, and then just the byte ranges of
the needed members are fetched and decompressed. A 1.2 GB release with
30 MB of changes costs ~30 MB of traffic.

Flow:
  1. read {root}/VERSION
  2. GitHub API -> latest release tag + assets
  3. download the small manifest.json asset (path/size/sha256 per file)
  4. compare with local files -> needed list
  5. Range-fetch EOCD + central directory of the release zip
  6. Range-fetch + inflate ONLY the needed members -> .update/staging
  7. verify sha256, apply atomically (os.replace), write VERSION
  8. restart the three services (ports 3000/3020/3021 -> boali_launch)

Usage:
  python tools/boali_update.py --root C:\\Boali [--repo owner/name]
      [--token GH_TOKEN] [--check-only] [--no-restart]

State file (for the web UI): {root}/.update/state.json
"""

import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time
import urllib.request
import urllib.error
import zlib

DEFAULT_REPO = "arammoostafaye/boali-radiology-workstation"
STATE_DIR_NAME = ".update"
STAGE_DIR_NAME = "staging"
LOG_MANIFEST = "manifest.json"
LOG_VERSION = "VERSION"
CHUNK = 64 * 1024
TIMEOUT = 60


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def log(msg):
    print("[boali-update] %s" % msg, flush=True)


def read_state(root):
    p = os.path.join(root, STATE_DIR_NAME, "state.json")
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def write_state(root, **fields):
    d = os.path.join(root, STATE_DIR_NAME)
    try:
        os.makedirs(d, exist_ok=True)
        cur = read_state(root)
        cur.update(fields)
        cur["ts"] = time.time()
        with open(os.path.join(d, "state.json"), "w", encoding="utf-8") as fh:
            json.dump(cur, fh, ensure_ascii=False, indent=1)
    except Exception as e:  # never crash the update for state problems
        log("state write failed: %s" % e)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(CHUNK)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def http_get(url, headers=None, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_range(url, start, end, headers=None, timeout=TIMEOUT):
    """fetch bytes [start, end] inclusive; returns None if unsupported"""
    h = {"Range": "bytes=%d-%d" % (start, end)}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status not in (200, 206):
                return None
            data = resp.read()
            if resp.status == 200:
                # server ignored the Range — slice ourselves
                return data[start : end + 1]
            return data
    except urllib.error.HTTPError as e:
        if e.code == 416:
            return b""
        raise


def api_headers(token):
    h = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "boali-updater",
    }
    if token:
        h["Authorization"] = "Bearer %s" % token
    return h


# --------------------------------------------------------------------------
# zip central-directory reader (range-based, no full download)
# --------------------------------------------------------------------------

def fetch_eocd(zip_url, headers):
    """return (cd_offset, cd_size, total_size) using a ranged tail read"""
    tail_len = 65557  # max EOCD + comment
    first = True
    while True:
        # we need total size: do a tiny ranged HEAD-ish probe first
        if first:
            # get total size via a 1-byte range (also verifies Range support)
            probe = http_get_range(zip_url, 0, 0, headers)
            # status 206 means ranges work; but we still need total length.
            req = urllib.request.Request(zip_url, headers=dict(headers or {}))
            req.get_method = lambda: "HEAD"
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                total = int(resp.headers.get("Content-Length", "0") or 0)
            if total <= 0:
                raise RuntimeError("release zip size unknown (no Content-Length)")
            if probe is None or len(probe) != 1:
                raise RuntimeError(
                    "the CDN does not support Range requests — cannot do a delta update"
                )
            first = False
        start = max(0, total - tail_len)
        tail = http_get_range(zip_url, start, total - 1, headers)
        if tail is None:
            raise RuntimeError("tail range read failed")
        # find EOCD signature 0x06054b50 scanning backwards
        idx = tail.rfind(b"PK\x05\x06")
        if idx >= 0 and (len(tail) - idx) >= 22:
            cd_size = struct.unpack_from("<I", tail, idx + 12)[0]
            cd_off = struct.unpack_from("<I", tail, idx + 16)[0]
            if cd_off != 0xFFFFFFFF and cd_size != 0xFFFFFFFF:
                return cd_off, cd_size, total
        raise RuntimeError("EOCD not found (zip64 or corrupt archive)")


def fetch_central_directory(zip_url, headers, cd_off, cd_size):
    blob = http_get_range(zip_url, cd_off, cd_off + cd_size - 1, headers)
    if blob is None or len(blob) != cd_size:
        raise RuntimeError("central directory range read failed")
    entries = {}
    pos = 0
    while pos + 46 <= len(blob):
        if blob[pos : pos + 4] != b"PK\x01\x02":
            break
        (method,) = struct.unpack_from("<H", blob, pos + 10)
        (comp_size,) = struct.unpack_from("<I", blob, pos + 20)
        (name_len, extra_len, comment_len) = struct.unpack_from("<HHH", blob, pos + 28)
        (local_off,) = struct.unpack_from("<I", blob, pos + 42)
        name = blob[pos + 46 : pos + 46 + name_len].decode("utf-8", "replace")
        # zip64 extra field fix-ups
        if local_off == 0xFFFFFFFF or comp_size == 0xFFFFFFFF:
            extra = blob[pos + 46 + name_len : pos + 46 + name_len + extra_len]
            epos = 0
            while epos + 4 <= len(extra):
                (xid, xsz) = struct.unpack_from("<HH", extra, epos)
                if xid == 0x0001:
                    vals = extra[epos + 4 : epos + 4 + xsz]
                    vpos = 0
                    if comp_size == 0xFFFFFFFF and vpos + 8 <= len(vals):
                        (comp_size,) = struct.unpack_from("<Q", vals, vpos)
                        vpos += 8
                    if local_off == 0xFFFFFFFF and vpos + 8 <= len(vals):
                        (local_off,) = struct.unpack_from("<Q", vals, vpos)
                    break
                epos += 4 + xsz
        entries[name] = {
            "method": method,
            "comp_size": comp_size,
            "local_off": local_off,
        }
        pos += 46 + name_len + extra_len + comment_len
    return entries


def fetch_member(zip_url, headers, entry, max_span=512 * 1024 * 1024):
    """ranged fetch + inflate of ONE zip member; returns its bytes"""
    off = entry["local_off"]
    # read the local header first (30 bytes + names)
    head = http_get_range(zip_url, off, off + 29, headers)
    if head is None or len(head) < 30 or head[:4] != b"PK\x03\x04":
        raise RuntimeError("local header read failed")
    (name_len, extra_len) = struct.unpack_from("<HH", head, 26)
    data_start = off + 30 + name_len + extra_len
    comp = entry["comp_size"]
    if comp > max_span:
        raise RuntimeError("member too large for a ranged fetch (%d bytes)" % comp)
    blob = http_get_range(zip_url, data_start, data_start + comp - 1, headers)
    if blob is None or len(blob) != comp:
        raise RuntimeError("member data read failed (got %d of %d)" % (len(blob or b""), comp))
    if entry["method"] == 0:
        return blob
    if entry["method"] == 8:
        d = zlib.decompressobj(-15)
        return d.decompress(blob) + d.flush()
    raise RuntimeError("unsupported compression method %d" % entry["method"])


# --------------------------------------------------------------------------
# service restart (same ports as STOP-BOALI / boali_launch)
# --------------------------------------------------------------------------

PORTS = (3000, 3020, 3021)


def pids_on_ports():
    pids = set()
    if os.name == "nt":
        try:
            out = subprocess.run(
                ["netstat", "-aon", "-p", "tcp"],
                capture_output=True, text=True, timeout=30,
            ).stdout
            for line in out.splitlines():
                low = line.lower()
                if "listening" not in low:
                    continue
                for port in PORTS:
                    if ":%d " % port in low or ":%d\t" % port in low:
                        parts = line.split()
                        if parts:
                            pids.add(parts[-1])
        except Exception as e:
            log("netstat failed: %s" % e)
    else:
        try:
            out = subprocess.run(
                ["ss", "-tlnp"],
                capture_output=True, text=True, timeout=30,
            ).stdout
            for line in out.splitlines():
                for port in PORTS:
                    if ":%d " % port in line:
                        m = re.search(r"pid=(\d+)", line)
                        if m:
                            pids.add(m.group(1))
        except Exception as e:
            log("ss failed: %s" % e)
    return pids


def restart_services(root):
    killed = []
    for pid in pids_on_ports():
        if pid in ("0",):
            continue
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", pid, "/T", "/F"],
                    capture_output=True, timeout=30,
                )
            else:
                os.kill(int(pid), 15)
            killed.append(pid)
        except Exception as e:
            log("could not kill pid %s: %s" % (pid, e))
    log("stopped services: %s" % (killed or "none"))

    # relaunch exactly like START-BOALI (hidden, detached)
    root = os.path.abspath(root)
    py = sys.executable
    launcher = os.path.join(root, "tools", "boali_launch.py")
    if not os.path.exists(launcher):
        log("launcher not found (%s) — start manually" % launcher)
        return
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED | NEW_PROCESS_GROUP
    log_file = os.path.join(root, STATE_DIR_NAME, "restart.log")
    fh = open(log_file, "ab", buffering=0)
    try:
        subprocess.Popen(
            [py, launcher, "--root", root, "--pyexe", py,
             "--nodeexe", os.path.join(root, "runtime", "node", "node.exe")],
            cwd=root, stdout=fh, stderr=fh, stdin=subprocess.DEVNULL,
            **kwargs
        )
    finally:
        time.sleep(2)
        fh.close()
    log("services relaunched via boali_launch.py")


# --------------------------------------------------------------------------
# main update flow
# --------------------------------------------------------------------------

def sanitize_rel_path(p):
    p = p.replace("\\", "/").strip()
    if not p or p.startswith("/") or ".." in p.split("/"):
        return None
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--repo", default=os.environ.get("BOALI_UPDATE_REPO", DEFAULT_REPO))
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN")
                    or os.environ.get("BOALI_GH_TOKEN"))
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--no-restart", action="store_true")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    write_state(root, phase="checking", error=None)

    # ---- 1. current version ------------------------------------------
    cur = ""
    try:
        with open(os.path.join(root, LOG_VERSION), "r", encoding="utf-8") as fh:
            cur = fh.read().strip()
    except Exception:
        pass
    if not cur:
        cur = "unknown"
    log("current version: %s" % cur)

    # ---- 2. latest release -------------------------------------------
    write_state(root, phase="fetch-release")
    api = "https://api.github.com/repos/%s/releases/latest" % args.repo
    try:
        rel = json.loads(http_get(api, api_headers(args.token)).decode("utf-8"))
    except Exception as e:
        write_state(root, phase="error", error="GitHub API: %s" % e)
        log("github api failed: %s" % e)
        return 1
    latest = (rel.get("tag_name") or "").strip()
    if not latest:
        write_state(root, phase="error", error="latest release has no tag")
        return 1
    log("latest release: %s" % latest)
    if latest == cur:
        write_state(root, phase="up-to-date", current=cur, latest=latest)
        log("already up to date.")
        return 0

    assets = {a.get("name"): a for a in rel.get("assets", [])}
    man_asset = assets.get("manifest.json")
    zip_asset = next(
        (a for n, a in assets.items() if n.endswith(".zip")), None
    )
    if not man_asset or not zip_asset:
        write_state(root, phase="error",
                    error="release has no manifest.json / zip asset")
        log("release assets incomplete: %s" % list(assets))
        return 1

    # ---- 3. manifest --------------------------------------------------
    write_state(root, phase="manifest")
    try:
        manifest = json.loads(
            http_get(man_asset["browser_download_url"], api_headers(args.token)).decode("utf-8")
        )
    except Exception as e:
        write_state(root, phase="error", error="manifest download: %s" % e)
        return 1
    files = manifest.get("files") or []
    log("manifest: %d files" % len(files))

    # ---- 4. diff --------------------------------------------------------
    write_state(root, phase="comparing")
    needed = []
    for f in files:
        rel_path = sanitize_rel_path(f.get("path", ""))
        if not rel_path:
            continue
        local = os.path.join(root, *rel_path.split("/"))
        want = f.get("sha256", "")
        if not want:
            continue
        try:
            if os.path.isfile(local) and sha256_file(local) == want:
                continue
        except Exception:
            pass
        needed.append((rel_path, want, f.get("size", 0)))

    total_bytes = sum(n[2] for n in needed)
    log("files needing update: %d (%.1f MB)" % (len(needed), total_bytes / 1048576.0))
    write_state(root, phase="checked", current=cur, latest=latest,
                changed=len(needed), changed_bytes=total_bytes)

    if args.check_only or not needed:
        if not needed:
            # same tag but files drifted? adopt the tag anyway
            try:
                with open(os.path.join(root, LOG_VERSION), "w", encoding="utf-8") as fh:
                    fh.write(latest)
            except Exception:
                pass
            write_state(root, phase="up-to-date", current=latest, latest=latest)
            log("no file changes needed.")
        return 0

    # ---- 5. remote zip index -------------------------------------------
    write_state(root, phase="indexing-zip", changed=len(needed))
    zip_url = zip_asset["browser_download_url"]
    dl_headers = {"User-Agent": "boali-updater"}
    try:
        cd_off, cd_size, total = fetch_eocd(zip_url, dl_headers)
        entries = fetch_central_directory(zip_url, dl_headers, cd_off, cd_size)
    except Exception as e:
        write_state(root, phase="error", error="zip index: %s" % e)
        log("zip indexing failed: %s" % e)
        return 1
    log("zip indexed: %d entries, %.0f MB total" % (len(entries), total / 1048576.0))

    # ---- 6. ranged download of only the needed members ------------------
    staging = os.path.join(root, STATE_DIR_NAME, STAGE_DIR_NAME)
    if os.path.isdir(staging):
        import shutil

        shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)

    done = 0
    for rel_path, want, _size in needed:
        write_state(root, phase="downloading", changed=len(needed),
                    done=done, current_file=rel_path)
        member = "Boali/" + rel_path
        entry = entries.get(member)
        if entry is None:
            log("  !! %s missing from the zip — skipped" % rel_path)
            continue
        try:
            data = fetch_member(zip_url, dl_headers, entry)
        except Exception as e:
            write_state(root, phase="error", error="%s: %s" % (rel_path, e))
            log("  !! %s failed: %s" % (rel_path, e))
            return 1
        got = hashlib.sha256(data).hexdigest()
        if got != want:
            write_state(root, phase="error",
                        error="%s: sha256 mismatch after download" % rel_path)
            log("  !! %s sha256 mismatch" % rel_path)
            return 1
        dest = os.path.join(staging, *rel_path.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
        done += 1
        log("  ok %s (%.1f KB)" % (rel_path, len(data) / 1024.0))

    # ---- 7. apply --------------------------------------------------------
    write_state(root, phase="applying", changed=len(needed), done=done)
    applied = 0
    for rel_path, want, _size in needed:
        src = os.path.join(staging, *rel_path.split("/"))
        if not os.path.isfile(src):
            continue
        dest = os.path.join(root, *rel_path.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        # keep one .bak generation for safety
        try:
            if os.path.isfile(dest):
                os.replace(dest, dest + ".bak")
        except Exception:
            pass
        os.replace(src, dest)
        try:
            if os.path.isfile(dest + ".bak"):
                os.remove(dest + ".bak")
        except Exception:
            pass
        applied += 1
    log("applied %d files" % applied)

    try:
        with open(os.path.join(root, LOG_VERSION), "w", encoding="utf-8") as fh:
            fh.write(latest)
    except Exception:
        pass

    # persist the manifest so future updates can also compute deletions
    try:
        with open(os.path.join(root, STATE_DIR_NAME, "manifest.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(manifest, fh)
    except Exception:
        pass

    # ---- 8. restart ------------------------------------------------------
    if args.no_restart:
        write_state(root, phase="applied", current=latest, latest=latest,
                    applied=applied, restart=False)
        log("restart skipped (--no-restart).")
        return 0

    write_state(root, phase="restarting", current=latest, latest=latest,
                applied=applied)
    restart_services(root)
    write_state(root, phase="done", current=latest, latest=latest,
                applied=applied, restart=True)
    log("update complete: %s -> %s" % (cur, latest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
