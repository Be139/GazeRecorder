const GRID_COLUMNS = 12;
const GRID_ROWS = 20;
const SAMPLE_LIMIT = 1200;
const RENDER_INTERVAL_MS = 200;
const BUILD_VERSION = "2026-05-03-v15";

const PRESET_SETTINGS = {
  low: {
    dwellMs: 1800,
    stabilityRadius: 60,
    heatGain: 0.85,
    decayHalfLifeMs: 3000,
    roiThresholdRatio: 0.68,
    roiPadding: 20,
    autoCaptureCooldownMs: 10000,
  },
  medium: {
    dwellMs: 1200,
    stabilityRadius: 80,
    heatGain: 1,
    decayHalfLifeMs: 4000,
    roiThresholdRatio: 0.58,
    roiPadding: 24,
    autoCaptureCooldownMs: 8000,
  },
  high: {
    dwellMs: 800,
    stabilityRadius: 110,
    heatGain: 1.25,
    decayHalfLifeMs: 6500,
    roiThresholdRatio: 0.48,
    roiPadding: 32,
    autoCaptureCooldownMs: 6000,
  },
};

const DEFAULT_PRESET = "medium";
const DEFAULT_SETTINGS = { ...PRESET_SETTINGS[DEFAULT_PRESET] };

const regionLabels = {
  work: "Work signal",
  trend: "Trend pull",
  rest: "Rest content",
  growth: "Growth note",
  none: "No region",
};

const state = {
  screen: "intro",
  source: "waiting",
  sampleCount: 0,
  heat: createHeatGrid(),
  regionHits: new Map(),
  lastPoint: null,
  roi: null,
  renderQueued: false,
  trackerActive: false,
  cloudCalibrationComplete: false,
  lastGazeAt: 0,
  realGazeSamples: 0,
  settings: { ...DEFAULT_SETTINGS },
  activePreset: DEFAULT_PRESET,
  autoCaptureEnabled: false,
  captureInProgress: false,
  captureArtifacts: [],
  lastArtifact: null,
  lastHeatDecayAt: Date.now(),
  dwellAnchor: null,
  dwellStartedAt: 0,
  currentDwellMs: 0,
  lastAutoCaptureAt: 0,
};

const el = {
  screens: document.querySelectorAll("[data-screen]"),
  stepPills: document.querySelectorAll("[data-step-pill]"),
  introStatus: document.querySelector("#introStatus"),
  startDetectionButton: document.querySelector("#startDetectionButton"),
  openFallbackButton: document.querySelector("#openFallbackButton"),
  cameraStatus: document.querySelector("#cameraStatus"),
  cameraTrackStatus: document.querySelector("#cameraTrackStatus"),
  calibrationPointStatus: document.querySelector("#calibrationPointStatus"),
  calibrationSampleStatus: document.querySelector("#calibrationSampleStatus"),
  gazeStatus: document.querySelector("#gazeStatus"),
  lastGazeStatus: document.querySelector("#lastGazeStatus"),
  calibrationStage: document.querySelector("#calibrationStage"),
  calibrationGrid: document.querySelector("#calibrationGrid"),
  calibrationStatus: document.querySelector("#calibrationStatus"),
  calibrationProgress: document.querySelector("#calibrationProgress"),
  skipCalibrationButton: document.querySelector("#skipCalibrationButton"),
  captureSurface: document.querySelector("#captureSurface"),
  heatmapGrid: document.querySelector("#heatmapGrid"),
  roiBox: document.querySelector("#roiBox"),
  gazeDot: document.querySelector("#gazeDot"),
  trackingStatus: document.querySelector("#trackingStatus"),
  signalDot: document.querySelector("#signalDot"),
  sampleMetric: document.querySelector("#sampleMetric"),
  hotMetric: document.querySelector("#hotMetric"),
  roiMetric: document.querySelector("#roiMetric"),
  regionTitle: document.querySelector("#regionTitle"),
  regionCopy: document.querySelector("#regionCopy"),
  regionStats: document.querySelector("#regionStats"),
  cameraNote: document.querySelector("#cameraNote"),
  recalibrateButton: document.querySelector("#recalibrateButton"),
  resetButton: document.querySelector("#resetButton"),
  captureButton: document.querySelector("#captureButton"),
  presetButtons: document.querySelectorAll("[data-preset]"),
  activePresetLabel: document.querySelector("#activePresetLabel"),
  autoCaptureToggle: document.querySelector("#autoCaptureToggle"),
  autoCaptureStatus: document.querySelector("#autoCaptureStatus"),
  settingInputs: document.querySelectorAll("[data-setting]"),
  emptyPreview: document.querySelector("#emptyPreview"),
  previewImage: document.querySelector("#previewImage"),
  downloadLink: document.querySelector("#downloadLink"),
  debugLog: document.querySelector("#debugLog"),
};

function createHeatGrid() {
  return Array.from({ length: GRID_ROWS }, () => Array(GRID_COLUMNS).fill(0));
}

function buildHeatmapGrid() {
  el.heatmapGrid.style.setProperty("--grid-columns", GRID_COLUMNS);
  el.heatmapGrid.style.setProperty("--grid-rows", GRID_ROWS);
  el.heatmapGrid.innerHTML = "";

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const cell = document.createElement("span");
      cell.className = "heat-cell";
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      el.heatmapGrid.appendChild(cell);
    }
  }
}

function switchScreen(screen) {
  state.screen = screen;
  document.body.dataset.screen = screen;
  el.screens.forEach((node) => node.classList.toggle("is-active", node.dataset.screen === screen));
  el.stepPills.forEach((node) => node.classList.toggle("is-active", node.dataset.stepPill === screen));
  window.scrollTo(0, 0);

  if (screen === "capture") {
    renderHeatmap();
  }
}

async function startDetection() {
  el.startDetectionButton.disabled = true;
  el.introStatus.textContent = "Requesting camera permission and starting GazeCloudAPI...";
  el.cameraStatus.textContent = "requesting";
  logDebug(`Start detection. build=${BUILD_VERSION}`);
  logDebug(`secure=${window.isSecureContext} protocol=${window.location.protocol}`);
  logDebug(`cameraAPI=${Boolean(navigator.mediaDevices?.getUserMedia)} gazeCloud=${Boolean(window.GazeCloudAPI)}`);

  try {
    if (!window.GazeCloudAPI) throw new Error("GazeCloudAPI script is not loaded");

    configureGazeCloud(window.GazeCloudAPI);
    state.trackerActive = true;
    state.source = "waiting";
    state.cloudCalibrationComplete = false;
    el.cameraStatus.textContent = "starting";
    el.cameraTrackStatus.textContent = "GazeCloudAPI";
    el.gazeStatus.textContent = "waiting";
    el.signalDot.classList.add("is-live");
    el.trackingStatus.textContent = "GazeCloud starting";
    el.cameraNote.textContent = "GazeCloudAPI calibration is active. Heatmap starts after the API reports calibration complete.";
    switchScreen("calibration");
    beginCalibration();
    window.GazeCloudAPI.StartEyeTracking();
  } catch (error) {
    state.source = "waiting";
    state.trackerActive = false;
    stopTrackingQuietly();
    el.startDetectionButton.disabled = false;
    el.cameraStatus.textContent = "unavailable";
    el.introStatus.textContent = `GazeCloud unavailable: ${error.message}. You can still test pointer demo.`;
    logDebug(`ERROR ${error.name || "Error"}: ${error.message}`);
    if (error.stack) logDebug(error.stack.split("\n").slice(0, 4).join(" | "));
    console.warn(error);
  }
}

function configureGazeCloud(gaze) {
  gaze.UseClickRecalibration = true;
  gaze.OnResult = handleGazeCloudResult;
  gaze.OnCalibrationComplete = () => {
    if (state.cloudCalibrationComplete || state.screen !== "calibration") return;
    logDebug("GazeCloud calibration complete.");
    enterCaptureAfterGazeCloudCalibration();
  };
  gaze.OnCamDenied = () => failTracking("Camera access denied by the browser.");
  gaze.OnError = (message) => failTracking(message || "GazeCloudAPI returned an error.");
}

function handleGazeCloudResult(gazeData) {
  if (!gazeData) return;

  if (gazeData.state !== 0) {
    const stateText = gazeData.state === -1 ? "face lost" : "uncalibrated";
    el.gazeStatus.textContent = stateText;
    if (state.screen === "calibration") {
      el.calibrationStatus.textContent = `GazeCloud status: ${stateText}. Complete the API calibration overlay.`;
    }
    if (state.screen === "capture") {
      el.cameraNote.textContent = `GazeCloud status: ${stateText}. Heatmap pauses until valid gaze resumes.`;
    }
    return;
  }

  const clientX = Number(gazeData.docX) - window.scrollX;
  const clientY = Number(gazeData.docY) - window.scrollY;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
  if (!state.cloudCalibrationComplete && state.screen === "calibration") {
    logDebug("GazeCloud produced valid gaze before calibration callback; entering capture.");
    enterCaptureAfterGazeCloudCalibration();
  }
  handleGazePrediction(clientX, clientY);
}

function handleGazePrediction(clientX, clientY) {
  state.lastGazeAt = Date.now();
  state.realGazeSamples += 1;
  el.gazeStatus.textContent = `receiving (${state.realGazeSamples})`;
  el.lastGazeStatus.textContent = `${Math.round(clientX)}, ${Math.round(clientY)}`;
  if (state.realGazeSamples <= 5 || state.realGazeSamples % 25 === 0) {
    logDebug(`real gaze sample #${state.realGazeSamples}: ${Math.round(clientX)},${Math.round(clientY)}`);
  }

  if (state.screen === "capture" && state.cloudCalibrationComplete) {
    addSample(clientX, clientY, "gaze");
  }
}

function failTracking(message) {
  state.source = "waiting";
  state.trackerActive = false;
  stopTrackingQuietly();
  el.startDetectionButton.disabled = false;
  el.cameraStatus.textContent = "unavailable";
  el.gazeStatus.textContent = "error";
  el.introStatus.textContent = `GazeCloud unavailable: ${message}`;
  el.calibrationStatus.textContent = `GazeCloud error: ${message}`;
  logDebug(`GazeCloud error: ${message}`);
}

function stopTrackingQuietly() {
  try {
    window.GazeCloudAPI?.StopEyeTracking?.();
  } catch (error) {
    console.warn(error);
  }
}

function openPointerFallback() {
  state.source = "simulation";
  state.trackerActive = false;
  el.signalDot.classList.remove("is-live");
  el.trackingStatus.textContent = "Pointer / touch simulation active";
  el.cameraNote.textContent = "Fallback mode: pointer and touch samples test only heatmap and ROI capture mechanics.";
  switchScreen("capture");
}

function beginCalibration() {
  clearCalibrationTimers();
  state.cloudCalibrationComplete = false;
  el.calibrationGrid.innerHTML = "";
  el.calibrationProgress.style.width = "0%";
  el.calibrationStatus.textContent = "GazeCloud calibration is running in its own camera overlay. Complete it there, then this page opens the heatmap surface.";
  el.calibrationPointStatus.textContent = "GazeCloud";
  el.calibrationSampleStatus.textContent = "0";
  el.gazeStatus.textContent = state.realGazeSamples ? `receiving (${state.realGazeSamples})` : "waiting";
}

function enterCaptureAfterGazeCloudCalibration() {
  state.cloudCalibrationComplete = true;
  state.source = "gaze";
  resetHeat();
  el.cameraStatus.textContent = "active";
  el.calibrationProgress.style.width = "100%";
  el.calibrationPointStatus.textContent = "complete";
  el.calibrationSampleStatus.textContent = String(state.realGazeSamples);
  el.gazeStatus.textContent = state.realGazeSamples ? `receiving (${state.realGazeSamples})` : "ready";
  el.trackingStatus.textContent = "GazeCloud gaze active";
  el.cameraNote.textContent = "GazeCloud calibration complete. Heatmap now uses GazeCloud docX/docY samples from this page.";
  el.calibrationStatus.textContent = "GazeCloud calibration complete. Moving to heatmap capture.";
  logDebug("GazeCloud calibration complete. entering capture.");
  window.setTimeout(() => switchScreen("capture"), 350);
}

function clearCalibrationTimers() {
}

function skipCalibration() {
  clearCalibrationTimers();
  stopTrackingQuietly();
  state.trackerActive = false;
  state.cloudCalibrationComplete = false;
  el.startDetectionButton.disabled = false;
  startDetection();
}

function recalibrate() {
  if (state.trackerActive) {
    skipCalibration();
    return;
  }

  switchScreen("intro");
  el.introStatus.textContent = "Start detection first to run GazeCloud calibration.";
}

function getSurfacePoint(clientX, clientY) {
  const rect = el.captureSurface.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    width: rect.width,
    height: rect.height,
    clientX,
    clientY,
  };
}

function addSample(clientX, clientY, source) {
  const point = getSurfacePoint(clientX, clientY);
  if (!point) return;
  const now = Date.now();

  applyHeatDecay(now);
  state.source = source;
  state.lastPoint = point;
  state.sampleCount = Math.min(SAMPLE_LIMIT, state.sampleCount + 1);

  const column = clamp(Math.floor((point.x / point.width) * GRID_COLUMNS), 0, GRID_COLUMNS - 1);
  const row = clamp(Math.floor((point.y / point.height) * GRID_ROWS), 0, GRID_ROWS - 1);
  diffuseHeat(row, column);
  trackDwell(point, source, now);
  countRegion(clientX, clientY);
  moveGazeDot(clientX, clientY, source);
  queueRender();
}

function diffuseHeat(row, column) {
  const kernel = [
    [0, 0, 0.28],
    [-1, 0, 0.14],
    [1, 0, 0.14],
    [0, -1, 0.14],
    [0, 1, 0.14],
    [-1, -1, 0.07],
    [1, -1, 0.07],
    [-1, 1, 0.07],
    [1, 1, 0.07],
  ];

  kernel.forEach(([rowOffset, columnOffset, weight]) => {
    const targetRow = row + rowOffset;
    const targetColumn = column + columnOffset;
    if (targetRow < 0 || targetRow >= GRID_ROWS || targetColumn < 0 || targetColumn >= GRID_COLUMNS) return;
    state.heat[targetRow][targetColumn] += weight * state.settings.heatGain;
  });
}

function applyHeatDecay(now = Date.now()) {
  const elapsed = now - state.lastHeatDecayAt;
  if (elapsed <= 0) return false;

  const halfLife = Math.max(250, state.settings.decayHalfLifeMs);
  const factor = Math.pow(0.5, elapsed / halfLife);
  let changed = false;
  let hadHeat = false;

  for (const heatRow of state.heat) {
    for (let index = 0; index < heatRow.length; index += 1) {
      const previous = heatRow[index];
      if (previous <= 0.0005) {
        heatRow[index] = 0;
        continue;
      }

      hadHeat = true;
      const next = previous * factor;
      heatRow[index] = next < 0.003 ? 0 : next;
      if (Math.abs(previous - heatRow[index]) > 0.0005) changed = true;
    }
  }

  state.lastHeatDecayAt = now;
  return hadHeat && changed;
}

function trackDwell(point, source, now) {
  const region = getRegionFromPoint(point.clientX, point.clientY);
  const anchor = state.dwellAnchor;
  const distance = anchor ? getDistance(point.clientX, point.clientY, anchor.clientX, anchor.clientY) : Infinity;
  const movedOut = distance > state.settings.stabilityRadius || source !== anchor?.source || region !== anchor?.region;

  if (!anchor || movedOut) {
    state.dwellAnchor = {
      clientX: point.clientX,
      clientY: point.clientY,
      region,
      source,
    };
    state.dwellStartedAt = now;
    state.currentDwellMs = 0;
    return;
  }

  state.currentDwellMs = now - state.dwellStartedAt;
}

function countRegion(clientX, clientY) {
  const region = getRegionFromPoint(clientX, clientY);
  state.regionHits.set(region, (state.regionHits.get(region) || 0) + 1);
}

function getRegionFromPoint(clientX, clientY) {
  const regionNode = document.elementFromPoint(clientX, clientY)?.closest?.("[data-region]");
  return regionNode?.dataset.region || "none";
}

function getDistance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function moveGazeDot(clientX, clientY, source) {
  el.gazeDot.style.left = `${clientX}px`;
  el.gazeDot.style.top = `${clientY}px`;
  el.gazeDot.classList.add("is-visible");
  el.gazeDot.dataset.source = source;
}

function handlePointerSample(event) {
  if (state.trackerActive && state.source !== "simulation") return;
  addSample(event.clientX, event.clientY, "simulation");
}

function queueRender() {
  if (state.renderQueued) return;

  state.renderQueued = true;
  window.setTimeout(() => {
    state.renderQueued = false;
    renderHeatmap();
  }, RENDER_INTERVAL_MS);
}

function renderHeatmap() {
  const max = getMaxHeat();
  const cells = el.heatmapGrid.querySelectorAll(".heat-cell");
  const absoluteOpacity = clamp(max / 1.2, 0, 1);

  cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const heat = state.heat[row][column];
    const normalized = max > 0 ? heat / max : 0;
    cell.style.opacity = normalized > 0.04 ? String(Math.min(0.86, normalized * 0.9 * absoluteOpacity)) : "0";
    cell.style.transform = `scale(${0.78 + normalized * 0.34 * absoluteOpacity})`;
  });

  state.roi = calculateRoi(max);
  renderRoi();
  renderStats(max);
}

function getMaxHeat() {
  let max = 0;
  state.heat.forEach((row) => {
    row.forEach((value) => {
      if (value > max) max = value;
    });
  });
  return max;
}

function calculateRoi(max) {
  const rect = el.captureSurface.getBoundingClientRect();
  if (!max || max < 0.12) return null;

  const threshold = max * state.settings.roiThresholdRatio;
  let minRow = GRID_ROWS;
  let maxRow = -1;
  let minColumn = GRID_COLUMNS;
  let maxColumn = -1;

  state.heat.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value < threshold) return;
      minRow = Math.min(minRow, rowIndex);
      maxRow = Math.max(maxRow, rowIndex);
      minColumn = Math.min(minColumn, columnIndex);
      maxColumn = Math.max(maxColumn, columnIndex);
    });
  });

  if (maxRow < 0 || maxColumn < 0) return null;

  const cellWidth = rect.width / GRID_COLUMNS;
  const cellHeight = rect.height / GRID_ROWS;
  const left = clamp(minColumn * cellWidth - state.settings.roiPadding, 0, rect.width);
  const top = clamp(minRow * cellHeight - state.settings.roiPadding, 0, rect.height);
  const right = clamp((maxColumn + 1) * cellWidth + state.settings.roiPadding, 0, rect.width);
  const bottom = clamp((maxRow + 1) * cellHeight + state.settings.roiPadding, 0, rect.height);

  return {
    left,
    top,
    width: Math.max(48, right - left),
    height: Math.max(48, bottom - top),
    score: max,
  };
}

function renderRoi() {
  if (!state.roi) {
    el.roiBox.classList.remove("is-visible");
    el.roiMetric.textContent = "--";
    return;
  }

  el.roiBox.classList.add("is-visible");
  el.roiBox.style.left = `${state.roi.left}px`;
  el.roiBox.style.top = `${state.roi.top}px`;
  el.roiBox.style.width = `${state.roi.width}px`;
  el.roiBox.style.height = `${state.roi.height}px`;
  el.roiMetric.textContent = `${Math.round(state.roi.width)}x${Math.round(state.roi.height)}`;
}

function renderStats(max) {
  const hotPercent = max ? Math.min(99, Math.round(max * 28)) : 0;
  const dominant = getDominantRegion();
  const mode = state.source === "gaze" ? "GazeCloud gaze" : state.source === "simulation" ? "Simulation" : "Waiting";
  const dwellText = state.currentDwellMs ? `${Math.round(state.currentDwellMs)} ms` : "0 ms";
  const captureText = state.lastArtifact ? `${state.lastArtifact.trigger}, ${Math.round(state.lastArtifact.dwellMs)} ms` : "none";

  el.sampleMetric.textContent = String(state.sampleCount);
  el.hotMetric.textContent = `${hotPercent}%`;
  el.trackingStatus.textContent = state.source === "gaze" ? "GazeCloud gaze active" : state.source === "simulation" ? "Pointer / touch simulation active" : "Waiting for gaze samples";
  el.regionTitle.textContent = dominant.region === "none" ? "Heat forming on test surface" : `${regionLabels[dominant.region]} is hottest`;
  el.regionCopy.textContent = state.roi
    ? `ROI is calculated from the strongest heat cluster and expanded by ${state.settings.roiPadding}px. Screenshot stays inside this page.`
    : "Look at one area for a few seconds, or use pointer fallback to form a stable heat region.";
  el.regionStats.innerHTML = `
    <div><span>Mode</span><strong>${mode}</strong></div>
    <div><span>Dominant area</span><strong>${regionLabels[dominant.region] || regionLabels.none}</strong></div>
    <div><span>Hits</span><strong>${dominant.hits}</strong></div>
    <div><span>Stable dwell</span><strong>${dwellText}</strong></div>
    <div><span>ROI</span><strong>${state.roi ? `${Math.round(state.roi.width)} x ${Math.round(state.roi.height)} px` : "--"}</strong></div>
    <div><span>Last capture</span><strong>${captureText}</strong></div>
  `;
  renderAutoCaptureStatus();
  evaluateAutoCapture(max, dominant);
}

function getDominantRegion() {
  let best = { region: "none", hits: 0 };
  state.regionHits.forEach((hits, region) => {
    if (hits > best.hits) best = { region, hits };
  });
  return best;
}

function evaluateAutoCapture(max, dominant) {
  if (!state.autoCaptureEnabled || !state.roi || state.captureInProgress) return;
  if (!max || state.source === "waiting") return;
  if (state.currentDwellMs < state.settings.dwellMs) return;

  const now = Date.now();
  if (now - state.lastAutoCaptureAt < state.settings.autoCaptureCooldownMs) return;

  state.lastAutoCaptureAt = now;
  logDebug(`Auto capture: dwell=${Math.round(state.currentDwellMs)}ms region=${dominant.region}`);
  captureHotRegion({ trigger: "auto", dwellMs: state.currentDwellMs });
}

function renderAutoCaptureStatus() {
  if (!el.autoCaptureStatus) return;

  if (!state.autoCaptureEnabled) {
    el.autoCaptureStatus.textContent = "Auto capture is off. Manual capture stays available.";
    return;
  }

  const dwellRemaining = Math.max(0, state.settings.dwellMs - state.currentDwellMs);
  const cooldownRemaining = Math.max(0, state.settings.autoCaptureCooldownMs - (Date.now() - state.lastAutoCaptureAt));
  if (cooldownRemaining > 0) {
    el.autoCaptureStatus.textContent = `Auto capture cooling down: ${(cooldownRemaining / 1000).toFixed(1)}s.`;
    return;
  }

  el.autoCaptureStatus.textContent = dwellRemaining > 0
    ? `Auto capture armed. Hold gaze for ${(dwellRemaining / 1000).toFixed(1)}s more.`
    : "Auto capture armed. Stable dwell reached.";
}

async function captureHotRegion(options = {}) {
  const trigger = options.trigger || "manual";
  const dwellMs = options.dwellMs ?? state.currentDwellMs;
  if (!state.roi) {
    el.regionCopy.textContent = "No stable ROI yet. Add more gaze or pointer samples first.";
    return;
  }

  if (!window.html2canvas) {
    el.regionCopy.textContent = "Screenshot library unavailable. Check network access for html2canvas.";
    return;
  }

  if (state.captureInProgress) return;
  state.captureInProgress = true;
  el.captureButton.disabled = true;
  el.captureButton.textContent = trigger === "auto" ? "Auto capturing..." : "Capturing...";
  document.body.classList.add("is-capturing");

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const sourceCanvas = await window.html2canvas(el.captureSurface, {
      backgroundColor: "#ffffff",
      scale: Math.min(2, window.devicePixelRatio || 1),
      useCORS: true,
      logging: false,
    });

    const surfaceRect = el.captureSurface.getBoundingClientRect();
    const scaleX = sourceCanvas.width / surfaceRect.width;
    const scaleY = sourceCanvas.height / surfaceRect.height;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(state.roi.width * scaleX));
    cropCanvas.height = Math.max(1, Math.round(state.roi.height * scaleY));

    const context = cropCanvas.getContext("2d");
    context.drawImage(
      sourceCanvas,
      Math.round(state.roi.left * scaleX),
      Math.round(state.roi.top * scaleY),
      cropCanvas.width,
      cropCanvas.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );

    const dataUrl = cropCanvas.toDataURL("image/png");
    const artifact = createCaptureArtifact({ dataUrl, dwellMs, trigger });
    state.lastArtifact = artifact;
    state.captureArtifacts.unshift(artifact);
    state.captureArtifacts = state.captureArtifacts.slice(0, 12);
    el.previewImage.src = dataUrl;
    el.previewImage.hidden = false;
    el.emptyPreview.hidden = true;
    el.downloadLink.href = dataUrl;
    el.downloadLink.download = `gaze-hot-region-${artifact.timestamp.replace(/[:.]/g, "-")}.png`;
    el.downloadLink.hidden = false;
    renderStats(state.roi.score);
    el.regionCopy.textContent = trigger === "auto"
      ? "Auto-captured the stable dwell ROI from this page only. No upload was started."
      : "Captured the strongest heat-region ROI from the current page only.";
  } catch (error) {
    el.regionCopy.textContent = "Capture failed. Try refreshing the page or using a smaller viewport.";
    console.warn(error);
  } finally {
    document.body.classList.remove("is-capturing");
    state.captureInProgress = false;
    el.captureButton.disabled = false;
    el.captureButton.textContent = "Capture hot region";
    renderAutoCaptureStatus();
  }
}

function createCaptureArtifact({ dataUrl, dwellMs, trigger }) {
  const dominant = getDominantRegion();
  return {
    timestamp: new Date().toISOString(),
    trigger,
    source: state.source,
    roi: state.roi ? {
      left: Math.round(state.roi.left),
      top: Math.round(state.roi.top),
      width: Math.round(state.roi.width),
      height: Math.round(state.roi.height),
      score: Number(state.roi.score.toFixed(3)),
    } : null,
    region: dominant.region,
    regionLabel: regionLabels[dominant.region] || regionLabels.none,
    dwellMs: Math.round(dwellMs),
    hotScore: state.roi ? Number(state.roi.score.toFixed(3)) : 0,
    settings: { ...state.settings },
    dataUrl,
  };
}

function resetHeat() {
  state.sampleCount = 0;
  state.heat = createHeatGrid();
  state.regionHits.clear();
  state.lastPoint = null;
  state.roi = null;
  state.dwellAnchor = null;
  state.dwellStartedAt = 0;
  state.currentDwellMs = 0;
  state.lastHeatDecayAt = Date.now();
  state.lastArtifact = null;
  state.captureArtifacts = [];
  el.previewImage.hidden = true;
  el.previewImage.removeAttribute("src");
  el.downloadLink.hidden = true;
  el.downloadLink.removeAttribute("href");
  el.emptyPreview.hidden = false;
  el.gazeDot.classList.remove("is-visible");
  renderHeatmap();
}

function applyPreset(preset) {
  const next = PRESET_SETTINGS[preset];
  if (!next) return;

  state.activePreset = preset;
  state.settings = { ...next };
  syncSettingsControls();
  renderHeatmap();
}

function handleSettingInput(event) {
  const key = event.currentTarget.dataset.setting;
  if (!key) return;

  state.activePreset = "custom";
  state.settings[key] = parseSettingValue(key, event.currentTarget.value);
  syncSettingsControls();
  renderHeatmap();
}

function parseSettingValue(key, rawValue) {
  const value = Number(rawValue);
  if (key === "roiThresholdRatio") return clamp(value / 100, 0.3, 0.9);
  if (key === "heatGain") return clamp(value, 0.2, 3);
  return Math.round(value);
}

function syncSettingsControls() {
  el.presetButtons.forEach((button) => {
    const active = button.dataset.preset === state.activePreset;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (el.activePresetLabel) {
    el.activePresetLabel.textContent = state.activePreset === "custom" ? "Custom" : state.activePreset;
  }

  el.settingInputs.forEach((input) => {
    const key = input.dataset.setting;
    const value = state.settings[key];
    if (document.activeElement !== input) {
      input.value = key === "roiThresholdRatio" ? String(Math.round(value * 100)) : String(value);
    }
    const output = document.querySelector(`[data-setting-output="${key}"]`);
    if (output) output.textContent = formatSetting(key, value);
  });

  renderAutoCaptureStatus();
}

function formatSetting(key, value) {
  if (key === "dwellMs") return `${Math.round(value)} ms`;
  if (key === "stabilityRadius") return `${Math.round(value)} px`;
  if (key === "heatGain") return `${Number(value).toFixed(2)}x`;
  if (key === "decayHalfLifeMs") return `${formatSeconds(value)}`;
  if (key === "roiThresholdRatio") return `${Math.round(value * 100)}%`;
  if (key === "roiPadding") return `${Math.round(value)} px`;
  if (key === "autoCaptureCooldownMs") return `${formatSeconds(value)}`;
  return String(value);
}

function formatSeconds(value) {
  const seconds = value / 1000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(BUILD_VERSION)}`).catch((error) => console.warn(error));
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function logDebug(message) {
  if (!el.debugLog) return;
  const time = new Date().toLocaleTimeString();
  el.debugLog.textContent = `${el.debugLog.textContent}\n[${time}] ${message}`.trim();
}

window.addEventListener("error", (event) => {
  logDebug(`window error: ${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  logDebug(`unhandled rejection: ${reason?.message || reason}`);
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

buildHeatmapGrid();
logDebug(`Loaded build ${BUILD_VERSION}`);
switchScreen("intro");
renderHeatmap();
syncSettingsControls();
window.getLastGazeCaptureArtifact = () => state.lastArtifact;
el.captureSurface.addEventListener("pointermove", handlePointerSample);
el.captureSurface.addEventListener("pointerdown", handlePointerSample);
el.startDetectionButton.addEventListener("click", startDetection);
el.openFallbackButton.addEventListener("click", openPointerFallback);
el.skipCalibrationButton.addEventListener("click", skipCalibration);
el.recalibrateButton.addEventListener("click", recalibrate);
el.resetButton.addEventListener("click", resetHeat);
el.captureButton.addEventListener("click", captureHotRegion);
el.presetButtons.forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
el.settingInputs.forEach((input) => input.addEventListener("input", handleSettingInput));
el.autoCaptureToggle?.addEventListener("change", (event) => {
  state.autoCaptureEnabled = event.currentTarget.checked;
  renderAutoCaptureStatus();
});
window.addEventListener("resize", () => renderHeatmap());
window.setInterval(() => {
  if (state.trackerActive && Date.now() - state.lastGazeAt > 1800 && state.screen === "capture") {
    el.gazeStatus.textContent = "waiting";
  }
}, 1000);
window.setInterval(() => {
  if (state.screen !== "capture") return;
  if (applyHeatDecay(Date.now())) renderHeatmap();
}, 250);
registerServiceWorker();
