// Screen-space POI label stacking. Labels are screen-constant sprites anchored
// bottom-centre above their point; two anchors a few metres apart draw on top
// of each other (farm: 雅歌園民宿 and 六堆雅歌園有機教育農場 sit about 6 m apart).
// Each frame the viewer passes the visible labels' screen boxes here; labels are
// placed in priority order (lower rank first, then input order) and a label that
// overlaps an already placed one is lifted just above it, so both stay readable.
// Pure and deterministic: the same boxes always give the same lifts.
//
// items: [{ x, y, w, h, rank }] in CSS pixels, y down; (x, y) is the anchor, the
// bottom-centre of the unlifted label. Returns the lift in pixels per item, or
// null for a label that would climb more than maxLevels label heights: it takes
// no space, and the caller hides it rather than draw it far from its anchor.
export function stackLabelLifts(items, gapPx = 2, maxLevels = Infinity) {
  const order = items.map((item, index) => index).sort((a, b) =>
    (items[a].rank ?? 3) - (items[b].rank ?? 3) || a - b);
  const placed = [];
  const lifts = new Array(items.length).fill(0);
  for (const index of order) {
    const { x, y, w, h } = items[index];
    const left = x - w / 2, right = x + w / 2;
    let bottom = y;
    // Each pass either settles or moves the label strictly above one placed
    // box, so it ends within placed.length + 1 passes.
    for (let pass = 0; pass <= placed.length; pass++) {
      const hit = placed.find(box => left < box.right && right > box.left
        && bottom - h < box.bottom && bottom > box.top);
      if (!hit) break;
      bottom = hit.top - gapPx;
    }
    if (y - bottom > maxLevels * (h + gapPx)) { lifts[index] = null; continue; }
    lifts[index] = y - bottom;
    placed.push({ left, right, top: bottom - h, bottom });
  }
  return lifts;
}
