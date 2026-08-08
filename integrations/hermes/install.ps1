param(
    [Parameter(Mandatory = $true)]
    [string]$HermesPath,
    [string]$VaultUrl = "https://arkan-server.tail9b08be.ts.net",
    [string]$Project = "",
    [string]$HermesHome = ""
)

$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePlugin = Join-Path $PSScriptRoot "plugins\memory\arkan"
$sdkPath = Join-Path $sourceRoot "sdk\python"
$hermesRoot = (Resolve-Path -LiteralPath $HermesPath).Path
if (-not $HermesHome) { $HermesHome = Split-Path -Parent $hermesRoot }
$hermesHomePath = [System.IO.Path]::GetFullPath($HermesHome)

if (-not (Test-Path -LiteralPath (Join-Path $hermesRoot "agent\memory_provider.py"))) {
    throw "HermesPath does not look like a Hermes Agent checkout: $hermesRoot"
}

$targetPlugin = Join-Path $hermesRoot "plugins\memory\arkan"
New-Item -ItemType Directory -Path $targetPlugin -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourcePlugin "__init__.py") -Destination (Join-Path $targetPlugin "__init__.py") -Force

$envFile = Join-Path $hermesHomePath ".env"
$settings = [ordered]@{
    "ARKAN_VAULT_URL" = $VaultUrl
    "ARKAN_VAULT_SDK_PATH" = $sdkPath
}
if ($Project) { $settings["ARKAN_VAULT_PROJECT"] = $Project }

$existing = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile } else { @() }
foreach ($key in $settings.Keys) {
    $existing = @($existing | Where-Object { $_ -notmatch "^$([regex]::Escape($key))=" })
    $existing += "$key=$($settings[$key])"
}
[System.IO.File]::WriteAllLines($envFile, $existing, [System.Text.UTF8Encoding]::new($false))

Write-Host "Arkan provider installed at $targetPlugin"
Write-Host "Run: hermes memory setup"
Write-Host "Choose provider: arkan"
