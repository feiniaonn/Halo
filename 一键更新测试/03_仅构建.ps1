Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_publish_common.ps1"

$exitCode = 0
try {
  Write-Host '=== Halo 仅构建（NSIS 安装包 + 签名）===' -ForegroundColor Magenta
  $ctx = Get-PublishContext

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

  Write-Ok "构建完成：$($artifacts.InstallerPath)"
  Write-Ok "签名文件：$($artifacts.SigPath)"
  Write-Ok "更新元数据：$($artifacts.LatestPath)"
} catch {
  $exitCode = 1
  Write-ErrMsg $_.Exception.Message
}

Write-Host ''
Read-Host '按回车键关闭窗口' | Out-Null
exit $exitCode
