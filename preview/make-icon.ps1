# Generates media/icon.png (128x128): night-sky disc with a cream four-point star and a few small stars.
Add-Type -AssemblyName System.Drawing
$size = 128
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.Rectangle 4, 4, 120, 120
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 0, 0, 0)), ([System.Drawing.Color]::FromArgb(255, 20, 43, 68)), 90
$g.FillEllipse($brush, $rect)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 255, 255, 255)), 4
$g.DrawEllipse($pen, 4, 4, 120, 120)

$cream = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 243, 196))
function Star($cx, $cy, $r, $w) {
  $pts = @(
    (New-Object System.Drawing.PointF $cx, ($cy - $r)), (New-Object System.Drawing.PointF ($cx + $w), ($cy - $w)),
    (New-Object System.Drawing.PointF ($cx + $r), $cy), (New-Object System.Drawing.PointF ($cx + $w), ($cy + $w)),
    (New-Object System.Drawing.PointF $cx, ($cy + $r)), (New-Object System.Drawing.PointF ($cx - $w), ($cy + $w)),
    (New-Object System.Drawing.PointF ($cx - $r), $cy), (New-Object System.Drawing.PointF ($cx - $w), ($cy - $w))
  )
  $g.FillPolygon($cream, $pts)
}
Star 64 62 36 7
Star 96 34 10 2.5
Star 36 94 7 2

$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
foreach ($p in @(@(30, 36), @(92, 92), @(40, 60), @(84, 64), @(70, 100))) { $g.FillEllipse($white, $p[0], $p[1], 3, 3) }

$out = Join-Path $PSScriptRoot '..\media\icon.png'
$bmp.Save((Resolve-Path (Split-Path $out)).Path + '\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
