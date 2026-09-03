@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
echo.
echo  REPAIR THE KEYS THE MIGRATION IMPORTED AS THE WRONG TYPE
echo.
echo  The Supabase import decided each key's Redis type from its name, and five
echo  hash families never followed that naming rule - so they arrived as plain
echo  strings. Every read of them throws WRONGTYPE. That is why pyth-context was
echo  returning 500 and why Bankr answered RELEASE_MISMATCH.
echo.
echo  This looks first and asks second. It shows you every key whose type is
echo  wrong and exactly what it will rebuild, and changes nothing until you type
echo  REPAIR. Each key is rebuilt from the value already stored in it - nothing
echo  is invented, nothing comes from a file. Safe to run twice.
echo.
echo  You need the same two values the site uses. Get them from the Upstash
echo  dashboard (or the Vercel environment variables): KV_REST_API_URL and
echo  KV_REST_API_TOKEN. They are not saved anywhere by this script.
echo.
set "KV_REST_API_URL="
set "KV_REST_API_TOKEN="
set /p KV_REST_API_URL=KV_REST_API_URL: 
set /p KV_REST_API_TOKEN=KV_REST_API_TOKEN: 
echo.
call node tools\kv_repair_shapes.mjs
set "KV_REST_API_TOKEN="
set "KV_REST_API_URL="
echo.
echo  (the token has been cleared from this window)
echo  (this window stays open - close it when you are done)
