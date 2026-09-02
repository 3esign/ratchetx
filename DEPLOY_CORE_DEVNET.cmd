@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
set REPORT=devnet_deploy.txt
set KEYPAIR=D:\keys\ratchet-core-program.json
set SO=onchain\ratchet-core\artifacts\ratchet_core-v1-2026-09-02.so
set PROGRAM=6sJn9CfSwD3Jt8V6vYyHq5hYmLKdDmaTgqwHY5czpPBv
echo RatchetX core v1 - DEVNET deploy > "%REPORT%"
echo. >> "%REPORT%"

where solana >nul 2>&1
if errorlevel 1 goto :nosolana

echo Program id : %PROGRAM% >> "%REPORT%"
echo Artifact   : %SO% >> "%REPORT%"
echo Keypair    : %KEYPAIR%  (stays on this machine) >> "%REPORT%"
echo. >> "%REPORT%"

if not exist "%SO%" goto :noso
if not exist "%KEYPAIR%" goto :nokey

echo Pointing the Solana CLI at devnet ...
call solana config set --url https://api.devnet.solana.com >> "%REPORT%" 2>&1

echo Checking your deployer balance (need ~4 SOL of devnet SOL for a program this size) ...
call solana balance >> "%REPORT%" 2>&1
echo If that is under ~4 SOL, run:  solana airdrop 5   (a few times if it rate-limits), then re-run this.
echo.

echo Deploying (this uploads the .so and can take a minute) ...
call solana program deploy --program-id "%KEYPAIR%" "%SO%" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"
echo --- on-chain program account after deploy --- >> "%REPORT%"
call solana program show %PROGRAM% >> "%REPORT%" 2>&1

type "%REPORT%"
echo.
echo ---------------------------------------------
echo Done. Send me %REPORT% and I run the crank against devnet to exercise the whole shot life.
echo ---------------------------------------------
goto :end

:nosolana
echo Solana CLI not found on PATH. Install it first (Agave/solana-install), then re-run.>> "%REPORT%"
type "%REPORT%"
goto :end
:noso
echo Artifact not found: %SO%  (build it first, or fix the path).>> "%REPORT%"
type "%REPORT%"
goto :end
:nokey
echo Keypair not found: %KEYPAIR%  (this is your core program key; it never leaves this machine).>> "%REPORT%"
type "%REPORT%"
goto :end
:end
