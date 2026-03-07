$LibsDir = "d:\Development\Projects\Halo\src-tauri\resources\jar\libs"
if (!(Test-Path $LibsDir)) {
    New-Item -ItemType Directory -Path $LibsDir | Out-Null
}

$Urls = @(
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unidbg-api/0.9.8/unidbg-api-0.9.8.jar",
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unidbg-android/0.9.8/unidbg-android-0.9.8.jar",
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unicorn/2.0.2/unicorn-2.0.2.jar",
    "https://repo1.maven.org/maven2/net/java/dev/jna/jna/5.13.0/jna-5.13.0.jar"
)

foreach ($Url in $Urls) {
    $FileName = Split-Path $Url -Leaf
    $Dest = Join-Path $LibsDir $FileName
    if (!(Test-Path $Dest)) {
        Write-Host "Downloading $FileName..."
        Invoke-WebRequest -Uri $Url -OutFile $Dest
    } else {
        Write-Host "$FileName already exists."
    }
}
