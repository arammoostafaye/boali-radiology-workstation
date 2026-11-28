#!/usr/bin/env python3
"""Boali silent service launcher.

Starts the three Boali services as fully DETACHED background processes
with NO console windows at all (hospital-friendly desktop):

    [1] boali-engine :3020  (FastAPI + torch inference)
    [2] boali-pacs   :3021  (FastAPI PACS archive)
    [3] boali-web    :3000  (Next.js workstation UI)

This replaces the old launcher that opened three visible CMD windows.
All service output is appended to  <root>/logs/*.log  instead, the
launcher waits until the web server actually answers HTTP and only then
opens the browser on http://localhost:3000.

Pure standard library - runs on the bundled embedded Python 3.12, the
fallback venv, or any system Python 3.8+.

Usage (from START-BOALI.bat):

    python tools/boali_launch.py --root "<ROOT>" --pyexe "<PYEXE>" --nodeexe "<NODEEXE>"
"""

from __future__ import annotations

import argparse
import datetime
import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ENGINE_PORT = 3020
PACS_PORT = 3021
WEB_PORT = 3000
WEB_URL = "http://localhost:3000"

# Rotate a log file once it passes this size (one ".old" generation kept).
LOG_MAX_BYTES = 10 * 1024 * 1024

# How long to wait for the web server before giving up (seconds). The
# production server answers in ~2 s; `next dev` on a slow machine can
# take over a minute to compile, so keep a generous ceiling.
WEB_TIMEOUT_S = 240

# ------------------------------------------------------------------
# Windows process creation flags: start each service with NO console
# window and fully detached from this launcher, so closing the START
# window can never kill the services. On non-Windows (dev/testing) the
# flags are simply zero.
# ------------------------------------------------------------------
CREATE_DETACHED = 0
if os.name == "nt":
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    CREATE_DETACHED = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP


def log(msg: str) -> None:
    """Progress line on the (one, short-lived) launcher console."""
    print(msg, flush=True)


def port_is_listening(port: int) -> bool:
    """True when something already accepts connections on this port."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return False


def open_log(path: str):
    """Append-mode utf-8 log with simple one-generation size rotation."""
    try:
        if os.path.exists(path) and os.path.getsize(path) > LOG_MAX_BYTES:
            try:
                os.remove(path + ".old")
            except OSError:
                pass
            os.replace(path, path + ".old")
    except OSError:
        pass
    return open(path, "a", buffering=1, encoding="utf-8", errors="replace")


def spawn(name: str, cmd: list, cwd: str, env_extra: dict, log_path: str, handles: list):
    """Start one service hidden + detached, output appended to its log."""
    fh = open_log(log_path)
    fh.write(
        "\n===== %s started %s =====\n"
        % (name, datetime.datetime.now().isoformat(timespec="seconds"))
    )
    fh.flush()
    env = os.environ.copy()
    env.update(env_extra)
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=fh,
            stderr=subprocess.STDOUT,
            creationflags=CREATE_DETACHED,
            close_fds=True,
            env=env,
        )
    except OSError as exc:
        fh.write("[launcher] FAILED to start %s: %s\n" % (name, exc))
        fh.close()
        log("[ERROR] Could not start %s: %s" % (name, exc))
        return None
    handles.append(fh)
    log(
        "[OK] %-6s started hidden (pid %s, log %s)"
        % (name, proc.pid, os.path.relpath(log_path).replace("\\", "/"))
    )
    return proc


def wait_for_web() -> bool:
    """Block until the web server answers HTTP on 127.0.0.1:WEB_PORT."""
    url = "http://127.0.0.1:%d/" % WEB_PORT
    log("[WAIT] Waiting for the web server on %s ..." % url)
    deadline = time.time() + WEB_TIMEOUT_S
    dots = 0
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status:
                    return True
        except Exception:
            pass
        time.sleep(1)
        dots += 1
        if dots % 15 == 0:
            log("      still waiting (%d s) - check logs/web.log if this takes long ..." % dots)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Boali silent service launcher")
    ap.add_argument("--root", required=True, help="Boali project root")
    ap.add_argument("--pyexe", required=True, help="Python interpreter to use")
    ap.add_argument("--nodeexe", required=True, help="Node.js interpreter to use")
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    logs_dir = os.path.join(root, "logs")
    os.makedirs(logs_dir, exist_ok=True)

    # ---- the three services ------------------------------------
    services = [
        (
            "engine",
            [args.pyexe, "-m", "uvicorn", "app:app",
             "--host", "127.0.0.1", "--port", str(ENGINE_PORT)],
            os.path.join(root, "mini-services", "boali-engine"),
            {},
            ENGINE_PORT,
            os.path.join(logs_dir, "engine.log"),
        ),
        (
            "pacs",
            [args.pyexe, "-m", "uvicorn", "app:app",
             "--host", "127.0.0.1", "--port", str(PACS_PORT)],
            os.path.join(root, "mini-services", "boali-pacs"),
            {},
            PACS_PORT,
            os.path.join(logs_dir, "pacs.log"),
        ),
    ]

    # Production path: webapp/server.js is the PREBUILT standalone
    # Next.js server (~2 s start). Source-checkout path: `next dev`.
    webapp_dir = os.path.join(root, "webapp")
    if os.path.exists(os.path.join(webapp_dir, "server.js")):
        web_cmd = [args.nodeexe, "server.js"]
        web_cwd = webapp_dir
        web_env = {"PORT": str(WEB_PORT), "HOSTNAME": "127.0.0.1"}
    else:
        web_cmd = [args.nodeexe,
                   os.path.join("node_modules", "next", "dist", "bin", "next"),
                   "dev", "-p", str(WEB_PORT), "--webpack"]
        web_cwd = root
        web_env = {}
    services.append(
        ("web", web_cmd, web_cwd, web_env, WEB_PORT, os.path.join(logs_dir, "web.log"))
    )

    # ---- start everything --------------------------------------
    handles = []
    pids = []
    started = 0
    for name, cmd, cwd, env_extra, port, log_path in services:
        if port_is_listening(port):
            log("[SKIP] %-5s is already running on port %d - not started twice."
                % (name, port))
            pids.append((name, "already-running"))
            continue
        if name == "web":
            if web_cwd != root:
                log("[OK] Prebuilt production web app found - starts in ~2 seconds.")
            else:
                log("[OK] Source checkout - starting the web app in dev mode.")
        proc = spawn(name, cmd, cwd, env_extra, log_path, handles)
        if proc is not None:
            pids.append((name, str(proc.pid)))
            started += 1
        time.sleep(1)  # tiny stagger: gentler on a cold hospital disk

    # remember which pids we own (informational; STOP-BOALI.bat uses ports)
    try:
        with open(os.path.join(logs_dir, "pids.txt"), "w", encoding="utf-8") as f:
            f.write("# boali services started %s\n"
                    % datetime.datetime.now().isoformat(timespec="seconds"))
            for name, pid in pids:
                f.write("%s %s\n" % (name, pid))
    except OSError:
        pass

    if started == 0 and all(p == "already-running" for _, p in pids):
        log("[OK] All services were already running.")
    else:
        log("[START] %d service(s) launched in the background - no console windows." % started)

    # ---- wait for the web UI, then open the browser --------------
    if port_is_listening(WEB_PORT) and started == 0:
        ok = True
    else:
        ok = wait_for_web()

    if ok:
        log("[OK] Web server is up - opening the browser ...")
    else:
        log("[WARN] The web server did not answer within %d s." % WEB_TIMEOUT_S)
        log("       Look into logs/web.log (and logs/engine.log) for the reason.")
    try:
        webbrowser.open(WEB_URL)
    except Exception:
        pass

    for fh in handles:
        try:
            fh.close()
        except OSError:
            pass
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
