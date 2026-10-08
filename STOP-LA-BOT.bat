@echo off
title LA_BOT
cd /d "%~dp0"
docker compose down
echo.
echo LA_BOT is stopped. Your data is kept for next time.
pause
