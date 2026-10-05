import { BASELINE_FIXTURE } from './daily-fixture.mjs';

const EPS = 1e-8;
const fail = (message) => { throw new Error(`Invalid daily fixture: ${message}`); };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const within = (value, low, high) => Math.max(low, Math.min(high, value));

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function pathLengthKm(path) {
  return path.slice(1).reduce((sum, point, index) => sum + distanceKm(path[index], point), 0);
}

function positionOnPath(path, fraction, altitudeM) {
  const distances = path.slice(1).map((point, index) => distanceKm(path[index], point));
  const total = distances.reduce((sum, length) => sum + length, 0);
  let remaining = within(fraction, 0, 1) * total;
  for (let i = 0; i < distances.length; i++) {
    if (remaining <= distances[i] || i === distances.length - 1) {
      const ratio = distances[i] === 0 ? 0 : within(remaining / distances[i], 0, 1);
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * ratio,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * ratio,
        altitudeM,
      };
    }
    remaining -= distances[i];
  }
  return { ...path.at(-1), altitudeM };
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') fail('fixture must be an object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fixture.date) || fixture.timezone !== 'Asia/Taipei') fail('date and Asia/Taipei timezone are required');
  if (!finite(fixture.startMin) || !finite(fixture.endMin) || fixture.startMin >= fixture.endMin) fail('invalid day bounds');
  if (!Array.isArray(fixture.sites) || !Array.isArray(fixture.resources) || !Array.isArray(fixture.orders) || !Array.isArray(fixture.routes)) fail('sites, resources, orders and routes must be arrays');
  const unique = (items, name) => {
    if (items.some((item) => !item?.id) || new Set(items.map((item) => item.id)).size !== items.length) fail(`${name} IDs must be present and unique`);
  };
  for (const [items, name] of [[fixture.sites, 'site'], [fixture.resources, 'resource'], [fixture.orders, 'order'], [fixture.routes, 'route']]) unique(items, name);
  const sites = new Map(fixture.sites.map((site) => [site.id, site]));
  const resources = new Map(fixture.resources.map((resource) => [resource.id, resource]));
  const orders = new Map(fixture.orders.map((order) => [order.id, order]));
  const routes = new Map(fixture.routes.map((route) => [route.id, route]));
  if (fixture.sites.length !== 5 || fixture.resources.length !== 3 || fixture.orders.length !== 2) fail('MVP 1 requires five sites, three resources and two orders');
  for (const site of fixture.sites) if (!finite(site.lat) || !finite(site.lng) || Math.abs(site.lat) > 90 || Math.abs(site.lng) > 180) fail(`invalid coordinates at ${site.id}`);
  for (const id of ['depot', 'magong-clinic', 'magong-transfer', 'qimei-transfer', 'qimei-clinic']) if (!sites.has(id)) fail(`missing site ${id}`);
  for (const [id, type] of [['V-01', 'van'], ['D-01', 'drone'], ['V-02', 'van']]) {
    const resource = resources.get(id);
    if (!resource || resource.type !== type) fail(`missing ${type} resource ${id}`);
  }
  for (const resource of fixture.resources) {
    if (!sites.has(resource.initialSiteId)) fail(`unknown initial site for ${resource.id}`);
    if (!positive(resource.initialEnergyWh) || !finite(resource.reserveWh) || resource.reserveWh < 0 || resource.reserveWh > resource.initialEnergyWh) fail(`invalid energy/reserve for ${resource.id}`);
    if (!positive(resource.capacityKg) || !positive(resource.capacityL)) fail(`invalid capacity for ${resource.id}`);
    const p = resource.mockProfile;
    if (!p || !['idleW', 'handlingW', 'movingW', 'travelWhPerKm'].every((key) => finite(p[key]) && p[key] >= 0)) fail(`invalid energy profile for ${resource.id}`);
  }
  for (const id of ['ORD-MAGONG', 'ORD-QIMEI']) if (!orders.has(id)) fail(`missing order ${id}`);
  if (orders.get('ORD-MAGONG').destinationId !== 'magong-clinic' || orders.get('ORD-QIMEI').destinationId !== 'qimei-clinic') fail('order destinations do not match the fixed service plan');
  for (const order of fixture.orders) {
    if (!sites.has(order.destinationId)) fail(`unknown destination for ${order.id}`);
    if (!Number.isInteger(order.quantity) || order.quantity <= 0 || !positive(order.massKg) || !positive(order.volumeL)) fail(`invalid quantity or package for ${order.id}`);
    if (!finite(order.deadlineMin) || !Array.isArray(order.receivingWindow) || order.receivingWindow.length !== 2 || !order.receivingWindow.every(finite) || order.receivingWindow[0] > order.receivingWindow[1]) fail(`invalid receiving window/deadline for ${order.id}`);
  }
  const batch = fixture.batch;
  if (!batch?.id || !Number.isInteger(batch.quantity) || batch.quantity <= 0 || !finite(batch.availableAtMin) || batch.availableAtMin < fixture.startMin || batch.availableAtMin >= fixture.endMin || !finite(batch.initialTemperatureC)) fail('invalid incoming batch');
  if (!Array.isArray(batch.upstreamHistory) || !batch.upstreamHistory.length ||
      batch.upstreamHistory.some((sample, index) => !finite(sample.timeMin) || !finite(sample.celsius) ||
        (index > 0 && sample.timeMin <= batch.upstreamHistory[index - 1].timeMin)) ||
      Math.abs(batch.upstreamHistory.at(-1).timeMin - batch.availableAtMin) > EPS ||
      Math.abs(batch.upstreamHistory.at(-1).celsius - batch.initialTemperatureC) > EPS) fail('upstream history must end at the batch release temperature/time');
  if (fixture.orders.reduce((sum, order) => sum + order.quantity, 0) > batch.quantity) fail('orders allocate more doses than the incoming batch');
  for (const route of fixture.routes) {
    if (!sites.has(route.fromSiteId) || !sites.has(route.toSiteId) || !['road', 'air'].includes(route.mode) || !positive(route.speedKph)) fail(`invalid route ${route.id}`);
    if (!Array.isArray(route.path) || route.path.length < 2 || route.path.some((point) => !finite(point.lat) || !finite(point.lng))) fail(`invalid path for ${route.id}`);
    if (distanceKm(route.path[0], sites.get(route.fromSiteId)) > 0.01 || distanceKm(route.path.at(-1), sites.get(route.toSiteId)) > 0.01 || !positive(pathLengthKm(route.path))) fail(`route ${route.id} does not join its declared sites`);
  }
  const bounds = fixture.profile?.temperatureBoundsC;
  if (!Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(finite) || bounds[0] >= bounds[1] || !positive(fixture.profile.sampleEveryMin)) fail('invalid temperature bounds/sample interval');
  for (const id of ['depotCold', 'packing', 'handling', 'vanCold', 'droneBox', 'transferWait', 'receiving', 'clinicCold']) {
    const profile = fixture.profile.thermal?.[id];
    if (!profile || !finite(profile.ambientC) || !positive(profile.tauMin)) fail(`invalid thermal profile ${id}`);
  }
  const plan = fixture.plan;
  if (JSON.stringify(plan?.sequence) !== JSON.stringify(['ORD-QIMEI', 'ORD-MAGONG'])) fail('MVP 1 requires Qimei drone handover before the local order');
  if (!finite(plan.v02ApproachStartMin) || plan.v02ApproachStartMin < fixture.startMin) fail('invalid V-02 approach start');
  for (const id of ['packQimei', 'packMagong', 'loadQimei', 'loadMagong', 'handoverOrigin', 'handoverQimei', 'receiveQimei', 'receiveMagong']) {
    if (!positive(plan.durationsMin?.[id])) fail(`invalid handling duration ${id}`);
  }
  return { sites, resources, orders, routes };
}

export function thermalAt(startC, profile, elapsedMin) {
  return profile.ambientC + (startC - profile.ambientC) * Math.exp(-elapsedMin / profile.tauMin);
}

export function excursionInPhase(phase, elapsedMin, bounds) {
  const duration = within(elapsedMin, 0, phase.endMin - phase.startMin);
  const breaks = [0, duration];
  for (const bound of bounds) {
    const denominator = phase.startC - phase.profile.ambientC;
    const ratio = (bound - phase.profile.ambientC) / denominator;
    if (ratio > 0 && Number.isFinite(ratio)) {
      const crossing = -phase.profile.tauMin * Math.log(ratio);
      if (crossing > 0 && crossing < duration) breaks.push(crossing);
    }
  }
  breaks.sort((a, b) => a - b);
  let minutes = 0;
  for (let i = 1; i < breaks.length; i++) {
    const midpointC = thermalAt(phase.startC, phase.profile, (breaks[i - 1] + breaks[i]) / 2);
    if (midpointC < bounds[0] || midpointC > bounds[1]) minutes += breaks[i] - breaks[i - 1];
  }
  return minutes;
}

export function thermalStatsAt(phases, timeMin, bounds) {
  if (!phases.length || timeMin < phases[0].startMin) return { temperatureC: null, minTemperatureC: null, maxTemperatureC: null, excursionMinutes: 0 };
  let minTemperatureC = phases[0].startC;
  let maxTemperatureC = phases[0].startC;
  let excursionMinutes = 0;
  let temperatureC = phases[0].startC;
  for (const phase of phases) {
    if (timeMin < phase.startMin) break;
    const elapsed = within(timeMin - phase.startMin, 0, phase.endMin - phase.startMin);
    temperatureC = thermalAt(phase.startC, phase.profile, elapsed);
    minTemperatureC = Math.min(minTemperatureC, temperatureC);
    maxTemperatureC = Math.max(maxTemperatureC, temperatureC);
    excursionMinutes += excursionInPhase(phase, elapsed, bounds);
    if (timeMin <= phase.endMin) break;
  }
  return { temperatureC, minTemperatureC, maxTemperatureC, excursionMinutes };
}

export function energyAt(resource, activities, startMin, timeMin) {
  const elapsed = Math.max(0, timeMin - startMin);
  const p = resource.mockProfile;
  let spentWh = elapsed * p.idleW / 60;
  for (const activity of activities) {
    const duration = Math.max(0, Math.min(timeMin, activity.endMin) - activity.startMin);
    if (!duration) continue;
    const drawW = activity.status === 'moving' ? p.movingW :
      ['loading', 'handover', 'receiving'].includes(activity.status) ? p.handlingW : p.idleW;
    spentWh += duration * (drawW - p.idleW) / 60;
    if (activity.movement) spentWh += activity.movement.distanceKm * p.travelWhPerKm * duration / (activity.endMin - activity.startMin);
  }
  return resource.initialEnergyWh - spentWh;
}

function resourceAt(run, resource, timeMin) {
  const activities = run._resourceActivities[resource.id];
  let siteId = resource.initialSiteId;
  let active = null;
  for (const activity of activities) {
    if (timeMin < activity.startMin) break;
    if (timeMin < activity.endMin) { active = activity; break; }
    if (activity.movement) siteId = activity.movement.toSiteId;
  }
  const site = run._sites.get(active && !active.movement ? active.siteId : siteId);
  const movement = active?.movement;
  const fraction = movement ? (timeMin - movement.startMin) / (movement.endMin - movement.startMin) : 0;
  const position = movement
    ? positionOnPath(movement.path, fraction, movement.mode === 'air' ? Math.sin(Math.PI * fraction) * (movement.cruiseAltitudeM ?? 120) : 0)
    : { lat: site.lat, lng: site.lng, altitudeM: 0 };
  const lastEnd = activities.at(-1)?.endMin ?? run.startMin;
  const terminal = timeMin >= lastEnd - EPS;
  const status = active?.status ?? (terminal ? run._terminalStatuses[resource.id] : 'idle');
  const activity = active?.activity ?? (terminal ? run._terminalLabels[resource.id] : '待命');
  const energyWh = energyAt(resource, activities, run.startMin, timeMin);
  return { id: resource.id, label: resource.label, type: resource.type, status, position,
    siteId: movement ? null : (active?.siteId ?? siteId), energyWh,
    energyPercent: 100 * energyWh / resource.initialEnergyWh, reserveWh: resource.reserveWh,
    orderIds: active?.orderIds ?? (terminal ? run._terminalOrderIds?.[resource.id] : null) ?? [], activity };
}

export function snapshotAt(run, timeMin) {
  if (!run || run.schemaVersion !== 1 || !finite(timeMin)) throw new Error('snapshotAt requires a simulation run and finite timeMin');
  const t = within(timeMin, run.startMin, run.endMin);
  const resources = run.fixture.resources.map((resource) => resourceAt(run, resource, t));
  const orders = run.fixture.orders.map((order) => {
    const phases = run._orderPhases[order.id];
    const current = phases.find((phase) => t >= phase.startMin && t < phase.endMin) ?? (t >= phases.at(-1).endMin ? phases.at(-1) : null);
    const stats = thermalStatsAt(phases, t, run._bounds);
    const deliveredAtMin = t >= run._deliveryTimes[order.id] ? run._deliveryTimes[order.id] : null;
    const status = t < run._allocations[order.id] ? 'awaiting-supply' : current.status;
    return { id: order.id, label: order.label, quantity: order.quantity,
      status: deliveredAtMin !== null && (stats.excursionMinutes > EPS || run.incoming.requiresAssessment) ? 'pending-assessment' : status,
      custodianId: current?.custodianId ?? null, ...stats, deliveredAtMin };
  });
  const released = t >= run.fixture.batch.availableAtMin;
  const allocated = run.fixture.orders.filter((order) => t >= run._allocations[order.id]);
  const availableQuantity = released ? run.fixture.batch.quantity - allocated.reduce((sum, order) => sum + order.quantity, 0) : 0;
  const reservedQuantity = allocated.filter((order) => t < run._dispatchTimes[order.id]).reduce((sum, order) => sum + order.quantity, 0);
  const deliveredQuantity = allocated.filter((order) => t >= run._deliveryTimes[order.id]).reduce((sum, order) => sum + order.quantity, 0);
  const inTransitQuantity = allocated.reduce((sum, order) => sum + order.quantity, 0) - reservedQuantity - deliveredQuantity;
  return { runId: run.id, timeMin: t, resources, orders,
    inventory: { released, totalQuantity: run.fixture.batch.quantity, availableQuantity,
      reservedQuantity, inTransitQuantity, deliveredQuantity, remainingQuantity: availableQuantity } };
}

export function simulateDay(fixture = BASELINE_FIXTURE) {
  const input = structuredClone(fixture);
  const { sites, resources, orders, routes } = validateFixture(input);
  const { startMin, endMin, batch, plan } = input;
  // Upstream travel is external, but supplied abnormal records still follow
  // both consignments. Do not infer exposure duration between those readings.
  const incoming = {
    history: batch.upstreamHistory.map(sample => ({...sample})),
    minTemperatureC: Math.min(...batch.upstreamHistory.map(sample => sample.celsius)),
    maxTemperatureC: Math.max(...batch.upstreamHistory.map(sample => sample.celsius)),
    requiresAssessment: batch.upstreamHistory.some(sample => sample.celsius < input.profile.temperatureBoundsC[0] || sample.celsius > input.profile.temperatureBoundsC[1]),
  };
  const qimei = orders.get('ORD-QIMEI');
  const magong = orders.get('ORD-MAGONG');
  const service = plan.durationsMin;
  const events = [];
  const movements = [];
  const activities = Object.fromEntries(input.resources.map((resource) => [resource.id, []]));
  const orderPhases = Object.fromEntries(input.orders.map((order) => [order.id, []]));
  const allocations = {};
  const dispatchTimes = {};
  const deliveryTimes = {};
  const event = (timeMin, type, label, orderId = null, resourceIds = [], siteId = null) => {
    events.push({ id: `EV-${String(events.length + 1).padStart(2, '0')}`, timeMin, type, label,
      ...(orderId ? { orderId } : {}), resourceIds, ...(siteId ? { siteId } : {}) });
  };
  const action = (resourceId, start, end, status, siteId, orderIds, activity, movement = null) => {
    if (end > start + EPS) activities[resourceId].push({ startMin: start, endMin: end, status, siteId, orderIds, activity, movement });
  };
  const move = (resourceId, routeId, start, orderIds) => {
    const route = routes.get(routeId);
    if (!route) fail(`missing route ${routeId}`);
    const resource = resources.get(resourceId);
    if ((resource.type === 'drone' ? 'air' : 'road') !== route.mode) fail(`${resourceId} cannot use ${route.mode} route ${routeId}`);
    for (const orderId of orderIds) {
      const order = orders.get(orderId);
      if (order.massKg > resource.capacityKg || order.volumeL > resource.capacityL) fail(`${resourceId} capacity exceeded by ${orderId}`);
    }
    const distance = pathLengthKm(route.path);
    const end = start + distance / route.speedKph * 60;
    const movement = { id: `MOVE-${String(movements.length + 1).padStart(2, '0')}`, resourceId,
      orderIds, mode: route.mode, fromSiteId: route.fromSiteId, toSiteId: route.toSiteId,
      startMin: start, endMin: end, path: route.path.map((point) => ({ ...point })), distanceKm: distance,
      ...(route.mode === 'air' ? { cruiseAltitudeM: route.cruiseAltitudeM ?? 120 } : {}) };
    movements.push(movement);
    action(resourceId, start, end, 'moving', null, orderIds, route.mode === 'air' ? '飛往七美' : '道路行駛', movement);
    event(start, 'movement-start', `${resourceId} 出發`, orderIds[0], [resourceId], route.fromSiteId);
    event(end, 'movement-end', `${resourceId} 抵達`, orderIds[0], [resourceId], route.toSiteId);
    return end;
  };
  const phase = (orderId, start, end, custodianId, thermalId, status) => {
    if (end > start + EPS) orderPhases[orderId].push({ startMin: start, endMin: end, custodianId, thermalId, status });
  };
  const checkHandover = (fromId, toId, siteId, start, end) => {
    const present = (id) => {
      const resource = resources.get(id);
      let location = resource.initialSiteId;
      for (const activity of activities[id].filter((item) => item.startMin < end - EPS).sort((a, b) => a.startMin - b.startMin)) {
        if (activity.movement && activity.endMin <= start + EPS) location = activity.movement.toSiteId;
        else if (activity.movement && activity.endMin > start + EPS) return false;
      }
      return location === siteId;
    };
    if (!present(fromId) || !present(toId)) fail(`handover ${fromId} to ${toId} requires both resources at ${siteId}`);
  };

  event(startMin, 'day-start', '模擬日開始');
  event(batch.availableAtMin, 'batch-release', `${batch.id} 放行 ${batch.quantity} 劑`, null, [], 'depot');

  const packQStart = batch.availableAtMin;
  const packQEnd = packQStart + service.packQimei;
  allocations[qimei.id] = packQStart;
  event(packQStart, 'allocation', `分配 ${qimei.quantity} 劑給七美`, qimei.id, [], 'depot');
  phase(qimei.id, packQStart, packQEnd, 'depot', 'packing', 'packing');
  event(packQEnd, 'packing-complete', '七美訂單完成包裝', qimei.id, [], 'depot');

  const packMStart = packQEnd;
  const packMEnd = packMStart + service.packMagong;
  allocations[magong.id] = packMStart;
  event(packMStart, 'allocation', `分配 ${magong.quantity} 劑給馬公`, magong.id, [], 'depot');
  phase(magong.id, packMStart, packMEnd, 'depot', 'packing', 'packing');
  event(packMEnd, 'packing-complete', '馬公訂單完成包裝', magong.id, [], 'depot');

  const loadQStart = packQEnd;
  const loadQEnd = loadQStart + service.loadQimei;
  action('V-01', loadQStart, loadQEnd, 'loading', 'depot', [qimei.id], '裝載七美訂單');
  phase(qimei.id, loadQStart, loadQEnd, 'depot', 'handling', 'loading');
  event(loadQStart, 'loading-start', 'V-01 開始裝載七美訂單', qimei.id, ['V-01'], 'depot');
  event(loadQEnd, 'loading-complete', '七美訂單移交 V-01', qimei.id, ['V-01'], 'depot');
  dispatchTimes[qimei.id] = loadQEnd;
  const originArrival = move('V-01', 'road-depot-origin', loadQEnd, [qimei.id]);
  const originHandoverEnd = originArrival + service.handoverOrigin;
  checkHandover('V-01', 'D-01', 'magong-transfer', originArrival, originHandoverEnd);
  action('V-01', originArrival, originHandoverEnd, 'handover', 'magong-transfer', [qimei.id], '交接七美訂單至 D-01');
  action('D-01', originArrival, originHandoverEnd, 'handover', 'magong-transfer', [qimei.id], '接收七美訂單');
  phase(qimei.id, loadQEnd, originArrival, 'V-01', 'vanCold', 'in-transit');
  phase(qimei.id, originArrival, originHandoverEnd, 'V-01', 'handling', 'handover');
  event(originArrival, 'handover-start', '馬公交接開始', qimei.id, ['V-01', 'D-01'], 'magong-transfer');
  event(originHandoverEnd, 'handover-complete', '七美訂單移交 D-01', qimei.id, ['V-01', 'D-01'], 'magong-transfer');
  const flightArrival = move('D-01', 'synthetic-air-qimei', originHandoverEnd, [qimei.id]);
  phase(qimei.id, originHandoverEnd, flightArrival, 'D-01', 'droneBox', 'in-transit');

  const depotReturn = move('V-01', 'road-origin-depot', originHandoverEnd, []);
  const loadMStart = Math.max(depotReturn, packMEnd);
  action('V-01', depotReturn, loadMStart, 'waiting', 'depot', [], '等待馬公訂單完成包裝');
  phase(magong.id, packMEnd, loadMStart, 'depot', 'depotCold', 'ready');
  const loadMEnd = loadMStart + service.loadMagong;
  action('V-01', loadMStart, loadMEnd, 'loading', 'depot', [magong.id], '裝載馬公訂單');
  phase(magong.id, loadMStart, loadMEnd, 'depot', 'handling', 'loading');
  event(loadMStart, 'loading-start', 'V-01 開始裝載馬公訂單', magong.id, ['V-01'], 'depot');
  event(loadMEnd, 'loading-complete', '馬公訂單移交 V-01', magong.id, ['V-01'], 'depot');
  dispatchTimes[magong.id] = loadMEnd;
  const magongArrival = move('V-01', 'road-depot-magong', loadMEnd, [magong.id]);
  phase(magong.id, loadMEnd, magongArrival, 'V-01', 'vanCold', 'in-transit');
  const magongReceiveStart = Math.max(magongArrival, magong.receivingWindow[0]);
  action('V-01', magongArrival, magongReceiveStart, 'waiting', 'magong-clinic', [magong.id], '等待衛生所收貨');
  phase(magong.id, magongArrival, magongReceiveStart, 'V-01', 'vanCold', 'ready');
  const magongReceiveEnd = magongReceiveStart + service.receiveMagong;
  action('V-01', magongReceiveStart, magongReceiveEnd, 'receiving', 'magong-clinic', [magong.id], '馬公衛生所驗收');
  phase(magong.id, magongReceiveStart, magongReceiveEnd, 'V-01', 'receiving', 'receiving');
  phase(magong.id, magongReceiveEnd, endMin, 'magong-clinic', 'clinicCold', 'delivered');
  deliveryTimes[magong.id] = magongReceiveEnd;
  event(magongReceiveStart, 'receiving-start', '馬公衛生所開始驗收', magong.id, ['V-01'], 'magong-clinic');
  event(magongReceiveEnd, 'delivery-complete', '馬公衛生所完成驗收', magong.id, ['V-01'], 'magong-clinic');

  const v02Arrival = move('V-02', 'road-qimei-approach', plan.v02ApproachStartMin, []);
  const qimeiHandoverStart = Math.max(flightArrival, v02Arrival);
  action('V-02', v02Arrival, qimeiHandoverStart, 'waiting', 'qimei-transfer', [], '等候 D-01 抵達');
  action('D-01', flightArrival, qimeiHandoverStart, 'waiting', 'qimei-transfer', [qimei.id], '等候 V-02 接駁');
  phase(qimei.id, flightArrival, qimeiHandoverStart, 'D-01', 'transferWait', 'ready');
  const qimeiHandoverEnd = qimeiHandoverStart + service.handoverQimei;
  checkHandover('D-01', 'V-02', 'qimei-transfer', qimeiHandoverStart, qimeiHandoverEnd);
  action('D-01', qimeiHandoverStart, qimeiHandoverEnd, 'handover', 'qimei-transfer', [qimei.id], '交接七美訂單至 V-02');
  action('V-02', qimeiHandoverStart, qimeiHandoverEnd, 'handover', 'qimei-transfer', [qimei.id], '接收 D-01 貨件');
  phase(qimei.id, qimeiHandoverStart, qimeiHandoverEnd, 'D-01', 'handling', 'handover');
  event(qimeiHandoverStart, 'handover-start', '七美交接開始', qimei.id, ['D-01', 'V-02'], 'qimei-transfer');
  event(qimeiHandoverEnd, 'handover-complete', '七美訂單移交 V-02；D-01 待回收', qimei.id, ['D-01', 'V-02'], 'qimei-transfer');
  const qimeiArrival = move('V-02', 'road-qimei-delivery', qimeiHandoverEnd, [qimei.id]);
  phase(qimei.id, qimeiHandoverEnd, qimeiArrival, 'V-02', 'vanCold', 'in-transit');
  const qimeiReceiveStart = Math.max(qimeiArrival, qimei.receivingWindow[0]);
  action('V-02', qimeiArrival, qimeiReceiveStart, 'waiting', 'qimei-clinic', [qimei.id], '等待衛生所收貨');
  phase(qimei.id, qimeiArrival, qimeiReceiveStart, 'V-02', 'vanCold', 'ready');
  const qimeiReceiveEnd = qimeiReceiveStart + service.receiveQimei;
  action('V-02', qimeiReceiveStart, qimeiReceiveEnd, 'receiving', 'qimei-clinic', [qimei.id], '七美衛生所驗收');
  phase(qimei.id, qimeiReceiveStart, qimeiReceiveEnd, 'V-02', 'receiving', 'receiving');
  phase(qimei.id, qimeiReceiveEnd, endMin, 'qimei-clinic', 'clinicCold', 'delivered');
  deliveryTimes[qimei.id] = qimeiReceiveEnd;
  event(qimeiReceiveStart, 'receiving-start', '七美衛生所開始驗收', qimei.id, ['V-02'], 'qimei-clinic');
  event(qimeiReceiveEnd, 'delivery-complete', '七美衛生所完成驗收', qimei.id, ['V-02'], 'qimei-clinic');
  event(endMin, 'day-end', '模擬日結束');

  for (const order of input.orders) {
    if (deliveryTimes[order.id] > order.receivingWindow[1] + EPS) fail(`${order.id} receiving completes outside its window`);
    if (deliveryTimes[order.id] > endMin + EPS) fail(`${order.id} cannot complete within the day`);
    const phases = orderPhases[order.id];
    if (Math.abs(phases[0].startMin - allocations[order.id]) > EPS || Math.abs(phases.at(-1).endMin - endMin) > EPS) fail(`custody does not span allocation to day end for ${order.id}`);
    for (let i = 1; i < phases.length; i++) if (Math.abs(phases[i].startMin - phases[i - 1].endMin) > EPS) fail(`custody gap/overlap for ${order.id}`);
    // Stock not yet allocated remains in the depot cold environment after release.
    let temperature = thermalAt(batch.initialTemperatureC, input.profile.thermal.depotCold,
      allocations[order.id] - batch.availableAtMin);
    for (const item of phases) {
      item.profile = input.profile.thermal[item.thermalId];
      item.startC = temperature;
      item.endC = temperature = thermalAt(temperature, item.profile, item.endMin - item.startMin);
    }
  }
  for (const resource of input.resources) {
    const timeline = activities[resource.id].sort((a, b) => a.startMin - b.startMin);
    let location = resource.initialSiteId;
    let previousEnd = startMin;
    for (const item of timeline) {
      if (item.startMin < previousEnd - EPS || item.startMin < startMin - EPS || item.endMin > endMin + EPS) fail(`${resource.id} has overlapping/out-of-day activity`);
      if (item.movement) {
        if (item.movement.fromSiteId !== location) fail(`${resource.id} movement starts away from its actual site`);
        location = item.movement.toSiteId;
      } else if (item.siteId !== location) fail(`${resource.id} handling is not co-located at ${item.siteId}`);
      previousEnd = item.endMin;
    }
    if (energyAt(resource, timeline, startMin, endMin) < resource.reserveWh - EPS) fail(`${resource.id} ends below its energy reserve`);
  }

  events.sort((a, b) => a.timeMin - b.timeMin || Number(a.id.slice(3)) - Number(b.id.slice(3)));
  const traces = {};
  for (const order of input.orders) {
    const phases = orderPhases[order.id];
    const custody = [];
    for (const item of phases) {
      const last = custody.at(-1);
      if (last?.custodianId === item.custodianId) last.endMin = item.endMin;
      else custody.push({ startMin: item.startMin, endMin: item.endMin,
        custodianId: item.custodianId, label: sites.get(item.custodianId)?.label ?? resources.get(item.custodianId)?.label });
    }
    const sampleTimes = new Set([allocations[order.id], endMin,
      ...phases.flatMap((item) => [item.startMin, item.endMin]),
      ...events.filter((item) => item.timeMin >= allocations[order.id] && item.timeMin <= endMin).map((item) => item.timeMin)]);
    for (let t = Math.ceil(allocations[order.id] / input.profile.sampleEveryMin) * input.profile.sampleEveryMin; t <= endMin; t += input.profile.sampleEveryMin) sampleTimes.add(t);
    traces[order.id] = { custody, temperature: [...sampleTimes].sort((a, b) => a - b).map((timeMin) =>
      ({ timeMin, celsius: thermalStatsAt(phases, timeMin, input.profile.temperatureBoundsC).temperatureC })) };
  }
  const run = { schemaVersion: 1, id: `run-${input.id}`, fixture: input, startMin, endMin,
    events, movements, traces, incoming, summary: null,
    _sites: sites, _resourceActivities: activities, _orderPhases: orderPhases,
    _allocations: allocations, _dispatchTimes: dispatchTimes, _deliveryTimes: deliveryTimes,
    _bounds: input.profile.temperatureBoundsC,
    _terminalStatuses: { 'V-01': 'parked', 'D-01': 'recovery-required', 'V-02': 'parked' },
    _terminalLabels: { 'V-01': '馬公衛生所停車', 'D-01': '七美轉運點待回收（未規劃返航）', 'V-02': '七美衛生所停車' } };
  const final = snapshotAt(run, endMin);
  const summaryOrders = input.orders.map((order) => {
    const stats = thermalStatsAt(orderPhases[order.id], endMin, input.profile.temperatureBoundsC);
    const exceptions = [];
    if (incoming.requiresAssessment) exceptions.push('來貨溫度紀錄超出模擬範圍；接收後仍待評估');
    if (deliveryTimes[order.id] > order.deadlineMin + EPS) exceptions.push('逾配送期限');
    if (stats.excursionMinutes > EPS) exceptions.push('模擬溫度超出範圍；待專業評估');
    return { id: order.id, quantity: order.quantity,
      status: stats.excursionMinutes > EPS || incoming.requiresAssessment ? 'pending-assessment' : 'delivered',
      deliveredAtMin: deliveryTimes[order.id], deadlineMin: order.deadlineMin,
      onTime: deliveryTimes[order.id] <= order.deadlineMin + EPS,
      minTemperatureC: stats.minTemperatureC, maxTemperatureC: stats.maxTemperatureC,
      excursionMinutes: stats.excursionMinutes, exceptions };
  });
  run.summary = {
    orders: summaryOrders,
    inventory: { totalQuantity: batch.quantity, deliveredQuantity: final.inventory.deliveredQuantity,
      remainingQuantity: final.inventory.remainingQuantity },
    resources: final.resources.map((resource) => ({ id: resource.id, siteId: resource.siteId,
      status: resource.status, energyWh: resource.energyWh, reserveWh: resource.reserveWh,
      reserveMet: resource.energyWh >= resource.reserveWh - EPS })),
    exceptions: summaryOrders.flatMap((order) => order.exceptions.map((message) => `${order.id}: ${message}`)),
    notes: ['D-01 停留七美模擬轉運點，需另行回收；本日未模擬返航。', '結果使用模擬路線、服務及溫控參數，並非實際配送或臨床放行判定。'],
  };
  return run;
}
