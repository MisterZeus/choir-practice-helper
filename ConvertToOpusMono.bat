@echo off

setlocal enabledelayedexpansion

rem Install ffmpeg if you do not have it!
rem winget install ffmpeg

for /r %%F in (*.mp3 *.wav *.flac *.m4a *.aac *.ogg *.wma *.aiff *.alac) do (
    set "input=%%~fF"
    set "output=%%~dpnF.opus"

    if /I "%%~xF"==".opus" (
        echo Skipping already-encoded Opus file: "%%~fF"
    ) else (
        echo Converting "!input!" to "!output!"
        ffmpeg -i "!input!" -c:a libopus -b:a 32k -vbr on -ac 1 -map_metadata 0 -y "!output!"
    )
)

endlocal
