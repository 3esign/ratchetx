@echo off
setlocal
REM ============================================================
REM  RATCHET - load the rescued legacy store into a Redis KV.
REM  Classifies first with no network, shows the plan, and waits
REM  for you to type IMPORT. Never touches Supabase.
REM
REM  Credentials are collected HERE and handed to node as
REM  environment variables: node's own prompt could not be made
REM  to read twice reliably from a cmd window. The token is read
REM  through PowerShell so it is not echoed to the screen, and
REM  neither value is ever written to a file.
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

echo  Paste the HTTPS REST endpoint from the Upstash console.
echo  NOT the redis:// line - that one is for redis-cli.
echo.
set "KV_REST_API_URL="
set /p KV_REST_API_URL=  REST URL  : 
if not defined KV_REST_API_URL goto :nourl

echo.
echo  Now the REST token. It will not be shown as you paste it.
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString ' '; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "KV_REST_API_TOKEN=%%T"
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
