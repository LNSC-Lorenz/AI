# LNSC-Apps 应用平台

多应用管理平台：`index.html` 为应用门户（apps.json 注册），各应用独立目录、独立服务，经 nginx 反代统一对外。

## 一键部署（apps/ssh）

把本地 `apps/<应用>` 的更新文件**直接覆盖**到服务器（10.86.180.76）对应路径，并**自动重启服务**。

### 首次使用（一次性免密配置）

```powershell
powershell apps/ssh/setup-sshkey.ps1
```

按提示输入一次服务器密码（公钥写入 `authorized_keys`，全程英文交互），之后永久免密。

### 日常部署

```powershell
powershell apps/ssh/deploy.ps1 fahuo              # 部署 fahuo 并重启 fahuo-api
powershell apps/ssh/deploy.ps1 fahuo -NoRestart   # 只覆盖文件，不重启
powershell apps/ssh/deploy.ps1 all                # 部署 apps.conf 里全部应用
```

### 工作机制

```
本地 apps/<app> → tar 打包（按 excludes.conf 排除数据/密钥）
  → scp 到服务器 /tmp → 解压 → sudo cp -r 覆盖到 apps.conf 配置的目标目录
  → sudo systemctl restart <服务名>（回显 active 状态）
```

### 安全设计（重要）

| 原则 | 说明 |
|---|---|
| **只增/覆盖，不删除** | 服务器上本地没有的文件一律保留 |
| **数据/密钥零覆盖** | `excludes.conf` 拦截 `fahuo.db*`、`oid.seq`、`Upload/`、`carriers.env`、`.db_logistic_seq`、`.git` 等，永不上传 |
| **服务可选重启** | `apps.conf` 里服务名留空的应用只部署文件 |

> ⚠️ 切勿再手动"删除服务器全部目录文件"——那会清掉数据库、运单序列（oid.seq 重置会撞顺丰幂等）、上传附件和密钥。

### 接入新应用

1. `apps/ssh/apps.conf` 加一行：
   ```
   应用目录名 | 服务器目标目录 | systemd服务名（可空）
   ```
2. 有专属数据文件的，在 `apps/ssh/excludes.conf` 追加排除模式。

### apps/ssh 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.ps1` | 主部署脚本（打包→上传→覆盖→重启） |
| `setup-sshkey.ps1` | 一次性免密配置（ed25519 密钥 + 写公钥） |
| `apps.conf` | 应用 → 服务器目录 → 服务名 映射表 |
| `excludes.conf` | 部署排除清单（数据/密钥保护） |
| `README.md` | 工具详细说明 |

## 应用更新后何时重启

| 改动 | 操作 |
|---|---|
| 后端代码 / 密钥（server.py、carriers/*.py、carriers.env 等） | 必须重启对应服务（deploy.ps1 默认自动完成） |
| 前端 html / js / css | 无需重启服务，浏览器 Ctrl+F5 强刷即可 |
| 数据库新增列 | 服务启动时自动迁移，无需操作 |

## 目录结构

```
LNSC-Apps/
├── index.html / apps.json   门户页与应用注册表
├── apps/
│   ├── fahuo/               全链发货平台（详见其 0_README.md）
│   ├── ssh/                 ★ 一键部署工具（见上）
│   └── …其他应用
└── README.md                本文档
```
