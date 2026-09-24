// Node inspector card builder (sml-node-inspector-card).
//
// Baked node balls (nodes.glb) carry `dt_edge_id = <their own twin id>` from
// the generic twin-registration stamp, so clicking one used to fall into the
// network-EDGE branch and render a bogus "twin_type: edge / T2_facility" card
// (the N16 eye-test report; J_* balls always did this). A node id resolves in
// the node registries the viewer already loads — the T2 intersections registry
// (role / z / z_source / z_lineage / provenance) and the frames node_metadata
// (name / archetype) — so the card can say what the node IS and where its Z
// came from. PURE + injectable, node-testable (computeCliffNodes contract
// style): no DOM, no THREE, no fetch.

// intersectionsById: Map<twin_id, record> over t2/edges/intersections.json.
// nodeMetadata: frames node_metadata object ({ id: { name, archetype, … } }).
// Returns an inspector-panel-shaped element, or null when the id is not a
// known node (edge ids fall through to the edge path unchanged).
export function buildNodeElement(id, intersectionsById, nodeMetadata) {
  const sim = nodeMetadata ? (nodeMetadata[id] || null) : null;
  let t2 = intersectionsById ? (intersectionsById.get(id) || null) : null;
  // Trace-back through the label (sml-twin-projection-threading): a sim node
  // with no registry row of its own borrows identity via twin_id (N35 →
  // SML-POI-15) — dereference it so the card carries the authored z + lineage
  // instead of rendering lineage-less. Rows projected from the ROOT
  // physical_twins.json are namespaced pt:<id> by the synth (the parallel
  // pool_a/ scout file assigns the same ids to different twins; pa: keys are
  // that other registry, never a sim node's namespace).
  if (!t2 && sim && sim.twin_id && intersectionsById) {
    t2 = intersectionsById.get(String(sim.twin_id))
      || intersectionsById.get(`pt:${sim.twin_id}`) || null;
  }
  if (!t2 && !sim) return null;
  const role = (t2 && t2.role) || (sim && sim.archetype) || 'node';
  const zl = t2 && t2.z_lineage ? t2.z_lineage : null;
  const twinId = (sim && sim.twin_id) || (t2 && t2.twin_id) || null;
  return {
    id,
    stable_id: id,
    twin_type: 'node',
    semantic_type: `Node (${role})`,
    name: (sim && sim.name) || (t2 && t2.name) || null,
    mode: null,
    // Shown only when the twin id differs from the card id — a T2 row keyed by
    // its own twin_id would otherwise repeat the header.
    twin: twinId && String(twinId) !== String(id) ? String(twinId) : null,
    lineage: { authority: (t2 && t2.provenance) || 'sim_graph' },
    terrain_reference_patch_id: null,
    // Rendered by inspector-panel's data-lineage rows. z_display (not
    // z_context): on EDGE cards z_context is the lineage context TAG — reusing
    // the name for the z VALUE gave one field two meanings
    // (sml-diagnostic-click-cards; flagged by the #105 review).
    z_source: t2 ? t2.z_source : undefined,
    z_tool: zl ? zl.tool : undefined,
    z_display: (t2 && Number.isFinite(t2.z)) ? `${t2.z.toFixed(2)} m` : undefined,
    // Raw records for programmatic consumers (__dt probes, tests).
    node_role: role,
    node_lat: (t2 || sim).lat,
    node_lng: (t2 || sim).lng,
    node_z: t2 ? t2.z : null,
  };
}

// Reverse direction of the same thread: twin_id → sim node id, over frames
// node_metadata. Injective today (97 twin-labeled nodes, no duplicates); a
// future duplicate keeps the first hit — that's a parity-gate problem, not a
// card problem.
export function buildTwinToSimNodeIndex(nodeMetadata) {
  const m = new Map();
  for (const [nid, meta] of Object.entries(nodeMetadata || {})) {
    if (!meta || !meta.twin_id) continue;
    if (!m.has(String(meta.twin_id))) m.set(String(meta.twin_id), nid);
    // Root-registry T2 rows carry a pt:<id> key (synth namespace) — map it
    // too so the pt:-keyed sphere's card still names its sim node.
    const pt = `pt:${meta.twin_id}`;
    if (!m.has(pt)) m.set(pt, nid);
  }
  return m;
}
