param (
    [switch]$VerboseOutput = $false
)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = Join-Path $ProjectRoot "src"
$LibsDir = Join-Path (Split-Path $ProjectRoot) "resources\jar\libs"
$BuildRoot = Join-Path (Split-Path $ProjectRoot) "target\bridge-build"
$ClassesDir = Join-Path $BuildRoot "classes"
$OutputJar = Join-Path $BuildRoot "bridge.jar"
$SourcesFile = Join-Path $BuildRoot "sources.txt"
$JavacLog = Join-Path $BuildRoot "javac_log.txt"

function Ensure-Directory {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Sync-FileIfChanged {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    Ensure-Directory -Path (Split-Path $Destination -Parent)

    if (Test-Path $Destination) {
        $SourceHash = (Get-FileHash -Path $Source -Algorithm SHA256).Hash
        $DestinationHash = (Get-FileHash -Path $Destination -Algorithm SHA256).Hash
        if ($SourceHash -eq $DestinationHash) {
            return $false
        }
    }

    Copy-Item -Path $Source -Destination $Destination -Force
    return $true
}

function Resolve-BundledJavaTool {
    param (
        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    $Candidates = @(
        (Join-Path (Split-Path $ProjectRoot) "resources\java\windows-x64\runtime\bin\$ToolName"),
        (Join-Path (Split-Path $ProjectRoot) "target\release\resources\java\windows-x64\runtime\bin\$ToolName"),
        (Join-Path (Split-Path $ProjectRoot) "target\debug\resources\java\windows-x64\runtime\bin\$ToolName")
    )

    foreach ($Candidate in $Candidates) {
        if (Test-Path $Candidate) {
            return $Candidate
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:HALO_JAVA_HOME)) {
        $FromEnv = Join-Path $env:HALO_JAVA_HOME "bin\$ToolName"
        if (Test-Path $FromEnv) {
            return $FromEnv
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $FromEnv = Join-Path $env:JAVA_HOME "bin\$ToolName"
        if (Test-Path $FromEnv) {
            return $FromEnv
        }
    }

    throw "Bundled Java tool not found: $ToolName. Sync the project runtime first via src-tauri\\scripts\\sync_java_runtime.ps1."
}

Write-Host "Rebuilding Spider Bridge..." -ForegroundColor Cyan

Ensure-Directory -Path $BuildRoot

# Cleanup legacy generated files under watched directories.
$LegacyGeneratedPaths = @(
    (Join-Path $ProjectRoot "classes"),
    (Join-Path $ProjectRoot "sources.txt"),
    (Join-Path $ProjectRoot "javac_log.txt"),
    (Join-Path (Split-Path $ProjectRoot) "javac_log.txt")
)
foreach ($LegacyPath in $LegacyGeneratedPaths) {
    if (Test-Path $LegacyPath) {
        Remove-Item -Path $LegacyPath -Recurse -Force
    }
}

# 1. Clean previous build
Write-Host "-> Cleaning old classes..."
if (Test-Path $ClassesDir) {
    Remove-Item -Path $ClassesDir -Recurse -Force
}
Ensure-Directory -Path $ClassesDir

# 2. Gather Java files
Write-Host "-> Discovering source files..."
$JavaFiles = Get-ChildItem -Path $SrcDir -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName

if ($JavaFiles.Count -eq 0) {
    Write-Host "No .java files found! Aborting." -ForegroundColor Red
    exit 1
}

$JavaFiles -join [Environment]::NewLine | Out-File -FilePath $SourcesFile -Encoding ASCII

# 3. Gather libraries for classpath
Write-Host "-> Building classpath..."
$Jars = New-Object System.Collections.Generic.List[string]
Get-ChildItem -Path $LibsDir -Filter "*.jar" | ForEach-Object { $Jars.Add($_.FullName) }

$DexToolsDir = Join-Path (Split-Path $LibsDir) "dex-tools"
if (Test-Path $DexToolsDir) {
    Get-ChildItem -Path $DexToolsDir -Filter "*.jar" | ForEach-Object { $Jars.Add($_.FullName) }
    $DexToolsLibDir = Join-Path $DexToolsDir "lib"
    if (Test-Path $DexToolsLibDir) {
        Get-ChildItem -Path $DexToolsLibDir -Filter "*.jar" | ForEach-Object { $Jars.Add($_.FullName) }
    }
}
$ClassPath = $Jars -join ";"

# 4. Compile
Write-Host "-> Compiling $($JavaFiles.Count) Java files..."
$PreviousErrorAction = $ErrorActionPreference
$HadNativeErrorPreference = Test-Path Variable:PSNativeCommandUseErrorActionPreference
if ($HadNativeErrorPreference) {
    $PreviousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
}
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false
$JavacExe = Resolve-BundledJavaTool -ToolName "javac.exe"

if ($VerboseOutput) {
    & $JavacExe -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" -verbose > $JavacLog 2>&1
} else {
    & $JavacExe -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" > $JavacLog 2>&1
}

$ErrorActionPreference = $PreviousErrorAction
if ($HadNativeErrorPreference) {
    $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorPreference
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Compilation failed! (Exit Code: $LASTEXITCODE)" -ForegroundColor Red
    Remove-Item $SourcesFile
    exit $LASTEXITCODE
}

# 5. Package JAR
Write-Host "-> Packaging bridge.jar..."
$JarExe = Resolve-BundledJavaTool -ToolName "jar.exe"
Set-Location $ClassesDir
& $JarExe cvf $OutputJar . > $null
Set-Location $ProjectRoot

# Cleanup
Remove-Item $SourcesFile

# 6. Deploy to resources
Write-Host "-> Deploying to resources..."
$Targets = @(
    (Join-Path (Split-Path $ProjectRoot) "resources\jar"),
    (Join-Path (Split-Path $ProjectRoot) "target\debug\resources\jar"),
    (Join-Path (Split-Path $ProjectRoot) "target\debug\jar"),
    (Join-Path (Split-Path $ProjectRoot) "target\release\resources\jar"),
    (Join-Path (Split-Path $ProjectRoot) "target\release\jar")
)

foreach ($Target in $Targets) {
    if (Test-Path $Target) {
        $DestinationJar = Join-Path $Target "bridge.jar"
        if (Sync-FileIfChanged -Source $OutputJar -Destination $DestinationJar) {
            Write-Host "   Copied to: $Target"
        } else {
            Write-Host "   Up to date: $Target"
        }
    }
}

Write-Host "Build Successful! Output: $OutputJar" -ForegroundColor Green
exit 0
