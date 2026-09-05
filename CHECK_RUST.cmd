@echo off
REM ============================================================
REM  CHECK_RUST.cmd  -  does the Rust COMPILE? Nothing else.
REM
REM  Why this exists. On 2026-09-05 the MIN-CAPTURE predicate was
REM  written into both programs by an agent with NO cargo (commit
REM  ebd69b8, labelled COMPILED: NO). Everything downstream - the
REM  Gate 1 build, the vector re-pin, the ELF lock, devnet - waits
REM  on one question that takes two minutes to answer and had no
REM  way to be asked from the cloud bridge: does it compile?
REM
REM  This is NOT the Gate 1 build. Use BUILD_G2.cmd for that, and
REM  only once the spec section 7 tests are green. This runs
REM  `cargo check` and `cargo test --no-run`, which type-check the
REM  crates AND their #[cfg(test)] modules and PRODUCE NO ARTIFACT:
REM  no .so, no vectors re-pinned, no ELF hash locked. It cannot
REM  turn one build into three, because it does not build one.
REM
REM  Read-only against the chain. No key. Nothing is deployed.
REM ============================================================
if defined RX_CHECK_KEEPOPEN goto :run
set RX_CHECK_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
set REPORT=check_rust_report.txt
echo check_rust %date% %time%> "%REPORT%"
echo ============================================================
echo  DOES THE RUST COMPILE  -  no artifact, no deploy, no key
echo ============================================================
echo.
where cargo >nul 2>&1 || goto :nocargo
call cargo --version
call cargo --version >> "%REPORT%" 2>&1
echo.
set RX_FAILED=0

echo [1/4] rcx-timepin-v2  -  cargo check ...
pushd onchain\rcx-timepin-v2
call cargo check --locked --all-targets >> "..\..\%REPORT%" 2>&1
if errorlevel 1 (echo   FAILED & set RX_FAILED=1) else (echo   ok)
popd

echo [2/4] rcx-timepin-v2 svm-tests  -  cargo test --no-run ...
pushd onchain\rcx-timepin-v2\svm-tests
call cargo test --locked --no-run >> "..\..\..\%REPORT%" 2>&1
if errorlevel 1 (echo   FAILED & set RX_FAILED=1) else (echo   ok)
popd

echo [3/4] ratchet-core-g2  -  cargo check ...
pushd onchain\ratchet-core-g2
call cargo check --locked --all-targets >> "..\..\%REPORT%" 2>&1
if errorlevel 1 (echo   FAILED & set RX_FAILED=1) else (echo   ok)
popd

echo [4/4] ratchet-core-g2 svm-tests  -  cargo test --no-run ...
pushd onchain\ratchet-core-g2\svm-tests
call cargo test --locked --no-run >> "..\..\..\%REPORT%" 2>&1
if errorlevel 1 (echo   FAILED & set RX_FAILED=1) else (echo   ok)
popd

echo.
if "%RX_FAILED%"=="1" goto :failed
echo  ============================================================
echo  IT COMPILES. All four targets type-check, tests included.
echo.
echo  This is NOT a GO and NOT Gate 1. It means the source is
echo  syntactically and type-wise sound - nothing about whether the
echo  RULE is right. That is the ten tests in MIN_CAPTURE_SPEC.md
echo  section 7, at host and exact-SBF, and they still need writing.
echo.
echo  Post the result in ROOM.md so the agent who wrote it blind
echo  can stop labelling it COMPILED: NO.
echo  ============================================================
goto :end

:failed
echo  ============================================================
echo  IT DOES NOT COMPILE  -  and that is exactly what this script
echo  is for. The errors are in %REPORT%.
echo.
echo  Paste the first error block into ROOM.md. The code was written
echo  without a compiler on purpose, to keep the critical path
echo  moving, on the understanding that this step would catch what
echo  a human eye cannot. Nothing downstream has been built, so
echo  nothing has to be undone.
echo  ============================================================
goto :end

:nocargo
echo  PROBLEM: cargo is not on PATH, so this machine cannot answer
echo  the question. Install Rust from https://rustup.rs, or run this
echo  on the machine that produced target\deploy\rcx_timepin_v2.so.

:end
echo.
echo  (window stays open - close it yourself when done)
