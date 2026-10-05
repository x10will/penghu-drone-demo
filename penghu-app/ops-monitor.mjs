import {createDefaultState, BASELINE_PLAN} from './ops-world.mjs';
import {evaluatePlan} from './ops-engine.mjs';
import {riskHash} from './risk-scenario.mjs';
import {thermalAt, energyAt} from './daily-simulation.mjs';

/** JSON cannot retain Map or Infinity, both used by the snapshot adapter. */
export function restoreRun(saved) {
  const run = structuredClone(saved);
  run._sites = new Map(run.fixture.sites.map(node => [node.id, node]));
  for (const key of ['_allocations', '_dispatchTimes', '_deliveryTimes'])
    for (const [id, value] of Object.entries(run[key] ?? {})) if (value === null) run[key][id] = Infinity;
  return run;
}
function crossing(start, end, predicate) {
  if (predicate(start)) return start;
  if (!predicate(end)) return null;
  for (let i = 0; i < 36; i++) { const middle = (start + end) / 2; if (predicate(middle)) end = middle; else start = middle; }
  return end;
}
/** Earliest modeled constraint failure, rather than the eventual receipt time. */
export function failingOrders(evaluation, run, plan) {
  return evaluation.orders.filter(order => !order.pass).map(verdict => {
    const order = run.fixture.orders.find(order => order.id === verdict.id), times = [];
    const reasons = verdict.reasons_zh.join(' ');
    if (reasons.includes('逾配送期限')) times.push(order.deadlineMin);
    if (reasons.includes('超出收貨時段')) times.push(order.receivingWindow[1]);
    if (reasons.includes('溫度超出')) {
      for (const phase of run._orderPhases[order.id] ?? []) {
        const time = crossing(phase.startMin, phase.endMin, at => {
          const c = thermalAt(phase.startC, phase.profile, at - phase.startMin); return c < 2 || c > 8;
        });
        if (time !== null) times.push(time);
      }
    }
    if (reasons.includes('能源')) {
      const assignedLegs = plan?.assignments.find(item => item?.orderId === verdict.id)?.legs ?? verdict.legs ?? [];
      const vehicleIds = new Set((Array.isArray(assignedLegs) ? assignedLegs : []).map(leg => leg?.vehicleId));
      for (const resource of run.fixture.resources.filter(resource => vehicleIds.has(resource.id))) {
        const time = crossing(run.startMin, run.endMin, at => energyAt(resource,
          run._resourceActivities[resource.id], run.startMin, at) < resource.reserveWh);
        if (time !== null) times.push(time);
      }
    }
    if (reasons.includes('來貨溫度')) times.push(run.startMin);
    if (!times.length) {
      // Invalid references fail before dispatch; a failed downstream leg starts
      // after the last successful arrival and its handover, as recorded in events.
      const latest = run.events.filter(event => event.orderId === order.id && event.type !== 'delivery')
        .sort((a, b) => b.timeMin - a.timeMin)[0];
      times.push(latest?.timeMin ?? run.startMin);
    }
    return {id: order.id, label: order.label, timeMin: Math.min(...times), reasons_zh: verdict.reasons_zh};
  });
}
export function verifyAdopted(state, world, field) {
  if (!state.adopted) return {adopted: null, failures: [], changed: false};
  const hash = riskHash(state.risk), saved = state.adopted;
  if (saved.riskHash === hash) {
    const run = restoreRun(saved.run);
    const evaluation = {orders: run.summary.orders.map(order => ({id: order.id, pass: order.status === 'delivered',
      reasons_zh: order.exceptions, legs: saved.plan.assignments.find(item => item?.orderId === order.id)?.legs ?? []}))};
    return {adopted: {...saved, run}, failures: failingOrders(evaluation, run, saved.plan), changed: false};
  }
  const adoptedState = createDefaultState(saved.run.fixture);
  adoptedState.risk = state.risk;
  const evaluation = evaluatePlan(saved.plan, adoptedState, world, field);
  if (!evaluation.run) return {adopted: {...saved, run: restoreRun(saved.run)},
    failures: state.adopted.run.fixture.orders.map(order => ({id: order.id, label: order.label, timeMin: world.startMin,
      reasons_zh: evaluation.orders.find(item => item.id === order.id)?.reasons_zh ?? ['方案無法播放']})), changed: false};
  const adopted = {...saved, run: evaluation.run, verifiedAt: new Date().toISOString(), riskHash: hash};
  return {adopted, failures: failingOrders(evaluation, evaluation.run, saved.plan), changed: true};
}

/** Verify the stage baseline without turning it into an adopted proposal. */
export function verifyMonitoring(state, world, field) {
  if (state.adopted) {
    const checked = verifyAdopted(state, world, field);
    return {...checked, run: checked.adopted.run};
  }
  const baseline = createDefaultState(world.fixture);
  baseline.risk = state.risk;
  const evaluation = evaluatePlan(BASELINE_PLAN, baseline, world, field);
  const failures = failingOrders(evaluation, evaluation.run, BASELINE_PLAN);
  return {adopted: null, changed: false, failures, run: evaluation.run};
}
