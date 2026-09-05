@echo off
setlocal
REM Run only after the release lead's source-ready handoff.
REM This builds and verifies a candidate. It never deploys or authorises mainnet.
cd /d "%~dp0" || exit /b 1
set TIMEPIN_ID=C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp
set CORE_ID=cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN
where node >nul 2>&1
if errorlevel 1 (
  echo FAIL: node is required for the G2 build handoff.
  exit /b 1
)
node tools\g2-build-artifacts.mjs --build --timepin-id "%TIMEPIN_ID%" --core-id "%CORE_ID%"
set "RX_BUILD_EXIT=%ERRORLEVEL%"
endlocal & exit /b %RX_BUILD_EXIT%
