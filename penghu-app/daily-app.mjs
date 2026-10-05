import {createApp} from './vendor/panel-core/core.js';
import {BASELINE_FIXTURE} from './daily-fixture.mjs';
import {simulateDay, snapshotAt} from './daily-simulation.mjs';
import {createDailyMap} from './daily-map.mjs';
import {createDailyPanels, minuteLabel, joinRiskReasons} from './daily-panels.mjs';
import {createCameraControls, createHazardControls} from './daily-controls.mjs';
import {createTrialPlanner} from './daily-route-panel.mjs';
import {FLIGHT_LEAD_H} from './scenario-clock.mjs';
import {resolveScenario, SCENARIOS, scenarioHref} from './scenario.mjs';
import {createOpsStore} from './ops-state.mjs';
import {createWorld} from './ops-world.mjs';
import {loadField} from './planner.mjs';
import {verifyAdopted, verifyMonitoring} from './ops-monitor.mjs';
import {createOpsPlanPanels} from './ops-plan-ui.mjs';
import {createRiskScenarioPanel} from './ops-risk-ui.mjs';
import {schedule, proposeRiskPatch, testConnection, loadReplay} from './ops-ai.mjs';
import {appendOpsSettings} from './ops-settings.mjs';
import {createDataSource} from './data-sources.mjs';

// daily-gate.mjs has already refused an unknown ?scenario=.
const {scenario} = resolveScenario(location.search);
const isRisk = scenario.id === 'risk';
const isDelivery = scenario.id === 'monitor';
const opsStore = createOpsStore();
const metaResponse = await fetch(new URL('../data/danger_frames/danger_meta.json', import.meta.url));
if (!metaResponse.ok) throw new Error(`風險資料 HTTP ${metaResponse.status}`);
const meta = await metaResponse.json();
const landmaskResponse = await fetch(new URL('../data/penghu_landmask.json', import.meta.url));
if (!landmaskResponse.ok) throw new Error(`陸地遮罩資料 HTTP ${landmaskResponse.status}`);
const landmask = await landmaskResponse.json();
const world = createWorld(meta);
// The replay fetch never rejects, so it can run beside the field fetch.
const [field, replay] = await Promise.all([
  loadField(meta, new URL('../data/danger_frames/router_field.bin', import.meta.url)), loadReplay()]);
const verified = verifyMonitoring(opsStore.get(), world, field);
if (verified.changed) opsStore.set({adopted: verified.adopted});

const run = isDelivery ? verified.run : simulateDay(BASELINE_FIXTURE);
const startMin = run.startMin;
const endMin = run.endMin;
const duration = (endMin - startMin) * 60_000;
const initialSnapshot = snapshotAt(run, startMin);
const initialResourceId = isDelivery ? run.fixture.resources.find(resource => resource.type === 'drone')?.id
  ?? run.fixture.resources[0]?.id ?? 'trial' : 'trial';
const listeners = new Set();
let state = {
  scenarioId: scenario.id,
  snapshot: initialSnapshot,
  selectedOrderId: run.fixture.plan.sequence[0],
  selectedEventId: null,
  focusedResourceId: null,
  mapStatus: {ready: false},
  camera: {mode: 'free', resourceId: initialResourceId},
  // Planning and monitoring start with a clear map; risk opens the shared field.
  hazardVisible: isRisk,
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
let previewRun = null;
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
      const reset = {mode: 'free', resourceId: initialResourceId};
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
const {dailyPlan, orderDetail, resourceStatus} = createDailyPanels({run, store, actions, adopted: isDelivery && Boolean(verified.adopted), compactResources: isDelivery});
const cameraControls = createCameraControls({run, store, actions, scenarioId: scenario.id});
const hazardControls = createHazardControls({store, actions, legendOpen: isRisk, explanationCollapsed: isRisk, meta, fixture: run.fixture});
const trialPlanner = createTrialPlanner({run, store, actions, risk: opsStore.get().risk, world, compactResults: isRisk});
const {ordersPanel, vehiclesPanel, schedulePanel} = createOpsPlanPanels({opsStore, world,
  scheduleAI: (state, {onProgress} = {}) => schedule({state, world, field, replay, onProgress}),
  onPreview(preview) {
    previewRun = preview;
    if (!dailyMap) return;
    dailyMap.setRun(preview ?? {...run, movements: [], fixture: {...run.fixture, sites: world.nodes, resources: []}});
    dailyMap.update(snapshotAt(preview ?? run, store.get().snapshot.timeMin));
  },
  onAdopt() { updateAdoptedChip(); },
});
const riskScenario = createRiskScenarioPanel({state: opsStore, world,
  onRiskChange(risk) {
    opsStore.set({risk});
    dailyMap?.setRisk(risk, world.nodes); trialPlanner.setRisk(risk, world);
    const check = verifyAdopted(opsStore.get(), world, field);
    if (check.changed) opsStore.set({adopted: check.adopted});
  },
  proposeRiskPatch: ({sentence, risk}) => proposeRiskPatch({sentence, risk, nodes: world.nodes, ai: opsStore.get().ai, replay}),
});
// Desktop presets fit 1600×1000; risk uses finer 30px rows for its two stacks.
const presets = {
  monitor: [
    {id: 'map', type: 'map', x: 0, y: 0, w: 6, h: 7},
    {id: 'daily-plan', type: 'dailyPlan', x: 6, y: 0, w: 3, h: 10},
    {id: 'order-detail', type: 'orderDetail', x: 9, y: 0, w: 3, h: 10},
    {id: 'resource-status', type: 'resourceStatus', x: 0, y: 7, w: 4, h: 3},
    {id: 'camera-controls', type: 'cameraControls', x: 4, y: 7, w: 2, h: 3},
  ],
  risk: [
    {id: 'map', type: 'map', x: 0, y: 0, w: 7, h: 23},
    {id: 'hazard-controls', type: 'hazardControls', x: 0, y: 23, w: 7, h: 7},
    {id: 'risk-scenario', type: 'riskScenario', x: 7, y: 0, w: 5, h: 15},
    {id: 'trial-planner', type: 'trialPlanner', x: 7, y: 15, w: 5, h: 9},
    {id: 'camera-controls', type: 'cameraControls', x: 7, y: 24, w: 5, h: 6},
  ],
  plan: [
    {id: 'map', type: 'map', x: 0, y: 0, w: 7, h: 6},
    {id: 'ops-schedule', type: 'opsSchedule', x: 7, y: 0, w: 5, h: 6},
    {id: 'ops-orders', type: 'opsOrders', x: 0, y: 6, w: 6, h: 3},
    {id: 'ops-vehicles', type: 'opsVehicles', x: 6, y: 6, w: 6, h: 3},
  ],
};
const preset = presets[scenario.id];
// Decorate our panel views once; prompts and engine/replay inputs stay untouched.
function withDataSource(panel, kind) {
  return {...panel,
    render(container, ...args) {
      const view = panel.render(container, ...args);
      const sourceView = createDataSource({kind, meta, landmask, fixture: run.fixture, opsStore});
      const chip = view.root.querySelector('.ops-mode-chip, .ops-risk-chip');
      if (chip) chip.id = `ops-ai-source-mode-${panel.id}`;
      if (kind === 'hazard') view.root.append(sourceView.root);
      else view.root.prepend(sourceView.root);
      return {...view, sourceView};
    },
    dispose(view) { view.sourceView.stop(); panel.dispose?.(view); },
  };
}
const manifest = {
  version: 1,
  // Each check remembers its own layout under its own ID.
  id: `penghu-vaccine-daily-${scenario.id}-${isDelivery ? 'v5' : isRisk ? 'v8' : 'v5'}`,
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
  // Core refuses to mount a disabled type, but still emits map selections.
  // Our order/resource panels own selection details instead of a generic popup.
  panelTypes: {selection: null,
    dailyPlan: withDataSource(dailyPlan, 'fixture'), orderDetail: withDataSource(orderDetail, 'fixture'),
    resourceStatus: withDataSource(resourceStatus, 'fixture'), cameraControls: withDataSource(cameraControls, 'camera'),
    hazardControls: withDataSource(hazardControls, 'hazard'), trialPlanner: withDataSource(trialPlanner, 'trial'),
    opsOrders: withDataSource(ordersPanel, 'fixture'), opsVehicles: withDataSource(vehiclesPanel, 'fixture'),
    opsSchedule: withDataSource(schedulePanel, 'schedule'), riskScenario: withDataSource(riskScenario, 'risk')},
  // Every panel type stays available in every check; only the preset differs.
  catalogue: [
    {id: 'ops-orders', type: 'opsOrders', titleKey: '訂單', icon: '▤', defaultSize: {w: 6, h: 4}},
    {id: 'ops-vehicles', type: 'opsVehicles', titleKey: '運具', icon: '▣', defaultSize: {w: 6, h: 5}},
    {id: 'ops-schedule', type: 'opsSchedule', titleKey: '排程', icon: '⌁', defaultSize: {w: 6, h: 4}},
    {id: 'risk-scenario', type: 'riskScenario', titleKey: '風險情境', icon: '◐', defaultSize: {w: 3, h: 6}},
    {id: 'map', type: 'map', titleKey: '配送地圖', icon: '⌖', defaultSize: {w: 6, h: 7}},
    {id: 'daily-plan', type: 'dailyPlan', titleKey: '今日配送計畫', icon: '▤', defaultSize: {w: 3, h: 7}},
    {id: 'order-detail', type: 'orderDetail', titleKey: '訂單詳情', icon: '▧', defaultSize: {w: 3, h: 7}},
    {id: 'camera-controls', type: 'cameraControls', titleKey: '視角', icon: '◉', defaultSize: {w: 4, h: 5}},
    {id: 'hazard-controls', type: 'hazardControls', titleKey: '風險場', icon: '◐', defaultSize: {w: 4, h: 5}},
    {id: 'trial-planner', type: 'trialPlanner', titleKey: '航線試算', icon: '⌁', defaultSize: {w: 4, h: 5}},
    {id: 'resource-status', type: 'resourceStatus', titleKey: '運具狀態', icon: '▣', defaultSize: {w: 4, h: 4}},
  ],
  preset,
  layout: {phone: {order: preset.filter(item => item.type !== 'map').map(item => item.id),
    activeId: preset.find(item => item.type !== 'map').id, deckVisible: true}},
  theme: {accent: '#64d5c8'},
};
document.title = `${scenario.title}｜今日配送計畫｜澎湖疫苗配送模擬`;

app = createApp(document.querySelector('#app'), manifest);
const mapSource = createDataSource({kind: 'map', meta, landmask, fixture: run.fixture, opsStore});
// Finer rows let risk's two stacks share the viewport without empty columns.
document.querySelector('.panel-grid').gridstack.cellHeight(isRisk ? 30 : scenario.id === 'plan' ? 91 : 90);
mapSource.root.classList.add('daily-map-source');
const mountMapSource = () => {
  const body = document.querySelector('.panel-map .panel-body');
  if (body && mapSource.root.parentElement !== body) body.append(mapSource.root);
};
mountMapSource();
const mapSourceMount = new MutationObserver(mountMapSource);
mapSourceMount.observe(document.querySelector('.panel-grid'), {childList: true, subtree: true});
document.querySelector('.panel-core-app').dataset.scenario = scenario.id;
// Disabling the generic panel skips core's highlight call; keep that map behavior.
const stopSelectionHighlight = app.map.subscribe('select', ({entity}) => {
  app.map.send('highlight', {ids: entity ? [entity.id] : []});
});
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
const adoptedChip = document.createElement('span'); adoptedChip.className = 'ops-adopted-chip';
checkSwitch.after(adoptedChip);
function updateAdoptedChip() {
  const adopted = opsStore.get().adopted;
  const mode = adopted?.plan.modeLabel ?? '';
  const model = adopted?.plan.model || mode.match(/^即時模型：(.+)$/)?.[1] || mode.match(/^示範回放（錄製自 ([^，]+)，/)?.[1] || '';
  const replay = adopted?.plan.mode === 'replay' || mode.includes('示範回放');
  adoptedChip.textContent = adopted ? `採用方案 · ${mode.includes('規則') ? '規則排程' : `${replay ? '示範回放' : '即時模型'}${model ? ` · ${model}` : ''}`}` : '今日基準計畫';
  adoptedChip.title = adopted ? `${mode} · 採用時間 ${new Date(adopted.adoptedAt ?? adopted.verifiedAt).toLocaleString('zh-TW', {hour12: false})}` : '';
}
const stopOpsHeader = opsStore.subscribe(updateAdoptedChip);
if (isDelivery && verified.failures.length) {
  const bar = document.createElement('aside'); bar.className = 'ops-risk-bar'; bar.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.textContent = `方案在目前風險情境下不成立：${verified.failures.map(failure => `${failure.label} ${minuteLabel(failure.timeMin)} 起（${joinRiskReasons(failure.reasons_zh)}）`).join('、')}`;
  const link = document.createElement('a'); link.textContent = '重新規劃';
  link.href = scenarioHref(SCENARIOS.find(item => item.id === 'plan'), location.href);
  bar.append(message, link); topbar.after(bar);
}
const settingsBody = document.querySelector('.app-settings > div');
appendOpsSettings(settingsBody, {opsStore, testConnection});
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
// Planning uses a stationary itinerary preview; transport belongs to monitoring.
if (scenario.id === 'plan') replayControls.hidden = true;
const failureMarkers = [];
if (isDelivery) for (const failure of verified.failures) {
  const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'ops-failure-marker';
  marker.title = `${failure.label} ${minuteLabel(failure.timeMin)} 起不成立`;
  marker.setAttribute('aria-label', marker.title); marker.addEventListener('click', () => actions.seekMinute(failure.timeMin));
  replayControls.append(marker); failureMarkers.push({marker, failure});
}
const positionFailureMarkers = () => {
  const range = replayControls.querySelector('input[type="range"]'); if (!range) return;
  const parent = replayControls.getBoundingClientRect(), track = range.getBoundingClientRect();
  for (const {marker, failure} of failureMarkers) marker.style.left = `${track.left - parent.left + (track.width - 14) * (failure.timeMin - startMin) / (endMin - startMin) + 7}px`;
};
requestAnimationFrame(positionFailureMarkers); window.addEventListener('resize', positionFailureMarkers);
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
  run: scenario.id === 'plan' ? {...run, movements: [], fixture: {...run.fixture, sites: world.nodes, resources: []}} : run,
  risk: opsStore.get().risk,
  nodes: world.nodes,
  field,
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
  dailyMap.update(scenario.id === 'plan' && previewRun ? snapshotAt(previewRun, timeMin) : snapshot);
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
  get opsState() { return opsStore.get(); },
  seekMinute: actions.seekMinute,
  playTrial: actions.playTrial,
  destroy() {
    mapSourceMount.disconnect();
    mapSource.stop();
    stopSelectionHighlight();
    stopOpsHeader();
    window.removeEventListener('resize', positionFailureMarkers);
    for (const target of seekTargets) target.removeEventListener(target.tagName === 'INPUT' ? 'input' : 'click', onGlobalSeek, true);
    stopClock(); dailyMap.destroy(); app.destroy(); delete window.dailySimulation;
  },
};
