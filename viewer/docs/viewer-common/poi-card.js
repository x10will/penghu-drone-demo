// Descriptive POI card helpers (sml-poi-descriptive-cards).
//
// buildings.glb is ONE merged mesh — no per-twin identity — so a building
// click resolves by PROXIMITY: nearest poi_descriptions.json entry to the
// raycast hit point, bounded by a tolerance. The descriptive card carries
// visitor-facing content (name, description, hours, wikidata) distilled from
// Pool A; the technical node card (z / lineage) stays on balls and balloons.
// PURE + injectable, node-testable: no DOM, no THREE, no fetch.

// descDoc: parsed poi_descriptions.json ({ pois: { id: { name, lat, lng, … } } }).
// geoToLocal: (lat, lng) → [x, y] in the viewer's local frame.
// Returns [{ id, x, y, entry }] for entries with finite coordinates.
export function buildPoiDescriptionIndex(descDoc, geoToLocal) {
  const out = [];
  for (const [id, entry] of Object.entries(descDoc?.pois || {})) {
    if (!entry || !Number.isFinite(entry.lat) || !Number.isFinite(entry.lng)) continue;
    const [x, y] = geoToLocal(entry.lat, entry.lng);
    out.push({ id, x, y, entry });
  }
  return out;
}

// Nearest index entry to (x, y) within maxDist meters, or null. Linear scan —
// the registry is ~100 entries, hit-path only.
export function resolvePoiAtXY(x, y, index, maxDist) {
  let best = null;
  let bestD2 = maxDist * maxDist;
  for (const e of index || []) {
    const d2 = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d2 <= bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}

// Inspector element for the descriptive card. Keys with no content are
// omitted so the panel renders no blank rows.
export function buildPoiDescriptionElement(id, entry) {
  if (!entry) return null;
  return {
    id,
    name: entry.name || id,
    name_en: entry.name_en || undefined,
    poi_type: entry.type || undefined,
    description: entry.description || undefined,
    opening_hours: entry.opening_hours || undefined,
    wikidata: entry.wikidata || undefined,
  };
}
