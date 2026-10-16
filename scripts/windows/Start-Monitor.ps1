$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'Teststock/runtime'
$config = Get-Content (Join-Path $state 'installation.json') -Raw | ConvertFrom-Json
$env:TESTSTOCK_RUNTIME_STATE_DIR = $config.state
$env:TESTSTOCK_EXECUTION_MODE = 'paper'
Remove-Item Env:TESTSTOCK_LIVE_TRADING -ErrorAction SilentlyContinue
Set-Location -LiteralPath $config.repo
& $config.node (Join-Path $config.repo 'scripts/windows-monitor.mjs')
exit $LASTEXITCODE
