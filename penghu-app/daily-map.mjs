import {DEFAULT_RISK} from './risk-scenario.mjs';

/** Bridge the public panel-core map facade to Penghu's snapshot-only viewer. */
export function createDailyMap({map, run, onStatus = () => {}, onSelectResource, onSelectOrder,
  onFieldStatus = () => {}, onCamera = () => {}, onHazardVisibility = () => {}, hazardVisible: initialHazardVisible = true,
  scenarioId = 'monitor', risk = DEFAULT_RISK, nodes = [], field = null}) {
  let activeRun = run;
  let sites = activeRun?.fixture?.sites ?? [];
  let ready = false, latest = null, focused = null, destroyed = false;
  let camera = {mode: 'free', resourceId: activeRun?.fixture?.resources?.[0]?.id ?? 'trial'};
  let hazardVisible = initialHazardVisible, trialPlan = null, activeRisk = risk, riskNodes = nodes;
  const send = (name, payload) => map.send('appCommand', {name, payload});
  const includesResources = () => ['monitor', 'plan', 'delivery'].includes(scenarioId);
  const initPayload = () => ({sites: activeRun?.fixture?.sites ?? sites,
    movements: includesResources() ? activeRun?.movements ?? [] : [],
    resources: includesResources() ? activeRun?.fixture?.resources ?? [] : []});
  const sendInit = () => {
    send('daily:init', initPayload());
    send('daily:options', {camera, hazardVisible});
    send('daily:risk', {risk: activeRisk, nodes: riskNodes, field});
    send('daily:trial', trialPlan);
    if (latest) send('daily:snapshot', latest);
    if (focused) send('daily:focus', focused);
  };
  const stops = [];
  stops.push(map.subscribe('appEvent', ({name, payload}) => {
    if (destroyed) return;
    if (name === 'twin:ready' && payload?.daily) {
      ready = true;
      sendInit();
    } else if (name === 'daily:rendered' && ready) {
      onStatus({ready: true, timeMin: payload.timeMin, runId: payload.runId});
    } else if (name === 'daily:field-status') {
      onFieldStatus(payload);
    } else if (name === 'daily:camera') {
      camera = payload; focused = null; onCamera(camera);
    } else if (name === 'daily:hazard-visibility') {
      hazardVisible = payload.visible; onHazardVisibility(hazardVisible);
    } else if (name === 'daily:error' || name === 'extension-error') {
      ready = false;
      onStatus({ready: false, error: payload?.message || '地圖載入失敗'});
    }
  }));
  stops.push(map.subscribe('ready', () => {
    ready = false;
    onStatus({ready: false});
    // The extension may load after the map handshake. It also emits its own
    // readiness once installed, so both early and late subscriptions recover.
    send('daily:hello', {});
  }));
  stops.push(map.subscribe('select', ({entity}) => {
    const id = entity?.id;
    if (id?.startsWith('daily-resource-')) onSelectResource?.(id.slice('daily-resource-'.length));
    if (id?.startsWith('daily-order-')) onSelectOrder?.(id.slice('daily-order-'.length));
  }));
  return {
    setRun(nextRun) {
      if (destroyed) return;
      activeRun = nextRun;
      if (nextRun?.fixture?.sites) sites = nextRun.fixture.sites;
      latest = null;
      focused = null;
      camera = {mode: 'free', resourceId: activeRun?.fixture?.resources?.[0]?.id ?? 'trial'};
      if (ready) sendInit();
    },
    setRisk(nextRisk, nextNodes = riskNodes) {
      if (destroyed) return;
      activeRisk = nextRisk;
      riskNodes = nextNodes ?? [];
      if (ready) send('daily:risk', {risk: activeRisk, nodes: riskNodes});
    },
    update(snapshot) { if (destroyed) return; latest = snapshot; if (ready) send('daily:snapshot', snapshot); },
    focusResource(id) { camera = {mode: 'free', resourceId: id}; focused = {resourceId: id}; if (ready) send('daily:focus', focused); },
    focusSite(id) {
      if (!sites.some(site => site.id === id)) return;
      camera = {...camera, mode: 'free'}; focused = {siteId: id};
      if (ready) send('daily:focus', focused);
    },
    overview() { camera = {...camera, mode: 'free'}; focused = null; if (ready) send('daily:overview', {}); },
    setCamera(value) { camera = value; focused = null; if (ready) send('daily:options', {camera, hazardVisible}); },
    setHazardVisible(value) { hazardVisible = value; if (ready) send('daily:options', {camera, hazardVisible}); },
    setTrialPlan(value) {
      trialPlan = value;
      const restore = !value && (focused?.trial || camera.resourceId === 'trial');
      if (restore) focused = null;
      if (!value && camera.resourceId === 'trial') camera = {mode: 'free', resourceId: activeRun?.fixture?.resources?.[0]?.id ?? 'trial'};
      if (ready) {
        send('daily:trial', value);
        if (restore) send('daily:overview', {});
      }
    },
    focusTrial() { camera = {mode: 'free', resourceId: 'trial'}; focused = {trial: true}; if (ready) send('daily:focus', focused); },
    frameTrial() {
      camera = {...camera, resourceId: 'trial'};
      focused = camera.mode === 'free' ? {trial: true} : null;
      if (ready) {
        send('daily:options', {camera, hazardVisible});
        if (camera.mode === 'free') send('daily:frame-trial', {});
      }
    },
    destroy() { if (destroyed) return; destroyed = true; for (const stop of stops) stop(); },
  };
}
