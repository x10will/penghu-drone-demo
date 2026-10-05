import {
  applyDeadZone,
  clampZUpPolar,
  dollyEngageLogForSpan,
  decayVelocity,
  DOLLY_ENGAGE_LOG,
  pinchRadiusFactor,
  qualifyVerticalTilt,
  solveGroundPlaneSimilarity,
  solveGroundPlaneSimilarityAtRotation,
  solveGroundPlaneSimilarityAtRotationAndScale,
  ROTATE_ENGAGE_DEG,
  wrappedAngleDelta,
} from '../viewer-common/mobile-gesture-math.mjs';
import { zoomSpeedForHeight } from '../viewer-common/nav-sensitivity.mjs';

const NO_ACTION = -1;
const TAP_MOVE_PX = 8;
const TAP_DELAY_MS = 350;
const DOUBLE_TAP_RADIUS_PX = 40;
const TWO_FINGER_TAP_MS = 250;
const STEP_ZOOM_MS = 250;
const ONE_HAND_ZOOM_LOG_PER_PX = 0.006;
const MOMENTUM_CUTOFF = 0.05;
const TILT_RADIANS_PER_PX = Math.PI / 720;

// This controller is deliberately the only coarse-pointer camera writer. All
// vectors and pointer slots are allocated at install time so pointermove and
// momentum frames only mutate existing numeric/vector storage.
class MobileGestureController {
  constructor(options) {
    this.element = options.element;
    this.coarsePointerQuery = options.coarsePointerQuery;
    this.camera = options.camera;
    this.controls = options.controls;
    this.three = options.three;
    this.raycastTerrainAt = options.raycastTerrainAt;
    this.raycastTargetPlaneAt = options.raycastTargetPlaneAt;
    this.navHeightAboveFloor = options.navHeightAboveFloor;
    this.pauseFollow = options.pauseFollow;
    this.flyAnimationActive = options.flyAnimationActive;
    this.pickAt = options.pickAt;
    this.suppressCompatibilityClick = options.suppressCompatibilityClick;
    this.prefersReducedMotion = options.prefersReducedMotion;
    this.allowTouchEventPropagation = options.allowTouchEventPropagation === true;

    this.pointerA = { id: -1, x: 0, y: 0, startX: 0, startY: 0 };
    this.pointerB = { id: -1, x: 0, y: 0, startX: 0, startY: 0 };
    const Vector3 = this.three.Vector3;
    this.scratch = {
      anchor: new Vector3(),
      anchorA: new Vector3(),
      anchorB: new Vector3(),
      tiltAnchor: new Vector3(),
      constraintAnchor: new Vector3(),
      cameraStart: new Vector3(),
      targetStart: new Vector3(),
      projected: new Vector3(),
      cursorWorld: new Vector3(),
      delta: new Vector3(),
      target: new Vector3(),
      right: new Vector3(),
      up: new Vector3(),
      momentum: new Vector3(),
      stepStartTarget: new Vector3(),
      stepEndTarget: new Vector3(),
      stepOffset: new Vector3(),
      actionAnchor: new Vector3(),
    };
    this.twoSimilarity = { valid: false, scale: 1, rotation: 0, tx: 0, ty: 0 };
    this.tiltOptions = { verticalPx: 24, dominanceRatio: 0.35 };
    this.constraintParams = new Float64Array(4);
    this.constraintProjection = new Float64Array(4);
    this.constraintPerturbation = new Float64Array(4);
    this.constraintStep = new Float64Array(4);
    this.constraintMatrix = new Float64Array(20);
    this.constraintNormal = new Float64Array(12);
    this.samplesT = new Float64Array(4);
    this.samplesX = new Float64Array(4);
    this.samplesY = new Float64Array(4);
    this.samplesZ = new Float64Array(4);
    this.sampleIndex = 0;
    this.sampleCount = 0;

    this.active = false;
    this.phase = 'idle';
    this.hasAnchor = false;
    this.anchorSource = 'none';
    this.anchorResolveCount = 0;
    this.rectLeft = 0;
    this.rectTop = 0;
    this.rectWidth = 1;
    this.rectHeight = 1;
    this.oneStartRadius = 0;
    this.twoStartDistance = 0;
    this.twoStartAngle = 0;
    this.twoStartMeanY = 0;
    this.twoStartRadius = 0;
    this.twoStartAzimuth = 0;
    this.twoStartPolar = 0;
    this.twoStartHeight = 0;
    this.twoStartAX = 0;
    this.twoStartAY = 0;
    this.twoStartBX = 0;
    this.twoStartBY = 0;
    this.twoRotationEngaged = false;
    this.twoRotationGateRadians = 0;
    this.twoRotationGateInputRadians = 0;
    this.twoRotationEngageAppliedRadians = 0;
    this.twoRotationCumulativeRadians = 0;
    this.twoRotationAppliedRadians = 0;
    this.twoRotationInputOffsetRadians = 0;
    this.twoDollyEngaged = false;
    this.twoDollyGateScaleLog = 0;
    this.twoDollyGateInputLog = 0;
    this.twoDollyEngageAppliedLog = 0;
    this.twoDollyEngageLog = DOLLY_ENGAGE_LOG;
    this.twoDollyCumulativeLog = 0;
    this.twoDollyAppliedLog = 0;
    this.tiltStartMeanY = 0;
    this.tiltStartRadius = 0;
    this.tiltStartAzimuth = 0;
    this.tiltStartPolar = 0;
    this.tiltActive = false;
    this.tiltQualified = false;
    this.pitchReferencePolar = 0;
    this.tapCandidate = false;
    this.suppressTapForSequence = false;
    this.firstPointerDownTime = 0;
    this.secondTapCandidate = false;
    this.secondTapStartY = 0;
    this.twoTapCandidate = false;
    this.twoTapStartTime = 0;
    this.oneHandStartRadius = 0;
    this.oneHandStartAzimuth = 0;
    this.oneHandStartPolar = 0;
    this.oneHandZoomScale = 1;
    this.pendingTap = false;
    this.pendingTapX = 0;
    this.pendingTapY = 0;
    this.pendingTapTimer = 0;
    this.pendingTapQueuedAt = 0;
    this.pickCount = 0;
    this.g5Count = 0;
    this.g6Count = 0;
    this.g7Count = 0;
    this.momentumRaf = 0;
    this.twoMoveRaf = 0;
    this.momentumLast = 0;
    this.stepZoomRaf = 0;
    this.stepZoomStart = 0;
    this.stepStartRadius = 0;
    this.stepEndRadius = 0;

    this.originalOne = this.controls.touches.ONE;
    this.originalTwo = this.controls.touches.TWO;
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onLostPointerCapture = this.onLostPointerCapture.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onMediaChange = this.onMediaChange.bind(this);
    this.onViewportGeometryChange = this.onViewportGeometryChange.bind(this);
    this.dispatchPendingTap = this.dispatchPendingTap.bind(this);
    this.runMomentumFrame = this.runMomentumFrame.bind(this);
    this.runTwoMoveFrame = this.runTwoMoveFrame.bind(this);
    this.runStepZoomFrame = this.runStepZoomFrame.bind(this);
    this.capturePitchReference();
  }

  install() {
    this.element.addEventListener('pointerdown', this.onPointerDown, true);
    this.element.addEventListener('pointermove', this.onPointerMove, true);
    this.element.addEventListener('pointerup', this.onPointerUp, true);
    this.element.addEventListener('pointercancel', this.onPointerCancel, true);
    this.element.addEventListener('lostpointercapture', this.onLostPointerCapture, true);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.coarsePointerQuery.addEventListener('change', this.onMediaChange);
    window.addEventListener('resize', this.onViewportGeometryChange, { passive: true });
    window.addEventListener('orientationchange', this.onViewportGeometryChange, { passive: true });
    window.visualViewport?.addEventListener('resize', this.onViewportGeometryChange, { passive: true });
    this.setActive(this.coarsePointerQuery.matches);
    return this;
  }

  destroy() {
    this.cancel();
    this.element.removeEventListener('pointerdown', this.onPointerDown, true);
    this.element.removeEventListener('pointermove', this.onPointerMove, true);
    this.element.removeEventListener('pointerup', this.onPointerUp, true);
    this.element.removeEventListener('pointercancel', this.onPointerCancel, true);
    this.element.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.coarsePointerQuery.removeEventListener('change', this.onMediaChange);
    window.removeEventListener('resize', this.onViewportGeometryChange);
    window.removeEventListener('orientationchange', this.onViewportGeometryChange);
    window.visualViewport?.removeEventListener('resize', this.onViewportGeometryChange);
    this.setActive(false);
  }

  snapshot() {
    return {
      active: this.active,
      phase: this.phase,
      pointerCount: this.pointerCount(),
      pointerAId: this.pointerA.id,
      pointerBId: this.pointerB.id,
      anchor: this.hasAnchor ? {
        x: this.scratch.anchor.x,
        y: this.scratch.anchor.y,
        z: this.scratch.anchor.z,
      } : null,
      anchorSource: this.anchorSource,
      anchorResolveCount: this.anchorResolveCount,
      anchors: this.pointerCount() === 2 ? [
        { x: this.scratch.anchorA.x, y: this.scratch.anchorA.y, z: this.scratch.anchorA.z },
        { x: this.scratch.anchorB.x, y: this.scratch.anchorB.y, z: this.scratch.anchorB.z },
      ] : null,
      tiltActive: this.tiltActive,
      tiltQualified: this.tiltQualified,
      pitchReferencePolar: this.pitchReferencePolar,
      pitchDelta: this.currentPitchDelta(),
      rotationEngaged: this.twoRotationEngaged,
      rotationEngageDeg: ROTATE_ENGAGE_DEG,
      rotationCumulativeDeg: this.twoRotationCumulativeRadians * 180 / Math.PI,
      rotationGateInputDeg: this.twoRotationGateInputRadians * 180 / Math.PI,
      rotationEngageAppliedDeg: this.twoRotationEngageAppliedRadians * 180 / Math.PI,
      rotationAppliedDeg: this.twoRotationAppliedRadians * 180 / Math.PI,
      dollyEngaged: this.twoDollyEngaged,
      dollyEngageLog: this.twoDollyEngageLog,
      dollyCumulativeLog: this.twoDollyCumulativeLog,
      dollyGateInputLog: this.twoDollyGateInputLog,
      dollyAppliedLog: this.twoDollyAppliedLog,
      tiltInputs: {
        startA: { x: this.twoStartAX, y: this.twoStartAY },
        startB: { x: this.twoStartBX, y: this.twoStartBY },
        liveA: { x: this.pointerA.x, y: this.pointerA.y },
        liveB: { x: this.pointerB.x, y: this.pointerB.y },
      },
      tiltAnchor: this.tiltActive ? {
        x: this.scratch.tiltAnchor.x,
        y: this.scratch.tiltAnchor.y,
        z: this.scratch.tiltAnchor.z,
      } : null,
      momentumActive: this.momentumRaf !== 0,
      momentumRaf: this.momentumRaf,
      twoMoveRaf: this.twoMoveRaf,
      momentumSpeed: this.scratch.momentum.length(),
      pendingTap: this.pendingTap,
      pickCount: this.pickCount,
      g5Count: this.g5Count,
      g6Count: this.g6Count,
      g7Count: this.g7Count,
      stepZoomActive: this.stepZoomRaf !== 0,
      stepZoomRaf: this.stepZoomRaf,
    };
  }

  ownsCamera() {
    return this.active && this.phase !== 'idle';
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.controls.touches.ONE = NO_ACTION;
      this.controls.touches.TWO = NO_ACTION;
      return;
    }
    this.cancel();
    this.controls.touches.ONE = this.originalOne;
    this.controls.touches.TWO = this.originalTwo;
  }

  onMediaChange(event) {
    this.setActive(event.matches);
  }

  onVisibilityChange() {
    if (document.hidden) this.cancel();
  }

  onViewportGeometryChange() {
    this.captureRect();
  }

  currentCameraPolar() {
    const dx = this.camera.position.x - this.controls.target.x;
    const dy = this.camera.position.y - this.controls.target.y;
    const dz = this.camera.position.z - this.controls.target.z;
    const radius = Math.hypot(dx, dy, dz);
    return radius > 0 && Number.isFinite(radius)
      ? Math.acos(Math.max(-1, Math.min(1, dz / radius)))
      : 0;
  }

  capturePitchReference() {
    this.pitchReferencePolar = this.currentCameraPolar();
  }

  currentPitchDelta() {
    return this.currentCameraPolar() - this.pitchReferencePolar;
  }

  claimEvent(event) {
    event.preventDefault();
    if (!this.allowTouchEventPropagation) event.stopImmediatePropagation();
  }

  onPointerDown(event) {
    if (!this.active || event.pointerType !== 'touch') return;
    this.stopMomentum();
    this.stopStepZoom();
    const now = performance.now();
    let isSecondTap = false;
    if (this.pendingTap) {
      clearTimeout(this.pendingTapTimer);
      this.pendingTapTimer = 0;
      const nearby = Math.hypot(event.clientX - this.pendingTapX, event.clientY - this.pendingTapY)
        <= DOUBLE_TAP_RADIUS_PX;
      isSecondTap = nearby && now - this.pendingTapQueuedAt <= TAP_DELAY_MS;
      if (isSecondTap) {
        this.pendingTap = false;
        this.suppressTapForSequence = true;
      } else {
        this.dispatchPendingTap();
        this.suppressTapForSequence = false;
      }
    }
    if (this.flyAnimationActive()) {
      this.claimEvent(event);
      return;
    }
    const pointer = this.freePointerSlot();
    if (!pointer) return;
    pointer.id = event.pointerId;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    try { this.element.setPointerCapture(event.pointerId); } catch { /* CDP/browser may release first */ }
    this.claimEvent(event);

    if (this.pointerCount() === 1) {
      // This is the only pointer-driven geometry read: cache one rect for the
      // complete contact sequence, including 1→2, G4 enter/leave, and 2→1.
      this.captureRect();
      this.firstPointerDownTime = now;
      this.secondTapCandidate = isSecondTap;
      this.secondTapStartY = event.clientY;
      this.tapCandidate = !isSecondTap && !this.suppressTapForSequence;
      this.beginOne(pointer);
      if (isSecondTap && this.hasAnchor) this.phase = 'second-tap-pending';
    } else if (this.pointerCount() === 2) {
      this.secondTapCandidate = false;
      this.tapCandidate = false;
      this.twoTapCandidate = now - this.firstPointerDownTime <= TWO_FINGER_TAP_MS;
      this.twoTapStartTime = this.firstPointerDownTime;
      this.beginTwo();
      if (this.twoTapCandidate && this.hasAnchor) this.phase = 'two-tap-pending';
    }
  }

  onPointerMove(event) {
    if (!this.active || event.pointerType !== 'touch') return;
    const pointer = this.pointerById(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    this.claimEvent(event);
    if (this.pointerCount() === 1) {
      if (this.phase === 'one-hand-zoom') {
        this.applyOneHandZoom(pointer.y);
        return;
      }
      const moved = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
      if (this.secondTapCandidate) {
        if (Math.abs(pointer.y - this.secondTapStartY) > TAP_MOVE_PX) {
          this.secondTapCandidate = false;
          this.suppressTapForSequence = true;
          if (this.beginOneHandZoom(pointer)) this.applyOneHandZoom(pointer.y);
          return;
        }
        if (moved <= TAP_MOVE_PX) return;
        this.secondTapCandidate = false;
        this.suppressTapForSequence = true;
      }
      if (this.tapCandidate && moved <= TAP_MOVE_PX) return;
      this.tapCandidate = false;
      this.applyOne(pointer.x, pointer.y);
    } else if (this.pointerCount() === 2) {
      this.tapCandidate = false;
      // G6 arbitration is independent of the G★ solver: a rendered
      // sub-tolerance solve remains a tap, while either material contact move
      // invalidates G6 before a release can cancel the pending RAF.
      if (this.twoTapCandidate && !this.twoTapWithinTolerance()) this.twoTapCandidate = false;
      if (!this.twoMoveRaf) this.twoMoveRaf = requestAnimationFrame(this.runTwoMoveFrame);
    }
  }

  onPointerUp(event) {
    if (!this.active || event.pointerType !== 'touch') return;
    const pointer = this.pointerById(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const tapX = pointer.x;
    const tapY = pointer.y;
    this.flushMaterialTwoMove();
    this.stopTwoMove();
    pointer.id = -1;
    // Every accepted pointerup changes contact count. Reset before either G6
    // arbitration return so neither G★-2 nor G★-3 survives a released contact.
    this.resetTwoGestureLatches();
    this.claimEvent(event);
    const count = this.pointerCount();
    if (count === 0) {
      if (this.phase === 'one-hand-zoom') {
        this.phase = 'idle';
        this.hasAnchor = false;
      } else if (this.secondTapCandidate && this.phase === 'second-tap-pending') {
        this.secondTapCandidate = false;
        this.g5Count++;
        this.startStepZoom(0.5);
      } else if (this.twoTapCandidate && this.phase === 'two-tap-release'
        && performance.now() - this.twoTapStartTime <= TWO_FINGER_TAP_MS) {
        this.twoTapCandidate = false;
        this.g6Count++;
        this.startStepZoom(2);
      } else if (this.phase === 'one-pan') {
        this.startMomentum();
      } else if (this.tapCandidate && !this.suppressTapForSequence) {
        this.queueTap(tapX, tapY);
      } else {
        this.phase = 'idle';
        this.hasAnchor = false;
      }
      this.tapCandidate = false;
      this.suppressTapForSequence = false;
      return;
    }
    if (this.twoTapCandidate) {
      this.phase = 'two-tap-release';
      this.tapCandidate = false;
      return;
    }
    this.tapCandidate = false;
    this.beginOne(this.pointerA.id !== -1 ? this.pointerA : this.pointerB);
  }

  onPointerCancel(event) {
    if (event.pointerType !== 'touch' || !this.pointerById(event.pointerId)) return;
    this.claimEvent(event);
    this.cancel();
  }

  onLostPointerCapture(event) {
    if (this.pointerById(event.pointerId)) this.cancel();
  }

  cancel() {
    this.stopTwoMove();
    this.stopMomentum();
    this.stopStepZoom();
    if (this.pendingTapTimer) clearTimeout(this.pendingTapTimer);
    this.pendingTapTimer = 0;
    this.pendingTap = false;
    this.pointerA.id = -1;
    this.pointerB.id = -1;
    this.phase = 'idle';
    this.hasAnchor = false;
    this.anchorSource = 'none';
    this.tapCandidate = false;
    this.suppressTapForSequence = false;
    this.secondTapCandidate = false;
    this.twoTapCandidate = false;
    this.resetTwoGestureLatches();
  }

  pointerCount() {
    return (this.pointerA.id !== -1 ? 1 : 0) + (this.pointerB.id !== -1 ? 1 : 0);
  }

  pointerById(id) {
    if (this.pointerA.id === id) return this.pointerA;
    if (this.pointerB.id === id) return this.pointerB;
    return null;
  }

  resetTwoRotationGate() {
    this.twoRotationEngaged = false;
    this.twoRotationGateRadians = 0;
    this.twoRotationGateInputRadians = 0;
    this.twoRotationEngageAppliedRadians = 0;
    this.twoRotationCumulativeRadians = 0;
    this.twoRotationAppliedRadians = 0;
    this.twoRotationInputOffsetRadians = 0;
  }

  resetTwoDollyGate() {
    this.twoDollyEngaged = false;
    this.twoDollyGateScaleLog = 0;
    this.twoDollyGateInputLog = 0;
    this.twoDollyEngageAppliedLog = 0;
    this.twoDollyEngageLog = DOLLY_ENGAGE_LOG;
    this.twoDollyCumulativeLog = 0;
    this.twoDollyAppliedLog = 0;
  }

  resetTwoGestureLatches() {
    this.tiltActive = false;
    this.tiltQualified = false;
    this.resetTwoRotationGate();
    this.resetTwoDollyGate();
  }

  freePointerSlot() {
    if (this.pointerA.id === -1) return this.pointerA;
    if (this.pointerB.id === -1) return this.pointerB;
    return null;
  }

  twoTapWithinTolerance() {
    return Math.hypot(this.pointerA.x - this.pointerA.startX, this.pointerA.y - this.pointerA.startY) <= TAP_MOVE_PX
      && Math.hypot(this.pointerB.x - this.pointerB.startX, this.pointerB.y - this.pointerB.startY) <= TAP_MOVE_PX;
  }

  beginOne(pointer) {
    if (!this.resolveAnchor(pointer.x, pointer.y)) {
      this.phase = 'idle';
      return;
    }
    this.resetTwoGestureLatches();
    const scratch = this.scratch;
    scratch.cameraStart.copy(this.camera.position);
    scratch.targetStart.copy(this.controls.target);
    this.capturePitchReference();
    this.resetSamples();
    this.recordSample(performance.now());
    this.phase = 'one-pending';
    this.pauseFollow();
  }

  beginTwo() {
    const scratch = this.scratch;
    const sourceA = this.resolveAnchorAt(this.pointerA.x, this.pointerA.y, scratch.anchorA);
    const sourceB = this.resolveAnchorAt(this.pointerB.x, this.pointerB.y, scratch.anchorB);
    if (sourceA === 'none' || sourceB === 'none') {
      this.phase = 'idle';
      this.hasAnchor = false;
      return;
    }
    scratch.anchor.copy(scratch.anchorA);
    this.hasAnchor = true;
    this.anchorSource = sourceA === sourceB ? sourceA : 'mixed';
    scratch.cameraStart.copy(this.camera.position);
    scratch.targetStart.copy(this.controls.target);
    scratch.delta.copy(this.camera.position).sub(this.controls.target);
    const radius = scratch.delta.length();
    if (!(radius > 0) || !Number.isFinite(radius)) {
      this.phase = 'idle';
      return;
    }
    // beginTwo is entered only on 1→2. G★-2/G★-3 gates and the G4 latch
    // therefore reset only with the contact-count transition.
    this.resetTwoGestureLatches();
    this.twoStartDistance = Math.hypot(this.pointerB.x - this.pointerA.x, this.pointerB.y - this.pointerA.y);
    this.twoDollyEngageLog = dollyEngageLogForSpan(this.twoStartDistance);
    this.twoStartAngle = Math.atan2(this.pointerB.y - this.pointerA.y, this.pointerB.x - this.pointerA.x);
    this.twoStartMeanY = (this.pointerA.y + this.pointerB.y) * 0.5;
    this.twoStartRadius = radius;
    this.twoStartAzimuth = Math.atan2(scratch.delta.y, scratch.delta.x);
    this.twoStartPolar = Math.acos(Math.max(-1, Math.min(1, scratch.delta.z / radius)));
    this.twoStartAX = this.pointerA.x;
    this.twoStartAY = this.pointerA.y;
    this.twoStartBX = this.pointerB.x;
    this.twoStartBY = this.pointerB.y;
    this.pitchReferencePolar = this.twoStartPolar;
    this.phase = 'two-pending';
    this.pauseFollow();
  }

  resolveAnchor(x, y) {
    const source = this.resolveAnchorAt(x, y, this.scratch.anchor);
    this.hasAnchor = source !== 'none';
    this.anchorSource = source;
    return this.hasAnchor;
  }

  resolveAnchorAt(x, y, anchor) {
    this.anchorResolveCount++;
    if (this.raycastTerrainAt(x, y, anchor,
      this.rectLeft, this.rectTop, this.rectWidth, this.rectHeight)) {
      return 'terrain';
    }
    if (this.raycastTargetPlaneAt(x, y, this.controls.target.z, anchor,
      this.rectLeft, this.rectTop, this.rectWidth, this.rectHeight)) {
      return 'target-plane';
    }
    return 'none';
  }

  captureRect() {
    const rect = this.element.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
    this.rectWidth = rect.width || 1;
    this.rectHeight = rect.height || 1;
  }

  applyOne(clientX, clientY) {
    if (!this.hasAnchor || this.phase === 'idle') return;
    const scratch = this.scratch;
    this.camera.position.copy(scratch.cameraStart);
    this.controls.target.copy(scratch.targetStart);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
    scratch.projected.copy(scratch.anchor).project(this.camera);
    const ndcX = ((clientX - this.rectLeft) / this.rectWidth) * 2 - 1;
    const ndcY = -((clientY - this.rectTop) / this.rectHeight) * 2 + 1;
    scratch.cursorWorld.set(ndcX, ndcY, scratch.projected.z).unproject(this.camera);
    scratch.delta.copy(scratch.anchor).sub(scratch.cursorWorld);
    this.camera.position.copy(scratch.cameraStart).add(scratch.delta);
    this.controls.target.copy(scratch.targetStart).add(scratch.delta);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
    this.recordSample(performance.now());
    this.phase = 'one-pan';
  }

  applyTwo() {
    if (!this.hasAnchor || this.phase === 'idle') return;
    if (this.tiltActive) {
      // G★-3: after entry, direction reversal and natural hand drift stay in
      // G4 until contact count changes. Do not hand off to the dolly solve.
      this.tiltQualified = true;
      this.applyTilt();
      return;
    }
    const solveLocked = this.twoRotationEngaged || this.twoDollyEngaged;
    const isTilt = !solveLocked && qualifyVerticalTilt(
      this.twoStartAX, this.twoStartAY, this.twoStartBX, this.twoStartBY,
      this.pointerA.x, this.pointerA.y, this.pointerB.x, this.pointerB.y,
      this.tiltOptions,
    );
    this.tiltQualified = isTilt;
    if (isTilt) {
      this.beginTilt(); // Entry captures the centroid without changing the camera.
      return;
    }
    this.applyTwoConstraint();
  }

  runTwoMoveFrame() {
    this.twoMoveRaf = 0;
    if (this.pointerCount() !== 2 || !this.active) return;
    this.applyTwo();
  }

  flushMaterialTwoMove() {
    if (!this.twoMoveRaf || this.twoTapCandidate) return;
    cancelAnimationFrame(this.twoMoveRaf);
    this.twoMoveRaf = 0;
    if (this.pointerCount() === 2 && this.active) this.applyTwo();
  }

  stopTwoMove() {
    if (this.twoMoveRaf) cancelAnimationFrame(this.twoMoveRaf);
    this.twoMoveRaf = 0;
  }

  applyTwoConstraint() {
    const scratch = this.scratch;
    // Live contact rays are evaluated from the immutable two-finger phase pose
    // against one horizontal target plane. Captured terrain anchors are never
    // raycast again during this phase.
    this.camera.position.copy(scratch.cameraStart);
    this.controls.target.copy(scratch.targetStart);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
    if (!this.raycastTargetPlaneAt(this.pointerA.x, this.pointerA.y, scratch.targetStart.z, scratch.cursorWorld,
      this.rectLeft, this.rectTop, this.rectWidth, this.rectHeight)
      || !this.raycastTargetPlaneAt(this.pointerB.x, this.pointerB.y, scratch.targetStart.z, scratch.target,
        this.rectLeft, this.rectTop, this.rectWidth, this.rectHeight)) return;
    if (!solveGroundPlaneSimilarity(
      scratch.anchorA.x, scratch.anchorA.y, scratch.anchorB.x, scratch.anchorB.y,
      scratch.cursorWorld.x, scratch.cursorWorld.y, scratch.target.x, scratch.target.y,
      this.twoSimilarity,
    )) return;

    const similarity = this.twoSimilarity;
    const fullRotation = similarity.rotation;
    const livePointerAngle = Math.atan2(
      this.pointerB.y - this.pointerA.y,
      this.pointerB.x - this.pointerA.x,
    );
    const cumulativeInputRotation = this.twoRotationInputOffsetRadians
      + wrappedAngleDelta(livePointerAngle, this.twoStartAngle);
    this.twoRotationCumulativeRadians = cumulativeInputRotation;
    let constrainedRotation = fullRotation;
    if (!this.twoRotationEngaged) {
      if (Math.abs(cumulativeInputRotation) >= ROTATE_ENGAGE_DEG * Math.PI / 180) {
        // The threshold frame itself retains the locked pose. Subsequent
        // samples apply only twist accrued after this frame, so pre-gate
        // jitter can never replay as a visible heading jump.
        this.twoRotationEngaged = true;
        this.twoRotationGateRadians = fullRotation;
        this.twoRotationGateInputRadians = cumulativeInputRotation;
        // The first applied yaw is only input movement past the engagement
        // boundary. This removes the last rotational residual without replaying
        // the gated pre-threshold twist as a heading jump.
        const engageThreshold = ROTATE_ENGAGE_DEG * Math.PI / 180;
        const excessRatio = (Math.abs(cumulativeInputRotation) - engageThreshold)
          / Math.abs(cumulativeInputRotation);
        this.twoRotationEngageAppliedRadians = fullRotation * excessRatio;
        constrainedRotation = this.twoRotationEngageAppliedRadians;
      } else {
        constrainedRotation = 0;
      }
    } else {
      constrainedRotation = this.twoRotationEngageAppliedRadians
        + wrappedAngleDelta(fullRotation, this.twoRotationGateRadians);
    }
    this.twoRotationAppliedRadians = constrainedRotation;
    if (!solveGroundPlaneSimilarityAtRotation(
      scratch.anchorA.x, scratch.anchorA.y, scratch.anchorB.x, scratch.anchorB.y,
      scratch.cursorWorld.x, scratch.cursorWorld.y, scratch.target.x, scratch.target.y,
      constrainedRotation, similarity,
    )) return;

    const candidateScaleLog = Math.log(similarity.scale);
    const liveDistance = Math.hypot(
      this.pointerB.x - this.pointerA.x,
      this.pointerB.y - this.pointerA.y,
    );
    const cumulativeInputLog = this.twoStartDistance > 1e-6 && liveDistance > 1e-6
      ? Math.log(liveDistance / this.twoStartDistance) : 0;
    this.twoDollyCumulativeLog = Number.isFinite(cumulativeInputLog) ? cumulativeInputLog : 0;
    let constrainedScaleLog = 0;
    if (!this.twoDollyEngaged) {
      if (Math.abs(this.twoDollyCumulativeLog) >= this.twoDollyEngageLog) {
        // Match G★-2's no-replay engagement: retain the fixed-scale pose at
        // the threshold and apply only the crossing-frame span excess.
        this.twoDollyEngaged = true;
        this.twoDollyGateScaleLog = candidateScaleLog;
        this.twoDollyGateInputLog = this.twoDollyCumulativeLog;
        const excessRatio = (Math.abs(this.twoDollyCumulativeLog) - this.twoDollyEngageLog)
          / Math.abs(this.twoDollyCumulativeLog);
        this.twoDollyEngageAppliedLog = candidateScaleLog * excessRatio;
        constrainedScaleLog = this.twoDollyEngageAppliedLog;
      }
    } else {
      constrainedScaleLog = this.twoDollyEngageAppliedLog
        + candidateScaleLog - this.twoDollyGateScaleLog;
    }
    this.twoDollyAppliedLog = constrainedScaleLog;
    const constrainedScale = Math.exp(constrainedScaleLog);
    if (!solveGroundPlaneSimilarityAtRotationAndScale(
      scratch.anchorA.x, scratch.anchorA.y, scratch.anchorB.x, scratch.anchorB.y,
      scratch.cursorWorld.x, scratch.cursorWorld.y, scratch.target.x, scratch.target.y,
      constrainedRotation, constrainedScale, similarity,
    )) return;

    const inverseScale = 1 / similarity.scale;
    const cos = Math.cos(similarity.rotation);
    const sin = Math.sin(similarity.rotation);
    const sourceX = scratch.targetStart.x - similarity.tx;
    const sourceY = scratch.targetStart.y - similarity.ty;
    const targetX = inverseScale * (cos * sourceX + sin * sourceY);
    const targetY = inverseScale * (-sin * sourceX + cos * sourceY);
    const radius = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance,
      this.twoStartRadius * inverseScale));
    const azimuth = this.twoStartAzimuth - similarity.rotation;
    const polar = this.twoStartPolar; // G★ never changes pitch.
    const sinPolar = Math.sin(polar);
    this.controls.target.set(targetX, targetY, scratch.targetStart.z);
    this.camera.position.set(
      targetX + radius * sinPolar * Math.cos(azimuth),
      targetY + radius * sinPolar * Math.sin(azimuth),
      scratch.targetStart.z + radius * Math.cos(polar),
    );
    // Two bounded corrections retain the gate's fixed heading while refining
    // only translation and dolly. All storage is constructor-owned.
    this.refineTwoConstraintFixedYaw(azimuth, this.twoDollyEngaged);
    this.phase = 'two-constraint';
  }

  beginTilt() {
    const scratch = this.scratch;
    const centerX = (this.pointerA.x + this.pointerB.x) * 0.5;
    const centerY = (this.pointerA.y + this.pointerB.y) * 0.5;
    if (this.resolveAnchorAt(centerX, centerY, scratch.tiltAnchor) === 'none') return;
    scratch.cameraStart.copy(this.camera.position);
    scratch.targetStart.copy(this.controls.target);
    scratch.delta.copy(this.camera.position).sub(this.controls.target);
    const radius = scratch.delta.length();
    if (!(radius > 0) || !Number.isFinite(radius)) return;
    this.tiltStartMeanY = centerY;
    this.tiltStartRadius = radius;
    this.tiltStartAzimuth = Math.atan2(scratch.delta.y, scratch.delta.x);
    this.tiltStartPolar = Math.acos(Math.max(-1, Math.min(1, scratch.delta.z / radius)));
    this.tiltActive = true;
    this.pitchReferencePolar = this.tiltStartPolar;
    this.phase = 'two-tilt';
  }

  applyTilt() {
    const scratch = this.scratch;
    const meanY = (this.pointerA.y + this.pointerB.y) * 0.5;
    const polar = clampZUpPolar(
      this.tiltStartPolar - (meanY - this.tiltStartMeanY) * TILT_RADIANS_PER_PX,
      this.controls.minPolarAngle ?? 0,
      this.controls.maxPolarAngle ?? Math.PI,
    );
    const sinPolar = Math.sin(polar);
    this.controls.target.copy(scratch.targetStart);
    this.camera.position.set(
      scratch.targetStart.x + this.tiltStartRadius * sinPolar * Math.cos(this.tiltStartAzimuth),
      scratch.targetStart.y + this.tiltStartRadius * sinPolar * Math.sin(this.tiltStartAzimuth),
      scratch.targetStart.z + this.tiltStartRadius * Math.cos(polar),
    );
    this.correctTiltAnchor(
      scratch.tiltAnchor,
      (this.pointerA.x + this.pointerB.x) * 0.5,
      (this.pointerA.y + this.pointerB.y) * 0.5,
      polar,
    );
  }

  correctHorizontalAnchor(anchor, clientX, clientY, iterations) {
    const scratch = this.scratch;
    const ndcX = ((clientX - this.rectLeft) / this.rectWidth) * 2 - 1;
    const ndcY = -((clientY - this.rectTop) / this.rectHeight) * 2 + 1;
    for (let i = 0; i < iterations; i++) {
      this.camera.lookAt(this.controls.target);
      this.camera.updateMatrixWorld(true);
      scratch.projected.copy(anchor).project(this.camera);
      scratch.cursorWorld.set(ndcX, ndcY, scratch.projected.z).unproject(this.camera);
      scratch.delta.set(anchor.x - scratch.cursorWorld.x, anchor.y - scratch.cursorWorld.y, 0);
      this.camera.position.add(scratch.delta);
      this.controls.target.add(scratch.delta);
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
  }

  correctTiltAnchor(anchor, clientX, clientY, polar) {
    const scratch = this.scratch;
    const ndcX = ((clientX - this.rectLeft) / this.rectWidth) * 2 - 1;
    const ndcY = -((clientY - this.rectTop) / this.rectHeight) * 2 + 1;
    const sinPolar = Math.sin(polar);
    for (let i = 0; i < 2; i++) {
      this.camera.lookAt(this.controls.target);
      this.camera.updateMatrixWorld(true);
      scratch.projected.copy(anchor).project(this.camera);
      const deltaX = ndcX - scratch.projected.x;
      const deltaY = ndcY - scratch.projected.y;
      const depth = this.controls.target.distanceTo(this.camera.position);
      scratch.right.setFromMatrixColumn(this.camera.matrix, 0);
      scratch.up.setFromMatrixColumn(this.camera.matrix, 1);
      this.controls.target.addScaledVector(scratch.right, -deltaX * depth * Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect);
      this.controls.target.addScaledVector(scratch.up, -deltaY * depth * Math.tan(this.camera.fov * Math.PI / 360));
      this.camera.position.set(
        this.controls.target.x + this.tiltStartRadius * sinPolar * Math.cos(this.tiltStartAzimuth),
        this.controls.target.y + this.tiltStartRadius * sinPolar * Math.sin(this.tiltStartAzimuth),
        this.controls.target.z + this.tiltStartRadius * Math.cos(polar),
      );
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
  }

  setTwoConstraintPose(targetX, targetY, azimuth, logRadius) {
    const scratch = this.scratch;
    const radius = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance,
      Math.exp(logRadius)));
    const sinPolar = Math.sin(this.twoStartPolar);
    this.controls.target.set(targetX, targetY, scratch.targetStart.z);
    this.camera.position.set(
      targetX + radius * sinPolar * Math.cos(azimuth),
      targetY + radius * sinPolar * Math.sin(azimuth),
      scratch.targetStart.z + radius * Math.cos(this.twoStartPolar),
    );
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
  }

  projectTwoConstraint(output) {
    const scratch = this.scratch;
    scratch.projected.copy(scratch.anchorA).project(this.camera);
    output[0] = this.rectLeft + (scratch.projected.x + 1) * this.rectWidth * 0.5;
    output[1] = this.rectTop + (1 - scratch.projected.y) * this.rectHeight * 0.5;
    scratch.projected.copy(scratch.anchorB).project(this.camera);
    output[2] = this.rectLeft + (scratch.projected.x + 1) * this.rectWidth * 0.5;
    output[3] = this.rectTop + (1 - scratch.projected.y) * this.rectHeight * 0.5;
  }

  refineTwoConstraintFixedYaw(azimuth, allowDolly) {
    const params = this.constraintParams;
    const projection = this.constraintProjection;
    const perturbed = this.constraintPerturbation;
    const matrix = this.constraintMatrix;
    const step = this.constraintStep;
    const normal = this.constraintNormal;
    params[0] = this.controls.target.x;
    params[1] = this.controls.target.y;
    params[2] = Math.log(this.camera.position.distanceTo(this.controls.target));
    const desired0 = this.pointerA.x;
    const desired1 = this.pointerA.y;
    const desired2 = this.pointerB.x;
    const desired3 = this.pointerB.y;
    const epsilon0 = 1;
    const epsilon1 = 1;
    const epsilon2 = 1e-3;
    const dimension = allowDolly ? 3 : 2;

    for (let iteration = 0; iteration < 2; iteration++) {
      this.setTwoConstraintPose(params[0], params[1], azimuth, params[2]);
      this.projectTwoConstraint(projection);
      matrix[3] = desired0 - projection[0];
      matrix[8] = desired1 - projection[1];
      matrix[13] = desired2 - projection[2];
      matrix[18] = desired3 - projection[3];
      for (let column = 0; column < dimension; column++) {
        const epsilon = column === 0 ? epsilon0 : column === 1 ? epsilon1 : epsilon2;
        params[column] += epsilon;
        this.setTwoConstraintPose(params[0], params[1], azimuth, params[2]);
        this.projectTwoConstraint(perturbed);
        params[column] -= epsilon;
        matrix[column] = (perturbed[0] - projection[0]) / epsilon;
        matrix[5 + column] = (perturbed[1] - projection[1]) / epsilon;
        matrix[10 + column] = (perturbed[2] - projection[2]) / epsilon;
        matrix[15 + column] = (perturbed[3] - projection[3]) / epsilon;
      }
      normal.fill(0);
      for (let row = 0; row < 4; row++) {
        const rowOffset = row * 5;
        for (let column = 0; column < dimension; column++) {
          const derivative = matrix[rowOffset + column];
          normal[column * 4 + 3] += derivative * matrix[rowOffset + 3];
          for (let other = 0; other < dimension; other++) {
            normal[column * 4 + other] += derivative * matrix[rowOffset + other];
          }
        }
      }
      if (!this.solveFixedYawConstraintNormal(normal, step, dimension)) break;
      params[0] += Math.max(-500, Math.min(500, step[0]));
      params[1] += Math.max(-500, Math.min(500, step[1]));
      if (allowDolly) params[2] += Math.max(-0.75, Math.min(0.75, step[2]));
    }
    this.setTwoConstraintPose(params[0], params[1], azimuth, params[2]);
  }

  solveFixedYawConstraintNormal(matrix, output, dimension) {
    for (let column = 0; column < dimension; column++) {
      let pivot = column;
      let largest = Math.abs(matrix[column * 4 + column]);
      for (let row = column + 1; row < dimension; row++) {
        const candidate = Math.abs(matrix[row * 4 + column]);
        if (candidate > largest) {
          largest = candidate;
          pivot = row;
        }
      }
      if (!(largest > 1e-9) || !Number.isFinite(largest)) return false;
      if (pivot !== column) {
        for (let index = column; index < 4; index++) {
          const swap = matrix[column * 4 + index];
          matrix[column * 4 + index] = matrix[pivot * 4 + index];
          matrix[pivot * 4 + index] = swap;
        }
      }
      const pivotValue = matrix[column * 4 + column];
      for (let row = column + 1; row < dimension; row++) {
        const ratio = matrix[row * 4 + column] / pivotValue;
        for (let index = column; index < 4; index++) {
          matrix[row * 4 + index] -= ratio * matrix[column * 4 + index];
        }
      }
    }
    for (let row = dimension - 1; row >= 0; row--) {
      let value = matrix[row * 4 + 3];
      for (let column = row + 1; column < dimension; column++) value -= matrix[row * 4 + column] * output[column];
      const pivot = matrix[row * 4 + row];
      if (!(Math.abs(pivot) > 1e-9) || !Number.isFinite(pivot)) return false;
      output[row] = value / pivot;
    }
    return Number.isFinite(output[0]) && Number.isFinite(output[1])
      && (dimension !== 3 || Number.isFinite(output[2]));
  }


  beginOneHandZoom(pointer) {
    const centerX = this.rectLeft + this.rectWidth * 0.5;
    const centerY = this.rectTop + this.rectHeight * 0.5;
    if (!this.resolveAnchor(centerX, centerY)) {
      this.phase = 'idle';
      return false;
    }
    const scratch = this.scratch;
    scratch.cameraStart.copy(this.camera.position);
    scratch.targetStart.copy(this.controls.target);
    scratch.delta.copy(this.camera.position).sub(scratch.anchor);
    const radius = scratch.delta.length();
    if (!(radius > 0) || !Number.isFinite(radius)) {
      this.phase = 'idle';
      return false;
    }
    this.oneHandStartRadius = radius;
    this.oneHandStartAzimuth = Math.atan2(scratch.delta.y, scratch.delta.x);
    this.oneHandStartPolar = Math.acos(Math.max(-1, Math.min(1, scratch.delta.z / radius)));
    this.oneHandZoomScale = zoomSpeedForHeight(this.navHeightAboveFloor(), radius);
    this.capturePitchReference();
    this.secondTapStartY = pointer.startY;
    this.g7Count++;
    this.phase = 'one-hand-zoom';
    this.suppressCompatibilityClick(TAP_DELAY_MS + 350);
    return true;
  }

  applyOneHandZoom(clientY) {
    if (!this.hasAnchor || this.phase !== 'one-hand-zoom') return;
    const dragY = applyDeadZone(clientY - this.secondTapStartY, TAP_MOVE_PX);
    const radius = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance,
      this.oneHandStartRadius * pinchRadiusFactor(dragY * ONE_HAND_ZOOM_LOG_PER_PX, this.oneHandZoomScale)));
    const polar = clampZUpPolar(this.oneHandStartPolar,
      this.controls.minPolarAngle ?? 0, this.controls.maxPolarAngle ?? Math.PI);
    const sinPolar = Math.sin(polar);
    const anchor = this.scratch.anchor;
    this.camera.position.set(
      anchor.x + radius * sinPolar * Math.cos(this.oneHandStartAzimuth),
      anchor.y + radius * sinPolar * Math.sin(this.oneHandStartAzimuth),
      anchor.z + radius * Math.cos(polar),
    );
    this.solveTargetAt(this.rectLeft + this.rectWidth * 0.5, this.rectTop + this.rectHeight * 0.5);
  }

  solveTargetAt(clientX, clientY, anchor = this.scratch.anchor, iterations = 5) {
    const scratch = this.scratch;
    const ndcX = ((clientX - this.rectLeft) / this.rectWidth) * 2 - 1;
    const ndcY = -((clientY - this.rectTop) / this.rectHeight) * 2 + 1;
    scratch.target.copy(anchor);
    const halfVertical = this.camera.fov * Math.PI / 360;
    const tanHalfVertical = Math.tan(halfVertical);
    for (let i = 0; i < iterations; i++) {
      this.camera.lookAt(scratch.target);
      this.camera.updateMatrixWorld(true);
      scratch.projected.copy(anchor).project(this.camera);
      const deltaX = ndcX - scratch.projected.x;
      const deltaY = ndcY - scratch.projected.y;
      if (Math.abs(deltaX) < 1e-3 && Math.abs(deltaY) < 1e-3) break;
      const depth = scratch.target.distanceTo(this.camera.position);
      scratch.right.setFromMatrixColumn(this.camera.matrix, 0);
      scratch.up.setFromMatrixColumn(this.camera.matrix, 1);
      scratch.target.addScaledVector(scratch.right, -deltaX * depth * tanHalfVertical * this.camera.aspect);
      scratch.target.addScaledVector(scratch.up, -deltaY * depth * tanHalfVertical);
    }
    this.controls.target.copy(scratch.target);
    this.camera.lookAt(scratch.target);
    this.camera.updateMatrixWorld(true);
  }

  resetSamples() {
    this.sampleIndex = 0;
    this.sampleCount = 0;
  }

  recordSample(now) {
    const i = this.sampleIndex;
    this.samplesT[i] = now;
    this.samplesX[i] = this.camera.position.x;
    this.samplesY[i] = this.camera.position.y;
    this.samplesZ[i] = this.camera.position.z;
    this.sampleIndex = (i + 1) & 3;
    if (this.sampleCount < 4) this.sampleCount++;
  }

  startMomentum() {
    this.phase = 'idle';
    this.hasAnchor = false;
    if (this.prefersReducedMotion() || this.sampleCount < 2) return;
    const last = (this.sampleIndex + 3) & 3;
    const previous = (this.sampleIndex + 2) & 3;
    const elapsed = this.samplesT[last] - this.samplesT[previous];
    if (!(elapsed > 0) || elapsed > 250) return;
    const scale = 1000 / elapsed;
    const momentum = this.scratch.momentum;
    momentum.set(
      (this.samplesX[last] - this.samplesX[previous]) * scale,
      (this.samplesY[last] - this.samplesY[previous]) * scale,
      (this.samplesZ[last] - this.samplesZ[previous]) * scale,
    );
    if (momentum.length() <= MOMENTUM_CUTOFF) return;
    this.phase = 'momentum';
    this.momentumLast = performance.now();
    this.momentumRaf = requestAnimationFrame(this.runMomentumFrame);
  }

  runMomentumFrame() {
    if (!this.momentumRaf) return;
    const now = performance.now();
    const elapsed = Math.min(64, Math.max(0, now - this.momentumLast));
    this.momentumLast = now;
    const momentum = this.scratch.momentum;
    this.camera.position.addScaledVector(momentum, elapsed / 1000);
    this.controls.target.addScaledVector(momentum, elapsed / 1000);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
    momentum.set(
      decayVelocity(momentum.x, elapsed),
      decayVelocity(momentum.y, elapsed),
      decayVelocity(momentum.z, elapsed),
    );
    if (momentum.length() <= MOMENTUM_CUTOFF) {
      this.stopMomentum();
      return;
    }
    this.momentumRaf = requestAnimationFrame(this.runMomentumFrame);
  }

  stopMomentum() {
    if (this.momentumRaf) cancelAnimationFrame(this.momentumRaf);
    this.momentumRaf = 0;
    this.scratch.momentum.set(0, 0, 0);
    if (this.phase === 'momentum') this.phase = 'idle';
  }

  startStepZoom(factor) {
    const scratch = this.scratch;
    scratch.actionAnchor.copy(scratch.anchor);
    scratch.stepStartTarget.copy(this.controls.target);
    scratch.stepOffset.copy(this.camera.position).sub(this.controls.target);
    scratch.delta.copy(this.camera.position).sub(scratch.actionAnchor);
    const startRadius = scratch.delta.length();
    if (!(startRadius > 0) || !Number.isFinite(startRadius)) {
      this.phase = 'idle';
      this.hasAnchor = false;
      return;
    }
    const endRadius = Math.max(this.controls.minDistance,
      Math.min(this.controls.maxDistance, startRadius * factor));
    scratch.stepEndTarget.copy(scratch.actionAnchor);
    this.stepStartRadius = scratch.stepOffset.length();
    this.stepEndRadius = endRadius;
    if (!(this.stepStartRadius > 0) || !Number.isFinite(this.stepStartRadius)) {
      this.phase = 'idle';
      this.hasAnchor = false;
      return;
    }
    this.capturePitchReference();
    this.suppressCompatibilityClick(STEP_ZOOM_MS + 350);
    this.phase = 'step-zoom';
    if (this.prefersReducedMotion()) {
      this.applyStepZoomPose(1);
      this.phase = 'idle';
      this.hasAnchor = false;
      return;
    }
    this.stepZoomStart = performance.now();
    this.stepZoomRaf = requestAnimationFrame(this.runStepZoomFrame);
  }

  runStepZoomFrame(now) {
    if (!this.stepZoomRaf) return;
    const t = Math.min(1, Math.max(0, (now - this.stepZoomStart) / STEP_ZOOM_MS));
    const eased = 1 - ((1 - t) ** 3);
    this.applyStepZoomPose(eased);
    if (t >= 1) {
      this.stepZoomRaf = 0;
      this.phase = 'idle';
      this.hasAnchor = false;
      return;
    }
    this.stepZoomRaf = requestAnimationFrame(this.runStepZoomFrame);
  }

  applyStepZoomPose(eased) {
    const scratch = this.scratch;
    this.controls.target.lerpVectors(scratch.stepStartTarget, scratch.stepEndTarget, eased);
    const radius = this.stepStartRadius + (this.stepEndRadius - this.stepStartRadius) * eased;
    this.camera.position.copy(this.controls.target)
      .addScaledVector(scratch.stepOffset, radius / this.stepStartRadius);
    const dx = this.camera.position.x - this.controls.target.x;
    const dy = this.camera.position.y - this.controls.target.y;
    const horizontalRadius = Math.hypot(dx, dy);
    if (horizontalRadius > 0) {
      this.camera.position.z = this.controls.target.z
        + horizontalRadius / Math.tan(this.pitchReferencePolar);
    }
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
  }

  stopStepZoom() {
    if (this.stepZoomRaf) cancelAnimationFrame(this.stepZoomRaf);
    this.stepZoomRaf = 0;
    if (this.phase === 'step-zoom') {
      this.phase = 'idle';
      this.hasAnchor = false;
    }
  }

  queueTap(x, y) {
    this.phase = 'idle';
    this.hasAnchor = false;
    this.pendingTap = true;
    this.pendingTapX = x;
    this.pendingTapY = y;
    this.pendingTapQueuedAt = performance.now();
    this.suppressCompatibilityClick(TAP_DELAY_MS + 350);
    this.pendingTapTimer = setTimeout(this.dispatchPendingTap, TAP_DELAY_MS);
  }

  dispatchPendingTap() {
    this.pendingTapTimer = 0;
    if (!this.pendingTap) return;
    this.pendingTap = false;
    this.pickAt(this.pendingTapX, this.pendingTapY);
    this.pickCount++;
  }
}

export function installMobileGestureController(options) {
  return new MobileGestureController(options).install();
}
