import { samplePlane } from './planner.mjs';

// A pure scenario overlay shared by route planning and future hazard painting.
// Times are hours, radii are kilometres, and event windows include fromH but
// exclude toH. UI slider bounds belong to the UI; positive finite multipliers
// and safety limits remain valid for callers of this module.
export const DEFAULT_RISK = Object.freeze({windMultiplier: 1, events: Object.freeze([]), safetyLimit: 1});

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

/** Restore the public schema without retaining references to caller objects. */
export function normalizeRisk(risk = {}) {
  const events = [];
  for (const input of Array.isArray(risk?.events) ? risk.events : []) {
    if (!input || !['gust', 'nofly'].includes(input.kind) || typeof input.nodeId !== 'string' || !input.nodeId.trim()) continue;
    if (!Number.isFinite(input.radiusKm) || input.radiusKm < 0 || !Number.isFinite(input.fromH) || !Number.isFinite(input.toH)) continue;
    const fromH = Math.max(0, Math.min(24, input.fromH)), toH = Math.max(0, Math.min(24, input.toH));
    if (fromH >= toH) continue;
    if (input.kind === 'gust' && input.multiplier !== undefined && positive(input.multiplier, null) === null) continue;
    events.push({kind: input.kind, nodeId: input.nodeId.trim(), radiusKm: input.radiusKm, fromH, toH,
      ...(input.kind === 'gust' ? {multiplier: positive(input.multiplier, 1)} : {})});
  }
  return {windMultiplier: positive(risk?.windMultiplier, 1), events, safetyLimit: positive(risk?.safetyLimit, 1)};
}

const canonicalEvents = events => [...events].sort((a, b) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
});

/** Stable FNV-1a 64-bit key; event order and object insertion order are immaterial. */
export function riskHash(risk) {
  const normalized = normalizeRisk(risk);
  const text = JSON.stringify({...normalized, events: canonicalEvents(normalized.events)});
  let hash = 14695981039346656037n;
  for (let i = 0; i < text.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 1099511628211n);
  return `risk-v1-${hash.toString(16).padStart(16, '0')}`;
}

// Accept the planner field or the danger metadata used by the map renderer.
const constant = (field, key, fallback) => field.C?.[key] ?? field[key.toLowerCase()]
  ?? field.assumptions?.find(a => a.key.toUpperCase() === key)?.value ?? fallback;
const dimensions = field => [field.nRows ?? field.grid?.[0], field.nCols ?? field.grid?.[1]];
function landAt(field, row, col) {
  return !!(Array.isArray(field.land?.[row]) ? field.land[row][col] : field.land?.[row * dimensions(field)[1] + col]);
}

function distanceKm(field, row, col, node) {
  const bbox = field.C?.BBOX ?? field.bbox, [rows, cols] = dimensions(field);
  if (bbox && Number.isFinite(node.lat) && Number.isFinite(node.lng)) {
    const [west, south, east, north] = bbox;
    const lat = north - (row + .5) * (north - south) / rows, lng = west + (col + .5) * (east - west) / cols;
    const rad = Math.PI / 180, dlat = (lat - node.lat) * rad, dlng = (lng - node.lng) * rad;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(node.lat * rad) * Math.sin(dlng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  }
  // Synthetic planner fields already specify their physical cell geometry.
  const [height, width] = field.cellM ?? [NaN, NaN];
  return Math.hypot((row - node.row) * height, (col - node.col) * width) / 1000;
}

// `nodes` resolves where events sit; `pads` is the set the planner will receive, and only
// land cells holding one of those are traversable pads.
function applyRiskCell(cell, risk, field, nodes, groundPad = false, pads = nodes) {
  const clamp = constant(field, 'DANGER_CLAMP', 4);
  let multiplier = risk.windMultiplier, prohibited = false, precomputedPad = false;
  for (const event of risk.events) {
    const node = nodes.find(n => n.id === event.nodeId);
    if (!node || !(distanceKm(field, cell.row, cell.col, node) <= event.radiusKm)) continue;
    // A land pad affected by a no-fly event needs its entire time series
    // precomputed: planner.prepareField otherwise replaces the prohibition.
    if (event.kind === 'nofly' && landAt(field, cell.row, cell.col)
      && pads.some(n => n.row === cell.row && n.col === cell.col)) precomputedPad = true;
    if (!(cell.hour >= event.fromH && cell.hour < event.toH)) continue;
    if (event.kind === 'gust') multiplier *= event.multiplier;
    else prohibited = true;
  }
  const wind = cell.wind * multiplier, scale = multiplier * multiplier;
  let danger = Math.min(clamp, Math.max(0, cell.danger * scale));
  // Margin is the increment to the same clamped wind-squared quantity.
  let margin = Math.max(0, Math.min(clamp, (cell.danger + cell.margin) * scale) - danger);
  if (precomputedPad || groundPad) {
    // Use the stored float32 wind, exactly as planner.prepareField does.
    const u = Math.fround(wind), reference = constant(field, 'U_REF_MS', 12);
    const lead = Math.max(0, cell.hour - constant(field, 'ANCHOR_HOUR', 6));
    const sigma = u * (constant(field, 'MARGIN_A', .03) + constant(field, 'MARGIN_B', .008) * lead);
    danger = Math.min(clamp, Math.max(0, (u / reference) ** 2));
    margin = Math.min(clamp, Math.max(0, ((u + sigma) / reference) ** 2)) - danger;
  }
  if (prohibited) {
    danger = clamp;
    // Even a caller-supplied safety limit above the display clamp cannot
    // legalize a no-fly event. Wind itself still has its physical value.
    margin = Math.max(0, risk.safetyLimit + 1 - clamp);
  }
  return {danger, margin, wind, prohibited, precomputedPad};
}

/**
 * Overlay one {danger, margin, wind, row, col, hour} sample. Pass the original
 * field/metadata and nodes with id, row, col and optional lat/lng. Returns
 * {danger, margin, wind, prohibited}; the original sample is never changed.
 */
export function modifyRiskCell(cell, risk, field, nodes = [], pads = nodes) {
  const normalized = normalizeRisk(risk);
  normalized.events = canonicalEvents(normalized.events);
  const groundPad = landAt(field, cell.row, cell.col) && pads.some(node => node.row === cell.row && node.col === cell.col);
  const {danger, margin, wind, prohibited} = applyRiskCell(cell, normalized, field, nodes, groundPad, pads);
  return {danger, margin, wind, prohibited};
}

/**
 * Build independent float32 planes and scenario constants for planner.plan.
 * isProhibitedAt(row, col, hour) supplies the exact hard wall between frames:
 * planner.sampleTotal must check this optional predicate before interpolating.
 */
export function deriveRiskField(field, risk, nodes = [], pads = nodes) {
  const normalized = normalizeRisk(risk);
  normalized.events = canonicalEvents(normalized.events);
  const {nRows, nCols, nFrames} = field, plane = nRows * nCols;
  const derived = {...field, C: {...field.C, SAFETY_LIMIT: normalized.safetyLimit},
    danger: new Float32Array(field.danger.length), margin: new Float32Array(field.margin.length),
    wind: new Float32Array(field.wind.length), land: Uint8Array.from(field.land),
    total: new Float32Array(field.danger.length), riskHash: riskHash(normalized)};
  const nofly = normalized.events.filter(event => event.kind === 'nofly');
  derived.isProhibitedAt = (row, col, hour) => nofly.some(event => {
    if (!(hour >= event.fromH && hour < event.toH)) return false;
    const node = nodes.find(n => n.id === event.nodeId);
    return !!node && distanceKm(field, row, col, node) <= event.radiusKm;
  });
  // Event edges need exact-time samples: a gust can begin and end between two
  // stored frames. Both planner safety and costs use the same cell overlay.
  if (normalized.events.length) derived.riskSampleAt = (row, col, hour) => {
    const groundPad = landAt(field, row, col) && pads.some(node => node.row === row && node.col === col);
    return applyRiskCell({row, col, hour, danger: samplePlane(field, field.danger, row, col, hour),
      margin: samplePlane(field, field.margin, row, col, hour), wind: samplePlane(field, field.wind, row, col, hour)},
      normalized, field, nodes, groundPad, pads);
  };
  for (let frame = 0; frame < nFrames; frame++) for (let row = 0; row < nRows; row++) for (let col = 0; col < nCols; col++) {
    const k = row * nCols + col, i = frame * plane + k;
    const result = applyRiskCell({danger: field.danger[i], margin: field.margin[i], wind: field.wind[i],
      row, col, hour: field.hours[frame]}, normalized, field, nodes, false, pads);
    derived.danger[i] = result.danger;
    derived.margin[i] = result.margin;
    derived.wind[i] = result.wind;
    derived.total[i] = derived.danger[i] + derived.margin[i];
    // These cells are already traversable pads. Clearing their derived land
    // flag only skips planner's wind recomputation; non-pad land stays blocked.
    if (result.precomputedPad) derived.land[k] = 0;
  }
  return derived;
}
