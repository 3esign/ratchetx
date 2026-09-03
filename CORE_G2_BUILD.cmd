@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
set REPORT=core_g2_build.txt
echo RatchetX Core - ruleset 2 build and full battery > "%REPORT%"
echo. >> "%REPORT%"
echo This does four things, in order, and stops at the first one that fails:
echo   1. the program's own unit tests
echo   2. reprints the golden vectors and checks them against vectors/core-rules-v2.json
echo   3. builds ratchet_core.so with the frozen recipe
echo   4. runs the LiteSVM adversarial battery against those exact bytes
echo Everything it prints also lands in %REPORT%.
echo.

where cargo >nul 2>&1
if errorlevel 1 goto :nocargo
where cargo-build-sbf >nul 2>&1
if errorlevel 1 goto :nosbf

cd onchain\ratchet-core

echo [1/4] Program unit tests ...
echo ==== 1. cargo test ==== >> "..\..\%REPORT%"
call cargo test --locked >> "..\..\%REPORT%" 2>&1
if errorlevel 1 goto :failed

echo [2/4] Golden vectors ...
echo. >> "..\..\%REPORT%"
echo ==== 2. golden vectors ==== >> "..\..\%REPORT%"
call cargo test --locked print_golden_vectors -- --ignored --nocapture > "%TEMP%\rx_vectors_raw.txt" 2>&1
if errorlevel 1 goto :failed
powershell -NoProfile -Command "$l=Get-Content '%TEMP%\rx_vectors_raw.txt'; $a=[array]::IndexOf($l,'GOLDEN_VECTORS_BEGIN'); $b=[array]::IndexOf($l,'GOLDEN_VECTORS_END'); if($a -lt 0 -or $b -le $a){exit 1}; $l[($a+1)..($b-1)] | Set-Content -Encoding ascii '%TEMP%\rx_vectors.json'"
if errorlevel 1 goto :novectors
fc /b "%TEMP%\rx_vectors.json" "vectors\core-rules-v2.json" >nul 2>&1
if errorlevel 1 goto :vectordrift
echo golden vectors: identical to vectors\core-rules-v2.json >> "..\..\%REPORT%"

echo [3/4] Building ratchet_core.so (this takes a few minutes the first time) ...
echo. >> "..\..\%REPORT%"
echo ==== 3. cargo build-sbf ==== >> "..\..\%REPORT%"
call cargo build-sbf -- --locked >> "..\..\%REPORT%" 2>&1
if errorlevel 1 goto :failed
echo. >> "..\..\%REPORT%"
echo Fresh bytes: >> "..\..\%REPORT%"
powershell -NoProfile -Command "$f='target\deploy\ratchet_core.so'; '{0} bytes  sha256 {1}' -f (Get-Item $f).Length,(Get-FileHash $f -Algorithm SHA256).Hash.ToLower()" >> "..\..\%REPORT%" 2>&1
powershell -NoProfile -Command "$f='target\deploy\ratchet_core.so'; '{0} bytes  sha256 {1}' -f (Get-Item $f).Length,(Get-FileHash $f -Algorithm SHA256).Hash.ToLower()"

echo [4/4] LiteSVM adversarial battery ...
echo. >> "..\..\%REPORT%"
echo ==== 4. LiteSVM battery ==== >> "..\..\%REPORT%"
set RATCHET_CORE_SO=%CD%\target\deploy\ratchet_core.so
cd svm-tests
call cargo test --locked -- --nocapture >> "..\..\..\..\%REPORT%" 2>&1
if errorlevel 1 goto :failedsvm
cd ..\..\..

echo. >> "%REPORT%"
echo RESULT: ALL GREEN >> "%REPORT%"
echo.
echo ================================================================
echo   ALL GREEN. Ruleset 2 builds and every battery passes.
echo.
echo   The fresh binary is at
echo     onchain\ratchet-core\target\deploy\ratchet_core.so
echo   Its hash is in %REPORT%. To make CI green too, copy it into
echo     onchain\ratchet-core\artifacts\
echo   named ratchet_core-v2-YYYY-MM-DD.so and commit it. That file
echo   is what the reproducibility gate compares a clean build to.
echo ================================================================
goto :end

:failedsvm
cd ..\..\..
goto :failed

:vectordrift
echo. >> "..\..\%REPORT%"
echo VECTOR DRIFT >> "..\..\%REPORT%"
cd ..\..
echo.
echo ================================================================
echo   The program's rules no longer match vectors\core-rules-v2.json.
echo   The server (lib/core_rules.js) and the client are pinned to
echo   that file, so this means one half of settlement has moved and
echo   the other has not. Nothing should ship until it is explained.
echo.
echo   The freshly printed vectors were left at:
echo     %TEMP%\rx_vectors.json
echo   Compare them with vectors\core-rules-v2.json before touching
echo   either one.
echo ================================================================
goto :end

:novectors
cd ..\..
echo.
echo Could not read the printed vectors. Raw output: %TEMP%\rx_vectors_raw.txt
goto :end

:failed
cd /d "%~dp0"
echo.
echo ================================================================
echo   A step failed. The full log is in %REPORT% - the last 30 or so
echo   lines usually say exactly what. Nothing was deployed and
echo   nothing on chain was touched; this script only builds and tests.
echo ================================================================
goto :end

:nocargo
echo.
echo Rust is not on PATH. Install it from https://rustup.rs then re-run this.
goto :end

:nosbf
echo.
echo cargo-build-sbf is not on PATH. That comes with the Solana tool suite,
echo the same one DEPLOY_CORE_DEVNET.cmd uses. Install it, open a new
echo terminal so PATH refreshes, then re-run this.
goto :end

:end
echo.
echo (this window stays open - close it when you are done)
