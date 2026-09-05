@echo off
REM ============================================================
REM  PUBLISH_PROMISE_FIX.cmd
REM
REM  Puts the corrected freeze copy in front of the public, and
REM  NOTHING ELSE. The 2026-09-08 promise is still live to the
REM  world and it expires Monday.
REM
REM  Why not PUSH.cmd: that runs `git push origin HEAD:main`, and
REM  this branch is 67 commits ahead of main with a half-written
REM  MIN-CAPTURE rule that nobody has compiled yet. Pushing it
REM  would publish unfinished on-chain work to the branch Bankr
REM  installs from.
REM
REM  What this does instead: a clean worktree on main, cherry-pick
REM  the ONE documentation commit, gate it, push main, deploy the
REM  site from that clean tree. The deployed code stays exactly the
REM  h113 that is live today; only the promise text changes.
REM ============================================================
if defined RX_PUB_KEEPOPEN goto :run
set RX_PUB_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
set REPORT=publish_promise_report.txt
set FIXCOMMIT=d7c9162
set WT=..\ratchetx-main-publish

echo ============================================================
echo  PUBLISH THE CORRECTED PROMISE  -  documentation only
echo ============================================================
echo.
echo publish_promise %date% %time%> "%REPORT%"

echo [1/6] Preparing a clean worktree on main ...
if exist "%WT%" (
  echo   reusing %WT%
  pushd "%WT%"
  call git fetch origin >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
  call git checkout main >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
  call git reset --hard origin/main >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
  popd
) else (
  call git worktree add "%WT%" main >> "%REPORT%" 2>&1
  if errorlevel 1 goto :wtfail
)

pushd "%WT%"

echo [2/6] Cherry-picking the documentation fix %FIXCOMMIT% ...
call git cherry-pick %FIXCOMMIT% >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
if errorlevel 1 goto :pickfail

echo [3/6] Showing exactly what will be published ...
call git show --stat HEAD
call git show --stat HEAD >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
echo.
echo   If that list is anything other than README.md, llms.txt,
echo   docs/AGENT_STATE.json and docs/FREEZE.md, CLOSE THIS WINDOW.
echo.

echo [4/6] Running the release gate on the clean tree ...
call npm test >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
if errorlevel 1 goto :gatefail
call node scripts\check-release-safety.mjs >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
if errorlevel 1 goto :gatefail
echo   gate passed on a clean tree.

echo [5/6] Pushing main ...
call git push origin main >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
if errorlevel 1 goto :pushfail

echo [6/6] Deploying the site from this clean tree ...
call npx --yes vercel deploy --prod --yes > "%TEMP%\rx_pub_vercel.txt" 2>&1
set "RX_PUB_EXIT=%ERRORLEVEL%"
type "%TEMP%\rx_pub_vercel.txt"
type "%TEMP%\rx_pub_vercel.txt" >> "..\ratchet_phase_a_clean\%REPORT%"
if not "%RX_PUB_EXIT%"=="0" goto :deployfail

echo.
echo  Verifying the live text ...
call node -e "fetch('https://ratchetx.xyz/llms.txt').then(r=>r.text()).then(t=>{const bad=t.includes('destroyed on 2026-09-08')||t.includes('scheduled for revocation on 2026-09-08');console.log(bad?'STILL PROMISING 09-08 - NOT FIXED':'LIVE TEXT IS CORRECTED');process.exit(bad?1:0)}).catch(e=>{console.error(e.message);process.exit(1)})"
call node -e "fetch('https://ratchetx.xyz/llms.txt').then(r=>r.text()).then(t=>{const bad=t.includes('destroyed on 2026-09-08')||t.includes('scheduled for revocation on 2026-09-08');process.exit(bad?1:0)}).catch(()=>process.exit(1))" >> "..\ratchet_phase_a_clean\%REPORT%" 2>&1
if errorlevel 1 goto :verifyfail

popd
echo.
echo  ============================================================
echo  DONE. main carries the correction, the site serves it, and
echo  the live llms.txt no longer promises the 09-08 revocation.
echo  The on-chain work on codex/core-source-bracket was NOT
echo  pushed and NOT deployed.
echo  ============================================================
goto :end

:wtfail
echo  Could not create the worktree. Read %REPORT%.
goto :end
:pickfail
popd
echo.
echo  CHERRY-PICK FAILED - main has moved under the fix. Nothing was
echo  pushed. Read %REPORT%, then ask Claude; do not resolve a
echo  conflict in a publishing script.
goto :end
:gatefail
popd
echo.
echo  GATE FAILED ON A CLEAN TREE. That is a real failure, not a
echo  local mess - nothing was pushed or deployed. Read %REPORT%.
goto :end
:pushfail
popd
echo.
echo  PUSH FAILED - probably credentials. Nothing was deployed.
goto :end
:deployfail
popd
echo.
echo  DEPLOY FAILED but MAIN WAS PUSHED. GitHub carries the
echo  correction; the site does not yet. Read %REPORT%.
goto :end
:verifyfail
popd
echo.
echo  DEPLOYED, BUT THE LIVE TEXT STILL READS THE OLD PROMISE.
echo  Do not call this done. Read %REPORT% and check whether the
echo  deployment actually went to ratchetx.xyz.

:end
echo.
echo  (window stays open - close it yourself when done)
