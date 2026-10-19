param([Parameter(Mandatory=$true)][string]$StateDir)
$ErrorActionPreference='Stop'
if (-not [IO.Path]::IsPathRooted($StateDir) -or -not (Test-Path -LiteralPath (Join-Path $StateDir 'installation.json'))) { throw 'Installed private runtime required.' }
function Read-PrivateJson([string]$Name) {
  try { Get-Content -LiteralPath (Join-Path $StateDir $Name) -Raw | ConvertFrom-Json } catch { $null }
}
function Save-PrivateJson([string]$Name,$Value) {
  $target=Join-Path $StateDir $Name
  $temp=$target+'.'+[guid]::NewGuid().ToString()+'.tmp'
  [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temp -Destination $target -Force
}
$allowed=@('MONITOR_HEARTBEAT_STALE_OR_MISSING','BROKER_MONITOR_BLOCKED','MARKET_DATA_BLOCKED','RECONCILIATION_INCOMPLETE','UNEXPECTED_LIVE_STATE','MONITOR_STOP_REQUESTED','WATCHDOG_STATE_INVALID','BROKER_SNAPSHOT_STALE_OR_MISSING','MARKET_DATA_STALE_OR_MISSING','HOLDING_PROTECTION_UNVERIFIED','OPTION_EXPIRATION_REVIEW_REQUIRED','CRYPTO_PROTECTION_UNVERIFIED','OPTION_PRICE_MONITORING_UNVERIFIED','SESSION_EXIT_TIME_UNVERIFIED','SESSION_EXIT_REVIEW_REQUIRED','SESSION_EXIT_REVIEW_UPCOMING','SESSION_CLOSED_WITH_HOLDINGS')
$watchdog=Read-PrivateJson 'watchdog-status.json'
$codes=@($watchdog.activeCodes | Where-Object { $_ -in $allowed } | Sort-Object -Unique)
$watchdogAge=[double]::PositiveInfinity
try { $watchdogAge=([DateTime]::UtcNow-[DateTime]::Parse($watchdog.at).ToUniversalTime()).TotalSeconds } catch {}
if ($watchdogAge -gt 120 -or $watchdogAge -lt -2) { $codes=@('MONITOR_HEARTBEAT_STALE_OR_MISSING') }
$key=[DateTime]::UtcNow.ToString('yyyy-MM-dd')+'|'+($codes -join ',')
$challenge=Read-PrivateJson 'desktop-alert-challenge.json'
if (-not $challenge -or $challenge.eventKey -ne $key) {
  $challenge=[ordered]@{version=1;id=[guid]::NewGuid().ToString();createdAt=[DateTime]::UtcNow.ToString('o');expiresAt=[DateTime]::UtcNow.AddMinutes(10).ToString('o');eventKey=$key;codes=$codes;lastAttemptAt=$null}
  Save-PrivateJson 'desktop-alert-challenge.json' $challenge
}
try {
  Add-Type -AssemblyName System.Windows.Forms
  if (-not [Environment]::UserInteractive) { throw 'Interactive Windows session unavailable.' }
  Save-PrivateJson 'desktop-alert-status.json' @{at=[DateTime]::UtcNow.ToString('o');state='READY'}
  $receipt=Read-PrivateJson 'desktop-alert-receipt.json'
  if ($receipt.challengeId -eq $challenge.id) { exit 0 }
  if ($challenge.lastAttemptAt -and ([DateTime]::UtcNow-[DateTime]::Parse($challenge.lastAttemptAt).ToUniversalTime()).TotalMinutes -lt 5) { exit 0 }
  # Expired unanswered challenges get a fresh ID; old receipts cannot acknowledge them.
  if ([DateTime]::UtcNow -gt [DateTime]::Parse($challenge.expiresAt).ToUniversalTime()) {
    $challenge.id=[guid]::NewGuid().ToString();$challenge.createdAt=[DateTime]::UtcNow.ToString('o');$challenge.expiresAt=[DateTime]::UtcNow.AddMinutes(10).ToString('o')
  }
  $challenge.lastAttemptAt=[DateTime]::UtcNow.ToString('o');Save-PrivateJson 'desktop-alert-challenge.json' $challenge
  $form=New-Object Windows.Forms.Form
  $form.Text='Teststock monitoring alert';$form.Width=620;$form.Height=330;$form.StartPosition='CenterScreen';$form.TopMost=$true
  $label=New-Object Windows.Forms.Label
  $label.Left=20;$label.Top=20;$label.Width=565;$label.Height=200
  $messages=@{
    MONITOR_HEARTBEAT_STALE_OR_MISSING='The monitor has stopped reporting.'
    BROKER_MONITOR_BLOCKED='The broker connection needs attention.'
    MARKET_DATA_BLOCKED='Market data is unavailable.'
    RECONCILIATION_INCOMPLETE='Some account or order checks remain unverified.'
    UNEXPECTED_LIVE_STATE='An unexpected trading setting needs review.'
    MONITOR_STOP_REQUESTED='Monitoring has been stopped.'
    WATCHDOG_STATE_INVALID='The alert history needs review.'
    BROKER_SNAPSHOT_STALE_OR_MISSING='Broker readings are stale or missing.'
    MARKET_DATA_STALE_OR_MISSING='Market readings are stale or missing.'
    HOLDING_PROTECTION_UNVERIFIED='A holding has no verified protective order.'
    OPTION_EXPIRATION_REVIEW_REQUIRED='An option is expiring and needs review.'
    CRYPTO_PROTECTION_UNVERIFIED='Crypto holdings need a protection review.'
    OPTION_PRICE_MONITORING_UNVERIFIED='A current option price could not be verified.'
    SESSION_EXIT_TIME_UNVERIFIED='The session exit deadline could not be verified.'
    SESSION_EXIT_REVIEW_REQUIRED='Review and close session-only positions now.'
    SESSION_EXIT_REVIEW_UPCOMING='The final scheduled exit review is approaching.'
    SESSION_CLOSED_WITH_HOLDINGS='The market closed with an option still held.'
  }
  $label.Text="Teststock needs your attention.`r`n`r`n"+$(if ($codes.Count) { ($codes | ForEach-Object { $messages[$_] }) -join "`r`n" } else { 'Alert delivery test: monitoring is running.' })+"`r`n`r`nAcknowledging confirms receipt only. It does not authorize trades or prove an unattended exit. Open your Teststock chat for details."
  $button=New-Object Windows.Forms.Button
  $button.Text='Acknowledge receipt';$button.Left=170;$button.Top=235;$button.Width=240
  $button.Add_Click({
    if ([DateTime]::UtcNow -le [DateTime]::Parse($challenge.expiresAt).ToUniversalTime()) {
      Save-PrivateJson 'desktop-alert-receipt.json' @{challengeId=$challenge.id;acknowledgedAt=[DateTime]::UtcNow.ToString('o');source='DESKTOP_ACKNOWLEDGE_BUTTON'}
    }
    $form.Close()
  })
  $form.Controls.Add($label);$form.Controls.Add($button)
  $timer=New-Object Windows.Forms.Timer;$timer.Interval=15000
  $timer.Add_Tick({
    Save-PrivateJson 'desktop-alert-status.json' @{at=[DateTime]::UtcNow.ToString('o');state='DISPLAYED'}
    if (([DateTime]::UtcNow-[DateTime]::Parse($challenge.lastAttemptAt).ToUniversalTime()).TotalMinutes -ge 4) { $form.Close() }
  })
  Save-PrivateJson 'desktop-alert-status.json' @{at=[DateTime]::UtcNow.ToString('o');state='DISPLAYED'}
  $timer.Start();[void]$form.ShowDialog();$timer.Stop();$timer.Dispose();$form.Dispose()
} catch {
  Save-PrivateJson 'desktop-alert-status.json' @{at=[DateTime]::UtcNow.ToString('o');state='DELIVERY_FAILED'}
  exit 1
}
