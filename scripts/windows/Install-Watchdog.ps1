param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Hidden-TaskAction.ps1')
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$state = Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
if (-not (Test-Path -LiteralPath (Join-Path $state 'installation.json'))) { throw 'Install the monitor first.' }
$toolsDir = Join-Path $state 'tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$runner = Join-Path $toolsDir 'monitor-watchdog.mjs'
Copy-Item -LiteralPath (Join-Path $repo 'scripts/monitor-watchdog.mjs') -Destination $runner -Force
Copy-Item -LiteralPath (Join-Path $repo 'scripts/monitor-lock.mjs') -Destination (Join-Path $toolsDir 'monitor-lock.mjs') -Force
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-TeststockHiddenTaskAction -Node $node -Runner $runner -State $state -Name watchdog -WorkingDirectory $state
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Teststock Read-only Watchdog' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Independent heartbeat checks and private local incident/recovery log. No broker access or order submission.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Teststock Read-only Watchdog'
Write-Output 'Watchdog installed: local-file alerts only; user notification receipt is not verified.'
