# Record a scripted tour of Napstrfy on a USB-attached phone.
#
#   .\tour.ps1                      # record the whole tour
#   .\tour.ps1 -SkipRecording       # just drive the UI (no video), for exploring
#
# The app is a WebView that publishes nothing to Android's accessibility layer,
# so every step is a tap at a FIXED device coordinate. Those coordinates were
# measured with measure.ps1 (see its header) and are listed below; if the layout
# changes, re-measure rather than nudging them by eye.
#
# Verification: screenrecord writes no useful duration metadata, so review a
# recording by decoding a contact sheet:
#   ffmpeg -i tour.mp4 -vf "fps=1/3,scale=250:-1,tile=5x4" -frames:v 1 sheet.png

param(
    [string]$Device = '52070DLAQ000MF',
    [string]$Remote = '/sdcard/napstr-demo.mp4',
    [string]$Local = "$env:TEMP\napstr-demo.mp4",
    [int]$Bitrate = 16000000,
    [int]$MediaVolume = 17,
    [switch]$SkipRecording
)

$ErrorActionPreference = 'Continue'

# --- coordinate map (device px on a 1080x2424 screen, density 420) -----------
# bottom nav   y = 2265   x = 130 Music / 334 Search / 538 Playlists
#                         x = 742 Podcasts / 946 Audiobooks
# header       connection chip (165,245)   top-right icon (988,238)
# search       field (540,412)   clear x (919,377)   filter chips y 601
# network lib  Play (968,788)   Crate Digging (196,927)   Random (466,927)
# track row    first row y 1094, its menu dots x 985
# mini player  (540,2085), its play/pause (988,2091)
# now playing  back (103,237) waveform y ~1301 times y 1421 transport y 1865
#              actions y 2048 (repeat 258 shuffle 405 queue 535 like 669 dislike 816)
# queue sheet  close x (983,263)
# results      Artists y ~872  Playlists covers y ~1370  Albums covers y ~1868
# playlist     back chevron (88,240)
# ----------------------------------------------------------------------------

function Tap([int]$x, [int]$y) { adb -s $Device shell input tap $x $y | Out-Null }
function Swipe([int]$x1, [int]$y1, [int]$x2, [int]$y2, [int]$ms) {
    adb -s $Device shell input swipe $x1 $y1 $x2 $y2 $ms | Out-Null
}
function Key([string]$k) { adb -s $Device shell input keyevent $k | Out-Null }
function Wait([int]$ms) { Start-Sleep -Milliseconds $ms }

Write-Output '=== PRE-ROLL (not recorded) ==='
Tap 88 240; Wait 1200                 # leave any open playlist
Tap 130 2265; Wait 1800               # Music tab
for ($i = 0; $i -lt 5; $i++) { Swipe 540 700 540 1700 220; Wait 260 }   # scroll to top
Wait 1200

if (-not $SkipRecording) {
    Write-Output '=== START RECORDING ==='
    # No audio track is produced, so mute the phone and restore it afterwards.
    adb -s $Device shell cmd media_session volume --stream 3 --set 0 | Out-Null
    adb -s $Device shell "nohup screenrecord --bit-rate $Bitrate --time-limit 180 $Remote >/dev/null 2>&1 &" | Out-Null
    Wait 2500
    $pid = (adb -s $Device shell pgrep -f screenrecord) -join ' '
    Write-Output "screenrecord pid: $pid"
    if (-not $pid) { Write-Output 'WARNING: screenrecord is not running' }
}

Write-Output '=== TOUR ==='
Wait 2000                                                    # Music tab at rest

Swipe 540 1750 540 850 700; Wait 1800                        # shelves, slowly
Swipe 540 1750 540 850 700; Wait 1800
Swipe 540 1750 540 850 700; Wait 2200
Swipe 540 850 540 1750 500; Wait 700                         # back to the top
Swipe 540 850 540 1750 500; Wait 700
Swipe 540 850 540 1750 500; Wait 1200

Tap 334 2265; Wait 2400                                      # Network Library
Tap 540 412; Wait 900                                        # search
Tap 919 377; Wait 700                                        # clear the old query
adb -s $Device shell input text 'rock'; Wait 3200
Key 4; Wait 1500                                             # dismiss the keyboard
Wait 2600                                                    # Artists/Playlists/Albums

Tap 214 1370; Wait 3200                                      # open a playlist
Swipe 540 1750 540 900 650; Wait 2600
Tap 88 240; Wait 1500                                        # back

Tap 540 2085; Wait 2800                                      # now playing
Wait 3200                                                    # waveform progresses
Tap 535 2048; Wait 2600                                      # queue sheet
Tap 983 263; Wait 1400                                       # close it

Tap 103 237; Wait 1600                                       # close the drawer
Tap 988 238; Wait 2800                                       # settings
Swipe 540 1750 540 1100 600; Wait 2600                       # scroll to playback/identity

if (-not $SkipRecording) {
    Write-Output '=== STOP RECORDING ==='
    adb -s $Device shell pkill -INT screenrecord | Out-Null   # SIGINT finalizes the moov
    Wait 2500
    adb -s $Device pull $Remote $Local
    if (Test-Path $Local) { Write-Output "local file: $((Get-Item $Local).Length) bytes" }
    adb -s $Device shell cmd media_session volume --stream 3 --set $MediaVolume | Out-Null
    Write-Output "media volume restored to $MediaVolume"
}
