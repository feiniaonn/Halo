param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = "Stop"

function Quote-CmdArg {
  param([string]$Value)

  if ([string]::IsNullOrEmpty($Value)) {
    return '""'
  }

  if ($Value -notmatch '[\s"&|<>^]') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Test-MsvcRoot {
  param([string]$Root)

  if (-not (Test-Path $Root)) {
    return $null
  }

  $vcVars = Join-Path $Root 'VC\Auxiliary\Build\vcvars64.bat'
  $msvcRoot = Join-Path $Root 'VC\Tools\MSVC'

  if (-not (Test-Path $vcVars) -or -not (Test-Path $msvcRoot)) {
    return $null
  }

  $toolsets = Get-ChildItem -Path $msvcRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

  foreach ($toolset in $toolsets) {
    $legacyStdIo = Join-Path $toolset.FullName 'lib\x64\legacy_stdio_definitions.lib'
    if (Test-Path $legacyStdIo) {
      return @{
        Root = $Root
        VcVars = $vcVars
        ToolsetDir = $toolset.FullName
        Toolset = $toolset.Name
        LegacyStdIo = $legacyStdIo
      }
    }
  }

  return $null
}

function Find-MsvcEnvironment {
  $roots = @(
    'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools',
    'C:\Program Files (x86)\Microsoft Visual Studio\18\Community',
    'C:\Program Files\Microsoft Visual Studio\18\Community',
    'C:\Program Files (x86)\Microsoft Visual Studio\18\Professional',
    'C:\Program Files\Microsoft Visual Studio\18\Professional',
    'C:\Program Files (x86)\Microsoft Visual Studio\18\Enterprise',
    'C:\Program Files\Microsoft Visual Studio\18\Enterprise',
    'C:\Program Files (x86)\Microsoft Visual Studio\17\BuildTools',
    'C:\Program Files (x86)\Microsoft Visual Studio\17\Community',
    'C:\Program Files\Microsoft Visual Studio\17\Community',
    'C:\Program Files (x86)\Microsoft Visual Studio\17\Professional',
    'C:\Program Files\Microsoft Visual Studio\17\Professional',
    'C:\Program Files (x86)\Microsoft Visual Studio\17\Enterprise',
    'C:\Program Files\Microsoft Visual Studio\17\Enterprise'
  )

  foreach ($root in $roots) {
    $match = Test-MsvcRoot -Root $root
    if ($null -ne $match) {
      return $match
    }
  }

  return $null
}

function Find-WindowsSdk {
  $sdkRoot = 'C:\Program Files (x86)\Windows Kits\10'
  $libRoot = Join-Path $sdkRoot 'Lib'
  $includeRoot = Join-Path $sdkRoot 'Include'

  if (-not (Test-Path $libRoot) -or -not (Test-Path $includeRoot)) {
    return $null
  }

  $versions = Get-ChildItem -Path $libRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

  foreach ($versionDir in $versions) {
    $version = $versionDir.Name
    $ucrtLib = Join-Path $versionDir.FullName 'ucrt\x64'
    $umLib = Join-Path $versionDir.FullName 'um\x64'
    $sdkIncludeDir = Join-Path $includeRoot $version
    $sharedInclude = Join-Path $sdkIncludeDir 'shared'
    $ucrtInclude = Join-Path $sdkIncludeDir 'ucrt'
    $umInclude = Join-Path $sdkIncludeDir 'um'
    $winrtInclude = Join-Path $sdkIncludeDir 'winrt'

    if (
      (Test-Path $ucrtLib) -and
      (Test-Path $umLib) -and
      (Test-Path $sharedInclude) -and
      (Test-Path $ucrtInclude) -and
      (Test-Path $umInclude) -and
      (Test-Path $winrtInclude)
    ) {
      return @{
        Root = $sdkRoot
        Version = $version
        LibDirs = @($ucrtLib, $umLib)
        IncludeDirs = @(
          $ucrtInclude,
          $sharedInclude,
          $umInclude,
          $winrtInclude,
          (Join-Path $sdkIncludeDir 'cppwinrt')
        ) | Where-Object { Test-Path $_ }
        BinDir = Join-Path $sdkRoot "bin\$version\x64"
      }
    }
  }

  return $null
}

$requiredSystemPaths = @(
  'C:\Windows\System32',
  'C:\Windows',
  'C:\Windows\System32\Wbem',
  'C:\Windows\System32\WindowsPowerShell\v1.0'
)

$pathEntries = @($env:Path -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$systemPathsForPrepend = [string[]]$requiredSystemPaths.Clone()
[array]::Reverse($systemPathsForPrepend)
foreach ($systemPath in $systemPathsForPrepend) {
  if ($pathEntries -notcontains $systemPath) {
    $env:Path = "$systemPath;$env:Path"
  }
}

$msvc = Find-MsvcEnvironment
if ($null -eq $msvc) {
  Write-Error "No usable MSVC x64 build environment was found (missing vcvars64.bat or legacy_stdio_definitions.lib)."
}

$sdk = Find-WindowsSdk
if ($null -eq $sdk) {
  Write-Error "No usable Windows 10/11 SDK was found (missing Include/Lib x64 folders)."
}

$msvcBinDir = Join-Path $msvc.ToolsetDir 'bin\HostX64\x64'
$msvcIncludeDir = Join-Path $msvc.ToolsetDir 'include'
$msvcLibDir = Join-Path $msvc.ToolsetDir 'lib\x64'
$vcInstallDir = (Join-Path $msvc.Root 'VC') + '\'

$env:VSCMD_ARG_TGT_ARCH = 'x64'
$env:VCINSTALLDIR = $vcInstallDir
$env:VCToolsInstallDir = "$($msvc.ToolsetDir)\"
$env:VCToolsVersion = $msvc.Toolset
$env:WindowsSdkDir = "$($sdk.Root)\"
$env:WindowsSDKVersion = "$($sdk.Version)\"
$env:UniversalCRTSdkDir = "$($sdk.Root)\"
$env:UCRTVersion = "$($sdk.Version)\"

$includeDirs = @($msvcIncludeDir) + $sdk.IncludeDirs
$libDirs = @($msvcLibDir) + $sdk.LibDirs
$pathPrepends = @($msvcBinDir, $sdk.BinDir) + $requiredSystemPaths

$existingInclude = @($env:INCLUDE -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$existingLib = @($env:LIB -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$existingLibPath = @($env:LIBPATH -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$existingPath = @($env:Path -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

$env:INCLUDE = (@($includeDirs + $existingInclude) | Select-Object -Unique) -join ';'
$env:LIB = (@($libDirs + $existingLib) | Select-Object -Unique) -join ';'
$env:LIBPATH = (@($libDirs + $existingLibPath) | Select-Object -Unique) -join ';'
$env:Path = (@($pathPrepends + $existingPath) | Select-Object -Unique) -join ';'

$pnpm = Get-Command pnpm -ErrorAction Stop

Write-Host "Using MSVC toolset $($msvc.Toolset) from $($msvc.Root)"
Write-Host "Using Windows SDK $($sdk.Version)"

& $pnpm.Source 'exec' 'tauri' @TauriArgs
exit $LASTEXITCODE
