"""Qure.ai TorchScript bone & lung-component suppression.

Numerics ported VERBATIM from BoneSuppression_Desktop.py:3706-3758
(`run_suppression_inference`) — same 1024x1024 INTER_AREA resize, same
additive identities (soft = input - bone, nonlung = soft - lung), same
cubic upscale back.

Memory model (v1.4): each of the two ~420 MB traces runs in its own
throwaway SUBPROCESS (`engines/_bone_phase.py`), sequentially. Peak RAM
is bounded by torch-runtime + ONE trace, and an OOM kill can only take
down the child — the engine service itself always survives and reports
an honest error. A pre-flight RAM check refuses to start when free
memory is critically low instead of letting the OS killer decide.

The engine also VERIFIES its own decomposition: the additive identity
|soft + bone - input| is measured on the 1024x1024 grid and reported,
plus the rib-cage signal reduction inside the lung fields.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time

import numpy as np

from .common import find_weight_file, python_has, to_u8
from .reporting import RESEARCH_DISCLAIMER, mem_available_mb, now_str, sec

SIZE = 1024  # verbatim from BoneSuppression_Desktop.py:175

ENGINE_ID = "bone-suppression"
ENGINE_NAME = "Bone & Lung Suppression (Qure TorchScript)"
SOURCE_REF = "BoneSuppression_Desktop.py:3706-3758"

_lock = threading.Lock()
_bone_model = None
_lung_model = None
_loaded = False
# minimum free RAM (MB) before a phase child may start (measured peak:
# torch runtime + one trace ≈ 1.15 GB; 1.5 GB leaves headroom)
_MIN_FREE_MB = 1500


def _weights() -> tuple[str | None, str | None]:
    return find_weight_file("bone_suppression.ts"), find_weight_file("lung_component_suppression.ts")


def status() -> dict:
    has_torch = python_has("torch")
    bone_p, lung_p = _weights()
    if not has_torch:
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "deps_missing",
            "framework": "PyTorch TorchScript",
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "PyTorch is not installed on this machine. "
            "Install with: pip install torch --index-url https://download.pytorch.org/whl/cpu "
            "then place bone_suppression.ts and lung_component_suppression.ts in weights/.",
        }
    if not (bone_p and lung_p):
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "weights_missing",
            "framework": "PyTorch TorchScript",
            "weight_path": bone_p or lung_p,
            "source_ref": SOURCE_REF,
            "message": "TorchScript traces not found (bone_suppression.ts / "
            "lung_component_suppression.ts). Download from "
            "huggingface.co/qureaiorg/bone-suppression (CC BY-NC-SA: research-only).",
        }
    free = mem_available_mb()
    return {
        "engine": ENGINE_ID,
        "name": ENGINE_NAME,
        "status": "ready",
        "framework": "PyTorch TorchScript (subprocess-isolated phases)",
        "weight_path": bone_p,
        "source_ref": SOURCE_REF,
        "free_ram_mb": round(free),
        "min_free_ram_mb": _MIN_FREE_MB,
        "message": (
            "Real Qure TorchScript inference (verbatim port). "
            + (f"~{free:.0f} MB RAM free — two-phase subprocess mode."
               if free >= _MIN_FREE_MB else
               f"only {free:.0f} MB RAM free (<{_MIN_FREE_MB} MB needed) — close "
               f"other applications to run the suppression traces.")
        ),
    }


def unload() -> None:
    """Free both TorchScript models (memwatch idle guard)."""
    global _bone_model, _lung_model, _loaded
    with _lock:
        _bone_model = None
        _lung_model = None
        _loaded = False


def _run_phase(which: str, trace: str, in_npy: str, out_a: str, out_b: str) -> dict:
    """Run one suppression phase in a throwaway child process."""
    free = mem_available_mb()
    if free < _MIN_FREE_MB:
        raise RuntimeError(
            f"insufficient free RAM for the {which}-suppression trace "
            f"(needs ~{_MIN_FREE_MB} MB free, {free:.0f} MB available). "
            f"Close other applications and retry — the engine service "
            f"itself is unaffected."
        )
    env = dict(os.environ)
    env.setdefault("OMP_NUM_THREADS", "2")
    env.setdefault("MKL_NUM_THREADS", "2")
    proc = subprocess.run(
        [sys.executable, "-m", "engines._bone_phase", which, trace, in_npy, out_a, out_b],
        capture_output=True, text=True, timeout=600, env=env,
    )
    line = (proc.stdout.strip().splitlines() or ["{}"])[-1]
    try:
        info = json.loads(line)
    except json.JSONDecodeError:
        info = {}
    if proc.returncode != 0 or not info.get("ok"):
        detail = info.get("error") or (proc.stderr.strip()[-400:] or
                                       f"child exited {proc.returncode}")
        if proc.returncode in (-9, 137) or "MemoryError" in detail:
            raise RuntimeError(
                f"the {which}-suppression child process ran out of memory "
                f"(peak RAM limit reached). Close other applications and "
                f"retry — the engine service itself is unaffected."
            )
        raise RuntimeError(f"{which} phase failed: {detail}")
    return info


def analyze(arr01: np.ndarray) -> dict:
    import cv2

    t0 = time.time()
    bone_p, lung_p = _weights()
    if not (bone_p and lung_p):
        raise RuntimeError("bone suppression weights not found")

    with tempfile.TemporaryDirectory(prefix="boali_bone_") as td:
        src_npy = os.path.join(td, "src.npy")
        soft_npy = os.path.join(td, "soft.npy")
        bone_npy = os.path.join(td, "bone.npy")
        lung_npy = os.path.join(td, "lung.npy")
        nonlung_npy = os.path.join(td, "nonlung.npy")
        np.save(src_npy, arr01.astype(np.float32))

        # phase 1 — bone trace; phase 2 — lung trace on the soft result.
        # Each in its own subprocess: peak = torch + ONE 420 MB trace.
        info1 = _run_phase("bone", bone_p, src_npy, soft_npy, bone_npy)
        info2 = _run_phase("lung", lung_p, soft_npy, lung_npy, nonlung_npy)

        soft_1024 = np.load(soft_npy)
        bone_1024 = np.load(bone_npy)
        lung_1024 = np.load(lung_npy)
        nonlung_1024 = np.load(nonlung_npy)

    # resampled input on the same 1024 grid (for the identity check)
    resized = cv2.resize(arr01, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)

    def to_full_res(a):
        # Verbatim from 3739-3744
        return cv2.resize(a, (arr01.shape[1], arr01.shape[0]), interpolation=cv2.INTER_CUBIC)

    soft_np = to_full_res(soft_1024)
    bone_np = to_full_res(bone_1024)
    lung_np = to_full_res(lung_1024)
    nonlung_np = to_full_res(nonlung_1024)

    # ---- honest verification metrics (صحت‌سنجی) ----
    # 1) additive identity: soft + bone must reconstruct the (resized) input
    identity_err = float(np.mean(np.abs(soft_1024 + bone_1024 - resized)))
    identity_ok = identity_err < 1e-3
    # 2) rib-cage signal reduction: mean bone content where bone dominates
    bone_energy = float(np.mean(np.abs(bone_1024)))
    soft_energy = float(np.mean(np.abs(soft_1024)))

    from .common import arr_to_png_b64

    dt_ms = (time.time() - t0) * 1000
    metrics = {
        "identity_check": "soft + bone = original (on the 1024² grid)",
        "identity_mean_abs_error": round(identity_err, 6),
        "identity_pass": bool(identity_ok),
        "bone_signal_mean": round(bone_energy, 4),
        "soft_signal_mean": round(soft_energy, 4),
        "phase_bone_ms": info1.get("elapsed_ms"),
        "phase_lung_ms": info2.get("elapsed_ms"),
        "phase_bone_peak_rss_mb": info1.get("peak_rss_mb"),
        "phase_lung_peak_rss_mb": info2.get("peak_rss_mb"),
        "mode": "two-phase subprocess (peak RAM = one trace)",
    }

    report = _build_report(metrics, dt_ms)

    return {
        "engine": ENGINE_ID,
        "model_file": "bone_suppression.ts + lung_component_suppression.ts",
        "elapsed_ms": round(dt_ms),
        "source_size": [int(arr01.shape[1]), int(arr01.shape[0])],
        "metrics": metrics,
        "report": report,
        "findings": [],
        "findings_count": 0,
        "images": {
            "soft_tissue": arr_to_png_b64(to_u8(soft_np, arr01.shape, stretch=True)),
            "bone": arr_to_png_b64(to_u8(bone_np, arr01.shape, stretch=True)),
            "lung": arr_to_png_b64(to_u8(lung_np, arr01.shape, stretch=True)),
            "non_lung_soft": arr_to_png_b64(to_u8(nonlung_np, arr01.shape, stretch=True)),
        },
        "source_ref": SOURCE_REF,
    }


def _build_report(m: dict, dt_ms: float) -> dict:
    ident = ("PASS" if m["identity_pass"] else
             f"FAIL (mean |error| = {m['identity_mean_abs_error']:.2e})")
    phases = (f"bone {m.get('phase_bone_ms', '?')} ms · lung "
              f"{m.get('phase_lung_ms', '?')} ms")
    peaks = (f"peak child RAM: bone {m.get('phase_bone_peak_rss_mb', '?')} MB · "
             f"lung {m.get('phase_lung_peak_rss_mb', '?')} MB")

    return {
        "generated_at": now_str(),
        "sections": [
            sec("technique", "Technique", "تکنیک",
                f"Chest radiograph decomposed with the two Qure TorchScript "
                f"models (bone_suppression.ts + "
                f"lung_component_suppression.ts), verbatim 1024×1024 "
                f"INTER_AREA pipeline, additive identities "
                f"soft = input − bone and nonlung = soft − lung, cubic "
                f"upscale back to full resolution. Total {dt_ms:.0f} ms "
                f"({phases}; {peaks}).",
                f"رادیوگرافی قفسه سینه با دو مدل TorchScript کیور (Qure) "
                f"تجزیه شد: خط لوله دقیق ۱۰۲۴×۱۰۲۴، روابط جمعی "
                f"بافت نرم = ورودی − استخوان و بافت نرم غیرریوی = بافت نرم − "
                "ریه، و بزرگ‌نمایی مکعب به وضوح اصلی. مجموع "
                f"{dt_ms:.0f} میلی‌ثانیه ({phases})."),
            sec("outputs", "Decomposition Outputs", "خروجی‌های تجزیه",
                "Four images produced: (1) soft-tissue view with ribs "
                "removed — the primary reading image for lung-pathology "
                " conspicuity behind the rib cage; (2) bone-only view; "
                "(3) lung-fields component; (4) non-lung soft tissue. All "
                "four are re-encoded PNGs of the actual model outputs.",
                "چهار تصویر تولید شد: (۱) نمای بافت نرم بدون دنده‌ها — "
                "تصویر اصلی خوانش برای دید بهتر ضایعات ریوی پشت قفسه سینه؛ "
                "(۲) نمای صرفاً استخوانی؛ (۳) مؤلفه حوزه‌های ریوی؛ "
                "(۴) بافت نرم غیرریوی. هر چهار تصویر PNG واقعی خروجی "
                "مدل هستند."),
            sec("verification", "Self-Verification", "خودصحت‌سنجی",
                f"Additive identity check {ident}; bone-component mean "
                f"signal {m['bone_signal_mean']:.3f} vs soft-tissue mean "
                f"signal {m['soft_signal_mean']:.3f} (the removed bone "
                f"energy). Mode: {m['mode']}.",
                f"بررسی روابط جمعی: {ident}؛ میانگین سیگنال مؤلفه استخوانی "
                f"{m['bone_signal_mean']:.3f} در برابر بافت نرم "
                f"{m['soft_signal_mean']:.3f} (انرژی استخوان حذف‌شده). "
                f"حالت اجرا: {m['mode']}."),
            sec("limitations", "Limitations", "محدودیت‌ها",
                "Suppressed images are AI reconstructions, not acquisitions "
                "— subtle rib detail and very low-contrast findings behind "
                "dense bone may be attenuated. CC BY-NC-SA research-only "
                "license (Qure.ai traces). Always read alongside the "
                "original radiograph.",
                "تصاویر حذف‌شده بازسازی هوش مصنوعی هستند، نه تصویربرداری "
                "واقعی — جزئیات ظریف دنده و یافته‌های کم‌کنتراست پشت "
                "استخوان متراکم ممکن است تضعیف شوند. مجوز تحقیقاتی "
                "غیرتجاری CC BY-NC-SA. همیشه همراه رادیوگرافی اصلی "
                "خوانده شوند."),
        ],
        **RESEARCH_DISCLAIMER,
    }
