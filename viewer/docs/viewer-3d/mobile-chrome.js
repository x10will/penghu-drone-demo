const DETENTS = ['peek', 'half', 'full'];
const SPRING_DAMPING = 0.87;
const SPRING_FREQUENCY = 24;
const SPRING_DURATION_MS = 420;
const SPRING_ROOT = Math.sqrt(1 - SPRING_DAMPING * SPRING_DAMPING);
const SPRING_DAMPED_FREQUENCY = SPRING_FREQUENCY * SPRING_ROOT;
const SPRING_PHASE_RATIO = SPRING_DAMPING / SPRING_ROOT;

export function installMobileChrome(options) {
  const doc = options.document || document;
  const win = options.window || window;
  const root = doc.getElementById('mobile-chrome');
  const sheet = doc.getElementById('mobile-sheet');
  const scrim = doc.getElementById('mobile-sheet-scrim');
  const grabber = doc.getElementById('mobile-sheet-grabber');
  const timeline = doc.getElementById('mobile-timeline');
  const status = doc.getElementById('mobile-status');
  const search = doc.getElementById('mobile-search');
  const compass = doc.getElementById('mobile-compass');
  const timeDisplay = doc.getElementById('time-display');
  const actBadge = doc.getElementById('act-badge');
  const scenarioSelect = doc.getElementById('scenario-select');
  const statusTime = doc.getElementById('mobile-status-time');
  const statusAct = doc.getElementById('mobile-status-act');
  const statusScenario = doc.getElementById('mobile-status-scenario');
  const play = doc.getElementById('btn-play');
  const gotoInput = doc.getElementById('goto-input');
  const detentButtons = doc.querySelectorAll('[data-mobile-detent]');
  const sectionButtons = doc.querySelectorAll('[data-mobile-section]');
  const sectionPanels = doc.querySelectorAll('[data-mobile-panel]');
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const homes = [];
  const decorated = [];
  const bindings = [
    ['goto-input', 'mobile-slot-search'], ['goto-results', 'mobile-slot-search'],
    ['scenario-select', 'mobile-slot-scenario'], ['viewpoints', 'mobile-slot-viewpoints'],
    ['layer-toggles', 'mobile-slot-layers'],
    ['btn-toggle-markers', 'mobile-slot-tools'], ['btn-toggle-vehicles', 'mobile-slot-tools'],
    ['btn-cinema', 'mobile-slot-tools'],
    ['btn-play', 'mobile-timeline-play-slot'], ['time-display', 'mobile-timeline-time-slot'],
    ['scrubber', 'mobile-timeline-scrubber-slot'], ['frame-counter', 'mobile-timeline-frame-slot'],
  ];

  let enabled = false;
  let detent = 'peek';
  let section = 'search';
  let sheetHeight = 0;
  let viewportHeight = 0;
  let peekY = 0;
  let halfY = 0;
  let fullY = 0;
  let currentY = 0;
  let startY = 0;
  let targetY = 0;
  let dragPointer = -1;
  let dragStartClientY = 0;
  let dragStartSheetY = 0;
  let dragLastY = 0;
  let dragLastTime = 0;
  let dragVelocity = 0;
  let animationRaf = 0;
  let animationStart = 0;
  let animationDuration = 0;
  let maxOvershoot = 0;
  let compassHideAt = 0;
  let compassAngle = 0;
  let lastPaintedSheetY = NaN;
  let lastTimelineLift = NaN;
  let lastStatusTime = null;
  let lastStatusAct = null;
  let lastScenarioValue = null;
  let lastScenarioText = '--';
  let lastPlayActive = null;
  let lastCompassAngle = NaN;
  let lastCompassHidden = compass.hidden;

  const iconMarkup = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
    film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>',
  };

  function decorate(element, html, label) {
    if (!element) return;
    decorated.push({ element, html: element.innerHTML, label: element.getAttribute('aria-label') });
    element.innerHTML = html;
    if (label) element.setAttribute('aria-label', label);
  }

  function decorateMobileIcons() {
    decorate(play, iconMarkup.play, 'Play');
    play.dataset.mobileIconState = 'play';
    decorate(doc.getElementById('btn-cinema'), `${iconMarkup.film}<span>Cinema</span>`, 'Cinema');
    decorate(doc.getElementById('inspector-close'), iconMarkup.close, 'Close inspector');
  }

  function restoreDecorations() {
    while (decorated.length) {
      const item = decorated.pop();
      if (item.element.id === 'btn-play') item.element.textContent = item.element.classList.contains('active') ? '⏸ Pause' : '▶ Play';
      else item.element.innerHTML = item.html;
      if (item.label === null) item.element.removeAttribute('aria-label');
      else item.element.setAttribute('aria-label', item.label);
      delete item.element.dataset.mobileIconState;
    }
  }

  function measure() {
    viewportHeight = win.visualViewport?.height || win.innerHeight;
    sheetHeight = sheet.getBoundingClientRect().height;
    fullY = 0;
    halfY = Math.max(0, sheetHeight - viewportHeight * 0.45);
    peekY = Math.max(0, sheetHeight - 93);
  }

  function yFor(name) {
    return name === 'full' ? fullY : name === 'half' ? halfY : peekY;
  }

  function paint(y) {
    currentY = Math.max(fullY, Math.min(peekY, y));
    if (currentY !== lastPaintedSheetY) {
      sheet.style.setProperty('--mobile-sheet-y', `${currentY}px`);
      lastPaintedSheetY = currentY;
    }
    const lift = detent === 'full' ? Math.max(0, viewportHeight - sheetHeight - 72) : 0;
    if (lift !== lastTimelineLift) {
      timeline.style.setProperty('--mobile-timeline-lift', `${lift}px`);
      lastTimelineLift = lift;
    }
  }

  function finishAnimation() {
    animationRaf = 0;
    paint(targetY);
  }

  function animationFrame(now) {
    const elapsed = now - animationStart;
    const t = animationDuration ? Math.min(1, elapsed / animationDuration) : 1;
    const seconds = elapsed / 1000;
    const envelope = Math.exp(-SPRING_DAMPING * SPRING_FREQUENCY * seconds);
    const eased = 1 - envelope * (Math.cos(SPRING_DAMPED_FREQUENCY * seconds)
      + SPRING_PHASE_RATIO * Math.sin(SPRING_DAMPED_FREQUENCY * seconds));
    paint(startY + (targetY - startY) * eased);
    const crossedTarget = targetY < startY ? currentY < targetY : currentY > targetY;
    const overshoot = crossedTarget ? Math.abs(currentY - targetY) : 0;
    if (overshoot > maxOvershoot) maxOvershoot = overshoot;
    if (t < 1) animationRaf = win.requestAnimationFrame(animationFrame);
    else finishAnimation();
  }

  function setDetent(name, opts = {}) {
    if (!DETENTS.includes(name)) return;
    measure();
    detent = name;
    targetY = yFor(name);
    sheet.dataset.detent = name;
    grabber.setAttribute('aria-expanded', String(name !== 'peek'));
    for (const button of detentButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mobileDetent === name));
    }
    const full = name === 'full';
    scrim.hidden = !full;
    scrim.dataset.visible = String(full);
    if (animationRaf) win.cancelAnimationFrame(animationRaf);
    animationRaf = 0;
    startY = currentY;
    animationDuration = opts.immediate || reduced.matches ? 0 : SPRING_DURATION_MS;
    maxOvershoot = 0;
    if (!animationDuration) finishAnimation();
    else {
      animationStart = performance.now();
      animationRaf = win.requestAnimationFrame(animationFrame);
    }
  }

  function setSection(name, minimumDetent = 'half') {
    let panel = null;
    for (const item of sectionPanels) {
      if (item.dataset.mobilePanel === name) { panel = item; break; }
    }
    if (!panel) return;
    section = name;
    for (const item of sectionPanels) item.hidden = item !== panel;
    for (const button of sectionButtons) {
      button.setAttribute('aria-selected', String(button.dataset.mobileSection === name));
    }
    if (detent === 'peek' || minimumDetent === 'full') setDetent(minimumDetent);
  }

  function moveIntoSlots() {
    for (const [id, slotId] of bindings) {
      const element = doc.getElementById(id);
      const slot = doc.getElementById(slotId);
      if (!element || !slot || element.parentNode === slot) continue;
      const marker = doc.createComment(`mobile-home:${id}`);
      element.parentNode.insertBefore(marker, element);
      homes.push({ element, marker });
      slot.appendChild(element);
    }
  }

  function restoreHomes() {
    while (homes.length) {
      const home = homes.pop();
      if (home.marker.parentNode) home.marker.parentNode.replaceChild(home.element, home.marker);
    }
  }

  function setMode(on) {
    on = Boolean(on);
    if (enabled === on) return;
    enabled = on;
    doc.body.classList.toggle('mobile', on);
    if (on) {
      moveIntoSlots();
      decorateMobileIcons();
      lastStatusTime = null;
      lastStatusAct = null;
      lastScenarioValue = null;
      lastPlayActive = null;
      lastCompassAngle = NaN;
      lastCompassHidden = compass.hidden;
      measure();
      currentY = peekY;
      setSection('search', 'peek');
      setDetent('peek', { immediate: true });
    } else {
      if (animationRaf) win.cancelAnimationFrame(animationRaf);
      animationRaf = 0;
      restoreHomes();
      restoreDecorations();
      scrim.hidden = true;
    }
  }

  function selectAfterRelease() {
    const projected = currentY + dragVelocity * 150;
    let best = 'peek';
    let distance = Math.abs(projected - peekY);
    const halfDistance = Math.abs(projected - halfY);
    const fullDistance = Math.abs(projected - fullY);
    if (halfDistance < distance) { best = 'half'; distance = halfDistance; }
    if (fullDistance < distance) best = 'full';
    setDetent(best);
  }

  function onPointerDown(event) {
    if (!enabled || dragPointer >= 0) return;
    dragPointer = event.pointerId;
    dragStartClientY = event.clientY;
    dragStartSheetY = currentY;
    dragLastY = event.clientY;
    dragLastTime = event.timeStamp;
    dragVelocity = 0;
    if (animationRaf) win.cancelAnimationFrame(animationRaf);
    animationRaf = 0;
    grabber.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (event.pointerId !== dragPointer) return;
    const dt = Math.max(1, event.timeStamp - dragLastTime);
    dragVelocity = (event.clientY - dragLastY) / dt;
    dragLastY = event.clientY;
    dragLastTime = event.timeStamp;
    paint(dragStartSheetY + event.clientY - dragStartClientY);
    event.preventDefault();
  }

  function onPointerEnd(event) {
    if (event.pointerId !== dragPointer) return;
    dragPointer = -1;
    selectAfterRelease();
    event.preventDefault();
  }

  function resetCompass() {
    options.cancelMomentum?.();
    const camera = options.camera;
    const controls = options.controls;
    const radius = camera.position.distanceTo(controls.target);
    const polar = 0.32;
    const horizontal = Math.sin(polar) * radius;
    const pos = [controls.target.x, controls.target.y - horizontal, controls.target.z + Math.cos(polar) * radius];
    const target = [controls.target.x, controls.target.y, controls.target.z];
    options.flyTo?.({ pos, target, duration: reduced.matches ? 0 : 250, onArrive: () => { compassHideAt = performance.now() + 1000; } });
  }

  function update(now) {
    if (!enabled) return;
    const nextTime = timeDisplay?.textContent || '--:--';
    if (nextTime !== lastStatusTime) {
      statusTime.textContent = nextTime;
      lastStatusTime = nextTime;
    }
    const nextAct = actBadge?.textContent || '--';
    if (nextAct !== lastStatusAct) {
      statusAct.textContent = nextAct;
      lastStatusAct = nextAct;
    }
    const nextScenarioValue = scenarioSelect?.value || '';
    if (nextScenarioValue !== lastScenarioValue) {
      lastScenarioValue = nextScenarioValue;
      lastScenarioText = nextScenarioValue ? nextScenarioValue.replace('_', ' ').toUpperCase() : '--';
      statusScenario.textContent = lastScenarioText;
    }
    const playActive = play.classList.contains('active');
    if (playActive !== lastPlayActive) {
      const playState = playActive ? 'pause' : 'play';
      play.innerHTML = iconMarkup[playState];
      play.dataset.mobileIconState = playState;
      play.setAttribute('aria-label', playState === 'pause' ? 'Pause' : 'Play');
      lastPlayActive = playActive;
    }
    const camera = options.camera;
    const controls = options.controls;
    const dx = camera.position.x - controls.target.x;
    const dy = camera.position.y - controls.target.y;
    const dz = camera.position.z - controls.target.z;
    const radius = Math.hypot(dx, dy, dz) || 1;
    const azimuth = Math.atan2(dy, dx);
    const polar = Math.acos(Math.max(-1, Math.min(1, dz / radius)));
    compassAngle = azimuth + Math.PI / 2;
    const deviated = Math.abs(compassAngle) > 0.035 || Math.abs(polar - 0.32) > 0.035;
    if (!Number.isFinite(lastCompassAngle) || Math.abs(compassAngle - lastCompassAngle) > 1e-6) {
      compass.style.setProperty('--mobile-compass-angle', `${compassAngle}rad`);
      lastCompassAngle = compassAngle;
    }
    const nextCompassHidden = !deviated && now >= compassHideAt;
    if (nextCompassHidden !== lastCompassHidden) {
      compass.hidden = nextCompassHidden;
      lastCompassHidden = nextCompassHidden;
    }
  }

  grabber.addEventListener('pointerdown', onPointerDown);
  grabber.addEventListener('pointermove', onPointerMove);
  grabber.addEventListener('pointerup', onPointerEnd);
  grabber.addEventListener('pointercancel', onPointerEnd);
  grabber.addEventListener('lostpointercapture', onPointerEnd);
  grabber.addEventListener('click', () => setDetent(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'peek'));
  grabber.addEventListener('keydown', (event) => {
    const i = DETENTS.indexOf(detent);
    if (event.key === 'ArrowUp') { setDetent(DETENTS[Math.min(2, i + 1)]); event.preventDefault(); }
    else if (event.key === 'ArrowDown') { setDetent(DETENTS[Math.max(0, i - 1)]); event.preventDefault(); }
    else if (event.key === 'Home') { setDetent('peek'); event.preventDefault(); }
    else if (event.key === 'End') { setDetent('full'); event.preventDefault(); }
    else if (event.key === 'Escape') { setDetent('peek'); event.preventDefault(); }
  });
  for (const button of detentButtons) button.addEventListener('click', () => setDetent(button.dataset.mobileDetent));
  for (const button of sectionButtons) button.addEventListener('click', () => setSection(button.dataset.mobileSection));
  status.addEventListener('click', () => setSection('scenario', 'half'));
  search.addEventListener('click', () => {
    setSection('search', 'full');
    gotoInput?.focus();
  });
  compass.addEventListener('click', resetCompass);
  scrim.addEventListener('click', () => setDetent('half'));
  win.visualViewport?.addEventListener('resize', () => enabled && setDetent(detent, { immediate: true }));
  win.addEventListener('resize', () => enabled && setDetent(detent, { immediate: true }));

  return {
    setMode,
    setDetent,
    setSection,
    update,
    snapshot: () => ({
      enabled, detent, section, currentY, targetY, peekY, halfY, fullY,
      velocity: dragVelocity, maxOvershoot, rafActive: animationRaf !== 0,
      scrimVisible: !scrim.hidden, compassAngle, compassHidden: compass.hidden,
      homes: homes.map((home) => home.element.id),
    }),
  };
}
