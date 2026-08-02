# HTML-ToolM_App_1210

刀具出入库管理系统 - HTML版本

## 说明

本项目是 `ToolM_App_1210` WPF版本的HTML模式转换，所有UI保持一致。

## 技术栈

- 前端：纯 HTML/CSS/JavaScript + SheetJS/xlsx（替代 MiniExcel）
- 后端：`server.js` — 零依赖 Node.js 服务（需要 Node.js 22+，内置SQLite）
- 数据库：服务器上的 SQLite（`toolinventory-server.db`），**多台电脑共享同一份库存数据**

## 架构（正式部署：集成到 LNSC-Apps 门户）

```
浏览器（多台电脑） ⇄ nginx ⇄ 门户 server.js (Express :3000)
                              ├─ /apps/ctms/     静态前端文件
                              └─ /apps/ctms/api/ 反代 ⇄ CTMS server.js (:3001) ⇄ toolinventory-server.db (SQLite)
```

- 门户 `server.js` 提供 CTMS 静态页面，并将 `/apps/ctms/api/` 反向代理给 CTMS 后端 `server.js`（端口 **3001**，避免与门户 3000 冲突）
- 前端 `db.js` 的 API 路径相对于页面目录自动适配（独立部署为 `/api/`，门户集成为 `/apps/ctms/api/`）
- 所有出入库操作实时写入服务器数据库，**多台电脑共享同一份数据，实时一致**
- 首次启动时若数据库为空，`server.js` 自动从 `initial_inventory.js` 导入WPF版的历史数据
- 前端不引用 `initial_inventory.js`（仅后端 seed 使用，seed 后自动归档为 `.bak`）

## 本地测试（Windows）

```powershell
node server.js 3000
# 浏览器打开 http://localhost:3000
```

## 部署方法（Ubuntu，LNSC-Apps 门户集成）

### 1. 安装 Node.js 22.13+（node:sqlite 内置，无需 flag）

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -e "require('node:sqlite'); console.log('node:sqlite OK')"
# 若报错，说明版本 < 22.13，请在 systemd ExecStart 中加 --experimental-sqlite
```

### 2. 复制后端文件（web root 之外，保护 user_info.txt / .db 不被公开下载）

```bash
sudo mkdir -p /opt/ctms
sudo cp server.js user_info.txt initial_inventory.js /opt/ctms/
# 已有数据库则一并拷贝（保留现有库存数据）；没有则由 initial_inventory.js 自动 seed
sudo cp toolinventory-server.db /opt/ctms/ 2>/dev/null || true
```

### 3. 复制前端文件到门户 apps 目录

```bash
sudo mkdir -p /var/www/lnsc-apps/apps/ctms
sudo cp index.html styles.css app.js db.js user_info.js xlsx.full.min.js 车间工具库存管理-信息表.xlsx /var/www/lnsc-apps/apps/ctms/
```

注意：**不要**把 `server.js`、`user_info.txt`、`toolinventory-server.db`、`initial_inventory.js` 放进 `/var/www/lnsc-apps/`，门户的 express.static 会公开它们。

### 4. 创建 systemd 服务（开机自启，端口 3001）

```bash
sudo tee /etc/systemd/system/ctms.service << 'EOF'
[Unit]
Description=CTMS Tool Inventory Server
After=network.target

[Service]
WorkingDirectory=/opt/ctms
ExecStart=/usr/bin/node /opt/ctms/server.js 3001
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
EOF

sudo chown -R www-data:www-data /opt/ctms
sudo systemctl daemon-reload
sudo systemctl enable --now ctms
sudo systemctl status ctms
curl http://127.0.0.1:3001/api/health   # 应返回 {"ok":true}
```

### 5. 重启门户服务（加载 /apps/ctms/api 反代）

```bash
sudo systemctl restart lnsc-apps   # 门户 server.js 已内置 /apps/ctms/api -> 127.0.0.1:3001 反代
curl http://127.0.0.1:3000/apps/ctms/api/health   # 应返回 {"ok":true}
```

### 6. 访问

- 门户首页点击 **CTMS** 卡片，或直接打开 `http://<服务器IP>/apps/ctms/`
- CTMS 卡片注册在门户 `apps.json` 中（内置应用，不会从门户 UI 被误删）
- 多台电脑同时打开时，操作结果实时写入同一数据库，刷新页面即可看到最新库存

## 数据管理

- **数据库文件**：`/opt/ctms/toolinventory-server.db`（往后的唯一数据库）
- **初始数据归档**：服务器首次导入成功后自动将 `initial_inventory.js` 重命名为 `.bak`，避免误删数据库后静默用旧数据重建
- **每日自动备份**（凌晨2点，保留最近30天）：

```bash
sudo mkdir -p /backup/ctms
echo '0 2 * * * root cp /opt/ctms/toolinventory-server.db /backup/ctms/toolinventory-$(date +\%Y\%m\%d).db && find /backup/ctms -name "*.db" -mtime +30 -delete' | sudo tee /etc/cron.d/ctms-backup
```

- **恢复备份**：停止服务 → 用备份文件覆盖 `toolinventory-server.db` → 重启服务
- **导出报表**：页面底部按钮直接生成Excel下载

## 功能对照

| WPF 功能 | HTML 实现 |
|----------|-----------|
| SQLite 数据库（本机） | SQLite 数据库（服务器，多机共享） |
| MiniExcel | SheetJS (xlsx) |
| WPF 控件 | HTML/CSS 自定义组件 |
| 扫码枪输入 | 键盘事件监听 |
| 导出 Excel | 浏览器下载 xlsx 文件 |

## 界面结构

- **主界面**: 5列柜子网格布局，每个柜子含多个抽屉和状态指示灯
- **详情界面**: 左侧柜子预览 + 中间刀具卡片(8×4) + 右侧操作面板
- **底部功能栏**: 导出操作按钮 / 柜子快速切换按钮
