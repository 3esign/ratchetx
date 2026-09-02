@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
set REPORT=equity_gate_check.txt
echo RatchetX equity feed gate check > "%REPORT%"
echo RPC: %1 >> "%REPORT%"
echo. >> "%REPORT%"
echo Running the mainnet gate on TSLA NVDA PLTR COIN HOOD ...
echo (a feed only enters the frozen table if its push account exists and is receiver-owned)
echo.
call node scripts\check-equity-feeds.mjs %1 >> "%REPORT%" 2>&1
type "%REPORT%"
echo.
echo ---------------------------------------------
echo Saved to %REPORT% . Send me that file (or paste it) and I take it from there.
echo ---------------------------------------------
