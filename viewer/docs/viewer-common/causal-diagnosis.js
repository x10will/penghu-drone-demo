// Pure cause-effect marker/pick helpers shared by the Three viewer and Node tests.

function finiteCoordinate(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

function finitePoint(point) {
  return Array.isArray(point)
    && point.length >= 3
    && point.slice(0, 3).every(finiteCoordinate);
}

export function causalMarkerModel(diagnosis, { surfaceLiftM = 0.35 } = {}) {
  if (diagnosis?.axis === 'tallSupport') {
    if (diagnosis?.effect?.type !== 'tall_support') return null;
    if (diagnosis?.applicability === 'not_applicable') return null;
    const freshness = typeof diagnosis?.freshness === 'string'
      ? diagnosis.freshness : diagnosis?.freshness?.status;
    if (freshness !== 'fresh') return null;
  }
  const surface = diagnosis?.marker?.surface_point;
  const effect = diagnosis?.effect?.point;
  if (!finitePoint(surface)) return null;
  if (diagnosis?.axis === 'tallSupport' && !finitePoint(effect)) return null;
  return {
    diagnosisId: diagnosis.diagnosis_id,
    axis: diagnosis.axis,
    position: [Number(surface[0]), Number(surface[1]), Number(surface[2]) + surfaceLiftM],
    surfacePoint: surface.slice(0, 3).map(Number),
    effectPoint: finitePoint(effect) ? effect.slice(0, 3).map(Number) : null,
    verticalOffsetM: Number(diagnosis?.marker?.vertical_offset_m ?? 0),
    diagnosis,
  };
}

export function causalMarkerScale(diagnosis) {
  let scale = 1;
  if (diagnosis?.verdict === 'justified_engineered'
      || diagnosis?.verdict === 'justified_natural') scale = 0.55;
  else if (diagnosis?.verdict === 'unresolved') scale = 0.75;
  if (diagnosis?.effect?.type === 'eat'
      && Number(diagnosis?.effect?.metrics?.over_m ?? Infinity) <= 1.5) {
    scale = Math.min(scale, 0.5);
  }
  return scale;
}

export function causalMarkerDepthTest(diagnosis) {
  return diagnosis?.axis !== 'tallSupport';
}

export function causalReliefAxisCounts(rawSummary = {}, causalSummary = {}) {
  const effects = causalSummary?.by_effect || {};
  const support = causalSummary?.elevated_supports;
  const supportCount = support?.applicability === 'applicable'
    && support?.status === 'fresh'
    && Number.isInteger(support?.cluster_count)
    && support.cluster_count >= 0
    ? support.cluster_count
    : null;
  return {
    eat: effects.eat ?? rawSummary.eat ?? 0,
    gap: effects.gap ?? rawSummary.gap ?? 0,
    spike: effects.spike ?? rawSummary.spike ?? 0,
    elevated_buried: effects.elevated_buried ?? rawSummary.elevated_buried ?? 0,
    carve: effects.carve ?? rawSummary.carve ?? 0,
    mound: effects.mound ?? rawSummary.mound ?? 0,
    cutWide: effects.cut_too_wide ?? 0,
    cutSteep: effects.cut_too_steep ?? 0,
    adjacentCut: (effects.adjacent_cut_interference ?? 0)
      + (effects.adjacent_cut_override ?? 0),
    tallSupport: supportCount,
  };
}

// True iff either summary actually carries a mound count — i.e. causalReliefAxisCounts'
// `mound: effects.mound ?? rawSummary.mound ?? 0` resolved from real data, not its `?? 0`
// default. mound is UNIQUE among the axes above: it's also fed directly by
// terrain_faults.json on sites like Alishan (main.js's loadDiagnostics, before this
// causal/relief lane ever runs). When causal_diagnoses.json or relief_faults.json loads
// but neither carries mound evidence (e.g. the causal pipeline hasn't classified mound
// for this site, or a stale artifact predates mound classification), main.js must NOT
// let causalReliefAxisCounts' hard `0` clobber that terrain_faults-derived count with a
// false "definitely zero" — this predicate is how it tells the two cases apart.
export function causalMoundHasEvidence(rawSummary = {}, causalSummary = {}) {
  const effects = causalSummary?.by_effect || {};
  return effects.mound !== undefined || rawSummary.mound !== undefined;
}

export function causalArtifactAvailability({
  terrainFaultCount = 0,
  causalLoaded = false,
  reliefLoaded = false,
} = {}) {
  if (causalLoaded || reliefLoaded) return { available: true, message: null };
  if (terrainFaultCount > 0) {
    return {
      available: false,
      message: `Causal terrain diagnosis unavailable for ${terrainFaultCount} measured fault(s); regenerate diagnostics/causal_diagnoses.json.`,
    };
  }
  return { available: false, message: null };
}

export function isVisibleInObjectTree(object) {
  for (let node = object; node; node = node.parent) {
    if (node.visible === false) return false;
  }
  return true;
}

export function chooseVisibleCausalHit(
  hits,
  terrainHit,
  featureHit = null,
  { occlusionEpsilonM = 0.45 } = {},
) {
  const candidates = (hits || [])
    .filter((hit) => hit?.object?.userData?.kind === 'causal-diagnosis')
    .filter((hit) => isVisibleInObjectTree(hit.object))
    .sort((a, b) => Number(a.distance) - Number(b.distance));
  const occluderDistance = Math.min(
    Number.isFinite(terrainHit?.distance) ? Number(terrainHit.distance) : Infinity,
    Number.isFinite(featureHit?.distance) ? Number(featureHit.distance) : Infinity,
  );
  return candidates.find((hit) => (
    !Number.isFinite(occluderDistance)
    || Number(hit.distance) <= occluderDistance + occlusionEpsilonM
  )) || null;
}

export function chooseAxisAwareCausalHit(
  hits,
  terrainHit,
  featureHit = null,
  options = {},
) {
  const candidates = (hits || [])
    .filter((hit) => hit?.object?.userData?.kind === 'causal-diagnosis')
    .filter((hit) => isVisibleInObjectTree(hit.object))
    .sort((a, b) => Number(a.distance) - Number(b.distance));
  for (const hit of candidates) {
    const axis = hit.object?.userData?.diagnosis?.axis
      ?? hit.object?.userData?.marker?.axis;
    if (axis === 'tallSupport') return hit;
    if (chooseVisibleCausalHit([hit], terrainHit, featureHit, options)) return hit;
  }
  return null;
}
