$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
$config = Get-Content (Join-Path $state 'installation.json') -Raw | ConvertFrom-Json
$env:TESTSTOCK_RUNTIME_STATE_DIR = $config.state
$env:TESTSTOCK_EXECUTION_MODE = 'paper'
Remove-Item Env:TESTSTOCK_LIVE_TRADING -ErrorAction SilentlyContinue
Set-Location -LiteralPath $config.repo
$runner = if ($config.monitorRunner) { $config.monitorRunner } else { Join-Path $config.repo 'scripts/windows-monitor.mjs' }
& $config.node $runner --state-dir $config.state
exit $LASTEXITCODE
