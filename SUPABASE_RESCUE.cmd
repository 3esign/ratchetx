@echo off
REM ============================================================
REM  RATCHET - rescue the legacy Supabase data. READ ONLY.
REM  Writes nothing to the database. Revokes nothing. Deletes nothing.
REM  The window stays open. A report goes to your private folder.
REM  House rule: "call" before npm - npm is itself a .cmd and would
REM  silently kill this script without it.
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  RATCHET LEGACY RESCUE - read only, nothing is changed
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist "node_modules\pg\package.json" (
  echo  The postgres client is missing. Installing it once...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :nodeps
)

echo  You will be asked for the DATABASE password once.
echo  That is the Postgres password from the Supabase dashboard,
echo  NOT the service key. It is typed into this window only and is
echo  never written to any file.
echo.
echo  What happens next: one connection, one count, then every row is
echo  streamed to a file in your private folder with a sha256 beside it.
echo.

node tools\supabase_rescue.mjs
if errorlevel 2 goto :nopass
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  RESCUED. The rows and their manifest are in:
echo    %%LOCALAPPDATA%%\RatchetX\private-snapshots
echo  This is a BACKUP, not a migration root - writers were never
echo  fenced, so it cannot anchor a cutover. It is simply ours now.
echo ============================================================
goto :end

:nonode
echo  Node was not found on PATH. Install Node, then run this again.
goto :end

:nodeps
echo  npm install failed - see the lines above.
goto :end

:nopass
echo  No password was given, so nothing was attempted.
goto :end

:failed
echo  It did not complete. The reason is printed above and saved in the
echo  report file named at the end of the output. Nothing was changed.
goto :end

:end
echo.
