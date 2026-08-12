# install/ · Ubuntu 一键安装

## 0. nginx 生产拓扑（内网应用，单文件夹）

所有文件集中 `/var/www/lnsc-apps/apps/po-closing` 一个文件夹，nginx `root` 直指即可，无需 /var/www 发布步骤：

```
浏览器 ──► nginx :80/:443
             ├── 静态: root /var/www/lnsc-apps/apps/po-closing（index.html、invoice/ 等全部在此）
             └── /api/ ──反代──► 127.0.0.1:8088（poclose.service）
```

**执行顺序：**

```bash
# 1) 上传 PO-Closing 整个文件夹到服务器（如 /home/<user>/PO-Closing）

# 2) 一键安装平台（第一阶段：后端 + Exchange 抓取定时任务）
cd /home/<user>/PO-Closing
sudo bash install/bach_POClosing

# 3) 编辑配置（数据源 csv/rfc、SAP/Exchange 连接；POCLOSE_HOST 保持 127.0.0.1）
sudo nano /var/www/lnsc-apps/apps/po-closing/.env && sudo systemctl restart poclose

# 4) nginx 站点：/etc/nginx/sites-available/poclosing
#    server {
#        listen 80;
#        server_name _;
#        root /var/www/lnsc-apps/apps/po-closing;
#        index index.html;
#        location / { try_files $uri $uri/ =404; }
#        location /api/ {
#            proxy_pass http://127.0.0.1:8088;
#            proxy_set_header Host $host;
#            proxy_set_header X-Real-IP $remote_addr;
#            proxy_read_timeout 600s;   # 需 ≥ 后端邮件抓取超时（/api/mail_sync 最长 600 秒）
#        }
#    }
sudo ln -sfn /etc/nginx/sites-available/poclosing /etc/nginx/sites-enabled/poclosing
#    若默认站点占用 listen 80 冲突：sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 5) 验证（按此顺序）
systemctl status poclose                     # 后端服务 active
curl http://127.0.0.1:8088/api/health        # 后端直连 OK
curl http://127.0.0.1/api/health             # 经 nginx 反代 OK
curl -I http://127.0.0.1/                    # 页面 200
# 浏览器访问 http://<服务器IP>/ → 自动载入 invoice 清单

# 6) 可选 HTTPS：sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx
```



安装分两个阶段、两个脚本：

| 脚本 | 阶段 | 内容 |
|---|---|---|
| `bach_POClosing` | **第一阶段（先行）** | 平台 + 内网 Exchange 发票抓取定时任务（venv + exchangelib） |
| `bach_POClosing_SAP` | **第二阶段（SAP 调试就绪后再跑）** | SAP NW RFC SDK + pyrfc + RFC 刷新定时任务 |

## 第一阶段：bach_POClosing（邮件 → CSV）

```bash
# 在 PO-Closing 根目录
sudo bash install/bach_POClosing              # 平台 + 内网 Exchange 发票抓取定时任务
sudo bash install/bach_POClosing --verify     # 发票链路验收（前置检查→连接验证→演练→正式抓取→摘要）
sudo bash install/bach_POClosing --uninstall  # 卸载服务与定时任务（保留数据目录）
```

装完后编辑 `/var/www/lnsc-apps/apps/po-closing/invoice/exchange.env` 填入 `EXCH_PASS`，然后一键验收：

```bash
sudo bash install/bach_POClosing --verify
# 自动执行：前置检查（密码未填则交互录入）→ --check 验证 → dry-run 演练 → 正式抓取 → 结果摘要
```

## 第二阶段：bach_POClosing_SAP（SAP 收货核查，调试麻烦可后置）

```bash
sudo bash install/bach_POClosing_SAP --with-sdk /path/SAPNWRFC.zip  # 装 SDK + pyrfc
sudo bash install/bach_POClosing_SAP --with-sdk                     # 自动查找 zip
sudo bash install/bach_POClosing_SAP                                # SDK 已就绪，仅装 pyrfc + 定时任务
sudo bash install/bach_POClosing_SAP --uninstall                    # 卸载 pyrfc + RFC 定时任务（保留 SDK）
```

- SDK 为 SAP 闭源组件，需 S 账号从 SAP for Me 下载 **Linux x86_64** 版（本仓库不提供）
- 前提检测：未完成第一阶段会直接报错退出；已装过 SDK 时自动复用 `/etc/profile.d/nwrfcsdk.sh`
- 完成后追加 cron（每周一 08:00 RFC 刷新 result.csv），并提示把 `.env` 的 `POCLOSE_DATA_SOURCE` 切为 `csv`/`rfc`
- SAP 侧函数部署（SE37 `Z_RFC_PO_GR_STATUS`）见 `rfc/README.md`，需 ABAP/Basis 配合

## 安装结果

| 位置 | 内容 |
|---|---|
| `/var/www/lnsc-apps/apps/po-closing/` | 平台文件（server.py、index.html、invoice/、rfc/ 等） |
| `/var/www/lnsc-apps/apps/po-closing/.env` | 全部配置（首次生成模板，`chmod 600`，重复安装不覆盖） |
| `/etc/systemd/system/poclose.service` | Web 常驻服务（开机自启，崩溃自动重启） |
| `/etc/cron.d/poclose` | 定时任务（见下） |
| `/var/log/poclose/` | 定时任务日志 |

## 定时任务编排

```
03:00 ── cron: exchange_invoice_sync.py 抓取发票邮件 → invoices_<YYYY>.csv（第一阶段）
03:33 ── 平台内置: 读 invoice/*.csv → 连 SAP 核查 → 落库（页面自动套用）
12:00 ── cron: 同上抓取
12:33 ── 平台内置: 同上核查
（第二阶段）每周一 08:00: po_gr_check.py 刷新 result.csv
```

平台核查时间可在页面「设置」弹窗修改（存 SQLite，即时生效）。

## 安装后操作

1. 编辑 `/var/www/lnsc-apps/apps/po-closing/invoice/exchange.env` 填入 auto@lechler.com.cn 的连接与密码（600，独立于主配置）；`/var/www/lnsc-apps/apps/po-closing/.env` 数据源默认 `csv`（演示可临时改 `mock`）
2. `systemctl restart poclose` 生效
3. 浏览器访问 `http://<主机>:8088`（默认仅 127.0.0.1，对外共享改 `POCLOSE_HOST=0.0.0.0`）
4. 验证：`cat /etc/cron.d/poclose`、`tail -f /var/log/poclose/inv_sync.log`
5. SAP 就绪后跑第二阶段：`sudo bash install/bach_POClosing_SAP --with-sdk <zip>`
