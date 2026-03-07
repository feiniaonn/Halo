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

$oneClickDir = Join-Path $repoRoot '一键更新测试'
$keyFile = Join-Path $oneClickDir '密钥.txt'
$noticeFile = Join-Path $oneClickDir '更新公告.txt'
$updateDir = Join-Path $repoRoot 'tools\update-test'

Write-Host '[Halo] Preflight started.' -ForegroundColor Yellow
Write-Host "[Info] Repo root: $repoRoot"

$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

if (-not (Test-Path -LiteralPath $updateDir)) { $errors.Add("Missing directory: $updateDir") }
if (-not (Test-Path -LiteralPath $keyFile)) { $errors.Add("Missing key file: $keyFile") }
if (-not (Test-Path -LiteralPath $noticeFile)) { $warnings.Add("Missing release note file: $noticeFile") }

$ssh = Get-Command ssh -ErrorAction SilentlyContinue
$scp = Get-Command scp -ErrorAction SilentlyContinue
if (-not $ssh) { $errors.Add('OpenSSH client not found: ssh') }
if (-not $scp) { $errors.Add('OpenSSH client not found: scp') }

$targetHost = if ($env:HALO_DEPLOY_HOST) { $env:HALO_DEPLOY_HOST } else { '192.168.1.120' }
$targetUser = if ($env:HALO_DEPLOY_USER) { $env:HALO_DEPLOY_USER } else { 'root' }
$targetPassword = if ($env:HALO_DEPLOY_PASSWORD) { $env:HALO_DEPLOY_PASSWORD } else { '' }
try {
  $pingOk = Test-Connection -ComputerName $targetHost -Count 1 -Quiet -ErrorAction Stop
  if (-not $pingOk) { $warnings.Add("Host unreachable by ICMP: $targetHost") }
} catch {
  $warnings.Add("Ping check failed for ${targetHost}: $($_.Exception.Message)")
}

try {
  if (Get-Command Test-NetConnection -ErrorAction SilentlyContinue) {
    $port22 = Test-NetConnection -ComputerName $targetHost -Port 22 -WarningAction SilentlyContinue
    if (-not $port22.TcpTestSucceeded) { $warnings.Add("TCP 22 not reachable on $targetHost") }
  }
} catch {
  $warnings.Add("TCP check failed: $($_.Exception.Message)")
}

if ($ssh -and -not [string]::IsNullOrWhiteSpace($targetUser)) {
  $authOk = $false
  $baseArgs = @('-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=8',"$targetUser@$targetHost",'echo auth-ok')

  try {
    if (-not [string]::IsNullOrWhiteSpace($targetPassword)) {
      $authCode = Invoke-OpenSsh -Exe 'ssh' -Arguments $baseArgs -Password $targetPassword
      if ($authCode -eq 0) {
        $authOk = $true
      } else {
        Write-Warning "Password auth failed for $targetUser@$targetHost, fallback to key auth."
      }
    }

    if (-not $authOk) {
      & ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes "$targetUser@$targetHost" 'echo auth-ok' | Out-Null
      $keyCode = $LASTEXITCODE
      if ($keyCode -eq 0) {
        $authOk = $true
      }
    }

    if (-not $authOk) {
      $errors.Add("SSH authentication failed for $targetUser@$targetHost")
    }
  } catch {
    $errors.Add("SSH authentication check error: $($_.Exception.Message)")
  }
}

foreach ($w in $warnings) { Write-Warning $w }

if ($errors.Count -gt 0) {
  foreach ($e in $errors) { Write-Host "[Error] $e" -ForegroundColor Red }
  exit 1
}

Write-Host '[Success] Preflight passed.' -ForegroundColor Green
exit 0
