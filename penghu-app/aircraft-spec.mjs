// Public aircraft limits are shared by the fixture and planner fallbacks.
export const AIRCRAFT_SPEC = Object.freeze({
  name: 'JEDSY Jedsy X',
  cruiseMs: 27.8,
  operatingWindMs: 12,
  bodyWindMs: 15,
  payloadKg: 3,
  rangeKm: 120,
  enduranceMin: 106,
  publishedEnduranceMin: 118,
  reserveFraction: .1,
  travelWhPerKm: 12,
  payloadBox: 'VACUETTE UN3373 運輸箱',
  source_ids: ['S5', 'S6', 'S7', 'S8', 'S9'],
});

export const AIRCRAFT_CRUISE_KPH = AIRCRAFT_SPEC.cruiseMs * 3.6;
export const AIRCRAFT_PACK_WH = AIRCRAFT_SPEC.rangeKm * AIRCRAFT_SPEC.travelWhPerKm / (1 - AIRCRAFT_SPEC.reserveFraction);
export const AIRCRAFT_RESERVE_WH = AIRCRAFT_PACK_WH * AIRCRAFT_SPEC.reserveFraction;
export const AIRCRAFT_ENERGY_BASIS = '電池容量廠商未公布；1,600 Wh 為依公布航程 120 km（3 kg、保留 10%）推算';
