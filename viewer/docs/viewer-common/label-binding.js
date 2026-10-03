// Label → twin binding and twin inspection composition (twin-inspection-contract).
// A label is a rendering of a twin's state, so its declared id is a twin
// reference. Pure and engine-neutral; the viewer supplies its registries as
// lookups. No site field is read.

/**
 * The views a twin inspection can be composed from. Keep equal to the closed
 * set `validateRegistry` accepts for `inspector.views` (site-config.js).
 */
export const INSPECTOR_VIEWS = Object.freeze(['descriptive', 'node', 'typed', 'sources']);

/** Label clicks without `inspector.views`: descriptive, node and typed records lead; sources is the final fallback. */
export const DEFAULT_LABEL_VIEWS = INSPECTOR_VIEWS;

/**
 * Resolve a label's declared id to the twin key its node and typed views read.
 * Rules, in order: the id is a twin; the frames node index maps the id (a Pool
 * A twin_id) to a node that is a twin; the id has an indexed sources view.
 * Returns null otherwise.
 */
export function resolveLabelTwin(id, { hasTwin, twinToSimNode = null, hasSources = null } = {}) {
  if (typeof id !== 'string' || id === '') return null;
  if (hasTwin?.(id)) return id;
  const node = twinToSimNode?.get?.(id);
  if (typeof node === 'string' && hasTwin?.(node)) return node;
  if (hasSources?.(id)) return id;
  return null;
}

/**
 * Compose a twin inspection: the views in `order` whose record exists, in that
 * order. `recordOf(view)` returns the view's runtime record or null.
 * @returns {{view: string, record: any}[]}
 */
export function composeTwinViews(order, recordOf) {
  const out = [];
  for (const view of order) {
    const record = recordOf(view);
    if (record != null) out.push({ view, record });
  }
  return out;
}

/** Count bound and unbound labels; unboundIds keeps each unbound label's id (or null). */
export function summarizeLabelBindings(labels, resolve, idOf = (label) => label) {
  const unboundIds = [];
  let total = 0;
  for (const label of labels) {
    total++;
    if (!resolve(label)) unboundIds.push(idOf(label) ?? null);
  }
  return { total, bound: total - unboundIds.length, unbound: unboundIds.length, unboundIds };
}
