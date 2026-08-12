*"=====================================================================
*" 函数模块 : Z_RFC_PO_GR_STATUS
*" 函数组   : ZPOCLOSE               (SE80 创建)
*" 属性     : 处理类型 = 远程启用模块 (RFC-enabled)
*" 用途     : 批量输入 PO 号，输出行项目级净收货数与关单建议
*" 调用方   : 独立 Ubuntu 设备 pyrfc 脚本 (po_gr_check.py)，每批 <=5000
*" 依赖 DDIC: 结构 ZS_PO_IN / ZS_PO_GR_STATUS
*"            表类型 ZTT_PO_IN / ZTT_PO_GR_STATUS
*"            (字段定义见同目录 README.md 第 1 节，需先在 SE11 创建并激活)
*" SAP_BASIS: 7.40+ (EHP7/EHP8/S4)；EHP6 需改写内联声明与字符串模板
*"=====================================================================
FUNCTION z_rfc_po_gr_status.
*"----------------------------------------------------------------------
*"*"本地接口:
*"  TABLES
*"      IT_EBELN  TYPE  ZTT_PO_IN
*"      ET_RESULT TYPE  ZTT_PO_GR_STATUS
*"      ET_RETURN TYPE  BAPIRET2_TAB
*"----------------------------------------------------------------------

  TYPES: BEGIN OF ty_ekpo,
           ebeln TYPE ekpo-ebeln,
           ebelp TYPE ekpo-ebelp,
           matnr TYPE ekpo-matnr,
           werks TYPE ekpo-werks,
           retpo TYPE ekpo-retpo,
           menge TYPE ekpo-menge,
           meins TYPE ekpo-meins,
           untto TYPE ekpo-untto,
           uebto TYPE ekpo-uebto,
           elikz TYPE ekpo-elikz,
           erekz TYPE ekpo-erekz,
           loekz TYPE ekpo-loekz,
         END OF ty_ekpo,
         BEGIN OF ty_ekbe,
           ebeln TYPE ekbe-ebeln,
           ebelp TYPE ekbe-ebelp,
           shkzg TYPE ekbe-shkzg,
           bwart TYPE ekbe-bwart,
           menge TYPE ekbe-menge,
         END OF ty_ekbe,
         BEGIN OF ty_gr,
           ebeln TYPE ekbe-ebeln,
           ebelp TYPE ekbe-ebelp,
           net   TYPE ekbe-menge,
         END OF ty_gr.

  DATA: lt_ebeln TYPE STANDARD TABLE OF zs_po_in,
        lt_ekpo  TYPE HASHED TABLE OF ty_ekpo WITH UNIQUE KEY ebeln ebelp,
        lt_ekbe  TYPE STANDARD TABLE OF ty_ekbe,
        lt_gr    TYPE HASHED TABLE OF ty_gr  WITH UNIQUE KEY ebeln ebelp.

  DATA: ls_out    TYPE zs_po_gr_status,
        ls_return TYPE bapiret2,
        lv_net    TYPE ekbe-menge,
        lv_limit  TYPE ekpo-menge.

  FIELD-SYMBOLS: <ekpo> TYPE ty_ekpo,
                 <gr>   TYPE ty_gr.

*-- 0. 输入整理：去重；空输入直接返回，防止 FOR ALL ENTRIES 退化为全表扫描
  lt_ebeln = it_ebeln.
  SORT lt_ebeln BY ebeln.
  DELETE ADJACENT DUPLICATES FROM lt_ebeln COMPARING ebeln.
  IF lt_ebeln IS INITIAL.
    RETURN.
  ENDIF.

*-- 1. PO 行项目
  SELECT ebeln ebelp matnr werks retpo menge meins untto uebto elikz erekz loekz
    INTO TABLE @lt_ekpo
    FROM ekpo
    FOR ALL ENTRIES IN @lt_ebeln
    WHERE ebeln = @lt_ebeln-ebeln.

*-- 2. 收货历史聚合（净收货 = S - H）
  IF lt_ekpo IS NOT INITIAL.
    SELECT ebeln ebelp shkzg bwart menge
      INTO TABLE @lt_ekbe
      FROM ekbe
      FOR ALL ENTRIES IN @lt_ekpo
      WHERE ebeln = @lt_ekpo-ebeln
        AND ebelp = @lt_ekpo-ebelp
        AND bewtp = 'E'                     " 仅收货
        AND bwart NOT IN ('103','104').     " 冻结库存收货/冲销剔除，避免与 105 双计

    LOOP AT lt_ekbe INTO DATA(ls_ekbe).
      READ TABLE lt_gr ASSIGNING <gr> WITH TABLE KEY ebeln = ls_ekbe-ebeln
                                                      ebelp = ls_ekbe-ebelp.
      IF sy-subrc <> 0.
        INSERT VALUE ty_gr( ebeln = ls_ekbe-ebeln ebelp = ls_ekbe-ebelp )
          INTO TABLE lt_gr ASSIGNING <gr>.
      ENDIF.
      IF ls_ekbe-shkzg = 'S'.
        <gr>-net = <gr>-net + ls_ekbe-menge.          " 101/105 等收货 +
      ELSE.
        <gr>-net = <gr>-net - ls_ekbe-menge.          " 102/122 等冲销退货 -
      ENDIF.
    ENDLOOP.
  ENDIF.

*-- 3. 行项目级输出
  LOOP AT lt_ekpo ASSIGNING <ekpo>.
    CLEAR ls_out.
    ls_out-ebeln     = <ekpo>-ebeln.
    ls_out-ebelp     = <ekpo>-ebelp.
    ls_out-matnr     = <ekpo>-matnr.
    ls_out-werks     = <ekpo>-werks.
    ls_out-retpo     = <ekpo>-retpo.
    ls_out-order_qty = <ekpo>-menge.
    ls_out-meins     = <ekpo>-meins.
    ls_out-untto     = <ekpo>-untto.
    ls_out-uebto     = <ekpo>-uebto.
    ls_out-elikz     = <ekpo>-elikz.
    ls_out-erekz     = <ekpo>-erekz.
    ls_out-loekz     = <ekpo>-loekz.

    READ TABLE lt_gr ASSIGNING <gr> WITH TABLE KEY ebeln = <ekpo>-ebeln
                                                    ebelp = <ekpo>-ebelp.
    IF sy-subrc = 0.
      lv_net = <gr>-net.
    ELSE.
      lv_net = 0.
    ENDIF.
    " 注意：退货 PO（RETPO='X'，收货移动类型 161）的符号方向需用真实数据
    " 验证；若实测净值为负，取消下一行注释：
    " IF <ekpo>-retpo = 'X'. lv_net = lv_net * -1. ENDIF.

    ls_out-net_gr_qty = lv_net.
    ls_out-diff_qty   = <ekpo>-menge - lv_net.

    " 关单判定：净收货 >= 订单数 × (1 - 交货不足容差%)
    " UNTTO 为空(0) 表示不允许交货不足，即须足额
    lv_limit = <ekpo>-menge * ( 100 - <ekpo>-untto ) / 100.
    IF lv_net >= lv_limit.
      ls_out-can_close = 'X'.
    ENDIF.

    IF <ekpo>-loekz IS NOT INITIAL.
      ls_out-suggest = 'DELETED'.
    ELSEIF <ekpo>-elikz = 'X'.
      ls_out-suggest = 'ALREADY_CLOSED'.
    ELSEIF lv_net <= 0.
      ls_out-suggest = 'NO_GR'.
    ELSEIF ls_out-can_close = 'X'.
      ls_out-suggest = 'CLOSABLE'.
    ELSE.
      ls_out-suggest = 'PARTIAL_GR'.
    ENDIF.
    APPEND ls_out TO et_result.
  ENDLOOP.

*-- 4. 输入中未找到的 PO 反馈
  LOOP AT lt_ebeln INTO DATA(ls_in).
    READ TABLE lt_ekpo TRANSPORTING NO FIELDS WITH KEY ebeln = ls_in-ebeln.
    IF sy-subrc <> 0.
      CLEAR ls_return.
      ls_return-type       = 'W'.
      ls_return-id         = 'ZPOCLOSE'.
      ls_return-number     = '001'.
      ls_return-message_v1 = ls_in-ebeln.
      ls_return-message    = |PO { ls_in-ebeln } 不存在或无行项目|.
      APPEND ls_return TO et_return.
    ENDIF.
  ENDLOOP.

ENDFUNCTION.
