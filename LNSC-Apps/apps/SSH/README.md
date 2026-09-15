# apps/ssh — LNSC-Apps 一键部署工具

把本地 `apps/<应用>` 的更新文件**直接覆盖**到服务器（10.86.180.76）对应路径，并可**直接重启服务**。

## 首次使用（一次性）

```powershell
powershell apps/ssh/setup-sshkey.ps1
```

按提示输入一次服务器密码（公钥写入 `authorized_keys`），之后永久免密。

## 日常使用

```powershell
powershell apps/ssh/deploy.ps1 fahuo           # 部署 fahuo 并重启 fahuo-api
powershell apps/ssh/deploy.ps1 fahuo -NoRestart  # 只覆盖文件，不重启
powershell apps/ssh/deploy.ps1 all             # 部署 apps.conf 里全部应用
```

## 工作机制

```
本地 apps/<app> → tar 打包（按 excludes.conf 排除数据/密钥）
  → scp 到服务器 /tmp → 解压 → sudo cp -r 覆盖到 apps.conf 配置的目标目录
  → sudo systemctl restart <服务名>
```

- **只增/覆盖，不删除**：服务器上本地没有的文件保留（数据安全）
- **数据/密钥零覆盖**：`excludes.conf` 拦截 `fahuo.db*`、`oid.seq`、`Upload/`、
  `carriers.env`、`.db_logistic_seq`、`.git` 等，永远不会传上服务器
- 配置 `apps.conf` 里 `服务名` 留空的应用：只部署文件，不重启

## 接入新应用

在 `apps.conf` 加一行：

```
应用目录名 | 服务器目标目录 | systemd服务名（可空）
```

如该应用有特殊数据文件不能覆盖，同步在 `excludes.conf` 追加排除模式。

## 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.ps1` | 主部署脚本（打包→上传→覆盖→重启） |
| `setup-sshkey.ps1` | 一次性免密配置（ed25519 密钥 + 写公钥） |
| `apps.conf` | 应用 → 服务器目录 → 服务名 映射表 |
| `excludes.conf` | 部署排除清单（数据/密钥保护） |
