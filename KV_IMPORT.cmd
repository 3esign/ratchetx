@echo off
setlocal
REM ============================================================
REM  RATCHET - load the rescued legacy store into a Redis KV.
REM  Classifies first with no network, shows the plan, and waits
REM  for you to type IMPORT. Never touches Supabase.
REM
REM  Both values are read with set /p and handed to node as
REM  environment variables. The first attempt hid the token behind
REM  PowerShell's Read-Host, and what came back through `for /f`
REM  carried a carriage return that node refused as an invalid
REM  Authorization header. A prompt that works beats a prompt that
REM  is clever: the token is visible on your own screen for a few
REM  seconds, it is never written to a file, the variable is
REM  cleared when node exits, and Upstash can rotate it in one
REM  click if you would rather it had never been shown.
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

echo  From the Upstash console, the HTTPS REST endpoint.
echo  NOT the redis:// line - that one is for redis-cli.
echo.
set "KV_REST_API_URL="
set /p KV_REST_API_URL=  REST URL  : 
if not defined KV_REST_API_URL goto :nourl

echo.
set "KV_REST_API_TOKEN="
set /p KV_REST_API_TOKEN=  REST token: 
if not defined KV_REST_API_TOKEN goto :notoken

echo.
node tools\kv_import.mjs
set "KV_REST_API_TOKEN="
goto :end

:nourl
echo  No URL given - nothing was sent.
goto :end

:notoken
echo  No token given - nothing was sent.
goto :end

:nonode
echo  Node was not found on PATH.
goto :end

:end
echo.
endlocal
