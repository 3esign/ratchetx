@echo off
setlocal EnableDelayedExpansion
rem move stray mangled filename with apostrophe out of ratchet root using dir /x short names
cd /d D:\Work\Software_Projects\pumpmind\ratchetx\ratchet_phase_a_clean
if not exist C:\Svemir\data\tmp mkdir C:\Svemir\data\tmp
set MOVED=0
for /f "delims=" %%F in ('dir /b /a:-d ^| findstr /c:"includes" /c:"startsWith"') do (
  if exist "%%F" (
    move /y "%%F" "C:\Svemir\data\tmp\rx_mangled_!RANDOM!_%%F" >nul
    set MOVED=1
  )
)
echo MOVED=!MOVED!
echo LEFTOVER:
dir /b | findstr /c:"includes" /c:"startsWith"
echo DONE