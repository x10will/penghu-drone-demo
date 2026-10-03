// DT viewer — per-site config layer (viewer-3d-site-agnostic).
//
// Loaded FIRST (before base.js / main.js) via a classic <script> tag in
// index.html, so the per-site parameters are set on `window` SYNCHRONOUSLY when
// base.js/main.js run their top-level init — no async/fetch ordering problem
// (design D1). Select a site with ?site=<id> (default 'sml'). Add a site by
// adding an entry to SITES. The viewer reads window.DT_SITE / DT_assetUrl /
// DT_geoToLocal / DT_hasLayer instead of hardcoded SML constants
// (see references/alishan-viewer-generalization.md).
//
// The pure core (resolveSite / makeAssetUrl / makeGeoToLocal / makeHasLayer) is
// tail-exported under CommonJS so tests/viewer/test_site_config.mjs can exercise
// it in node without a browser. Browsers ignore the `module` block.

(function () {
  'use strict';
  const M_PER_DEG_LAT = 111320.0;
  const ALISHAN_ZHUSHAN_SUN = {
    date: '2026-01-01',
    timeZone: 'Asia/Taipei',
    utcOffsetMinutes: 480,
    observer: { lat: 23.5119872, lng: 120.8226332 },
    horizonDeg: -0.833,
  };

  const SITES = {
    // Existing SML site — values lifted verbatim from base.js/main.js so the
    // default (?site=sml) behavior is byte-identical after the refactor.
    sml: {
      id: 'sml',
      label: '日月潭 Sun Moon Lake',
      renderStyle: 'apple',          // Apple Maps 3D grade (bright daylight); override per-session with ?style=classic
      environment: { default: 'daylight' },
      poiLabelScreenH: 0.010,        // POI label sprite height, viewport fraction (sizeAttenuation:false → fixed 1.0% of viewport). SML omitted this and fell back to the 0.026 default (oversized). Set smaller than Alishan's 0.013 — SML is POI-dense (~91 labels). Tune this one number to taste.
      center: { lat: 23.858, lng: 120.917 },
      dataBase: '../../data/sml',
      lakeZ: 748.48,                 // orthometric (TWVD2001); null = no lake layer
      cameraTargetZ: 752,            // initial camera target Z + node-Z fallback
      cameraFloorZ: 742,             // lowest the camera may descend (lake - headroom)
      scenarios: true,               // has frames_*_viewer.json (frame-driven node markers)
      // Overlap-axis gates (sml-overlap-cleanup): the broad net pinned 90 pairs /
      // 147 edges, but triage showed 86 pairs are real-world co-location (52
      // junction grazes + 34 paths built a steady 2–5 m beside roads), not the
      // duplicate-surface fault this axis targets. Both gates ON leaves exactly
      // the 4 true duplicates — 月潭自行車道 cycleway segments whose byte-identical
      // reversed polylines are ALSO carried as unnamed highway=service driving
      // ways (1000809719, 712325702). Re-pin: 90/147 → 4/8.
      overlapDiscountSharedJunctions: true,
      overlapStrictDuplicateSurface: true,
      layers: {                      // which optional layers this site has
        terrain: true, nodes: true, edges: true, intersections: true,
        lake: true, buildings: true, docks: true, ropeway: true,
        'twin-lineage': { required: false },
        supportStructures: true,     // M9 separate S7 retaining-wall asset
        junctionPlates: true,        // Stage-7 dressing; exact legacy fallback is metadata-driven
        edgeLabels: true,            // OSM road/trail names along edges (edge_names.json)
        // SML resources with source-owned artifacts. A declaration authorizes
        // the request; required resources fail closed when unavailable.
        heroRailing: true,
        poiDescriptions: true,
        stairsStepCounts: true,
        edgeNames: true,
        causalDiagnoses: true,
        reliefFaults: true,
        walkway3dOverrides: true,
      },
      // Hero prop assets (video-recon-hero-prop): standalone anchored GLBs in
      // the toggleable 'props' layer; provenance sidecar sits next to each GLB.
      props: [
        { id: 'lalu_island', label: '拉魯島', path: 'props/lalu_island.glb', visible: true, twin: 'SML-POI-21' },
        { id: 'lalu_ring', label: '浮田（拉魯島）', path: 'props/lalu_ring.glb', visible: true, twin: 'SML-POI-21' },
        { id: 'wenwu_temple', label: '文武廟', path: 'props/wenwu_temple.glb', visible: true, twin: 'SML-POI-10' },
      ],
      // Splat display lane (sml-hero-splat-v2): photoreal Gaussian splats
      // trained on the same captures as the mesh props. Display-only — the
      // mesh prop keeps pick duty; meshProps lists the prop ids a loaded
      // splat hides (restored if the splat 404s or the lane toggles off).
      splats: [
        { id: 'lalu_splat', label: '拉魯島（splat）', path: 'props/lalu_splat.ksplat', twin: 'SML-POI-21', meshProps: ['lalu_island', 'lalu_ring'] },
        { id: 'wenwu_splat', label: '文武廟（splat）', path: 'props/wenwu_splat.ksplat', twin: 'SML-POI-10', meshProps: ['wenwu_temple'] },
      ],
      // Camera presets. Raw {pos,target} are local-space; geo-anchored presets
      // ({posAnchor,posOffset,posZ,targetAnchor,targetZ}) resolve via geoToLocal.
      viewpoints: {
        aerial:    { label: 'Aerial', pos: [0, -4000, 3500], target: [0, 0, 752] },
        shuishe:   { label: '水社',   posAnchor: [23.866, 120.911], posOffset: [200, -300], posZ: 832, targetAnchor: [23.866, 120.911], targetZ: 752 },
        itathao:   { label: '伊達邵', posAnchor: [23.849, 120.934], posOffset: [200, -300], posZ: 832, targetAnchor: [23.849, 120.934], targetZ: 752 },
        xiangshan: { label: '向山',   posAnchor: [23.852, 120.902], posOffset: [-200, -300], posZ: 832, targetAnchor: [23.852, 120.902], targetZ: 752 },
        ropeway:   { label: '纜車',   posAnchor: [23.860, 120.940], posOffset: [300, -200], posZ: 900, targetAnchor: [23.858, 120.938], targetZ: 800 },
      },
    },

    // 六堆雅歌園有機教育農場 — manifest-bound static first-light package.
    farm: {
      id: 'farm',
      label: '六堆雅歌園有機教育農場',
      renderStyle: 'apple',
      environment: { default: 'daylight' },
      center: { lat: 22.6229171, lng: 120.5991429 },
      dataBase: '../../data/farm',
      canonicalManifest: '../../data/farm-canonical/manifest.json',
      canonicalNoticeSummary: '模擬候選資料 · 非農場操作建議',
      canonicalNotices: ['展示六塊田的模擬階段、擴散與通知。'],
      // Declared canonical scenarios, picked with ?scenario=<id> in canonical
      // mode; an undeclared id fails closed. Without the parameter the
      // canonicalManifest above plays. Authority: Will, 2026-09-28: "hmm. the
      // use cases are not clear. 巡田 is a feature, identify pest spread is another".
      canonicalScenarios: {
        pest: '../../data/farm-canonical-pest/manifest.json',
        patrol: '../../data/farm-canonical-patrol/manifest.json',
      },
      lakeZ: null,
      cameraTargetZ: 30,
      cameraFloorZ: 16.92,
      scenarios: false,
      // Suppress the browser's implicit root favicon request for this offline
      // package without changing the legacy SML request/response behavior.
      faviconHref: 'data:,',
      // Phones: render terrain and nodes first, then stream context layers and
      // props (Will, 2026-09-27: "let's optimize for mobile"). No meshopt: the
      // package GLBs are not EXT_meshopt_compression-packed. No
      // startupNodeCount: the node count belongs to the mounted package, so a
      // deployment registry pins it, not this entry.
      progressiveLoading: true,
      // Farm export receipt records this package manifest as manifest.json
      // beside the exported assets (linked Farm receipt
      // reference/sources/receipts/farm-site-export-determinism-20260821.receipt.json:92-96).
      contextLayerManifest: 'manifest.json',
      // Source: linked Farm profile context roles, plus the ruled optional
      // generic-edge package role from viewer lane brief 2.
      // reference/sources/derived/site-bake-pipeline/farm.site-profile.v1.json:587-595;
      // Will's #200 closing comment (issue comment 5889322216), after DT PR
      // #207 made context toggles declaration-driven: declare context-waterways
      // here with a label so its generated toggle reads well.
      // These declarations admit roles only; the manifest supplies each path,
      // and an optional role is inert when its record is absent.
      contextLayerRoles: {
        'painted-terrain': true,
        'context-roads': true,
        'generic-edge': true,
        'river-zone-paint': true,
        'river-ribbon': true,
        trees: true,
        'white-context-buildings': true,
        'supported-labels': true,
        'farm-field-ridges': true,
        'context-waterways': { label: '水路' },
      },
      layers: {
        terrain: true, nodes: true, edges: true, intersections: true,
        lake: false, buildings: false, docks: false, ropeway: false,
        junctionPlates: false, edgeLabels: false, trees: false,
      },
      props: [
        // Source: viewer-site-config/spec.md:95-105 and the accepted Farm
        // prop rows already present in this config. Context and authored
        // records are explicit; the consumer never infers scope from labels or paths.
        // Source/notice lineage: Farm source package
        // reference/sources/derived/farm-site-export/farm-site-source-package.v1.json:135-155
        // (OSM relation/source IDs and the context_road notice at 110-112).
        // Source: Farm source package
        // reference/sources/derived/farm-site-export/farm-site-source-package.v1.json:461-520.
        // The context prop is origin_kind=context-record at 461-465; accepted
        // authored rows retain their source-owned Building, DirectorAssertion,
        // or Face origin_kind at 468-520. No authority is inferred from a path.
        { id: 'county-road-185-ribbon-v1', label: '縣道185（context only）', path: 'props/context/sha256-40b7617024a25a8d97692420d903014ce622146b94066eb23562d5d737d4396d.glb', visible: true, authority_scope: 'context-only', origin_kind: 'context-record', context_role: 'context-roads', source_ref: 'urn:npust:smart-agriculture-management-platform:source:osm-relation-5311031', notice_ref: 'context_road' },
        { id: 'urn:npust:smart-agriculture-management-platform:building:education-pavilion', label: '模擬食農教育亭', path: 'props/buildings/sha256-4a46a823dc1c80e2a34cbbada40bf239fa1dbc2427041e449b215ef9c354529b.glb', visible: true, origin_kind: 'Building' },
        // preserve_declared_appearance: the Farm Director appearance mandate
        // (x10will/farm#58) authorises this Building to ship authored surface
        // detail, which the shared restyle would discard. The declaration is
        // inert for an asset that declares no material of its own, so it does
        // not change the current vertex-coloured extrusion.
        { id: 'urn:npust:smart-agriculture-management-platform:building:guesthouse', label: '雅歌園民宿', path: 'props/buildings/sha256-50b1ffd0ec2e272cd25fd430193e8e3fe55f5bbfa7f2f00ec775a5f5e5ec0da4.glb', visible: true, origin_kind: 'Building', preserve_declared_appearance: true },
        { id: 'urn:npust:smart-agriculture-management-platform:director-assertion:farm-parking-outline-presentation-v1', label: 'urn:npust:smart-agriculture-management-platform:director-assertion:farm-parking-outline-presentation-v1', path: 'props/presentations/sha256-80b46e4003954e4707b05f30f5890113158f977d837d14baeb0572e10165c3f3.glb', visible: true, origin_kind: 'DirectorAssertion' },
        { id: 'urn:npust:smart-agriculture-management-platform:director-assertion:farm-site-perimeter-presentation-v1', label: 'urn:npust:smart-agriculture-management-platform:director-assertion:farm-site-perimeter-presentation-v1', path: 'props/presentations/sha256-afd039c2a9c0bbba615ddded5cd8a8c1fad9108e5e985031f4b2c07d5205e5f2.glb', visible: true, origin_kind: 'DirectorAssertion' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:education-pavilion-footprint', label: '模擬食農教育亭 footprint', path: 'props/faces/sha256-2b452b7d25f8cb7e5fa62dc7410cae8c7b9745c595d2a008844fda56f00b92c1.glb', visible: true, origin_kind: 'Face' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:field-eta', label: '模擬田區 1', path: 'props/faces/sha256-ebf37449f80091efdeb4e2d242d0c9159b53035a15f0c8c5e0010bb36aeaae00.glb', visible: true, origin_kind: 'Face' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:field-alpha', label: '模擬田區 2', path: 'props/faces/sha256-aba6b698b589b561e01b53a42e3f790fcd13ac96204a68957317b97cd4dc0b0f.glb', visible: true, origin_kind: 'Face' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:field-theta', label: '模擬田區 3', path: 'props/faces/sha256-7ede008cec2d9390053806064f9261999687c28af73c732a9a6742bbea2f2dd2.glb', visible: true, origin_kind: 'Face' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:greenhouse-bay-a', label: 'urn:npust:smart-agriculture-management-platform:face:greenhouse-bay-a', path: 'props/faces/sha256-22dda1b2ffdc081ad22c17d44bb1900d19b5dec1fca05eb0808279474f340b9d.glb', visible: true, origin_kind: 'Face' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:greenhouse-bay-b', label: 'urn:npust:smart-agriculture-management-platform:face:greenhouse-bay-b', path: 'props/faces/sha256-856ca1292a7150a667f8acbf9621c41f605b1493483cab2be147e9196fa13de9.glb', visible: true, origin_kind: 'Face' },
        { id: 'urn:npust:smart-agriculture-management-platform:face:guesthouse-footprint', label: 'urn:npust:smart-agriculture-management-platform:face:guesthouse-footprint', path: 'props/faces/sha256-11a7858e58713962eecbaf019516a2083a79893545239337ab8fa03a46be04c9.glb', visible: true, origin_kind: 'Face' },
      ],
      viewpoints: {
        // portrait: a close oblique view for a phone held upright (Will,
        // 2026-09-28 lane design: default 農場近距斜視 shows the fields in
        // portrait at 390 px). Seen from the south-south-east, it puts
        // 田區1/2/3, both greenhouse bays, the mock neighbour field (where the
        // pest story starts), the buildings and the full
        // 六堆雅歌園有機教育農場 / 雅歌園民宿 labels between y 70 and 330 of a
        // 390 x 788 frame: the strip the farm panel's deck leaves uncovered.
        aerial: { label: '農場近距斜視', pos: [-130.008, -199.946, 192.5], target: [19.992, 0.054, 30],
          portrait: { pos: [73.4, -213, 232.1], target: [8, -63, 30] } },
      },
    },

    // Alishan NSA — alternate site (config-only here; meshes live in AliShanTwin).
    // Present so the site-independence path is exercisable; no lake, no ropeway.
    alishan: {
      id: 'alishan',
      label: '阿里山 Alishan',
      center: { lat: 23.486, lng: 120.733 },
      dataBase: '../../data/alishan',
      lakeZ: null,
      cameraTargetZ: 1500,
      cameraFloorZ: 1000,
      scenarios: false,              // no frames yet -> keep the GLB nodes, skip frame-driven markers
      fog: false,                    // ~35 km extent: SML-scale fog would wash out the whole view
      renderStyle: 'apple',          // Apple Maps 3D grade (bright daylight); override per-session with ?style=classic
      environment: {
        default: 'sunrise-demo',
        sun: ALISHAN_ZHUSHAN_SUN,
        goldenWindowMin: 20,
        loopSeconds: 90,
        reviewViewpoint: {
          id: 'ALI-POI-01',
          label: '祝山觀景台',
          local: { x: 9151.4, y: 2892.9, z: 2463.4 },
          yawDeg: 120,
          pitchDeg: 0,
          eyeHeightM: 150,
          lookDistanceM: 4800,
        },
      },
      poiLabelScreenH: 0.013,        // POI label sprite height, viewport fraction (exec producer: 50% of the 0.026 default; sites omitting this keep 0.026)
      // Diagnosis-layer tuning for the synth-corridor (engine-agnostic-tier2) graph:
      // edges fan out from shared junctions and rail runs parallel to trails, so the
      // overlap axis discounts shared-junction grazes, and the schematic colors by
      // transport mode (steep NOT overridden — Alishan trails are steep by nature).
      // SML now sets the two overlap gates too (sml-overlap-cleanup; see its
      // entry) but still omits the schematic overrides (undefined -> neutral).
      overlapDiscountSharedJunctions: true,
      // Strict duplicate-surface test: boardwalks (森之道/林之道) run a deliberate
      // 2–5 m beside forest roads, and same-junction trail/road pairs are legit
      // parallel routes — median-separation + shared-endpoint gates purge both.
      overlapStrictDuplicateSurface: true,
      schematicColorByMode: true,
      // The engine colors the schematic by mode generically — it reads which edge
      // field names the mode + the per-mode palette from here, so no site vocab is
      // hardcoded in the viewer code. SML omits these (undefined -> neutral base).
      schematicModeField: 'mode_alishan',   // road/trail/railway/disused live in edges.json.mode_alishan
      schematicModeColors: {
        road: 0xf5f5fa,     // near-white
        trail: 0xff8c00,    // orange
        railway: 0xe12828,  // red — 森鐵 active line
        disused: 0xb478d2,  // violet — 眠月線 etc.
      },
      // Path-flowing edge-label text tint keyed by schematicModeField values
      // (viewer-edge-flow-labels). Sites omitting this get one neutral style.
      edgeLabelColors: {
        road: '#5f6368',    // Apple road-label gray
        trail: '#2f5c38',   // deep mountain green — Alishan is a forestry
        railway: '#a04a32', // rust — 森鐵
      },
      layers: {
        terrain: true, nodes: true, edges: true, intersections: true,
        lake: false, buildings: true, docks: false, ropeway: false,
        trees: true,                   // conifer dressing (AliShanTwin feat-viewer-dressing-resilient); landcover is COLOR_0 paint inside terrain.glb now
        edgeLabels: true,              // Apple-style path-flowing road/trail/rail names
        edgeNames: true,
        terrainFaults: true,
        causalDiagnoses: true,
        // Alishan supports a causal-only diagnostic package; the normalized
        // SML relief census is therefore requested when present but not required.
        reliefFaults: { required: false },
      },
      viewpoints: {
        // Sized for the ~35 km NSA extent (X +/-18 km, Y +/-10 km), not SML's 5 km.
        aerial: { label: 'Aerial', pos: [0, -32000, 34000], target: [0, 0, 1200] },
        // Drops into the 森林遊樂區 core (阿里山站/沼平/祝山) so the internal
        // forest-road/trail/rail network is legible — the 35 km aerial makes it
        // a sub-pixel speck. ~3.4 km out, 45deg down.
        park: { label: '森林遊樂區', posAnchor: [23.5108, 120.8025], posOffset: [0, -3400], posZ: 5650, targetAnchor: [23.5108, 120.8025], targetZ: 2250 },
      },
    },
  };

  // ── Pure core (testable) ───────────────────────────────────────
  // Views a twin inspection is composed from (twin-inspection-contract); equal
  // to INSPECTOR_VIEWS in docs/viewer-common/label-binding.js.
  const INSPECTOR_VIEW_NAMES = Object.freeze(['descriptive', 'node', 'typed', 'sources']);
  const CONTEXT_LAYER_ROLES = Object.freeze([
    'painted-terrain', 'context-roads', 'generic-edge', 'river-zone-paint',
    'river-ribbon', 'trees', 'white-context-buildings', 'supported-labels',
    'farm-field-ridges', 'context-waterways',
  ]);

  function reportFatalLoad(error) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const overlay = document.getElementById('loading');
    if (!overlay) return;
    const message = typeof error?.message === 'string' ? error.message : String(error);
    const errorPanel = document.getElementById('loading-error');
    const errorMessage = document.getElementById('loading-error-message');
    const progressBar = document.getElementById('loading-bar');
    const progressText = document.getElementById('loading-status');
    if (errorMessage) errorMessage.textContent = message;
    if (progressText) {
      progressText.textContent = `Error: ${message}`;
      progressText.hidden = true;
    }
    if (progressBar) progressBar.hidden = true;
    if (errorPanel) errorPanel.hidden = false;
    overlay.classList.remove('done');
  }

  function setLoadingTitle(site) {
    if (typeof document === 'undefined') return;
    if (!site || typeof site.label !== 'string' || !site.label.trim()) return;
    document.title = `${site.label} — Digital Twin Viewer`;
    const loadingTitle = typeof document.getElementById === 'function'
      ? document.getElementById('loading-title') : null;
    const hudTitle = typeof document.querySelector === 'function'
      ? document.querySelector('#hud h1') : null;
    if (loadingTitle) loadingTitle.textContent = `Loading ${site.label}…`;
    if (hudTitle) hudTitle.textContent = site.label;
  }

  function setLoadingTitleFromRegistry(registry) {
    const siteId = new URLSearchParams(window.location.search).get('site') || registry?.defaultSite;
    const site = registry?.sites?.[siteId];
    setLoadingTitle(site);
  }

  if (typeof window !== 'undefined') window.DT_reportFatalLoad = reportFatalLoad;

  function validateRegistry(registry) {
    const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const fail = () => { throw new Error('DT viewer: malformed deployment registry'); };
    const nonEmpty = v => typeof v === 'string' && v.length > 0;
    // Optional camera envelope, as main.js/base.js consume it: each is read with
    // `?? default` (null or absent = default); cameraFar is the far plane beyond
    // the fixed 10 m near plane, cameraMaxDistance and terrainRayMaxDistance are
    // distances, and cameraPosition is spread into camera.position.set(x, y, z).
    const optional = (value, valid) => value === undefined || value === null || valid(value);
    const distance = v => Number.isFinite(v) && v > 0;
    const cameraValid = site =>
      optional(site.cameraFar, v => Number.isFinite(v) && v > 10) &&
      optional(site.cameraMaxDistance, distance) &&
      optional(site.terrainRayMaxDistance, distance) &&
      optional(site.cameraPosition, v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite));
    // Optional `inspector: { views }`: a non-empty list of distinct known view
    // names. `views` is the only key; later phases extend the object on purpose.
    // Optional canonical declarations: a manifest path, and a scenario
    // allowlist of id -> manifest path (ids are URL-safe lowercase names).
    const path = v => typeof v === 'string' && v.length > 0;
    const nonBlankPath = v => typeof v === 'string' && v.trim() !== '';
    const scenariosValid = scenarios => scenarios === undefined || (object(scenarios) &&
      Object.entries(scenarios).every(([id, manifest]) => /^[a-z0-9][a-z0-9_-]*$/.test(id) && path(manifest)));
    const gzipAssetDeclarationCheck = paths => paths === undefined || (Array.isArray(paths) &&
      paths.length > 0 && new Set(paths).size === paths.length &&
      paths.every(p => typeof p === 'string' && p.endsWith('.json') &&
        p.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..')));
    const meshoptDeclarationCheck = value => value === undefined || typeof value === 'boolean';
    const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    // Optional portrait variant of a local {pos, target} viewpoint (geo-anchored
    // presets have none): {pos, target} local vectors.
    const viewpointsValid = viewpoints => viewpoints === undefined || (object(viewpoints) &&
      Object.values(viewpoints).every(vp => object(vp) && (vp.portrait === undefined ||
        (vp.pos && vp.target && object(vp.portrait) && vector(vp.portrait.pos) && vector(vp.portrait.target)))));
    const inspectorValid = inspector => inspector === undefined || (object(inspector) &&
      Object.keys(inspector).length === 1 && Array.isArray(inspector.views) &&
      inspector.views.length > 0 && new Set(inspector.views).size === inspector.views.length &&
      inspector.views.every(view => INSPECTOR_VIEW_NAMES.includes(view)));
    const layerMapValid = layers => object(layers) && Object.values(layers).every(value =>
      typeof value === 'boolean' || (object(value) &&
        (!Object.hasOwn(value, 'enabled') || typeof value.enabled === 'boolean') &&
        (!Object.hasOwn(value, 'required') || typeof value.required === 'boolean')));
    const contextRolesValid = declarations => declarations === undefined ||
      (Array.isArray(declarations)
        ? new Set(declarations).size === declarations.length &&
          declarations.every(role => CONTEXT_LAYER_ROLES.includes(role))
        : object(declarations) && Object.entries(declarations).every(([role, declaration]) => {
          if (!CONTEXT_LAYER_ROLES.includes(role)) return false;
          if (declaration === null || typeof declaration === 'boolean') return true;
          return object(declaration) &&
            (!Object.hasOwn(declaration, 'enabled') || typeof declaration.enabled === 'boolean') &&
            (!Object.hasOwn(declaration, 'required') || typeof declaration.required === 'boolean') &&
            (!Object.hasOwn(declaration, 'label') ||
              (typeof declaration.label === 'string' && declaration.label.trim() !== ''));
        }));
    const propValid = prop => object(prop) && nonEmpty(prop.id) && nonEmpty(prop.label) &&
      nonEmpty(prop.path) && prop.path.endsWith('.glb') && typeof prop.visible === 'boolean' &&
      ['twin', 'authority_scope', 'origin_kind', 'context_role', 'source_ref', 'notice_ref',
        'appearance_provenance_ref'].every(field => !Object.hasOwn(prop, field) || nonEmpty(prop[field])) &&
      (!Object.hasOwn(prop, 'preserve_declared_appearance') ||
        typeof prop.preserve_declared_appearance === 'boolean');
    const splatValid = splat => object(splat) && nonEmpty(splat.id) && nonEmpty(splat.label) &&
      nonEmpty(splat.path) && splat.path.endsWith('.ksplat') &&
      (!Object.hasOwn(splat, 'twin') || nonEmpty(splat.twin)) &&
      (!Object.hasOwn(splat, 'meshProps') || (Array.isArray(splat.meshProps) &&
        new Set(splat.meshProps).size === splat.meshProps.length && splat.meshProps.every(nonEmpty)));
    if (!object(registry) || !object(registry.sites) ||
        !Object.hasOwn(registry.sites, registry.defaultSite)) fail();
    const legacySiteIds = [];
    for (const [id, site] of Object.entries(registry.sites)) {
      if (Object.hasOwn(site || {}, 'dtContract')) {
        if (site.dtContract !== 1) {
          throw new Error(
            `Registry declares dtContract ${String(site.dtContract)}; this viewer supports 1 (site '${id}').`,
          );
        }
      } else {
        legacySiteIds.push(id);
      }
      if (!object(site) || id.length === 0 || site.id !== id || typeof site.label !== 'string' ||
          site.label.trim() === '' ||
          !object(site.center) || !Number.isFinite(site.center.lat) ||
          !Number.isFinite(site.center.lng) || typeof site.dataBase !== 'string' ||
          !site.dataBase || !layerMapValid(site.layers) ||
          !Number.isFinite(site.cameraTargetZ) || !Number.isFinite(site.cameraFloorZ) ||
          !(site.lakeZ === null || Number.isFinite(site.lakeZ)) ||
          typeof site.scenarios !== 'boolean' || !cameraValid(site) || !inspectorValid(site.inspector) ||
          !optional(site.canonicalManifest, path) || !scenariosValid(site.canonicalScenarios) ||
          (site.canonicalNoticeSummary !== undefined && !nonEmpty(site.canonicalNoticeSummary)) ||
          (site.canonicalNotices !== undefined && (!Array.isArray(site.canonicalNotices) ||
            !site.canonicalNotices.every(notice => typeof notice === 'string'))) ||
          (site.contextLayerManifest !== undefined && !nonBlankPath(site.contextLayerManifest)) ||
          !contextRolesValid(site.contextLayerRoles) ||
          (site.props !== undefined && (!Array.isArray(site.props) || !site.props.every(propValid))) ||
          (site.splats !== undefined && (!Array.isArray(site.splats) || !site.splats.every(splatValid))) ||
          !meshoptDeclarationCheck(site.meshopt) ||
          !gzipAssetDeclarationCheck(site.gzipAssets) ||
          !viewpointsValid(site.viewpoints) ||
          (site.startupNodeCount !== undefined &&
            !(Number.isInteger(site.startupNodeCount) && site.startupNodeCount > 0))) fail();
    }
    const warnings = legacySiteIds.length ? [{
      code: 'missing-dtContract',
      scope: 'registry',
      siteIds: legacySiteIds,
      message: `[dt-contract] registry omits dtContract; interpreting as major 1 for sites: ${legacySiteIds.join(', ')}`,
    }] : [];
    return { ...registry, warnings };
  }

  // Built-in DT-owned entries cross the same contract boundary as injected
  // deployments. Their legacy omissions are reported by browser wiring below.
  const BUILTIN_REGISTRY = validateRegistry({ defaultSite: 'sml', sites: SITES });

  function resolveSite(search, sites, defaultSite = 'sml') {
    sites = sites || SITES;
    const params = new URLSearchParams(search || '');
    const siteId = params.get('site') || defaultSite;
    const site = Object.hasOwn(sites, siteId) ? sites[siteId] : null;
    if (!site) {
      throw new Error(
        `DT viewer: unknown ?site=${siteId}. Known: ${Object.keys(sites).join(', ')}.`
        + " Refusing an undeclared site to prevent loading undeclared data or fallback to another site's data.");
    }
    return site;
  }

  function makeAssetUrl(site) {
    return (rel) => `${site.dataBase}/${String(rel).replace(/^\/+/, '')}`;
  }

  function makeGeoToLocal(site) {
    const m_per_deg_lng = M_PER_DEG_LAT * Math.cos(site.center.lat * Math.PI / 180);
    return (lat, lng) => [
      (lng - site.center.lng) * m_per_deg_lng,
      (lat - site.center.lat) * M_PER_DEG_LAT,
    ];
  }

  function makeLocalToGeo(site) {
    const m_per_deg_lng = M_PER_DEG_LAT * Math.cos(site.center.lat * Math.PI / 180);
    return (x, y) => ({
      lon: site.center.lng + x / m_per_deg_lng,
      lat: site.center.lat + y / M_PER_DEG_LAT,
    });
  }

  function makeHasLayer(site) {
    return (name) => !!site.layers[name];
  }

  function makeOptionalResourceResolver(site) {
    const assetUrl = makeAssetUrl(site);
    return (role, path) => {
      const declaration = site.layers && site.layers[role];
      if (!declaration || declaration.enabled === false) return null;
      return {
        role,
        url: assetUrl(path),
        required: declaration === true || declaration.required !== false,
      };
    };
  }

  // ── Render-style palettes (design-D1: values are DATA here, not main.js
  // ternaries). main.js consumes window.DT_STYLE generically; a new grade
  // (P1+ buildings/casing/vegetation phases) adds a row, not branches.
  // NB: exact-color surfaces (diagnostic pins/markers/schematic) set
  // toneMapped:false and are style-independent by contract — palettes grade
  // the SCENERY only.
  const RENDER_STYLES = {
    classic: {
      clearColor: 0x4a6a8a,
      sky: { zenith: 0x0d1a2e, horizon: 0x4a6a8a, ground: 0x1a1a2e },
      toneMapping: null,            // renderer default (no tone mapping)
      exposure: 1.0,
      // respectSiteFogOff: large sites (alishan) declare fog:false and get none.
      fog: { color: 0x4a6a8a, density: 0.00006, respectSiteFogOff: true },
      lights: {
        ambient: { color: 0x4466aa, intensity: 0.3 },
        dir:     { color: 0xffeedd, intensity: 1.8 },
        fill:    { color: 0xffeedd, intensity: 0.3 },
        hemi:    { sky: 0x88aacc, ground: 0x443322, intensity: 0.5 },
      },
      building: { color: 0xb0a898, specular: 0x111111, shininess: 5 },
    },
    // Apple Maps 3D grade: bright neutral daylight, ACES-compensated lights,
    // gentle pale haze even on fog:false sites (deliberate — review-verified
    // mild: FogExp2 survival 0.90–0.73 at 20–35 km).
    apple: {
      clearColor: 0xd6e2ec,
      sky: { zenith: 0x9ec1e6, horizon: 0xd6e2ec, ground: 0xc4ccd2 },
      toneMapping: 'aces',
      exposure: 1.1,
      fog: { color: 0xd6e2ec, density: 0.000016, respectSiteFogOff: false },
      lights: {
        ambient: { color: 0xffffff, intensity: 0.5 },
        dir:     { color: 0xfff3e0, intensity: 2.4 },
        fill:    { color: 0xdfeaff, intensity: 0.35 },
        hemi:    { sky: 0xeaf3fb, ground: 0xc9ccc4, intensity: 0.85 },
      },
      building: { color: 0xedeae4, specular: 0x0a0a0a, shininess: 2 },  // matte near-white
    },
  };

  // ?style=<name> overrides the site default; unknown names fail loud like
  // resolveSite (a typo must not silently render a different grade).
  function resolveRenderStyle(search, site) {
    const name = new URLSearchParams(search || '').get('style')
      || (site && site.renderStyle) || 'classic';
    const style = RENDER_STYLES[name];
    if (!style) {
      throw new Error(
        `DT viewer: Unknown render style '${name}'. Known: ${Object.keys(RENDER_STYLES).join(', ')}`);
    }
    return { name, ...style };
  }

  const ENVIRONMENTS = {
    daylight: {
      loopSeconds: 0,
    },
    'sunrise-demo': {
      sun: ALISHAN_ZHUSHAN_SUN,
      sunAngularRadiusDeg: 0.265,
      goldenWindowMin: 20,
      loopSeconds: 90,
    },
  };

  // ?env=<name> overrides the site default. Environment values are data so
  // sites can tune sunrise timing without adding viewer branches.
  function resolveEnvironment(search, site) {
    const params = new URLSearchParams(search || '');
    const siteEnv = (site && site.environment) || {};
    const name = params.get('env') || siteEnv.default || 'daylight';
    const env = ENVIRONMENTS[name];
    if (!env) {
      throw new Error(
        `DT viewer: Unknown environment '${name}'. Known: ${Object.keys(ENVIRONMENTS).join(', ')}`);
    }
    const { default: _default, ...siteOverrides } = siteEnv;
    return { name, ...env, ...siteOverrides };
  }

  // ── Browser wiring: synchronous globals before base.js/main.js ──
  if (typeof window !== 'undefined' && window.location) {
    try {
      const hasDeployment = Object.hasOwn(window, 'DT_DEPLOYMENT');
      const sourceRegistry = hasDeployment ? window.DT_DEPLOYMENT : BUILTIN_REGISTRY;
      // A valid selected entry can name the loading overlay even when another
      // registry check rejects the deployment before runtime globals exist.
      setLoadingTitleFromRegistry(sourceRegistry);
      const registry = hasDeployment ? validateRegistry(sourceRegistry) : BUILTIN_REGISTRY;
      for (const warning of registry.warnings) console.warn(warning.message);
      const site = resolveSite(window.location.search, registry.sites, registry.defaultSite);
      window.DT_SITE = site;
      window.DT_SITES = registry.sites;
      // Render style: resolved palette on DT_STYLE (name included). 'apple' =
      // Apple Maps 3D grade. base.js ignores this by design (diagnostic scene).
      window.DT_STYLE = resolveRenderStyle(window.location.search, site);
      window.DT_RENDER_STYLE = window.DT_STYLE.name;
      window.DT_ENV = resolveEnvironment(window.location.search, site);
      window.DT_assetUrl = makeAssetUrl(site);
      window.DT_geoToLocal = makeGeoToLocal(site);
      window.DT_localToGeo = makeLocalToGeo(site);
      window.DT_hasLayer = makeHasLayer(site);
      window.DT_optionalResource = makeOptionalResourceResolver(site);
      if (site.faviconHref) {
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.href = site.faviconHref;
        document.head.appendChild(favicon);
      }
      // Drive page chrome from the active registry entry.
      setLoadingTitle(site);
      console.log(
        `[DT viewer] site=${site.id} center=(${site.center.lat},${site.center.lng}) dataBase=${site.dataBase} env=${window.DT_ENV.name}`);
    } catch (error) {
      reportFatalLoad(error);
      throw error;
    }
  }

  // ── Node (tests): export the pure core. Browsers ignore `module`. ──
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateRegistry, BUILTIN_REGISTRY, INSPECTOR_VIEW_NAMES, SITES, resolveSite, makeAssetUrl, makeGeoToLocal, makeLocalToGeo, makeHasLayer,
                       makeOptionalResourceResolver,
                       RENDER_STYLES, resolveRenderStyle, ENVIRONMENTS,
                       resolveEnvironment, M_PER_DEG_LAT };
  }
})();
