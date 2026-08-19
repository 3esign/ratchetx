@echo off
REM RATCHET diagnostic - runs nothing interactive, just writes facts
REM to deploy_check.txt for Claude to read. Takes ~30 seconds.
REM FIX 2026-08-19: "call npm" - without CALL, npm.cmd silently
REM kills this script before the vercel checks ever run.
if defined RATCHET_KEEPOPEN goto :run
set RATCHET_KEEPOPEN=1
cmd /k "%~f0"
exit /b
:run
cd /d "%~dp0"
echo Writing diagnostics to deploy_check.txt ... please wait ~30s
echo RATCHET diag %date% %time%> deploy_check.txt
node -v >> deploy_check.txt 2>&1
call npm -v >> deploy_check.txt 2>&1
where npx >> deploy_check.txt 2>&1
call npx --yes vercel --version >> deploy_check.txt 2>&1
echo exitcode %errorlevel% >> deploy_check.txt
call npx --yes vercel whoami >> deploy_check.txt 2>&1
echo exitcode %errorlevel% >> deploy_check.txt
echo DONE. Now tell Claude: read deploy_check.txt
