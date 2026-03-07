Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = (Get-Location).Path }
$projectRoot = Join-Path $scriptDir '..'
$entryFile = Get-ChildItem -Path $projectRoot -Recurse -File -Filter '03_*.ps1' -ErrorAction SilentlyContinue |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.Directory.FullName '_publish_common.ps1') } |
  Sort-Object FullName |
  Select-Object -First 1

if ($null -eq $entryFile) {
  throw 'Missing entry script matching 03_*.ps1'
}

& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $entryFile.FullName
exit $LASTEXITCODE
