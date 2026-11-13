@echo off
setlocal EnableDelayedExpansion
title The Visualizer
cd /d "%~dp0"
rem Get the latest version of the loft from GitHub before starting. Your songs
rem are never touched. No internet or no git: it just starts the version you
rem already have. After an update it restarts itself (from inside this block,
rem which Windows has already read whole), so the newest copy of this file runs.
if not "%~1"=="--updated" (
  where git >nul 2>nul && if exist ".git" (
    echo Checking for updates...
    set "GIT_TERMINAL_PROMPT=0"
    for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "LOFT_BEFORE=%%h"
    git pull --ff-only -q origin main 2>nul
    if errorlevel 1 (
      rem The lyrics cache is rewritten as the loft runs, and those local copies can
      rem block an update. They're rebuilt from what was heard at startup, so take
      rem GitHub's copies and try once more.
      git checkout -q -- cache/lyrics 2>nul
      git pull --ff-only -q origin main 2>nul
    )
    if errorlevel 1 (
      echo Could not update right now. Starting the version you have.
    ) else (
      for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "LOFT_AFTER=%%h"
      if not "!LOFT_BEFORE!"=="!LOFT_AFTER!" (
        echo Updated to the latest version.
        "%~f0" --updated
      )
      echo The loft is up to date.
    )
  )
)
rem Find a real Python: the py launcher first, then python, skipping the fake
rem "python" Windows ships that only opens the Microsoft Store.
set "PY="
where py >nul 2>nul && py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && python -c "import sys" >nul 2>nul && set "PY=python"
)
rem The voice's private Python (needs internet once). The marker file is only
rem written when setup finishes, so a setup that failed is tried again next time.
if not exist ".venv\.ready" if defined PY (
  echo Setting up the loft's voice, one time only...
  if not exist ".venv\Scripts\python.exe" !PY! -m venv .venv
  if exist ".venv\Scripts\python.exe" ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt && echo ok> ".venv\.ready"
  if not exist ".venv\.ready" echo Voice setup failed. The loft will use the browser voice for now, and try again next time.
)
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" server.py
  goto :done
)
if defined PY (
  !PY! server.py
  goto :done
)
echo Python was not found. Install Python 3 from python.org and try again.
:done
pause
