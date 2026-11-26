@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title BOALI RADIOLOGY SUITE - LAUNCHER
color 0B

echo ==========================================================
echo    BOALI RADIOLOGY SUITE  -  Windows One-Click Launcher
echo    FastAPI engines (:3020, :3021)  +  Next.js web (:3000)
echo ==========================================================
echo.

cd /d "%~dp0.."
set "ROOT=%CD%"
set "WHEELS=%ROOT%\runtime\wheels"

REM ---------------- 1. locate Python -------------------------
REM py -3.12 is preferred: the bundled offline wheels in runtime/wheels
REM are built for CPython 3.12 64-bit (win_amd64).
set "PY="
py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
if not defined PY (
  py -3 --version >nul 2>&1 && set "PY=py -3"
)
if not defined PY (
  python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
  color 0C
  echo [ERROR] Python 3 was not found on this machine.
  echo         Install Python 3.12 64-bit from https://www.python.org/downloads/
  echo         IMPORTANT: tick "Add python.exe to PATH" during install.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('%PY% --version 2^>^&1') do echo [OK] %%v found.
for /f "tokens=2" %%v in ('%PY% --version 2^>^&1') do set "PYVER=%%v"

REM ---------------- 2. create / reuse venv --------------------
if not exist "%ROOT%\.venv\Scripts\python.exe" (
  echo [SETUP] Creating virtual environment .venv ... first run only
  %PY% -m venv "%ROOT%\.venv"
  if errorlevel 1 (
    color 0C
    echo [ERROR] Could not create the virtual environment.
    pause
    exit /b 1
  )
)
set "VENV=%ROOT%\.venv\Scripts\python.exe"

REM ---------------- 3. install Python dependencies ------------
REM EVERY Windows wheel ships inside this repo (runtime/wheels/) - the
REM install below runs OFFLINE (no internet) when the detected Python
REM matches the bundled build: CPython 3.12 64-bit. Other versions fall
REM back to an online install automatically.
set "STAMP=%ROOT%\.venv\.boali_deps_done"
if not exist "%STAMP%" (
  echo [SETUP] Detected Python !PYVER!.
  set "OFFLINE=1"
  if /i not "!PYVER:~0,4!"=="3.12" (
    color 0E
    echo [WARN] The bundled offline wheels target Python 3.12 64-bit.
    echo         Found !PYVER! - falling back to an ONLINE install.
    set "OFFLINE=0"
  )
  if "!OFFLINE!"=="1" (
    echo [RUNTIME] Verifying bundled wheels + assembling torch from chunks ...
    "%VENV%" "%ROOT%\tools\assemble_runtime.py"
    if errorlevel 1 (
      color 0C
      echo [ERROR] Bundled runtime wheels are missing or corrupt.
      echo         Re-download / re-extract the project and try again.
      pause
      exit /b 1
    )
    echo [SETUP] Installing Python dependencies OFFLINE from bundled wheels ...
    "%VENV%" -m pip install --no-index --find-links "%WHEELS%" fastapi uvicorn numpy opencv-python-headless Pillow pydicom scipy torch torchvision
    if errorlevel 1 (
      color 0E
      echo [WARN] Offline install failed - falling back to an ONLINE install.
      set "OFFLINE=0"
    )
  )
  if "!OFFLINE!"=="0" (
    echo [SETUP] Installing Python dependencies ONLINE - about 250 MB, once ...
    "%VENV%" -m pip install --upgrade pip
    if errorlevel 1 (
      color 0E
      echo [WARN] Could not upgrade pip - continuing with the bundled version.
    )
    "%VENV%" -m pip install fastapi uvicorn numpy opencv-python-headless Pillow pydicom scipy
    if errorlevel 1 (
      color 0C
      echo [ERROR] Base dependency install failed - check your internet connection.
      pause
      exit /b 1
    )
    "%VENV%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    if errorlevel 1 (
      color 0E
      echo [WARN] torch CPU install failed - AI engines will report "deps missing".
    )
  )
  echo done > "%STAMP%"
) else (
  echo [OK] Python dependencies already installed.
)

REM ---------------- 4. assemble big model weights --------------
REM All model bytes SHIP WITH THIS REPO (weights/chunks/). The two 417 MB
REM Qure traces are split into <100 MB pieces because of GitHub's file
REM limit; they are glued back together here - NO download happens.
set "WDIR=%ROOT%\mini-services\boali-engine\weights"

if not exist "%WDIR%\bone_suppression.ts" (
  echo [WEIGHTS] Assembling bone_suppression.ts from repo chunks ...
  copy /b "%WDIR%\chunks\bone_suppression.ts.00"+"%WDIR%\chunks\bone_suppression.ts.01"+"%WDIR%\chunks\bone_suppression.ts.02"+"%WDIR%\chunks\bone_suppression.ts.03"+"%WDIR%\chunks\bone_suppression.ts.04" "%WDIR%\bone_suppression.ts" >nul
  if errorlevel 1 (
    color 0C
    echo [ERROR] Could not assemble bone_suppression.ts from chunks.
    pause
    exit /b 1
  )
)
if not exist "%WDIR%\lung_component_suppression.ts" (
  echo [WEIGHTS] Assembling lung_component_suppression.ts from repo chunks ...
  copy /b "%WDIR%\chunks\lung_component_suppression.ts.00"+"%WDIR%\chunks\lung_component_suppression.ts.01"+"%WDIR%\chunks\lung_component_suppression.ts.02"+"%WDIR%\chunks\lung_component_suppression.ts.03"+"%WDIR%\chunks\lung_component_suppression.ts.04" "%WDIR%\lung_component_suppression.ts" >nul
  if errorlevel 1 (
    color 0C
    echo [ERROR] Could not assemble lung_component_suppression.ts from chunks.
    pause
    exit /b 1
  )
)
echo [OK] Model weights ready ^(all shipped inside this repository^).

REM ---------------- 5. locate Node -----------------------------
where bun >nul 2>&1 && set "RUNNER=bun" || set "RUNNER="
if not defined RUNNER (
  where node >nul 2>&1 || (
    color 0C
    echo [ERROR] Neither bun nor node/npm was found.
    echo         Install Node.js LTS from https://nodejs.org  ^(or bun from https://bun.sh^)
    pause
    exit /b 1
  )
  set "RUNNER=npm"
)

REM ---------------- 6. install web dependencies -----------------
REM NOTE: node_modules cannot be bundled across platforms (native binaries),
REM so this step needs internet ONCE. Models and Python deps are offline.
if not exist "%ROOT%\node_modules" (
  echo [SETUP] Installing web dependencies - first run only, needs internet ...
  if "%RUNNER%"=="bun" ( bun install ) else ( npm install )
  if errorlevel 1 (
    color 0C
    echo [ERROR] Web dependency install failed.
    pause
    exit /b 1
  )
) else (
  echo [OK] Web dependencies already installed.
)

echo.
echo [START] Launching the three services ...
echo.

REM ---------------- 7. start engine (:3020) ---------------------
start "boali-engine :3020" cmd /k "chcp 65001 >nul & cd /d "%ROOT%\mini-services\boali-engine" && "%VENV%" -m uvicorn app:app --host 127.0.0.1 --port 3020 & cd /d %ROOT%"

REM ---------------- 8. start pacs (:3021) -----------------------
timeout /t 2 /nobreak >nul
start "boali-pacs :3021" cmd /k "chcp 65001 >nul & cd /d "%ROOT%\mini-services\boali-pacs" && "%VENV%" -m uvicorn app:app --host 127.0.0.1 --port 3021 & cd /d %ROOT%"

REM ---------------- 9. start web (:3000) ------------------------
REM NOTE: `next` is invoked directly (not via `npm run dev`) because the
REM package.json dev script pipes through `tee`, which does not exist in
REM Windows cmd.
timeout /t 2 /nobreak >nul
if "%RUNNER%"=="bun" (
  start "boali-web :3000" cmd /k "chcp 65001 >nul & cd /d "%ROOT%" && bunx next dev -p 3000 --webpack"
) else (
  start "boali-web :3000" cmd /k "chcp 65001 >nul & cd /d "%ROOT%" && npx next dev -p 3000 --webpack"
)

echo ==========================================================
echo  All services launched in separate windows:
echo.
echo    [1] boali-engine :3020   - real AI inference (5 engines)
echo    [2] boali-pacs   :3021   - hardened PACS archive
echo    [3] boali-web    :3000   - the workstation UI
echo.
echo  Python dependencies and ALL model weights were installed from
echo  files inside this repository - no model downloads, ever.
echo.
echo  Wait until the web window prints "Ready", then open:
echo.
echo      http://localhost:3000
echo.
echo  To stop everything: close the three service windows.
echo ==========================================================
echo.
echo Opening the browser in 25 seconds ...
timeout /t 25 /nobreak >nul
start http://localhost:3000
color 0A
echo Done. You can close this launcher window.
timeout /t 5 >nul
endlocal
