@echo off
setlocal
if "%RX_RELAUNCHED%"=="1" goto :run
set RX_RELAUNCHED=1
cmd /k "%~f0" %*
exit /b
:run
cd /d "%~dp0"
set REPORT=push_report.txt
echo RatchetX push - %date% %time% > "%REPORT%"

echo ============================================================
echo   PUSH TO GITHUB main
echo ============================================================
echo.
echo   This sends your commits to github.com/3esign/ratchetx on the
echo   main branch. That is where Bankr installs the skill from, so
echo   this is the step that makes a new skill version reachable.
echo.
echo   It is NOT what deploys the site. DEPLOY.cmd does that, and
echo   the two are independent - you can push without deploying and
echo   deploy without pushing.
echo.
echo   Nothing is sent until you type PUSH at the end.
echo.

where git >nul 2>&1
if errorlevel 1 goto :nogit
if not exist ".git" goto :norepo

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo   You are on branch: %BRANCH%
echo   You are on branch: %BRANCH% >> "%REPORT%"
echo.

echo   Checking uncommitted changes ...
git diff --quiet
if errorlevel 1 goto :dirty
git diff --cached --quiet
if errorlevel 1 goto :dirty
echo   Working tree is clean - nothing half-finished will go along.
echo.

echo   Asking GitHub where main is ...
for /f "tokens=1" %%r in ('git ls-remote origin refs/heads/main 2^>nul') do set REMOTE=%%r
if "%REMOTE%"=="" goto :noremote
echo   GitHub main is at %REMOTE:~0,7%
echo   GitHub main is at %REMOTE% >> "%REPORT%"

git merge-base --is-ancestor %REMOTE% HEAD
if errorlevel 1 goto :diverged

for /f %%n in ('git rev-list --count %REMOTE%..HEAD') do set AHEAD=%%n
if "%AHEAD%"=="0" goto :uptodate
echo.
echo   %AHEAD% commit^(s^) will be added to main. This is a fast-forward -
echo   nothing on GitHub is rewritten or lost.
echo.
echo   ---------------- what will be pushed ----------------
git log --oneline --no-decorate %REMOTE%..HEAD
git log --oneline --no-decorate %REMOTE%..HEAD >> "%REPORT%"
echo   ----------------------------------------------------
echo.

echo   Running the fast release checks first. main is what Bankr
echo   installs from, so a stale skill digest must not go up.
echo.
call node scripts\check-release-safety.mjs >> "%REPORT%" 2>&1
if errorlevel 1 goto :gatefail
call node scripts\check-versions.mjs >> "%REPORT%" 2>&1
if errorlevel 1 goto :gatefail
echo   Release safety and version/digest checks passed.
echo.

echo   If this is the first push from this machine, Windows will open
echo   a GitHub sign-in window. That is normal. It remembers you after.
echo.
set "GO="
set /p GO=Type PUSH to send, anything else to stop: 
if /i not "%GO%"=="PUSH" goto :stopped

echo.
echo   Pushing ...
call git push origin HEAD:main >> "%REPORT%" 2>&1
if errorlevel 1 goto :pushfail

echo.
echo ============================================================
echo   PUSHED. GitHub main now has your work.
echo.
echo   To hand the new skill to Bankr, send this in Bankr chat:
echo.
echo   Install the ratchetx skill from
echo   https://github.com/3esign/ratchetx/tree/main/skills/ratchetx
echo ============================================================
goto :end

:dirty
echo.
echo ============================================================
echo   STOPPED - there are uncommitted changes.
echo.
echo   Pushing now would send some of your work and not the rest.
echo   The files in question:
echo ============================================================
git status --short
git status --short >> "%REPORT%"
echo.
echo   Commit them first, or ask Claude to, then run this again.
goto :end

:diverged
echo.
echo ============================================================
echo   STOPPED - GitHub main has commits you do not have.
echo.
echo   Somebody or something pushed since you last pulled. Pushing
echo   now would either be refused or would need a merge, and this
echo   script will not guess which you want.
echo.
echo   Run:  git pull --rebase origin main
echo   then run this again. Or ask Claude to look at it.
echo ============================================================
goto :end

:uptodate
echo.
echo   GitHub main already has everything on this branch.
echo   Nothing to push.
goto :end

:gatefail
echo.
echo ============================================================
echo   STOPPED - the release checks failed. Nothing was pushed.
echo.
echo   The detail is at the end of %REPORT%. The usual cause is a
echo   skill file edited without its sha256 in SKILL.md being
echo   updated - which is exactly what these checks are for.
echo ============================================================
goto :end

:pushfail
echo.
echo ============================================================
echo   THE PUSH FAILED. Nothing on GitHub changed.
echo.
echo   The reason is at the end of %REPORT%. The two common ones:
echo     - sign-in was cancelled or the account has no write access
echo     - GitHub main moved while you were reading this screen
echo ============================================================
goto :end

:noremote
echo.
echo   Could not reach GitHub to ask where main is. Check the
echo   connection and run this again. Nothing was pushed.
goto :end

:nogit
echo.
echo   git is not on PATH. Install Git for Windows from git-scm.com,
echo   open a new window so PATH refreshes, then run this again.
goto :end

:norepo
echo.
echo   This folder is not a git repository. Run this from inside
echo   ratchet_phase_a_clean.
goto :end

:stopped
echo.
echo   Stopped. Nothing was pushed.
goto :end

:end
echo.
echo (this window stays open - close it when you are done)
