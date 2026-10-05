// Edge-track resolution (viewer-story-cinema). PURE functions — NO Three.js,
// DOM, or fetch (viewer-engine-policy: shared logic lives under
// viewer-common/). Resolves schema-2 `position_edge {edge_id, offset_m,
// direction, next_edge}` from baked frames into local-XY world positions,
// using the frames' OWN edge_metadata polylines (self-contained id space —
// deliberately NOT the mesh polyline_3d table, whose E-<hash> ids don't map
// to sim ids and which carries no ferry edges; see viewer-story-cinema
// design). Z is a separate runtime policy (terrain sample / lake plane) —
// this module is 2D + heading, per canonical-frame-schema render-agnosticism.
//
// Reduced-scope delivery of three-agent-player tasks 1.1 (edge lookup with
// cumulative arc-length) and 2.4 (along-edge interpolation with next_edge);
// re-verify against mesh geometry when the sim↔mesh id mapping lands.

/** Build edgeId → {points [[x,y]…], cum [0,…], length, mode} from frame edge_metadata. */
export function buildEdgeTrackIndex(edgeMetadata, geoToLocal) {
  const index = new Map();
  for (const [eid, meta] of Object.entries(edgeMetadata || {})) {
    const poly = meta.polyline;
    if (!Array.isArray(poly) || poly.length === 0) continue;
    const points = poly.map(([lat, lng]) => {
      const [x, y] = geoToLocal(lat, lng);
      return [x, y];
    });
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i][0] - points[i - 1][0];
      const dy = points[i][1] - points[i - 1][1];
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    index.set(eid, { points, cum, length: cum[cum.length - 1], mode: meta.mode || 'trail' });
  }
  return index;
}

/**
 * Position + travel heading at an edge-relative offset. `direction: 'reverse'`
 * measures offset_m from the `to` end (the traversal's entry point, matching
 * engines/movement.py). Offsets clamp to the edge; unknown edges → null
 * (never fabricate a position).
 */
export function resolveEdgePosition(index, posEdge) {
  if (!posEdge || !index) return null;
  const track = index.get(posEdge.edge_id);
  if (!track) return null;
  const { points, cum, length } = track;
  if (points.length === 1) {
    return { x: points[0][0], y: points[0][1], headingRad: 0 };
  }
  const reverse = posEdge.direction === 'reverse';
  const off = Math.max(0, Math.min(length, Number(posEdge.offset_m) || 0));
  const s = reverse ? length - off : off;   // arc-length from the polyline start

  // binary search the segment containing s
  let lo = 0, hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const t = segLen > 0 ? (s - cum[lo]) / segLen : 0;
  const [ax, ay] = points[lo];
  const [bx, by] = points[lo + 1];
  const x = ax + t * (bx - ax);
  const y = ay + t * (by - ay);
  let headingRad = Math.atan2(by - ay, bx - ax);
  if (reverse) headingRad = Math.atan2(ay - by, ax - bx);   // travel direction
  return { x, y, headingRad };
}

/** Remaining travel distance on an edge past posEdge, in its travel direction. */
function remainingOn(index, posEdge) {
  const track = index.get(posEdge.edge_id);
  if (!track) return null;
  const off = Math.max(0, Math.min(track.length, Number(posEdge.offset_m) || 0));
  return track.length - off;
}

/**
 * Position between two frame samples at alpha ∈ [0,1].
 * - same edge (same direction): offset lerp along the polyline;
 * - posA.next_edge === posB.edge_id: carry the overflow onto the next edge
 *   (no corner cutting);
 * - unrelated edges: straight XY lerp between the two resolved points;
 * - anything unresolvable: null.
 */
export function interpolatePosition(index, posA, posB, alpha) {
  const a = resolveEdgePosition(index, posA);
  const b = resolveEdgePosition(index, posB);
  if (!a || !b) return null;
  const t = Math.max(0, Math.min(1, alpha));

  if (posA.edge_id === posB.edge_id && posA.direction === posB.direction) {
    const off = (Number(posA.offset_m) || 0)
      + t * ((Number(posB.offset_m) || 0) - (Number(posA.offset_m) || 0));
    return resolveEdgePosition(index, { ...posA, offset_m: off });
  }

  if (posA.next_edge && posA.next_edge === posB.edge_id) {
    const remA = remainingOn(index, posA);
    const offB = Math.max(0, Number(posB.offset_m) || 0);
    if (remA !== null) {
      const travel = t * (remA + offB);
      if (travel <= remA) {
        return resolveEdgePosition(index, { ...posA, offset_m: (Number(posA.offset_m) || 0) + travel });
      }
      return resolveEdgePosition(index, { ...posB, offset_m: travel - remA });
    }
  }

  // Unrelated edges (teleport-ish sample gap): straight blend, heading from B.
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), headingRad: b.headingRad };
}

/**
 * Nearest-deck-vertex Z sampler from the mesh-space edges table (edges.json
 * `polyline_3d` — the Z-pipeline's authored deck truth). This deliberately
 * does NOT map sim edge ids to mesh ids (still open, three-agent-player D2):
 * a surface actor gliding along a road only needs "the deck Z at this XY",
 * and the nearest deck vertex within `radiusM` answers that without the id
 * rabbit hole. Returns a sampler (x,y) → deck Z, or NaN when no deck vertex
 * is within reach (caller falls back to its terrain policy); returns null
 * when the edges table has no usable verts (fail-soft, never fabricate).
 *
 * BOUNDS (deliberate, #62 review finding 1): nearest-VERTEX, not
 * nearest-point-on-segment — on a graded road the returned Z stair-steps at
 * vertex bisectors (~0.5-0.75 m per hop at the data's ~14.5 m median vertex
 * spacing), and where two decks stack within radiusM (overpass, tight
 * switchback) the nearer VERTEX wins with no edge-identity tiebreak. Both
 * are non-issues on the flat over-water hero corridor the bike actually
 * rides today. If surface actors ever ride sloped or stacked roads, upgrade
 * to nearest-segment interpolation (still needs no id mapping) or wait for
 * the D2/D5 sim↔mesh identity.
 */
export function buildDeckZSampler(edges, geoToLocal, radiusM = 12) {
  const cell = radiusM;                 // bucket pitch = search radius
  const buckets = new Map();            // "bx,by" → flat [x, y, z, …]
  let count = 0;
  for (const e of edges || []) {
    for (const p of e.polyline_3d || []) {
      if (!p || p.length < 3 || !Number.isFinite(p[2])) continue;
      const [x, y] = geoToLocal(p[0], p[1]);
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(x, y, p[2]);
      count++;
    }
  }
  if (!count) return null;
  const r2 = radiusM * radiusM;
  return function deckZAt(x, y) {
    const bx = Math.floor(x / cell), by = Math.floor(y / cell);
    let best = NaN, bestD2 = r2;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const b = buckets.get(`${bx + i},${by + j}`);
        if (!b) continue;
        for (let k = 0; k < b.length; k += 3) {
          const dx = b[k] - x, dy = b[k + 1] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) { bestD2 = d2; best = b[k + 2]; }
        }
      }
    }
    return best;
  };
}
