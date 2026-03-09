/**
 * renderer.js — Canvas rendering for tracked ball arcs and detection indicators.
 */

const LINE_WIDTH = 3.5;
const LINE_ALPHA = 0.85;
const INDICATOR_RADIUS = 12;
const INDICATOR_LINE_WIDTH = 2.5;

/**
 * Draw a smooth arc through an array of {x, y} points using the midpoint
 * quadratic bezier technique.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number, y:number}[]} points
 */
function drawSmoothArc(ctx, points) {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    // Midpoint quadratic bezier
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    // End at the last point
    const last = points[points.length - 1];
    const secondLast = points[points.length - 2];
    ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
  }

  ctx.stroke();
}

/**
 * Resize canvas to match the displayed video dimensions if needed.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement} video
 */
function syncCanvasSize(canvas, video) {
  const { offsetWidth: w, offsetHeight: h } = video;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/**
 * Map a video-space coordinate to canvas-space, accounting for object-fit:cover.
 *
 * The video stream may have a different aspect ratio than the display area.
 * We need to scale and translate the arc points so they align with what the
 * user sees on screen.
 *
 * @param {number} x           - Video-space x
 * @param {number} y           - Video-space y
 * @param {number} videoW      - Intrinsic video width
 * @param {number} videoH      - Intrinsic video height
 * @param {number} canvasW     - Canvas / display width
 * @param {number} canvasH     - Canvas / display height
 * @returns {{x:number, y:number}}
 */
function videoToCanvas(x, y, videoW, videoH, canvasW, canvasH) {
  const scaleX = canvasW / videoW;
  const scaleY = canvasH / videoH;
  // object-fit:cover uses the larger scale so the video fills the container
  const scale = Math.max(scaleX, scaleY);
  const offsetX = (canvasW - videoW * scale) / 2;
  const offsetY = (canvasH - videoH * scale) / 2;
  return {
    x: x * scale + offsetX,
    y: y * scale + offsetY,
  };
}

/**
 * Render all paths and active detection indicators onto the canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement}  video
 * @param {import('./tracker.js').Path[]} paths          - All tracked paths
 * @param {{x:number,y:number,color:string}[]} activePoints - Latest point per active path
 * @param {number} videoW  - Intrinsic video width
 * @param {number} videoH  - Intrinsic video height
 */
export function render(canvas, video, paths, activePoints, videoW, videoH) {
  syncCanvasSize(canvas, video);
  const ctx = canvas.getContext('2d');
  const { width: cw, height: ch } = canvas;

  ctx.clearRect(0, 0, cw, ch);

  // Draw persisted arcs
  for (const path of paths) {
    if (path.points.length < 2) continue;

    const mapped = path.points.map(p =>
      videoToCanvas(p.x, p.y, videoW, videoH, cw, ch)
    );

    ctx.save();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.globalAlpha = path.active ? LINE_ALPHA : LINE_ALPHA * 0.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawSmoothArc(ctx, mapped);
    ctx.restore();
  }

  // Draw current-position indicators for active balls
  for (const pt of activePoints) {
    const { x, y } = videoToCanvas(pt.x, pt.y, videoW, videoH, cw, ch);
    ctx.save();
    ctx.globalAlpha = 0.9;

    // Outer ring
    ctx.beginPath();
    ctx.arc(x, y, INDICATOR_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = INDICATOR_LINE_WIDTH;
    ctx.stroke();

    // Filled dot
    ctx.beginPath();
    ctx.arc(x, y, INDICATOR_RADIUS * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = pt.color;
    ctx.fill();

    ctx.restore();
  }
}
