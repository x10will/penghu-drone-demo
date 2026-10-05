import { BASELINE_FIXTURE } from './daily-fixture.mjs';

// Local island groups, checked against the fixture coordinates and raster mask.
// A port can occupy a sea cell at this ~1 km resolution; that is not an island ID.
export const ISLAND_GROUPS = Object.freeze({
  N01: '本島', N04: '本島', N07: '本島', N09: '本島', N12: '本島',
  N02: '七美', N05: '七美', N13: '七美', N15: '七美',
  N03: '望安', N06: '望安', N10: '望安', N14: '望安', N11: '吉貝', N08: '虎井',
  depot: '本島', 'magong-clinic': '本島', 'magong-transfer': '本島',
  'qimei-transfer': '七美', 'qimei-clinic': '七美',
});

export function cellOf(meta, lat, lng) {
  const [west, south, east, north] = meta.bbox;
  const [rows, cols] = meta.grid;
  return {
    row: Math.max(0, Math.min(rows - 1, Math.trunc((north - lat) / ((north - south) / rows)))),
    col: Math.max(0, Math.min(cols - 1, Math.trunc((lng - west) / ((east - west) / cols)))),
  };
}

export function createWorld(meta, fixture = BASELINE_FIXTURE) {
  const input = structuredClone(fixture);
  const clinic = input.sites.find(site => site.id === 'qimei-clinic');
  if (clinic) clinic.label = `${clinic.label}（模擬配送點）`;
  const assumptions = Object.fromEntries((meta.assumptions ?? []).map(item => [item.key, item.value]));
  const weatherTimeline = Number.isFinite(assumptions.surge_start_h) && Number.isFinite(assumptions.surge_end_h)
    ? [{ kind: 'baked-surge', fromH: assumptions.surge_start_h, toH: assumptions.surge_end_h,
      ampMs: assumptions.surge_amp_ms, rampH: assumptions.surge_ramp_h, label_zh: '基準強風' }] : [];
  const nodes = [
    ...meta.pads.map(pad => ({ ...pad, label: pad.name, kind: pad.archetype, droneServable: true })),
    ...input.sites.map(site => ({ ...site, name: site.label, ...cellOf(meta, site.lat, site.lng),
      droneServable: site.kind === 'mock-transfer' })),
  ].map(node => ({ ...node, island: ISLAND_GROUPS[node.id], land: Boolean(meta.land[node.row][node.col]) }));
  const reference = input.orders.find(order => order.id === 'ORD-QIMEI') ?? input.orders[0];
  return {
    nodes, fixture: input, weatherTimeline, startMin: input.startMin, endMin: input.endMin,
    weatherContext: {label: meta.scenario?.label, date: meta.scenario?.date ?? input.date,
      baseWindMs: assumptions.base_wind_ms, windFromDeg: assumptions.wind_from_deg,
      windHeightM: 10, season: '12–2 月冬季東北季風'},
    stock: { ...input.batch, nodeId: 'depot', doses: input.batch.quantity, releaseMin: input.batch.availableAtMin },
    perDose: { massKg: reference.massKg / reference.quantity, volumeL: reference.volumeL / reference.quantity },
    profile: input.profile,
    // The artifact's table covers only N01–N15. The engine also routes fixture sites.
    pads: nodes.map(node => ({ ...node, name: node.label })),
  };
}

export function vehicleFromFixture(resource) {
  return { id: resource.id, label: resource.label, type: resource.type, baseNodeId: resource.initialSiteId,
    energyWh: resource.initialEnergyWh, reserveWh: resource.reserveWh,
    capacityKg: resource.capacityKg, capacityL: resource.capacityL, profile: structuredClone(resource.mockProfile) };
}

export function createVehicle(type, id, baseNodeId, fixture = BASELINE_FIXTURE) {
  const template = fixture.resources.find(resource => resource.type === type);
  if (!template) throw new Error(`Unknown vehicle type: ${type}`);
  return { ...vehicleFromFixture(template), id, label: `${id} ${type === 'drone' ? '無人機' : '配送車'}`, baseNodeId };
}

export function createDefaultState(fixture = BASELINE_FIXTURE) {
  return {
    orders: fixture.orders.map(order => ({ id: order.id, label: order.label,
      destinationNodeId: order.destinationId, doses: order.quantity, deadlineMin: order.deadlineMin,
      receivingWindow: [...order.receivingWindow], priority: order.priority })),
    vehicles: fixture.resources.map(vehicleFromFixture),
    risk: { windMultiplier: 1, events: [], safetyLimit: 1 }, adopted: null,
    ai: { baseUrl: '', model: '', apiKey: '', enableThinking: false },
  };
}

export const BASELINE_PLAN = {
  assignments: [
    { orderId: 'ORD-QIMEI', legs: [
      { vehicleId: 'V-01', from: 'depot', to: 'magong-transfer' },
      { vehicleId: 'D-01', from: 'magong-transfer', to: 'qimei-transfer' },
      { vehicleId: 'V-02', from: 'qimei-transfer', to: 'qimei-clinic' },
    ] },
    { orderId: 'ORD-MAGONG', legs: [{ vehicleId: 'V-01', from: 'depot', to: 'magong-clinic' }] },
  ],
  notes_zh: '今日基準計畫：七美交接優先，再配送馬公訂單。',
};
