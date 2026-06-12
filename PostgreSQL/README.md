# Ubuntu 24.04 LTS + PostgreSQL 18 企业级运维手册

## 目录

- [环境说明](#环境说明)
- [硬件配置要求](#硬件配置要求)
- [安装](#安装)
- [初始化配置](#初始化配置)
- [数据库管理](#数据库管理)
- [用户与权限](#用户与权限)
- [备份与恢复](#备份与恢复)
- [性能调优](#性能调优)
- [监控](#监控)
- [升级维护](#升级维护)
- [故障排查](#故障排查)

---

## 环境说明

| 项目 | 版本 |
|------|------|
| 操作系统 | Ubuntu 24.04 LTS (Noble Numbat) |
| 数据库 | PostgreSQL 18 |
| 架构 | x86_64 |
| 使用场景 | 纯数据库服务器，AI 模型独立运行于 2 台 DGX Spark |

---

## 硬件配置要求

> 本节面向 **纯 PostgreSQL 18 数据库服务器**场景。AI 模型独立运行在 2 台 DGX Spark 上，本机仅作数据库使用。

### 最低配置（可用）

| 组件 | 要求 |
|------|------|
| **CPU** | x86_64，8 核心（推荐 Intel Xeon / AMD EPYC） |
| **内存 (RAM)** | 32 GB DDR4 |
| **GPU** | 不需要 |
| **系统盘** | SSD，≥ 100 GB（OS + PostgreSQL 程序） |
| **数据盘** | SSD，≥ 500 GB（PostgreSQL 数据目录） |
| **网络** | 千兆以太网 |

### 推荐配置（生产级）

| 组件 | 推荐 |
|------|------|
| **CPU** | 16~32 核心，Intel Xeon Silver/Gold 或 AMD EPYC |
| **内存 (RAM)** | 64~128 GB DDR4/DDR5 ECC（`shared_buffers` 建议内存的 25%） |
| **GPU** | 不需要 |
| **系统盘** | NVMe SSD，≥ 100 GB |
| **数据盘** | NVMe SSD，≥ 2 TB（PostgreSQL 数据 + WAL） |
| **备份盘** | 机械硬盘 / NAS，≥ 数据盘容量 × 2 |
| **网络** | 万兆以太网（与 DGX Spark 高速互联） |
| **电源** | 冗余电源 |

### 内存分配参考

| 组件 | 内存占用（估算） |
|------|-----------------|
| `shared_buffers` | 物理内存的 25%（如 64GB 内存 → 16GB） |
| `effective_cache_size` | 物理内存的 75% |
| `work_mem` × 并发连接 | 并发数 × work_mem（注意总量上限） |
| 操作系统 + 其他 | ~4~8 GB |

### 存储 I/O 要求

| 场景 | 要求 |
|------|------|
| PostgreSQL 数据目录 | 随机读写 IOPS ≥ 5,000（SSD），≥ 50,000（NVMe） |
| WAL 日志目录 | 顺序写入吞吐 ≥ 200 MB/s（建议独立分区） |
| 备份存储 | 机械硬盘或 NAS 均可 |

> **建议：** WAL 目录与数据目录分别放在不同物理磁盘，减少 I/O 竞争。

### 操作系统配置要求

| 项目 | 要求 |
|------|------|
| 内核版本 | ≥ 5.15（Ubuntu 24.04 默认满足） |
| 文件描述符限制 | ≥ 65536（`ubuntu-init.sh` 已配置） |
| 透明大页（THP） | 必须关闭（`ubuntu-init.sh` 已处理） |
| `vm.swappiness` | 建议设为 10（`ubuntu-init.sh` 已配置） |
| Swap | ≥ 8 GB（防止偶发 OOM） |
| 时区 | 统一设置（避免日志时间混乱） |

### 部署架构

```
┌──────────────────┐     ┌──────────────────┐
│  DGX Spark #1    │     │  DGX Spark #2    │
│  AI 推理引擎      │     │  AI 推理引擎      │
│  (Ollama/vLLM)   │     │  (Ollama/vLLM)   │
└────────┬─────────┘     └────────┬─────────┘
         │  TCP/IP（万兆网络）      │
         └──────────┬─────────────┘
                    │
         ┌──────────▼──────────┐
         │  Ubuntu 24.04 LTS   │
         │  PostgreSQL 18      │
         │  - 对话历史存储      │
         │  - RAG 向量数据      │
         │  - 业务数据          │
         │  CPU: 16C+          │
         │  RAM: 64~128 GB     │
         │  NVMe: 2 TB+        │
         └─────────────────────┘
```

> **pgvector 扩展：** 若需存储 AI 向量嵌入（RAG 场景），需额外安装 `postgresql-18-pgvector`。

---

## 安装

### 添加 PostgreSQL 官方源

```bash
sudo apt-get install -y curl ca-certificates
sudo install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
```

### 安装 PostgreSQL 18

```bash
sudo apt-get update
sudo apt-get install -y postgresql-18 postgresql-client-18
```

### 验证安装

```bash
psql --version
sudo systemctl status postgresql
```

---

## 初始化配置

### 启动并设置开机自启

```bash
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 修改 postgres 超级用户密码

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'your_password';"
```

### 主配置文件位置

| 文件 | 路径 |
|------|------|
| 主配置 | `/etc/postgresql/18/main/postgresql.conf` |
| 访问控制 | `/etc/postgresql/18/main/pg_hba.conf` |
| 数据目录 | `/var/lib/postgresql/18/main/` |
| 日志目录 | `/var/log/postgresql/` |

### 允许远程连接

编辑 `postgresql.conf`：
```bash
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" \
  /etc/postgresql/18/main/postgresql.conf
```

编辑 `pg_hba.conf`，追加：
```
host    all             all             0.0.0.0/0               scram-sha-256
```

重启生效：
```bash
sudo systemctl restart postgresql
```

---

## 数据库管理

### 创建数据库

```bash
sudo -u postgres createdb mydb
# 或
sudo -u postgres psql -c "CREATE DATABASE mydb ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8';"
```

### 删除数据库

```bash
sudo -u postgres dropdb mydb
```

### 列出所有数据库

```bash
sudo -u postgres psql -c "\l"
```

### 连接数据库

```bash
sudo -u postgres psql -d mydb
psql -h 127.0.0.1 -U myuser -d mydb
```

---

## 用户与权限

### 创建用户

```bash
sudo -u postgres psql -c "CREATE USER myuser WITH PASSWORD 'password' LOGIN;"
```

### 授予数据库权限

```bash
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE mydb TO myuser;"
sudo -u postgres psql -d mydb -c "GRANT ALL ON SCHEMA public TO myuser;"
```

### 创建只读用户

```bash
sudo -u postgres psql <<EOF
CREATE USER readonly_user WITH PASSWORD 'password';
GRANT CONNECT ON DATABASE mydb TO readonly_user;
GRANT USAGE ON SCHEMA public TO readonly_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_user;
EOF
```

### 列出所有用户

```bash
sudo -u postgres psql -c "\du"
```

---

## 备份与恢复

### 单库备份（pg_dump）

```bash
sudo -u postgres pg_dump mydb > /backup/mydb_$(date +%Y%m%d).sql
# 压缩格式（推荐）
sudo -u postgres pg_dump -Fc mydb > /backup/mydb_$(date +%Y%m%d).dump
```

### 全库备份（pg_dumpall）

```bash
sudo -u postgres pg_dumpall > /backup/all_databases_$(date +%Y%m%d).sql
```

### 恢复

```bash
# 从 SQL 文件恢复
sudo -u postgres psql mydb < /backup/mydb_20250101.sql
# 从压缩格式恢复
sudo -u postgres pg_restore -d mydb /backup/mydb_20250101.dump
```

### 定时备份（crontab）

```bash
sudo crontab -u postgres -e
# 每天凌晨2点备份，保留30天
0 2 * * * pg_dump -Fc mydb > /backup/mydb_$(date +\%Y\%m\%d).dump && find /backup -name "*.dump" -mtime +30 -delete
```

---

## 性能调优

### 关键参数（`postgresql.conf`）

```ini
# 内存（建议设为物理内存的25%）
shared_buffers = 4GB

# 单次查询可用内存
work_mem = 64MB

# 维护操作内存（VACUUM, CREATE INDEX）
maintenance_work_mem = 512MB

# 有效缓存大小（建议物理内存的75%）
effective_cache_size = 12GB

# 并发连接数
max_connections = 200

# WAL 日志
wal_buffers = 64MB
checkpoint_completion_target = 0.9

# 查询优化
random_page_cost = 1.1          # SSD 存储推荐
effective_io_concurrency = 200  # SSD 推荐
```

修改后重启：
```bash
sudo systemctl restart postgresql
```

### 查看当前参数

```bash
sudo -u postgres psql -c "SHOW shared_buffers;"
sudo -u postgres psql -c "SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','max_connections');"
```

---

## 监控

### 查看当前连接

```bash
sudo -u postgres psql -c "SELECT pid, usename, application_name, client_addr, state, query FROM pg_stat_activity;"
```

### 查看数据库大小

```bash
sudo -u postgres psql -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC;"
```

### 查看表大小

```bash
sudo -u postgres psql -d mydb -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;"
```

### 查看慢查询

```bash
# 开启慢查询日志，在 postgresql.conf 中设置：
# log_min_duration_statement = 1000  # 记录超过1秒的查询
sudo -u postgres psql -c "SELECT query, calls, total_exec_time, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

### 查看锁等待

```bash
sudo -u postgres psql -c "SELECT pid, usename, pg_blocking_pids(pid) AS blocked_by, query FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;"
```

---

## 升级维护

### VACUUM（清理死元组）

```bash
sudo -u postgres psql -d mydb -c "VACUUM ANALYZE;"
# 完整清理（会锁表）
sudo -u postgres psql -d mydb -c "VACUUM FULL ANALYZE;"
```

### REINDEX（重建索引）

```bash
sudo -u postgres psql -d mydb -c "REINDEX DATABASE mydb;"
```

### 查看服务状态

```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT version();"
```

### 查看日志

```bash
sudo tail -f /var/log/postgresql/postgresql-18-main.log
```

---

## 故障排查

| 问题 | 排查命令 |
|------|----------|
| 服务无法启动 | `sudo journalctl -u postgresql -n 50` |
| 连接被拒绝 | 检查 `pg_hba.conf` 和防火墙 `sudo ufw status` |
| 磁盘空间不足 | `df -h` / `sudo -u postgres psql -c "\l+"` |
| 连接数耗尽 | `SELECT count(*) FROM pg_stat_activity;` |
| 主从复制延迟 | `SELECT * FROM pg_stat_replication;` |
| 死锁 | `SELECT * FROM pg_locks WHERE NOT granted;` |

### 常用紧急操作

```bash
# 终止指定数据库的所有连接
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = 'mydb';"

# 重载配置（不重启）
sudo -u postgres psql -c "SELECT pg_reload_conf();"

# 强制 checkpoint
sudo -u postgres psql -c "CHECKPOINT;"
```