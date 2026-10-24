# 工单物料查询 — RFC 对接指南（移植自 PO-Closing）

架构：Ubuntu 服务器（已装 NW RFC SDK，与 PO-Closing 同机）→ pyrfc → `Z_OA_GET_ORDERMAT_ORDERNR`（SAP 侧 OA 交付的业务函数）
与 RPA/Prefect 无关；本机（Windows）仅保存源码，不安装任何依赖。

## 1. 接口说明（Z_OA_GET_ORDERMAT_ORDERNR）

**输入** `I_ORDERNO`：单个工单号（ZZORDERNR，无前导零）

**输出** `E_ORDER`（结构 ZTS_STRUCT_ORDER）：

| 字段 | 说明 |
|---|---|
| AUFNR | 工单号（为空 = 查无此单） |
| PLNBEZ / MAKTX / BMEINS | 物料号 / 物料描述 / 基本单位 |
| GAMNG | 工单数量（2026-10-16 OA 侧新增，QUAN；脚本已转 float） |
| EBELN / EBELP | 采购订单 / 行项目 |
| BANFN | 采购申请 |
| LIFNR / NAME1 | 供应商 / 供应商名称 |
| TXZ01 | 短文本 |

> 生产订单只回 AUFNR/PLNBEZ/MAKTX/BMEINS 四个字段，采购类字段为空属正常（2026-10 实测）。
> 函数为**单条查询**（非批量表），`order_mat_check.py` 内置逐条循环 + 0.1s 节流 + 3 次重试。

**权限**：RFC 通讯用户需对该函数所在函数组有 S_RFC 执行权限（复用 PO-Closing 的 WEAVER 账号，已验证可用）。

## 2. 设备侧部署（Ubuntu，与 PO-Closing 同机复用 SDK）

SDK 已装在 `/usr/local/sap/nwrfcsdk`（ldconfig 已注册），无需重装。CTMS 后端在 `/opt/ctms`：

```bash
# 1. 独立 venv + pyrfc（钉死 3.3.1：PyRFC 已归档，全版本 yanked，必须精确指定版本）
sudo python3 -m venv /opt/ctms/venv
sudo /opt/ctms/venv/bin/pip install -q --upgrade pip
. /etc/profile.d/nwrfcsdk.sh   # SAPNWRFC_HOME，编译时需要
sudo -E /opt/ctms/venv/bin/pip install pyrfc==3.3.1
sudo /opt/ctms/venv/bin/python -c "from pyrfc import Connection; print('pyrfc OK')"

# 2. SAP 连接参数（复用 PO-Closing 的同一份 .env；600 root，脚本 Python 直读不经 shell）
sudo cp /var/www/lnsc-apps/apps/po-closing/.env /opt/ctms/.env
sudo chmod 600 /opt/ctms/.env

# 3. 告诉后端用哪个 python 调 RFC 脚本
sudo mkdir -p /etc/systemd/system/ctms.service.d
sudo tee /etc/systemd/system/ctms.service.d/rfc.conf << 'EOF'
[Service]
Environment=CTMS_RFC_PYTHON=/opt/ctms/venv/bin/python
EOF
sudo systemctl daemon-reload && sudo systemctl restart ctms
```

## 3. 验证

```bash
# 连通性冒烟（链路 + 账号 + 权限）：
cd /opt/ctms && sudo venv/bin/python rfc/rfc_smoke_test.py Z_OA_GET_ORDERMAT_ORDERNR I_ORDERNO=1352095

# 命令行批量查询：
printf '1352095\n1354665\n1353284\n' | sudo tee orders.csv >/dev/null
sudo venv/bin/python rfc/order_mat_check.py orders.csv result.csv && cat result.csv

# Web API 端到端：
curl -X POST http://127.0.0.1:3001/api/order-material \
  -H 'Content-Type: application/json' -d '{"orders":["1352095","1354665","1353284"]}'
```

**参数名拿不准时**：本系统 `RFC_FUNCTION_DESCRIBE` 被禁（FU_NOT_FOUND），用
`sudo venv/bin/python rfc/rfc_fm_params.py <函数名>`（走 FUPARAREF 元数据 + 候选名试调）。

## 4. Web API

`POST /api/order-material`，body `{"orders":["1352095", ...]}`（纯数字，≤500 个/次，自动去重）。
返回 `{ ok:true, source:"rfc", count, rows:[{AUFNR,PLNBEZ,MAKTX,BMEINS,EBELN,EBELP,BANFN,LIFNR,NAME1,TXZ01,FOUND,ERROR}] }`；
`FOUND=""` 且 `ERROR=""` = 查无此单。环境变量：`CTMS_RFC_PYTHON` / `CTMS_RFC_SCRIPT` / `CTMS_RFC_TIMEOUT_MS` / `CTMS_RFC_MAX_ORDERS`。

## 5. 安全

- `.env`（SAP 凭据）与 `rfc/`、`venv/` 目录已在 `server.js` 静态服务中整目录 403 拦截
- `.env` 保持 600 root；脚本 Python 直读不经 shell（密码含 `$` 空格 引号均安全，PO-Closing 实测踩坑后固化）

## 6. 排错对照（继承 PO-Closing 2026-08 实测记录）

| 现象 | 根因 | 处置 |
|---|---|---|
| pip 报 yanked / from versions: none | PyRFC 已归档，全版本 yanked | 精确 `pip install pyrfc==3.3.1` |
| `KeyError: SAP_RFC_PASS` | 密码含空格/`$`，shell 加载被截断 | 脚本 Python 直读 .env（已内置） |
| error during logon（无详情） | 登录语言包未装 | .env 换 SAP_LANG（EN↔ZH） |
| Name or password is incorrect | 密码错或账号锁 | 通讯账号无法 GUI 验证，以 RFC 调用为准；SU01 解锁 |
| FU_NOT_FOUND | 函数未激活 / 无权限 | 找 Basis 确认函数状态与授权 |
| rc=20 field 'XXX' not found | 导入参数名不对 | 用 rfc_fm_params.py 查真实签名 |
