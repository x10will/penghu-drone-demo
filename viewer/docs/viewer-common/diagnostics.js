// Engine-neutral SML Z-fault verdict logic (viewer-engine-policy: shared logic
// lives under viewer-common/). PURE functions — NO Three.js, DOM, camera, or
// fetch. Each viewer computes verdicts on the authoritative `edges.json`
// centerline polyline + z_lineage (the synth's output, the source of truth) and
// renders them however it likes: base.js draws THREE.Line overlays; the
// production viewer recolors the matching edges.glb mesh by dt_edge_id.
//
// Ported verbatim from base.js (sml-viewer-diagnostic-convergence) so both
// viewers report identical faults. The ONLY change is computeCliffNodes takes
// geoToLocal as a parameter instead of closing over a module global — keeping
// this module free of any viewer-specific projection constants.
//
// The fault axes (see base.js for the long-form rationale). The canonical list,
// with colors + the rule that fires each, is the DIAGNOSTIC_AXES registry at the
// foot of this file — that table is the SINGLE authority; this comment is a map:
//   • cliff      (red)     — unjustified walking/cycling snap-adjacent node-Z cliff
//   • submerged  (magenta) — driving edge dipping below the lake disk, in-basin
//   • steep      (yellow)  — walking/cycling edge whose avg grade exceeds its cap
//   • overlap    (cyan)    — same surface mapped as two cross-mode edges (topological)
//   • eat/gap/spike         — terrain.glb-vs-road-deck relief faults (group 'relief')

// ── Cliff (node-Z fault) ───────────────────────────────────────────
// A walking/cycling edge whose snap-adjacent (tool === "node") flank segment's
// grade exceeds cap × slack flanks an unjustified cliff. JUSTIFIED if the flank
// node has an incident stairs edge or is a terminus.
export const CLIFF_MODE_CAP = { walking: 0.25, cycling: 0.08 };
export const CLIFF_SLACK = 4.0;

// ── Submerged (road-Z fault) ───────────────────────────────────────
export const LAKE_SURFACE_Z = 748.48;
export const SUBMERGED_DROP_M = 2.0;     // below lake surface by at least this
export const SUBMERGED_BASIN_M = 1700;   // within this of lake center = "in the lake"

// ── Steep slope (reality fault, not a Z fault) ─────────────────────
export const STEEP_SLOPE_MIN_LEN_M = 10;
export const STEEP_MODE_CAP = { walking: 0.25, cycling: 0.08 };

// Returns Map<node_twin_id, maxGradePct> for UNJUSTIFIED cliff-flanking nodes.
// geoToLocal(lat, lng) → [x, y] is injected by the caller (both viewers share
// the same projection constants); the grade is computed in that local frame.
export function computeCliffNodes(edges, roleByNode, geoToLocal) {
  // Nodes with >=1 incident stairs edge — these justify an adjacent cliff.
  const stairNodes = new Set();
  for (const e of edges) {
    if (e.mode === 'stairs') { stairNodes.add(e.from_node); stairNodes.add(e.to_node); }
  }
  const justified = (nodeId) =>
    stairNodes.has(nodeId) || roleByNode.get(nodeId) === 'terminus';

  const cliff = new Map();
  for (const e of edges) {
    const cap = CLIFF_MODE_CAP[e.mode];
    if (cap === undefined) continue;            // walking/cycling only
    const p = e.polyline_3d, zl = e.z_lineage;
    if (!p || !zl || p.length < 2 || zl.length !== p.length) continue;
    const thr = cap * CLIFF_SLACK;
    const segs = [];
    if (zl[0]?.tool === 'node') segs.push([0, 1, e.from_node]);
    if (zl[zl.length - 1]?.tool === 'node') segs.push([p.length - 2, p.length - 1, e.to_node]);
    for (const [i, j, flank] of segs) {
      if (!flank || justified(flank)) continue;
      const [xi, yi] = geoToLocal(p[i][0], p[i][1]);
      const [xj, yj] = geoToLocal(p[j][0], p[j][1]);
      const h = Math.hypot(xj - xi, yj - yi);
      if (h <= 0) continue;
      const grade = Math.abs(p[j][2] - p[i][2]) / h;
      if (grade > thr) cliff.set(flank, Math.max(cliff.get(flank) ?? 0, grade * 100));
    }
  }
  return cliff;
}

// Returns the deepest submerged-in-basin [x, y, z] of a driving edge, or null.
// xyzPositions is a flat [x0,y0,z0, x1,y1,z1, ...] array in the viewer's local
// frame (caller projects the polyline first).
export function submergedInBasinPoint(edge, xyzPositions) {
  if (edge.mode !== 'driving') return null;
  let deepest = null;
  for (let i = 0; i < xyzPositions.length; i += 3) {
    const z = xyzPositions[i + 2];
    if (z >= LAKE_SURFACE_Z - SUBMERGED_DROP_M) continue;
    const x = xyzPositions[i], y = xyzPositions[i + 1];
    if (Math.hypot(x, y) > SUBMERGED_BASIN_M) continue;   // descent road, not lake
    if (!deepest || z < deepest[2]) deepest = [x, y, z];
  }
  return deepest;
}

// ── Below-lake (exhaustive underwater axis) ────────────────────────
// `submerged` above is DRIVING-only and gated on a basin disk, so it cannot see a
// walking/cycling/stairs deck under the lake, nor an underwater NODE. `below-lake`
// is the exhaustive complement: it fires for ANY node OR deck vertex (all modes)
// whose authored Z is below the lake full-pool surface (LAKE_SURFACE_Z) and which
// lies in/near the lake footprint. Near-lake is an INJECTED predicate
// `isNearLake(lat, lng) -> bool` — parity with `computeCliffNodes`'s injected
// geoToLocal — so this module holds no lake geometry / projection constants and
// stays unit-testable. Inputs are raw graph records (intersections.json nodes,
// edges.json edges), NOT pre-projected xyz, because the predicate keys off lat/lng.

// Returns [{ id, z, lat, lng }] for below-full-pool nodes in/near the lake.
export function belowLakeNodes(intersections, isNearLake) {
  const out = [];
  for (const n of intersections || []) {
    const z = n.z;
    if (typeof z !== 'number' || z >= LAKE_SURFACE_Z) continue;
    if (!isNearLake(n.lat, n.lng)) continue;
    out.push({ id: n.twin_id ?? n.id, z, lat: n.lat, lng: n.lng });
  }
  return out;
}

// Returns [{ id, mode, point:[lat,lng,z] }] for edges with a below-full-pool deck
// vertex in/near the lake — one entry per edge, at its DEEPEST such vertex.
// Only TUNNEL edges are excluded: a tunnel is below-ground *by design*, so its
// floor sitting below the lake surface is not a submerged-deck fault. Bridges are
// NOT excluded: a bridge is above-water by design, so a bridge deck below the lake
// surface IS a submerged deck — at SML the over-water boardwalks (月潭自行車道) are
// OSM-tagged bridge=yes and are exactly the fault this axis must surface. Excluding
// them would silently drop the strongest below-lake cases (contradicting the spec's
// "ANY deck vertex"). Genuinely-elevated bridges are filtered by Z (deck > full-pool
// ⇒ not flagged), so including bridges adds only real submerged decks.
export function belowLakeDeckVerts(edges, isNearLake) {
  const out = [];
  for (const e of edges || []) {
    if (e.tunnel) continue;
    const poly = e.polyline_3d || e.polyline;
    if (!poly) continue;
    let worst = null;
    for (const p of poly) {
      if (!p || p.length < 3) continue;
      const z = p[2];
      if (z >= LAKE_SURFACE_Z) continue;
      if (!isNearLake(p[0], p[1])) continue;
      if (!worst || z < worst[2]) worst = p;
    }
    if (worst) out.push({ id: e.id, mode: e.mode, point: worst });
  }
  return out;
}

// Returns midpoint [x, y, z, grade] if the edge is steep-slope, else null.
// xyzPositions is the same flat local-frame array submergedInBasinPoint takes.
export function steepSlopeMarker(edge, xyzPositions) {
  const cap = STEEP_MODE_CAP[edge.mode];
  if (cap === undefined) return null;
  const n = xyzPositions.length / 3;
  if (n < 2) return null;
  let len = 0;
  for (let i = 0; i < n - 1; i++) {
    const dx = xyzPositions[(i + 1) * 3] - xyzPositions[i * 3];
    const dy = xyzPositions[(i + 1) * 3 + 1] - xyzPositions[i * 3 + 1];
    len += Math.hypot(dx, dy);
  }
  if (len < STEEP_SLOPE_MIN_LEN_M) return null;
  const z0 = xyzPositions[2];
  const z1 = xyzPositions[(n - 1) * 3 + 2];
  const climb = Math.abs(z1 - z0);
  if (climb / len <= cap) return null;
  const mid = Math.floor(n / 2);
  return [xyzPositions[mid * 3], xyzPositions[mid * 3 + 1], xyzPositions[mid * 3 + 2], climb / len];
}

// ── Overlap / duplicate edges (TOPOLOGICAL fault, not a Z fault) ────
// The three axes above are Z-fault detectors. This fourth axis detects a
// TOPOLOGICAL fault: the same physical surface carried as multiple
// overlapping cross-mode edges — a shared deck mapped as both a `walkway`
// and a `cycleway` way, or a road grazing a cycleway. It is a symptom of an
// incomplete T-1 source, and today it only ever surfaces MISLABELED as a
// downstream Z symptom (a buried-deck cliff). A PAIR is flagged when the
// edges are DIFFERENT mode AND coincident (>= OVERLAP_MIN_SHARED_VERTS verts
// of one within OVERLAP_COINCIDENCE_M of the other's polyline) AND co-aligned
// (their coincident-span bearings agree, undirected, within
// OVERLAP_BEARING_TOL_DEG) — so a one-point crossing or a perpendicular X
// does NOT flag. Same-mode parallels are not, on their own, duplicate-surface
// evidence, so different-mode is required.
export const OVERLAP_COINCIDENCE_M = 5.0;   // local-frame metres
export const OVERLAP_MIN_SHARED_VERTS = 2;  // coincident verts to count as a shared run
export const OVERLAP_BEARING_TOL_DEG = 30;  // undirected span-bearing agreement
// Modes excluded from this axis: a rail-like ('mixed') edge is a SEPARATE grade
// structure — a railway is not a pedestrian/road *surface*, so a path or road
// running within OVERLAP_COINCIDENCE_M of it is real-world co-location, NOT the
// "same physical surface mapped twice" this axis targets. Including them produced
// proximity false-positives (e.g. a forest footpath laid 2–3 m beside a railway
// flagged as a duplicate). SML has no 'mixed' overlaps, so its pinned count is
// unaffected; the railway-parallel false blues in rail sites (Alishan) clear.
export const OVERLAP_EXCLUDED_MODES = new Set(['mixed']);
// Endpoints within this distance are the SAME junction. Used by the opt-in
// shared-junction-graze discount: two edges meeting at a junction are coincident
// AT that node by connectivity, not surface duplication, so a path/road that
// merely touches another at an intersection and then diverges is not a duplicate.
export const OVERLAP_SHARED_NODE_M = 1.0;   // local-frame metres
// Strict duplicate-surface gate (opt-in, opts.strictDuplicateSurface): median
// separation the coincident verts must stay under to count as "the same physical
// surface mapped twice". Sites where paths are deliberately BUILT 2–5 m beside
// roads (Alishan boardwalks along forest roads) opt in — a parallel run at a
// steady 2–5 m offset is real-world co-location, while a true duplicate mapping
// sits well under 2 m. OFF by default at the function level; both Alishan and
// SML opt in via site-config (SML since sml-overlap-cleanup, pinned net 4/8).
export const OVERLAP_STRICT_MEDIAN_M = 2.0; // local-frame metres, median vert separation

function _segDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function _polylineMinDist(px, py, pts) {
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = _segDistSq(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function _nearestVertex(px, py, pts) {
  let best = pts[0], bd = Infinity;
  for (const q of pts) {
    const d = (px - q[0]) ** 2 + (py - q[1]) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

// Undirected angle (0..90°) between segment a→b and segment c→d.
function _undirectedBearingDiffDeg(ax, ay, bx, by, cx, cy, dx, dy) {
  let diff = Math.abs(Math.atan2(by - ay, bx - ax) - Math.atan2(dy - cy, dx - cx)) * 180 / Math.PI;
  diff %= 360;
  if (diff > 180) diff = 360 - diff;
  if (diff > 90) diff = 180 - diff;   // undirected — overlap is direction-agnostic
  return diff;
}

// Returns overlapping cross-mode edge PAIRS: [{ a, b, sharedVerts }, ...]
// (edge ids + the coincident vertex count). geoToLocal(lat, lng) -> [x, y] is
// injected by the caller (both viewers share the projection), keeping this
// module free of projection constants — identical contract to computeCliffNodes.
//
// opts.discountSharedJunctions (default false): when two edges meet at exactly ONE
// shared junction and only coincide near it (then diverge), ignore the coincidence
// at that node — it's connectivity, not surface duplication. Edges that share BOTH
// endpoints (a parallel run between the same two junctions, the road↔sidewalk case)
// are NOT discounted. OFF by default so existing pins are byte-stable; rail sites
// (Alishan), where graph edges naturally fan out from shared junctions, opt in.
//
// opts.strictDuplicateSurface (default false): tighten the test to what a true
// duplicate mapping actually looks like. (1) Coincident verts within
// OVERLAP_SHARED_NODE_M of a junction endpoint shared by BOTH edges never count
// toward OVERLAP_MIN_SHARED_VERTS — including the both-endpoints case the
// discount exempts: two edges connecting the SAME two junctions via different
// paths coincide only AT those junctions, which is connectivity, not surface
// duplication. (2) The MEDIAN separation of the coincident verts must be
// <= OVERLAP_STRICT_MEDIAN_M — a boardwalk built at a steady 2–5 m beside a
// road is a real separate structure, not a duplicate. OFF by default at the
// function level; Alishan (boardwalk-beside-forest-road) and SML (since
// sml-overlap-cleanup) both opt in via site-config.
export function overlapEdges(edges, geoToLocal, opts = {}) {
  const R = OVERLAP_COINCIDENCE_M;
  const discountSharedJunctions = opts.discountSharedJunctions === true;
  const strictDuplicateSurface = opts.strictDuplicateSurface === true;
  // Project once; precompute bbox + mode. Edges without usable geometry/mode skip.
  const recs = [];
  for (const e of edges) {
    const poly = e.polyline_3d || e.polyline;
    if (!poly || poly.length < 1 || !e.mode) continue;
    if (OVERLAP_EXCLUDED_MODES.has(e.mode)) continue;  // rail/mixed: separate grade, never a shared surface
    const pts = [];
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of poly) {
      const [x, y] = geoToLocal(p[0], p[1]);
      pts.push([x, y]);
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    recs.push({ id: e.id, mode: e.mode, pts, bbox: [minx, miny, maxx, maxy] });
  }
  const pairs = [];
  for (let i = 0; i < recs.length; i++) {
    const a = recs[i];
    for (let j = i + 1; j < recs.length; j++) {
      const b = recs[j];
      if (a.mode === b.mode) continue;                 // different-mode required
      // bbox pre-filter (expanded by R) — cheap reject for the all-pairs scan
      if (a.bbox[0] - R > b.bbox[2] || b.bbox[0] - R > a.bbox[2]
        || a.bbox[1] - R > b.bbox[3] || b.bbox[1] - R > a.bbox[3]) continue;
      // Optional shared-junction-graze discount: ignore a-verts within R of a
      // SINGLE shared endpoint (the junction the two edges fan out from). Sharing
      // BOTH endpoints = a parallel run between the same junctions → not discounted.
      let nearSharedNode = null;
      let sharedNodes = null;
      if (discountSharedJunctions || strictDuplicateSurface) {
        const aEnds = [a.pts[0], a.pts[a.pts.length - 1]];
        const bEnds = [b.pts[0], b.pts[b.pts.length - 1]];
        sharedNodes = [];
        for (const ae of aEnds) for (const be of bEnds) {
          if (Math.hypot(ae[0] - be[0], ae[1] - be[1]) <= OVERLAP_SHARED_NODE_M) sharedNodes.push(ae);
        }
        if (discountSharedJunctions && sharedNodes.length === 1) {
          const s = sharedNodes[0];
          nearSharedNode = (px, py) => Math.hypot(px - s[0], py - s[1]) <= R;
        }
      }
      // count a-verts within R of b's polyline; record the coincident span
      let shared = 0, firstA = -1, lastA = -1;
      const dists = strictDuplicateSurface ? [] : null;  // per-coincident-vert separations, for the strict median gate
      for (let k = 0; k < a.pts.length; k++) {
        if (nearSharedNode && nearSharedNode(a.pts[k][0], a.pts[k][1])) continue;  // connectivity, not duplication
        // Strict: a coincident vert AT a shared junction (either endpoint, incl. the
        // both-endpoints case) is connectivity, not duplication — never counts.
        if (strictDuplicateSurface && sharedNodes.some(
          (s) => Math.hypot(a.pts[k][0] - s[0], a.pts[k][1] - s[1]) <= OVERLAP_SHARED_NODE_M,
        )) continue;
        const d = _polylineMinDist(a.pts[k][0], a.pts[k][1], b.pts);
        if (d <= R) {
          shared++;
          if (firstA < 0) firstA = k;
          lastA = k;
          if (dists) dists.push(d);
        }
      }
      if (shared < OVERLAP_MIN_SHARED_VERTS) continue;
      // Strict: median separation of the coincident verts must sit under the
      // duplicate threshold — a steady 2–5 m parallel (boardwalk beside a road)
      // is a real separate structure, not the same surface mapped twice.
      if (dists) {
        dists.sort((x, y) => x - y);
        const mid = dists.length >> 1;
        const median = dists.length % 2 ? dists[mid] : (dists[mid - 1] + dists[mid]) / 2;
        if (median > OVERLAP_STRICT_MEDIAN_M) continue;
      }
      // co-alignment over the coincident span (undirected). A degenerate span
      // (single coincident vertex, or zero-length on either side) falls back to
      // the shared-count test alone so 2-pt stubs are not silently dropped.
      let aligned = true;
      if (firstA !== lastA) {
        const af = a.pts[firstA], al = a.pts[lastA];
        const bf = _nearestVertex(af[0], af[1], b.pts);
        const bl = _nearestVertex(al[0], al[1], b.pts);
        const aSpan = af[0] !== al[0] || af[1] !== al[1];
        const bSpan = bf[0] !== bl[0] || bf[1] !== bl[1];
        if (aSpan && bSpan) {
          aligned = _undirectedBearingDiffDeg(
            af[0], af[1], al[0], al[1], bf[0], bf[1], bl[0], bl[1],
          ) <= OVERLAP_BEARING_TOL_DEG;
        }
      }
      if (!aligned) continue;
      pairs.push({ a: a.id, b: b.id, sharedVerts: shared });
    }
  }
  return pairs;
}

// ── Stairs-flat (EVIDENCE fault) — sml-stairs-flat-axis ────────────
// A step-counted OSM stairs way whose T2 member edges' summed endpoint |dz|
// is under half the conservative minimum rise its `step_count` implies — the
// staircase has been LEVELED (the 水濱婚紗廣場 trestle class: 24 wooden steps
// flattened to 0.73 m by node-consensus leveling). WAY-level so split ways
// aggregate (way 65630189's 367 steps span two edges — per-edge would
// false-positive); member edges match by lineage.source.way_id regardless of
// mode. MIRRORS tests/t2/test_node_z_evidence_gates.py Gate A — keep the two
// in sync (same constants, same bound), so the viewer marks exactly what the
// build gate pins.
export const STAIRS_MIN_RISER_M = 0.13;
export const STAIRS_RISER_FRACTION = 0.5;

// Returns [{ wayId, stepCount, edges: [ids], sumDz, expectedMin,
//            anchor: [lat, lng, z] }] — anchor is the mid vertex of the first
// member edge's polyline (beacon placement).
export function stairsFlatViolations(edges, stepWays) {
  const byWay = new Map();
  for (const e of edges || []) {
    const wid = e?.lineage?.source?.way_id;
    if (wid == null) continue;
    if (!byWay.has(wid)) byWay.set(wid, []);
    byWay.get(wid).push(e);
  }
  const out = [];
  for (const w of stepWays || []) {
    const members = byWay.get(w.way_id);
    if (!members || !members.length) continue;   // evidence without geometry: coverage, not a Z fault
    let sumDz = 0;
    const ids = [];
    for (const e of members) {
      const pl = e.polyline_3d || [];
      if (pl.length >= 2) sumDz += Math.abs(pl[pl.length - 1][2] - pl[0][2]);
      ids.push(e.id);
    }
    const expectedMin = w.step_count * STAIRS_MIN_RISER_M * STAIRS_RISER_FRACTION;
    if (sumDz >= expectedMin) continue;
    const pl0 = members[0].polyline_3d || [];
    const anchor = pl0.length ? pl0[Math.floor(pl0.length / 2)] : null;
    out.push({
      wayId: w.way_id, stepCount: w.step_count, edges: ids,
      sumDz: Math.round(sumDz * 100) / 100,
      expectedMin: Math.round(expectedMin * 100) / 100,
      anchor,
    });
  }
  return out;
}

// ── Diagnostics-overlay visibility ─────────────────────────────────
// The two scene groups the "Diagnostics" toggle owns: the sim-node spheres AND the
// fault-beacon group (makeBeacon sprites). setDiagnosticsVisible historically flipped
// only `simNodesGroup`, so the beacons were created visible and never gated — the
// toggle "did nothing" to the yellow/blue squares, and they blocked the view. Listing
// both here makes the toggle authoritative. THREE-free: the caller injects
// setVisible(group, on) (group.visible + leaf traverse), so this stays unit-testable.
// `reliefGroup` is the surface-relief beacons (eat/gap/spike, loaded offline from
// relief_faults.json) — also a Faults-group overlay, so it rides the same toggle.
export const DIAGNOSTIC_LAYER_KEYS = ['simNodesGroup', 'diagnosticsGroup', 'reliefGroup'];

export function applyDiagnosticsVisibility(diag, on, setVisible) {
  for (const key of DIAGNOSTIC_LAYER_KEYS) {
    const group = diag && diag[key];
    if (group) setVisible(group, !!on);
  }
}

// The terrain-fault axis (5th) rides the SAME master Diagnostics toggle as every other axis —
// "we have a diagnosis button that turns all diagnosis on and off" (no axis opts out). Its pins
// additionally require the "terrain faults" sub-checkbox on top of the master (see
// terrainFaultPinsVisible below): the checkbox narrows what the master already turned on, it
// cannot show pins the master has hidden. Deliberately NOT in DIAGNOSTIC_LAYER_KEYS — that list
// applies a group's visibility as the master's ON/OFF value directly, but the pin group needs
// the extra AND term, so the caller (main.js) resolves masterOn && subOn first and passes the
// result in here.
export const TERRAIN_FAULT_LAYER_KEY = 'terrainFaultGroup';

export function applyTerrainFaultVisibility(diag, on, setVisible) {
  const group = diag && diag[TERRAIN_FAULT_LAYER_KEY];
  if (group) setVisible(group, !!on);
}

// True iff the terrain-fault PIN group should be visible: BOTH the master Diagnostics toggle
// AND the "terrain faults" sub-checkbox. The sub-checkbox alone (master off) shows nothing;
// re-enabling the master restores whatever the sub-checkbox already said — no orphan states.
export function terrainFaultPinsVisible({ masterOn, subOn }) {
  return !!masterOn && !!subOn;
}

// Resolves the color one edge should display for a recolor-managed axis (submerged/steep/
// overlap/below-lake/stairs-flat/terrain-fault) given the master Diagnostics toggle state.
// Terrain-fault color OUTRANKS every other toggle-managed axis color on a dual-fault edge —
// main.js's setDiagnosticsVisible applies DIAG.terrainFaultColorById AFTER DIAG.edgeColorById,
// which is this same "terrain wins" priority expressed as apply order rather than as a
// load-time eviction. Returns null when the master is off, meaning: reset the edge to its own
// recorded base color instead of rendering a fault color.
export function resolveEdgeDisplayColor({ masterOn, axisColor, terrainColor }) {
  if (!masterOn) return null;
  return terrainColor ?? axisColor ?? null;
}

// On-screen legend rows for whichever diagnostic axes are BOTH present (count > 0) AND toggled on,
// so the key matches exactly what's drawn (no rows for axes with no markers). Colors mirror the
// hexes in main.js (CLIFF/SUBMERGED/STEEP/OVERLAP) + TERRAIN_FAULT_COLOR here.
// SUPERSEDED by legendModel()/buildDiagnosticLegend() below (main.js imports only legendModel) —
// this function is dead in the live render path but stays covered by its own tests. Slated for
// consolidation in a follow-up; keep any row added here mirrored there and vice versa until then.
export function diagnosticLegendEntries(diag, { terrainFaults = false, diagnostics = false } = {}) {
  const d = diag || {};
  const rows = [];
  if (terrainFaults) {
    if (d.terrainFaultCount > 0) {
      rows.push({ key: 'rollercoaster', color: TERRAIN_FAULT_COLOR.rollercoaster, label: 'rollercoaster', desc: 'path floats above the ground' });
      rows.push({ key: 'tunnel',        color: TERRAIN_FAULT_COLOR.tunnel,        label: 'tunnel',        desc: 'path buried below the ground' });
      rows.push({ key: 'carve',         color: TERRAIN_FAULT_COLOR.carve,         label: 'carve',         desc: 'terrain gouged to meet the path' });
      rows.push({ key: 'mound',         color: TERRAIN_FAULT_COLOR.mound,         label: 'mound',         desc: 'terrain raised to meet the path' });
      rows.push({ key: 'side_ridge',    color: TERRAIN_FAULT_COLOR.side_ridge,    label: 'side ridge',    desc: 'terrain wall beside the path' });
      rows.push({ key: 'side_trench',   color: TERRAIN_FAULT_COLOR.side_trench,   label: 'side trench',   desc: 'terrain notch beside the path' });
    }
  }
  if (diagnostics) {
    if (d.steepSlopeCount > 0) rows.push({ key: 'steep',     color: 0xffdd00, label: 'steep slope',   desc: 'grade over the mode limit' });
    if (d.overlapCount   > 0) rows.push({ key: 'overlap',   color: 0x22ddff, label: 'duplicate edge', desc: 'overlapping cross-mode edges' });
    if (d.submergedCount > 0) rows.push({ key: 'submerged', color: 0xff22ff, label: 'submerged',     desc: 'driving edge below the lake' });
    if (d.belowLakeCount > 0) rows.push({ key: 'belowLake', color: 0x2255ff, label: 'below lake',     desc: 'any node/deck below the lake surface, near the lake' });
    if (d.cliffNodeCount > 0) rows.push({ key: 'cliff',     color: 0xff2222, label: 'cliff node',    desc: 'unjustified node-Z cliff' });
    if (d.stairsFlatCount > 0) rows.push({ key: 'stairsFlat', color: 0xff66aa, label: 'stairs flat', desc: 'staircase leveled vs its OSM step_count' });
  }
  return rows;
}

// ── Terrain-fault axis (5th) — edges vs the rendered TERRAIN SURFACE ────────────────
// Unlike the cliff/submerged/steep/overlap axes (computed client-side from edges.json), these
// need a terrain.glb ray-cast, so AliShanTwin's measure_edge_terrain generates them offline into
// t2/edges/terrain_faults.json (id + verdict + metrics + worst-point lat/lng/z). The viewer just
// renders them: recolor the edge by id + a beacon at the worst point.
//   rollercoaster — a grounded edge floats above the terrain
//   tunnel        — the edge sits BELOW the terrain surface
//   carve         — terrain gouged below the DEM to meet a conforming edge (the V-gorge)
//   mound         — terrain raised above the DEM to meet a conforming edge (the berm symmetric
//                   to carve; measure_edge_terrain's classify() mound verdict)
//   side_ridge / side_trench — beside-ribbon earthwork the CENTERLINE raycast is blind to: a
//                   fabricated wall/notch a few metres off the ribbon (cross_section_scan,
//                   wired into this file via --with-cross-section, tagged source=cross_section)
//
// COLORS are kept identical to master's DIAGNOSTIC_AXES relief palette (be3fa7d, the #25
// single-registry SSOT) by FIRING SEMANTICS, so the merged legend never contradicts itself:
//   rollercoaster (floats above)  == gap   (float)  → green  0x33dd55
//   tunnel        (buried below)  == eat   (buried) → orange 0xcc6622
//   carve         (terrain gouge) == spike (3rd)    → purple 0x8844ff
//   mound         (terrain berm)  == mound (relief)  → olive  0x6f8f3d (same hex, reused)
// This axis predates that registry; the follow-up is to drop this map and source colors from
// DIAGNOSTIC_AXES once master is merged in. Until then, keep these in sync with it.
//
// side_ridge/side_trench ARE first-class DIAGNOSTIC_AXES rows (group 'relief', below) — unlike
// rollercoaster/tunnel/carve/mound above, which alias an EXISTING axis's color by firing
// semantics, these two have no genuine counterpart (spike's firing rule — a thin terrain sliver
// near a road — is the closest description, but spike's hex is already claimed by carve above,
// and adjacentCut/cutWide/cutSteep are authored-operation validity checks, not a raw terrain-vs-
// surroundings excursion) so they were registered directly instead of aliased. The crimson/violet
// pair was chosen at a pairwise RGB distance of 70+ from every one of the (then-)15 existing
// DIAGNOSTIC_AXES + TERRAIN_FAULT_COLOR hexes — a clean margin above the 24-39 near-collision
// range a previous amber/sky-blue pair sat in (side_ridge vs cutWide, side_trench vs
// adjacentCut) — the worst case since terrain-fault pins toggle independently of the Diagnostics
// master and both sets can render together.
export const TERRAIN_FAULT_COLOR = {
  rollercoaster: 0x33dd55,  // green   — == DIAGNOSTIC_AXES.gap (float)
  tunnel:        0xcc6622,  // orange  — == DIAGNOSTIC_AXES.eat (buried)
  carve:         0x8844ff,  // purple  — == DIAGNOSTIC_AXES.spike (3rd terrain-vs-deck fault)
  // mound/side_ridge/side_trench are filled in below, once DIAGNOSTIC_AXES (their registry
  // entry) exists — see the assignments just after the DIAGNOSTIC_AXES declaration.
};

export function terrainFaultMarkers(faults, geoToLocal) {
  return (faults || []).map((f) => {
    const marker = {
      id: f.id,
      verdict: f.verdict,
      color: TERRAIN_FAULT_COLOR[f.verdict] ?? 0xffffff,
      // cross_section rows (side_ridge/side_trench) are a point-local worst-point
      // excursion a few metres OFF the ribbon — painting the WHOLE edge mesh in
      // their color reads as a cliff-red corridor, not a local wall/notch. Only the
      // 4 centerline verdicts (rollercoaster/tunnel/carve/mound) own the edge color;
      // cross_section verdicts are pin-only.
      recolorEdge: f.source !== 'cross_section',
      fields: {
        is_terrain_fault: true, terrain_verdict: f.verdict, dt_edge_id: f.id,
        max_float: f.max_float, max_dive: f.max_dive, carve_depth: f.carve_depth,
        max_ridge: f.max_ridge, max_trench: f.max_trench,   // side_ridge/side_trench metrics
        // cross_section rows have no edge/deck at the worst point — f.z IS the terrain surface Z
        // there (cross_section_scan has no separate "edge Z" concept), so label it surface_z, not
        // edge_z, or the tooltip would imply a deck sits at that height.
        ...(f.source === 'cross_section' ? { surface_z: f.z } : { edge_z: f.z }),
      },
    };
    if (Number.isFinite(f.lat) && Number.isFinite(f.lng) && Number.isFinite(f.z)) {
      const [x, y] = geoToLocal(f.lat, f.lng);
      // Ground the pin on the terrain SURFACE (surface_z from measure_edge_terrain) so it sits ON
      // the ground — not 24 m underground (tunnel) or up in the air (rollercoaster). Older faults
      // files without surface_z fall back to the edge z.
      const pinZ = Number.isFinite(f.surface_z) ? f.surface_z : f.z;
      marker.position = [x, y, pinZ];
    }
    return marker;
  });
}

// Returns { mound, side_ridge, side_trench } counts tallied directly from the raw
// terrain_faults.json faults array — the SAME data terrainFaultMarkers just colored
// and pinned, so the legend can never claim '—' for an axis that already rendered.
// mound is a centerline verdict ALSO fed by diagnostics/causal_diagnoses.json on
// sites that have one (main.js's loadReliefFaults/causalReliefAxisCounts overwrites
// this count when that artifact loads); side_ridge/side_trench have no other source
// — cross_section rows only ever appear in terrain_faults.json.
export function terrainFaultAxisCounts(faults) {
  const counts = { mound: 0, side_ridge: 0, side_trench: 0 };
  for (const f of faults || []) {
    if (f && Object.prototype.hasOwnProperty.call(counts, f.verdict)) counts[f.verdict] += 1;
  }
  return counts;
}

// ── Diagnostic-axis registry (SSOT) ────────────────────────────────
// THE single authority for every diagnostic axis the viewer can surface. Each
// axis is ONE row: a UNIQUE color, the toggle GROUP it rides, the artifact it
// reads, and the human-readable rule that fires it. The viewer sources its fault
// colors from this table (main.js) and renders the on-screen legend from it — so
// a color can never mean two things and no signal is a surprise.
//
// >>> NEW DIAGNOSTIC SIGNAL → ADD ONE ROW HERE with a fresh color. Do NOT mint a
//     parallel color const, a new toggle, or a side data file on a branch. The
//     registryColorsUnique() invariant (tested) makes a color collision a FAILING
//     BUILD, not a render surprise. This is what stops the same fault being built
//     twice under two names (the relief/terrain-fault split this table merges).
//
// group:
//   'z-fault'  — derived from the authored edges.json centerline + z_lineage
//   'topology' — derived from edges.json graph structure (not a Z value)
//   'relief'   — measured on the RENDERED terrain.glb vs the road decks (offline
//                producer scripts/mesh_gen/relief_diagnostics.py →
//                data/<site>/diagnostics/relief_faults.json)
export const DIAGNOSTIC_AXES = {
  cliff:     { label: 'Cliff',        color: 0xff2222, group: 'z-fault',  source: 'edges.json node z_lineage',
               firesWhen: 'walking/cycling node-Z cliff steeper than mode cap × slack, unjustified by a stairs edge or terminus' },
  submerged: { label: 'Submerged',    color: 0xff22ff, group: 'z-fault',  source: 'edges.json driving polyline',
               firesWhen: 'a driving edge dips ≥2 m below the lake surface, within the lake basin' },
  belowLake: { label: 'Below lake',   color: 0x2255ff, group: 'z-fault',  source: 'edges.json deck verts + intersections.json node z',
               firesWhen: 'any deck vertex (all modes) or node whose Z is below lake full-pool, in or near the lake footprint — the exhaustive complement to the driving-only submerged axis' },
  steep:     { label: 'Steep',        color: 0xffdd00, group: 'z-fault',  source: 'edges.json walking/cycling polyline',
               firesWhen: 'a walking/cycling edge whose average grade exceeds its mode cap' },
  overlap:   { label: 'Overlap',      color: 0x22ddff, group: 'topology', source: 'edges.json cross-mode geometry',
               firesWhen: 'the same physical surface carried as two coincident, co-aligned cross-mode edges' },
  // Evidence fault: the graph contradicts hard OSM engineering evidence. Rose so it
  // never reads as red (cliff) or magenta (submerged). Mirrors the build gate
  // tests/t2/test_node_z_evidence_gates.py Gate A — viewer and CI mark the same ways.
  stairsFlat: { label: 'Stairs flat', color: 0xff66aa, group: 'z-fault', source: 'edges.json member polylines + elevation_profiles/stairs_step_counts.json',
               firesWhen: 'a step-counted OSM stairs way whose member edges sum under half the minimum rise its step_count implies — a leveled staircase (node-consensus leveling class)' },
  // Surface-relief axis — terrain.glb vs road decks. Consolidates the work two
  // branches built in parallel: NAMES + DATA are the relief producer's
  // (eat/gap/spike); COLORS are the non-colliding terrain-fault palette
  // (orange/green/purple) so they never clash with the Z-fault axes above.
  eat:       { label: 'Eat (buried)', color: 0xcc6622, group: 'relief',   source: 'diagnostics/relief_faults.json',
               firesWhen: 'the rendered terrain pokes ABOVE the road deck — the road is buried' },
  gap:       { label: 'Gap (float)',  color: 0x33dd55, group: 'relief',   source: 'diagnostics/relief_faults.json',
               firesWhen: 'the road deck floats far ABOVE the terrain just beyond its cut (>12 m)' },
  spike:     { label: 'Spike',        color: 0x8844ff, group: 'relief',   source: 'diagnostics/relief_faults.json',
               firesWhen: 'a long, thin terrain sliver radiates near a road (a render artifact)' },
  carve:     { label: 'Carve',        color: 0x9c6644, group: 'relief',   source: 'diagnostics/causal_diagnoses.json',
               firesWhen: 'the generated terrain is gouged below its source surface to meet an authored deck' },
  mound:     { label: 'Mound',        color: 0x6f8f3d, group: 'relief',
               source: 'diagnostics/causal_diagnoses.json or t2/edges/terrain_faults.json (centerline rows)',
               firesWhen: 'the generated terrain is raised above its source surface to meet an authored deck' },
  // Elevated-deck burial — the axis the eat loop is BLIND to. eat excludes bridge/
  // boardwalk decks (they float on stilts, so relief must not cut for them); this
  // fires when such a deck's authored Z sits BELOW the terrain it spans — buried in a
  // hillside, invisible to eat/gap/spike + edge_audit. Own teal so it never reads as eat.
  elevated_buried: { label: 'Elevated buried', color: 0x00c2b8, group: 'relief', source: 'diagnostics/relief_faults.json',
               firesWhen: 'an elevated deck (bridge/boardwalk, not tunnel; over-water sub-pool excluded) whose authored Z sits below the terrain it spans — buried, though relief cannot cut for it (it is meant to float)' },
  // Causal cut/fill effects. These are operation-lineage signals, not aliases for
  // the raw eat/gap/spike measurements above, so each is an explicit registry row.
  cutWide:   { label: 'Cut too wide', color: 0xff8c42, group: 'relief', source: 'diagnostics/causal_diagnoses.json',
               firesWhen: 'a generated relief footprint exceeds its owning corridor envelope' },
  cutSteep:  { label: 'Cut too steep', color: 0xf4c95d, group: 'relief', source: 'diagnostics/causal_diagnoses.json',
               firesWhen: 'a generated shoulder-to-toe batter exceeds its configured cross-slope envelope' },
  adjacentCut: { label: 'Adjacent cuts', color: 0x4dabf7, group: 'relief', source: 'diagnostics/causal_diagnoses.json',
               firesWhen: 'two non-junction relief footprints overlap and compete for final-terrain ownership' },
  tallSupport: { label: 'Tall supports', color: 0xc77dff, group: 'relief', source: 'diagnostics/causal_diagnoses.json',
                firesWhen: 'three consecutive support candidates are each >3 m tall, or one isolated support is >12 m tall; this is a review trigger, not a structural limit' },
  // Beside-ribbon earthwork the centerline terrain-fault axis (rollercoaster/tunnel/carve/mound,
  // above in TERRAIN_FAULT_COLOR) is blind to: cross_section_scan samples the terrain a few
  // metres OFF the ribbon, not on it, so it catches a fabricated wall/notch the centerline
  // raycast walks right past.
  side_ridge:  { label: 'Side ridge',  color: 0xe6556b, group: 'relief', source: 't2/edges/terrain_faults.json (cross_section rows)',
               firesWhen: 'terrain within ~9 m of a corridor ribbon stands proud of the linear trend of its own surroundings (≥15 m out) — a wall/spike beside the path' },
  side_trench: { label: 'Side trench', color: 0xc955e6, group: 'relief', source: 't2/edges/terrain_faults.json (cross_section rows)',
               firesWhen: 'terrain within ~9 m of a corridor ribbon falls below the linear trend of its own surroundings (≥15 m out) — a carved notch beside the path' },
};

// DIAGNOSTIC_AXES is the SSOT for these three colors; TERRAIN_FAULT_COLOR reads them
// back (not a repeated hex literal) so the two can never drift apart.
TERRAIN_FAULT_COLOR.mound = DIAGNOSTIC_AXES.mound.color;
TERRAIN_FAULT_COLOR.side_ridge = DIAGNOSTIC_AXES.side_ridge.color;
TERRAIN_FAULT_COLOR.side_trench = DIAGNOSTIC_AXES.side_trench.color;

// Legend group order (declaration order is preserved within each group).
export const DIAGNOSTIC_GROUPS = ['z-fault', 'topology', 'relief'];

// True iff every axis color is distinct — the load-bearing invariant: one color =
// one meaning. Tested in tests/viewer/test_diagnostic_registry.mjs; also usable as
// a runtime guard before rendering the legend.
export function registryColorsUnique(axes = DIAGNOSTIC_AXES) {
  const seen = new Set();
  for (const a of Object.values(axes)) {
    if (seen.has(a.color)) return false;
    seen.add(a.color);
  }
  return true;
}

// Axes bucketed by group for the legend: { group: [{ key, ...axis }, …] }.
export function axesByGroup(axes = DIAGNOSTIC_AXES) {
  const out = {};
  for (const g of DIAGNOSTIC_GROUPS) out[g] = [];
  for (const [key, a] of Object.entries(axes)) {
    (out[a.group] ||= []).push({ key, ...a });
  }
  return out;
}

// Pure legend model the viewer renders to DOM (DOM/THREE-free, so it is unit
// testable). One entry per non-empty group; each row carries the swatch hex, the
// live count (or null → the view shows '—' for an axis whose data isn't loaded on
// this site), and the firing rule for the hover tooltip.
//   counts: { <axisKey>: number }  — omit a key to mark it "not loaded" (null).
export function legendModel(counts = {}, axes = DIAGNOSTIC_AXES) {
  const grouped = axesByGroup(axes);
  const model = [];
  for (const group of DIAGNOSTIC_GROUPS) {
    const rows = (grouped[group] || []).map((a) => ({
      key: a.key,
      label: a.label,
      color: a.color,
      hex: `#${a.color.toString(16).padStart(6, '0')}`,
      count: a.key in counts ? counts[a.key] : null,
      firesWhen: a.firesWhen,
    }));
    if (rows.length) model.push({ group, rows });
  }
  return model;
}
