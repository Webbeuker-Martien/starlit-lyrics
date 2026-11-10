# Read-only spike: lists Windows media sessions (title, artist, timeline). Run while Spotify plays:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/media-session-spike.ps1
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$sessions = $mgr.GetSessions()
"sessions: $($sessions.Count)"
foreach ($s in $sessions) {
  $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $s.GetTimelineProperties()
  $pb = $s.GetPlaybackInfo()
  [pscustomobject]@{
    app = $s.SourceAppUserModelId; title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle
    status = $pb.PlaybackStatus; position = $tl.Position; end = $tl.EndTime; lastUpdated = $tl.LastUpdatedTime
    canSeek = $pb.Controls.IsPlaybackPositionEnabled; hasThumb = [bool]$props.Thumbnail
  } | Format-List
}
