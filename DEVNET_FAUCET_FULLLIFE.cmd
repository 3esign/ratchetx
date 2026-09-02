@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
set REPORT=devnet_fulllife.txt
set PAYER=%USERPROFILE%\.config\solana\id.json
set KEY=onchain\ratchet-core-devnet\devnet-program-keypair.json
set SO=onchain\ratchet-core-devnet\ratchet_core_devnet.so
set PRE=onchain\ratchet-core-devnet\devnet-preflight.mjs
set PROG=CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx
set RPC=https://api.devnet.solana.com
set TMP=preflight.tmp
> "%REPORT%" echo RatchetX DEVNET faucet program - self-healing deploy + full shot life
>> "%REPORT%" echo.
where solana >nul 2>&1
if errorlevel 1 goto :nosol
call solana config set --url %RPC% >nul 2>&1

echo [1/4] Recovering any SOL stranded in old deploy buffers ... >> "%REPORT%"
call solana program close --buffers >> "%REPORT%" 2>&1
echo. >> "%REPORT%"

set TRIED=0
:preflight
echo [2/4] Preflight: balance, and is the faucet program already on devnet? >> "%REPORT%"
call node "%PRE%" --rpc %RPC% --keypair "%PAYER%" --program %PROG% --so "%SO%" > "%TMP%" 2>&1
type "%TMP%" >> "%REPORT%"
echo. >> "%REPORT%"
findstr /C:"RXVERDICT READY"  "%TMP%" >nul && goto :fulllife
findstr /C:"RXVERDICT DEPLOY" "%TMP%" >nul && goto :deploy
findstr /C:"RXVERDICT RETRY"  "%TMP%" >nul && goto :retry
rem otherwise SHORT - try the CLI faucet once, then re-check, then send to the web faucet
if "%TRIED%"=="1" goto :needfaucet
set TRIED=1
echo    short on devnet SOL - asking the CLI faucet for 2 SOL (often rate-limited) ... >> "%REPORT%"
call solana airdrop 2 >> "%REPORT%" 2>&1
echo. >> "%REPORT%"
goto :preflight

:deploy
echo [3/4] Deploying the DEVNET faucet program (id %PROG% - never the mainnet id) ... >> "%REPORT%"
call solana program deploy --program-id "%KEY%" "%SO%" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"
call node "%PRE%" --rpc %RPC% --keypair "%PAYER%" --program %PROG% --so "%SO%" > "%TMP%" 2>&1
type "%TMP%" >> "%REPORT%"
echo. >> "%REPORT%"
findstr /C:"RXVERDICT READY" "%TMP%" >nul || goto :deployfail

:fulllife
echo [4/4] Full shot life (about 8 minutes): faucet -^> reload -^> seal A+B -^> checkpoint -^> settle A -^> reveal A -^> deadline -^> void B -^> close ... >> "%REPORT%"
echo        (started %TIME% - leave the window open) >> "%REPORT%"
call node onchain\ratchet-core-devnet\full-life.mjs --rpc %RPC% --keypair "%PAYER%" --minutes 5 >> "%REPORT%" 2>&1
goto :show

:needfaucet
echo. >> "%REPORT%"
echo STOP: not enough devnet SOL to deploy, and the CLI faucet is rate-limited right now. >> "%REPORT%"
echo Open https://faucet.solana.com , paste the address below, request 5 SOL, then double-click this file again: >> "%REPORT%"
call solana address >> "%REPORT%" 2>&1
goto :show

:retry
echo. >> "%REPORT%"
echo STOP: could not read the devnet RPC (transient). Check the connection and run this file again. >> "%REPORT%"
goto :show

:deployfail
echo. >> "%REPORT%"
echo STOP: the deploy did not land (see the errors above). Re-run - it recovers buffers and retries. >> "%REPORT%"
goto :show

:nosol
echo Solana CLI not on PATH. Install it, then run this file again. >> "%REPORT%"

:show
del "%TMP%" >nul 2>&1
type "%REPORT%"
echo.
echo ------------------------------------------------
echo Saved to %REPORT% - Claude reads it over the bridge. Re-running is always safe.
echo ------------------------------------------------
