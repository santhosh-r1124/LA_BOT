# Starts LA_BOT on this computer with Docker Desktop and opens it in the
# browser at http://localhost:3000. Run it by double-clicking
# START-LA-BOT.bat in the repo folder. Works with Windows PowerShell 5.1 and
# PowerShell 7.
#
#   Browser -> http://localhost:3000 (Next.js) -> /api/v1 proxy -> FastAPI
#   (API also published directly on http://localhost:8000, docs at /docs)

$ErrorActionPreference = 'Continue'
$PreferredWebPort = 3000
$PreferredApiPort = 8000
$FallbackWebPorts = @(3010, 3020, 3030, 4010, 5010, 8090)
$FallbackApiPorts = @(8010, 8020, 8030, 9010, 9020)
# Old LA_BOT containers: this launcher (labot-*), the first manual setup
# (labot-api/-pg/-redis) and the repo's original dev stack (legal-platform-*).
$LaBotContainerPattern = '^(labot|legal-platform)'

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

function Get-ContainersOnPort([int]$port) {
    # "name|image" for each running container publishing $port.
    $rows = docker ps --filter "publish=$port" --format '{{.Names}}|{{.Image}}' 2> $null
    return @($rows | Where-Object { $_ })
}

function Get-PortProcess([int]$port) {
    # Windows only: the process listening on $port (null elsewhere or if unknown).
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return $null }
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Select-Object -First 1
        if (-not $conn) { return $null }
        $owner = [int]$conn.OwningProcess
        $info = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction Stop
        return [pscustomobject]@{
            Id          = $owner
            Name        = [string]$info.Name
            CommandLine = [string]$info.CommandLine
        }
    } catch {
        return $null
    }
}

function Wait-PortFree([int]$port) {
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-PortFree $port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Clear-Port([int]$port, [string]$what) {
    # Try to make $port available. LA_BOT leftovers are stopped automatically;
    # anything else is only stopped if the user agrees. Returns $true if free.
    if (Test-PortFree $port) { return $true }

    foreach ($row in Get-ContainersOnPort $port) {
        $name = $row.Split('|')[0]
        $image = $row.Split('|')[1]
        if ($name -match $LaBotContainerPattern) {
            Say "Port $port is used by an old LA_BOT container ($name) - stopping it." Yellow
            docker stop $name *> $null
        } else {
            Say "Port $port is used by the Docker container '$name' (image $image)." Yellow
            $answer = Read-Host "Stop that container so LA_BOT can use port $port? (y/n)"
            if ($answer -match '^\s*y') { docker stop $name *> $null }
        }
    }
    if (Wait-PortFree $port) { return $true }

    $proc = Get-PortProcess $port
    if ($proc -and $proc.Name -notmatch '^(com\.docker|vpnkit|wslrelay|docker|System$|svchost)') {
        $cmd = $proc.CommandLine
        if ($cmd.Length -gt 160) { $cmd = $cmd.Substring(0, 160) + '...' }
        $isLaBot = $cmd -match '(?i)LA_BOT|legal-platform'
        if ($isLaBot) {
            Say "Port $port is used by an old LA_BOT process ($($proc.Name), PID $($proc.Id)) - stopping it." Yellow
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        } else {
            Say "Port $port ($what) is used by another program:" Yellow
            Say "   $($proc.Name) (PID $($proc.Id))"
            if ($cmd) { Say "   $cmd" }
            $answer = Read-Host "Stop this program so LA_BOT can use port $port? (y/n)"
            if ($answer -match '^\s*y') {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        if (Wait-PortFree $port) { return $true }
    }
    return (Test-PortFree $port)
}

function Select-Port([int]$preferred, [int[]]$fallbacks, [string]$what) {
    if (Clear-Port $preferred $what) { return $preferred }
    foreach ($port in $fallbacks) {
        if (Test-PortFree $port) {
            Say "Port $preferred stays in use, so the $what will use port $port instead." Yellow
            return $port
        }
    }
    return $null
}

function Start-LaBot {
    $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    Set-Location $repo

    Say ''
    Say '=========================================' Cyan
    Say '   Starting LA_BOT on this computer' Cyan
    Say '=========================================' Cyan
    Say ''

    # --- 1. Docker Desktop ---------------------------------------------------
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

    # --- 2. AI key in .env ------------------------------------------------------
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

    # --- 3. Stop this launcher's previous run and old manual containers ---------
    docker compose down *> $null
    docker rm -f labot-api labot-pg labot-redis *> $null

    # --- 4. Ports: website on 3000, API on 8000 ----------------------------------
    $web = Select-Port $PreferredWebPort $FallbackWebPorts 'website'
    $api = Select-Port $PreferredApiPort $FallbackApiPorts 'API'
    if (-not $web -or -not $api) { Fail 'Could not find a free port for LA_BOT.' }
    $env:WEB_PORT = "$web"
    $env:API_PORT = "$api"
    Say "[ok] Website port $web, API port $api" Green

    # --- 5. Build and start -------------------------------------------------------
    Say ''
    Say 'Building and starting LA_BOT. The first time takes 3-6 minutes...' Cyan
    Say ''
    docker compose up --build -d
    if ($LASTEXITCODE -ne 0) {
        Fail 'Docker could not build or start LA_BOT. The reason is in the messages above - take a screenshot of this window and send it.'
    }

    # --- 6. Wait until it answers ---------------------------------------------
    Say ''
    Say 'Waiting for LA_BOT to finish starting...'
    $ok = $false
    for ($i = 0; $i -lt 100; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$web/health/ready" -UseBasicParsing -TimeoutSec 5
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
    Say "   API     : http://localhost:$api   (docs: http://localhost:$api/docs)"
    Say "   Admin   : admin@labot.local / admin12345  ($url/advocates/import)"
    Say ''
    Say '   On the home page, click "Test AI connection" to check your Gemini key.'
    Say '   To stop LA_BOT, double-click STOP-LA-BOT.bat.'
    Say ''
    try {
        Start-Process $url
    } catch {
        Say "Open $url in your browser." Yellow
    }
}

# Dot-sourcing (tests) only loads the functions above.
if ($MyInvocation.InvocationName -ne '.') { Start-LaBot }
