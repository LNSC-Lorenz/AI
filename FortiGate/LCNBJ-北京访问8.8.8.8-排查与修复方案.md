# LCNBJ（北京/LCNTIT-FW01）经工厂新加坡出口访问 8.8.8.8 —— 排查结论与修复方案

> 基于 `readme` 中完整排查对话整理。日期：2026-08-07
> 涉及设备：LCNBJ-FW01（真实主机名 **LCNTIT-FW01**，北京，7.4.11）/ LCNSC-FW01（工厂，7.4.11）

---

## 一、架构与目标

```
北京PC (192.168.79.0/24)
   → LCNBJ-FW01 (LAN 192.168.79.90 / WAN 219.141.223.251)
   → IPSec 隧道（北京侧名 VPN_LNSC_Main，工厂侧名 VPN_TITCO_Main）
   → 工厂 LCNSC-FW01
   → SDWAN  zone SD_WAN_Web → member 3 = port4（新加坡出口）
   → Internet（Google / 8.8.8.8）
```

目标：北京分支借工厂新加坡 WAN 访问境外资源（8.8.8.8 为验证目标）。
对照组：上海分支（10.86.101.0/24）同样路径 **已通**（ping 8.8.8.8 reply 109ms）。

## 二、readme 中已验证/已排除的事实

| # | 事实 | 状态 |
|---|------|------|
| 1 | 北京 → 工厂内网 10.86.180.1 通（30ms），隧道本身正常 | ✅ 已验证 |
| 2 | 北京路由表：8.8.8.8 → VPN_LNSC_Main | ✅ 已验证 |
| 3 | 工厂回程路由 192.168.79.0/24 → SD_WAN_VPN zone（12 条隧道 ECMP）——上海 10.86.101.0/24 完全相同且上海通 | ✅ 已排除（非根因） |
| 4 | 工厂 SDWAN 规则 `Internal-Google`（internet-service：Google-Web/ICMP/DNS…，priority-members 3）与 `Internal-Google-FQDN` 的 **src 已包含** `N_192.168.79.0_Lechler-TITCO-192.168` | ✅ 已验证无问题 |
| 5 | 用户确认工厂存在 SD_WAN_VPN→SD_WAN_Web + NAT 的放行策略；兜底规则 `INTERNAL_WEB_all`（edit 7）不需要含北京 | ✅ 用户确认 |
| 6 | tracert：第 1 跳到北京防火墙 192.168.79.90，之后全部超时 | 现象确认 |

## 三、决定性证据（readme 最后一组输出）

工厂侧在北京 PC 持续 ping 8.8.8.8 时执行：

```
diagnose sys session filter clear
diagnose sys session filter src 192.168.79.0 255.255.255.0
diagnose sys session filter dst 8.8.8.8
diagnose sys session list
→ total session: 0        ★★★
```

**结论：北京的 8.8.8.8 流量根本没有到达工厂。** 问题不在工厂侧（策略/SDWAN/回程都已排除），
锁定在 **北京防火墙本地发送路径** 或 **隧道封装环节**。

## 四、剩余 3 个嫌疑点（按概率排序）

| 嫌疑 | 机理 | 说明 |
|------|------|------|
| A. 北京本地策略未放行 ⭐⭐⭐ | LCNBJ 的 internal→VPN 策略 dst 只写了 10.86.0.0/16（工厂段），8.8.8.8 被本地 implicit deny，从未进隧道 | 最初清单的"环节3"始终未实际验证 |
| B. Phase2 选择子过窄 ⭐⭐ | 隧道 Phase2 若为 192.168.79.0/24 ↔ 10.86.0.0/16 精确选择子，目的 8.8.8.8 的包找不到匹配 SA，进隧道即被丢弃 | 经典站点 VPN 坑 |
| C. 去程隧道选错 | 北京若有主备双隧道，8.8.8.8 走了工厂未预期/未放行的那条 | 概率低，诊断时可顺带排除 |


---

## 五、诊断步骤（先确诊，再动手改）

### 第 1 步：北京本地 debug flow —— 一锤定音区分 A / B

**LCNBJ-FW01** 执行，然后北京 PC 持续 `ping 8.8.8.8 -t`：

```
diagnose debug reset
diagnose debug flow filter addr 8.8.8.8
diagnose debug flow filter proto 1
diagnose debug flow show function-name enable
diagnose debug flow trace start 100
diagnose debug enable
（ping 约 10 秒后）
diagnose debug disable
diagnose debug reset
```

判读：

| debug flow 输出 | 含义 | 对应修复 |
|---|---|---|
| `Denied by forward policy check` / `implicit deny (policy id 0)` | 本地策略拦截 → **嫌疑 A** | 修复 A |
| 正常建会话、`out dev = VPN_LNSC_Main`，但始终无回包 | 包已送进隧道 → **嫌疑 B/C** | 走第 2、3 步 |

### 第 2 步：两端隧道口同步抓包 —— 确认包是否过隧道

北京侧：
```
diagnose sniffer packet VPN_LNSC_Main 'host 8.8.8.8 and icmp' 4 0 a
```
工厂侧（交叉验证）：
```
diagnose sniffer packet VPN_TITCO_Main 'host 8.8.8.8 and icmp' 4 0 a
```

| 北京抓到发出 | 工厂抓到 | 结论 |
|---|---|---|
| ✅ | ❌ | 隧道封装/选择子丢弃 → **嫌疑 B** |
| ✅ | ✅（但无回程） | 才轮到查工厂策略/回程（目前证据指向不会到这步） |
| ❌ | — | 回第 1 步，本地就没送出来 → **嫌疑 A** |

### 第 3 步：核对 Phase2 选择子（两端都要看）

```
diagnose vpn tunnel list name VPN_LNSC_Main
```
看输出中 `proxyid` 的 `src` / `dst` 选择子：
- `0.0.0.0-255.255.255.255 ↔ 0.0.0.0-255.255.255.255`（即 0/0↔0/0）→ 选择子无限制，排除 B
- `192.168.79.0/24 ↔ 10.86.0.0/16` 这类精确选择子 → **坐实嫌疑 B**，8.8.8.8 不在选择子内被丢弃

### 第 4 步：核对北京本地策略（嫌疑 A 的直接证据）

```
diagnose firewall iprope lookup 8.8.8.8 1 192.168.79.100 internal
show firewall policy | grep -B2 -A15 VPN_LNSC_Main
```
看 internal→VPN_LNSC_Main 策略的 `dstaddr`：若只有 10.86.0.0/16 相关对象，即为根因。

---

## 六、修复方案（按诊断结果三选一/组合）

### 修复 A：北京本地放行策略补全（嫌疑 A）⭐ 最可能

**LCNBJ-FW01**：

```
config firewall policy
    edit 0
        set name "Internal-to-Factory_Internet"
        set srcintf "internal"
        set dstintf "VPN_LNSC_Main"
        set action accept
        set srcaddr "<北京内网对象 192.168.79.0/24>"
        set dstaddr "all"
        set schedule "always"
        set service "ALL"
        set nat disable          ← 关键：隧道流量不要在北京做 NAT，由工厂出网时统一 NAT
        set logtraffic all
    next
end
```

或若已有 internal→VPN 策略（dst=10.86.0.0/16）：把 `dstaddr` 改为 `all`（或先追加 8.8.8.8 测试对象验证）。
注意：策略 `ssl-ssh-profile` 保持 `no-inspection`，避免 UTM 干扰首测。

### 修复 B：Phase2 选择子放宽为 0/0 ↔ 0/0（嫌疑 B）

两端（北京 LCNBJ-FW01 的 VPN_LNSC_Main、工厂 LCNSC-FW01 的 VPN_TITCO_Main）镜像修改：

```
config vpn ipsec phase2-interface
    edit "<该隧道的 phase2 名称>"
        set src-addr-type subnet
        set dst-addr-type subnet
        set src-start-ip 0.0.0.0
        set src-end-ip 0.0.0.0
        set dst-start-ip 0.0.0.0
        set dst-end-ip 0.0.0.0
    next
end
```

改完重置隧道使其重新协商：
```
diagnose vpn ike gateway clear name VPN_LNSC_Main     （北京侧；工厂侧对应 VPN_TITCO_Main）
```

> 若不想动现有 Phase2，也可**新增一条** Phase2：src 192.168.79.0/24 ↔ dst 0.0.0.0/0（两端镜像）。
> 但 0/0↔0/0 是 FortiGate 站点间 VPN 的常规做法，一步到位、一劳永逸。

### 修复 C：统一去程隧道（嫌疑 C，仅诊断指向时执行）

确认北京 8.8.8.8 静态路由指向的隧道接口 = 工厂侧 VPN_TITCO_Main 对应的那一条；
若走了备隧道，把静态路由接口改回主隧道，或在工厂为备隧道补齐同样的放行与回程。


---

## 七、修复后验证清单（按顺序）

1. **北京 PC**：`ping 8.8.8.8` → 应有 Reply（参考上海 109ms）
2. **工厂会话**（北京的包应终于到达工厂）：
   ```
   diagnose sys session filter src 192.168.79.0 255.255.255.0
   diagnose sys session filter dst 8.8.8.8
   diagnose sys session list
   ```
   预期：能看到会话，且 `policy_id` ≠ 0、有 NAT（源被转成 port4 新加坡段公网 IP）、出接口 = port4
3. **工厂日志**：Log & Report → Forward Traffic，筛选 192.168.79.x → 8.8.8.8，应为 Accept + NAT
4. **真实目标**：北京浏览器打开 `https://www.google.com`；`nslookup www.google.com`（走 DC 条件转发器）
5. **回归测试**：北京访问工厂内网（10.86.180.1）、上海/其他分支互访不受影响

### 工厂侧兜底检查（仅当第 2 步出现会话但 policy_id=0 时执行）

readme 配置粘贴中实际**未看到** SD_WAN_VPN→SD_WAN_Web 的策略（粘贴有截断，用户确认其存在）。
若流量到工厂后 policy_id=0，说明该策略未真正匹配北京，需全量核对：


---

## 十、补充排查：已加 8.8.8.8 静态路由但仍走本地 WAN（2026-08-07 更新）

**原理**：8.8.8.8/32 是最长前缀，只要在 FIB 中处于 active 状态就必然优先于默认路由。
仍然走 Domestic WAN，只有 4 类可能：①老会话粘滞 ②PBR/SDWAN 规则覆盖 ③静态路由未生效（inactive）④路由指向了 SDWAN zone。

### 按顺序执行（LCNBJ-FW01 / LCNTIT-FW01）

**① 看 FIB 里这条路由到底生没生效、出接口是谁**
```
get router info routing-table details 8.8.8.8
```
- 出接口 = `VPN_LNSC_Main` → 路由没问题，查 ②④（会话/PBR/SDWAN）
- 出接口 = Domestic/wan → 路由 inactive，查 ③

**② 清掉改路由前的残留会话（最常见原因）**
```
diagnose sys session filter dst 8.8.8.8
diagnose sys session list        ← 先看：out dev 是哪个口、policy id 是几
diagnose sys session clear       ← filter 生效中，只清 8.8.8.8 相关会话
diagnose sys session filter clear
```
然后 PC 重新 `ping 8.8.8.8`。
（ICMP 会话不含序列号，连续 ping 一直复用同一条旧会话 → 改了路由也继续走老路，必须清会话或等其老化。）

**③ 检查静态路由配置本身**
```
show router static | grep -B2 -A6 8.8.8.8
diagnose vpn tunnel list name VPN_LNSC_Main
```
要点：
- `set device "VPN_LNSC_Main"` —— 接口名逐字符核对（大小写、是否配成了别的隧道/zone）
- **gateway 留空（0.0.0.0）** —— 隧道是点对点接口，不需要 gateway；填了不可达的 gateway 会导致路由 inactive
- 隧道必须 up（上一条命令能列出 SA）；多 VDOM 环境确认路由配在了正确 VDOM

**④ 查策略路由（PBR）和 SDWAN 覆盖**
```
diagnose firewall proute list     ← 有 src=192.168.79.0/24、output device=Domestic 的条目即命中
show system sdwan                 ← 北京若也启用了 SDWAN，看 config service 规则
diagnose sys sdwan service
```
- PBR 命中 → 调整/禁用该策略路由，或加一条更精确的 PBR 把 8.8.8.8 指到 VPN_LNSC_Main
- SDWAN 规则把流量钉在 Domestic → 新增置顶规则：src 192.168.79.0/24、dst 8.8.8.8、priority-members = VPN 隧道成员
- 注意：/32 直接指向隧道接口时 SDWAN 不参与选路；只有指向 zone 或路由 inactive 落回默认路由时才受 SDWAN 规则影响

**⑤ 实锤看转发决策（前面都查完仍走 WAN 时）**
```
diagnose debug flow filter addr 8.8.8.8
diagnose debug flow filter proto 1
diagnose debug flow show function-name enable
diagnose debug flow trace start 50
diagnose debug enable
（PC ping 8.8.8.8）
diagnose debug disable
```
看输出里的 `out dev` 和 `policy id`：
- `out dev=Domestic` → 把整段输出贴出来分析（重点看 matched policy 和选路过程）
- `out dev=VPN_LNSC_Main` 但工厂仍 `total session: 0` → 回到**修复 B**（Phase2 选择子），用 `diagnose vpn tunnel list name VPN_LNSC_Main` 核对 proxyid

### 走通后别忘的两件事
1. 北京 internal→VPN_LNSC_Main 的放行策略（dst 含 8.8.8.8、NAT 关闭、no-inspection）必须存在——路由对了策略不放行照样不通
2. 出接口改对后，回工厂复验：`diagnose sys session list` 应看到 192.168.79.x→8.8.8.8 会话、policy_id≠0、NAT、出接口 port4

```
show firewall policy | grep -B2 -A15 SD_WAN_VPN
```

若确实缺失，新建：

```
config firewall policy
    edit 0
        set name "VPN_BJ-to-SD_WAN_Web"
        set srcintf "SD_WAN_VPN"
        set dstintf "SD_WAN_Web"
        set action accept
        set srcaddr "N_192.168.79.0_Lechler-TITCO-192.168"
        set dstaddr "all"
        set schedule "always"
        set service "ALL"
        set nat enable
        set logtraffic all
    next
end
```

---

## 八、后续优化建议（打通后的事项）

1. **补齐其余境外类 SDWAN 规则的北京源** —— 目前工厂只有 `Internal-Google`、`Internal-Linkedin` 的 src 含 `N_192.168.79.0`；以下规则的 src **只有** `N_10.86.0.0_16_LNSC`，北京如需同类访问要逐个 `append src`：
   - `Internal-ChatGPT-FQDN`、`Internal-Claude`、`Internal-Meta`、`Internal-AWS`、`Internal-Salesforce`、`Internal-Github`（均 priority-members 3 走新加坡）
   - `Internal-Office365`、`Internal-Teamviewer`（members 5 4 走国内口，按需决定）
   ```
   config system sdwan
       config service
           edit <规则ID>
               append src "N_192.168.79.0_Lechler-TITCO-192.168"
           next
       end
   end
   ```
   审计命令：`show system sdwan | grep -E "edit |set name|set src |set priority-members"`

2. **北京的"哪些流量走隧道"策略**：目前仅 8.8.8.8/32 静态路由入隧道。要让北京真正"按域名走新加坡"，可选：
   - 简单做法：北京侧把需要出境的目的网段/Google 常用段静态路由入隧道（维护成本高）
   - 推荐做法：北京默认路由仍走本地 Domestic 口；DNS 由 DC 条件转发器解析特殊域名；北京防火墙用 **FQDN 地址对象 + 策略路由（PBR）** 把特殊域名流量引入隧道（与工厂 FQDN SDWAN 规则呼应，两端都用 FQDN，不用维护 IP）
3. **命名规范**：北京防火墙主机名 LCNTIT-FW01 与对话中的 LCNBJ、工厂侧 TITCO 命名混用，曾造成排查误解，建议统一站点代号
4. **新分支上线 Checklist 化**（本次教训）：① 本地放行策略（dst=all 或按需）② Phase2 选择子 0/0↔0/0 ③ 工厂 VPN→SDWAN 放行策略含新子网 ④ 工厂 SDWAN 各出境规则 src 含新子网 ⑤ 回程路由/SDWAN 回程规则 —— 五项一次配齐
5. 可选卫生项：工厂 SDWAN 回程规则 `LNSC-Beijing-VPN`（edit 6）引用的 SLA 健康检查是 `FW_LNSC`（server 10.86.102.200、latency 阈值 20ms、无成员限定），而专为北京建的 `FW_TITCO`（server 192.168.79.90、members 8 7、latency 50ms）未被引用。该规则影响的是**工厂主动发起到北京**的流量选路（会话回包不受影响，故与本次故障无关），建议把 edit 6 的 SLA 改为 `FW_TITCO`，避免隧道 30ms 延迟超 20ms 阈值导致规则失效

---

## 九、一页纸结论

> **现象**：北京 ping 8.8.8.8 不通，上海通。
> **定论**：工厂 `diagnose sys session list` 显示北京→8.8.8.8 会话为 0 —— 流量根本没出北京。
> **最可能根因**：北京 LCNBJ 本地 internal→VPN 策略只放行了工厂段（10.86.0.0/16），8.8.8.8 被本地 implicit deny（或隧道 Phase2 选择子不含 8.8.8.8）。
> **动作**：先做"第五节 第 1 步 debug flow"确诊 → 大概率执行"修复 A"（北京策略 dst 补 all、NAT 关闭）；若包进隧道而工厂收不到则执行"修复 B"（Phase2 改 0/0↔0/0）。
> **验证**：北京 ping 8.8.8.8 有 Reply + 工厂会话表可见 policy_id≠0、NAT、出接口 port4。
