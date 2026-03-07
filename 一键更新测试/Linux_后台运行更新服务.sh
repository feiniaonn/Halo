#!/usr/bin/env sh
set -e

PORT="${1:-1421}"
DIR="${2:-/opt/halo-update}"

nohup sh "$(dirname "$0")/Linux_启动更新服务.sh" "$PORT" "$DIR" >/var/log/halo-update.log 2>&1 &
echo $! > /var/run/halo-update.pid
echo "Started. pid=$(cat /var/run/halo-update.pid) log=/var/log/halo-update.log"

