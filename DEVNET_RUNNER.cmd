@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
rem RatchetX Core v1 - OPEN RUNNER against the devnet faucet program (CnKAJ...).
rem Run this on ANY machine - yours, a friend's VPS, a stranger's laptop. It needs
rem only node and this folder (git clone https://github.com/3esign/ratchetx then
rem npm install). It settles, voids, forfeits and closes shots that the program
rem lets anyone finish. Nothing of RatchetX's has to be online for it to work.
set REPORT=devnet_runner.txt
set RPC=https://api.devnet.solana.com
set KEY=%USERPROFILE%\.config\solana\id.json
if exist "%KEY%" goto :havekey
set KEY=devnet-runner-keypair.json
if exist "%KEY%" goto :havekey
echo No devnet key found - making a throwaway one (%KEY%, devnet only, gitignored) ...
call node -e "const{Keypair}=require('@solana/web3.js');const fs=require('fs');const k=Keypair.generate();fs.writeFileSync(process.argv[1],JSON.stringify([...k.secretKey]));console.log('runner key',k.publicKey.toBase58())" "%KEY%"
:havekey
if not exist node_modules\@solana\web3.js (
  echo Installing @solana/web3.js ...
  call npm install --no-audit --no-fund >nul 2>&1
)
echo Runner fee payer:
call node -e "const{Connection,Keypair}=require('@solana/web3.js');const fs=require('fs');const k=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[1]))));const c=new Connection(process.argv[2]);c.getBalance(k.publicKey).then(async b=>{console.log(' ',k.publicKey.toBase58(),(b/1e9).toFixed(3),'SOL');if(b<0.2e9){console.log('  low - asking the devnet faucet for 1 SOL ...');try{await c.requestAirdrop(k.publicKey,1e9);console.log('  airdrop requested; if it is rate-limited use https://faucet.solana.com with the address above')}catch(e){console.log('  airdrop refused:',e.message.split('\n')[0],'- use https://faucet.solana.com with the address above')}}})" "%KEY%" %RPC%
echo.
echo Running the open runner (Ctrl+C to stop). Log: %REPORT%
echo ------------------------------------------------
call node onchain\ratchet-core-devnet\crank.mjs --rpc %RPC% --keypair "%KEY%" --interval 5 --close 2>&1 | node -e "process.stdin.pipe(require('fs').createWriteStream(process.argv[1],{flags:'a'}));process.stdin.pipe(process.stdout)" "%REPORT%"
