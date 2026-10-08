# Starts LA_BOT on this computer with Docker Desktop and opens it in the
# browser. Run it by double-clicking START-LA-BOT.bat in the repo folder.
# Works with Windows PowerShell 5.1 and PowerShell 7.

$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) {
    Write-Host ''
    Write-Host "PROBLEM: $text" -ForegroundColor Red
    exit 1
}
function Test-PortFree([int]$port) {
    foreach ($address in @([System.Net.IPAddress]::Loopback, [System.Net.IPAddress]::Any)) {
        try {
            $listener = New-Object System.Net.Sockets.TcpListener($address, $port)
            $listener.Start()
            $listener.Stop()
        } catch {
            return $false
        }
    }
    return $true
}
function Find-FreePort([int[]]$candidates) {
    foreach ($port in $candidates) {
        if (Test-PortFree $port) { return $port }
    }
    return $null
}

Say ''
Say '=========================================' Cyan
Say '   Starting LA_BOT on this computer' Cyan
Say '=========================================' Cyan
Say ''

# --- 1. Docker Desktop -------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , start it, then run START-LA-BOT.bat again.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $desktop = $null
    if ($env:ProgramFiles) { $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe' }
    if ($desktop -and (Test-Path $desktop)) {
        Say 'Docker Desktop is not running - starting it now...' Yellow
        Start-Process $desktop
    }
    Say 'Waiting for Docker to be ready (this can take a minute)...'
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 3
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { break }
    }
    if ($LASTEXITCODE -ne 0) {
        Fail 'Docker Desktop is not running. Open Docker Desktop, wait until it says "Engine running", then run START-LA-BOT.bat again.'
    }
}
Say '[ok] Docker is running' Green

# --- 2. AI key in .env ------------------------------------------------------------
$envFile = Join-Path $repo '.env'
if (Test-Path $envFile) {
    # Docker Compose can't read UTF-16 or BOM-prefixed files: rewrite as plain ASCII.
    $bytes = [System.IO.File]::ReadAllBytes($envFile)
    if ($bytes.Length -ge 2 -and ($bytes[0] -eq 0xFF -or $bytes[0] -eq 0xFE -or $bytes[0] -eq 0xEF)) {
        $lines = Get-Content -Path $envFile
        Set-Content -Path $envFile -Value $lines -Encoding ascii
    }
}
$hasKey = (Test-Path $envFile) -and
    (Select-String -Path $envFile -Pattern '^\s*(GEMINI_API_KEY|GROQ_API_KEY)\s*=\s*\S' -Quiet)
if (-not $hasKey) {
    Say ''
    Say 'Legal chat and document drafts need a free Gemini API key.' Yellow
    Say 'Get one at https://aistudio.google.com/apikey (sign in, click "Create API key").'
    $key = Read-Host 'Paste your Gemini API key and press Enter (or just press Enter to skip)'
    if ($key) { $key = $key.Trim() }
    if ($key) {
        if ((Test-Path $envFile) -and (Get-Item $envFile).Length -gt 0) {
            $last = [System.IO.File]::ReadAllBytes($envFile)[-1]
            if ($last -ne 10) { Add-Content -Path $envFile -Value '' -Encoding ascii }
        }
        Add-Content -Path $envFile -Value "GEMINI_API_KEY=$key" -Encoding ascii
        Say '[ok] Key saved in .env' Green
    } else {
        Say 'Skipped. The app will start, but chat and drafts will say the AI is not configured.' Yellow
    }
} else {
    Say '[ok] AI key found in .env' Green
}

# --- 3. Clear out old LA_BOT containers --------------------------------------
docker rm -f labot-api labot-pg labot-redis *> $null
docker compose down *> $null

# --- 4. Pick free ports -------------------------------------------------------
$web = Find-FreePort @(3010, 3020, 3030, 3040, 3050, 4010, 5010, 8090)
$api = Find-FreePort @(8010, 8020, 8030, 8040, 8050, 9010, 9020)
if (-not $web -or -not $api) { Fail 'Could not find a free port for the app.' }
$env:WEB_PORT = "$web"
$env:API_PORT = "$api"
Say "[ok] Using port $web for the website and $api for the API" Green

# --- 5. Build and start -----------------------------------------------------------
Say ''
Say 'Building and starting LA_BOT. The first time takes 3-6 minutes...' Cyan
Say ''
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Fail 'Docker could not build or start LA_BOT. The reason is in the messages above - take a screenshot of this window and send it.'
}

# --- 6. Wait until it answers -------------------------------------------------
Say ''
Say 'Waiting for LA_BOT to finish starting...'
$ok = $false
for ($i = 0; $i -lt 100; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$web/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
    $state = docker compose ps app --format '{{.State}}' 2> $null
    if ("$state" -match 'exited|dead|restarting') { break }
    Start-Sleep -Seconds 3
}
if (-not $ok) {
    Say ''
    Say '----- last lines of the LA_BOT log -----' Yellow
    docker compose logs app --tail 60
    Fail 'LA_BOT did not start. The reason is in the log above - take a screenshot of this window and send it.'
}

$url = "http://localhost:$web"
Say ''
Say '=========================================' Green
Say '   LA_BOT is running!' Green
Say '=========================================' Green
Say "   Website : $url"
Say "   API docs: http://localhost:$api/docs"
Say "   Admin   : admin@labot.local / admin12345  ($url/advocates/import)"
Say ''
Say '   To stop it, double-click STOP-LA-BOT.bat.'
Say ''
try {
    Start-Process $url
} catch {
    Say "Open $url in your browser." Yellow
}
