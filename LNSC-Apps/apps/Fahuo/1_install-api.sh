#!/usr/bin/env bash
# =============================================================================
# LNSC 发货全链系统 - API 服务一键部署（SQLite + Python3 标准库，零依赖）
# 用法：scp 到服务器后  sudo bash 1_install-api.sh   （可重复执行）
# =============================================================================
set -e

APP_DIR="/var/www/lnsc-apps/apps/fahuo"   # 平台应用目录（按实际上传位置调整）
PORT=8091
BACKUP_DIR="$APP_DIR/backup"

echo "==> [1/4] 检查 python3"
if ! command -v python3 >/dev/null; then
  apt-get update && apt-get install -y python3
fi
python3 --version

echo "==> [2/4] 注册 systemd 服务 fahuo-api"
cat > /etc/systemd/system/fahuo-api.service <<EOF
[Unit]
Description=LNSC Fahuo API (SQLite)
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/python3 $APP_DIR/server.py
Environment=PORT=$PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now fahuo-api
systemctl --no-pager --full status fahuo-api | head -5 || true

echo "==> [3/4] 注册每日备份 cron（SQLite 在线备份到 $BACKUP_DIR）"
mkdir -p "$BACKUP_DIR"
cat > /etc/cron.d/fahuo-backup <<EOF
# 每天 23:55 备份发货数据库（保留 30 天）
55 23 * * * root sqlite3 $APP_DIR/fahuo.db ".backup '$BACKUP_DIR/fahuo-\$(date +\%Y\%m\%d).db'" && find $BACKUP_DIR -name 'fahuo-*.db' -mtime +30 -delete
EOF

echo "==> [4/4] 验证"
sleep 1
curl -s "http://127.0.0.1:$PORT/api/stats" && echo

cat <<'TIP'

✅ 部署完成！

前端无需任何修改即可工作（script.js 自动探测 API）：
  1. 若平台 nginx 已配置 /fahuo/api/ 反代 → 走同源相对路径
  2. 否则前端自动直连 http://<服务器IP>:8091/api（本服务已开 CORS）

可选（更规范）：在平台 nginx 配置中加一行反代后走同源：
  location /fahuo/api/ { proxy_pass http://127.0.0.1:8091; }

防火墙：若启用 ufw，需放行 8091： sudo ufw allow 8091/tcp
数据库文件：$APP_DIR/fahuo.db （备份 = 复制该文件）
TIP
