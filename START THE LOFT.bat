@echo off
setlocal EnableDelayedExpansion
title The Loft
cd /d "%~dp0"
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
