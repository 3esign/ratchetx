@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
echo ============================================================
echo   SETTLE THE EXPIRED SHOTS
echo ============================================================
echo.
echo   Settlement on RatchetX is lazy: an expired shot settles when
echo   somebody touches that wallet. Usually that is the player
echo   loading the page. If nobody does, the shot sits expired and
echo   its stake sits in nobody's credits.
echo.
echo   That is what is standing between you and the migration root.
echo   This walks the public snapshot and touches every wallet with
echo   an expired shot, which is the same thing a visit would do.
echo.
echo   It needs no keys and no login. It cannot choose an outcome -
echo   the exit price was fixed by the oracle when the window closed.
echo   All it decides is that the settlement happens now rather than
echo   whenever somebody happens to log in. It stays at half the
echo   public rate limit and backs off on its own.
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode

call node tools\crank.mjs --once
REM  A pass that could not look is not a pass that found nothing. The crank
REM  exits non-zero on a failed single pass so this can tell them apart.
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   DONE. Give the settlements a minute to land, then run
echo   LEGACY_ROOT_LIVE.cmd again.
echo.
echo   If it still refuses with open shots, run this once more -
echo   a shot that settles can pay out into a wallet whose own
echo   shot then needs a touch, so one pass does not always
echo   finish the chain.
echo ============================================================
goto :end

:failed
echo.
echo ============================================================
echo   THE PASS FAILED - nothing was settled.
echo.
echo   The reason is printed above. Nothing here can corrupt
echo   anything: every action it takes is one the API already lets
echo   any stranger take, and a failed pass simply did not act.
echo.
echo   If it says TIMEOUT: the full snapshot builds the entire
echo   hash-chained log before it answers. This crank asks for the
echo   cheap players-only view first, which exists once the site is
echo   redeployed; until then it falls back to the slow one with a
echo   two-minute patience. Run it again before worrying.
echo ============================================================
goto :end

:nonode
echo   Node was not found on PATH.
goto :end

:end
echo.
echo (this window stays open - close it when you are done)
