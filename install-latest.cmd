@echo off
setlocal
cd /d "%~dp0"
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-latest.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-latest.ps1"
)
set ERR=%ERRORLEVEL%
if not %ERR%==0 (
  echo FAILED exit %ERR%
  pause
  exit /b %ERR%
)
echo OK
pause
