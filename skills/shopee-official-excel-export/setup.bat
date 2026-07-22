@echo off & chcp 65001 >nul & cd /d "%~dp0" & node scripts\setup.mjs & pause & exit /b %ERRORLEVEL%
@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo Shopee Official Excel Export - Setup
echo.

where node >nul 2>nul
if errorlevel 1 goto node_missing

echo Installing dependencies...
npm install
if errorlevel 1 goto install_failed

node -e "require('playwright'); console.log('Playwright OK')"
if errorlevel 1 goto playwright_failed

if not exist "%USERPROFILE%\.codex" mkdir "%USERPROFILE%\.codex"
if exist "%USERPROFILE%\.codex\shopee-official-excel-export.config.json" goto ready
echo {}>"%USERPROFILE%\.codex\shopee-official-excel-export.config.json"

:ready
echo.
echo Environment is ready.
echo 环境已就绪
pause
exit /b 0

:node_missing
echo Node.js is not installed or not available in PATH.
echo Please install Node.js 20 or later, then run setup.bat again.
pause
exit /b 1

:install_failed
echo.
echo Dependency installation failed.
echo Please run this command manually in this folder:
echo npm install
pause
exit /b 1

:playwright_failed
echo.
echo Playwright check failed.
echo Please run:
echo npm install playwright
pause
exit /b 1
