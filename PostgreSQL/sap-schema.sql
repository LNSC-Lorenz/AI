-- =============================================================
-- SAP 1v1 Test Schema - PostgreSQL
-- Database: appdb
-- Schema:   sap_test
-- Created:  2026-06-17
-- =============================================================

-- Create dedicated schema for SAP test data
CREATE SCHEMA IF NOT EXISTS sap_test;
GRANT USAGE ON SCHEMA sap_test TO sapwriter;
GRANT USAGE ON SCHEMA sap_test TO airead;
ALTER DEFAULT PRIVILEGES IN SCHEMA sap_test
    GRANT INSERT, UPDATE ON TABLES TO sapwriter;
ALTER DEFAULT PRIVILEGES IN SCHEMA sap_test
    GRANT SELECT ON TABLES TO airead;

-- =============================================================
-- 1. FAGLL03 公司月度应收账款 ACDOCA (完整字段)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    rldnr        VARCHAR(2),               -- 账本
    rbukrs       VARCHAR(4),               -- 公司代码
    gjahr        VARCHAR(4),               -- 财年
    belnr        VARCHAR(10),              -- 凭证号
    docln        VARCHAR(6),               -- 行项目
    ryear        VARCHAR(4),               -- 参考年度
    aworg        VARCHAR(10),              -- 参考组织单元
    awref        VARCHAR(10),              -- 参考凭证号
    awitem       VARCHAR(3),               -- 参考凭证行
    awitgrp      VARCHAR(3),               -- 参考凭证行组
    subta        VARCHAR(3),               -- 子交易
    rtcur        VARCHAR(5),               -- 交易货币
    rwcur        VARCHAR(5),               -- 公司代码货币2
    rhcur        VARCHAR(5),               -- 本币
    rkcur        VARCHAR(5),               -- 控制范围货币
    rfccur       VARCHAR(5),               -- 集团货币
    co_meinh     VARCHAR(3),               -- CO数量单位
    racct        VARCHAR(10),              -- 总账科目
    rcntr        VARCHAR(10),              -- 成本中心
    prctr        VARCHAR(10),              -- 利润中心
    rfarea       VARCHAR(16),              -- 功能范围
    rbusa        VARCHAR(4),               -- 业务范围
    kokrs        VARCHAR(4),               -- 控制范围
    segment      VARCHAR(10),              -- 细分
    tsl          NUMERIC(23,2),            -- 交易货币金额
    wsl          NUMERIC(23,2),            -- 公司代码货币金额
    wsl2         NUMERIC(23,2),            -- 公司代码货币2金额
    wsl3         NUMERIC(23,2),            -- 公司代码货币3金额
    hsl          NUMERIC(23,2),            -- 本币金额
    ksl          NUMERIC(23,2),            -- 控制范围货币金额
    fcsl         NUMERIC(23,2),            -- 集团货币金额
    msl          NUMERIC(23,3),            -- 数量
    mfsl         NUMERIC(23,3),            -- 固定数量
    vmsl         NUMERIC(23,3),            -- 差异数量
    co_megbtr    NUMERIC(23,3),            -- CO数量
    drcrk        VARCHAR(1),               -- 借贷标识
    poper        VARCHAR(3),               -- 记账期间
    periv        VARCHAR(2),               -- 财年变式
    fiscyearper  VARCHAR(7),               -- 财年期间
    budat        DATE,                     -- 记账日期
    bldat        DATE,                     -- 凭证日期
    blart        VARCHAR(2),               -- 凭证类型
    buzei        VARCHAR(3),               -- 凭证行
    zuonr        VARCHAR(18),              -- 分配号
    bschl        VARCHAR(2),               -- 记账码
    bstat        VARCHAR(1),               -- 凭证状态
    kdauf        VARCHAR(10),              -- 销售订单
    kdpos        VARCHAR(6),               -- 销售订单行
    wwkak_pa     VARCHAR(10),
    wwkap_pa     VARCHAR(10),
    matnr        VARCHAR(18),              -- 物料号
    werks        VARCHAR(4),               -- 工厂
    lifnr        VARCHAR(10),              -- 供应商
    kunnr        VARCHAR(10),              -- 客户
    coco_num     VARCHAR(20),
    wwert        DATE,                     -- 汇率日期
    prctr_drvtn_source_type VARCHAR(3),
    ucb_id       VARCHAR(10),
    ucb_scale_numerator NUMERIC(5),
    koart        VARCHAR(1),               -- 科目类型
    umskz        VARCHAR(1),               -- 特殊总账标识
    tax_country  VARCHAR(3),               -- 税收国家
    mwskz        VARCHAR(2),               -- 税码
    kalnr        VARCHAR(12),              -- 成本估算号
    vprsv        VARCHAR(1),               -- 价格控制
    mlast        VARCHAR(1),               -- 物料账标识
    kzbws        VARCHAR(1),               -- 评估类型
    xobew        VARCHAR(1),               -- 批次评估标识
    sobkz        VARCHAR(1),               -- 特殊库存标识
    co_belkz     VARCHAR(1),               -- CO凭证标识
    co_beknz     VARCHAR(1),               -- CO凭证性质
    beltp        VARCHAR(1),               -- 凭证类别
    muvflg       VARCHAR(1),               -- MUV标识
    gkont        VARCHAR(10),              -- 对方科目
    gkoar        VARCHAR(1),               -- 对方科目类型
    erlkz        VARCHAR(1),               -- 已结标识
    pernr        VARCHAR(8),               -- 人事编号
    paobjnr      VARCHAR(10),              -- PA对象号
    prof_seg_type VARCHAR(1),
    xpaobjnr_co_rel VARCHAR(1),
    scope        VARCHAR(2),
    accas        VARCHAR(12),              -- 分配标识
    accasty      VARCHAR(1),
    lstar        VARCHAR(6),               -- 活动类型
    aufnr        VARCHAR(12),              -- 内部订单
    autyp        VARCHAR(2),               -- 订单类别
    erkrs        VARCHAR(4),               -- CO版本
    co_refbz     VARCHAR(3),
    fkart        VARCHAR(4),               -- 开票类型
    vkorg        VARCHAR(4),               -- 销售组织
    vtweg        VARCHAR(2),               -- 分销渠道
    spart        VARCHAR(2),               -- 产品组
    matnr_copa   VARCHAR(18),              -- COPA物料号
    matkl        VARCHAR(9),               -- 物料组
    kdgrp        VARCHAR(2),               -- 客户组
    land1        VARCHAR(3),               -- 国家
    brsch        VARCHAR(4),               -- 行业
    bzirk        VARCHAR(6),               -- 销售地区
    kunre        VARCHAR(10),              -- 开票方
    kunwe        VARCHAR(10),              -- 收货方
    konzs        VARCHAR(2),               -- 集团关系
    acdoc_copa_eew_dummy_pa VARCHAR(1),
    beskz_pa     VARCHAR(1),
    paph1_pa     VARCHAR(20),
    paph2_pa     VARCHAR(20),
    paph3_pa     VARCHAR(20),
    pstyv_pa     VARCHAR(4),
    vkbur_pa     VARCHAR(4),
    wwcst_pa     VARCHAR(10),
    sorhist_pa   VARCHAR(10),
    wwbkl_pa     VARCHAR(10),
    wwadm_pa     VARCHAR(10),
    wwick_pa     VARCHAR(10),
    auart_pa     VARCHAR(4),
    vbund_pa     VARCHAR(6),
    wwksp_pa     VARCHAR(10),
    wwapp_pa     VARCHAR(10),
    wwkdp_pa     VARCHAR(10),
    wwktp_pa     VARCHAR(10),
    wwsub_pa     VARCHAR(10),
    wwart_pa     VARCHAR(10),
    wwreg_pa     VARCHAR(10),
    mstae_pa     VARCHAR(2),
    dummy_mrkt_sgmnt_eew_ps VARCHAR(1)
);

-- =============================================================
-- 2. FAGLL03 公司月度应收账款 BSADyiqign
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_BSAD" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    buzei        VARCHAR(3),
    kunnr        VARCHAR(10),
    augbl        VARCHAR(10),              -- 清账凭证号
    augdt        DATE,                     -- 清账日期
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    wrbtr        NUMERIC(18,2),
    budat        DATE,
    bldat        DATE,
    shkzg        VARCHAR(1),
    zfbdt        DATE,                     -- 基准日期
    zterm        VARCHAR(4)                -- 付款条款
);

-- =============================================================
-- 3. FAGLL03 公司月度应收账款 BSID
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_BSID" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    buzei        VARCHAR(3),
    kunnr        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    wrbtr        NUMERIC(18,2),
    budat        DATE,
    bldat        DATE,
    shkzg        VARCHAR(1),
    zfbdt        DATE,
    zterm        VARCHAR(4),
    faedt        DATE                      -- 到期日
);

-- =============================================================
-- 4. FAGLL03 现金流量表
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_CASHFLOW" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    hkont        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    budat        DATE,
    bldat        DATE,
    shkzg        VARCHAR(1),
    sgtxt        VARCHAR(50),
    kostl        VARCHAR(10),              -- 成本中心
    aufnr        VARCHAR(12)               -- 订单号
);

-- =============================================================
-- 5. FAGLL03 现金流量表 BSEG
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_BSEG" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    belnr        VARCHAR(10),
    gjahr        VARCHAR(4),
    buzei        VARCHAR(3),
    hkont        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    wrbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    shkzg        VARCHAR(1),
    zuonr        VARCHAR(18),              -- 分配
    sgtxt        VARCHAR(50),
    kostl        VARCHAR(10),
    prctr        VARCHAR(10)               -- 利润中心
);

-- =============================================================
-- 6. FBL3N 进口运费占比 ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FBL3N_IMPORT_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    hkont        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    budat        DATE,
    bldat        DATE,
    shkzg        VARCHAR(1),
    ebeln        VARCHAR(10),              -- 采购订单号
    ebelp        VARCHAR(5),               -- 采购订单行
    lifnr        VARCHAR(10),              -- 供应商
    sgtxt        VARCHAR(50)
);

-- =============================================================
-- 7. FBL3N 进口运费占比 EKKO (采购订单抬头)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FBL3N_IMPORT_EKKO" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    ebeln        VARCHAR(10),              -- 采购订单号
    bukrs        VARCHAR(4),
    bsart        VARCHAR(4),               -- 订单类型
    lifnr        VARCHAR(10),              -- 供应商
    bedat        DATE,                     -- 订单日期
    ekgrp        VARCHAR(3),               -- 采购组
    waers        VARCHAR(5),
    wkurs        NUMERIC(9,5),             -- 汇率
    zterm        VARCHAR(4),
    verkf        VARCHAR(30),              -- 联系人
    inco1        VARCHAR(3),               -- 贸易条款
    inco2        VARCHAR(28)
);

-- =============================================================
-- 8. FBL3N 进口运费占比 EKPO (采购订单行项目)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FBL3N_IMPORT_EKPO" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    ebeln        VARCHAR(10),
    ebelp        VARCHAR(5),
    matnr        VARCHAR(18),              -- 物料号
    txz01        VARCHAR(40),              -- 物料描述
    menge        NUMERIC(13,3),            -- 数量
    meins        VARCHAR(3),               -- 单位
    netpr        NUMERIC(11,2),            -- 净价
    peinh        NUMERIC(5,0),             -- 价格单位
    waers        VARCHAR(5),
    werks        VARCHAR(4),               -- 工厂
    lgort        VARCHAR(4)                -- 库存地点
);

-- =============================================================
-- 9. FBL3N 销售运费占比 ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FBL3N_SALES_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    hkont        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    budat        DATE,
    bldat        DATE,
    shkzg        VARCHAR(1),
    vbeln        VARCHAR(10),              -- 销售订单号
    kunnr        VARCHAR(10),
    sgtxt        VARCHAR(50)
);

-- =============================================================
-- 10. MB51 平均采购价格 MSEG (物料凭证)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."MB51_MSEG" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    mblnr        VARCHAR(10),              -- 物料凭证号
    mjahr        VARCHAR(4),               -- 物料凭证年度
    zeile        VARCHAR(4),               -- 行项目
    bwart        VARCHAR(3),               -- 移动类型
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    lgort        VARCHAR(4),
    menge        NUMERIC(13,3),
    meins        VARCHAR(3),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    budat        DATE,
    ebeln        VARCHAR(10),
    ebelp        VARCHAR(5),
    lifnr        VARCHAR(10),
    charg        VARCHAR(10)               -- 批次
);

-- =============================================================
-- 11. 供应商付款条件 LFM1
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."LFM1_VENDOR_PAYMENT" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    lifnr        VARCHAR(10),              -- 供应商号
    ekorg        VARCHAR(4),               -- 采购组织
    zterm        VARCHAR(4),               -- 付款条款
    waers        VARCHAR(5),
    inco1        VARCHAR(3),
    inco2        VARCHAR(28),
    minbw        NUMERIC(15,2),            -- 最小订单金额
    verkf        VARCHAR(30),
    name1        VARCHAR(35),              -- 供应商名称
    land1        VARCHAR(3),               -- 国家
    ktokk        VARCHAR(4)                -- 供应商账户组
);

-- =============================================================
-- 12. 信贷科目主数据 UKMBP_CMS_SGM
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."UKMBP_CMS_SGM" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    kunnr        VARCHAR(10),              -- 客户号
    name1        VARCHAR(35),              -- 客户名称
    land1        VARCHAR(3),
    bukrs        VARCHAR(4),
    klimk        NUMERIC(15,2),            -- 信用限额
    skfor        NUMERIC(15,2),            -- 特殊总账余额
    waers        VARCHAR(5),
    ctlpc        VARCHAR(3),               -- 信用控制范围
    knkli        VARCHAR(10),              -- 信用账户
    crblb        VARCHAR(1),               -- 信用块标识
    nxtdt        DATE                      -- 下次审核日期
);

-- =============================================================
-- 13. 客户付款条件 KNVV
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."KNVV_CUSTOMER_PAYMENT" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    kunnr        VARCHAR(10),
    vkorg        VARCHAR(4),               -- 销售组织
    vtweg        VARCHAR(2),               -- 分销渠道
    spart        VARCHAR(2),               -- 产品组
    zterm        VARCHAR(4),               -- 付款条款
    waers        VARCHAR(5),
    kalks        VARCHAR(1),               -- 定价程序
    konda        VARCHAR(2),               -- 价格组
    kdgrp        VARCHAR(2),               -- 客户组
    bzirk        VARCHAR(6),               -- 销售地区
    name1        VARCHAR(35),
    land1        VARCHAR(3)
);

-- =============================================================
-- 14. 解决方案 MARA (物料主数据)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."MARA_MATERIAL" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    matnr        VARCHAR(18),              -- 物料号
    mbrsh        VARCHAR(1),               -- 行业领域
    matkl        VARCHAR(9),               -- 物料组
    meins        VARCHAR(3),               -- 基本单位
    mstae        VARCHAR(2),               -- 跨工厂物料状态
    mtpos_mara   VARCHAR(4),               -- 总体项目类别组
    brgew        NUMERIC(13,3),            -- 毛重
    ntgew        NUMERIC(13,3),            -- 净重
    gewei        VARCHAR(3),               -- 重量单位
    volum        NUMERIC(13,3),            -- 体积
    voleh        VARCHAR(3),               -- 体积单位
    mfrpn        VARCHAR(40),              -- 制造商零件号
    mfrnr        VARCHAR(10),              -- 制造商号
    attyp        VARCHAR(2),               -- 物料分类类型
    labor        VARCHAR(3),               -- 实验室/设计室
    extwg        VARCHAR(18)               -- 外部物料组
);

-- =============================================================
-- 15. AFKO 生产订单抬头 (QM内部质量)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."AFKO" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    aufnr        VARCHAR(12),              -- 生产订单号
    auart        VARCHAR(4),               -- 订单类型
    werks        VARCHAR(4),               -- 工厂
    matnr        VARCHAR(18),              -- 物料号
    plnbez       VARCHAR(18),              -- 参考物料
    dispo        VARCHAR(3),               -- MRP控制员
    ftrmi        DATE,                     -- 最终交货日期
    gstrs        DATE,                     -- 计划开始日期
    gltrs        DATE,                     -- 计划完成日期
    gstri        DATE,                     -- 实际开始日期
    getri        DATE,                     -- 实际完成日期
    gamng        NUMERIC(13,3),            -- 订单数量
    gmein        VARCHAR(3),               -- 单位
    wemng        NUMERIC(13,3),            -- 已收货数量
    rmnga        NUMERIC(13,3),            -- 已确认数量
    igmng        NUMERIC(13,3),            -- 已发货数量
    bukrs        VARCHAR(4)
);

-- =============================================================
-- 16. AFVC 生产订单工序 (QM内部质量)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."AFVC" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    aufpl        VARCHAR(10),              -- 工艺路线号
    aplzl        VARCHAR(8),               -- 工序计数器
    aufnr        VARCHAR(12),              -- 生产订单号
    vornr        VARCHAR(4),               -- 工序号
    ltxa1        VARCHAR(40),              -- 工序描述
    werks        VARCHAR(4),
    arbid        VARCHAR(8),               -- 工作中心内部ID
    arbpl        VARCHAR(8),               -- 工作中心
    larnt        VARCHAR(2),               -- 活动类型
    bmsch        NUMERIC(13,3),            -- 基本数量
    meinh        VARCHAR(3),
    isdd         DATE,                     -- 计划开始日期
    iedd         DATE                      -- 计划完成日期
);

-- =============================================================
-- 17. CRHD 工作中心主数据 (QM内部质量)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."CRHD" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    objid        VARCHAR(8),               -- 工作中心内部ID
    werks        VARCHAR(4),
    arbpl        VARCHAR(8),               -- 工作中心
    verwe        VARCHAR(3),               -- 工作中心类别
    begda        DATE,                     -- 有效开始日期
    endda        DATE,                     -- 有效结束日期
    ktext        VARCHAR(40)               -- 工作中心描述
);

-- =============================================================
-- 18. CO-PA 业务盈利 ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."COPA_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    prctr        VARCHAR(10),
    kokrs        VARCHAR(4),
    kunnr        VARCHAR(10),
    matnr        VARCHAR(18),
    vkorg        VARCHAR(4),
    vtweg        VARCHAR(2),
    spart        VARCHAR(2),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    hwaer        VARCHAR(5)
);

-- =============================================================
-- 16. FAGLL03 息税前利润 EBIT/EBT ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_EBIT_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    buzei        VARCHAR(3),
    hkont        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    shkzg        VARCHAR(1),
    waers        VARCHAR(5),
    budat        DATE,
    bldat        DATE
);

-- =============================================================
-- 17. FAGLL03 毛利率 Gross Margin ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."FAGLL03_GM_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    belnr        VARCHAR(10),
    buzei        VARCHAR(3),
    hkont        VARCHAR(10),
    matnr        VARCHAR(18),
    dmbtr        NUMERIC(18,2),
    shkzg        VARCHAR(1),
    waers        VARCHAR(5),
    budat        DATE
);

-- =============================================================
-- 18. MB5L 公司库存周转天数 ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."MB5L_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    lgort        VARCHAR(4),
    menge        NUMERIC(13,3),
    meins        VARCHAR(3),
    dmbtr        NUMERIC(18,2),
    waers        VARCHAR(5),
    budat        DATE
);

-- =============================================================
-- 19. QM 供应商质量 FPYQALS
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."QM_VENDOR_QALS" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    prueflos     VARCHAR(12),
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    lifnr        VARCHAR(10),
    art          VARCHAR(4),
    erdat        DATE,
    abdat        DATE,
    mengeist     NUMERIC(13,3),
    mengesoll    NUMERIC(13,3),
    meins        VARCHAR(3),
    ergebnis     VARCHAR(1)
);

-- =============================================================
-- 20. QM 供应商质量 FPYQMEL
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."QM_VENDOR_QMEL" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    qmnum        VARCHAR(12),
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    lifnr        VARCHAR(10),
    qmart        VARCHAR(2),
    erdat        DATE,
    mncod        VARCHAR(8),
    statu        VARCHAR(4),
    priok        VARCHAR(1)
);

-- =============================================================
-- 21. QM 内部质量 FPY AUFK
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."QM_INTERNAL_AUFK" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    aufnr        VARCHAR(12),
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    auart        VARCHAR(4),
    erdat        DATE,
    gstrs        DATE,
    gltrs        DATE,
    gamng        NUMERIC(13,3),
    gmein        VARCHAR(3)
);

-- =============================================================
-- 22. QM 内部/客户质量 QMEL (通用)
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."QM_QMEL" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    qmnum        VARCHAR(12),
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    kunnr        VARCHAR(10),
    qmart        VARCHAR(2),
    erdat        DATE,
    mncod        VARCHAR(8),
    statu        VARCHAR(4),
    priok        VARCHAR(1),
    txt_codegrp  TEXT
);

-- =============================================================
-- 23. ZFIGPT Division Profitability ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."ZFIGPT_DIV_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    prctr        VARCHAR(10),
    hkont        VARCHAR(10),
    dmbtr        NUMERIC(18,2),
    shkzg        VARCHAR(1),
    waers        VARCHAR(5),
    budat        DATE
);

-- =============================================================
-- 24. ZFIGPT 平均售价 ACDOCA
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."ZFIGPT_AVG_PRICE_ACDOCA" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    bukrs        VARCHAR(4),
    matnr        VARCHAR(18),
    vkorg        VARCHAR(4),
    vtweg        VARCHAR(2),
    gjahr        VARCHAR(4),
    monat        VARCHAR(2),
    netwr        NUMERIC(18,2),
    fkimg        NUMERIC(13,3),
    waers        VARCHAR(5)
);

-- =============================================================
-- 25. Z_PRICE_INFORMATION
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."Z_PRICE_INFORMATION" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    ekorg        VARCHAR(4),
    lifnr        VARCHAR(10),
    netpr        NUMERIC(18,2),
    peinh        NUMERIC(5),
    waers        VARCHAR(5),
    datab        DATE,
    datbi        DATE,
    infnr        VARCHAR(10)
);

-- =============================================================
-- 26. MBEW 可用库存数量
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."MBEW_STOCK" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    matnr        VARCHAR(18),
    bwkey        VARCHAR(4),
    bwtar        VARCHAR(10),
    lbkum        NUMERIC(13,3),
    salk3        NUMERIC(18,2),
    verpr        NUMERIC(18,5),
    stprs        NUMERIC(18,5),
    peinh        NUMERIC(5),
    waers        VARCHAR(5),
    lfgja        VARCHAR(4),
    lfmon        VARCHAR(2)
);

-- =============================================================
-- 27. MARC 安全库存
-- =============================================================
CREATE TABLE IF NOT EXISTS sap_test."MARC_SAFETY_STOCK" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
    matnr        VARCHAR(18),
    werks        VARCHAR(4),
    dismm        VARCHAR(2),
    minbe        NUMERIC(13,3),
    eisbe        NUMERIC(13,3),
    mtvfp        VARCHAR(2),
    plifz        NUMERIC(3),
    webaz        NUMERIC(3),
    meins        VARCHAR(3),
    mabst        NUMERIC(13,3)
);

-- =============================================================
-- Grant permissions on all tables in sap_test schema
-- =============================================================
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA sap_test TO sapwriter;
GRANT SELECT ON ALL TABLES IN SCHEMA sap_test TO airead;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sap_test TO sapwriter;

-- Summary view: show all SAP tables
CREATE OR REPLACE VIEW sap_test."_table_summary" AS
SELECT
    table_name,
    pg_size_pretty(pg_total_relation_size('sap_test."' || table_name || '"')) AS size
FROM information_schema.tables
WHERE table_schema = 'sap_test'
  AND table_name NOT LIKE '\_%'
ORDER BY table_name;

GRANT SELECT ON sap_test."_table_summary" TO airead;
GRANT SELECT ON sap_test."_table_summary" TO sapwriter;
