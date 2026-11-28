"""Tiny shared helpers for the bilingual (en/fa) structured reports."""

from __future__ import annotations

import datetime


def now_str() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def sec(sid: str, t_en: str, t_fa: str, b_en: str, b_fa: str) -> dict:
    """One report section, English + Persian bodies."""
    return {
        "id": sid,
        "title_en": t_en,
        "title_fa": t_fa,
        "body_en": b_en,
        "body_fa": b_fa,
    }


RESEARCH_DISCLAIMER = {
    "disclaimer_en": (
        "AI-generated draft for research/education. A licensed radiologist "
        "must review, edit and sign before any clinical use."
    ),
    "disclaimer_fa": (
        "پیش‌نویس تولیدشده توسط هوش مصنوعی برای پژوهش/آموزش. بازبینی، "
        "ویرایش و امضای رادیولوژیست پیش از هر استفاده بالینی الزامی است."
    ),
}


def mem_available_mb() -> float:
    """Best-effort available RAM in MB (Linux /proc; psutil on Windows;
    large sentinel when unknowable so checks never block deployment)."""
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return float(line.split()[1]) / 1024.0
    except Exception:
        pass
    try:
        import psutil  # type: ignore

        return float(psutil.virtual_memory().available) / (1024 * 1024)
    except Exception:
        return 1e9
