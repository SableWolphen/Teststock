param()
$ErrorActionPreference='Stop'
$state=Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
if (-not (Test-Path -LiteralPath (Join-Path $state 'installation.json'))) { throw 'Install monitor first.' }
$task=Get-ScheduledTask -TaskName 'Teststock Desktop Alerts' -ErrorAction SilentlyContinue
if ($task) {
  Disable-ScheduledTask -TaskName 'Teststock Desktop Alerts' | Out-Null
  Stop-ScheduledTask -TaskName 'Teststock Desktop Alerts'
}
$toolsDir=Join-Path $state 'tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Show-MonitorAlert.ps1') -Destination (Join-Path $toolsDir 'Show-MonitorAlert.ps1') -Force
$preferences=@{schemaVersion=1;interactiveAlertsEnabled=$false;reason='USER_REQUEST_NO_POPUPS_OR_FOCUS_STEALING';updatedAt=[DateTime]::UtcNow.ToString('o')}
$preferences | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'notification-preferences.json') -Encoding utf8
& (Join-Path $toolsDir 'Show-MonitorAlert.ps1') -StateDir $state
Write-Output 'Interactive alerts disabled. Silent local logs remain; no user receipt or unattended execution is inferred.'
