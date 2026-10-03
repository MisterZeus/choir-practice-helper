@echo off
setlocal enabledelayedexpansion

pushd "%~dp0"
if errorlevel 1 exit /b 1

rem Output file name
set "outfile=audio_paths.txt"
rem Capture current directory root for relative path generation
set "root=%CD%"

rem call ConvertToOpusMono.bat and ConvertToAAC.bat
call "%~dp0ConvertToOpusMono.bat"
call "%~dp0ConvertToAAC.bat"

if exist "%outfile%" del "%outfile%"

for /r %%F in (*.opus *.aac) do (
    set "file=%%~fF"
    set "rel=!file:%root%\=!"
    echo !rel!>>"%outfile%"
)

echo Written opus and aac relative paths to %outfile%
popd
endlocal
