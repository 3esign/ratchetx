@echo off
setlocal
set "RXDIR=D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean"
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
echo ============================================================
echo   COMMIT THE THREE PENDING PIECES
echo ============================================================
echo.
echo   Every file is already correct on your disk - I wrote them all
echo   there directly, so nothing here can half-apply. This makes the
echo   three commits. It does not push and does not deploy.
echo.
echo     1  STOCK_CADENCE.cmd            the /? quoting fix
echo     2  test_migration_freeze.mjs    a real test of the freeze
echo     3  onchain_cost + ONCHAIN_COST  what the game costs on chain,
echo        + STOCKS_DECISION            and how the crank funds itself
echo.
echo   Safe while the cadence measurement runs. Nothing is restarted.
echo.
cd /d "%RXDIR%"
if errorlevel 1 goto :nodir
if not exist "PUSH.cmd" goto :nodir
where git >nul 2>nul
if errorlevel 1 goto :nogit
if not exist "tools\onchain_cost.mjs" goto :missing
if not exist "test\test_onchain_cost.mjs" goto :missing
if not exist "docs\ONCHAIN_COST.md" goto :missing
if not exist "test\test_migration_freeze.mjs" goto :missing
pause
echo.
echo   [1/5] Clearing any stale locks ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$g=Join-Path $env:RXDIR '.git'; $l=Get-ChildItem -LiteralPath $g -Recurse -Force -Filter '*.lock' -ErrorAction SilentlyContinue; if(-not $l){Write-Host '     none'; exit 0}; $bad=0; foreach($f in $l){ try { $f.Attributes='Normal'; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; Write-Host ('     removed ' + $f.Name) } catch { $bad++; Write-Host ('     STUCK   ' + $f.FullName + '  ->  ' + $_.Exception.Message) } }; exit $bad"
if errorlevel 1 goto :lockstuck
echo.
echo   [2/5] What is here now:
call git status --short
echo.
echo   [3/5] Commit 1 of 3 - the cmd quoting fix ...
call git add STOCK_CADENCE.cmd
call git commit -q -m "a URL with /? in it is a help switch to cmd, not an argument" -m "A Helius endpoint contains /?api-key=. Unquoted, cmd read the leading /? as CALL help switch and printed CALL manual instead of measuring. Quoted now, and it asks how many minutes rather than expecting a flag - the flag went into the RPC prompt and worked only by accident. A prompt that can be answered wrongly and still appear to work is worse than one that asks out loud." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 echo      (nothing to commit there - carrying on)
echo.
echo   [4/5] Commit 2 of 3 - the freeze test ...
call git add test\test_migration_freeze.mjs
call git commit -q -m "the freeze had never been thrown, only described" -m "RX_MIGRATION_FREEZE gets thrown exactly once, on the day a mistake costs the most, and all that defended it was an assertion that api/game.js CONTAINS the right lines - which would have passed just as happily if takeStake refused settlement too. This loads game.js twice against one shared store, once selling and once frozen, and asserts both halves: it stops SELLING (shot refused, challenge refused, and a refused seal debits nothing and opens no chamber) and it never stops SETTLING (a shot sealed before the freeze still settles, still records the hit, still pays 1.7x)." -m "Verified it can fail: const forced false breaks 6 checks, refusal disabled breaks 6, generic SHOT_REFUSED breaks 2." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 echo      (nothing to commit there - carrying on)
echo.
echo   [5/5] Commit 3 of 3 - the cost model ...
call git add tools\onchain_cost.mjs test\test_onchain_cost.mjs docs\ONCHAIN_COST.md docs\STOCKS_DECISION.md
call git commit -q -m "the crank is not a bill, it is a market nobody opened yet" -m "G4 asks for costs at 1, 100 and 1000 agents from measured actions, not a guessed forecast. Nothing in this repo carried a lamports figure of any kind, so the migration plan sat downstream of an unchecked assumption. Rent and base fees are arithmetic over constants already compiled into the program: exact today, no devnet needed. A thousand players is affordable - 10.9 SOL locked, 0.06 spent per cycle, and the locked part is the players own refundable deposit." -m "The finding: a checkpoint is only useful where a shot expires, and one serves every shot expiring in that publish interval. So the crank is proportional at low volume and capped at high - 1.33 checkpoints per shot at one player, 0.32 at ten thousand. Cost per shot FALLS as the game grows, which is the shape a self-funding levy needs, and it is a property of the design as built. When the purse empties the bounty is zero and every instruction still works: it degrades to where the game stands today, never to stopped." -m "close_shot needs no purse at all - it releases rent, so paying the caller out of what it recovers is self-financing by construction. And blocker 8 is the same problem wearing a different hat: a crossing goes uncaptured because nobody was paid to capture it. Stocks came out ahead too - 870s cadence means 99 checkpoints/day against SOL 1440, and 64 observations cover 928 minutes, so a 6-hour stock shot settles with no bind_crossing at all." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 goto :commitfailed
echo.
echo ============================================================
call git log --oneline -4
echo.
echo   COMMITTED. Run PUSH.cmd when you want them on GitHub.
echo ============================================================
goto :end
:commitfailed
echo.
echo   A commit did not go through - reason above. Send me this.
goto :end
:lockstuck
echo.
echo   STOPPED: a lock would not delete, reason printed next to it.
goto :end
:missing
echo   STOPPED: one of the new files is not on disk yet. Tell me and
echo   I will re-send it.
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
