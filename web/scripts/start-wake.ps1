$ErrorActionPreference = "Stop"

# Use virtual environment if present
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$pythonExe = "python"
if (Test-Path "$rootDir\venv\Scripts\python.exe") {
    $pythonExe = "$rootDir\venv\Scripts\python.exe"
} elseif (Test-Path "$rootDir\.venv\Scripts\python.exe") {
    $pythonExe = "$rootDir\.venv\Scripts\python.exe"
}

$model = "hey_jarvis"
if ($env:WAKE_MODEL) { $model = $env:WAKE_MODEL }

$port = 8766
if ($env:WAKE_PORT) { $port = $env:WAKE_PORT }

Write-Host "[start-wake] Checking python environment using: $pythonExe"
if (!(Get-Command $pythonExe -ErrorAction SilentlyContinue)) {
    Write-Error "Python not found. Please install Python or set up a venv."
}

Write-Host "[start-wake] Checking openwakeword installation..."
$owwCheck = & $pythonExe -c "import openwakeword; print('OK')" 2>&1
if ($owwCheck -notmatch "OK") {
    Write-Error "openwakeword is not installed or has DLL issues. Please check your environment.`n$owwCheck"
}

Write-Host "[start-wake] Ensuring model '$model' is downloaded..."
# This ensures it exists before the daemon tries to run
$downloadScript = "
import sys
try:
    from openwakeword.utils import download_models
    download_models(['$model'])
    print('OK')
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
"
$downloadRes = & $pythonExe -c $downloadScript 2>&1
if ($downloadRes -notmatch "OK") {
    Write-Error "Failed to download model '$model'.`n$downloadRes"
}

Write-Host "[start-wake] Starting wake-detector.py on port $port with model $model"
& $pythonExe "$PSScriptRoot\wake-detector.py" --model $model --port $port

