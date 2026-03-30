[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
$managerTask = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$managerTask.AsTask().Wait()
$manager = $managerTask.GetResults()

$sessions = $manager.GetSessions()
foreach ($session in $sessions) {
    $appId = $session.SourceAppUserModelId
    $mediaTask = $session.TryGetMediaPropertiesAsync()
    $mediaTask.AsTask().Wait()
    $mediaInfo = $mediaTask.GetResults()
    
    $timeline = $session.GetTimelineProperties()
    $playbackInfo = $session.GetPlaybackInfo()
    
    Write-Host "AppId: $appId"
    Write-Host "Title: $($mediaInfo.Title)"
    Write-Host "Artist: $($mediaInfo.Artist)"
    if ($timeline) {
        Write-Host "Position: $($timeline.Position.TotalSeconds)"
        Write-Host "Duration: $($timeline.EndTime.TotalSeconds)"
        Write-Host "Last Updated: $($timeline.LastUpdatedTime)"
    } else {
        Write-Host "Timeline: Null"
    }
    if ($playbackInfo) {
        Write-Host "Status: $($playbackInfo.PlaybackStatus)"
    } else {
        Write-Host "Status: Null"
    }
    Write-Host "--------------------"
}
