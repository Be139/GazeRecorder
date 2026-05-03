const GRID_COLUMNS = 12;
const GRID_ROWS = 20;
const ROI_PADDING = 24;
const SAMPLE_DECAY = 0.996;
const SAMPLE_LIMIT = 1200;

const regionLabels = {
  work: "Work signal",
  trend: "Trend pull",
  rest: "Rest content",
  growth: "Growth note",
  none: "No region",
};

const state = {
  source: "simulation",
  sampleCount: 0,
  heat: Array.from({ length: GRID_ROWS }, () => Array(GRID_COLUMNS).fill(0)),
  regionHits: new Map(),
  lastPoint: null,
  roi: null,
  renderQueued: false,
};

const el = {
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
  startGazeButton: document.querySelector("#startGazeButton"),
  captureButton: document.querySelector("#captureButton"),
  resetButton: document.querySelector("#resetButton"),
  calibration: document.querySelector("#calibration"),
  calibrationGrid: document.querySelector("#calibrationGrid"),
  skipCalibrationButton: document.querySelector("#skipCalibrationButton"),
  emptyPreview: document.querySelector("#emptyPreview"),
  previewImage: document.querySelector("#previewImage"),
  downloadLink: document.querySelector("#downloadLink"),
};

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
  const mode = state.source === "gaze" ? "Camera gaze" : "Simulation";

  el.sampleMetric.textContent = String(state.sampleCount);
  el.hotMetric.textContent = `${hotPercent}%`;
  el.trackingStatus.textContent = state.source === "gaze" ? "Camera gaze proxy active" : "Pointer / touch simulation active";
  el.regionTitle.textContent = dominant.region === "none" ? "Heat forming on test surface" : `${regionLabels[dominant.region]} is hottest`;
  el.regionCopy.textContent = state.roi
    ? `ROI is calculated from the strongest heat cluster and expanded by ${ROI_PADDING}px. Screenshot stays inside this page.`
    : "Move or look at one area for a few seconds to form a stable heat region.";
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

async function startGaze() {
  el.startGazeButton.disabled = true;
  el.trackingStatus.textContent = "Requesting camera permission";

  try {
    if (!window.webgazer) throw new Error("WebGazer script is not loaded");

    await window.webgazer
      .setRegression("ridge")
      .setGazeListener((data) => {
        if (!data || typeof data.x !== "number" || typeof data.y !== "number") return;
        addSample(data.x, data.y, "gaze");
      })
      .saveDataAcrossSessions(false)
      .begin();

    window.webgazer.showVideo(false);
    window.webgazer.showFaceOverlay(false);
    window.webgazer.showFaceFeedbackBox(false);
    window.webgazer.showPredictionPoints(false);

    state.source = "gaze";
    el.signalDot.classList.add("is-live");
    el.startGazeButton.textContent = "Camera on";
    el.trackingStatus.textContent = "Camera gaze proxy active";
    openCalibration();
  } catch (error) {
    state.source = "simulation";
    el.startGazeButton.disabled = false;
    el.signalDot.classList.remove("is-live");
    el.trackingStatus.textContent = "Camera unavailable; simulation active";
    console.warn(error);
  }
}

function openCalibration() {
  el.calibration.classList.add("is-open");
  el.calibration.setAttribute("aria-hidden", "false");
  el.calibrationGrid.innerHTML = "";

  Array.from({ length: 9 }).forEach((_, index) => {
    const point = document.createElement("button");
    point.className = "calibration-point";
    point.type = "button";
    point.setAttribute("aria-label", `calibration point ${index + 1}`);
    point.addEventListener("click", () => {
      point.classList.add("is-done");
      const rect = point.getBoundingClientRect();
      if (window.webgazer?.recordScreenPosition) {
        window.webgazer.recordScreenPosition(rect.left + rect.width / 2, rect.top + rect.height / 2, "click");
      }
      if (document.querySelectorAll(".calibration-point.is-done").length >= 9) {
        closeCalibration();
      }
    });
    el.calibrationGrid.appendChild(point);
  });
}

function closeCalibration() {
  el.calibration.classList.remove("is-open");
  el.calibration.setAttribute("aria-hidden", "true");
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

function resetSession() {
  state.sampleCount = 0;
  state.heat = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLUMNS).fill(0));
  state.regionHits.clear();
  state.lastPoint = null;
  state.roi = null;
  el.previewImage.hidden = true;
  el.previewImage.removeAttribute("src");
  el.downloadLink.hidden = true;
  el.downloadLink.removeAttribute("href");
  el.emptyPreview.hidden = false;
  el.gazeDot.classList.remove("is-visible");
  closeCalibration();
  renderHeatmap();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => console.warn(error));
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

buildHeatmapGrid();
renderHeatmap();
el.captureSurface.addEventListener("pointermove", (event) => addSample(event.clientX, event.clientY, "simulation"));
el.captureSurface.addEventListener("pointerdown", (event) => addSample(event.clientX, event.clientY, "simulation"));
el.startGazeButton.addEventListener("click", startGaze);
el.captureButton.addEventListener("click", captureHotRegion);
el.resetButton.addEventListener("click", resetSession);
el.skipCalibrationButton.addEventListener("click", closeCalibration);
window.addEventListener("resize", () => renderHeatmap());
registerServiceWorker();
