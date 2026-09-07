@echo off
setlocal
set "RXDIR=%~dp0"
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%RXDIR%"
echo ============================================================
echo   STOCK CADENCE
echo ============================================================
echo.
echo   Reads only. No key, no signer, no transaction.
echo.
echo   Answer each question with a PLAIN NUMBER. Do not type a flag
echo   like --every here; the questions below are the flags.
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode
if not exist "tools\stock_cadence.mjs" goto :notool

set "RX_RPC="
set /p RX_RPC=RPC URL (blank = public): 
echo.

:askmin
set "RX_MIN="
set /p "RX_MIN=Minutes to watch [480]: "
if "%RX_MIN%"=="" set "RX_MIN=480"
echo %RX_MIN%| findstr /r "^[1-9][0-9]*$" >nul
if errorlevel 1 (
  echo   "%RX_MIN%" is not a plain number. Just digits, like 480.
  echo.
  goto :askmin
)

:asksec
set "RX_EVERY="
set /p "RX_EVERY=Seconds between polls [20, use 5 to resolve SOL]: "
if "%RX_EVERY%"=="" set "RX_EVERY=20"
echo %RX_EVERY%| findstr /r "^[1-9][0-9]*$" >nul
if errorlevel 1 (
  echo   "%RX_EVERY%" is not a plain number. Just digits, like 5.
  echo.
  goto :asksec
)

:askout
set "RX_OUT=stock_cadence_report.txt"
if exist "%RX_OUT%" (
  echo.
  echo   %RX_OUT% already exists - another run may still be writing it.
  set "RX_OUT=stock_cadence_report_2.txt"
  echo   This run will write %RX_OUT% instead, so nothing is clobbered.
)
echo.
echo   Watching %RX_MIN% minutes, polling every %RX_EVERY%s, into %RX_OUT%.
echo   Leave this window open.
echo.
rem The URL is QUOTED: a Helius URL contains "/?api-key=" and cmd reads the
rem leading "/?" as a help switch.
node "tools\stock_cadence.mjs" "%RX_RPC%" --minutes %RX_MIN% --every %RX_EVERY% --out "%RX_OUT%"
set "RX_RPC="
if errorlevel 1 goto :failed
echo.
echo ============================================================
echo   DONE. The report is %RX_OUT% in this folder.
echo.
echo   Read the CONTROL line first. If SOL did not tick, the RPC was
echo   serving stale data and every stock row is meaningless.
echo ============================================================
goto :end
:failed
echo.
echo   It stopped early and the reason is above.
goto :end
:notool
echo   STOPPED: tools\stock_cadence.mjs is not next to this script.
goto :end
:nonode
echo   Node was not found on PATH.
goto :end
:end
echo.
echo (this window stays open - close it when you are done)
