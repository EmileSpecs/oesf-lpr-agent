@echo off
setlocal
cd /d "e:\Specs\Development\OESF\oesf-lpr-agent"
set "GIT=C:\Program Files\Git\mingw64\bin\git.exe"
"%GIT%" add -A
"%GIT%" write-tree > .git\TREE_HASH.txt
set /p TREE=<.git\TREE_HASH.txt
"%GIT%" rev-parse HEAD > .git\PARENT_HASH.txt
set /p PARENT=<.git\PARENT_HASH.txt
echo Release 0.4.1: fix packaged crash from createRequire/import.meta.> .git\COMMIT_MSG.txt
echo.>> .git\COMMIT_MSG.txt
echo Packaged CJS builds crashed on startup; tray no longer uses import.meta/createRequire.>> .git\COMMIT_MSG.txt
type .git\COMMIT_MSG.txt | "%GIT%" commit-tree %TREE% -p %PARENT% > .git\NEW_COMMIT.txt
set /p COMMIT=<.git\NEW_COMMIT.txt
echo COMMIT=%COMMIT%
"%GIT%" update-ref HEAD %COMMIT%
"%GIT%" log -1 --oneline
