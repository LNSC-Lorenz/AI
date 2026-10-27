<#
.SYNOPSIS
  用 Microsoft Edge 无头模式，把本目录下的 HTML 文档导出为 PDF（A4，无浏览器页眉页脚）。
.EXAMPLE
  .\build-pdf.ps1                      # 导出全部文档
  .\build-pdf.ps1 -Only 工单            # 只导出名字里含「工单」的文档
.NOTES
  交互式网页（Jira使用说明.html）需要注入打印样式，否则滚动动画元素 opacity:0 会导出成空白。
#>
[CmdletBinding()]
param(
  [string]$Only,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)

$ErrorActionPreference = 'Stop'
$Root    = $PSScriptRoot
$WorkDir = Join-Path $env:TEMP 'lnsc-jira-pdf'
$Profile = Join-Path $WorkDir 'edge-profile'
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

# 交互式网页专用的打印覆盖样式
$PrintCss = @'
@page { size: A4; margin: 12mm 11mm; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
    animation: none !important; transition: none !important; }
html, body { background: #fff !important; }
.nav, .hero .cta, .hero .dot, .hero-logo i, .confetti, .demo-bar .dbtn, .faq-q .arr { display: none !important; }
.reveal { opacity: 1 !important; transform: none !important; }
.container { max-width: 100% !important; padding: 0 4px !important; }
.hero { padding: 20px 0 24px !important; }
.hero h1 { font-size: 30px !important; }
.hero p.sub { font-size: 13px !important; margin-top: 10px !important; }
.hero-logo { width: 54px; height: 54px; margin-bottom: 12px !important; }
.hero-logo span { width: 42px; height: 42px; font-size: 23px; border-radius: 12px; }
section { padding: 16px 0 !important; }
.sec-title { font-size: 20px !important; break-after: avoid; }
.sec-sub { margin: 4px auto 14px !important; max-width: none !important; font-size: 12px !important; }
.f-card, .q-step, .demo-wrap, .table-wrap, .faq-item, tr { break-inside: avoid !important; }
.f-card, .q-step { box-shadow: none !important; transform: none !important; }
.f-card { padding: 14px 16px; } .f-card h3 { margin: 8px 0 4px; font-size: 15px; }
.f-card p { font-size: 12px; } .q-step p { font-size: 12px; }
table { font-size: 11px; } th, td { padding: 7px 10px; }
.faq { max-width: none !important; }
.faq-q { font-size: 13px; padding: 10px 14px; }
.faq-a { max-height: none !important; overflow: visible !important; }
.faq-a p { padding: 0 14px 12px; font-size: 12px; }
.jcard { opacity: 1 !important; transform: none !important; pointer-events: auto !important; box-shadow: 0 2px 6px rgba(23,43,77,.10) !important; }
.avatar { opacity: 1 !important; transform: none !important; }
.tag.sprint { display: inline-block !important; }
.pbar i { width: 80% !important; }
.board { min-height: 0 !important; } .col-body { min-height: 70px !important; }
footer { padding: 14px 0 !important; font-size: 11px; }
'@
