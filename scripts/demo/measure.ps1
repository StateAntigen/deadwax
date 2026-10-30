# Measure a phone screenshot in DEVICE pixels.
#
# The Deadwax WebView exposes no accessibility nodes, so UI automation has to
# tap fixed coordinates - which means those coordinates have to be measured
# rather than guessed. A screenshot shown to a human or a model is scaled by an
# unknown factor, so never read positions off a scaled image. This draws a
# labelled grid in device pixels onto a copy and lets you read the answer off
# the gridlines, which carry absolute coordinates and therefore no scale.
#
#   # whole screen, majors every 500 px
#   .\measure.ps1 -In shot.png -Out shot-grid.png
#
#   # regions at 1:1, stacked, fine grid - the one to reach for
#   .\measure.ps1 -In shot.png -Out probe.png -Spec "150:340;1980:2200" -Step 50

param(
    [Parameter(Mandatory = $true)][string]$In,
    [Parameter(Mandatory = $true)][string]$Out,
    # Absolute device-y regions to crop and stack, e.g. "100:400;1900:2300".
    # Omitted = the whole screen.
    [string]$Spec = '',
    [int]$X = 0,
    [int]$W = 1080,
    [int]$Step = 100,
    [int]$Zoom = 1,
    [int]$Gap = 24
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile((Resolve-Path $In))

$regions = @()
if ([string]::IsNullOrWhiteSpace($Spec)) {
    $regions += [pscustomobject]@{ Y1 = 0; Y2 = $src.Height }
}
else {
    foreach ($part in $Spec.Split(';')) {
        $bits = $part.Split(':')
        $regions += [pscustomobject]@{ Y1 = [int]$bits[0]; Y2 = [int]$bits[1] }
    }
}

$cropW = [int]($W * $Zoom)
$totalH = 0
foreach ($r in $regions) {
    $r | Add-Member -NotePropertyName H -NotePropertyValue ([int](($r.Y2 - $r.Y1) * $Zoom)) -Force
    $totalH += $r.H + $Gap
}

$bmp = New-Object System.Drawing.Bitmap($cropW, $totalH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 20, 20, 24))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

$minor = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(130, 0, 255, 120), 1)
$major = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(230, 255, 60, 60), 2)
$font = New-Object System.Drawing.Font('Consolas', 13, [System.Drawing.FontStyle]::Bold)
$label = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 200, 60))
$back = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 0, 0, 0))

$cursor = 0
foreach ($r in $regions) {
    $g.DrawImage(
        $src,
        (New-Object System.Drawing.Rectangle(0, $cursor, $cropW, $r.H)),
        (New-Object System.Drawing.Rectangle($X, $r.Y1, $W, ($r.Y2 - $r.Y1))),
        [System.Drawing.GraphicsUnit]::Pixel)

    for ($ix = [int][Math]::Ceiling($X / $Step) * $Step; $ix -lt ($X + $W); $ix += $Step) {
        $px = [int](($ix - $X) * $Zoom)
        $isMajor = ($ix % ($Step * 4)) -eq 0
        $g.DrawLine($(if ($isMajor) { $major } else { $minor }), $px, $cursor, $px, ($cursor + $r.H))
        if ($isMajor) {
            $text = "$ix"
            $size = $g.MeasureString($text, $font)
            $g.FillRectangle($back, [float]$px + 2, [float]$cursor + 2, $size.Width, $size.Height)
            $g.DrawString($text, $font, $label, [float]$px + 2, [float]$cursor + 2)
        }
    }

    for ($iy = [int][Math]::Ceiling($r.Y1 / $Step) * $Step; $iy -lt $r.Y2; $iy += $Step) {
        $py = $cursor + [int](($iy - $r.Y1) * $Zoom)
        $isMajor = ($iy % ($Step * 4)) -eq 0
        $g.DrawLine($(if ($isMajor) { $major } else { $minor }), 0, $py, $cropW, $py)
        if ($isMajor) {
            $text = "y$iy"
            $size = $g.MeasureString($text, $font)
            $g.FillRectangle($back, 2, [float]$py + 2, $size.Width, $size.Height)
            $g.DrawString($text, $font, $label, 2, [float]$py + 2)
        }
    }

    $cursor += $r.H + $Gap
}

$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$src.Dispose()
Write-Output "wrote $Out ($cropW x $totalH) regions: $(if ($Spec) { $Spec } else { 'whole screen' })"
