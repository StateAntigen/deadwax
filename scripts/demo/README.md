# Demo tooling for the phone app

Two throwaway-once, now-kept scripts for driving Napstrfy on a USB-attached
phone from the Windows dev machine, plus the traps that make them necessary.

## Why coordinates

Napstrfy's UI is a WebView, and it publishes **nothing** to Android's
accessibility layer: `adb shell uiautomator dump` returns a handful of nodes
whose innermost is one opaque `android.webkit.WebView` with no `content-desc`.
There is no element to query by name, so a script has to tap at fixed device
coordinates.

## `measure.ps1` - find those coordinates

A screenshot shown to a person or a model is scaled by an unknown factor, and
the factor cannot be recovered reliably by eye. So don't read positions off a
scaled image: draw a **labelled grid in device pixels** onto a copy and read the
answer off the gridlines, which carry absolute coordinates.

```powershell
# whole screen, major lines every 500 px
.\measure.ps1 -In shot.png -Out shot-grid.png

# the useful one: cropped regions at 1:1, stacked, fine grid
.\measure.ps1 -In shot.png -Out probe.png -Spec "150:340;1980:2200" -Step 50
```

Take the screenshot properly - `adb exec-out screencap -p > x.png` writes
**UTF-16** under PowerShell 5.1 (the file starts `FF FE` and every byte is
followed by `00`), so it looks plausible and is garbage. Pull it instead:

```powershell
adb shell screencap -p /sdcard/shot.png
adb pull /sdcard/shot.png $env:TEMP\shot.png
```

## `tour.ps1` - record the tour

Runs `screenrecord` on the device as a background process (it survives the
`adb shell` exit; the pid is checked before the tour starts), drives the UI, then
`pkill -INT`s the recorder so the MP4 is finalised. The coordinate map is at the
top of the script.

```powershell
.\tour.ps1                  # record
.\tour.ps1 -SkipRecording   # just drive the UI
```

- `screenrecord` caps a clip at 180 s and captures **no audio**, so the script
  mutes media volume for the run and restores it afterwards.
- `ffprobe` reports `duration=0` and `nb_frames=1` on these files even when they
  play fine. Review a recording by decoding frames instead:

  ```powershell
  ffmpeg -i tour.mp4 -vf "fps=1/3,scale=250:-1,tile=5x4" -frames:v 1 sheet.png
  ```

- `input swipe` over a list can register as a press if it ends on a row, which
  will start playback and change the track under the tour.
- Keep an automated tour away from anything destructive or public: Dislike,
  Delete playlist, and Send in a discussion (which publishes under the phone's
  key).

## When the app looks wrong, check whether the host is actually there

The connection chip reading "Offline" means the phone's `status.connected` is
false, and it recovers on its own. To tell "the host is gone" from "the chip is
stale", watch the desktop's log grow after a phone action:

```powershell
(Get-Item "$env:APPDATA\social.napstr.desktop\napstr.log").Length
```

The file is live and rotates to `napstr.log.1`, so a truncated directory listing
column must not be read as "not written since".
