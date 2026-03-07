$LibsDir = "d:\Development\Projects\Halo\src-tauri\resources\jar\libs"
$Urls = @(
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unidbg-api/0.9.8/unidbg-api-0.9.8.jar",
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unidbg-android/0.9.8/unidbg-android-0.9.8.jar",
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unicorn/1.0.14/unicorn-1.0.14.jar",
    "https://repo1.maven.org/maven2/com/github/zhkl0228/capstone/3.0.4/capstone-3.0.4.jar",
    "https://repo1.maven.org/maven2/net/java/dev/jna/jna/5.13.0/jna-5.13.0.jar",
    "https://repo1.maven.org/maven2/org/slf4j/slf4j-api/1.7.36/slf4j-api-1.7.36.jar",
    "https://repo1.maven.org/maven2/org/slf4j/slf4j-simple/1.7.36/slf4j-simple-1.7.36.jar"
)

foreach ($Url in $Urls) {
    $FileName = Split-Path $Url -Leaf
    $Dest = Join-Path $LibsDir $FileName
    Write-Host "Checking $FileName..."
    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($Url, $Dest)
        Write-Host "Success."
    } catch {
        Write-Host "Failed: $Url" -ForegroundColor Red
    }
}
