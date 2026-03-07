param(
  [string]$CargoTargetDir = "$PSScriptRoot\..\src-tauri\target"
)

$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
Set-Location $root

if (-not (Test-Path $CargoTargetDir)) {
  New-Item -ItemType Directory -Path $CargoTargetDir | Out-Null
}
$env:CARGO_TARGET_DIR = $CargoTargetDir

# Avoid stale bundle resources (especially icon cache in target\release\resources).
$releaseBundleDir = Join-Path $root 'src-tauri\target\release\bundle'
$releaseResourcesDir = Join-Path $root 'src-tauri\target\release\resources'
if (Test-Path -LiteralPath $releaseBundleDir) {
  Remove-Item -LiteralPath $releaseBundleDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $releaseResourcesDir) {
  Remove-Item -LiteralPath $releaseResourcesDir -Recurse -Force -ErrorAction SilentlyContinue
}

pnpm tauri build --bundles msi nsis --config src-tauri/tauri.build.unsigned.json
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
