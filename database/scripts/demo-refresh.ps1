<#
.SYNOPSIS
  Rebuilds the deployed demo's data (FR-DEM-06), for a scheduled task that
  keeps the demo fresh while people explore it over several days.

.DESCRIPTION
  The demo is anchored to the moment it is reset: the mid-queue chamber, the
  bed board's freshness, "today" on every dashboard. Nothing moves it forward
  afterwards (the nightly worker is not built), so a demo left open for a week
  is reset once a day. See docs/STATUS.md, "Keeping the demo fresh for a week".

  This truncates the demo database, which is remote (Supabase) and shared by
  everyone using the demo. Run it only on the owner's word: the scheduled task
  that calls it is registered by hand, for named days, and expires.

  It refuses to run unless the checkout's database/ and shared/ are exactly
  mvp's: a seed from a half-finished branch could truncate the demo and then
  fail against a schema Supabase does not have, leaving it empty.

  Writes a log to %LOCALAPPDATA%\HealthCareDemo\refresh.log. The log holds
  what the reset prints (row counts, the host) and never the connection string.
#>

# 'Continue', not 'Stop': Windows PowerShell 5.1 turns a native command's
# stderr into a terminating error under 'Stop', and pnpm writes progress there.
# Every native call below is judged by its exit code instead.
$ErrorActionPreference = 'Continue'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $env:LOCALAPPDATA 'HealthCareDemo'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'refresh.log'

function Write-Log([string] $message) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $log -Value "[$stamp UTC] $message" -Encoding utf8
}

Set-Location $repo
Write-Log "refresh starting in $repo"

# --- only mvp's seeds and schema ------------------------------------------
git diff --quiet mvp HEAD -- database shared
$differsFromMvp = $LASTEXITCODE -ne 0
git diff --quiet HEAD -- database shared
$uncommitted = $LASTEXITCODE -ne 0
if ($differsFromMvp -or $uncommitted) {
  $branch = git rev-parse --abbrev-ref HEAD
  Write-Log "skipped: database/ or shared/ on '$branch' differs from mvp. Check out mvp and run this again."
  exit 1
}

# pnpm.cmd rather than pnpm: on this machine `pnpm` resolves to npm's .ps1
# shim, which a scheduled task's execution policy may refuse to load.
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if ($null -eq $pnpm) {
  Write-Log 'skipped: pnpm.cmd is not on PATH for this account.'
  exit 1
}

# Appends a native command's output to the log as UTF-8. `*>>` would not do:
# 5.1 writes redirected output as UTF-16, which interleaves unreadably with
# Write-Log's lines.
function Invoke-Logged([string[]] $arguments) {
  & $pnpm @arguments 2>&1 | ForEach-Object { "$_" } | Add-Content -Path $log -Encoding utf8
  return $LASTEXITCODE
}

$env:ALLOW_REMOTE_DB = '1'

# Read-only, and first: a dead connection or a schema that has drifted fails
# here, before anything is truncated.
if ((Invoke-Logged @('db:verify')) -ne 0) {
  Write-Log 'stopped: db:verify failed, so nothing was truncated.'
  exit 1
}

$env:ALLOW_DESTRUCTIVE_DB = '1'
if ((Invoke-Logged @('db:reset')) -ne 0) {
  Write-Log 'FAILED: db:reset did not finish. The demo may be empty; run it again by hand.'
  exit 1
}

Write-Log 'refresh complete'
