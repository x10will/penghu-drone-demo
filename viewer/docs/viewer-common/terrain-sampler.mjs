// Irregular-mesh terrain height sampler (#11, sml-terrain-corridor-densify-bench
// follow-on). The original viewer sampler assumed a REGULAR ROW-MAJOR GRID and
// indexed positions[(iy*nx+ix)] directly — which reads garbage on a densified
// (irregular Delaunay) terrain and breaks building clamp + camera floor.
//
// This samples ANY triangle mesh: a uniform 2D spatial bucket over triangle XY
// bboxes gives O(1) point location, then barycentric interpolation gives Z.
// Works for the regular grid (today) AND the densified mesh (later). Pure JS —
// no THREE, no DOM — so it is unit-testable in Node and loadable in the browser.

const INSIDE_EPS = 1e-6;

/**
 * @param {ArrayLike<number>} positions flat [x,y,z, x,y,z, ...] vertex array
 * @param {ArrayLike<number>} indices   flat [i0,i1,i2, ...] triangle vertex indices
 * @returns {(x:number,y:number)=>number} sampler returning terrain Z at (x,y), NaN outside the hull
 */
export function buildTerrainSampler(positions, indices) {
  const nTri = (indices.length / 3) | 0;

  // XY bounds over all vertices.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  // Uniform bucket grid sized for ~1 triangle per cell (sqrt(area / nTri)).
  const w = Math.max(xMax - xMin, 1e-9);
  const h = Math.max(yMax - yMin, 1e-9);
  const cell = Math.max(Math.sqrt((w * h) / Math.max(nTri, 1)), 1e-6);
  // Cap the grid so a degenerate/sparse mesh can't allocate a huge table.
  const nx = Math.min(Math.max(Math.ceil(w / cell), 1), 4096);
  const ny = Math.min(Math.max(Math.ceil(h / cell), 1), 4096);
  const dx = w / nx;
  const dy = h / ny;

  const buckets = new Array(nx * ny);
  const cx = (x) => Math.min(nx - 1, Math.max(0, Math.floor((x - xMin) / dx)));
  const cy = (y) => Math.min(ny - 1, Math.max(0, Math.floor((y - yMin) / dy)));

  for (let t = 0; t < nTri; t++) {
    const ia = indices[t * 3] * 3, ib = indices[t * 3 + 1] * 3, ic = indices[t * 3 + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1];
    const bx = positions[ib], by = positions[ib + 1];
    const cxx = positions[ic], cyy = positions[ic + 1];
    const ix0 = cx(Math.min(ax, bx, cxx)), ix1 = cx(Math.max(ax, bx, cxx));
    const iy0 = cy(Math.min(ay, by, cyy)), iy1 = cy(Math.max(ay, by, cyy));
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = iy * nx + ix;
        (buckets[k] || (buckets[k] = [])).push(t);
      }
    }
  }

  return function sampleTerrain(x, y) {
    // Strictly outside the AABB -> outside the hull.
    if (x < xMin - dx || x > xMax + dx || y < yMin - dy || y > yMax + dy) return NaN;
    const bucket = buckets[cy(y) * nx + cx(x)];
    if (!bucket) return NaN;
    for (let b = 0; b < bucket.length; b++) {
      const t = bucket[b];
      const ia = indices[t * 3] * 3, ib = indices[t * 3 + 1] * 3, ic = indices[t * 3 + 2] * 3;
      const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
      const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
      const cxx = positions[ic], cyy = positions[ic + 1], cz = positions[ic + 2];
      // Barycentric weights of (x,y) in triangle a,b,c (XY only).
      const det = (by - cyy) * (ax - cxx) + (cxx - bx) * (ay - cyy);
      if (Math.abs(det) < 1e-12) continue; // degenerate triangle
      const wa = ((by - cyy) * (x - cxx) + (cxx - bx) * (y - cyy)) / det;
      const wb = ((cyy - ay) * (x - cxx) + (ax - cxx) * (y - cyy)) / det;
      const wc = 1 - wa - wb;
      if (wa >= -INSIDE_EPS && wb >= -INSIDE_EPS && wc >= -INSIDE_EPS) {
        return wa * az + wb * bz + wc * cz;
      }
    }
    return NaN;
  };
}
