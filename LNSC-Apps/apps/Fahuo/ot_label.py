#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""专车/自提 厂内面单 PDF 渲染（2026-09-21 用户反馈：HTML 打印屡次乱版/乱码，弃用浏览器打印）

方案：
- 服务端 Pillow 绘制 300dpi 位图（1181×1772 = 100×150mm），1 位色存储 → PDF 页尺寸恒等于纸张，
  走与顺丰/德邦官方面单相同的 iframe PDF 打印链路，不依赖 Chrome HTML 打印的任何行为。
- 中文字体：shared/fonts/simhei.ttf（随包部署；如需换 Noto Sans SC 直接替换该文件即可）。
- 条码/二维码 PNG 由浏览器用已验证前端库（JsBarcode/qrcode-generator）画好随 POST 上传
  （服务端无 symbology 库，也不重复造轮子）；本模块只负责文字/线条/拼图。

渲染坐标系 = 预览 px（宽 287）× 缩放 S=1181/287，与 HTML 预览版式一一对应。
"""
import base64
import io
import json
import os
import re
import threading
import time

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = os.path.join(BASE, "shared", "fonts", "simhei.ttf")

W, H = 1181, 1772                 # 100×150mm @ 300dpi
S = W / 287.0                     # 预览 px → 300dpi px

_fonts = {}


def _f(px):
    """预览 px 字号 → 300dpi ImageFont（SimHei 单字重；粗体用 stroke_width 仿粗）"""
    key = int(round(px * S))
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FONT_PATH, key)
    return _fonts[key]


def _png_from_data_url(data_url):
    """data:image/png;base64,... / 裸 base64 → PIL 图（白底 RGB）"""
    if not data_url:
        return None
    b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
    raw = base64.b64decode(re.sub(r"\s", "", b64))
    im = Image.open(io.BytesIO(raw))
    rgba = im.convert("RGBA")
    bg = Image.new("RGB", rgba.size, "#ffffff")
    bg.paste(rgba, mask=rgba.split()[-1])
    return bg


# ---------------- 渲染缓存（POST 渲染 → GET raw 供 iframe 显示/打印） ----------------
_CACHE = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 600                  # 10 分钟


def cache_put(key, pdf_bytes):
    with _CACHE_LOCK:
        now = time.time()
        for k in [k for k, (_, ts) in _CACHE.items() if now - ts > _CACHE_TTL]:
            del _CACHE[k]
        _CACHE[key] = (pdf_bytes, now)


def cache_get(key):
    with _CACHE_LOCK:
        item = _CACHE.get(key)
        return item[0] if item else None


# ---------------- 文字工具 ----------------
def _wrap(draw, text, font, max_w):
    """按像素宽折行（中文逐字），最多 2 行，超出省略号"""
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=font) <= max_w:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
            if len(lines) == 2:
                break
    if cur and len(lines) < 2:
        lines.append(cur)
    if len(lines) == 2:
        t = lines[1]
        while t and draw.textlength(t + "…", font=font) > max_w:
            t = t[:-1]
        lines[1] = t + "…"
    return [l for l in lines if l]


def _settings(order):
    try:
        return (json.loads(order.get("order_resp") or "{}")).get("settings") or {}
    except Exception:
        return {}



def render_pdf(order, bar_png="", qr_png=""):
    """order = row_to_json dict；bar/qr_png = 浏览器 canvas dataURL；返回 PDF bytes"""
    st = _settings(order)
    carrier = order.get("carrier") or "专车"
    no = re.sub(r"\s", "", order.get("waybill_no") or "")
    no_spaced = (no[:2] + " " + no[2:6] + " " + no[6:10] + " " + no[10:]) if len(no) == 12 else no
    no_type = "自提号" if carrier == "自提" else "专车号"
    product = st.get("product") or "整车直送"
    pay = st.get("pay") or "寄付月结"
    cargo = st.get("cargo") or "--"
    parcels = st.get("parcels") or "1"
    qty = st.get("qty") or "1"
    ship = order.get("ship_date") or time.strftime("%Y-%m-%d")
    name = order.get("name") or "---"
    phone = order.get("phone") or ""
    addr = order.get("address") or ""
    company = order.get("company") or "--"
    pv = re.sub(r"(壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$", "", order.get("province") or "")
    ct = re.sub(r"市$", "", order.get("city") or "")
    dest = (pv if pv == ct else pv + "-" + ct) if (pv or ct) else "--"
    dn = order.get("so") or "--------"
    so_no = order.get("so_no") or "--"
    note = order.get("note") or ""

    img = Image.new("RGB", (W, H), "#ffffff")
    dr = ImageDraw.Draw(img)
    X = lambda px: int(round(px * S))                     # noqa: E731
    Lp, Rp = 12, 275                                      # 内容左右缘（预览 px）
    CW = X(Rp - Lp)
    BLACK = (0, 0, 0)
    BOLD_W = max(1, int(S * 0.35))                        # 仿粗描边宽

    def hline(y, w=1, x1=None):
        dr.rectangle([0, X(y), W if x1 is None else X(x1), X(y) + X(w) - 1],
                     fill=BLACK)

    def text(x, y, s, size, bold=False):
        dr.text((X(x), X(y)), s, font=_f(size), fill=BLACK,
                stroke_width=(BOLD_W if bold else 0), stroke_fill=BLACK)

    def text_right(y, s, size, bold=False):
        f = _f(size)
        w = dr.textlength(s, font=f)
        dr.text((X(Rp) - w, X(y)), s, font=f, fill=BLACK,
                stroke_width=(BOLD_W if bold else 0), stroke_fill=BLACK)

    # ① 头部：公司 + 车型 -------------------------------------------- 0..42
    ttl = "莱克勒喷嘴系统（常州）有限公司"
    # 车型：32 调小至 22 并加矩形外框（2026-09-23 用户要求）；框贴右缘、头部带内垂直居中
    fcar = _f(22)
    bbw = dr.textlength(carrier, font=fcar)
    bb = dr.textbbox((0, 0), carrier, font=fcar)
    th = bb[3] - bb[1]
    padx = X(5)
    bx1, by0, by1 = X(Rp), X(6), X(38)
    bx0 = int(bx1 - bbw - BOLD_W - 2 * padx)
    tsz = 13                                                  # 标题字号自适应：避免压右侧车型外框
    while tsz > 9 and X(14) + dr.textlength(ttl, font=_f(tsz)) + BOLD_W > bx0 - X(4):
        tsz -= 1
    text(14, 12, ttl, tsz, bold=True)                       # 头部整体下移居中（2026-09-23 间距均衡）
    dr.rectangle([bx0, by0, bx1, by1], outline=BLACK, width=max(2, X(1)))
    dr.text((bx0 + padx - bb[0], by0 + ((by1 - by0) - th) / 2 - bb[1]),
            carrier, font=fcar, fill=BLACK, stroke_width=BOLD_W, stroke_fill=BLACK)
    hline(42, 2)

    # ② 条码区（2026-09-23 用户样图）：条码条自顶线垂下；编号嵌于条码底部中央白缺口，
    #    缺口内条码截断、两侧保持全高 43..103
    bar = _png_from_data_url(bar_png)
    if bar is not None:
        bar = bar.resize((CW, X(44)), Image.NEAREST)
        img.paste(bar, (X(12), X(43)))             # 紧贴 hline(42) 下缘垂下（高度调低 2026-09-23）
    fno = _f(20)                                   # 编号加粗加大，嵌入白缺口
    wno = dr.textlength(no_spaced, font=fno)
    cx = X(12) + CW / 2
    dr.rectangle([cx - wno / 2 - X(3), X(76), cx + wno / 2 + X(3), X(87)],
                 fill=(255, 255, 255))             # 底部中央白缺口（截断中间条码）
    dr.text((cx - wno / 2, X(78)), no_spaced, font=fno, fill=BLACK,
            stroke_width=BOLD_W, stroke_fill=BLACK)
    hline(103, 1)

    def legend(y, s, dark=False, x1=None):
        """分节图例：圆角小盒悬挂在分隔线下方（盒顶压线约3mm、主体垂在线下，
        参照用户 2026-09-22 提供样图；寄=黑底白字，其余白底黑框）
        x1：横线右终点（预览 px）；None=通栏。用于横线避让右侧竖列"""
        f = _f(10)
        pad_x, h = X(6), X(16)
        w = int(dr.textlength(s, font=f)) + 2 * pad_x
        x0, y0 = X(6), X(y) - X(3)                             # 悬挂式：盒顶略压线；再靠左突出（2026-09-23）
        hline(y, 1, x1)
        dr.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=X(4),
                             fill=(BLACK if dark else (255, 255, 255)),
                             outline=BLACK, width=max(2, X(1)))
        dr.text((x0 + pad_x, y0 + (h - X(10)) // 2 - X(1)), s, font=f,
                fill=((255, 255, 255) if dark else BLACK))

    # ③ 时效 + 目的地（2026-09-23 应用户要求：移除「要求时效」图例标题，保留分隔线与内容） 104..146
    hline(103, 1)
    text(30, 117, product, 16, bold=True)          # 内容缩进，图例圆框左突（2026-09-22）；带内垂直居中（2026-09-23）
    text_right(114, dest, 22, bold=True)
    hline(146, 1)

    # ④ 收方 + 二维码（图例「收」；姓名+电话同一行；收件信息再调小一档 2026-09-22） 147..250
    legend(146, "收")
    y = 159
    fn16, f14 = _f(13), _f(11)
    dr.text((X(30), X(y)), name, font=fn16, fill=BLACK,
            stroke_width=BOLD_W, stroke_fill=BLACK)
    wnm = dr.textlength(name, font=fn16) + BOLD_W
    dr.text((X(30) + wnm + X(6), X(y + 1)), phone, font=f14, fill=BLACK)
    y += 20
    f13 = _f(11)
    for ln in _wrap(dr, addr, f13, CW - X(92)):
        dr.text((X(30), X(y)), ln, font=f13, fill=BLACK); y += 15
    s_dest = "目的地公司：" + company
    f11 = _f(11)
    lim = X(Rp - 70 - 30) if y < 222 else X(Rp - 30)          # 与二维码同高时限宽到二维码左缘
    if dr.textlength(s_dest, font=f11) > lim:
        while len(s_dest) > 1 and dr.textlength(s_dest + "…", font=f11) > lim:
            s_dest = s_dest[:-1]
        s_dest += "…"
    text(30, y, s_dest, 11); y += 15
    text(30, y, "运费：" + pay, 11)
    qr = _png_from_data_url(qr_png)
    if qr is not None:
        qr = qr.resize((X(64), X(64)), Image.NEAREST)
        img.paste(qr, (X(Rp - 66), X(156)))                   # 右列下移居中，与左侧文字列平衡（2026-09-23）
        fq = _f(9)
        wq = dr.textlength("扫码追踪", font=fq)
        dr.text((X(Rp - 66) + (X(64) - wq) / 2, X(223)), "扫码追踪", font=fq, fill=BLACK)
    hline(250, 1)

    # ⑤ 寄方：3 行（物流部/公司/地址；图例「寄」黑底白字；字号降档行距加大） 251..317
    legend(250, "寄", dark=True)
    text(30, 266, "物流部　0519 6822-8088", 13, bold=True)   # 避开悬挂盒；三行统一 16px 行距（2026-09-23 间距均衡）
    text(30, 282, "莱克勒喷嘴系统（常州）有限公司", 11)
    text(30, 298, "江苏省常州市金坛区德城路99号", 11)
    hline(317, 1)

    # ⑥⑦ 明细+手写栏（图例「司机」骑线；右侧「车牌号」跨行竖列；
    #     行内"托寄物："/"司机"前缀随图例移除；「托寄物」标题移除 2026-09-23） 318..430
    hline(317, 1)                                            # 2026-09-23 应用户要求：移除「托寄物」图例标题，保留分隔线
    col_x = Rp - 24                                          # 右列左缘（列宽 24px）
    dr.rectangle([X(col_x), X(318), X(col_x) + 1, X(430)], fill=BLACK)   # 垂直分隔线（跨行）
    LW = X(col_x - 30 - 4)                                   # 左区文字可用宽（含缩进）
    y = 326                                                  # 托寄物行（图例移除后上移；13px 粗体）
    dr.text((X(30), X(y)), cargo, font=_f(13), fill=BLACK,
            stroke_width=max(1, int(S * 0.3)), stroke_fill=BLACK)
    y = 346                                                  # 明细三行统一 15px 行距（图例移除后上移，为司机行让高）
    f12 = _f(12)                                             # ⑥明细字号独立（不受④收件区调小影响）
    dr.text((X(30), X(y)), "DN：", font=f12, fill=BLACK)
    wdn = dr.textlength("DN：", font=f12)
    dr.text((X(30) + wdn, X(y)), dn, font=f12, fill=BLACK,
            stroke_width=max(1, int(S * 0.3)), stroke_fill=BLACK)
    wv = dr.textlength(dn, font=f12) + BOLD_W
    dr.text((X(30) + wdn + wv + X(4), X(y)), "SO：" + so_no, font=f12, fill=BLACK)
    y += 15
    text(30, y, "件数 / 数量：%s件 / %spcs" % (parcels, qty), 12); y += 15
    note_lns = _wrap(dr, "备注：" + note, f12, LW)[:1]       # 备注限 1 行
    for ln in note_lns:
        dr.text((X(30), X(y)), ln, font=f12, fill=BLACK)

    legend(394, "司机", x1=col_x)   # 司机行加高：分隔线上移 8px（394..430=36px≈12.6mm）；横线止于车牌号列左缘（2026-09-23）
    # 姓名+电话一行（带内垂直居中；图例已表"司机"，行内从简）
    # 2026-09-23 应用户要求右移：两字段在司机带内容区（30..col_x）水平居中，不再贴左缘
    f11d = _f(11)
    lab_n, lab_t = "姓名：", "电话："
    ul_n, ul_t = X(52), X(88)                              # 下划线加长（姓名约4字 / 电话11位手写；2026-09-23 应用户要求；右端与车牌号列留 ~3mm）
    w_ln, w_lt = dr.textlength(lab_n, font=f11d), dr.textlength(lab_t, font=f11d)
    x0 = X(30) + (X(col_x - 30) - (w_ln + ul_n + X(10) + w_lt + ul_t)) / 2
    # 下划线改用绘制线段并贴字形底边：下划线字符挂基线下方，视觉上掉行（2026-09-23 修复）
    yu = X(407) + f11d.getbbox(lab_n)[3] - max(1, int(S * 0.3))
    dr.text((x0, X(407)), lab_n, font=f11d, fill=BLACK)
    dr.line([(x0 + w_ln, yu), (x0 + w_ln + ul_n, yu)], fill=BLACK, width=max(1, X(1)))
    xt = x0 + w_ln + ul_n + X(8)
    dr.text((xt, X(407)), lab_t, font=f11d, fill=BLACK)
    dr.line([(xt + w_lt, yu), (xt + w_lt + ul_t, yu)], fill=BLACK, width=max(1, X(1)))

    # 右列：车牌号竖排（旋转 90° 自上而下读）；2026-09-23 应用户要求：加粗 + 靠上显示
    #   （水平：col_x..纸右缘 居中；垂直：贴列顶 318 下方 ~4px，不再垂直居中）
    fv = _f(12)
    tw = int(dr.textlength("车牌号", font=fv)) + X(2)
    bbv = fv.getbbox("车牌号")
    sh = (bbv[3] - bbv[1]) + 2 * BOLD_W + X(2)          # 条带高=字高+仿粗描边余量
    strip = Image.new("RGB", (tw, sh), "#ffffff")
    ImageDraw.Draw(strip).text((X(1) - bbv[0], BOLD_W + X(1) - bbv[1]), "车牌号",
                               font=fv, fill=BLACK, stroke_width=BOLD_W, stroke_fill=BLACK)
    rot = strip.rotate(-90, expand=True)
    img.paste(rot, (int((X(col_x) + W) / 2 - rot.width / 2),
                    int(X(322))))

    # 调试：OT_DEBUG_PNG=/path/x.png 时另存位图预览（生产不设该环境变量）
    import os as _os
    _dbg = _os.environ.get("OT_DEBUG_PNG")
    if _dbg:
        img.convert("RGB").save(_dbg)

    # 1 位色（热敏打印更清晰、文件更小）→ PDF（页尺寸恒 100×150mm）
    out = io.BytesIO()
    img.convert("1").save(out, "PDF", resolution=300.0)
    return out.getvalue()
