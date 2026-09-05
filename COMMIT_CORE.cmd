@echo off
setlocal
set "RXDIR=D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean"
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
echo ============================================================
echo   COMMIT THE CORE WORK
echo ============================================================
echo.
echo   Every file is already correct on your disk. This makes four
echo   commits. It does not push and does not deploy.
echo.
echo     1  mainnet-exercise + onchain_cost   compute units were
echo                                          measured and discarded
echo     2  lib.rs                            the crank purse
echo     3  lib.rs                            bind_entry, forward entry
echo     4  ONCHAIN_COST + STOCKS_DECISION    what the run measured
echo.
echo   Commits 2 and 3 both touch lib.rs, so they are split by staging
echo   the same file twice - the second commit carries what the first
echo   did not. Nothing is lost either way.
echo.
echo   Safe while the cadence measurement runs.
echo.
cd /d "%RXDIR%"
if errorlevel 1 goto :nodir
if not exist "PUSH.cmd" goto :nodir
where git >nul 2>nul
if errorlevel 1 goto :nogit
set "LIB=onchain\ratchet-core\programs\ratchet-core\src\lib.rs"
if not exist "%LIB%" goto :missing
if not exist "tools\onchain_cost.mjs" goto :missing
pause
echo.
echo   [1/6] Clearing any stale locks ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$g=Join-Path $env:RXDIR '.git'; $l=Get-ChildItem -LiteralPath $g -Recurse -Force -Filter '*.lock' -ErrorAction SilentlyContinue; if(-not $l){Write-Host '     none'; exit 0}; $bad=0; foreach($f in $l){ try { $f.Attributes='Normal'; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; Write-Host ('     removed ' + $f.Name) } catch { $bad++; Write-Host ('     STUCK   ' + $f.FullName) } }; exit $bad"
if errorlevel 1 goto :lockstuck
echo.
echo   [2/6] Commit 1 of 4 - the compute-unit loop ...
call git add tools\mainnet-exercise.mjs tools\onchain_cost.mjs test\test_onchain_cost.mjs
call git commit -q -m "the compute measurement was already being taken and thrown away" -m "mainnet-exercise puts every transaction through simulateTransaction before deciding whether to send it, simulation returns unitsConsumed, and the script printed the number and dropped it. --cu-out records it; onchain_cost --cu reads it back. --dry sends nothing and spends nothing, so the measurement costs a run and no SOL. The report is refused without program, cluster and timestamp: a CU figure that cannot say what it measured is worse than none. Price per CU is asked for, never assumed." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 echo      (nothing there - carrying on)
echo.
echo   [3/6] Commit 2 of 4 - the crank purse ...
call git add "%LIB%"
call git commit -q -m "the crank purse: permissionless was never the same as paid" -m "Permissionless AND UNPAID means the work is done by whoever happens to care, which is a dependency on a person. Because one checkpoint serves every shot expiring in its publish interval, cranking costs 1.33 calls per shot at one player and 0.32 at ten thousand, so a per-seal levy carries it and gets cheaper as the game grows. The purse rides in remaining_accounts, so no account list changes and every instruction still works with no purse in sight - it pays nothing. pay_cranker returns Ok(0) on every branch that cannot pay: a bounty must never be able to refuse an instruction." -m "Both numbers ship at zero, same discipline as BAND_K_BPS." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 echo      (nothing there - carrying on)
echo.
echo   [4/6] Commit 3 of 4 - bind_entry ...
call git add "%LIB%"
call git commit -q -m "bind the entry forward: a price nobody can know at seal" -m "ENTRY_FORWARD takes the entry from the first print at or after the seal - prev_publish_time < sealed_ts <= publish_time, the crossing predicate bind_crossing already applies at the other end. You cannot seal on a stale price if your entry price does not exist yet, so the freshness bound is not relaxed, it is inapplicable. Per feed, shipping all zero." -m "An unbindable entry REFUSES rather than settling: entry_e12 would be 0 and a strike of zero scores every shot a hit. Binding twice refuses rather than re-pricing. A feed outside the table has no entry rule - defaulting to OBSERVED would sell a slow feed under the fast rule. Shot grows 17 bytes so it can prove both ends of itself; rent 0.002659 -> 0.002777 per open shot." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 echo      (nothing there - carrying on)
echo.
echo   [5/6] Commit 4 of 4 - what the measurement said ...
call git add docs\ONCHAIN_COST.md docs\STOCKS_DECISION.md
call git commit -q -m "870 seconds is a metronome, and the ring is smaller than we thought" -m "71 minutes, 211 polls, zero RPC errors, control sound. 870s is EXACT - min, median and max agree within one second across five feeds. AAPLX is on its own 600s schedule, so the six do not share one publisher. HOODX is intermittent (6.8 days stale on the 2nd, 6.25 hours tonight) where COINX is dead (10.7 -> 34.7 hours). Mask decided: 0b1100000 for every feed." -m "And a correction: SOL produced 210 publish times across 211 polls, so the run is SAMPLING-LIMITED and SOL is not on a 60s heartbeat. A push account updates on deviation OR heartbeat, so 60s is the quiet floor. At 20s the ring covers 21 minutes not 64, and the 30m horizon outruns it too. The ring covers least time exactly when the market is moving, so bind_crossing is load-bearing at nearly every horizon on a busy day and the cost table is a FLOOR." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 goto :commitfailed
echo.
echo   [6/6] Anything left uncommitted from these files:
call git status --short -- "%LIB%" tools docs test
echo.
echo ============================================================
call git log --oneline -5
echo.
echo   COMMITTED. Run PUSH.cmd when you want them on GitHub.
echo ============================================================
goto :end
:commitfailed
echo.
echo   A commit did not go through - reason above. Send me this.
goto :end
:lockstuck
echo   STOPPED: a lock would not delete. Send me this window.
goto :end
:missing
echo   STOPPED: a file is not on disk yet. Tell me which step said so.
goto :end
:nodir
echo   STOPPED: could not open %RXDIR% - do not run as Administrator.
goto :end
:nogit
echo   git was not found on PATH.
goto :end
:end
echo.
echo (this window stays open - close it when you are done)
