#!/usr/bin/env bash
# =============================================================================
# LNSC 发货全链系统 - API 服务一键部署（SQLite + Python3 标准库，零依赖）
# 用法：scp 到服务器后  sudo bash 1_install-api.sh   （可重复执行）
# =============================================================================
set -e

APP_DIR="/var/www/lnsc-apps/apps/fahuo"   # 平台应用目录（按实际上传位置调整）
PORT=8091
BACKUP_DIR="$APP_DIR/backup"
UPLOAD_DIR="$APP_DIR/Upload"              # 上传文件根目录（按 DN 建子文件夹）
ENV_FILE="$APP_DIR/carriers.env"          # 承运商 API 密钥配置（server.py 经 os.environ 读取）

echo "==> [1/7] 检查 python3"
if ! command -v python3 >/dev/null; then
  apt-get update && apt-get install -y python3
fi
python3 --version

echo "==> [2/7] 准备目录与承运商密钥模板"
mkdir -p "$UPLOAD_DIR"
# 承运商 API 密钥：仅首次生成模板，绝不覆盖已有配置；权限 600 防泄漏
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# ===== 承运商 API 密钥（对接时填入真实值，server.py 经 os.environ 读取）=====
# 顺丰丰桥（ https://open.sf-express.com ）
SF_APP_KEY=
SF_APP_SECRET=
SF_CUST_CODE=           # 月结卡号
# 德邦快递开放平台
DB_APP_KEY=
DB_APP_SECRET=
DB_CUST_CODE=
# 跨越速运开放平台
KY_APP_KEY=
KY_APP_SECRET=
KY_CUST_CODE=
EOF
  chmod 600 "$ENV_FILE"
  echo "    已生成密钥模板 $ENV_FILE（权限 600，请填入真实密钥）"
else
  echo "    密钥文件已存在，跳过（$ENV_FILE）"
fi

echo "==> [3/7] 检查端口 $PORT 可用性"
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$PORT$"; then
  if systemctl is-active --quiet fahuo-api 2>/dev/null; then
    echo "    端口 $PORT 为本服务占用（重复安装，enable --now 将平滑接管）"
  else
    echo "    ❌ 端口 $PORT 被其他进程占用，服务将启动失败："
    ss -ltnp 2>/dev/null | grep ":$PORT" || true
    echo "    请先释放该端口，或修改本脚本 PORT 变量后重试"
    exit 1
  fi
else
  echo "    端口 $PORT 空闲"
fi

echo "==> [4/7] 注册 systemd 服务 fahuo-api"
cat > /etc/systemd/system/fahuo-api.service <<EOF
[Unit]
Description=LNSC Fahuo API (SQLite)
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/python3 $APP_DIR/server.py
Environment=PORT=$PORT
EnvironmentFile=-$ENV_FILE
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now fahuo-api
systemctl --no-pager --full status fahuo-api | head -5 || true

echo "==> [5/7] 注册每日备份 cron（SQLite 在线备份到 $BACKUP_DIR）"
mkdir -p "$BACKUP_DIR"
cat > /etc/cron.d/fahuo-backup <<EOF
# 每天 23:55 备份发货数据库（保留 30 天）
55 23 * * * root sqlite3 $APP_DIR/fahuo.db ".backup '$BACKUP_DIR/fahuo-\$(date +\%Y\%m\%d).db'" && find $BACKUP_DIR -name 'fahuo-*.db' -mtime +30 -delete
EOF

echo "==> [6/7] 外网连通性预检（承运商开放平台，仅告警不中断）"
for url in "https://open.sf-express.com" "https://open.deppon.com" "https://open.ky-express.com"; do
  if curl -s -o /dev/null --connect-timeout 3 "$url"; then
    echo "    可达: $url"
  else
    echo "    ⚠️ 不可达: $url （对接该承运商前需开通服务器出网 443）"
  fi
done

echo "==> [7/7] 验证（端口监听 + 接口应答）"
sleep 1
ss -ltn 2>/dev/null | grep ":$PORT" || { echo "❌ 服务未监听 $PORT，请查看 journalctl -u fahuo-api"; exit 1; }
curl -s "http://127.0.0.1:$PORT/api/stats" && echo

cat <<'TIP'

✅ 部署完成！

前端无需任何修改即可工作（script.js 自动探测 API）：
  1. 若平台 nginx 已配置 /fahuo/api/ 反代 → 走同源相对路径
  2. 否则前端自动直连 http://<服务器IP>:8091/api（本服务已开 CORS）

可选（更规范，推荐）：nginx 统一入口反代走同源（与 CTMS 同约定，前缀剥离）：
  sudo bash PO-Closing/install/bach_POClosing_proxy   # 幂等补丁，含 /apps/fahuo/api/ → 127.0.0.1:8091/api/
  验证: curl http://127.0.0.1/apps/fahuo/api/stats   # 应返回 JSON

防火墙：若启用 ufw，需放行 8091： sudo ufw allow 8091/tcp
数据库文件：$APP_DIR/fahuo.db （备份 = 复制该文件）

承运商 API 对接（未来）：
  1. 密钥填入 $APP_DIR/carriers.env 后  sudo systemctl restart fahuo-api  生效
  2. server.py 新增 /api/carrier/* 端点（下单/轨迹），复用本服务与端口，无需改部署
  3. 外部轨迹推送（顺丰等 callback）需平台 nginx 增加反代路径并保证承运商可访问
TIP
