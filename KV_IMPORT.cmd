@echo off
REM ============================================================
REM  RATCHET - load the rescued legacy store into a Redis KV.
REM  Classifies first with no network, shows you the plan, and
REM  waits for you to type IMPORT. Never touches Supabase.
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  KV IMPORT - the rescued rows into their new home
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode
node tools\kv_import.mjs
goto :end

:nonode
echo  Node was not found on PATH.
goto :end

:end
echo.
