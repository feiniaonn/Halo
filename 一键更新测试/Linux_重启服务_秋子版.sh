#!/bin/bash
# Linux 服务重启脚本 (修正版) - Halo Update Server

# 1. 尝试停止旧的 Python 服务
echo "Stopping existing Python Update service..."
pkill -f "python3 -m http.server 1421" || true

# 2. 进入正确目录并启动服务 (后台运行)
echo "Starting Halo Update service on 192.168.1.120:1421..."
cd /opt/halo-update || exit
nohup python3 -m http.server 1421 --bind 0.0.0.0 > update-server.log 2>&1 &

echo "Service started in background. Logs: /opt/halo-update/update-server.log"
