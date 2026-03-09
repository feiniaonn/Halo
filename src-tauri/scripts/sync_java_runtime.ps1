param(
    [string]$JavaHome = "",
    [switch]$UseJlink = $false,
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$JavaResourcesRoot = Join-Path $ProjectRoot "resources\java"
$ResourcesRoot = Join-Path $JavaResourcesRoot "windows-x64"
$RuntimeRoot = Join-Path $ResourcesRoot "runtime"
$RuntimeVersionFile = Join-Path $ResourcesRoot "runtime-version.txt"

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    if (-not [string]::IsNullOrWhiteSpace($env:HALO_JAVA_HOME)) {
        $JavaHome = $env:HALO_JAVA_HOME
    } elseif (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $JavaHome = $env:JAVA_HOME
    }
}

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    throw "Provide -JavaHome or set HALO_JAVA_HOME / JAVA_HOME."
}

$JavaHome = [System.IO.Path]::GetFullPath($JavaHome)
$JavaExe = Join-Path $JavaHome "bin\java.exe"
if (-not (Test-Path $JavaExe)) {
    throw "Invalid Java Home: $JavaHome"
}

if ((Test-Path $RuntimeRoot) -and -not $Force) {
    throw "Runtime directory already exists: $RuntimeRoot. Use -Force to overwrite."
}

if (Test-Path $RuntimeRoot) {
    Remove-Item -Path $RuntimeRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $ResourcesRoot -Force | Out-Null

$JavaVersion = (& cmd /c "`"$JavaExe`" -version 2>&1" | Select-Object -First 1).ToString()
$JlinkExe = Join-Path $JavaHome "bin\jlink.exe"
$JmodsDir = Join-Path $JavaHome "jmods"

if ($UseJlink -and (Test-Path $JlinkExe) -and (Test-Path $JmodsDir)) {
    $Modules = @(
        "java.base",
        "java.desktop",
        "java.logging",
        "java.management",
        "java.naming",
        "java.net.http",
        "java.prefs",
        "java.scripting",
        "java.security.jgss",
        "java.sql",
        "jdk.crypto.cryptoki",
        "jdk.crypto.ec",
        "jdk.zipfs",
        "jdk.unsupported"
    ) -join ","

    Write-Host "Using jlink to create bundled runtime..." -ForegroundColor Cyan
    & $JlinkExe `
        --module-path $JmodsDir `
        --add-modules $Modules `
        --output $RuntimeRoot `
        --bind-services `
        --strip-debug `
        --no-header-files `
        --no-man-pages `
        --compress=2
} else {
    Write-Host "Copying full JDK runtime..." -ForegroundColor Yellow
    Copy-Item -Path $JavaHome -Destination $RuntimeRoot -Recurse -Force
}

$RuntimeJavaExe = Join-Path $RuntimeRoot "bin\java.exe"
if (-not (Test-Path $RuntimeJavaExe)) {
    throw "Bundled runtime is missing java.exe: $RuntimeJavaExe"
}

@(
    "source=$JavaHome"
    "java=$JavaVersion"
    "generatedAt=$([DateTimeOffset]::UtcNow.ToString('u'))"
) | Set-Content -Path $RuntimeVersionFile -Encoding UTF8

foreach ($TargetRoot in @(
    (Join-Path $ProjectRoot "target\debug\resources\java"),
    (Join-Path $ProjectRoot "target\release\resources\java")
)) {
    $TargetParent = Split-Path -Parent $TargetRoot
    if (-not (Test-Path $TargetParent)) {
        continue
    }
    if (Test-Path $TargetRoot) {
        Remove-Item -Path $TargetRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TargetParent -Force | Out-Null
    Copy-Item -Path $JavaResourcesRoot -Destination $TargetParent -Recurse -Force
    Write-Host "Synced runtime to: $TargetRoot" -ForegroundColor DarkCyan
}

Write-Host "Bundled Java runtime is ready: $RuntimeRoot" -ForegroundColor Green
