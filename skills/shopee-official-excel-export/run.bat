@echo off & chcp 65001 >nul & cd /d "%~dp0" & node scripts\shopee-export.mjs %* & echo. & pause & exit /b 0
@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

node scripts\shopee-export.mjs

echo.
pause
