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
set PROG=CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx
set RPC=https://api.devnet.solana.com
echo RatchetX DEVNET faucet program - self-healing deploy + full shot life > "%REPORT%"
echo. >> "%REPORT%"
where solana >nul 2>&1
if errorlevel 1 goto :nosol
call solana config set --url %RPC% >nul 2>&1

echo [1/5] Recovering any SOL stranded in old deploy buffers ... >> "%REPORT%"
call solana program close --buffers >> "%REPORT%" 2>&1

echo [2/5] Checking devnet balance (need 3.3 SOL: ~3.06 rent for the program + fees) ... >> "%REPORT%"
call node -e "const{Connection,PublicKey}=require('@solana/web3.js');const fs=require('fs');const k=JSON.parse(fs.readFileSync(process.argv[1]));const {Keypair}=require('@solana/web3.js');const kp=Keypair.fromSecretKey(Uint8Array.from(k));new Connection(process.argv[2]).getBalance(kp.publicKey).then(b=>{const s=b/1e9;console.log('balance',s.toFixed(3),'SOL');process.exit(s>=3.3?0:1)}).catch(e=>{console.log('balance check failed',e.message);process.exit(1)})" "%PAYER%" %RPC% >> "%REPORT%" 2>&1
if not errorlevel 1 goto :funded

echo    short - asking the faucet (rate-limited, 3 tries) ... >> "%REPORT%"
call solana airdrop 2 >> "%REPORT%" 2>&1
call solana airdrop 2 >> "%REPORT%" 2>&1
call solana airdrop 2 >> "%REPORT%" 2>&1
call node -e "const{Connection,Keypair}=require('@solana/web3.js');const fs=require('fs');const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[1]))));new Connection(process.argv[2]).getBalance(kp.publicKey).then(b=>{const s=b/1e9;console.log('balance now',s.toFixed(3),'SOL');process.exit(s>=3.3?0:1)})" "%PAYER%" %RPC% >> "%REPORT%" 2>&1
if not errorlevel 1 goto :funded
goto :needfaucet

:funded
echo [3/5] Is the faucet program already on devnet? >> "%REPORT%"
call node -e "const{Connection,PublicKey}=require('@solana/web3.js');new Connection(process.argv[2]).getAccountInfo(new PublicKey(process.argv[1])).then(a=>{console.log(a&&a.executable?'already deployed - skipping deploy':'not deployed yet');process.exit(a&&a.executable?0:1)})" %PROG% %RPC% >> "%REPORT%" 2>&1
if not errorlevel 1 goto :deployed

echo [4/5] Deploying the DEVNET faucet program (id %PROG%, never mainnet) ... >> "%REPORT%"
call solana program deploy --program-id "%KEY%" "%SO%" >> "%REPORT%" 2>&1
call node -e "const{Connection,PublicKey}=require('@solana/web3.js');new Connection(process.argv[2]).getAccountInfo(new PublicKey(process.argv[1])).then(a=>{process.exit(a&&a.executable?0:1)})" %PROG% %RPC% >> "%REPORT%" 2>&1
if errorlevel 1 goto :deployfail

:deployed
echo [5/5] Full shot life (about 8 minutes): faucet -^> reload -^> seal A+B -^> checkpoint -^> settle A -^> reveal A -^> deadline -^> void B -^> close ... >> "%REPORT%"
echo        (started %TIME% - leave the window open) >> "%REPORT%"
call node onchain\ratchet-core-devnet\full-life.mjs --rpc %RPC% --keypair "%PAYER%" --minutes 5 >> "%REPORT%" 2>&1
goto :show

:needfaucet
echo. >> "%REPORT%"
echo STOP: still under 3.3 SOL and the CLI faucet is rate-limited. >> "%REPORT%"
echo Open https://faucet.solana.com , paste this address, request 5 SOL, then run this script again: >> "%REPORT%"
call solana address >> "%REPORT%" 2>&1
goto :show

:deployfail
echo. >> "%REPORT%"
echo STOP: deploy did not land (see errors above). Re-run this script - it recovers buffers and retries. >> "%REPORT%"
goto :show

:nosol
echo Solana CLI not on PATH. >> "%REPORT%"

:show
type "%REPORT%"
echo.
echo ------------------------------------------------
echo Saved to %REPORT% - Claude reads it over the bridge. Re-running is always safe.
echo ------------------------------------------------
