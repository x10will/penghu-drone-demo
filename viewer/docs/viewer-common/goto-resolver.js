// Engine-neutral go-to-twin query resolution (viewer-engine-policy: shared logic
// lives under viewer-common/). Pure string→id policy — NO Three.js, DOM, camera,
// or fetch. Each viewer shell builds its own ordered `indexes` from whatever it
// has loaded (production: typed runtime + frame node_metadata; base: T2 sim nodes
// + surfaces) and performs its own camera move on the returned id.
//
// Policy: an exact id match (case-insensitive) ALWAYS beats a name-substring
// match, regardless of index order. Among exact-id matches, earlier indexes win.
// Among name matches (only when no exact id matched anywhere), earlier indexes /
// earlier entries win. This mirrors the original Cesium handler: you can type a
// twin id OR a place name, and a precise id is never shadowed by a fuzzy name.
//
// indexes: Array<{ name?: string, entries: Iterable<{ id: string, name?: string }> }>
// returns: { found: true, id, indexName, matched: 'id'|'name', query }
//        | { found: false, query }
// All-matches variant (viewer-goto-dropdown): same id-beats-name policy, but
// instead of returning the single winner it reports the first exact-id match
// (or null) AND every name-substring hit in index-then-entry order. Grouping
// by name is a UI concern — viewer shells group; this stays pure string policy.
//
// returns: { query, exactId: string|null, matches: [{ id, name, indexName }] }
export function resolveTwinQueryAll(rawQuery, indexes) {
  const q = (rawQuery || '').trim();
  if (!q) return { query: q, exactId: null, matches: [] };
  const ql = q.toLowerCase();
  let exactId = null;
  const matches = [];
  for (const index of indexes || []) {
    for (const entry of index?.entries || []) {
      if (!entry || !entry.id) continue;
      if (exactId === null && entry.id.toLowerCase() === ql) exactId = entry.id;
      if (entry.name && entry.name.toLowerCase().includes(ql)) {
        matches.push({ id: entry.id, name: entry.name, indexName: index.name || null });
      }
    }
  }
  return { query: q, exactId, matches };
}

export function resolveTwinQuery(rawQuery, indexes) {
  const q = (rawQuery || '').trim();
  if (!q) return { found: false, query: q };
  const ql = q.toLowerCase();

  let nameHit = null;
  for (const index of indexes || []) {
    for (const entry of index?.entries || []) {
      if (!entry || !entry.id) continue;
      if (entry.id.toLowerCase() === ql) {
        return { found: true, id: entry.id, indexName: index.name || null, matched: 'id', query: q };
      }
      if (!nameHit && entry.name && entry.name.toLowerCase().includes(ql)) {
        nameHit = { found: true, id: entry.id, indexName: index.name || null, matched: 'name', query: q };
      }
    }
  }
  return nameHit || { found: false, query: q };
}

// Reverse of the search direction: build an id -> name map from the SAME index
// shape (viewer-click-names). First non-empty name for an id wins; entries with
// no/empty name are skipped (so the inspector omits the name row rather than
// showing a placeholder). Used by the inspector and the click tooltip.
// indexes: Array<{ name?: string, entries: Iterable<{ id: string, name?: string }> }>
// returns: Map<string, string>
export function buildNameById(indexes) {
  const byId = new Map();
  for (const index of indexes || []) {
    for (const entry of index?.entries || []) {
      if (!entry || !entry.id || !entry.name) continue;
      if (!byId.has(entry.id)) byId.set(entry.id, entry.name);
    }
  }
  return byId;
}
