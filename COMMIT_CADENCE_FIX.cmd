@echo off
setlocal
set "RXDIR=D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean"
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
echo ============================================================
echo   COMMIT THE STOCK_CADENCE FIX
echo ============================================================
echo.
echo   STOCK_CADENCE.cmd on your disk is already the fixed version -
echo   I wrote it there directly, so it works but has no commit. This
echo   commits that one file. Nothing else is touched.
echo.
echo   Safe to run while the measurement is going: it does not stop
echo   or restart anything, and a running script is read from memory.
echo.
cd /d "%RXDIR%"
if errorlevel 1 goto :nodir
if not exist "PUSH.cmd" goto :nodir
where git >nul 2>nul
if errorlevel 1 goto :nogit
pause
echo.
echo   [1/3] Clearing any stale locks ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$g=Join-Path $env:RXDIR '.git'; $l=Get-ChildItem -LiteralPath $g -Recurse -Force -Filter '*.lock' -ErrorAction SilentlyContinue; if(-not $l){Write-Host '     none'; exit 0}; $bad=0; foreach($f in $l){ try { $f.Attributes='Normal'; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; Write-Host ('     removed ' + $f.Name) } catch { $bad++; Write-Host ('     STUCK   ' + $f.FullName + '  ->  ' + $_.Exception.Message) } }; exit $bad"
if errorlevel 1 goto :lockstuck
echo.
echo   [2/3] What is about to be committed:
call git status --short
echo.
echo   [3/3] Committing ...
call git add STOCK_CADENCE.cmd
call git commit -m "a URL with /? in it is a help switch to cmd, not an argument" -m "STOCK_CADENCE.cmd passed the RPC URL unquoted. A Helius endpoint contains /?api-key=, cmd read the leading /? as CALL help switch, and the script printed CALL manual instead of measuring. Quoted now. It also asks how many minutes rather than expecting a flag - the flag went into the RPC prompt and worked only by accident. A prompt that can be answered wrongly and still appear to work is worse than one that asks out loud." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if errorlevel 1 goto :commitfailed
echo.
echo ============================================================
call git log --oneline -1
echo.
echo   COMMITTED. Run PUSH.cmd when you want it on GitHub.
echo   It is bookkeeping - the script already works either way.
echo ============================================================
goto :end
:commitfailed
echo.
echo   The commit did not go through. Reason is above - send me this.
echo   If it says "nothing to commit", it was already committed and
echo   there is nothing to do.
goto :end
:lockstuck
echo.
echo   STOPPED: a lock would not delete, reason printed next to it.
goto :end
:nodir
echo   STOPPED: could not open %RXDIR% - do not run this as Administrator.
goto :end
:nogit
echo   git was not found on PATH.
goto :end
:end
echo.
echo (this window stays open - close it when you are done)
