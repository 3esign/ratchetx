@echo off
setlocal EnableDelayedExpansion
REM ============================================================
REM  RATCHET - plug in a fast RPC (Helius free tier) in ~3 min.
REM  Get the key first: helius.dev - sign up free - copy the key.
REM ============================================================
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo Paste your Helius API key OR the full RPC URL, then press Enter.
echo   (a key looks like 1a2b3c4d-...   a URL starts with https://)
echo.
set /p RPCIN="> "
if "!RPCIN!"=="" goto :empty
echo !RPCIN! | findstr /b "https://" >nul
if errorlevel 1 set "RPCURL=https://mainnet.helius-rpc.com/?api-key=!RPCIN!"
if not errorlevel 1 set "RPCURL=!RPCIN!"
echo.
echo Setting SOLANA_RPC_URL for production...
call npx --yes vercel env rm SOLANA_RPC_URL production -y >nul 2>nul
echo !RPCURL!| call npx --yes vercel env add SOLANA_RPC_URL production
echo.
echo Redeploying so the functions pick it up...
call npx --yes vercel deploy --prod
echo.
if errorlevel 1 goto :fail
echo DONE. Proof page and burns now ride Helius; public RPC stays as fallback.
goto :end
:empty
echo Nothing entered - aborting.
goto :end
:fail
echo FAILED - the error is above. Tell Claude what it says.
:end
echo (window stays open - close it yourself. Your key lives only in Vercel env vars.)
