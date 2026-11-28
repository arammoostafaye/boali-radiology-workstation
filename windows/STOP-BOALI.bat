@echo off
chcp 65001 >nul
setlocal EnableExtensions
title BOALI RADIOLOGY SUITE - STOP
color 0C

echo ==========================================================
echo    BOALI RADIOLOGY SUITE  -  STOP ALL SERVICES
echo    Stops the hidden background services:
echo    engine :3020   pacs :3021   web :3000
echo ==========================================================
echo.

set "FOUND=0"
for %%P in (3000 3020 3021) do (
  for /f "tokens=5" %%p in ('netstat -aon -p tcp ^| findstr /c:":%%P " ^| findstr "LISTENING"') do (
    if %%p GEQ 10 (
      echo    [STOP] Port %%P  -  killing PID %%p ...
      taskkill /PID %%p /T /F >nul 2>&1
      set "FOUND=1"
    )
  )
)

if "%FOUND%"=="0" (
  color 0E
  echo    Nothing to stop - no Boali services are running.
) else (
  echo.
  echo    All Boali services stopped.
)
echo.
echo Done. You can close this window.
timeout /t 4 >nul
endlocal
exit /b 0
