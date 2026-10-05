// viewer-schematic-diagnosis-layer — build the authored-graph "diagnosis" layer
// for the PRODUCTION viewer: one readable Line2 fat-line per T2 edge, drawn from
// edges.json polyline_3d at AUTHORED Z (verbatim — no clamp/offset/lift, per
// [[no-polish-on-top-of-bad-z]]). Reproduces the data→line mapping of
// base.js:loadSurfaces(), but emits Line2 (readable, screen-space width,
// pickable) instead of base.html's thin THREE.Line, and lives in main.js's scene
// so it inherits the production 0x4a6a8a background.
//
// Pure builder: caller supplies the already-loaded edges (DIAG.edges), the
// viewer's geoToLocal, a per-edge color policy (fault-or-mode), and the canvas
// resolution. Node "balls" are NOT built here — main.js reuses its existing
// sim-node layer for those (D2).

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * @param {object}   opts
 * @param {Array}    opts.edges        DIAG.edges (each { id, polyline_3d:[[lat,lng,z],…], mode, … }).
 * @param {function} opts.geoToLocal   (lat,lng) → [x,y] ENU, the viewer's projector.
 * @param {function} opts.colorForEdge (edge) → hex int. Fault color or mode color; policy owned by caller.
 * @param {number}   opts.fallbackZ    Z to use when a vertex z is non-finite (cameraTargetZ).
 * @param {number}   [opts.linewidth]  screen-space line width in px (default 2.5).
 * @param {{x:number,y:number}} opts.resolution  canvas pixel size for LineMaterial.
 * @returns {THREE.Group} group named 'schematic-diagnosis'; group.userData.lineMaterials
 *          is the array of LineMaterials (so main.js can keep .resolution synced on resize).
 */
export function buildSchematicLayer({ edges, geoToLocal, colorForEdge, modeField, fallbackZ, linewidth = 2.5, resolution }) {
  const group = new THREE.Group();
  group.name = 'schematic-diagnosis';
  const materials = [];
  const res = resolution || { x: 1, y: 1 };

  for (const e of edges) {
    const pl = e.polyline_3d;
    if (!Array.isArray(pl) || pl.length < 2) continue;

    const positions = [];
    for (const [lat, lng, z] of pl) {
      const [x, y] = geoToLocal(lat, lng);
      const zz = Number.isFinite(Number(z)) ? Number(z) : fallbackZ;   // authored Z verbatim
      positions.push(x, y, zz);
    }

    const geo = new LineGeometry();
    geo.setPositions(positions);

    const mat = new LineMaterial({
      color: colorForEdge(e),
      linewidth,                 // screen-space px (worldUnits:false)
      worldUnits: false,
      dashed: false,
      alphaToCoverage: false,
      toneMapped: false,         // diagnosis colors render the exact registry hex
    });
    mat.resolution.set(res.x, res.y);   // REQUIRED for Line2 render + raycast
    materials.push(mat);

    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.name = `schematic:${e.id}`;
    // userData mirrors the surface-edge convention so the existing picking →
    // routeHitToInspector dispatch applies unchanged.
    line.userData = {
      dt_edge_id: e.id,
      dt_type: 'schematic_edge',
      edge_id: e.id,
      name: e.name,                       // OSM way name (when known) for the inspector
      from_node: e.from_node,
      to_node: e.to_node,
      mode: e.mode,                       // diagnostics vocab (driving/walking/mixed)
      mode_display: modeField ? e[modeField] : undefined,  // site display-mode (field named in site-config.schematicModeField)
      highway: e.highway,
      distance_m: e.distance_m,
      osm_way_id: e.lineage?.osm_way_id ?? e.osm_way_id,
      lineage: e.lineage,
      bridge: !!e.bridge,
      z_source: e.z_source || 'dem',
      kind: 'edge',
      authority_tier: 'T2_facility',
    };
    group.add(line);
  }

  group.userData.lineMaterials = materials;
  return group;
}
