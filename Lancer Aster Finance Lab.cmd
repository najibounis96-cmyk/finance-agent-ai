@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 ou plus est requis.
  pause
  exit /b 1
)

if not exist node_modules (
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Aster Finance Lab demarre. Ouvrez http://127.0.0.1:5173 dans votre navigateur.
call npm run dev
pause
