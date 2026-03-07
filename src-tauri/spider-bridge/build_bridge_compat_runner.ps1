$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PatchSrcRoot = Join-Path $ProjectRoot "patch-src"
$BridgeSrcRoot = Join-Path $ProjectRoot "src"
$ClassesRoot = Join-Path $ProjectRoot "patch-classes"
$BridgeJar = Join-Path $ProjectRoot "..\resources\jar\bridge.jar"
$LibsRoot = Join-Path $ProjectRoot "..\resources\jar\libs"
$DexLibsRoot = Join-Path $ProjectRoot "..\resources\jar\dex-tools\lib"

if (-not (Test-Path $BridgeJar)) {
  throw "bridge.jar not found: $BridgeJar"
}

if (Test-Path $ClassesRoot) {
  Remove-Item -Recurse -Force $ClassesRoot
}
New-Item -ItemType Directory -Path $ClassesRoot | Out-Null

$JavaFiles = @(Get-ChildItem -Path $PatchSrcRoot -Recurse -Filter *.java | Select-Object -ExpandProperty FullName)
$TransformerSource = Join-Path $BridgeSrcRoot "com\halo\spider\DexSpiderTransformer.java"
if (Test-Path $TransformerSource) {
  $JavaFiles = @($JavaFiles + $TransformerSource)
}

if (-not $JavaFiles) {
  throw "No patch java sources found under $PatchSrcRoot"
}

$ClasspathParts = @($BridgeJar)
if (Test-Path $LibsRoot) {
  $ClasspathParts += (Join-Path $LibsRoot "*")
}
if (Test-Path $DexLibsRoot) {
  $ClasspathParts += (Join-Path $DexLibsRoot "*")
}
$Classpath = $ClasspathParts -join ";"

$javac = (Get-Command javac | Select-Object -ExpandProperty Source)
$javaBin = Split-Path -Parent $javac
$jar = Join-Path $javaBin "jar.exe"
if (-not (Test-Path $jar)) {
  $javaHomeLine = cmd /c "java -XshowSettings:properties -version 2>&1" | Select-String "java.home ="
  if ($javaHomeLine) {
    $javaHome = ($javaHomeLine -replace ".*java.home =\s*", "").Trim()
    $jar = Join-Path $javaHome "bin\\jar.exe"
  }
}
if (-not (Test-Path $jar)) {
  throw "jar.exe not found via javac or java.home"
}

& $javac --release 8 -encoding UTF-8 -cp $Classpath -d $ClassesRoot $JavaFiles
if ($LASTEXITCODE -ne 0) {
  throw "javac failed with exit code $LASTEXITCODE"
}

Push-Location $ClassesRoot
try {
  $CompiledClasses = Get-ChildItem -Path "com\halo\spider" -Filter *.class | ForEach-Object {
    $_.FullName.Substring($ClassesRoot.Length + 1).Replace("\", "/")
  }
  if (-not $CompiledClasses) {
    throw "No compiled bridge classes found under $ClassesRoot\\com\\halo\\spider"
  }

  & $jar uf $BridgeJar $CompiledClasses
  if ($LASTEXITCODE -ne 0) {
    throw "jar update failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Host "Updated bridge.jar with compiled bridge classes" -ForegroundColor Green
