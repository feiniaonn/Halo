#!/usr/bin/env sh
set -e

PID_FILE="/var/run/halo-update.pid"
if [ ! -f "$PID_FILE" ]; then
  echo "pid file not found: $PID_FILE"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped pid=$PID"
else
  echo "Process not running: $PID"
fi

rm -f "$PID_FILE"

