param([switch]$Unregister)
$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
New-Item -ItemType Directory -Force $state | Out-Null
New-Item -ItemType File -Force (Join-Path $state 'STOP') | Out-Null
if ($Unregister) { Unregister-ScheduledTask -TaskName 'Teststock Read-only Monitor' -Confirm:$false }
Write-Output 'Stop requested. Logs and claims retained. Remove STOP after confirming the process exited to resume.'
