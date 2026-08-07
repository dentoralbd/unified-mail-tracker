@echo off
title Unified Mail Tracker (AliExpress + BD Post IPS)
cd /d "%~dp0"
echo ========================================================
echo   Unified Mail Tracker System starting...
echo ========================================================
echo.
echo Installing/verifying dependencies...
call npm install
echo.
echo Starting Web Dashboard & Server on http://localhost:3000...
node server.js
pause
