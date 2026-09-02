@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
rem RatchetX devnet SHOOTER - a player, not a runner. Seals one 5-minute SOL shot
rem every 6 minutes for 24 h (faucet credits), reveals its own settled shots, and
rem NEVER settles anything - so whoever runs DEVNET_RUNNER.cmd elsewhere is the
rem one finishing the shots. Leave both windows open; read devnet_shooter.txt.
set REPORT=devnet_shooter.txt
set RPC=https://api.devnet.solana.com
set KEY=%USERPROFILE%\.config\solana\id.json
if not exist "%KEY%" (
  echo No devnet payer at %KEY% - run DEPLOY_CORE_DEVNET.cmd once first.
  goto :eof
)
echo Shooter runs 24 h, one shot every 6 min (Ctrl+C to stop). Log: %REPORT%
echo ------------------------------------------------
call node onchain\ratchet-core-devnet\shooter.mjs --rpc %RPC% --keypair "%KEY%" --every 6 --hours 24 2>&1 | node -e "process.stdin.pipe(require('fs').createWriteStream(process.argv[1],{flags:'a'}));process.stdin.pipe(process.stdout)" "%REPORT%"
