<#
.SYNOPSIS
  用 Microsoft Edge 无头模式，把本目录下的 HTML 文档导出为 PDF（A4，无浏览器页眉页脚）。
.EXAMPLE
  .\build-pdf.ps1                    # 导出全部文档
  .\build-pdf.ps1 -Only 工单          # 只导出文件名里含「工单」的文档
  .\build-pdf.ps1 -KeepTemp          # 导出后保留临时 HTML，便于排查
.NOTES
  排版规则写在各自 HTML 的 @media print 里，本脚本只负责：
    1) 复制 HTML 到临时目录并注入 <base>（相对路径的 logo 才能解析）
    2) 兜底注入「强制打印背景色 + 关闭动画」
    3) 调 Edge 打印，并回报每个文档的页数
  页数由 HTML 自己控制：定页文档用 .page{height:297mm} + page-break-before:always。
  Chromium 的 zoom / scale 不参与分页计算，所以别指望缩放把内容压进一页。
#>
[CmdletBinding()]
param(
  [string]$Only,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$Root    = $PSScriptRoot
$WorkDir = Join-Path ([IO.Path]::GetTempPath()) ('lnsc-jira-pdf-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$Profile = Join-Path $WorkDir 'edge-profile'
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

# 交付文件名映射：源 HTML 与既有 PDF 不同名的文档在这里登记
$NameMap = @{ 'Jira使用说明.html' = 'Jira-Usage.pdf' }

# 兜底打印样式：背景色必须印出来，动画必须关掉（否则动画初始态会被打印成隐藏）
$CssBase = @'
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
    animation: none !important; transition: none !important; }
'@

# Edge 导出的 PDF 用 /Type /Page 计数；第三方 PDF 回退到 /Count
function Get-PdfPageCount([string]$Path) {
  $text  = [Text.Encoding]::GetEncoding('ISO-8859-1').GetString([IO.File]::ReadAllBytes($Path))
  $pages = [regex]::Matches($text, '/Type\s*/Page(?![\w])').Count
  if ($pages -gt 0) { return $pages }
  $counts = [regex]::Matches($text, '/Count\s+(\d+)') | ForEach-Object { [int]$_.Groups[1].Value }
  if ($counts) { return ($counts | Measure-Object -Maximum).Maximum }
  return 0
}

# Edge 可能在文件真正写完前就返回，轮询到大小连续两次不变为止
function Wait-ForPdf([string]$Path, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = -1
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $size = (Get-Item -LiteralPath $Path).Length
      if ($size -gt 0 -and $size -eq $last) { return $true }
      $last = $size
    }
    Start-Sleep -Milliseconds 300
  }
  return (Test-Path -LiteralPath $Path)
}

function ConvertTo-TempHtml {
  param([string]$SourcePath, [string]$TempPath)

  $html = [IO.File]::ReadAllText($SourcePath, [Text.Encoding]::UTF8)
  $base = '<base href="file:///' + ($Root -replace '\\', '/') + '/">'
  $nl   = [char]10
  $tag  = $base + $nl + '<style>' + $nl + $CssBase + $nl + '</style>' + $nl

  $rx = [regex]'(?i)</head\s*>'
  if ($rx.IsMatch($html)) {
    $html = $rx.Replace($html, ($tag + '</head>'), 1)
  } else {
    $rxBody = [regex]'(?i)<body(\s[^>]*)?>'
    if (-not $rxBody.IsMatch($html)) { throw "既找不到 </head> 也找不到 <body>：$SourcePath" }
    $html = $rxBody.Replace($html, { param($m) $tag + $m.Value }, 1)
  }
  [IO.File]::WriteAllText($TempPath, $html, (New-Object Text.UTF8Encoding($false)))
}

function Invoke-EdgePdf {
  param([string]$HtmlPath, [string]$PdfPath)
  if (Test-Path -LiteralPath $PdfPath) { Remove-Item -LiteralPath $PdfPath -Force }
  $edgeArgs = @(
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-pdf-header-footer',
    ('--print-to-pdf=' + $PdfPath),
    '--virtual-time-budget=15000',
    ('--user-data-dir=' + $Profile),
    ('file:///' + ($HtmlPath -replace '\\', '/'))
  )
  $p = Start-Process -FilePath $Edge -ArgumentList $edgeArgs -Wait -PassThru -WindowStyle Hidden
  if (-not (Wait-ForPdf $PdfPath)) { throw "Edge 未生成 PDF（退出码 $($p.ExitCode)）：$PdfPath" }
}

# 只用于回报文档类型，不参与排版决策
function Get-DocKind([string]$Html) {
  if ($Html -match '(min-)?height\s*:\s*297mm') { return '定页' }
  if ($Html -match 'class="[^"]*\breveal\b"')   { return '滚动' }
  return '常规'
}

# ---------------------------------------------------------------- 导出主流程

if (-not (Test-Path -LiteralPath $Edge)) { throw "找不到 Edge：$Edge" }

$files = @(Get-ChildItem -LiteralPath $Root -Filter '*.html' -File | Sort-Object Name)
if ($Only) { $files = @($files | Where-Object { $_.Name -like ('*' + $Only + '*') }) }
if ($files.Count -eq 0) { Write-Warning "没有匹配的 HTML（-Only '$Only'）"; return }

$report = foreach ($f in $files) {
  $html = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)

  if ($NameMap.ContainsKey($f.Name)) { $pdfName = $NameMap[$f.Name] }
  else { $pdfName = [IO.Path]::GetFileNameWithoutExtension($f.Name) + '.pdf' }
  $outPdf = Join-Path $Root $pdfName

  $tmpHtml = Join-Path $WorkDir ($f.BaseName + '.html')
  $tmpPdf  = Join-Path $WorkDir ($f.BaseName + '.pdf')
  ConvertTo-TempHtml -SourcePath $f.FullName -TempPath $tmpHtml
  Invoke-EdgePdf -HtmlPath $tmpHtml -PdfPath $tmpPdf

  Copy-Item -LiteralPath $tmpPdf -Destination $outPdf -Force
  [PSCustomObject]@{
    源文件 = $f.Name
    类型   = Get-DocKind $html
    输出   = $pdfName
    页数   = Get-PdfPageCount $outPdf
    大小KB = [math]::Round((Get-Item -LiteralPath $outPdf).Length / 1KB, 1)
  }
}

if (-not $KeepTemp) { Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
$report | Format-Table -AutoSize
