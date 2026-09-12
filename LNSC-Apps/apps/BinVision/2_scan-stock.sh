#!/bin/bash
# ════════════════════════════════════════════════════════════
#  服务器端扫描：读取挂载目录中 RPA 自动生成的「物料移动频次.xlsx」，
#  解析 LGTYP(仓储区) / LGPLA(库位号) / 数量列(STOCK→AVAILABLE→COUNT) 三列，
#  生成 stock.json 到前端应用目录，所有用户共享同一份数据。
#  数据源: \\10.86.180.4\Department\LNSC-12_LD-Logistics\05_Mixed\12-M_Muti\
#          99_RPA\01_AutoJob_RPA02_06\06_DataOutput\物料移动频次.xlsx（RPA 定期更新）
#  用法: sudo bash 2_scan-stock.sh
#  首次运行会自动把自己注册到 root crontab（每 30 分钟），
#  RPA 更新文件后，最多 30 分钟网页自动更新，无需人工干预。
#  （与 Purchase search drawing 的 2_scan-drawings.sh 结构一致）
# ════════════════════════════════════════════════════════════

SRC='/var/www/lnsc-apps/binstock'                 # ← 由 1_mount-stock.sh 挂载的 RPA 数据输出目录
REPORT_NAME='物料移动频次.xlsx'                    # ← RPA 固定输出的数据文件名
APP_DIR='/var/www/lnsc-apps/apps/binvision'       # ← 前端部署目录：改成本应用实际的 ID（应用名的小写）
OUT="$APP_DIR/stock.json"

# ── 自动注册 cron（每 30 分钟），已存在则跳过 ──
SELF="$(readlink -f "$0")"
if [ "$EUID" -eq 0 ] && ! crontab -l 2>/dev/null | grep -qF "$SELF"; then
  (crontab -l 2>/dev/null; echo "*/30 * * * * /bin/bash $SELF") | crontab -
  echo "已注册 cron: */30 * * * * /bin/bash $SELF"
fi

if [ ! -d "$SRC" ] || ! mountpoint -q "$SRC"; then
  echo "ERROR: $SRC 未挂载，请先运行 1_mount-stock.sh" >&2
  exit 1
fi

# 部署目录不存在则预创建（前端上传应用时会写入同一目录）
if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
  echo "部署目录 $APP_DIR 不存在，已预创建（等待前端上传应用）"
fi
PARENT_OWNER="$(stat -c '%U:%G' "$(dirname "$APP_DIR")")"
chown "$PARENT_OWNER" "$APP_DIR"
chmod 775 "$APP_DIR"

# 优先取 RPA 固定输出的文件；文件缺失时回退为目录中最新的报告文件
if [ -f "$SRC/$REPORT_NAME" ]; then
  NEWEST="$SRC/$REPORT_NAME"
else
  echo "WARNING: 未找到 $REPORT_NAME，回退为目录中最新报告文件" >&2
  NEWEST=$(find "$SRC" -type f \( -iname '*.xls' -o -iname '*.xlsx' -o -iname '*.csv' -o -iname '*.txt' \) ! -iname '~$*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
fi

if [ -z "$NEWEST" ]; then
  echo "WARNING: $SRC 中未找到数据文件，保留现有 stock.json" >&2
  exit 0
fi

echo "数据源: $NEWEST"

SRC_FILE="$NEWEST" OUT_FILE="$OUT" python3 - <<'PYEOF'
import sys, os, json, csv, io, zipfile
from datetime import datetime
from xml.etree import ElementTree

src = os.environ["SRC_FILE"]
out = os.environ["OUT_FILE"]
ext = os.path.splitext(src)[1].lower()

def rows_from_csv(path):
    # 支持 逗号/制表符/分号 分隔；编码自动尝试 utf-8-sig / utf-8 / gbk / utf-16
    raw = open(path, "rb").read()
    encs = ("utf-16",) if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff") \
           else ("utf-8-sig", "utf-8", "gbk", "utf-16")
    text = None
    for enc in encs:
        try:
            text = raw.decode(enc)
            break
        except Exception:
            pass
    if text is None:
        raise RuntimeError("无法识别文件编码")
    head = text.lstrip("\ufeff").splitlines()[:5]
    delim, best = ",", 0
    for d in (",", "\t", ";"):
        n = max((len(l.split(d)) for l in head), default=0)
        if n > best:
            best, delim = n, d
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim)]

def rows_from_xlsx(path):
    # 优先 openpyxl；未安装则用标准库解析（xlsx = zip + xml）
    try:
        import openpyxl
        ws = openpyxl.load_workbook(path, data_only=True, read_only=True).active
        return [list(row) for row in ws.iter_rows(values_only=True)]
    except ImportError:
        pass
    NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
        sheet = "xl/worksheets/sheet1.xml"
        if sheet not in names:
            sheet = next(n for n in sorted(names)
                         if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        root = ElementTree.fromstring(z.read(sheet))
        rows = []
        for row in root.iter(NS + "row"):
            vals = []
            for c in row.iter(NS + "c"):
                t = c.get("t")
                if t == "s":
                    v = c.find(NS + "v")
                    vals.append(shared[int(v.text)] if v is not None and v.text else "")
                elif t == "inlineStr":
                    is_el = c.find(NS + "is")
                    vals.append("".join(x.text or "" for x in is_el.iter(NS + "t")) if is_el is not None else "")
                else:
                    v = c.find(NS + "v")
                    vals.append(v.text if v is not None and v.text else "")
            rows.append(vals)
        return rows

def rows_from_xls(path):
    try:
        import xlrd
    except ImportError:
        raise RuntimeError(".xls(Excel 97-2003) 需要 python3-xlrd：sudo apt-get install -y python3-xlrd；或改导出 .xlsx/.csv")
    wb = xlrd.open_workbook(path)
    ws = wb.sheet_by_index(0)
    return [[ws.cell_value(r, c) for c in range(ws.ncols)] for r in range(ws.nrows)]

if ext in (".csv", ".txt"):
    rows = rows_from_csv(src)
elif ext == ".xlsx":
    rows = rows_from_xlsx(src)
elif ext == ".xls":
    rows = rows_from_xls(src)
else:
    raise RuntimeError("不支持的文件类型: %s" % src)

# 定位表头（须含 LGTYP 与 LGPLA 列；数量列按 STOCK → AVAILABLE → COUNT 优先识别）——与前端 parseAOA/parseCSV 逻辑一致
header_idx, cols = -1, None
for i in range(min(len(rows), 10)):
    c = [str(x).strip().upper() for x in rows[i]]
    if "LGTYP" in c and "LGPLA" in c:
        header_idx, cols = i, c
        break
if header_idx < 0:
    raise RuntimeError("未找到表头，报告须包含 LGTYP 和 LGPLA 列")
i_type, i_bin = cols.index("LGTYP"), cols.index("LGPLA")
i_stock = -1
for cand in ("STOCK", "AVAILABLE", "COUNT"):
    if cand in cols:
        i_stock = cols.index(cand)
        break

out_rows = []
for row in rows[header_idx + 1:]:
    if len(row) <= max(i_type, i_bin):
        continue
    zone = str(row[i_type] if row[i_type] is not None else "").strip()
    bin_ = str(row[i_bin] if row[i_bin] is not None else "").strip()
    if not zone or not bin_:
        continue
    stock = 0.0
    if i_stock >= 0 and row[i_stock] not in (None, ""):
        try:
            stock = float(str(row[i_stock]).replace(",", ""))
        except ValueError:
            stock = 0.0
    out_rows.append([zone, bin_, stock])

if not out_rows:
    raise RuntimeError("未解析到数据行")

payload = {
    "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
    "file": os.path.basename(src),
    "rows": out_rows,
}
tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
os.replace(tmp, out)
print("Done. %d rows from %s -> %s" % (len(out_rows), os.path.basename(src), out))
PYEOF

if [ $? -ne 0 ]; then
  echo "ERROR: 报告解析失败，保留现有 stock.json 不变" >&2
  exit 1
fi

chmod 644 "$OUT"
COUNT=$(python3 -c "import json; print(len(json.load(open('$OUT'))['rows']))")
echo "Done. $COUNT stock rows indexed -> $OUT"
