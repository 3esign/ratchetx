@echo off
setlocal
REM ============================================================
REM  RATCHET - build the legacy migration root from the rescued
REM  snapshot. Reads a file, writes two files, touches no network
REM  and no database. It REFUSES rather than guesses.
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  LEGACY ROOT - who owned what, provable on chain
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode

node tools\legacy_root.mjs %*
if errorlevel 1 goto :refused

echo.
echo  Next, when you are ready to build the program with it:
echo    node scripts\set-legacy-root.mjs merkle_tree.json
goto :end

:refused
echo.
echo  It refused, and the reason is above. Nothing was written that
echo  a later step could mistake for a finished root.
goto :end

:nonode
echo  Node was not found on PATH.
goto :end

:end
echo.
endlocal
