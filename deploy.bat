@echo off
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git is missing. Install it from https://git-scm.com then run this again.
  pause & exit /b 1
)
where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI is missing. Run: winget install GitHub.cli
  pause & exit /b 1
)
where npx >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install it from https://nodejs.org then run this again.
  pause & exit /b 1
)

echo.
echo === GitHub ===
gh auth status >nul 2>nul
if errorlevel 1 gh auth login
if not exist .git git init -b main

rem Rename the old discord-amplifier repo to dios-amplifier (skipped if it is already renamed)
git remote get-url origin 2>nul | findstr /i "discord-amplifier" >nul
if not errorlevel 1 (
  gh repo rename dios-amplifier --yes
  for /f "delims=" %%u in ('gh repo view dios-amplifier --json url -q .url 2^>nul') do git remote set-url origin %%u.git
)

git add -A
git commit -m "DIOS Amplifier v2: 100,000x loud and clear engine, presets, gate, EQ, recorder, new design"
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  gh repo create dios-amplifier --public --source=. --remote=origin --push
) else (
  git push -u origin main
)

echo.
echo === Vercel ===
call npx vercel@latest whoami >nul 2>nul
if errorlevel 1 call npx vercel@latest login
call npx vercel@latest deploy --prod --yes

echo.
echo Done. Your site URL is printed above.
pause
