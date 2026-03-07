Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-OpenSsh {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$Password
  )

  if ([string]::IsNullOrWhiteSpace($Password)) {
    & $Exe @Arguments
    return $LASTEXITCODE
  }

  $askPass = Join-Path $env:TEMP ("halo_askpass_{0}.cmd" -f ([guid]::NewGuid().ToString('N')))
  "@echo off`r`necho %HALO_SSH_PASS%`r`n" | Set-Content -LiteralPath $askPass -Encoding ASCII

  $oldAskPass = $env:SSH_ASKPASS
  $oldAskPassRequire = $env:SSH_ASKPASS_REQUIRE
  $oldDisplay = $env:DISPLAY
  $oldPass = $env:HALO_SSH_PASS
  try {
    $env:HALO_SSH_PASS = $Password
    $env:SSH_ASKPASS = $askPass
    $env:SSH_ASKPASS_REQUIRE = 'force'
    $env:DISPLAY = '1'
    & $Exe @Arguments
    return $LASTEXITCODE
  } finally {
    $env:SSH_ASKPASS = $oldAskPass
    $env:SSH_ASKPASS_REQUIRE = $oldAskPassRequire
    $env:DISPLAY = $oldDisplay
    $env:HALO_SSH_PASS = $oldPass
    Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Join-Path $scriptDir '..\..'
$updateDir = Join-Path $repoRoot 'tools\update-test'

$defaultHost = '192.168.1.120'
$defaultUser = 'root'
$defaultRemoteDir = '/opt/halo-update'

$targetHost = if ($env:HALO_DEPLOY_HOST) { $env:HALO_DEPLOY_HOST } else { $defaultHost }
$user = if ($env:HALO_DEPLOY_USER) { $env:HALO_DEPLOY_USER } else { $defaultUser }
$password = if ($env:HALO_DEPLOY_PASSWORD) { $env:HALO_DEPLOY_PASSWORD } else { '' }
$remoteDir = if ($env:HALO_DEPLOY_DIR) { $env:HALO_DEPLOY_DIR } else { $defaultRemoteDir }
$endpointBase = if ($env:HALO_DEPLOY_BASE_URL) { $env:HALO_DEPLOY_BASE_URL } else { "http://${targetHost}:1421" }

$latestFile = Join-Path $updateDir 'latest.json'
$installer = Get-ChildItem -Path $updateDir -Filter 'halo_*_x64-setup.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "No installer found in $updateDir" }
$sigFile = "$($installer.FullName).sig"
if (-not (Test-Path -LiteralPath $sigFile)) { throw "Missing signature file: $sigFile" }
if (-not (Test-Path -LiteralPath $latestFile)) { throw "Missing latest.json: $latestFile" }

$target = "$user@$targetHost"
Write-Host "[Halo] Push target: $target" -ForegroundColor Yellow
Write-Host "[Info] Remote dir: $remoteDir"

$sshArgs = @('-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=8')
$scpArgs = @('-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=8')
if ([string]::IsNullOrWhiteSpace($password)) {
  $sshArgs += @('-o','BatchMode=yes')
  $scpArgs += @('-o','BatchMode=yes')
}

if (-not [string]::IsNullOrWhiteSpace($password)) {
  $probeRc = Invoke-OpenSsh -Exe 'ssh' -Arguments ($sshArgs + @("$target", "echo auth-ok")) -Password $password
  if ($probeRc -ne 0) {
    Write-Warning "Password auth failed for $target, fallback to key auth."
    $password = ''
    $sshArgs = @('-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=8','-o','BatchMode=yes')
    $scpArgs = @('-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=8','-o','BatchMode=yes')
  }
}

$rc = Invoke-OpenSsh -Exe 'ssh' -Arguments ($sshArgs + @("$target", "mkdir -p '$remoteDir'")) -Password $password
if ($rc -ne 0) { throw 'ssh mkdir failed' }

$rc = Invoke-OpenSsh -Exe 'scp' -Arguments ($scpArgs + @("$latestFile", "$target`:$remoteDir/latest.json")) -Password $password
if ($rc -ne 0) { throw 'scp latest.json failed' }

$rc = Invoke-OpenSsh -Exe 'scp' -Arguments ($scpArgs + @("$($installer.FullName)", "$target`:$remoteDir/$($installer.Name)")) -Password $password
if ($rc -ne 0) { throw 'scp installer failed' }

$rc = Invoke-OpenSsh -Exe 'scp' -Arguments ($scpArgs + @("$sigFile", "$target`:$remoteDir/$($installer.Name).sig")) -Password $password
if ($rc -ne 0) { throw 'scp signature failed' }

Write-Host '[Success] Push finished.' -ForegroundColor Green

try {
  $probe = Invoke-WebRequest -Uri "$endpointBase/latest.json" -UseBasicParsing -TimeoutSec 8
  Write-Host "[Info] Endpoint check status: $($probe.StatusCode)"
} catch {
  Write-Warning "Endpoint probe failed: $($_.Exception.Message)"
}

exit 0
