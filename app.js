const GRID_COLUMNS = 12;
const GRID_ROWS = 20;
const ROI_PADDING = 24;
const SAMPLE_DECAY = 0.996;
const SAMPLE_LIMIT = 1200;
const CALIBRATION_HOLD_MS = 1800;
const CALIBRATION_RECORD_EVERY_MS = 180;
const CALIBRATION_EVENT_TYPE = "click";
const CAMERA_TRACK_TIMEOUT_MS = 6500;
const MEDIAPIPE_FACE_MESH_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh";
const BUILD_VERSION = "2026-05-03-v11";
const CALIBRATION_POINTS = [
  { x: 10, y: 10 },
  { x: 50, y: 10 },
  { x: 90, y: 10 },
  { x: 15, y: 50 },
  { x: 50, y: 50 },
  { x: 85, y: 50 },
  { x: 10, y: 78 },
  { x: 50, y: 78 },
  { x: 90, y: 78 },
];

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
  webgazerActive: false,
  lastGazeAt: 0,
  calibrationIndex: 0,
  calibrationTotalSamples: 0,
  calibrationPointSamples: 0,
  calibrationTimeout: null,
  calibrationRecorder: null,
  realGazeSamples: 0,
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
  el.introStatus.textContent = "Requesting camera permission and starting WebGazer...";
  el.cameraStatus.textContent = "requesting";
  logDebug(`Start detection. build=${BUILD_VERSION}`);
  logDebug(`secure=${window.isSecureContext} protocol=${window.location.protocol}`);
  logDebug(`cameraAPI=${Boolean(navigator.mediaDevices?.getUserMedia)} webgazer=${Boolean(window.webgazer)}`);

  try {
    if (!window.webgazer) throw new Error("WebGazer script is not loaded");

    configureWebGazer(window.webgazer);
    logDebug(`faceMeshPath=${window.webgazer.params?.faceMeshSolutionPath || "unknown"}`);
    await window.webgazer.begin(() => {
      console.warn("WebGazer camera stream callback fired before initialization completed.");
      logDebug("WebGazer camera callback fired.");
    });
    showWebGazerFeedback(window.webgazer);
    await waitForCameraTrack();
    const trackInfo = reportCameraTrack();
    if (trackInfo.isVirtual) {
      throw new Error(`Virtual camera detected: ${trackInfo.label}. Use Android Chrome with the real front camera.`);
    }
    logDebug(`begin ok. ready=${Boolean(window.webgazer.isReady?.())}`);

    state.webgazerActive = true;
    state.source = "gaze";
    el.cameraStatus.textContent = "active";
    el.gazeStatus.textContent = "waiting";
    el.signalDot.classList.add("is-live");
    el.trackingStatus.textContent = "Camera gaze proxy active";
    el.cameraNote.textContent = "WebGazer is active. Look at one content block to form a heat region.";
    switchScreen("calibration");
    beginCalibration();
  } catch (error) {
    state.source = "waiting";
    state.webgazerActive = false;
    stopWebGazerQuietly();
    el.startDetectionButton.disabled = false;
    const virtualCamera = /Virtual camera detected/i.test(error.message);
    el.cameraStatus.textContent = virtualCamera ? "virtual rejected" : "unavailable";
    el.introStatus.textContent = virtualCamera
      ? `${error.message} This prototype requires a real phone front camera.`
      : `Camera unavailable: ${error.message}. You can still test pointer fallback.`;
    logDebug(`ERROR ${error.name || "Error"}: ${error.message}`);
    if (error.stack) logDebug(error.stack.split("\n").slice(0, 4).join(" | "));
    console.warn(error);
  }
}

function configureWebGazer(gaze) {
  if (gaze.params) {
    gaze.params.faceMeshSolutionPath = MEDIAPIPE_FACE_MESH_PATH;
  }

  gaze.setRegression?.("ridge");
  gaze.saveDataAcrossSessions?.(false);
  gaze.setGazeListener?.((data) => {
    if (!data || typeof data.x !== "number" || typeof data.y !== "number") return;
    state.lastGazeAt = Date.now();
    state.realGazeSamples += 1;
    el.gazeStatus.textContent = `receiving (${state.realGazeSamples})`;
    el.lastGazeStatus.textContent = `${Math.round(data.x)}, ${Math.round(data.y)}`;
    if (state.realGazeSamples <= 5 || state.realGazeSamples % 25 === 0) {
      logDebug(`real gaze sample #${state.realGazeSamples}: ${Math.round(data.x)},${Math.round(data.y)}`);
    }
    addSample(data.x, data.y, "gaze");
  });
}

function showWebGazerFeedback(gaze) {
  gaze.setVideoViewerSize?.(320, 240);
  gaze.showVideo?.(true);
  gaze.showFaceOverlay?.(true);
  gaze.showFaceFeedbackBox?.(true);
  gaze.showPredictionPoints?.(true);
}

async function waitForCameraTrack() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CAMERA_TRACK_TIMEOUT_MS) {
    const track = getWebGazerVideoTrack();
    if (track) {
      logDebug("cameraTrack exposed by WebGazer.");
      return track;
    }
    await delay(120);
  }

  throw new Error("WebGazer did not expose a real camera video track. Check camera permission and use Android Chrome.");
}

function getWebGazerVideoTrack() {
  const video = document.querySelector("#webgazerVideoFeed");
  const stream = video?.srcObject;
  return stream?.getVideoTracks?.()[0] || null;
}

function reportCameraTrack() {
  const track = getWebGazerVideoTrack();

  if (!track) {
    el.cameraTrackStatus.textContent = "no video track";
    logDebug("cameraTrack=none");
    return { isVirtual: false, label: "none" };
  }

  const settings = track.getSettings?.() || {};
  const size = settings.width && settings.height ? `${settings.width}x${settings.height}` : "unknown size";
  const facing = settings.facingMode ? ` ${settings.facingMode}` : "";
  const label = track.label || "camera label hidden";
  const trackText = `${label} / ${size}${facing}`;
  const isVirtual = isVirtualCameraTrack(label, settings);
  el.cameraTrackStatus.textContent = trackText;
  logDebug(`cameraTrack=${trackText}${isVirtual ? " [virtual rejected]" : ""}`);
  return { isVirtual, label, settings };
}

function isVirtualCameraTrack(label, settings = {}) {
  const haystack = [label, settings.deviceId, settings.groupId].filter(Boolean).join(" ");
  return /fake|virtual|obs|manycam|snap camera|xsplit|droidcam|ivcam/i.test(haystack);
}

function stopWebGazerQuietly() {
  try {
    window.webgazer?.end?.();
  } catch (error) {
    console.warn(error);
  }
}

function openPointerFallback() {
  state.source = "simulation";
  state.webgazerActive = false;
  el.signalDot.classList.remove("is-live");
  el.trackingStatus.textContent = "Pointer / touch simulation active";
  el.cameraNote.textContent = "Fallback mode: pointer and touch samples test only heatmap and ROI capture mechanics.";
  switchScreen("capture");
}

function beginCalibration() {
  clearCalibrationTimers();
  state.calibrationIndex = 0;
  state.calibrationTotalSamples = 0;
  state.calibrationPointSamples = 0;
  el.calibrationGrid.innerHTML = "";
  el.calibrationProgress.style.width = "0%";

  CALIBRATION_POINTS.forEach((pointConfig, index) => {
    const point = document.createElement("span");
    point.className = "calibration-point";
    point.setAttribute("aria-label", `calibration point ${index + 1}`);
    point.style.left = `${pointConfig.x}%`;
    point.style.top = `${pointConfig.y}%`;
    point.dataset.index = String(index);
    el.calibrationGrid.appendChild(point);
  });

  advanceCalibrationPoint();
}

function advanceCalibrationPoint() {
  clearCalibrationTimers();

  if (state.calibrationIndex >= CALIBRATION_POINTS.length) {
    el.calibrationProgress.style.width = "100%";
    el.calibrationPointStatus.textContent = "9 / 9";
    el.calibrationStatus.textContent = "Calibration complete. Moving to heatmap capture.";
    window.setTimeout(() => switchScreen("capture"), 550);
    return;
  }

  const point = CALIBRATION_POINTS[state.calibrationIndex];
  const pointNode = el.calibrationGrid.querySelector(`[data-index="${state.calibrationIndex}"]`);
  const pointNumber = state.calibrationIndex + 1;
  state.calibrationPointSamples = 0;

  el.calibrationGrid.querySelectorAll(".calibration-point").forEach((node) => node.classList.remove("is-active"));
  pointNode?.classList.add("is-active");
  el.calibrationProgress.style.width = `${(state.calibrationIndex / CALIBRATION_POINTS.length) * 100}%`;
  el.calibrationPointStatus.textContent = `${pointNumber} / ${CALIBRATION_POINTS.length}`;
  el.calibrationSampleStatus.textContent = String(state.calibrationTotalSamples);
  el.calibrationStatus.textContent = `Point ${pointNumber}: look at the highlighted dot. WebGazer records known-point samples.`;

  state.calibrationRecorder = window.setInterval(() => {
    recordCalibrationSample(point.x, point.y);
  }, CALIBRATION_RECORD_EVERY_MS);

  state.calibrationTimeout = window.setTimeout(() => {
    pointNode?.classList.remove("is-active");
    pointNode?.classList.add("is-done");
    state.calibrationIndex += 1;
    el.calibrationProgress.style.width = `${(state.calibrationIndex / CALIBRATION_POINTS.length) * 100}%`;
    advanceCalibrationPoint();
  }, CALIBRATION_HOLD_MS);
}

function recordCalibrationSample(percentX, percentY) {
  const rect = el.calibrationStage.getBoundingClientRect();
  const screenX = rect.left + (percentX / 100) * rect.width;
  const screenY = rect.top + (percentY / 100) * rect.height;

  if (window.webgazer?.recordScreenPosition) {
    window.webgazer.recordScreenPosition(screenX, screenY, CALIBRATION_EVENT_TYPE);
    state.calibrationPointSamples += 1;
    state.calibrationTotalSamples += 1;
    el.calibrationSampleStatus.textContent = `${state.calibrationTotalSamples} (${state.calibrationPointSamples} on current)`;
  }
}

function clearCalibrationTimers() {
  if (state.calibrationTimeout) {
    window.clearTimeout(state.calibrationTimeout);
    state.calibrationTimeout = null;
  }

  if (state.calibrationRecorder) {
    window.clearInterval(state.calibrationRecorder);
    state.calibrationRecorder = null;
  }
}

function skipCalibration() {
  clearCalibrationTimers();
  switchScreen("capture");
}

function recalibrate() {
  if (state.webgazerActive) {
    switchScreen("calibration");
    beginCalibration();
    return;
  }

  switchScreen("intro");
  el.introStatus.textContent = "Start detection first to run WebGazer calibration.";
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

  state.source = source;
  state.lastPoint = point;
  state.sampleCount = Math.min(SAMPLE_LIMIT, state.sampleCount + 1);

  const column = clamp(Math.floor((point.x / point.width) * GRID_COLUMNS), 0, GRID_COLUMNS - 1);
  const row = clamp(Math.floor((point.y / point.height) * GRID_ROWS), 0, GRID_ROWS - 1);
  diffuseHeat(row, column);
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

  for (const heatRow of state.heat) {
    for (let index = 0; index < heatRow.length; index += 1) {
      heatRow[index] *= SAMPLE_DECAY;
    }
  }

  kernel.forEach(([rowOffset, columnOffset, weight]) => {
    const targetRow = row + rowOffset;
    const targetColumn = column + columnOffset;
    if (targetRow < 0 || targetRow >= GRID_ROWS || targetColumn < 0 || targetColumn >= GRID_COLUMNS) return;
    state.heat[targetRow][targetColumn] += weight;
  });
}

function countRegion(clientX, clientY) {
  const regionNode = document.elementFromPoint(clientX, clientY)?.closest?.("[data-region]");
  const region = regionNode?.dataset.region || "none";
  state.regionHits.set(region, (state.regionHits.get(region) || 0) + 1);
}

function moveGazeDot(clientX, clientY, source) {
  el.gazeDot.style.left = `${clientX}px`;
  el.gazeDot.style.top = `${clientY}px`;
  el.gazeDot.classList.add("is-visible");
  el.gazeDot.dataset.source = source;
}

function handlePointerSample(event) {
  if (state.webgazerActive && state.source !== "simulation") return;
  addSample(event.clientX, event.clientY, "simulation");
}

function queueRender() {
  if (state.renderQueued) return;

  state.renderQueued = true;
  window.setTimeout(() => {
    state.renderQueued = false;
    renderHeatmap();
  }, 200);
}

function renderHeatmap() {
  const max = getMaxHeat();
  const cells = el.heatmapGrid.querySelectorAll(".heat-cell");

  cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const heat = state.heat[row][column];
    const normalized = max > 0 ? heat / max : 0;
    cell.style.opacity = normalized > 0.04 ? String(Math.min(0.86, normalized * 0.9)) : "0";
    cell.style.transform = `scale(${0.78 + normalized * 0.34})`;
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

  const threshold = max * 0.58;
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
  const left = clamp(minColumn * cellWidth - ROI_PADDING, 0, rect.width);
  const top = clamp(minRow * cellHeight - ROI_PADDING, 0, rect.height);
  const right = clamp((maxColumn + 1) * cellWidth + ROI_PADDING, 0, rect.width);
  const bottom = clamp((maxRow + 1) * cellHeight + ROI_PADDING, 0, rect.height);

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
  const mode = state.source === "gaze" ? "Camera gaze" : state.source === "simulation" ? "Simulation" : "Waiting";

  el.sampleMetric.textContent = String(state.sampleCount);
  el.hotMetric.textContent = `${hotPercent}%`;
  el.trackingStatus.textContent = state.source === "gaze" ? "Camera gaze proxy active" : state.source === "simulation" ? "Pointer / touch simulation active" : "Waiting for gaze samples";
  el.regionTitle.textContent = dominant.region === "none" ? "Heat forming on test surface" : `${regionLabels[dominant.region]} is hottest`;
  el.regionCopy.textContent = state.roi
    ? `ROI is calculated from the strongest heat cluster and expanded by ${ROI_PADDING}px. Screenshot stays inside this page.`
    : "Look at one area for a few seconds, or use pointer fallback to form a stable heat region.";
  el.regionStats.innerHTML = `
    <div><span>Mode</span><strong>${mode}</strong></div>
    <div><span>Dominant area</span><strong>${regionLabels[dominant.region] || regionLabels.none}</strong></div>
    <div><span>Hits</span><strong>${dominant.hits}</strong></div>
    <div><span>ROI</span><strong>${state.roi ? `${Math.round(state.roi.width)} x ${Math.round(state.roi.height)} px` : "--"}</strong></div>
  `;
}

function getDominantRegion() {
  let best = { region: "none", hits: 0 };
  state.regionHits.forEach((hits, region) => {
    if (hits > best.hits) best = { region, hits };
  });
  return best;
}

async function captureHotRegion() {
  if (!state.roi) {
    el.regionCopy.textContent = "No stable ROI yet. Add more gaze or pointer samples first.";
    return;
  }

  if (!window.html2canvas) {
    el.regionCopy.textContent = "Screenshot library unavailable. Check network access for html2canvas.";
    return;
  }

  el.captureButton.disabled = true;
  el.captureButton.textContent = "Capturing...";
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
    el.previewImage.src = dataUrl;
    el.previewImage.hidden = false;
    el.emptyPreview.hidden = true;
    el.downloadLink.href = dataUrl;
    el.downloadLink.hidden = false;
    el.regionCopy.textContent = "Captured the strongest heat-region ROI from the current page only.";
  } catch (error) {
    el.regionCopy.textContent = "Capture failed. Try refreshing the page or using a smaller viewport.";
    console.warn(error);
  } finally {
    document.body.classList.remove("is-capturing");
    el.captureButton.disabled = false;
    el.captureButton.textContent = "Capture hot region";
  }
}

function resetHeat() {
  state.sampleCount = 0;
  state.heat = createHeatGrid();
  state.regionHits.clear();
  state.lastPoint = null;
  state.roi = null;
  el.previewImage.hidden = true;
  el.previewImage.removeAttribute("src");
  el.downloadLink.hidden = true;
  el.downloadLink.removeAttribute("href");
  el.emptyPreview.hidden = false;
  el.gazeDot.classList.remove("is-visible");
  renderHeatmap();
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
el.captureSurface.addEventListener("pointermove", handlePointerSample);
el.captureSurface.addEventListener("pointerdown", handlePointerSample);
el.startDetectionButton.addEventListener("click", startDetection);
el.openFallbackButton.addEventListener("click", openPointerFallback);
el.skipCalibrationButton.addEventListener("click", skipCalibration);
el.recalibrateButton.addEventListener("click", recalibrate);
el.resetButton.addEventListener("click", resetHeat);
el.captureButton.addEventListener("click", captureHotRegion);
window.addEventListener("resize", () => renderHeatmap());
window.setInterval(() => {
  if (state.webgazerActive && Date.now() - state.lastGazeAt > 1800 && state.screen === "capture") {
    el.gazeStatus.textContent = "waiting";
  }
}, 1000);
registerServiceWorker();
