import {createApp} from './vendor/panel-core/core.js';
import {BASELINE_FIXTURE} from './daily-fixture.mjs';
import {simulateDay, snapshotAt} from './daily-simulation.mjs';
import {createDailyMap} from './daily-map.mjs';
import {createDailyPanels, minuteLabel} from './daily-panels.mjs';
import {createCameraControls, createHazardControls} from './daily-controls.mjs';
import {createTrialPlanner} from './daily-route-panel.mjs';
import {FLIGHT_LEAD_H} from './scenario-clock.mjs';
import {resolveScenario, SCENARIOS, scenarioHref} from './scenario.mjs';

// daily-gate.mjs has already refused an unknown ?scenario=.
const {scenario} = resolveScenario(location.search);
const isDrone = scenario.id === 'drone';
const isDelivery = scenario.id === 'delivery';

const run = simulateDay(BASELINE_FIXTURE);
const startMin = run.startMin;
const endMin = run.endMin;
const duration = (endMin - startMin) * 60_000;
const initialSnapshot = snapshotAt(run, startMin);
const listeners = new Set();
let state = {
  scenarioId: scenario.id,
  snapshot: initialSnapshot,
  selectedOrderId: run.fixture.plan.sequence[0],
  selectedEventId: null,
  focusedResourceId: null,
  mapStatus: {ready: false},
  camera: {mode: 'free', resourceId: isDelivery ? 'D-01' : 'trial'},
  // The risk field starts hidden only in the delivery check; the trial avoids it, so the drone check shows it.
  hazardVisible: scenario.id !== 'delivery',
  fieldStatus: {loading: true},
  trialPlan: null,
};
const store = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  set(patch) { state = {...state, ...patch}; for (const fn of listeners) fn(state); },
};

const mapUrl = new URL('../viewer/docs/viewer-3d/index.html', import.meta.url);
mapUrl.searchParams.set('site', 'penghu');
mapUrl.searchParams.set('embed', '1');
mapUrl.searchParams.set('ext', new URL('./daily-layers.js', import.meta.url).pathname);

let app;
let dailyMap;
let trialArrivalElapsed = null;
const stopTrialPlayback = (pause = false) => {
  if (trialArrivalElapsed == null) return;
  trialArrivalElapsed = null;
  if (pause) {
    app?.clock.pause();
    app?.clock.seek(app.clock.time);
  }
};
const actions = {
  selectOrder(id, {focus = false} = {}) {
    if (!run.fixture.orders.some(order => order.id === id)) return;
    store.set({selectedOrderId: id});
    if (focus) app?.focus('order-detail');
  },
  selectResource(id, {focus = false} = {}) {
    if (!run.fixture.resources.some(resource => resource.id === id)) return;
    store.set({focusedResourceId: id, camera: {...store.get().camera, mode: 'free', resourceId: id}});
    if (isDelivery) dailyMap?.focusResource(id);
    if (focus) app?.focus('resource-status');
  },
  overview() {
    store.set({focusedResourceId: null, camera: {...store.get().camera, mode: 'free'}});
    dailyMap?.overview();
  },
  seekMinute(min, eventId = null) {
    const bounded = Math.max(startMin, Math.min(endMin, Number(min)));
    if (!Number.isFinite(bounded)) return;
    stopTrialPlayback();
    const event = run.events.find(item => item.id === eventId);
    if (event) store.set({selectedEventId: event.id, focusedResourceId: null, camera: {...store.get().camera, mode: 'free'},
      selectedOrderId: event.orderId ?? store.get().selectedOrderId});
    app?.clock.pause();
    app?.clock.seek((bounded - startMin) * 60_000);
    // Seek first so the actors and the event's camera target share one time.
    if (event?.siteId) dailyMap?.focusSite(event.siteId);
    else if (event) dailyMap?.overview();
  },
  setCamera(camera) {
    store.set({camera, focusedResourceId: camera.mode === 'free' ? null : camera.resourceId});
    dailyMap?.setCamera(camera);
  },
  setHazardVisible(hazardVisible) { store.set({hazardVisible}); dailyMap?.setHazardVisible(hazardVisible); },
  setTrialPlan(trialPlan) {
    if (store.get().trialPlan !== trialPlan) stopTrialPlayback(true);
    const camera = store.get().camera;
    if (!trialPlan && camera.resourceId === 'trial') {
      const reset = {mode: 'free', resourceId: isDelivery ? 'D-01' : 'trial'};
      store.set({trialPlan, camera: reset, focusedResourceId: null});
    } else store.set({trialPlan});
    dailyMap?.setTrialPlan(trialPlan);
    if (trialPlan) actions.focusTrial();
  },
  focusTrial() {
    if (!store.get().trialPlan) return;
    store.set({focusedResourceId: null, camera: {mode: 'free', resourceId: 'trial'}});
    dailyMap?.focusTrial();
  },
  playTrial() {
    const trial = store.get().trialPlan;
    if (!trial) return;
    const start = Math.max(startMin, (trial.itinerary.depart_h - FLIGHT_LEAD_H) * 60);
    trialArrivalElapsed = (trial.itinerary.arrive_h * 60 - startMin) * 60_000;
    app.clock.pause();
    app.clock.seek((start - startMin) * 60_000);
    const camera = {...store.get().camera, resourceId: 'trial'};
    store.set({selectedEventId: null, camera, focusedResourceId: camera.mode === 'free' ? null : 'trial'});
    dailyMap?.frameTrial?.();
    app.clock.play();
  },
};
const {dailyPlan, orderDetail, resourceStatus} = createDailyPanels({run, store, actions});
const cameraControls = createCameraControls({run, store, actions, scenarioId: scenario.id});
const hazardControls = createHazardControls({store, actions, legendOpen: scenario.id === 'hazard'});
const trialPlanner = createTrialPlanner({run, store, actions});
// Nine 90px rows fit the desktop screen; navigation belongs in the header.
const presets = {
  delivery: [
    {id: 'map', type: 'map', x: 0, y: 0, w: 6, h: 6},
    {id: 'daily-plan', type: 'dailyPlan', x: 6, y: 0, w: 3, h: 9},
    {id: 'order-detail', type: 'orderDetail', x: 9, y: 0, w: 3, h: 9},
    {id: 'resource-status', type: 'resourceStatus', x: 0, y: 6, w: 4, h: 3},
    {id: 'camera-controls', type: 'cameraControls', x: 4, y: 6, w: 2, h: 3},
  ],
  drone: [
    {id: 'map', type: 'map', x: 0, y: 0, w: 6, h: 9},
    {id: 'trial-planner', type: 'trialPlanner', x: 6, y: 0, w: 3, h: 9},
    {id: 'hazard-controls', type: 'hazardControls', x: 9, y: 0, w: 3, h: 3},
    {id: 'camera-controls', type: 'cameraControls', x: 9, y: 3, w: 3, h: 3},
    {id: 'resource-status', type: 'resourceStatus', resourceIds: ['D-01'], x: 9, y: 6, w: 3, h: 3},
  ],
  hazard: [
    {id: 'map', type: 'map', x: 0, y: 0, w: 8, h: 9},
    {id: 'hazard-controls', type: 'hazardControls', x: 8, y: 0, w: 4, h: 4},
    {id: 'camera-controls', type: 'cameraControls', x: 8, y: 4, w: 4, h: 5},
  ],
};
const preset = presets[scenario.id];
const manifest = {
  version: 1,
  // Each check remembers its own layout under its own ID.
  id: `penghu-vaccine-daily-${scenario.id}-v3`,
  title: `澎湖疫苗配送 · ${scenario.title}`,
  subtitle: null,
  locale: 'zh-Hant',
  locales: ['zh-Hant'],
  mapUrl: mapUrl.href,
  streams: {},
  clock: {
    duration,
    rate: 300,
    rates: [60, 300, 600, 1800],
    step: 60_000,
    loop: false,
    controls: true,
    labelFormat: elapsedMs => minuteLabel(startMin + elapsedMs / 60_000),
  },
  panelTypes: {dailyPlan, orderDetail, resourceStatus, cameraControls, hazardControls, trialPlanner},
  // Every panel type stays available in every check; only the preset differs.
  catalogue: [
    {id: 'map', type: 'map', titleKey: '配送地圖', icon: '⌖', defaultSize: {w: 6, h: 7}},
    {id: 'daily-plan', type: 'dailyPlan', titleKey: '今日配送計畫', icon: '▤', defaultSize: {w: 3, h: 7}},
    {id: 'order-detail', type: 'orderDetail', titleKey: '訂單詳情', icon: '▧', defaultSize: {w: 3, h: 7}},
    {id: 'camera-controls', type: 'cameraControls', titleKey: '視角', icon: '◉', defaultSize: {w: 4, h: 5}},
    {id: 'hazard-controls', type: 'hazardControls', titleKey: '風險場', icon: '◐', defaultSize: {w: 4, h: 5}},
    {id: 'trial-planner', type: 'trialPlanner', titleKey: '航線試算', icon: '⌁', defaultSize: {w: 4, h: 5}},
    {id: 'resource-status', type: 'resourceStatus', titleKey: '運具狀態', icon: '▣', defaultSize: {w: 4, h: 4},
      ...(isDrone ? {resourceIds: ['D-01']} : {})},
  ],
  preset,
  layout: {phone: {order: preset.filter(item => item.type !== 'map').map(item => item.id),
    activeId: preset.find(item => item.type !== 'map').id, deckVisible: true}},
  theme: {accent: '#64d5c8'},
};
document.title = `${scenario.title}｜今日配送計畫｜澎湖疫苗配送模擬`;

app = createApp(document.querySelector('#app'), manifest);
// App-owned shell adapter; the vendored kit stays byte-for-byte unchanged.
const topbar = document.querySelector('.topbar');
const checkSwitch = document.createElement('nav');
checkSwitch.className = 'daily-check-switch'; checkSwitch.setAttribute('aria-label', '檢查情境');
for (const check of SCENARIOS) {
  const link = document.createElement('a'); link.textContent = check.title;
  link.href = scenarioHref(check, location.href);
  if (check.id === scenario.id) link.setAttribute('aria-current', 'page');
  checkSwitch.append(link);
}
topbar.querySelector('.brand').after(checkSwitch);
const headerTime = document.createElement('output'); headerTime.className = 'daily-header-time';
topbar.querySelector('.topbar-controls').prepend(headerTime);
const settingsBody = document.querySelector('.app-settings > div');
settingsBody.prepend(...document.querySelector('.panel-manager > div').children);
document.querySelector('.panel-manager').hidden = true;
app.clock.pause();
// The shell starts its interval during createApp. Seeking after pause refreshes the shell's play label.
app.clock.seek(0);
// The shell owns these controls. A manual seek ends the trial arrival stop,
// while its play/pause button can still pause and resume that same flight.
// Pinned-kit adapter: replace these listeners when core exposes seek intent.
// Owner and removal condition: OpenSpec core-panel-follow-up.md (clock events).
const replayControls = document.querySelector('.replay-controls');
for (const [caption, minute] of [['從頭', startMin], ['日終', endMin]]) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = caption;
  button.addEventListener('click', () => actions.seekMinute(minute));
  replayControls.append(button);
}
const seekTargets = [replayControls?.querySelector('input[type="range"]'),
  replayControls?.querySelectorAll('button')[1], replayControls?.querySelectorAll('button')[2]].filter(Boolean);
const onGlobalSeek = () => stopTrialPlayback();
for (const target of seekTargets) target.addEventListener(target.tagName === 'INPUT' ? 'input' : 'click', onGlobalSeek, true);
dailyMap = createDailyMap({
  map: app.map,
  scenarioId: scenario.id,
  hazardVisible: store.get().hazardVisible,
  run,
  onStatus(status) {
    store.set({mapStatus: status});
  },
  onFieldStatus: fieldStatus => store.set({fieldStatus}),
  onCamera: camera => store.set({camera, focusedResourceId: camera.mode === 'free' ? null : camera.resourceId}),
  onHazardVisibility: hazardVisible => store.set({hazardVisible}),
  onSelectResource: id => actions.selectResource(id, {focus: true}),
  onSelectOrder: id => actions.selectOrder(id, {focus: true}),
});
const stopClock = app.clock.subscribe(elapsedMs => {
  if (trialArrivalElapsed != null && elapsedMs >= trialArrivalElapsed) {
    const arrival = trialArrivalElapsed;
    trialArrivalElapsed = null;
    app.clock.pause();
    app.clock.seek(arrival);
    return;
  }
  const timeMin = Math.min(endMin, startMin + elapsedMs / 60_000);
  const snapshot = snapshotAt(run, timeMin);
  headerTime.textContent = `${run.fixture.date} · ${minuteLabel(timeMin)}`;
  store.set({snapshot});
  dailyMap.update(snapshot);
  if (elapsedMs >= duration && !app.clock.paused) {
    app.clock.pause();
    app.clock.seek(duration);
  }
});

// Inspection hook for browser acceptance of the shared snapshot and replay.
window.dailySimulation = {
  run,
  app,
  get snapshot() { return store.get().snapshot; },
  get state() { return store.get(); },
  seekMinute: actions.seekMinute,
  playTrial: actions.playTrial,
  destroy() {
    for (const target of seekTargets) target.removeEventListener(target.tagName === 'INPUT' ? 'input' : 'click', onGlobalSeek, true);
    stopClock(); dailyMap.destroy(); app.destroy(); delete window.dailySimulation;
  },
};
