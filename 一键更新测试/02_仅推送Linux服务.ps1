Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_publish_common.ps1"

$exitCode = 0
try {
  Write-Host '=== Halo 仅推送更新文件（latest.json + setup.exe + .sig） ===' -ForegroundColor Magenta
  $ctx = Get-PublishContext

  $version = Get-CurrentVersion -ctx $ctx
  $secretCtx = Load-OrInit-Secrets -ctx $ctx

  $prepareArgs = @{
    ctx = $ctx
    privateKeyPath = $secretCtx.PrivateKeyPath
    privateKeyPassword = $secretCtx.PrivateKeyPassword
    version = $version
  }
  $artifacts = Ensure-ReleaseArtifactsForPush @prepareArgs

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

  Write-Ok '仅推送更新文件完成。'
} catch {
  $exitCode = 1
  Write-ErrMsg $_.Exception.Message
}

Write-Host ''
Read-Host '按回车键关闭窗口' | Out-Null
exit $exitCode
