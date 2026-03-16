Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = (Get-Location).Path }
$projectRoot = Join-Path $scriptDir '..'
$mpvExe = Join-Path $projectRoot 'src-tauri\resources\mpv\windows\mpv.exe'
$libmpvWrapper = Join-Path $projectRoot 'src-tauri\lib\libmpv-wrapper.dll'
$libmpvCore = Join-Path $projectRoot 'src-tauri\lib\libmpv-2.dll'
if (
  -not (Test-Path -LiteralPath $mpvExe) -or
  -not (Test-Path -LiteralPath $libmpvWrapper) -or
  -not (Test-Path -LiteralPath $libmpvCore)
) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'fetch-mpv-from-official.ps1')
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
$entryFile = Get-ChildItem -Path $projectRoot -Recurse -File -Filter '03_*.ps1' -ErrorAction SilentlyContinue |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.Directory.FullName '_publish_common.ps1') } |
  Sort-Object FullName |
  Select-Object -First 1

if ($null -eq $entryFile) {
  throw 'Missing entry script matching 03_*.ps1'
}

& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $entryFile.FullName
exit $LASTEXITCODE
