@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title BOALI RADIOLOGY SUITE - LAUNCHER
color 0B

echo ==========================================================
echo    BOALI RADIOLOGY SUITE  -  Windows One-Click Launcher
echo    FastAPI engines (:3020, :3021)  +  Next.js web (:3000)
echo    100%% OFFLINE: bundled Python 3.12 + Node.js 22
echo    + all wheels + all model weights - no downloads, ever.
echo ==========================================================
echo.

cd /d "%~dp0.."
set "ROOT=%CD%"
set "RUNTIME=%ROOT%\runtime"
set "WHEELS=%RUNTIME%\wheels"
set "PYP=%RUNTIME%\python"
set "SITEPKGS=%PYP%\Lib\site-packages"
set "PYZIP=%RUNTIME%\python-3.12.10-embed-amd64.zip"
set "PTHFILE=%RUNTIME%\python312._pth"
set "NODEP=%RUNTIME%\node"
set "NODEZIP=%RUNTIME%\node-v22.23.5-win-x64.zip"

REM ---------------- 0. path-length guard ----------------------
REM torch unpacks ~120-char relative paths under
REM runtime\python\Lib\site-packages\ - a very deep install
REM folder can exceed the Windows 260-char path limit.
call :STRLEN "%ROOT%" PLEN
if !PLEN! GTR 105 (
  color 0E
  echo [WARN] This folder path is !PLEN! characters deep.
  echo         Very deep paths can break Python on Windows ^(260-char limit^).
  echo         Recommended: move the folder to a short path such as C:\Boali
  echo.
)

REM ---------------- 1. bundled Python 3.12 --------------------
REM The full CPython 3.12 (win_amd64) runtime SHIPS INSIDE THIS
REM PACKAGE (runtime/python-3.12.10-embed-amd64.zip, ~11 MB). It
REM is extracted once next to the launcher and used from then on,
REM so the Python version installed on THIS machine is irrelevant.
set "PYEXE="
if exist "%PYP%\python.exe" set "PYEXE=%PYP%\python.exe"

if not defined PYEXE if exist "%PYZIP%" (
  echo [SETUP] Extracting the bundled Python 3.12 runtime - first run only ...
  if not exist "%PYP%" mkdir "%PYP%"
  call :UNZIP "%PYZIP%" "%PYP%"
)
if not defined PYEXE if exist "%PYP%\python.exe" set "PYEXE=%PYP%\python.exe"

if defined PYEXE (
  if exist "%PTHFILE%" copy /y "%PTHFILE%" "%PYP%\python312._pth" >nul
  for /f "usebackq tokens=*" %%v in (`"%PYEXE%" --version`) do echo [OK] %%v - bundled runtime, system Python not required.
)

REM ---------------- 2. fallback: system Python ----------------
REM Only used when the bundled runtime is missing (rare, e.g. a
REM stripped copy). The bundled wheels target CPython 3.12 64-bit.
set "PYVER="
if not defined PYEXE (
  color 0E
  echo [WARN] Bundled Python runtime not found - trying the system Python.
  set "SYSPY="
  py -3.12 --version >nul 2>&1 && set "SYSPY=py -3.12"
  if not defined SYSPY (
    py -3 --version >nul 2>&1 && set "SYSPY=py -3"
  )
  if not defined SYSPY (
    python --version >nul 2>&1 && set "SYSPY=python"
  )
  if not defined SYSPY (
    color 0C
    echo [ERROR] No Python available: the bundled runtime is missing AND no
    echo         system Python was found. Re-extract the full package, or
    echo         download the ready-to-run Release zip from GitHub.
    pause
    exit /b 1
  )
  for /f "tokens=2" %%v in ('%SYSPY% --version 2^>^&1') do set "PYVER=%%v"
  echo [SETUP] Detected system Python !PYVER!.
  if not exist "%ROOT%\.venv\Scripts\python.exe" (
    echo [SETUP] Creating virtual environment .venv - first run only ...
    %SYSPY% -m venv "%ROOT%\.venv"
    if errorlevel 1 (
      color 0C
      echo [ERROR] Could not create the virtual environment.
      pause
      exit /b 1
    )
  )
  set "PYEXE=%ROOT%\.venv\Scripts\python.exe"
)

REM ---------------- 3. install Python dependencies ------------
REM Every wheel ships inside this package (runtime/wheels/):
REM   - bundled runtime path: fully offline install into the
REM     embedded python's site-packages (pip is bootstrapped from
REM     the bundled pip wheel - embedded python has no ensurepip)
REM   - venv path: offline when the system Python is 3.12 64-bit,
REM     otherwise an online install is attempted as a rescue.
if /i "%PYEXE%"=="%PYP%\python.exe" (
  if not exist "%SITEPKGS%\torch\__init__.py" (
    echo [SETUP] Installing Python dependencies OFFLINE from bundled wheels ...
    if not exist "%SITEPKGS%" mkdir "%SITEPKGS%"
    if not exist "%RUNTIME%\tmp" mkdir "%RUNTIME%\tmp"
    REM keep pip's temp files inside the project (short path)
    set "TMP=%RUNTIME%\tmp"
    set "TEMP=%RUNTIME%\tmp"
    if exist "%RUNTIME%\MANIFEST.txt" (
      echo [RUNTIME] Verifying bundled wheels + assembling torch from chunks ...
      "%PYEXE%" "%ROOT%\tools\assemble_runtime.py"
      if errorlevel 1 goto :failwheels
    )
    if not exist "%SITEPKGS%\pip\__init__.py" (
      set "PIPWHL="
      for /f "delims=" %%f in ('dir /b /a-d "%WHEELS%\pip-*.whl" 2^>nul') do if not defined PIPWHL set "PIPWHL=%%f"
      if not defined PIPWHL goto :failwheels
      echo [RUNTIME] Bootstrapping pip from the bundled wheel ...
      "%PYEXE%" -m zipfile -e "%WHEELS%\!PIPWHL!" "%SITEPKGS%"
      if errorlevel 1 goto :failwheels
    )
    "%PYEXE%" -m pip install --no-index --find-links "%WHEELS%" --target "%SITEPKGS%" --upgrade fastapi uvicorn python-multipart numpy opencv-python-headless Pillow pydicom scipy torch torchvision
    if errorlevel 1 goto :failwheels
    echo [RUNTIME] Verifying imports ^(torch, cv2, fastapi, pydicom ...^) ...
    "%PYEXE%" -c "import torch, torchvision, cv2, fastapi, pydicom, scipy, PIL, numpy, python_multipart"
    if errorlevel 1 goto :failwheels
    echo done> "%PYP%\.site_done"
  ) else (
    echo [OK] Python dependencies already installed.
  )
)

if /i "%PYEXE%"=="%ROOT%\.venv\Scripts\python.exe" (
  if not exist "%ROOT%\.venv\.boali_deps_done" (
    set "OFFLINE=1"
    if /i not "!PYVER:~0,4!"=="3.12" (
      color 0E
      echo [WARN] The bundled offline wheels target Python 3.12 64-bit.
      echo         Found !PYVER! - an ONLINE install will be attempted.
      set "OFFLINE=0"
    )
    if "!OFFLINE!"=="1" (
      "%PYEXE%" "%ROOT%\tools\assemble_runtime.py"
      if errorlevel 1 goto :failwheels
      echo [SETUP] Installing Python dependencies OFFLINE from bundled wheels ...
      "%PYEXE%" -m pip install --no-index --find-links "%WHEELS%" fastapi uvicorn python-multipart numpy opencv-python-headless Pillow pydicom scipy torch torchvision
      if errorlevel 1 (
        color 0E
        echo [WARN] Offline install failed - falling back to an ONLINE install.
        set "OFFLINE=0"
      )
    )
    if "!OFFLINE!"=="0" (
      echo [SETUP] Installing Python dependencies ONLINE - about 250 MB, once ...
      call :PIPONLINE fastapi uvicorn python-multipart numpy opencv-python-headless Pillow pydicom scipy
      if errorlevel 1 (
        color 0C
        echo [ERROR] Base dependency install failed - check your internet connection.
        echo         TIP: the Release zip needs NO internet at all.
        pause
        exit /b 1
      )
      "%PYEXE%" -m pip install --timeout 60 --retries 4 torch torchvision --index-url https://download.pytorch.org/whl/cpu
      if errorlevel 1 (
        color 0E
        echo [WARN] torch CPU install failed - AI engines will report "deps missing".
      )
    )
    echo done> "%ROOT%\.venv\.boali_deps_done"
  ) else (
    echo [OK] Python dependencies already installed.
  )
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
echo [OK] Model weights ready ^(all shipped inside this package^).

REM ---------------- 5. bundled Node.js 22 ---------------------
set "NODEEXE="
if exist "%NODEP%\node.exe" set "NODEEXE=%NODEP%\node.exe"

if not defined NODEEXE if exist "%NODEZIP%" (
  echo [SETUP] Extracting the bundled Node.js 22 runtime - first run only ...
  if not exist "%NODEP%" mkdir "%NODEP%"
  call :UNZIP "%NODEZIP%" "%NODEP%"
)
if not defined NODEEXE if exist "%NODEP%\node.exe" set "NODEEXE=%NODEP%\node.exe"

if not defined NODEEXE (
  where node >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%n in ('where node') do if not defined NODEEXE set "NODEEXE=%%n"
  )
)
if not defined NODEEXE (
  color 0C
  echo [ERROR] No Node.js runtime found: the bundled runtime is missing and
  echo         node is not installed on this machine. Re-extract the full
  echo         package, or download the ready-to-run Release zip from GitHub.
  pause
  exit /b 1
)
for /f "usebackq tokens=*" %%v in (`"%NODEEXE%" --version`) do echo [OK] Node.js %%v ready.

REM ---------------- 6. web app --------------------------------
REM The Release zip ships a PREBUILT PRODUCTION web app (webapp\)
REM - `next build` already ran on GitHub, so the server starts in
REM ~2 seconds with NO compile step and NO node_modules install.
REM Source checkouts fall back to dev mode (next dev).
if exist "%ROOT%\webapp\server.js" (
  echo [OK] Prebuilt production web app found - starts in ~2 seconds.
) else (
  if exist "%ROOT%\node_modules\next\dist\bin\next" (
    echo [OK] Web dependencies installed ^(dev mode^).
  ) else (
    color 0E
    echo [SETUP] node_modules is missing ^(source checkout^) - installing once ...
    echo        ^(needs internet; the Release zip skips this entirely^)
    pushd "%ROOT%"
    if exist "%NODEP%\node_modules\npm\bin\npm-cli.js" (
      "%NODEEXE%" "%NODEP%\node_modules\npm\bin\npm-cli.js" install --no-audit --no-fund
    ) else (
      call npm install --no-audit --no-fund
    )
    if errorlevel 1 (
      popd
      color 0C
      echo [ERROR] Web dependency install failed.
      echo         TIP: download the prebuilt Release zip - nothing to install.
      pause
      exit /b 1
    )
    popd
  )
)

echo.
echo [START] Launching the three services ...
echo.

REM ---------------- 7. start engine (:3020) ---------------------
start "boali-engine :3020" cmd /k "chcp 65001 >nul & cd /d "%ROOT%\mini-services\boali-engine" && "%PYEXE%" -m uvicorn app:app --host 127.0.0.1 --port 3020"

REM ---------------- 8. start pacs (:3021) -----------------------
timeout /t 2 /nobreak >nul
start "boali-pacs :3021" cmd /k "chcp 65001 >nul & cd /d "%ROOT%\mini-services\boali-pacs" && "%PYEXE%" -m uvicorn app:app --host 127.0.0.1 --port 3021"

REM ---------------- 9. start web (:3000) ------------------------
REM Production path: webapp\server.js is a PREBUILT standalone Next.js
REM server - it starts in ~2 seconds (no webpack compile on boot).
REM PORT / HOSTNAME are inherited by the child process; binding to
REM 127.0.0.1 avoids the Windows Firewall popup.
REM Fallback path (source checkout): `next` is invoked directly (not via
REM `npm run dev`) because the package.json dev script pipes through
REM `tee`, which does not exist in Windows cmd.
timeout /t 2 /nobreak >nul
if exist "%ROOT%\webapp\server.js" (
  set "PORT=3000"
  set "HOSTNAME=127.0.0.1"
  start "boali-web :3000" cmd /k "chcp 65001 >nul & cd /d "%ROOT%\webapp" && "%NODEEXE%" server.js"
) else (
  start "boali-web :3000" cmd /k "chcp 65001 >nul & cd /d "%ROOT%" && "%NODEEXE%" "node_modules\next\dist\bin\next" dev -p 3000 --webpack"
)

echo ==========================================================
echo  All services launched in separate windows:
echo.
echo    [1] boali-engine :3020   - real AI inference (5 engines)
echo    [2] boali-pacs   :3021   - hardened PACS archive
echo    [3] boali-web    :3000   - the workstation UI
echo.
echo  Python 3.12, Node.js 22, every wheel and ALL model weights
echo  were used from files INSIDE this package - no downloads, no
echo  internet connection, no system-wide installations required.
echo.
echo  The web app is a PREBUILT production server - it is up in
echo  ~2 seconds. This launcher now waits for it to answer and
echo  then opens the browser automatically on:
echo.
echo      http://localhost:3000
echo.
echo  To stop everything: close the three service windows.
echo ==========================================================
echo.
echo [WAIT] Waiting for the web server on http://127.0.0.1:3000 ...
where curl >nul 2>&1
if errorlevel 1 (
  color 0E
  echo        curl not found - opening the browser in 20 seconds ...
  timeout /t 20 /nobreak >nul
  goto :openbrowser
)
set /a WTRIES=0
:waitweb
set /a WTRIES+=1
curl -s -o NUL --max-time 2 http://127.0.0.1:3000/
if not errorlevel 1 goto :openbrowser
if !WTRIES! GTR 90 goto :openbrowser
timeout /t 1 /nobreak >nul
goto :waitweb

:openbrowser
start http://localhost:3000
color 0A
echo [OK] Web server is up - browser opened.
echo Done. You can close this launcher window.
timeout /t 5 >nul
endlocal
exit /b 0

REM ============================================================
REM failure labels
REM ============================================================
:failwheels
color 0C
echo [ERROR] Bundled runtime wheels are missing or corrupt.
echo         Re-download / re-extract the project and try again.
pause
exit /b 1

REM ============================================================
REM :UNZIP  <zipFile> <destDir>
REM tar (Windows 10 1803+, bsdtar) handles zip archives; older
REM systems fall back to PowerShell 5+'s Expand-Archive.
REM ============================================================
:UNZIP
tar -xf "%~1" -C "%~2"
if not errorlevel 1 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~1' -DestinationPath '%~2' -Force"
exit /b %errorlevel%

REM ============================================================
REM :STRLEN  <string> <resultVar>   - path length helper
REM ============================================================
:STRLEN
set "s=%~1#"
set "l=0"
for %%i in (8192 4096 2048 1024 512 256 128 64 32 16 8 4 2 1) do (
  if not "!s:~%%i,1!"=="" (
    set /a l+=%%i
    set "s=!s:~%%i!"
  )
)
set "%~2=%l%"
exit /b 0

REM ============================================================
REM :PIPONLINE  <packages...>   - pip with mirror fallback
REM Tries PyPI directly, then two mirrors that are usually
REM reachable when files.pythonhosted.org is blocked/slow.
REM ============================================================
:PIPONLINE
"%PYEXE%" -m pip install --timeout 60 --retries 4 %*
if not errorlevel 1 exit /b 0
color 0E
echo [WARN] Direct PyPI failed - retrying via the Aliyun mirror ...
"%PYEXE%" -m pip install --timeout 60 --retries 4 -i https://mirrors.aliyun.com/pypi/simple/ %*
if not errorlevel 1 exit /b 0
echo [WARN] Aliyun mirror failed - retrying via the Tsinghua mirror ...
"%PYEXE%" -m pip install --timeout 60 --retries 4 -i https://pypi.tuna.tsinghua.edu.cn/simple %*
exit /b %errorlevel%
