param(
  [ValidateSet("debug", "release")]
  [string]$Profile = "debug",
  [int]$MaxSiteCases = 6,
  [string[]]$SourceSlugs = @(),
  [string[]]$SiteIds = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $false

$projectRoot = Split-Path -Parent $PSScriptRoot
$reportRoot = Join-Path $PSScriptRoot "reports\$Profile\single-source-audit"
$summaryPath = Join-Path $PSScriptRoot "summary-single-source-$Profile-2026-03-09.md"
$docsDir = Join-Path $projectRoot "docs"
$sourceListPath = Get-ChildItem -Path $docsDir -Filter *.txt |
  Where-Object {
    try {
      ([System.IO.File]::ReadAllText($_.FullName) -match 'fty\.xxooo\.cf/tv')
    } catch {
      $false
    }
  } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $sourceListPath) {
  throw "Could not locate the single-source list under docs\\*.txt"
}

New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

function Write-Utf8 {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Normalize-Text {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return $Value.Trim()
}

function Normalize-SourceKey {
  param([string]$Url)

  $trimmed = Normalize-Text $Url
  if (-not $trimmed) {
    return ""
  }

  try {
    $uri = [System.Uri]$trimmed
    $path = $uri.AbsolutePath.TrimEnd('/')
    if (-not $path) {
      $path = "/"
    }
    return ("{0}://{1}{2}" -f $uri.Scheme.ToLowerInvariant(), $uri.IdnHost.ToLowerInvariant(), $path)
  } catch {
    return $trimmed.TrimEnd('/').ToLowerInvariant()
  }
}

function Get-SourceSlug {
  param([string]$Url)

  $normalized = Normalize-SourceKey $Url
  if (-not $normalized) {
    return "unknown"
  }

  $slug = ($normalized -replace '^[a-z]+://', '' -replace '[^a-zA-Z0-9]+', '-')
  $slug = $slug.Trim('-').ToLowerInvariant()
  if (-not $slug) {
    return "unknown"
  }
  return $slug
}

function Get-SafeSlug {
  param([string]$Text)

  $value = Normalize-Text $Text
  if (-not $value) {
    return "unknown"
  }

  $slug = ($value -replace '[^a-zA-Z0-9]+', '-')
  $slug = $slug.Trim('-').ToLowerInvariant()
  if (-not $slug) {
    return "unknown"
  }
  return $slug
}

function Expand-ListValues {
  param([string[]]$Values)

  $expanded = New-Object System.Collections.Generic.List[string]
  foreach ($value in $Values) {
    $text = Normalize-Text $value
    if (-not $text) {
      continue
    }

    foreach ($part in ($text -split ',')) {
      $trimmed = Normalize-Text $part
      if ($trimmed) {
        $expanded.Add($trimmed)
      }
    }
  }

  return @($expanded)
}

function Read-SingleSourceUrls {
  param([string]$Path)

  $raw = [System.IO.File]::ReadAllText($Path)
  $matches = [regex]::Matches($raw, 'https?://[^\s\r\n]+')

  $urls = New-Object System.Collections.Generic.List[string]
  $seen = @{}
  foreach ($match in $matches) {
    $url = $match.Value.Trim()
    $normalized = Normalize-SourceKey $url
    if (-not $normalized -or $seen.ContainsKey($normalized)) {
      continue
    }
    $seen[$normalized] = $true
    $urls.Add($url)
  }

  return @($urls)
}

function Get-CandidateUrls {
  param([string]$Url)

  switch (Normalize-SourceKey $Url) {
    "http://fty.xxooo.cf/tv" {
      return @(
        "http://www.xn--sss604efuw.net/tv",
        "http://cdn.qiaoji8.com/tvbox.json",
        "https://gh-proxy.net/https://raw.githubusercontent.com/yoursmile66/TVBox/refs/heads/main/XC.json",
        "https://gitee.com/xxoooo/fan/raw/master/in.bmp"
      )
    }
    "http://tvbox.xn--4kq62z5rby2qupq9ub.top/" {
      return @(
        "http://www.xn--sss604efuw.net/tv",
        "http://cdn.qiaoji8.com/tvbox.json",
        "https://gh-proxy.net/https://raw.githubusercontent.com/yoursmile66/TVBox/refs/heads/main/XC.json"
      )
    }
    default {
      return @()
    }
  }
}

function Extract-DiagJson {
  param([string]$Text)

  $match = [regex]::Match(
    $Text,
    '>>HALO_SPIDER_DIAG<<\s*(\{.*\})\s*>>HALO_SPIDER_DIAG<<',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $match.Success) {
    throw "Could not find HALO_SPIDER_DIAG payload"
  }

  return $match.Groups[1].Value
}

function Invoke-SpiderDiag {
  param(
    [string]$ExePath,
    [string]$Source,
    [string]$OutputDir,
    [string]$Repo = "",
    [string]$Site = ""
  )

  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

  $args = @("--source", $Source)
  if (-not [string]::IsNullOrWhiteSpace($Repo)) {
    $args += @("--repo", $Repo)
  }
  if (-not [string]::IsNullOrWhiteSpace($Site)) {
    $args += @("--site", $Site)
  }

  $escapedArgs = $args | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  $cmdLine = '"' + $ExePath + '" ' + ($escapedArgs -join ' ') + ' 2>&1'
  $raw = & cmd /d /s /c $cmdLine | Out-String
  $exitCode = $LASTEXITCODE

  Write-Utf8 -Path (Join-Path $OutputDir "raw.log") -Content $raw

  $report = $null
  $errorText = ""
  if ($exitCode -eq 0) {
    try {
      $jsonText = Extract-DiagJson -Text $raw
      Write-Utf8 -Path (Join-Path $OutputDir "report.json") -Content $jsonText
      $report = $jsonText | ConvertFrom-Json
    } catch {
      $errorText = ($_ | Out-String).Trim()
      Write-Utf8 -Path (Join-Path $OutputDir "parse-error.log") -Content $errorText
    }
  } else {
    $errorText = $raw.Trim()
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $raw
    Report = $report
    Error = $errorText
    OutputDir = $OutputDir
  }
}

function Invoke-HttpProbe {
  param(
    [string]$Url,
    [string]$OutputDir
  )

  $probeDir = Join-Path $OutputDir "http-probe"
  New-Item -ItemType Directory -Force -Path $probeDir | Out-Null

  $response = & curl.exe -sS -i -L --max-time 20 $Url 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  Write-Utf8 -Path (Join-Path $probeDir "response.txt") -Content $response

  $classification = "unknown"
  $head = $response.ToLowerInvariant()
  if ($exitCode -ne 0) {
    if ($head.Contains("empty reply")) {
      $classification = "empty-reply"
    } elseif ($head.Contains("ssl") -or $head.Contains("schannel")) {
      $classification = "tls-failure"
    } elseif ($head.Contains("timed out")) {
      $classification = "timeout"
    } else {
      $classification = "request-failed"
    }
  } elseif ($head.Contains("<!doctype html") -or $head.Contains("<html")) {
    $classification = "html-wrapper"
  } elseif ($head.Contains("jfif")) {
    $classification = "mixed-binary-payload"
  } elseif ($head.Contains('"sites"') -or $head.Contains('"urls"')) {
    $classification = "tvbox-json"
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Classification = $classification
  }
}

function Select-SiteTargets {
  param(
    $RootReport,
    [int]$Limit,
    [int[]]$PreferredSiteIds = @()
  )

  if ($null -eq $RootReport -or $null -eq $RootReport.sites) {
    return @()
  }

  $patterns = @(
    "douban",
    "tgyun",
    "ttian",
    "jpys",
    "qiao2",
    "qiji",
    "zxzj",
    "czsapp",
    "czzy",
    "guazi",
    "configcenter"
  )

  $selected = New-Object System.Collections.Generic.List[object]
  $taken = @{}

  foreach ($siteId in $PreferredSiteIds) {
    $match = $RootReport.sites | Where-Object { [int]$_.index -eq $siteId } | Select-Object -First 1
    if ($null -eq $match) {
      continue
    }
    if ($taken.ContainsKey($match.index)) {
      continue
    }
    $selected.Add($match)
    $taken[$match.index] = $true
    if ($selected.Count -ge $Limit) {
      return $selected.ToArray()
    }
  }

  foreach ($pattern in $patterns) {
    $match = $RootReport.sites | Where-Object {
      $api = [string]$_.apiClass
      $key = [string]$_.key
      $name = [string]$_.name
      $api.ToLowerInvariant().Contains($pattern) -or
      $key.ToLowerInvariant().Contains($pattern) -or
      $name.ToLowerInvariant().Contains($pattern)
    } | Select-Object -First 1

    if ($null -eq $match) {
      continue
    }
    if ($taken.ContainsKey($match.index)) {
      continue
    }
    $selected.Add($match)
    $taken[$match.index] = $true
    if ($selected.Count -ge $Limit) {
      return $selected.ToArray()
    }
  }

  foreach ($site in $RootReport.sites) {
    if ($selected.Count -ge $Limit) {
      break
    }
    if ($taken.ContainsKey($site.index)) {
      continue
    }
    $selected.Add($site)
    $taken[$site.index] = $true
  }

  return $selected.ToArray()
}

function Write-SiteSummary {
  param(
    $SiteDiag,
    [string]$Path,
    [string]$Source
  )

  if ($null -eq $SiteDiag.Report) {
    return
  }

  $homeResult = $SiteDiag.Report.selectedSite.home
  $categoryResult = $SiteDiag.Report.selectedSite.category
  $primaryExecution = if ($homeResult -and $homeResult.executionReport) {
    $homeResult.executionReport
  } elseif ($categoryResult -and $categoryResult.executionReport) {
    $categoryResult.executionReport
  } else {
    $null
  }
  $siteProfile = if ($primaryExecution) { $primaryExecution.siteProfile } else { $null }
  $artifact = if ($primaryExecution) { $primaryExecution.artifact } else { $null }

  $summary = [ordered]@{
    source = $Source
    siteIndex = $SiteDiag.Report.selectedSite.site.index
    siteKey = $SiteDiag.Report.selectedSite.site.key
    apiClass = $SiteDiag.Report.selectedSite.site.apiClass
    className = if ($homeResult) { $homeResult.executionReport.className } else { "" }
    jar = if ($SiteDiag.Report.selectedSite.prefetch) {
      Split-Path -Leaf $SiteDiag.Report.selectedSite.prefetch.preparedJarPath
    } else {
      ""
    }
    artifactKind = if ($artifact) { $artifact.artifactKind } else { "" }
    requiredRuntime = if ($artifact) { $artifact.requiredRuntime } else { "" }
    homeOk = if ($homeResult) { [bool]$homeResult.ok } else { $false }
    categoryOk = if ($categoryResult) { [bool]$categoryResult.ok } else { $false }
    executionTarget = if ($primaryExecution) { $primaryExecution.executionTarget } else { "" }
    missingDependency = if ($primaryExecution) { $primaryExecution.missingDependency } else { $null }
    requiredCompatPacks = if ($siteProfile) { @($siteProfile.requiredCompatPacks) } else { @() }
    helperPorts = if ($siteProfile) { @($siteProfile.requiredHelperPorts) } else { @() }
    routingReason = if ($siteProfile) { $siteProfile.routingReason } else { "" }
    classCount = if ($homeResult -and $homeResult.payloadSummary) { $homeResult.payloadSummary.classCount } else { 0 }
    listCount = if ($categoryResult -and $categoryResult.payloadSummary) { $categoryResult.payloadSummary.listCount } else { 0 }
    failureKind = if ($homeResult -and $homeResult.failureKind) {
      $homeResult.failureKind
    } elseif ($categoryResult) {
      $categoryResult.failureKind
    } else {
      ""
    }
  } | ConvertTo-Json -Depth 6

  Write-Utf8 -Path $Path -Content $summary
}

function Write-RootSummary {
  param(
    $RootDiag,
    [string]$Path,
    [string]$Source
  )

  if ($null -eq $RootDiag.Report) {
    return
  }

  $sites = @($RootDiag.Report.sites)
  $apiClassDistribution = @(
    $sites |
      Group-Object apiClass |
      Sort-Object Name |
      ForEach-Object {
        $first = $_.Group | Select-Object -First 1
        [ordered]@{
          apiClass = $_.Name
          count = $_.Count
          sampleIndex = $first.index
          sampleKey = $first.key
          spider = Split-Path -Leaf ([string]$first.spiderUrl)
        }
      }
  )

  $spiderDistribution = @(
    $sites |
      Group-Object spiderUrl |
      Sort-Object @{ Expression = "Count"; Descending = $true }, @{ Expression = "Name"; Descending = $false } |
      ForEach-Object {
        $leaf = Split-Path -Leaf ([string]$_.Name)
        $sampleClasses = @($_.Group | Select-Object -ExpandProperty apiClass -Unique | Select-Object -First 10)
        [ordered]@{
          spider = $leaf
          siteCount = $_.Count
          sampleApiClasses = $sampleClasses
        }
      }
  )

  $summary = [ordered]@{
    source = $Source
    siteCount = $RootDiag.Report.siteCount
    repoCount = $RootDiag.Report.repoCount
    spider = Split-Path -Leaf ([string]$RootDiag.Report.spiderUrl)
    uniqueApiClassCount = @($apiClassDistribution).Count
    jarOverrideCount = @($sites | Where-Object { $_.hasJarOverride }).Count
    runtimeBridgeJar = Split-Path -Leaf ([string]$RootDiag.Report.bridge.runtimeBridgeJar)
    profileBridgeJar = Split-Path -Leaf ([string]$RootDiag.Report.bridge.profileBridgeJar)
    profileBridgeDiffers = [bool]$RootDiag.Report.bridge.profileJarDiffersFromRuntime
    apiClassDistribution = $apiClassDistribution
    spiderDistribution = $spiderDistribution
  } | ConvertTo-Json -Depth 8

  Write-Utf8 -Path $Path -Content $summary
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

$sources = Read-SingleSourceUrls -Path $sourceListPath
$preferredSiteIds = Expand-ListValues -Values $SiteIds | ForEach-Object {
  $parsed = 0
  if ([int]::TryParse($_, [ref]$parsed)) {
    $parsed
  }
} | Where-Object { $_ -gt 0 } | Select-Object -Unique

if ($SourceSlugs.Count -gt 0) {
  $sourceSlugFilters = Expand-ListValues -Values $SourceSlugs
  $wanted = @{}
  foreach ($slug in $sourceSlugFilters) {
    $wanted[(Get-SafeSlug $slug)] = $true
  }
  $sources = @($sources | Where-Object {
    $slug = Get-SourceSlug $_
    $wanted.ContainsKey($slug)
  })
}
$summary = New-Object System.Collections.Generic.List[string]
$summary.Add("# Single Source Audit ($Profile)")
$summary.Add("")
$summary.Add("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')")
$summary.Add("")
$summary.Add("## Root Results")
$summary.Add("")
$summary.Add("| Source | Result | Sites | Spider | Notes |")
$summary.Add("|--------|--------|-------|--------|-------|")

foreach ($source in $sources) {
  $sourceSlug = Get-SourceSlug $source
  $sourceDir = Join-Path $reportRoot $sourceSlug
  $rootDir = Join-Path $sourceDir "root"

  Write-Host "[spider-diagnostics] root audit: $source"
  $rootDiag = Invoke-SpiderDiag -ExePath $exePath -Source $source -OutputDir $rootDir

  $rootResult = "FAIL"
  $siteCount = "-"
  $spiderLeaf = "-"
  $note = ""

  if ($rootDiag.Report) {
    $rootResult = "OK"
    $siteCount = [string]$rootDiag.Report.siteCount
    $rootSpider = Normalize-Text ([string]$rootDiag.Report.spiderUrl)
    if ($rootSpider) {
      $spiderLeaf = Split-Path -Leaf $rootSpider
    }
    Write-RootSummary -RootDiag $rootDiag -Path (Join-Path $rootDir "summary.json") -Source $source

    $targets = Select-SiteTargets -RootReport $rootDiag.Report -Limit $MaxSiteCases -PreferredSiteIds $preferredSiteIds
    foreach ($target in $targets) {
      $siteSlug = "{0:D2}-{1}" -f $target.index, (Get-SafeSlug ([string]$target.apiClass))
      $siteDir = Join-Path $sourceDir $siteSlug
      Write-Host "[spider-diagnostics] site audit: $source :: $($target.apiClass)"
      $siteDiag = Invoke-SpiderDiag -ExePath $exePath -Source $source -Site ([string]$target.index) -OutputDir $siteDir
      Write-SiteSummary -SiteDiag $siteDiag -Path (Join-Path $siteDir "summary.json") -Source $source
    }
  } else {
    $probe = Invoke-HttpProbe -Url $source -OutputDir $rootDir
    $note = $probe.Classification

    foreach ($candidate in (Get-CandidateUrls -Url $source)) {
      $candidateSlug = "candidate-" + (Get-SourceSlug $candidate)
      $candidateDir = Join-Path $sourceDir $candidateSlug
      Write-Host "[spider-diagnostics] candidate audit: $candidate"
      $candidateDiag = Invoke-SpiderDiag -ExePath $exePath -Source $candidate -OutputDir $candidateDir

      if (-not $candidateDiag.Report) {
        Invoke-HttpProbe -Url $candidate -OutputDir $candidateDir | Out-Null
        continue
      }

      $targets = Select-SiteTargets -RootReport $candidateDiag.Report -Limit ([Math]::Min(4, $MaxSiteCases)) -PreferredSiteIds $preferredSiteIds
      foreach ($target in $targets) {
        $siteSlug = "{0:D2}-{1}" -f $target.index, (Get-SafeSlug ([string]$target.apiClass))
        $siteDir = Join-Path $candidateDir $siteSlug
        $siteDiag = Invoke-SpiderDiag -ExePath $exePath -Source $candidate -Site ([string]$target.index) -OutputDir $siteDir
        Write-SiteSummary -SiteDiag $siteDiag -Path (Join-Path $siteDir "summary.json") -Source $candidate
      }
    }
  }

  $summary.Add("| $source | $rootResult | $siteCount | $spiderLeaf | $note |")
}

$summary.Add("")
$summary.Add("## Notes")
$summary.Add("")
$summary.Add("- Failed roots write http-probe/response.txt under the same report directory.")
$summary.Add("- Successful roots continue with representative site diagnostics and write summary.json, raw.log, report.json.")
$summary.Add("- candidate-* directories store probes for links extracted from wrapper pages.")

Write-Utf8 -Path $summaryPath -Content ($summary -join [Environment]::NewLine)
Write-Host "[spider-diagnostics] done. Summary: $summaryPath"
