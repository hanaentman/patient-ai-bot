@echo off
setlocal

cd /d "%~dp0.."
echo [DOCSS] build start...
node scripts\build_docss.js

if errorlevel 1 (
  echo [DOCSS] build failed.
  exit /b 1
)

echo [DOCSS] build complete.
endlocal
