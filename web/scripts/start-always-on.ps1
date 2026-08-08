$ErrorActionPreference = "Stop"

Write-Host "========================================="
Write-Host " Starting Hermes Always-On Mode"
Write-Host "========================================="

$port = 8766
if ($env:WAKE_PORT) { $port = $env:WAKE_PORT }

# Start Wake Daemon in background
Write-Host "[Always-On] Launching Wake Daemon..."
$daemonJob = Start-Job -ScriptBlock {
    param($scriptPath)
    # Using Call Operator inside Job
    & $scriptPath
} -ArgumentList "$PSScriptRoot\start-wake.ps1"

Write-Host "[Always-On] Waiting for Wake Daemon on port $port..."
$maxRetries = 20
$retryCount = 0
$isListening = $false

while ($retryCount -lt $maxRetries) {
    $conn = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($conn) {
        $isListening = $true
        break
    }
    
    # Check if job failed
    if ($daemonJob.State -ne 'Running' -and $daemonJob.State -ne 'NotStarted') {
        Receive-Job $daemonJob
        Write-Error "Wake Daemon stopped unexpectedly!"
    }

    Start-Sleep -Seconds 1
    $retryCount++
}

if (-not $isListening) {
    Receive-Job $daemonJob
    Write-Error "Wake Daemon failed to start or bind to port $port in time."
}

Write-Host "[Always-On] Wake Daemon is LISTENING!"

# Start Vinext UI in background
Write-Host "[Always-On] Starting Hermes Web UI (vinext dev)..."
Set-Location "$PSScriptRoot\.."
$vinextJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:WRANGLER_LOG_PATH = ".wrangler\wrangler.log"
    & node ".\node_modules\vinext\dist\cli.js" dev --port 3000 --strictPort --host 127.0.0.1
} -ArgumentList "$PSScriptRoot\.."

# Wait briefly for Vinext to bind a port (usually 3000 or 3001)
Start-Sleep -Seconds 4

# Start local-preview proxy in foreground
Write-Host "[Always-On] Starting Proxy server (local-preview.mjs) on port 4174..."
$env:HERMES_UI_UPSTREAM_PORT = "3000" # Assumes Vinext grabbed 3000. 
$env:PORT = "4174"

Write-Host "[Always-On] Opening Browser at http://127.0.0.1:4174"
Start-Process "http://127.0.0.1:4174"

try {
    & node .\scripts\local-preview.mjs
} finally {
    Write-Host "[Always-On] Shutting down..."
    Stop-Job $daemonJob
    Remove-Job $daemonJob
    Stop-Job $vinextJob
    Remove-Job $vinextJob
}
