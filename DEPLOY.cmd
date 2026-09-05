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

REM  A folder deploy uploads the WORKING TREE, so a file that ships while
REM  uncommitted puts bytes live that no commit contains: unreviewable,
REM  unreproducible, impossible to roll back to. Only the DEPLOY SET is a
REM  hard stop - this tree is permanently dirty while G2 is built and none
REM  of that ships, so it must never stand between you and a deploy. The
REM  check is a node script on purpose: batch is the one thing nobody here
REM  can run, and a gate nobody can run is not a gate.
REM  Escape hatch: RATCHET_DEPLOY_DIRTY=1, set nowhere in this repository.
echo  Checking the files that will ship against their commits...
node scripts/check-clean-tree.mjs >> deploy_check.txt 2>&1
if errorlevel 1 goto :dirtytree
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
REM Recheck after tests: tests can create files in the upload directory.
node scripts/check-release-safety.mjs >> deploy_check.txt 2>&1
if errorlevel 1 goto :testfail
call npx --yes vercel deploy --prod --yes > "%TEMP%\rx_vercel.txt" 2>&1
set "RATCHET_DEPLOY_EXIT=%ERRORLEVEL%"
type "%TEMP%\rx_vercel.txt"
type "%TEMP%\rx_vercel.txt" >> deploy_check.txt
echo.
if not "%RATCHET_DEPLOY_EXIT%"=="0" goto :vercelfail
echo  ============================================================
echo  SUCCESS - your site is live at the URL printed above.
echo  VERIFYING the live API against lib/release.js...
node -e "const expected=require('./lib/release.js').RELEASE;fetch('https://ratchetx.xyz/api/game?action=state').then(r=>r.json()).then(s=>{console.log('expected',expected,'live',s.v);process.exit(s.v===expected?0:1)}).catch(e=>{console.error(e);process.exit(1)})" >> deploy_check.txt 2>&1
if errorlevel 1 goto :verifyfail
echo  LIVE RELEASE MATCHES SOURCE.
echo  ============================================================
goto :end

:vercelfail
REM  The CLI's own words, sorted into the two that have a known answer.
findstr /i /c:"Not authorized" /c:"credentials" /c:"not authenticated" "%TEMP%\rx_vercel.txt" >nul 2>&1
if not errorlevel 1 goto :notauth
findstr /i /c:"does not exist" /c:"Project not found" "%TEMP%\rx_vercel.txt" >nul 2>&1
if not errorlevel 1 goto :nolink
goto :fail

:notauth
echo  ============================================================
echo  VERCEL SAYS YOU ARE NOT SIGNED IN.
echo.
echo  Nothing is wrong with the code - the release gate passed and
echo  nothing was sent. The CLI just has no valid login for the team
echo  that owns this project.
echo.
echo  Fix it in this same window:
echo.
echo      npx vercel login
echo.
echo  It opens a browser. Pick the account that owns the ratchetx
echo  project, come back here, then run DEPLOY.cmd again.
echo.
echo  If it says you ARE logged in already, close this window and
echo  run DEPLOY.cmd from a NORMAL window rather than an
echo  Administrator one - an elevated shell can read a different
echo  user profile, and the saved login lives in the profile.
echo  ============================================================
goto :end

:nolink
echo  ============================================================
echo  VERCEL CANNOT FIND THE PROJECT.
echo.
echo  .vercel\project.json points at a project this login cannot
echo  see. Either sign in as the account that owns it:
echo.
echo      npx vercel login
echo.
echo  or re-link with  npx vercel link  and pick the right one.
echo  Nothing was sent to production.
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

:dirtytree
echo  ============================================================
echo  DEPLOY STOPPED - files that SHIP are not in any commit.
echo  Deploying now would publish bytes no commit contains.
echo  deploy_check.txt names them. Only shipping files count;
echo  uncommitted work outside the deploy set is not the problem.
echo  Commit those files, then run this again. To publish
echo  uncommitted bytes deliberately: set RATCHET_DEPLOY_DIRTY=1.
echo  Nothing was sent to production.
echo  ============================================================
goto :end
:end
echo.
echo  (window stays open - close it yourself when done)
