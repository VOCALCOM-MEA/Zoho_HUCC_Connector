# Pack Vocalcom HUCC Zoho Sigma extension into dist/vocalcom_hucc.zip
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot "..\extension"),
    [string]$OutputDir = (Join-Path $PSScriptRoot "..\dist"),
    [string]$ZipName = "vocalcom_hucc.zip"
)

$ErrorActionPreference = "Stop"

$ExtensionRoot = (Resolve-Path $ExtensionRoot).Path
$OutputDir = (Resolve-Path $OutputDir -ErrorAction SilentlyContinue)
if (-not $OutputDir) {
    $OutputDir = Join-Path $PSScriptRoot "..\dist"
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    $OutputDir = (Resolve-Path $OutputDir).Path
}

$zipPath = Join-Path $OutputDir $ZipName
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "Packing extension from: $ExtensionRoot"
Write-Host "Output: $zipPath"

# Validate JSON manifests
$manifestPath = Join-Path $ExtensionRoot "plugin-manifest.json"
$settingsPath = Join-Path $ExtensionRoot "config\settings.json"
foreach ($jsonFile in @($manifestPath, $settingsPath)) {
    if (-not (Test-Path $jsonFile)) {
        throw "Missing required file: $jsonFile"
    }
    Get-Content $jsonFile -Raw | ConvertFrom-Json | Out-Null
    Write-Host "Validated JSON: $jsonFile"
}

Compress-Archive -Path (Join-Path $ExtensionRoot "*") -DestinationPath $zipPath -Force

$size = (Get-Item $zipPath).Length
Write-Host "Created $zipPath ($size bytes)"
