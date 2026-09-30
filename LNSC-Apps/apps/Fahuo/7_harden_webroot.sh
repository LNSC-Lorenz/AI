#!/usr/bin/env bash
# ============================================================================
#  7_harden_webroot.sh —— Fahuo 目录清理 + webroot 敏感文件加固（幂等；需 root）
#
#  背景（2026-09-30 安全事件）：nginx `location /apps/ { try_files $uri $uri/ =404; }`
#  把整个应用目录当静态根，实测 /apps/fahuo/carriers.env 返回 200 且是真实密钥；
#  fahuo.db / backup/*.db / server.py / 0_README.md，以及其他应用的 .env、*.db 同样可下载。
#
#  本脚本做三件事（可反复执行）：
#    ① 删除 __pycache__ 字节码（显式路径白名单，绝不通配 —— 见 2026-09-24 误删 __init__.py 事故教训）
#    ② 密钥文件权限收紧 600
#    ③ 幂等插入 nginx 拦截规则：只拦代码/密钥/数据类扩展名与敏感目录；
#       前端实际加载的 .js/.css/.json/.xlsx 一律放行（shipphotos.json、stock.json、catalog.json、
#       media.json、drawings.json、车间工具库存管理-信息表.xlsx 都必须仍可读）
#
#  用法：sudo bash 7_harden_webroot.sh
#  回滚：脚本末尾会打印 cp -aL 回滚命令（备份在 sites-available/，不是 sites-enabled/）
# ============================================================================
set -uo pipefail

APP=/var/www/lnsc-apps/apps/fahuo
SITE=/etc/nginx/sites-enabled/lac.lechler.com.cn
STAMP=$(date +%Y%m%d-%H%M%S)
ok() { echo "[ok] $*"; }

echo "===== 1) 删除 Python 字节码缓存（服务无影响，运行时自动重建） ====="
for d in "$APP/__pycache__" "$APP/carriers/__pycache__"; do
    if [ -d "$d" ]; then
        n=$(find "$d" -type f | wc -l)
        echo "[del] $d  ($n 个文件)"
        rm -rf -- "$d"
        ok "已删除"
    else
        echo "[skip] $d 不存在"
    fi
done

echo "===== 2) 密钥文件权限收紧（原 644，webroot 内可下载） ====="
if [ -f "$APP/carriers.env" ]; then
    chmod 600 "$APP/carriers.env"
    ok "carriers.env -> 600  ($(stat -c '%U:%G %a' "$APP/carriers.env"))"
fi

echo "===== 3) nginx 敏感文件拦截规则（幂等插入） ====="
if grep -q 'fahuo-webroot-hardening' "$SITE"; then
    echo "[skip] 保护规则已存在"
else
    # ⚠️ $SITE 是软链：必须 readlink -f 解引用后 -L 备份到 sites-available，
    #    否则备份软链落进 sites-enabled/* 会重复加载同一 vhost
    #    （conflicting server name 警告 + reload 期间旧 worker 短暂按旧配置应答）。
    REAL=$(readlink -f "$SITE")
    cp -aL "$REAL" "${REAL}.bak-$STAMP"
    ok "已备份 $REAL -> ${REAL}.bak-$STAMP（真实文件）"
    python3 - "$REAL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
marker = "    location /apps/ {\n"
block = '''    # >>> fahuo-webroot-hardening 2026-09-30
    # 漏洞修复：此前 webroot 内源码/密钥/数据库/备份可被直接下载（实测 carriers.env 200 + 真实密钥）。
    # 只拦代码/密钥/数据类扩展名与敏感目录；前端实际抓取的 .json/.xlsx/.js/.css 不受影响
    # （shipphotos.json、stock.json、catalog.json、media.json、drawings.json、信息表.xlsx 仍可读）。
    location ~* ^/apps/.*\\.(py|pyc|pyo|sh|env|trc|db(-wal|-shm)?|seq|log|md|bak|orig|swp)$ { return 404; }
    location ~* ^/apps/[^/]+/(carriers|backup|install)/ { return 404; }
    # Node 后端同名文件（仅本地开发用；全仓库无任何前端 src/script 引用）——同样不可下载
    location ~* ^/apps/([^/]+/)?server\\.js$ { return 404; }
    # <<< fahuo-webroot-hardening

'''
if marker not in s:
    sys.exit("锚点 `    location /apps/ {` 未找到，未修改配置")
open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(marker, block + marker, 1))
print("[ok] 已插入保护规则")
PY
fi

echo "===== 4) 配置校验 + 生效 ====="
if nginx -t; then
    systemctl reload nginx
    sleep 1
    ok "nginx -t 通过（应无 conflicting server name 警告），已 reload"
else
    echo "[FAIL] nginx -t 失败，未 reload；回滚：cp -aL ${SITE}.bak-<时间戳> $(readlink -f "$SITE") && systemctl reload nginx"
    exit 1
fi

echo "===== 5) 验签：敏感文件应 404 / 前端资源应 200 ====="
HOSTHDR='lac.lechler.com.cn'
PASS=0; FAIL=0
check() { # $1=期望码 $2=路径
    got=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOSTHDR" "http://127.0.0.1$2")
    if [ "$got" = "$1" ]; then
        printf '  [PASS] %-3s %s\n' "$got" "$2"; PASS=$((PASS + 1))
    else
        printf '  [FAIL] 期望 %s 实得 %-3s %s\n' "$1" "$got" "$2"; FAIL=$((FAIL + 1))
    fi
}
for p in /apps/fahuo/carriers.env /apps/fahuo/fahuo.db /apps/fahuo/fahuo.db-wal /apps/fahuo/fahuo.db-shm \
         /apps/fahuo/oid.seq /apps/fahuo/server.py /apps/fahuo/server.js /apps/fahuo/ot_label.py \
         /apps/fahuo/0_README.md /apps/fahuo/audit.log /apps/fahuo/backup/fahuo-20260930-0630.db \
         /apps/fahuo/carriers/_sb_pages.py /apps/fahuo/carriers/sf_express.py \
         /apps/po-closing/.env /apps/po-closing/poclose.db /apps/po-closing/server.py \
         /apps/ctms/toolinventory-server.db /apps/ctms/server.js; do check 404 "$p"; done
for p in /apps/fahuo/ /apps/fahuo/pages/2-order.html /apps/fahuo/pages/2-order.js \
         /apps/fahuo/shared/style.css /apps/fahuo/shared/region.js /apps/fahuo/shared/lib/JsBarcode.all.min.js \
         /apps/fahuo/shared/lib/qrcode.min.js /apps/fahuo/shipphotos.json /apps.json \
         /apps/ctms/user_info.js /apps/binvision/stock.json /apps/qms/catalog.json \
         /apps/libq/media.json /apps/purchasedrawing/drawings.json /apps/po-closing/; do check 200 "$p"; done
check 200 "/apps/fahuo/api/stats"        # 反代链路
echo
echo "PASS=$PASS FAIL=$FAIL"
ls -la /etc/nginx/sites-enabled/
echo "回滚：cp -aL $(readlink -f "$SITE").bak-<时间戳> $(readlink -f "$SITE") && systemctl reload nginx"
[ "$FAIL" -eq 0 ] && echo "HARDEN_GREEN" || echo "HARDEN_RED"