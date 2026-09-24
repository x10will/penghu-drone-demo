import { canonicalCandidateUrl, loadCanonicalAdapter, createCanonicalClock, localArtifactUrl, presentationPaint } from '../viewer-common/canonical-site-playback.mjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TypedRuntimeRegistry } from '../viewer-common/typed-runtime.js';
import { resolveTwinQuery, resolveTwinQueryAll, buildNameById } from '../viewer-common/goto-resolver.js';
import { mergeEdgesIntoBatches } from '../viewer-common/edge-mesh-merge.js';
import { buildTerrainSampler } from '../viewer-common/terrain-sampler.mjs';
import { CAMERA_MAX_DISTANCE as DEFAULT_CAMERA_MAX_DISTANCE, heightAboveFloor, zoomSpeedForHeight, rotateScaleForHeight, orbitPosition } from '../viewer-common/nav-sensitivity.mjs';
import { findSunrise, solarPosition } from '../viewer-common/solar-position.mjs';
import { buildEdgeTrackIndex, resolveEdgePosition, interpolatePosition, buildDeckZSampler } from '../viewer-common/edge-tracks.js';
import { buildNodeZLookup } from '../viewer-common/node-z-lookup.js';
import {
  applyLayerFailureUi,
  makeAssetErrorDiagnostic,
  supportStructureUserData,
  validateSupportAssetMetadata,
} from '../viewer-common/support-structure.js';
import { installMobileGestureController } from './mobile-gesture-controller.js';
import { installMobileChrome } from './mobile-chrome.js';
import { buildNodeElement, buildTwinToSimNodeIndex } from '../viewer-common/node-card.js';
import { buildPoiDescriptionIndex, resolvePoiAtXY, buildPoiDescriptionElement } from '../viewer-common/poi-card.js';
import {
  causalMarkerScale,
  causalMarkerModel,
  causalMarkerDepthTest,
  causalArtifactAvailability,
  causalReliefAxisCounts,
  causalMoundHasEvidence,
  chooseVisibleCausalHit,
  chooseAxisAwareCausalHit,
} from '../viewer-common/causal-diagnosis.js';
import { chainRuns, layoutLabels } from './edge-labels.mjs';
import {
  computeCliffNodes,
  submergedInBasinPoint,
  steepSlopeMarker,
  overlapEdges,
  belowLakeNodes,
  belowLakeDeckVerts,
  stairsFlatViolations,
  applyDiagnosticsVisibility,
  applyTerrainFaultVisibility,
  terrainFaultPinsVisible,
  terrainFaultMarkers,
  terrainFaultAxisCounts,
  DIAGNOSTIC_AXES,
  legendModel,
} from '../viewer-common/diagnostics.js';
import {
  buildBeatIndex,
  currentBeat,
  isWannabeCohort,
  isProtagonist,
  WANNABE_COLOR,
  WANNABE_SCALE_BOOST,
} from '../viewer-common/story-narration.js';
import { activeTrackCohort, cinemaTempoStep, filmSchedule, sanitizeStoryConfig } from '../viewer-common/story-director.js';
import { buildSchematicLayer } from './schematic-layer.js';
import { buildBikeGeometry } from './actor-models.js';
import {
  resolveDeclaredLayerRequests,
  resolveContextManifestUrl,
  resolveProvenanceCatalogUrl,
  applyProvenanceCatalog,
  contextInspectionRecord,
  authoredPropInspection,
  CONTEXT_AUTHORITY_SCOPE,
  CONTEXT_PROP_ORIGIN_KIND,
} from '../viewer-common/site-layer-consumer.js';
import {
  resolveAppearanceSource,
  gltfPrimitiveDeclaresMaterial,
  readAppearanceDeclaration,
  APPEARANCE_DECLARED,
} from '../viewer-common/appearance-policy.js';
import {
  showInspector,
  setRuntimeInspectionProvider,
  refreshRuntimeInspection,
  toggleElevatedInspector,
  hideInspector,
  toggleInspector,
  toggleSimNodeInspector,
  setTwinToSimNodeIndex,
  togglePoiDescriptionInspector,
  toggleDiagnosticEdgeInspector,
  toggleStairsFlatInspector,
  toggleWalkway3dInspector,
  toggleNodeMarkerInspector,
  toggleCohortInspector,
  toggleVehicleInspector,
  toggleSchematicEdgeInspector,
  toggleCausalDiagnosisInspector,
  isSupportStructureUserData,
  toggleSupportStructureInspector,
  attachInspectorBindings,
} from './inspector-panel.js';

let typedRuntime = new TypedRuntimeRegistry();
const typedObjectRegistry = new Map();
// Engine-neutral context records and accepted authored Farm props are kept in
// registries separate from twinRegistry below. Source: viewer-site-config/spec.md:76-105
// and sml-3d-scene-loader/spec.md:3-7.
const contextRegistry = new Map();
const authoredPropRegistry = new Map();
window.smlViewerRuntime = typedRuntime;
window.__smlThreeTypedRuntimeError = null;

function artifactUrl(queryName, defaultPath) {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(queryName);
  return new URL(value || defaultPath, window.location.href).toString();
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

async function fetchDeclaredOptionalResource(role, path, init) {
  const resource = window.DT_optionalResource(role, path);
  if (!resource) return null;
  try {
    const response = await fetch(resource.url, init);
    if (response.ok) return response;
    if (!resource.required) return null;
    throw new Error(
      `required optional resource ${role} unavailable at ${resource.url} (HTTP ${response.status})`,
    );
  } catch (err) {
    if (!resource.required) return null;
    if (err.message.startsWith(`required optional resource ${role} unavailable`)) throw err;
    throw new Error(
      `required optional resource ${role} unavailable at ${resource.url}: ${err.message}`,
      { cause: err },
    );
  }
}

function registerContextTerrainAlias(request) {
  const root = layerRoots[request.alias_of];
  if (!root) {
    throw new Error(`site-layer consumer: alias target '${request.alias_of}' is not loaded`);
  }
  const inspection = contextInspectionRecord(request);
  contextRegistry.set(request.stable_id, {
    request,
    inspection,
    root,
    alias_of: request.alias_of,
  });
}

async function initializeTypedRuntime() {
  try {
    typedRuntime = await TypedRuntimeRegistry.loadFromUrls({
      typedSetUrl: artifactUrl('typedSetUrl', window.DT_assetUrl('set/typed_set.json')),
      terrainReferenceUrl: artifactUrl('terrainReferenceUrl', window.DT_assetUrl('set/terrain_reference.json')),
      geometryReportUrl: artifactUrl('geometryReportUrl', window.DT_assetUrl('set/geometry_report.json')),
    });
    window.smlViewerRuntime = typedRuntime;
    return typedRuntime;
  } catch (err) {
    window.__smlThreeTypedRuntimeError = err.message;
    return typedRuntime;
  }
}

window.__smlThreeTypedRuntimeReady = initializeTypedRuntime();

// ── Coordinate system ──────────────────────────────────────────
const CENTER_LAT = window.DT_SITE.center.lat;
const CENTER_LNG = window.DT_SITE.center.lng;
const GEOID_OFFSET = 0.0;  // orthometric frame (post-2026-05-25); legacy +18m geoid lift dropped
const M_PER_DEG_LAT = 111320.0;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos(CENTER_LAT * Math.PI / 180);

function geoToLocal(lat, lng) {
  return [
    (lng - CENTER_LNG) * M_PER_DEG_LNG,
    (lat - CENTER_LAT) * M_PER_DEG_LAT,
  ];
}

// ── Loading ────────────────────────────────────────────────────
const loadingFill = document.getElementById('loading-fill');
const loadingStatus = document.getElementById('loading-status');
const loadingOverlay = document.getElementById('loading');
let loadProgress = 0;
const TOTAL_STEPS = 10;

function setLoading(msg, step) {
  loadingStatus.textContent = msg;
  loadProgress = step;
  loadingFill.style.width = `${(step / TOTAL_STEPS) * 100}%`;
}
function hideLoading() {
  loadingOverlay.classList.add('done');
}

function stampTypedObject(object, element, source) {
  if (!object || !element) return null;
  const objectId = object.uuid || object.name || element.id;
  object.userData = {
    ...object.userData,
    typedSetId: element.id,
    stableId: element.stable_id,
    twinType: element.twin_type,
    semanticType: element.semantic_type,
  };
  typedObjectRegistry.set(element.id, object);
  typedRuntime.associateRenderedObject(objectId, element.id, {
    renderer: 'three',
    object_name: object.name || objectId,
    source,
    stableId: element.stable_id,
    twinType: element.twin_type,
    semanticType: element.semantic_type,
  });
  return object.userData;
}

function typedObjectSummary() {
  const bySemanticType = {};
  for (const [typedSetId, object] of typedObjectRegistry) {
    const item = {
      objectId: object.uuid || object.name,
      objectName: object.name || '',
      typedSetId,
      stableId: object.userData.stableId,
      twinType: object.userData.twinType,
      semanticType: object.userData.semanticType,
    };
    if (!bySemanticType[item.semanticType]) bySemanticType[item.semanticType] = [];
    bySemanticType[item.semanticType].push(item);
  }
  return { count: typedObjectRegistry.size, bySemanticType };
}

function selectTypedElement(id) {
  const selection = typedRuntime.selectElement(id);
  const element = typedRuntime.getSelectedElement();
  return {
    selection,
    element,
    geometry: element ? typedRuntime.getGeometryReport(element.id) : null,
    associations: typedRuntime.getRenderedObjectAssociationsByTypedId(id),
    object: typedObjectSummaryForId(id),
  };
}

function typedObjectSummaryForId(id) {
  const object = typedObjectRegistry.get(id);
  if (!object) return null;
  return {
    objectId: object.uuid || object.name,
    objectName: object.name || '',
    typedSetId: object.userData.typedSetId,
    stableId: object.userData.stableId,
    twinType: object.userData.twinType,
    semanticType: object.userData.semanticType,
  };
}

// ── Scene setup ────────────────────────────────────────────────
// Scene grade comes from the render-style palette (site-config RENDER_STYLES,
// resolved to window.DT_STYLE via ?style / site.renderStyle). Grade VALUES
// live in that table — a new style adds a row there, not ternaries here.
// classic (SML default) is byte-identical to the pre-style-table grade.
const STYLE = window.DT_STYLE;
const ENV = window.DT_ENV || { name: 'daylight', loopSeconds: 0 };

const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(STYLE.clearColor);
if (STYLE.toneMapping === 'aces') {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = STYLE.exposure;
}
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Sky gradient sphere. Kept in a module ref so the click/anchor raycast can
// exclude it (a 20 km BackSide sphere is never a pick target). The environment
// system repaints this same geometry instead of loading a staged skybox asset.
let skyMesh = null;
const SKY_RADIUS = 20000;
const USE_ENVIRONMENT_SKY = ENV.name === 'sunrise-demo';
function paintLegacySkyGradient(geo, palette) {
  const colors = geo.attributes.color;
  const pos = geo.attributes.position;
  const zenith = new THREE.Color(palette.zenith);
  const horizon = new THREE.Color(palette.horizon);
  const ground = new THREE.Color(palette.ground);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, (y / SKY_RADIUS + 1) * 0.5)); // 0=bottom, 1=top
    const c = t > 0.5
      ? new THREE.Color().lerpColors(horizon, zenith, (t - 0.5) * 2)
      : new THREE.Color().lerpColors(ground, horizon, t * 2);
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
}

function makeSkyMaterial(palette) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(palette.zenith) },
      uHorizon: { value: new THREE.Color(palette.horizon) },
      uGround: { value: new THREE.Color(palette.ground) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunColor: { value: new THREE.Color(0xffcf7a) },
      uSunOpacity: { value: 0 },
      uSunAngularRadiusDeg: { value: 0.265 },
    },
    vertexShader: `
      varying vec3 vSkyDir;
      void main() {
        vSkyDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunOpacity;
      uniform float uSunAngularRadiusDeg;
      varying vec3 vSkyDir;
      void main() {
        float t = clamp(vSkyDir.z * 0.5 + 0.5, 0.0, 1.0);
        vec3 color = t > 0.5
          ? mix(uHorizon, uZenith, (t - 0.5) * 2.0)
          : mix(uGround, uHorizon, t * 2.0);
        float sunCos = dot(normalize(vSkyDir), normalize(uSunDir));
        float radius = radians(max(0.001, uSunAngularRadiusDeg));
        float core = smoothstep(cos(radius * 1.6), cos(radius), sunCos);
        float halo = smoothstep(cos(radius * 8.0), cos(radius * 1.6), sunCos) * 0.24;
        color = mix(color, uSunColor, clamp((core + halo) * uSunOpacity, 0.0, 1.0));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

function setSkyPalette(palette) {
  if (!skyMesh) return;
  if (skyMesh.material.type === 'ShaderMaterial') {
    skyMesh.material.uniforms.uZenith.value.set(palette.zenith);
    skyMesh.material.uniforms.uHorizon.value.set(palette.horizon);
    skyMesh.material.uniforms.uGround.value.set(palette.ground);
    return;
  }
  paintLegacySkyGradient(skyMesh.geometry, palette);
}

(function createSky() {
  if (!(window.DT_SITE.sky ?? true)) return;
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  skyGeo.setIndex(null);
  if (USE_ENVIRONMENT_SKY) {
    skyMesh = new THREE.Mesh(skyGeo, makeSkyMaterial(STYLE.sky));
  } else {
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(skyGeo.attributes.position.count * 3).fill(0), 3));
    paintLegacySkyGradient(skyGeo, STYLE.sky);
    skyMesh = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  }
  skyMesh.name = 'EnvironmentSky';
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);
})();

function updateSkyPlacement() {
  if (USE_ENVIRONMENT_SKY && skyMesh) skyMesh.position.copy(camera.position);
}

// Site-gated (fog:false = large sites skip SML-scale fog) unless the style
// deliberately hazes everything (apple's respectSiteFogOff:false — mild by design).
scene.fog = (window.DT_SITE.fogPolicy === 'off' || (window.DT_SITE.fog === false && STYLE.fog.respectSiteFogOff))
  ? null
  : new THREE.FogExp2(STYLE.fog.color, STYLE.fog.density);

const CAMERA_MAX_DISTANCE = window.DT_SITE.cameraMaxDistance ?? DEFAULT_CAMERA_MAX_DISTANCE;
const TERRAIN_RAY_MAX_DISTANCE = window.DT_SITE.terrainRayMaxDistance ?? 40000;
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 10, window.DT_SITE.cameraFar ?? 50000);
camera.position.set(...(window.DT_SITE.cameraPosition ?? [0, -4000, 3500]));
camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, window.DT_SITE.cameraTargetZ);  // site lake level + small margin
controls.maxDistance = CAMERA_MAX_DISTANCE;
// minDistance 50 → 10: with the distance-to-floor zoom law (nav-sensitivity)
// the step shrinks near the ground, so close approach is controlled; the
// render-loop cameraFloorZ clamp still keeps the camera above the site floor.
controls.minDistance = 10;
controls.maxPolarAngle = Math.PI * 0.48;
controls.zoomToCursor = true;
// Ctrl-modal rotation per three-viewer-controls R2.
// Default left-drag is owned by the drag-the-world handler below (R6).
// Ctrl (or Meta on macOS) re-maps left-drag to OrbitControls' built-in rotation.
controls.mouseButtons.LEFT = -1;
// Touch (viewer-mobile-controls B): one-finger is the drag-the-world pan
// (custom pointer handlers below) — disable OrbitControls' one-finger rotate
// so they don't fight. Two-finger = pinch dolly + drag rotate/tilt, with the
// dolly/rotate rates modulated per move by the distance-to-floor law.
controls.touches.ONE = -1;
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

// Lights — per style palette (apple: bright neutral daylight, ACES-compensated).
const ambientLight = new THREE.AmbientLight(STYLE.lights.ambient.color, STYLE.lights.ambient.intensity);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(STYLE.lights.dir.color, STYLE.lights.dir.intensity);
dirLight.name = 'SunriseDirectionalLight';
dirLight.position.set(2000, 3000, 5000);
scene.add(dirLight);
const dirLightTarget = new THREE.Object3D();
dirLightTarget.name = 'SunriseDirectionalLightTarget';
dirLight.target = dirLightTarget;
scene.add(dirLightTarget);
const fillLight = new THREE.DirectionalLight(STYLE.lights.fill.color, STYLE.lights.fill.intensity);
fillLight.position.set(-1000, 2000, 3000);
scene.add(fillLight);
const hemiLight = new THREE.HemisphereLight(STYLE.lights.hemi.sky, STYLE.lights.hemi.ground, STYLE.lights.hemi.intensity);
scene.add(hemiLight);

// ── Environment: daylight + Alishan sunrise demo ─────────────────
const environmentGroup = new THREE.Group();
environmentGroup.name = 'EnvironmentActors';
scene.add(environmentGroup);

let environmentProgress = 0;
let environmentMode = ENV.name || 'daylight';
let latestEnvironmentSample = null;

function resolveSolarModel(env) {
  if (env.name !== 'sunrise-demo') return null;
  const sun = env.sun;
  const lat = sun?.observer?.lat;
  const lng = sun?.observer?.lng;
  if (!sun?.date || !sun?.timeZone || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('DT viewer: sunrise-demo requires sun.date, sun.timeZone, and sun.observer lat/lng');
  }
  const sunrise = findSunrise({
    date: sun.date,
    timeZone: sun.timeZone,
    utcOffsetMinutes: sun.utcOffsetMinutes ?? 0,
    latitude: lat,
    longitude: lng,
    horizonDeg: sun.horizonDeg ?? -0.833,
  });
  return {
    ...sunrise,
    latitude: lat,
    longitude: lng,
    utcOffsetMinutes: sun.utcOffsetMinutes ?? 0,
    horizonDeg: sun.horizonDeg ?? -0.833,
  };
}

const solarModel = resolveSolarModel(ENV);

const SUNRISE_KEYS = [
  {
    t: 0,
    clearColor: 0x17233a,
    sky: { zenith: 0x11172d, horizon: 0x5c4c78, ground: 0x1d2432 },
    ambient: { color: 0x405070, intensity: 0.34 },
    dir: { color: 0xffa35f, intensity: 0.55, elevationDeg: 1, opacity: 0.58 },
    fill: { color: 0x516585, intensity: 0.18 },
    hemi: { sky: 0x405b86, ground: 0x2a241f, intensity: 0.42 },
  },
  {
    t: 0.48,
    clearColor: 0xf1b06d,
    sky: { zenith: 0x608fca, horizon: 0xffb86d, ground: 0x7d4d44 },
    ambient: { color: 0xffd6aa, intensity: 0.58 },
    dir: { color: 0xffbd73, intensity: 2.8, elevationDeg: 3, opacity: 1.0 },
    fill: { color: 0xb8ccff, intensity: 0.26 },
    hemi: { sky: 0xf7c17a, ground: 0x6b5848, intensity: 0.78 },
  },
  {
    t: 1,
    clearColor: STYLE.clearColor,
    sky: STYLE.sky,
    ambient: STYLE.lights.ambient,
    dir: { ...STYLE.lights.dir, elevationDeg: 22, opacity: 0.82 },
    fill: STYLE.lights.fill,
    hemi: STYLE.lights.hemi,
  },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

function lerpSky(a, b, t) {
  return {
    zenith: lerpColor(a.zenith, b.zenith, t),
    horizon: lerpColor(a.horizon, b.horizon, t),
    ground: lerpColor(a.ground, b.ground, t),
  };
}

function sampleSunrise(progress) {
  const p = Math.max(0, Math.min(1, progress));
  let a = SUNRISE_KEYS[0];
  let b = SUNRISE_KEYS[SUNRISE_KEYS.length - 1];
  for (let i = 1; i < SUNRISE_KEYS.length; i++) {
    if (p <= SUNRISE_KEYS[i].t) {
      b = SUNRISE_KEYS[i];
      a = SUNRISE_KEYS[i - 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const local = Math.max(0, Math.min(1, (p - a.t) / span));
  const goldenMin = ENV.goldenWindowMin || 20;
  const solarMs = solarModel
    ? lerp(solarModel.utcMs - goldenMin * 60000, solarModel.utcMs + goldenMin * 2 * 60000, p)
    : null;
  const solar = solarMs == null
    ? null
    : solarPosition(solarMs, solarModel.latitude, solarModel.longitude);
  return {
    clearColor: lerpColor(a.clearColor, b.clearColor, local),
    sky: lerpSky(a.sky, b.sky, local),
    ambient: {
      color: lerpColor(a.ambient.color, b.ambient.color, local),
      intensity: lerp(a.ambient.intensity, b.ambient.intensity, local),
    },
    dir: {
      color: lerpColor(a.dir.color, b.dir.color, local),
      intensity: lerp(a.dir.intensity, b.dir.intensity, local),
      azimuthDeg: solar?.azimuthDeg ?? 90,
      elevationDeg: solar?.elevationDeg ?? lerp(a.dir.elevationDeg, b.dir.elevationDeg, local),
      opacity: lerp(a.dir.opacity, b.dir.opacity, local),
    },
    fill: {
      color: lerpColor(a.fill.color, b.fill.color, local),
      intensity: lerp(a.fill.intensity, b.fill.intensity, local),
    },
    hemi: {
      sky: lerpColor(a.hemi.sky, b.hemi.sky, local),
      ground: lerpColor(a.hemi.ground, b.hemi.ground, local),
      intensity: lerp(a.hemi.intensity, b.hemi.intensity, local),
    },
  };
}

function setLightColor(light, color) {
  light.color.set(color);
}

function setSkySun(sample, dir) {
  if (!skyMesh || skyMesh.material.type !== 'ShaderMaterial') return;
  const uniforms = skyMesh.material.uniforms;
  uniforms.uSunDir.value.copy(dir);
  uniforms.uSunColor.value.set(sample.dir.color);
  uniforms.uSunOpacity.value = sample.dir.opacity;
  uniforms.uSunAngularRadiusDeg.value = ENV.sunAngularRadiusDeg ?? 0.265;
}

function hideSkySun() {
  if (!skyMesh || skyMesh.material.type !== 'ShaderMaterial') return;
  skyMesh.material.uniforms.uSunOpacity.value = 0;
}

function sunDirection(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const horiz = Math.cos(el);
  return new THREE.Vector3(
    Math.sin(az) * horiz,
    Math.cos(az) * horiz,
    Math.sin(el)
  ).normalize();
}

function directionFromYawPitch(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const horiz = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * horiz,
    Math.cos(yaw) * horiz,
    Math.sin(pitch)
  ).normalize();
}

function applyInitialSunriseCameraPose() {
  if (ENV.name !== 'sunrise-demo' || window.DT_SITE.id !== 'alishan') return;
  const vp = ENV.reviewViewpoint;
  if (!vp?.local) return;
  const eyeHeight = vp.eyeHeightM ?? 18;
  const lookDistance = vp.lookDistanceM ?? 4800;
  const cameraPos = new THREE.Vector3(vp.local.x, vp.local.y, vp.local.z + eyeHeight);
  const dir = directionFromYawPitch(vp.yawDeg ?? solarModel?.azimuthDeg ?? 90, vp.pitchDeg ?? -8);
  const target = cameraPos.clone().addScaledVector(dir, lookDistance);
  controls.maxPolarAngle = Math.PI * 0.5;
  controls.target.copy(target);
  camera.position.copy(cameraPos);
  controls.update();
}

applyInitialSunriseCameraPose();

function updateSunAndLight(sample) {
  if (environmentMode !== 'sunrise-demo') return;
  const dir = sunDirection(sample.dir.azimuthDeg, sample.dir.elevationDeg);
  const target = controls.target || new THREE.Vector3(0, 0, window.DT_SITE.cameraTargetZ);
  setSkySun(sample, dir);
  dirLightTarget.position.copy(target);
  dirLight.position.copy(target).addScaledVector(dir, 6000);
}

function applyDaylightEnvironment() {
  environmentMode = 'daylight';
  renderer.setClearColor(STYLE.clearColor);
  setSkyPalette(STYLE.sky);
  setLightColor(ambientLight, STYLE.lights.ambient.color);
  ambientLight.intensity = STYLE.lights.ambient.intensity;
  setLightColor(dirLight, STYLE.lights.dir.color);
  dirLight.intensity = STYLE.lights.dir.intensity;
  dirLight.position.set(2000, 3000, 5000);
  dirLightTarget.position.set(0, 0, window.DT_SITE.cameraTargetZ);
  setLightColor(fillLight, STYLE.lights.fill.color);
  fillLight.intensity = STYLE.lights.fill.intensity;
  hemiLight.color.set(STYLE.lights.hemi.sky);
  hemiLight.groundColor.set(STYLE.lights.hemi.ground);
  hemiLight.intensity = STYLE.lights.hemi.intensity;
  latestEnvironmentSample = null;
  hideSkySun();
  environmentGroup.visible = false;
}

function applyEnvironmentProgress(progress, now) {
  if (ENV.name !== 'sunrise-demo') {
    environmentProgress = 0;
    applyDaylightEnvironment();
    return;
  }
  environmentMode = 'sunrise-demo';
  environmentProgress = Math.max(0, Math.min(1, progress));
  environmentGroup.visible = true;
  const sample = sampleSunrise(environmentProgress);
  latestEnvironmentSample = sample;
  renderer.setClearColor(sample.clearColor);
  setSkyPalette(sample.sky);
  setLightColor(ambientLight, sample.ambient.color);
  ambientLight.intensity = sample.ambient.intensity;
  setLightColor(dirLight, sample.dir.color);
  dirLight.intensity = sample.dir.intensity;
  setLightColor(fillLight, sample.fill.color);
  fillLight.intensity = sample.fill.intensity;
  hemiLight.color.set(sample.hemi.sky);
  hemiLight.groundColor.set(sample.hemi.ground);
  hemiLight.intensity = sample.hemi.intensity;
  updateSunAndLight(sample, now);
}

function parseTimeMinutes(text) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(text || ''));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function progressFromSunriseState(state) {
  if (!state) return null;
  const value = typeof state === 'string' ? state : state.phase || state.state || state.stage;
  if (typeof state === 'object' && Number.isFinite(state.progress)) {
    return Math.max(0, Math.min(1, state.progress));
  }
  if (/pre/i.test(value || '')) return 0.18;
  if (/golden/i.test(value || '')) return 0.48;
  if (/post|morning|day/i.test(value || '')) return 0.88;
  return null;
}

function progressFromFrameTime(timeText) {
  const sunrise = parseTimeMinutes(solarModel?.localTime || ENV.sunriseTime);
  const t = parseTimeMinutes(timeText);
  if (sunrise == null || t == null) return null;
  const golden = ENV.goldenWindowMin || 20;
  const start = sunrise - golden;
  const end = sunrise + golden * 2;
  return Math.max(0, Math.min(1, (t - start) / Math.max(1, end - start)));
}

function applyEnvironmentForFrame(frame, now) {
  if (ENV.name !== 'sunrise-demo') {
    applyDaylightEnvironment();
    return;
  }
  const fromState = progressFromSunriseState(frame?.sunrise_state);
  const fromTime = progressFromFrameTime(frame?.time);
  applyEnvironmentProgress(fromState ?? fromTime ?? environmentProgress, now);
}

function setFramelessEnvironmentProgress(progress, now) {
  applyEnvironmentProgress(progress, now);
  const scrubber = document.getElementById('scrubber');
  if (scrubber && !frameData) {
    scrubber.max = 100;
    scrubber.value = Math.round(environmentProgress * 100);
  }
  const counter = document.getElementById('frame-counter');
  if (counter && !frameData) {
    counter.textContent = `${Math.round(environmentProgress * 100)}% sunrise`;
  }
}

function advanceFramelessEnvironment(deltaMs, now) {
  const loopMs = Math.max(1, (ENV.loopSeconds || 90) * 1000);
  const next = (environmentProgress + deltaMs / loopMs) % 1;
  setFramelessEnvironmentProgress(next, now);
}

function environmentStateForTest() {
  const roots = pickableFeatureRoots();
  const sunOpacity = skyMesh?.material?.uniforms?.uSunOpacity?.value ?? 0;
  return {
    mode: environmentMode,
    progress: environmentProgress,
    sunVisible: sunOpacity > 0.02,
    solarDate: solarModel?.date,
    sunriseTime: solarModel?.localTime,
    sunAzimuthDeg: latestEnvironmentSample?.dir?.azimuthDeg,
    sunElevationDeg: latestEnvironmentSample?.dir?.elevationDeg,
    cloudCount: 0,
    pickExcluded: !roots.includes(skyMesh) && !roots.includes(environmentGroup),
  };
}

// Environment map for PBR materials (hero zone meshes)
(function createEnvMap() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(1, 16, 8);
  const envColors = [];
  const pos = envGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i);
    const t = (ny + 1) * 0.5;
    const c = new THREE.Color().lerpColors(
      new THREE.Color(0x443322), new THREE.Color(0x88aacc), t
    );
    envColors.push(c.r, c.g, c.b);
  }
  envGeo.setAttribute('color', new THREE.Float32BufferAttribute(envColors, 3));
  envScene.add(new THREE.Mesh(envGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const envMap = pmrem.fromScene(envScene).texture;
  scene.environment = envMap;
  pmrem.dispose();
})();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Line2 width is screen-space — material.resolution must track the canvas.
  for (const m of _schematicLineMaterials) m.resolution.set(window.innerWidth, window.innerHeight);
});

// ── Terrain ────────────────────────────────────────────────────
let loadedTerrainMesh = null;  // cached for screen-center raycast (R2)

async function loadTerrain() {
  setLoading('Loading terrain mesh...', 1);
  const loader = new GLTFLoader();
  if (window.DT_SITE.meshopt) {
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder);
  }

  return new Promise((resolve, reject) => {
    loader.load(window.DT_assetUrl('meshes/terrain.glb'),
      (gltf) => {
        let terrainMesh = null;
        gltf.scene.traverse(child => {
          if (child.isMesh) {
            if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
            child.material = new THREE.MeshLambertMaterial({
              vertexColors: true,
              side: THREE.DoubleSide,
              // At-grade paths sit at ground level, so the S6 fit seats terrain
              // on the deck Z (scene-wide median gap ~0.00 m): road ribbon and
              // terrain are coplanar and z-fight along ~90% of edges. This is a
              // depth-test tie, not a data fault (terrain = deck = ground is the
              // honest value). polygonOffset pushes terrain a hair back in the
              // DEPTH BUFFER ONLY so coplanar overlays (roads/walkways) win — no
              // vertex/Z moves, no data masked (≠ the removed
              // SURFACE_TERRAIN_CLEARANCE_M lift). units bumped 1->4: at this
              // scene's near/far=5000 depth range, units:1 lost the tie on
              // near-flat coplanar shelves at distance (camera-dependent flicker,
              // e.g. E-6e0ede3d). Still flickering? escalate units, or fall back
              // to a small world-Z lift on the edges (user-sanctioned).
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 4,
            });
            terrainMesh = child;
          }
        });
        scene.add(gltf.scene);
        layerRoots.terrain = gltf.scene;  // toggleable terrain layer

        if (terrainMesh) {
          const pos = terrainMesh.geometry.attributes.position.array;
          console.log(`Terrain: ${pos.length / 3} vertices`);
          const tIdx = terrainMesh.geometry.index ? terrainMesh.geometry.index.array
            : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);  // non-indexed → sequential tris
          terrainSampler = buildTerrainSampler(pos, tIdx);
          terrainMesh.name = terrainMesh.name || 'terrain';
          loadedTerrainMesh = terrainMesh;
          const terrainPatch = typedRuntime.getElementsBySemanticType('TerrainPatch')[0];
          if (terrainPatch) stampTypedObject(terrainMesh, terrainPatch, 'terrain.glb');
        }

        setLoading('Terrain loaded', 3);
        resolve({ terrain: terrainMesh, lakeZ: LAKE_Z_WGS84 });
      },
      undefined,
      (err) => reject(new Error(`Terrain load failed: ${err.message}`))
    );
  });
}

const LAKE_Z_WGS84 = window.DT_SITE.lakeZ + GEOID_OFFSET;

// ── Terrain height sampler ─────────────────────────────────────
let terrainSampler = null;

// buildTerrainSampler now lives in ../viewer-common/terrain-sampler.mjs — a
// triangle-lookup + barycentric sampler that works on the densified (irregular)
// terrain too, not just a regular grid (#11). The old grid-index sampler read
// garbage on a non-grid mesh and broke building clamp + camera floor.

function clampMeshToTerrain(mesh) {
  if (!terrainSampler) return;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const arr = pos.array;
  const nv = pos.count;
  // PER-BUILDING RIGID clamp: lift each connected component (one building) by its
  // OWN largest below-terrain gap, WITHOUT deforming it. Per-vertex clamping
  // melted rigid structures onto uneven terrain (a DEM mound taller than a
  // building dragged every vertex onto the mound surface → the "building normal"
  // blobs); lifting the whole combined GLB by the global max instead floats every
  // building by the worst mound. Per-component keeps each box rigid, grounded
  // independently, and normals invariant (pure per-component Z translation).
  const idx = geo.index ? geo.index.array : null;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  if (idx) {
    for (let i = 0; i < idx.length; i += 3) { union(idx[i], idx[i + 1]); union(idx[i + 1], idx[i + 2]); }
  }
  const lift = new Map();
  for (let v = 0; v < nv; v++) {
    const tz = terrainSampler(arr[v * 3], arr[v * 3 + 1]);
    if (isNaN(tz)) continue;
    const gap = tz - arr[v * 3 + 2];
    const r = find(v);
    if (gap > (lift.get(r) || 0)) lift.set(r, gap);
  }
  let moved = 0;
  for (let v = 0; v < nv; v++) {
    const l = lift.get(find(v));
    if (l > 0) { arr[v * 3 + 2] += l; moved++; }
  }
  if (moved > 0) pos.needsUpdate = true;  // normals invariant under per-component Z translation
}

// ── glTF Scene Meshes ──────────────────────────────────────────
// Per-twin named meshes (edges.glb, nodes.glb) + backdrop blobs (lake, buildings)
const edgeMaterials = new Map(); // edge_id → material (for flow color updates)

// sml-edge-mesh-merge: collapse edges.glb's ~10.4k per-edge sub-meshes into a
// few BatchedMesh draw calls at load. Per-edge identity (pick / flow / goto /
// diagnostic) is kept via the merge handle's maps. Default ON (gates green +
// visual check passed); `?nomerge` is the kill-switch/rollback to the legacy
// per-node path (full flag removal is a later cleanup once bedded in).
const MERGE_EDGES = !(new URLSearchParams(location.search).has('nomerge'));
let edgeBatch = null; // set by loadMeshes when MERGE_EDGES → the merge handle

// sml-viewer-diagnostic-convergence (layer toggles): root Object3D per toggleable
// layer (the GLB's gltf.scene wrapper, or the terrain wrapper). Hiding a layer
// sets root.visible=false — a VISIBILITY control, never a Z edit. base.html has
// the same toggles (terrain/lake/nodes/surfaces); production lacked them, so the
// coarse terrain mesh buried edges with no way to look underneath.
const layerRoots = {};
const assetDiagnostics = [];

const ASSET_LAYER_FAILURE_UI = {
  supportStructures: {
    labelId: 'toggle-support-structures-label',
    checkboxId: 'toggle-support-structures',
  },
  terrainFaults: {
    labelId: 'toggle-terrain-faults-label',
    checkboxId: 'toggle-terrain-faults',
  },
};

function recordAssetDiagnostic(code, url, error, { layerKey } = {}) {
  const diagnostic = makeAssetErrorDiagnostic(code, url, error);
  assetDiagnostics.push(diagnostic);
  console.error(`[${code}] ${url}: ${diagnostic.message}`);
  if (layerKey && ASSET_LAYER_FAILURE_UI[layerKey]) {
    applyLayerFailureUi(document, ASSET_LAYER_FAILURE_UI[layerKey], diagnostic);
  }
  return diagnostic;
}

// Stage-7 junction plates supersede only the legacy junction meshes named in
// their emitted `dt_covered_junctions` metadata.  This is deliberately an
// identity join, never a proximity rule or a broad N-INT prefix hide.
const junctionPlateCoveredNodes = new Set();
let legacyCoveredJunctionMeshes = [];

function applyJunctionPlateLegacySupersession(platesVisible) {
  const showLegacy = !platesVisible;
  if (edgeBatch) {
    for (const nodeId of junctionPlateCoveredNodes) {
      edgeBatch.setEdgeVisible(nodeId, showLegacy);
    }
    return;
  }
  legacyCoveredJunctionMeshes.forEach((mesh) => { mesh.visible = showLegacy; });
}

function configureJunctionPlateLegacySupersession() {
  junctionPlateCoveredNodes.clear();
  legacyCoveredJunctionMeshes = [];
  const platesRoot = layerRoots.junctionPlates;
  if (!platesRoot) return;
  platesRoot.traverse((mesh) => {
    if (!mesh.isMesh || mesh.userData?.dt_type !== 'junction_plate') return;
    const covered = mesh.userData?.dt_covered_junctions;
    if (!Array.isArray(covered) || covered.some((nodeId) => typeof nodeId !== 'string')) {
      console.warn('[junction-plates] missing exact dt_covered_junctions metadata', mesh.name);
      return;
    }
    covered.forEach((nodeId) => junctionPlateCoveredNodes.add(nodeId));
  });
  if (!edgeBatch) {
    const edgesRoot = layerRoots.edges;
    edgesRoot?.traverse((mesh) => {
      if (
        mesh.isMesh
        && mesh.userData?.dt_type === 'junction'
        && junctionPlateCoveredNodes.has(mesh.userData?.dt_edge_id)
      ) legacyCoveredJunctionMeshes.push(mesh);
    });
  }
  applyJunctionPlateLegacySupersession(platesRoot.visible !== false);
}

// viewer-schematic-diagnosis-layer: the authored-graph "diagnosis" layer (Line2
// fat lines from edges.json polyline_3d) + its per-line materials (kept in sync
// with the canvas on resize) + the visibility snapshot taken on entering the
// exclusive diagnosis mode (so exiting restores the prior terrain/lake/edges state).
let _schematicGroup = null;
let _schematicLineMaterials = [];
let _diagModeSnapshot = null;

async function loadMeshes() {
  const loader = new GLTFLoader();
  if (window.DT_SITE.meshopt) {
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  setLoading('Loading scene meshes...', 4);

  const lakeMat = new THREE.MeshStandardMaterial({
    color: 0x2266aa, metalness: 0.1, roughness: 0.3,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: true,
  });

  const buildingMat = new THREE.MeshPhongMaterial({
    // Per-style palette (RENDER_STYLES.building): classic keeps the original
    // warm gray (SML byte-identical); apple gets the matte near-white.
    color: STYLE.building.color, side: THREE.DoubleSide, flatShading: true,
    specular: STYLE.building.specular, shininess: STYLE.building.shininess,
  });

  // M9 S7 support structures are ordinary opaque world geometry.  They get
  // their own material and layer only so the Director can inspect/toggle the
  // structure independently; normal depth behavior remains authoritative.
  const supportMat = new THREE.MeshStandardMaterial({
    color: 0x8f8b82, metalness: 0.0, roughness: 0.92,
    transparent: false, opacity: 1.0, side: THREE.DoubleSide,
    depthTest: true, depthWrite: true,
  });

  // Helper: load a GLB and register named sub-meshes in twinRegistry
  function loadGLB(url, opts = {}) {
    return new Promise((resolve, reject) => {
      loader.load(url,
        (gltf) => {
          let count = 0;
          gltf.scene.traverse(child => {
            if (child.isMesh) {
              const appearanceSource = resolveAppearanceSource({
                hasExplicitMaterial: !!opts.material,
                preserveDeclaredAppearance: !!opts.preserveDeclaredAppearance,
                declaresMaterials: gltfPrimitiveDeclaresMaterial(gltf, child),
              });
              if (!child.geometry.attributes.normal) {
                child.geometry.computeVertexNormals();
              }
              if (opts.material) {
                child.material = opts.material;
              } else if (opts.preservePBR && child.material && child.material.isMeshStandardMaterial) {
                // Keep embedded PBR material from hero zone GLBs
              } else if (appearanceSource === APPEARANCE_DECLARED) {
                // GLTFLoader shares authored materials across primitives and
                // reused nodes. Presentation mutates per mesh: isolate the
                // material so first-frame overrides cannot contaminate the
                // next mesh's remembered base. Textures remain shared.
                child.material = child.material.clone();
              } else {
                const hasVC = child.geometry.attributes.color != null;
                child.material = new THREE.MeshLambertMaterial({
                  vertexColors: hasVC,
                  color: hasVC ? 0xffffff : 0x888888,
                  side: THREE.DoubleSide,
                });
              }
              if (opts.clamp) clampMeshToTerrain(child);
              // Stamp arbitrary userData fields (used by elevated-structure meshes)
              if (opts.userData) {
                Object.assign(child.userData, opts.userData);
              }
              if (opts.contextRequest) {
                Object.assign(child.userData, {
                  authority_scope: CONTEXT_AUTHORITY_SCOPE,
                  context_role: opts.contextRequest.role,
                  context_id: opts.contextRequest.stable_id,
                  source_ref: opts.contextRequest.source_ref,
                  notice_ref: opts.contextRequest.notice_ref,
                });
              }
              // Register named meshes in twin registry.
              // sml-base-network-mesh names meshes as `<edge_id>/<role>` so a
              // single edge can carry multiple child meshes (ribbon, railing_left,
              // railing_right, deck, pillars, junction, plaza, ...). Register
              // both the full name AND the leading edge_id token so legacy
              // twinRegistry lookups by raw twin_id keep working.
              if (opts.registerTwins && child.name) {
                const fullName = child.name;
                // sml-base-network-mesh uses `__` (GLTFLoader-safe) to join
                // edge_id and role; legacy mesh names (pre-base-network-mesh)
                // are the raw twin_id with no role suffix.
                const sepIdx = fullName.indexOf('__');
                const twinId = sepIdx >= 0 ? fullName.slice(0, sepIdx) : fullName;
                const role = sepIdx >= 0 ? fullName.slice(sepIdx + 2) : null;
                // Stamp dt_userData (carries through from Trimesh.metadata via
                // GLB extras). Trimesh exports metadata into mesh.userData on
                // the three-loader side.
                if (role && !child.userData.dt_type) {
                  // Heuristic fallback for ribbon/deck/etc if metadata didn't
                  // come through — derive a coarse dt_type from the role name.
                  child.userData.dt_type = role;
                }
                if (!child.userData.dt_edge_id) child.userData.dt_edge_id = twinId;
                twinRegistry.set(fullName, child);
                // Only register the bare twin_id once per edge (first child wins).
                if (!twinRegistry.has(twinId)) {
                  twinRegistry.set(twinId, child);
                }
                const typedElement = typedRuntime.getElement(twinId);
                if (typedElement) stampTypedObject(child, typedElement, url);
                if (opts.trackMaterials && !MERGE_EDGES) {
                  // Under merge the batch owns edge color; edgeMaterials is unused.
                  edgeMaterials.set(fullName, child.material);
                  if (!edgeMaterials.has(twinId)) edgeMaterials.set(twinId, child.material);
                }
                // Extract centroid Z for node meshes (authoritative DEM elevation)
                if (opts.extractNodeZ && twinId.startsWith('N')) {
                  const pos = child.geometry.attributes.position.array;
                  let zSum = 0, cnt = 0;
                  for (let i = 2; i < pos.length; i += 3) { zSum += pos[i]; cnt++; }
                  glbNodeZ.set(twinId, zSum / cnt);
                }
                count++;
              }
            }
          });
          if (opts.mergeEdges && MERGE_EDGES) {
            // sml-edge-mesh-merge: collapse the per-edge sub-meshes into a few
            // BatchedMesh draw calls. The originals stay referenced by
            // twinRegistry (goto/extent read their baked-world geometry) but are
            // NOT added to the scene → zero draw calls, never raycast.
            edgeBatch = mergeEdgesIntoBatches(THREE, gltf.scene);
            scene.add(edgeBatch.group);
            if (opts.layer) layerRoots[opts.layer] = edgeBatch.group;  // toggleable
            // I1: the per-edge materials are unused under merge (the batch owns
            // color); dispose them to reclaim memory. Geometry is retained (the
            // originals stay in twinRegistry) for goto-extent framing.
            gltf.scene.traverse((o) => { if (o.isMesh && o.material) o.material.dispose(); });
            console.log(`  ${url}: merged ${edgeBatch.edgeInstances.size} edges -> `
              + `${edgeBatch.drawCallCount} draw call(s)`);
          } else {
            scene.add(gltf.scene);
            if (opts.layer) layerRoots[opts.layer] = gltf.scene;  // toggleable layer
          }
          if (opts.contextRequest) {
            const inspection = contextInspectionRecord(opts.contextRequest);
            gltf.scene.userData = {
              ...gltf.scene.userData,
              authority_scope: CONTEXT_AUTHORITY_SCOPE,
              context_role: opts.contextRequest.role,
              context_id: opts.contextRequest.stable_id,
              source_ref: opts.contextRequest.source_ref,
              notice_ref: opts.contextRequest.notice_ref,
            };
            contextRegistry.set(opts.contextRequest.stable_id, {
              request: opts.contextRequest,
              inspection,
              root: gltf.scene,
            });
          }
          if (count > 0) console.log(`  ${url}: ${count} named twins registered`);
          resolve({ url, scene: gltf.scene, twins: count });
        },
        undefined,
        (err) => {
          if (opts.diagnosticCode) {
            recordAssetDiagnostic(opts.diagnosticCode, opts.diagnosticUrl || url, err, {
              layerKey: opts.layer,
            });
          } else console.warn(`Failed to load ${url}:`, err);
          if (opts.contextRequest || opts.optionalResource?.required) {
            reject(opts.optionalResource
              ? new Error(`required optional resource ${opts.optionalResource.role} unavailable at ${url}`, { cause: err })
              : err);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  if (window.DT_SITE.progressiveLoading) {
    const nodes = await loadGLB(window.DT_assetUrl('meshes/nodes.glb'), {
      registerTwins: true, extractNodeZ: true, layer: 'nodes',
    });
    if (!nodes) throw new Error('Required startup nodes failed to load');
    // Optional site contract: a site may pin its startup node count so a
    // truncated or stale nodes.glb fails loudly instead of rendering partially.
    const expectedNodes = window.DT_SITE.startupNodeCount;
    if (Number.isInteger(expectedNodes) && nodes.twins !== expectedNodes) {
      throw new Error(`Site startup requires ${expectedNodes} nodes; loaded ${nodes.twins}`);
    }
    const details = [
      ['edges', { registerTwins: true, trackMaterials: true, layer: 'edges', mergeEdges: true }],
      ['buildings', { material: buildingMat, clamp: true, layer: 'buildings', userData: { dt_layer: 'buildings' } }],
    ].filter(([key]) => window.DT_hasLayer(key));
    // Bind toggles now; their handlers look up the current root on each change.
    for (const [key] of details) layerRoots[key] = new THREE.Group();
    return async () => Promise.all(details.map(async ([key, opts]) => {
      const pendingRoot = layerRoots[key];
      const result = await loadGLB(window.DT_assetUrl(`meshes/${key}.glb`), opts);
      if (!result) throw new Error(`Deferred ${key} failed to load`);
      layerRoots[key].visible = pendingRoot.visible;
    }));
  }

  async function fetchRequiredSupportJson(path) {
    const url = window.DT_assetUrl(path);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`${path} is not valid JSON: ${error.message}`);
    }
  }

  async function fetchRequiredSupportGlb(path) {
    const url = window.DT_assetUrl(path);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { arrayBuffer, sha256: `sha256:${hex}` };
  }

  async function loadSupportStructures() {
    const glbUrl = window.DT_assetUrl('meshes/support_structures.glb');
    try {
      const [manifest, sidecar, glb] = await Promise.all([
        fetchRequiredSupportJson('meshes/manifest.json'),
        fetchRequiredSupportJson('meshes/support_structures.glb.provenance.json'),
        fetchRequiredSupportGlb('meshes/support_structures.glb'),
      ]);
      const { structure } = validateSupportAssetMetadata(manifest, sidecar, {
        artifactSha256: glb.sha256,
      });
      const objectUrl = URL.createObjectURL(new Blob([glb.arrayBuffer], {
        type: 'model/gltf-binary',
      }));
      try {
        return await loadGLB(objectUrl, {
          material: supportMat,
          layer: 'supportStructures',
          diagnosticCode: 'support-structure-load',
          diagnosticUrl: glbUrl,
          userData: supportStructureUserData(sidecar, structure),
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      recordAssetDiagnostic('support-structure-load', glbUrl, error, {
        layerKey: 'supportStructures',
      });
      return null;
    }
  }

  // Depth-tested organizational order: terrain is already present before this
  // function; load lake, then supports, before any deck/edge member.  This is
  // not a display-Z or visibility override.
  const preDeck = [];
  if (window.DT_hasLayer('lake')) preDeck.push(await loadGLB(
    window.DT_assetUrl('meshes/lake.glb'), { material: lakeMat, layer: 'lake' },
  ));
  if (window.DT_hasLayer('supportStructures')) {
    preDeck.push(await loadSupportStructures());
  }

  // Remaining optional layers — only loaded if the active site declares them
  // (a site without docks/etc. skips it; viewer-3d-site-agnostic D3).
  const optional = [];
  // dt_layer stamp: buildings.glb is ONE merged mesh (no per-twin identity) —
  // the click router resolves a buildings hit by PROXIMITY to the descriptive
  // POI registry, keyed on this stamp (sml-poi-descriptive-cards).
  if (window.DT_hasLayer('buildings')) optional.push(loadGLB(window.DT_assetUrl('meshes/buildings.glb'), { material: buildingMat, clamp: true, layer: 'buildings', userData: { dt_layer: 'buildings' } }));
  if (window.DT_hasLayer('docks'))     optional.push(loadGLB(window.DT_assetUrl('meshes/docks.glb'), { clamp: true, layer: 'docks' }));
  if (window.DT_hasLayer('junctionPlates')) optional.push(loadGLB(
    window.DT_assetUrl('meshes/junction_plates.glb'), { layer: 'junctionPlates' },
  ));
  // Conifer dressing — terrain-raycast tree impostors, one merged mesh (vertex colours -> matte Lambert).
  if (window.DT_hasLayer('trees')) optional.push(loadGLB(window.DT_assetUrl('meshes/trees.glb'), { layer: 'trees' }));

  // Hero prop assets (video-recon-hero-prop): config-declared anchored GLBs,
  // grouped under one toggleable 'props' layer. Not terrain, not graph — a
  // failed fetch warns and leaves the rest of the scene intact (loadGLB
  // resolves null on error). Sites without a props declaration create no
  // layer root, so the props checkbox stays hidden and rendering is unchanged.
  const siteProps = (window.DT_SITE && window.DT_SITE.props) || [];
  if (siteProps.length > 0) {
    const propsGroup = new THREE.Group();
    propsGroup.name = 'props';
    scene.add(propsGroup);
    layerRoots.props = propsGroup;
    let contextPropsGroup = null;
    const getContextPropsGroup = () => {
      if (contextPropsGroup) return contextPropsGroup;
      // Source: Farm source package stable_prop_inventory path_group="context"
      // and site-bake-pipeline/spec.md:140-147: context props occupy a
      // physically separate static context catalog.
      contextPropsGroup = new THREE.Group();
      contextPropsGroup.name = 'context-props';
      scene.add(contextPropsGroup);
      layerRoots.contextProps = contextPropsGroup;
      return contextPropsGroup;
    };
    for (const p of siteProps) {
      if (p.authority_scope && p.authority_scope !== CONTEXT_AUTHORITY_SCOPE) {
        throw new Error(`site-layer consumer: unsupported prop authority ${p.authority_scope}`);
      }
      const isContextProp = p.authority_scope === CONTEXT_AUTHORITY_SCOPE;
      const isAuthoredProp = typeof p.origin_kind === 'string'
        && p.origin_kind !== CONTEXT_PROP_ORIGIN_KIND;
      const propOpts = isContextProp
        ? {
            // Source: the pre-existing viewer `props` layer root; the loaded
            // scene is moved to the separate contextProps group below.
            contextRequest: {
              role: p.context_role,
              path: p.path,
              root: 'props',
              kind: 'glb',
              stable_id: p.id,
              authority_scope: p.authority_scope,
              source_ref: p.source_ref,
              notice_ref: p.notice_ref,
            },
          }
        : isAuthoredProp
          ? { authoredProp: authoredPropInspection(p) }
          : {};
      propOpts.preserveDeclaredAppearance = readAppearanceDeclaration(p, `prop ${p.id}`);
      optional.push(loadGLB(window.DT_assetUrl(p.path), propOpts).then((r) => {
        if (r && r.scene) {
          r.scene.visible = p.visible !== false;
          // identity stamp (PR #51 review finding 1): without it a prop click
          // shows the debug tooltip and falls through to hideInspector(). The
          // {twinId, name} shape routes to the node-marker inspector branch.
          r.scene.traverse((o) => {
            if (o.isMesh) {
              Object.assign(o.userData, {
                kind: 'prop', propId: p.id, name: p.label || p.id,
                ...(p.authority_scope ? { authority_scope: p.authority_scope } : {}),
                ...(p.context_role ? { context_role: p.context_role } : {}),
                ...(p.context_role ? { context_id: p.id } : {}),
                ...(p.source_ref ? { source_ref: p.source_ref } : {}),
                ...(p.notice_ref ? { notice_ref: p.notice_ref } : {}),
                ...(p.origin_kind ? { origin_kind: p.origin_kind } : {}),
                ...(!p.authority_scope && !p.origin_kind && p.twin ? { twinId: p.twin } : {}),
              });
            }
          });
          if (isContextProp) {
            // loadGLB has already placed the context request in the separate
            // contextRegistry; no context prop may enter twinRegistry.
          } else if (isAuthoredProp) {
            authoredPropRegistry.set(p.id, { scene: r.scene, record: propOpts.authoredProp });
          } else if (!twinRegistry.has(p.id)) {
            // Legacy SML prop path: no new authority metadata means the old
            // twin registration and p.twin stamp remain exactly unchanged.
            twinRegistry.set(p.id, r.scene);
          }
          const targetGroup = isContextProp
            ? getContextPropsGroup()
            : propsGroup;
          targetGroup.add(r.scene);  // three.js reparents out of `scene`
        }
        return r;
      }));
    }
  }

  // Splat display lane (sml-hero-splat-v2): photoreal Gaussian splats over
  // the same captures as the mesh props. Display-only — the mesh prop keeps
  // raycast/pick duty (the Raycaster ignores visibility, so a hidden mesh
  // still picks). A splat that loads takes display duty from its meshProps
  // (applied in installLayerToggles, after ALL loads, so registration order
  // can't race); a 404/renderer failure warns and the mesh stays visible.
  // The renderer module is imported dynamically so sites without splats pay
  // nothing. sharedMemoryForWorkers=false: our servers send no COOP/COEP.
  const siteSplats = (window.DT_SITE && window.DT_SITE.splats) || [];
  if (siteSplats.length > 0) {
    const splatsGroup = new THREE.Group();
    splatsGroup.name = 'splats';
    scene.add(splatsGroup);
    layerRoots.splats = splatsGroup;
    optional.push((async () => {
      let gs;
      try {
        gs = await import('@mkkellogg/gaussian-splats-3d');
      } catch (e) {
        console.warn('[splats] renderer module failed to load — mesh props stay visible', e);
        return null;
      }
      // ONE DropInViewer hosting every splat scene: the library's supported
      // multi-scene path is repeated addSplatScene on a single instance (its
      // demos do exactly this). Two separate DropInViewers rendered only the
      // last-added one (observed: 文武廟 fine, 拉魯島 invisible).
      const dropIn = new gs.DropInViewer({ sharedMemoryForWorkers: false });
      dropIn.name = 'splats-dropin';
      Object.assign(dropIn.userData, { kind: 'splat' });
      for (const sp of siteSplats) {
        try {
          const url = window.DT_assetUrl(sp.path);
          // fail FAST on a missing asset: the library's addSplatScene never
          // settles on a 404 (observed: it hangs the whole boot batch), so
          // probe first, and race a timeout as the belt for hung parses.
          const head = await fetch(url, { method: 'HEAD' });
          if (!head.ok) throw new Error(`HTTP ${head.status} for ${sp.path}`);
          await Promise.race([
            dropIn.addSplatScene(url, {
              showLoadingUI: false,
              splatAlphaRemovalThreshold: 5,
            }),
            new Promise((_, reject) => setTimeout(
              () => reject(new Error(`splat load timed out: ${sp.path}`)), 20000)),
          ]);
          splatMeshPairs.push({
            id: sp.id, twin: sp.twin, meshIds: sp.meshProps || [],
          });
        } catch (e) {
          console.warn(`[splats] ${sp.id} failed to load — mesh prop stays visible`, e);
        }
      }
      if (splatMeshPairs.length > 0) {
        // Transparent-pass ordering: both the splat mesh and lake.glb sit at
        // the world origin, so three.js' distance sort ties and the lake can
        // blend 0.85-opacity blue OVER the splat (design open question 2,
        // observed on 拉魯島). renderOrder beats distance sort — draw splats
        // after the water.
        dropIn.traverse((o) => { o.renderOrder = 10; });
        splatsGroup.add(dropIn);
      }
      return null;
    })());
  }

  // Farm context is manifest-bound. A site with no explicit role declaration
  // takes no branch here, preserving the SML/default load graph exactly.
  if (siteHasDeclaredContextRoles()) {
    optional.push((async () => {
      const manifestPath = window.DT_SITE.contextLayerManifest;
      if (typeof manifestPath !== 'string' || manifestPath.trim() === '') {
        throw new Error('site-layer consumer: declared context roles require contextLayerManifest');
      }
      const manifestUrl = resolveContextManifestUrl(window.DT_SITE);
      const response = await fetch(manifestUrl);
      if (!response.ok) {
        throw new Error(`site-layer consumer: context manifest unavailable at ${manifestPath}`);
      }
      renderedStaticManifestBytes = await response.arrayBuffer();
      const requests = resolveDeclaredLayerRequests(window.DT_SITE, JSON.parse(new TextDecoder().decode(renderedStaticManifestBytes)));
      // The package's provenance catalog answers appearance_provenance_ref,
      // which otherwise points at a profile row the package does not ship. A
      // package without the catalog leaves the reference unresolved rather
      // than failing the scene, and nothing is substituted for the values.
      try {
        const catalogResponse = await fetch(resolveProvenanceCatalogUrl(window.DT_SITE));
        if (catalogResponse.ok) {
          applyProvenanceCatalog(requests, await catalogResponse.json());
        }
      } catch (provenanceError) {
        console.warn('site-layer consumer: provenance catalog unavailable', provenanceError);
      }
      for (const request of requests) {
        // painted-terrain and river-zone-paint are metadata-only records for
        // the already-loaded terrain surface. They must never fetch terrain a
        // second time or enter twinRegistry.
        if (request.alias_of) {
          registerContextTerrainAlias(request);
          continue;
        }
        if (request.kind === 'json' || request.kind === 'labels') {
          await loadPoiLabels({
            url: request.url,
            layer: request.root,
            contextRequest: request,
          });
        } else {
          await loadGLB(request.url, {
            layer: request.root,
            contextRequest: request,
            preserveDeclaredAppearance: readAppearanceDeclaration(
              request, `context role ${request.role}`,
            ),
          });
        }
      }
    })());
  }

  const concurrent = await Promise.all([
    // Per-twin named meshes (core — every site)
    loadGLB(window.DT_assetUrl('meshes/edges.glb'), { registerTwins: true, trackMaterials: true, layer: 'edges', mergeEdges: true }),
    loadGLB(window.DT_assetUrl('meshes/nodes.glb'), { registerTwins: true, extractNodeZ: true, layer: 'nodes' }),
    // Backdrop (not in graph), per-site
    ...optional,
    // cycleways.glb, roads.glb, trails.glb, ropeway.glb — superseded by edges.glb
    // Hero zone test — requested only for a site that declares the resource.
    ...(() => {
      const resource = window.DT_optionalResource(
        'heroRailing', 'meshes/test_hero_railing.glb',
      );
      return resource
        ? [loadGLB(resource.url, { preservePBR: true, optionalResource: resource })]
        : [];
    })(),
  ]);
  const results = [...preDeck.filter(Boolean), ...concurrent];

  // Elevated structures (sml-bridge-deck-z, deprecated 2026-05-24):
  // Per-route decks + pillars under data/sml/elevated_meshes/ have been
  // subsumed by data/sml/meshes/edges.glb via sml-base-network-mesh.
  // Elevated deck + pillar meshes now live inside edges.glb with
  // userData.dt_type ∈ {'elevated_deck', 'elevated_pillars'}.
  // The old manifest fetch was removed here.


  const loaded = results.filter(Boolean);
  configureJunctionPlateLegacySupersession();
  const totalTwins = loaded.reduce((s, r) => s + (r.twins || 0), 0);
  console.log(`Loaded ${loaded.length} GLBs, ${totalTwins} twins registered`);
  return loaded;
}

// ── sml-viewer-diagnostic-convergence: Z-fault diagnostics ──────────
// The cliff / submerged / steep verdicts are computed on the AUTHORITATIVE
// edges.json centerline polyline + z_lineage (the synth's output, the source of
// truth) via the shared viewer-common/diagnostics.js, then attached to the
// rendered edges.glb meshes by dt_edge_id. Picking uses production's mesh
// raycast (angle-independent), which fixes base.html's oblique-angle wrong-edge
// line-pick by construction (no THREE.Line is ever rendered or picked here).
// Fault colors are sourced from the DIAGNOSTIC_AXES registry (the SSOT in
// viewer-common/diagnostics.js) — NOT redefined here. One table owns every color,
// so a collision is structurally impossible (and caught by the registry test).
const CLIFF_COLOR = DIAGNOSTIC_AXES.cliff.color;        // red    — unjustified node-Z cliff
const SUBMERGED_COLOR = DIAGNOSTIC_AXES.submerged.color; // magenta — driving edge below the lake disk
const STEEP_SLOPE_COLOR = DIAGNOSTIC_AXES.steep.color;  // yellow — walking/cycling above mode cap
const OVERLAP_COLOR = DIAGNOSTIC_AXES.overlap.color;    // cyan   — overlapping/duplicate cross-mode edges (topological)
const BELOW_LAKE_COLOR = DIAGNOSTIC_AXES.belowLake.color; // deep blue — any node/deck vert below lake full-pool, in/near the lake
const STAIRS_FLAT_COLOR = DIAGNOSTIC_AXES.stairsFlat.color; // rose — staircase leveled vs its OSM step_count evidence
const DIAG_BEACON_SCREEN_SIZE = 0.022;  // ~2.2% of viewport height, sizeAttenuation off

// T2 sim-node spheres (ported from base.js): structural graph nodes that are
// NOT in edges.glb, so they get their own pickable depthTest-off spheres behind
// the diagnostics toggle. Muted role colours; cliff-flanking nodes red + larger.
const T2_SIM_SPHERE_GEO = new THREE.SphereGeometry(2, 8, 6);
const CLIFF_SPHERE_GEO = new THREE.SphereGeometry(6, 12, 8);
// Terrain-fault pins (5th axis): grounded ON the terrain (surface_z), depth-tested so
// hills occlude them, and pickable — a real mesh in diagGroup auto-joins raycastHitsAt's
// pick set. World-space (radius ~18 m) so they vanish in the ~35 km aerial (the recolored
// edges carry the global signal) and read as ground markers when you zoom to inspect.
const TERRAIN_FAULT_PIN_RADIUS = 6;
const TERRAIN_FAULT_PIN_GEO = new THREE.SphereGeometry(TERRAIN_FAULT_PIN_RADIUS, 12, 8);
const _terrainFaultPinMats = new Map();   // color -> shared MeshBasicMaterial
function makeGroundPin(color, [x, y, z], name, userData) {
  let mat = _terrainFaultPinMats.get(color);
  // toneMapped:false on ALL diagnostic/marker materials: registry colors must
  // render the exact DIAGNOSTIC_AXES hex the legend chip (DOM CSS) shows —
  // ACES on apple-graded sites would desaturate/hue-shift them otherwise.
  if (!mat) { mat = new THREE.MeshBasicMaterial({ color, toneMapped: false }); _terrainFaultPinMats.set(color, mat); }
  const pin = new THREE.Mesh(TERRAIN_FAULT_PIN_GEO, mat);
  pin.position.set(x, y, z + TERRAIN_FAULT_PIN_RADIUS);   // rest the ball ON the surface, not half-buried
  pin.name = name;
  pin.userData = userData;
  return pin;
}
// Stamp a diagnostic color onto a legacy per-edge GLB material (the merge
// path routes through the batch material, toneMapped:false at creation).
// Kills vertexColors AND tone mapping together: the stamped registry hex must
// render exactly, matching the DOM legend chip (see makeGroundPin note).
function stampDiagEdgeColor(mat, hex) {
  if (mat.vertexColors || mat.toneMapped) {
    mat.vertexColors = false;
    mat.toneMapped = false;
    mat.needsUpdate = true;
  }
  mat.color.setHex(hex);
}
const T2_SIM_COLOR_BY_ROLE = {
  intersection: 0x707070,  // medium gray — graph junction
  terminus:     0xa0a0a0,  // light gray — way endpoint
  waypoint:     0x4488cc,  // blue — T1-serving
  entrance:     0xff8844,  // orange — reserved for mode pass
};

const DIAG = {
  intersections: [],
  edges: [],
  cliffNodeCount: 0,
  submergedCount: 0,
  steepSlopeCount: 0,
  submergedEdgeIds: [],
  steepEdgeIds: [],
  cliffNodeIds: [],
  overlapCount: 0,
  overlapEdgeIds: [],
  overlapPairs: [],
  simNodes: [],
  simNodesGroup: null,
  diagnosticsGroup: null,
  beaconCount: 0,
  // edgeId → fault color hex for every edge recolored by a master-toggle axis
  // (submerged/steep/overlap/below-lake). The Diagnostics toggle applies these
  // on ON and resets edges to their base color on OFF — a fault color is only
  // on screen when diagnostics are. (terrain-fault edges ride their OWN toggle,
  // so they are recorded separately, not here.)
  edgeColorById: new Map(),
  belowLakeCount: 0,
  belowLakeNodeIds: new Set(),   // node twin_ids below full-pool in/near the lake
  belowLakeEdgeIds: [],          // edges with a below-full-pool deck vert near the lake
  belowLakeAxisDisabled: false,  // true iff a DECLARED lake layer failed to yield geometry
  stairsFlatCount: 0,            // violating step-counted ways (mirrors Gate A's allowlist)
  stairsFlatWayIds: [],
  stairsFlatEdgeIds: [],
  // edgeId → fault color for every edge recolored by a master-toggle axis
  // (submerged/steep/overlap/below-lake). The Diagnostics toggle applies these on
  // ON and resets each edge to its captured base color on OFF — so a fault color is
  // only on screen when diagnostics are. (Ported from the #54 toggle fix; below-lake
  // is wired in here too. When #54 merges, this reconciles to one copy.)
  edgeColorById: new Map(),
  // edgeId → terrain-fault color. Terrain-fault recolors are ALWAYS-ON (the pins ride
  // their own toggle; the edge color carries the global signal), so they must NOT be
  // toggle-managed: the terrain-fault pass records here and evicts the id from
  // edgeColorById, so a dual-fault edge (terrain + overlap/below-lake) keeps its
  // terrain color across Diagnostics ON (no cyan re-apply) and OFF (no base reset).
  terrainFaultColorById: new Map(),
};

// ── sml-viewer-goto-edge-index: goto index over ALL edges.json edges ──
// gotoTwin resolves typed ids + twinRegistry ids + node names today, so an edge
// that did NOT render into a registered GLB mesh (e.g. an overlay hero, or any
// non-edges.glb edge) is unreachable by id. We index ALL edges from edges.json
// (the same fetch loadDiagnostics already does) so any edge id/name resolves and
// the camera flies to its ENU centroid — not limited to rendered/hero edges.
//   edgeGotoEntries: [{ id, name? }]  — appended AFTER node indexes (precedence)
//   edgeGotoCentroids: Map(edgeId → [x, y, z])  — ENU centroid of polyline_3d
// Populated in loadDiagnostics; empty until then (gotoTwin degrades gracefully).
let edgeGotoEntries = [];
const edgeGotoCentroids = new Map();
// edgeGotoSizes: Map(edgeId → [sx, sy, sz]) ENU bbox size, so goto frames the
// WHOLE edge (size 0 → MIN_STANDOFF buries the camera under the hillside for an
// elevated boardwalk cut into a slope). Mirrors the rendered-edge _polylineBboxSize.
const edgeGotoSizes = new Map();

// Build a screen-constant beacon sprite at a verdict point. Legacy raw markers
// keep the always-on-top visual-only defaults; causal markers opt into normal
// depth testing and the dedicated pick path below.
function makeBeacon(color, [x, y, z], name, userData, {
  depthTest = false,
  renderOrder = 1000,
} = {}) {
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
    color, depthTest, depthWrite: false, sizeAttenuation: false,
    toneMapped: false,   // exact registry hex (see makeGroundPin)
  }));
  beacon.scale.set(DIAG_BEACON_SCREEN_SIZE, DIAG_BEACON_SCREEN_SIZE, 1);
  beacon.position.set(x, y, z);
  beacon.renderOrder = renderOrder;
  beacon.name = name;
  beacon.userData = userData;
  return beacon;
}

// Build isNearLake(lat,lng)->bool from the loaded lake.glb footprint — lake.glb
// IS the lake polygon (viewer-common has no separate outline). A point is "near
// the lake" if its projected XY is within BELOW_LAKE_NEAR_M of any lake-surface
// vertex: the client-side analogue of the synth's signed-distance-to-polygon test
// (sml-below-lake-floor), reaching the same over-water band beyond the ~11 m-inland
// polygon. A bbox pre-filter fast-rejects the many inland-low nodes before the
// per-vertex scan. Returns () => false if the lake mesh isn't loaded (the axis then
// simply shows nothing — graceful, like a site with no lake).
// Verified (sml-below-lake-floor): at 22 m this nearest-VERTEX test reproduces the
// synth's signed-distance-to-polygon deck classification EXACTLY (20 below-lake deck
// edges either way; 0 miss, 0 extra). Nearest-vertex slightly over-estimates distance
// vs nearest-edge on sparse boundary segments, but such near-shore nodes are floored
// to the lid upstream, so shipped data has no below-pool node for it to miss.
const BELOW_LAKE_NEAR_M = 22;   // matches the synth node reach (NODE_LAKE_NEAR_DIST_M)
function buildIsNearLake() {
  const pts = [];
  const lakeRoot = layerRoots.lake;
  if (lakeRoot) {
    const v = new THREE.Vector3();
    lakeRoot.updateWorldMatrix(true, true);
    lakeRoot.traverse((o) => {
      const pos = o.isMesh && o.geometry && o.geometry.getAttribute && o.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        pts.push(v.x, v.y);
      }
    });
  }
  if (!pts.length) {
    // Distinguish "no lake by config" (correct no-op) from "declared lake failed to
    // load" (a silent false-0 that reads as success — the axis would measure nothing
    // yet report the same numbers as a clean census). Fail LOUD for the latter and
    // mark the axis disabled so the legend/console show '—', never a bare 0. Mirrors
    // buildSimNodeLayer's "fail loudly on a missing load-bearing input" stance.
    if (window.DT_hasLayer && window.DT_hasLayer('lake')) {
      console.error('[below-lake] site declares a lake layer but lake.glb produced no '
        + 'vertices (fetch/parse failed, or loadDiagnostics ran before the lake load). '
        + 'The below-lake census would be a false 0 — axis DISABLED. Rebuild meshes '
        + '(make viewer-assets) or check the lake.glb load warning above.');
      DIAG.belowLakeAxisDisabled = true;
    }
    return () => false;   // genuinely lakeless site — correct no-op
  }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  const m = BELOW_LAKE_NEAR_M, n2 = m * m;
  return (lat, lng) => {
    const [x, y] = geoToLocal(lat, lng);
    if (x < minx - m || x > maxx + m || y < miny - m || y > maxy + m) return false;  // fast inland reject
    for (let i = 0; i < pts.length; i += 2) {
      const dx = x - pts[i], dy = y - pts[i + 1];
      if (dx * dx + dy * dy <= n2) return true;
    }
    return false;
  };
}

async function loadDiagnostics() {
  setLoading('Loading Z-fault diagnostics...', 6);
  const [iResp, eResp, sResp] = await Promise.all([
    fetch(window.DT_assetUrl('t2/edges/intersections.json')),
    fetch(window.DT_assetUrl('t2/edges/edges.json')),
    // Stairs-flat evidence (sml-stairs-flat-axis): tracked step_count extract.
    // Sites without a declaration simply get a null-count axis.
    fetchDeclaredOptionalResource(
      'stairsStepCounts', 'elevation_profiles/stairs_step_counts.json',
    ),
  ]);
  if (!iResp.ok) throw new Error(`intersections.json fetch failed: ${iResp.status}`);
  if (!eResp.ok) throw new Error(`edges.json fetch failed: ${eResp.status}`);
  DIAG.intersections = (await iResp.json()).intersections || [];
  DIAG.edges = (await eResp.json()).edges || [];
  // Guarded parse (review finding): a 200-with-HTML response (SPA-style server
  // answering a missing path) must degrade to "no evidence", never kill ALL
  // diagnostics — the required intersections/edges fetches above stay loud.
  try {
    DIAG.stepWays = sResp ? ((await sResp.json()).ways || []) : [];
  } catch {
    console.warn('[stairs-flat] stairs_step_counts.json unparseable; axis disabled');
    DIAG.stepWays = [];
  }
  // Deck-Z sampler for surface-seated actors (the bike): nearest polyline_3d
  // vert answers "deck Z at this XY" without the sim↔mesh id mapping.
  deckZSampler = buildDeckZSampler(DIAG.edges, geoToLocal);
  // Index edges by id so the inspector can show the full record (name + data lineage) on click —
  // the rendered mesh userData only carries dt_edge_id, but edges.json has name/z_source/z_lineage/
  // osm_way. (Fixes: clicking an edge showed no name and no provenance.)
  DIAG.edgeById = new Map(DIAG.edges.map((e) => [String(e.id), e]));
  // Node registry by twin_id (sml-node-inspector-card): lets a click on a baked
  // node ball show role/z/z-lineage instead of the bogus edge card.
  DIAG.intersectionsById = new Map(
    DIAG.intersections.filter((i) => i && i.twin_id).map((i) => [String(i.twin_id), i]));

  // sml-viewer-goto-edge-index: build the goto edge index + centroid map from the
  // edges just parsed (D4: reuse this fetch — no second load). Names come from the
  // shared edge_names.json loader (name → [ids]); invert to id → name. Sites
  // without a declaration keep id-only resolution with no resource request.
  await buildEdgeGotoIndex(DIAG.edges);

  // Cliff verdicts are node-level (attach to sim nodes in C4, not edge meshes).
  const roleByNode = new Map(DIAG.intersections.map((n) => [n.twin_id, n.role]));
  const cliffNodes = computeCliffNodes(DIAG.edges, roleByNode, geoToLocal);
  DIAG.cliffNodeCount = cliffNodes.size;
  DIAG.cliffNodeIds = [...cliffNodes.keys()];

  // Below-lake axis (exhaustive underwater): ANY node or deck vert below full-pool
  // in/near the lake — the complement to submerged (driving-in-basin only). Node
  // ids feed the sim-node layer (below); deck recolor runs after the overlap pass.
  const isNearLake = buildIsNearLake();
  DIAG.belowLakeNodeIds = new Set(belowLakeNodes(DIAG.intersections, isNearLake).map((n) => n.id));

  // Index the rendered edges.glb sub-meshes by edge id (dt_edge_id == twin_id ==
  // edges.json id, verified 2177/2177). One edge → multiple meshes (ribbon,
  // railings, curbs, deck, …) — recolor them all.
  const meshesByEdge = new Map();
  scene.traverse((o) => {
    const id = o.isMesh && o.userData?.dt_edge_id;
    if (!id) return;
    if (!meshesByEdge.has(id)) meshesByEdge.set(id, []);
    meshesByEdge.get(id).push(o);
  });

  const diagGroup = new THREE.Group();
  diagGroup.name = 'z-fault-diagnostics';
  for (const e of DIAG.edges) {
    const xyz = [];
    for (const [lat, lng, z] of e.polyline_3d) {
      const [x, y] = geoToLocal(lat, lng);
      xyz.push(x, y, Number.isFinite(Number(z)) ? Number(z) : window.DT_SITE.cameraTargetZ);
    }
    const submergedPt = submergedInBasinPoint(e, xyz);
    const isSubmerged = submergedPt !== null;
    // Steep is mutually exclusive with submerged by mode (submerged=driving,
    // steep=walking/cycling) so order is incidental; evaluate submerged first
    // to match base.js's diagnostic priority.
    const steepInfo = isSubmerged ? null : steepSlopeMarker(e, xyz);
    const isSteep = steepInfo !== null;
    if (!isSubmerged && !isSteep) continue;

    const color = isSubmerged ? SUBMERGED_COLOR : STEEP_SLOPE_COLOR;
    const kind = isSubmerged ? 'submerged' : 'steep-slope';
    const diagFields = isSubmerged
      ? { is_submerged: true, deepest_z: Math.round(submergedPt[2] * 10) / 10 }
      : { is_steep_slope: true, avg_grade_pct: Math.round(steepInfo[3] * 1000) / 10 };

    // Recolor the edge + stamp its inspector userData. Under merge (edgeBatch):
    // per-instance tint + stamp the per-edge userData store. Otherwise recolor
    // the per-edge sub-mesh materials (the legacy angle-independent mesh raycast).
    if (edgeBatch) {
      edgeBatch.setEdgeColor(e.id, color);
      DIAG.edgeColorById.set(e.id, color);   // toggle applies/resets this at runtime
      const ud = edgeBatch.edgeUserData.get(e.id);
      if (ud) Object.assign(ud, diagFields, { z_source: e.z_source || 'dem', dt_edge_id: e.id });
    } else {
      for (const m of (meshesByEdge.get(e.id) || [])) {
        if (m.material) stampDiagEdgeColor(m.material, color);
        Object.assign(m.userData, diagFields, { z_source: e.z_source || 'dem', dt_edge_id: e.id });
      }
    }

    DIAG.edgeColorById.set(e.id, color);   // toggle applies/resets this at runtime

    const pt = isSubmerged ? submergedPt : steepInfo;
    diagGroup.add(makeBeacon(color, pt, `${kind}-beacon:${e.id}`,
      { ...diagFields, dt_edge_id: e.id, z_source: e.z_source || 'dem', kind: `${kind}-beacon` }));

    if (isSubmerged) { DIAG.submergedCount++; DIAG.submergedEdgeIds.push(e.id); }
    else { DIAG.steepSlopeCount++; DIAG.steepEdgeIds.push(e.id); }
    DIAG.beaconCount++;
  }

  // Overlap / duplicate-edge axis (4th axis — TOPOLOGICAL, not a Z fault):
  // the same physical surface carried as multiple overlapping cross-mode edges
  // (a symptom of an incomplete T-1 source). Recolor every participating edge's
  // meshes cyan + a pickable beacon per pair at the edge's ENU centroid. An edge
  // already colored by a Z-fault axis keeps that color (the overlap beacon still
  // marks it), so the established axes are not clobbered.
  // Rail (mode 'mixed') is excluded from the overlap axis upstream in
  // viewer-common/diagnostics.js — a railway is a separate grade structure, not a
  // shared surface, so road/trail edges running parallel to it are real
  // co-location, not duplicates. The shared-junction-graze discount additionally
  // clears two separate features meeting at an intersection then diverging (e.g.
  // the 對高岳步道 elevated walkway grazing 祝山林道 at their shared node). It is
  // site-gated (DT_SITE.overlapDiscountSharedJunctions): ON for synth-corridor
  // graphs that fan edges out from shared junctions (Alishan). The strict
  // duplicate-surface gate (DT_SITE.overlapStrictDuplicateSurface) is gated the
  // same way: ON for sites where paths are deliberately built 2–5 m beside roads
  // (Alishan boardwalks). SML runs BOTH gates too since sml-overlap-cleanup
  // (broad-net triage: 86 of 90 pairs were co-location; pinned net now 4/8 —
  // the true duplicate-surface mappings, see site-config.js).
  const overlapPairs = overlapEdges(DIAG.edges, geoToLocal, {
    discountSharedJunctions: !!window.DT_SITE?.overlapDiscountSharedJunctions,
    strictDuplicateSurface: !!window.DT_SITE?.overlapStrictDuplicateSurface,
  });
  DIAG.overlapPairs = overlapPairs;
  DIAG.overlapCount = overlapPairs.length;
  const zFaultIds = new Set([...DIAG.submergedEdgeIds, ...DIAG.steepEdgeIds]);
  // An edge can participate in several pairs — collect each edge's partners +
  // its max shared-vertex count for the inspector card.
  const partnersByEdge = new Map();
  const addPartner = (id, other, sv) => {
    if (!partnersByEdge.has(id)) partnersByEdge.set(id, { with: new Set(), shared: 0 });
    const rec = partnersByEdge.get(id);
    rec.with.add(other);
    rec.shared = Math.max(rec.shared, sv);
  };
  for (const { a, b, sharedVerts } of overlapPairs) {
    addPartner(a, b, sharedVerts);
    addPartner(b, a, sharedVerts);
  }
  DIAG.overlapEdgeIds = [...partnersByEdge.keys()];
  for (const [eid, rec] of partnersByEdge) {
    const fields = { is_overlap: true, dt_edge_id: eid, overlap_with: [...rec.with], shared_verts: rec.shared };
    if (!zFaultIds.has(eid)) DIAG.edgeColorById.set(eid, OVERLAP_COLOR);   // keep Z-fault color; toggle-managed
    if (edgeBatch) {
      const ud = edgeBatch.edgeUserData.get(eid);
      if (ud) Object.assign(ud, fields);
      if (!zFaultIds.has(eid)) { edgeBatch.setEdgeColor(eid, OVERLAP_COLOR); DIAG.edgeColorById.set(eid, OVERLAP_COLOR); }   // keep Z-fault color; toggle-managed
    } else {
      for (const m of (meshesByEdge.get(eid) || [])) {
        Object.assign(m.userData, fields);
        if (zFaultIds.has(eid) || !m.material) continue;   // keep Z-fault color
        stampDiagEdgeColor(m.material, OVERLAP_COLOR);
      }
    }
  }
  for (const { a, b, sharedVerts } of overlapPairs) {
    const c = edgeGotoCentroids.get(a) || edgeGotoCentroids.get(b);
    if (!c) continue;
    diagGroup.add(makeBeacon(OVERLAP_COLOR, c, `overlap-beacon:${a}~${b}`,
      { is_overlap: true, overlap_pair: [a, b], shared_verts: sharedVerts, dt_edge_id: a, kind: 'overlap-beacon' }));
    // NB: DIAG.beaconCount is the Z-fault edge-beacon bookkeeping (asserted by
    // test_three_diagnostics C3/C7); the overlap axis is counted by overlapCount.
  }

  // Below-lake axis (exhaustive underwater) — edges with a below-full-pool deck
  // vertex in/near the lake, across ALL modes. Recolor deep blue + a beacon at the
  // deepest such vertex. Skip edges already colored by submerged/steep (a submerged
  // driving edge IS below-lake — keep the more specific color); below-lake, a
  // Z-fault, takes precedence over the topological overlap color where they collide.
  // The beacon marks it regardless. On master the recolor rides setEdgeColor like
  // submerged/steep (the toggle-reset lands with #54's edgeColorById).
  const belowDecks = belowLakeDeckVerts(DIAG.edges, isNearLake);
  DIAG.belowLakeEdgeIds = belowDecks.map((d) => d.id);
  for (const d of belowDecks) {
    const [blat, blng, bz] = d.point;
    const [bx, by] = geoToLocal(blat, blng);
    const fields = { is_below_lake: true, dt_edge_id: d.id, below_lake_z: Math.round(bz * 100) / 100, mode: d.mode };
    if (!zFaultIds.has(d.id)) {
      // Register in the toggle-reset map (PR #58 review item 1): without this,
      // below-lake decks stay blue when Diagnostics toggles OFF.
      DIAG.edgeColorById.set(d.id, BELOW_LAKE_COLOR);
      if (edgeBatch) {
        edgeBatch.setEdgeColor(d.id, BELOW_LAKE_COLOR);
        DIAG.edgeColorById.set(d.id, BELOW_LAKE_COLOR);   // toggle applies/resets this at runtime
        const ud = edgeBatch.edgeUserData.get(d.id);
        if (ud) Object.assign(ud, fields);
      } else {
        for (const m of (meshesByEdge.get(d.id) || [])) {
          if (m.material) stampDiagEdgeColor(m.material, BELOW_LAKE_COLOR);
          Object.assign(m.userData, fields);
        }
      }
    }
    // Beacon + count are OUTSIDE the zFault guard ON PURPOSE: a below-lake deck that
    // keeps its submerged/steep color still gets a below-lake beacon and is counted,
    // so the signal is never dropped (only the redundant recolor is). Do not move
    // this inside the `if` — that would under-count vs what's rendered.
    diagGroup.add(makeBeacon(BELOW_LAKE_COLOR, [bx, by, bz], `below-lake-beacon:${d.id}`,
      { ...fields, kind: 'below-lake-beacon' }));
  }
  DIAG.belowLakeCount = DIAG.belowLakeNodeIds.size + belowDecks.length;

  // Stairs-flat axis (EVIDENCE fault — sml-stairs-flat-axis): a step-counted OSM
  // stairs way whose member edges sum under half the minimum rise its step_count
  // implies — a leveled staircase (the 水濱婚紗廣場 trestle class). Mirrors the
  // build gate tests/t2/test_node_z_evidence_gates.py Gate A, so the viewer marks
  // exactly the ways the gate's allowlist pins. Recolor member edges rose + one
  // beacon per way; recolor defers to earlier axes (a member edge already carrying
  // a Z-fault color keeps it — the beacon still marks the way, never dropped).
  const stairsFlat = stairsFlatViolations(DIAG.edges, DIAG.stepWays || []);
  DIAG.stairsFlatWayIds = stairsFlat.map((v) => String(v.wayId));
  DIAG.stairsFlatEdgeIds = stairsFlat.flatMap((v) => v.edges);
  for (const v of stairsFlat) {
    const fields = {
      is_stairs_flat: true, dt_way_id: v.wayId, step_count: v.stepCount,
      sum_dz_m: v.sumDz, expected_min_m: v.expectedMin,
    };
    for (const eid of v.edges) {
      if (zFaultIds.has(eid) || DIAG.edgeColorById.has(eid)) continue;  // keep the earlier axis color
      DIAG.edgeColorById.set(eid, STAIRS_FLAT_COLOR);   // toggle applies/resets at runtime
      if (edgeBatch) {
        edgeBatch.setEdgeColor(eid, STAIRS_FLAT_COLOR);
        const ud = edgeBatch.edgeUserData.get(eid);
        if (ud) Object.assign(ud, fields, { dt_edge_id: eid });
      } else {
        for (const m of (meshesByEdge.get(eid) || [])) {
          if (m.material) stampDiagEdgeColor(m.material, STAIRS_FLAT_COLOR);
          Object.assign(m.userData, fields, { dt_edge_id: eid });
        }
      }
    }
    if (v.anchor) {
      const [alat, alng, az] = v.anchor;
      const [ax, ay] = geoToLocal(alat, alng);
      diagGroup.add(makeBeacon(STAIRS_FLAT_COLOR, [ax, ay, az], `stairs-flat-beacon:${v.wayId}`,
        { ...fields, kind: 'stairs-flat-beacon' }));
    }
  }
  DIAG.stairsFlatCount = stairsFlat.length;

  // Terrain-fault axis (5th) — edges vs the rendered terrain SURFACE, generated offline by
  // AliShanTwin's measure_edge_terrain ray-cast (t2/edges/terrain_faults.json). Recolor each
  // edge + a grounded pin at the worst point. Both ride the master Diagnostics toggle; the PINS
  // additionally have a "terrain faults" sub-checkbox (masterOn && subChecked) so they can be
  // hidden inside an active master to avoid the steep+overlap clutter — see setDiagnosticsVisible
  // / setTerrainFaultsVisible. Sites without a declaration simply get no terrain-fault axis.
  DIAG.terrainFaultCount = 0;
  DIAG.terrainFaultCausalEligibleCount = 0;   // excludes cross_section rows — causal_terrain_diagnosis.py
                                              // silently drops those (unknown verdict), so counting them
                                              // here would overstate what regenerating causal_diagnoses.json
                                              // can actually resolve (viewer-diagnostic-registry adoption below)
  DIAG.terrainFaultsLoaded = false;   // whether terrain_faults.json loaded for this site — gates
                                      // mound/side_ridge/side_trench between a real count and legend '—'
  DIAG.moundCount = 0;
  DIAG.sideRidgeCount = 0;
  DIAG.sideTrenchCount = 0;
  const tfGroup = new THREE.Group();
  tfGroup.name = 'terrain-faults';
  const terrainFaultResource = window.DT_optionalResource(
    'terrainFaults', 't2/edges/terrain_faults.json',
  );
  if (terrainFaultResource) {
    try {
      const tfResp = await fetch(terrainFaultResource.url);
      if (!tfResp.ok) throw new Error(`terrain_faults.json returned HTTP ${tfResp.status}`);
      const faultsRaw = (await tfResp.json()).faults;
      const markers = terrainFaultMarkers(faultsRaw, geoToLocal);
      for (const mk of markers) {
        // Centerline verdicts (rollercoaster/tunnel/carve/mound) outrank the toggle-
        // managed recolors (overlap/below-lake/Z-fault) on the edge MESH: record the
        // terrain color into its OWN map (DIAG.terrainFaultColorById) and EVICT the id
        // from edgeColorById, so the master toggle's two apply/reset loops (see
        // setDiagnosticsVisible) never collide on the same id — the terrainFaultColorById
        // loop runs AFTER the edgeColorById loop, so a dual-fault edge always shows its
        // terrain color while the master is ON. The color itself is NOT applied here —
        // setDiagnosticsVisible(false), called with the default-off state at the end of
        // this function, is what puts it (or doesn't) on screen; this used to recolor
        // unconditionally at load and never get reset, so terrain-fault edges stayed lit
        // with the master OFF. The evicted axis keeps its beacon + count; only the edge
        // color yields.
        //
        // cross_section verdicts (side_ridge/side_trench, mk.recolorEdge === false) are
        // a point-local worst-point excursion off the ribbon, not a whole-edge fault —
        // painting the full edge crimson/violet at ~2k rows drowned out every other
        // axis and read as cliff-red. They get a PIN only; the edge mesh color is left
        // to whichever axis (or none) already claimed it. This also fixes a latent bug:
        // an edge can carry both a centerline row and a side row (side rows are
        // appended after centerline rows in the file) — Object.assign-ing the side
        // row's fields onto the same edge userData used to clobber the centerline
        // verdict's max_float/max_dive with the side row's max_ridge/max_trench. Since
        // side rows never touch edge userData now, the centerline verdict's fields (and
        // its edge color) are untouched regardless of row order.
        if (mk.recolorEdge) {
          DIAG.terrainFaultColorById.set(mk.id, mk.color);
          DIAG.edgeColorById.delete(mk.id);
          if (edgeBatch) {
            const ud = edgeBatch.edgeUserData.get(mk.id);
            if (ud) Object.assign(ud, mk.fields);
          } else {
            for (const m of (meshesByEdge.get(mk.id) || [])) {
              if (m.material) stampDiagEdgeColor(m.material, mk.color);
              Object.assign(m.userData, mk.fields);
            }
          }
        }
        if (mk.position) {
          tfGroup.add(makeGroundPin(mk.color, mk.position, `terrain-fault-beacon:${mk.id}`,
            { ...mk.fields, kind: 'terrain-fault-beacon' }));
        }
      }
      DIAG.terrainFaultCount = markers.length;
      DIAG.terrainFaultCausalEligibleCount = faultsRaw.filter((f) => f.source !== 'cross_section').length;
      DIAG.terrainFaultsLoaded = true;
      const tfAxisCounts = terrainFaultAxisCounts(faultsRaw);
      DIAG.moundCount = tfAxisCounts.mound;
      DIAG.sideRidgeCount = tfAxisCounts.side_ridge;
      DIAG.sideTrenchCount = tfAxisCounts.side_trench;
      // Introspect the pins actually added: count those that are grounded depth-tested meshes
      // (so they occlude behind hills AND auto-join raycastHitsAt's mesh pick set). A regression
      // back to a punch-through sprite would drop this count -> the headless verify catches it.
      const pickablePins = tfGroup.children.filter(
        (o) => o.userData?.kind === 'terrain-fault-beacon' && o.isMesh && o.material?.depthTest === true);
      console.info(`[terrain-fault axis] ${markers.length} markers from terrain_faults.json; `
        + `${pickablePins.length} grounded depth-tested mesh pin(s) (pickable)`);
    } catch (err) {
      recordAssetDiagnostic('terrain-faults-load', terrainFaultResource.url, err, {
        layerKey: 'terrainFaults',
      });
      if (terrainFaultResource.required) throw err;
    }
  }
  // Own group + own toggle, default hidden (leaves too — Raycaster ignores ancestor visibility).
  tfGroup.visible = false;
  tfGroup.traverse((o) => { if (o !== tfGroup) o.visible = false; });
  scene.add(tfGroup);
  DIAG.terrainFaultGroup = tfGroup;
  layerRoots.terrainFaults = tfGroup;     // exposes __dt.layers.terrainFaults
  wireTerrainFaultToggle();

  scene.add(diagGroup);
  DIAG.diagnosticsGroup = diagGroup;

  buildSimNodeLayer(cliffNodes);
  buildSchematicDiagnosisLayer();   // authored-graph line layer (default hidden)
  // Live counts for the registry-driven legend, keyed by DIAGNOSTIC_AXES key. The
  // 'relief' axes (eat/gap/spike) are produced offline (relief_diagnostics.py) and
  // loaded by their own pass when present; left undefined here so the legend shows
  // '—' on a site without that data instead of a misleading 0.
  DIAG.axisCounts = {
    cliff: DIAG.cliffNodeCount,
    submerged: DIAG.submergedCount,
    steep: DIAG.steepSlopeCount,
    overlap: DIAG.overlapCount,
    // null (→ legend '—') when the axis is disabled by a failed lake load, so a
    // disabled axis never masquerades as a clean "0" census.
    belowLake: DIAG.belowLakeAxisDisabled ? null : DIAG.belowLakeCount,
    // null (→ '—') on sites without the tracked step_count extract: no evidence
    // loaded is not the same claim as "0 leveled staircases".
    stairsFlat: (DIAG.stepWays && DIAG.stepWays.length) ? DIAG.stairsFlatCount : null,
    // null (→ '—') on sites without terrain_faults.json — this centerline count is the
    // FLOOR: loadReliefFaults (below) overwrites it with the causal_diagnoses.json/
    // relief_faults.json count ONLY when that artifact actually carries mound evidence
    // (causalMoundHasEvidence) — a loaded-but-mound-blind artifact leaves this floor
    // alone rather than clobbering it with causalReliefAxisCounts' hard `?? 0` default.
    mound: DIAG.terrainFaultsLoaded ? DIAG.moundCount : null,
    // null (→ '—') on sites without terrain_faults.json (e.g. SML) — these come from
    // cross_section rows only, which causal_diagnoses.json never carries, so there is
    // no second artifact to fall back to the way relief axes do.
    side_ridge: DIAG.terrainFaultsLoaded ? DIAG.sideRidgeCount : null,
    side_trench: DIAG.terrainFaultsLoaded ? DIAG.sideTrenchCount : null,
  };
  buildDiagnosticLegend();
  setDiagnosticsVisible(false);  // default OFF — scenario viewer stays uncluttered
  console.info(`[z-fault diagnostics] ${DIAG.cliffNodeCount} cliff node(s), `
    + `${DIAG.submergedCount} submerged + ${DIAG.steepSlopeCount} steep edge(s) recolored; `
    + `${DIAG.overlapCount} overlapping cross-mode edge pair(s) (${DIAG.overlapEdgeIds.length} edges); `
    + (DIAG.belowLakeAxisDisabled
      ? 'below-lake: DISABLED (lake mesh unavailable).'
      : `below-lake: ${DIAG.belowLakeNodeIds.size} node(s) + ${DIAG.belowLakeEdgeIds.length} deck edge(s); `)
    + `stairs-flat: ${DIAG.stairsFlatCount} way(s) (${DIAG.stairsFlatEdgeIds.length} edges).`);
}

// ── viewer-diagnostic-registry: on-screen legend (SSOT-driven) ──────
// Render #diagnostic-legend from DIAGNOSTIC_AXES so every fault color on screen
// has a stated meaning + live count, grouped (Z-faults / Topology / Surface
// relief). Built once after diagnostics load; shown/hidden by the Diagnostics
// toggle. Reading the registry (not hardcoding rows) is what keeps the legend and
// the actual recolor in lockstep — a new axis appears here automatically.
const LEGEND_GROUP_LABEL = {
  'z-fault':  'Z-faults · edges.json',
  topology:   'Topology · edges.json',
  relief:     'Surface relief · terrain vs deck',
};
function buildDiagnosticLegend() {
  const host = document.getElementById('diagnostic-legend');
  if (!host) return;
  const parts = ['<div class="legend-title">Diagnostic faults</div>'];
  if (DIAG.causalDiagnosisUnavailable) {
    parts.push(`<div class="legend-status legend-status-unavailable">${DIAG.causalDiagnosisUnavailable}</div>`);
  }
  for (const { group, rows } of legendModel(DIAG.axisCounts || {})) {
    parts.push(`<div class="legend-group-label">${LEGEND_GROUP_LABEL[group] || group}</div>`);
    for (const r of rows) {
      const count = r.count === null ? '—' : r.count;
      const tip = r.firesWhen.replace(/"/g, '&quot;');
      parts.push(
        `<div class="legend-row" title="${tip}">`
        + `<span class="legend-swatch" style="background:${r.hex}"></span>`
        + `<span class="legend-name">${r.label}</span>`
        + `<span class="legend-count">${count}</span>`
        + '</div>');
    }
  }
  host.innerHTML = parts.join('');
}

// ── viewer-diagnostic-registry adoption: surface-relief axis ────────
// Load the offline causal diagnoses and/or relief census as the REGISTERED `relief`
// axes. Either artifact is sufficient: Alishan can project terrain_faults.json verdicts
// directly into causal_diagnoses.json, while SML keeps its normalized relief census.
// Colors come from DIAGNOSTIC_AXES — never a
// local palette — so they cannot collide with the z-fault/topology axes (the rule #25
// enforces). The beacons join the Faults group (DIAG.reliefGroup, gated by the
// Diagnostics toggle via DIAGNOSTIC_LAYER_KEYS), and the axis counts light up the
// legend rows that read '—' until this site's data loads. A site without a resource
// declaration simply keeps the '—' and emits no request.
const RELIEF_EAT_SIGNIFICANT_M = 1.5;   // a sub-1.5 m eat is at-grade noise — kept the
                                        // SAME registry orange but half-size, so the real
                                        // burials (the issue) stand out, not a new color.
async function loadReliefFaults() {
  let causal = null;
  const causalResponse = await fetchDeclaredOptionalResource(
    'causalDiagnoses', 'diagnostics/causal_diagnoses.json',
  );
  if (causalResponse) {
    const resp = causalResponse;
    causal = await resp.json();
  }
  let data = null;
  const reliefResponse = await fetchDeclaredOptionalResource(
    'reliefFaults', 'diagnostics/relief_faults.json',
  );
  if (reliefResponse) {
    const resp = reliefResponse;
    data = await resp.json();
  }
  const availability = causalArtifactAvailability({
    // causal-eligible only: cross_section rows (side_ridge/side_trench) are ALWAYS dropped by
    // causal_terrain_diagnosis.py's _normalize_faults (unknown verdict), not because
    // causal_diagnoses.json is stale — counting them here would falsely imply regenerating it
    // would resolve them.
    terrainFaultCount: DIAG.terrainFaultCausalEligibleCount,
    causalLoaded: !!causal,
    reliefLoaded: !!data,
  });
  DIAG.causalDiagnosisUnavailable = availability.message;
  if (!availability.available) {
    buildDiagnosticLegend();
    return;
  }
  const group = new THREE.Group();
  group.name = 'relief-fault-diagnostics';
  if (causal) {
    for (const diagnosis of causal.diagnoses || []) {
      const marker = causalMarkerModel(diagnosis);
      const axis = DIAGNOSTIC_AXES[diagnosis.axis];
      if (!marker || !axis || axis.group !== 'relief') continue;
      const beacon = makeBeacon(
        axis.color,
        marker.position,
        `causal-diagnosis:${diagnosis.diagnosis_id}`,
        { kind: 'causal-diagnosis', diagnosis, marker },
        { depthTest: causalMarkerDepthTest(diagnosis), renderOrder: 20 },
      );
      beacon.scale.multiplyScalar(causalMarkerScale(diagnosis));
      group.add(beacon);
    }
  } else {
    for (const f of data?.faults || []) {
      const axis = DIAGNOSTIC_AXES[f.type];
      if (!axis || axis.group !== 'relief') continue;   // only registered relief axes
      const beacon = makeBeacon(axis.color, [f.x, f.y, f.z],
        `relief-${f.type}-beacon`, { kind: `relief-${f.type}`, ...f });
      if (f.type === 'eat' && (f.over_m ?? 0) <= RELIEF_EAT_SIGNIFICANT_M) {
        beacon.scale.multiplyScalar(0.5);              // marginal eat: smaller, same color
      }
      group.add(beacon);
    }
  }
  group.visible = false;                  // gated by the Diagnostics (Faults) toggle
  scene.add(group);
  DIAG.reliefGroup = group;
  // Light up the legend's relief rows (were '—' until this site's data loaded).
  const s = data?.summary || {};
  const causalCounts = causalReliefAxisCounts(s, causal?.summary);
  // mound is the one axis ALSO set from terrain_faults.json above (loadDiagnostics'
  // floor count) — causalReliefAxisCounts defaults mound to a hard 0 when neither
  // summary carries it, which would silently clobber that real floor with a false
  // "definitely zero". Only let this causal/relief lane's mound value win when it
  // actually carries mound evidence; otherwise drop the key so the spread below
  // leaves the terrain_faults-derived count (or null) untouched.
  if (!causalMoundHasEvidence(s, causal?.summary)) delete causalCounts.mound;
  DIAG.axisCounts = { ...(DIAG.axisCounts || {}), ...causalCounts };
  buildDiagnosticLegend();
  const sig = (data?.faults || []).filter(
    (f) => f.type === 'eat' && (f.over_m ?? 0) > RELIEF_EAT_SIGNIFICANT_M).length;
  const causalInfo = causal ? ` / ${causal.summary?.diagnoses ?? 0} causal diagnoses` : '';
  console.info(`[relief faults] ${group.children.length} marker(s): `
    + `${s.eat ?? 0} eat (${sig} significant >1.5 m) / ${s.gap ?? 0} gap / ${s.spike ?? 0} spike`
    + ` / ${s.elevated_buried ?? 0} elevated_buried${causalInfo}. `
    + 'Colors from DIAGNOSTIC_AXES; toggle with the Diagnostics button.');
}

// sml-viewer-goto-edge-index: build the goto entries + ENU centroid map for every
// edge. Reuses geoToLocal (the viewer's geo→ENU) and the SAME polyline_3d Z
// convention the diagnostics loop uses above (Number(z), cameraTargetZ fallback). Names are
// inverted from edge_names.json's name→[ids] map (loaded by the shared dropdown
// loader). Idempotent; safe to call once at boot.
async function buildEdgeGotoIndex(edges) {
  const nameById = new Map();
  const namesByName = await loadEdgeNameIndex();  // { name: [edgeId, …] } | {}
  for (const [nm, ids] of Object.entries(namesByName || {})) {
    for (const id of ids || []) if (!nameById.has(id)) nameById.set(id, nm);
  }

  const entries = [];
  edgeGotoCentroids.clear();
  edgeGotoSizes.clear();
  for (const e of edges || []) {
    const id = e.id || e.twin_id;
    if (!id) continue;
    const name = nameById.get(id);
    // Enrich the edge record with its OSM-sourced name so the edge-label overlay
    // (chainRuns reads e.name) and the inspector see it — edges.json carries no
    // inline name; the names live in edge_names.json. Fill-only: never overwrite
    // an inline name (keeps sites whose edges.json already has names intact).
    if (name != null && e.name == null) e.name = name;
    entries.push(name ? { id, name } : { id });
    const pl = e.polyline_3d;
    if (!Array.isArray(pl) || pl.length === 0) continue;
    let sx = 0, sy = 0, sz = 0;
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (const [lat, lng, z] of pl) {
      const [x, y] = geoToLocal(lat, lng);
      const zz = Number.isFinite(Number(z)) ? Number(z) : window.DT_SITE.cameraTargetZ;
      sx += x; sy += y; sz += zz;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (zz < minz) minz = zz; if (zz > maxz) maxz = zz;
    }
    edgeGotoCentroids.set(id, [sx / pl.length, sy / pl.length, sz / pl.length]);
    // Bbox SIZE so goto pulls back to frame the whole edge (not a 15 m standoff
    // that lands under the slope for an elevated boardwalk). Mirrors line ~1733.
    edgeGotoSizes.set(id, [maxx - minx, maxy - miny, maxz - minz]);
  }
  edgeGotoEntries = entries;
  console.info(`[goto-edge-index] indexed ${entries.length} edge(s); `
    + `${edgeGotoCentroids.size} centroid(s).`);
}

// Build the sim-node sphere layer (ported from base.js loadT2SimNodes). All
// spheres are depthTest-off so nodes whose z sits below terrain / the lake disk
// stay visible AND raycast-pickable when the layer is on. Cliff-flank nodes are
// red + larger + carry a beacon. The group is added to the scene (so it is in
// production's intersectObjects pick set) but starts hidden.
// viewer-schematic-diagnosis-layer ──────────────────────────────────
// Build the authored-graph line layer from the edges DIAG already parsed, colored
// by the fault verdicts DIAG already computed (submerged>steep>overlap, else a
// neutral readable base). Registered as the exclusive 'diagnosis' layer, default
// hidden. Reproduces base.html's surface view in the PRODUCTION scene (readable
// Line2 + the 0x4a6a8a background), without touching base.js.
const SCHEMATIC_BASE_COLOR = 0xcfd8e0;   // neutral, legible on the 0x4a6a8a slate
function buildSchematicDiagnosisLayer() {
  if (_schematicGroup) return;            // idempotent
  const submerged = new Set(DIAG.submergedEdgeIds || []);
  const steep = new Set(DIAG.steepEdgeIds || []);
  const overlap = new Set(DIAG.overlapEdgeIds || []);
  // Coloring is site-gated (DT_SITE.schematicColorByMode). Mode-primary sites
  // (synth-corridor graphs, e.g. Alishan) color by transport type so the schematic
  // reads as a network map; topology faults still override (overlap = duplicate/
  // cross-mode; submerged = below-lake) but steep is NOT overridden there — Alishan
  // trails are steep by nature, so it would flood the map (steep stays in
  // DIAG.steepEdgeIds for inspection). SML keeps the master fault-centric chain
  // (submerged > steep > overlap > neutral base) so its pinned schematic is intact.
  const colorByMode = !!window.DT_SITE?.schematicColorByMode;
  // Mode coloring is config-driven (site vocab lives in site-config.js, not here):
  // which edge field names the mode + the per-mode palette.
  const modeField = window.DT_SITE?.schematicModeField;
  const modeColors = window.DT_SITE?.schematicModeColors || {};
  const colorForEdge = (e) =>
    submerged.has(e.id) ? SUBMERGED_COLOR
    : (!colorByMode && steep.has(e.id)) ? STEEP_SLOPE_COLOR
    : overlap.has(e.id) ? OVERLAP_COLOR
    : ((modeField ? modeColors[e[modeField]] : undefined) ?? SCHEMATIC_BASE_COLOR);
  const group = buildSchematicLayer({
    edges: DIAG.edges || [],
    geoToLocal,
    colorForEdge,
    modeField,
    fallbackZ: window.DT_SITE.cameraTargetZ,   // authored Z verbatim; fallback only for non-finite z
    linewidth: 2.5,
    resolution: { x: window.innerWidth, y: window.innerHeight },
  });
  group.visible = false;                       // exclusive mode shows it
  scene.add(group);
  _schematicGroup = group;
  _schematicLineMaterials = group.userData.lineMaterials || [];
  layerRoots.diagnosis = group;                // exposes __dt.layers.diagnosis
  // Wire the diagnosis checkbox (static in index.html) once.
  const cb = document.getElementById('toggle-diagnosis');
  if (cb && !cb._dtWired) { cb._dtWired = true; cb.addEventListener('change', () => setDiagnosisMode(cb.checked)); }
}

// Exclusive "diagnosis mode": hide the baked surfaces (terrain/lake/edges), show
// the authored schematic + the sim-node balls; restore prior visibility on exit.
// Idempotent — re-entering while already in mode is a no-op (snapshot guarded).
function setDiagnosisMode(on) {
  on = !!on;
  if (on && !_diagModeSnapshot) {
    // Snapshot + hide every content layer generically (terrain/lake/edges/nodes/
    // landcover/buildings/docks/poiLabels/…) so new layers auto-hide in x-ray mode.
    // 'diagnosis' is the x-ray layer itself; never hide it here.
    _diagModeSnapshot = { layers: {}, simNodes: diagnosticsVisible };
    for (const key of Object.keys(layerRoots)) {
      if (key === 'diagnosis') continue;
      _diagModeSnapshot.layers[key] = layerRoots[key]?.visible ?? true;
      setLayerVisible(key, false);
    }
    if (_schematicGroup) _schematicGroup.visible = true;
    // The small intersection "balls": setDiagnosticsVisible sets the group AND
    // every child sphere visible (children were hidden at load) — setting only
    // group.visible leaves the spheres invisible, so reuse it.
    setDiagnosticsVisible(true);
  } else if (!on && _diagModeSnapshot) {
    for (const [key, vis] of Object.entries(_diagModeSnapshot.layers)) setLayerVisible(key, vis);
    if (_schematicGroup) _schematicGroup.visible = false;
    setDiagnosticsVisible(_diagModeSnapshot.simNodes);
    _diagModeSnapshot = null;
  }
  const cb = document.getElementById('toggle-diagnosis');
  if (cb) cb.checked = on;
}

function buildSimNodeLayer(cliffNodes) {
  const group = new THREE.Group();
  group.name = 't2-sim-nodes';
  for (const n of DIAG.intersections) {
    const [x, y] = geoToLocal(n.lat, n.lng);
    if (!Number.isFinite(n.z)) {
      // Per sml-t2-intersection-z-resolution: the viewer reads node z directly
      // and MUST fail loudly if it is missing — terrain fallback is forbidden.
      throw new Error(
        `T2 sim node ${n.twin_id} missing numeric \`z\`. Synth output regression — `
        + `re-run scripts/t2/build_sml_t2_facility_graph.py.`,
      );
    }
    const cliffGradePct = cliffNodes.get(n.twin_id);
    const isCliff = cliffGradePct !== undefined;
    const color = isCliff ? CLIFF_COLOR : (T2_SIM_COLOR_BY_ROLE[n.role] ?? 0x808080);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
    const sphere = new THREE.Mesh(isCliff ? CLIFF_SPHERE_GEO : T2_SIM_SPHERE_GEO, mat);
    sphere.position.set(x, y, n.z);
    sphere.name = `sim-node:${n.twin_id}`;
    sphere.userData = {
      ...n, kind: 't2-sim-node', authority_tier: 'T2_sim',
      ...(isCliff ? { is_cliff: true, cliff_grade_pct: Math.round(cliffGradePct) } : {}),
    };
    if (isCliff) sphere.renderOrder = 999;
    group.add(sphere);
    DIAG.simNodes.push(sphere);
    if (isCliff) {
      group.add(makeBeacon(CLIFF_COLOR, [x, y, n.z], `cliff-beacon:${n.twin_id}`,
        { ...sphere.userData, kind: 'cliff-beacon' }));
    }
    if (DIAG.belowLakeNodeIds.has(n.twin_id)) {
      group.add(makeBeacon(BELOW_LAKE_COLOR, [x, y, n.z], `below-lake-beacon:${n.twin_id}`,
        { ...sphere.userData, is_below_lake: true, kind: 'below-lake-beacon' }));
    }
  }
  scene.add(group);
  DIAG.simNodesGroup = group;
}

// Tracks the master Diagnostics toggle's live ON/OFF state. setDiagnosticsVisible is called
// from more than one place (the button handler below AND setDiagnosisMode's x-ray toggle,
// which does not go through the `diagnosticsVisible` variable below), so the terrain-fault pin
// sub-filter reads this instead of a particular call site's local state.
let _diagnosticsMasterOn = false;

// Toggle the sim-node diagnostic layer. Sets BOTH the group AND each child's
// `.visible` — three's Raycaster ignores ancestor-group visibility, so leaf
// visibility is what removes the spheres from the (production) pick set when off.
function setDiagnosticsVisible(on) {
  on = !!on;
  _diagnosticsMasterOn = on;
  // Toggle BOTH diagnostic overlay groups — the sim-node spheres AND the fault-beacon
  // group (DIAG.diagnosticsGroup). This previously flipped only simNodesGroup, so the
  // beacons (yellow/blue squares) were never gated and the toggle "did nothing" to them.
  // Set the group AND each leaf (three's Raycaster ignores ancestor visibility).
  applyDiagnosticsVisibility(DIAG, on, (g, vis) => {
    g.visible = !!vis;
    g.traverse((o) => { if (o !== g) o.visible = !!vis; });
  });
  // Edge fault-colors ride the same toggle: previously recolored edges (submerged/
  // steep/overlap/below-lake/stairs-flat) kept their color with diagnostics OFF. ON
  // re-applies the recorded fault color; OFF restores each edge to its own captured
  // base color via the merge handle. (edgeBatch path — production.)
  if (edgeBatch && DIAG.edgeColorById) {
    for (const [id, hex] of DIAG.edgeColorById) {
      if (on) edgeBatch.setEdgeColor(id, hex); else edgeBatch.resetEdgeColor(id);
    }
  }
  // Terrain-fault centerline recolors (rollercoaster/tunnel/carve/mound) ride the SAME
  // toggle, applied in their OWN loop AFTER the one above so a dual-fault edge always
  // shows its terrain color while ON — the priority the load-time eviction from
  // edgeColorById used to encode, now toggle-aware instead of always-on (previously this
  // axis recolored at load and never got reset, so it stayed lit with the master OFF).
  if (edgeBatch && DIAG.terrainFaultColorById) {
    for (const [id, hex] of DIAG.terrainFaultColorById) {
      if (on) edgeBatch.setEdgeColor(id, hex); else edgeBatch.resetEdgeColor(id);
    }
  }
  const btn = document.getElementById('btn-toggle-diagnostics');
  if (btn) {
    btn.textContent = `Diagnostics: ${on ? 'ON' : 'OFF'}`;
    btn.classList.toggle('active', !!on);
  }
  // The legend rides the same toggle — a fault color is only on screen when its
  // key is on screen, so its meaning should be too.
  const legend = document.getElementById('diagnostic-legend');
  if (legend) legend.classList.toggle('hidden', !on);
  // Terrain-fault PINS need the master AND the "terrain faults" sub-checkbox — recompute
  // now that the master changed (setTerrainFaultsVisible reads _diagnosticsMasterOn).
  const tfCb = document.getElementById('toggle-terrain-faults');
  setTerrainFaultsVisible(tfCb ? tfCb.checked : false);
}

let diagnosticsVisible = false;
(function wireDiagnosticsToggle() {
  const btn = document.getElementById('btn-toggle-diagnostics');
  if (!btn) return;
  btn.addEventListener('click', () => {
    diagnosticsVisible = !diagnosticsVisible;
    setDiagnosticsVisible(diagnosticsVisible);
  });
})();

// Terrain-fault pins — a SUB-filter under the master Diagnostics button, not an independent
// toggle: effective visibility is masterOn && subChecked (terrainFaultPinsVisible), so checking
// this box alone with the master off shows nothing, and re-enabling the master restores
// whatever the box already said. `on` here is the sub-checkbox's own state. Wired once after
// loadDiagnostics builds the group; the checkbox is hidden on sites with no faults (SML), so it
// only appears where it does something.
function setTerrainFaultsVisible(on) {
  const effective = terrainFaultPinsVisible({ masterOn: _diagnosticsMasterOn, subOn: on });
  applyTerrainFaultVisibility(DIAG, effective, (g, vis) => {
    g.visible = !!vis;
    g.traverse((o) => { if (o !== g) o.visible = !!vis; });
  });
}
function wireTerrainFaultToggle() {
  const label = document.getElementById('toggle-terrain-faults-label');
  const cb = document.getElementById('toggle-terrain-faults');
  if (!cb) return;
  // Only meaningful where the site actually has terrain faults (alishan), not SML.
  if (label && label.dataset.assetStatus !== 'failed') {
    label.style.display = DIAG.terrainFaultCount > 0 ? '' : 'none';
  }
  if (!cb._dtWired) {
    cb._dtWired = true;
    cb.addEventListener('change', () => setTerrainFaultsVisible(cb.checked));
  }
  setTerrainFaultsVisible(cb.checked);   // honor restored/default state
}

// ── sml-viewer-diagnostic-convergence: layer-visibility toggles ────
// Checkbox-driven visibility for the major layers, persisted to localStorage
// (mirrors base.html). Digit keys 1–5 are NOT used here — production binds them
// to camera viewpoints. Hiding a layer is a visibility control, not a Z edit.
const LAYER_DEFS = [
  { key: 'terrain',   checkboxId: 'toggle-terrain' },
  { key: 'lake',      checkboxId: 'toggle-lake' },
  { key: 'supportStructures', checkboxId: 'toggle-support-structures', hideWhenAbsent: true },
  { key: 'buildings', checkboxId: 'toggle-buildings' },
  { key: 'edges',     checkboxId: 'toggle-edges' },
  { key: 'nodes',     checkboxId: 'toggle-nodes' },
  { key: 'junctionPlates', checkboxId: 'toggle-junction-plates', hideWhenAbsent: true },
  // hideWhenAbsent: label is display:none in index.html; only revealed when
  // the active site declared props (layerRoots.props exists).
  { key: 'props',     checkboxId: 'toggle-props', hideWhenAbsent: true },
  { key: 'splats',    checkboxId: 'toggle-splats', hideWhenAbsent: true },
  { key: 'edgeLabels', checkboxId: 'toggle-edge-labels', hideWhenAbsent: true },
  { key: 'root-context-field-ridges', checkboxId: 'toggle-farm-field-ridges', hideWhenAbsent: true },
];
const LAYER_STORAGE_KEY = '__dtThreeLayerToggles_v1';

// Splat↔mesh display-duty pairs (sml-hero-splat-v2): filled by the splat
// loader for each splat that actually loaded. Splats visible → paired mesh
// props hidden (they keep pick duty — the Raycaster ignores visibility);
// splats hidden or absent → mesh props shown.
const splatMeshPairs = [];

function _applySplatMeshHandoff(splatsOn) {
  for (const pair of splatMeshPairs) {
    for (const mid of pair.meshIds) {
      const m = twinRegistry.get(mid);
      if (m) {
        m.visible = !splatsOn;
        // Display duty only: the mesh stays the pick surface (PR #75 review
        // finding 2 — isVisibleInTree would otherwise drop every prop hit
        // and prop clicks stop reaching the inspector). The flag marks this
        // root as hidden-for-display-not-for-picking; the props-layer toggle
        // hides via the GROUP (no flag), so toggling props off still kills
        // prop picks as before.
        m.userData.splatDisplayDelegate = splatsOn;
      }
    }
  }
}

function _readLayerState() {
  try { return JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function _writeLayerState(state) {
  try { localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(state)); } catch { /* private window / quota */ }
}

function setLayerVisible(key, on) {
  const root = layerRoots[key];
  if (root) root.visible = !!on;
  if (key === 'junctionPlates') applyJunctionPlateLegacySupersession(!!on);
  if (key === 'splats') _applySplatMeshHandoff(!!on);
  const cb = document.getElementById(LAYER_DEFS.find((d) => d.key === key)?.checkboxId);
  if (cb) cb.checked = !!on;          // programmatic .checked set does NOT fire 'change'
  const state = _readLayerState();
  state[key] = !!on;
  _writeLayerState(state);
}

// Apply persisted layer choices (default visible) + wire the checkboxes. Called
// after the GLBs load so layerRoots is populated.
function installLayerToggles() {
  const stored = _readLayerState();
  for (const d of LAYER_DEFS) {
    const root = layerRoots[d.key];
    if (!root) continue;
    const on = stored[d.key] === undefined ? true : !!stored[d.key];
    root.visible = on;
    if (d.key === 'junctionPlates') applyJunctionPlateLegacySupersession(on);
    if (d.key === 'splats') _applySplatMeshHandoff(on);
    const cb = document.getElementById(d.checkboxId);
    if (cb) {
      if (d.hideWhenAbsent) {
        // layer exists for this site — reveal the hidden-by-default label
        const label = document.getElementById(`${d.checkboxId}-label`);
        if (label) label.style.display = '';
      }
      cb.checked = on;
      cb.addEventListener('change', () => setLayerVisible(d.key, cb.checked));
    }
  }
}

// ── GLB node elevations (authoritative DEM-sampled Z) ──────────
const glbNodeZ = new Map(); // node_id → centroid Z from nodes.glb

// ── Frame Data + Entities ──────────────────────────────────────
const twinRegistry = new Map();
const cohortActors = new Map();
const vehicleActors = new Map();
let vehiclesVisible = false;   // working-viewer default OFF; cinema turns them on
let edgeTrackIndex = null;     // built per scenario from the frames' own edge_metadata
let deckZSampler = null;       // (x,y) → nearest edges.json deck vert Z (bike seating)

// ── Actor placement (viewer-story-cinema §2) ───────────────────
// Z policy, per actor class (still interim — superseded when sim↔mesh
// edge-id mapping lands, three-agent-player D2/D5 stays open):
//   dots (crowd markers): max(terrain, lake) + ACTOR_LIFT balloon — elevated
//     on purpose so crowds read from a distance.
//   bike (surface prop): SEATED on the deck — nearest edges.json polyline_3d
//     vert (deckZSampler; the relief terrain has road footprints CUT OUT, so
//     terrainSampler is blind exactly where a bike rides), terrain fallback
//     off-road, + BIKE_LIFT z-fight margin. Wheels touch z=0 in the model.
//   vehicles: max(terrain, lake) + VEHICLE_LIFT.
// ONE lift constant per actor class; no per-edge offsets (no-polish rule).
const ACTOR_LIFT = 25;    // cohort marker height above ground (old node offset class)
const NODE_MARKER_AUTHORED_MAX_DIST_M = 10;  // sim node -> nearest intersections.json record (T2 node-cluster drift is 1-5 m)
const VEHICLE_LIFT = 6;   // vehicles hug their surface
const BIKE_LIFT = 0.3;    // bike wheels sit on the deck; margin beats z-fighting

function actorGroundZ(x, y, onWater) {
  const lakeZ = window.DT_SITE.lakeZ ?? -Infinity;
  if (onWater) return Number.isFinite(lakeZ) ? lakeZ : 0;
  const tz = terrainSampler ? terrainSampler(x, y) : NaN;
  return Math.max(Number.isFinite(tz) ? tz : window.DT_SITE.cameraTargetZ, lakeZ);
}

// Final placement Z for a cohort/vehicle actor at (x, y). The bike is the
// only surface-seated class; everything else keeps its balloon/hover lift.
function actorPlacementZ(actor, x, y, onWater) {
  if (actor.userData.vehicleType) return actorGroundZ(x, y, onWater) + VEHICLE_LIFT;
  if (actor.userData.modelKind === 'bike' && !onWater) {
    const dz = deckZSampler ? deckZSampler(x, y) : NaN;
    const lakeZ = window.DT_SITE.lakeZ ?? -Infinity;
    // max(deck, lake) is DELIBERATE (#62 review finding 3): a below-lake
    // authored deck is a data fault the below-lake diagnostic axis already
    // flags — rendering the bike underwater there would just make the
    // protagonist invisible. At lake level it sits where the deck should be.
    const ground = Number.isFinite(dz) ? Math.max(dz, lakeZ) : actorGroundZ(x, y, false);
    return ground + BIKE_LIFT;
  }
  return actorGroundZ(x, y, onWater) + ACTOR_LIFT;
}

// Deterministic per-cohort hash (replaces the old per-frame Math.random() Z
// jitter — the literal "bubble"): same cohort, same offset, every frame.
function cohortHash01(cid) {
  let h = 0;
  for (let i = 0; i < cid.length; i++) h = (h * 31 + cid.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}
let frameData = null;
let renderedStaticManifestBytes = null;
let canonicalAdapter = null;
let canonicalClock = null;
let canonicalProjection = null;
let canonicalResourceBaseUrl = null;
const canonicalManifestUrl = canonicalCandidateUrl(window.DT_SITE, location.search, location.href);
// Frameless sites must not display another site's scenario/transport controls.
document.body.classList.toggle('no-scenarios', window.DT_SITE.scenarios === false);
document.body.classList.toggle('no-playback', window.DT_SITE.scenarios === false && !canonicalManifestUrl);

// Paint authored props from the frame's presentation tokens. Each Face GLB gets
// its own restyled or preserved material in loadGLB, so fills stay local. The
// baked look (vertex colours or the flat default) is remembered on first touch
// and restored whenever the frame's token does not override — including
// frame zero after Reset. Hard cut, no tween: the ruling forbids animation.
function applyCanonicalPresentation(presentation) {
  const paint = presentationPaint(presentation, authoredPropRegistry.keys());
  for (const [propId, entry] of authoredPropRegistry) {
    const target = paint[propId];
    entry.scene.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return;
      const base = o.userData.presentationBase ??= {
        vertexColors: o.material.vertexColors === true,
        color: o.material.color.getHex(),
      };
      const vertexColors = target.fill ? false : base.vertexColors;
      if (o.material.vertexColors !== vertexColors) {
        o.material.vertexColors = vertexColors;
        o.material.needsUpdate = true;
      }
      o.material.color.set(target.fill ? target.color : base.color);
    });
  }
}

function renderCanonicalState(state, force = false) {
  playing = state.playing;
  document.getElementById('btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
  document.getElementById('btn-play').classList.toggle('active', playing);
  document.getElementById('scrubber').value = state.elapsedSeconds;
  document.getElementById('frame-counter').textContent = `${state.frameIndex + 1} / ${canonicalAdapter.frameTimesSeconds.length}`;
  const time = `${Math.floor(state.elapsedSeconds / 60).toString().padStart(2, '0')}:${Math.floor(state.elapsedSeconds % 60).toString().padStart(2, '0')}`;
  document.getElementById('time-display').textContent = time;
  document.getElementById('story-time').textContent = `${time} / ${canonicalAdapter.durationSeconds}s`;
  if (!force && canonicalProjection?.frameIndex === state.frameIndex) return;
  canonicalProjection = canonicalAdapter.selectFrame(state.frameIndex);
  applyCanonicalPresentation(canonicalProjection.presentation);
  document.getElementById('act-badge').textContent = canonicalProjection.beatLabel;
  document.getElementById('story-beat').textContent = canonicalProjection.beatLabel;
  const text = document.getElementById('story-text');
  text.replaceChildren();
  const notices = document.createElement('details'); notices.className = 'canonical-notices';
  const noticeSummary = document.createElement('summary');
  noticeSummary.textContent = '模擬候選資料 · 非農場操作建議'; notices.appendChild(noticeSummary);
  for (const notice of [...canonicalProjection.notices, '展示六塊田的模擬階段、擴散與通知。']) {
    const row = document.createElement('div'); row.textContent = notice; notices.appendChild(row);
  }
  text.appendChild(notices);
  for (const notification of canonicalProjection.notifications) {
    const row = document.createElement('div');
    row.dataset.notificationId = notification.id;
    row.className = 'canonical-notification';
    const message = document.createElement('div'); message.textContent = notification.text; row.appendChild(message);
    const detail = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = `來源識別碼 (${notification.sourceIds.length})`;
    detail.appendChild(summary);
    for (const sourceId of notification.sourceIds) {
      const source = document.createElement('div'); source.textContent = sourceId; detail.appendChild(source);
    }
    row.appendChild(detail); text.appendChild(row);
  }
  const links = document.getElementById('story-chips'); links.replaceChildren();
  for (const item of canonicalProjection.provenanceLinks) {
    const link = document.createElement('a'); link.className = 'story-chip'; link.textContent = item.label;
    link.href = localArtifactUrl(item.url, canonicalResourceBaseUrl);
    link.target = '_blank'; link.rel = 'noopener'; links.appendChild(link);
  }
  document.getElementById('story-card').classList.remove('hidden');
  refreshRuntimeInspection();
}

async function loadCanonicalPlayback() {
  if (!canonicalManifestUrl) return;
  if (!renderedStaticManifestBytes) throw new Error('Canonical playback requires the rendered static manifest bytes');
  canonicalAdapter = await loadCanonicalAdapter({ manifestUrl: canonicalManifestUrl, staticManifestBytes: renderedStaticManifestBytes });
  canonicalResourceBaseUrl = new URL('.', canonicalManifestUrl).href;
  canonicalClock = createCanonicalClock(canonicalAdapter);
  document.body.classList.add('canonical-site');
  setRuntimeInspectionProvider(id => canonicalProjection?.inspection[id] || []);
  document.title = canonicalAdapter.title;
  document.querySelector('#hud h1').textContent = canonicalAdapter.title;
  const speed = document.getElementById('speed-select'); speed.value = '200';
  const scrubber = document.getElementById('scrubber'); scrubber.max = canonicalAdapter.durationSeconds; scrubber.step = '0.01';
  for (const id of ['scenario-select', 'btn-cinema', 'btn-toggle-story', 'btn-toggle-markers', 'btn-toggle-vehicles']) document.getElementById(id).style.display = 'none';
  const reset = document.createElement('button'); reset.id = 'btn-reset'; reset.className = 'btn'; reset.textContent = 'Reset';
  reset.addEventListener('click', () => { canonicalProjection = null; renderCanonicalState(canonicalClock.reset(), true); });
  document.getElementById('btn-step-fwd').after(reset);
  renderCanonicalState(canonicalClock.reset(), true);
  // Use the site's existing close-oblique preset and existing camera transition path.
  // Finish it before the first render rather than exposing the regional startup pose.
  const initialViewpoint = Object.keys(VIEWPOINTS)[0];
  if (initialViewpoint) {
    flyTo(initialViewpoint);
    updateFly(flyAnimation.startTime + flyAnimation.duration);
  }
}
let currentFrame = 0;
let markersVisible = false;

// ── Story mode (sml-red-v5 task 5.2) ───────────────────────────
// director_narration_<scenario>.json carries the scriptor's beat prose;
// story mode shows the active beat card and keeps the wannabe protagonist
// visible independent of the Markers toggle. Auto-ON when narration exists —
// but an explicit toggle choice outlives scenario switches (loadNarration
// runs on every switch; without the choice flag it would force ON again).
let narrationBeats = [];
let storyMode = false;
let storyUserChoice = null;   // null = never toggled; auto-ON applies
let currentStoryBeat = null;
let storyConfig = null;       // Director story config (story_<scenario>.json)

async function loadNarration(scenario) {
  narrationBeats = [];
  currentStoryBeat = null;
  storyConfig = null;
  try {
    const resp = await fetch(window.DT_assetUrl(`director_narration_${scenario}.json`));
    if (resp.ok) narrationBeats = buildBeatIndex(await resp.json());
  } catch { /* narration is optional — story mode just stays off */ }
  // Director story config: protagonist tracks + camera plans + pacing.
  // Optional. Section-granular salvage: a bad beat drops THAT beat loudly,
  // not the whole config — one typo must not silently revert the protagonist
  // to the /wannabe/ id-sniff. (The repo gate stays strict: the pytest
  // lineage gate runs validateStoryConfig and fails the build on ANY error.)
  try {
    const cfgResp = await fetch(window.DT_assetUrl(`story_${scenario}.json`));
    if (cfgResp.ok) {
      const { config: kept, errors: errs } = sanitizeStoryConfig(await cfgResp.json());
      if (errs.length) console.error(`[dt] story_${scenario}.json: invalid entries dropped — fix the config: ${errs.join('; ')}`);
      storyConfig = kept;
      // Honest signposting (#57 finding 6): report what is ACTUALLY active —
      // all sections are consumed now (tracks by the actor layer, the rest by
      // cinema mode §4), but a section sanitize dropped must not be claimed.
      if (storyConfig) {
        const active = ['protagonist_tracks', 'beats', 'defaults', 'closing_card', 'display']
          .filter((k) => storyConfig[k]
            && (Array.isArray(storyConfig[k]) ? storyConfig[k].length : Object.keys(storyConfig[k]).length));
        console.info(`[dt] story_${scenario}.json active sections: ${active.join('/') || 'none'} (beats/pacing/closing_card consumed by cinema mode)`);
        if (!active.includes('protagonist_tracks')) {
          console.warn(`[dt] story_${scenario}.json: protagonist_tracks absent or dropped — protagonist falls back to the /wannabe/ id sniff`);
        }
      }
    }
  } catch (err) {
    // Config is optional (absent file → !ok above, silent). A PARSE/network
    // throw is a real problem — say so instead of silently discarding (#57 F4).
    console.error(`[dt] story_${scenario}.json load failed — config skipped:`, err);
  }
  storyMode = narrationBeats.length > 0 && storyUserChoice !== false;
  const btn = document.getElementById('btn-toggle-story');
  btn.style.display = narrationBeats.length ? '' : 'none';
  btn.textContent = `Story: ${storyMode ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', storyMode);
}

function updateStoryOverlay(frameTime) {
  const card = document.getElementById('story-card');
  const beat = storyMode ? currentBeat(narrationBeats, frameTime) : null;
  if (!beat) {
    card.classList.add('hidden');
    currentStoryBeat = null;
    return;
  }
  if (beat !== currentStoryBeat) {
    currentStoryBeat = beat;
    document.getElementById('story-time').textContent = beat.time;
    // Lower-third copy (§4): 中文 headline + EN subline when the scriptor
    // authored them (`title_zh`/`excerpt_en`); prettified slug + prose is the
    // documented fallback (current narration bakes carry neither).
    document.getElementById('story-beat').textContent =
      beat.title_zh || (beat.beat || '').replaceAll('_', ' ');
    document.getElementById('story-text').textContent =
      ((cinema && beat.excerpt_en) || beat.text || '').trim();
    renderStoryChips(beat);
  }
  card.classList.remove('hidden');
}

// Metric chips docked to the story card (cinema only, CSS-gated): the beat's
// own baked metrics snapshot from director_narration_*.json — no free-typed
// numbers. Chip provenance rides the container's title attribute.
function renderStoryChips(beat) {
  const box = document.getElementById('story-chips');
  if (!box) return;
  box.textContent = '';
  const m = beat.metrics || {};
  const chips = [];
  if (m.total_pax != null) chips.push(`在場 ${Number(m.total_pax).toLocaleString()}`);
  if (m.top_node) chips.push(`尖峰 ${m.top_node}`);
  if (m.cohort_count != null) chips.push(`${m.cohort_count} cohorts`);
  for (const c of chips) {
    const el = document.createElement('span');
    el.className = 'story-chip';
    el.textContent = c;
    box.appendChild(el);
  }
  box.title = 'source: director_narration metrics (baked per-beat snapshot)';
}

// Monotonic load generation: concurrent loadFrameData calls (cinema chapter
// switch racing an Esc-exit restore, #63 review finding 3) resolve to a
// single winner — a superseded load bails after its awaits instead of
// clobbering frameData/actors with the older scenario. Narration globals
// keep a narrower last-writer window (loadNarration's own small fetches);
// accepted — they are idempotent per scenario and re-run on the next switch.
let frameLoadGen = 0;

async function loadFrameData(scenario) {
  const gen = ++frameLoadGen;
  setLoading('Loading scenario frames...', 6);
  const url = window.DT_assetUrl(`frames_${scenario}_viewer.json`);
  const resp = await fetch(url);
  const parsed = await resp.json();
  if (gen !== frameLoadGen) return;   // superseded while fetching
  frameData = parsed;
  // viewer-story-cinema: fail LOUD on a frame schema this player doesn't
  // speak (silent staleness is how the schema-1 "bubbling" survived a
  // quarter). Schema-1 bakes (no frame_schema key) keep working — actors
  // just fall back to node placement.
  if (frameData.frame_schema != null && frameData.frame_schema > 2) {
    throw new Error(
      `frames_${scenario}: unsupported frame_schema ${frameData.frame_schema} (player speaks ≤ 2)`);
  }
  if (frameData.frame_schema == null) {
    console.log(`[dt] frames_${scenario}: schema-1 bake — no edge positions, actors use node placement`);
  }
  await loadNarration(scenario);  // non-fatal; story mode auto-ON when present
  await rebuildNameIndex();  // node_metadata names now available (viewer-click-names)
  // twin → sim-node reverse link for the T2 card (sml-twin-projection-threading);
  // idempotent per scenario switch, same node_metadata registry either way.
  setTwinToSimNodeIndex(buildTwinToSimNodeIndex(frameData.node_metadata));
  if (gen !== frameLoadGen) return;   // superseded during narration/name loads

  document.getElementById('scrubber').max = frameData.frame_count - 1;
  document.getElementById('frame-counter').textContent =
    `0 / ${frameData.frame_count}`;

  setLoading('Creating node markers...', 7);
  createNodeMarkers();
  setLoading('Creating cohort actors...', 8);
  // Track index first: actors resolve schema-2 position_edge against the
  // frames' OWN edge_metadata polylines (ferries included, id-consistent).
  edgeTrackIndex = buildEdgeTrackIndex(frameData.edge_metadata || {}, geoToLocal);
  stopFollow();   // the followed id belongs to the OLD scenario's actor map
  createCohortActors();
  createVehicleActors();

  applyFrame(0);
}

// Balloons + stems created by the LAST createNodeMarkers run, so a scenario
// switch REPLACES them (sml-stairs-flat-axis). The old strip loop removed
// N*-prefixed twinRegistry entries only: J_* balloons and ALL stems leaked on
// every scenario switch, and it also deleted the baked GLB node meshes —
// emptying the Nodes layer of named twins (the "N16 missing" report) while
// leaving J_* meshes in it. The GLB meshes now stay put: the Nodes layer shows
// ALL baked graph nodes; balloons are the frame-driven overlay on top.
let nodeMarkers = new Map();   // nid -> { sphere, stem, prevTwin }

function createNodeMarkers() {
  // Replace last run's balloons — never the baked GLB meshes. Restore the
  // twinRegistry entry the balloon displaced (the GLB mesh) so goto/extent
  // keeps resolving nodes that the NEW scenario's metadata doesn't carry.
  for (const [nid, m] of nodeMarkers) {
    m.sphere.parent?.remove(m.sphere);
    m.stem.parent?.remove(m.stem);
    if (twinRegistry.get(nid) === m.sphere) {
      if (m.prevTwin) twinRegistry.set(nid, m.prevTwin);
      else twinRegistry.delete(nid);
    }
  }
  nodeMarkers = new Map();

  const nm = frameData.node_metadata;
  const BALLOON_HEIGHT = 18;
  const sphereGeo = new THREE.SphereGeometry(3, 8, 6);
  const stemMat = new THREE.LineBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.5, toneMapped: false });

  // Authored node Z (sml-node-z-evidence-gates): sim junctions (J_*) have no
  // baked GLB Z, and falling straight to terrain+5 displays an arbitrary
  // render offset for exactly the nodes whose Z the pipeline computed — the
  // J_9247191279 eye-test read that accident as data. Prefer the nearest
  // intersections.json record (loadDiagnostics runs before loadFrameData).
  const authoredNodeZ = buildNodeZLookup(DIAG.intersections, geoToLocal);

  for (const [nid, meta] of Object.entries(nm)) {
    // sml-poi-descriptive-cards: a twin with a POI label sprite doesn't also
    // get a balloon — the label IS its overhead marker (people click the
    // building or the ball, not the balloon). Labels load at boot P4, before
    // the first frames load, so the set is filled here; if it were ever empty
    // the balloon simply reappears (degraded, never broken). Skipping also
    // leaves the baked ball as the twin's registry entry (technical card).
    if (meta.twin_id && _poiLabelTwinIds.has(String(meta.twin_id))) continue;
    const [x, y] = geoToLocal(meta.lat, meta.lng);
    const _tz = terrainSampler ? terrainSampler(x, y) : NaN;  // NaN outside the terrain hull
    const _authoredZ = glbNodeZ.has(nid) ? null : authoredNodeZ(x, y, NODE_MARKER_AUTHORED_MAX_DIST_M);
    const groundZ = glbNodeZ.has(nid) ? glbNodeZ.get(nid) :
        _authoredZ ??
        (Math.max(Number.isFinite(_tz) ? _tz : window.DT_SITE.cameraTargetZ, window.DT_SITE.lakeZ ?? -Infinity) + 5);
    const balloonZ = groundZ + BALLOON_HEIGHT;

    const color = nodeColor(meta.archetype);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, toneMapped: false });
    const sphere = new THREE.Mesh(sphereGeo, mat);
    sphere.position.set(x, y, balloonZ);
    sphere.userData = { twinId: nid, ...meta };
    sphere.visible = markersVisible;
    scene.add(sphere);
    const prevTwin = twinRegistry.get(nid) || null;   // the baked GLB mesh, if any
    twinRegistry.set(nid, sphere);

    // Stem line from ground to balloon
    const stemGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, y, groundZ),
      new THREE.Vector3(x, y, balloonZ),
    ]);
    const stem = new THREE.Line(stemGeo, stemMat);
    stem.visible = markersVisible;
    sphere.userData._stem = stem;
    scene.add(stem);
    nodeMarkers.set(nid, { sphere, stem, prevTwin });
  }
}

function nodeColor(archetype) {
  const map = {
    'transport-station': 0x1e88e5,
    'transport-junction': 0x1565c0,
    'transport-hub': 0x0d47a1,
    'visitor-facility': 0xff8f00,
    'scenic-viewpoint': 0x43a047,
    'food-street': 0xfdd835,
    'accommodation-zone': 0x8e24aa,
    'recreation-area': 0x00acc1,
    'commerce-area': 0xfdd835,
    'cycling-rental': 0x76ff03,
    'cycling-hub': 0x00e676,
  };
  return map[archetype] || 0x888888;
}

// Vehicle actor shapes — simple glyph-level geometry per type (hulls/fill
// bars are the polish tier). Shared per-type materials; scene actors, not
// registry colors, so they take the scene grade like other scenery.
const VEHICLE_SPECS = {
  ferry:   { size: [26, 9, 6],  color: 0x2277bb },
  bus:     { size: [12, 3.6, 3.6], color: 0xd9a441 },
  ropeway: { size: [4, 3, 3],   color: 0x8877aa },
  unknown: { size: [8, 3, 3],   color: 0x999999 },
};
const _vehicleMats = new Map();
const _vehicleGeos = new Map();

function createVehicleActors() {
  for (const [, obj] of vehicleActors) scene.remove(obj);
  vehicleActors.clear();
  if (!frameData || !frameData.frames) return;

  // Prescan for the distinct vehicle ids + types this scenario ever shows.
  const types = new Map();
  for (const f of frameData.frames) {
    for (const [vid, v] of Object.entries(f.vehicles || {})) {
      if (!types.has(vid)) types.set(vid, v.vehicle_type || 'unknown');
    }
  }
  for (const [vid, vtype] of types) {
    const spec = VEHICLE_SPECS[vtype] || VEHICLE_SPECS.unknown;
    if (!_vehicleGeos.has(vtype)) _vehicleGeos.set(vtype, new THREE.BoxGeometry(...spec.size));
    if (!_vehicleMats.has(vtype)) _vehicleMats.set(vtype, new THREE.MeshBasicMaterial({ color: spec.color }));
    const mesh = new THREE.Mesh(_vehicleGeos.get(vtype), _vehicleMats.get(vtype));
    mesh.visible = false;
    mesh.name = `vehicle:${vid}`;
    mesh.userData = { vehicleId: vid, vehicleType: vtype };
    scene.add(mesh);
    vehicleActors.set(vid, mesh);
  }
}

// Sub-frame glide: between applyFrame ticks, actors with a look-ahead tween
// slide along the edge polyline toward the next frame's position.
function updateActorTweens(alpha) {
  if (!edgeTrackIndex) return;
  for (const actorMap of [cohortActors, vehicleActors]) {
    for (const [, actor] of actorMap) {
      const tw = actor.userData.tween;
      if (!actor.visible || !tw) continue;
      const p = interpolatePosition(edgeTrackIndex, tw.from, tw.to, alpha);
      if (!p) continue;
      actor.position.set(p.x, p.y, actorPlacementZ(actor, p.x, p.y, tw.onWater));
      if (p.headingRad != null) actor.userData.headingRad = p.headingRad;
      if (actor.userData.vehicleType && p.headingRad != null) actor.rotation.z = p.headingRad;
      if (actor.userData.modelKind === 'bike' && p.headingRad != null) actor.rotation.z = p.headingRad;
    }
  }
}

let _bikeGeo = null;   // shared merged geometry across all cycling-cohort actors
let _dotGeo = null;    // shared sphere for non-bike cohorts + bikes-on-water

function createCohortActors() {
  // Dispose the per-actor materials (#57 finding 3) — ~90 MeshBasicMaterials
  // leaked per scenario switch otherwise. Geometries are SHARED (_dotGeo /
  // _bikeGeo) and must survive.
  for (const [, obj] of cohortActors) { scene.remove(obj); obj.material.dispose(); }
  cohortActors.clear();

  const cm = frameData.cohort_metadata;
  if (!cm) return;

  if (!_dotGeo) _dotGeo = new THREE.SphereGeometry(1, 8, 6);
  const geo = _dotGeo;
  if (!_bikeGeo) _bikeGeo = buildBikeGeometry(THREE);
  for (const [cid, meta] of Object.entries(cm)) {
    // The protagonist gets the story gold — identifiable at a glance even
    // among visible cohort markers. Routed through the story config's
    // declared tracks when present (viewer-story-cinema D3), falling back
    // to the /wannabe/ id convention.
    const wannabe = isProtagonist(cid, storyConfig);
    const color = wannabe ? new THREE.Color(WANNABE_COLOR)
                          : new THREE.Color(meta.color || '#ffffff');
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: wannabe ? 0.95 : 0.8, toneMapped: false });
    // Cycling cohorts ride the toy bike model instead of the crowd sphere.
    const isBike = /cycling/i.test(meta.archetype || '') || /wannabe_ride/i.test(cid);
    const mesh = new THREE.Mesh(isBike ? _bikeGeo : geo, mat);
    mesh.visible = false;
    mesh.userData = { cohortId: cid, isWannabe: wannabe, ...meta, modelKind: isBike ? 'bike' : 'dot' };
    scene.add(mesh);
    cohortActors.set(cid, mesh);
  }
}

function applyFrame(idx) {
  if (!frameData || idx < 0 || idx >= frameData.frames.length) return;
  currentFrame = idx;
  const frame = frameData.frames[idx];
  const nextFrame = frameData.frames[idx + 1];
  applyEnvironmentForFrame(frame);

  // Time display
  document.getElementById('time-display').textContent = frame.time || '--:--';
  const actBadge = document.getElementById('act-badge');
  actBadge.textContent = frame.act ? `ACT ${frame.act}` : '--';

  // Update cohort positions
  if (frame.cohorts) {
    // Hide all first
    for (const [, actor] of cohortActors) actor.visible = false;

    for (const [cid, state] of Object.entries(frame.cohorts)) {
      const actor = cohortActors.get(cid);
      if (!actor) continue;

      // Continuous placement: schema-2 position_edge resolved on the edge
      // polyline (viewer-story-cinema §2). Look-ahead tween target = the
      // NEXT frame's position, so playback glides into the next applyFrame
      // instead of snapping. Unresolvable → node fallback, never fabricated.
      let placed = false;
      const posEdge = state.position_edge;
      if (posEdge && edgeTrackIndex) {
        const p = resolveEdgePosition(edgeTrackIndex, posEdge);
        if (p) {
          const onWater = edgeTrackIndex.get(posEdge.edge_id)?.mode === 'ferry';
          // A cycling cohort aboard a ferry is a passenger, not a floating
          // bike: swap to the dot on water, back to the bike on land.
          if (actor.userData.modelKind === 'bike') {
            const g = onWater ? _dotGeo : _bikeGeo;
            if (actor.geometry !== g) actor.geometry = g;
          }
          actor.position.set(p.x, p.y, actorPlacementZ(actor, p.x, p.y, onWater));
          actor.userData.headingRad = p.headingRad;
          if (actor.userData.modelKind === 'bike' && p.headingRad != null) actor.rotation.z = p.headingRad;
          const nextPos = nextFrame?.cohorts?.[cid]?.position_edge;
          actor.userData.tween = nextPos ? { from: posEdge, to: nextPos, onWater } : null;
          placed = true;
        }
      }
      if (!placed) {
        actor.userData.tween = null;
        const dist = state.distribution;
        if (!dist) continue;

        // Position at the node with highest distribution fraction
        let bestNode = null, bestFrac = 0;
        for (const [nid, frac] of Object.entries(dist)) {
          if (frac > bestFrac) { bestFrac = frac; bestNode = nid; }
        }

        if (!bestNode || !twinRegistry.has(bestNode)) continue;
        const nodePos = twinRegistry.get(bestNode).position;
        actor.position.copy(nodePos);
        if (actor.userData.modelKind === 'bike') {
          // A dwelling bike parks on the ground, not in the balloon stack.
          actor.position.z = actorPlacementZ(actor, nodePos.x, nodePos.y, false);
        } else {
          actor.position.z += 20 + cohortHash01(cid) * 10;
        }
      }

      actor.userData.live = state;   // inspector card reads the live frame state
      const size = state.size || 50;
      const scale = Math.max(1, Math.sqrt(size) * 0.3);
      actor.scale.setScalar(scale * (actor.userData.isWannabe ? WANNABE_SCALE_BOOST : 1));
      // The protagonist stays visible in story mode regardless of Markers.
      // Cinema (D7): background cohorts show at ≥ the config's display
      // threshold (cited ⚠ ENGINE stragglers stay hidden); working mode is
      // unaffected and still shows everything Markers shows.
      actor.visible = cinema
        ? (actor.userData.isWannabe || size >= (storyConfig?.display?.min_cohort_pax ?? 0))
        : (markersVisible || (storyMode && actor.userData.isWannabe));
    }
  }

  // Vehicles (viewer-story-cinema §2): position_edge → v1 current_edge+progress
  // → baked lat/lng → stopped-at-node; never fabricated.
  if (vehicleActors.size) {
    for (const [, v] of vehicleActors) v.visible = false;
    for (const [vid, vs] of Object.entries(frame.vehicles || {})) {
      const actor = vehicleActors.get(vid);
      if (!actor) continue;
      const onWater = actor.userData.vehicleType === 'ferry';
      let p = null;
      let posEdge = vs.position_edge;
      if (!posEdge && vs.current_edge && edgeTrackIndex) {
        const track = edgeTrackIndex.get(vs.current_edge);
        if (track) {
          posEdge = { edge_id: vs.current_edge, direction: 'forward',
                      offset_m: (vs.progress || 0) * track.length };
        }
      }
      if (posEdge && edgeTrackIndex) p = resolveEdgePosition(edgeTrackIndex, posEdge);
      if (!p && vs.lat != null && vs.lng != null) {
        const [x, y] = geoToLocal(vs.lat, vs.lng);
        // baked heading is degrees clockwise from north → math radians
        p = { x, y, headingRad: (90 - (vs.heading || 0)) * Math.PI / 180 };
      }
      if (!p && vs.position_node && twinRegistry.has(vs.position_node)) {
        const np = twinRegistry.get(vs.position_node).position;
        p = { x: np.x, y: np.y, headingRad: null };
      }
      if (!p) continue;
      actor.userData.live = vs;      // inspector card reads the live frame state
      actor.position.set(p.x, p.y, actorPlacementZ(actor, p.x, p.y, onWater));
      if (p.headingRad != null) actor.rotation.z = p.headingRad;
      const nextVs = nextFrame?.vehicles?.[vid];
      actor.userData.tween = (posEdge && nextVs?.position_edge)
        ? { from: posEdge, to: nextVs.position_edge, onWater } : null;
      actor.visible = vehiclesVisible;
    }
  }

  // Story beat card follows the sim clock (held until the next beat).
  updateStoryOverlay(frame.time);

  // Cinema beat engine: every frame application (playback OR jump) advances
  // the film schedule — beats whose sim time has arrived fire pace + camera.
  if (cinema) cinemaOnFrame(frame.time, performance.now());

  // Update node crowd levels
  if (frame.nodes) {
    for (const [nid, state] of Object.entries(frame.nodes)) {
      const marker = twinRegistry.get(nid);
      if (!marker) continue;
      const cl = state.crowd_level || 0;
      marker.scale.setScalar(1 + cl * 0.25);
    }
  }

  // Update edge flow colors (per-twin addressable)
  if (frame.edge_flows) {
    const red = new THREE.Color(1.0, 0.05, 0.05);
    const baseColor = new THREE.Color(0.2, 0.2, 0.2); // road grey
    const _flowC = new THREE.Color();
    for (const [eid, flow] of Object.entries(frame.edge_flows)) {
      const ratio = Math.min(1, Math.max(0, flow.saturation || flow.flow_ratio || 0));
      if (edgeBatch) {
        // sml-edge-mesh-merge: solid per-instance recolor (batch is vertexColors-off
        // + white, so the instance color IS the rendered color). No else-reset —
        // legacy flow only tinted up (never cleared), so a diagnostic tint set in
        // loadDiagnostics survives low-flow frames exactly as before.
        if (ratio > 0.01) edgeBatch.setEdgeColor(eid, _flowC.copy(baseColor).lerp(red, ratio).getHex());
      } else {
        const mat = edgeMaterials.get(eid);
        if (!mat) continue;
        if (ratio > 0.01) {
          mat.color.copy(baseColor).lerp(red, ratio);
          mat.vertexColors = false;
          mat.needsUpdate = true;
        }
      }
    }
  }

  // UI
  document.getElementById('scrubber').value = idx;
  document.getElementById('frame-counter').textContent =
    `${idx + 1} / ${frameData.frame_count}`;
}

// ── Playback ───────────────────────────────────────────────────
let playing = false;
let playSpeed = 40; // ms per frame
let lastTick = 0;

function togglePlay() {
  if (canonicalClock) { renderCanonicalState(canonicalClock.setPlaying(!canonicalClock.state().playing)); return; }
  playing = !playing;
  document.getElementById('btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
  document.getElementById('btn-play').classList.toggle('active', playing);
}

function stepFrame(delta) {
  if (canonicalClock) { renderCanonicalState(canonicalClock.step(delta)); return; }
  const next = currentFrame + delta;
  if (frameData && next >= 0 && next < frameData.frame_count) {
    applyFrame(next);
    return;
  }
  if (!frameData && ENV.name === 'sunrise-demo') {
    setFramelessEnvironmentProgress(environmentProgress + delta * 0.01);
  }
}

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('btn-step-back').addEventListener('click', () => stepFrame(-1));
document.getElementById('btn-step-fwd').addEventListener('click', () => stepFrame(1));
document.getElementById('speed-select').addEventListener('change', e => {
  if (canonicalClock) { renderCanonicalState(canonicalClock.setSpeed(parseFloat(e.target.selectedOptions[0].textContent))); return; }
  playSpeed = parseInt(e.target.value);
});
document.getElementById('scrubber').addEventListener('input', e => {
  if (canonicalClock) { renderCanonicalState(canonicalClock.seek(Number(e.target.value))); return; }
  if (frameData) {
    applyFrame(parseInt(e.target.value));
  } else if (ENV.name === 'sunrise-demo') {
    setFramelessEnvironmentProgress(parseInt(e.target.value) / 100);
  }
});
document.getElementById('scenario-select').addEventListener('change', async e => {
  if (canonicalManifestUrl) return;
  await loadFrameData(e.target.value);
});
document.getElementById('btn-toggle-markers').addEventListener('click', () => {
  setMarkersVisible(!markersVisible);
});
// Shared with cinema mode (which hides the balloon crowd and restores on exit).
function setMarkersVisible(on) {
  markersVisible = on;
  document.getElementById('btn-toggle-markers').textContent =
    `Markers: ${markersVisible ? 'ON' : 'OFF'}`;
  document.getElementById('btn-toggle-markers').classList.toggle('active', markersVisible);
  for (const [, obj] of twinRegistry) {
    obj.visible = markersVisible;
    if (obj.userData?._stem) obj.userData._stem.visible = markersVisible;
  }
  // Recompute cohort-actor visibility from the current frame — keeps the
  // story-mode wannabe visible when Markers goes OFF.
  if (frameData) applyFrame(currentFrame);
}
document.getElementById('btn-toggle-vehicles').addEventListener('click', () => {
  setVehiclesVisible(!vehiclesVisible);
});
// Shared with cinema mode (which forces vehicles on and restores on exit).
function setVehiclesVisible(on) {
  vehiclesVisible = on;
  const btn = document.getElementById('btn-toggle-vehicles');
  btn.textContent = `Vehicles: ${vehiclesVisible ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', vehiclesVisible);
  if (frameData) applyFrame(currentFrame);
}
document.getElementById('btn-toggle-story').addEventListener('click', () => {
  storyMode = !storyMode;
  storyUserChoice = storyMode;
  const btn = document.getElementById('btn-toggle-story');
  btn.textContent = `Story: ${storyMode ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', storyMode);
  if (frameData) applyFrame(currentFrame);
});

// ── Camera viewpoints (site-driven; built from DT_SITE.viewpoints) ──
// Raw presets carry {pos,target} in local space (e.g. aerial). Geo-anchored
// presets carry {posAnchor,posOffset,posZ,targetAnchor,targetZ} in lat/lng and
// resolve through the active site's geoToLocal — no hardcoded site coords here.
function buildViewpoints(site, geo) {
  const out = {};
  for (const [name, vp] of Object.entries(site.viewpoints || {})) {
    if (vp.pos && vp.target) {
      out[name] = { pos: vp.pos.slice(), target: vp.target.slice() };
      continue;
    }
    // Shared with cinema pose beats (D4: same math, one implementation).
    out[name] = resolveStoryPose(vp, geo);
  }
  return out;
}
const VIEWPOINTS = buildViewpoints(window.DT_SITE, geoToLocal);

let flyAnimation = null;
let flyOnArrive = null;  // callback fired once when current fly completes
let mobileGestures = null;
let mobileChrome = null;

// flyTo accepts either a preset name string (legacy) or a {pos, target, duration?, onArrive?}
// object. See three-viewer-controls R5.
function flyTo(arg) {
  mobileGestures?.cancel();
  let pos, target, duration = 1200, onArrive = null;
  if (typeof arg === 'string') {
    const vp = VIEWPOINTS[arg];
    if (!vp) return;
    pos = vp.pos;
    target = vp.target;
  } else if (arg && typeof arg === 'object' && arg.pos && arg.target) {
    pos = arg.pos;
    target = arg.target;
    if (typeof arg.duration === 'number') duration = arg.duration;
    if (typeof arg.onArrive === 'function') onArrive = arg.onArrive;
  } else {
    return;
  }

  flyAnimation = {
    startPos: camera.position.clone(),
    startTarget: controls.target.clone(),
    endPos: new THREE.Vector3(...pos),
    endTarget: new THREE.Vector3(...target),
    startTime: performance.now(),
    duration,
  };
  flyOnArrive = onArrive;
}

function flyAnimationActive() {
  return flyAnimation !== null;
}

// Embed extension hook: local Z-up metres, without changing the orbit pose.
function translateCameraTarget(dx, dy, dz) {
  if (![dx, dy, dz].every(Number.isFinite) || !window.__dtEmbed || !controls) return false;
  flyAnimation = null;
  flyOnArrive = null;
  const delta = new THREE.Vector3(dx, dy, dz);
  camera.position.add(delta);
  controls.target.add(delta);
  controls.update();
  return true;
}

// Embed-only synchronous pose. Validate before cancelling any existing motion.
function setCameraPose(position, target) {
  const valid = value => Array.isArray(value) && value.length === 3
    && [0, 1, 2].every(i => Number.isFinite(value[i]));
  if (!window.__dtEmbed || !camera || !controls || !valid(position) || !valid(target)) return false;
  const offset = new THREE.Vector3(...position).sub(new THREE.Vector3(...target));
  const distance = offset.length();
  const polar = Math.acos(THREE.MathUtils.clamp(offset.z / distance, -1, 1));
  if (!Number.isFinite(distance) || distance === 0 || distance < controls.minDistance
      || distance > controls.maxDistance || !Number.isFinite(polar)
      || polar < controls.minPolarAngle || polar > controls.maxPolarAngle
      || position[2] < window.DT_SITE?.cameraFloorZ) return false;

  flyAnimation = null;
  flyOnArrive = null;
  mobileGestures?.cancel();
  // Pinned OrbitControls recomputes spherical coordinates from the live pose.
  // Clear its accumulated input, including cursor dolly, so controls.update()
  // is inert whether the extension RAF runs before or after the viewer RAF.
  controls._sphericalDelta.set(0, 0, 0);
  controls._panOffset.set(0, 0, 0);
  controls._scale = 1;
  controls._performCursorZoom = false;
  camera.position.fromArray(position);
  controls.target.fromArray(target);
  camera.lookAt(controls.target);
  camera.updateMatrixWorld(true);
  return true;
}

// ── Follow-cam (viewer-story-cinema §3.4) ──────────────────────
// Damped chase on a moving actor: controls.target eases toward a point just
// ahead of the actor (short time constant) while the camera eases toward a
// pose behind its travel heading (longer constant) — the marker leads, the
// camera breathes. Ported from the legacy 2D updateFollowMeiCamera onto the
// orbit world. One-shot flyTo set-pieces own the camera while active
// (updateFollowCam yields to flyAnimationActive); any user gesture pauses
// the chase until resumeFollow().
let followState = null;   // { id, spec, paused }
const FOLLOW_DEFAULTS = { distance_m: 140, height_m: 70, look_ahead_m: 30 };
const _followDesired = new THREE.Vector3();
const _followCam = new THREE.Vector3();

function startFollow(id, spec) {
  mobileGestures?.cancel();
  followState = { id, spec: { ...FOLLOW_DEFAULTS, ...(spec || {}) }, paused: false, prev: null };
}
function stopFollow() { followState = null; }
function resumeFollow() {
  mobileGestures?.cancel();
  if (followState) followState.paused = false;
}

// τ of the exponential chase (ms): target leads the camera so turns read.
const FOLLOW_TAU_TARGET_MS = 800;
const FOLLOW_TAU_CAM_MS = 1200;
// Chasing a moving target, a first-order lerp filter converges to a TRAILING
// offset of exactly v·τ — negligible at real-time speeds, but at cinema time
// compression (~5 sim-min/s ⇒ the rider moves ~1000 m per wall-second) it is
// a kilometer: the camera visibly parked at 水社 while the protagonist left
// (2026-07-06 live report). Feed-forward aims the filter at position + v·τ,
// cancelling the steady-state error at ANY tempo while keeping the damping.
const FOLLOW_V_CAP_M_S = 3000;   // sane bound on the velocity estimate
const FOLLOW_SNAP_M = 600;       // beyond this, cut — don't crawl across the map

function updateFollowCam(dtMs) {
  if (!followState || followState.paused || flyAnimationActive()) {
    if (followState) followState.prev = null;   // stale positions make fake velocity
    return;
  }
  const actor = cohortActors.get(followState.id) || vehicleActors.get(followState.id);
  if (!actor || !actor.visible) {
    followState.prev = null;
    return;
  }
  const spec = followState.spec;
  const h = actor.userData.headingRad;
  let cos, sin;
  if (h != null) {
    cos = Math.cos(h);
    sin = Math.sin(h);
  } else {
    // Stationary/unknown heading: keep the camera's current bearing.
    const dx = camera.position.x - controls.target.x;
    const dy = camera.position.y - controls.target.y;
    const len = Math.hypot(dx, dy) || 1;
    cos = -dx / len;
    sin = -dy / len;
  }
  // Velocity estimate from the tweened actor motion (m/s), capped.
  const p = actor.position;
  let vx = 0, vy = 0, vz = 0;
  const prev = followState.prev;
  if (prev && dtMs > 0) {
    vx = (p.x - prev.x) / dtMs * 1000;
    vy = (p.y - prev.y) / dtMs * 1000;
    vz = (p.z - prev.z) / dtMs * 1000;
    const mag = Math.hypot(vx, vy, vz);
    if (mag > FOLLOW_V_CAP_M_S) {
      const s = FOLLOW_V_CAP_M_S / mag;
      vx *= s; vy *= s; vz *= s;
    }
  }
  followState.prev = { x: p.x, y: p.y, z: p.z };
  _followDesired.set(p.x + cos * spec.look_ahead_m + vx * (FOLLOW_TAU_TARGET_MS / 1000),
                     p.y + sin * spec.look_ahead_m + vy * (FOLLOW_TAU_TARGET_MS / 1000),
                     p.z + vz * (FOLLOW_TAU_TARGET_MS / 1000));
  _followCam.set(p.x - cos * spec.distance_m + vx * (FOLLOW_TAU_CAM_MS / 1000),
                 p.y - sin * spec.distance_m + vy * (FOLLOW_TAU_CAM_MS / 1000),
                 p.z + spec.height_m + vz * (FOLLOW_TAU_CAM_MS / 1000));
  // Shot acquisition / teleport (pose→follow beat, skip_to jump): CUT to the
  // chase pose instead of a multi-second crawl from wherever the camera was.
  if (camera.position.distanceTo(_followCam) > FOLLOW_SNAP_M) {
    camera.position.copy(_followCam);
    controls.target.copy(_followDesired);
    return;
  }
  // Frame-rate-independent exponential easing (τ target 0.8 s, camera 1.2 s).
  const kT = 1 - Math.exp(-dtMs / FOLLOW_TAU_TARGET_MS);
  const kP = 1 - Math.exp(-dtMs / FOLLOW_TAU_CAM_MS);
  controls.target.lerp(_followDesired, kT);
  camera.position.lerp(_followCam, kP);
}

// A user gesture takes the wheel: pause the chase (cinema resumes explicitly).
controls.addEventListener('start', () => {
  if (followState) followState.paused = true;
});

// ── Fit-to-bounds framing (viewer-zoom-to-feature) ─────────────────────────
// Derive the camera standoff from a feature's extent + the camera FOV so any
// feature fills a consistent fraction of the viewport, instead of a fixed
// extent-independent offset. Reusable by gotoTwin (registry + typed paths) and
// any future text/name search or selection caller.
const FIT_MARGIN = 1.4;
const MIN_STANDOFF_M = 15;
const MAX_STANDOFF_M = 1200;
// Default view direction: back-and-up, matching the legacy node offset
// [0, -300, +200] (∝ [0, -0.832, +0.555]) so the camera "feel" is preserved.
const _FIT_VIEWDIR = (() => {
  const v = new THREE.Vector3(0, -300, 200).normalize();
  return [v.x, v.y, v.z];
})();

// Normalize an Object3D OR a precomputed {center, size} to {center, size}
// (arrays of length 3). Returns null when no finite extent is available.
function featureExtent(target) {
  if (target && target.isObject3D) {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty() || !Number.isFinite(box.min.x)) return null;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    return { center: [c.x, c.y, c.z], size: [s.x, s.y, s.z] };
  }
  if (target && Array.isArray(target.center) && Array.isArray(target.size)) {
    return { center: target.center.slice(0, 3), size: target.size.slice(0, 3) };
  }
  return null;
}

// Pure: compute a camera pose {pos, target, dist} that fits an extent.
// dist = (maxExtent / 2) / tan(fov / 2) * margin, clamped to [MIN, MAX].
function fitPoseForExtent(ext, opts = {}) {
  if (!ext || !Array.isArray(ext.center) || !Array.isArray(ext.size)) return null;
  const [cx, cy, cz] = ext.center;
  const maxExtent = Math.max(ext.size[0], ext.size[1], ext.size[2]);
  const halfFovV = camera.fov * Math.PI / 360; // (fov / 2) in radians
  const raw = (maxExtent / 2) / Math.tan(halfFovV) * FIT_MARGIN;
  const dist = Math.min(MAX_STANDOFF_M, Math.max(MIN_STANDOFF_M, raw));
  let dir = Array.isArray(opts.viewDir) ? opts.viewDir : _FIT_VIEWDIR;
  const dlen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const pos = [
    cx + (dir[0] / dlen) * dist,
    cy + (dir[1] / dlen) * dist,
    cz + (dir[2] / dlen) * dist,
  ];
  return { pos, target: [cx, cy, cz], dist };
}

// zoomToFeature(target, opts?) — frame a feature by fitting its extent, then
// animate there via the existing flyTo. target: Object3D OR {center, size}.
// opts: { viewDir?, duration?, onArrive? }. Returns the pose, or null.
function zoomToFeature(target, opts = {}) {
  const pose = fitPoseForExtent(featureExtent(target), opts);
  if (!pose) return null;
  flyTo({ pos: pose.pos, target: pose.target, duration: opts.duration, onArrive: opts.onArrive });
  return pose;
}

function updateFly(now) {
  if (!flyAnimation) return;
  const { startPos, startTarget, endPos, endTarget, startTime, duration } = flyAnimation;
  let t = (now - startTime) / duration;
  let arrived = false;
  if (t >= 1) {
    t = 1;
    arrived = true;
  }
  // Ease in-out
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  camera.position.lerpVectors(startPos, endPos, eased);
  controls.target.lerpVectors(startTarget, endTarget, eased);

  if (arrived) {
    flyAnimation = null;
    const cb = flyOnArrive;
    flyOnArrive = null;
    if (cb) cb();
  }
}

// Viewpoint buttons + number-key map — generated from DT_SITE.viewpoints so the
// UI is site-driven (no hardcoded SML presets). Insertion order → keys 1..N.
const vpKeys = {};
(function buildViewpointButtons() {
  const container = document.getElementById('viewpoints');
  if (!container) return;
  container.innerHTML = '';
  let i = 1;
  for (const [name, vp] of Object.entries(window.DT_SITE.viewpoints || {})) {
    const key = String(i++);
    vpKeys[key] = name;
    const btn = document.createElement('button');
    btn.className = 'vp-btn';
    btn.dataset.vp = name;
    btn.innerHTML = `<kbd>${key}</kbd>${vp.label || name}`;
    btn.addEventListener('click', () => flyTo(name));
    container.appendChild(btn);
  }
})();

// WASD + QE movement
// Speed scales with height above terrain: clamp(h * 0.01, 2.5, 100) m/frame.
// See three-viewer-controls R1.
const moveState = { w: false, a: false, s: false, d: false, q: false, e: false };
const WASD_SPEED_FACTOR = 0.01;
const WASD_SPEED_MIN = 2.5;
const WASD_SPEED_MAX = 100;
let lastWasdMoveSpeed = WASD_SPEED_MIN;

function computeWasdMoveSpeed() {
  const groundZ = terrainSampler ? terrainSampler(camera.position.x, camera.position.y) : 0;
  const heightAboveTerrain = camera.position.z - (Number.isFinite(groundZ) ? groundZ : 0);
  const raw = heightAboveTerrain * WASD_SPEED_FACTOR;
  return Math.max(WASD_SPEED_MIN, Math.min(WASD_SPEED_MAX, raw));
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k in moveState) { moveState[k] = true; e.preventDefault(); return; }
  if (vpKeys[e.key]) flyTo(vpKeys[e.key]);
  if (e.key === ' ' || e.key === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowLeft') stepFrame(-1);
  if (e.key === 'ArrowRight') stepFrame(1);
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in moveState) moveState[k] = false;
});

// ── Cinema mode (viewer-story-cinema §4) ────────────────────────────────────
// playFilm(): a directed A→B→C sitting for a zero-context viewer. One state
// object (`cinema`) owns the film; null means the working viewer. Cinema is a
// MODE with a clean exit (D5): everything it changes is captured in
// cinema.saved and restored by exitCinema — it adds state, never rewires the
// diagnostic path. Pacing schedules the EXISTING frame stepper via playSpeed;
// cameras ride the EXISTING flyTo / follow-cam primitives (D4).

const CINEMA_CHAPTERS = [
  { scenario: 'v5_a', pill: 'A', zh: '夢想', en: 'The Dream',
    sub: '租車在水社，西岸騎行，纜渡過湖，黃昏騎回 — the perfect Sunday, if everything works.' },
  { scenario: 'v5_b', pill: 'B', zh: '現實', en: 'Peak Sunday',
    sub: '甲租甲還：排隊、壅塞、錯過末班船 — and a long walk home in the dark.' },
  { scenario: 'v5_c', pill: 'C', zh: '解方', en: '甲租乙還',
    sub: '伊達邵還車，搭船回程 — same fleet, one policy change.' },
];

let cinema = null;   // null = working mode

function currentScenarioValue() {
  return document.getElementById('scenario-select').value;
}

async function playFilm(opts = {}) {
  if (cinema || !window.DT_SITE.scenarios) return;
  cinema = {
    fast: !!opts.fast,           // test hook: near-zero card/hold times
    chapter: -1,
    schedule: [],
    schedIdx: 0,
    holdUntil: 0,
    tempo: 1,                    // ↑/↓ live multiplier on authored play_speed_ms
    basePaceMs: 100,             // last fired beat's authored pace (tempo re-base)
    cardActive: false,
    cardResolve: null,
    cardTimer: 0,
    prefetched: new Set(),
    saved: {
      scenario: currentScenarioValue(),
      frame: currentFrame,
      playing, playSpeed, markersVisible, vehiclesVisible,
      storyMode, storyUserChoice,
      camPos: camera.position.clone(),
      camTarget: controls.target.clone(),
    },
  };
  playing = false;
  document.body.classList.add('cinema');
  renderCinemaPills();
  await showCinemaCard({
    kicker: 'SML 數位分身 · RED v5', zh: '一位騎士的完美星期天',
    en: "A cycling wannabe's perfect Sunday at 日月潭", sub: '三種星期天：夢想 · 現實 · 解方',
    kind: 'title',
  });
  await startChapter(0);
}

async function exitCinema() {
  if (!cinema) return;
  const s = cinema.saved;
  dismissCinemaCard();
  cinema = null;
  document.body.classList.remove('cinema');
  stopFollow();
  playing = false;
  document.getElementById('btn-play').textContent = '▶ Play';
  document.getElementById('btn-play').classList.remove('active');
  playSpeed = s.playSpeed;
  storyUserChoice = s.storyUserChoice;
  setVehiclesVisible(s.vehiclesVisible);
  setMarkersVisible(s.markersVisible);
  if (currentScenarioValue() !== s.scenario) {
    document.getElementById('scenario-select').value = s.scenario;
    await loadFrameData(s.scenario);    // recomputes storyMode from storyUserChoice
  }
  storyMode = s.storyMode;
  applyFrame(Math.min(s.frame, frameData ? frameData.frame_count - 1 : 0));
  flyAnimation = null;  // cancel an in-flight pose flyTo or it keeps lerping over the restore
  camera.position.copy(s.camPos);
  controls.target.copy(s.camTarget);
  if (s.playing) togglePlay();
}

async function startChapter(i) {
  // `loading` doubles as the re-entrancy guard (#63 review finding 2): the
  // natural end-of-frames advance, the N/P keys, and __dt.nextChapter can
  // all race this async body — first caller wins, the rest no-op.
  if (!cinema || cinema.loading) return;
  cinema.loading = true;
  try {
  if (i >= CINEMA_CHAPTERS.length) { await showClosingCard(); return; }
  const ch = CINEMA_CHAPTERS[i];
  cinema.chapter = i;
  renderCinemaPills();
  await showCinemaCard({
    kicker: i === 0 ? 'CHAPTER A' : `CHAPTER ${ch.pill}`,
    zh: `${ch.pill} · ${ch.zh}`, en: ch.en, sub: ch.sub, kind: 'chapter',
  });
  if (!cinema) return;   // Esc during the card
  if (currentScenarioValue() !== ch.scenario) {
    document.getElementById('scenario-select').value = ch.scenario;
    await loadFrameData(ch.scenario);
  }
  if (!cinema) return;
  // Warm the NEXT chapter's frames into the HTTP cache while this one plays.
  const next = CINEMA_CHAPTERS[i + 1];
  if (next && !cinema.prefetched.has(next.scenario)) {
    cinema.prefetched.add(next.scenario);
    fetch(window.DT_assetUrl(`frames_${next.scenario}_viewer.json`)).catch(() => {});
  }
  storyMode = narrationBeats.length > 0;
  setVehiclesVisible(true);
  setMarkersVisible(false);          // crowds read via cohort actors, not balloons
  cinema.schedule = filmSchedule(narrationBeats, storyConfig);
  cinema.schedIdx = 0;
  cinema.holdUntil = 0;
  renderCinemaTicks();
  // Default pace BEFORE applyFrame(0): a beat scheduled at (or before) the
  // first frame's time fires inside applyFrame, and its play_speed_ms must
  // not be clobbered afterwards (#63 review, minor).
  playSpeed = cinema.fast ? 4 : (storyConfig?.defaults?.play_speed_ms ?? 100);
  applyFrame(0);
  if (!playing) togglePlay();
  } finally {
    if (cinema) cinema.loading = false;
  }
}

// The beat engine: called from applyFrame whenever cinema is active. Fires
// every schedule entry whose sim time has arrived (pace + camera), keeps the
// follow target on the protagonist across track handoffs, updates the HUD.
function cinemaOnFrame(frameTime, now) {
  if (!cinema || cinema.chapter < 0) return;
  while (cinema.schedIdx < cinema.schedule.length
         && cinema.schedule[cinema.schedIdx].time <= frameTime) {
    // Advance BEFORE firing: a skip_to beat re-enters applyFrame → this very
    // function on the SHARED schedIdx. Post-increment double-fired the skip
    // beat in the nested call and then over-advanced past the next beat —
    // chapter A's return_dilemma follow cue was silently dropped (~100 sim-min
    // of parked camera). PR #63 review finding 1.
    const entry = cinema.schedule[cinema.schedIdx];
    cinema.schedIdx++;
    fireBeat(entry, now);
  }
  // Track stitch (ride cohort → ferry cohort): retarget a live follow.
  if (followState && storyConfig?.protagonist_tracks) {
    const pid = protagonistIdAt(frameTime);
    if (pid && pid !== followState.id) {
      followState.id = pid;
      followState.prev = null;   // cross-actor delta is not a velocity
    }
  }
  updateCinemaProgress();
}

function fireBeat(entry, now) {
  cinema.basePaceMs = entry.pace.play_speed_ms;   // ↑/↓ rescale from the authored pace
  playSpeed = cinema.fast ? 4 : Math.round(entry.pace.play_speed_ms / cinema.tempo);
  if (entry.pace.hold_ms) cinema.holdUntil = now + (cinema.fast ? 40 : entry.pace.hold_ms);
  if (entry.pace.skip_to) {
    const idx = frameIndexForSimTime(entry.pace.skip_to);
    if (idx > currentFrame) applyFrame(idx);   // forward-only fast-forward
  }
  if (entry.camera) applyBeatCamera(entry.camera);
}

function applyBeatCamera(cam) {
  if (cam.mode === 'follow') {
    const pid = protagonistIdAt(frameData?.frames[currentFrame]?.time || '00:00');
    if (pid) startFollow(pid, cam.follow || {});
  } else if (cam.mode === 'pose' && cam.pose) {
    stopFollow();
    const p = resolveStoryPose(cam.pose);
    if (p) flyTo({ pos: p.pos, target: p.target, duration: cinema.fast ? 60 : 2400 });
  }
}

// THE geo-anchored pose math — the story config's pose format IS the
// viewpoints format (D4); buildViewpoints delegates its geo branch here so
// there is exactly one implementation.
function resolveStoryPose(vp, geo = geoToLocal) {
  if (!Array.isArray(vp.posAnchor) || !Array.isArray(vp.targetAnchor)) return null;
  const [px, py] = geo(vp.posAnchor[0], vp.posAnchor[1]);
  const [tx, ty] = geo(vp.targetAnchor[0], vp.targetAnchor[1]);
  const off = vp.posOffset || [0, 0];
  return { pos: [px + off[0], py + off[1], vp.posZ], target: [tx, ty, vp.targetZ] };
}

function protagonistIdAt(time) {
  const viaTrack = activeTrackCohort(storyConfig?.protagonist_tracks, time);
  if (viaTrack && cohortActors.has(viaTrack)) return viaTrack;
  for (const [cid] of cohortActors) if (isProtagonist(cid, storyConfig)) return cid;
  return null;
}

function frameIndexForSimTime(t) {
  if (!frameData) return -1;
  const idx = frameData.frames.findIndex((f) => f.time >= t);
  return idx === -1 ? frameData.frame_count - 1 : idx;
}

// ↑ / ↓ live tempo (2026-07-06 report: arrows were the instinctive reach for
// "slow this down"). A ladder multiplier over every beat's AUTHORED pace —
// it applies to the running beat immediately and persists across beats
// (fireBeat divides by it). Fast mode (test drive) ignores tempo.
let tempoToastTimer = 0;
function setCinemaTempo(dir) {
  if (!cinema) return;
  cinema.tempo = cinemaTempoStep(cinema.tempo, dir);
  if (!cinema.fast) playSpeed = Math.round(cinema.basePaceMs / cinema.tempo);
  const toast = document.getElementById('cinema-tempo');
  if (toast) {
    toast.textContent = `速度 ×${cinema.tempo}`;
    toast.classList.add('show');
    clearTimeout(tempoToastTimer);
    tempoToastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  }
}

// ← / → beat navigation: → jumps to the next unfired beat; ← restarts the
// beat we're in (schedIdx-1). Setting schedIdx to the target BEFORE the jump
// lets cinemaOnFrame re-fire exactly that beat's pace + camera. Also accepts
// {index} for an absolute beat (presenter/test drive).
function jumpToBeat(dirOrIndex) {
  if (!cinema || !cinema.schedule.length) return;
  const abs = dirOrIndex && typeof dirOrIndex === 'object' ? dirOrIndex.index : null;
  const raw = abs != null ? abs
    : (dirOrIndex > 0 ? cinema.schedIdx : cinema.schedIdx - 1);
  const target = Math.max(0, Math.min(cinema.schedule.length - 1, raw));
  cinema.schedIdx = target;
  cinema.holdUntil = 0;
  applyFrame(frameIndexForSimTime(cinema.schedule[target].time));
  if (!playing) togglePlay();
}

// ── Cinema cards (title / chapter / closing) ──
// One overlay, promise-based: auto-dismiss after a hold (any key skips);
// the closing scoreboard holds until a key.
function showCinemaCard(copy) {
  return new Promise((resolve) => {
    if (!cinema) { resolve(); return; }
    const card = document.getElementById('cinema-card');
    document.getElementById('cinema-card-kicker').textContent = copy.kicker || '';
    document.getElementById('cinema-card-title').textContent = copy.zh || '';
    document.getElementById('cinema-card-sub').textContent = copy.en || '';
    document.getElementById('cinema-card-body').textContent = copy.sub || '';
    document.getElementById('cinema-card-table').textContent = '';
    document.getElementById('cinema-card-hint').textContent =
      copy.kind === 'closing' ? '任意鍵離開 · any key to exit' : '任意鍵繼續 · any key';
    card.classList.remove('hidden');
    cinema.cardActive = true;
    cinema.cardResolve = resolve;
    const auto = copy.kind === 'closing' ? 0
      : (cinema.fast ? 120 : (copy.kind === 'title' ? 5200 : 3600));
    if (auto) cinema.cardTimer = setTimeout(dismissCinemaCard, auto);
  });
}

function dismissCinemaCard() {
  if (!cinema || !cinema.cardActive) return;
  clearTimeout(cinema.cardTimer);
  cinema.cardActive = false;
  document.getElementById('cinema-card').classList.add('hidden');
  const r = cinema.cardResolve;
  cinema.cardResolve = null;
  if (r) r();
}

// Closing scoreboard: EVERY figure comes from the story config's closing_card
// (source-carrying entries, lineage-gated) — no free-typed numbers (D7). The
// card renders from the LAST chapter's loaded config (story_v5_c.json).
async function showClosingCard() {
  if (!cinema) return;
  playing = false;
  const figures = storyConfig?.closing_card || [];
  const p = showCinemaCard({
    kicker: 'CLOSING · 同一支船隊，三種星期天', zh: '結算', en: 'The scoreboard (A / B / C)',
    sub: figures.length ? '' : 'closing_card missing from story config — no figures to show',
    kind: 'closing',
  });
  const table = document.getElementById('cinema-card-table');
  for (const fig of figures) {
    const row = document.createElement('div');
    row.className = 'cinema-row';
    const label = document.createElement('span');
    label.className = 'cinema-row-label';
    label.textContent = fig.label;
    const value = document.createElement('span');
    value.className = 'cinema-row-value';
    value.textContent = fig.value;
    row.title = `source: ${fig.source}`;
    row.append(label, value);
    table.appendChild(row);
  }
  await p;            // resolves on Esc (closing card has no auto-dismiss)
  await exitCinema();
}

// ── Cinema HUD (pills, beat ticks, progress, presenter strip) ──
function renderCinemaPills() {
  const box = document.getElementById('cinema-pills');
  box.textContent = '';
  CINEMA_CHAPTERS.forEach((ch, i) => {
    const el = document.createElement('span');
    el.className = 'cinema-pill' + (cinema && i === cinema.chapter ? ' active' : '');
    el.textContent = ch.pill;
    box.appendChild(el);
  });
}

function renderCinemaTicks() {
  const bar = document.getElementById('cinema-progress');
  for (const el of [...bar.querySelectorAll('.cinema-tick')]) el.remove();
  if (!frameData) return;
  const last = Math.max(1, frameData.frame_count - 1);
  for (const entry of cinema.schedule) {
    const idx = frameIndexForSimTime(entry.time);
    const el = document.createElement('span');
    el.className = 'cinema-tick';
    el.style.left = `${(idx / last) * 100}%`;
    el.title = `${entry.time} ${entry.slug}`;
    bar.appendChild(el);
  }
}

function updateCinemaProgress() {
  if (!frameData) return;
  const last = Math.max(1, frameData.frame_count - 1);
  document.getElementById('cinema-progress-fill').style.width =
    `${(currentFrame / last) * 100}%`;
}

// Presenter strip: keys legend surfaces on mouse-move, fades after 3 s.
let presenterTimer = 0;
document.addEventListener('mousemove', () => {
  if (!cinema) return;
  const strip = document.getElementById('cinema-presenter');
  strip.classList.add('show');
  clearTimeout(presenterTimer);
  presenterTimer = setTimeout(() => strip.classList.remove('show'), 3000);
});

document.getElementById('btn-cinema').addEventListener('click', () => playFilm());
document.getElementById('cinema-exit').addEventListener('click', () => exitCinema());

// Cinema owns the keyboard while active (capture phase, before the working
// handlers): Space pause · →/PgDn next beat · ←/PgUp beat restart · N/P
// chapter · F free-look · Esc exit. Any key dismisses an up card.
document.addEventListener('keydown', (e) => {
  if (!cinema) return;
  e.stopPropagation();
  if (cinema.cardActive) {
    if (e.key === 'Escape') {
      // cardResolve is pending inside playFilm/startChapter/showClosingCard —
      // dismiss FIRST so the awaited promise resolves, then tear down.
      dismissCinemaCard();
      exitCinema();
    } else {
      dismissCinemaCard();
    }
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'Escape': exitCinema(); break;
    case ' ': togglePlay(); break;
    case 'ArrowRight': case 'PageDown': jumpToBeat(1); break;
    case 'ArrowLeft': case 'PageUp': jumpToBeat(-1); break;
    case 'ArrowUp': setCinemaTempo(1); break;
    case 'ArrowDown': setCinemaTempo(-1); break;
    case 'n': case 'N': startChapter(cinema.chapter + 1); break;
    case 'p': case 'P': startChapter(Math.max(0, cinema.chapter - 1)); break;
    case 'f': case 'F': if (followState) followState.paused = true; break;
    default: return;
  }
  e.preventDefault();
}, true);

// ── Ctrl-modal rotation (three-viewer-controls R2) ─────────────────────────
// Anchor-pinned rotation. At Ctrl+mousedown the cursor's terrain hit is
// captured as a world-fixed anchor; each mousemove orbits the camera around
// the anchor AND pans camera+target so the anchor re-projects to the current
// cursor position. Net: the clicked world point stays pinned under the cursor
// throughout the drag (Google-Earth style). Sky click falls through to
// OrbitControls' default rotation around the previous target.
let ctrlModalActive = false;
window.addEventListener('keydown', (e) => {
  if ((e.key === 'Control' || e.key === 'Meta') && !ctrlModalActive) {
    ctrlModalActive = true;
    // Ctrl merges BOTH buttons onto the anchored pivot (the custom gesture below
    // owns the drag; this just lets OrbitControls rotate-around-target as the
    // fallback on a sky miss, for either button).
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Control' || e.key === 'Meta') {
    ctrlModalActive = false;
    controls.mouseButtons.LEFT = -1;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;  // restore plain right-drag pan
  }
});

function screenCenterTerrainHit() {
  const hit = raycastAt(
    renderer.domElement.clientWidth / 2 + renderer.domElement.getBoundingClientRect().left,
    renderer.domElement.clientHeight / 2 + renderer.domElement.getBoundingClientRect().top
  );
  return hit;
}

let ctrlGesture = null;
const _gOffset = new THREE.Vector3();
const _gRight = new THREE.Vector3();
const _gUpCam = new THREE.Vector3();
const _gProjected = new THREE.Vector3();
const CTRL_ROTATE_SPEED = 1.0;
const PIN_ITERATIONS = 5;
const PIN_NDC_TOLERANCE = 1e-3;

function solveLookAtTargetForCursorPin(anchor, cursorNdcX, cursorNdcY) {
  const T = anchor.clone();
  const halfV = camera.fov * Math.PI / 360;
  const tanHalfV = Math.tan(halfV);
  for (let i = 0; i < PIN_ITERATIONS; i++) {
    camera.lookAt(T);
    camera.updateMatrixWorld(true);
    _gProjected.copy(anchor).project(camera);
    const dxNdc = cursorNdcX - _gProjected.x;
    const dyNdc = cursorNdcY - _gProjected.y;
    if (Math.abs(dxNdc) < PIN_NDC_TOLERANCE && Math.abs(dyNdc) < PIN_NDC_TOLERANCE) break;
    const depth = T.distanceTo(camera.position);
    _gRight.setFromMatrixColumn(camera.matrix, 0);
    _gUpCam.setFromMatrixColumn(camera.matrix, 1);
    const dWorldX = -dxNdc * depth * tanHalfV * camera.aspect;
    const dWorldY = -dyNdc * depth * tanHalfV;
    T.addScaledVector(_gRight, dWorldX);
    T.addScaledVector(_gUpCam, dWorldY);
  }
  return T;
}

function startCtrlRotationPivot(clientX, clientY) {
  camera.updateMatrixWorld(true);
  // Anchor on whatever solid surface is under the cursor — terrain, lake,
  // buildings or roads — not bare terrain only. A miss over the lake/a building
  // used to drop the gesture and fall back to OrbitControls' stale controls.target
  // (the "pivot is off / I have to reset it" symptom).
  const hit = raycastSurfaceAt(clientX, clientY);
  if (hit && hit.point) {
    if (followState) followState.paused = true;   // a user gesture takes the wheel
    const anchor = hit.point.clone();
    ctrlGesture = {
      anchor,
      radius: camera.position.distanceTo(anchor),
      lastX: clientX,
      lastY: clientY,
    };
    return hit;
  }
  return null;
}

function applyCtrlGestureMove(clientX, clientY) {
  if (!ctrlGesture) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const dx = clientX - ctrlGesture.lastX;
  const dy = clientY - ctrlGesture.lastY;
  ctrlGesture.lastX = clientX;
  ctrlGesture.lastY = clientY;
  if (dx === 0 && dy === 0) return;
  const anchor = ctrlGesture.anchor;
  // Distance-to-floor pivot rate (viewer-mobile-controls A): pivoting while
  // zoomed-in close is gentler — rate scales by clamp(h/r, 0.1, 1) where h is
  // height above terrain and r the orbit radius (nav-sensitivity.mjs law).
  const rotScale = rotateScaleForHeight(navHeightAboveFloor(), ctrlGesture.radius);
  const azDelta = (2 * Math.PI * dx / rect.height) * CTRL_ROTATE_SPEED * rotScale;
  const polDelta = (2 * Math.PI * dy / rect.height) * CTRL_ROTATE_SPEED * rotScale;
  _gOffset.copy(camera.position).sub(anchor);
  const r = ctrlGesture.radius;
  // Z-up orbit: azimuth about +Z, polar measured FROM +Z. The previous code used
  // THREE.Spherical (whose polar axis is +Y) on this Z-up offset and then clamped
  // it with the Z-up maxPolarAngle — the convention mismatch flung the camera
  // through the pole (below ground, camZ negative) on vertical drags and the
  // cursor-pin solver couldn't recover. Do the spherical math in the scene's own
  // Z-up frame and clamp polar so the camera stays above the anchor.
  let az = Math.atan2(_gOffset.y, _gOffset.x);
  let pol = Math.acos(Math.max(-1, Math.min(1, _gOffset.z / r)));
  az -= azDelta;
  pol -= polDelta;
  const minPol = controls.minPolarAngle ?? 0;
  const maxPol = controls.maxPolarAngle ?? Math.PI;
  pol = Math.max(minPol + 1e-3, Math.min(maxPol - 1e-3, pol));
  const sinPol = Math.sin(pol);
  _gOffset.set(r * sinPol * Math.cos(az), r * sinPol * Math.sin(az), r * Math.cos(pol));
  camera.position.copy(anchor).add(_gOffset);
  const cursorNdcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const cursorNdcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  const T = solveLookAtTargetForCursorPin(anchor, cursorNdcX, cursorNdcY);
  controls.target.copy(T);
  camera.lookAt(T);
  camera.updateMatrixWorld(true);
}

function endCtrlGesture() {
  if (!ctrlGesture) return;
  ctrlGesture = null;
  controls.enableRotate = true;
  controls.enablePan = true;
}

renderer.domElement.addEventListener('mousedown', (e) => {
  // Ctrl + left OR right both drive the anchored pivot (merged per user request).
  if (!(e.ctrlKey || e.metaKey) || (e.button !== 0 && e.button !== 2)) return;
  const hit = startCtrlRotationPivot(e.clientX, e.clientY);
  if (!hit) return;   // sky click → OrbitControls fallback
  controls.enableRotate = false;
  controls.enablePan = false;   // also block OrbitControls' right-button pan
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);

window.addEventListener('mousemove', (e) => {
  if (ctrlGesture) applyCtrlGestureMove(e.clientX, e.clientY);
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0 || e.button === 2) endCtrlGesture();
});

// ── Drag-the-world pan (three-viewer-controls R6) ──────────────────────────
// On no-modifier left-mouse-down, raycast cursor → terrain. The hit point is
// "anchored" — through the drag, the camera and target translate so the anchor
// projects to the current cursor position. Fixed-frame math: each mousemove
// computes the translation from the initial camera state, not incrementally,
// avoiding accumulated drift.
let panAnchor = null;

// Analytic ray-vs-terrain via the heightfield sampler. The terrain mesh has
// ~5 M triangles and no BVH, so a brute-force intersectObject is ~670 ms/ray
// (measured) — it was the freeze felt at every drag-grab / ctrl-pivot and the
// click lag. The terrain is a regular grid, so we sphere-trace the ray against
// terrainSampler(x, y): step forward, shrink the step as the ray nears the
// ground, then bisect the crossing. Sub-millisecond. The caller-owned output
// form is also used by the touch controller so its two-finger move path keeps
// all ray/vector scratch preallocated.
const touchTerrainRaycaster = new THREE.Raycaster();
const touchTerrainNdc = new THREE.Vector2();
function raycastTerrainFastInto(clientX, clientY, out, rectLeft, rectTop, rectWidth, rectHeight) {
  if (!terrainSampler) return false;
  if (!(Number.isFinite(rectLeft) && Number.isFinite(rectTop)
    && Number.isFinite(rectWidth) && rectWidth > 0
    && Number.isFinite(rectHeight) && rectHeight > 0)) {
    return false;
  }
  camera.updateMatrixWorld(true);
  touchTerrainNdc.set(
    ((clientX - rectLeft) / rectWidth) * 2 - 1,
    -((clientY - rectTop) / rectHeight) * 2 + 1,
  );
  touchTerrainRaycaster.setFromCamera(touchTerrainNdc, camera);
  const o = touchTerrainRaycaster.ray.origin, d = touchTerrainRaycaster.ray.direction;
  let t = 0, prevT = 0;
  let prevGap = o.z - terrainSampler(o.x, o.y);
  if (!Number.isFinite(prevGap) || prevGap <= 0) return null;  // camera at/below ground
  for (let i = 0; i < 6000 && t < TERRAIN_RAY_MAX_DISTANCE; i++) {
    const step = Math.max(2, Math.min(0.5 * prevGap, 150));
    const nt = t + step;
    const gap = (o.z + d.z * nt) - terrainSampler(o.x + d.x * nt, o.y + d.y * nt);
    if (gap <= 0) {
      let lo = prevT, hi = nt;
      for (let b = 0; b < 22; b++) {
        const mt = (lo + hi) * 0.5;
        const g = (o.z + d.z * mt) - terrainSampler(o.x + d.x * mt, o.y + d.y * mt);
        if (g > 0) lo = mt; else hi = mt;
      }
      const ht = (lo + hi) * 0.5;
      out.set(o.x + d.x * ht, o.y + d.y * ht, o.z + d.z * ht);
      return true;
    }
    prevGap = gap; prevT = nt; t = nt;
  }
  return false;
}

// Desktop and inspector callers retain the original Raycaster-shaped result.
// The coarse-pointer seam below calls raycastTerrainFastInto directly.
function raycastTerrainFast(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const point = new THREE.Vector3();
  if (!raycastTerrainFastInto(clientX, clientY, point,
    rect.left, rect.top, rect.width, rect.height)) return null;
  return { point, object: loadedTerrainMesh, distance: camera.position.distanceTo(point) };
}

// Nearest solid surface under the cursor for the drag/pivot anchor: the cheap
// surface meshes (lake, buildings, roads, docks) vs the analytic terrain — NOT
// floating node balloons / cohort dots, which would offset the pivot.
function raycastSurfaceAt(clientX, clientY) {
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(pointerToNdc(clientX, clientY), camera);
  const roots = [layerRoots.lake, layerRoots.buildings, layerRoots.edges, layerRoots.docks]
    .filter((r) => r && r.visible);
  const meshHit = roots.length
    ? (raycaster.intersectObjects(roots, true).filter((h) => h.object?.isMesh && isVisibleInTree(h.object))[0] || null)
    : null;
  const terrHit = raycastTerrainFast(clientX, clientY);
  if (meshHit && terrHit) return meshHit.distance <= terrHit.distance ? meshHit : terrHit;
  return meshHit || terrHit;
}

function startDragTheWorld(clientX, clientY) {
  const hit = raycastSurfaceAt(clientX, clientY);
  if (!hit || !hit.point) return null;
  if (followState) followState.paused = true;   // a user gesture takes the wheel
  panAnchor = {
    anchorPoint: hit.point.clone(),
    startClientX: clientX,
    startClientY: clientY,
    cameraStart: camera.position.clone(),
    targetStart: controls.target.clone(),
  };
  return panAnchor;
}

function applyDragTheWorld(clientX, clientY) {
  if (!panAnchor) return;
  // Reset camera + target to mousedown state for clean reference frame
  camera.position.copy(panAnchor.cameraStart);
  controls.target.copy(panAnchor.targetStart);
  camera.updateMatrixWorld(true);

  // NDC of the anchor under the initial camera (gives us the depth to use)
  const anchorNdc = panAnchor.anchorPoint.clone().project(camera);

  // Cursor NDC at anchor's depth — where the current cursor "would point" in world
  const rect = renderer.domElement.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  const cursorWorld = new THREE.Vector3(ndcX, ndcY, anchorNdc.z).unproject(camera);

  // delta = where the anchor IS - where the cursor POINTS (both in the initial frame)
  // Translating camera+target by delta moves the world so the anchor lands under the cursor.
  const delta = panAnchor.anchorPoint.clone().sub(cursorWorld);
  camera.position.copy(panAnchor.cameraStart).add(delta);
  controls.target.copy(panAnchor.targetStart).add(delta);
  // Update matrixWorld so subsequent projections / next-frame raycasts see the new transform.
  camera.updateMatrixWorld(true);
}

function endDragTheWorld() {
  panAnchor = null;
}

// Wire up to real DOM events. Capture phase so we intercept before OrbitControls.
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.ctrlKey || e.metaKey) return;  // Ctrl path owns this drag
  startDragTheWorld(e.clientX, e.clientY);
}, true);

window.addEventListener('mousemove', (e) => {
  if (!panAnchor) return;
  applyDragTheWorld(e.clientX, e.clientY);
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) endDragTheWorld();
});

// ── Distance-to-floor nav sensitivity (viewer-mobile-controls A) ───────────
// OrbitControls' dolly step scales with the camera→target radius r; the target
// parks at floor level / the last anchor, so zoomed-in-close steps are far too
// big. A capture-phase listener refreshes controls.zoomSpeed per event, BEFORE
// OrbitControls' own handler runs, so the effective radius step
// r·(1−0.95^zoomSpeed) tracks h·(1−0.95) — height above terrain, not radius.
// The same exponent drives OrbitControls' pinch (Math.pow(d/prevD, zoomSpeed)),
// so refreshing it during two-pointer moves fixes pinch too. rotateSpeed gets
// the matching clamp(h/r) law for the built-in touch rotate. Laws + the
// NaN-sampler fallback chain live in viewer-common/nav-sensitivity.mjs
// (node-tested); the last-resort floor is the site's cameraTargetZ — no site
// literals here.
function navHeightAboveFloor() {
  const groundZ = terrainSampler ? terrainSampler(camera.position.x, camera.position.y) : NaN;
  return heightAboveFloor({
    cameraZ: camera.position.z,
    terrainZ: groundZ,
    targetDistance: camera.position.distanceTo(controls.target),
    fallbackFloorZ: window.DT_SITE.cameraTargetZ,
  });
}

function applyNavSensitivity() {
  const r = camera.position.distanceTo(controls.target);
  const h = navHeightAboveFloor();
  controls.zoomSpeed = zoomSpeedForHeight(h, r);
  controls.rotateSpeed = rotateScaleForHeight(h, r);
}

renderer.domElement.addEventListener('wheel', applyNavSensitivity, { capture: true, passive: true });

// On-screen zoom step (mobile nav buttons) through the same law as the wheel:
// one press ≈ 6 wheel ticks' worth of height-scaled dolly toward the target,
// clamped to controls' distance range. dir +1 = in, −1 = out.
function navZoomStep(dir) {
  if (flyAnimationActive()) return;
  const h = navHeightAboveFloor();
  const offset = camera.position.clone().sub(controls.target);
  const r = offset.length() || 1;
  const newR = Math.max(controls.minDistance,
    Math.min(controls.maxDistance, r - dir * h * 0.26));
  offset.multiplyScalar(newR / r);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

// On-screen orbit step (mobile nav buttons): rotate = azimuth about the target,
// tilt = polar. The Z-up spherical math + pole clamp lives in nav-sensitivity.mjs
// (node-tested `orbitPosition`); this just feeds the live camera/target and the
// controls' own polar bounds, then commits. dAz/dPol in radians.
const NAV_ROTATE_STEP = Math.PI / 12;   // 15° azimuth per press
const NAV_TILT_STEP = Math.PI / 18;     // 10° polar per press
function navOrbitStep(dAz, dPol) {
  if (flyAnimationActive()) return;
  const t = controls.target;
  const [x, y, z] = orbitPosition(
    [camera.position.x, camera.position.y, camera.position.z],
    [t.x, t.y, t.z], dAz, dPol,
    { minPol: controls.minPolarAngle ?? 0, maxPol: controls.maxPolarAngle ?? Math.PI },
  );
  camera.position.set(x, y, z);
  controls.update();
}

// ── Coarse-pointer touch gestures (viewer-mobile-apple-maps round 1) ──────
// The controller is capture-phase and owns every accepted touch. It deliberately
// leaves desktop mouse/keyboard listeners above and below this seam untouched.
const COARSE_POINTER_MQ = window.matchMedia('(pointer: coarse)');

function raycastTerrainAnchorAt(clientX, clientY, out, rectLeft, rectTop, rectWidth, rectHeight) {
  return raycastTerrainFastInto(clientX, clientY, out, rectLeft, rectTop, rectWidth, rectHeight);
}

function raycastTargetPlaneAnchorAt(clientX, clientY, targetZ, out, rectLeft, rectTop, rectWidth, rectHeight) {
  if (!(Number.isFinite(rectLeft) && Number.isFinite(rectTop)
    && Number.isFinite(rectWidth) && rectWidth > 0
    && Number.isFinite(rectHeight) && rectHeight > 0)) return false;
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(pointerToNdcAtRect(clientX, clientY, rectLeft, rectTop, rectWidth, rectHeight), camera);
  const { origin, direction } = raycaster.ray;
  if (!Number.isFinite(direction.z) || Math.abs(direction.z) < 1e-9) return false;
  const distance = (targetZ - origin.z) / direction.z;
  if (!Number.isFinite(distance) || distance <= 0) return false;
  out.copy(origin).addScaledVector(direction, distance);
  return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
}

mobileGestures = installMobileGestureController({
  element: renderer.domElement,
  coarsePointerQuery: COARSE_POINTER_MQ,
  camera,
  controls,
  three: THREE,
  raycastTerrainAt: raycastTerrainAnchorAt,
  raycastTargetPlaneAt: raycastTargetPlaneAnchorAt,
  navHeightAboveFloor,
  pauseFollow: () => { if (followState) followState.paused = true; },
  flyAnimationActive,
  pickAt: handleCanvasPick,
  suppressCompatibilityClick: (durationMs) => { _suppressClickUntil = performance.now() + durationMs; },
  prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
});

function applyWASD() {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.z = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();

  const delta = new THREE.Vector3();
  if (moveState.w) delta.add(forward);
  if (moveState.s) delta.sub(forward);
  if (moveState.d) delta.add(right);
  if (moveState.a) delta.sub(right);
  if (moveState.e) delta.z += 1;
  if (moveState.q) delta.z -= 1;

  lastWasdMoveSpeed = computeWasdMoveSpeed();
  if (delta.lengthSq() > 0) {
    delta.normalize().multiplyScalar(lastWasdMoveSpeed);
    camera.position.add(delta);
    controls.target.add(delta);
  }
}

// ── Click-to-identify ──────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('info');

function pointerToNdcAtRect(clientX, clientY, rectLeft, rectTop, rectWidth, rectHeight) {
  mouse.x = ((clientX - rectLeft) / rectWidth) * 2 - 1;
  mouse.y = -((clientY - rectTop) / rectHeight) * 2 + 1;
  return mouse;
}

function pointerToNdc(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  return pointerToNdcAtRect(clientX, clientY, rect.left, rect.top, rect.width, rect.height);
}

// three's Raycaster does NOT skip objects whose ANCESTOR group is invisible — it
// only honours the leaf's own `.visible`. A layer hidden via its root wrapper
// (layerRoots[*].visible=false) would therefore still be picked. Walk the parent
// chain so a hidden layer is excluded from picking, matching what's rendered.
function isVisibleInTree(obj) {
  for (let o = obj; o; o = o.parent) {
    // splatDisplayDelegate: prop root hidden because its splat has DISPLAY
    // duty — the mesh keeps pick duty (video-recon-hero-prop delta), so this
    // one invisibility is pick-transparent. Any other invisible ancestor
    // (props toggle, layer roots) still excludes the hit.
    if (o.visible === false && !o.userData?.splatDisplayDelegate) return false;
  }
  return true;
}

// The roots the user can click to identify: every scene child EXCEPT the
// ~5 M-tri terrain mesh (picked analytically — see raycastTerrainFast) and the
// sky sphere (never a target). Limiting the set cuts the click raycast from
// ~670 ms to ~4 ms (measured on the live SML scene) without dropping any
// feature pickable — node balloons / cohort dots are loose scene children and
// stay in. isVisibleInTree below still honours per-layer visibility.
function pickableFeatureRoots() {
  // Exclude terrain (analytic pick) + sky, and the landcover dressing (an anonymous
  // draped mesh — would corrupt the terrain-Δ tooltip and occlude real features).
  return scene.children.filter((c) => c !== layerRoots.terrain && c !== skyMesh
    && c !== layerRoots.trees && c !== environmentGroup);
}

function raycastHitsAt(clientX, clientY) {
  raycaster.setFromCamera(pointerToNdc(clientX, clientY), camera);
  const hits = raycaster.intersectObjects(pickableFeatureRoots(), true)
    .filter(hit => hit.object?.isMesh && isVisibleInTree(hit.object)
      && hit.object.userData?.dt_pickable !== false);
  if (!edgeBatch) return hits;
  // sml-edge-mesh-merge: a BatchedMesh hit carries .batchId; resolve it to the
  // per-edge identity and present a lightweight proxy so the inspector routing
  // (reads object.userData / .name) works exactly as for per-edge sub-meshes.
  return hits.map((hit) => {
    if (!edgeBatch.isBatched(hit.object)) return hit;
    const r = edgeBatch.resolveHit(hit);
    if (!r || !r.userData) return hit;
    return { ...hit, object: { isMesh: true, name: r.edgeId, userData: r.userData, _edgeBatched: true } };
  });
}

function raycastAt(clientX, clientY) {
  // Features first; fall back to the analytic terrain (empty-ground recenter).
  return raycastHitsAt(clientX, clientY)[0] || raycastTerrainFast(clientX, clientY);
}

// sml-viewer-diagnostic-convergence: the sim-node spheres are depthTest-off
// (drawn ON TOP of terrain/lake so faults below the surface stay visible). A
// plain intersectObjects still returns the geometrically-nearest hit (terrain),
// so clicking a marker you can SEE would select terrain. Mirror base.js's
// nodes-first pick: when the layer is visible, prefer the nearest sim-node
// sphere under the cursor. Gated on visibility, so when the layer is OFF the
// normal edge/mesh pick applies unchanged.
function pickSimNodeAt(clientX, clientY) {
  const g = DIAG.simNodesGroup;
  if (!g || !g.visible) return null;
  raycaster.setFromCamera(pointerToNdc(clientX, clientY), camera);
  const hits = raycaster.intersectObjects(g.children, true)
    .filter((h) => h.object?.isMesh && h.object.visible !== false);
  return hits[0] || null;
}

// Causal diagnosis sprites are real pick targets. Most render with depthTest=true
// and reject hits occluded by terrain/features. Tall-support review markers are
// intentionally depth-independent, so the shared axis-aware selector keeps them
// pickable through those surfaces. Its ancestor walk still makes Faults: OFF
// non-pickable even though Three raycasts invisible descendants.
function pickCausalDiagnosisAt(clientX, clientY) {
  const group = DIAG.reliefGroup;
  if (!group || !group.visible) return null;
  raycaster.setFromCamera(pointerToNdc(clientX, clientY), camera);
  const markerHits = raycaster.intersectObjects(group.children, true)
    .filter((hit) => hit.object?.isSprite
      && hit.object?.userData?.kind === 'causal-diagnosis');
  if (!markerHits.length) return null;
  const terrainHit = raycastTerrainFast(clientX, clientY);
  const featureHit = raycastHitsAt(clientX, clientY)[0] || null;
  return chooseAxisAwareCausalHit(markerHits, terrainHit, featureHit);
}

function cameraState() {
  return {
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    target: {
      x: controls.target.x,
      y: controls.target.y,
      z: controls.target.z,
    },
    zoomToCursor: controls.zoomToCursor === true,
  };
}

function recenterOrbitAt({ clientX, clientY }) {
  const hit = raycastAt(clientX, clientY);
  if (!hit) return { ok: false, reason: 'no-hit' };
  controls.target.copy(hit.point);
  controls.update();
  return {
    ok: true,
    objectName: hit.object.name || '',
    point: {
      x: controls.target.x,
      y: controls.target.y,
      z: controls.target.z,
    },
  };
}

// Resolve a raycast hit to a typed-set element via the parent-walk cascade.
// Returns { name, element, hit } when typed; { name, element: null, hit } when
// the hit object has no typed identity; null when no hit at all.
function resolveTypedFromHit(hit) {
  if (!hit) return null;
  if (hit.object?.userData?.authority_scope === CONTEXT_AUTHORITY_SCOPE) {
    // Context is renderable but never a typed-runtime or Farm-twin input.
    return { name: '', element: null, hit };
  }
  let obj = hit.object;
  while (obj && (!obj.name || /^(Scene|geometry_0|)$/.test(obj.name))) {
    obj = obj.parent;
  }
  let name = obj?.name || '';
  // sml-base-network-mesh names meshes as `<edge_id>__<role>` — strip the
  // role suffix when resolving against typed_runtime / twin_id keyed lookups.
  if (name && name.includes('__')) {
    name = name.split('__', 1)[0];
  }
  // Also honor dt_edge_id stamped by loadGLB when the mesh has no parent name.
  if (!name && hit.object?.userData?.dt_edge_id) {
    name = hit.object.userData.dt_edge_id;
  }
  const element = name ? typedRuntime.getElement(name) : null;
  return { name, element, hit };
}

// sml-base-network-mesh / sml-base-network-cross-section: dt_type values
// emitted by the unified network-mesh generator. Each is delegated to the
// parent edge via dt_edge_id. The generator stamps suffixed names like
// `curb_left` and `railing_left` AT GENERATOR TIME, but the LOAD-TIME
// fallback at main.js:401 maps role → dt_type verbatim — so we accept
// BOTH spellings to keep the fallback honest. (See morning review #6.)
const NETWORK_DT = new Set([
  // generator-canonical (one-word):
  'road_ribbon', 'walkway_ribbon', 'cycleway_ribbon',
  'elevated_road_bridge_ribbon',
  'surface', 'curb', 'shoulder', 'cut_slope', 'wall_outer', 'skirt',
  'railing', 'stair_handrail',
  'junction', 'junction_skirt', 'plaza', 'plaza_ramp',
  'elevated_deck', 'elevated_pillars', 'stair_steps',
  // load-time fallback names (suffixed by role from the mesh name split):
  'curb_left', 'curb_right',
  'shoulder_left', 'shoulder_right',
  'cut_slope_left', 'cut_slope_right',
  'skirt_left', 'skirt_right',
  'wall_left_0', 'wall_left_1', 'wall_right_0', 'wall_right_1',
  'wall_outer_left', 'wall_outer_right',
  'railing_left', 'railing_right',
  'stair_handrail_left', 'stair_handrail_right',
  'pillars', 'deck',
]);

// Synthesize a typed-element-shaped object from a hit's userData when the
// real typed_set entry is missing (T2 twin_ids are not in typed_set.json,
// which is keyed by expanded_graph stable_ids like E025).
// sml-base-network-cross-section morning review #1.
function _synthesizeElementFromUserData(ud) {
  if (!ud || !ud.dt_edge_id) return null;
  // Enrich from the full edges.json record (name + data lineage) when available — the mesh
  // userData only carries dt_edge_id, but DIAG.edgeById has the OSM name, z_source/z_lineage,
  // surface and osm_way. So clicking ANY edge shows what it is and where its Z came from, and
  // for unnamed edges the lineage (osm_way / z_source) is the identity.
  const rec = (DIAG.edgeById && DIAG.edgeById.get(String(ud.dt_edge_id))) || null;
  const zl0 = rec && Array.isArray(rec.z_lineage) ? rec.z_lineage[0] : null;
  return {
    id: ud.dt_edge_id,
    stable_id: ud.dt_edge_id,
    twin_type: ud.dt_render_class || ud.dt_deck_class || (rec && (rec.mode_alishan || rec.mode)) || 'edge',
    semantic_type: ud.dt_render_class
      ? `${ud.dt_render_class[0].toUpperCase()}${ud.dt_render_class.slice(1)}Edge`
      : 'Edge',
    name: (rec && rec.name) || nameForTwin(ud.dt_edge_id) || null,
    mode: ud.dt_render_class || (rec && (rec.mode_alishan || rec.mode)) || null,
    lineage: { authority: (rec && rec.provenance) || 'T2_facility' },
    terrain_reference_patch_id: null,
    // Surface: a profile name (SML CS) or the OSM surface tag (alishan).
    surface: ud.dt_profile_name
      ? { type: ud.dt_profile_name, width_m: null }
      : (rec && rec.surface ? { type: rec.surface, width_m: null } : null),
    // Data lineage (rendered by the inspector when present).
    z_source: rec && rec.z_source,
    z_tool: zl0 && zl0.tool,
    z_context: zl0 && zl0.context_tag,
    osm_way_id: rec && rec.lineage && rec.lineage.osm_way_id,
    is_bridge: rec && rec.bridge,
    is_tunnel: rec && rec.tunnel,
    // Elevated context.
    _deck_class: ud.dt_deck_class,
    _z_min: ud.dt_z_min,
    _z_max: ud.dt_z_max,
    _from_node: ud.dt_from_node,
    _to_node: ud.dt_to_node,
    _way_id: ud.dt_way_id,
  };
}

// Post-raycast routing — extracted so tests can verify the dt_type string
// equality check without needing pixel-perfect click coordinates. Returns
// 'elevated' | 'typed' | 'synthesized' | 'none' to identify which branch fired.
function routeHitToInspector(hit) {
  const ud = hit?.object?.userData;
  if (ud?.authority_scope === CONTEXT_AUTHORITY_SCOPE) {
    const entry = contextRegistry.get(ud.context_id);
    if (entry?.inspection) toggleInspector(entry.inspection, null);
    else hideInspector();
    return 'context-only';
  }
  if (ud?.kind === 'prop' && typeof ud.origin_kind === 'string'
      && ud.origin_kind !== CONTEXT_PROP_ORIGIN_KIND) {
    const entry = authoredPropRegistry.get(ud.propId);
    if (entry?.record) toggleInspector(entry.record, null);
    else hideInspector();
    return 'authored-prop';
  }
  // sml-viewer-diagnostic-convergence: T2 sim nodes (not in edges.glb) and
  // flagged edges take precedence — a producer clicking a red sphere or a
  // recolored fault edge wants the diagnostic verdict, not the generic edge card.
  if (ud?.kind === 'causal-diagnosis') {
    toggleCausalDiagnosisInspector(ud.diagnosis);
    return 'causal-diagnosis';
  }
  if (ud?.kind === 't2-sim-node') {
    if (ud.name == null) ud.name = nameForTwin(ud.twin_id);  // viewer-click-names
    toggleSimNodeInspector(ud);
    return 'sim-node';
  }
  // Node-shaped diagnostic beacons (sml-diagnostic-click-cards): the cliff and
  // below-lake NODE beacons clone their sphere's userData but OVERRIDE kind to
  // '*-beacon', so the branch above missed them and they answered a click with
  // NOTHING. Route them to the same sim-node card their sphere gets. (Below-lake
  // EDGE beacons carry dt_edge_id, not twin_id — the guard keeps them for the
  // diagnostic-edge path below.)
  if (ud?.twin_id && (ud.kind === 'cliff-beacon' || ud.kind === 'below-lake-beacon')) {
    if (ud.name == null) ud.name = nameForTwin(ud.twin_id);
    toggleSimNodeInspector(ud);
    return 'sim-node';
  }
  // viewer-story-cinema actors: the balls the audience watches move must
  // answer a click with WHO they are (the earlier fall-through to the T2
  // node meshes behind them read as "waypoint" — confusing).
  if (ud?.cohortId) {
    toggleCohortInspector(ud);
    return 'cohort';
  }
  if (ud?.vehicleId) {
    toggleVehicleInspector(ud);
    return 'vehicle';
  }
  if (isSupportStructureUserData(ud)) {
    toggleSupportStructureInspector(ud);
    return 'support-structure';
  }
  // Named facility markers (node_metadata balloons): userData = {twinId, name, …}.
  // They carry their name directly; route them to the node inspector.
  if (ud?.twinId) {
    toggleNodeMarkerInspector(ud);
    return 'node-marker';
  }
  // Edge-fault verdicts (sml-diagnostic-click-cards widened the gate): below-lake
  // and terrain-fault carriers used to fall through to the GENERIC edge card with
  // their verdict fields invisible — same class of lie as the N16 node card.
  if (ud && (ud.is_submerged || ud.is_steep_slope || ud.is_overlap
             || ud.is_below_lake || ud.is_terrain_fault)) {
    if (ud.name == null) ud.name = nameForTwin(ud.dt_edge_id);  // viewer-click-names
    toggleDiagnosticEdgeInspector(ud);
    return 'diagnostic-edge';
  }
  // Stairs-flat (evidence axis): the WAY beacon carries dt_way_id but NO
  // dt_edge_id, so it fell through EVERY branch to hideInspector; member edges
  // fell into the generic edge card. A stronger fault on a member edge still
  // wins above — matches the recolor precedence.
  if (ud?.is_stairs_flat) {
    toggleStairsFlatInspector(ud);
    return 'stairs-flat';
  }
  // engine-agnostic-tier2: T2 schematic corridors (diagnosis-layer Line2) carry
  // kind:'edge' + dt_type:'schematic_edge' with the OSM name + lineage. They are
  // synth E-JCT ids (not in typed_set), so route them to the schematic-edge
  // inspector — without this branch a corridor click falls through to hideInspector.
  if (ud?.kind === 'edge' && ud.dt_type === 'schematic_edge') {
    toggleSchematicEdgeInspector(ud);
    return 'schematic-edge';
  }
  // Elevated-structure meshes (sml-bridge-deck-z §6): legacy path via
  // dt_route_id. Kept for backward compat; the unified-network meshes do
  // NOT stamp dt_route_id (the new pipeline is per-edge, not per-route).
  if (ud?.dt_route_id &&
      (ud.dt_type === 'elevated_deck' || ud.dt_type === 'elevated_pillars')) {
    toggleElevatedInspector(ud);
    return 'elevated';
  }
  // sml-walkway-3d-overlay: hero-walkway planks (deck / stair / stilts / railing)
  // carry dt_route_id from the GLB mesh extras but are NOT dt_type elevated_* nor
  // dt_edge_id network meshes — without this branch they fall through to
  // hideInspector() ("i can't click on the planks"). The unified-network meshes
  // do NOT stamp dt_route_id, so a remaining dt_route_id here is an overlay part.
  if (ud?.dt_route_id) {
    toggleWalkway3dInspector(ud);
    return 'walkway-3d';
  }
  // Baked node balls (nodes.glb) carry dt_edge_id = their OWN twin id via the
  // generic registration stamp (see loadGLB), so they used to fall into the
  // network-EDGE branch below and render "twin_type: edge / T2_facility" (the
  // N16 eye-test report; J_* balls always did). Node ids resolve in the node
  // registries (disjoint namespace from E-* edge ids) — route them to a node
  // card carrying role + z + z-lineage. Single-click card only: the dblclick
  // fly-to path resolves via typedRuntime, which never yields node balls
  // (goto-search flies to node ids via the mesh AABB instead).
  if (ud && ud.dt_edge_id && !ud.dt_route_id) {
    const nodeCard = buildNodeElement(
      String(ud.dt_edge_id), DIAG.intersectionsById, frameData?.node_metadata);
    if (nodeCard) {
      nodeCard.name = nodeCard.name || nameForTwin(nodeCard.id);
      toggleInspector(nodeCard, null);
      return 'node';
    }
  }
  // Network-mesh meshes delegate to the parent edge via dt_edge_id. Try
  // typed_set lookup first (works for any edge_id that happens to overlap
  // typed_set's stable_ids), then synthesize from userData.
  // Site-agnostic edge recognition: an edge hit is identified by its dt_edge_id. SML's network
  // sub-meshes also carry a dt_type role (road_ribbon, curb, …); alishan's merged edges carry
  // dt_edge_id but NO dt_type. Accept both — the old `NETWORK_DT.has(dt_type)` gate left every
  // alishan edge unclickable. A present-but-unknown dt_type is still rejected (SML unchanged).
  if (ud && ud.dt_edge_id && (NETWORK_DT.has(ud.dt_type) || ud.dt_type == null)) {
    const real = typedRuntime.getElement(ud.dt_edge_id);
    if (real) {
      real.name = nameForTwin(real.id);  // viewer-click-names
      const report = typedRuntime.getGeometryReport(ud.dt_edge_id);
      toggleInspector(real, report);
      return 'typed';
    }
    // Morning review #1: typed_set is keyed by expanded_graph stable_ids
    // (E025 / E028a / …), the new edges.glb uses T2 twin_ids (E-0057d790).
    // Synthesize a minimal element from the userData the generator stamps
    // so the inspector shows SOMETHING useful instead of dying silently.
    const synth = _synthesizeElementFromUserData(ud);
    if (synth) {
      // Keep the edges.json name (enriched in _synthesize); fall back to the name index only
      // when the record had none (viewer-click-names). Previously this clobbered it with null.
      synth.name = synth.name || nameForTwin(synth.id);
      toggleInspector(synth, null);
      return 'synthesized';
    }
  }
  // sml-poi-descriptive-cards: a buildings-surface hit resolves by proximity —
  // buildings.glb is one merged mesh with no per-twin identity, so the nearest
  // descriptive-registry POI within POI_DESC_MAX_DIST_M of the hit point wins.
  // Descriptive card (visitor content) on the building; the technical node
  // card stays on balls/balloons. A miss falls through unchanged.
  if (ud?.dt_layer === 'buildings' && hit?.point && _poiDescIndex.length) {
    const poi = resolvePoiAtXY(hit.point.x, hit.point.y, _poiDescIndex, POI_DESC_MAX_DIST_M);
    if (poi) {
      togglePoiDescriptionInspector(buildPoiDescriptionElement(poi.id, poi.entry));
      return 'poi-description';
    }
  }
  const resolved = resolveTypedFromHit(hit);
  if (resolved?.element) {
    resolved.element.name = nameForTwin(resolved.element.id);  // viewer-click-names
    const report = typedRuntime.getGeometryReport(resolved.element.id);
    toggleInspector(resolved.element, report);
    return 'typed';
  }
  hideInspector();
  return 'none';
}

// Single-click handler (three-viewer-controls R3).
// Inspector toggle only — does not move camera or change controls.target.
// The existing #info tooltip continues to show terrain-Δ for the click.
// Extracted to a named function so touch taps (viewer-mobile-controls B) can
// route through the identical pick path; _suppressClickUntil swallows the
// compatibility click the browser fires after a handled tap.
let _suppressClickUntil = 0;

function handleCanvasPick(clientX, clientY) {
  // Visible causal squares have first claim on their own pixel, followed by the
  // existing sim-node diagnostic priority and then ordinary feature/terrain pick.
  const hit = pickCausalDiagnosisAt(clientX, clientY)
    || pickSimNodeAt(clientX, clientY)
    || raycastHitsAt(clientX, clientY)[0]
    || raycastTerrainFast(clientX, clientY);   // empty-ground → analytic terrain
  routeHitToInspector(hit);
  if (window.__dtEmbed) {
    window.dispatchEvent(new CustomEvent('dt:select', {
      detail: window.__dtEmbed.normalizePick(hit),
    }));
  }
  // Existing tooltip line stays useful for terrain-Δ debugging
  if (hit) {
    const resolved = resolveTypedFromHit(hit);
    const z = hit.point.z.toFixed(1);
    const tz = terrainSampler ? terrainSampler(hit.point.x, hit.point.y)?.toFixed(1) : '?';
    const diff = terrainSampler ? (hit.point.z - terrainSampler(hit.point.x, hit.point.y)).toFixed(1) : '?';
    const label = nameForTwin(resolved?.name) || resolved?.name || '(unnamed)';  // viewer-click-names
    tooltip.textContent = `${label}  z=${z}  terrain=${tz}  Δ=${diff}m`;
    tooltip.style.color = parseFloat(diff) < -2 ? '#f87171' : '#5a6170';
  }
}

renderer.domElement.addEventListener('click', (e) => {
  if (performance.now() < _suppressClickUntil) return;   // tap already handled
  handleCanvasPick(e.clientX, e.clientY);
});

attachInspectorBindings();

// Test hook (three-viewer-controls R3): invoke the click-handler logic by
// typed-set ID rather than by screen coordinates. Pass null to simulate an
// untyped-mesh click (hide inspector).
function simulateClickOnTyped(typedSetId) {
  if (typedSetId == null) {
    hideInspector();
    return { dismissed: true };
  }
  const element = typedRuntime.getElement(typedSetId);
  if (!element) {
    hideInspector();
    return { dismissed: true, reason: 'unknown-id' };
  }
  const report = typedRuntime.getGeometryReport(typedSetId);
  toggleInspector(element, report);
  return { typedSetId };
}

// Compute the length-weighted midpoint of a polyline AND the tangent of the
// segment that contains it. Pure function — used by flyTargetForElement and
// also by the R4 edge test to compute the expected destination independently.
function polylineMidpointAndTangent(poly) {
  if (!Array.isArray(poly) || poly.length < 2) return null;
  let totalLen = 0;
  const segLens = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const dx = poly[i + 1][0] - poly[i][0];
    const dy = poly[i + 1][1] - poly[i][1];
    const dz = (poly[i + 1][2] ?? 0) - (poly[i][2] ?? 0);
    const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
    segLens.push(seg);
    totalLen += seg;
  }
  const half = totalLen / 2;
  let traversed = 0;
  let segIdx = 0;
  for (; segIdx < segLens.length - 1; segIdx++) {
    if (traversed + segLens[segIdx] >= half) break;
    traversed += segLens[segIdx];
  }
  const a = poly[segIdx];
  const b = poly[segIdx + 1];
  const segLen = segLens[segIdx] || 1;
  const frac = (half - traversed) / segLen;
  const mid = [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    (a[2] ?? window.DT_SITE.cameraTargetZ) + ((b[2] ?? window.DT_SITE.cameraTargetZ) - (a[2] ?? window.DT_SITE.cameraTargetZ)) * frac,
  ];
  // Tangent of the segment that contains the midpoint (xy only — Z handled
  // separately by the camera-offset Z lift).
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const tlen = Math.sqrt(dx * dx + dy * dy) || 1;
  return { mid, tangent: [dx / tlen, dy / tlen] };
}

// Bounding-box size [dx, dy, dz] of an XYZ polyline.
function _polylineBboxSize(poly) {
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (const p of poly) {
    const x = p[0], y = p[1], z = p[2] ?? 0;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  return [maxx - minx, maxy - miny, maxz - minz];
}

// Compute fly destination (pos + target) for a typed element (three-viewer-controls R4).
// Frames via fit-to-bounds (viewer-zoom-to-feature): target = node position /
// length-weighted polyline midpoint; standoff derived from the feature extent
// (a node is point-like → clamps to MIN_STANDOFF_M; a longer edge → larger standoff).
function flyTargetForElement(element) {
  if (!element) return null;
  if (element.twin_type === 'node' && element.geometry?.position) {
    const [x, y, z] = element.geometry.position;
    return fitPoseForExtent({ center: [x, y, z], size: [0, 0, 0] });
  }
  if (element.twin_type === 'edge' && Array.isArray(element.geometry?.polyline)) {
    const mt = polylineMidpointAndTangent(element.geometry.polyline);
    if (!mt) return null;
    return fitPoseForExtent({ center: mt.mid, size: _polylineBboxSize(element.geometry.polyline) });
  }
  return null;
}

// dblclick handler (three-viewer-controls R4): fly to clicked twin, then show
// inspector. Named function so touch double-taps share the identical path.
function handleCanvasDblPick(clientX, clientY) {
  const hit = raycastHitsAt(clientX, clientY)[0];
  const resolved = resolveTypedFromHit(hit);
  if (!resolved?.element) return;
  const dest = flyTargetForElement(resolved.element);
  if (!dest) return;
  const report = typedRuntime.getGeometryReport(resolved.element.id);
  flyTo({
    ...dest,
    onArrive: () => showInspector(resolved.element, report),
  });
}

renderer.domElement.addEventListener('dblclick', (e) => {
  if (performance.now() < _suppressClickUntil) return;   // tap already handled
  handleCanvasDblPick(e.clientX, e.clientY);
});

// Test hook (three-viewer-controls R4): trigger the dblclick path by typed ID.
function simulateDblclickOnTyped(typedSetId) {
  if (typedSetId == null) return { skipped: true };
  const element = typedRuntime.getElement(typedSetId);
  if (!element) return { skipped: true, reason: 'unknown-id' };
  const dest = flyTargetForElement(element);
  if (!dest) return { skipped: true, reason: 'no-geometry' };
  const report = typedRuntime.getGeometryReport(typedSetId);
  flyTo({
    ...dest,
    onArrive: () => showInspector(element, report),
  });
  return { typedSetId };
}

// ── Go-to-twin search ──────────────────────────────────────────
// Ported from the Cesium viewer (viewer-cesium/main.js:832), which was the only
// engine that had it. Resolve a query to a twin and fly there + inspect:
//   1. exact typed-element id (edges E042 + typed nodes; case-insensitive)
//   2. exact id in twinRegistry (semantic node N01, T2 edge twin_id E-…)
//   3. semantic node by id OR name substring (frameData.node_metadata, e.g. 水社)
// Returns {found, id?, kind?, query} so the input wiring + tests can react.
function gotoTwin(rawQuery) {
  const queryText = String(rawQuery ?? '').trim();
  if ([...contextRegistry.keys()].some((id) => id.toLowerCase() === queryText.toLowerCase())) {
    // Context IDs are deliberately not candidates for twin lookup, even if a
    // future authored name or edge index happens to share the text.
    return { found: false, query: queryText };
  }
  // Resolution policy is shared (viewer-common/goto-resolver). Build the same
  // three ordered indexes the original port used; the resolver applies
  // id-beats-name + case-insensitivity:
  //   1) rendered typed ids (E042, typed nodes)
  //   2) any twinRegistry id (semantic node N01, T2 edge twin_id E-…)
  //   3) semantic node by id OR name substring (frameData.node_metadata, 水社)
  //   4) every edge from edges.json by id (+ edge_names.json name) — appended
  //      AFTER the node indexes (sml-viewer-goto-edge-index D1) so an exact node
  //      id still wins and a node name is never shadowed by an edge name. Lets an
  //      edge that did NOT render into a registered mesh still resolve + fly.
  const indexes = [
    { name: 'typed', entries: [...typedObjectRegistry.keys()].map((id) => ({ id })) },
    { name: 'twin', entries: [...twinRegistry.keys()].map((id) => ({ id })) },
    { name: 'node', entries: Object.entries(frameData?.node_metadata || {})
        .map(([id, meta]) => ({ id, name: meta.name })) },
    { name: 'edge', entries: edgeGotoEntries },
  ];
  const res = resolveTwinQuery(rawQuery, indexes);
  if (!res.found) return res;
  const id = res.id;

  // Prefer the typed path (full inspector, same as dblclick). Fall back to the
  // twinRegistry mesh position for ids not in typed_set (e.g. T2 edge twin_ids).
  const typed = typedRuntime.getElement(id);
  if (typed) {
    const dest = flyTargetForElement(typed);
    const report = typedRuntime.getGeometryReport(id);
    if (dest) flyTo({ ...dest, onArrive: () => showInspector(typed, report) });
    else showInspector(typed, report);
    return { found: true, kind: typed.twin_type || 'typed', id };
  }
  const obj = twinRegistry.get(id);
  if (obj) {
    // Frame via fit-to-bounds (viewer-zoom-to-feature): standoff derived from
    // the object's world AABB extent — robust whether the object is a node
    // sphere (mesh.position set) or an edge sub-mesh (geometry baked in world
    // coords with mesh.position at the origin).
    const pose = zoomToFeature(obj);
    if (pose) {
      const kind = id.startsWith('N') ? 'node' : 'edge';
      return { found: true, kind, id };
    }
  }
  // sml-viewer-goto-edge-index: an edge that resolved only via the edges index
  // (not in typed_set / twinRegistry — e.g. an overlay hero, or any edge not in
  // edges.glb). Fly to its precomputed ENU centroid, framed by the edge's bbox
  // size so the camera pulls back to clear the terrain (a size-0 standoff lands
  // the eye UNDER the hillside for an elevated boardwalk cut into a slope).
  const centroid = edgeGotoCentroids.get(id);
  if (centroid) {
    const size = edgeGotoSizes.get(id) || [0, 0, 0];
    const pose = zoomToFeature({ center: centroid, size });
    if (pose) return { found: true, kind: 'edge', id };
  }
  return { found: false, query: res.query };
}

// ── Goto results dropdown (viewer-goto-dropdown) ───────────────
// Clickable, name-grouped search results under #goto-input. Purely additive:
// Enter keeps the gotoTwin path verbatim; the dropdown only adds a click path.
// Edge names come from the derived data/sml/edge_names.json (lineage.source.
// way_id → OSM name join); node names from frameData.node_metadata.
let _edgeNameIndexPromise = null;
function loadEdgeNameIndex() {
  if (!_edgeNameIndexPromise) {
    // An undeclared resource degrades to node-name matches only. A declared,
    // required resource remains fail-closed through the shared fetch gate.
    _edgeNameIndexPromise = fetchDeclaredOptionalResource('edgeNames', 'edge_names.json')
      .then((r) => (r ? r.json() : null))
      .then((doc) => (doc && doc.names && typeof doc.names === 'object' ? doc.names : {}));
  }
  return _edgeNameIndexPromise;
}

// ── Twin name index (viewer-click-names) ───────────────────────
// id -> human name, built from the SAME indexes the goto dropdown uses
// (edge_names.json inverted + frameData.node_metadata). Rebuilt whenever frames
// load (node names are per-scenario; edge names are static + memoized).
let _nameById = new Map();
async function rebuildNameIndex() {
  const edgeNames = await loadEdgeNameIndex();
  _nameById = buildNameById([
    { name: 'edge', entries: Object.entries(edgeNames).flatMap(([nm, ids]) => ids.map((id) => ({ id, name: nm }))) },
    { name: 'node', entries: Object.entries(frameData?.node_metadata || {}).map(([id, meta]) => ({ id, name: meta.name })) },
  ]);
}
function nameForTwin(id) {
  return (id && _nameById.get(id)) || null;
}

// Resolve a query to name-grouped row models [{name, kind, count, ids}].
// Grouping happens here (UI concern) — resolveTwinQueryAll stays pure policy.
async function gotoDropdownRows(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const edgeNames = await loadEdgeNameIndex();
  const indexes = [
    {
      name: 'edge',
      entries: Object.entries(edgeNames).flatMap(([nm, ids]) => ids.map((id) => ({ id, name: nm }))),
    },
    {
      name: 'node',
      entries: Object.entries(frameData?.node_metadata || {}).map(([id, meta]) => ({ id, name: meta.name })),
    },
  ];
  const res = resolveTwinQueryAll(q, indexes);
  const groups = new Map();
  for (const m of res.matches) {
    if (!m.name) continue;
    const key = `${m.indexName}:${m.name}`;
    if (!groups.has(key)) groups.set(key, { name: m.name, kind: m.indexName, count: 0, ids: [] });
    const g = groups.get(key);
    g.count += 1;
    g.ids.push(m.id);
  }
  return [...groups.values()];
}

// Union featureExtent over the group's resolvable twinRegistry meshes (a name
// group may include edges outside the rendered AOI — skip those), then frame
// via zoomToFeature's {center, size} form. Returns the pose, or null.
function gotoDropdownPickRow(row) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let used = 0;
  for (const id of row.ids || []) {
    const obj = twinRegistry.get(id);
    if (!obj) continue;
    const ext = featureExtent(obj);
    if (!ext) continue;
    used += 1;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], ext.center[i] - ext.size[i] / 2);
      max[i] = Math.max(max[i], ext.center[i] + ext.size[i] / 2);
    }
  }
  if (!used) return null;
  hideGotoResults();
  const input = document.getElementById('goto-input');
  if (input) { input.value = ''; input.blur(); }
  return zoomToFeature({
    center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2),
    size: [0, 1, 2].map((i) => max[i] - min[i]),
  });
}

function renderGotoResults(rows) {
  const box = document.getElementById('goto-results');
  if (!box) return;
  box.innerHTML = '';
  if (!rows.length) { box.classList.add('hidden'); return; }
  for (const row of rows.slice(0, 12)) {
    const el = document.createElement('div');
    el.className = 'goto-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'goto-name';
    nameEl.textContent = row.name;
    const metaEl = document.createElement('span');
    metaEl.className = 'goto-meta';
    metaEl.textContent = row.kind === 'edge' ? `edge · ${row.count}` : row.kind;
    el.append(nameEl, metaEl);
    el.addEventListener('click', () => gotoDropdownPickRow(row));
    box.appendChild(el);
  }
  box.classList.remove('hidden');
}

function hideGotoResults() {
  const box = document.getElementById('goto-results');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

// Wire the #goto-input box: Enter resolves + flies; Escape clears. stopPropagation
// keeps keystrokes (digits, WASD letters) from reaching the viewer keybinds.
(function wireGotoInput() {
  const input = document.getElementById('goto-input');
  const info = document.getElementById('info');
  if (!input) return;
  // Dropdown render on typing (≥2 chars). Sequence guard drops stale async
  // results so a fast second keystroke can't be overwritten by a slow first.
  let gotoSeq = 0;
  input.addEventListener('input', async () => {
    const seq = ++gotoSeq;
    const rows = await gotoDropdownRows(input.value);
    if (seq === gotoSeq) renderGotoResults(rows);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { hideGotoResults(); input.value = ''; input.blur(); return; }
    if (e.key !== 'Enter') return;
    hideGotoResults();
    const res = gotoTwin(input.value);
    if (res.found) {
      input.value = '';
      input.blur();
      if (info) info.textContent = '';
    } else if (res.query) {
      if (info) {
        info.textContent = `Not found: ${res.query}`;
        setTimeout(() => {
          if (info.textContent.startsWith('Not found')) info.textContent = '';
        }, 2000);
      }
    }
  });
})();

// ── Mobile Apple-Maps chrome ────────────────────────────────────────────────
// The focused controller owns only layout/sheet state. Existing controls move
// by identity into semantic slots and return through exact DOM markers.
const MOBILE_MQ = window.matchMedia('(max-width: 768px), ((pointer: coarse) and (max-width: 1024px))');
(function wireMobileChrome() {
  mobileChrome = installMobileChrome({
    camera,
    controls,
    flyTo,
    cancelMomentum: () => mobileGestures?.cancel(),
  });
  const zoomIn = document.getElementById('btn-zoom-in');
  const zoomOut = document.getElementById('btn-zoom-out');
  const reset = document.getElementById('btn-reset-view');
  if (zoomIn) zoomIn.addEventListener('click', () => navZoomStep(1));
  if (zoomOut) zoomOut.addEventListener('click', () => navZoomStep(-1));
  if (reset) {
    // Reset = fly to the site's FIRST viewpoint (same insertion order that
    // maps key `1` — site-driven, no hardcoded pose).
    reset.addEventListener('click', () => {
      const first = Object.keys(VIEWPOINTS)[0];
      if (first) flyTo(first);
    });
  }
  const apply = () => mobileChrome.setMode(MOBILE_MQ.matches);
  if (typeof MOBILE_MQ.addEventListener === 'function') MOBILE_MQ.addEventListener('change', apply);
  apply();
})();

// ── POI labels (P4): screen-constant icon+text sprites, rank-based distance LOD ──
// Apple-style: same pixel size at any rotate/pivot/tilt (sizeAttenuation off, like
// makeBeacon); each label shows only within a camera-distance band by rank, so far
// zoom-out declutters to the notable ones. Data: meshes/poi_labels.json (physical_twins).
// Camera-distance visibility band by rank. Rank 1 is ALWAYS visible (declutter
// keeps the notable labels); hiding bands (2/3) must sit within controls'
// reachable range [minDistance 50, maxDistance 40000] — a finite band above
// 40 km would never trigger by zooming (camera clamps at 40 km from target).
const LABEL_MAXDIST = { 1: Infinity, 2: 9000, 3: 4000 };
// Sprite height as fraction of viewport — per-site override via site-config
// poiLabelScreenH (exec producer 2026-07-05: alishan labels 50% smaller);
// sites without the key keep the previous constant unchanged.
const LABEL_SCREEN_H = window.DT_SITE.poiLabelScreenH || 0.026;
const _poiLabels = [];

function _makeLabelSprite(label) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const FONT = 30, PAD = 12, DOT = 8, GAP = 7;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `600 ${FONT}px "Microsoft JhengHei","Noto Sans TC",sans-serif`;
  ctx.font = font;
  const text = label.name || label.id;
  const tw = Math.ceil(ctx.measureText(text).width);
  const W = PAD + DOT * 2 + GAP + tw + PAD, H = FONT + PAD;
  cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
  ctx.scale(dpr, dpr);
  ctx.font = font; ctx.textBaseline = 'middle';
  const cy = H / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath(); ctx.roundRect(0.5, 0.5, W - 1, H - 1, H / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = label.type === 'station' ? '#4285f4' : label.type === 'tree' ? '#2e7d32' : '#e8710a';
  ctx.beginPath(); ctx.arc(PAD + DOT, cy, DOT, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.fillText(text, PAD + DOT * 2 + GAP, cy);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4; tex.needsUpdate = true;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true,
    toneMapped: false,   // Alishan defaults to renderStyle:'apple' (ACES) — keep canvas colors as authored
  }));
  spr.scale.set(LABEL_SCREEN_H * (W / H), LABEL_SCREEN_H, 1);
  spr.center.set(0.5, 0);                       // anchor bottom-centre -> sits above the point
  spr.position.set(label.x, label.y, label.z + 30);
  spr.renderOrder = 2000;
  return spr;
}

// Twin ids that own a label sprite — createNodeMarkers skips their balloons
// (the label IS the overhead marker; sml-poi-descriptive-cards).
const _poiLabelTwinIds = new Set();

async function loadPoiLabels(opts = {}) {
  let labels;
  const labelUrl = opts.contextRequest
    ? opts.url
    : (opts.url || window.DT_assetUrl('meshes/poi_labels.json'));
  if (opts.contextRequest && (typeof labelUrl !== 'string' || labelUrl.trim() === '')) {
    throw new Error('site-layer consumer: context label artifact requires an explicit URL');
  }
  try {
    const r = await fetch(labelUrl);
    if (!r.ok) {
      if (opts.contextRequest) throw new Error(`context label artifact unavailable at ${labelUrl}`);
      return;                                    // site without labels -> skip silently
    }
    labels = await r.json();
  } catch (err) {
    if (opts.contextRequest) throw err;
    return;
  }
  if (!Array.isArray(labels)) {
    if (opts.contextRequest) throw new Error(`context label artifact is not an array at ${labelUrl}`);
    return;                                      // malformed file -> skip, never abort boot
  }
  const group = new THREE.Group();
  let bad = 0;
  const contextInspection = opts.contextRequest
    ? contextInspectionRecord(opts.contextRequest)
    : null;
  for (const l of labels) {
    try {
      if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y) || !Number.isFinite(l.z)) { bad++; continue; }
      const spr = _makeLabelSprite(l);
      spr.userData = { rank: l.rank || 3 };
      if (contextInspection) {
        Object.assign(spr.userData, {
          authority_scope: CONTEXT_AUTHORITY_SCOPE,
          context_role: opts.contextRequest.role,
          context_id: opts.contextRequest.stable_id,
          source_ref: opts.contextRequest.source_ref,
          notice_ref: opts.contextRequest.notice_ref,
        });
      }
      group.add(spr); _poiLabels.push(spr);
      if (!contextInspection && l.id) _poiLabelTwinIds.add(String(l.id));
    } catch { bad++; }                           // one bad label must not stop the rest / boot
  }
  scene.add(group);
  layerRoots[opts.layer || 'poiLabels'] = group;
  if (contextInspection) {
    group.userData = {
      ...group.userData,
      authority_scope: CONTEXT_AUTHORITY_SCOPE,
      context_role: opts.contextRequest.role,
      context_id: opts.contextRequest.stable_id,
      source_ref: opts.contextRequest.source_ref,
      notice_ref: opts.contextRequest.notice_ref,
    };
    contextRegistry.set(opts.contextRequest.stable_id, {
      request: opts.contextRequest,
      inspection: contextInspection,
      root: group,
    });
  }
  console.log(`  poi_labels.json: ${_poiLabels.length} labels${bad ? ` (${bad} skipped)` : ''}`);
}

// Descriptive POI registry (sml-poi-descriptive-cards): visitor-facing content
// distilled from Pool A by scripts/build_poi_descriptions.py. Feeds the
// buildings-surface click card; sites without a declaration emit no request.
const POI_DESC_MAX_DIST_M = 40;   // building footprints reach ~30 m from the label anchor
let _poiDescIndex = [];

async function loadPoiDescriptions() {
  const r = await fetchDeclaredOptionalResource(
    'poiDescriptions', 'poi_descriptions.json',
  );
  if (!r) return;
  _poiDescIndex = buildPoiDescriptionIndex(await r.json(), geoToLocal);
  console.log(`  poi_descriptions.json: ${_poiDescIndex.length} descriptive POIs`);
}

function updatePoiLabelLOD() {
  if (!_poiLabels.length) return;
  const cp = camera.position;
  for (const s of _poiLabels) {
    s.visible = cp.distanceTo(s.position) <= (LABEL_MAXDIST[s.userData.rank] ?? LABEL_MAXDIST[3]);
  }
}

// ── Edge flow labels (viewer-edge-flow-labels) ─────────────────
// Apple-style path text for named network runs: glyphs flow along the
// screen-space projection at constant pixel size, repeat on long runs, hide
// when the projected run is too short, never render upside-down. The pure
// layout rules live in edge-labels.mjs (node-tested); this section owns
// projection, motion throttling and 2D-canvas drawing. Data source is the
// DIAG.edges array already fetched by loadDiagnostics — never a second
// fetch of the 49 MB edges.json.
const EDGE_LABEL_FONT_PX = 13;
const EDGE_LABEL_REPEAT_PX = 420;
const EDGE_LABEL_RELAYOUT_MS = 120;   // throttle during motion; settle pass ≤120ms after stop
const EDGE_LABEL_VIEW_MARGIN_PX = 100;
const EDGE_LABEL_MODE_PRIORITY = { road: 0, railway: 1, trail: 2 };  // roads win collisions

const EDGE_LABEL_OCCLUSION_CLEAR_M = 12;   // anchor lift so a crest doesn't hide its own label

const _edgeLabels = {
  runs: null, canvas: null, ctx: null, dpr: 1, placements: [],
  lastCamPos: null, lastCamQuat: null, dirty: false, lastLayout: 0,
  lastMs: 0, lastGlideMs: 0, advCache: new Map(),
  prevKeys: null, kState: {},   // layout-to-layout hysteresis (world-anchor stability)
};

function _edgeLabelFont() {
  return `600 ${EDGE_LABEL_FONT_PX}px "Microsoft JhengHei","Noto Sans TC",sans-serif`;
}

function _edgeLabelAdvances(text) {
  let adv = _edgeLabels.advCache.get(text);
  if (!adv) {
    _edgeLabels.ctx.font = _edgeLabelFont();
    adv = Array.from(text).map((ch) => _edgeLabels.ctx.measureText(ch).width);
    _edgeLabels.advCache.set(text, adv);
  }
  return adv;
}

function _sizeEdgeLabelCanvas() {
  const st = _edgeLabels;
  st.dpr = Math.min(window.devicePixelRatio || 1, 2);
  st.canvas.width = Math.ceil(window.innerWidth * st.dpr);
  st.canvas.height = Math.ceil(window.innerHeight * st.dpr);
  st.canvas.style.width = `${window.innerWidth}px`;
  st.canvas.style.height = `${window.innerHeight}px`;
  st.advCache.clear();                   // canvas resize resets ctx state
}

function initEdgeLabels(edges) {
  const chained = chainRuns(edges, { modeField: window.DT_SITE.schematicModeField });
  if (!chained.length) return;           // no named runs (e.g. SML) — stay inert
  // Local ENU coords + bounding sphere per run, computed once at load.
  _edgeLabels.runs = chained.map((r, idx) => {
    const xyz = new Float64Array(r.points.length * 3);
    const c = new THREE.Vector3();
    r.points.forEach(([lat, lng, z], i) => {
      const [x, y] = geoToLocal(lat, lng);
      const zz = Number.isFinite(Number(z)) ? Number(z) : window.DT_SITE.cameraTargetZ;
      xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = zz;
      c.x += x; c.y += y; c.z += zz;
    });
    c.divideScalar(r.points.length);
    let r2 = 0;
    for (let i = 0; i < xyz.length; i += 3) {
      r2 = Math.max(r2, (xyz[i] - c.x) ** 2 + (xyz[i + 1] - c.y) ** 2 + (xyz[i + 2] - c.z) ** 2);
    }
    // World cumulative arc — anchors are parameterized on this so placements
    // stay glued to their road spot under camera motion (spec: world-anchored).
    const warcs = new Float64Array(r.points.length);
    for (let i = 1; i < r.points.length; i++) {
      warcs[i] = warcs[i - 1] + Math.hypot(
        xyz[i * 3] - xyz[(i - 1) * 3],
        xyz[i * 3 + 1] - xyz[(i - 1) * 3 + 1],
        xyz[i * 3 + 2] - xyz[(i - 1) * 3 + 2]);
    }
    return { id: idx, name: r.name, mode: r.mode, xyz, warcs, sphere: new THREE.Sphere(c, Math.sqrt(r2)) };
  });
  const cv = document.createElement('canvas');
  cv.id = 'edge-label-overlay';
  container.appendChild(cv);
  _edgeLabels.canvas = cv;
  _edgeLabels.ctx = cv.getContext('2d');
  _sizeEdgeLabelCanvas();
  window.addEventListener('resize', () => { _sizeEdgeLabelCanvas(); _edgeLabels.dirty = true; });
  _edgeLabels.lastCamPos = new THREE.Vector3();
  _edgeLabels.lastCamQuat = new THREE.Quaternion();
  // Toggleable like scene layers; the setter redraws so both the checkbox and
  // programmatic setLayerVisible() clear/restore the overlay immediately.
  layerRoots.edgeLabels = {
    _v: true,
    get visible() { return this._v; },
    set visible(v) { this._v = !!v; _drawEdgeLabels(); },
  };
  _edgeLabels.dirty = true;
  console.log(`  edge labels: ${_edgeLabels.runs.length} named runs`);
}

const _elFrustum = new THREE.Frustum();
const _elMat = new THREE.Matrix4();
const _elV = new THREE.Vector3();

function _relayoutEdgeLabels() {
  const st = _edgeLabels;
  const W = window.innerWidth, H = window.innerHeight, M = EDGE_LABEL_VIEW_MARGIN_PX;
  _elMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _elFrustum.setFromProjectionMatrix(_elMat);
  const runs2d = [];
  for (const run of st.runs) {
    if (!_elFrustum.intersectsSphere(run.sphere)) continue;
    // Project verts, splitting at behind-camera portions; merge sub-3px steps.
    let cur = null;
    const flush = () => {
      if (cur && cur.pts.length >= 2 && cur.x1 >= -M && cur.x0 <= W + M && cur.y1 >= -M && cur.y0 <= H + M) {
        cur.prio = EDGE_LABEL_MODE_PRIORITY[run.mode] ?? 3;
        runs2d.push(cur);
      }
      cur = null;
    };
    const xyz = run.xyz;
    for (let i = 0; i < xyz.length; i += 3) {
      _elV.set(xyz[i], xyz[i + 1], xyz[i + 2]).applyMatrix4(camera.matrixWorldInverse);
      if (_elV.z > -1) { flush(); continue; }      // behind/at camera → split the run
      _elV.applyMatrix4(camera.projectionMatrix);  // camera space → NDC
      const sx = (_elV.x * 0.5 + 0.5) * W;
      const sy = (0.5 - _elV.y * 0.5) * H;
      // Near-plane verts project to absurd coordinates — split there like
      // behind-camera, or the inflated screen length poisons the repeat count.
      if (Math.abs(sx - W * 0.5) > W * 4 || Math.abs(sy - H * 0.5) > H * 4) { flush(); continue; }
      const warc = run.warcs[i / 3];
      if (!cur) {
        cur = { id: run.id, name: run.name, mode: run.mode, pts: [[sx, sy, warc]], len: 0, x0: sx, y0: sy, x1: sx, y1: sy };
        continue;
      }
      const last = cur.pts[cur.pts.length - 1];
      const step = Math.hypot(sx - last[0], sy - last[1]);
      const isFinal = i + 3 >= xyz.length;
      if (step < 3 && !isFinal) continue;          // screen-space downsample
      cur.pts.push([sx, sy, warc]);
      cur.len += step;
      cur.x0 = Math.min(cur.x0, sx); cur.y0 = Math.min(cur.y0, sy);
      cur.x1 = Math.max(cur.x1, sx); cur.y1 = Math.max(cur.y1, sy);
    }
    flush();
  }
  // Roads before railway before trails, longer projections first — collision
  // rects then declutter in Apple's priority order.
  runs2d.sort((a, b) => (a.prio - b.prio) || (b.len - a.len));
  st.placements = layoutLabels(runs2d, {
    fontPx: EDGE_LABEL_FONT_PX, repeatPx: EDGE_LABEL_REPEAT_PX, measure: _edgeLabelAdvances,
    viewport: { w: W, h: H },   // off-screen anchors must not starve the budget
    prevKeys: st.prevKeys,      // survivors keep their collision wins (no flip-flop)
    prevState: st.kState,       // repeat-count debounce (no anchor reshuffle)
    occluded: _edgeLabelOccluded,
  });
  st.kState = st.placements.kState;
  st.prevKeys = new Set(st.placements.map((p) => p.key));
  // Resolve each glyph's world point + reading-direction lookahead so the
  // glide pass can re-project them every frame between relayouts.
  for (const p of st.placements) {
    const run = st.runs[p.runId];
    for (const g of p.glyphs) {
      g.world = _pointAtWarc(run, g.warc);
      g.worldAhead = _pointAtWarc(run, g.warcAhead);
    }
  }
  _drawEdgeLabels();
}

// Point on the run's 3D polyline at world arc w (binary search + lerp).
function _pointAtWarc(run, w) {
  const W = run.warcs, xyz = run.xyz;
  const last = W.length - 1;
  const x = Math.min(Math.max(w, W[0]), W[last]);
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (W[m] <= x) lo = m; else hi = m;
  }
  const t = (x - W[lo]) / ((W[hi] - W[lo]) || 1);
  return [
    xyz[lo * 3] + (xyz[hi * 3] - xyz[lo * 3]) * t,
    xyz[lo * 3 + 1] + (xyz[hi * 3 + 1] - xyz[lo * 3 + 1]) * t,
    xyz[lo * 3 + 2] + (xyz[hi * 3 + 2] - xyz[lo * 3 + 2]) * t,
  ];
}

// Terrain occlusion: ray-march camera→anchor against the O(1) terrain height
// sampler. Clearance lifts the anchor and the march skips both endpoints so a
// road never hides its own label on a crest; a ridge in between does hide it.
function _edgeLabelOccluded(run2d, warc) {
  if (!terrainSampler) return false;
  const run = _edgeLabels.runs[run2d.id];
  const p = _pointAtWarc(run, warc);
  const c = camera.position;
  const dx = p[0] - c.x, dy = p[1] - c.y, dz = p[2] + EDGE_LABEL_OCCLUSION_CLEAR_M - c.z;
  const dist = Math.hypot(dx, dy, dz);
  const n = Math.min(40, Math.max(8, Math.floor(dist / 120)));
  for (let i = 1; i < n; i++) {
    const t = 0.05 + (0.90 * i) / n;
    const tz = terrainSampler(c.x + dx * t, c.y + dy * t);
    if (Number.isFinite(tz) && tz > c.z + dz * t + 1.0) return true;
  }
  return false;
}

// Glide: between throttled relayouts, re-project the placed glyphs from their
// stored world points every frame — labels stay glued to their road spot
// instead of freezing in screen space and snapping 120ms later.
const _glV = new THREE.Vector3();
function _projectWorldPoint(w) {
  _glV.set(w[0], w[1], w[2]).applyMatrix4(camera.matrixWorldInverse);
  if (_glV.z > -1) return null;                  // behind camera
  _glV.applyMatrix4(camera.projectionMatrix);
  return [(_glV.x * 0.5 + 0.5) * window.innerWidth, (0.5 - _glV.y * 0.5) * window.innerHeight];
}

function _glideEdgeLabels() {
  const st = _edgeLabels;
  const t0 = performance.now();
  for (const p of st.placements) {
    p.hidden = false;
    for (const g of p.glyphs) {
      const a = _projectWorldPoint(g.world);
      const b = _projectWorldPoint(g.worldAhead);
      if (!a || !b) { p.hidden = true; break; }
      g.x = a[0]; g.y = a[1];
      g.angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  _drawEdgeLabels();
  st.lastGlideMs = performance.now() - t0;
}

function _drawEdgeLabels() {
  const st = _edgeLabels;
  if (!st.ctx) return;
  const ctx = st.ctx;
  ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
  ctx.clearRect(0, 0, st.canvas.width / st.dpr, st.canvas.height / st.dpr);
  if (!layerRoots.edgeLabels?.visible) return;
  const palette = window.DT_SITE.edgeLabelColors || {};
  ctx.font = _edgeLabelFont();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';     // Apple halo
  for (const p of st.placements) {
    if (p.hidden) continue;                       // behind camera during glide
    ctx.fillStyle = palette[p.mode] || '#5f6368';
    for (const g of p.glyphs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.strokeText(g.ch, 0, 0);
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    }
  }
}

function updateEdgeLabels(now) {
  const st = _edgeLabels;
  if (!st.runs) return;
  const moved = camera.position.distanceToSquared(st.lastCamPos) > 0.01
    || camera.quaternion.angleTo(st.lastCamQuat) > 1e-4;
  if (moved) {
    st.lastCamPos.copy(camera.position);
    st.lastCamQuat.copy(camera.quaternion);
    st.dirty = true;
  }
  if (st.dirty && now - st.lastLayout >= EDGE_LABEL_RELAYOUT_MS) {
    const t0 = performance.now();
    _relayoutEdgeLabels();
    st.lastMs = performance.now() - t0;           // perf hook (task 4.2)
    st.lastLayout = now;
    st.dirty = false;
    return;                                       // fresh layout already drew
  }
  if (moved && st.placements.length) _glideEdgeLabels();   // glued between relayouts
}

// ── Render loop ────────────────────────────────────────────────
let _lastRafNow = 0;
function animate(now) {
  requestAnimationFrame(animate);

  // WASD
  applyWASD();

  // Playback. Cinema holds (beat hold_ms / an up card) gate the stepper
  // without touching `playing` — Space pause/resume stays the user's.
  const cinemaHolding = cinema && (cinema.cardActive || now < cinema.holdUntil);
  if (canonicalClock) {
    renderCanonicalState(canonicalClock.tick(now));
  } else if (playing && frameData && now - lastTick > playSpeed && !cinemaHolding) {
    lastTick = now;
    const next = currentFrame + 1;
    if (next < frameData.frame_count) {
      applyFrame(next);
    } else {
      playing = false;
      document.getElementById('btn-play').textContent = '▶ Play';
      document.getElementById('btn-play').classList.remove('active');
      // End of a cinema chapter: roll the next one (closing card after C).
      if (cinema) startChapter(cinema.chapter + 1);
    }
  } else if (playing && frameData && !cinemaHolding) {
    // Sub-frame glide toward the next frame's baked position (story-cinema §2).
    updateActorTweens(Math.min(1, (now - lastTick) / playSpeed));
  } else if (playing && !frameData && ENV.name === 'sunrise-demo') {
    const last = lastTick || now;
    lastTick = now;
    advanceFramelessEnvironment(now - last, now);
  } else if (!frameData && ENV.name === 'sunrise-demo') {
    // Keep the sun/light pose in sync while paused; progress stays fixed.
    applyEnvironmentProgress(environmentProgress, now);
  }

  // Camera fly
  updateFly(now);
  mobileChrome?.update(now);

  // Protagonist chase (yields to one-shot flights and user gestures).
  updateFollowCam(now - (_lastRafNow || now));
  _lastRafNow = now;

  // Terrain clamp — prevent camera below terrain
  if (camera.position.z < window.DT_SITE.cameraFloorZ) camera.position.z = window.DT_SITE.cameraFloorZ;  // site camera floor (lake - headroom)

  // OrbitControls remains the desktop writer. During an owned coarse-pointer
  // phase its update would re-clamp the anchor-relative pose around a different
  // target, so it yields until touch/momentum returns to idle.
  if (!mobileGestures?.ownsCamera()) controls.update();
  updateSkyPlacement();
  updatePoiLabelLOD();
  updateEdgeLabels(now);   // path-flowing edge labels: throttled relayout
  renderer.render(scene, camera);
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  try {
    await window.__smlThreeTypedRuntimeReady;
    const terrain = await loadTerrain();
    if (window.DT_SITE.progressiveLoading && !terrain.terrain) {
      throw new Error('Required startup terrain mesh is missing');
    }
    setLoading('Loading meshes...', 5);
    const deferredMeshes = await loadMeshes();
    if (!siteHasDeclaredContextRoles()) {
      await loadPoiLabels();   // P4: screen-constant POI labels (physical_twins)
    }
    await loadPoiDescriptions();   // descriptive card registry (rides P4; before frames)
    // Z-fault diagnostics + goto index read the t2 edges/intersections JSON —
    // only when the site declares that pipeline (viewer-3d-site-agnostic D3).
    if (window.DT_hasLayer('intersections')) {
      await loadDiagnostics();
      await loadReliefFaults();   // surface-relief axis (eat/gap/spike) — lights up the legend
      // Path-flowing edge labels chain the same DIAG.edges records — must run
      // before installLayerToggles so layerRoots.edgeLabels exists to wire.
      if (window.DT_hasLayer('edgeLabels')) initEdgeLabels(DIAG.edges);
    }
    installLayerToggles();
    // sml-walkway-3d-overlay: additive overlay loaded as a separate toggleable
    // Three.js Group. A site without the declaration emits no request.
    await loadWalkway3dOverlay();
    if (window.DT_SITE.scenarios) await loadFrameData('v5_a');  // frameless sites keep the GLB nodes (no createNodeMarkers strip)
    if (!frameData) {
      if (ENV.name === 'sunrise-demo') {
        setFramelessEnvironmentProgress(environmentProgress);
      } else {
        applyDaylightEnvironment();
      }
    }
    await loadCanonicalPlayback();
    setLoading('Ready', TOTAL_STEPS);
    hideLoading();
    requestAnimationFrame(animate);
    if (typeof deferredMeshes === 'function') {
      requestAnimationFrame(() => {
        // Wait for the overlay's actual fade, including a zero-duration style.
        Promise.all(loadingOverlay.getAnimations().map((animation) => animation.finished))
          .then(deferredMeshes)
          .catch((err) => {
            console.error('Deferred scene meshes failed:', err);
            const info = document.querySelector('#info');
            if (info) info.textContent = `Scene details unavailable: ${err.message}`;
          });
      });
    }
    // Kiosk boot (§4): ?cinema=1 starts the film directly.
    if (window.DT_SITE.scenarios && new URLSearchParams(location.search).has('cinema')) playFilm();
  } catch (err) {
    loadingStatus.textContent = `Error: ${err.message}`;
    console.error(err);
  }
}

// ── sml-walkway-3d-overlay: load + toggle the additive walkway-3D overlay ──
// The overlay glb is built by scripts/mesh_gen/build_walkway_3d_overlay.py
// from data/sml/elevation_profiles/walkway_3d_overrides.yaml. It sits as a
// separate Three.js Group alongside edges.glb; the legacy mesh is untouched.
// Default visible; toggle with `O` (Overlay).
let walkway3dOverlayGroup = null;
// Base-network edges.glb meshes the overlay supersedes (the "two sets" the
// producer flagged): an edge-chain hero is also rendered as the crude base
// ribbon + railings. We hide those base meshes while the overlay is shown and
// restore them when it's toggled off, so the trail is drawn once.
let supersededBaseMeshes = [];
let supersededEdgeIds = [];  // sml-edge-mesh-merge: covered edges hidden in the batch

function applyOverlaySupersede(group) {
  const covered = new Set();
  group.traverse((o) => { (o.userData?.dt_covered_edges || []).forEach((e) => covered.add(e)); });
  supersededBaseMeshes = [];
  supersededEdgeIds = [];
  if (covered.size === 0) return;
  if (edgeBatch) {
    // sml-edge-mesh-merge: the base meshes are merged into the batch; hide the
    // covered edges' instances so the hero overlay isn't double-drawn over them.
    supersededEdgeIds = [...covered].filter((e) => edgeBatch.edgeInstances.has(e));
    supersededEdgeIds.forEach((e) => edgeBatch.setEdgeVisible(e, false));
    console.log(`[walkway-3d-overlay] superseded ${supersededEdgeIds.length} batched edges across ${covered.size} edges`);
    return;
  }
  const edgesRoot = layerRoots.edges;
  if (!edgesRoot) return;
  edgesRoot.traverse((o) => {
    if (o.isMesh && covered.has(o.userData?.dt_edge_id)) supersededBaseMeshes.push(o);
  });
  supersededBaseMeshes.forEach((m) => { m.visible = false; });
  console.log(`[walkway-3d-overlay] superseded ${supersededBaseMeshes.length} base meshes across ${covered.size} edges`);
}

async function loadWalkway3dOverlay() {
  const resource = window.DT_optionalResource(
    'walkway3dOverrides', 'meshes/walkway_3d_overrides.glb',
  );
  if (!resource) return null;
  const url = resource.url;
  const head = await fetchDeclaredOptionalResource(
    'walkway3dOverrides', 'meshes/walkway_3d_overrides.glb', { method: 'HEAD' },
  );
  if (!head) return null;

  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const group = new THREE.Group();
        group.name = 'walkway_3d_overrides';
        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          if (!child.geometry.attributes.normal) {
            child.geometry.computeVertexNormals();
          }
          const hasVC = child.geometry.attributes.color != null;
          child.material = new THREE.MeshLambertMaterial({
            vertexColors: hasVC,
            color: hasVC ? 0xffffff : 0x888888,
            side: THREE.DoubleSide,
          });
        });
        group.add(gltf.scene);
        group.visible = true; // D4: default ON during this change
        scene.add(group);
        walkway3dOverlayGroup = group;
        applyOverlaySupersede(group);  // hide the redundant base-network meshes
        console.log(`[walkway-3d-overlay] loaded ${url}; press O to toggle`);
        resolve(group);
      },
      undefined,
      (err) => {
        if (resource.required) {
          reject(new Error(
            `required optional resource ${resource.role} unavailable at ${url}`,
            { cause: err },
          ));
        } else {
          console.warn('[walkway-3d-overlay] load failed:', err);
          resolve(null);
        }
      }
    );
  });
}

// Toggle overlay visibility with `O`. Skip when the user is typing in a form.
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key.toLowerCase() !== 'o') return;
  if (!walkway3dOverlayGroup) return;
  walkway3dOverlayGroup.visible = !walkway3dOverlayGroup.visible;
  // Restore the base-network meshes when the overlay is hidden (so the trail
  // isn't blank), re-supersede them when it's shown.
  const reveal = !walkway3dOverlayGroup.visible;
  supersededBaseMeshes.forEach((m) => { m.visible = reveal; });
  if (edgeBatch) supersededEdgeIds.forEach((e) => edgeBatch.setEdgeVisible(e, reveal));
  console.log(`[walkway-3d-overlay] visibility = ${walkway3dOverlayGroup.visible}`);
});

main().then(() => {
  // Test hook — expose internals for Playwright verify_scene tests
  window.__dt = {
    scene,
    camera,
    controls,
    twinRegistry,
    contextRegistry,
    authoredPropRegistry,
    inspectContext: (id) => contextRegistry.get(id)?.inspection || null,
    inspectAuthoredProp: (id) => authoredPropRegistry.get(id)?.record || null,
    splatPairs: () => splatMeshPairs,  // loaded splats + their handed-off mesh props
    raycastAt,                         // app pick path (tests probe it directly)
    edgeMaterials,
    get edgeBatch() { return edgeBatch; }, // also reflects roads loaded after startup
    MERGE_EDGES,
    cohortActors,
    vehicleActors,
    setVehiclesVisible,
    edgeTracks: () => edgeTrackIndex,
    deckZAt: (x, y) => (deckZSampler ? deckZSampler(x, y) : NaN),
    follow: { start: startFollow, stop: stopFollow, resume: resumeFollow,
              state: () => followState },
    cinema: {
      start: playFilm, exit: exitCinema,
      nextChapter: () => startChapter(cinema ? cinema.chapter + 1 : 0),
      jump: jumpToBeat, dismissCard: dismissCinemaCard,
      setPlaying: (on) => { if (playing !== !!on) togglePlay(); },
      state: () => cinema && ({ chapter: cinema.chapter, schedIdx: cinema.schedIdx,
                                scheduleLength: cinema.schedule.length,
                                cardActive: cinema.cardActive, fast: cinema.fast,
                                loading: !!cinema.loading, tempo: cinema.tempo,
                                playSpeed, currentFrame }),
    },
    geoToLocal,
    frameData,
    terrainSampler,
    diagnostics: DIAG,
    assetDiagnostics,
    edgeLabels: _edgeLabels,   // placements/lastMs/dirty — test + perf hook
    environment: {
      state: environmentStateForTest,
      setProgress: setFramelessEnvironmentProgress,
    },
    // Story mode (sml-red-v5 task 5.2) — read state + drive it from tests.
    // frameIndexForTime reads the LIVE frameData (the top-level __dt.frameData
    // capture goes stale after a scenario switch).
    story: {
      beats: () => narrationBeats,
      config: () => storyConfig,
      mode: () => storyMode,
      current: () => currentStoryBeat,
      frameIndexForTime: (t) =>
        frameData ? frameData.frames.findIndex((f) => f.time === t) : -1,
      cohortIds: () => (frameData ? Object.keys(frameData.cohort_metadata || {}) : []),
    },
    setDiagnosticsVisible,
    layers: layerRoots,
    setLayerVisible,
    setDiagnosisMode,
    clearColorHex: () => renderer.getClearColor(new THREE.Color()).getHex(),
    applyFrame,
    glbNodeZ,
    typedObjectSummary,
    selectTypedElement,
    typedObjectSummaryForId,
    nameForTwin,
    routeHitToInspector,   // viewer-click-names: drive the inspector path in tests
    cameraState,
    // Test hook: project a world point to client (CSS) pixel coords so a
    // Playwright test can dispatch a real oblique-angle click at a known edge.
    worldToClient: ([x, y, z]) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (v.x + 1) / 2 * rect.width,
        y: rect.top + (1 - v.y) / 2 * rect.height,
      };
    },
    recenterOrbitAt,
    // viewer-mobile-controls: distance-to-floor nav law + mobile chrome hooks.
    nav: {
      heightAboveFloor: navHeightAboveFloor,
      applySensitivity: applyNavSensitivity,
      zoomStep: navZoomStep,
      orbitStep: navOrbitStep,
      maxDistance: CAMERA_MAX_DISTANCE,
    },
    // Read-only touch evidence. CDP coverage drives real events; it never
    // invokes a controller mutation through this surface.
    gestures: { snapshot: () => mobileGestures.snapshot() },
    mobile: {
      setMode: (on) => mobileChrome.setMode(on),
      setDetent: (name, opts) => mobileChrome.setDetent(name, opts),
      setSection: (name, minimum) => mobileChrome.setSection(name, minimum),
      snapshot: () => mobileChrome.snapshot(),
    },
    wasdMoveSpeed: () => computeWasdMoveSpeed(),
    simulateRotationStart: ({ clientX, clientY } = {}) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const cx = clientX ?? (rect.left + rect.width / 2);
      const cy = clientY ?? (rect.top + rect.height / 2);
      return startCtrlRotationPivot(cx, cy);
    },
    simulateRotationMove: ({ clientX, clientY }) => applyCtrlGestureMove(clientX, clientY),
    simulateRotationEnd: () => endCtrlGesture(),
    ctrlGestureAnchor: () => (ctrlGesture ? ctrlGesture.anchor.clone() : null),
    simulateClickOnTyped,
    simulateDblclickOnTyped,
    raycastHitsAt,
    raycastTerrainFast,   // analytic ray-vs-terrain (debug/verify hook)
    pickSimNodeAt,
    pickCausalDiagnosisAt,
    gotoTwin,
    // sml-viewer-goto-edge-index: expose the edges goto index + centroid map so
    // the Playwright spec can assert reachability without re-parsing edges.json.
    goto: { edgeEntries: edgeGotoEntries, edgeCentroids: edgeGotoCentroids },
    gotoDropdownQuery: (q) => gotoDropdownRows(q),
    gotoDropdownPick: async (name) => {
      const rows = await gotoDropdownRows(name);
      const row = rows.find((r) => r.name === name) || rows[0];
      return row ? gotoDropdownPickRow(row) : null;
    },
    routeHitToInspector,
    toggleElevatedInspector,
    flyTo,
    flyAnimationActive,
    zoomToFeature,
    featureExtent,
    polylineMidpointAndTangent,
    simulateDragTheWorld: (start, end) => {
      // Test helper: drive the same code path the DOM event listeners use.
      // start: {clientX, clientY, ctrlKey?} for the mousedown moment, or null to continue an active drag
      // end:   {clientX, clientY} for the mousemove moment
      // Returns { anchored, suppressed?, anchorPoint? }
      if (start) {
        if (start.ctrlKey || start.metaKey) {
          // Ctrl path — drag-the-world is suppressed
          return { anchored: false, suppressed: true };
        }
        const anchor = startDragTheWorld(start.clientX, start.clientY);
        if (!anchor) return { anchored: false };
      }
      if (!panAnchor) return { anchored: false };
      applyDragTheWorld(end.clientX, end.clientY);
      return { anchored: true, anchorPoint: panAnchor.anchorPoint };
    },
    endDragTheWorld,
  };
  if (window.__dtEmbed && canonicalClock) {
    window.__dtEmbed.canonical = { clock: canonicalClock,
      frameTimesSeconds: canonicalAdapter.frameTimesSeconds, render: renderCanonicalState };
  }
  if (window.__dtEmbed) window.__dtEmbed.translateCameraTarget = translateCameraTarget;
  if (window.__dtEmbed) window.__dtEmbed.setCameraPose = setCameraPose;
  if (window.__dtEmbed && loadingOverlay.classList.contains('done')) {
    requestAnimationFrame(() => window.dispatchEvent(
      new CustomEvent('dt:ready', { detail: window.__dt }),
    ));
  }
});
