"""18 chest & heart pathologies screening (TorchXRayVision DenseNet).

Ported VERBATIM from BoneSuppression_Desktop.py:3926-4011
(`run_pathology_inference`) — same [-1024,1024] normalization, same center
crop, same 224x224 resize, same 18 operating thresholds, same calibrated
op_norm rescaling, same labels. Raw sigmoid probabilities are ALSO returned
(unlike the desktop UI which only shows the rescaled score).
"""

from __future__ import annotations

import threading
import time

import numpy as np

from .common import find_weight_file, python_has
from .reporting import RESEARCH_DISCLAIMER, now_str, sec

ENGINE_ID = "chest18"
ENGINE_NAME = "18 Chest Pathologies (DenseNet TorchScript)"
SOURCE_REF = "BoneSuppression_Desktop.py:3926-4011"

_lock = threading.Lock()
_model = None
_loaded_path: str | None = None

# Verbatim from BoneSuppression_Desktop.py:3969-3982
LABELS_FA = [
    "آتلکتازی (کلاپس ریه)", "کانسولیدیشن (تراکم بافت)", "اینفیلتراسیون (تراوش ریوی)",
    "پنوموتوراکس (هوای جنب)", "ادم ریوی (آب آوردن ریه)", "آمفیزم ریوی",
    "فیبروز ریوی", "پلورال افیوژن (مایع جنب)", "پنومونی (عفونت ریه)",
    "ضخیم‌شدگی پلورا", "کاردیومگالی (بزرگی قلب)", "ندول ریوی (Nodule)",
    "توده ریوی (Mass)", "فتق دیافراگم (Hernia)", "ضایعه موضعی ریه",
    "شکستگی استخوان/دنده", "کدورت منتشر ریه (Opacity)", "بزرگی مدیاستن و قلب",
]
LABELS_EN = [
    "Atelectasis", "Consolidation", "Infiltration", "Pneumothorax", "Edema",
    "Emphysema", "Fibrosis", "Effusion", "Pneumonia", "Pleural_Thickening",
    "Cardiomegaly", "Nodule", "Mass", "Hernia", "Lung Lesion", "Fracture",
    "Lung Opacity", "Enlarged Cardiomediastinum",
]


def _weight() -> str | None:
    return find_weight_file("cxr_densenet18.ts")


def status() -> dict:
    has_torch = python_has("torch")
    p = _weight()
    if not has_torch:
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "deps_missing",
            "framework": "PyTorch TorchScript",
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "PyTorch is not installed. Install torch (CPU) and place "
            "cxr_densenet18.ts in weights/.",
        }
    if not p:
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "weights_missing",
            "framework": "PyTorch TorchScript",
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "cxr_densenet18.ts not found. Download from "
            "huggingface.co/arammoostafaye/bone-suppression-desktop.",
        }
    return {
        "engine": ENGINE_ID,
        "name": ENGINE_NAME,
        "status": "ready",
        "framework": "PyTorch TorchScript",
        "weight_path": p,
        "source_ref": SOURCE_REF,
        "message": "Real DenseNet inference (verbatim port, thresholds included).",
    }


def unload() -> None:
    """Free the DenseNet model (memwatch idle guard)."""
    global _model, _loaded_path
    with _lock:
        _model = None
        _loaded_path = None


def _get_model():
    global _model, _loaded_path
    import torch

    p = _weight()
    if p is None:
        raise RuntimeError("chest18 weights not found")
    with _lock:
        if _loaded_path != p or _model is None:
            # Verbatim from BoneSuppression_Desktop.py:3938-3939
            _model = torch.jit.load(p, map_location="cpu")
            _model.eval()
            _loaded_path = p
    return _model, torch


def analyze(arr01: np.ndarray) -> dict:
    model, torch = _get_model()
    import cv2

    t0 = time.time()

    # Verbatim from 3950-3956: normalize to [-1024,1024], center square crop, 224
    gray_norm = (arr01 * 2048.0) - 1024.0
    gh, gw = gray_norm.shape
    min_dim = min(gh, gw)
    cy, cx = gh // 2, gw // 2
    crop = gray_norm[cy - min_dim // 2: cy + min_dim // 2, cx - min_dim // 2: cx + min_dim // 2]
    resized = cv2.resize(crop, (224, 224), interpolation=cv2.INTER_AREA)

    t_in = torch.from_numpy(resized).unsqueeze(0).unsqueeze(0).float().to("cpu")
    with torch.no_grad():
        raw_logits = model(t_in)[0].cpu().numpy()
        sig = 1.0 / (1.0 + np.exp(-raw_logits))

    # Verbatim from 3963-3967: calibrated operating thresholds
    op_threshs = np.array([
        0.07422872, 0.038290843, 0.09814756, 0.0098118475, 0.023601074, 0.0022490358,
        0.010060724, 0.103246614, 0.056810737, 0.026791653, 0.050318155, 0.023985857,
        0.01939503, 0.042889766, 0.053369623, 0.035975814, 0.20204692, 0.05015312,
    ], dtype=np.float32)

    # Verbatim from 3984-3990: operating-threshold rescaling (op_norm)
    outputs_new = np.zeros_like(sig) + 0.5
    mask_leq = sig < op_threshs
    mask_gt = ~mask_leq
    outputs_new[mask_leq] = sig[mask_leq] / (op_threshs[mask_leq] * 2.0)
    outputs_new[mask_gt] = 1.0 - ((1.0 - sig[mask_gt]) / ((1.0 - op_threshs[mask_gt]) * 2.0))
    normed = np.clip(outputs_new, 0.0, 1.0)

    findings = []
    # Verbatim zip from 3993-4001
    for fa, en, n_score, raw_s, th in zip(LABELS_FA, LABELS_EN, normed, sig, op_threshs):
        findings.append(
            {
                "fa": fa,
                "en": en,
                "score": float(n_score),
                "raw_prob": float(raw_s),
                "threshold": float(th),
                "is_positive": bool(n_score >= 0.5),
            }
        )
    findings.sort(key=lambda x: x["score"], reverse=True)

    dt_ms = (time.time() - t0) * 1000
    report = _build_report(findings, dt_ms)
    return {
        "engine": ENGINE_ID,
        "model_file": "cxr_densenet18.ts",
        "elapsed_ms": round(dt_ms),
        "source_size": [int(gw), int(gh)],
        "findings": findings,
        "findings_count": sum(1 for f in findings if f["is_positive"]),
        "report": report,
        "source_ref": SOURCE_REF,
    }


def _build_report(findings: list[dict], dt_ms: float) -> dict:
    """Detailed bilingual report from the calibrated 18-label output."""
    positives = [f for f in findings if f["is_positive"]]
    negatives = [f for f in findings if not f["is_positive"]]
    top_neg = sorted(negatives, key=lambda f: f["score"], reverse=True)[:3]

    if positives:
        pos_en = "; ".join(
            f"{f['en']} ({f['fa']}) score {f['score'] * 100:.1f}% "
            f"[raw sigmoid {f['raw_prob'] * 100:.2f}%, operating threshold "
            f"{f['threshold'] * 100:.1f}%]"
            for f in positives
        )
        pos_fa = "؛ ".join(
            f"{f['fa']} — امتیاز {f['score'] * 100:.1f}٪ (آستانه "
            f"{f['threshold'] * 100:.1f}٪)"
            for f in positives
        )
        find_en = (
            f"Positive labels ({len(positives)}/18): {pos_en}. "
            f"Highest-scoring negative labels: "
            + "; ".join(f"{f['en']} {f['score'] * 100:.1f}%" for f in top_neg)
            + "."
        )
        find_fa = (
            f"برچسب‌های مثبت ({len(positives)} از ۱۸): {pos_fa}. "
            f"بالاترین برچسب‌های منفی: "
            + "؛ ".join(f"{f['fa']} {f['score'] * 100:.1f}٪" for f in top_neg)
            + "."
        )
        imp_en = (
            f"{len(positives)} pathology pattern(s) crossed their calibrated "
            f"operating threshold. Correlate with the clinical picture and "
            f"prior imaging; thresholds are dataset-calibrated and may "
            f"require site-specific adjustment."
        )
        imp_fa = (
            f"{len(positives)} الگوی بیماری از آستانه کالیبره خود گذشت. "
            f"همبستگی با تصویر بالینی و مطالعات قبلی لازم است؛ آستانه‌ها "
            f"بر پایه دیتاست کالیبره شده‌اند و ممکن است نیاز به تنظیم "
            f"محلی داشته باشند."
        )
    else:
        find_en = (
            "No pathology crossed its calibrated operating threshold "
            "(18/18 negative). Top three scores: "
            + "; ".join(f"{f['en']} {f['score'] * 100:.1f}%" for f in top_neg)
            + " — all below 50% post-calibration."
        )
        find_fa = (
            "هیچ بیماری از آستانه کالیبره خود نگذشت (۱۸ از ۱۸ منفی). "
            "سه امتیاز برتر: "
            + "؛ ".join(f"{f['fa']} {f['score'] * 100:.1f}٪" for f in top_neg)
            + " — همه زیر ۵۰٪ پس از کالیبراسیون."
        )
        imp_en = ("Screening negative for all 18 pathologies at the "
                  "calibrated thresholds.")
        imp_fa = ("غربالگری برای هر ۱۸ بیماری در آستانه‌های کالیبره منفی "
                  "است.")

    return {
        "generated_at": now_str(),
        "sections": [
            sec("technique", "Technique", "تکنیک",
                f"TorchXRayVision DenseNet-18 multi-label classifier; "
                f"[-1024,1024] normalization, center-square crop, 224×224 "
                f"resize; per-label calibrated operating thresholds "
                f"(verbatim desktop pipeline). Inference {dt_ms:.0f} ms on "
                f"CPU.",
                f"طبقه‌بند چندبرچسبی DenseNet-18 (TorchXRayVision)؛ "
                f"نرمال‌سازی [-۱۰۲۴،۱۰۲۴]، برش مرکزی، تغییر اندازه "
                f"۲۲۴×۲۲۴؛ آستانه‌های بهره‌برداری کالیبره به تفکیک "
                f"برچسب (خط لوله دقیق دسکتاپ). استنتاج {dt_ms:.0f} "
                f"میلی‌ثانیه."),
            sec("findings", "Findings", "یافته‌ها", find_en, find_fa),
            sec("impression", "Impression", "جمع‌بندی", imp_en, imp_fa),
            sec("limitations", "Limitations", "محدودیت‌ها",
                "Whole-image multi-label screening — no localization, no "
                "severity grading, no laterality. Sigmoid outputs are "
                "dataset-calibrated, not site-validated probabilities.",
                "غربالگری چندبرچسبی کل تصویر — بدون مکان‌یابی، درجه‌بندی "
                "شدت یا تعیین طرف. خروجی‌های سیگموید روی دیتاست کالیبره "
                "شده‌اند، نه احتمالات اعتبارسنجی‌شده محلی."),
        ],
        **RESEARCH_DISCLAIMER,
    }
