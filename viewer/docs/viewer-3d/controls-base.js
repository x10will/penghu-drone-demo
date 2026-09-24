// SML base-stage controls: WASD + QE fly, Ctrl-modal rotate,
// drag-the-world pan. Ported from main.js to keep parity with the
// scenario viewer per three-viewer-controls R1/R2/R6.
//
// Public API:
//   installControls({ camera, controls, renderer, getTerrainSampler,
//                     raycastTerrainAt }): { applyWASD, computeWasdSpeed }
//
// The viewer must call applyWASD() each animation frame. WASD speed
// scales with height above terrain (clamp(h * 0.02, 5, 200) m/frame).
//
// Behavior contract is enforced by tests/test_base_viewer_tdd_sweep.spec.js
// B1 (W moves camera) and B2 (speed scales with altitude).

import * as THREE from 'three';
import { heightAboveFloor, zoomSpeedForHeight, rotateScaleForHeight } from '../viewer-common/nav-sensitivity.mjs';
import { installMobileGestureController } from './mobile-gesture-controller.js';

const WASD_SPEED_FACTOR = 0.01;
const WASD_SPEED_MIN = 2.5;
const WASD_SPEED_MAX = 100;

export function installControls({
  camera, controls, renderer, getTerrainSampler, raycastTerrainAt,
}) {
  // ── Distance-to-floor nav sensitivity (viewer-mobile-controls A; parity
  // with main.js — sibling semantics). Capture-phase refresh of zoomSpeed /
  // rotateSpeed before OrbitControls' own handlers, so wheel + pinch steps
  // track height above terrain instead of camera→target radius.
  function navHeightAboveFloor() {
    const sampler = getTerrainSampler();
    const groundZ = sampler ? sampler(camera.position.x, camera.position.y) : NaN;
    return heightAboveFloor({
      cameraZ: camera.position.z,
      terrainZ: groundZ,
      targetDistance: camera.position.distanceTo(controls.target),
      fallbackFloorZ: window.DT_SITE.cameraTargetZ,
    });
  }
  function applyNavSensitivity() {
    const r = camera.position.distanceTo(controls.target);
    const h = navHeightAboveFloor();
    controls.zoomSpeed = zoomSpeedForHeight(h, r);
    controls.rotateSpeed = rotateScaleForHeight(h, r);
  }
  renderer.domElement.addEventListener('wheel', applyNavSensitivity, { capture: true, passive: true });
  // ── R1: WASD + QE ────────────────────────────────────────────
  const moveState = { w: false, a: false, s: false, d: false, q: false, e: false };

  function computeWasdSpeed() {
    const sampler = getTerrainSampler();
    const groundZ = sampler ? sampler(camera.position.x, camera.position.y) : 0;
    const h = camera.position.z - (Number.isFinite(groundZ) ? groundZ : 0);
    return Math.max(WASD_SPEED_MIN, Math.min(WASD_SPEED_MAX, h * WASD_SPEED_FACTOR));
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k in moveState) { moveState[k] = true; e.preventDefault(); }
  });
  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in moveState) moveState[k] = false;
  });

  function applyWASD() {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.z = 0;
    if (forward.lengthSq() === 0) return;
    forward.normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();
    const delta = new THREE.Vector3();
    if (moveState.w) delta.add(forward);
    if (moveState.s) delta.sub(forward);
    if (moveState.d) delta.add(right);
    if (moveState.a) delta.sub(right);
    if (moveState.e) delta.z += 1;
    if (moveState.q) delta.z -= 1;
    if (delta.lengthSq() > 0) {
      delta.normalize().multiplyScalar(computeWasdSpeed());
      camera.position.add(delta);
      controls.target.add(delta);
    }
  }

  // ── R2: Ctrl-modal rotate ────────────────────────────────────
  let ctrlModalActive = false;
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Control' || e.key === 'Meta') && !ctrlModalActive) {
      ctrlModalActive = true;
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Meta') {
      ctrlModalActive = false;
      controls.mouseButtons.LEFT = -1;
    }
  });

  // Anchor-pinned rotation. At mousedown the cursor's terrain hit is
  // captured as a world-fixed anchor at radius R₀. On each mousemove
  // the camera orbits the anchor on the sphere of radius R₀ (radius
  // preserved). Then a virtual look-at target T is solved iteratively
  // such that `camera.lookAt(T)` projects the anchor to the cursor's
  // current screen NDC. Net: the clicked world point stays pinned
  // under the cursor and camera-to-anchor distance is unchanged
  // throughout the drag. Sky click (raycast miss) falls through to
  // OrbitControls' default rotation around the previous target.
  let ctrlGesture = null;
  const _gOffset = new THREE.Vector3();
  const _gSpherical = new THREE.Spherical();
  const _gRight = new THREE.Vector3();
  const _gUpCam = new THREE.Vector3();
  const _gProjected = new THREE.Vector3();
  const ROTATE_SPEED = 1.0;
  const PIN_ITERATIONS = 5;
  const PIN_NDC_TOLERANCE = 1e-3;

  function solveLookAtTargetForCursorPin(anchor, cursorNdcX, cursorNdcY) {
    const T = anchor.clone();
    const halfV = camera.fov * Math.PI / 360;
    const tanHalfV = Math.tan(halfV);
    for (let i = 0; i < PIN_ITERATIONS; i++) {
      camera.lookAt(T);
      camera.updateMatrixWorld(true);
      _gProjected.copy(anchor).project(camera);
      const dxNdc = cursorNdcX - _gProjected.x;
      const dyNdc = cursorNdcY - _gProjected.y;
      if (Math.abs(dxNdc) < PIN_NDC_TOLERANCE && Math.abs(dyNdc) < PIN_NDC_TOLERANCE) break;
      const depth = T.distanceTo(camera.position);
      _gRight.setFromMatrixColumn(camera.matrix, 0);
      _gUpCam.setFromMatrixColumn(camera.matrix, 1);
      const dWorldX = -dxNdc * depth * tanHalfV * camera.aspect;
      const dWorldY = -dyNdc * depth * tanHalfV;
      T.addScaledVector(_gRight, dWorldX);
      T.addScaledVector(_gUpCam, dWorldY);
    }
    return T;
  }

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
    const hit = raycastTerrainAt(e.clientX, e.clientY);
    if (!hit || !hit.point) return;
    const anchor = hit.point.clone();
    ctrlGesture = {
      anchor,
      radius: camera.position.distanceTo(anchor),
      lastX: e.clientX,
      lastY: e.clientY,
    };
    controls.enableRotate = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (!ctrlGesture) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const dx = e.clientX - ctrlGesture.lastX;
    const dy = e.clientY - ctrlGesture.lastY;
    ctrlGesture.lastX = e.clientX;
    ctrlGesture.lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    const anchor = ctrlGesture.anchor;
    // Distance-to-floor pivot rate (parity with main.js applyCtrlGestureMove).
    const rotScale = rotateScaleForHeight(navHeightAboveFloor(), ctrlGesture.radius);
    const azDelta = (2 * Math.PI * dx / rect.height) * ROTATE_SPEED * rotScale;
    const polDelta = (2 * Math.PI * dy / rect.height) * ROTATE_SPEED * rotScale;
    _gOffset.copy(camera.position).sub(anchor);
    _gSpherical.setFromVector3(_gOffset);
    _gSpherical.theta -= azDelta;
    _gSpherical.phi -= polDelta;
    const minPol = controls.minPolarAngle ?? 0;
    const maxPol = controls.maxPolarAngle ?? Math.PI;
    _gSpherical.phi = Math.max(minPol + 1e-3, Math.min(maxPol - 1e-3, _gSpherical.phi));
    _gOffset.setFromSpherical(_gSpherical);
    _gOffset.setLength(ctrlGesture.radius);
    camera.position.copy(anchor).add(_gOffset);
    const cursorNdcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const cursorNdcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const T = solveLookAtTargetForCursorPin(anchor, cursorNdcX, cursorNdcY);
    controls.target.copy(T);
    camera.lookAt(T);
    camera.updateMatrixWorld(true);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !ctrlGesture) return;
    ctrlGesture = null;
    controls.enableRotate = true;
  });

  const getCtrlGestureAnchor = () => (ctrlGesture ? ctrlGesture.anchor.clone() : null);

  // ── R6: drag-the-world pan ───────────────────────────────────
  let panAnchor = null;
  function startDragTheWorld(clientX, clientY) {
    const hit = raycastTerrainAt(clientX, clientY);
    if (!hit || !hit.point) return;
    panAnchor = {
      anchorPoint: hit.point.clone(),
      cameraStart: camera.position.clone(),
      targetStart: controls.target.clone(),
    };
  }
  function applyDragTheWorld(clientX, clientY) {
    if (!panAnchor) return;
    camera.position.copy(panAnchor.cameraStart);
    controls.target.copy(panAnchor.targetStart);
    camera.updateMatrixWorld(true);
    const anchorNdc = panAnchor.anchorPoint.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const cursorWorld = new THREE.Vector3(ndcX, ndcY, anchorNdc.z).unproject(camera);
    const delta = panAnchor.anchorPoint.clone().sub(cursorWorld);
    camera.position.copy(panAnchor.cameraStart).add(delta);
    controls.target.copy(panAnchor.targetStart).add(delta);
    camera.updateMatrixWorld(true);
  }
  function endDragTheWorld() { panAnchor = null; }

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    startDragTheWorld(e.clientX, e.clientY);
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (panAnchor) applyDragTheWorld(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) endDragTheWorld();
  });

  // ── Shared coarse-pointer controller ──────────────────────────
  // The base viewer keeps its existing pointer-up inspector route. Allowing
  // accepted touch events to propagate lets that route remain the sole picker;
  // OrbitControls still cannot write because both touch actions are no-op.
  const touchRaycaster = new THREE.Raycaster();
  const touchNdc = new THREE.Vector2();
  function raycastTerrainAnchorAt(clientX, clientY, out, rectLeft, rectTop, rectWidth, rectHeight) {
    const sampler = getTerrainSampler();
    if (!sampler) return false;
    if (!(Number.isFinite(rectLeft) && Number.isFinite(rectTop)
      && Number.isFinite(rectWidth) && rectWidth > 0
      && Number.isFinite(rectHeight) && rectHeight > 0)) {
      return false;
    }
    touchNdc.set(
      ((clientX - rectLeft) / rectWidth) * 2 - 1,
      -((clientY - rectTop) / rectHeight) * 2 + 1,
    );
    camera.updateMatrixWorld(true);
    touchRaycaster.setFromCamera(touchNdc, camera);
    const origin = touchRaycaster.ray.origin;
    const direction = touchRaycaster.ray.direction;
    let t = 0;
    let previousT = 0;
    let previousGap = origin.z - sampler(origin.x, origin.y);
    if (!Number.isFinite(previousGap) || previousGap <= 0) return false;
    for (let i = 0; i < 6000 && t < (window.DT_SITE.terrainRayMaxDistance ?? 40000); i++) {
      const step = Math.max(2, Math.min(0.5 * previousGap, 150));
      const nextT = t + step;
      const gap = (origin.z + direction.z * nextT)
        - sampler(origin.x + direction.x * nextT, origin.y + direction.y * nextT);
      if (gap <= 0) {
        let low = previousT;
        let high = nextT;
        for (let b = 0; b < 22; b++) {
          const middle = (low + high) * 0.5;
          const middleGap = (origin.z + direction.z * middle)
            - sampler(origin.x + direction.x * middle, origin.y + direction.y * middle);
          if (middleGap > 0) low = middle; else high = middle;
        }
        const hitT = (low + high) * 0.5;
        out.set(
          origin.x + direction.x * hitT,
          origin.y + direction.y * hitT,
          origin.z + direction.z * hitT,
        );
        return true;
      }
      previousGap = gap;
      previousT = nextT;
      t = nextT;
    }
    return false;
  }
  function raycastTargetPlaneAnchorAt(clientX, clientY, targetZ, out, rectLeft, rectTop, rectWidth, rectHeight) {
    if (!(Number.isFinite(rectLeft) && Number.isFinite(rectTop)
      && Number.isFinite(rectWidth) && rectWidth > 0
      && Number.isFinite(rectHeight) && rectHeight > 0)) {
      return false;
    }
    touchNdc.set(
      ((clientX - rectLeft) / rectWidth) * 2 - 1,
      -((clientY - rectTop) / rectHeight) * 2 + 1,
    );
    camera.updateMatrixWorld(true);
    touchRaycaster.setFromCamera(touchNdc, camera);
    const { origin, direction } = touchRaycaster.ray;
    if (!Number.isFinite(direction.z) || Math.abs(direction.z) < 1e-9) return false;
    const distance = (targetZ - origin.z) / direction.z;
    if (!Number.isFinite(distance) || distance <= 0) return false;
    out.copy(origin).addScaledVector(direction, distance);
    return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
  }

  const mobileGestures = installMobileGestureController({
    element: renderer.domElement,
    coarsePointerQuery: window.matchMedia('(pointer: coarse)'),
    camera,
    controls,
    three: THREE,
    raycastTerrainAt: raycastTerrainAnchorAt,
    raycastTargetPlaneAt: raycastTargetPlaneAnchorAt,
    navHeightAboveFloor,
    pauseFollow: () => {},
    flyAnimationActive: () => false,
    pickAt: () => {},
    suppressCompatibilityClick: () => {},
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    allowTouchEventPropagation: true,
  });

  const orbitUpdate = controls.update.bind(controls);
  controls.update = function updateWithoutTouchCompetition() {
    if (mobileGestures.ownsCamera()) return false;
    return orbitUpdate();
  };

  return { applyWASD, computeWasdSpeed, getCtrlGestureAnchor, mobileGestures };
}
