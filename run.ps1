# One-command local demo (FR-DEM-06, FR-SEC-08). No cloud credentials needed.
[CmdletBinding()]
param(
    [switch]$Background,
    [switch]$Stop,
    [switch]$SetupOnly,
    [switch]$SkipInstall,
    [ValidateSet('Django', 'Node')]
    [string]$ApiBackend = 'Django',
    [string]$WslDistribution = 'Ubuntu',
    [ValidateSet('Auto', 'Docker', 'WSL', 'Existing')]
    [string]$DatabaseProvider = 'Auto'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localDir = Join-Path $PSScriptRoot '.local'
$statePath = Join-Path $localDir 'run-state.json'
$serviceScript = Join-Path $PSScriptRoot 'scripts/dev-service.mjs'
$env:LOCAL_API_BACKEND = $ApiBackend
New-Item -ItemType Directory -Path $localDir -Force | Out-Null

function Invoke-Pnpm {
    & corepack pnpm @args
    if ($LASTEXITCODE -ne 0) { throw "pnpm failed with exit code $LASTEXITCODE" }
}

function Get-OwnedProcesses {
    if (!(Test-Path -LiteralPath $statePath)) { return @() }
    $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    foreach ($entry in $saved) {
        $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime() -eq ([datetime]$entry.StartTime).ToUniversalTime()) {
            $details = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.Id)"
            if ($details.CommandLine -and $details.CommandLine.Contains($serviceScript)) { $process }
        }
    }
}

function Stop-Apps {
    foreach ($process in @(Get-OwnedProcesses)) {
        & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
}

if ($Stop) {
    Stop-Apps
    Write-Host 'Stopped this workspace''s apps. Database and data are kept.'
    return
}
if (@(Get-OwnedProcesses).Count -gt 0) {
    throw 'This workspace is already running. Use .\run.ps1 -Stop before restarting.'
}
if (!(Get-Command node -ErrorAction SilentlyContinue) -or !(Get-Command corepack -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22.19+ with Corepack first (Node 24 recommended).'
}
if ([version]((& node --version).TrimStart('v')) -lt [version]'22.19.0') { throw 'Node.js 22.19+ required.' }
# Package scripts themselves invoke pnpm; give them a writable local shim.
$binDir = Join-Path $localDir 'bin'
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
& corepack enable pnpm --install-directory $binDir
if ($LASTEXITCODE -ne 0) { throw 'Could not create the local pnpm shim.' }
$env:PATH = "$binDir;$env:PATH"
& node scripts/setup-local.mjs --env-only
if ($LASTEXITCODE -ne 0) { throw 'Local environment validation failed.' }
if (!$SkipInstall) { Invoke-Pnpm install --frozen-lockfile }
if ($ApiBackend -eq 'Django') {
    $pythonPath = Join-Path $PSScriptRoot 'backend/django/.venv/Scripts/python.exe'
    if (!(Test-Path -LiteralPath $pythonPath)) {
        & python -m venv (Join-Path $PSScriptRoot 'backend/django/.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required for the Django API.' }
    }
    if (!$SkipInstall) {
        & $pythonPath -m pip install -r backend/django/requirements.lock.txt
        if ($LASTEXITCODE -ne 0) { throw 'Django dependency installation failed.' }
    }
}

# Reuse the configured local database first; otherwise start Docker or WSL.
if ($DatabaseProvider -eq 'Auto') {
    & node scripts/setup-local.mjs --connection-only *> $null
    if ($LASTEXITCODE -eq 0) { $DatabaseProvider = 'Existing' }
}
if ($DatabaseProvider -eq 'Auto') {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) { $DatabaseProvider = 'Docker' }
    }
    if ($DatabaseProvider -eq 'Auto') {
        $distros = (& wsl.exe --list --quiet 2>$null) -replace "`0", ''
        if ($distros -contains $WslDistribution) { $DatabaseProvider = 'WSL' }
        else { throw 'Start Docker Desktop, or install Ubuntu 24.04 in WSL. For an existing local database use -DatabaseProvider Existing.' }
    }
}
if ($DatabaseProvider -eq 'Docker') {
    & docker compose up -d --wait db
    if ($LASTEXITCODE -ne 0) { throw 'Docker database failed to start.' }
} elseif ($DatabaseProvider -eq 'WSL') {
    # WSL stops even systemd services after the last Windows client leaves.
    # Keep a client open so Postgres stays available to Windows Node processes.
    $keeperPath = Join-Path $localDir 'wsl-state.json'
    $keeperAlive = $false
    if (Test-Path -LiteralPath $keeperPath) {
        $savedKeeper = Get-Content -LiteralPath $keeperPath -Raw | ConvertFrom-Json
        $keeperProcess = Get-Process -Id $savedKeeper.Id -ErrorAction SilentlyContinue
        if ($keeperProcess -and $keeperProcess.ProcessName -eq 'wsl') {
            $keeperAlive = $keeperProcess.StartTime.ToUniversalTime() -eq ([datetime]$savedKeeper.StartTime).ToUniversalTime()
        }
    }
    if (!$keeperAlive) {
        $keeper = Start-Process -FilePath wsl.exe -ArgumentList @('-d', $WslDistribution, '--', 'sleep', 'infinity') -WindowStyle Hidden -PassThru
        [pscustomobject]@{ Id = $keeper.Id; StartTime = $keeper.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $keeperPath
    }
    $script = (Get-Content scripts/local-db-wsl.sh -Raw).Replace("`r", '')
    $script | & wsl.exe -d $WslDistribution -u root -- bash -c "tr -d '\r' | bash"
    if ($LASTEXITCODE -ne 0) { throw 'Ubuntu WSL database setup failed.' }
}
Invoke-Pnpm db:migrate
& node scripts/setup-local.mjs
if ($LASTEXITCODE -eq 10) { Invoke-Pnpm db:seed }
elseif ($LASTEXITCODE -ne 0) { throw 'Database inspection failed.' }
Invoke-Pnpm db:verify
Invoke-Pnpm db:role
if ($SetupOnly) { Write-Host 'Dependencies, environment and database are ready.'; return }

$services = @('api', 'patient', 'console', 'site')
$ports = @(4000, 3000, 3100, 3200)
foreach ($port in $ports) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is occupied. Stop that process before starting the project."
    }
}
$started = @()
try {
    foreach ($service in $services) {
        $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList @("`"$serviceScript`"", $service) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localDir "$service.log") -RedirectStandardError (Join-Path $localDir "$service.error.log")
        $started += [pscustomobject]@{ Id = $process.Id; StartTime = $process.StartTime.ToUniversalTime().ToString('o'); Service = $service }
        ConvertTo-Json -InputObject @($started) | Set-Content -LiteralPath $statePath
    }
    foreach ($url in @('http://localhost:4000/readyz', 'http://localhost:3000', 'http://localhost:3100', 'http://localhost:3200/en')) {
        $deadline = (Get-Date).AddMinutes(4)
        $ready = $false
        do {
            if (@(Get-OwnedProcesses).Count -ne $services.Count) { throw "An app exited. Read .local/*.error.log and .local/*.log." }
            try {
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
                $ready = $response.StatusCode -eq 200
            } catch { Start-Sleep -Seconds 1 }
        } until ($ready -or (Get-Date) -ge $deadline)
        if (!$ready) { throw "Timed out starting $url. Read .local/*.log." }
    }
    Write-Host "`nMedLiveBD is running (synthetic demo data):"
    Write-Host 'Patient: http://localhost:3000'
    Write-Host 'Console: http://localhost:3100'
    Write-Host 'API:     http://localhost:4000/readyz'
    Write-Host 'Site:    http://localhost:3200/en'
    Write-Host 'Logs:    .local/*.log'
    Write-Host 'Stop:    .\run.ps1 -Stop'
    if ($Background) { return }
    Write-Host 'Press Ctrl+C here to stop the apps.'
    while (@(Get-OwnedProcesses).Count -eq $services.Count) { Start-Sleep -Seconds 2 }
    throw 'An app exited; inspect .local/*.log.'
} catch {
    Stop-Apps
    throw
} finally {
    if (!$Background) { Stop-Apps }
}
