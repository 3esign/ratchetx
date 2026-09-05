@echo off
REM ============================================================
REM  COMMIT THE V2 LAYER  -  one click, window stays open.
REM  Why this script exists: the cloud session edits your files
REM  through the bridge, but git there cannot delete its own
REM  temp objects, so it cannot commit. Windows git can.
REM  Nothing is pushed. Nothing is deployed.
REM ============================================================
if defined RX_COMMIT_KEEPOPEN goto :run
set RX_COMMIT_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  COMMITTING THE V2 LAYER  -  local only, no push
echo ============================================================
echo.
echo commit_v2_report %date% %time%> commit_v2_report.txt

if exist ".git\index.lock.stale-1100" (
  echo  removing the stale lock the bridge could not delete...
  del /q ".git\index.lock.stale-1100" >> commit_v2_report.txt 2>&1
)
if exist ".git\index.lock" (
  echo  WARNING: a live .git\index.lock exists. Close any other git
  echo  process, then run this again.
  echo  live index.lock present>> commit_v2_report.txt
  goto :end
)

echo  staging...
call git add onchain/rcx-timepin onchain/rcx-timepin-v2 onchain/ratchet-core-g2 >> commit_v2_report.txt 2>&1
call git add README.md llms.txt docs/AGENT_STATE.json >> commit_v2_report.txt 2>&1
call git add docs/ROAD_TO_MAINNET.md docs/MIN_CAPTURE_SPEC.md AGENT_ONBOARD.md ROOM.md >> commit_v2_report.txt 2>&1
call git add scripts/run-tests.mjs >> commit_v2_report.txt 2>&1

echo.
echo  what is staged:
call git diff --cached --name-only
call git diff --cached --name-only >> commit_v2_report.txt 2>&1
echo.

echo  running the release safety gate over the staged tree...
call node scripts/check-release-safety.mjs >> commit_v2_report.txt 2>&1
if errorlevel 1 goto :gatefail
echo  gate passed.

call git commit -F ".git\COMMIT_V2_MSG.txt" >> commit_v2_report.txt 2>&1
if errorlevel 1 goto :commitfail
echo.
echo  ============================================================
echo  COMMITTED. Nothing was pushed.
call git log -1 --oneline
call git log -1 --oneline >> commit_v2_report.txt 2>&1
echo  ============================================================
goto :end

:gatefail
echo  ============================================================
echo  STOPPED - the release safety gate failed. Nothing committed.
echo  Read commit_v2_report.txt and tell Claude what it says.
echo  ============================================================
goto :end

:commitfail
echo  ============================================================
echo  COMMIT FAILED - read commit_v2_report.txt.
echo  ============================================================

:end
echo.
echo  (window stays open - close it yourself when done)
