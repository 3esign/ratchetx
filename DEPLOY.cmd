@echo off
REM ============================================================
REM  RATCHET - one-command deploy to Vercel
REM  The window stays open. A report goes to deploy_check.txt.
REM  FIX 2026-08-19: "call npm" - npm is itself a .cmd, and
REM  without CALL it silently kills this script (house rule).
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  RATCHET DEPLOY  -  this window stays open, errors and all
echo ============================================================
echo.
echo RATCHET preflight %date% %time%> deploy_check.txt
where node >> deploy_check.txt 2>&1
node -v >> deploy_check.txt 2>&1
call npm -v >> deploy_check.txt 2>&1

where node >nul 2>nul
if errorlevel 1 goto :nonode
echo  Running the same release gate used by CI...
call npm test >> deploy_check.txt 2>&1
if errorlevel 1 goto :testfail
echo  Release gate passed.
echo  Node found - good. Starting the deploy (first time may take
echo  a minute while npx fetches the Vercel CLI - be patient).
echo.
echo  FIRST RUN ONLY - it asks questions. Answers, in order:
echo    browser login  -  Set up and deploy? Y  -  scope: Enter
echo    Link existing? N  -  Project name: TYPE THE NAME YOU WANT
echo    ONLY lowercase letters, numbers, hyphens - e.g. ratchet-game
echo    (that becomes name.vercel.app)  -  directory: Enter  -  modify? N
echo.
call npx --yes vercel deploy --prod --yes
echo.
if errorlevel 1 goto :fail
echo  ============================================================
echo  SUCCESS - your site is live at the URL printed above.
echo  VERIFYING the live API against lib/release.js...
node -e "const expected=require('./lib/release.js').RELEASE;fetch('https://ratchetx.xyz/api/game?action=state').then(r=>r.json()).then(s=>{console.log('expected',expected,'live',s.v);process.exit(s.v===expected?0:1)}).catch(e=>{console.error(e);process.exit(1)})" >> deploy_check.txt 2>&1
if errorlevel 1 goto :verifyfail
echo  LIVE RELEASE MATCHES SOURCE.
echo  ============================================================
goto :end

:fail
echo  ============================================================
echo  DEPLOY FAILED - the error is printed above this line.
echo  Tell Claude what it says, or say "read deploy_check.txt".
echo  ============================================================
goto :end

:nonode
echo  PROBLEM: Node.js was not found. Install the LTS version from
echo  https://nodejs.org and run this again.
goto :end

:testfail
echo  ============================================================
echo  DEPLOY STOPPED - the complete release gate failed.
echo  Read deploy_check.txt. Nothing was sent to production.
echo  ============================================================
goto :end

:verifyfail
echo  ============================================================
echo  DEPLOY FINISHED BUT LIVE RELEASE VERIFICATION FAILED.
echo  Read deploy_check.txt before calling this release live.
echo  ============================================================

:end
echo.
echo  (window stays open - close it yourself when done)
