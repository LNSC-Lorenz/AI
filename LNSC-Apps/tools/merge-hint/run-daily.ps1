<#  今日可合并清单·每日运行包装
    用法：
      powershell -File run-daily.ps1                      # 生成今日清单并打印
      powershell -File run-daily.ps1 -Open                # 生成后用记事本打开
      powershell -File run-daily.ps1 -Clip                # 生成后复制到剪贴板（贴群里）
      powershell -File run-daily.ps1 -Date 2026-10-27     # 指定日期
      powershell -File run-daily.ps1 -Api http://IP/apps/fahuo/api
    输出文件：%USERPROFILE%\Documents\Fahuo\可合并清单-YYYY-MM-DD.txt
#>
param(
  [string]$Date = '',
  [string]$Api = '',
  [string]$OutDir = '',
  [switch]$Open,
  [switch]$Clip
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error '未找到 node：请先安装 Node.js 18+（脚本需要内置 fetch）'
}
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutDir) { $OutDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Fahuo' }
$out = Join-Path $OutDir ("可合并清单-{0}.txt" -f (Get-Date -Format yyyy-MM-dd))

$nodeArgs = @((Join-Path $here 'merge-hint.mjs'), "--out=$out")
if ($Date) { $nodeArgs += "--date=$Date" }
if ($Api)  { $nodeArgs += "--base=$Api" }

& node @nodeArgs
if ($LASTEXITCODE -ne 0) { Write-Error "生成失败（node 退出码 $LASTEXITCODE）：请确认能访问服务器" }

if ($Clip) { Get-Content -LiteralPath $out -Raw -Encoding UTF8 | Set-Clipboard; Write-Host '清单已复制到剪贴板' }
if ($Open) { Start-Process $out }
