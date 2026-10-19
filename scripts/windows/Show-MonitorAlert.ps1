param([Parameter(Mandatory=$true)][string]$StateDir)
$ErrorActionPreference='Stop'
if (-not [IO.Path]::IsPathRooted($StateDir) -or -not (Test-Path -LiteralPath (Join-Path $StateDir 'installation.json'))) { throw 'Installed private runtime required.' }
# Compatibility entry point for an old task. Never load UI assemblies, display
# a window, request focus, or infer receipt from a log write.
$value=@{at=[DateTime]::UtcNow.ToString('o');state='SILENT_LOG_ONLY';userReceiptVerified=$false}
$target=Join-Path $StateDir 'desktop-alert-status.json'
$temp=$target+'.'+[guid]::NewGuid().ToString()+'.tmp'
[IO.File]::WriteAllText($temp,($value | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temp -Destination $target -Force
