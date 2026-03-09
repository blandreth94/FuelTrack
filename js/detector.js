/**
 * detector.js — Ball detection interface and color-based implementation.
 *
 * To add a new detector (e.g. ML-based), implement a class with the same
 * `detect(imageData, width, height)` signature and register it in
 * `createDetector()`.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert an RGB pixel to HSL.
 * @returns {{ h: number, s: number, l: number }}  h in [0,360), s/l in [0,1]
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

// ── ColorBallDetector ─────────────────────────────────────────────────────────

/**
 * Detects yellow balls via HSL color thresholding on raw ImageData.
 *
 * Tunable thresholds are exposed as public properties so callers can adjust
 * them without subclassing.
 */
export class ColorBallDetector {
  constructor() {
    // HSL thresholds for yellow
    this.hueMin = 35;
    this.hueMax = 75;
    this.satMin = 0.40;
    this.litMin = 0.25;
    this.litMax = 0.88;

    // Minimum blob area (in downsampled pixels) to count as a ball
    this.minArea = 30;

    // Pixel step for downsampling (2 = check every other pixel in each axis)
    this.step = 2;
  }

  /**
   * Detect yellow ball blobs in a video frame.
   *
   * @param {ImageData} imageData - Raw RGBA pixel data
   * @param {number} width        - Frame width in pixels
   * @param {number} height       - Frame height in pixels
   * @returns {Array<{cx:number, cy:number, radius:number, area:number}>}
   */
  detect(imageData, width, height) {
    const { step } = this;
    const data = imageData.data;

    // Build a boolean mask over a downsampled grid
    const cols = Math.ceil(width / step);
    const rows = Math.ceil(height / step);
    const mask = new Uint8Array(cols * rows); // 1 = yellow

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const px = col * step;
        const py = row * step;
        const idx = (py * width + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const { h, s, l } = rgbToHsl(r, g, b);
        if (
          h >= this.hueMin && h <= this.hueMax &&
          s >= this.satMin &&
          l >= this.litMin && l <= this.litMax
        ) {
          mask[row * cols + col] = 1;
        }
      }
    }

    // Connected-component labeling using union-find
    const labels = new Int32Array(cols * rows).fill(-1);
    const parent = [];

    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]; // path compression
        x = parent[x];
      }
      return x;
    }
    function union(a, b) {
      a = find(a); b = find(b);
      if (a !== b) parent[b] = a;
    }

    let nextLabel = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        if (!mask[i]) continue;

        const above = row > 0 ? labels[(row - 1) * cols + col] : -1;
        const left  = col > 0 ? labels[row * cols + (col - 1)] : -1;

        if (above === -1 && left === -1) {
          labels[i] = nextLabel;
          parent[nextLabel] = nextLabel;
          nextLabel++;
        } else if (above !== -1 && left === -1) {
          labels[i] = above;
        } else if (above === -1 && left !== -1) {
          labels[i] = left;
        } else {
          labels[i] = Math.min(above, left);
          union(above, left);
        }
      }
    }

    // Accumulate stats per root label
    const stats = new Map(); // root → {sumX, sumY, count, minX, minY, maxX, maxY}
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        if (labels[i] === -1) continue;
        const root = find(labels[i]);
        if (!stats.has(root)) {
          stats.set(root, { sumX: 0, sumY: 0, count: 0, minX: col, minY: row, maxX: col, maxY: row });
        }
        const s = stats.get(root);
        s.sumX += col; s.sumY += row; s.count++;
        if (col < s.minX) s.minX = col;
        if (col > s.maxX) s.maxX = col;
        if (row < s.minY) s.minY = row;
        if (row > s.maxY) s.maxY = row;
      }
    }

    // Convert blobs back to full-resolution coordinates
    const results = [];
    for (const [, s] of stats) {
      if (s.count < this.minArea) continue;
      const cx = (s.sumX / s.count) * step;
      const cy = (s.sumY / s.count) * step;
      const w = (s.maxX - s.minX + 1) * step;
      const h = (s.maxY - s.minY + 1) * step;
      const radius = Math.max(w, h) / 2;
      results.push({ cx, cy, radius, area: s.count * step * step });
    }

    return results;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a ball detector by type.
 *
 * Supported types:
 *   'color'  — ColorBallDetector (HSL pixel filtering, no dependencies)
 *   'model'  — (future) TensorFlow.js model-based detector
 *
 * @param {'color'|'model'} type
 * @returns {ColorBallDetector}
 */
export function createDetector(type = 'color') {
  switch (type) {
    case 'color':
      return new ColorBallDetector();
    case 'model':
      throw new Error("Model-based detector not yet implemented. Import and wire up a TF.js detector here.");
    default:
      throw new Error(`Unknown detector type: "${type}"`);
  }
}
