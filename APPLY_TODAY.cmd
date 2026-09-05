@echo off
setlocal
set "RXDIR=D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean"
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
echo ============================================================
echo   UNSTICK GIT, THEN APPLY TODAYS WORK
echo ============================================================
echo.
echo   Double-click this. Do NOT run it as Administrator.
echo.
cd /d "%RXDIR%"
if errorlevel 1 goto :nodir
if not exist "PUSH.cmd" goto :nodir
if not exist "ratchetx-stocks-and-freeze.patch" goto :nopatch
where git >nul 2>nul
if errorlevel 1 goto :nogit
echo   Folder: %CD%
echo.
echo   Five stale .lock files in .git are blocking git here, some from
echo   earlier sessions. Last run, cmd DEL refused them with a path
echo   error on paths that exist, so this uses PowerShell instead - it
echo   handles hidden and long paths properly and says what it did.
echo.
echo   Close VS Code / Cursor / GitHub Desktop first, then continue.
echo.
pause
echo.
echo   [1/4] Clearing stale locks ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$g=Join-Path $env:RXDIR '.git'; $l=Get-ChildItem -LiteralPath $g -Recurse -Force -Filter '*.lock' -ErrorAction SilentlyContinue; if(-not $l){Write-Host '     none found'; exit 0}; $bad=0; foreach($f in $l){ try { $f.Attributes='Normal'; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; Write-Host ('     removed ' + $f.Name) } catch { $bad++; Write-Host ('     STUCK   ' + $f.FullName + '  ->  ' + $_.Exception.Message) } }; exit $bad"
if errorlevel 1 goto :lockstuck
echo   done.
echo.
echo   [2/4] Backing out the half-finished apply ...
if not exist "%RXDIR%\.git\rebase-apply" goto :noam
call git am --abort
if errorlevel 1 goto :abortfailed
echo   backed out.
goto :amdone
:noam
echo   nothing half-finished - good.
:amdone
echo.
echo   [3/4] Checking the folder is clean ...
git diff --quiet
if errorlevel 1 goto :dirty
git diff --cached --quiet
if errorlevel 1 goto :dirty
call git log --oneline -1
echo   clean.
echo.
echo   [4/4] Applying ...
call git am --3way "ratchetx-stocks-and-freeze.patch"
if errorlevel 1 goto :amfailed
echo.
echo ============================================================
echo   APPLIED.
echo.
call git log --oneline -1
echo.
if exist "STOCK_CADENCE.cmd" echo   STOCK_CADENCE.cmd is now in this folder.
echo.
echo   Next: PUSH.cmd, then DEPLOY.cmd.
echo ============================================================
goto :end
:amfailed
echo.
echo   git am still could not apply it. Backing out ...
call git am --abort
echo   Send me this whole window.
goto :end
:abortfailed
echo.
echo   STOPPED: could not back out the half-finished apply.
echo   Send me this whole window - do not fix it by hand.
goto :end
:lockstuck
echo.
echo   STOPPED: at least one lock would not delete, and the reason is
echo   printed next to it above. Send me this window.
goto :end
:dirty
echo.
echo   STOPPED: uncommitted changes are here.
echo.
call git status --short
echo.
echo   Send me that list.
goto :end
:nodir
echo.
echo   STOPPED: could not open
echo     %RXDIR%
echo   If you ran this as Administrator, close it and double-click the
echo   file in Explorer instead.
goto :end
:nopatch
echo   STOPPED: ratchetx-stocks-and-freeze.patch is not in that folder.
goto :end
:nogit
echo   git was not found on PATH.
goto :end
:end
echo.
echo (this window stays open - close it when you are done)
