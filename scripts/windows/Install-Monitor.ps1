param([switch]$RegisterTask)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
if ([int]((& $node -p 'process.versions.node.split(".")[0]')) -lt 22) { throw 'Install Node.js 22 or later.' }
$state = Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
New-Item -ItemType Directory -Force $state | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $state /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect private runtime folder.' }
$config = @{ node=$node; repo=$repo; state=$state }
$config | ConvertTo-Json | Set-Content (Join-Path $state 'installation.json')
$env:TESTSTOCK_RUNTIME_STATE_DIR = $state
& $node (Join-Path $repo 'scripts/windows-monitor.mjs') --once
if ($LASTEXITCODE -notin @(0,2)) { throw 'Monitor smoke check failed.' }
if ($RegisterTask) {
  $runner = Join-Path $repo 'scripts/windows/Start-Monitor.ps1'
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -File `"$runner`"" -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'Teststock Read-only Monitor' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only monitoring; no order submission.' -Force | Out-Null
}
Write-Output "Installed read-only monitor. State: $state. Broker authentication is a separate gate."
