# 销售测试沟通 | 图片和视频记录集

浏览质量部共享盘 `001 销售测试沟通` 目录下图片/视频的内网网页应用。
纯静态单页（HTML + CSS + JS，无框架、无构建），通过 LNSC-Apps 平台部署。

## 架构

```
共享盘 \\10.86.180.4\department\LNSC-06_QD-Quality\07_Open\001 销售测试沟通
        │  (CIFS 只读挂载)
        ▼
Ubuntu 服务器 /var/www/lnsc-apps/libq        ← 1_mount-libq.sh
        │  (nginx 以 /libq/ 路径直接提供媒体文件)
        ▼
浏览器 index.html + media.json (文件索引)    ← 2_scan.sh 生成
```

- 网页部署访问时，媒体 URL 走 `/libq/<相对路径>`
- 本地双击 `index.html`（file:// 协议）时，媒体 URL 走 UNC 路径 `file://///10.86.180.4/...`

## 文件说明

| 文件 | 用途 |
|------|------|
| `index.html` | 应用本体（界面 + 全部逻辑） |
| `media.json` | 媒体文件索引（`name`/`path`/`date`/`size`），由 `2_scan.sh` 生成 |
| `0_README.md` | 本文档 |
| `1_mount-libq.sh` | 服务器一次性配置：将共享盘 CIFS 挂载到 `/var/www/lnsc-apps/libq` |
| `2_scan.sh` | **服务器端**扫描脚本，扫挂载点生成 `media.json`（推荐配 cron 自动更新） |
| `3_uninstall.sh` | 完全卸载：清理 cron、卸载挂载、删 fstab 条目/凭据文件，可选删应用目录 |
| `lib/` | h265web.js（GPL 开源）WASM 软解库，HEVC 视频黑屏时自动回退使用 |

## 功能

- **文件夹树**：左侧按共享盘目录结构浏览，显示各文件夹文件数
- **搜索 / 筛选**：全局文件名搜索；ALL / IMG / VIDEO 类型过滤
- **排序**：按年份（文件夹路径）降序 / 升序切换，默认降序
- **灯箱预览**：
  - 图片：滚轮缩放（100%–800%，以鼠标为中心）、拖拽平移、双击放大/复位
  - 视频：优先原生播放器（H.264 硬解流畅）；检测到 HEVC 黑屏时自动切 h265web.js WASM 软解（带播放/暂停/进度条，4K 大文件可能卡顿）
  - `←` `→` 键或左右按钮切换上/下一个，`Esc` 关闭，底部显示序号
- **打开原文件**：灯箱内可直接打开/下载源文件

## 部署（两条命令 + 前端上传）

服务器端只需依次运行两个脚本，全部动作自动完成、可重复执行：

```bash
scp 1_mount-libq.sh 2_scan.sh sysadmin@10.86.180.76:/home/sysadmin/
ssh sysadmin@10.86.180.76 'sudo bash /home/sysadmin/1_mount-libq.sh && sudo bash /home/sysadmin/2_scan.sh'
```

- **`1_mount-libq.sh`**：装 cifs-utils → 写凭据 → 挂载共享盘 → 自动写入 fstab（重启自动恢复）
- **`2_scan.sh`**：自动注册 cron（每 30 分钟）→ 预创建部署目录 → 生成 `media.json` 到 `/var/www/lnsc-apps/apps/libq/`

然后前端上传 `index.html` + `lib/` 整个目录（HEVC 软解库），**应用名固定填 `LibQ`**（ID 自动转小写 `libq`，与脚本 `APP_DIR` 对应）。

之后共享盘新增文件最多 30 分钟自动出现在网页，无需人工干预。

> 注意：前端重新上传应用会用本地旧 `media.json` 覆盖服务器版本，等下一个 cron 周期自动恢复。

## 常见问题

- **视频黑屏 / 只有声音**：视频为 HEVC(H.265) 编码（iPhone/相机常见），浏览器无解码器。
  页面会自动切换到 h265web.js WASM 软解（需 `lib/` 目录已部署）；软解 4K 大文件卡顿时，
  建议观看电脑安装 Microsoft Store「HEVC 视频扩展」获得硬解，或点击"打开原文件"下载后本地观看。
- **网页显示 MEDIA.JSON NOT FOUND**：索引未生成，先在服务器运行 `2_scan.sh`。
- **图片/视频 404**：确认服务器挂载正常：`mountpoint /var/www/lnsc-apps/libq`；
  未挂载则重新运行 `1_mount-libq.sh` 或 `sudo mount /var/www/lnsc-apps/libq`。
