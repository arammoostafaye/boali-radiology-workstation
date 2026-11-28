"""Subprocess runner for ONE Qure TorchScript suppression phase.

The two Qure traces (~420 MB each) cannot both stay resident on small
hosts, and loading even one inside the FastAPI process can push a 4 GB
machine into the Linux OOM killer (which silently kills the whole engine
service). Running each phase in a throwaway child process bounds the
peak to torch-runtime + one trace, and if the child is ever killed the
SERVICE SURVIVES and can return an honest error.

Numerics are identical to the in-process path: same trace file, same
1024x1024 INTER_AREA resize, same additive identities (soft = input −
bone, nonlung = soft − lung) — verbatim port of
BoneSuppression_Desktop.py:3706-3758.

Usage:
    python -m engines._bone_phase bone <trace> <input.npy> <soft.npy> <bone.npy>
    python -m engines._bone_phase lung <trace> <soft.npy>  <lung.npy> <nonlung.npy>
    prints one JSON line {ok, phase, elapsed_ms, peak_rss_mb} on stdout.
"""

from __future__ import annotations

import json
import resource
import sys
import time

import numpy as np

SIZE = 1024


def _peak_rss_mb() -> float:
    try:
        ru = resource.getrusage(resource.RUSAGE_SELF)
        return ru.ru_maxrss / 1024.0 if sys.platform != "win32" else 0.0
    except Exception:
        return 0.0


def main() -> int:
    try:
        which, trace_path, in_path, out_a, out_b = sys.argv[1:6]
        t0 = time.time()

        import cv2
        import torch

        arr = np.load(in_path).astype(np.float32)
        if which == "bone":
            # input is the ORIGINAL image -> verbatim 1024x1024 INTER_AREA
            t_in = torch.from_numpy(
                cv2.resize(arr, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
            ).unsqueeze(0).unsqueeze(0).float().to("cpu")
        else:
            # input is the already-1024x1024 soft-tissue 2-D array
            t_in = torch.from_numpy(arr).unsqueeze(0).unsqueeze(0).float().to("cpu")

        model = torch.jit.load(trace_path, map_location="cpu").eval()
        with torch.no_grad():
            out = model(t_in)
            comp = out[0] if isinstance(out, (list, tuple)) else out
            if which == "bone":
                # soft = input - bone (verbatim from 3732-3734); save 2-D
                np.save(out_a, (t_in - comp).squeeze().numpy())
                np.save(out_b, comp.squeeze().numpy())
            else:
                # nonlung = soft - lung (verbatim from 3735-3737); save 2-D
                np.save(out_a, comp.squeeze().numpy())
                np.save(out_b, (t_in - comp).squeeze().numpy())
        print(json.dumps({
            "ok": True,
            "phase": which,
            "elapsed_ms": round((time.time() - t0) * 1000),
            "peak_rss_mb": round(_peak_rss_mb(), 1),
        }))
        return 0
    except Exception as e:  # honest error surfaced to the service
        print(json.dumps({"ok": False, "phase": "?", "error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
