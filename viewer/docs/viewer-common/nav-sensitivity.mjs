// Distance-to-floor navigation sensitivity (viewer-mobile-controls).
// PURE functions — NO Three.js, DOM, camera, or fetch (viewer-engine-policy:
// shared logic lives under viewer-common/). Node-tested by
// tests/viewer/test_nav_sensitivity.mjs.
//
// Problem: OrbitControls' dolly step scales with the camera→target radius r
// (one wheel tick moves the camera by r·(1−0.95^zoomSpeed)), but the target
// usually parks at lake level / the last anchor — so steps near the ground are
// far too big. These laws re-derive the per-event zoomSpeed / rotateSpeed so
// the EFFECTIVE step tracks the camera's height above the terrain floor h
// instead of r. Same exponent drives OrbitControls' pinch
// (Math.pow(dist/prevDist, zoomSpeed)), so one modulation fixes wheel + pinch.

export const NAV_MIN_HEIGHT_M = 5;      // h floor so the step never reaches 0
export const ZOOM_DOLLY_BASE = 0.95;    // OrbitControls' internal dolly base
export const ZOOM_SPEED_MIN = 0.05;
export const ZOOM_SPEED_MAX = 3;
export const ROTATE_SCALE_MIN = 0.1;
export const ROTATE_SCALE_MAX = 1;
// One camera-distance envelope for desktop controls and owned mobile pinch.
// It stays below the existing 50 km camera far plane while restoring the
// full-lake overview requested by the C6 device feedback.
export const CAMERA_MAX_DISTANCE = 40000;

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Height above the navigation floor, with the fallback chain:
//   1. cameraZ − terrainZ            (terrain sampler hit — primary, any site)
//   2. targetDistance                (sampler NaN — e.g. over water, outside hull)
//   3. cameraZ − fallbackFloorZ      (no usable target distance either; callers
//                                     pass their site's camera floor, e.g.
//                                     DT_SITE.cameraTargetZ — never read here)
// floored to minHeight so the result is always a positive step scale.
export function heightAboveFloor({
  cameraZ, terrainZ, targetDistance, fallbackFloorZ = 0, minHeight = NAV_MIN_HEIGHT_M,
} = {}) {
  let h;
  if (Number.isFinite(terrainZ) && Number.isFinite(cameraZ)) {
    h = cameraZ - terrainZ;
  } else if (Number.isFinite(targetDistance) && targetDistance > 0) {
    h = targetDistance;
  } else if (Number.isFinite(cameraZ)) {
    h = cameraZ - fallbackFloorZ;
  } else {
    h = minHeight;
  }
  return Math.max(minHeight, h);
}

// zoomSpeed such that OrbitControls' radius step r·(1−base^zoomSpeed) equals
// the height-proportional step h·(1−base):
//   zoomSpeed = log(1 − (h/r)·(1−base)) / log(base)
// (h = r ⇒ exactly 1, the stock behavior). Clamped to [min, max]; degenerate
// inputs return the stock 1.
export function zoomSpeedForHeight(h, r, {
  base = ZOOM_DOLLY_BASE, min = ZOOM_SPEED_MIN, max = ZOOM_SPEED_MAX,
} = {}) {
  if (!Number.isFinite(h) || !Number.isFinite(r) || h <= 0 || r <= 0) return 1;
  const arg = 1 - (h / r) * (1 - base);
  if (arg <= 0) return max;               // h ≫ r: full-throttle, clamp wins anyway
  return _clamp(Math.log(arg) / Math.log(base), min, max);
}

// Rotation-rate scale for anchored pivots / touch rotate: full speed when the
// camera is at least the orbit radius above the floor, proportionally gentler
// as it descends (pivoting zoomed-in close stays controllable).
export function rotateScaleForHeight(h, r, {
  min = ROTATE_SCALE_MIN, max = ROTATE_SCALE_MAX,
} = {}) {
  if (!Number.isFinite(h) || !Number.isFinite(r) || h <= 0 || r <= 0) return 1;
  return _clamp(h / r, min, max);
}

// Default polar clamp margin (radians): keep the camera off the pole so the orbit
// never degenerates to a zero-length offset (mirrors applyCtrlGestureMove's 1e-3).
export const ORBIT_POLE_EPS = 1e-3;

// Orbit a Z-up camera around a fixed target by (dAz, dPol) radians — the pure math
// behind the on-screen rotate/tilt buttons (viewer-mobile-controls). The scene is
// Z-up (camera.up = +Z), so azimuth is measured about +Z and polar FROM +Z; doing
// the spherical math in that frame (NOT THREE.Spherical, whose polar axis is +Y)
// is what keeps a tilt from flinging the camera through the pole — the exact bug
// applyCtrlGestureMove documents. `dAz` rotates (subtracted, so +dAz spins one
// way); `dPol` tilts, clamped to [minPol+eps, maxPol−eps] so the camera stays
// above the target. Radius is preserved. Returns `[x, y, z]`; degenerate inputs
// (target coincident with camera) return the camera position unchanged.
export function orbitPosition(cam, target, dAz, dPol, {
  minPol = 0, maxPol = Math.PI, eps = ORBIT_POLE_EPS,
} = {}) {
  const ox = cam[0] - target[0], oy = cam[1] - target[1], oz = cam[2] - target[2];
  const r = Math.hypot(ox, oy, oz);
  if (!(r > 0) || !Number.isFinite(r)) return [cam[0], cam[1], cam[2]];
  let az = Math.atan2(oy, ox);
  let pol = Math.acos(_clamp(oz / r, -1, 1));
  az -= dAz;
  pol = _clamp(pol - dPol, minPol + eps, maxPol - eps);
  const sinPol = Math.sin(pol);
  return [
    target[0] + r * sinPol * Math.cos(az),
    target[1] + r * sinPol * Math.sin(az),
    target[2] + r * Math.cos(pol),
  ];
}
