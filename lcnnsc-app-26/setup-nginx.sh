#!/usr/bin/env bash
# =============================================================
# lcnnsc-app-26 Nginx 安装部署脚本（纯 HTTP，内网使用）
# 域名: lac.lechler.com.cn | IP: 10.86.180.76
# 项目路径: /var/www/lnsc-apps
# 前置: hardening.sh 已执行并重启
# 用法: sudo bash setup-nginx.sh
# =============================================================

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}[OK]   $*${RESET}"; }
warn() { echo -e "${YELLOW}[WARN] $*${RESET}"; }
info() { echo -e "${CYAN}[INFO] $*${RESET}"; }
fail() { echo -e "${RED}[FAIL] $*${RESET}"; exit 1; }
step() { echo -e "\n${CYAN}══════════════════════════════════════${RESET}"; \
         echo -e "${CYAN}  $*${RESET}"; \
         echo -e "${CYAN}══════════════════════════════════════${RESET}"; }

# ── 配置区 ────────────────────────────────────────────────────
DOMAIN="lac.lechler.com.cn"
WEB_ROOT="/var/www/lnsc-apps"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"

# ── 检查 root 权限 ─────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "请以 root 用户运行: sudo bash $0"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  lcnnsc-app-26 Nginx 部署（内网 HTTP）         ║"
echo "║  域名: lac.lechler.com.cn                         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 1: 确认 Nginx 已安装 ─────────────────────────────────
step "1: 确认 Nginx"

if ! command -v nginx &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq nginx
fi
ok "Nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"

# ── Step 2: 安装 Node.js ──────────────────────────────────────
step "2: 安装 Node.js"

if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi
ok "Node.js $(node -v)"

# ── Step 3: 创建项目目录 ──────────────────────────────────────
step "3: 创建项目目录"

mkdir -p "$WEB_ROOT"
chown -R sysadmin:www-data "$WEB_ROOT"
chmod -R 775 "$WEB_ROOT"
ok "Web 根目录: $WEB_ROOT (owner: sysadmin, group: www-data)"

# ── Step 4: 配置 Nginx ────────────────────────────────────────
step "4: 配置 Nginx"

cat > "$NGINX_CONF" <<'NGINX'
server {
    listen 80;
    server_name lac.lechler.com.cn;

    root /var/www/lnsc-apps;
    index index.html;
    client_max_body_size 5g;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; media-src 'self' blob: data:;" always;

    # API 代理到 Node.js 后端
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 5g;
    }

    # 根目录 JS/CSS 不缓存（便于更新）
    location ~* ^/[^/]+\.(css|js)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # 子应用：直接返回文件，不走 SPA 回退
    location /apps/ {
        try_files $uri $uri/ =404;
    }

    # 子应用和图片长缓存
    location ~* ^/(apps|images)/.*\.(css|js|ico|png|jpg|jpeg|gif|svg|woff2?|ttf)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # apps.json 不缓存
    location = /apps.json {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # SPA 回退（仅主站页面）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript text/xml image/svg+xml;
    gzip_min_length 256;

    # 访问日志
    access_log /var/log/nginx/lac.lechler.com.cn.access.log;
    error_log  /var/log/nginx/lac.lechler.com.cn.error.log warn;

}
NGINX

ok "Nginx 站点配置已写入"

# ── Step 5: 启用站点并重载 ────────────────────────────────────
step "5: 启用 Nginx 站点"

rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/

if nginx -t 2>/dev/null; then
    ok "Nginx 配置验证通过"
    systemctl enable nginx
    systemctl restart nginx
    ok "Nginx 已启动"
else
    fail "Nginx 配置验证失败！请检查: nginx -t"
fi

# ── Step 6: 配置 Node.js 后端服务 ─────────────────────────────
step "6: 配置 Node.js 后端服务"

# 安装依赖
cd "$WEB_ROOT"
if [[ -f "package.json" ]]; then
    npm install --production
    ok "Node.js 依赖安装完成"
else
    warn "package.json 未找到，请先上传项目文件后执行: cd $WEB_ROOT && npm install"
fi

# 创建 systemd 服务
cat > /etc/systemd/system/lnsc-apps.service <<EOF
[Unit]
Description=LNSC Apps Center Node.js Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=${WEB_ROOT}
ExecStart=/usr/bin/node ${WEB_ROOT}/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lnsc-apps
if [[ -f "${WEB_ROOT}/server.js" ]]; then
    systemctl start lnsc-apps
    ok "lnsc-apps 服务已启动 (port 3000)"
else
    warn "server.js 未找到，上传项目后执行: sudo systemctl start lnsc-apps"
fi

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Nginx + Node.js 部署完成！（内网 HTTP）       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
ok "访问地址: http://${DOMAIN}"
ok "根目录: ${WEB_ROOT}"
ok "后端服务: lnsc-apps (systemd, port 3000)"
ok "上传 API: http://${DOMAIN}/api/upload"
echo ""
warn "后续操作:"
echo "  1. 上传项目文件到 ${WEB_ROOT}/"
echo "  2. cd ${WEB_ROOT} && npm install"
echo "  3. sudo systemctl restart lnsc-apps"
echo "  4. DNS 添加: ${DOMAIN} -> 10.86.180.76"
echo ""
