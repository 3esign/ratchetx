@echo off
REM ============================================================
REM  RATCHET - run ONCE on token day, right after Jupiter Studio
REM  gives you the mint address. Turns on real burns. ~2 minutes.
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo Paste the RATCHET mint address from Jupiter Studio when asked, then Enter.
call npx --yes vercel env rm RATCHET_MINT production -y >nul 2>nul
call npx --yes vercel env add RATCHET_MINT production
echo.
echo Redeploying with real burns enabled...
call npx --yes vercel deploy --prod
echo.
if errorlevel 1 goto :fail
echo DONE. Burn-to-play is LIVE.
goto :end
:fail
echo FAILED - the error is above. Tell Claude what it says.
:end
echo (window stays open - close it yourself)
