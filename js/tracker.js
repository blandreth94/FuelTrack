/**
 * tracker.js — Multi-ball path tracking across video frames.
 *
 * Associates per-frame detections with existing paths using nearest-centroid
 * matching. Inactive paths (no recent detection) retain their points so arcs
 * persist on screen until reset() is called.
 */

const ARC_COLORS = [
  '#FF3B30', // red
  '#007AFF', // blue
  '#34C759', // green
  '#FF9500', // orange
  '#AF52DE', // purple
  '#FF2D55', // pink
  '#5AC8FA', // light blue
  '#FFCC00', // yellow (visible on dark backgrounds)
];

/** Max pixel distance to match a detection to an existing active path. */
const MAX_MATCH_DISTANCE = 160;

/** ms without a detection before a path is marked inactive (frame-rate independent). */
const DEFAULT_INACTIVE_AFTER_MS = 500;

/**
 * A detection must move at least this many pixels from the last recorded point
 * before a new point is appended. Prevents static false-positives from
 * accumulating hundreds of duplicate points at the same location.
 */
const MIN_MOVE_PX = 6;

/**
 * A path must span at least this many pixels (max distance between any point
 * and the first point) before it is considered drawable as an arc.
 * Filters out noise blobs that are detected but never actually travel.
 */
const MIN_ARC_SPAN_PX = 15;

let colorIndex = 0;
function nextColor() {
  const c = ARC_COLORS[colorIndex % ARC_COLORS.length];
  colorIndex++;
  return c;
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A single tracked ball path.
 * @typedef {{ points: {x:number,y:number,t:number}[], color:string, active:boolean, framesSinceUpdate:number }} Path
 */

export class BallTracker {
  constructor() {
    /** @type {Path[]} */
    this.paths = [];
    /** Milliseconds without a detection before a path goes inactive. */
    this.inactiveAfterMs = DEFAULT_INACTIVE_AFTER_MS;
  }

  /**
   * Update paths with detections from the current frame.
   *
   * @param {Array<{cx:number, cy:number, radius:number, area:number}>} detections
   * @param {number} timestamp - performance.now() or Date.now()
   */
  update(detections, timestamp) {
    // Separate active paths (candidates for matching) from inactive ones
    const activePaths = this.paths.filter(p => p.active);

    // Track which active paths got a match this frame
    const matched = new Set();

    for (const det of detections) {
      let bestPath = null;
      let bestDist = MAX_MATCH_DISTANCE;

      for (const path of activePaths) {
        if (matched.has(path)) continue;
        const last = path.points[path.points.length - 1];
        const d = dist(det.cx, det.cy, last.x, last.y);
        if (d < bestDist) {
          bestDist = d;
          bestPath = path;
        }
      }

      if (bestPath) {
        const last = bestPath.points[bestPath.points.length - 1];
        // Only record a new point (and keep the path alive) if the ball actually moved.
        // If it hasn't moved, we don't update lastSeenAt — the path will time out via
        // inactiveAfterMs, preventing stationary objects from being tracked indefinitely.
        if (dist(det.cx, det.cy, last.x, last.y) >= MIN_MOVE_PX) {
          bestPath.points.push({ x: det.cx, y: det.cy, t: timestamp });
          bestPath.lastSeenAt = timestamp;
        }
        matched.add(bestPath);
      } else {
        // New ball — start a fresh path
        this.paths.push({
          points: [{ x: det.cx, y: det.cy, t: timestamp }],
          color: nextColor(),
          active: true,
          lastSeenAt: timestamp,
        });
      }
    }

    // Age unmatched active paths by time (frame-rate independent)
    for (const path of activePaths) {
      if (!matched.has(path) && timestamp - path.lastSeenAt > this.inactiveAfterMs) {
        path.active = false;
      }
    }
  }

  /** Clear all paths and reset color cycling. */
  reset() {
    this.paths = [];
    colorIndex = 0;
  }

  /** Returns paths that have moved enough to be worth drawing as arcs. */
  get drawablePaths() {
    return this.paths.filter(p => {
      if (p.points.length < 2) return false;
      const origin = p.points[0];
      return p.points.some(pt => dist(pt.x, pt.y, origin.x, origin.y) >= MIN_ARC_SPAN_PX);
    });
  }

  /** Returns the most recent point of each currently active path. */
  get activeDetectionPoints() {
    return this.paths
      .filter(p => p.active && p.points.length > 0)
      .map(p => ({ ...p.points[p.points.length - 1], color: p.color }));
  }

  get activeBallCount() {
    return this.paths.filter(p => p.active).length;
  }

  get totalPathCount() {
    return this.paths.length;
  }
}
