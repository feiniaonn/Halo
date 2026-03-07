Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Join-Path $scriptDir '..\..'
$updateDir = Join-Path $repoRoot 'tools\update-test'
$oneClickDir = Join-Path $repoRoot '一键更新测试'
$deployConfigPath = Join-Path $oneClickDir 'deploy.config.json'

$buildScript = Join-Path $repoRoot 'scripts\build-installers-unsigned.ps1'
$tauriConfig = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
$latestFile = Join-Path $updateDir 'latest.json'
$noticeFile = Join-Path $oneClickDir '更新公告.txt'

if (-not (Test-Path -LiteralPath $buildScript)) { throw "Missing build script: $buildScript" }
if (-not (Test-Path -LiteralPath $tauriConfig)) { throw "Missing tauri config: $tauriConfig" }

function Get-InstallerVersionFromName {
  param([Parameter(Mandatory = $true)][string]$Name)
  if ($Name -match 'halo_([0-9]+\.[0-9]+\.[0-9]+)_x64-setup\.exe') {
    return $matches[1]
  }
  return $null
}

$forceBuild = $true
$configVersion = $null
if (Test-Path -LiteralPath $deployConfigPath) {
  try {
    $deployConfig = Get-Content -LiteralPath $deployConfigPath -Raw | ConvertFrom-Json
    if ($null -ne $deployConfig.forceBuild) {
      $forceBuild = [bool]$deployConfig.forceBuild
    }
    if ($deployConfig.releaseVersion) {
      $configVersion = [string]$deployConfig.releaseVersion
    }
  } catch {
    Write-Warning "Failed to parse deploy.config.json, use default options."
  }
}

if ($env:HALO_DEPLOY_FORCE_BUILD -match '^(0|false|False)$') {
  $forceBuild = $false
}

$installer = $null
if ($forceBuild) {
  Write-Host '[Step 1] Build installer package...' -ForegroundColor Yellow
  & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $buildScript
  if ($LASTEXITCODE -ne 0) { throw "Build failed. ExitCode=$LASTEXITCODE" }

  $nsisDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis'
  $built = Get-ChildItem -Path $nsisDir -Filter 'halo_*_x64-setup.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $built) { throw "No built installer found in $nsisDir" }

  Copy-Item -LiteralPath $built.FullName -Destination (Join-Path $updateDir $built.Name) -Force
  if (Test-Path -LiteralPath "$($built.FullName).sig") {
    Copy-Item -LiteralPath "$($built.FullName).sig" -Destination (Join-Path $updateDir "$($built.Name).sig") -Force
  }
  $installer = Get-Item -LiteralPath (Join-Path $updateDir $built.Name)
} else {
  Write-Host '[Step 1] Skip build (forceBuild=false), use existing installer...' -ForegroundColor Yellow
  $installer = Get-ChildItem -Path $updateDir -Filter 'halo_*_x64-setup.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) {
    throw "No installer found in $updateDir while forceBuild=false"
  }
}

$sigFile = "$($installer.FullName).sig"
if (-not (Test-Path -LiteralPath $sigFile)) { throw "Missing signature file: $sigFile" }

$conf = Get-Content -LiteralPath $tauriConfig -Raw | ConvertFrom-Json
$versionFromTauri = if ($conf.version) { [string]$conf.version } else { '0.0.0' }
$versionFromInstaller = Get-InstallerVersionFromName -Name $installer.Name
$version = if ($configVersion) { $configVersion } elseif ($versionFromInstaller) { $versionFromInstaller } else { $versionFromTauri }

if ($versionFromInstaller -and $versionFromTauri -and ($versionFromInstaller -ne $versionFromTauri)) {
  Write-Warning "Version mismatch: installer=$versionFromInstaller, tauri.conf=$versionFromTauri, latest.json will use $version"
}

$notes = ''
if (Test-Path -LiteralPath $noticeFile) { $notes = (Get-Content -LiteralPath $noticeFile -Raw).Trim() }

$endpoint = 'http://192.168.1.120:1421/latest.json'
if ($conf.plugins -and $conf.plugins.updater -and $conf.plugins.updater.endpoints -and $conf.plugins.updater.endpoints.Count -gt 0) {
  $endpoint = [string]$conf.plugins.updater.endpoints[0]
}
$baseUrl = $endpoint -replace '/latest\.json$',''

Write-Host '[Step 2] Generate latest.json from installer + announcement...' -ForegroundColor Yellow
$sig = (Get-Content -LiteralPath $sigFile -Raw).Trim()
$latest = [ordered]@{
  version = $version
  notes = $notes
  pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = $sig
      url = "$baseUrl/$($installer.Name)"
    }
  }
}

$latest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $latestFile -Encoding UTF8
Write-Host "[Success] latest.json generated: $latestFile" -ForegroundColor Green
Write-Host "[Info] Release version: $version"
Write-Host "[Info] Installer: $($installer.Name)"

Write-Host '[Step 3] Push release files to server...' -ForegroundColor Yellow
& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'push_only.ps1')
if ($LASTEXITCODE -ne 0) { throw "push_only failed. ExitCode=$LASTEXITCODE" }

Write-Host '[Success] Deploy completed.' -ForegroundColor Green
exit 0
