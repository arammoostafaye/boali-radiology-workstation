"""Idle memory guard — unloads torch models and 3D volume caches after a
period of inactivity so the engine service stays small on memory-constrained
machines (the sandbox host has 3.9 GB RAM and also runs the Next.js
dev server). Models reload lazily on the next inference request.
"""

from __future__ import annotations

import gc
import threading
import time

_IDLE_SEC = 180  # unload after 3 minutes without engine activity
_last_activity = time.time()
_lock = threading.Lock()


def touch() -> None:
    global _last_activity
    with _lock:
        _last_activity = time.time()


def seconds_idle() -> float:
    with _lock:
        return time.time() - _last_activity


def start(unload_hooks: list, idle_sec: float = _IDLE_SEC) -> None:
    """Start the background watcher. `unload_hooks` are callables that free
    engine memory (set model refs to None etc.). Safe to call repeatedly."""

    def loop() -> None:
        unloaded = False
        while True:
            time.sleep(20)
            if seconds_idle() > idle_sec:
                if not unloaded:
                    for hook in unload_hooks:
                        try:
                            hook()
                        except Exception:
                            pass
                    gc.collect()
                    unloaded = True
            else:
                unloaded = False

    t = threading.Thread(target=loop, daemon=True, name="boali-memwatch")
    t.start()
