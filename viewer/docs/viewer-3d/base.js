// sml-base-travel-surface-viewer — Three.js base diagnostic stage.
//
// Per sml-t2-facility-graph: this is a diagnostic base scene that
// renders T1 semantic anchors plus T2 facility-graph edges
// synthesized from validated topology + multi-source evidence.
//
// Renders ONLY:
//
//   • base terrain (data/sml/meshes/terrain.glb — coarse base)
//   • lake surface (data/sml/meshes/lake.glb)
//   • T1 nodes (data/sml/base/nodes.json) — semantic authority
//   • T2 edges (data/sml/t2/edges/edges.json) — synthesized facility
//     graph from sml-t2-facility-graph (multi-input fusion of T1 +
//     OSM + KMZ + GPX + DEM, geometry owned by the synthesizer)
//
// Does NOT load scenario YAML, route director output, cyclist frames,
// or legacy scene-dressing GLBs (buildings, lake, edges, nodes.glb,
// scene_dressing).
//
// Controls match three-viewer-controls (R1 WASD, R2 Ctrl-modal rotate,
// R6 drag-the-world pan) for parity with the main scenario viewer.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSiteGLTFLoader } from '../viewer-common/site-gltf-loader.mjs';
import { fetchSiteAsset as fetch } from '../viewer-common/fetch-site-asset.mjs';
import {
  showSurfaceInspector, showNodeInspector, hideInspector,
  attachInspectorClose,
} from './inspector-base.js';
import { installControls } from './controls-base.js';
import { resolveTwinQuery } from '../viewer-common/goto-resolver.js';
import { CAMERA_MAX_DISTANCE as DEFAULT_CAMERA_MAX_DISTANCE } from '../viewer-common/nav-sensitivity.mjs';
// Engine-neutral Z-fault verdict logic — single source of truth shared with
// the production viewer (main.js). This module was extracted verbatim FROM the
// copies that used to live inline here; consume it instead of re-declaring.
import {
  computeCliffNodes,
  submergedInBasinPoint,
  steepSlopeMarker,
  overlapEdges,
} from '../viewer-common/diagnostics.js';
import {
  resolveDeclaredLayerRequests,
  validateContextManifest,
  resolveContextManifestUrl,
  contextInspectionRecord,
  setDeclaredLayerVisible,
  CONTEXT_AUTHORITY_SCOPE,
} from '../viewer-common/site-layer-consumer.js';

// Window-level test contract (showInspectors / camera / sampler / ...)
// is consolidated at the bottom of this file. Search for "Test contract".

// ── Pipeline attribution (registry + inline manifests) ─────────
// Per artifact-provenance-manifests openspec change: viewers MUST NOT
// hardcode pipeline maps. Attribution comes from the artifact's own
// `generated_by` block when present, else from data/sml/pipeline_registry.json.
//
// Water-plane is the one exception — it's genuinely procedural and
// declared inline below.
const PIPELINE_REGISTRY_URL = window.DT_assetUrl('pipeline_registry.json');
let _registry = { entries: [] };

function _globToRegex(glob) {
  // Minimal fnmatch-equivalent for the patterns we use.
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '.';
    else if ('.+^$(){}|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp(re + '$');
}

function pipelineForArtifact(siteRelPath) {
  for (const entry of (_registry.entries || [])) {
    if (_globToRegex(entry.path_pattern).test(siteRelPath)) {
      return entry.pipeline;
    }
  }
  return null;
}

async function loadPipelineRegistry() {
  try {
    const resp = await fetch(PIPELINE_REGISTRY_URL);
    if (resp.ok) _registry = await resp.json();
    else console.warn(`pipeline_registry.json fetch failed: ${resp.status}`);
  } catch (err) {
    console.warn('pipeline_registry.json fetch threw:', err.message);
  }
}

// ── Public test handle ─────────────────────────────────────────
const handle = {
  ready: false,
  terrain: null,
  lakeGroup: null,
  lakeMeshes: [],
  nodes: [],                // Array<THREE.Mesh>  (T1 semantic nodes)
  nodesGroup: null,         // THREE.Group parent of `nodes`
  simNodes: [],             // Array<THREE.Mesh>  (T2 sim nodes)
  simNodesGroup: null,      // THREE.Group parent of `simNodes`
  simNodeCount: 0,
  // Two surface layers from the same T2 edges artifact:
  //   surfaces / surfacesGroup       — real Z from polyline_3d (authored)
  //   surfacesClamped / surfacesGroupClamped — diagnostic overlay clamped
  //                                            to terrain + clearance
  // Both share userData. Picking targets the real layer.
  surfaces: [],             // Array<THREE.Line>  (real Z — authored)
  surfacesGroup: null,
  manifestSurfaceCount: 0,
  countsByClass: {},
  baseNodeCount: 0,
  inventory: null,
  // Context records stay in their own inspection map and never enter a twin
  // or topology index. Terrain aliases point at this already-loaded root.
  contextRegistry: new Map(),
  contextLayerRoots: {},
  contextLabels: [],
  setContextLayerVisible: (request, visible) =>
    setDeclaredLayerVisible(handle.contextLayerRoots, request, visible),
};
// (handle export consolidated with rest of test contract at end of file)

// ── Coordinate system ──────────────────────────────────────────
const CENTER_LAT = window.DT_SITE.center.lat;
const CENTER_LNG = window.DT_SITE.center.lng;
const M_PER_DEG_LAT = 111320.0;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(CENTER_LAT * Math.PI / 180);

function geoToLocal(lat, lng) {
  return [
    (lng - CENTER_LNG) * M_PER_DEG_LNG,
    (lat - CENTER_LAT) * M_PER_DEG_LAT,
  ];
}

// ── Loading UI ─────────────────────────────────────────────────
const loadingFill = document.getElementById('loading-fill');
const loadingStatus = document.getElementById('loading-status');
const loadingOverlay = document.getElementById('loading');
const TOTAL_STEPS = 3;

function setLoading(msg, step) {
  loadingStatus.textContent = msg;
  loadingFill.style.width = `${(step / TOTAL_STEPS) * 100}%`;
}
function hideLoading() {
  loadingOverlay.classList.add('done');
}

// ── Scene ──────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Sky-grey clear color so areas beyond terrain.glb read as sky, not
// as more lake. Water plane is the only blue surface.
// base is the diagnostic scene: deliberately un-graded — renderStyle/DT_STYLE
// (site-config RENDER_STYLES) applies to the production shell (main.js) only.
renderer.setClearColor(0xc8d2dc);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const CAMERA_MAX_DISTANCE = window.DT_SITE.cameraMaxDistance ?? DEFAULT_CAMERA_MAX_DISTANCE;
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 10, window.DT_SITE.cameraFar ?? 50000);
camera.position.set(...(window.DT_SITE.cameraPosition ?? [0, -4000, 3500]));
camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, window.DT_SITE.cameraTargetZ);  // site lake level + small margin
controls.maxDistance = CAMERA_MAX_DISTANCE;
// minDistance 50 → 10 (parity with main.js): the distance-to-floor zoom law
// installed by controls-base.js shrinks the step near the ground.
controls.minDistance = 10;
controls.maxPolarAngle = Math.PI * 0.48;
controls.zoomToCursor = true;
// three-viewer-controls R2: Ctrl-modal rotate. Default left-drag is owned
// by the drag-the-world handler below (R6).
controls.mouseButtons.LEFT = -1;

// Neutral lighting — anything tinted (blue ambient, blue hemisphere
// sky) bleeds into terrain.glb's actual vertex colors. We let the
// mesh's own vertex colors define hue; lights only define brightness.
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2000, 3000, 5000);
scene.add(dirLight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Terrain sampler (for WASD speed scaling + click pivot) ─────
let terrainSampler = null;

function buildTerrainSamplerFromMesh(mesh) {
  const positions = mesh.geometry.attributes.position.array;
  const n = positions.length / 3;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1];
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  const y0 = positions[1];
  let nx = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 1] - y0) < 0.1) nx++;
    else break;
  }
  if (nx < 2) return null;   // non-grid terrain — skip sampler
  const ny = Math.round(n / nx);
  const dx = (xMax - xMin) / (nx - 1);
  const dy = (yMax - yMin) / (ny - 1);
  return function sample(x, y) {
    const fx = (x - xMin) / dx;
    const fy = (y - yMin) / dy;
    const ix = Math.floor(Math.max(0, Math.min(fx, nx - 2)));
    const iy = Math.floor(Math.max(0, Math.min(fy, ny - 2)));
    const tx = Math.max(0, Math.min(fx - ix, 1));
    const ty = Math.max(0, Math.min(fy - iy, 1));
    const z00 = positions[(iy * nx + ix) * 3 + 2];
    const z10 = positions[(iy * nx + ix + 1) * 3 + 2];
    const z01 = positions[((iy + 1) * nx + ix) * 3 + 2];
    const z11 = positions[((iy + 1) * nx + ix + 1) * 3 + 2];
    return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) +
           z01 * (1 - tx) * ty + z11 * tx * ty;
  };
}

// ── Lake surface ───────────────────────────────────────────────
// data/sml/meshes/lake.glb is the actual lake polygon — generated by
// scripts/mesh_gen/lake_mesh.py per pipeline_registry.json. Loading
// the real geometry instead of a rectangular procedural plane so the
// water matches the actual SML shoreline.
const LAKE_Z_WGS84 = window.DT_SITE.lakeZ;   // orthometric (TWVD2001) — geoid lift dropped 2026-05-25

async function loadLake() {
  setLoading('Loading lake surface...', 2);
  const url = window.DT_assetUrl('meshes/lake.glb');
  const loader = await createSiteGLTFLoader(window.DT_SITE);
  return new Promise((resolve, reject) => {
    loader.load(url,
      (gltf) => {
        const meshes = [];
        gltf.scene.traverse(child => {
          if (child.isMesh) meshes.push(child);
        });
        if (!meshes.length) { reject(new Error('lake.glb empty')); return; }
        // Take all lake meshes — the GLB may split into the main lake
        // plus carved-out subregions. Apply a uniform water material.
        // Opaque + unlit — semi-transparent let terrain.glb's underwater
        // bathymetry (z down to ~450m) show through, producing a fake
        // "submerged mountain" silhouette in side views. MeshBasicMaterial
        // (no lighting) because lake.glb has no vertex normals; Lambert
        // would render the lake as solid black.
        const mat = new THREE.MeshBasicMaterial({
          color: 0x2266aa,
          side: THREE.DoubleSide,
        });
        const group = new THREE.Group();
        group.name = 'lake';
        const pipeline = pipelineForArtifact('meshes/lake.glb');
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          m.material = mat;
          m.name = `lake:${i}`;
          m.userData = {
            kind: 'lake',
            source_url: url,
            pipeline,
            elevation_m: LAKE_Z_WGS84,
            sub_mesh_index: i,
          };
          group.add(m);
        }
        scene.add(group);
        handle.lakeGroup = group;
        handle.lakeMeshes = meshes;
        resolve();
      },
      undefined,
      (err) => reject(new Error(`lake.glb load failed: ${err && err.message || err}`)),
    );
  });
}

// ── Base terrain ───────────────────────────────────────────────
async function loadTerrain() {
  setLoading('Loading base terrain...', 1);
  const loader = await createSiteGLTFLoader(window.DT_SITE);
  return new Promise((resolve, reject) => {
    loader.load(window.DT_assetUrl('meshes/terrain.glb'),
      (gltf) => {
        const meshes = [];
        gltf.scene.traverse(child => {
          if (child.isMesh) meshes.push(child);
        });
        let terrainMesh = null;
        let bestCount = -1;
        for (const m of meshes) {
          const hasColor = !!m.geometry.attributes.color;
          const count = m.geometry.attributes.position?.count || 0;
          if (hasColor && count > bestCount) { bestCount = count; terrainMesh = m; }
        }
        if (!terrainMesh) {
          for (const m of meshes) {
            const count = m.geometry.attributes.position?.count || 0;
            if (count > bestCount) { bestCount = count; terrainMesh = m; }
          }
        }
        if (!terrainMesh) { reject(new Error('terrain.glb empty')); return; }
        if (!terrainMesh.geometry.attributes.normal) {
          terrainMesh.geometry.computeVertexNormals();
        }
        const hasColor = !!terrainMesh.geometry.attributes.color;
        terrainMesh.material = new THREE.MeshLambertMaterial({
          vertexColors: hasColor,
          color: hasColor ? 0xffffff : 0x6e7a5a,
          side: THREE.DoubleSide,
          // At-grade paths sit at ground level, so the S6 fit seats terrain on
          // the deck Z (scene-wide median gap ~0.00 m): the road ribbon and the
          // terrain are coplanar and z-fight along ~90% of edges. This is a
          // depth-test tie, not a data fault — terrain = deck = ground is the
          // honest value. polygonOffset pushes terrain fragments a hair back in
          // the DEPTH BUFFER ONLY so coplanar overlays (roads, walkways) win;
          // no vertex / Z moves, no data masked (≠ the removed
          // SURFACE_TERRAIN_CLEARANCE_M lift). units bumped 1->4: units:1 lost
          // the tie on near-flat coplanar shelves at distance (camera-dependent
          // flicker). Still flickering? escalate, or fall back to a small
          // world-Z lift on the edges (user-sanctioned).
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 4,
        });
        terrainMesh.name = 'terrain';
        terrainMesh.userData = {
          kind: 'terrain',
          source_url: window.DT_assetUrl('meshes/terrain.glb'),
          pipeline: pipelineForArtifact('meshes/terrain.glb'),
        };
        scene.add(terrainMesh);
        handle.terrain = terrainMesh;
        handle.contextLayerRoots.terrain = terrainMesh;
        terrainSampler = buildTerrainSamplerFromMesh(terrainMesh);
        resolve();
      },
      undefined,
      (err) => reject(new Error(`Terrain load failed: ${err && err.message || err}`)),
    );
  });
}

function siteHasDeclaredContextRoles() {
  const roles = window.DT_SITE && window.DT_SITE.contextLayerRoles;
  if (Array.isArray(roles)) return roles.length > 0;
  if (!roles || typeof roles !== 'object') return !!roles;
  return Object.values(roles).some((declaration) => {
    if (declaration === false) return false;
    return !(declaration && typeof declaration === 'object' && declaration.enabled === false);
  });
}

function registerContextRecord(request, root) {
  root.userData = {
    ...root.userData,
    authority_scope: CONTEXT_AUTHORITY_SCOPE,
    context_role: request.role,
    context_id: request.stable_id,
    source_ref: request.source_ref,
    notice_ref: request.notice_ref,
  };
  handle.contextRegistry.set(request.stable_id, {
    request,
    inspection: contextInspectionRecord(request),
    root,
  });
}

async function loadContextGLB(request) {
  const loader = await createSiteGLTFLoader(window.DT_SITE);
  return new Promise((resolve, reject) => {
    loader.load(
      request.url,
      (gltf) => {
        const root = gltf.scene;
        root.name = request.root;
        root.visible = request.visible;
        root.traverse((child) => {
          if (!child.isMesh) return;
          child.userData = {
            ...child.userData,
            authority_scope: CONTEXT_AUTHORITY_SCOPE,
            context_role: request.role,
            context_id: request.stable_id,
            source_ref: request.source_ref,
            notice_ref: request.notice_ref,
          };
        });
        scene.add(root);
        handle.contextLayerRoots[request.root] = root;
        registerContextRecord(request, root);
        resolve(root);
      },
      undefined,
      (err) => reject(new Error(`context role ${request.role} load failed: ${err?.message || err}`)),
    );
  });
}

// Manifest-declared supported labels use the production viewer's established
// canvas-sprite presentation. Keep this renderer local to the base surface so
// the existing SML/main.js label path and request graph remain untouched.
const CONTEXT_LABEL_SCREEN_H = window.DT_SITE.poiLabelScreenH || 0.026;

function makeContextLabelSprite(label) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const FONT = 30, PAD = 12, DOT = 8, GAP = 7;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `600 ${FONT}px "Microsoft JhengHei","Noto Sans TC",sans-serif`;
  ctx.font = font;
  const text = label.name || label.id;
  const textWidth = Math.ceil(ctx.measureText(text).width);
  const width = PAD + DOT * 2 + GAP + textWidth + PAD;
  const height = FONT + PAD;
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  const centerY = height / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, width - 1, height - 1, height / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = label.type === 'station' ? '#4285f4' : label.type === 'tree' ? '#2e7d32' : '#e8710a';
  ctx.beginPath();
  ctx.arc(PAD + DOT, centerY, DOT, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.fillText(text, PAD + DOT * 2 + GAP, centerY);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  }));
  sprite.scale.set(CONTEXT_LABEL_SCREEN_H * (width / height), CONTEXT_LABEL_SCREEN_H, 1);
  sprite.center.set(0.5, 0);
  sprite.position.set(label.x, label.y, label.z + 30);
  sprite.renderOrder = 2000;
  return sprite;
}

function addContextLabelToggle(request) {
  const toggles = document.getElementById('layer-toggles');
  if (!toggles) return;
  const label = document.createElement('label');
  label.id = `toggle-${request.role}-label`;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `toggle-${request.role}`;
  checkbox.dataset.layer = request.root;
  checkbox.checked = request.visible;
  label.append(checkbox, document.createTextNode(' labels'));
  toggles.appendChild(label);
}

function renderContextLabels(request, records) {
  if (!Array.isArray(records)) {
    throw new Error(`context label artifact is not an array at ${request.url}`);
  }
  const group = new THREE.Group();
  group.name = request.root;
  group.visible = request.visible;
  for (const record of records) {
    if (!record || !Number.isFinite(record.x) || !Number.isFinite(record.y) || !Number.isFinite(record.z)) {
      continue;
    }
    const sprite = makeContextLabelSprite(record);
    sprite.userData = {
      rank: record.rank || 3,
      label_id: record.id,
      label_name: record.name || record.id,
      authority_scope: CONTEXT_AUTHORITY_SCOPE,
      context_role: request.role,
      context_id: request.stable_id,
      source_ref: request.source_ref,
      notice_ref: request.notice_ref,
    };
    group.add(sprite);
  }
  // An empty (or wholly invalid) declared record set is absence: it must not
  // manufacture an invisible scene root or a dead HUD control.
  if (group.children.length === 0) return null;
  group.userData = {
    authority_scope: CONTEXT_AUTHORITY_SCOPE,
    context_role: request.role,
    context_id: request.stable_id,
    source_ref: request.source_ref,
    notice_ref: request.notice_ref,
  };
  scene.add(group);
  handle.contextLayerRoots[request.root] = group;
  registerContextRecord(request, group);
  addContextLabelToggle(request);
  return group;
}

async function loadDeclaredContextLayers() {
  if (!siteHasDeclaredContextRoles()) return [];
  const manifestPath = window.DT_SITE.contextLayerManifest;
  if (typeof manifestPath !== 'string' || manifestPath.trim() === '') {
    throw new Error('site-layer consumer: declared context roles require contextLayerManifest');
  }
  const response = await fetch(resolveContextManifestUrl(window.DT_SITE));
  if (!response.ok) {
    throw new Error(`site-layer consumer: context manifest unavailable at ${manifestPath}`);
  }
  const manifest = await response.json();
  const validation = validateContextManifest(window.DT_SITE, manifest);
  for (const warning of validation.warnings) console.warn(warning.message);
  const requests = resolveDeclaredLayerRequests(window.DT_SITE, manifest, validation);
  for (const request of requests) {
    if (request.alias_of) {
      const root = handle.contextLayerRoots[request.alias_of];
      if (!root) {
        throw new Error(`site-layer consumer: alias target '${request.alias_of}' is not loaded`);
      }
      registerContextRecord(request, root);
      continue;
    }
    if (request.kind === 'json' || request.kind === 'labels') {
      const labelResponse = await fetch(request.url);
      if (!labelResponse.ok) {
        throw new Error(`context label artifact unavailable at ${request.url}`);
      }
      const records = await labelResponse.json();
      handle.contextLabels.push({
        request,
        records,
        root: renderContextLabels(request, records),
      });
      continue;
    }
    await loadContextGLB(request);
  }
  return requests;
}

// ── Base nodes (Stage 1) ───────────────────────────────────────
// Colors keyed by the ACTUAL node.type values present in
// data/sml/base/nodes.json. Verified with:
//   python -c "import json,collections; print(collections.Counter(n['type']
//       for n in json.load(open('data/sml/base/nodes.json',
//       encoding='utf-8'))['nodes']))"
// Counter({'facility': 37, 'station': 26, 'poi': 13, 'trail-node': 11,
//          'commerce': 7, 'accommodation': 6, 'landmark': 2, 'food-street': 2})
const NODE_COLOR_BY_TYPE = {
  accommodation: 0xff7755,    // orange
  commerce:      0xffbb33,    // amber
  'food-street': 0xffdd55,    // yellow
  station:       0x44ccff,    // sky blue (transport)
  poi:           0xcc99ff,    // lavender
  landmark:      0xa088ff,    // purple
  facility:      0x88dd88,    // sage green
  'trail-node':  0x99cc66,    // moss
  default:       0xeeeeee,    // neutral fallback — should never appear
};
// T1 node markers — sized to be visible against terrain without
// dominating it. Previously 20m (huge); 5m reads as a building-scale
// marker.
const NODE_SPHERE_GEO = new THREE.SphereGeometry(5, 12, 8);

// T2 sim nodes are structural (intersection / terminus / waypoint /
// entrance) and should not visually compete with semantic T1s.
const T2_SIM_SPHERE_GEO = new THREE.SphereGeometry(2, 8, 6);
const T2_SIM_COLOR_BY_ROLE = {
  intersection: 0x707070,  // medium gray — graph junction
  terminus:     0xa0a0a0,  // light gray — way endpoint
  waypoint:     0x4488cc,  // blue — T1-serving (matches cycleway tone)
  entrance:     0xff8844,  // orange — reserved for mode pass
};

// Diagnostic: nodes flanking an UNJUSTIFIED walking/cycling snap-adjacent
// cliff are drawn bigger + red so they're spottable in the scene. Mirrors
// openspec/changes/sml-t2-unjustified-cliff-assertion/probe_cliffs.py: a
// snap-adjacent segment (endpoint carries z_lineage[i].tool === "node") whose
// grade exceeds mode_cap × CLIFF_SLACK is a cliff. A cliff is JUSTIFIED — and
// not flagged — when its flank node has an incident stairs edge or is a
// terminus (a stair landing / path end legitimately meets a sharp drop).
// Stair-mode edges are themselves excluded (self-justifying). Recomputed from
// edges.json on every load so it stays in sync as upstream Z fixes land.
const CLIFF_SPHERE_GEO = new THREE.SphereGeometry(6, 12, 8);
const CLIFF_COLOR = 0xff2222;
// CLIFF_MODE_CAP / CLIFF_SLACK + computeCliffNodes live in viewer-common/diagnostics.js.
// Many cliff nodes sit at or below the lake disk (748.5m) or under terrain, so a
// world-scale sphere is both buried AND sub-pixel from the basin-wide default
// camera. The findable marker is a Sprite: depthTest off (always on top) and
// sizeAttenuation off (constant screen size at any zoom), so it reads as a fixed
// red dot whether you're looking at the whole basin or standing on a ridge.
const CLIFF_BEACON_SCREEN_SIZE = 0.022;  // ~2.2% of viewport height

async function loadBaseNodes() {
  setLoading('Loading Stage 1 base nodes...', 2);
  const sourceUrl = window.DT_assetUrl('base/nodes.json');
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`nodes.json fetch failed: ${resp.status}`);
  const doc = await resp.json();
  const nodes = doc.nodes || [];
  handle.baseNodeCount = nodes.length;
  // Prefer the manifest's inline pipeline; fall back to the registry.
  const pipeline = (doc.generated_by && doc.generated_by.pipeline)
    || pipelineForArtifact('base/nodes.json');

  const group = new THREE.Group();
  group.name = 'base-nodes';
  for (const n of nodes) {
    const [x, y] = geoToLocal(n.lat, n.lng);
    const z = terrainSampler ? terrainSampler(x, y) : window.DT_SITE.cameraTargetZ;  // site Z fallback
    const color = NODE_COLOR_BY_TYPE[n.type] ?? NODE_COLOR_BY_TYPE.default;
    const mat = new THREE.MeshBasicMaterial({ color });
    const sphere = new THREE.Mesh(NODE_SPHERE_GEO, mat);
    sphere.position.set(x, y, (Number.isFinite(z) ? z : window.DT_SITE.cameraTargetZ) + 2);
    sphere.name = `node:${n.id}`;
    sphere.userData = {
      ...n,
      kind: 'base-node',
      // T1 semantic authority — see sml-t1-node-authority-boundary.
      authority_tier: 'T1',
      source_url: sourceUrl,
      pipeline,
    };
    group.add(sphere);
    handle.nodes.push(sphere);
  }
  scene.add(group);
  handle.nodesGroup = group;
}

// ── T2 sim nodes (intersections / termini / waypoints) ─────────
// Per sml-t2-intersection-first-graph: T2 synthesizes structural
// nodes (graph junctions, way endpoints, T1-serving waypoints) that
// the edge graph references via twin_id. They're rendered smaller and
// in muted colours so they don't visually compete with T1 semantic
// nodes — but they're present so producers can see the graph topology.

async function loadT2SimNodes() {
  setLoading('Loading T2 sim nodes (intersections / termini / waypoints)...', 3);
  // Source: synth OUTPUT (which carries the resolved `z` field per node).
  // Per t2-intersection-z-authority R1: the viewer reads `z` directly and
  // MUST fail loudly if it's missing — terrain fallback is forbidden.
  const sourceUrl = window.DT_assetUrl('t2/edges/intersections.json');
  const resp = await fetch(sourceUrl);
  if (!resp.ok) {
    throw new Error(`T2 sim nodes file unreadable: ${resp.status} ${sourceUrl}`);
  }
  const doc = await resp.json();
  const simNodes = doc.intersections || [];
  handle.simNodeCount = simNodes.length;
  const pipeline = (doc.generated_by && doc.generated_by.pipeline)
    || pipelineForArtifact('t2/edges/intersections.json');

  // Diagnostic cliff set — recomputed from the current edges.json so it stays
  // in sync. Non-fatal if edges are unreadable (just no red markers).
  const roleByNode = new Map(simNodes.map((n) => [n.twin_id, n.role]));
  let cliffNodes = new Map();
  try {
    const er = await fetch(window.DT_assetUrl('t2/edges/edges.json'));
    if (er.ok) cliffNodes = computeCliffNodes((await er.json()).edges || [], roleByNode, geoToLocal);
  } catch (err) {
    console.warn('cliff-node diagnostic skipped:', err);
  }
  handle.cliffNodeCount = cliffNodes.size;

  const group = new THREE.Group();
  group.name = 't2-sim-nodes';
  for (const n of simNodes) {
    const [x, y] = geoToLocal(n.lat, n.lng);
    if (!Number.isFinite(n.z)) {
      throw new Error(
        `T2 sim node ${n.twin_id} missing numeric \`z\` field. Synth output regression — `
        + `re-run scripts/t2/build_sml_t2_facility_graph.py. The viewer MUST NOT fall `
        + `back to terrain sampling per sml-t2-intersection-z-resolution.`,
      );
    }
    const cliffGradePct = cliffNodes.get(n.twin_id);
    const isCliff = cliffGradePct !== undefined;
    const color = isCliff ? CLIFF_COLOR : (T2_SIM_COLOR_BY_ROLE[n.role] ?? 0x808080);
    // ALL sim-node spheres draw through terrain (depthTest off) so nodes whose
    // z lands below the terrain mesh or the lake disk stay visible AND
    // raycast-pickable. The cliff sphere is larger (radius 6) and red; regular
    // sim nodes stay at radius 2 + role colour — small enough not to clutter
    // when many are layered above terrain.
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
    const sphere = new THREE.Mesh(isCliff ? CLIFF_SPHERE_GEO : T2_SIM_SPHERE_GEO, mat);
    sphere.position.set(x, y, n.z);
    sphere.name = `sim-node:${n.twin_id}`;
    sphere.userData = {
      ...n,
      kind: 't2-sim-node',
      authority_tier: 'T2_sim',
      source_url: sourceUrl,
      pipeline,
      ...(isCliff ? { is_cliff: true, cliff_grade_pct: Math.round(cliffGradePct) } : {}),
    };
    if (isCliff) sphere.renderOrder = 999;
    group.add(sphere);
    handle.simNodes = handle.simNodes || [];
    handle.simNodes.push(sphere);

    if (isCliff) {
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
        color: CLIFF_COLOR, depthTest: false, depthWrite: false, sizeAttenuation: false,
      }));
      beacon.scale.set(CLIFF_BEACON_SCREEN_SIZE, CLIFF_BEACON_SCREEN_SIZE, 1);
      beacon.position.set(x, y, n.z);
      beacon.renderOrder = 1000;
      beacon.name = `cliff-beacon:${n.twin_id}`;
      beacon.userData = { ...sphere.userData, kind: 'cliff-beacon' };
      group.add(beacon);
    }
  }
  scene.add(group);
  handle.simNodesGroup = group;
  if (cliffNodes.size) {
    console.info(`[cliff diagnostic] ${cliffNodes.size} sim node(s) flank an unjustified `
      + `walking/cycling snap cliff — drawn red. ids:`, [...cliffNodes.keys()]);
  }
}

// ── T2 facility-graph edges ────────────────────────────────────
// Per sml-t2-facility-graph: edges synthesized from T1 nodes + producer-
// validated topology + multi-source evidence (OSM/KMZ/shapefile/GPX/
// DEM). Geometry is owned by the synthesizer; no edge polyline vertex
// is a verbatim copy of a single input. Each edge userData carries
// authority_tier: "T2_facility".
const MODE_STYLE = {
  driving: { color: 0xa08070, opacity: 0.85, linewidth: 1 },
  cycling: { color: 0x4488cc, opacity: 0.95, linewidth: 2 },
  walking: { color: 0xccaa88, opacity: 0.75, linewidth: 1 },
  mixed:   { color: 0x88aa88, opacity: 0.80, linewidth: 1 },
};
const sharedMaterials = {};
for (const [mode, style] of Object.entries(MODE_STYLE)) {
  sharedMaterials[mode] = new THREE.LineBasicMaterial({
    color: style.color,
    transparent: true,
    opacity: style.opacity,
    linewidth: style.linewidth,
  });
}

// Diagnostic: a DRIVING edge that dips below the lake surface while INSIDE the
// lake basin is a submerged road — a bridge/causeway whose Z fell to lake
// bathymetry (terrain_at_road_surface, or gpx_offset's DEM anchor over water)
// instead of the deck. Drawn magenta + on top (depthTest off) so the span shows
// through the lake disk, with a constant-size beacon for findability. Distinct
// from the red cliff-node markers (a different fault axis — road-Z, not
// walking/cycling node-Z). Descent roads to lower towns legitimately go below
// lake level, so the basin-radius gate excludes them.
const SUBMERGED_COLOR = 0xff22ff;            // magenta
// LAKE_SURFACE_Z / SUBMERGED_DROP_M / SUBMERGED_BASIN_M + submergedInBasinPoint
// live in viewer-common/diagnostics.js.
const SUBMERGED_BEACON_SCREEN_SIZE = 0.022;
const submergedLineMat = new THREE.LineBasicMaterial({
  color: SUBMERGED_COLOR, depthTest: false, depthWrite: false, transparent: false,
});

// Steep-slope diagnostic (third axis, distinct from cliff + submerged):
// walking / cycling edges whose AVERAGE node-to-node grade exceeds the mode
// cap. Unlike cliffs (localized snap faults) or submerged (Z below water),
// steep slopes are "reality faults" — the Z reflects (often inherited) DEM
// slope, the path resolves to that, and the engineered grade a real cycleway
// would have is missing. The producer's call: tag stairs, mark no-go, route
// around, OR fix the upstream Z source. Drawn yellow + on top, with a
// constant-size beacon. Stairs excluded (self-justifying steep). Very-short
// edges (< 10 m) skipped — length-noise dominates the grade calc.
//
// Threshold is the raw mode cap (walking 25%, cycling 8%) — even 12% on a
// cycleway is engineering-wrong, not "just above cap" noise. Producer
// 2026-05-28: "12% is not good... some of our cycleways are clamped to
// terrain" — the diagnostic SHOULD keep flagging these.
const STEEP_SLOPE_COLOR = 0xffdd00;          // yellow
// STEEP_SLOPE_MIN_LEN_M / STEEP_MODE_CAP + steepSlopeMarker live in
// viewer-common/diagnostics.js.
const steepSlopeLineMat = new THREE.LineBasicMaterial({
  color: STEEP_SLOPE_COLOR, depthTest: false, depthWrite: false, transparent: false,
});

// Overlap / duplicate-edge diagnostic (fourth axis — TOPOLOGICAL, not a Z
// fault): the same physical surface carried as multiple overlapping cross-mode
// edges (a symptom of an incomplete T-1 source). overlapEdges + the three
// thresholds live in viewer-common/diagnostics.js. Drawn cyan, on top.
const OVERLAP_COLOR = 0x22ddff;              // cyan
const overlapLineMat = new THREE.LineBasicMaterial({
  color: OVERLAP_COLOR, depthTest: false, depthWrite: false, transparent: false,
});
const OVERLAP_BEACON_SCREEN_SIZE = 0.022;

async function loadSurfaces() {
  setLoading('Loading T2 facility edges...', 3);
  const url = window.DT_assetUrl('t2/edges/edges.json');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`T2 edges fetch failed: ${resp.status}`);
  const doc = await resp.json();
  const edges = doc.edges || [];
  handle.manifestSurfaceCount = edges.length;
  // Count by mode for the HUD badge (was countsByClass on the T1 manifest).
  handle.countsByClass = {};
  for (const e of edges) {
    const m = e.mode || 'mixed';
    handle.countsByClass[m] = (handle.countsByClass[m] || 0) + 1;
  }
  handle.surfacesManifestGeneratedBy = doc.generated_by || null;
  const surfacesPipeline = (doc.generated_by && doc.generated_by.pipeline)
    || pipelineForArtifact('t2/edges/edges.json');

  // Single authoritative group — Z verbatim from polyline_3d (authored truth).
  // The clamped diagnostic overlay was removed per
  // sml-t2-intersection-z-resolution §8: with node-Z-driven sim-nodes, the
  // clamp can no longer hide a structural fault, and keeping it would only
  // mask the deferred terrain-regen frame mismatch.
  const realGroup = new THREE.Group();
  realGroup.name = 'base-travel-surfaces';

  // Overlap / duplicate-edge axis (4th axis): compute once over all edges, then
  // recolor each participating edge's line cyan in the loop below. An edge that
  // is ALSO submerged/steep keeps that Z-fault color (overlap is lower priority);
  // the overlap beacon still marks it.
  const overlapPairs = overlapEdges(edges, geoToLocal);
  const overlapIds = new Set();
  for (const { a, b } of overlapPairs) { overlapIds.add(a); overlapIds.add(b); }
  handle.overlapCount = overlapPairs.length;
  handle.overlapEdgeIds = [...overlapIds];
  handle.overlapPairs = overlapPairs;

  for (const e of edges) {
    const realPositions = [];
    for (const [lat, lng, z] of e.polyline_3d) {
      const [x, y] = geoToLocal(lat, lng);
      const manifestZ = Number.isFinite(Number(z)) ? Number(z) : window.DT_SITE.cameraTargetZ;
      realPositions.push(x, y, manifestZ);
    }
    const realGeo = new THREE.BufferGeometry();
    realGeo.setAttribute('position', new THREE.Float32BufferAttribute(realPositions, 3));
    const submergedPt = submergedInBasinPoint(e, realPositions);
    const isSubmerged = submergedPt !== null;
    // Steep-slope detection is mutually exclusive with submerged by mode
    // (submerged is driving-only, steep is walking/cycling-only) so the order
    // is incidental, but we evaluate submerged first to match the existing
    // diagnostic priority.
    const steepInfo = isSubmerged ? null : steepSlopeMarker(e, realPositions);
    const isSteep = steepInfo !== null;
    const isOverlap = overlapIds.has(e.id);
    const lineMat = isSubmerged ? submergedLineMat
                   : isSteep ? steepSlopeLineMat
                   : isOverlap ? overlapLineMat
                   : (sharedMaterials[e.mode] || sharedMaterials.mixed);
    const realLine = new THREE.Line(realGeo, lineMat);
    realLine.name = `surface:${e.id}`;
    if (isSubmerged || isSteep || isOverlap) realLine.renderOrder = 998;
    realLine.userData = {
      edge_id: e.id,
      from_node: e.from_node, to_node: e.to_node,
      mode: e.mode, bridge: !!e.bridge, z_source: e.z_source || 'dem',
      lineage: e.lineage, kind: 'edge',
      authority_tier: 'T2_facility',
      source_url: url,
      pipeline: surfacesPipeline,
      ...(isSubmerged ? { is_submerged: true, deepest_z: Math.round(submergedPt[2] * 10) / 10 } : {}),
      ...(isSteep ? { is_steep_slope: true, avg_grade_pct: Math.round(steepInfo[3] * 1000) / 10 } : {}),
      ...(isOverlap ? { is_overlap: true } : {}),
    };
    realGroup.add(realLine);
    handle.surfaces.push(realLine);

    if (isSubmerged) {
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
        color: SUBMERGED_COLOR, depthTest: false, depthWrite: false, sizeAttenuation: false,
      }));
      beacon.scale.set(SUBMERGED_BEACON_SCREEN_SIZE, SUBMERGED_BEACON_SCREEN_SIZE, 1);
      beacon.position.set(submergedPt[0], submergedPt[1], submergedPt[2]);
      beacon.renderOrder = 1000;
      beacon.name = `submerged-beacon:${e.id}`;
      beacon.userData = { ...realLine.userData, kind: 'submerged-beacon' };
      realGroup.add(beacon);
      handle.submergedCount = (handle.submergedCount || 0) + 1;
    } else if (isSteep) {
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
        color: STEEP_SLOPE_COLOR, depthTest: false, depthWrite: false, sizeAttenuation: false,
      }));
      beacon.scale.set(SUBMERGED_BEACON_SCREEN_SIZE, SUBMERGED_BEACON_SCREEN_SIZE, 1);
      beacon.position.set(steepInfo[0], steepInfo[1], steepInfo[2]);
      beacon.renderOrder = 1000;
      beacon.name = `steep-slope-beacon:${e.id}`;
      beacon.userData = { ...realLine.userData, kind: 'steep-slope-beacon' };
      realGroup.add(beacon);
      handle.steepSlopeCount = (handle.steepSlopeCount || 0) + 1;
    } else if (isOverlap) {
      const n = realPositions.length / 3;
      const mi = Math.floor(n / 2) * 3;
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
        color: OVERLAP_COLOR, depthTest: false, depthWrite: false, sizeAttenuation: false,
      }));
      beacon.scale.set(OVERLAP_BEACON_SCREEN_SIZE, OVERLAP_BEACON_SCREEN_SIZE, 1);
      beacon.position.set(realPositions[mi], realPositions[mi + 1], realPositions[mi + 2]);
      beacon.renderOrder = 1000;
      beacon.name = `overlap-beacon:${e.id}`;
      beacon.userData = { ...realLine.userData, kind: 'overlap-beacon' };
      realGroup.add(beacon);
    }
  }
  scene.add(realGroup);
  handle.surfacesGroup = realGroup;
  if (handle.submergedCount) {
    console.info(`[submerged-road diagnostic] ${handle.submergedCount} driving edge(s) dip below `
      + `the lake surface inside the basin — drawn magenta (bridge/causeway Z fell to bathymetry).`);
  }
  if (handle.steepSlopeCount) {
    console.info(`[steep-slope diagnostic] ${handle.steepSlopeCount} walking/cycling edge(s) `
      + `exceed the mode cap end-to-end — drawn yellow (real terrain steepness, not a Z fault; `
      + `producer decides per edge: stair-tag, no-go, accept, or reroute).`);
  }
  if (handle.overlapCount) {
    console.info(`[overlap diagnostic] ${handle.overlapCount} overlapping cross-mode edge pair(s) `
      + `(${handle.overlapEdgeIds.length} edges) — drawn cyan (TOPOLOGICAL: same physical surface `
      + `mapped as duplicate/overlapping ways; a symptom of an incomplete T-1 source).`);
  }
}

// ── Scene inventory (Playwright assertion target) ──────────────
// Allowed top-level group/mesh names that match what THIS stage generates.
const ALLOWED_NAMES = new Set([
  'terrain',           // base terrain mesh
  'base-nodes',        // Stage 1 (T1) node markers group
  't2-sim-nodes',      // T2 sim nodes (intersection/terminus/waypoint)
  'base-travel-surfaces',           // T2 edges, real Z (authored)
]);

function buildSceneInventory() {
  // Inventory reflects VISIBLE meshes only — a layer toggled off via the
  // HUD must not surface its meshes as `extraneous`. We walk manually
  // because THREE.traverse always recurses regardless of `.visible`.
  const inv = {
    meshCount: 0, lineCount: 0,
    meshNames: [], topLevelNames: [],
    extraneous: [],
  };
  function isContextObject(node) {
    let current = node;
    const roots = Object.values(handle.contextLayerRoots);
    while (current && current !== scene) {
      if (roots.includes(current)) return true;
      current = current.parent;
    }
    return false;
  }
  for (const child of scene.children) {
    if (child.isLight || child.isCamera) continue;
    inv.topLevelNames.push(child.name || child.type);
  }
  function walk(node) {
    if (node !== scene && node.visible === false) return;
    if (node.isMesh) {
      inv.meshCount++;
      if (node.name) inv.meshNames.push(node.name);
      const isAllowed =
        node.name === 'terrain' ||
        node.name?.startsWith('lake:') ||
        node.name?.startsWith('node:') ||
        node.name?.startsWith('sim-node:');
      if (!isAllowed && !isContextObject(node)) inv.extraneous.push({ name: node.name, type: 'Mesh' });
    } else if (node.isLine) {
      inv.lineCount++;
      if (node.name && !node.name.startsWith('surface:')) {
        inv.extraneous.push({ name: node.name, type: 'Line' });
      }
    }
    for (const child of node.children) walk(child);
  }
  walk(scene);
  return inv;
}
// (buildSceneInventory export consolidated at end of file)

// ── Picking + inspector ────────────────────────────────────────
attachInspectorClose();

const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 5 };
const pointer = new THREE.Vector2();

function pointerToNdc(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  return pointer;
}

function raycastTerrainAt(clientX, clientY) {
  if (!handle.terrain) return null;
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(pointerToNdc(clientX, clientY), camera);
  const hits = raycaster.intersectObject(handle.terrain, true);
  return hits[0] || null;
}

// Click-to-inspect dispatches to node or surface based on hit kind.
let clickWasDrag = false;
let mouseDownAt = null;

renderer.domElement.addEventListener('pointerdown', (ev) => {
  mouseDownAt = { x: ev.clientX, y: ev.clientY };
  clickWasDrag = false;
});

window.addEventListener('pointermove', (ev) => {
  if (!mouseDownAt) return;
  const dx = ev.clientX - mouseDownAt.x;
  const dy = ev.clientY - mouseDownAt.y;
  if (dx * dx + dy * dy > 9) clickWasDrag = true;
});

renderer.domElement.addEventListener('pointerup', (ev) => {
  const wasClick = mouseDownAt && !clickWasDrag;
  mouseDownAt = null;
  if (!wasClick) return;
  raycaster.setFromCamera(pointerToNdc(ev.clientX, ev.clientY), camera);
  // THREE.Raycaster doesn't skip objects with .visible=false. Honour the
  // HUD toggles by gating each list on its parent group's visibility.
  const nodesOn = handle.nodesGroup ? handle.nodesGroup.visible !== false : true;
  const simNodesOn = handle.simNodesGroup ? handle.simNodesGroup.visible !== false : true;
  const surfacesOn = handle.surfacesGroup ? handle.surfacesGroup.visible !== false : true;
  // T2 sim nodes were missing from the pickable list — underground/lakeside ones
  // (z below the lake disk or below terrain) couldn't be clicked even with the
  // cliff/submerged depthTest-off markers visible. Combine T1 + T2 sources.
  const pickableNodes = [
    ...(nodesOn ? handle.nodes : []),
    ...(simNodesOn ? handle.simNodes : []),
  ];
  const pickableSurfaces = surfacesOn ? handle.surfaces : [];
  // Nodes have larger pickable footprint than line surfaces — try nodes first.
  const nodeHits = pickableNodes.length ? raycaster.intersectObjects(pickableNodes, false) : [];
  if (nodeHits.length > 0) { showNodeInspector(nodeHits[0].object.userData); return; }
  const surfHits = pickableSurfaces.length ? raycaster.intersectObjects(pickableSurfaces, false) : [];
  if (surfHits.length > 0) { showSurfaceInspector(surfHits[0].object.userData); return; }
  hideInspector();
});

// ── Controls (WASD + Ctrl-rotate + drag-the-world) ─────────────
const { applyWASD, computeWasdSpeed, getCtrlGestureAnchor, mobileGestures } = installControls({
  camera, controls, renderer,
  getTerrainSampler: () => terrainSampler,
  raycastTerrainAt,
});

// ── Layer-visibility toggles ───────────────────────────────────
// HUD checkboxes + 1/2/3/4 keyboard shortcuts toggle four layer kinds:
// terrain, lake, T1 base nodes, T2 facility edges. State persists across reloads
// via localStorage under a versioned key.
//
// Source of truth = each group's THREE.Object3D.visible — checkboxes and
// localStorage are mirrors of that state, never the authority.
const LAYER_TOGGLE_STORAGE_KEY = '__smlBaseViewer_layerToggles_v1';

const LAYER_DEFS = [
  { key: 'terrain',   digit: '1', checkboxId: 'toggle-terrain',   groupOf: (h) => h.terrain },
  { key: 'lake',      digit: '2', checkboxId: 'toggle-lake',      groupOf: (h) => h.lakeGroup },
  { key: 'nodes',     digit: '3', checkboxId: 'toggle-nodes',     groupOf: (h) => h.nodesGroup },
  { key: 'surfaces',  digit: '4', checkboxId: 'toggle-surfaces',  groupOf: (h) => h.surfacesGroup },
  // 5th toggle (sml-base-network-cross-section morning review #4): T2 sim
  // nodes (intersection/terminus/waypoint spheres) were previously added
  // by loadT2SimNodes() with no HUD entry — unkillable visual clutter.
  { key: 'sim-nodes', digit: '5', checkboxId: 'toggle-sim-nodes', groupOf: (h) => h.simNodesGroup },
  // 6th toggle removed per sml-t2-intersection-z-resolution §8: clamped
  // overlay would only mask the deferred terrain-regen frame mismatch
  // now that sim-nodes pull Z from data.
];

function _readStoredLayerState() {
  // Lenient: return any object with boolean keys. Missing keys fall through
  // to the per-layer default in installLayerToggles. This keeps stored state
  // from previous app versions usable when LAYER_DEFS grows (e.g., adding
  // the surfaces-clamped overlay didn't invalidate prior 5-key state).
  try {
    const raw = localStorage.getItem(LAYER_TOGGLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function _writeStoredLayerState(state) {
  try {
    localStorage.setItem(LAYER_TOGGLE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private window / quota exceeded — toggle still works in-memory.
  }
}

function installLayerToggles({ handle }) {
  const stored = _readStoredLayerState();
  const contextLabelDefs = handle.contextLabels
    .filter(({ root }) => root)
    .map(({ request }) => ({
      key: request.role,
      digit: null,
      checkboxId: `toggle-${request.role}`,
      groupOf: (h) => h.contextLayerRoots[request.root],
    }));
  const defs = [...LAYER_DEFS, ...contextLabelDefs].map(def => ({
    ...def,
    group: def.groupOf(handle),
    checkbox: document.getElementById(def.checkboxId),
  })).filter(d => d.group && d.checkbox);

  function snapshot() {
    const s = {};
    for (const d of defs) s[d.key] = d.group.visible;
    return s;
  }
  function persist() { _writeStoredLayerState(snapshot()); }

  // Apply initial state per-key: stored value if it's a boolean, else fall
  // back to the load-time group.visible (which loadSurfaces sets to false
  // for the clamped overlay so it stays off until opted in).
  for (const d of defs) {
    const stashed = stored && typeof stored[d.key] === 'boolean' ? stored[d.key] : null;
    const on = stashed === null ? d.group.visible : stashed;
    d.group.visible = on;
    d.checkbox.checked = on;
  }
  persist();

  for (const d of defs) {
    d.checkbox.addEventListener('change', () => {
      d.group.visible = d.checkbox.checked;
      persist();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    const def = defs.find(d => d.digit === e.key);
    if (!def) return;
    const next = !def.group.visible;
    def.group.visible = next;
    def.checkbox.checked = next;
    persist();
  });
}

// ── Test contract (window exposures) ───────────────────────────
// ── Go-to-twin search (diagnostic) ───────────────────────────
// Shared resolution policy (viewer-common/goto-resolver). The base viewer's
// index is the T2 sim nodes (intersections/termini/waypoints, by twin_id +
// name) plus the surface edges (by edge_id) — the things this viewer loads
// that production does not. Action: reposition the orbit pivot onto the twin
// and open its inspector. This is the Z-fault triage path: search the exact
// N-INT-… node you're judging.
function baseGotoTwin(rawQuery) {
  const nodeEntries = (handle.simNodes || []).map((m) => ({
    id: m.userData.twin_id, name: m.userData.name,
  }));
  const surfaceEntries = (handle.surfaces || []).map((m) => ({
    id: m.userData.edge_id,
  }));
  const res = resolveTwinQuery(rawQuery, [
    { name: 'sim-node', entries: nodeEntries },
    { name: 'surface', entries: surfaceEntries },
  ]);
  if (!res.found) return res;

  const node = (handle.simNodes || []).find((m) => m.userData.twin_id === res.id);
  if (node) {
    const p = node.position;
    controls.target.set(p.x, p.y, p.z);
    camera.position.set(p.x, p.y - 300, p.z + 200);
    controls.update();
    showNodeInspector(node.userData);
    return { found: true, kind: 'sim-node', id: res.id };
  }
  const surf = (handle.surfaces || []).find((m) => m.userData.edge_id === res.id);
  if (surf) {
    const c = new THREE.Box3().setFromObject(surf).getCenter(new THREE.Vector3());
    if (Number.isFinite(c.x)) {
      controls.target.copy(c);
      camera.position.set(c.x, c.y - 200, c.z + 120);
      controls.update();
      showSurfaceInspector(surf.userData);
      return { found: true, kind: 'surface', id: res.id };
    }
  }
  return { found: false, query: res.query };
}
handle.gotoTwin = baseGotoTwin;

// Wire the #goto-input box: Enter resolves + moves; Escape clears.
// stopPropagation keeps digit/letter keys from firing the layer toggles + WASD.
const gotoInput = document.getElementById('goto-input');
const gotoInfoEl = document.getElementById('info');
if (gotoInput) {
  gotoInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { gotoInput.value = ''; gotoInput.blur(); return; }
    if (e.key !== 'Enter') return;
    const r = baseGotoTwin(gotoInput.value);
    if (r.found) {
      gotoInput.value = '';
      gotoInput.blur();
    } else if (r.query && gotoInfoEl) {
      gotoInfoEl.textContent = `Not found: ${r.query}`;
      setTimeout(() => {
        if (gotoInfoEl.textContent.startsWith('Not found')) gotoInfoEl.textContent = '';
      }, 2000);
    }
  });
}

// Names here are part of a stable test contract — Playwright tests in
//   tests/test_base_viewer.spec.js
//   tests/test_base_viewer_tdd_sweep.spec.js
// depend on these. Don't rename without updating the tests.
window.__smlBaseViewer = handle;
window.__smlBaseViewer_showSurfaceInspector = showSurfaceInspector;
window.__smlBaseViewer_showNodeInspector = showNodeInspector;
window.__smlBaseViewer_hideInspector = hideInspector;
window.__smlBaseViewer_buildInventory = buildSceneInventory;
window.__smlBaseViewer_camera = camera;
window.__smlBaseViewer_controls = controls;
window.__smlBaseViewer_raycastTerrainAt = raycastTerrainAt;
window.__smlBaseViewer_gestures = mobileGestures;
window.__smlBaseViewer_computeWasdSpeed = computeWasdSpeed;
window.__smlBaseViewer_getCtrlGestureAnchor = getCtrlGestureAnchor;
// terrainSampler is set inside loadTerrain after boot; expose via
// getter so the test reads the live value, not the boot-time null.
Object.defineProperty(window, '__smlBaseViewer_terrainSampler', {
  get: () => terrainSampler,
});

// ── Boot ───────────────────────────────────────────────────────
(async function boot() {
  try {
    // Registry first — every downstream loader pulls pipeline attribution
    // from it (or from the artifact's own generated_by block).
    await loadPipelineRegistry();
    await loadTerrain();
    // Farm context is manifest-bound and consumed through the same common
    // role resolver as main.js. SML has no declaration, so this is a no-op.
    await loadDeclaredContextLayers();
    // Water plane is procedural — sized to terrain.glb's actual bbox so
    // it doesn't paint real mountains beyond terrain coverage as lake.
    // Optional/per-site layers are gated (viewer-3d-site-agnostic D3).
    if (window.DT_hasLayer('lake')) await loadLake();
    const baseLoaders = [loadBaseNodes()];
    if (window.DT_hasLayer('intersections')) baseLoaders.push(loadT2SimNodes(), loadSurfaces());
    await Promise.all(baseLoaders);
    const hud = document.getElementById('surface-counts');
    if (hud) {
      const parts = [];
      for (const [k, v] of Object.entries(handle.countsByClass)) parts.push(`${k}: ${v}`);
      parts.push(`nodes: ${handle.baseNodeCount}`);
      hud.textContent = parts.join(' · ');
    }
    // Install toggles AFTER all groups exist (so groupOf() resolves), and
    // BEFORE the inventory snapshot — restored state must already be applied
    // so hidden layers don't surface as `extraneous`.
    installLayerToggles({ handle });
    handle.inventory = buildSceneInventory();
    setLoading('Ready', TOTAL_STEPS);
    hideLoading();
    handle.ready = true;
  } catch (err) {
    setLoading(`Error: ${err.message}`, TOTAL_STEPS);
    handle.error = err.message;
    throw err;
  }
})();

function animate() {
  requestAnimationFrame(animate);
  applyWASD();
  controls.update();
  renderer.render(scene, camera);
}
animate();
