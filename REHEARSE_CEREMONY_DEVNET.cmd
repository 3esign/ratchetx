@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"

rem ===================================================================
rem  ZERO-AUTHORITY CEREMONY — DEVNET DRESS REHEARSAL
rem
rem  Rehearses the exact mainnet sequence on a THROWAWAY devnet program:
rem      build -> deploy -> VERIFY -> revoke -> confirm -> stranger plays
rem
rem  Two things this script enforces rather than merely documents:
rem    1. It refuses to run anywhere but devnet. The check is the cluster
rem       GENESIS HASH, not the RPC url, so a mislabelled endpoint cannot
rem       smuggle the revoke onto mainnet.
rem    2. It will NOT revoke unless verification has already succeeded.
rem       On mainnet that order is irreversible: the verified-build PDA can
rem       only be written by the upgrade authority, so revoking first loses
rem       self-service verification forever.
rem ===================================================================

set REPORT=devnet_ceremony.txt
set PF=devnet_ceremony_preflight.txt
set RPC=https://api.devnet.solana.com
set PROGRAM=CnKAJQAQvJQ7Ht3rZRt4ZaFuZSFL4G6sDZShbmJUdTCx
set PROGKEY=onchain\ratchet-core-devnet\devnet-program-keypair.json
set PAYER=%USERPROFILE%\.config\solana\id.json

rem --- verification parameters: adjust to match the repo layout ----------
set REPO=https://github.com/3esign/ratchetx
set LIBNAME=ratchet_core
set MOUNTPATH=onchain/ratchet-core-devnet
rem -----------------------------------------------------------------------

echo RatchetX - zero-authority ceremony, DEVNET rehearsal > "%REPORT%"
echo %DATE% %TIME% >> "%REPORT%"
echo. >> "%REPORT%"

where solana >nul 2>&1
if errorlevel 1 goto :nosolana

echo [1/6] Preflight - cluster, program, and whether the authority is still live...
call solana config set --url %RPC% >> "%REPORT%" 2>&1
node onchain\ratchet-core-devnet\ceremony-preflight.mjs --rpc %RPC% --program %PROGRAM% --keypair "%PAYER%" > "%PF%" 2>&1
type "%PF%"
type "%PF%" >> "%REPORT%"

findstr /C:"RXVERDICT NOTDEVNET" "%PF%" >nul
if not errorlevel 1 goto :notdevnet
findstr /C:"RXVERDICT NOTDEPLOYED" "%PF%" >nul
if not errorlevel 1 goto :notdeployed
findstr /C:"RXVERDICT IMMUTABLE" "%PF%" >nul
if not errorlevel 1 goto :immutable
findstr /C:"RXVERDICT SHORT" "%PF%" >nul
if not errorlevel 1 goto :short
findstr /C:"RXVERDICT READY" "%PF%" >nul
if errorlevel 1 goto :retry

echo.
echo [2/6] Authority BEFORE the ceremony:
call solana program show %PROGRAM% >> "%REPORT%" 2>&1
call solana program show %PROGRAM%

echo.
echo [3/6] VERIFY - this must succeed BEFORE anything is revoked.
where solana-verify >nul 2>&1
if errorlevel 1 goto :noverify
where docker >nul 2>&1
if errorlevel 1 goto :nodocker
rem  The --remote FLAG on verify-from-repo is deprecated upstream. Verification
rem  is now two steps and both must pass before anything is revoked:
rem    1. verify-from-repo  - rebuilds from source in the pinned docker image,
rem       compares the hash to the deployed program, and writes the build data
rem       to the program's PDA. This is the step that needs Docker, and the
rem       step that needs the upgrade authority - which is exactly why it can
rem       never be done after the authority is gone.
rem    2. remote submit-job - asks OtterSec to rebuild it independently and
rem       publish the verdict, so a stranger does not have to take our word.
rem  The uploader is whoever signed the PDA write -- the upgrade authority, i.e.
rem  this machine's configured wallet. Read it rather than hardcode it, so a
rem  rehearsal run from a different keypair submits under that keypair.
for /f "delims=" %%A in ('solana address') do set UPLOADER=%%A
echo Uploader (upgrade authority): %UPLOADER%
echo Uploader: %UPLOADER% >> "%REPORT%"
echo Running: solana-verify verify-from-repo --program-id %PROGRAM% %REPO% --library-name %LIBNAME% --mount-path %MOUNTPATH%
echo --- verify-from-repo --- >> "%REPORT%"
call solana-verify verify-from-repo --program-id %PROGRAM% %REPO% --library-name %LIBNAME% --mount-path %MOUNTPATH% >> "%REPORT%" 2>&1
if errorlevel 1 goto :verifyfailed
echo Build data written to the PDA. Submitting the remote job...
echo --- remote submit-job --- >> "%REPORT%"
call solana-verify remote submit-job --program-id %PROGRAM% --uploader %UPLOADER% >> "%REPORT%" 2>&1
if errorlevel 1 goto :verifyfailed
echo Verification registered.
echo Verification registered. >> "%REPORT%"

echo.
echo [4/6] REVOKE - irreversible for this devnet program.
echo     After this, these rules can never be changed again - not even by you.
echo     This is the rehearsal of the one mainnet step that has no undo.
set /p GO="Type  REVOKE  to continue (anything else aborts): "
if /I not "%GO%"=="REVOKE" goto :aborted
echo --- set-upgrade-authority --final --- >> "%REPORT%"
call solana program set-upgrade-authority %PROGRAM% --final >> "%REPORT%" 2>&1
if errorlevel 1 goto :revokefailed

echo.
echo [5/6] Confirming on chain that the authority is gone...
node onchain\ratchet-core-devnet\ceremony-preflight.mjs --rpc %RPC% --program %PROGRAM% > "%PF%" 2>&1
type "%PF%"
type "%PF%" >> "%REPORT%"
findstr /C:"RXVERDICT IMMUTABLE" "%PF%" >nul
if errorlevel 1 goto :notimmutable
echo CONFIRMED: upgrade authority is NONE. The program is immutable.
echo CONFIRMED: upgrade authority is NONE. >> "%REPORT%"

echo.
echo [6/6] Proving a stranger can still use an immutable program...
echo     (a fresh keypair that has never touched our infrastructure)
call DEVNET_FAUCET_FULLLIFE.cmd
goto :done

:notdevnet
echo. & echo STOPPED: that cluster is not devnet. Nothing was changed.
goto :end
:notdeployed
echo. & echo STOPPED: program not deployed on devnet. Run DEPLOY_CORE_DEVNET.cmd first.
goto :end
:immutable
echo. & echo STOPPED: this program's authority is already revoked - nothing left to rehearse.
echo Deploy a fresh throwaway devnet program to rehearse again.
goto :end
:short
echo. & echo STOPPED: payer is short. Run:  solana airdrop 2
goto :end
:retry
echo. & echo STOPPED: could not read the RPC. Nothing was decided; just re-run.
goto :end
:noverify
echo. & echo STOPPED before revoking: solana-verify is not installed.
echo   1. Install Rust if you have not:  https://rustup.rs  (no admin needed)
echo   2. cargo install solana-verify --locked
echo Then re-run this script.
echo Rehearsing the revoke without the verify would teach the wrong order.
goto :end
:nodocker
echo. & echo STOPPED before revoking: Docker is not available, and the verified
echo build is a deterministic docker build, and verify-from-repo runs it here to
echo compare the hash against the deployed program before submitting anything.
echo   Install Docker Desktop:  https://www.docker.com/products/docker-desktop
echo   Then start it, wait for the whale icon to settle, and re-run this script.
echo There is no way around this one: a verification nobody can reproduce is not
echo a verification, and after the revoke it can never be produced at all.
goto :end
:verifyfailed
echo. & echo STOPPED: verification did not register - so NOTHING was revoked.
echo That is the correct outcome. An unverified immutable program is the worst
echo of both worlds. Fix verification first, then re-run.
goto :end
:revokefailed
echo. & echo Revoke command failed. See %REPORT%.
goto :end
:notimmutable
echo. & echo WARNING: the authority still reads as present after revoking. Inspect %REPORT%.
goto :end
:aborted
echo. & echo Aborted before revoking. Nothing was changed.
goto :end
:nosolana
echo Solana CLI not found. Install it, then re-run.
goto :end

:done
echo.
echo ---------------------------------------------
echo Rehearsal complete. Report: %REPORT%
echo You have now done the irreversible step once, where it was free.
echo ---------------------------------------------
:end
echo.
