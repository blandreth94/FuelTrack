# FuelTrack

A mobile-first web app for tracking FRC game balls in real time using your device camera. Arcs are drawn as balls move through the frame, and snapshots or recordings can be saved directly from the browser.

No installation or build step required — open `index.html` in a browser or serve the folder over HTTPS.

---

## Features

- **Live ball detection** — HSL color filtering identifies yellow game balls frame by frame
- **Arc tracking** — smooth quadratic bezier arcs are drawn over each ball's trajectory
- **Camera selector** — switches between available cameras (front/rear/ultra-wide), including multi-camera iOS devices
- **Snapshot** — saves a composite image (video + arcs) via the Web Share API on iOS or as a download on desktop
- **Video recording** — arm the record button before starting tracking; the session is saved as WebM/MP4 when tracking stops
- **Fullscreen** — available on Android and desktop (hidden automatically on iOS where the API is unsupported)
- **Settings panel** — all detection and tracking parameters are tunable live with no restart required

---

## Architecture

```
index.html          Entry point and UI markup
style.css           All styles (dark camera UI, settings panel, controls)
js/
  main.js           App entry: camera, render loop, UI wiring
  detector.js       ColorBallDetector — HSL pixel filtering + union-find blob labeling
  tracker.js        BallTracker — nearest-neighbour assignment, arc persistence
  renderer.js       Canvas rendering — arc curves, position indicators, cover-transform math
  version.js        BUILD_COMMIT constant — updated with each release
```

### Detection pipeline

Each frame (at the display's native refresh rate):

1. The video is drawn to a **downscaled offscreen canvas** (default 25% of camera resolution) to reduce pixel work ~4×
2. Every pixel is tested against tunable HSL thresholds (`hueMin/Max`, `satMin`, `litMin/Max`)
3. Matching pixels are labeled into blobs via **union-find connected components**
4. Blobs below `minArea` or above `maxAspect` are discarded
5. Detection coordinates are scaled back up to display space and passed to the tracker

### Tracker

- Nearest-neighbour matching: each detection is assigned to the closest active arc within `MAX_MATCH_DISTANCE` pixels
- New detections with no matching arc start a fresh path
- Paths are marked inactive after `inactiveAfterMs` (default 500 ms) without a detection — frame-rate independent

### Composite canvas / recording

`compositeCanvas` mirrors the display (video drawn with object-fit:cover geometry + arc overlay on top) and is updated every frame during recording. It serves two purposes:

- **Snapshot** — `toBlob()` → Web Share API or `<a download>`
- **Recording** — `captureStream(30)` → `MediaRecorder` → WebM/MP4

---

## Settings

Open the settings panel via the gear icon (top-left). All changes take effect immediately.

| Setting | Default | Effect |
|---|---|---|
| Detection Resolution | 25% | Size of the offscreen detection canvas — lower is faster |
| Hue Min / Max | 42° / 68° | Hue range for yellow; widen to catch more, narrow to reduce false positives |
| Saturation Min | 55% | Filters out desaturated surfaces (wood, concrete) |
| Lightness Min / Max | 40% / 85% | Filters out shadows and specular highlights |
| Min Blob Area | 80 | Minimum blob size in downsampled pixels; increase to ignore small specks |
| Inactivity Timeout | 500 ms | How long a ball can disappear before its arc is finalised |

**Reset to Defaults** restores all values and syncs the UI.

The build commit hash shown at the bottom of the settings panel identifies the exact version running in the browser.

---

## Browser support

| Platform | Camera | Fullscreen | Snapshot | Recording |
|---|---|---|---|---|
| iOS Safari / Chrome | ✓ | — | ✓ (Share sheet → Photos) | — |
| Android Chrome | ✓ | ✓ | ✓ | ✓ |
| Desktop Chrome / Edge | ✓ | ✓ | ✓ (download) | ✓ |
| Desktop Firefox | ✓ | ✓ | ✓ (download) | ✓ |

> iOS does not expose the Fullscreen API or `captureStream` — the fullscreen and record buttons are hidden automatically.

---

## Development

The project is intentionally dependency-free. Edit the files directly and reload.

To test locally over HTTPS (required for camera access on most browsers):

```bash
# Python 3
python3 -m http.server 8080

# Or with npx
npx serve .
```

The build version is stamped automatically by the GitHub Actions deployment
workflow (`.github/workflows/deploy.yml`) using `GITHUB_SHA`. The value in
`js/version.js` in source is always `'unknown'`; the correct hash is injected
at deploy time before the Pages artifact is uploaded.
