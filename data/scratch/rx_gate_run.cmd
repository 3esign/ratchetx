@echo off
rem full release gate, clean run: no stale servers, log to laptop Svemir data/tmp
cd /d D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean
if not exist C:\Svemir\data\tmp mkdir C:\Svemir\data\tmp
set RATCHET_LAYOUT_SERVER=
call npm run test:release > C:\Svemir\data\tmp\rx_gate2.log 2>&1
echo GATE-EXIT=%ERRORLEVEL% >> C:\Svemir\data\tmp\rx_gate2.log
echo GATE-DONE >> C:\Svemir\data\tmp\rx_gate2.log