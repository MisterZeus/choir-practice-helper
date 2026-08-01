@echo off

rem Install ffmpeg if you do not have it!
rem winget install ffmpeg

for /f "tokens=*" %%a in ('dir /b /s *.opus') do (
    echo Converting "%%a" to "%%~dpna.aac"
    ffmpeg -i "%%a" -c:a aac -q:a 2 "%%~dpna.aac"
)

pause
