@echo off
setlocal enabledelayedexpansion

rem Output file name
set "outfile=audio_paths.txt"
rem Capture current directory root for relative path generation
set "root=%CD%"

if exist "%outfile%" del "%outfile%"

for /r %%F in (*.opus *.aac) do (
    set "file=%%~fF"
    set "rel=!file:%root%\=!"
    echo !rel!>>"%outfile%"
)

echo Written opus and aac relative paths to %outfile%
endlocal
