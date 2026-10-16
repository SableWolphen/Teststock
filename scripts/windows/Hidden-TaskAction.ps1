function New-TeststockHiddenTaskAction {
  param(
    [Parameter(Mandatory=$true)][string]$Node,
    [Parameter(Mandatory=$true)][string]$Runner,
    [Parameter(Mandatory=$true)][string]$State,
    [Parameter(Mandatory=$true)][ValidateSet('monitor','watchdog')][string]$Name,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory
  )
  foreach($value in @($Node,$Runner,$State,$WorkingDirectory)) {
    if (-not [IO.Path]::IsPathRooted($value) -or $value.Contains('"') -or $value.Contains("`r") -or $value.Contains("`n")) { throw 'Invalid hidden task path.' }
  }
  $hostExe = Join-Path $env:SystemRoot 'System32/wscript.exe'
  if (-not (Test-Path -LiteralPath $hostExe)) { throw 'Windows Script Host is unavailable; refusing a visible task fallback.' }
  $dir = Join-Path $State 'hidden-launchers'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $launcher = Join-Path $dir "$Name.vbs"
  $commandLine = '"' + $Node + '" "' + $Runner + '" --state-dir "' + $State + '"'
  # wscript is a GUI host: Run(..., 0, True) hides the child at creation and
  # preserves its exit status for Task Scheduler. No credentials enter this file.
  @(
    'Option Explicit',
    'Dim runner, result',
    'Set runner = CreateObject("WScript.Shell")',
    ('runner.CurrentDirectory = "' + $WorkingDirectory.Replace('"','""') + '"'),
    ('result = runner.Run("' + $commandLine.Replace('"','""') + '", 0, True)'),
    'WScript.Quit result'
  ) | Set-Content -LiteralPath $launcher -Encoding Unicode
  New-ScheduledTaskAction -Execute $hostExe -Argument ('//B //NoLogo "' + $launcher + '"') -WorkingDirectory $State
}
