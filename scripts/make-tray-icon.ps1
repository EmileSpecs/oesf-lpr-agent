# Generate assets/tray.ico + tray.png — simplified OESF badge (clear at 16px).
Add-Type -AssemblyName System.Drawing

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -ErrorAction SilentlyContinue
if (-not $root) { $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

function New-OesfBadge([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)

  $navy = [System.Drawing.Color]::FromArgb(255, 10, 22, 40)
  $white = [System.Drawing.Color]::White
  $pad = [math]::Max(1, [math]::Round($size * 0.06))
  $diam = $size - 2 * $pad

  $brush = New-Object System.Drawing.SolidBrush $navy
  $g.FillEllipse($brush, $pad, $pad, $diam, $diam)

  $penW = [math]::Max(1.0, $size / 16.0)
  $pen = New-Object System.Drawing.Pen $white, $penW
  $inset = $pad + $penW
  $g.DrawEllipse($pen, $inset, $inset, $size - 2 * $inset, $size - 2 * $inset)

  $cx = $size / 2.0
  $top = $size * 0.22
  $shieldW = $size * 0.42
  $shieldH = $size * 0.52
  $left = $cx - $shieldW / 2
  $right = $cx + $shieldW / 2
  $midY = $top + $shieldH * 0.55
  $bottom = $top + $shieldH

  $shield = New-Object System.Drawing.Drawing2D.GraphicsPath
  [void]$shield.AddLine([float]$left, [float]$top, [float]$right, [float]$top)
  [void]$shield.AddLine([float]$right, [float]$top, [float]$right, [float]$midY)
  [void]$shield.AddLine([float]$right, [float]$midY, [float]$cx, [float]$bottom)
  [void]$shield.AddLine([float]$cx, [float]$bottom, [float]$left, [float]$midY)
  $shield.CloseFigure()

  $whiteBrush = New-Object System.Drawing.SolidBrush $white
  $shieldPen = New-Object System.Drawing.Pen $white, ([math]::Max(1.0, $size / 18.0))
  $g.DrawPath($shieldPen, $shield)

  $canopyY = $size * 0.32
  $canopyR = $size * 0.11
  $g.FillEllipse($whiteBrush, [float]($cx - $canopyR * 1.6), [float]$canopyY, [float]($canopyR * 1.5), [float]($canopyR * 1.3))
  $g.FillEllipse($whiteBrush, [float]($cx + $canopyR * 0.1), [float]$canopyY, [float]($canopyR * 1.5), [float]($canopyR * 1.3))
  $g.FillEllipse($whiteBrush, [float]($cx - $canopyR * 0.75), [float]($canopyY - $canopyR * 0.55), [float]($canopyR * 1.5), [float]($canopyR * 1.35))

  $trunkW = [math]::Max(1.0, $size * 0.06)
  $trunkTop = $canopyY + $canopyR * 1.1
  $trunkBot = $size * 0.58
  $g.FillRectangle($whiteBrush, [float]($cx - $trunkW / 2), [float]$trunkTop, [float]$trunkW, [float]($trunkBot - $trunkTop))

  $rootPen = New-Object System.Drawing.Pen $white, ([math]::Max(1.0, $size / 20.0))
  $rootPen.StartCap = 'Round'
  $rootPen.EndCap = 'Round'
  $g.DrawLine($rootPen, [float]$cx, [float]$trunkBot, [float]($cx - $size * 0.08), [float]($trunkBot + $size * 0.08))
  $g.DrawLine($rootPen, [float]$cx, [float]$trunkBot, [float]($cx + $size * 0.08), [float]($trunkBot + $size * 0.08))
  $g.DrawLine($rootPen, [float]$cx, [float]$trunkBot, [float]$cx, [float]($trunkBot + $size * 0.07))

  $brush.Dispose(); $pen.Dispose(); $whiteBrush.Dispose(); $shieldPen.Dispose(); $rootPen.Dispose(); $shield.Dispose(); $g.Dispose()
  return $bmp
}

function Write-Ico([string]$outPath, [System.Drawing.Bitmap[]]$bitmaps) {
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$bitmaps.Count)
  $imageData = New-Object System.Collections.Generic.List[byte[]]
  foreach ($b in $bitmaps) {
    $pngMs = New-Object System.IO.MemoryStream
    $b.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
    [void]$imageData.Add($pngMs.ToArray())
    $pngMs.Dispose()
  }
  $offset = 6 + (16 * $bitmaps.Count)
  for ($i = 0; $i -lt $bitmaps.Count; $i++) {
    $b = $bitmaps[$i]
    $w = if ($b.Width -ge 256) { [byte]0 } else { [byte]$b.Width }
    $h = if ($b.Height -ge 256) { [byte]0 } else { [byte]$b.Height }
    $bw.Write($w); $bw.Write($h); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$imageData[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $imageData[$i].Length
  }
  foreach ($d in $imageData) { $bw.Write($d) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($outPath, $ms.ToArray())
  $bw.Dispose(); $ms.Dispose()
}

$sizes = @(16, 20, 24, 32, 48, 256)
$bmps = @()
foreach ($s in $sizes) { $bmps += New-OesfBadge $s }
Write-Ico (Join-Path $root 'assets\tray.ico') $bmps
$bmps[-1].Save((Join-Path $root 'assets\tray.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmps[0].Save((Join-Path $root 'assets\tray-16.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmps[3].Save((Join-Path $root 'assets\tray-32.png'), [System.Drawing.Imaging.ImageFormat]::Png)
foreach ($b in $bmps) { $b.Dispose() }
Write-Host "Wrote assets/tray.ico and assets/tray.png"
