# lcnnsc-app-26 部署文档

| 项目 | 值 |
|------|-----|
| 主机名 | lcnnsc-app-26 |
| IP | 10.86.180.76 |
| 域名 | lac.lechler.com.cn |
| 协议 | HTTP（内网使用，无需 SSL） |
| 项目路径 | /var/www/lnsc-apps |
| 操作系统 | Ubuntu 24.04 LTS |
| 用途 | Nginx Web 服务器 (LNSC-Apps-Center) |

---

## 简述

1. 重新生成 ISO
   ```
   cd C:\Users\zhlo\Documents\GIT\AI\lcnnsc-app-26\autoinstall
   .\Create-CidataISO.ps1
   ```

2. ESXi 挂载新 ISO -> 开机全自动安装（约15分钟，自动重启）

3. 上传脚本
   ```
   cd C:\Users\zhlo\Documents\GIT\AI\lcnnsc-app-26
   .\upload-scripts.ps1
   ```

4. SSH 登录
   ```
   ssh sysadmin@10.86.180.76
   密码: ChangeMe2026!@#
   ```

5. 执行加固（会提示输入新密码）
   ```
   cd /opt/scripts
   sudo chmod +x *.sh
   sudo bash hardening.sh
   -> Continue? y
   -> New password: (输入新密码，>=14位)
   -> Confirm: (再次输入)
   sudo reboot
   ```

6. 安装 Nginx
   ```
   ssh sysadmin@10.86.180.76
   sudo bash /opt/scripts/setup-nginx.sh
   ```

7. 部署应用文件
   ```
   scp ../LNSC-Apps/index.html ../LNSC-Apps/style.css ../LNSC-Apps/script.js ../LNSC-Apps/apps.json ../LNSC-Apps/App.ico ../LNSC-Apps/server.js ../LNSC-Apps/package.json sysadmin@10.86.180.76:/var/www/lnsc-apps/
   scp -r ../LNSC-Apps/images sysadmin@10.86.180.76:/var/www/lnsc-apps/
   ```

8. 启动后端服务
   ```
   ssh sysadmin@10.86.180.76
   cd /var/www/lnsc-apps && sudo npm install --production
   sudo systemctl restart lnsc-apps
   ```

---

## 硬件配置要求

| 组件 | 最低要求 |
|------|---------|
| CPU | 2 核心 |
| 内存 | 2 GB |
| 系统盘 | SSD，≥ 50 GB |
| 网络 | 千兆以太网 |

---

## 文件清单

```
lcnnsc-app-26/
├── autoinstall/
│   ├── user-data            # Ubuntu autoinstall 配置
│   ├── meta-data            # Cloud-init 元数据
│   └── Create-CidataISO.ps1 # ISO 生成脚本 (Windows)
├── hardening.sh             # CIS 系统加固脚本
├── setup-nginx.sh           # Nginx 部署脚本（内网 HTTP）
├── upload-scripts.ps1       # WinSCP 上传脚本
└── README.md                # 本文件
```

---

## 客户端配置

1. **DNS**：在内网 DNS 添加 `lac.lechler.com.cn → 10.86.180.76`
2. **访问**：浏览器打开 `http://lac.lechler.com.cn`

