@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
set REPORT=devnet_exercise.txt
set PAYER=%USERPROFILE%\.config\solana\id.json
echo RatchetX core v1 - DEVNET exercise > "%REPORT%"
echo. >> "%REPORT%"
echo Exercising the live devnet program with your devnet payer (nothing of value moves) ...
call node onchain\ratchet-core\client\exercise-devnet.mjs --rpc https://api.devnet.solana.com --keypair "%PAYER%" >> "%REPORT%" 2>&1
echo. >> "%REPORT%"
echo --- crank, one pass, real (there are no shots yet, so it should find nothing to do) --- >> "%REPORT%"
call node onchain\ratchet-core\client\crank.mjs --rpc https://api.devnet.solana.com --keypair "%PAYER%" --once >> "%REPORT%" 2>&1
type "%REPORT%"
echo.
echo ---------------------------------------------
echo Saved to %REPORT% - Claude reads it over the bridge.
echo ---------------------------------------------
