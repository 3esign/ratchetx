@echo off
REM ============================================================
REM  RATCHET - what did we rescue? Reads the newest rescue file,
REM  prints a census. No network, no database, nothing changed.
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  RESCUE INVENTORY - reads the file, touches nothing else
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode
node tools\rescue_inventory.mjs
goto :end

:nonode
echo  Node was not found on PATH.
goto :end

:end
echo.
