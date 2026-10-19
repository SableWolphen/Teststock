param()
$ErrorActionPreference='Stop'
$state=Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
if (-not (Test-Path -LiteralPath (Join-Path $state 'installation.json'))) { throw 'Install monitor first.' }
$toolsDir=Join-Path $state 'tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$runner=Join-Path $toolsDir 'Show-MonitorAlert.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Show-MonitorAlert.ps1') -Destination $runner -Force
$shell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
foreach ($p in @($shell,$runner,$state)) { if ($p.Contains('"') -or $p.Contains("`r") -or $p.Contains("`n")) { throw 'Invalid task path.' } }
$action=New-ScheduledTaskAction -Execute $shell -Argument ('-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$runner+'" -StateDir "'+$state+'"') -WorkingDirectory $state
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$triggers=@((New-ScheduledTaskTrigger -AtLogOn -User $identity),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Teststock Desktop Alerts' -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Local interactive alert delivery with explicit receipt. No broker access or order submission. Requires logged-in desktop.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Teststock Desktop Alerts'
Write-Output 'Desktop alerts installed. Acknowledgement is required to verify receipt; no unattended broker capability is inferred.'
