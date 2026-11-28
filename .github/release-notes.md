# Boali Radiology Workstation — v1.3.0

نسخه کامل و واقعی پلتفرم هوش مصنوعی تصویربرداری بیمارستان بوعلی — رابط ورک‌استیشن (Next.js 16) + موتورهای استنتاج واقعی (FastAPI + PyTorch/ONNX) + آرشیو PACS امن‌شده.

> **English:** Full-stack release of the Boali radiology AI platform. **This version bundles EVERYTHING — the embedded Python 3.12 runtime, the Node.js 22 runtime, all 968 MB of model weights, every Python wheel (incl. torch 2.11 CPU) and a PREBUILT PRODUCTION web app (standalone `next build`). Extract and run: no Python, no Node.js, no internet, no compile step on the target machine.**

## 🆕 جدید در v1.3.0 — بدون هیچ پنجرهٔ CMD (مخصوص دسکتاپ بیمارستان)

- **سه سرویس دیگر هیچ پنجرهٔ کنسولی باز نمی‌کنند.** در نسخه‌های قبلی اجرای برنامه سه پنجرهٔ CMD سیاه (`boali-engine :3020`، `boali-pacs :3021`، `next-server`) روی دسکتاپ باز می‌شد — روی سیستم‌های بیمارستانی زشت و ناپسند بود. حالا هر سه سرویس **کاملاً مخفی و Detach شده در پس‌زمینه** اجرا می‌شوند (`tools\boali_launch.py`) و دسکتاپ تمیز می‌ماند.
- **لاگ کامل به‌جای پنجره:** خروجی هر سه سرویس به `logs\engine.log`، `logs\pacs.log` و `logs\web.log` اضافه می‌شود (با چرخش خودکار در ۱۰ مگابایت) — عیب‌یابی حتی راحت‌تر از قبل است.
- **`STOP-BOALI.bat`** (کنار `START-BOALI.bat`): توقف همهٔ سرویس‌ها با یک کلیک — فقط پروسه‌هایی که روی پورت‌های 3000 / 3020 / 3021 گوش می‌دهند را می‌بندد و به هیچ برنامهٔ دیگری دست نمی‌زند.
- **اجرای دوبارهٔ START بی‌خطر شد:** اگر سرویس‌ها از قبل روشن باشند، لانچر آنها را دوباره اجرا نمی‌کند (تشخیص با چک پورت) و فقط مرورگر را دوباره باز می‌کند — دیگر با دوبار کلیک، پنجره‌های تکراری/خطای Port in use ساخته نمی‌شود.
- رفتار قبلی حفظ شد: بدون نصب، بدون اینترنت، مرورگر فقط بعد از بالا آمدن واقعی سرور وب باز می‌شود.

---

## 🚀 شروع سریع در ویندوز

1. فایل **`Boali-Radiology-Workstation-v1.3.0-Windows-Portable.zip`** را از همین صفحه دانلود کنید (~۱.۴ گیگابایت).
2. آن را در یک **مسیر کوتاه** (مثلاً `C:\Boali`) extract کنید.
3. روی **`Boali\windows\START-BOALI.bat`** دوبار کلیک کنید.
4. مرورگر **خودکار و فقط بعد از بالا آمدن سرور** روی `http://localhost:3000` باز می‌شود — **بدون هیچ پنجرهٔ CMD** روی دسکتاپ.

> **پیش‌نیاز: هیچ.** نه Python، نه Node.js، نه اینترنت، نه کامپایل. همه‌چیز — ران‌تایم‌ها، وزن‌ها، wheel ها و بیلد آمادهٔ وب — داخل بسته است و در اولین اجرا فقط چند فایل زیپ محلی باز می‌شوند (چند ثانیه).

> **توقف برنامه:** `Boali\windows\STOP-BOALI.bat` را دوبار کلیک کنید. لاگ سرویس‌ها: پوشهٔ `Boali\logs\`.

### اجرا از سورس (Git)

```
git clone https://github.com/arammoostafaye/boali-radiology-workstation.git
cd boali-radiology-workstation
windows\START-BOALI.bat
```

> در حالت clone: وزن‌های بزرگ، wheel تورچ و ران‌تایم‌ها در اولین اجرا از فایل‌های داخل خود ریپو سرهم/استخراج می‌شوند (کاملاً محلی، صحت‌سنجی SHA-256) و وب در حالت dev اجرا می‌شود (فقط `node_modules` در این حالت یک بار با اینترنت نصب می‌شود).

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

---

## امنیت و صحت

- 📦 **کاملاً آفلاین:** پس از دانلود، هیچ درخواست شبکه‌ای برای اجرا لازم نیست.
- 🩻 **مدل‌های واقعی:** ۹۶۸ مگابایت وزن واقعی (Qure AI bone/lung suppression، DenseNet-18، ResNet-50، YOLOv8) داخل بسته.
- 🔒 PACS با ۴ اصلاحیهٔ امنیتی (path traversal، upload بدون اعتبارسنجی، MIME sniffing، CORS باز).
- ⚕️ این نرم‌افزار برای **تحقیق و آموزش** است؛ ابزار تشخیص پزشکی بالینی نیست.
