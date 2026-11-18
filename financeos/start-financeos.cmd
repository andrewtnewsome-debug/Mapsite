@echo off
REM FinanceOS launcher for Windows. Double-click this file to start FinanceOS.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing FinanceOS for the first time. This can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo Installation failed. See SETUP_GUIDE.md, Troubleshooting.
    pause
    exit /b 1
  )
)
echo Starting FinanceOS. Open http://localhost:3000 in your browser.
echo Press Ctrl+C in this window to stop FinanceOS.
call npm run dev
pause
