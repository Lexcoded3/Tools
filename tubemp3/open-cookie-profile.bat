@echo off
REM ============================================================
REM  TUBEMP3 - one-time YouTube cookie setup
REM  Opens Chrome with the tool's private profile so you can log
REM  into YouTube once. From then on TUBEMP3 uses these cookies
REM  automatically to bypass "Sign in to confirm you're not a bot".
REM
REM  Steps:
REM    1. Run this file (double-click).
REM    2. Log into YouTube in the window that opens.
REM    3. Close that window completely.
REM    4. Retry your download in TUBEMP3.
REM ============================================================
setlocal

set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
    echo Chrome was not found. Install Google Chrome first.
    pause
    exit /b 1
)

start "" "%CHROME%" --user-data-dir="%~dp0.ytprofile" https://www.youtube.com

echo.
echo A Chrome window opened with the tool's private profile.
echo  - Log into YouTube in that window (or just let the page load).
echo  - Then CLOSE that window completely.
echo  - Return to TUBEMP3 and retry the download.
echo.
pause
