param (
    [switch]$VerboseOutput = $false
)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = Join-Path $ProjectRoot "src"
$LibsDir = Join-Path (Split-Path $ProjectRoot) "resources\jar\libs"
$ClassesDir = Join-Path $ProjectRoot "classes"
$OutputJar = Join-Path $ProjectRoot "bridge.jar"

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

# 1. Clean previous build
Write-Host "-> Cleaning old classes..."
if (Test-Path $ClassesDir) {
    Remove-Item -Path $ClassesDir -Recurse -Force
}
New-Item -ItemType Directory -Path $ClassesDir | Out-Null

# 2. Gather Java files
Write-Host "-> Discovering source files..."
$JavaFiles = Get-ChildItem -Path $SrcDir -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName

if ($JavaFiles.Count -eq 0) {
    Write-Host "No .java files found! Aborting." -ForegroundColor Red
    exit 1
}

$SourcesFile = Join-Path $ProjectRoot "sources.txt"
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
$ErrorActionPreference = "Continue"
$JavacExe = Resolve-BundledJavaTool -ToolName "javac.exe"

if ($VerboseOutput) {
    & $JavacExe -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" -verbose > javac_log.txt 2>&1
} else {
    & $JavacExe -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" > javac_log.txt 2>&1
}

$ErrorActionPreference = $PreviousErrorAction

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
        Copy-Item -Path $OutputJar -Destination $Target -Force
        Write-Host "   Copied to: $Target"
    }
}

Write-Host "Build Successful! Output: $OutputJar" -ForegroundColor Green
exit 0
