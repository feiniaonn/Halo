param(
  [ValidateSet("debug", "release")]
  [string]$Profile = "debug",
  [string[]]$CaseIds = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $false

$projectRoot = Split-Path -Parent $PSScriptRoot
$reportRoot = Join-Path $PSScriptRoot "reports\$Profile"
$summaryPath = Join-Path $PSScriptRoot "summary-$Profile-2026-03-09.md"

New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

function Write-Utf8 {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Extract-DiagJson {
  param([string]$Text)

  $startTag = ">>HALO_SPIDER_DIAG<<"
  $first = $Text.IndexOf($startTag)
  $last = $Text.LastIndexOf($startTag)
  if ($first -lt 0 -or $last -le $first) {
    throw "Could not find HALO_SPIDER_DIAG markers"
  }

  $json = $Text.Substring($first + $startTag.Length, $last - ($first + $startTag.Length)).Trim()
  if (-not $json) {
    throw "Extracted empty HALO_SPIDER_DIAG payload"
  }
  return $json
}

function Get-SafeValue {
  param(
    $Value,
    [string]$Fallback = "-"
  )

  if ($null -eq $Value) {
    return $Fallback
  }

  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $Fallback
  }

  return $text
}

function Get-LeafName {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return "-"
  }

  return Split-Path -Leaf $Path
}

$cargoArgs = @("build", "--manifest-path", (Join-Path $projectRoot "src-tauri\Cargo.toml"), "--bin", "spider_diag")
if ($Profile -eq "release") {
  $cargoArgs += "--release"
}

Write-Host "[spider-diagnostics] building spider_diag ($Profile)..."
& cargo @cargoArgs | Out-Host

$exePath = Join-Path $projectRoot "src-tauri\target\$Profile\spider_diag.exe"
if (-not (Test-Path $exePath)) {
  throw "spider_diag.exe not found: $exePath"
}

$cases = @(
  @{ Id = "iyouhun-root"; Source = "https://www.iyouhun.com/tv/dc-xs"; Repo = $null; Site = $null; Note = "multi repo inventory" },
  @{ Id = "iyouhun-site-01-douban"; Source = "https://www.iyouhun.com/tv/dc-xs"; Repo = $null; Site = "1"; Note = "douban compat path" },
  @{ Id = "iyouhun-site-05-apprj"; Source = "https://www.iyouhun.com/tv/dc-xs"; Repo = $null; Site = "5"; Note = "anotherds app happy path" },
  @{ Id = "iyouhun-site-08-hxq"; Source = "https://www.iyouhun.com/tv/dc-xs"; Repo = $null; Site = "8"; Note = "hxq compat path" },
  @{ Id = "iyouhun-site-28-biliys"; Source = "https://www.iyouhun.com/tv/dc-xs"; Repo = $null; Site = "28"; Note = "biliys failure mode" },
  @{ Id = "feimao-root"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = $null; Note = "html wrapper to remote config" },
  @{ Id = "feimao-site-02-douban"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = "2"; Note = "douban on current remote config" },
  @{ Id = "feimao-site-05-guazi"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = "5"; Note = "helper-dependent guazi path" },
  @{ Id = "feimao-site-06-ttian"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = "6"; Note = "ttian direct runtime path" },
  @{ Id = "feimao-site-07-jpys"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = "7"; Note = "jpys timeout path" },
  @{ Id = "feimao-site-18-czzy"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = "18"; Note = "custom spider jar override" },
  @{ Id = "feimao-site-49-ygp"; Source = "http://xn--z7x900a.com"; Repo = $null; Site = "49"; Note = "ygp preview path" }
)

if ($CaseIds -and $CaseIds.Count -gt 0) {
  if ($CaseIds.Count -eq 1 -and ($CaseIds[0] -is [string]) -and $CaseIds[0].Contains(",")) {
    $CaseIds = @($CaseIds[0].Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  }

  $wanted = @{}
  foreach ($id in $CaseIds) {
    $wanted[$id] = $true
  }
  $cases = @($cases | Where-Object { $wanted.ContainsKey($_.Id) })
}

$summary = @()
$summary += "# Spider Diagnostics Summary ($Profile)"
$summary += ""
$summary += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
$summary += ""
$summary += "| Case | Result | Key Facts |"
$summary += "|------|--------|-----------|"

foreach ($case in $cases) {
  $caseDir = Join-Path $reportRoot $case.Id
  New-Item -ItemType Directory -Force -Path $caseDir | Out-Null
  $parseErrorPath = Join-Path $caseDir "parse-error.log"
  if (Test-Path $parseErrorPath) {
    Remove-Item $parseErrorPath -Force
  }

  $args = @("--source", $case.Source)
  if ($case.Repo) {
    $args += @("--repo", $case.Repo)
  }
  if ($case.Site) {
    $args += @("--site", $case.Site)
  }

  Write-Host "[spider-diagnostics] running $($case.Id) ($Profile)..."
  $escapedArgs = $args | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  $cmdLine = '"' + $exePath + '" ' + ($escapedArgs -join ' ') + ' 2>&1'
  $output = & cmd /d /s /c $cmdLine | Out-String
  Write-Utf8 -Path (Join-Path $caseDir "raw.log") -Content $output

  $resultCell = "FAIL"
  $facts = $case.Note

  try {
    $json = Extract-DiagJson -Text $output
    Write-Utf8 -Path (Join-Path $caseDir "report.json") -Content $json
    $parsed = $json | ConvertFrom-Json

    if ($null -eq $parsed.selectedSite) {
      if (($parsed.repoCount -gt 0) -or ($parsed.siteCount -gt 0)) {
        $resultCell = "OK"
        $firstRepo = if ($parsed.repos.Count -gt 0) { $parsed.repos[0].url } else { "-" }
        $firstSite = if ($parsed.sites.Count -gt 0) { $parsed.sites[0].key } else { "-" }
        $facts = "repos=$($parsed.repoCount) sites=$($parsed.siteCount) firstRepo=$firstRepo firstSite=$firstSite"
      } else {
        $resultCell = "EMPTY"
      }
    } else {
      $site = $parsed.selectedSite.site
      $prefetch = $parsed.selectedSite.prefetch
      $siteProfileReport = $parsed.selectedSite.profile
      $homeResult = $parsed.selectedSite.home
      $categoryResult = $parsed.selectedSite.category

      $homeOk = $false
      if ($null -ne $homeResult) {
        $homeOk = [bool]$homeResult.ok
      }

      $categoryOk = $true
      $hasCategoryResult = $null -ne $categoryResult
      if ($hasCategoryResult) {
        $categoryOk = [bool]$categoryResult.ok
      }

      if ($homeOk -and $hasCategoryResult -and $categoryOk) {
        $resultCell = "OK"
      } elseif ($homeOk) {
        $resultCell = "PARTIAL"
      } else {
        $resultCell = "FAIL"
      }

      $className = Get-SafeValue -Value ($homeResult.executionReport.className)
      if ($className -eq "-") {
        $className = Get-SafeValue -Value ($siteProfileReport.className)
      }

      $jarName = Get-LeafName -Path $prefetch.preparedJarPath
      $homeClassCount = Get-SafeValue -Value ($homeResult.payloadSummary.classCount)
      $listCount = if ($null -ne $categoryResult) { Get-SafeValue -Value ($categoryResult.payloadSummary.listCount) } else { "-" }
      $failureKind = Get-SafeValue -Value ($homeResult.failureKind)

      $facts = "site=$($site.key) class=$className jar=$jarName homeClass=$homeClassCount list=$listCount fail=$failureKind"
    }
  } catch {
    Write-Utf8 -Path $parseErrorPath -Content ($_ | Out-String)
  }

  $summary += "| $($case.Id) | $resultCell | $facts |"
}

Write-Utf8 -Path $summaryPath -Content ($summary -join [Environment]::NewLine)
Write-Host "[spider-diagnostics] done. Summary: $summaryPath"
