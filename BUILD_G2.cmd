@echo off
REM ============================================================
REM  BUILD_G2.cmd  -  the ONE build of Gate 1, in one click.
REM
REM  Why one script: the identity migration, the SBPFv3 build, the
REM  artifact verification and the vector re-pin are a SINGLE atomic
REM  pass. Doing them separately is how a tree ends up with new-id
REM  PDAs paired to an old-id artifact. Nothing here deploys.
REM
REM  It REFUSES to build until the MIN-CAPTURE rule has landed,
REM  because a build before the rule is a build you do twice.
REM ============================================================
if defined RX_BUILD_KEEPOPEN goto :run
set RX_BUILD_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
set REPORT=build_g2_report.txt
set TIMEPIN_ID=C8wwxUGmoKAV22MaY3oW2Q6QeDbmB9dbNdbohsRjJkYp
set CORE_ID=ANVGVtDrECeyQkS56UZ9ZiWCUxk2JWEVNJioFW8JEwbL

echo ============================================================
echo  GATE 1 BUILD  -  Timepin %TIMEPIN_ID:~0,8%... + Core %CORE_ID:~0,8%...
echo  Nothing is deployed. The window stays open.
echo ============================================================
echo.
echo BUILD_G2 %date% %time%> "%REPORT%"

echo [0/7] Checking the rule has landed ...
findstr /c:"PublishBeforeTarget" onchain\rcx-timepin-v2\programs\rcx-timepin-v2\src\lifecycle.rs >nul 2>&1
if errorlevel 1 goto :norule
findstr /c:"DoesNotBracketTarget," onchain\rcx-timepin-v2\programs\rcx-timepin-v2\src\lifecycle.rs >nul 2>&1
if not errorlevel 1 echo   note: DoesNotBracketTarget still present - fine if adapter 2 kept it deliberately>> "%REPORT%"
echo   rule present.

echo [1/7] Checking the toolchain ...
where cargo >nul 2>&1 || goto :nocargo
where cargo-build-sbf >nul 2>&1 || goto :nosbf
where node >nul 2>&1 || goto :nonode
call cargo-build-sbf --version >> "%REPORT%" 2>&1
call cargo-build-sbf --version
echo   (the plan pins cargo-build-sbf 4.3.0 and platform-tools v1.56 - if the
echo    line above disagrees, stop and say so in the room before continuing.)

echo [2/7] Building Timepin v2 for SBPF v3 ...
cd onchain\rcx-timepin-v2
echo ==== timepin build-sbf ====>> "..\..\%REPORT%"
call cargo build-sbf --arch v3 -- --locked >> "..\..\%REPORT%" 2>&1
if errorlevel 1 goto :buildfail
set TIMEPIN_SO=%CD%\target\deploy\rcx_timepin_v2.so
cd ..\..

echo [3/7] Verifying the Timepin artifact ...
set EXPECT_SBPF=3
REM  REQUIRE_CONTENT_ADDRESS is deliberately NOT set on this run, and that is
REM  not a relaxation - it is the only way this step can execute at all.
REM  verify-artifact.mjs:85-87 makes that mode DEMAND an expected sha256 and an
REM  expected size as positional arguments, and this script passes neither. So
REM  it exited 2 and the run died at 3 of 7 with a message about verification
REM  while nothing was wrong with the artifact. Reproduced 2026-09-05 by OpusB:
REM    EXPECT_SBPF=3 REQUIRE_CONTENT_ADDRESS=1 node tools\verify-artifact.mjs <so> <id>
REM    -> 'release mode requires expected sha256, size, and EXPECT_SBPF', exit 2
REM  It is a catch-22 by construction: release mode checks an artifact against a
REM  hash we already know, and on the FIRST build of a new identity there is no
REM  such hash - producing it is the whole point of Gate 1.
REM  What still guards this run is what matters on a first build: EXPECT_SBPF=3
REM  refuses a wrong architecture, FORBID_PROGRAM_IDS refuses an ELF that still
REM  carries the superseded identity. Record the size and sha256 printed below,
REM  and use REQUIRE_CONTENT_ADDRESS=1 with them on every LATER verification -
REM  which is the mode it was written for.
set REQUIRE_CONTENT_ADDRESS=
set FORBID_PROGRAM_IDS=US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx
call node tools\verify-artifact.mjs "%TIMEPIN_SO%" %TIMEPIN_ID% >> "%REPORT%" 2>&1
if errorlevel 1 goto :verifyfail
call node tools\verify-artifact.mjs "%TIMEPIN_SO%" %TIMEPIN_ID%
set FORBID_PROGRAM_IDS=

echo [4/7] Re-pinning the golden vectors to the built artifact ...
echo ==== repin vectors ====>> "%REPORT%"
call node tools\repin-timepin-vectors.mjs --to %TIMEPIN_ID% --artifact "%TIMEPIN_SO%" --deployable >> "%REPORT%" 2>&1
if errorlevel 1 goto :repinfail
call node tools\repin-timepin-vectors.mjs --check >> "%REPORT%" 2>&1
if errorlevel 1 goto :repinfail
echo   vectors re-pinned and self-checked.

echo [5/7] Building Core G2 for SBPF v3 ...
cd onchain\ratchet-core-g2
echo ==== core g2 build-sbf ====>> "..\..\%REPORT%"
call cargo build-sbf --arch v3 -- --locked >> "..\..\%REPORT%" 2>&1
if errorlevel 1 goto :buildfail
set CORE_SO=%CD%\target\deploy\ratchet_core_g2.so
cd ..\..
REM  Second half of the same defect Opus B found: the original cleared
REM  FORBID_PROGRAM_IDS after step 3 but left REQUIRE_CONTENT_ADDRESS set, so the
REM  Core verification died the same way even once step 3 was fixed by hand.
set EXPECT_SBPF=3
set REQUIRE_CONTENT_ADDRESS=
call node tools\verify-artifact.mjs "%CORE_SO%" %CORE_ID% >> "%REPORT%" 2>&1
if errorlevel 1 goto :verifyfail
call node tools\verify-artifact.mjs "%CORE_SO%" %CORE_ID%
echo   RECORD THE size AND sha256 OF BOTH ARTIFACTS. Every verification after
echo   this one runs with REQUIRE_CONTENT_ADDRESS=1 and those two numbers as
echo   arguments - that is what makes a later build reproducible rather than
echo   merely well-formed.

echo [6/7] Running the exact-SBF matrix against the built artifacts ...
set RCX_TIMEPIN_V2_SO=%TIMEPIN_SO%
set RATCHET_CORE_G2_SO=%CORE_SO%
cd onchain\rcx-timepin-v2\svm-tests
echo ==== timepin svm-tests ====>> "..\..\..\%REPORT%"
call cargo test --locked -- --nocapture >> "..\..\..\%REPORT%" 2>&1
if errorlevel 1 goto :testfail
cd ..\..\..
cd onchain\ratchet-core-g2\svm-tests
echo ==== core g2 svm-tests ====>> "..\..\..\%REPORT%"
call cargo test --locked -- --nocapture >> "..\..\..\%REPORT%" 2>&1
if errorlevel 1 goto :testfail
cd ..\..\..

echo [7/7] Running the JS release gate ...
call npm test >> "%REPORT%" 2>&1
if errorlevel 1 goto :testfail

echo.
echo  ============================================================
echo  GATE 1 PASSED. Both artifacts built at SBPF v3, both verified,
echo  vectors re-pinned and self-checked, exact-SBF matrix green.
echo.
echo  Paste the two lines above that start with "size" and "sha256"
echo  into the room. NOTHING WAS DEPLOYED - deploy needs a separate,
echo  explicit decision.
echo  ============================================================
goto :end

:norule
echo.
echo  ============================================================
echo  REFUSING TO BUILD - the MIN-CAPTURE rule has not landed.
echo.
echo  lifecycle.rs does not mention PublishBeforeTarget, so it is
echo  still the strict bracket that measured 0 of 25 against the
echo  real sponsored cadence. Building now means building again
echo  after the rule, and re-pinning the vectors and the ELF hashes
echo  a second time.
echo.
echo  See docs\MIN_CAPTURE_SPEC.md. Nothing was built.
echo  ============================================================
goto :end

:nocargo
echo  PROBLEM: cargo not found. This build is Windows-native only.
goto :end
:nosbf
echo  PROBLEM: cargo-build-sbf not found. Install the Solana platform tools.
goto :end
:nonode
echo  PROBLEM: node not found.
goto :end

:buildfail
cd /d "%~dp0"
echo.
echo  BUILD FAILED - read %REPORT%, the compiler said why.
goto :end

:verifyfail
cd /d "%~dp0"
echo.
echo  ============================================================
echo  ARTIFACT VERIFICATION FAILED - the built .so does not match
echo  the identity or the expected SBPF version. Do NOT re-pin, do
echo  NOT deploy, and do not "fix" it by changing the expected id.
echo  Read %REPORT%.
echo  ============================================================
goto :end

:repinfail
cd /d "%~dp0"
echo.
echo  ============================================================
echo  VECTOR RE-PIN FAILED. The tool is fail-closed on purpose: it
echo  refuses to pair new-id PDAs with an old-id artifact. Read
echo  %REPORT% before doing anything else.
echo  ============================================================
goto :end

:testfail
cd /d "%~dp0"
echo.
echo  ============================================================
echo  TESTS FAILED after a successful build. The artifacts exist but
echo  Gate 1 is NOT passed. Read %REPORT% and post the failure in
echo  the room - do not deploy and do not re-run until it is green.
echo  ============================================================

:end
echo.
echo  (window stays open - close it yourself when done)
