@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
echo ============================================================
echo   LEGACY ROOT, FROM THE LIVE STORE
echo ============================================================
echo.
echo   Two steps. First it takes a fresh snapshot of the player rows
echo   from the store the game is actually using, then it builds the
echo   migration root from that.
echo.
echo   Why not the old rescue file: that one was taken at 01:40 on
echo   3 September, while the game was off the air. The site has been
echo   live since. A root from it would be a precise, verifiable claim
echo   about a moment that has passed.
echo.
echo   It reads and never writes. The only commands it sends are SCAN,
echo   MGET and PTTL. The snapshot goes to your private folder, never
echo   into the repository - it is every player's balance.
echo.
echo   It will REFUSE if any shot is still open, and tell you when the
echo   last one expires. That is not a fault. A stake in flight is in
echo   nobody's credits, so those players would migrate short by
echo   exactly that much.
echo.
echo   You need the same two values the site uses: KV_REST_API_URL and
echo   KV_REST_API_TOKEN, from Upstash or your Vercel environment.
echo   Nothing is saved by this script.
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode

set "KV_REST_API_URL="
set "KV_REST_API_TOKEN="
set /p KV_REST_API_URL=KV_REST_API_URL: 
set /p KV_REST_API_TOKEN=KV_REST_API_TOKEN: 
echo.

echo   [1/2] Reading the live store ...
call node tools\live_snapshot.mjs
if errorlevel 1 goto :snapfail
set "KV_REST_API_TOKEN="
set "KV_REST_API_URL="
echo   (the token has been cleared from this window)
echo.

echo   [2/2] Building the root from what was just read ...
call node tools\legacy_root.mjs %*
if errorlevel 1 goto :refused

echo.
echo ============================================================
echo   ROOT BUILT. merkle_tree.json, merkle_balances.json and
echo   merkle_excluded.json are in this folder.
echo.
echo   Read merkle_excluded.json before going further - it lists
echo   every wallet the root leaves out and why.
echo.
echo   When you are ready to compile it into the program:
echo     node scripts\set-legacy-root.mjs merkle_tree.json
echo ============================================================
goto :end

:refused
set "KV_REST_API_TOKEN="
set "KV_REST_API_URL="
echo.
echo ============================================================
echo   IT REFUSED, and the reason is above. Nothing was written
echo   that a later step could mistake for a finished root.
echo.
echo   The snapshot it just took IS saved, so when you re-run this
echo   after the open shots settle it costs you one more read and
echo   nothing else.
echo ============================================================
goto :end

:snapfail
set "KV_REST_API_TOKEN="
set "KV_REST_API_URL="
echo.
echo   Could not read the live store. The reason is above. Nothing
echo   was written and nothing in the store was touched.
goto :end

:nonode
echo   Node was not found on PATH.
goto :end

:end
echo.
echo (this window stays open - close it when you are done)
