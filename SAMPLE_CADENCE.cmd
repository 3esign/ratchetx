@echo off
REM ============================================================
REM  SAMPLE THE PYTH CADENCE  -  24 h, one click, window stays open.
REM
REM  Tracker item 2.3. It produces the one number Semir cannot decide
REM  without: max_post_target_lag per feed in the write-once mainnet
REM  manifest. A wrong value there is permanent for that economy.
REM
REM  Why a .cmd and not an agent: every agent on the cloud bridge has
REM  NO network (the device VM has no egress; the container proxy
REM  rejects the RPCs). This machine has network. The job also has to
REM  run for 24 hours, which no agent turn survives.
REM
REM  Read-only. No key. No transaction. Nothing is deployed. Close the
REM  window to stop early - the NDJSON written so far stays valid and
REM  summarize works on a partial file.
REM ============================================================
if defined RX_CADENCE_KEEPOPEN goto :run
set RX_CADENCE_KEEPOPEN=1
cmd /k "%~f0"
exit /b

:run
cd /d "%~dp0"
echo ============================================================
echo  PYTH CADENCE SAMPLER  -  24 h, read-only, no key
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 goto :nonode

REM  api.mainnet-beta.solana.com rate-limits this pattern and answers
REM  403 to some clients. publicnode answered 100%% of paced polls in
REM  the pilot (0 errors, 1 poll / 1.5 s, 7 feeds, 217 s). It DOES
REM  rate-limit above roughly 1 poll/s - do not lower --interval-ms
REM  below 1000 to "get more data", you will get less.
if not defined RATCHET_RPC_URL set "RATCHET_RPC_URL=https://solana-rpc.publicnode.com"
echo  RPC: %RATCHET_RPC_URL%
echo  Writing NDJSON under docs\reviews\cadence\ - one line per price change.
echo  This runs for 24 hours. You can leave it and come back.
echo.
node onchain\rcx-timepin-v2\scripts\cadence-sampler.mjs sample --hours 24 --interval-ms 1000
if errorlevel 1 goto :samplefail
echo.
echo  Sampling finished. Building the hit-rate table...
set "RX_LAST="
for /f "delims=" %%F in ('dir /b /o-d docs\reviews\cadence\*.ndjson') do if not defined RX_LAST set "RX_LAST=%%F"
if not defined RX_LAST goto :nofile
node onchain\rcx-timepin-v2\scripts\cadence-sampler.mjs summarize --in "docs\reviews\cadence\%RX_LAST%"
if errorlevel 1 goto :sumfail
echo.
echo  ============================================================
echo  DONE. Commit docs\reviews\cadence\ and tell the room.
echo  ============================================================
goto :end

:nonode
echo  PROBLEM: Node.js was not found. Install the LTS from nodejs.org.
goto :end

:nofile
echo  No NDJSON was produced. Nothing to summarize.
goto :end

:samplefail
echo  Sampling stopped with an error. Any NDJSON already written is
echo  still valid - run summarize on it by hand if you want a table.
goto :end

:sumfail
echo  The samples are fine but summarize failed. The NDJSON is the
echo  evidence; the table can be rebuilt any time, offline.

:end
echo.
echo  (window stays open - close it yourself when done)
