Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_publish_common.ps1"

$exitCode = 0
try {
  Write-Host '=== Halo 自动发布（构建签名包 + 推送 Linux）===' -ForegroundColor Magenta
  $ctx = Get-PublishContext

  Ensure-File $ctx.PackageJsonPath '缺少 package.json'
  Ensure-File $ctx.TauriConfigPath '缺少 tauri.conf.json'
  Ensure-File $ctx.BuildScriptPath '缺少构建脚本'

  $currentVersion = Get-CurrentVersion -ctx $ctx
  $newVersion = Select-NewVersion -currentVersion $currentVersion
  if ($newVersion -ne $currentVersion) {
    Set-ProjectVersion -ctx $ctx -newVersion $newVersion
  } else {
    Write-Info "版本保持不变：$currentVersion"
  }

  $secretCtx = Load-OrInit-Secrets -ctx $ctx

  $prepareArgs = @{
    ctx = $ctx
    privateKeyPath = $secretCtx.PrivateKeyPath
    privateKeyPassword = $secretCtx.PrivateKeyPassword
    version = $newVersion
  }
  $artifacts = Prepare-ReleaseArtifacts @prepareArgs

  $pushArgs = @{
    ctx = $ctx
    targetHost = $secretCtx.LinuxHost
    user = $secretCtx.LinuxUser
    password = $secretCtx.LinuxPassword
    remoteDir = $secretCtx.RemoteDir
    remoteServiceDir = $secretCtx.RemoteServiceDir
    latestPath = $artifacts.LatestPath
    installerPath = $artifacts.InstallerPath
    sigPath = $artifacts.SigPath
  }
  Push-FilesToLinux @pushArgs

  Write-Ok '自动发布完成。'
} catch {
  $exitCode = 1
  Write-ErrMsg $_.Exception.Message
}

Write-Host ''
Read-Host '按回车键关闭窗口' | Out-Null
exit $exitCode
