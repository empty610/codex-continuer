@echo off
cd /d "%~dp0"
node plugin/open.js
if errorlevel 1 pause
