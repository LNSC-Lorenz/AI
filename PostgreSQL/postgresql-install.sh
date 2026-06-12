#!/usr/bin/env bash
# =============================================================
# PostgreSQL 18 企业级安装与配置脚本
# 适用于 Ubuntu 24.04 LTS
# 用法: sudo bash postgresql-install.sh
# 前置: ubuntu-init.sh 已完成执行
# =============================================================

set -euo pipefail

# ── 颜色输出 ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}[OK]   $*${RESET}"; }
warn() { echo -e "${YELLOW}[WARN] $*${RESET}"; }
info() { echo -e "${CYAN}[INFO] $*${RESET}"; }
fail() { echo -e "${RED}[FAIL] $*${RESET}"; exit 1; }
step() { echo -e "\n${CYAN}══════════════════════════════════════${RESET}"; \
         echo -e "${CYAN}  Step $*${RESET}"; \
         echo -e "${CYAN}══════════════════════════════════════${RESET}"; }

# ── 配置区（按需修改）────────────────────────────────────────
PG_VERSION=18
PG_DATA_DIR="/var/lib/postgresql/${PG_VERSION}/main"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
PG_LOG_DIR="/var/log/postgresql"

LISTEN_ADDRESS="*"              # 监听地址（* = 所有接口）
MAX_CONNECTIONS=200             # 最大连接数
SHARED_BUFFERS="256MB"          # 共享内存（建议物理内存25%）
WORK_MEM="4MB"                  # 单查询内存
MAINTENANCE_WORK_MEM="64MB"     # 维护操作内存
EFFECTIVE_CACHE_SIZE="1GB"      # 有效缓存大小（建议物理内存75%）
LOG_MIN_DURATION=1000           # 慢查询阈值（毫秒）

POSTGRES_PASSWORD="Postgres@2025"   # postgres 超级用户密码

# ── 预检 ──────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "请以 root 用户运行: sudo bash $0"
. /etc/os-release
[[ "$ID" == "ubuntu" && "$VERSION_ID" == "24.04" ]] || \
  warn "当前系统非 Ubuntu 24.04，继续执行请谨慎"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  PostgreSQL 18 企业级安装脚本                 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
info "PostgreSQL 版本  : $PG_VERSION"
info "监听地址         : $LISTEN_ADDRESS"
info "最大连接数       : $MAX_CONNECTIONS"
info "shared_buffers   : $SHARED_BUFFERS"
info "数据目录         : $PG_DATA_DIR"
echo ""
read -rp "确认以上配置并继续? (y/N): " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { info "已取消"; exit 0; }

# ── Step 1: 检查是否已安装 ───────────────────────────────────
step "1: 检查 PostgreSQL 安装状态"
if command -v psql &>/dev/null; then
  INSTALLED_VER=$(psql --version | grep -oP '\d+' | head -1)
  warn "PostgreSQL $INSTALLED_VER 已安装"
  read -rp "是否继续（覆盖配置）? (y/N): " overwrite
  [[ "$overwrite" =~ ^[Yy]$ ]] || { info "已取消"; exit 0; }
else
  info "未检测到 PostgreSQL，开始安装..."
fi

# ── Step 2: 添加 PostgreSQL 官方源 ───────────────────────────
step "2: 添加 PostgreSQL 官方 APT 源"
apt-get install -y -qq curl ca-certificates
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
ok "PostgreSQL 官方源添加完成"

# ── Step 3: 安装 PostgreSQL 18 ───────────────────────────────
step "3: 安装 PostgreSQL $PG_VERSION"
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  postgresql-${PG_VERSION} \
  postgresql-client-${PG_VERSION} \
  postgresql-contrib-${PG_VERSION}
systemctl enable postgresql --now
ok "PostgreSQL $PG_VERSION 安装完成"
psql --version

# ── Step 4: 设置 postgres 用户密码 ───────────────────────────
step "4: 设置 postgres 超级用户密码"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';"
ok "postgres 密码设置完成"

# ── Step 5: 配置 postgresql.conf ─────────────────────────────
step "5: 配置 postgresql.conf"
cp "$PG_CONF" "${PG_CONF}.bak.$(date +%Y%m%d)"

# 监听地址
sed -i "s/^#*listen_addresses = .*/listen_addresses = '$LISTEN_ADDRESS'/" "$PG_CONF"

# 连接
sed -i "s/^#*max_connections = .*/max_connections = $MAX_CONNECTIONS/" "$PG_CONF"

# 内存
sed -i "s/^#*shared_buffers = .*/shared_buffers = $SHARED_BUFFERS/" "$PG_CONF"
sed -i "s/^#*work_mem = .*/work_mem = $WORK_MEM/" "$PG_CONF"
sed -i "s/^#*maintenance_work_mem = .*/maintenance_work_mem = $MAINTENANCE_WORK_MEM/" "$PG_CONF"
sed -i "s/^#*effective_cache_size = .*/effective_cache_size = $EFFECTIVE_CACHE_SIZE/" "$PG_CONF"

# WAL
sed -i "s/^#*wal_buffers = .*/wal_buffers = 16MB/" "$PG_CONF"
sed -i "s/^#*checkpoint_completion_target = .*/checkpoint_completion_target = 0.9/" "$PG_CONF"
sed -i "s/^#*wal_compression = .*/wal_compression = on/" "$PG_CONF"

# 查询优化（SSD）
sed -i "s/^#*random_page_cost = .*/random_page_cost = 1.1/" "$PG_CONF"
sed -i "s/^#*effective_io_concurrency = .*/effective_io_concurrency = 200/" "$PG_CONF"

# 日志
sed -i "s/^#*logging_collector = .*/logging_collector = on/" "$PG_CONF"
sed -i "s/^#*log_filename = .*/log_filename = 'postgresql-%Y-%m-%d.log'/" "$PG_CONF"
sed -i "s/^#*log_rotation_age = .*/log_rotation_age = 1d/" "$PG_CONF"
sed -i "s/^#*log_rotation_size = .*/log_rotation_size = 100MB/" "$PG_CONF"
sed -i "s/^#*log_min_duration_statement = .*/log_min_duration_statement = $LOG_MIN_DURATION/" "$PG_CONF"
sed -i "s/^#*log_connections = .*/log_connections = on/" "$PG_CONF"
sed -i "s/^#*log_disconnections = .*/log_disconnections = on/" "$PG_CONF"
sed -i "s/^#*log_lock_waits = .*/log_lock_waits = on/" "$PG_CONF"
sed -i "s/^#*log_temp_files = .*/log_temp_files = 0/" "$PG_CONF"

# 统计扩展
sed -i "s/^#*shared_preload_libraries = .*/shared_preload_libraries = 'pg_stat_statements'/" "$PG_CONF"

ok "postgresql.conf 配置完成"

# ── Step 6: 配置 pg_hba.conf ─────────────────────────────────
step "6: 配置 pg_hba.conf（访问控制）"
cp "$PG_HBA" "${PG_HBA}.bak.$(date +%Y%m%d)"
cat > "$PG_HBA" <<'EOF'
# TYPE  DATABASE        USER            ADDRESS                 METHOD
# 本地 Unix socket
local   all             postgres                                peer
local   all             all                                     md5
# 本地 TCP
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
# 远程访问（按需限制 IP 段）
host    all             all             0.0.0.0/0               scram-sha-256
EOF
ok "pg_hba.conf 配置完成"

# ── Step 7: 重启并验证 ───────────────────────────────────────
step "7: 重启 PostgreSQL 并验证"
systemctl restart postgresql
sleep 2
systemctl is-active postgresql && ok "PostgreSQL 服务正在运行" || fail "PostgreSQL 启动失败"
sudo -u postgres psql -c "SELECT version();"
ok "PostgreSQL 连接验证通过"

# ── Step 8: 启用 pg_stat_statements 扩展 ─────────────────────
step "8: 启用 pg_stat_statements（慢查询分析）"
sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
ok "pg_stat_statements 扩展已启用"

# ── Step 9: 创建备份目录 ─────────────────────────────────────
step "9: 创建备份目录并配置定时备份"
BACKUP_DIR="/var/backups/postgresql"
mkdir -p "$BACKUP_DIR"
chown postgres:postgres "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

# 写入备份脚本
cat > /usr/local/bin/pg-backup.sh <<EOF
#!/usr/bin/env bash
# PostgreSQL 自动备份脚本
BACKUP_DIR="$BACKUP_DIR"
DATE=\$(date +%Y%m%d_%H%M%S)
pg_dumpall -U postgres > "\$BACKUP_DIR/all_\${DATE}.sql"
gzip "\$BACKUP_DIR/all_\${DATE}.sql"
# 保留最近 30 天
find "\$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete
echo "备份完成: \$BACKUP_DIR/all_\${DATE}.sql.gz"
EOF
chmod +x /usr/local/bin/pg-backup.sh
chown root:root /usr/local/bin/pg-backup.sh

# 添加 crontab（每天凌晨2点）
(crontab -u postgres -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/pg-backup.sh >> /var/log/pg-backup.log 2>&1") \
  | crontab -u postgres -
ok "备份目录: $BACKUP_DIR，定时备份: 每天凌晨 2:00"

# ── Step 10: 配置 UFW 开放 5432 ──────────────────────────────
step "10: 防火墙开放 PostgreSQL 端口"
if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  ufw allow 5432/tcp
  ok "UFW 已开放端口 5432"
else
  warn "UFW 未启用，跳过防火墙规则"
fi

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  PostgreSQL 18 安装配置完成！                 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
ok "PostgreSQL $PG_VERSION 安装"
ok "超级用户密码已设置"
ok "postgresql.conf 企业级配置"
ok "pg_hba.conf 访问控制"
ok "pg_stat_statements 慢查询扩展"
ok "自动备份: $BACKUP_DIR（每天02:00）"
echo ""
warn "重要信息："
echo "  postgres 密码   : $POSTGRES_PASSWORD"
echo "  数据目录        : $PG_DATA_DIR"
echo "  配置文件        : $PG_CONF"
echo "  备份目录        : $BACKUP_DIR"
echo "  端口            : 5432"
echo ""
info "常用命令："
echo "  进入 psql       : sudo -u postgres psql"
echo "  重启服务        : sudo systemctl restart postgresql"
echo "  查看日志        : sudo tail -f $PG_LOG_DIR/postgresql-$(date +%Y-%m-%d).log"
echo "  手动备份        : sudo -u postgres /usr/local/bin/pg-backup.sh"
echo ""
