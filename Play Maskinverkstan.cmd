@echo off
setlocal
title Maskinverkstan
set "GAME=%~dp0dist\Maskinverkstan.exe"
if not exist "%GAME%" goto missing
for %%F in ("%GAME%") do if %%~zF LSS 1024 goto missing
"%GAME%"
exit /b %errorlevel%

:missing
echo The prebuilt launcher is missing. Run git lfs pull, or see README.md for build instructions.
pause
exit /b 1
