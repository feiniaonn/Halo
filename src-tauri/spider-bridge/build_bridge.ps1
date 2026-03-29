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
$FoundationSourcesFile = Join-Path $BuildRoot "foundation-sources.txt"
$JavacLog = Join-Path $BuildRoot ("javac_log_{0}_{1}.txt" -f $PID, ([Guid]::NewGuid().ToString("N")))

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

function Invoke-JavacBatch {
    param (
        [Parameter(Mandatory = $true)]
        [string]$JavacExe,
        [Parameter(Mandatory = $true)]
        [string]$ClassPath,
        [Parameter(Mandatory = $true)]
        [string]$ClassesDir,
        [Parameter(Mandatory = $true)]
        [string[]]$Sources,
        [Parameter(Mandatory = $true)]
        [string]$ArgFile
    )

    if (-not $Sources -or $Sources.Count -eq 0) {
        return
    }

    $Sources -join [Environment]::NewLine | Out-File -FilePath $ArgFile -Encoding ASCII
    & $JavacExe -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$ArgFile" > $JavacLog 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "javac failed for $ArgFile (exit $LASTEXITCODE)"
    }
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
    $JavaFiles -join [Environment]::NewLine | Out-File -FilePath $SourcesFile -Encoding ASCII
    & $JavacExe -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" -verbose > $JavacLog 2>&1
} else {
    Invoke-JavacBatch -JavacExe $JavacExe -ClassPath $ClassPath -ClassesDir $ClassesDir -Sources $JavaFiles -ArgFile $SourcesFile
}

$ErrorActionPreference = $PreviousErrorAction
if ($HadNativeErrorPreference) {
    $PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorPreference
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Compilation failed! (Exit Code: $LASTEXITCODE)" -ForegroundColor Red
    Remove-Item $SourcesFile -ErrorAction SilentlyContinue
    exit $LASTEXITCODE
}

$RequiredFoundationClasses = @(
    (Join-Path $ClassesDir "android\content\Context.class"),
    (Join-Path $ClassesDir "android\content\DialogInterface.class"),
    (Join-Path $ClassesDir "android\app\Application.class"),
    (Join-Path $ClassesDir "android\app\Activity.class"),
    (Join-Path $ClassesDir "android\app\ActivityThread.class"),
    (Join-Path $ClassesDir "android\webkit\WebViewClient.class"),
    (Join-Path $ClassesDir "android\os\Environment.class"),
    (Join-Path $ClassesDir "android\view\View.class"),
    (Join-Path $ClassesDir "android\view\ViewGroup.class"),
    (Join-Path $ClassesDir "android\widget\TextView.class"),
    (Join-Path $ClassesDir "android\widget\EditText.class"),
    (Join-Path $ClassesDir "android\widget\FrameLayout.class"),
    (Join-Path $ClassesDir "android\widget\LinearLayout.class"),
    (Join-Path $ClassesDir "android\widget\Toast.class"),
    (Join-Path $ClassesDir "com\github\catvod\crawler\Spider.class"),
    (Join-Path $ClassesDir "com\github\catvod\crawler\SpiderApi.class"),
    (Join-Path $ClassesDir "com\github\catvod\spider\Init.class"),
    (Join-Path $ClassesDir "com\github\catvod\spider\BaseSpiderAmns.class"),
    (Join-Path $ClassesDir "com\halo\spider\SpiderProfileRunner.class")
)

$MissingFoundationClasses = $RequiredFoundationClasses | Where-Object { -not (Test-Path $_) }
if ($MissingFoundationClasses.Count -gt 0) {
    Write-Host "-> Repairing foundational bridge classes..." -ForegroundColor Yellow
    $FoundationSources = @()
    $FoundationSources += Get-ChildItem -Path (Join-Path $SrcDir "android") -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName
    $FoundationSources += Get-ChildItem -Path (Join-Path $SrcDir "com\github\catvod\crawler") -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName
    $FoundationSources += Get-ChildItem -Path (Join-Path $SrcDir "com\github\catvod\bean") -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName
    $FoundationSources += Get-ChildItem -Path (Join-Path $SrcDir "com\github\catvod\net") -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName

    $OptionalFoundationFiles = @(
        (Join-Path $SrcDir "com\github\catvod\Proxy.java"),
        (Join-Path $SrcDir "com\github\catvod\spider\Init.java"),
        (Join-Path $SrcDir "com\github\catvod\spider\Spider.java"),
        (Join-Path $SrcDir "com\github\catvod\spider\BaseSpiderAmns.java")
    )
    foreach ($OptionalFile in $OptionalFoundationFiles) {
        if (Test-Path $OptionalFile) {
            $FoundationSources += $OptionalFile
        }
    }

    $FoundationSources = $FoundationSources | Sort-Object -Unique
    $RepairClassPath = @($ClassesDir, $ClassPath) -join ";"
    Invoke-JavacBatch -JavacExe $JavacExe -ClassPath $RepairClassPath -ClassesDir $ClassesDir -Sources $FoundationSources -ArgFile $FoundationSourcesFile
}

# 5. Package JAR
Write-Host "-> Packaging bridge.jar..."
$JarExe = Resolve-BundledJavaTool -ToolName "jar.exe"
Set-Location $ClassesDir
& $JarExe cvf $OutputJar . > $null
Set-Location $ProjectRoot

# Cleanup
Remove-Item $SourcesFile -ErrorAction SilentlyContinue
Remove-Item $FoundationSourcesFile -ErrorAction SilentlyContinue

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
