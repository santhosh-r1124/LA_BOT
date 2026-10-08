# Starts LA_BOT on this computer with Docker Desktop and opens it in the
# browser at http://localhost:3000. Run it by double-clicking
# START-LA-BOT.bat in the repo folder. Works with Windows PowerShell 5.1 and
# PowerShell 7.
#
#   Browser -> http://localhost:3000 (Next.js) -> /api/v1 proxy -> FastAPI
#   (API also published directly on http://localhost:8000, docs at /docs)
#
# Everything (Node, pnpm, Python, Postgres, Redis) runs inside Docker with the
# versions the project pins, so nothing on this computer needs matching
# versions. Common failures are diagnosed and repaired automatically.

$ErrorActionPreference = 'Continue'
$PreferredWebPort = 3000
$PreferredApiPort = 8000
$FallbackWebPorts = @(3010, 3020, 3030, 4010, 5010, 8090)
$FallbackApiPorts = @(8010, 8020, 8030, 9010, 9020)
$MaxStartAttempts = 4
# Old LA_BOT containers: this launcher (labot-*), the first manual setup
# (labot-api/-pg/-redis) and the repo's original dev stack (legal-platform-*).
$LaBotContainerPattern = '^(labot|legal-platform)'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) {
    Write-Host ''
    Write-Host "PROBLEM: $text" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------

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

function Set-Ports {
    $web = Select-Port $PreferredWebPort $FallbackWebPorts 'website'
    $api = Select-Port $PreferredApiPort $FallbackApiPorts 'API'
    if (-not $web -or -not $api) { Fail 'Could not find a free port for LA_BOT.' }
    $env:WEB_PORT = "$web"
    $env:API_PORT = "$api"
    Say "[ok] Website port $web, API port $api" Green
}

# ---------------------------------------------------------------------------
# Code, Docker and .env
# ---------------------------------------------------------------------------

function Update-Code([string]$repo) {
    # Fast-forward to the latest version on GitHub; never touches local edits.
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return }
    if (-not (Test-Path (Join-Path $repo '.git'))) { return }
    $dirty = git status --porcelain --untracked-files=no 2> $null
    if ($dirty) {
        Say 'Not updating the code: this folder has local changes.' Yellow
        return
    }
    # Never stop to ask for a GitHub login: fall back to the local code instead.
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'never'
    git pull --ff-only *> $null
    if ($LASTEXITCODE -eq 0) {
        Say '[ok] Code is up to date' Green
    } else {
        Say 'Could not check GitHub for updates - using the code already here.' Yellow
    }
}

function Test-DockerReady {
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Say 'Docker Desktop is not installed. LA_BOT needs it to run.' Yellow
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            $answer = Read-Host 'Install Docker Desktop now? (y/n)'
            if ($answer -match '^\s*y') {
                winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
                Fail 'Docker Desktop was installed. Restart the computer, open Docker Desktop once (accept its terms), then double-click START-LA-BOT.bat again.'
            }
        }
        Fail 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , start it, then run START-LA-BOT.bat again.'
    }
    if (Test-DockerReady) { return }

    $desktop = $null
    if ($env:ProgramFiles) { $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe' }
    if ($desktop -and (Test-Path $desktop)) {
        Say 'Docker Desktop is not running - starting it now...' Yellow
        Start-Process $desktop
    }
    Say 'Waiting for Docker to be ready (up to 5 minutes the first time)...'
    for ($i = 0; $i -lt 100; $i++) {
        Start-Sleep -Seconds 3
        if (Test-DockerReady) { return }
    }
    Fail 'Docker Desktop did not start. Open it and check its message. If it mentions WSL, open PowerShell as administrator, run "wsl --update", restart the computer, then run START-LA-BOT.bat again.'
}

function Assert-Compose {
    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail 'Your Docker is too old (no "docker compose"). Update Docker Desktop, then run START-LA-BOT.bat again.'
    }
}

function Repair-EnvFile([string]$envFile) {
    if (-not (Test-Path $envFile)) { return }
    # Docker Compose can't read UTF-16 or BOM-prefixed files: rewrite as plain ASCII.
    $bytes = [System.IO.File]::ReadAllBytes($envFile)
    if ($bytes.Length -ge 2 -and ($bytes[0] -eq 0xFF -or $bytes[0] -eq 0xFE -or $bytes[0] -eq 0xEF)) {
        $lines = Get-Content -Path $envFile
        Set-Content -Path $envFile -Value $lines -Encoding ascii
        Say '[fixed] .env was saved in a format Docker cannot read - converted it.' Green
    }
}

function Confirm-AiKey([string]$envFile) {
    $hasKey = (Test-Path $envFile) -and
        (Select-String -Path $envFile -Pattern '^\s*(GEMINI_API_KEY|GROQ_API_KEY)\s*=\s*\S' -Quiet)
    if ($hasKey) {
        Say '[ok] AI key found in .env' Green
        return
    }
    Say ''
    Say 'Legal chat and document drafts need a free Gemini API key.' Yellow
    Say 'Get one at https://aistudio.google.com/apikey (sign in, click "Create API key").'
    $key = Read-Host 'Paste your Gemini API key and press Enter (or just press Enter to skip)'
    if ($key) { $key = $key.Trim() }
    if (-not $key) {
        Say 'Skipped. The app will start, but chat and drafts will say the AI is not configured.' Yellow
        return
    }
    if ((Test-Path $envFile) -and (Get-Item $envFile).Length -gt 0) {
        $last = [System.IO.File]::ReadAllBytes($envFile)[-1]
        if ($last -ne 10) { Add-Content -Path $envFile -Value '' -Encoding ascii }
    }
    Add-Content -Path $envFile -Value "GEMINI_API_KEY=$key" -Encoding ascii
    Say '[ok] Key saved in .env' Green
}

# ---------------------------------------------------------------------------
# Build/start with automatic recovery
# ---------------------------------------------------------------------------

function Invoke-Docker([string[]]$arguments) {
    # Runs docker, shows its output live, and returns @{ Code; Text }.
    $lines = & docker @arguments 2>&1 | ForEach-Object {
        $line = "$_"
        Write-Host $line
        $line
    }
    return @{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
}

function Get-FailureKind([string]$text) {
    if ($text -match '(?i)port is already allocated|address already in use|only one usage of each socket address|ports are not available') { return 'port' }
    if ($text -match '(?i)no space left on device|not enough space|disk quota exceeded') { return 'disk' }
    if ($text -match '(?i)heap out of memory|exit code: 137|signal: killed|cannot allocate memory|ENOMEM') { return 'memory' }
    if ($text -match '(?i)cannot connect to the docker daemon|error during connect|docker daemon is not running|dockerDesktopLinuxEngine') { return 'engine' }
    if ($text -match '(?i)toomanyrequests|rate limit|tls handshake timeout|i/o timeout|connection reset|no such host|temporary failure in name resolution|failed to resolve|unexpected eof|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ERR_PNPM_META_FETCH_FAIL|could not connect to|network is unreachable') { return 'network' }
    return 'build'
}

function Repair-Failure([string]$kind, [int]$attempt) {
    # Fixes what it can before the next attempt. Returns extra build options.
    switch ($kind) {
        'port' {
            Say 'A port was taken while starting - picking free ports again.' Yellow
            docker compose down *> $null
            Set-Ports
        }
        'network' {
            $wait = 20 * $attempt
            Say "Download problem (internet or Docker Hub busy) - retrying in $wait seconds..." Yellow
            Start-Sleep -Seconds $wait
        }
        'disk' {
            Say 'Docker is out of disk space - clearing its old build cache and unused images.' Yellow
            docker builder prune -af *> $null
            docker image prune -f *> $null
        }
        'memory' {
            Say 'Docker ran out of memory while building - freeing cache and retrying.' Yellow
            Say '(If this keeps happening: close other apps, or raise Memory in Docker Desktop > Settings > Resources.)'
            docker builder prune -f *> $null
        }
        'engine' {
            Say 'Lost the connection to Docker - waiting for it to come back.' Yellow
            Assert-Docker
        }
        default {
            Say 'The build failed - clearing the build cache and rebuilding from scratch.' Yellow
            docker builder prune -f *> $null
            return @('--no-cache')
        }
    }
    return @()
}

function Start-Containers {
    $buildOptions = @()
    for ($attempt = 1; $attempt -le $MaxStartAttempts; $attempt++) {
        if ($attempt -gt 1) { Say ''; Say "Attempt $attempt of $MaxStartAttempts..." Cyan }
        if ($buildOptions.Count -gt 0) {
            $result = Invoke-Docker (@('compose', 'build') + $buildOptions)
            if ($result.Code -eq 0) { $result = Invoke-Docker @('compose', 'up', '-d') }
        } else {
            $result = Invoke-Docker @('compose', 'up', '--build', '-d')
        }
        if ($result.Code -eq 0) { return }
        $kind = Get-FailureKind $result.Text
        if ($attempt -eq $MaxStartAttempts) { break }
        $buildOptions = @(Repair-Failure $kind $attempt)
    }
    if ($kind -eq 'memory') {
        Fail 'Docker keeps running out of memory while building. Close other apps, or open Docker Desktop > Settings > Resources and raise Memory to at least 4 GB, then run START-LA-BOT.bat again.'
    }
    Fail 'LA_BOT could not be built or started even after automatic repairs. The reason is in the messages above - take a screenshot of this window and send it.'
}

function Wait-Ready([int]$web) {
    # 'ready', 'crashed' or 'timeout'
    for ($i = 0; $i -lt 100; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$web/health/ready" -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return 'ready' }
        } catch { }
        $state = docker compose ps app --format '{{.State}}' 2> $null
        if ("$state" -match 'exited|dead|restarting') { return 'crashed' }
        Start-Sleep -Seconds 3
    }
    return 'timeout'
}

function Start-AndVerify {
    Start-Containers
    Say ''
    Say 'Waiting for LA_BOT to finish starting...'
    $status = Wait-Ready ([int]$env:WEB_PORT)
    if ($status -eq 'ready') { return }

    $log = (docker compose logs app --tail 80 2>&1 | ForEach-Object { "$_" }) -join "`n"
    if ($log -match '(?i)alembic|sqlalchemy|asyncpg|psycopg|relation .* (does not exist|already exists)|password authentication failed') {
        Say ''
        Say 'LA_BOT could not set up its local database.' Yellow
        Say 'Resetting it rebuilds the database from scratch (advocates are re-imported; local test accounts and chats are removed).'
        $answer = Read-Host 'Reset the local LA_BOT database? (y/n)'
        if ($answer -match '^\s*y') {
            docker compose down -v *> $null
            Start-Containers
            if ((Wait-Ready ([int]$env:WEB_PORT)) -eq 'ready') { return }
        }
    } else {
        Say 'LA_BOT did not start cleanly - restarting it once.' Yellow
        docker compose restart app *> $null
        if ((Wait-Ready ([int]$env:WEB_PORT)) -eq 'ready') { return }
    }

    Say ''
    Say '----- last lines of the LA_BOT log -----' Yellow
    docker compose logs app --tail 60
    Fail 'LA_BOT did not start. The reason is in the log above - take a screenshot of this window and send it.'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Start-LaBot {
    $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    Set-Location $repo

    Say ''
    Say '=========================================' Cyan
    Say '   Starting LA_BOT on this computer' Cyan
    Say '=========================================' Cyan
    Say ''

    Update-Code $repo
    Assert-Docker
    Assert-Compose
    Say '[ok] Docker is running' Green

    $envFile = Join-Path $repo '.env'
    Repair-EnvFile $envFile
    Confirm-AiKey $envFile

    # Previous runs of this launcher and the first manual setup.
    docker compose down *> $null
    docker rm -f labot-api labot-pg labot-redis *> $null

    Set-Ports

    Say ''
    Say 'Building and starting LA_BOT. The first time takes 3-6 minutes...' Cyan
    Say ''
    Start-AndVerify

    $url = "http://localhost:$($env:WEB_PORT)"
    Say ''
    Say '=========================================' Green
    Say '   LA_BOT is running!' Green
    Say '=========================================' Green
    Say "   Website : $url"
    Say "   API     : http://localhost:$($env:API_PORT)   (docs: http://localhost:$($env:API_PORT)/docs)"
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
