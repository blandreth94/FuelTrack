/**
 * main.js — FuelTrack app entry point.
 *
 * Handles camera initialisation, the detection/tracking/rendering loop,
 * and UI button events.
 */

import { createDetector } from './detector.js';
import { BallTracker } from './tracker.js';
import { render } from './renderer.js';

// ── DOM References ────────────────────────────────────────────────────────────
const video          = document.getElementById('video');
const canvas         = document.getElementById('overlay');
const btnTrack       = document.getElementById('btn-track');
const btnReset       = document.getElementById('btn-reset');
const statusText     = document.getElementById('status-text');
const fpsText        = document.getElementById('fps-text');
const cameraSelect   = document.getElementById('camera-select');
const cameraRow      = document.getElementById('camera-row');
const zoomSlider     = document.getElementById('zoom-slider');
const zoomValue      = document.getElementById('zoom-value');

// ── State ─────────────────────────────────────────────────────────────────────
const detector = createDetector('color');
const tracker  = new BallTracker();

let tracking    = false;
let rafId       = null;
let lastFrameTs = 0;

// Rolling FPS — keep timestamps of the last 30 processed frames
const FPS_WINDOW = 30;
const frameTimes = [];

/** Offscreen canvas used to read pixel data from the video stream. */
const offscreen    = document.createElement('canvas');
const offscreenCtx = offscreen.getContext('2d', { willReadFrequently: true });

// Throttle to ~30 fps to preserve battery / thermal headroom on iPhone.
const TARGET_INTERVAL_MS = 1000 / 30;

// ── Camera ────────────────────────────────────────────────────────────────────

/** Start (or restart) the camera stream for a given deviceId. */
async function startCamera(deviceId) {
  statusText.textContent = 'Requesting camera…';

  // Stop any existing stream first
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }

  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await new Promise(resolve => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
    });
    statusText.textContent = 'Press Start to begin tracking';
    btnTrack.disabled = false;

    // Populate the camera selector after we have permission (first call only)
    await populateCameraList(stream.getVideoTracks()[0].getSettings().deviceId);
  } catch (err) {
    showError(err);
  }
}

/** Enumerate video input devices and fill the selector. */
async function populateCameraList(activeDeviceId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Deduplicate: keep one entry per physical camera (same groupId = same device)
    const seen = new Set();
    const cameras = devices.filter(d => {
      if (d.kind !== 'videoinput') return false;
      const key = d.groupId || d.deviceId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (cameras.length <= 1) {
      cameraRow.classList.add('hidden');
      return;
    }

    cameraSelect.innerHTML = '';
    cameras.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera ${i + 1}`;
      if (cam.deviceId === activeDeviceId) opt.selected = true;
      cameraSelect.appendChild(opt);
    });
    cameraRow.classList.remove('hidden');
  } catch {
    cameraRow.classList.add('hidden');
  }
}

cameraSelect.addEventListener('change', () => {
  // Reset tracking state and arcs when switching cameras
  if (tracking) {
    tracking = false;
    btnTrack.textContent = 'Start Tracking';
    btnTrack.classList.remove('tracking');
  }
  tracker.reset();
  zoomSlider.value = 1;
  applyZoom(1);
  startCamera(cameraSelect.value);
});

// ── Zoom ──────────────────────────────────────────────────────────────────────

function applyZoom(z) {
  const t = `scale(${z})`;
  video.style.transform  = t;
  canvas.style.transform = t;
  zoomValue.textContent  = `${z.toFixed(2).replace(/\.?0+$/, '')}×`;
}

zoomSlider.addEventListener('input', () => {
  applyZoom(parseFloat(zoomSlider.value));
});

// ── Detection / Render Loop ───────────────────────────────────────────────────

function loop(ts) {
  rafId = requestAnimationFrame(loop);

  const elapsed = ts - lastFrameTs;
  if (elapsed < TARGET_INTERVAL_MS) return; // throttle
  lastFrameTs = ts - (elapsed % TARGET_INTERVAL_MS);

  // Update rolling FPS
  frameTimes.push(ts);
  if (frameTimes.length > FPS_WINDOW) frameTimes.shift();
  if (frameTimes.length >= 2) {
    const fps = (frameTimes.length - 1) / ((ts - frameTimes[0]) / 1000);
    fpsText.textContent = `${Math.round(fps)} fps`;
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  if (!vw || !vh) return; // video not ready yet

  // Resize offscreen canvas to match the video stream (not the display)
  if (offscreen.width !== vw || offscreen.height !== vh) {
    offscreen.width  = vw;
    offscreen.height = vh;
  }

  let detections = [];

  if (tracking) {
    offscreenCtx.drawImage(video, 0, 0, vw, vh);
    const imageData = offscreenCtx.getImageData(0, 0, vw, vh);
    detections = detector.detect(imageData, vw, vh);
    tracker.update(detections, ts);
    updateStatus();
  }

  render(
    canvas,
    video,
    tracker.drawablePaths,
    tracker.activeDetectionPoints,
    vw,
    vh,
  );
}

function startLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(loop);
}

// ── UI ────────────────────────────────────────────────────────────────────────

function updateStatus() {
  const active = tracker.activeBallCount;
  const total  = tracker.totalPathCount;
  if (!tracking) {
    statusText.textContent = total > 0
      ? `Paused — ${total} arc${total !== 1 ? 's' : ''} recorded`
      : 'Press Start to begin tracking';
    return;
  }
  if (active === 0) {
    statusText.textContent = 'Tracking — no balls detected';
  } else {
    statusText.textContent = `Tracking ${active} ball${active !== 1 ? 's' : ''}` +
      (total > active ? ` · ${total} total arcs` : '');
  }
}

btnTrack.addEventListener('click', () => {
  tracking = !tracking;
  if (tracking) {
    video.play();
    btnTrack.textContent = 'Stop Tracking';
    btnTrack.classList.add('tracking');
    statusText.textContent = 'Tracking — no balls detected';
  } else {
    video.pause(); // freeze the last frame for review
    btnTrack.textContent = 'Start Tracking';
    btnTrack.classList.remove('tracking');
    updateStatus();
  }
});

btnReset.addEventListener('click', () => {
  tracker.reset();
  updateStatus();
});

// ── Error Handling ────────────────────────────────────────────────────────────

function showError(err) {
  console.error('FuelTrack error:', err);

  let message = 'An unexpected error occurred.';
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    message = 'Camera access was denied. Please allow camera permissions in your browser settings and reload the page.';
  } else if (err.name === 'NotFoundError') {
    message = 'No camera was found on this device.';
  } else if (err.name === 'NotReadableError') {
    message = 'The camera is already in use by another application.';
  }

  const overlay = document.createElement('div');
  overlay.id = 'error-overlay';
  overlay.innerHTML = `<h2>Camera Unavailable</h2><p>${message}</p>`;
  document.body.appendChild(overlay);

  statusText.textContent = 'Camera unavailable';
  btnTrack.disabled = true;
}

// ── Init ──────────────────────────────────────────────────────────────────────

btnTrack.disabled = true; // enabled after camera is ready
cameraRow.classList.add('hidden'); // hidden until we know there are multiple cameras

startCamera().then(() => {
  startLoop();
});
