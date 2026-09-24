// Typed inspector panel for the Three viewer.
//
// DOM expectations (defined in index.html):
//   #inspector            container, has .hidden class when not showing
//   #inspector-close      X button
//   #inspector-type       semantic-type badge
//   #inspector-id         monospace ID, click to copy
//   #inspector-body       key-value rows
//
// See three-viewer-controls R3 spec for behavior contract.

let currentElementId = null;
let runtimeInspectionProvider = null;
let currentTypedInspection = null;

export function setRuntimeInspectionProvider(provider) {
  runtimeInspectionProvider = provider;
}

export function refreshRuntimeInspection() {
  if (currentTypedInspection && currentElementId === currentTypedInspection.element.id
      && !el('inspector').classList.contains('hidden')) {
    el('inspector-body').innerHTML = renderBody(currentTypedInspection.element, currentTypedInspection.geometryReport);
  }
}

function el(id) {
  return document.getElementById(id);
}

function kvRow(key, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="kv"><span class="kv-key">${escapeHtml(key)}</span><span class="kv-val">${escapeHtml(value)}</span></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function diagnosisValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function diagnosisRow(key, value) {
  const formatted = diagnosisValue(value);
  if (!formatted) return '';
  return `<div class="kv"><span class="kv-key">${escapeHtml(key)}</span>`
    + `<span class="kv-val">${escapeHtml(formatted)}</span></div>`;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metres(value) {
  const number = finiteNumber(value);
  return number === null ? null : `${number.toFixed(2)} m`;
}

function conclusion(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object') return value;
  const head = firstPresent(value.status, value.stage, value.result);
  const detail = firstPresent(value.signature, value.reason, value.summary);
  if (head && detail) return `${head}: ${detail}`;
  return firstPresent(head, detail, value);
}

function stageTraceRow(diagnosis, stage) {
  const trace = diagnosis?.stage_trace;
  if (!Array.isArray(trace)) return null;
  return trace.find((row) => row?.stage === stage) || null;
}

function contractResult(row, nameFragment) {
  const checks = Array.isArray(row?.contract_checks) ? row.contract_checks : [];
  return checks.find((check) => String(check?.name || '').includes(nameFragment))?.result
    ?? checks[0]?.result;
}

function clusterSpan(metrics) {
  const start = finiteNumber(metrics?.station_start_m);
  const end = finiteNumber(metrics?.station_end_m);
  if (start === null || end === null) return null;
  const spanValue = finiteNumber(metrics?.span_m);
  const span = spanValue === null ? '' : ` (${spanValue.toFixed(2)} m)`;
  return `${start.toFixed(2)}–${end.toFixed(2)} m${span}`;
}

function reviewThresholds(metrics) {
  const thresholds = metrics?.thresholds;
  if (!thresholds || typeof thresholds !== 'object') return null;
  const sustained = firstPresent(
    thresholds.sustained_height_m,
    thresholds.moderate_height_m,
  );
  const count = firstPresent(
    thresholds.sustained_min_count,
    thresholds.consecutive_candidate_count,
  );
  const isolated = firstPresent(
    thresholds.isolated_height_m,
    thresholds.extreme_height_m,
  );
  const sustainedValue = finiteNumber(sustained);
  const countValue = finiteNumber(count);
  const isolatedValue = finiteNumber(isolated);
  if (sustainedValue !== null && countValue !== null && isolatedValue !== null) {
    return `sustained >${sustainedValue} m × ${countValue} consecutive; `
      + `isolated >${isolatedValue} m`;
  }
  return thresholds;
}

function formatPoint(point) {
  if (!Array.isArray(point) || point.length < 3) return null;
  const values = point.slice(0, 3).map(finiteNumber);
  return values.some((value) => value === null)
    ? null
    : values.map((value) => value.toFixed(2)).join(', ');
}

function joined(values) {
  return Array.isArray(values) ? values.join(', ') : null;
}

export function renderCausalDiagnosisBody(diagnosis) {
  if (!diagnosis) return '';
  const effectPoint = diagnosis.effect?.point;
  const surfacePoint = diagnosis.marker?.surface_point;
  const metrics = diagnosis.effect?.metrics || {};
  const isTallSupport = diagnosis.axis === 'tallSupport'
    && diagnosis.effect?.type === 'tall_support';
  const s5 = isTallSupport ? stageTraceRow(diagnosis, 'S5') : null;
  const s6 = isTallSupport ? stageTraceRow(diagnosis, 'S6') : null;
  const s7 = isTallSupport ? stageTraceRow(diagnosis, 'S7') : null;
  const s5Values = s5?.values || {};
  const s6Values = s6?.values || {};
  const s7Values = s7?.values || {};
  const parts = [
    diagnosisRow('verdict', diagnosis.verdict),
    diagnosisRow('confidence', diagnosis.confidence),
    diagnosisRow('cause', diagnosis.cause?.type),
    diagnosisRow('cause.summary', diagnosis.cause?.summary),
    diagnosisRow('edge', diagnosis.operation?.edge_id),
    diagnosisRow('corridor', diagnosis.operation?.corridor_id),
    diagnosisRow('competing_edges', joined(diagnosis.competing_edge_ids)),
    diagnosisRow('evidence', joined(diagnosis.evidence_ids)),
    diagnosisRow('missing_evidence', joined(diagnosis.missing_evidence)),
    diagnosisRow('missing_stage_evidence', joined(diagnosis.missing_stage_evidence)),
    isTallSupport ? diagnosisRow('cluster_span', clusterSpan(metrics)) : null,
    isTallSupport ? diagnosisRow('support_count', metrics.support_count) : null,
    isTallSupport ? diagnosisRow('max_height', metres(metrics.max_height_m)) : null,
    isTallSupport ? diagnosisRow('review_thresholds', reviewThresholds(metrics)) : null,
    isTallSupport ? diagnosisRow('S5.status', s5?.status) : null,
    isTallSupport ? diagnosisRow('S5.deck_z', metres(s5Values.deck_z)) : null,
    isTallSupport ? diagnosisRow('S5.deck_authority', firstPresent(
      s5Values.deck_authority, s5Values.authority, s5Values.z_source,
    )) : null,
    isTallSupport ? diagnosisRow('S5.deck_evidence', firstPresent(
      s5Values.height_evidence, s5Values.deck_height_evidence, s5Values.deck_evidence,
    )) : null,
    isTallSupport ? diagnosisRow('S6.status', s6?.status) : null,
    isTallSupport ? diagnosisRow('S6.terrain_delta', metres(firstPresent(
      s6Values.final_foot_minus_prefit_terrain_m,
      s6Values.final_support_foot_minus_prefit_terrain_m,
      s6Values.terrain_delta_m,
    ))) : null,
    isTallSupport ? diagnosisRow('S6.terrain_result', firstPresent(
      s6Values.terrain_status, contractResult(s6, 'support'),
    )) : null,
    isTallSupport ? diagnosisRow('S7.status', s7?.status) : null,
    isTallSupport ? diagnosisRow('S7.endpoint_result', firstPresent(
      s7Values.endpoint_result, s7Values.endpoint_status, contractResult(s7, 'endpoint'),
    )) : null,
    diagnosisRow('root_cause', conclusion(diagnosis.root_cause)),
    isTallSupport ? diagnosisRow('physical_validity', conclusion(diagnosis.physical_validity)) : null,
    isTallSupport ? diagnosisRow('freshness', conclusion(diagnosis.freshness)) : null,
    diagnosisRow('effect_point', formatPoint(effectPoint)),
    diagnosisRow('surface_point', formatPoint(surfacePoint)),
    diagnosisRow('surface_offset', metres(diagnosis.marker?.vertical_offset_m)),
  ];
  const chainItems = Array.isArray(diagnosis.cause_effect_chain)
    ? diagnosis.cause_effect_chain : [];
  const chain = chainItems.map((item, index) => {
    const summary = diagnosisValue(item.summary);
    return `<div class="diagnosis-chain-step" data-stage="${escapeHtml(item.stage || '')}">`
      + `<span class="diagnosis-chain-index">${index + 1}</span>`
      + `<div><div class="diagnosis-chain-stage">${escapeHtml(item.stage || '')}</div>`
      + `<div class="diagnosis-chain-summary">${escapeHtml(summary)}</div></div></div>`;
  });
  if (chain.length) {
    parts.push('<div class="diagnosis-chain">' + chain.join('') + '</div>');
  }
  return parts.filter(Boolean).join('');
}

export function causalDiagnosisTitle(diagnosis) {
  if (diagnosis?.axis === 'tallSupport' && diagnosis?.effect?.type === 'tall_support') {
    return 'Support diagnosis · Tall supports';
  }
  return `Terrain diagnosis · ${diagnosis?.effect?.type || '?'}`;
}

export function showCausalDiagnosisInspector(diagnosis) {
  const panel = el('inspector');
  if (!panel || !diagnosis) return;
  el('inspector-type').textContent = causalDiagnosisTitle(diagnosis);
  el('inspector-id').textContent = diagnosis.diagnosis_id || '';
  el('inspector-id').classList.remove('copied');
  el('inspector-body').innerHTML = renderCausalDiagnosisBody(diagnosis);
  panel.classList.remove('hidden');
  currentElementId = `causal-diagnosis:${diagnosis.diagnosis_id || ''}`;
}

export function toggleCausalDiagnosisInspector(diagnosis) {
  const id = `causal-diagnosis:${diagnosis?.diagnosis_id || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showCausalDiagnosisInspector(diagnosis);
}

export function renderBody(element, geometryReport) {
  const parts = [
    kvRow('name', element.name),
    kvRow('twin_type', element.twin_type),
    kvRow('stable_id', element.stable_id),
    kvRow('twin', element.twin),
    kvRow('lineage', element.lineage?.authority),
    kvRow('terrain_patch', element.terrain_reference_patch_id),
    kvRow('mode', element.mode),
  ];
  // Source: viewer-site-config/spec.md:76-105. Context inspection is
  // explicit and lineage-visible, but it has no twin/topology/runtime fields.
  if (element.authority_scope === 'context-only') {
    parts.push(kvRow('authority', element.authority_scope));
    parts.push(kvRow('context_role', element.context_role));
    parts.push(kvRow('source_ref', element.source_ref));
    parts.push(kvRow('notice_ref', element.notice_ref));
    parts.push(kvRow('presentation_only', element.presentation_only));
    parts.push(kvRow('appearance_provenance_ref', element.appearance_provenance_ref));
    // The ref names a profile row the offline package does not ship, so the
    // package carries the decided values in its provenance catalog. Render
    // them when they are present; never substitute anything when they are not.
    const appearance = element.appearance_provenance;
    if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
      parts.push(kvRow('presentation_width_m', appearance.presentation_width_m));
      parts.push(kvRow('width_status', appearance.width_status));
      parts.push(kvRow('traced_over', appearance.traced_over));
      parts.push(kvRow('identification_method', appearance.identification_method));
      parts.push(kvRow('imagery_date', appearance.imagery_date));
      for (const question of appearance.open_questions ?? []) {
        parts.push(kvRow(`open_question: ${question?.topic}`, question?.state));
      }
    }
  } else if (element.origin_kind) {
    // Source: Farm source package
    // reference/sources/derived/farm-site-export/farm-site-source-package.v1.json:468-520.
    // Accepted authored props expose their source-owned origin_kind without
    // borrowing context authority or entering twin lookup.
    parts.push(kvRow('origin_kind', element.origin_kind));
  }
  if (element.surface) {
    parts.push(kvRow('surface.type', element.surface.type));
    parts.push(kvRow('surface.width', element.surface.width_m ? element.surface.width_m + ' m' : null));
  }
  // Data lineage (alishan edges + any edge enriched from edges.json) — so the popup says what
  // the edge is and where its deck Z came from, even when it has no name.
  parts.push(kvRow('osm_way', element.osm_way_id));
  parts.push(kvRow('z_source', element.z_source));
  parts.push(kvRow('z_tool', element.z_tool));
  parts.push(kvRow('z_context', element.z_context));
  // Node cards carry the resolved z VALUE (sml-diagnostic-click-cards renamed it
  // out of z_context, which on edge cards is the lineage context TAG — one field
  // name, one meaning).
  parts.push(kvRow('z', element.z_display));
  if (element.is_bridge) parts.push(kvRow('bridge', 'yes'));
  if (element.is_tunnel) parts.push(kvRow('tunnel', 'yes'));
  if (geometryReport && !geometryReport.missing) {
    if (geometryReport.length_m !== undefined) {
      parts.push(kvRow('length', geometryReport.length_m.toFixed(1) + ' m'));
    }
    if (geometryReport.area_m2 !== undefined) {
      parts.push(kvRow('area', geometryReport.area_m2.toFixed(1) + ' m²'));
    }
  }
  if (element.authority_scope !== 'context-only' && runtimeInspectionProvider) {
    for (const row of runtimeInspectionProvider(element.stable_id || element.id) || []) {
      parts.push(kvRow(row.label, Array.isArray(row.value) ? row.value.join(' · ') : row.value));
    }
  }
  return parts.filter(Boolean).join('');
}

export function showInspector(element, geometryReport) {
  const panel = el('inspector');
  if (!panel || !element) return;
  currentTypedInspection = { element, geometryReport };
  el('inspector-type').textContent = element.semantic_type || element.twin_type
    || element.origin_kind || 'typed';
  el('inspector-id').textContent = element.id;
  el('inspector-id').classList.remove('copied');
  el('inspector-body').innerHTML = renderBody(element, geometryReport);
  panel.classList.remove('hidden');
  currentElementId = element.id;
}

export function hideInspector() {
  const panel = el('inspector');
  if (panel) panel.classList.add('hidden');
  currentElementId = null;
  currentTypedInspection = null;
}

export function toggleInspector(element, geometryReport) {
  if (currentElementId === element.id && !el('inspector').classList.contains('hidden')) {
    hideInspector();
  } else {
    showInspector(element, geometryReport);
  }
}

export function currentInspectorElementId() {
  return currentElementId;
}

export function isSupportStructureUserData(userData) {
  return userData?.dt_mesh_role === 'support_structure'
    && !!userData?.dt_structure_id;
}

export function renderSupportStructureBody(userData) {
  if (!isSupportStructureUserData(userData)) return '';
  const tuples = Array.isArray(userData.dt_covered_tuple_ids)
    ? userData.dt_covered_tuple_ids.join(', ') : null;
  return [
    diagnosisRow('support_type', userData.dt_support_type),
    diagnosisRow('component', userData.dt_component_role),
    diagnosisRow('convention', userData.dt_convention_id),
    diagnosisRow('water_class', userData.dt_water_class),
    diagnosisRow('covered_tuples', tuples),
    diagnosisRow('source_hashes', userData.dt_source_hashes),
  ].filter(Boolean).join('');
}

export function showSupportStructureInspector(userData) {
  const panel = el('inspector');
  if (!panel || !isSupportStructureUserData(userData)) return;
  el('inspector-type').textContent = `Support · ${userData.dt_support_type || '?'}`;
  el('inspector-id').textContent = userData.dt_structure_id;
  el('inspector-id').classList.remove('copied');
  el('inspector-body').innerHTML = renderSupportStructureBody(userData);
  panel.classList.remove('hidden');
  currentElementId = `support-structure:${userData.dt_structure_id}:${userData.dt_component_role || ''}`;
}

export function toggleSupportStructureInspector(userData) {
  const id = `support-structure:${userData?.dt_structure_id || ''}:${userData?.dt_component_role || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) {
    hideInspector();
  } else {
    showSupportStructureInspector(userData);
  }
}

// Elevated-structure inspector (sml-bridge-deck-z §6). Decks + pillars
// aren't typed_set elements, so they need their own showInspector path.
// userData expected: dt_route_id, dt_deck_class, dt_z_min, dt_z_max,
// dt_n_segments, optional dt_type.
export function showElevatedInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  el('inspector-type').textContent = userData.dt_type === 'elevated_pillars'
    ? 'Pillars'
    : `Deck · ${userData.dt_deck_class || '?'}`;
  el('inspector-id').textContent = userData.dt_route_id || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('deck_class', userData.dt_deck_class),
    kvRow('n_segments', userData.dt_n_segments),
    kvRow('z_min', userData.dt_z_min != null ? userData.dt_z_min.toFixed(2) + ' m' : null),
    kvRow('z_max', userData.dt_z_max != null ? userData.dt_z_max.toFixed(2) + ' m' : null),
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `elevated:${userData.dt_route_id || ''}`;
}

export function toggleElevatedInspector(userData) {
  const id = `elevated:${userData?.dt_route_id || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) {
    hideInspector();
  } else {
    showElevatedInspector(userData);
  }
}

// twin_id → sim node id (frames node_metadata reverse index), injected by
// main.js after frames load so the T2 card can name the sim node projecting
// onto its twin (sml-twin-projection-threading).
let twinToSimNode = new Map();
export function setTwinToSimNodeIndex(map) {
  twinToSimNode = map || new Map();
}

// sml-poi-descriptive-cards: descriptive POI card — visitor-facing content
// (name, description, hours, wikidata) for a building-surface click. The
// TECHNICAL node card (z / lineage) stays on balls and balloons; this card
// deliberately carries no Z rows. Element built by poi-card.js.
export function showPoiDescriptionInspector(element) {
  const panel = el('inspector');
  if (!panel || !element) return;
  el('inspector-type').textContent = element.name || 'POI';
  el('inspector-id').textContent = element.id || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('name_en', element.name_en),
    kvRow('type', element.poi_type),
    kvRow('about', element.description),
    kvRow('hours', element.opening_hours),
    kvRow('wikidata', element.wikidata),
    kvRow('sim_node', twinToSimNode.get(String(element.id || '')) || null),
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `poi-desc:${element.id || ''}`;
}

export function togglePoiDescriptionInspector(element) {
  const id = `poi-desc:${element?.id || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showPoiDescriptionInspector(element);
}

// sml-viewer-diagnostic-convergence: T2 sim-node inspector. These nodes are NOT
// typed_set elements (they live in intersections.json); they carry
// kind:'t2-sim-node' userData stamped by buildSimNodeLayer. Shows the synth's
// per-node z + z_lineage so a producer can audit a flagged node's provenance.
export function showSimNodeInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  el('inspector-type').textContent = `T2 sim node · ${userData.role || '?'}`;
  el('inspector-id').textContent = userData.twin_id || '';
  el('inspector-id').classList.remove('copied');
  const zl = userData.z_lineage || {};
  const parts = [
    kvRow('name', userData.name),
    kvRow('role', userData.role),
    kvRow('sim_node', twinToSimNode.get(String(userData.twin_id || '')) || null),
    kvRow('z', userData.z != null ? userData.z.toFixed(2) + ' m' : null),
    kvRow('z_lineage.tool', zl.tool),
    kvRow('z_lineage.confidence', zl.confidence),
    kvRow('z_source', userData.z_source),
    userData.is_cliff ? kvRow('cliff_grade_pct', userData.cliff_grade_pct + ' %') : '',
    userData.is_below_lake ? kvRow('below_lake', 'node z under full pool') : '',
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `sim-node:${userData.twin_id || ''}`;
}

export function toggleSimNodeInspector(userData) {
  const id = `sim-node:${userData?.twin_id || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showSimNodeInspector(userData);
}

// sml-viewer-diagnostic-convergence: diagnostic-edge inspector. A flagged edge's
// mesh carries the verdict fields (is_submerged/deepest_z or is_steep_slope/
// avg_grade_pct + z_source) stamped by loadDiagnostics. Shows why it's flagged.
export function showDiagnosticEdgeInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  const isSub = !!userData.is_submerged;
  const isOverlap = !!userData.is_overlap;
  const isSteep = !!userData.is_steep_slope;
  const isBelowLake = !!userData.is_below_lake;
  const isTerrain = !!userData.is_terrain_fault;
  // Type label precedence mirrors main.js's ACTUAL recolor precedence, so the
  // headline always matches the color the mesh renders (when the master Diagnostics
  // toggle is on): the terrain-fault recolor EVICTS every other axis color at load
  // (terrain-fault block: "outranks the toggle-managed recolors") and is applied at
  // higher priority in setDiagnosticsVisible; submerged/steep are the zFaultIds tier
  // that both overlap and below-lake defer to (sub/steep mutually exclusive by
  // mode); below-lake overwrites the overlap color where they collide (its
  // loop runs after overlap, guarded only by zFaultIds). userData flags (and so this
  // headline) are stamped regardless of toggle state — only the rendered edge COLOR
  // is toggle-gated. Every verdict row the carrier holds still renders below
  // regardless of the headline.
  el('inspector-type').textContent =
    isTerrain ? `Relief fault · ${userData.terrain_verdict || '?'}`
    : isSub ? 'Submerged edge'
    : isSteep ? 'Steep-slope edge'
    : isBelowLake ? 'Below-lake edge'
    : isOverlap ? 'Overlapping/duplicate edge'
    : 'Diagnostic edge';
  el('inspector-id').textContent = userData.dt_edge_id || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('name', userData.name),
    kvRow('z_source', userData.z_source),
    isSub && userData.deepest_z != null ? kvRow('deepest_z', userData.deepest_z + ' m') : '',
    isSteep ? kvRow('avg_grade_pct', userData.avg_grade_pct + ' %') : '',
    isOverlap && userData.overlap_with ? kvRow('overlaps', userData.overlap_with.join(', ')) : '',
    isOverlap && userData.shared_verts != null ? kvRow('shared_verts', String(userData.shared_verts)) : '',
    isBelowLake && userData.below_lake_z != null ? kvRow('below_lake_z', userData.below_lake_z + ' m') : '',
    isBelowLake && userData.mode ? kvRow('mode', userData.mode) : '',
    isTerrain ? kvRow('verdict', userData.terrain_verdict) : '',
    isTerrain && userData.max_float != null ? kvRow('max_float', userData.max_float + ' m') : '',
    isTerrain && userData.max_dive != null ? kvRow('max_dive', userData.max_dive + ' m') : '',
    isTerrain && userData.carve_depth != null ? kvRow('carve_depth', userData.carve_depth + ' m') : '',
    isTerrain && userData.max_ridge != null ? kvRow('max_ridge', userData.max_ridge + ' m') : '',
    isTerrain && userData.max_trench != null ? kvRow('max_trench', userData.max_trench + ' m') : '',
    isTerrain && userData.edge_z != null ? kvRow('edge_z', userData.edge_z + ' m') : '',
    isTerrain && userData.surface_z != null ? kvRow('surface_z', userData.surface_z + ' m') : '',
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `diag-edge:${userData.dt_edge_id || ''}`;
}

export function toggleDiagnosticEdgeInspector(userData) {
  const id = `diag-edge:${userData?.dt_edge_id || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showDiagnosticEdgeInspector(userData);
}

// sml-diagnostic-click-cards: WAY-level stairs-flat evidence card (the
// sml-stairs-flat-axis rose markers). The way beacon carries dt_way_id but NO
// dt_edge_id, so it fell through every routing branch and answered a click
// with NOTHING; member edges fell into the generic edge card with the verdict
// invisible. Shows the Gate-A arithmetic a producer needs: step_count × riser
// vs the measured rise.
export function showStairsFlatInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  el('inspector-type').textContent = 'Leveled stairs (evidence)';
  el('inspector-id').textContent = String(userData.dt_way_id ?? userData.dt_edge_id ?? '');
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('osm_way', userData.dt_way_id),
    userData.dt_edge_id ? kvRow('member_edge', userData.dt_edge_id) : '',
    kvRow('step_count', userData.step_count),
    typeof userData.sum_dz_m === 'number' ? kvRow('sum_dz', userData.sum_dz_m.toFixed(2) + ' m') : '',
    typeof userData.expected_min_m === 'number' ? kvRow('expected_min', userData.expected_min_m.toFixed(2) + ' m') : '',
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = _stairsFlatKey(userData);
}

// Key includes the member edge: the WAY beacon and each member edge share a
// dt_way_id, and a way-only key made beacon→member-edge clicks read as "same
// thing" and CLOSE the panel instead of switching cards.
function _stairsFlatKey(userData) {
  return `stairs-flat:${userData?.dt_way_id ?? ''}:${userData?.dt_edge_id ?? 'way'}`;
}

export function toggleStairsFlatInspector(userData) {
  const id = _stairsFlatKey(userData);
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showStairsFlatInspector(userData);
}

// sml-walkway-3d-overlay: hero-walkway plank inspector. The overlay meshes
// (deck / stair treads / stilts / railings) carry dt_route_id +
// dt_construction_mode + dt_segment_index (from the GLB mesh extras, stamped by
// assemble_route) — they are NOT dt_type elevated_* nor dt_edge_id network
// meshes, so the click handler needs this branch to let a producer click a
// plank and see which route + segment + mode it belongs to.
export function showWalkway3dInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  el('inspector-type').textContent = `Walkway 3D · ${userData.dt_construction_mode || 'part'}`;
  el('inspector-id').textContent = userData.dt_route_id || '';
  el('inspector-id').classList.remove('copied');
  const tread = userData.step_tread_m;
  const parts = [
    kvRow('construction_mode', userData.dt_construction_mode),
    kvRow('segment_index', userData.dt_segment_index),
    kvRow('deck_class', userData.dt_deck_class),
    userData.step_count != null ? kvRow('step_count', userData.step_count) : '',
    typeof tread === 'number' ? kvRow('step_tread_m', tread.toFixed(2) + ' m') : '',
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `walkway-3d:${userData.dt_route_id || ''}:${userData.dt_segment_index ?? ''}`;
}

export function toggleWalkway3dInspector(userData) {
  const id = `walkway-3d:${userData?.dt_route_id || ''}:${userData?.dt_segment_index ?? ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showWalkway3dInspector(userData);
}

// viewer-click-names: named facility markers (node_metadata balloons). userData:
// { twinId, name, archetype, lat, lng, … }. The marker carries its name directly,
// so clicking it surfaces the facility's name + archetype (these spheres had no
// inspector route before).
export function showNodeMarkerInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  el('inspector-type').textContent = userData.archetype || 'node';
  el('inspector-id').textContent = userData.twinId || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('name', userData.name),
    kvRow('archetype', userData.archetype),
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `node-marker:${userData.twinId || ''}`;
}

export function toggleNodeMarkerInspector(userData) {
  const id = `node-marker:${userData?.twinId || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showNodeMarkerInspector(userData);
}

// viewer-story-cinema: cohort-actor identity card. The sphere the audience
// sees IS a simulated group — the card must say who, how many, and what
// they're doing right now (live state stashed by applyFrame).
export function showCohortInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  const live = userData.live || {};
  const pe = live.position_edge;
  el('inspector-type').textContent = userData.isWannabe ? 'protagonist cohort' : 'cohort';
  el('inspector-id').textContent = userData.cohortId || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('archetype', userData.archetype),
    kvRow('size', live.size ?? userData.size),
    kvRow('status', live.status),
    pe ? kvRow('on edge', `${pe.edge_id} @ ${Math.round(pe.offset_m)} m (${pe.direction})`) : null,
    kvRow('spawn', userData.spawn_node),
    kvRow('destination', userData.destination),
    userData.isWannabe ? kvRow('story', 'the wannabe — follows the narration beats') : null,
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `cohort:${userData.cohortId || ''}`;
}

export function toggleCohortInspector(userData) {
  const id = `cohort:${userData?.cohortId || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showCohortInspector(userData);
}

// viewer-story-cinema: vehicle identity card (ferry/bus/ropeway actor).
export function showVehicleInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  const live = userData.live || {};
  el('inspector-type').textContent = `${userData.vehicleType || 'vehicle'}`;
  el('inspector-id').textContent = userData.vehicleId || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('status', live.status),
    kvRow('passengers', live.capacity != null ? `${live.passengers ?? 0} / ${live.capacity}` : live.passengers),
    kvRow('utilization', live.utilization != null ? Math.round(live.utilization * 100) + '%' : null),
    kvRow('on edge', live.current_edge),
    kvRow('next stop', live.next_stop),
    kvRow('eta', live.eta),
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `vehicle:${userData.vehicleId || ''}`;
}

export function toggleVehicleInspector(userData) {
  const id = `vehicle:${userData?.vehicleId || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showVehicleInspector(userData);
}

// engine-agnostic-tier2 / viewer-schematic-diagnosis-layer: T2 schematic corridor
// inspector. The diagnosis-layer Line2 edges are synthesized junction-to-junction
// corridors (ids like E-JCT-…), NOT typed_set elements, so they need their own
// route. Mirrors base.js's surface inspector — surfaces the corridor's name +
// lineage (OSM way id / highway tag / provenance) the producer needs to trace it.
export function showSchematicEdgeInspector(userData) {
  const panel = el('inspector');
  if (!panel || !userData) return;
  const lin = userData.lineage || {};
  el('inspector-type').textContent = `${userData.mode_display || userData.mode || 'edge'} corridor`;
  el('inspector-id').textContent = userData.dt_edge_id || userData.edge_id || '';
  el('inspector-id').classList.remove('copied');
  const parts = [
    kvRow('name', userData.name),
    kvRow('mode', userData.mode_display || userData.mode),
    kvRow('highway', userData.highway),
    kvRow('length', userData.distance_m != null ? Number(userData.distance_m).toFixed(0) + ' m' : null),
    kvRow('from_node', userData.from_node),
    kvRow('to_node', userData.to_node),
    kvRow('osm_way_id', userData.osm_way_id ?? lin.osm_way_id),
    kvRow('provenance', lin.provenance),
    kvRow('z_source', userData.z_source),
    kvRow('authority', userData.authority_tier),
  ];
  el('inspector-body').innerHTML = parts.filter(Boolean).join('');
  panel.classList.remove('hidden');
  currentElementId = `schematic-edge:${userData.dt_edge_id || userData.edge_id || ''}`;
}

export function toggleSchematicEdgeInspector(userData) {
  const id = `schematic-edge:${userData?.dt_edge_id || userData?.edge_id || ''}`;
  if (currentElementId === id && !el('inspector').classList.contains('hidden')) hideInspector();
  else showSchematicEdgeInspector(userData);
}

export function attachInspectorBindings() {
  const closeBtn = el('inspector-close');
  if (closeBtn) closeBtn.addEventListener('click', hideInspector);

  const idEl = el('inspector-id');
  if (idEl) {
    idEl.addEventListener('click', async () => {
      const text = idEl.textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        idEl.classList.add('copied');
        setTimeout(() => idEl.classList.remove('copied'), 800);
      } catch {
        // clipboard may be unavailable (insecure context); silently no-op
      }
    });
  }
}
