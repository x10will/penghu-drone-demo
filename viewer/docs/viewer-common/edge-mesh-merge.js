// sml-edge-mesh-merge: collapse edges.glb's ~10.4k per-edge sub-meshes into a
// few THREE.BatchedMesh draw calls (one per render-class/material) while keeping
// every edge individually addressable by dt_edge_id — picking, flow-color
// recolor, goto-framing, and diagnostic highlight all keep working.
//
// Viewer-side only: consumes the loaded edges.glb scene (the `<edge_id>__<role>`
// hierarchy + userData is the source of per-edge identity). edges.glb and
// build_base_network_mesh.py are unchanged. See openspec/changes/sml-edge-mesh-merge.

// Material signature → groups meshes whose geometry has the same attribute set
// AND visual params, so each BatchedMesh has one shared material + consistent
// attributes (BatchedMesh requires both).
function matSig(m) {
  if (!m) return 'none';
  return [
    m.type,
    m.vertexColors ? 'vc' : 'novc',
    m.transparent ? 't' : 'o',
    m.opacity,
    m.side,
    m.color ? m.color.getHexString() : 'nocol',
  ].join('|');
}

// Geometry signature → index-presence + attribute key set, so a BatchedMesh
// batch is attribute-uniform (addGeometry throws on a mismatch).
function geomSig(g) {
  return (g.index ? 'i' : 'n') + ':' + Object.keys(g.attributes).sort().join(',');
}

function edgeIdOf(mesh) {
  const name = mesh.name || '';
  const sep = name.indexOf('__');
  if (sep >= 0) return name.slice(0, sep);
  return mesh.userData && mesh.userData.dt_edge_id ? mesh.userData.dt_edge_id : name;
}

/**
 * @param {object} THREE  the three module (so this stays import-free / testable)
 * @param {THREE.Object3D} gltfScene  the loaded edges.glb scene root
 * @returns {{group, edgeInstances, edgeUserData, reverse, drawCallCount,
 *            setEdgeColor, resetEdgeColor, resolveHit, isBatched}}
 */
export function mergeEdgesIntoBatches(THREE, gltfScene) {
  gltfScene.updateMatrixWorld(true);

  const leaves = [];
  gltfScene.traverse((o) => { if (o.isMesh && o.geometry) leaves.push(o); });

  // 1. group leaf meshes by material signature + geometry signature, so each
  //    BatchedMesh has one shared material AND an attribute-uniform/index-uniform
  //    geometry set (BatchedMesh.addGeometry throws otherwise).
  const groups = new Map(); // sig -> { material, items: [{mesh, edgeId}] }
  for (const mesh of leaves) {
    const sig = matSig(mesh.material) + '#' + geomSig(mesh.geometry);
    if (!groups.has(sig)) groups.set(sig, { material: mesh.material, items: [] });
    groups.get(sig).items.push({ mesh, edgeId: edgeIdOf(mesh) });
  }

  // 2. build one BatchedMesh per group, baking each sub-mesh's world transform
  const group = new THREE.Group();
  group.name = 'edges-batched';
  const edgeInstances = new Map(); // edgeId -> [{ bm, instanceId }]
  const reverse = new Map();       // bm -> Map(instanceId -> edgeId)
  // Each mesh's COLOR_0 is flat (verified), so its color collapses to one value.
  // Render with vertexColors OFF + a white base material and carry that flat color
  // as the per-instance color — so the instance color IS the final rendered color
  // (no multiply). Diagnostic/flow recolor then renders SOLID (matching the legacy
  // `vertexColors=false; color.setHex()` recolor), and getEdgeColor reads back the
  // true rendered color.
  function baseColorOf(mesh) {
    const col = mesh.geometry.attributes.color;
    if (col) return new THREE.Color(col.getX(0), col.getY(0), col.getZ(0));
    return mesh.material && mesh.material.color ? mesh.material.color.clone() : new THREE.Color(0x888888);
  }

  for (const { material, items } of groups.values()) {
    let vTotal = 0, iTotal = 0;
    for (const { mesh } of items) {
      const g = mesh.geometry;
      const vc = g.attributes.position.count;
      vTotal += vc;
      iTotal += g.index ? g.index.count : vc;
    }
    const sharedMat = material ? material.clone() : new THREE.MeshLambertMaterial();
    sharedMat.vertexColors = false;                  // instance color = final color
    // Edge instance colors are DATA (flat per-edge colors + diagnostic tints —
    // "the recolored edges carry the global signal"): bypass scene tone mapping
    // so registry hexes keep their hue on tone-mapped (apple-graded) sites.
    // Inert on the classic grade (no tone mapping enabled).
    sharedMat.toneMapped = false;
    if (sharedMat.color) sharedMat.color.setHex(0xffffff);
    // Depth bias so edges win the depth test against terrain they now sit ON: after the
    // terrain fit, roads are co-planar with the surface (a validation win) and z-fight.
    // polygonOffset is scale-independent (NDC depth), so it deconflicts at any camera
    // distance WITHOUT floating the road off-grade — "tapered to terrain", flush. Harmless
    // for the already-elevated boardwalk/rail batches (they render in front regardless).
    sharedMat.polygonOffset = true;
    sharedMat.polygonOffsetFactor = -4;
    sharedMat.polygonOffsetUnits = -4;
    const bm = new THREE.BatchedMesh(items.length, vTotal, iTotal, sharedMat);
    bm.name = 'edges-batched/' + matSig(material);
    const rev = new Map();
    for (const { mesh, edgeId } of items) {
      const gid = bm.addGeometry(mesh.geometry);     // group is attribute+index uniform (geomSig)
      const iid = bm.addInstance(gid);
      mesh.updateWorldMatrix(true, false);
      bm.setMatrixAt(iid, mesh.matrixWorld);
      const base = baseColorOf(mesh);
      bm.setColorAt(iid, base);                      // default = the mesh's own flat color
      if (!edgeInstances.has(edgeId)) edgeInstances.set(edgeId, []);
      edgeInstances.get(edgeId).push({ bm, instanceId: iid, base: base.getHex() });
      rev.set(iid, edgeId);
    }
    reverse.set(bm, rev);
    group.add(bm);
  }

  // 3. per-edge userData store (the inspector's source of truth under merge,
  //    replacing the per-Object3D userData the pick handler used to read).
  //    Seed from the first sub-mesh of each edge; diagnostics Object.assign onto it.
  const edgeUserData = new Map();
  for (const mesh of leaves) {
    const edgeId = edgeIdOf(mesh);
    if (!edgeUserData.has(edgeId)) {
      edgeUserData.set(edgeId, { ...mesh.userData, dt_edge_id: edgeId, name: edgeId });
    }
  }

  // 4. helpers
  const _c = new THREE.Color();
  function setEdgeColor(edgeId, hex) {
    const inst = edgeInstances.get(edgeId);
    if (!inst) return;
    _c.setHex(hex);
    for (const { bm, instanceId } of inst) bm.setColorAt(instanceId, _c);
  }
  // Restore an edge to its own (flat) base color — NOT white (the batch material
  // is white, so the base color lives in the instance color).
  function resetEdgeColor(edgeId) {
    const inst = edgeInstances.get(edgeId);
    if (!inst) return;
    for (const { bm, instanceId, base } of inst) { _c.setHex(base); bm.setColorAt(instanceId, _c); }
  }
  // Read an edge's current rendered color as an sRGB hex int (first instance);
  // since the batch material is white + vertexColors off, this IS the rendered color.
  function getEdgeColor(edgeId) {
    const inst = edgeInstances.get(edgeId);
    if (!inst || !inst.length) return null;
    inst[0].bm.getColorAt(inst[0].instanceId, _c);
    return _c.getHex();
  }
  // Per-edge render visibility (overlay supersession hides covered edges).
  function setEdgeVisible(edgeId, visible) {
    const inst = edgeInstances.get(edgeId);
    if (!inst) return;
    for (const { bm, instanceId } of inst) bm.setVisibleAt(instanceId, !!visible);
  }
  function getEdgeVisible(edgeId) {
    const inst = edgeInstances.get(edgeId);
    if (!inst || !inst.length) return null;
    return inst[0].bm.getVisibleAt(inst[0].instanceId);
  }

  // intersection.object is the BatchedMesh, intersection.batchId the instanceId.
  function resolveHit(intersection) {
    if (!intersection) return null;
    const rev = reverse.get(intersection.object);
    if (!rev) return null;
    const edgeId = rev.get(intersection.batchId);
    if (edgeId == null) return null;
    return { edgeId, userData: edgeUserData.get(edgeId) };
  }
  const isBatched = (obj) => reverse.has(obj);

  return {
    group,
    edgeInstances,
    edgeUserData,
    reverse,
    drawCallCount: group.children.length,
    setEdgeColor,
    resetEdgeColor,
    getEdgeColor,
    setEdgeVisible,
    getEdgeVisible,
    resolveHit,
    isBatched,
  };
}
