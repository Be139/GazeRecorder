# Gaze heat region PWA prototype

## Direction Guardrail

- Current direction touches systemic / structural risk: `no`.
- Risk would appear if the prototype expands into cross-app screenshots, background screen reading, OCR, AI upload, or continuous monitoring.
- Current scope stays as one controlled PWA loop: `GazeCloud calibration -> gaze samples -> heatmap -> ROI screenshot`.

## Current delivery

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- `assets/`

## Prototype behavior

1. `Screen 1 / Feed`: opens on a dense controlled information page.
2. `Screen 2 / GazeCloud calibration`: `Start detection` loads `GazeCloudAPI.StartEyeTracking()`.
3. `GazeCloud data`: `GazeCloudAPI.OnResult` reads `GazeData.state`, `GazeData.docX`, and `GazeData.docY`.
4. `Screen 3 / Heat capture`: after GazeCloud calibration completes, gaze samples map into a `12 x 20` heat grid.
5. `ROI screenshot`: the strongest heat cluster is expanded by `24px`, then html2canvas captures that current-page ROI and exports a PNG.
6. `Pointer demo`: pointer/touch remains available only to test heatmap and screenshot mechanics. It does not validate eye tracking.

## Important GazeCloud note

GazeCloud requires HTTPS and may require registering the page origin:

```text
https://api.gazerecorder.com/register/
```

For GitHub Pages, register:

```text
https://be139.github.io
```

## Recommended test flow

```text
Android Chrome opens the HTTPS page
-> Start detection
-> Complete the GazeCloud camera calibration overlay
-> Automatically enter the heat capture page
-> Look at one content region for a few seconds
-> Heatmap and ROI box appear
-> Capture hot region
-> Preview and download PNG
```

The screenshot only comes from this PWA page. The prototype does not capture other apps and does not include OCR or AI upload.
