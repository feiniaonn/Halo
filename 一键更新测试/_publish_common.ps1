Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Initialize-ConsoleUtf8 {
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $script:OutputEncoding = $utf8
    if ($env:OS -like '*Windows*') {
      & chcp 65001 > $null
    }
  } catch {
    # Best-effort only; continue even if host doesn't allow encoding change.
  }
}

Initialize-ConsoleUtf8

function Write-Info([string]$msg) { Write-Host "[信息] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "[成功] $msg" -ForegroundColor Green }
function Write-WarnMsg([string]$msg) { Write-Host "[警告] $msg" -ForegroundColor Yellow }
function Write-ErrMsg([string]$msg) { Write-Host "[失败] $msg" -ForegroundColor Red }

function Format-ByteSize([double]$bytes) {
  if ($bytes -lt 1024) { return ('{0:N0} B' -f $bytes) }
  if ($bytes -lt 1MB) { return ('{0:N1} KB' -f ($bytes / 1KB)) }
  if ($bytes -lt 1GB) { return ('{0:N2} MB' -f ($bytes / 1MB)) }
  return ('{0:N2} GB' -f ($bytes / 1GB))
}

function Get-PublishContext {
  $scriptDir = $PSScriptRoot
  if ([string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = (Get-Location).Path }
  $projectRoot = Join-Path $scriptDir '..'
  $artifactRoot = Join-Path $projectRoot 'release-artifacts'
  $ctx = [ordered]@{
    ScriptDir = $scriptDir
    ProjectRoot = $projectRoot
    OneClickDir = $scriptDir
    ArtifactRoot = $artifactRoot
    ExeOutDir = Join-Path $artifactRoot 'exe'
    MsiOutDir = Join-Path $artifactRoot 'msi'
    UpdateDir = Join-Path $artifactRoot 'meta'
    TauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
    CargoTomlPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'
    PackageJsonPath = Join-Path $projectRoot 'package.json'
    DeployConfigPath = Join-Path $scriptDir 'deploy.config.json'
    NoticePath = Join-Path $scriptDir '更新公告.txt'
    SecretsPath = Join-Path $scriptDir '.publish-secrets.json'
    BuildScriptPath = Join-Path $projectRoot 'scripts\build-installers-unsigned.ps1'
    NsisDir = Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis'
    MsiDir = Join-Path $projectRoot 'src-tauri\target\release\bundle\msi'
    RemoteDir = '/opt/halo-update'
    RemoteServiceDir = '/opt/halo-update/service-files'
  }
  return $ctx
}

function Ensure-File([string]$path, [string]$hint) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "${hint}: $path"
  }
}

function Ensure-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "命令不可用：$name"
  }
}

function Protect-Secret([string]$plain) {
  if ([string]::IsNullOrEmpty($plain)) { return '' }
  $secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
  return ConvertFrom-SecureString -SecureString $secure
}

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

function Read-SecretAsPlain([string]$prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
  }
}

function Read-JsonObject([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $raw = Get-Content -Raw -LiteralPath $path
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Save-JsonObject([string]$path, [object]$obj) {
  $json = $obj | ConvertTo-Json -Depth 20
  # Use UTF-8 without BOM, otherwise some tooling (Vite/enhanced-resolve) fails to parse JSON.
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, ($json -replace "`r?`n", "`r`n"), $utf8)
}

function Ensure-LocalDirectories([hashtable]$ctx) {
  foreach ($dir in @($ctx.ArtifactRoot, $ctx.ExeOutDir, $ctx.MsiOutDir, $ctx.UpdateDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir | Out-Null
    }
  }
}

function Load-OrInit-Secrets([hashtable]$ctx) {
  $secrets = Read-JsonObject -path $ctx.SecretsPath
  if ($null -eq $secrets) {
    $secrets = [ordered]@{
      privateKeyPath = ''
      privateKeyPasswordEnc = ''
      linuxHost = '192.168.1.120'
      linuxUser = 'root'
      linuxPasswordEnc = (Protect-Secret '1234')
      remoteDir = $ctx.RemoteDir
      remoteServiceDir = $ctx.RemoteServiceDir
    }
  }

  if ([string]::IsNullOrWhiteSpace($secrets.linuxHost)) { $secrets.linuxHost = '192.168.1.120' }
  if ([string]::IsNullOrWhiteSpace($secrets.linuxUser)) { $secrets.linuxUser = 'root' }
  if ([string]::IsNullOrWhiteSpace($secrets.remoteDir)) { $secrets.remoteDir = $ctx.RemoteDir }
  if ([string]::IsNullOrWhiteSpace($secrets.remoteServiceDir)) { $secrets.remoteServiceDir = $ctx.RemoteServiceDir }
  if ([string]::IsNullOrWhiteSpace($secrets.linuxPasswordEnc)) { $secrets.linuxPasswordEnc = Protect-Secret '1234' }

  $changed = $false

  while ([string]::IsNullOrWhiteSpace($secrets.privateKeyPath) -or -not (Test-Path -LiteralPath $secrets.privateKeyPath)) {
    if (-not [string]::IsNullOrWhiteSpace($secrets.privateKeyPath)) {
      Write-WarnMsg "签名私钥文件不存在：$($secrets.privateKeyPath)"
    }
    $inputPath = Read-Host '请输入 Tauri 更新签名私钥文件路径（minisign 私钥）'
    if ([string]::IsNullOrWhiteSpace($inputPath)) { continue }
    $candidate = $inputPath.Trim().Trim('"')
    if (-not (Test-Path -LiteralPath $candidate)) {
      Write-WarnMsg "路径无效，请重试。"
      continue
    }
    $secrets.privateKeyPath = $candidate
    $changed = $true
  }

  $pwdPlain = ''
  if ([string]::IsNullOrWhiteSpace($secrets.privateKeyPasswordEnc)) {
    $pwdPlain = Read-SecretAsPlain '请输入签名私钥密码（首次保存）'
    if ([string]::IsNullOrWhiteSpace($pwdPlain)) {
      throw '签名私钥密码不能为空。'
    }
    $secrets.privateKeyPasswordEnc = Protect-Secret $pwdPlain
    $changed = $true
  } else {
    try {
      $pwdPlain = Unprotect-Secret $secrets.privateKeyPasswordEnc
    } catch {
      Write-WarnMsg '已保存的签名密码无法解密，将重新输入。'
      $pwdPlain = Read-SecretAsPlain '请输入签名私钥密码'
      if ([string]::IsNullOrWhiteSpace($pwdPlain)) {
        throw '签名私钥密码不能为空。'
      }
      $secrets.privateKeyPasswordEnc = Protect-Secret $pwdPlain
      $changed = $true
    }
  }

  $linuxPwd = ''
  try {
    $linuxPwd = Unprotect-Secret $secrets.linuxPasswordEnc
  } catch {
    $linuxPwd = '1234'
    $secrets.linuxPasswordEnc = Protect-Secret $linuxPwd
    $changed = $true
  }
  if ([string]::IsNullOrWhiteSpace($linuxPwd)) {
    $linuxPwd = '1234'
    $secrets.linuxPasswordEnc = Protect-Secret $linuxPwd
    $changed = $true
  }

  if ($changed) {
    Save-JsonObject -path $ctx.SecretsPath -obj $secrets
    Write-Ok "已更新密钥配置：$($ctx.SecretsPath)"
  }

  return [ordered]@{
    Secrets = $secrets
    PrivateKeyPath = $secrets.privateKeyPath
    PrivateKeyPassword = $pwdPlain
    LinuxHost = $secrets.linuxHost
    LinuxUser = $secrets.linuxUser
    LinuxPassword = $linuxPwd
    RemoteDir = $secrets.remoteDir
    RemoteServiceDir = $secrets.remoteServiceDir
  }
}

function Parse-Semver([string]$v) {
  if ($v -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
    throw "版本号格式不正确：$v（需要 x.y.z）"
  }
  return @([int]$matches[1], [int]$matches[2], [int]$matches[3])
}

function Compare-Semver([string]$left, [string]$right) {
  $l = Parse-Semver $left
  $r = Parse-Semver $right
  for ($i = 0; $i -lt 3; $i++) {
    if ($l[$i] -gt $r[$i]) { return 1 }
    if ($l[$i] -lt $r[$i]) { return -1 }
  }
  return 0
}

function Get-CargoPackageVersion([string]$cargoTomlPath) {
  Ensure-File $cargoTomlPath '缺少 Cargo.toml'
  $lines = Get-Content -LiteralPath $cargoTomlPath
  $inPackage = $false
  foreach ($line in $lines) {
    $trim = $line.Trim()
    if ($trim -match '^\[package\]$') {
      $inPackage = $true
      continue
    }
    if ($inPackage -and $trim -match '^\[.+\]$') {
      break
    }
    if ($inPackage -and $line -match '^\s*version\s*=\s*"([^"]+)"\s*$') {
      return $matches[1]
    }
  }
  throw "无法读取 Cargo.toml 的 [package].version：$cargoTomlPath"
}

function Set-CargoPackageVersion([string]$cargoTomlPath, [string]$newVersion) {
  Ensure-File $cargoTomlPath '缺少 Cargo.toml'
  [void](Parse-Semver $newVersion)

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.AddRange([string[]](Get-Content -LiteralPath $cargoTomlPath))

  $inPackage = $false
  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $trim = $line.Trim()
    if ($trim -match '^\[package\]$') {
      $inPackage = $true
      continue
    }
    if ($inPackage -and $trim -match '^\[.+\]$') {
      break
    }
    if ($inPackage -and $line -match '^\s*version\s*=\s*"([^"]+)"\s*$') {
      $indent = [regex]::Match($line, '^\s*').Value
      $lines[$i] = "$indent" + "version = ""$newVersion"""
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    throw "未找到 Cargo.toml 的 [package].version 可更新项：$cargoTomlPath"
  }

  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($cargoTomlPath, $lines, $utf8)
}

function Select-NewVersion([string]$currentVersion) {
  Write-Host ''
  Write-Host "当前版本：$currentVersion" -ForegroundColor Yellow
  Write-Host '请选择版本处理方式：'
  Write-Host '  1. 保持不变'
  Write-Host '  2. Patch +1'
  Write-Host '  3. Minor +1（Patch 归零）'
  Write-Host '  4. Major +1（Minor/Patch 归零）'
  Write-Host '  5. 手动输入版本'

  while ($true) {
    $choice = (Read-Host '输入选项 [1-5]').Trim()
    switch ($choice) {
      '1' { return $currentVersion }
      '2' {
        $parts = Parse-Semver $currentVersion
        return ("{0}.{1}.{2}" -f $parts[0], $parts[1], ($parts[2] + 1))
      }
      '3' {
        $parts = Parse-Semver $currentVersion
        return ("{0}.{1}.{2}" -f $parts[0], ($parts[1] + 1), 0)
      }
      '4' {
        $parts = Parse-Semver $currentVersion
        return ("{0}.{1}.{2}" -f ($parts[0] + 1), 0, 0)
      }
      '5' {
        $manual = (Read-Host '请输入目标版本（x.y.z）').Trim()
        [void](Parse-Semver $manual)
        return $manual
      }
      default { Write-WarnMsg '输入无效，请重试。' }
    }
  }
}

function Get-CurrentVersion([hashtable]$ctx) {
  Ensure-File $ctx.TauriConfigPath '缺少 tauri.conf.json'
  Ensure-File $ctx.PackageJsonPath '缺少 package.json'
  Ensure-File $ctx.CargoTomlPath '缺少 src-tauri/Cargo.toml'

  $tauri = Read-JsonObject -path $ctx.TauriConfigPath
  $pkg = Read-JsonObject -path $ctx.PackageJsonPath
  $cargoVersion = Get-CargoPackageVersion -cargoTomlPath $ctx.CargoTomlPath
  if ($null -eq $tauri -or [string]::IsNullOrWhiteSpace($tauri.version)) {
    throw '无法读取 tauri.conf.json 版本号。'
  }
  if ($null -eq $pkg -or [string]::IsNullOrWhiteSpace($pkg.version)) {
    throw '无法读取 package.json 版本号。'
  }

  $tauriVersion = [string]$tauri.version
  $pkgVersion = [string]$pkg.version
  [void](Parse-Semver $tauriVersion)
  [void](Parse-Semver $pkgVersion)
  [void](Parse-Semver $cargoVersion)

  if ($tauriVersion -eq $pkgVersion -and $pkgVersion -eq $cargoVersion) {
    return $tauriVersion
  }

  $resolvedVersion = $pkgVersion
  if ((Compare-Semver $tauriVersion $resolvedVersion) -gt 0) { $resolvedVersion = $tauriVersion }
  if ((Compare-Semver $cargoVersion $resolvedVersion) -gt 0) { $resolvedVersion = $cargoVersion }

  Write-WarnMsg "检测到版本不一致：package.json=$pkgVersion，tauri.conf.json=$tauriVersion，Cargo.toml=$cargoVersion"
  Write-Info "将自动对齐为较高版本：$resolvedVersion"
  Set-ProjectVersion -ctx $ctx -newVersion $resolvedVersion
  return $resolvedVersion
}

function Set-ProjectVersion([hashtable]$ctx, [string]$newVersion) {
  [void](Parse-Semver $newVersion)
  Ensure-File $ctx.CargoTomlPath '缺少 src-tauri/Cargo.toml'

  $pkg = Read-JsonObject -path $ctx.PackageJsonPath
  if ($null -eq $pkg) { throw 'package.json 解析失败。' }
  $pkg.version = $newVersion
  Save-JsonObject -path $ctx.PackageJsonPath -obj $pkg

  $tauri = Read-JsonObject -path $ctx.TauriConfigPath
  if ($null -eq $tauri) { throw 'tauri.conf.json 解析失败。' }
  $tauri.version = $newVersion
  Save-JsonObject -path $ctx.TauriConfigPath -obj $tauri

  Set-CargoPackageVersion -cargoTomlPath $ctx.CargoTomlPath -newVersion $newVersion

  if (Test-Path -LiteralPath $ctx.DeployConfigPath) {
    try {
      $deploy = Read-JsonObject -path $ctx.DeployConfigPath
      if ($null -ne $deploy) {
        $deploy.releaseVersion = $newVersion
        Save-JsonObject -path $ctx.DeployConfigPath -obj $deploy
      }
    } catch {
      Write-WarnMsg 'deploy.config.json 更新失败，已跳过。'
    }
  }

  Write-Ok "版本已更新为 $newVersion"
}

function Invoke-UnsignedBuild([hashtable]$ctx) {
  Ensure-File $ctx.BuildScriptPath '缺少构建脚本'
  Write-Info '开始构建安装包（MSI + NSIS，unsigned config）...'
  Push-Location $ctx.ProjectRoot
  try {
    # Keep logs visible while preventing command output from becoming function return value.
    & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ctx.BuildScriptPath | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "构建失败，退出码：$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Get-LatestNsisInstaller([hashtable]$ctx) {
  if (-not (Test-Path -LiteralPath $ctx.NsisDir)) {
    throw "未找到 NSIS 输出目录：$($ctx.NsisDir)"
  }
  $built = Get-ChildItem -LiteralPath $ctx.NsisDir -Filter 'halo_*_x64-setup.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $built) {
    throw '未找到 NSIS 安装包（halo_*_x64-setup.exe）。'
  }
  return $built
}

function Get-LatestMsiInstaller([hashtable]$ctx) {
  if (-not (Test-Path -LiteralPath $ctx.MsiDir)) {
    throw "未找到 MSI 输出目录：$($ctx.MsiDir)"
  }
  $built = Get-ChildItem -LiteralPath $ctx.MsiDir -Filter 'halo_*_x64*.msi' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $built) {
    throw '未找到 MSI 安装包（halo_*_x64*.msi）。'
  }
  return $built
}

function Copy-InstallerToDir([hashtable]$ctx, [System.IO.FileInfo]$installer, [string]$targetDir) {
  Ensure-LocalDirectories $ctx
  $target = Join-Path $targetDir $installer.Name
  Copy-Item -LiteralPath $installer.FullName -Destination $target -Force
  return (Get-Item -LiteralPath $target)
}

function Sign-Installer([hashtable]$ctx, [string]$installerPath, [string]$privateKeyPath, [string]$privateKeyPassword) {
  Ensure-Command 'pnpm'
  Ensure-File $privateKeyPath '签名私钥不存在'

  Write-Info "开始签名：$installerPath"
  Push-Location $ctx.ProjectRoot
  try {
    $signOutput = & pnpm tauri signer sign -f $privateKeyPath -p $privateKeyPassword $installerPath 2>&1
    $signCode = $LASTEXITCODE
    $skipPublicSignature = $false
    foreach ($line in $signOutput) {
      $text = [string]$line
      if ($text -match 'Public signature:') {
        $skipPublicSignature = $true
        continue
      }
      if ($skipPublicSignature) {
        if ($text -match '^\s*Make sure to include this into the signature field') {
          $skipPublicSignature = $false
          continue
        }
        continue
      }
      Write-Host $text
    }
    if ($signCode -ne 0) {
      throw "签名失败，退出码：$signCode"
    }
  } finally {
    Pop-Location
  }

  $sig = "$installerPath.sig"
  if (-not (Test-Path -LiteralPath $sig)) {
    throw "签名文件未生成：$sig"
  }
  return $sig
}

function Get-EndpointBaseUrl([hashtable]$ctx) {
  $tauri = Read-JsonObject -path $ctx.TauriConfigPath
  $endpoint = 'http://192.168.1.120:1421/latest.json'
  if ($null -ne $tauri -and $null -ne $tauri.plugins -and $null -ne $tauri.plugins.updater) {
    $eps = $tauri.plugins.updater.endpoints
    if ($eps -and $eps.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($eps[0])) {
      $endpoint = [string]$eps[0]
    }
  }
  return ($endpoint -replace '/latest\.json$', '')
}

function Get-InstallerVersionFromName([string]$name) {
  if ($name -match 'halo_([0-9]+\.[0-9]+\.[0-9]+)_x64-setup\.exe') {
    return $matches[1]
  }
  return $null
}

function Generate-LatestJson([hashtable]$ctx, [string]$installerPath, [string]$sigPath, [string]$version) {
  Ensure-File $installerPath '安装包不存在'
  Ensure-File $sigPath '签名文件不存在'

  $installerName = Split-Path -Leaf $installerPath
  $sig = (Get-Content -Raw -LiteralPath $sigPath).Trim()
  if ([string]::IsNullOrWhiteSpace($sig)) {
    throw '签名内容为空。'
  }

  $notes = ''
  if (Test-Path -LiteralPath $ctx.NoticePath) {
    $notes = (Get-Content -Raw -LiteralPath $ctx.NoticePath).Trim()
  }

  $baseUrl = Get-EndpointBaseUrl -ctx $ctx
  $latest = [ordered]@{
    version = $version
    notes = $notes
    pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = [ordered]@{
      'windows-x86_64' = [ordered]@{
        signature = $sig
        url = "$baseUrl/$installerName"
      }
    }
  }

  $latestPath = Join-Path $ctx.UpdateDir 'latest.json'
  Save-JsonObject -path $latestPath -obj $latest
  Write-Ok "latest.json 已生成：$latestPath"
  return $latestPath
}

function Invoke-OpenSsh {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$Password,
    [int]$TimeoutSec = 600,
    [string]$Label = 'SSH/SCP 命令'
  )

  if ($TimeoutSec -le 0) {
    $TimeoutSec = 600
  }

  $hasPassword = -not [string]::IsNullOrWhiteSpace($Password)
  $askPass = $null
  $oldAskPass = $null
  $oldAskPassRequire = $null
  $oldDisplay = $null
  $oldPass = $null

  if ($hasPassword) {
    $askPass = Join-Path $env:TEMP ("halo_askpass_{0}.cmd" -f ([guid]::NewGuid().ToString('N')))
    "@echo off`r`necho %HALO_SSH_PASS%`r`n" | Set-Content -LiteralPath $askPass -Encoding ASCII

    $oldAskPass = $env:SSH_ASKPASS
    $oldAskPassRequire = $env:SSH_ASKPASS_REQUIRE
    $oldDisplay = $env:DISPLAY
    $oldPass = $env:HALO_SSH_PASS
  }

  try {
    if ($hasPassword) {
      $env:HALO_SSH_PASS = $Password
      $env:SSH_ASKPASS = $askPass
      $env:SSH_ASKPASS_REQUIRE = 'force'
      $env:DISPLAY = '1'
    }

    $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -NoNewWindow -PassThru
    if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
      try { $proc.Kill() } catch {}
      throw "$Label 执行超时（${TimeoutSec}s）：$Exe"
    }
    return [int]$proc.ExitCode
  } finally {
    if ($hasPassword) {
      $env:SSH_ASKPASS = $oldAskPass
      $env:SSH_ASKPASS_REQUIRE = $oldAskPassRequire
      $env:DISPLAY = $oldDisplay
      $env:HALO_SSH_PASS = $oldPass
      Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
    }
  }
}

function Push-FilesToLinux {
  param(
    [hashtable]$ctx,
    [Alias('host')]
    [string]$targetHost,
    [string]$user,
    [string]$password,
    [string]$remoteDir,
    [string]$remoteServiceDir,
    [string]$latestPath,
    [string]$installerPath,
    [string]$sigPath,
    [string]$msiPath
  )

  Ensure-Command 'ssh'
  Ensure-Command 'scp'

  if ([string]::IsNullOrWhiteSpace($targetHost)) {
    throw 'Linux 主机地址不能为空。'
  }
  $target = "$user@$targetHost"
  Write-Info "推送目标：$target"
  Write-Info "远端目录：$remoteDir"
  Write-Info '推送模式：仅更新必需文件（latest.json + setup.exe + .sig）'

  $sshArgs = @(
    '-o','StrictHostKeyChecking=accept-new',
    '-o','ConnectTimeout=8',
    '-o','ConnectionAttempts=1',
    '-o','ServerAliveInterval=15',
    '-o','ServerAliveCountMax=3'
  )
  $scpArgs = @(
    '-o','StrictHostKeyChecking=accept-new',
    '-o','ConnectTimeout=8',
    '-o','ConnectionAttempts=1',
    '-o','ServerAliveInterval=15',
    '-o','ServerAliveCountMax=3'
  )
  $tempRenamedFiles = [System.Collections.Generic.List[string]]::new()

  try {
    $requiredPairs = @(
      @{ Local = $latestPath; Remote = "$remoteDir/latest.json" },
      @{ Local = $installerPath; Remote = "$remoteDir/$(Split-Path -Leaf $installerPath)" },
      @{ Local = $sigPath; Remote = "$remoteDir/$(Split-Path -Leaf $sigPath)" }
    )
    $releaseTasks = [System.Collections.Generic.List[object]]::new()
    foreach ($pair in $requiredPairs) {
      if (-not (Test-Path -LiteralPath $pair.Local)) {
        throw "缺少必需推送文件：$($pair.Local)"
      }
      $source = (Resolve-Path -LiteralPath $pair.Local).Path
      $remoteName = Split-Path -Leaf $pair.Remote
      $localName = Split-Path -Leaf $source
      if ($localName -ne $remoteName) {
        $tempPath = Join-Path $env:TEMP ("halo_push_{0}_{1}" -f ([guid]::NewGuid().ToString('N')), $remoteName)
        Copy-Item -LiteralPath $source -Destination $tempPath -Force
        $tempRenamedFiles.Add($tempPath)
        $source = $tempPath
      }
      $size = (Get-Item -LiteralPath $source).Length
      $releaseTasks.Add([PSCustomObject]@{
        Local = $source
        Remote = "$remoteDir/$remoteName"
        Size = [double]$size
      })
    }

    $totalBytes = ($releaseTasks | Measure-Object -Property Size -Sum).Sum
    if ($null -eq $totalBytes) { $totalBytes = 0 }
    Write-Info ("本次固定推送：{0} 个文件，总大小：{1}" -f $releaseTasks.Count, (Format-ByteSize $totalBytes))
    for ($idx = 0; $idx -lt $releaseTasks.Count; $idx++) {
      $task = $releaseTasks[$idx]
      Write-Host ("  [上传 {0}/{1}] {2}  ->  {3}  ({4})" -f ($idx + 1), $releaseTasks.Count, (Split-Path -Leaf $task.Local), $task.Remote, (Format-ByteSize $task.Size)) -ForegroundColor DarkCyan
    }

    $rc = Invoke-OpenSsh -Exe 'ssh' -Arguments ($sshArgs + @("$target", "mkdir -p '$remoteDir'")) -Password $password -TimeoutSec 45 -Label '创建远端目录'
    if ($rc -ne 0) { throw '远端目录创建失败。' }
    Write-Ok '远端目录已就绪。'

    Write-Info ("开始推送更新文件（{0} 个）..." -f $releaseTasks.Count)
    $releaseWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $releaseBytes = ($releaseTasks | Measure-Object -Property Size -Sum).Sum
    $releaseTimeoutSec = [Math]::Max(180, [int][Math]::Ceiling($releaseBytes / 512KB))
    $releaseLocals = @($releaseTasks | ForEach-Object { $_.Local })
    $releaseArgs = @($scpArgs + $releaseLocals + @("$target`:$remoteDir/"))
    $rc = Invoke-OpenSsh -Exe 'scp' -Arguments $releaseArgs -Password $password -TimeoutSec $releaseTimeoutSec -Label '推送更新文件'
    $releaseWatch.Stop()
    if ($rc -ne 0) { throw '推送更新文件失败。' }
    $releaseSpeed = if ($releaseWatch.Elapsed.TotalSeconds -gt 0) {
      "{0}/s" -f (Format-ByteSize ($releaseBytes / $releaseWatch.Elapsed.TotalSeconds))
    } else {
      'n/a'
    }
    Write-Ok ("更新文件推送完成，用时 {0:N1}s，均速 {1}" -f $releaseWatch.Elapsed.TotalSeconds, $releaseSpeed)
    Write-Ok 'Linux 服务器推送完成。'
  } finally {
    foreach ($tempFile in $tempRenamedFiles) {
      Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    }
  }
}

function Prepare-ReleaseArtifacts {
  param(
    [hashtable]$ctx,
    [string]$privateKeyPath,
    [string]$privateKeyPassword,
    [string]$version
  )

  Invoke-UnsignedBuild -ctx $ctx
  $builtNsis = Get-LatestNsisInstaller -ctx $ctx
  $installerInUpdate = Copy-InstallerToDir -ctx $ctx -installer $builtNsis -targetDir $ctx.ExeOutDir
  $builtMsi = Get-LatestMsiInstaller -ctx $ctx
  $msiInUpdate = Copy-InstallerToDir -ctx $ctx -installer $builtMsi -targetDir $ctx.MsiOutDir
  $sigPath = Sign-Installer -ctx $ctx -installerPath $installerInUpdate.FullName -privateKeyPath $privateKeyPath -privateKeyPassword $privateKeyPassword
  $latestPath = Generate-LatestJson -ctx $ctx -installerPath $installerInUpdate.FullName -sigPath $sigPath -version $version

  return [ordered]@{
    InstallerPath = $installerInUpdate.FullName
    MsiPath = $msiInUpdate.FullName
    SigPath = $sigPath
    LatestPath = $latestPath
  }
}

function Ensure-ReleaseArtifactsForPush {
  param(
    [hashtable]$ctx,
    [string]$privateKeyPath,
    [string]$privateKeyPassword,
    [string]$version
  )

  Ensure-LocalDirectories $ctx

  $installer = Get-ChildItem -LiteralPath $ctx.ExeOutDir -Filter 'halo_*_x64-setup.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($null -eq $installer) {
    Write-WarnMsg "未在 $($ctx.ExeOutDir) 发现安装包，将从构建输出目录复制最近版本。"
    $built = Get-LatestNsisInstaller -ctx $ctx
    $installer = Copy-InstallerToDir -ctx $ctx -installer $built -targetDir $ctx.ExeOutDir
  }

  $msi = Get-ChildItem -LiteralPath $ctx.MsiOutDir -Filter 'halo_*_x64*.msi' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $msi) {
    Write-WarnMsg "未在 $($ctx.MsiOutDir) 发现 MSI，将从构建输出目录复制最近版本。"
    $builtMsi = Get-LatestMsiInstaller -ctx $ctx
    $msi = Copy-InstallerToDir -ctx $ctx -installer $builtMsi -targetDir $ctx.MsiOutDir
  }

  $sigPath = "$($installer.FullName).sig"
  if (-not (Test-Path -LiteralPath $sigPath)) {
    Write-WarnMsg '未找到签名文件，开始补签名。'
    $sigPath = Sign-Installer -ctx $ctx -installerPath $installer.FullName -privateKeyPath $privateKeyPath -privateKeyPassword $privateKeyPassword
  }

  $latestPath = Join-Path $ctx.UpdateDir 'latest.json'
  if (-not (Test-Path -LiteralPath $latestPath)) {
    Write-WarnMsg '未找到 latest.json，将自动生成。'
    $latestPath = Generate-LatestJson -ctx $ctx -installerPath $installer.FullName -sigPath $sigPath -version $version
  }

  return [ordered]@{
    InstallerPath = $installer.FullName
    MsiPath = $msi.FullName
    SigPath = $sigPath
    LatestPath = $latestPath
  }
}
