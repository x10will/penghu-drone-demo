// Inspector for the SML base stage.
//
// Targets the same DOM as index.html's inspector-panel.js but
// understands surface/node userData shapes. We don't import the typed
// inspector because it expects a twin-element schema that base-stage
// objects don't carry.
//
// Public API:
//   showSurfaceInspector(userData)
//   showNodeInspector(userData)
//   hideInspector()
//   attachInspectorClose()
//
// Behavior contract is enforced by:
//   tests/test_base_viewer_tdd_sweep.spec.js A1/A2/A3

function el(id) { return document.getElementById(id); }

function kv(key, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="kv"><span class="kv-key">${key}</span><span class="kv-val">${value}</span></div>`;
}

export function showSurfaceInspector(ud) {
  const panel = el('inspector');
  if (!panel) return;
  el('inspector-type').textContent = `${ud.mode} edge`;
  el('inspector-id').textContent = ud.edge_id;
  el('inspector-body').innerHTML = [
    kv('from_node', ud.from_node),
    kv('to_node', ud.to_node),
    kv('mode', ud.mode),
    kv('bridge', ud.bridge ? 'yes' : ''),
    kv('z_source', ud.z_source),
    kv('topology_rule_id', ud.lineage?.topology_rule_id),
    kv('validated_by', ud.lineage?.validated_by ?? 'unvalidated'),
    kv('inputs_consulted', (ud.lineage?.inputs_consulted || []).length + ' source(s)'),
    kv('authority_tier', ud.authority_tier),
    kv('pipeline', ud.pipeline?.name),
    kv('script', ud.pipeline?.script),
  ].filter(Boolean).join('');
  panel.classList.remove('hidden');
}

export function showNodeInspector(ud) {
  const panel = el('inspector');
  if (!panel) return;
  if (ud.kind === 't2-sim-node') {
    // T2 sim nodes (intersections/termini/waypoints/entrances) have role + z +
    // z_lineage, NOT the T1 type/name/name_en that the base header used. They
    // also carry is_cliff + cliff_grade_pct when the diagnostic flagged them.
    const lineageTool = ud.z_lineage?.tool;
    el('inspector-type').textContent = `T2 sim node · ${ud.role ?? 'unknown'}`;
    el('inspector-id').textContent = ud.twin_id ?? ud.id ?? '?';
    el('inspector-body').innerHTML = [
      kv('role', ud.role),
      kv('z', ud.z?.toFixed?.(2) != null ? `${ud.z.toFixed(2)} m` : null),
      kv('z_source', ud.z_source),
      kv('z_lineage.tool', lineageTool),
      kv('z_lineage.confidence', ud.z_lineage?.confidence),
      kv('serves_t1_id', ud.serves_t1_id),
      kv('trust_tier', ud.trust_tier),
      kv('lat', ud.lat?.toFixed?.(6)),
      kv('lng', ud.lng?.toFixed?.(6)),
      kv('is_cliff', ud.is_cliff ? 'yes' : ''),
      kv('cliff_grade_pct', ud.cliff_grade_pct != null ? `${ud.cliff_grade_pct}%` : null),
      kv('consensus_warning', ud.consensus_warning),
      kv('authority_tier', ud.authority_tier),
      kv('pipeline', ud.pipeline?.name),
      kv('script', ud.pipeline?.script),
    ].filter(Boolean).join('');
    panel.classList.remove('hidden');
    return;
  }
  el('inspector-type').textContent = `base node · ${ud.type ?? 'unknown'}`;
  el('inspector-id').textContent = ud.id ?? ud.twin_id ?? '?';
  el('inspector-body').innerHTML = [
    kv('name', ud.name),
    kv('name_en', ud.name_en),
    kv('type', ud.type),
    kv('trust_tier', ud.trust_tier),
    kv('lat', ud.lat?.toFixed?.(6)),
    kv('lng', ud.lng?.toFixed?.(6)),
    kv('pipeline', ud.pipeline?.name),
    kv('script', ud.pipeline?.script),
  ].filter(Boolean).join('');
  panel.classList.remove('hidden');
}

export function hideInspector() {
  const panel = el('inspector');
  if (panel) panel.classList.add('hidden');
}

export function attachInspectorClose() {
  const closeBtn = el('inspector-close');
  if (closeBtn) closeBtn.addEventListener('click', hideInspector);
}
