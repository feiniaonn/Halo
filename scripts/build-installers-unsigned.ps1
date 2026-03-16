param(
  [string]$CargoTargetDir = "$PSScriptRoot\..\src-tauri\target",
  [string]$SigningPrivateKeyPath = "",
  [string]$SigningPrivateKeyPassword = ""
)

$ErrorActionPreference = "Stop"

function Unprotect-Secret([string]$cipher) {
  if ([string]::IsNullOrWhiteSpace($cipher)) { return '' }
  $secure = $cipher | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Get-OneClickPublishDir([string]$ProjectRoot) {
  Get-ChildItem -LiteralPath $ProjectRoot -Directory |
    Where-Object {
      (Test-Path -LiteralPath (Join-Path $_.FullName 'deploy.config.json')) -and
      (Test-Path -LiteralPath (Join-Path $_.FullName '_publish_common.ps1'))
    } |
    Select-Object -First 1 -ExpandProperty FullName
}

function Resolve-UpdaterSigningSecrets([string]$ProjectRoot, [string]$ProvidedKeyPath, [string]$ProvidedKeyPassword) {
  if (-not [string]::IsNullOrWhiteSpace($ProvidedKeyPath)) {
    if (-not (Test-Path -LiteralPath $ProvidedKeyPath)) {
      throw "TAURI signing private key not found: $ProvidedKeyPath"
    }
    return [pscustomobject]@{
      KeyPath = (Resolve-Path -LiteralPath $ProvidedKeyPath).Path
      Password = $ProvidedKeyPassword
      Source = 'script arguments'
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
    return [pscustomobject]@{
      KeyPath = $env:TAURI_SIGNING_PRIVATE_KEY
      Password = if (-not [string]::IsNullOrWhiteSpace($SigningPrivateKeyPassword)) {
        $SigningPrivateKeyPassword
      } else {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
      }
      Source = 'environment variables'
    }
  }

  $oneClickDir = Get-OneClickPublishDir -ProjectRoot $ProjectRoot
  if ([string]::IsNullOrWhiteSpace($oneClickDir)) {
    throw 'Missing updater signing configuration: no one-click publish directory was found.'
  }

  $secretsPath = Join-Path $oneClickDir '.publish-secrets.json'
  if (-not (Test-Path -LiteralPath $secretsPath)) {
    throw "Missing updater signing configuration: $secretsPath"
  }

  $secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
  $keyPath = [string]$secrets.privateKeyPath
  if ([string]::IsNullOrWhiteSpace($keyPath) -or -not (Test-Path -LiteralPath $keyPath)) {
    throw "Updater signing private key is missing or invalid in $secretsPath"
  }

  return [pscustomobject]@{
    KeyPath = (Resolve-Path -LiteralPath $keyPath).Path
    Password = if (-not [string]::IsNullOrWhiteSpace($SigningPrivateKeyPassword)) {
      $SigningPrivateKeyPassword
    } else {
      Unprotect-Secret ([string]$secrets.privateKeyPasswordEnc)
    }
    Source = $secretsPath
  }
}

$root = Join-Path $PSScriptRoot ".."
Set-Location $root

$mpvExe = Join-Path $root 'src-tauri\resources\mpv\windows\mpv.exe'
$libmpvWrapper = Join-Path $root 'src-tauri\lib\libmpv-wrapper.dll'
$libmpvCore = Join-Path $root 'src-tauri\lib\libmpv-2.dll'
if (
  -not (Test-Path -LiteralPath $mpvExe) -or
  -not (Test-Path -LiteralPath $libmpvWrapper) -or
  -not (Test-Path -LiteralPath $libmpvCore)
) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fetch-mpv-from-official.ps1')
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
if (-not (Test-Path $CargoTargetDir)) {
  New-Item -ItemType Directory -Path $CargoTargetDir | Out-Null
}
$env:CARGO_TARGET_DIR = $CargoTargetDir

$signing = Resolve-UpdaterSigningSecrets -ProjectRoot $root -ProvidedKeyPath $SigningPrivateKeyPath -ProvidedKeyPassword $SigningPrivateKeyPassword
$previousSigningKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousSigningPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$env:TAURI_SIGNING_PRIVATE_KEY = $signing.KeyPath
if ([string]::IsNullOrWhiteSpace($signing.Password)) {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
} else {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $signing.Password
}
Write-Host "[Halo] Loaded updater signing key from $($signing.Source)" -ForegroundColor Cyan

# Avoid stale bundle resources (especially icon cache in target\release\resources).
$releaseBundleDir = Join-Path $root 'src-tauri\target\release\bundle'
$releaseResourcesDir = Join-Path $root 'src-tauri\target\release\resources'
if (Test-Path -LiteralPath $releaseBundleDir) {
  Remove-Item -LiteralPath $releaseBundleDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $releaseResourcesDir) {
  Remove-Item -LiteralPath $releaseResourcesDir -Recurse -Force -ErrorAction SilentlyContinue
}

try {
  pnpm tauri build --bundles nsis --config src-tauri/tauri.build.unsigned.json
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $previousSigningKey
  if ([string]::IsNullOrWhiteSpace($previousSigningPassword)) {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousSigningPassword
  }
}
