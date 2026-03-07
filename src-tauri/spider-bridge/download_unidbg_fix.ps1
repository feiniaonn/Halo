$LibsDir = "d:\Development\Projects\Halo\src-tauri\resources\jar\libs"
$Urls = @(
    "https://repo1.maven.org/maven2/com/github/zhkl0228/unicorn/2.0.2/unicorn-2.0.2.jar",
    "https://repo1.maven.org/maven2/com/github/zhkl0228/capstone/3.0.4/capstone-3.0.4.jar",
    "https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0/commons-lang3-3.12.0.jar"
)

foreach ($Url in $Urls) {
    $FileName = Split-Path $Url -Leaf
    $Dest = Join-Path $LibsDir $FileName
    if (!(Test-Path $Dest)) {
        Write-Host "Downloading $FileName..."
        try {
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($Url, $Dest)
            Write-Host "Done."
        } catch {
            Write-Host "Failed to download $FileName : $_" -ForegroundColor Red
        }
    } else {
        Write-Host "$FileName already exists."
    }
}
