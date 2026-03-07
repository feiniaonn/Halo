param (
    [switch]$VerboseOutput = $false
)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = Join-Path $ProjectRoot "src"
$LibsDir = Join-Path (Split-Path $ProjectRoot) "resources\jar\libs"
$ClassesDir = Join-Path $ProjectRoot "classes"
$OutputJar = Join-Path $ProjectRoot "bridge.jar"

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

if ($VerboseOutput) {
    javac -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" -verbose > javac_log.txt 2>&1
} else {
    javac -cp $ClassPath -d $ClassesDir -encoding UTF-8 "@$SourcesFile" > javac_log.txt 2>&1
}

$ErrorActionPreference = $PreviousErrorAction

if ($LASTEXITCODE -ne 0) {
    Write-Host "Compilation failed! (Exit Code: $LASTEXITCODE)" -ForegroundColor Red
    Remove-Item $SourcesFile
    exit $LASTEXITCODE
}

# 5. Package JAR
Write-Host "-> Packaging bridge.jar..."
$JavaHome = (java -XshowSettings:properties 2>&1 | Select-String "java.home").ToString().Trim().Split("=")[1].Trim()
$JarExe = Join-Path $JavaHome "bin\jar.exe"
if (!(Test-Path $JarExe)) {
    $JarExe = "jar"
}
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
    (Join-Path (Split-Path $ProjectRoot) "target\debug\jar")
)

foreach ($Target in $Targets) {
    if (Test-Path $Target) {
        Copy-Item -Path $OutputJar -Destination $Target -Force
        Write-Host "   Copied to: $Target"
    }
}

Write-Host "Build Successful! Output: $OutputJar" -ForegroundColor Green
exit 0

