// Engine-neutral consumer for manifest-declared site context layers.
//
// This module deliberately does not know about Three.js, display Z, SML
// defaults, or Farm topology. It validates the site/manifest boundary and
// returns requests that an engine-specific loader may render.

// Source: Farm's committed profile
// sources/derived/site-bake-pipeline/farm.site-profile.v1.json:587-595;
// the same role contract is viewer-site-config/spec.md:76-93.
export const CONTEXT_LAYER_ROLES = Object.freeze([
  'painted-terrain',
  'context-roads',
  'generic-edge',
  'river-zone-paint',
  'river-ribbon',
  'trees',
  'white-context-buildings',
  'supported-labels',
  'farm-field-ridges',
]);

// Source: viewer-site-config/spec.md:76-105 and
// site-bake-pipeline/spec.md:140-147: context records are renderable but
// have context-only authority, source lineage, and notice lineage.
export const CONTEXT_AUTHORITY_SCOPE = 'context-only';

// Source: Farm source package
// reference/sources/derived/farm-site-export/farm-site-source-package.v1.json:461-465:
// the separate road prop is explicitly an origin_kind=context-record.
export const CONTEXT_PROP_ORIGIN_KIND = 'context-record';

// Source: companion site-bake-pipeline/spec.md:158-178 and the gap-3c
// single-load requirement. These two roles describe presentation/lineage
// records for the already-loaded terrain surface; they are not fetchable GLBs.
export const TERRAIN_ALIAS_ROLES = Object.freeze([
  'painted-terrain',
  'river-zone-paint',
]);
// Source: the existing terrain roots in docs/viewer-3d/base.js:347 and
// docs/viewer-3d/main.js:779; aliases point at that already-loaded root.
export const TERRAIN_ALIAS_TARGET = 'terrain';

// Source: site-bake-pipeline/spec.md:140-147 and
// sml-3d-scene-loader/spec.md:3-7: these authority fields must never be
// carried by a context-only record or promoted into typed lookup.
const FORBIDDEN_CONTEXT_FIELDS = Object.freeze([
  'twin', 'twin_id', 'twinId',
  'farm_id', 'farmId',
  'farm_topology_id', 'topology_id', 'topologyId', 'topology', 'topology_entity',
  'route_id', 'routeId',
  'canonical_frame_id', 'canonicalFrameId', 'canonical_frame', 'canonical_frame_input',
  'runtime_state_id', 'runtimeStateId', 'runtime_state', 'runtime',
  'crop', 'crop_id', 'cropId',
]);

const PROVENANCE_CATALOG_PATH = 'provenance/group4-catalog.json';
const RIDGE_ROLE = 'farm-field-ridges';

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`site-layer consumer: ${label} must be a non-empty string`);
  }
  return value;
}

function optionalContextMetadata(record, role) {
  const metadata = {};
  if (role === 'farm-field-ridges') {
    if (record.presentation_only !== true) {
      throw new Error(
        `site-layer consumer: ${role} must declare presentation_only=true`,
      );
    }
    if (typeof record.appearance_provenance_ref !== 'string'
        || record.appearance_provenance_ref.trim() === '') {
      throw new Error(
        `site-layer consumer: ${role} appearance_provenance_ref must be non-empty`,
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(record, 'presentation_only')) {
    if (typeof record.presentation_only !== 'boolean') {
      throw new Error(`site-layer consumer: presentation_only for ${role} must be a boolean`);
    }
    metadata.presentation_only = record.presentation_only;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'appearance_provenance_ref')) {
    metadata.appearance_provenance_ref = nonEmptyString(
      record.appearance_provenance_ref,
      `appearance_provenance_ref for ${role}`,
    );
  }
  // Whether the package's own materials survive the viewer's shared restyle.
  // Separate from appearance_provenance_ref: that one records where an
  // appearance decision came from, which is true of restyled layers too.
  if (Object.prototype.hasOwnProperty.call(record, 'preserve_declared_appearance')) {
    if (typeof record.preserve_declared_appearance !== 'boolean') {
      throw new Error(
        `site-layer consumer: preserve_declared_appearance for ${role} must be a boolean`,
      );
    }
    metadata.preserve_declared_appearance = record.preserve_declared_appearance;
  }
  // The ref names a profile row the offline package does not ship. The Farm
  // package carries the decided values in its provenance catalog instead, and
  // they are passed through here so the inspector can show what the ref means
  // rather than only that it exists.
  if (Object.prototype.hasOwnProperty.call(record, 'appearance_provenance')) {
    const resolved = record.appearance_provenance;
    if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new Error(
        `site-layer consumer: appearance_provenance for ${role} must be an object`,
      );
    }
    metadata.appearance_provenance = resolved;
  }
  return metadata;
}

function roleDeclarations(site) {
  const declarations = site?.contextLayerRoles;
  if (declarations == null) return [];
  if (Array.isArray(declarations)) {
    return declarations.map((role) => [role, { enabled: true }]);
  }
  if (typeof declarations !== 'object') {
    throw new Error('site-layer consumer: contextLayerRoles must be an array or object');
  }
  return Object.entries(declarations).map(([role, declaration]) => {
    if (declaration === false) return [role, { enabled: false }];
    if (declaration === true || declaration == null) return [role, { enabled: true }];
    if (typeof declaration !== 'object') {
      throw new Error(`site-layer consumer: declaration for ${role} must be an object`);
    }
    return [role, declaration];
  });
}

function validateRole(role) {
  nonEmptyString(role, 'context role');
  if (!CONTEXT_LAYER_ROLES.includes(role)) {
    throw new Error(`site-layer consumer: unsupported context role '${role}'`);
  }
}

function validateRelativePath(value, label) {
  const path = nonEmptyString(value, label).trim();
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* reject only structural escapes below */ }
  if (
    path.startsWith('/') || path.startsWith('\\') || /^[a-z][a-z\d+.-]*:/i.test(path)
    || path.includes('?') || path.includes('#')
    || decoded.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`site-layer consumer: ${label} must be a contained relative path`);
  }
  return path.replaceAll('\\', '/').replace(/^\/+/, '');
}

function manifestLayer(manifest, role) {
  const layers = manifest?.layers;
  if (!layers) return null;
  if (Array.isArray(layers)) {
    return layers.find((row) => row && (row.role === role || row.id === role)) || null;
  }
  if (typeof layers === 'object') return layers[role] || null;
  throw new Error('site-layer consumer: manifest.layers must be an object or array');
}

function assertNoSmlRoute(site, url, path) {
  // Farm's active data root is declared in docs/viewer-3d/site-config.js and
  // must never be substituted with the SML root. Check both the joined URL and
  // the manifest path because either one can carry a boundary mistake.
  if (site?.id === 'farm' && /(?:^|[\\/])data[\\/]sml(?:[\\/]|$)/i.test(`${url}/${path}`)) {
    throw new Error(`site-layer consumer: Farm context role routes to data/sml: ${path}`);
  }
}

function validateContextRecord(site, role, record) {
  if (!record || typeof record !== 'object') {
    throw new Error(`site-layer consumer: manifest record missing for ${role}`);
  }
  for (const field of FORBIDDEN_CONTEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`site-layer consumer: context role ${role} contains forbidden authority field ${field}`);
    }
  }
  if (record.lineage && typeof record.lineage === 'object') {
    for (const field of FORBIDDEN_CONTEXT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(record.lineage, field)) {
        throw new Error(`site-layer consumer: context role ${role} lineage contains forbidden authority field ${field}`);
      }
    }
  }
  if (record.role != null && record.role !== role) {
    throw new Error(`site-layer consumer: manifest role identity mismatch for ${role}`);
  }
  const kind = nonEmptyString(record.kind, `kind for ${role}`);
  const aliasOf = record.alias_of;
  // The explicit alias_of field is the structural distinction. The proposal
  // does not authorize a new literal kind value; kind remains producer-owned.
  const isTerrainAlias = aliasOf !== undefined;
  let path = null;
  if (isTerrainAlias) {
    if (!TERRAIN_ALIAS_ROLES.includes(role)) {
      throw new Error(`site-layer consumer: terrain alias is unsupported for ${role}`);
    }
    if (aliasOf !== TERRAIN_ALIAS_TARGET) {
      throw new Error(`site-layer consumer: ${role} has an invalid terrain alias`);
    }
    if (record.path !== undefined) {
      throw new Error(`site-layer consumer: ${role} terrain alias must omit path`);
    }
  } else {
    if (aliasOf !== undefined) {
      throw new Error(`site-layer consumer: ${role} has an unsupported alias target`);
    }
    path = validateRelativePath(record.path, `manifest path for ${role}`);
  }
  const root = validateRelativePath(record.root, `layer root for ${role}`);
  if (isTerrainAlias && root !== TERRAIN_ALIAS_TARGET) {
    throw new Error(`site-layer consumer: ${role} terrain alias must target the terrain root`);
  }
  const stableId = record.stable_id ?? record.id;
  nonEmptyString(stableId, `stable_id for ${role}`);
  nonEmptyString(record.source_ref, `source_ref for ${role}`);
  nonEmptyString(record.notice_ref, `notice_ref for ${role}`);
  if (record.authority_scope !== CONTEXT_AUTHORITY_SCOPE) {
    throw new Error(`site-layer consumer: ${role} must declare authority_scope=${CONTEXT_AUTHORITY_SCOPE}`);
  }
  return {
    path,
    root,
    stable_id: stableId,
    kind,
    alias_of: isTerrainAlias ? aliasOf : null,
    optionalMetadata: optionalContextMetadata(record, role),
  };
}

function assetUrl(site, path) {
  const base = nonEmptyString(site?.dataBase, 'site dataBase').replace(/\/+$/, '');
  const url = `${base}/${path}`;
  assertNoSmlRoute(site, url, path);
  return url;
}

/** Resolve the active site's explicit context manifest without ambient roots. */
export function resolveContextManifestUrl(site) {
  const path = validateRelativePath(site?.contextLayerManifest, 'contextLayerManifest');
  return assetUrl(site, path);
}

/**
 * The package ships the values behind `appearance_provenance_ref` in its
 * provenance catalog, beside the declared context manifest. The reference
 * itself names an authority-profile row the package does not carry.
 */
export function resolveProvenanceCatalogUrl(site) {
  validateRelativePath(site?.contextLayerManifest, 'contextLayerManifest');
  return assetUrl(site, PROVENANCE_CATALOG_PATH);
}

/**
 * Attach the catalog's resolved record to the request whose reference it
 * answers. A package without the block is an absence, not an error: the
 * reference still renders and nothing is substituted for the missing values.
 */
export function applyProvenanceCatalog(requests, catalog) {
  const resolved = catalog?.field_ridges;
  if (resolved == null || typeof resolved !== 'object' || Array.isArray(resolved)) {
    return requests;
  }
  for (const [index, request] of (requests ?? []).entries()) {
    if (request?.role === RIDGE_ROLE) {
      // Resolved requests are frozen. Keep the caller's array (main.js uses
      // it after this call), replacing only this entry with a frozen copy.
      requests[index] = Object.freeze({ ...request, appearance_provenance: resolved });
    }
  }
  return requests;
}

/**
 * Resolve only roles explicitly declared by the active site and present in
 * the supplied manifest. Missing optional records are an absence, not a
 * request and never trigger an SML fallback. A declaration or manifest row
 * may set required:true to turn that absence into a fail-closed error.
 */
export function resolveDeclaredLayerRequests(site, manifest) {
  const requests = [];
  for (const [role, declaration] of roleDeclarations(site)) {
    validateRole(role);
    if (declaration.enabled === false) continue;
    const record = manifestLayer(manifest, role);
    if (!record) {
      if (declaration.required === true) {
        throw new Error(`site-layer consumer: required context role '${role}' is absent from the manifest`);
      }
      continue;
    }
    if (record.enabled === false) continue;
    if (record.required === true && declaration.enabled === false) continue;
    const normalized = validateContextRecord(site, role, record);
    const request = {
      role,
      root: normalized.root,
      kind: normalized.kind,
      stable_id: normalized.stable_id,
      authority_scope: CONTEXT_AUTHORITY_SCOPE,
      source_ref: record.source_ref,
      notice_ref: record.notice_ref,
      ...normalized.optionalMetadata,
      visible: record.visible !== false,
    };
    if (normalized.alias_of) {
      request.alias_of = normalized.alias_of;
      request.path = null;
      request.url = null;
    } else {
      request.path = normalized.path;
      request.url = assetUrl(site, normalized.path);
    }
    requests.push(Object.freeze(request));
  }
  return requests;
}

/**
 * Toggle a manifest-declared root without touching object positions or Z.
 * Returns false when the engine has not created the declared root yet.
 */
export function setDeclaredLayerVisible(layerRoots, request, visible) {
  if (!layerRoots || !request) return false;
  const root = layerRoots[request.root];
  if (!root) return false;
  root.visible = !!visible;
  return true;
}

/** Return the inspectable context record with no twin/topology/runtime fields. */
export function contextInspectionRecord(request) {
  if (!request || request.authority_scope !== CONTEXT_AUTHORITY_SCOPE) {
    throw new Error(`site-layer consumer: inspection requires ${CONTEXT_AUTHORITY_SCOPE} authority`);
  }
  for (const field of FORBIDDEN_CONTEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      throw new Error(`site-layer consumer: inspection contains forbidden authority field ${field}`);
    }
  }
  validateRole(request.role);
  nonEmptyString(request.stable_id, 'context stable_id');
  nonEmptyString(request.source_ref, 'context source_ref');
  nonEmptyString(request.notice_ref, 'context notice_ref');
  const optionalMetadata = optionalContextMetadata(request, request.role);
  return Object.freeze({
    id: request.stable_id,
    stable_id: request.stable_id,
    semantic_type: CONTEXT_AUTHORITY_SCOPE,
    context_role: request.role,
    authority_scope: CONTEXT_AUTHORITY_SCOPE,
    source_ref: request.source_ref,
    notice_ref: request.notice_ref,
    ...optionalMetadata,
    lineage: Object.freeze({
      authority: CONTEXT_AUTHORITY_SCOPE,
      source_ref: request.source_ref,
      notice_ref: request.notice_ref,
      ...optionalMetadata,
    }),
  });
}

/** Preserve accepted authored Farm prop fields exactly. */
export function authoredPropInspection(prop) {
  if (!prop || typeof prop.origin_kind !== 'string' || prop.origin_kind.trim() === ''
      || prop.origin_kind === CONTEXT_PROP_ORIGIN_KIND) {
    throw new Error('site-layer consumer: authored prop must carry a non-context origin_kind');
  }
  return Object.freeze({ ...prop });
}

export function isForbiddenContextField(field) {
  return FORBIDDEN_CONTEXT_FIELDS.includes(field);
}
