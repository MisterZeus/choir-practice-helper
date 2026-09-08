@echo off

rem Install ffmpeg if you do not have it!
rem winget install ffmpeg


for /r %%F in (*.mp3 *.wav *.flac *.m4a *.ogg *.wma *.aiff *.alac) do (
    set "input=%%~fF"
    set "output=%%~dpnF.aac"

    if /I "%%~xF"==".aac" (
        echo Skipping already-encoded AAC file: "%%~fF"
    ) else (
        echo Converting "%%F" to "%%~dpnF.aac"
        ffmpeg -i "%%F" -c:a aac -q:a 0.5 -map_metadata 0 -ac 1 "%%~dpnF.aac" -y
    )
)
