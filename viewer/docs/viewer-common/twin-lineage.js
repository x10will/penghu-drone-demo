// Runtime reader for the optional Producer twin-lineage asset.
export const TWIN_LINEAGE_SCHEMA = 'dt-twin-lineage/1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(record, allowed) {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateDocument(document) {
  if (!isRecord(document) || !hasOnlyKeys(document, ['generator', 'inputs', 'schema', 'site', 'twins'])) {
    return 'top-level record has unsupported fields or is not an object';
  }
  if (document.schema !== TWIN_LINEAGE_SCHEMA || !nonEmptyString(document.generator)
      || !nonEmptyString(document.site)) {
    return `top-level identity must include schema ${TWIN_LINEAGE_SCHEMA}, generator, and site`;
  }
  const inputNames = ['data_sources', 'linkage', 'physical_twins'];
  if (!isRecord(document.inputs) || !hasOnlyKeys(document.inputs, inputNames)
      || inputNames.some((name) => !Object.hasOwn(document.inputs, name))) {
    return 'inputs must contain exactly data_sources, linkage, and physical_twins';
  }
  for (const name of inputNames) {
    const input = document.inputs[name];
    if (!isRecord(input) || !hasOnlyKeys(input, ['path', 'sha256'])
        || !nonEmptyString(input.path)
        || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/.test(input.path)
        || input.path.includes('\\') || /^[A-Za-z]:/.test(input.path)
        || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) {
      return `inputs.${name} must contain a repository-relative path and lowercase SHA-256`;
    }
  }
  if (!isRecord(document.twins)) return 'twins must be an object';
  for (const [twinId, twin] of Object.entries(document.twins)) {
    if (!nonEmptyString(twinId) || !isRecord(twin)
        || !hasOnlyKeys(twin, ['authority', 'evidence_ids', 'sources'])
        || !nonEmptyString(twin.authority)
        || !Array.isArray(twin.evidence_ids)
        || twin.evidence_ids.some((id) => !nonEmptyString(id))
        || !Array.isArray(twin.sources) || twin.sources.length === 0) {
      return `twins.${twinId || '<empty>'} is malformed`;
    }
    for (const [sourceIndex, source] of twin.sources.entries()) {
      if (!isRecord(source)
          || !hasOnlyKeys(source, [
            'source_id', 'name', 'provider', 'trust_level', 'url', 'provides', 'resolved_fields',
          ])
          || !nonEmptyString(source.source_id) || !nonEmptyString(source.name)) {
        return `twins.${twinId}.sources[${sourceIndex}] must include source_id and name only from the published fields`;
      }
      if (Object.hasOwn(source, 'provider') && typeof source.provider !== 'string') {
        return `twins.${twinId}.sources[${sourceIndex}].provider must be a string`;
      }
      if (Object.hasOwn(source, 'trust_level') && typeof source.trust_level !== 'number') {
        return `twins.${twinId}.sources[${sourceIndex}].trust_level must be a number`;
      }
      if (Object.hasOwn(source, 'url') && source.url !== null && typeof source.url !== 'string') {
        return `twins.${twinId}.sources[${sourceIndex}].url must be a string or null`;
      }
      if (Object.hasOwn(source, 'provides') && typeof source.provides !== 'string') {
        return `twins.${twinId}.sources[${sourceIndex}].provides must be a string`;
      }
      if (Object.hasOwn(source, 'resolved_fields') && (!Array.isArray(source.resolved_fields)
          || source.resolved_fields.some((field) => typeof field !== 'string'))) {
        return `twins.${twinId}.sources[${sourceIndex}].resolved_fields must be an array of strings`;
      }
    }
  }
  return null;
}

/** Parse and validate a lineage index. Bad optional data degrades to no index. */
export function loadTwinLineageIndex(text, warn = console.warn) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    warn(`[dt] twin-lineage index is invalid JSON: ${error.message}`);
    return null;
  }
  const issue = validateDocument(document);
  if (issue) {
    warn(`[dt] twin-lineage index has an unsupported or malformed schema: ${issue}`);
    return null;
  }
  return document;
}

/** Return the first exact candidate key found in a validated index. */
export function resolveTwinLineageEntry(index, candidateIds) {
  if (!index || !isRecord(index.twins) || !Array.isArray(candidateIds)) return null;
  for (const twinId of candidateIds) {
    if (typeof twinId !== 'string' || twinId === '') continue;
    const entry = index.twins[twinId];
    if (isRecord(entry)) return { twinId, entry };
  }
  return null;
}
