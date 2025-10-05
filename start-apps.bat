@echo off
title Camper Registration System Launcher
color 0A

echo 🚀 Camper Registration System Launcher
echo.

REM Get the directory where this batch file is located
set "APP_DIR=%~dp0"

REM Define path to PowerShell script
set "PS_SCRIPT=%APP_DIR%autorun\start-simple.ps1"

REM Check if PowerShell script exists
if not exist "%PS_SCRIPT%" (
    echo ERROR: PowerShell script not found: %PS_SCRIPT%
    echo.
    echo Please make sure start-simple.ps1 exists in the autorun folder.
    pause
    exit /b 1
)

echo Found PowerShell script: %PS_SCRIPT%
echo.
echo Launching applications via PowerShell script...
echo.

REM Execute the PowerShell script
powershell -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

echo.
echo Script execution completed.
pause