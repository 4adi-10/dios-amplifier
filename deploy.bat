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
git add -A
git commit -m "Discord Amplifier"
gh repo create discord-amplifier --public --source=. --remote=origin --push
if errorlevel 1 (
  echo Repo may already exist, pushing to it instead.
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
