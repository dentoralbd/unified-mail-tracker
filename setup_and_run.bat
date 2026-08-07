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
echo Launching Cloudflare Tunnel for Live Public HTTPS Access...
start "Cloudflare Live HTTPS Tunnel" cloudflared.exe tunnel --url http://localhost:3000
echo.
echo Starting Web Dashboard & Telegram Bot on http://localhost:3000...
node server.js
pause
