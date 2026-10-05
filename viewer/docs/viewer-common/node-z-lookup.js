// Authored node-Z lookup for sim-node markers (sml-node-z-evidence-gates).
//
// The frame-driven sim nodes (J_* junctions and friends) carry no baked Z:
// `createNodeMarkers` used to fall straight to terrain+5 for them, displaying
// an arbitrary render offset for exactly the nodes whose Z the pipeline
// computed (intersections.json, node-Z dispatcher lineage). This helper gives
// the marker path the AUTHORED value: nearest `role === 'intersection'`
// record within a small XY radius.
//
// Pure + injectable (geoToLocal passed in) so node tests run without a
// browser — same contract style as computeCliffNodes/overlapEdges.

// Build once per intersections load; returns (x, y, maxDistM) => z | null.
export function buildNodeZLookup(intersections, geoToLocal) {
  const pts = [];
  for (const r of intersections || []) {
    if (!r || r.role !== 'intersection') continue;  // pa:* POI rows are building Zs, not path level
    if (!Number.isFinite(r.z) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const [x, y] = geoToLocal(r.lat, r.lng);
    pts.push({ x, y, z: r.z });
  }
  return function nearestNodeZ(x, y, maxDistM) {
    let best = null;
    let bestD2 = maxDistM * maxDistM;
    for (const p of pts) {
      const dx = p.x - x, dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) { bestD2 = d2; best = p; }
    }
    return best ? best.z : null;
  };
}
