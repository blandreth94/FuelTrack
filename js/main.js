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
const btnFullscreen  = document.getElementById('btn-fullscreen');
const iconExpand     = document.getElementById('icon-expand');
const iconCompress   = document.getElementById('icon-compress');
const btnSettings      = document.getElementById('btn-settings');
const settingsPanel    = document.getElementById('settings-panel');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSave          = document.getElementById('btn-save');

// ── State ─────────────────────────────────────────────────────────────────────
const detector = createDetector('color');
const tracker  = new BallTracker();

let tracking        = false;
let rafId           = null;
let detectionScale  = 0.25; // canvas drawn at this fraction of video resolution

// Rolling FPS — keep timestamps of the last 60 processed frames
const FPS_WINDOW = 60;
const frameTimes = [];

/** Offscreen canvas used to read pixel data from the video stream (downscaled). */
const offscreen    = document.createElement('canvas');
const offscreenCtx = offscreen.getContext('2d', { willReadFrequently: true });

// Use step=1 — the canvas is already downscaled, no need for additional sampling skip
detector.step = 1;

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
    const activeDeviceId = stream.getVideoTracks()[0]?.getSettings()?.deviceId ?? '';
    await populateCameraList(activeDeviceId);
  } catch (err) {
    showError(err);
  }
}

/** Enumerate video input devices and fill the selector. */
async function populateCameraList(activeDeviceId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Deduplicate by deviceId only — groupId is unreliable on iOS Chrome
    // (all cameras may share the same groupId, causing valid entries to be dropped)
    const seen = new Set();
    const cameras = devices.filter(d => {
      if (d.kind !== 'videoinput' || !d.deviceId) return false;
      if (seen.has(d.deviceId)) return false;
      seen.add(d.deviceId);
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
  startCamera(cameraSelect.value);
});

// ── Fullscreen ────────────────────────────────────────────────────────────────

// iOS (Chrome + Safari) does not support the Fullscreen API — hide the button
const supportsFullscreen = !!document.documentElement.requestFullscreen;
if (!supportsFullscreen) {
  btnFullscreen.style.display = 'none';
}

function updateFullscreenIcon() {
  const fs = !!document.fullscreenElement;
  iconExpand.style.display   = fs ? 'none' : '';
  iconCompress.style.display = fs ? '' : 'none';
}

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

document.addEventListener('fullscreenchange', updateFullscreenIcon);

// ── Settings Panel ────────────────────────────────────────────────────────────

function openSettings() {
  settingsPanel.classList.add('open');
  settingsPanel.setAttribute('aria-hidden', 'false');
}
function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsPanel.setAttribute('aria-hidden', 'true');
}

btnSettings.addEventListener('click', openSettings);
btnSettingsClose.addEventListener('click', closeSettings);

// Detection resolution (segmented control)
document.getElementById('seg-scale').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  document.querySelectorAll('#seg-scale .seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  detectionScale = parseFloat(btn.dataset.value);
});

// HSL thresholds
function bindSlider(id, valId, transform, apply) {
  const slider = document.getElementById(id);
  const valEl  = document.getElementById(valId);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    valEl.textContent = transform(v);
    apply(v);
  });
}

bindSlider('s-hue-min',  'val-hue-min',  v => `${Math.round(v)}°`,  v => { detector.hueMin = v; });
bindSlider('s-hue-max',  'val-hue-max',  v => `${Math.round(v)}°`,  v => { detector.hueMax = v; });
bindSlider('s-sat-min',  'val-sat-min',  v => `${Math.round(v)}%`,  v => { detector.satMin = v / 100; });
bindSlider('s-lit-min',  'val-lit-min',  v => `${Math.round(v)}%`,  v => { detector.litMin = v / 100; });
bindSlider('s-lit-max',  'val-lit-max',  v => `${Math.round(v)}%`,  v => { detector.litMax = v / 100; });
bindSlider('s-area',     'val-area',     v => `${Math.round(v)}`,   v => { detector.minArea = v; });
bindSlider('s-timeout',  'val-timeout',  v => `${Math.round(v)}ms`, v => { tracker.inactiveAfterMs = v; });

// Reset all settings to their default values and sync slider/segmented-control UI
const DEFAULTS = {
  hueMin: 42, hueMax: 68, satMin: 0.55, litMin: 0.40, litMax: 0.85,
  minArea: 80, detectionScale: 0.25, inactiveAfterMs: 500,
};

function applyDefaults() {
  detector.hueMin         = DEFAULTS.hueMin;
  detector.hueMax         = DEFAULTS.hueMax;
  detector.satMin         = DEFAULTS.satMin;
  detector.litMin         = DEFAULTS.litMin;
  detector.litMax         = DEFAULTS.litMax;
  detector.minArea        = DEFAULTS.minArea;
  tracker.inactiveAfterMs = DEFAULTS.inactiveAfterMs;
  detectionScale          = DEFAULTS.detectionScale;

  // Sync slider values and labels
  const setSlider = (id, valId, raw, fmt) => {
    document.getElementById(id).value   = raw;
    document.getElementById(valId).textContent = fmt;
  };
  setSlider('s-hue-min', 'val-hue-min', DEFAULTS.hueMin,               `${DEFAULTS.hueMin}°`);
  setSlider('s-hue-max', 'val-hue-max', DEFAULTS.hueMax,               `${DEFAULTS.hueMax}°`);
  setSlider('s-sat-min', 'val-sat-min', DEFAULTS.satMin * 100,         `${Math.round(DEFAULTS.satMin * 100)}%`);
  setSlider('s-lit-min', 'val-lit-min', DEFAULTS.litMin * 100,         `${Math.round(DEFAULTS.litMin * 100)}%`);
  setSlider('s-lit-max', 'val-lit-max', DEFAULTS.litMax * 100,         `${Math.round(DEFAULTS.litMax * 100)}%`);
  setSlider('s-area',    'val-area',    DEFAULTS.minArea,               `${DEFAULTS.minArea}`);
  setSlider('s-timeout', 'val-timeout', DEFAULTS.inactiveAfterMs,       `${DEFAULTS.inactiveAfterMs}ms`);

  // Sync segmented control
  document.querySelectorAll('#seg-scale .seg-btn').forEach(b => {
    b.classList.toggle('active', parseFloat(b.dataset.value) === DEFAULTS.detectionScale);
  });
}

document.getElementById('btn-reset-defaults').addEventListener('click', applyDefaults);

// ── Snapshot / Recording ──────────────────────────────────────────────────────

/**
 * Build a composite canvas that merges the live video frame with the arc
 * overlay, using the same object-fit:cover crop the user sees on screen.
 *
 * Designed for dual use:
 *   - Still snapshot: call .toBlob() on the returned canvas
 *   - Future screen recording: call .captureStream(fps) → MediaRecorder
 */
function buildCompositeCanvas() {
  const cw = canvas.width;  // overlay canvas is sized to the display
  const ch = canvas.height;

  const composite = document.createElement('canvas');
  composite.width  = cw;
  composite.height = ch;
  const ctx = composite.getContext('2d');

  // Draw video with object-fit:cover geometry (same as videoToCanvas in renderer)
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw && vh) {
    const scale   = Math.max(cw / vw, ch / vh);
    const ox      = (cw - vw * scale) / 2;
    const oy      = (ch - vh * scale) / 2;
    ctx.drawImage(video, ox, oy, vw * scale, vh * scale);
  }

  // Draw arc overlay on top
  ctx.drawImage(canvas, 0, 0);

  return composite;
}

async function saveSnapshot() {
  const composite = buildCompositeCanvas();

  composite.toBlob(async blob => {
    const filename = `fueltrack-${Date.now()}.jpg`;
    const file = new File([blob], filename, { type: 'image/jpeg' });

    // Web Share API — works on iOS Safari/Chrome and saves directly to Photos
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'FuelTrack Snapshot' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled share sheet
      }
    }

    // Fallback: trigger browser download (desktop)
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/jpeg', 0.92);
}

btnSave.addEventListener('click', saveSnapshot);

// ── Detection / Render Loop ───────────────────────────────────────────────────

function loop(ts) {
  rafId = requestAnimationFrame(loop);

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

  // Draw to a downscaled canvas for faster pixel processing
  const dw = Math.max(1, Math.round(vw * detectionScale));
  const dh = Math.max(1, Math.round(vh * detectionScale));
  if (offscreen.width !== dw || offscreen.height !== dh) {
    offscreen.width  = dw;
    offscreen.height = dh;
  }

  let detections = [];

  if (tracking) {
    offscreenCtx.drawImage(video, 0, 0, dw, dh);
    const imageData = offscreenCtx.getImageData(0, 0, dw, dh);
    const raw = detector.detect(imageData, dw, dh);
    // Scale detection coordinates back up to display space
    detections = raw.map(d => ({
      cx:     d.cx     / detectionScale,
      cy:     d.cy     / detectionScale,
      radius: d.radius / detectionScale,
      area:   d.area,
    }));
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
