param(
  [ValidateSet("60", "30")]
  [string]$IntervalMinutes = "60",
  [string]$TaskPrefix = "ShopeeAdsAutopilot",
  [switch]$Silent,
  [string]$ReportWindowBeijing = "09:00-19:00",
  [int]$ReportIntervalHours = 2
)

$Root = "E:\AI$([char]0x9879)$([char]0x76ee)$([char]0x6c47)$([char]0x603b)\shopee-adspower-scraper"
$Node = "node.exe"
$Runner = Join-Path $Root "scripts\run-hidden.vbs"
$RealtimeName = "$TaskPrefix-Realtime"
$RecheckName = "$TaskPrefix-YesterdayRecheck"
$ReportPrefix = "$TaskPrefix-Report"

if (-not (Test-Path -LiteralPath $Root)) { throw "Project root not found: $Root" }
if ($Silent -and -not (Test-Path -LiteralPath $Runner)) { throw "Hidden runner not found: $Runner" }

function New-AutopilotAction([string[]]$TaskArgs) {
  if ($Silent) {
    $quotedRunner = '"' + $Runner + '"'
    $argText = ('//B //Nologo ' + $quotedRunner + ' node.exe ' + ($TaskArgs -join ' '))
    return New-ScheduledTaskAction -Execute "wscript.exe" -Argument $argText -WorkingDirectory $Root
  }
  return New-ScheduledTaskAction -Execute $Node -Argument ($TaskArgs -join ' ') -WorkingDirectory $Root
}

function Convert-BeijingTime([string]$HHmm) {
  $parts = $HHmm.Split(':')
  $beijing = [TimeZoneInfo]::FindSystemTimeZoneById("China Standard Time")
  $local = [TimeZoneInfo]::Local
  $today = [DateTime]::Today
  $bj = New-Object DateTime($today.Year, $today.Month, $today.Day, [int]$parts[0], [int]$parts[1], 0, [DateTimeKind]::Unspecified)
  return [TimeZoneInfo]::ConvertTime($bj, $beijing, $local)
}

function Get-BeijingReportTimes([string]$Window, [int]$EveryHours) {
  $pair = $Window.Split('-')
  $start = [int]$pair[0].Split(':')[0]
  $end = [int]$pair[1].Split(':')[0]
  $minute = $pair[0].Split(':')[1]
  $times = @()
  for ($h = $start; $h -le $end; $h += $EveryHours) { $times += ('{0:00}:{1}' -f $h, $minute) }
  return $times
}

$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

$RealtimeAction = New-AutopilotAction -TaskArgs @('scripts\ads-autopilot.mjs','collect','--days','2','--no-google')
$RealtimeTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes ([int]$IntervalMinutes)) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $RealtimeName -Action $RealtimeAction -Trigger $RealtimeTrigger -Settings $Settings -Description "Shopee Ads hourly realtime backfill for ID/MY/TH." -Force | Out-Null

$RecheckAction = New-AutopilotAction -TaskArgs @('scripts\ads-autopilot.mjs','collect','--days','2','--no-google')
$RecheckTrigger = New-ScheduledTaskTrigger -Daily -At 10:00
Register-ScheduledTask -TaskName $RecheckName -Action $RecheckAction -Trigger $RecheckTrigger -Settings $Settings -Description "Shopee Ads yesterday recheck after site data stabilizes." -Force | Out-Null

Get-ScheduledTask -TaskName "$ReportPrefix-*" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
foreach ($t in Get-BeijingReportTimes $ReportWindowBeijing $ReportIntervalHours) {
  $localAt = Convert-BeijingTime $t
  $name = "$ReportPrefix-$($t.Replace(':',''))"
  $action = New-AutopilotAction -TaskArgs @('scripts\ads-report.mjs','run')
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $localAt
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $Settings -Description "Shopee Ads HTML+Excel Product ID report. Beijing time $t." -Force | Out-Null
}

Write-Host "Registered $RealtimeName, $RecheckName, and report tasks under $Root. Silent=$Silent"