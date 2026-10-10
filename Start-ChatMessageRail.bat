@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-Rail.ps1" -Mode Enable
echo.
pause
