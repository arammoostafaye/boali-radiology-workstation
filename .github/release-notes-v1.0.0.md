# Boali Radiology Workstation — v1.0.0

نسخه کامل و واقعی پلتفرم هوش مصنوعی تصویربرداری بیمارستان بوعلی — رابط ورک‌استیشن (Next.js 16) + موتورهای استنتاج واقعی (FastAPI + PyTorch/ONNX) + آرشیو PACS امن‌شده.

> **English:** Full-stack release of the Boali radiology AI platform: workstation UI, real inference engines, hardened PACS archive. **All 968 MB of model weights ship inside the package — nothing is downloaded at runtime.**

---

## 🚀 شروع سریع در ویندوز — دو روش

### روش ۱: بسته آماده Portable (پیشنهادی — بدون نیاز به Git)

1. فایل **`Boali-Radiology-Workstation-v1.0.0-Windows-Portable.zip`** را از همین صفحه دانلود کنید (~۱ گیگابایت).
2. آن را extract کنید (پوشه `Boali-Radiology-Workstation-v1.0.0-Windows-Portable` ساخته می‌شود).
3. وارد پوشه شوید و روی **`windows\START-BOALI.bat`** دوبار کلیک کنید.
4. اسکریپت همه‌چیز را بالا می‌آورد و مرورگر را روی `http://localhost:3000` باز می‌کند.

> در این بسته **وزن‌های ۴۱۷ مگابایتی از قبل سرهم شده‌اند** — هیچ مرحله اضافی وجود ندارد.

### روش ۲: Git

```
git clone https://github.com/arammoostafaye/boali-radiology-workstation.git
cd boali-radiology-workstation
windows\START-BOALI.bat
```

در این حالت، لانچر در اولین اجرا قطعات وزن‌های بزرگ را از داخل خود ریپو (پوشه `weights/chunks/`) سرهم می‌کند — کاملاً محلی و بدون دانلود.

---

## پیش‌نیازها (هر دو روش)

| نرم‌افزار | نسخه | لینک |
|---|---|---|
| Python | 3.10+ | https://www.python.org/downloads/ (تیک **Add python.exe to PATH**) |
| Node.js | LTS 18+ | https://nodejs.org (یا Bun) |

- بار اول فقط **وابستگی‌های نرم‌افزاری** نصب می‌شود (~۲۵۰ مگابایت شامل torch نسخه CPU ویندوزی) — یک‌بار برای همیشه.
- ⚠️ **هیچ فایل مدلی دانلود نمی‌شود** — هر ۵ موتور با وزن‌های داخل بسته کار می‌کنند.

---

## ماژول‌ها (هرکدام محیط اختصاصی خودش)

| ماژول | موتور | مدل |
|---|---|---|
| Fracture Detection | `fracture` | YOLOv8 ONNX — رادیوگرافی ارتوپدی |
| Bone Suppression | `bone-suppression` | Qure TorchScript — بازسازی بافت نرم |
| Lung Screen | `chest18` | DenseNet-18 — ۱۸ پاتولوژی قفسه سینه |
| Mammography AI | `mammography` | ResNet-50 — غربالگری |
| 3D CT Studio | `ct3d` | Volume rendering — MPR / VR |
| AI Report | — | گزارش ساختاریافته · خروجی |

**اصل طراحی:** هیچ عدد جعلی تولید نمی‌شود — وضعیت واقعی هر موتور روی چیپ همان کارت نمایش داده می‌شود.

## نمونه‌های آماده تست

داخل خود برنامه (بدون نیاز به فایل خارجی): ۳ ماموگرافی DICOM + CT + MR در `public/samples/` و آرشیو دموی PACS + سری کامل CT قفسه سینه برای 3D CT Studio.

## صحت‌سنجی

- `SHA256SUMS.txt` (پیوست همین Release) — هش بسته portable.
- `mini-services/boali-engine/weights/MANIFEST.txt` — اندازه و SHA-256 تک‌تک وزن‌ها.

## نکات اجرا

| مورد | توضیح |
|---|---|
| SmartScreen | More info → **Run anyway** (اسکریپت محلی است، امضا ندارد) |
| توقف | بستن ۳ پنجره سرویس |
| اجرای مجدد | دوباره `START-BOALI.bat` (نصب‌ها تکرار نمی‌شوند) |
| رفع اشکال | `windows/README-WINDOWS.md` |

---

## ⚠️ سلب مسئولیت

این نرم‌افزار برای **تحقیق و آموزش** است و ابزار تشخیص پزشکی بالینی نیست. وزن‌های Bone Suppression از مدل عمومی [Qure AI](https://huggingface.co/qureaiorg/bone-suppression) و منطق موتورها از [`arammoostafaye/boali-radiology-suite`](https://github.com/arammoostafaye/boali-radiology-suite) پورت شده‌اند.
