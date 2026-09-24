const text = value => typeof value === 'string' && value.length ? value : null;
const firstText = (...values) => values.find(value => text(value)) || null;
export const PICK_FAILED = Symbol('embed-pick-failed');

// This is called directly from the shared pick hook: errors must stay here.
export function normalizePick(hit, { dt, runtime, site, localToGeo } = {}) {
  try {
    if (!hit?.object) return null;
    let ud = null;
    for (let object = hit.object; object; object = object.parent) {
      if (object === dt?.layers?.terrain || object.userData?.semanticType === 'TerrainPatch') return null;
      const data = object.userData || {};
      if (!ud && [data.context_id, data.propId, data.typedSetId, data.twin_id,
        data.twinId, data.dt_edge_id, data.id].some(text)) ud = data;
    }
    if (!ud) return null;
    const id = firstText(ud.context_id, ud.propId, ud.typedSetId, ud.twin_id, ud.twinId, ud.dt_edge_id, ud.id);
    const record = dt?.contextRegistry?.get(id)?.inspection
      || dt?.authoredPropRegistry?.get(id)?.record
      || runtime?.getElement?.(id) || dt?.diagnostics?.intersectionsById?.get?.(id) || {};
    if (record.semantic_type === 'TerrainPatch') return null;
    const label = firstText(record.label, record.name, record.name_en, ud.name, ud.name_en, dt?.nameForTwin?.(id));
    const kind = firstText(record.semantic_type, record.origin_kind, ud.origin_kind,
      ud.semanticType, ud.kind, ud.type, record.twin_type) || 'feature';
    let lon = record.lon ?? record.lng ?? ud.lon ?? ud.lng;
    let lat = record.lat ?? ud.lat;
    let positionSource = 'source';
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      if (!Number.isFinite(hit.point?.x) || !Number.isFinite(hit.point?.y)) return null;
      ({ lon, lat } = localToGeo(hit.point.x, hit.point.y));
      positionSource = 'rendered-hit';
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    const properties = { site, positionSource };
    const authority = firstText(record.authority_scope, ud.authority_scope);
    if (authority) properties.authorityScope = authority;
    const origin = firstText(record.origin_kind, ud.origin_kind);
    if (origin) properties.originKind = origin;
    if (!label) properties.labelSource = 'id';
    return { id, name: label || id, kind, lon, lat, properties };
  } catch (error) {
    console.error('Embed pick normalization failed', error);
    return PICK_FAILED;
  }
}

export function toEntity(pick) {
  return pick ? { id: pick.id, label: pick.name, type: pick.kind,
    properties: { ...pick.properties, lon: pick.lon, lat: pick.lat } } : null;
}
