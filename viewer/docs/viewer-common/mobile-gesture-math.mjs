// Pure numeric helpers for the coarse-pointer viewer controller.  Keeping this
// Three/DOM-free makes the gesture thresholds and decay law directly node-testable.

export const GESTURE_POLE_EPS = 1e-3;
export const MOMENTUM_FRAME_DECAY = 0.9;
export const MOMENTUM_FRAME_MS = 1000 / 60;
export const G4_MIN_VERTICAL_PX = 24;
export const G4_DOMINANCE_RATIO = 0.35;
export const DOLLY_ENGAGE_LOG = 0.075;
// The translation-only runway must leave enough screen-space budget for the
// preserved 4 px per-anchor bound. The threshold is span-aware so wide
// contacts cannot accumulate a large fixed-scale pinch residual.
export const DOLLY_LOCKED_SPAN_DELTA_PX = 6;
export const ROTATE_ENGAGE_DEG = 6;

export function dollyEngageLogForSpan(startSpan) {
  if (!Number.isFinite(startSpan) || startSpan <= DOLLY_LOCKED_SPAN_DELTA_PX) {
    return DOLLY_ENGAGE_LOG;
  }
  // Use the shrink-side log magnitude: it is the larger direction-symmetric
  // bound, so either signed span change remains inside the fixed-scale runway.
  const spanBoundLog = -Math.log(1 - DOLLY_LOCKED_SPAN_DELTA_PX / startSpan);
  return Number.isFinite(spanBoundLog) && spanBoundLog > 0
    ? Math.min(DOLLY_ENGAGE_LOG, spanBoundLog)
    : DOLLY_ENGAGE_LOG;
}

export function applyDeadZone(value, threshold) {
  if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold < 0) return 0;
  const magnitude = Math.abs(value) - threshold;
  if (magnitude <= 0) return 0;
  return value < 0 ? -magnitude : magnitude;
}

export function wrappedAngleDelta(currentAngle, startAngle) {
  if (!Number.isFinite(currentAngle) || !Number.isFinite(startAngle)) return 0;
  let delta = currentAngle - startAngle;
  if (delta > Math.PI || delta <= -Math.PI) {
    delta = (delta + Math.PI) % (2 * Math.PI);
    if (delta < 0) delta += 2 * Math.PI;
    delta -= Math.PI;
  }
  return delta;
}

// Writes the unique orientation-preserving 2D similarity mapping A1/A2 to
// P1/P2. The caller owns `output`; this function returns only a boolean so the
// pointer-move path never receives a freshly-created result object.
export function solveGroundPlaneSimilarity(
  a1x, a1y, a2x, a2y,
  p1x, p1y, p2x, p2y,
  output,
) {
  if (!output) return false;
  output.valid = false;
  output.scale = 1;
  output.rotation = 0;
  output.tx = 0;
  output.ty = 0;
  if (!Number.isFinite(a1x) || !Number.isFinite(a1y)
    || !Number.isFinite(a2x) || !Number.isFinite(a2y)
    || !Number.isFinite(p1x) || !Number.isFinite(p1y)
    || !Number.isFinite(p2x) || !Number.isFinite(p2y)) return false;

  const adx = a2x - a1x;
  const ady = a2y - a1y;
  const pdx = p2x - p1x;
  const pdy = p2y - p1y;
  const anchorLengthSq = adx * adx + ady * ady;
  const pointerLengthSq = pdx * pdx + pdy * pdy;
  if (!(anchorLengthSq > 1e-12) || !(pointerLengthSq > 1e-12)) return false;

  const scale = Math.sqrt(pointerLengthSq / anchorLengthSq);
  const rotation = Math.atan2(adx * pdy - ady * pdx, adx * pdx + ady * pdy);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tx = p1x - scale * (cos * a1x - sin * a1y);
  const ty = p1y - scale * (sin * a1x + cos * a1y);
  if (!Number.isFinite(scale) || !Number.isFinite(rotation)
    || !Number.isFinite(tx) || !Number.isFinite(ty)) return false;

  output.valid = true;
  output.scale = scale;
  output.rotation = rotation;
  output.tx = tx;
  output.ty = ty;
  return true;
}

// Least-squares two-point similarity with a caller-supplied rotation. G★-2
// uses rotation=0 before engagement, then the post-engagement rotation delta.
// The output object is caller-owned, matching the unrestricted solve above.
export function solveGroundPlaneSimilarityAtRotation(
  a1x, a1y, a2x, a2y,
  p1x, p1y, p2x, p2y,
  rotation,
  output,
) {
  if (!output) return false;
  output.valid = false;
  output.scale = 1;
  output.rotation = 0;
  output.tx = 0;
  output.ty = 0;
  if (!Number.isFinite(a1x) || !Number.isFinite(a1y)
    || !Number.isFinite(a2x) || !Number.isFinite(a2y)
    || !Number.isFinite(p1x) || !Number.isFinite(p1y)
    || !Number.isFinite(p2x) || !Number.isFinite(p2y)
    || !Number.isFinite(rotation)) return false;

  const adx = a2x - a1x;
  const ady = a2y - a1y;
  const pdx = p2x - p1x;
  const pdy = p2y - p1y;
  const anchorLengthSq = adx * adx + ady * ady;
  if (!(anchorLengthSq > 1e-12)) return false;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotatedDx = cos * adx - sin * ady;
  const rotatedDy = sin * adx + cos * ady;
  const scale = (rotatedDx * pdx + rotatedDy * pdy) / anchorLengthSq;
  if (!(scale > 1e-12) || !Number.isFinite(scale)) return false;
  const anchorMidX = (a1x + a2x) * 0.5;
  const anchorMidY = (a1y + a2y) * 0.5;
  const pointerMidX = (p1x + p2x) * 0.5;
  const pointerMidY = (p1y + p2y) * 0.5;
  const tx = pointerMidX - scale * (cos * anchorMidX - sin * anchorMidY);
  const ty = pointerMidY - scale * (sin * anchorMidX + cos * anchorMidY);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

  output.valid = true;
  output.scale = scale;
  output.rotation = rotation;
  output.tx = tx;
  output.ty = ty;
  return true;
}

// Fixed rotation + scale least-squares translation. G★-3 uses this below the
// dolly engagement threshold so translation is still best-fit without replaying
// pre-gate span change as camera-radius motion.
export function solveGroundPlaneSimilarityAtRotationAndScale(
  a1x, a1y, a2x, a2y,
  p1x, p1y, p2x, p2y,
  rotation, scale,
  output,
) {
  if (!output) return false;
  output.valid = false;
  output.scale = 1;
  output.rotation = 0;
  output.tx = 0;
  output.ty = 0;
  if (!Number.isFinite(a1x) || !Number.isFinite(a1y)
    || !Number.isFinite(a2x) || !Number.isFinite(a2y)
    || !Number.isFinite(p1x) || !Number.isFinite(p1y)
    || !Number.isFinite(p2x) || !Number.isFinite(p2y)
    || !Number.isFinite(rotation) || !(scale > 1e-12) || !Number.isFinite(scale)) return false;

  const adx = a2x - a1x;
  const ady = a2y - a1y;
  const anchorLengthSq = adx * adx + ady * ady;
  if (!(anchorLengthSq > 1e-12)) return false;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const anchorMidX = (a1x + a2x) * 0.5;
  const anchorMidY = (a1y + a2y) * 0.5;
  const pointerMidX = (p1x + p2x) * 0.5;
  const pointerMidY = (p1y + p2y) * 0.5;
  const tx = pointerMidX - scale * (cos * anchorMidX - sin * anchorMidY);
  const ty = pointerMidY - scale * (sin * anchorMidX + cos * anchorMidY);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

  output.valid = true;
  output.scale = scale;
  output.rotation = rotation;
  output.tx = tx;
  output.ty = ty;
  return true;
}

// G★-3's pre-latch G4 classifier is direction-symmetric by construction:
// common vertical travel must dominate every differential motion. The caller
// owns all state; this pure numeric path allocates no result storage.
export function qualifyVerticalTilt(
  a1x, a1y, a2x, a2y,
  p1x, p1y, p2x, p2y,
  options,
) {
  if (!Number.isFinite(a1x) || !Number.isFinite(a1y)
    || !Number.isFinite(a2x) || !Number.isFinite(a2y)
    || !Number.isFinite(p1x) || !Number.isFinite(p1y)
    || !Number.isFinite(p2x) || !Number.isFinite(p2y)) return false;
  const verticalPx = Number.isFinite(options?.verticalPx) ? options.verticalPx : G4_MIN_VERTICAL_PX;
  const dominanceRatio = Number.isFinite(options?.dominanceRatio)
    ? options.dominanceRatio : G4_DOMINANCE_RATIO;
  if (!(verticalPx >= 0) || !(dominanceRatio >= 0)) return false;

  const move1x = p1x - a1x;
  const move1y = p1y - a1y;
  const move2x = p2x - a2x;
  const move2y = p2y - a2y;
  const meanY = (move1y + move2y) * 0.5;
  const commonVertical = Math.abs(meanY);
  if (commonVertical < verticalPx || move1y * move2y < 0) return false;

  const startDx = a2x - a1x;
  const startDy = a2y - a1y;
  const currentDx = p2x - p1x;
  const currentDy = p2y - p1y;
  const startLength = Math.hypot(startDx, startDy);
  const currentLength = Math.hypot(currentDx, currentDy);
  if (!(startLength > 1e-6) || !(currentLength > 1e-6)) return false;
  const rotation = Math.abs(wrappedAngleDelta(
    Math.atan2(currentDy, currentDx), Math.atan2(startDy, startDx),
  ));
  const allowedDifferential = commonVertical * dominanceRatio;
  const horizontalTravel = Math.max(Math.abs(move1x), Math.abs(move2x));
  const verticalMismatch = Math.abs(move1y - move2y);
  const spanChange = Math.abs(currentLength - startLength);
  const rotationTravel = startLength * Math.abs(Math.sin(rotation));
  return horizontalTravel <= allowedDifferential
    && verticalMismatch <= allowedDifferential
    && spanChange <= allowedDifferential
    && rotationTravel <= allowedDifferential;
}

// Positive pinch log means fingers separated (zoom in), so the radius factor
// is below one. Negating the same input produces the exact reciprocal factor.
export function pinchRadiusFactor(pinchLog, gain = 1) {
  if (!Number.isFinite(pinchLog) || !Number.isFinite(gain)) return 1;
  return Math.exp(-pinchLog * gain);
}

export function clampZUpPolar(polar, minPolar = 0, maxPolar = Math.PI, eps = GESTURE_POLE_EPS) {
  const min = Number.isFinite(minPolar) ? minPolar : 0;
  const max = Number.isFinite(maxPolar) && maxPolar > min ? maxPolar : Math.PI;
  const margin = Number.isFinite(eps) && eps >= 0 ? eps : GESTURE_POLE_EPS;
  const lower = min + margin;
  const upper = Math.max(lower, max - margin);
  if (!Number.isFinite(polar)) return lower;
  return Math.max(lower, Math.min(upper, polar));
}

export function decayVelocity(velocity, elapsedMs) {
  if (!Number.isFinite(velocity) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return velocity * Math.pow(MOMENTUM_FRAME_DECAY, elapsedMs / MOMENTUM_FRAME_MS);
}
