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
echo   STOCK CADENCE - the measurement the stocks decision needs
echo ============================================================
echo.
echo   Stocks are already reachable with no API key: the tokenized
echo   xStocks are filed under Crypto, and Pyth sponsors those with
echo   permanent push accounts the frozen program can already read.
echo   That part is settled and measured.
echo.
echo   What is NOT settled is how often those feeds publish. Measured
echo   once on 2 September, for 13 minutes, they wrote every 870
echo   seconds - against a seal bound that stops at 60. On that number
echo   about 7 stock seals in 100 would land, and the feature does not
echo   work. But 13 minutes is not a measurement, it is a glimpse.
echo.
echo   This watches them properly. It reads only: no key, no signer,
echo   no transaction, nothing on chain changes. The report is
echo   rewritten after every poll, so closing the window early still
echo   leaves you what it had.
echo.
where node >/dev/null 2>nul
if errorlevel 1 goto :nonode
if not exist "tools\stock_cadence.mjs" goto :notool
echo   A private RPC is worth it here: 8 hours of 20-second polling
echo   will get throttled on the public endpoint, and throttling looks
echo   exactly like a slow publisher. Paste a full https:// URL, or
echo   leave it blank to use the public one anyway.
echo.
set "RX_RPC="
set /p RX_RPC=RPC URL (blank = public): 
echo.
set "RX_MIN=480"
set /p RX_MIN=How many minutes to watch [480]: 
echo.
echo   Measuring for %RX_MIN% minutes. Leave this window open.
echo.
rem The URL is QUOTED on purpose. A Helius URL contains "/?api-key="
rem and cmd reads that leading "/?" as the help switch for CALL, so an
rem unquoted one prints CALLs manual instead of running anything.
node "tools\stock_cadence.mjs" "%RX_RPC%" --minutes %RX_MIN%
set "RX_RPC="
if errorlevel 1 goto :failed
echo.
echo ============================================================
echo   DONE. The report is stock_cadence_report.txt in this folder.
echo.
echo   Read the CONTROL line first. If SOL did not tick, the RPC was
echo   serving stale data and every stock row is meaningless - re-run
echo   with a different RPC rather than believing it.
echo.
echo   Send me that file and I will tell you what it permits.
echo ============================================================
goto :end
:failed
echo.
echo   It stopped early and the reason is above. Whatever it had
echo   measured is still in stock_cadence_report.txt.
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
