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
echo RatchetX DEVNET faucet program - deploy + full shot life > "%REPORT%"
echo. >> "%REPORT%"
where solana >nul 2>&1
if errorlevel 1 goto :nosol
echo Devnet balance (need ~4 SOL; faucet.solana.com to your payer if short): >> "%REPORT%"
call solana balance >> "%REPORT%" 2>&1
echo Deploying the DEVNET faucet program (separate id CnKAJ... - never mainnet) ... >> "%REPORT%"
call solana program deploy --program-id "%KEY%" "%SO%" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"
echo Running the whole shot life: faucet -^> reload -^> seal -^> settle -^> reveal ... >> "%REPORT%"
call node onchain\ratchet-core-devnet\full-life.mjs --rpc https://api.devnet.solana.com --keypair "%PAYER%" --minutes 1 >> "%REPORT%" 2>&1
type "%REPORT%"
echo.
echo ------------------------------------------------
echo Saved to %REPORT% - send it to Claude (or he reads it over the bridge).
echo ------------------------------------------------
goto :end
:nosol
echo Solana CLI not on PATH.>> "%REPORT%"
type "%REPORT%"
:end
