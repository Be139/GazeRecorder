# Gaze heat region PWA prototype

## Direction Guardrail

- Current direction touches systemic / structural risk: `no`.
- Risk would appear if the prototype expands into cross-app screenshots, background screen reading, OCR, AI upload, or continuous monitoring.
- Current scope stays as one controlled PWA loop: `GazeCloud calibration -> gaze samples -> dwell/heatmap -> local ROI screenshot`.

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
5. `Sensitivity`: Low / Medium / High presets plus advanced sliders control dwell trigger, stable radius, heat strength, heat fade half-life, ROI tightness, ROI padding, and auto-capture cooldown.
6. `Local auto capture`: when enabled, stable gaze dwell can capture the current-page ROI locally. It does not upload or analyze anything.
7. `ROI screenshot`: the strongest heat cluster is expanded by the current ROI padding, then html2canvas captures that current-page ROI and exports a PNG.
8. `Pointer demo`: pointer/touch remains available only to test heatmap, dwell, auto-capture, and screenshot mechanics. It does not validate eye tracking.

## Auto-capture artifact

Each screenshot creates a local artifact shape that can be used by a future upload step:

```js
{
  timestamp,
  trigger,
  source,
  roi,
  region,
  regionLabel,
  dwellMs,
  hotScore,
  settings,
  dataUrl
}
```

No upload endpoint is present in this prototype.

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
-> Keep the default Medium sensitivity, or tune the sliders
-> Optional: enable Auto capture local ROI
-> Look at one content region for a few seconds
-> Heatmap and ROI box appear
-> Capture hot region
-> Preview and download PNG
```

The screenshot only comes from this PWA page. The prototype does not capture other apps and does not include OCR or AI upload.
