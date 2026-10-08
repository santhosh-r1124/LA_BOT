@echo off
title LA_BOT
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0infrastructure\local\start-la-bot.ps1"
echo.
pause
