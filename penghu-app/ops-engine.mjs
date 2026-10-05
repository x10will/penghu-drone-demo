import { plan as dronePlan, sampleTotal, sampleDanger, label as hourLabel } from './planner.mjs';
import { deriveRiskField } from './risk-scenario.mjs';
import { distanceKm, pathLengthKm, thermalAt, thermalStatsAt, energyAt, snapshotAt } from './daily-simulation.mjs';

const EPS = 1e-8;
const REPOSITION_PROBES = 12;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const unique = values => [...new Set(values)];

/** Validate references and the custody chain without throwing on bad proposals. */
export function validatePlan(plan, state, world) {
  const orderReasons = Object.fromEntries(state.orders.map(order => [order.id, []]));
  const errors_zh = [];
  const nodes = new Set(world.nodes.map(node => node.id));
  const vehicles = new Set(state.vehicles.map(vehicle => vehicle.id));
  for (const [items, name] of [[state.orders, '訂單'], [state.vehicles, '運具']])
    if (items.some(item => typeof item.id !== 'string' || !item.id) || new Set(items.map(item => item.id)).size !== items.length)
      errors_zh.push(`${name} ID 必須存在且不可重複。`);
  if (!plan || !Array.isArray(plan.assignments)) {
    errors_zh.push('方案必須包含 assignments 陣列。');
  } else {
    const assigned = new Set();
    for (const assignment of plan.assignments) {
      const reasons = Object.hasOwn(orderReasons, assignment?.orderId) ? orderReasons[assignment.orderId] : null;
      if (!reasons) { errors_zh.push(`未知訂單：${assignment?.orderId ?? '未指定'}。`); continue; }
      if (assigned.has(assignment.orderId)) reasons.push('同一訂單重複指派。');
      assigned.add(assignment.orderId);
      if (!Array.isArray(assignment.legs) || !assignment.legs.length) { reasons.push('訂單缺少運輸航段。'); continue; }
      let expectedFrom = world.stock.nodeId;
      for (const leg of assignment.legs) {
        if (!leg || !vehicles.has(leg.vehicleId)) reasons.push(`未知運具：${leg?.vehicleId ?? '未指定'}。`);
        if (!leg || !nodes.has(leg.from) || !nodes.has(leg.to)) reasons.push('航段起訖點不存在。');
        if (leg?.from !== expectedFrom) reasons.push('航段未銜接：第一段須從冷庫出發，後續須在前段終點交接。');
        if (leg?.departAfterMin !== undefined && (!finite(leg.departAfterMin) || leg.departAfterMin < world.startMin || leg.departAfterMin > world.endMin))
          reasons.push('departAfterMin 必須是當日範圍內的分鐘。');
        expectedFrom = leg?.to;
      }
      if (expectedFrom !== state.orders.find(order => order.id === assignment.orderId).destinationNodeId) reasons.push('最後一段未抵達訂單目的地。');
    }
    for (const order of state.orders) if (!assigned.has(order.id)) orderReasons[order.id].push('訂單未指派運輸方案。');
  }
  if (plan?.notes_zh !== undefined && typeof plan.notes_zh !== 'string') errors_zh.push('notes_zh 必須是文字。');
  return { valid: !errors_zh.length && Object.values(orderReasons).every(reasons => !reasons.length), errors_zh, orderReasons };
}

/** Fixture OSM routes in either direction, otherwise an explicit distance estimate. */
export function vanRoute(world, fromId, toId) {
  const from = world.nodes.find(node => node.id === fromId), to = world.nodes.find(node => node.id === toId);
  if (!from || !to) return { status: 'failed', reason_zh: '道路起訖點不存在。' };
  if (!from.island || from.island !== to.island) return { status: 'failed', reason_zh: `配送車不可跨島：${from.island ?? '未知'} → ${to.island ?? '未知'}。` };
  const route = world.fixture.routes.find(item => item.mode === 'road' && item.fromSiteId === fromId && item.toSiteId === toId);
  const reverse = !route && world.fixture.routes.find(item => item.mode === 'road' && item.fromSiteId === toId && item.toSiteId === fromId);
  const path = route ? route.path : reverse ? [...reverse.path].reverse() : [from, to];
  const speedKph = (route || reverse)?.speedKph ?? world.fixture.routes.find(item => item.mode === 'road').speedKph;
  const estimated = !route && !reverse;
  const km = (route || reverse) ? pathLengthKm(path) : distanceKm(from, to) * 1.35;
  return { status: 'ok', mode: 'road', path: path.map(({ lat, lng }) => ({ lat, lng })), distanceKm: km,
    durationMin: km / speedKph * 60, speedKph, estimated, ...(estimated ? { label_zh: '道路距離估算' } : {}) };
}

/** Evaluate in proposal order. Invalid and infeasible assignments produce verdicts. */
export function evaluatePlan(plan, state, world, field) {
  const validation = validatePlan(plan, state, world);
  const reasons = Object.fromEntries(state.orders.map(order => [order.id,
    [...validation.errors_zh, ...validation.orderReasons[order.id]]]));
  const nodes = new Map(world.nodes.map(node => [node.id, node]));
  const startMin = world.startMin, endMin = world.endMin;
  const service = world.fixture.plan.durationsMin;
  const activities = Object.fromEntries(state.vehicles.map(vehicle => [vehicle.id, []]));
  const fleet = new Map(state.vehicles.map(vehicle => [vehicle.id, { spec: vehicle,
    resource: { ...vehicle, initialSiteId: vehicle.baseNodeId, initialEnergyWh: vehicle.energyWh, mockProfile: vehicle.profile,
      typeLabel: vehicle.type === 'drone' ? '無人機' : '配送車' }, nodeId: vehicle.baseNodeId,
    freeMin: startMin, reasons_zh: [], warnings: [], orderIds: new Set() }]));
  const schedule = { events: [], movements: [], activities, phases: {}, allocations: {}, dispatchTimes: {}, deliveryTimes: {} };
  const scheduledLegs = Object.fromEntries(state.orders.map(order => [order.id, []]));
  const plannerDelays = Object.fromEntries(state.orders.map(order => [order.id, []]));
  const warnings = [];
  const addReason = (orderId, message) => { if (!reasons[orderId].includes(message)) reasons[orderId].push(message); };
  const event = (timeMin, type, label, orderId = null, resourceIds = [], siteId = null) => {
    schedule.events.push({ id: `EV-${String(schedule.events.length + 1).padStart(3, '0')}`, timeMin, type, label,
      ...(orderId ? { orderId } : {}), resourceIds, ...(siteId ? { siteId } : {}) });
  };
  const action = (v, start, end, status, siteId, orderIds, activity, movement = null) => {
    if (end > start + EPS || movement) activities[v.spec.id].push({ startMin: start, endMin: end, status, siteId, orderIds, activity, movement });
  };
  const phase = (orderId, start, end, custodianId, thermalId, status) => {
    if (end > start + EPS) schedule.phases[orderId].push({ startMin: start, endMin: end, custodianId, thermalId, status });
  };
  const reserveAt = (v, at) => energyAt(v.resource, activities[v.spec.id], startMin, at) >= v.spec.reserveWh - EPS;
  let riskField;
  try {
    riskField = deriveRiskField(field, state.risk, world.nodes);
    // Artifact distances only cover the fifteen original pads; compute geometry
    // for this expanded set using the same cell metric as planner's fallback.
    riskField = { ...riskField, padDistances: undefined };
  } catch (error) {
    for (const order of state.orders) addReason(order.id, `風險情境無效：${error.message}`);
  }
  for (const v of fleet.values()) {
    const p = v.spec.profile;
    if (!nodes.has(v.nodeId) || !['van', 'drone'].includes(v.spec.type) ||
        !finite(v.spec.energyWh) || v.spec.energyWh <= 0 || !finite(v.spec.reserveWh) || v.spec.reserveWh < 0 ||
        !finite(v.spec.capacityKg) || v.spec.capacityKg <= 0 || !finite(v.spec.capacityL) || v.spec.capacityL <= 0 ||
        !p || !['idleW', 'handlingW', 'movingW', 'travelWhPerKm'].every(key => finite(p[key]) && p[key] >= 0))
      v.reasons_zh.push('運具基地、容量或能源參數無效。');
  }
  // An invalid fleet cannot supply the simulation snapshot contract. Return the
  // input errors as verdicts; do not silently repair the user's vehicle rows.
  if ([...fleet.values()].some(v => v.reasons_zh.length)) {
    const failures = [...fleet.values()].flatMap(v => v.reasons_zh.map(reason => `${v.spec.id}：${reason}`));
    return { orders: state.orders.map(order => ({ id: order.id, orderId: order.id, status: 'fail', pass: false,
      reasons_zh: unique([...reasons[order.id], ...failures]), deliveredAtMin: null, legs: [] })),
      vehicles: [...fleet.values()].map(v => ({ id: v.spec.id, status: v.reasons_zh.length ? 'fail' : 'pass', reasons_zh: v.reasons_zh, warnings: [] })),
      allPass: false, warnings: [], validation, run: null };
  }
  const routeAt = (v, fromId, toId, earliest) => {
    if (v.spec.type === 'van') {
      const road = vanRoute(world, fromId, toId);
      return road.status === 'ok' ? { ...road, departMin: earliest, arriveMin: earliest + road.durationMin } : road;
    }
    if (!riskField) return { status: 'failed', reason_zh: '風險情境無效，無法驗證航線。' };
    // No flight or return may extend beyond the simulated day.
    if (earliest >= endMin) return { status: 'failed', reason_zh: '當日已無可起飛時間。' };
    let result = dronePlan(riskField, world.pads, fromId, toId, earliest / 60,
      Math.min(endMin / 60, earliest / 60 + riskField.C.HORIZON_H));
    if (result.status !== 'ok') return { status: 'failed', reason_zh: result.reason_zh };
    // The grid router cannot resolve distances within one cell. Retain its safe
    // departure, then account for the real facility-to-facility local flight.
    if (result.path.length === 1) {
      const from = nodes.get(fromId), to = nodes.get(toId);
      const durationH = distanceKm(from, to) * 1000 / riskField.C.CRUISE_MS / 3600;
      const arrivalH = result.depart_h + durationH;
      if (durationH * 60 > riskField.C.ENDURANCE_MIN || arrivalH * 60 > endMin + EPS)
        return { status: 'failed', reason_zh: '同網格航段超出續航或當日範圍。' };
      const times = unique([result.depart_h, arrivalH, ...(state.risk?.events ?? []).flatMap(event => [event.fromH, event.toH])])
        .filter(hour => finite(hour) && hour >= result.depart_h && hour <= arrivalH);
      const totals = times.map(hour => sampleTotal(riskField, from.row, from.col, hour));
      if (totals.some(total => total > riskField.C.SAFETY_LIMIT))
        return { status: 'failed', reason_zh: '同網格航段在飛行期間超出安全門檻。' };
      const maximum = Math.max(...totals), maximumHour = times[totals.indexOf(maximum)];
      const risk = durationH * sampleDanger(riskField, from.row, from.col, result.depart_h);
      result = { ...result, arrive_h: arrivalH, arrive_label: hourLabel(arrivalH), direct_h: durationH,
        total_risk: risk, max_cell_total: maximum, localHop: true,
        path: [{ ...result.path[0], lat: from.lat, lng: from.lng },
          { ...result.path[0], lat: to.lat, lng: to.lng, t_h: arrivalH, kind: 'fly' }],
        legs: [{ from_name: from.label, to_name: to.label, t0_h: result.depart_h, t1_h: arrivalH,
          risk, max_cell: maximum, max_cell_h: maximumHour }],
        rationale_zh: `同一網格內依實際距離飛行，預計 ${hourLabel(arrivalH)} 抵達${to.label}。` };
    }
    if (result.arrive_h * 60 > endMin + EPS) return { status: 'failed', reason_zh: '航線抵達時間超出當日範圍。' };
    const path = result.path.map(point => ({ ...point }));
    // Grid centers define routing; the displayed movement joins actual facilities.
    path[0] = { ...path[0], lat: nodes.get(fromId).lat, lng: nodes.get(fromId).lng };
    if (path.length === 1) path.push({ ...path[0] });
    path[path.length - 1] = { ...path.at(-1), lat: nodes.get(toId).lat, lng: nodes.get(toId).lng };
    return { status: 'ok', mode: 'air', path, distanceKm: pathLengthKm(path),
      requestedDepartMin: earliest, departMin: result.depart_h * 60, arriveMin: result.arrive_h * 60, planner: result, estimated: false };
  };
  const recordPlannerDelay = (orderId, v, route, purpose = '起飛') => {
    if (!route.planner) return null;
    const departureDelayed = route.departMin > route.requestedDepartMin + EPS;
    const waits = route.planner.waits ?? [];
    if (!departureDelayed && !waits.length) return null;
    const timeline = [...(world.weatherTimeline ?? []), ...(state.risk?.events ?? []).map(event => ({ ...event,
      label_zh: `${nodes.get(event.nodeId)?.label ?? event.nodeId}${event.kind === 'gust' ? '陣風' : '禁飛'}` }))];
    const context = timeline.filter(event => event.fromH * 60 < route.arriveMin && event.toH * 60 > route.requestedDepartMin)
      .map(event => `${hourLabel(event.fromH)}–${hourLabel(event.toH)} ${event.label_zh}${finite(event.ampMs) ? ` +${event.ampMs} m/s` : ''}`);
    const timing = departureDelayed
      ? `${v.spec.id} ${purpose}受風險場延至 ${hourLabel(route.departMin / 60)}（原定 ${hourLabel(route.requestedDepartMin / 60)} 後${context.length ? `；${context.join('；')}` : ''}）`
      : `${v.spec.id} ${purpose}途中於${waits.map(wait => `${wait.name}停等 ${wait.minutes} 分鐘`).join('、')}，等待風險回落`;
    const delay = { requestedDepartMin: route.requestedDepartMin, departMin: route.departMin,
      waits: structuredClone(waits), rationale_zh: route.planner.rationale_zh,
      reason_zh: `${timing}。${route.planner.rationale_zh ?? ''}` };
    plannerDelays[orderId].push(delay);
    return delay;
  };
  const move = (v, fromId, toId, route, orderIds) => {
    // Only a risk-field hold earns the safety label; other idle time is just standby for the handover.
    const riskHold = route.mode === 'air' && route.departMin > route.requestedDepartMin + EPS;
    action(v, v.freeMin, route.departMin, 'waiting', fromId, orderIds, riskHold ? '等待安全出發時間' : '待命');
    event(route.departMin, 'movement-start', `${v.spec.id} 出發${route.estimated ? '（道路距離估算）' : ''}`, orderIds[0], [v.spec.id], fromId);
    // Split planner ground holds so thermal, energy and positions agree with its clock.
    const parts = [];
    if (route.mode === 'air') {
      let partStart = 0;
      for (let i = 1; i < route.path.length; i++) {
        if (route.path[i].kind !== 'wait') continue;
        if (i - 1 > partStart) parts.push({ path: route.path.slice(partStart, i), moving: true });
        const holdStart = i - 1;
        while (i + 1 < route.path.length && route.path[i + 1].kind === 'wait') i++;
        parts.push({ path: route.path.slice(holdStart, i + 1), moving: false });
        partStart = i;
      }
      if (partStart < route.path.length - 1) parts.push({ path: route.path.slice(partStart), moving: true });
    } else parts.push({ path: route.path, moving: true });
    for (const part of parts) {
      const a = route.mode === 'air' ? part.path[0].t_h * 60 : route.departMin;
      const b = route.mode === 'air' ? part.path.at(-1).t_h * 60 : route.arriveMin;
      if (!part.moving) {
        const node = world.nodes.find(node => node.row === part.path[0].row && node.col === part.path[0].col);
        action(v, a, b, 'waiting', node.id, orderIds, '起降點等待風險回落');
        continue;
      }
      const fromNode = parts.length === 1 || part === parts[0] ? fromId : world.nodes.find(node => node.row === part.path[0].row && node.col === part.path[0].col)?.id ?? fromId;
      const toNode = part === parts.at(-1) ? toId : world.nodes.find(node => node.row === part.path.at(-1).row && node.col === part.path.at(-1).col)?.id ?? toId;
      const movement = { id: `MOVE-${String(schedule.movements.length + 1).padStart(3, '0')}`, resourceId: v.spec.id,
        orderIds: [...orderIds], mode: route.mode, fromSiteId: fromNode, toSiteId: toNode, startMin: a, endMin: b,
        path: part.path, distanceKm: route.mode === 'road' ? route.distanceKm : pathLengthKm(part.path),
        estimated: route.estimated, ...(route.mode === 'air' ? { cruiseAltitudeM: 120 } : {}),
        ...(route.estimated ? { label_zh: '道路距離估算' } : {}) };
      schedule.movements.push(movement);
      action(v, a, b, 'moving', null, orderIds, route.mode === 'air' ? '無人機飛行' : '道路行駛', movement);
    }
    v.nodeId = toId; v.freeMin = route.arriveMin;
    event(route.arriveMin, 'movement-end', `${v.spec.id} 抵達`, orderIds[0], [v.spec.id], toId);
    return reserveAt(v, route.arriveMin);
  };
  const reposition = (v, targetId, orderId, neededAt) => {
    if (v.nodeId === targetId) return true;
    let route = routeAt(v, v.nodeId, targetId, v.freeMin);
    if (route.status === 'ok' && route.arriveMin < neededAt) {
      if (v.spec.type === 'van') {
        route = routeAt(v, v.nodeId, targetId, Math.max(v.freeMin, neededAt - route.durationMin));
      } else {
        // Search backwards from the latest physically possible departure. Every
        // candidate goes through the same risk router; an unsafe late approach
        // must never replace a safe earlier one. Resolution is one sim minute.
        // The search is bounded: each failed probe is a full A* over the day, so
        // the first unroutable candidate and a probe cap keep the earlier safe
        // route (valid, merely less just-in-time) instead of scanning the window.
        const flightMin = distanceKm(nodes.get(v.nodeId), nodes.get(targetId)) * 1000 / riskField.C.CRUISE_MS / 60;
        let probes = 0;
        for (let at = neededAt - flightMin; at > route.departMin + EPS && probes < REPOSITION_PROBES; at -= 1, probes++) {
          const candidate = routeAt(v, v.nodeId, targetId, at);
          if (candidate.status !== 'ok') break;
          if (candidate.arriveMin <= neededAt + EPS) { route = candidate; break; }
        }
      }
    }
    if (route.status !== 'ok' || route.arriveMin > endMin + EPS) {
      addReason(orderId, `${v.spec.id} 空車調度失敗：${route.reason_zh ?? '超出當日範圍。'}`); return false;
    }
    recordPlannerDelay(orderId, v, route, '空機調度');
    if (!move(v, v.nodeId, targetId, route, [])) {
      addReason(orderId, `${v.spec.id} 空車調度後能源低於保留電量。`); return false;
    }
    return true;
  };
  event(startMin, 'day-start', '模擬日開始');
  event(world.stock.releaseMin, 'batch-release', `${world.stock.id} 放行 ${world.stock.doses} 劑`, null, [], world.stock.nodeId);
  let packFree = world.stock.releaseMin, stockRemaining = world.stock.doses;
  for (const order of state.orders) {
    schedule.phases[order.id] = [];
    schedule.allocations[order.id] = Infinity;
    schedule.dispatchTimes[order.id] = Infinity;
    schedule.deliveryTimes[order.id] = Infinity;
    if (!nodes.has(order.destinationNodeId) || !Number.isInteger(order.doses) || order.doses <= 0 ||
        !finite(order.deadlineMin) || !Array.isArray(order.receivingWindow) || order.receivingWindow.length !== 2 ||
        !order.receivingWindow.every(finite) || order.receivingWindow[0] > order.receivingWindow[1])
      addReason(order.id, '訂單目的地、劑數或收貨時間無效。');
  }
  const assignments = Array.isArray(plan?.assignments) ? plan.assignments : [];
  for (const assignment of assignments) {
    const order = state.orders.find(order => order.id === assignment?.orderId);
    if (!order || reasons[order.id].length) continue;
    if (order.doses > stockRemaining) { addReason(order.id, '批次庫存不足，無法分配所需劑數。'); continue; }
    const islandOrder = nodes.get(order.destinationNodeId).island !== nodes.get(world.stock.nodeId).island;
    const packDuration = islandOrder ? service.packQimei : service.packMagong;
    const packStart = packFree, packedAt = packStart + packDuration;
    if (packedAt > endMin) { addReason(order.id, '包裝無法於當日完成。'); continue; }
    stockRemaining -= order.doses; packFree = packedAt;
    schedule.allocations[order.id] = packStart;
    event(packStart, 'allocation', `分配 ${order.doses} 劑給${order.label}`, order.id, [], world.stock.nodeId);
    phase(order.id, packStart, packedAt, world.stock.nodeId, 'packing', 'packing');
    event(packedAt, 'packing-complete', '訂單完成包裝', order.id, [], world.stock.nodeId);
    let readyAt = packedAt, custodian = world.stock.nodeId, previousVehicle = null;
    let complete = true;
    for (let index = 0; index < assignment.legs.length; index++) {
      const leg = assignment.legs[index], v = fleet.get(leg.vehicleId);
      if (v.reasons_zh.length) { addReason(order.id, `${v.spec.id}：${v.reasons_zh.join('；')}`); complete = false; break; }
      if (v.heldOrderId) { addReason(order.id, `${v.spec.id} 尚持有未完成訂單 ${v.heldOrderId}，當日無法再指派。`); complete = false; break; }
      v.orderIds.add(order.id);
      if (order.doses * world.perDose.massKg > v.spec.capacityKg + EPS || order.doses * world.perDose.volumeL > v.spec.capacityL + EPS) {
        addReason(order.id, `${v.spec.id} 容量不足（重量或體積超限）。`); complete = false; break;
      }
      const changingVehicle = previousVehicle && previousVehicle !== v;
      const handleDuration = !previousVehicle ? (islandOrder ? service.loadQimei : service.loadMagong) : changingVehicle
        ? (nodes.get(leg.from).island === nodes.get(world.stock.nodeId).island ? service.handoverOrigin : service.handoverQimei) : 0;
      const neededAt = Math.max(readyAt, (leg.departAfterMin ?? startMin) - handleDuration);
      if (!reposition(v, leg.from, order.id, neededAt)) { complete = false; break; }
      const handleStart = Math.max(readyAt, v.freeMin, (leg.departAfterMin ?? startMin) - handleDuration);
      const departEarliest = handleStart + handleDuration;
      if (departEarliest > endMin) { addReason(order.id, '裝載或交接無法於當日完成。'); complete = false; break; }
      phase(order.id, readyAt, handleStart, custodian, previousVehicle ? previousVehicle.spec.type === 'drone' ? 'transferWait' : 'vanCold' : 'depotCold', 'ready');
      if (changingVehicle) {
        action(previousVehicle, previousVehicle.freeMin, handleStart, 'waiting', leg.from, [order.id], '等待交接運具');
        action(previousVehicle, handleStart, departEarliest, 'handover', leg.from, [order.id], '貨件交接');
        previousVehicle.freeMin = departEarliest;
      }
      action(v, handleStart, departEarliest, previousVehicle ? 'handover' : 'loading', leg.from, [order.id], previousVehicle ? '貨件交接' : '訂單裝載');
      phase(order.id, handleStart, departEarliest, custodian, 'handling', previousVehicle ? 'handover' : 'loading');
      event(handleStart, previousVehicle ? 'handover-start' : 'loading-start', previousVehicle ? '貨件交接開始' : '訂單裝載開始', order.id,
        unique([previousVehicle?.spec.id, v.spec.id].filter(Boolean)), leg.from);
      event(departEarliest, previousVehicle ? 'handover-complete' : 'loading-complete', `訂單移交 ${v.spec.id}`, order.id,
        unique([previousVehicle?.spec.id, v.spec.id].filter(Boolean)), leg.from);
      const outgoingVehicle = previousVehicle;
      v.freeMin = departEarliest;
      readyAt = departEarliest; custodian = v.spec.id;
      previousVehicle = v;
      if ((outgoingVehicle && !reserveAt(outgoingVehicle, departEarliest)) || !reserveAt(v, departEarliest)) {
        addReason(order.id, '裝載或交接後能源低於保留電量。'); complete = false; break;
      }
      const route = routeAt(v, leg.from, leg.to, departEarliest);
      if (route.status !== 'ok' || route.arriveMin > endMin + EPS) {
        addReason(order.id, `${v.spec.id} 航段失敗：${route.reason_zh ?? '超出當日範圍。'}`);
        complete = false; previousVehicle = v; break;
      }
      phase(order.id, departEarliest, route.departMin, custodian, v.spec.type === 'drone' ? 'transferWait' : 'vanCold', 'ready');
      if (index === 0) schedule.dispatchTimes[order.id] = route.departMin;
      const reserveMet = move(v, leg.from, leg.to, route, [order.id]);
      const plannerDelay = recordPlannerDelay(order.id, v, route);
      // Drone holds use the same fixture environment as its passive box.
      phase(order.id, route.departMin, route.arriveMin, custodian, v.spec.type === 'drone' ? 'droneBox' : 'vanCold', 'in-transit');
      scheduledLegs[order.id].push({ ...leg, departMin: route.departMin, arriveMin: route.arriveMin,
        estimated: route.estimated, ...(route.planner ? { planner: route.planner } : {}),
        ...(plannerDelay ? { plannerDelay } : {}) });
      readyAt = route.arriveMin; previousVehicle = v;
      if (!reserveMet) { addReason(order.id, `${v.spec.id} 航段後能源低於保留電量。`); complete = false; break; }
    }
    if (complete && previousVehicle) {
      const v = previousVehicle;
      const receiveStart = Math.max(readyAt, order.receivingWindow[0]);
      const receiveEnd = receiveStart + (islandOrder ? service.receiveQimei : service.receiveMagong);
      if (receiveEnd <= endMin + EPS) {
        phase(order.id, readyAt, receiveStart, custodian, v.spec.type === 'drone' ? 'transferWait' : 'vanCold', 'ready');
        action(v, readyAt, receiveStart, 'waiting', v.nodeId, [order.id], '等待收貨時段');
        action(v, receiveStart, receiveEnd, 'receiving', v.nodeId, [order.id], '目的地驗收');
        phase(order.id, receiveStart, receiveEnd, custodian, 'receiving', 'receiving');
        event(receiveStart, 'receiving-start', '目的地開始驗收', order.id, [v.spec.id], v.nodeId);
        event(receiveEnd, 'delivery-complete', '目的地完成驗收', order.id, [v.spec.id], v.nodeId);
        schedule.deliveryTimes[order.id] = receiveEnd; readyAt = receiveEnd; v.freeMin = receiveEnd;
        custodian = order.destinationNodeId;
        phase(order.id, readyAt, endMin, custodian, 'clinicCold', 'delivered');
        if (receiveEnd > order.deadlineMin + EPS) addReason(order.id, '逾配送期限。');
        if (receiveEnd > order.receivingWindow[1] + EPS) addReason(order.id, '驗收完成時間超出收貨時段。');
      } else { addReason(order.id, '驗收無法於當日完成。'); complete = false; }
    }
    if (!complete) {
      phase(order.id, readyAt, endMin, custodian,
        previousVehicle ? previousVehicle.spec.type === 'drone' ? 'transferWait' : 'vanCold' : 'depotCold', 'ready');
      const holder = fleet.get(custodian);
      if (holder) {
        action(holder, holder.freeMin, endMin, 'waiting', holder.nodeId, [order.id], '保管未完成訂單');
        holder.heldOrderId = order.id; holder.freeMin = endMin;
      }
    }
  }
  // Returns happen only after every assigned drone leg, and do not claim delivery
  // failure when recovery is needed. Probe energy before adding an unsafe return.
  for (const v of fleet.values()) {
    if (v.spec.type !== 'drone' || v.nodeId === v.spec.baseNodeId || v.reasons_zh.length) continue;
    const route = routeAt(v, v.nodeId, v.spec.baseNodeId, v.freeMin);
    let safeEnergy = false;
    if (route.status === 'ok') {
      const flightMin = route.planner.legs.reduce((sum, leg) => sum + (leg.t1_h - leg.t0_h) * 60, 0);
      const projected = energyAt(v.resource, activities[v.spec.id], startMin, endMin) -
        flightMin * (v.spec.profile.movingW - v.spec.profile.idleW) / 60 - route.distanceKm * v.spec.profile.travelWhPerKm;
      safeEnergy = projected >= v.spec.reserveWh - EPS;
    }
    if (route.status === 'ok' && safeEnergy) move(v, v.nodeId, v.spec.baseNodeId, route, []);
    else {
      const message = `${v.spec.id} 待回收：${route.status === 'ok' ? '返航將低於保留電量。' : route.reason_zh}`;
      warnings.push(message); v.warnings.push(message);
    }
  }
  for (const v of fleet.values()) {
    const minimumWh = energyAt(v.resource, activities[v.spec.id], startMin, endMin);
    if (minimumWh < v.spec.reserveWh - EPS) {
      v.reasons_zh.push('日終能源低於保留電量。');
      for (const orderId of v.orderIds) addReason(orderId, `${v.spec.id} 日終能源低於保留電量。`);
    }
  }
  for (const order of state.orders) {
    const phases = schedule.phases[order.id];
    if (!phases.length) phases.push({ startMin: endMin, endMin, custodianId: world.stock.nodeId, thermalId: 'depotCold', status: 'awaiting-supply' });
    let celsius = thermalAt(world.stock.initialTemperatureC, world.profile.thermal.depotCold,
      Math.max(0, (Number.isFinite(schedule.allocations[order.id]) ? schedule.allocations[order.id] : world.stock.releaseMin) - world.stock.releaseMin));
    for (const item of phases) {
      item.profile = world.profile.thermal[item.thermalId]; item.startC = celsius;
      item.endC = celsius = thermalAt(celsius, item.profile, item.endMin - item.startMin);
    }
    const stats = thermalStatsAt(phases, endMin, world.profile.temperatureBoundsC);
    if (stats.excursionMinutes > EPS) addReason(order.id, `溫度超出 2–8°C，共 ${stats.excursionMinutes.toFixed(1)} 分鐘。`);
    if (!Number.isFinite(schedule.deliveryTimes[order.id]) && !reasons[order.id].length) addReason(order.id, '訂單未完成配送。');
  }
  if (world.stock.upstreamHistory.some(sample => sample.celsius < world.profile.temperatureBoundsC[0] || sample.celsius > world.profile.temperatureBoundsC[1]))
    for (const order of state.orders) addReason(order.id, '來貨溫度紀錄超出範圍，待評估。');
  // Waiting is explanatory evidence, not a failure by itself.
  for (const order of state.orders) if (reasons[order.id].length)
    for (const delay of plannerDelays[order.id]) addReason(order.id, delay.reason_zh);
  event(endMin, 'day-end', '模擬日結束');
  const orders = state.orders.map(order => ({ id: order.id, orderId: order.id, status: reasons[order.id].length ? 'fail' : 'pass',
    pass: !reasons[order.id].length, reasons_zh: reasons[order.id], deliveredAtMin: Number.isFinite(schedule.deliveryTimes[order.id]) ? schedule.deliveryTimes[order.id] : null,
    legs: scheduledLegs[order.id], plannerDelays: plannerDelays[order.id],
    ...thermalStatsAt(schedule.phases[order.id], endMin, world.profile.temperatureBoundsC) }));
  const vehicles = [...fleet.values()].map(v => ({ id: v.spec.id, status: v.reasons_zh.length ? 'fail' : 'pass',
    reasons_zh: unique(v.reasons_zh), warnings: v.warnings, nodeId: v.nodeId,
    energyWh: energyAt(v.resource, activities[v.spec.id], startMin, endMin), reserveWh: v.spec.reserveWh }));
  const evaluation = { orders, vehicles, allPass: validation.valid && orders.every(order => order.pass), warnings, validation };
  schedule.sequence = unique([...assignments.map(assignment => assignment?.orderId).filter(id => Object.hasOwn(reasons, id)), ...state.orders.map(order => order.id)]);
  evaluation.run = toSimulationRun(evaluation, state, world, schedule, fleet);
  return evaluation;
}

/** Emit the contract consumed by snapshotAt, panels and the map. */
export function toSimulationRun(evaluation, state, world, schedule, fleet) {
  const input = structuredClone({ ...world.fixture, sites: world.nodes,
    resources: [...fleet.values()].map(v => v.resource),
    orders: state.orders.map(order => ({ ...order, destinationId: order.destinationNodeId, quantity: order.doses,
      massKg: order.doses * world.perDose.massKg, volumeL: order.doses * world.perDose.volumeL })),
    plan: { ...world.fixture.plan, sequence: schedule.sequence } });
  const startMin = world.startMin, endMin = world.endMin;
  const incoming = { history: world.stock.upstreamHistory.map(sample => ({ ...sample })),
    minTemperatureC: Math.min(...world.stock.upstreamHistory.map(sample => sample.celsius)),
    maxTemperatureC: Math.max(...world.stock.upstreamHistory.map(sample => sample.celsius)),
    requiresAssessment: world.stock.upstreamHistory.some(sample => sample.celsius < world.profile.temperatureBoundsC[0] || sample.celsius > world.profile.temperatureBoundsC[1]) };
  const labels = new Map([...input.sites, ...input.resources].map(item => [item.id, item.label]));
  const traces = {};
  for (const order of state.orders) {
    const phases = schedule.phases[order.id], custody = [];
    for (const item of phases) {
      const last = custody.at(-1);
      if (last?.custodianId === item.custodianId) last.endMin = item.endMin;
      else custody.push({ startMin: item.startMin, endMin: item.endMin, custodianId: item.custodianId, label: labels.get(item.custodianId) });
    }
    const times = new Set(phases.flatMap(item => [item.startMin, item.endMin]));
    for (let t = phases[0].startMin; t <= endMin; t += world.profile.sampleEveryMin) times.add(t);
    traces[order.id] = { custody, temperature: [...times].sort((a, b) => a - b).map(timeMin =>
      ({ timeMin, celsius: thermalStatsAt(phases, timeMin, world.profile.temperatureBoundsC).temperatureC })) };
  }
  const run = { schemaVersion: 1, id: `run-ops-${world.fixture.id}`, fixture: input, startMin, endMin,
    events: [...schedule.events].sort((a, b) => a.timeMin - b.timeMin || a.id.localeCompare(b.id)), movements: schedule.movements,
    traces, incoming, summary: null, _sites: new Map(input.sites.map(site => [site.id, site])),
    _resourceActivities: Object.fromEntries(Object.entries(schedule.activities).map(([id, items]) => [id, [...items].sort((a, b) => a.startMin - b.startMin)])),
    _orderPhases: schedule.phases, _allocations: schedule.allocations, _dispatchTimes: schedule.dispatchTimes,
    _deliveryTimes: schedule.deliveryTimes, _bounds: world.profile.temperatureBoundsC,
    _terminalOrderIds: Object.fromEntries([...fleet.values()].map(v => [v.spec.id, v.heldOrderId ? [v.heldOrderId] : []])),
    _terminalStatuses: Object.fromEntries([...fleet.values()].map(v => [v.spec.id, v.warnings.length ? 'recovery-required' : 'parked'])),
    _terminalLabels: Object.fromEntries([...fleet.values()].map(v => [v.spec.id, v.warnings.length ? '待回收' : `${labels.get(v.nodeId)}停車`])) };
  const final = snapshotAt(run, endMin);
  run.summary = {
    orders: state.orders.map(order => {
      const verdict = evaluation.orders.find(item => item.id === order.id);
      return { id: order.id, quantity: order.doses, status: verdict.pass ? 'delivered' : verdict.deliveredAtMin !== null ? 'pending-assessment' : 'undelivered',
        deliveredAtMin: verdict.deliveredAtMin, deadlineMin: order.deadlineMin,
        onTime: verdict.deliveredAtMin !== null && verdict.deliveredAtMin <= order.deadlineMin + EPS,
        minTemperatureC: verdict.minTemperatureC, maxTemperatureC: verdict.maxTemperatureC,
        excursionMinutes: verdict.excursionMinutes, exceptions: verdict.reasons_zh };
    }),
    inventory: { totalQuantity: world.stock.doses, deliveredQuantity: final.inventory.deliveredQuantity, remainingQuantity: final.inventory.remainingQuantity },
    resources: final.resources.map(v => ({ id: v.id, siteId: v.siteId, status: v.status, energyWh: v.energyWh,
      reserveWh: v.reserveWh, reserveMet: v.energyWh >= v.reserveWh - EPS })),
    exceptions: evaluation.orders.flatMap(order => order.reasons_zh.map(reason => `${order.id}: ${reason}`)),
    notes: [...evaluation.warnings, '結果使用模擬服務及溫控參數，並非實際配送或臨床放行判定。'],
  };
  return run;
}
