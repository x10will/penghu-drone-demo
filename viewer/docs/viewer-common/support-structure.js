// Browser-side integrity contract for the optional S7 support-structure layer.
// Build-time authority/freshness gates belong to the producer.  The viewer
// validates the published schema and binding chain without pinning a build's
// input hashes, so later stages may add or refresh declared inputs.

function normalizedSha(value) {
  const text = String(value || '');
  return text.startsWith('sha256:') ? text.slice(7) : text;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const STRUCTURE_ID = 'SML-S7-SUPPORT-E-62f16ef2-R53-56';
const EDGE_ID = 'E-62f16ef2';
const CONVENTION_ID = 'sml-s7-support-selection-v1';
const COVERED_TUPLES = [
  ...Array.from({ length: 7 }, (_, i) => 191 + i),
  ...Array.from({ length: 4 }, (_, i) => 200 + i),
  207,
].map((station) => `unsupported_deck_gap|vertex|${EDGE_ID}|r|${station}|gt_0_5m`).concat(
  [...Array.from({ length: 8 }, (_, i) => 190 + i),
    ...Array.from({ length: 5 }, (_, i) => 199 + i), 206, 207]
    .map((station) => `unsupported_deck_gap|segment|${EDGE_ID}|r|${station}|gt_0_5m`),
);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function requireDeclaredInput(inputHashes, source, label) {
  requireValue(typeof source === 'string' && source.length > 0,
    `support ${label} source missing`);
  requireValue(SHA256.test(inputHashes[source] || ''),
    `support ${label} source hash missing: ${source}`);
}

function isExactSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === expected.length
    && actual.every((value) => expected.includes(value));
}

export function validateSupportAssetMetadata(manifest, sidecar, opts = {}) {
  const manifestEntries = (manifest?.meshes || []).filter(
    (entry) => entry?.file === 'support_structures.glb',
  );
  requireValue(manifestEntries.length === 1, 'support manifest entry missing or duplicated');
  const manifestEntry = manifestEntries[0];
  requireValue(
    manifestEntry.sidecar === 'support_structures.glb.provenance.json',
    'support manifest sidecar binding missing',
  );
  requireValue(sidecar?.schema === 'sml-s7-support-structures/v3', 'support sidecar schema mismatch');
  requireValue(sidecar?.stage === 'S7' && sidecar?.tool === 'road_support_structure',
    'support sidecar producer identity mismatch');
  const generatedBy = sidecar?.generated_by;
  requireValue(generatedBy?.pipeline?.name === 'sml-s7-road-support-structure'
      && generatedBy?.pipeline?.script === 'scripts/mesh_gen/road_support_structure.py'
      && generatedBy?.pipeline?.openspec_change === 'sml-m9-road-support-structure'
      && generatedBy?.site === 'sml'
      && Array.isArray(generatedBy?.consumes),
  'support sidecar canonical generated_by mismatch');
  requireValue(sidecar?.artifact === 'data/sml/meshes/support_structures.glb',
    'support sidecar artifact binding missing');
  requireValue(SHA256.test(sidecar?.artifact_sha256 || ''),
    'support sidecar artifact hash malformed');
  requireValue(normalizedSha(manifestEntry.sha256) === normalizedSha(sidecar.artifact_sha256),
    'support artifact hash mismatch between manifest and sidecar');
  if (opts.artifactSha256 !== undefined) {
    requireValue(SHA256.test(opts.artifactSha256 || ''), 'served support artifact hash malformed');
    requireValue(normalizedSha(opts.artifactSha256) === normalizedSha(sidecar.artifact_sha256),
      'served artifact hash mismatch');
  }

  const inputHashes = sidecar?.input_hashes;
  requireValue(inputHashes && typeof inputHashes === 'object' && !Array.isArray(inputHashes),
    'support input_hashes missing');
  requireValue(Object.keys(inputHashes).length > 0, 'support input_hashes empty');
  for (const [path, hash] of Object.entries(inputHashes)) {
    requireValue(typeof path === 'string' && path.trim().length > 0,
      'support input hash path malformed');
    requireValue(SHA256.test(hash || ''), `support input hash malformed: ${path}`);
  }
  requireDeclaredInput(inputHashes, generatedBy.pipeline.script, 'producer');
  requireValue(generatedBy.consumes.every(
    (path) => typeof path === 'string'
      && (path.startsWith('data/') || path.startsWith('external/'))
      && SHA256.test(inputHashes[path] || ''),
  ), 'support generated_by consumes binding mismatch');

  const structures = sidecar?.structures;
  requireValue(Array.isArray(structures) && structures.length === 1,
    'support sidecar must describe exactly one structure');
  const structure = structures[0];
  requireValue(structure?.structure_id === STRUCTURE_ID
      && structure?.edge_id === EDGE_ID
      && isExactSet(structure?.covered_tuple_ids, COVERED_TUPLES),
  'support identity differs from exact Tranche-1 allowlist');
  requireValue(structure?.support_type === 'open_side_retaining_wall',
    'support structure type mismatch');
  requireValue(structure?.convention_id === CONVENTION_ID, 'support convention mismatch');
  requireValue(structure?.water_class === 'land', 'support water class mismatch');
  requireDeclaredInput(inputHashes, structure?.deck_authority?.source, 'deck authority');
  requireDeclaredInput(inputHashes, structure?.ground_authority?.source, 'ground authority');
  const classifierSource = typeof structure?.water_classifier === 'string'
    ? structure.water_classifier.split(':', 1)[0]
    : '';
  requireDeclaredInput(inputHashes, classifierSource, 'water classifier');
  return { manifestEntry, structure };
}

export function makeAssetErrorDiagnostic(code, url, error) {
  return {
    code,
    url,
    message: error?.message || String(error || 'unknown error'),
    severity: 'error',
  };
}

export function applyLayerFailureUi(documentLike, ids, diagnostic) {
  const label = documentLike?.getElementById?.(ids.labelId);
  const checkbox = documentLike?.getElementById?.(ids.checkboxId);
  if (!label && !checkbox) return false;
  const title = `Asset failed: ${diagnostic.message}`;
  if (label) {
    label.style.display = '';
    label.dataset.assetStatus = 'failed';
    label.title = title;
    label.classList.add('layer-failed');
  }
  if (checkbox) {
    checkbox.checked = false;
    checkbox.disabled = true;
    checkbox.title = title;
    checkbox.setAttribute('aria-invalid', 'true');
  }
  return true;
}

export function supportStructureUserData(sidecar, structure) {
  return {
    dt_layer: 'supportStructures',
    dt_mesh_role: 'support_structure',
    dt_structure_id: structure.structure_id,
    dt_support_type: structure.support_type,
    dt_convention_id: structure.convention_id,
    dt_water_class: structure.water_class,
    dt_covered_tuple_ids: structure.covered_tuple_ids,
    dt_source_hashes: sidecar.input_hashes,
  };
}
