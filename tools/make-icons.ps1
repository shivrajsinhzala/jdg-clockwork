# Renders the JDG Clockwork toolbar icons.
# Drawn once at 256px and downsampled, so the 16px variant stays legible.
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$S = 256
$master = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($master)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded slate tile
$pad = 10
$r = 52
$rect = New-Object System.Drawing.Rectangle($pad, $pad, ($S - 2 * $pad), ($S - 2 * $pad))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
$path.CloseFigure()

$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0, 0)),
  (New-Object System.Drawing.Point($S, $S)),
  [System.Drawing.Color]::FromArgb(255, 30, 45, 62),
  [System.Drawing.Color]::FromArgb(255, 12, 20, 30))
$g.FillPath($grad, $path)

# Dial ring — the "still owed" arc is left open on purpose
$cx = $S / 2.0; $cy = $S / 2.0; $rad = 74
$ringRect = New-Object System.Drawing.RectangleF(($cx - $rad), ($cy - $rad), (2 * $rad), (2 * $rad))

$trackPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 40, 58, 78), 18)
$trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($trackPen, $ringRect, 0, 360)

$arcPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 56, 189, 248), 18)
$arcPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arcPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($arcPen, $ringRect, -90, 268)

# Hands
$handPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 230, 237, 245), 15)
$handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$handPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($handPen, $cx, $cy, $cx, ($cy - 42))
$g.DrawLine($handPen, $cx, $cy, ($cx + 34), ($cy + 20))

# Centre pip in the "cleared" green
$dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 52, 211, 153))
$g.FillEllipse($dot, ($cx - 11), ($cy - 11), 22, 22)

$g.Dispose()

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $gg = [System.Drawing.Graphics]::FromImage($bmp)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $gg.Clear([System.Drawing.Color]::Transparent)
  $gg.DrawImage($master, 0, 0, $size, $size)
  $gg.Dispose()
  $p = Join-Path $outDir "icon$size.png"
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $p"
}

$master.Dispose()
