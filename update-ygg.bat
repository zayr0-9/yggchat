@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM --- Self-detach so script survives if caller (bash/tool host) dies ---
if /I not "%~1"=="__run" (
    start "" /min "%ComSpec%" /c call "%~f0" __run
    exit /b 0
)

set "LOG=D:\yggchat\update-ygg.log"
echo.>>"%LOG%"
echo [%date% %time%] Starting update script >>"%LOG%"

set "APP_EXE=yggdrasil.exe"
set "CLIENT_DIR=D:\yggchat\ygg-chat\client\ygg-chat-r"
set "RELEASE_DIR=%CLIENT_DIR%\release"

REM --- Build latest Windows installer first ---
set "BUILD_LOG=%TEMP%\ygg-build-%RANDOM%%RANDOM%.log"
echo [%date% %time%] Running npm run build:win in %CLIENT_DIR% ... >>"%LOG%"
pushd "%CLIENT_DIR%" >>"%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Cannot access %CLIENT_DIR% >>"%LOG%"
    >&2 echo ERROR: Cannot access %CLIENT_DIR%
    exit /b 1
)

call npm run build:win > "%BUILD_LOG%" 2>&1
set "BUILD_EXIT=%ERRORLEVEL%"
popd

if not "%BUILD_EXIT%"=="0" (
    set "EXACT_ERROR="
    for /f "usebackq delims=" %%L in (`findstr /i /c:"npm ERR!" "%BUILD_LOG%"`) do set "EXACT_ERROR=%%L"
    if not defined EXACT_ERROR set "EXACT_ERROR=build:win failed with exit code %BUILD_EXIT%"

    echo [%date% %time%] ERROR: !EXACT_ERROR! >>"%LOG%"
    echo [%date% %time%] --- build:win output (failure) --- >>"%LOG%"
    type "%BUILD_LOG%" >>"%LOG%"
    echo [%date% %time%] --- end build output --- >>"%LOG%"

    >&2 echo ERROR: !EXACT_ERROR!
    >&2 type "%BUILD_LOG%"

    echo [%date% %time%] Killing %APP_EXE% due to failed build... >>"%LOG%"
    taskkill /IM "%APP_EXE%" /F /T >>"%LOG%" 2>&1

    del /q "%BUILD_LOG%" >nul 2>&1
    exit /b %BUILD_EXIT%
)

del /q "%BUILD_LOG%" >nul 2>&1

REM --- Kill running app instance(s) ---
echo [%date% %time%] Killing %APP_EXE%... >>"%LOG%"
taskkill /IM "%APP_EXE%" /F /T >>"%LOG%" 2>&1

REM Give Windows a moment to release file locks
timeout /t 2 /nobreak >nul

REM --- Find latest installer EXE in release folder ---
set "LATEST_EXE="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%RELEASE_DIR%\Yggdrasil-*.exe" 2^>nul') do (
    set "LATEST_EXE=%RELEASE_DIR%\%%F"
    goto :found_installer
)

:found_installer
if not defined LATEST_EXE (
    echo [%date% %time%] ERROR: No installer EXE found in %RELEASE_DIR% >>"%LOG%"
    exit /b 1
)

echo [%date% %time%] Latest installer: !LATEST_EXE! >>"%LOG%"

REM --- Launch installer detached so update continues independently ---
start "" "!LATEST_EXE!"
echo [%date% %time%] Installer launched. >>"%LOG%"

endlocal
exit /b 0
