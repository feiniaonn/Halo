$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcRoot = Join-Path $repoRoot "compat-helper-src"
$buildRoot = Join-Path $repoRoot "target\\compat-helper-build"
$classesRoot = Join-Path $buildRoot "classes"
$jarRoot = Join-Path $repoRoot "resources\\jar\\compat"
$jarPath = Join-Path $jarRoot "compat_helper.jar"

New-Item -ItemType Directory -Force -Path $classesRoot | Out-Null
New-Item -ItemType Directory -Force -Path $jarRoot | Out-Null
Remove-Item -Recurse -Force $classesRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $classesRoot | Out-Null

$javaHome = Split-Path -Parent (Split-Path -Parent (Get-Command javac | Select-Object -ExpandProperty Source))
$javac = Join-Path $javaHome "bin\\javac.exe"
if (-not (Test-Path $javac)) {
  $javac = (Get-Command javac | Select-Object -ExpandProperty Source)
}

$sources = Get-ChildItem -Path $srcRoot -Recurse -Filter *.java | Select-Object -ExpandProperty FullName
if (-not $sources) {
  throw "No compat helper Java sources found under $srcRoot"
}

& $javac --release 8 -encoding UTF-8 -d $classesRoot $sources
if ($LASTEXITCODE -ne 0) {
  throw "javac failed with exit code $LASTEXITCODE"
}

if (Test-Path $jarPath) {
  Remove-Item -Force $jarPath
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$fileStream = [System.IO.File]::Open($jarPath, [System.IO.FileMode]::Create)
try {
  $archive = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    Get-ChildItem -Path $classesRoot -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($classesRoot.Length).TrimStart('\').Replace('\', '/')
      $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
      $entryStream = $entry.Open()
      $inputStream = [System.IO.File]::OpenRead($_.FullName)
      try {
        $inputStream.CopyTo($entryStream)
      } finally {
        $inputStream.Dispose()
        $entryStream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
} finally {
  $fileStream.Dispose()
}
Write-Host "Built compat helper jar: $jarPath"
