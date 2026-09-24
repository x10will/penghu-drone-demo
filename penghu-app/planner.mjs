// In-browser port of twin/router.py (space-time A* over the danger field).
// The Python router is the oracle: tests/penghu-planner.unit.mjs compares this
// module against tests/fixtures/router-parity.json. Fields are Float32Array like
// the router's float32 numpy arrays, and all arithmetic runs in doubles as
// Python's does. Python-computed artifact geometry fixes planning across engines;
// oracle fields match exactly except display-only direct_h (relative 1e-12).
// Python-specific rounding (round-half-even, float //) is reproduced below.

const BUCKET_S = 180, SEED_STEP_S = 15 * 60, EPS_DELAY = 1e-4;
const MOVES = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

// ── artifact ─────────────────────────────────────────────────
// constants.py values keyed like the Python module (C.SAFETY_LIMIT, ...).
export const constantsOf = meta => Object.fromEntries(meta.assumptions.map(a => [a.key.toUpperCase(), a.value]));

// router_field.bin: float32 little-endian [danger, margin, wind][frame][row][col].
export function fieldFromArtifact(meta, buffer) {
  const [nRows, nCols] = meta.grid, nFrames = meta.frame_count, size = nFrames * nRows * nCols;
  if (buffer.byteLength !== 3 * size * 4) throw new Error(`router_field.bin: ${buffer.byteLength} bytes, expected ${3 * size * 4}`);
  const all = new Float32Array(buffer);
  return {C: constantsOf(meta), nFrames, nRows, nCols,
    cellM: meta.cell_m, moveCost: meta.move_cost, padDistances: meta.pad_distances_m,
    danger: all.subarray(0, size), margin: all.subarray(size, 2 * size), wind: all.subarray(2 * size),
    land: Uint8Array.from(meta.land.flat()),
    hours: Array.from({length: nFrames}, (_, i) => i * meta.frame_minutes / 60)};
}

export async function loadField(meta, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Router field HTTP ${response.status}`);
  return fieldFromArtifact(meta, await response.arrayBuffer());
}

// ── Python number semantics ──────────────────────────────────
const roundHalfEven = x => { const f = Math.floor(x), d = x - f; return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f; };
// round(x, n): nearest decimal on the exact binary value, ties to even.
export function pyRound(x, n) {
  const exact = x.toFixed(100), dot = exact.indexOf('.'), tail = exact.slice(dot + 1 + n);
  if (!/^50*$/.test(tail)) return Number(x.toFixed(n));
  const kept = exact.slice(0, dot + 1 + n), last = Number(kept.at(n ? -1 : -2));
  return last % 2 ? Number(x.toFixed(n)) : Number(kept);
}
// a // b for a >= 0, b > 0, as CPython's float_floor_div computes it.
function floorDiv(a, b) {
  const div = (a - a % b) / b, floor = Math.floor(div);
  return div - floor > 0.5 ? floor + 1 : floor;
}
const pyFloat = x => Number.isInteger(x) ? x.toFixed(1) : String(x);  // str(float)
const fixed = (x, n) => pyRound(x, n).toFixed(n);  // f"{x:.nf}"

// ── field sampling ───────────────────────────────────────────
const frameH = field => field.C.FRAME_MINUTES / 60;
function interp(field, arr, r, c, tH) {
  const n = field.nFrames, idx = tH / frameH(field), plane = field.nRows * field.nCols, k = r * field.nCols + c;
  const i0 = Math.max(0, Math.min(Math.trunc(idx), n - 1)), i1 = Math.min(i0 + 1, n - 1);
  const frac = Math.min(Math.max(idx - i0, 0), 1);
  return arr[i0 * plane + k] * (1 - frac) + arr[i1 * plane + k] * frac;
}
// danger + margin at (cell, time): the hard-wall quantity.
export const sampleTotal = (field, r, c, tH) => field.total ? interp(field, field.total, r, c, tH)
  : interp(field, field.danger, r, c, tH) + interp(field, field.margin, r, c, tH);
export const sampleDanger = (field, r, c, tH) => interp(field, field.danger, r, c, tH);

// ── geometry ─────────────────────────────────────────────────
export function cellMeters(field) {
  return field.cellM;
}
function cellCenter(field, r, c) {
  const [lngMin, latMin, lngMax, latMax] = field.C.BBOX;
  return [latMax - (r + 0.5) * (latMax - latMin) / field.nRows, lngMin + (c + 0.5) * (lngMax - lngMin) / field.nCols];
}

// ── pad helpers ──────────────────────────────────────────────
const dangerOf = (C, u) => { const x = u / C.U_REF_MS; return Math.min(Math.max(x * x, 0), C.DANGER_CLAMP); };
const marginOf = (C, u, leadH) => dangerOf(C, u + u * (C.MARGIN_A + C.MARGIN_B * Math.max(0, leadH))) - dangerOf(C, u);

// Copy danger/margin; land pads get wind-based values (ground ops are wind-limited).
function prepareField(field, pads) {
  const {C, nFrames, nRows, nCols} = field, plane = nRows * nCols;
  const danger = Float32Array.from(field.danger), margin = Float32Array.from(field.margin);
  for (const p of pads) {
    const k = p.row * nCols + p.col;
    if (!field.land[k]) continue;
    for (let i = 0; i < nFrames; i++) {
      const u = field.wind[i * plane + k], lead = Math.max(0, field.hours[i] - C.ANCHOR_HOUR);
      danger[i * plane + k] = dangerOf(C, u);
      margin[i * plane + k] = marginOf(C, u, lead);
    }
  }
  const total = new Float32Array(danger.length);
  for (let i = 0; i < total.length; i++) total[i] = danger[i] + margin[i];
  return {...field, danger, margin, total};
}

function padsReachable(field, pads, fromId, toId, hM, wM) {
  const {C} = field;
  const distance = (p, q) => {
    if (field.padDistances) return field.padDistances[p.id][q.id];
    const dy = p.row * hM - q.row * hM, dx = p.col * wM - q.col * wM;
    return Math.sqrt(dy * dy + dx * dx); // synthetic fields
  };
  const range = C.CRUISE_MS * C.ENDURANCE_MIN * 60;
  const frontier = [pads.find(p => p.id === fromId)], seen = new Set([fromId]);
  while (frontier.length) {
    const cur = frontier.pop();
    if (cur.id === toId) return true;
    for (const p of pads) if (!seen.has(p.id) && distance(cur, p) <= range) {
      seen.add(p.id); frontier.push(p);
    }
  }
  return false;
}

// ── min-heap on [key0, key1, ...] ────────────────────────────
class Heap {
  constructor(less) { this.items = []; this.less = less; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items; let i = a.push(item) - 1;
    while (i > 0) { const up = (i - 1) >> 1; if (!this.less(a[i], a[up])) break; [a[i], a[up]] = [a[up], a[i]]; i = up; }
  }
  pop() {
    const a = this.items, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

// ── planner ──────────────────────────────────────────────────
// Per-cell lower bound (seconds) of soft cost to reach the destination: reverse
// Dijkstra over each cell's best-over-time danger. Admissible, since true cost at
// any time is at least the min-over-time cost and waits only add.
function dijkstraHeuristic(fld, padCells, dest, moveCost) {
  const {nFrames, nRows, nCols, land, danger, C} = fld, plane = nRows * nCols;
  const dmin = new Float32Array(plane).fill(Infinity);
  for (let i = 0; i < nFrames; i++) for (let k = 0; k < plane; k++) dmin[k] = Math.min(dmin[k], danger[i * plane + k]);
  const h = new Float64Array(plane).fill(Infinity), heap = new Heap((a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))));
  h[dest] = 0; heap.push([0, Math.floor(dest / nCols), dest % nCols]);
  while (heap.size) {
    const [d, r, c] = heap.pop();
    if (d > h[r * nCols + c]) continue;
    MOVES.forEach(([dr, dc], m) => {
      const nr = r + dr, nc = c + dc, nk = nr * nCols + nc;
      if (nr < 0 || nr >= nRows || nc < 0 || nc >= nCols) return;
      if (land[nk] && !padCells.has(nk)) return;
      // cost of the step INTO (r, c) when walking forward
      const nd = d + moveCost[m] * (1 + C.LAMBDA_DANGER * dmin[r * nCols + c]);
      if (nd < h[nk]) { h[nk] = nd; heap.push([nd, nr, nc]); }
    });
  }
  return h;
}

export function plan(field, pads, fromId, toId, departEarliestH, departLatestH) {
  const {C} = field, origin = pads.find(p => p.id === fromId), dest = pads.find(p => p.id === toId);
  if (!origin || !dest) throw new Error(`unknown node: ${fromId} / ${toId}`);
  const [hM, wM] = cellMeters(field);
  if (!padsReachable(field, pads, fromId, toId, hM, wM)) return {status: 'no_safe_route',
    reason_zh: `續航不足：${origin.name} 至 ${dest.name} 無法以單段${C.ENDURANCE_MIN}分鐘續航完成，且無可中停的起降點。`};

  const fld = prepareField(field, pads), {nRows, nCols, land} = fld;
  const padCells = new Set(pads.map(p => p.row * nCols + p.col));
  const originK = origin.row * nCols + origin.col, destK = dest.row * nCols + dest.col;
  const maxTH = Math.min(departEarliestH + C.HORIZON_H, fld.hours.at(-1) + frameH(fld));
  const enduranceS = C.ENDURANCE_MIN * 60, waitS = C.WAIT_STEP_MIN * 60;
  const moveCost = field.moveCost ?? MOVES.map(([dr, dc]) => Math.sqrt((dr * hM) * (dr * hM) + (dc * wM) * (dc * wM)) / C.CRUISE_MS);
  const h = dijkstraHeuristic(fld, padCells, destK, moveCost);

  // states[sid] = [r, c, t_s, airborne_s, parent sid, kind]
  const states = [], visited = new Map(), heap = new Heap((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]));
  let counter = 0;
  function push(r, c, tS, airborne, g, parent, kind) {
    const hr = h[r * nCols + c];
    if (hr === Infinity) return;  // geometrically cut off from the destination
    const key = (r * nCols + c) * 1e4 + floorDiv(tS, BUCKET_S), entries = visited.get(key) || [];
    // Pareto pruning on (cost, airborne time) per (cell, time bucket)
    if (entries.some(([g0, a0]) => g0 <= g && a0 <= airborne)) return;
    visited.set(key, [...entries.filter(([g0, a0]) => !(g <= g0 && airborne <= a0)), [g, airborne]]);
    states.push([r, c, tS, airborne, parent, kind]);
    heap.push([g + hr, counter++, g, states.length - 1]);
  }

  // seed departures across the window (origin waiting is free, tie-broken)
  const latestS = departLatestH * 3600;
  for (let t = departEarliestH * 3600; t <= latestS + 1e-6; t += SEED_STEP_S) {
    const tH = t / 3600;
    if (tH <= maxTH && sampleTotal(fld, origin.row, origin.col, tH) <= C.SAFETY_LIMIT)
      push(origin.row, origin.col, t, 0, EPS_DELAY * (t - departEarliestH * 3600), null, 'seed');
  }

  let goal = null;
  while (heap.size) {
    const [, , g, sid] = heap.pop(), [r, c, tS, airborne] = states[sid];
    if (r * nCols + c === destK) { goal = sid; break; }
    MOVES.forEach(([dr, dc], m) => {  // flight moves
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= nRows || nc < 0 || nc >= nCols) return;
      if (land[nr * nCols + nc] && !padCells.has(nr * nCols + nc)) return;
      const dt = moveCost[m], nt = tS + dt, ntH = nt / 3600;
      if (ntH > maxTH) return;
      const na = airborne + dt;
      if (na > enduranceS) return;
      if (sampleTotal(fld, nr, nc, ntH) > C.SAFETY_LIMIT) return;
      push(nr, nc, nt, na, g + dt + C.LAMBDA_DANGER * sampleDanger(fld, nr, nc, ntH) * dt, sid, 'fly');
    });
    const k = r * nCols + c;  // wait (ground hold) at non-origin pads
    if (padCells.has(k) && k !== originK) {
      const nt = tS + waitS, ntH = nt / 3600;
      if (ntH <= maxTH && sampleTotal(fld, r, c, ntH) <= C.SAFETY_LIMIT) push(r, c, nt, 0, g + waitS, sid, 'wait');
    }
  }

  if (goal === null) return {status: 'no_safe_route',
    reason_zh: `${label(departEarliestH)}–${label(departLatestH)} 出發、${fixed(C.HORIZON_H, 0)} 小時規劃範圍內，`
      + `找不到全程低於安全門檻（danger+margin ≤ ${pyFloat(C.SAFETY_LIMIT)}）的航線。`};
  return reconstruct(states, goal, fld, pads, origin, dest, departEarliestH, hM, wM);
}

export function label(tH) {
  const minutes = roundHalfEven(tH * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function reconstruct(states, goal, fld, pads, origin, dest, earliestH, hM, wM) {
  const {C} = fld, chain = [];
  for (let sid = goal; sid !== null; sid = states[sid][4]) chain.unshift(states[sid]);
  const padAt = new Map(pads.map(p => [`${p.row},${p.col}`, p]));
  const placeName = (r, c) => padAt.get(`${r},${c}`)?.name ?? `(${r},${c})`;
  const closeLeg = (leg, r, c, t1S) => Object.assign(leg, {to_name: placeName(r, c), t1_h: t1S / 3600,
    risk: pyRound(leg.risk, 4), max_cell: pyRound(leg.max_cell, 3), max_cell_h: pyRound(leg.max_cell_h, 3)});

  const path = [], waits = new Map(), legs = [];
  let leg = null, totalRisk = 0, maxCell = 0, prev = null;
  for (const [r, c, tS, , , kind] of chain) {
    const tH = tS / 3600, [lat, lng] = cellCenter(fld, r, c);
    path.push({row: r, col: c, lat, lng, t_h: tH, kind});
    if (kind === 'fly' && prev) {
      leg ??= {from_name: placeName(prev[0], prev[1]), t0_h: prev[2] / 3600, risk: 0, max_cell: 0, max_cell_h: prev[2] / 3600};
      const dt = tS - prev[2], d = sampleDanger(fld, r, c, tH);
      leg.risk += d * dt / 3600;
      totalRisk += d * dt / 3600;
      const total = sampleTotal(fld, r, c, tH);
      maxCell = Math.max(maxCell, total);
      if (total > leg.max_cell) { leg.max_cell = total; leg.max_cell_h = tH; }  // the binding cell of this leg
    }
    if (kind === 'wait') {
      if (leg) { legs.push(closeLeg(leg, r, c, prev[2])); leg = null; }  // landing closes the open leg
      const pad = padAt.get(`${r},${c}`);
      if (!waits.has(pad.id)) waits.set(pad.id, {pad_id: pad.id, name: pad.name, t0_h: prev[2] / 3600, minutes: 0});
      const w = waits.get(pad.id);
      w.minutes += C.WAIT_STEP_MIN;
      w.t1_h = tH;
    }
    prev = [r, c, tS, kind];
  }
  if (leg) legs.push(closeLeg(leg, prev[0], prev[1], prev[2]));  // arrival closes the final leg

  const departH = path[0].t_h, arriveH = path.at(-1).t_h, waitsList = [...waits.values()];
  const delayMin = roundHalfEven((departH - earliestH) * 60);
  const directM = Math.hypot((origin.row - dest.row) * hM, (origin.col - dest.col) * wM);
  const parts = [`建議 ${label(departH)} 出發，預計 ${label(arriveH)} 抵達${dest.name}。`];
  if (delayMin >= 10) parts.push(`較最早可起飛時間延後 ${delayMin} 分鐘，以避開高風險時段。`);
  for (const w of waitsList) parts.push(`途中於${w.name}停等 ${w.minutes} 分鐘，待風險回落後續飛。`);
  parts.push(`全程最大單格風險 ${fixed(maxCell, 2)}（安全門檻 ${pyFloat(C.SAFETY_LIMIT)}）。`);
  return {status: 'ok', from_id: origin.id, to_id: dest.id, depart_h: departH, arrive_h: arriveH,
    depart_label: label(departH), arrive_label: label(arriveH), delay_min: delayMin,
    waited_min: waitsList.reduce((sum, w) => sum + w.minutes, 0), waits: waitsList, legs, path,
    total_risk: pyRound(totalRisk, 4), max_cell_total: pyRound(maxCell, 3),
    direct_h: directM / C.CRUISE_MS / 3600, rationale_zh: parts.join('')};
}
