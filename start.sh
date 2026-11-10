#!/bin/sh
# The Loft for Mac / Linux: sets up the optional voice once, then starts the server.
cd "$(dirname "$0")"
PY=python3; command -v $PY >/dev/null 2>&1 || PY=python
if [ ! -f .venv/.ready ]; then
  echo "Setting up the voice, one time only..."
  [ -x .venv/bin/python ] || $PY -m venv .venv
  .venv/bin/python -m pip install -q -r requirements.txt && echo ok > .venv/.ready || echo "Voice setup failed: the Loft runs without it."
fi
[ -x .venv/bin/python ] && exec .venv/bin/python server.py
exec $PY server.py
