<#
.SYNOPSIS
    从打印服务器 lcnnsc-print01 / lcnnsc-print02 遍历共享打印机，导出 printers.json。

.DESCRIPTION
    在任意一台已加域、能访问打印服务器的 Windows 机器上运行（建议配计划任务每小时执行）。
    生成的 printers.json 会上传到 LNSC-Apps Web 服务器的 Printing 应用目录。
    上传依赖 scp + SSH key 免密登录（首次先手动 ssh 一次确认 host key）。

.NOTES
    运行账号需对打印服务器有读取权限（域内默认 Authenticated Users 可枚举，
    若被收紧则加入 Print Operators 组）。
#>

$PrintServers = @('lcnnsc-print01', 'lcnnsc-print02')
$WebTarget    = 'sysadmin@10.86.180.76:/var/www/lnsc-apps/apps/printing/printers.json'
$OutFile      = Join-Path $PSScriptRoot 'printers.json'

$all = foreach ($srv in $PrintServers) {
    Write-Host "Querying $srv ..."
    try {
        Get-Printer -ComputerName $srv -ErrorAction Stop |
            Where-Object { $_.Shared -eq $true } |
            ForEach-Object {
                [pscustomobject]@{
                    server   = $srv
                    name     = $_.Name
                    share    = $_.ShareName
                    driver   = $_.DriverName
                    location = $_.Location
                    comment  = $_.Comment
                    port     = $_.PortName
                }
            }
    }
    catch {
        Write-Warning "Failed to query ${srv}: $($_.Exception.Message)"
    }
}

$doc = [ordered]@{
    generated = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    servers   = $PrintServers
    printers  = @($all)
}

$json = $doc | ConvertTo-Json -Depth 4
# PowerShell 5.1 的 ConvertTo-Json 对单元素数组输出对象，强制 printers 为数组
if ($all.Count -eq 1) {
    $json = $json -replace '"printers":\s*\{', '"printers": [{'
    $json = $json -replace '\}(\s*)$', '} ]$1'
}
[IO.File]::WriteAllText($OutFile, $json, (New-Object Text.UTF8Encoding($true)))
Write-Host "Exported $($all.Count) printers -> $OutFile"

# 上传到 Web 服务器（需要 scp 可用 + SSH key 免密）
if (Get-Command scp -ErrorAction SilentlyContinue) {
    & scp $OutFile $WebTarget
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Uploaded -> $WebTarget"
    }
    else {
        Write-Warning "scp upload failed (exit $LASTEXITCODE). 请手动上传 printers.json 到 $WebTarget"
    }
}
else {
    Write-Warning "scp not found. 请手动上传 $OutFile 到 $WebTarget"
}
