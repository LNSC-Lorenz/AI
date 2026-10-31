<#  注册/卸载「今日可合并清单」每日计划任务（当前用户，不需管理员权限）
    用法：
      powershell -File install-task.ps1                  # 每天 07:45 生成并弹出清单
      powershell -File install-task.ps1 -Time 08:30      # 改时间
      powershell -File install-task.ps1 -NoOpen          # 只生成文件，不弹窗
      powershell -File install-task.ps1 -Uninstall       # 删除任务
    说明：任务在当前用户登录状态下运行；错过时间不会补跑（可手动运行 run-daily.ps1）。
#>
param(
  [string]$Time = '07:45',
  [string]$TaskName = 'FahuoMergeHint',
  [switch]$NoOpen,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if ($Uninstall) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Host "已删除计划任务 $TaskName"
  return
}

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'run-daily.ps1'
if (-not (Test-Path -LiteralPath $script)) { Write-Error "找不到 $script" }
# schtasks 的 /TR 值里的引号必须写成 \" 才不会被 PowerShell 吞掉
$tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"' + $script + '\"' + ($(if ($NoOpen) { '' } else { ' -Open' }))
schtasks /Create /TN $TaskName /SC DAILY /ST $Time /TR $tr /F | Out-Null
$mode = if ($NoOpen) { '（只生成文件，不弹窗）' } else { ' 并弹窗显示' }
Write-Host "已注册计划任务 $TaskName：每天 $Time 生成可合并清单$mode"
schtasks /Query /TN $TaskName /V /FO LIST | Select-String -Pattern 'Task To Run|任务要运行|Next Run Time|下次运行时间|Status|状态|Schedule Type|计划任务类型'
