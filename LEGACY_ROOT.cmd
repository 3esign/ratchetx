@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
rem LEGACY MIGRATION, the founder's one click on the chosen day. Order matters:
rem   BEFORE this: put the site in read-only mode and let every open shot finish
rem   (the script refuses a snapshot that still has open stake).
rem   1. dump the Supabase ledger (u:* keys)        -> kv_dump.json
rem   2. reconcile credits / xp / open stake        -> merkle_balances.json
rem   3. Merkle tree with the program's leaf rule    -> merkle_tree.json (root + proofs)
rem   4. verify every proof, write LEGACY_ROOT into the core source
rem   AFTER this: commit + push -> CI builds the 4th build -> add the .so under
rem   onchain/ratchet-core/artifacts, record its sha256 in docs/CORE.md, deploy
rem   with DEPLOY_CORE_MAINNET.cmd. Players claim once with claim_legacy.
set REPORT=legacy_root.txt
echo RatchetX legacy snapshot %DATE% %TIME% > "%REPORT%"
if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
) else (
  echo No .env here - SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in this window. >> "%REPORT%"
)
echo [1/4] dump >> "%REPORT%"
call node scripts\dump_kv.mjs >> "%REPORT%" 2>&1
if errorlevel 1 goto :fail
echo [2/4] reconcile >> "%REPORT%"
call node scripts\reconcile.mjs >> "%REPORT%" 2>&1
if errorlevel 1 goto :fail
echo [3/4] merkle >> "%REPORT%"
call node scripts\merkle_generator.mjs >> "%REPORT%" 2>&1
if errorlevel 1 goto :fail
echo [4/4] verify + write LEGACY_ROOT >> "%REPORT%"
call node scripts\set-legacy-root.mjs merkle_tree.json >> "%REPORT%" 2>&1
if errorlevel 1 goto :fail
echo. >> "%REPORT%"
echo DONE. Now: git add onchain/ratchet-core/programs/ratchet-core/src/lib.rs merkle_tree.json ; commit ; push. >> "%REPORT%"
echo (kv_dump.json and merkle_balances.json stay local - they are gitignored.) >> "%REPORT%"
goto :show
:fail
echo. >> "%REPORT%"
echo STOPPED - nothing was written to the program source. Read the lines above. >> "%REPORT%"
:show
type "%REPORT%"
echo ------------------------------------------------
echo Saved to %REPORT%
