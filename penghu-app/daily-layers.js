import {labelWorldHeight} from './display-math.mjs';
import {createDailyHazard} from './daily-hazard.js';
import {DroneVisual, VehicleVisual, RouteActor} from './route-actor.js';
import {FollowCamera} from './follow-camera.mjs';
import {initMapCredit} from './attribution.mjs';

const DRAG_CANCEL_PX = 4, TAIL_WHEEL_RATE = 0.0015;
const COLORS = {'D-01': '#67e4dc', 'V-01': '#ffd38a', 'V-02': '#a7baff'};

/** Public viewer extension. All geographic poses come from the parent snapshot. */
export default function setup(api) {
  const {THREE} = api;
  const root = new THREE.Group();
  root.name = 'penghu-daily';
  api.scene.add(root);
  const viewStyle = document.createElement('style');
  viewStyle.textContent = `
    html.dt-embed #dt-embed-navigation{top:56px;right:6px;width:190px;max-width:calc(100% - 12px);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
    html.dt-embed #dt-embed-navigation button{box-sizing:border-box;width:100%;max-width:100%;min-width:0;margin:0}
    html.dt-embed #dt-embed-navigation #viewpoints{grid-column:1/-1;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));flex-direction:row;max-height:none;overflow:visible;gap:4px;width:100%;min-width:0}
    .penghu-daily-credit .credit-full{box-sizing:border-box}
  `;
  document.head.append(viewStyle);
  const creditStyle = document.createElement('link'); creditStyle.rel = 'stylesheet';
  creditStyle.href = new URL('./attribution.css', import.meta.url).href;
  document.head.append(creditStyle);
  const creditHost = document.createElement('div'); creditHost.className = 'map-overlays';
  Object.assign(creditHost.style, {position:'fixed',left:'auto',right:'6px',top:'8px',bottom:'auto',
    zIndex:'100',width:'min(330px, calc(100% - 180px))',pointerEvents:'none'});
  // The viewer's embed mode hides direct body children with !important.
  creditHost.style.setProperty('display', 'block', 'important');
  const credit = document.createElement('div');
  credit.className = 'penghu-daily-credit map-credit'; credit.dataset.creditState = 'intro';
  credit.innerHTML = '<div class="credit-full" id="daily-credit-details" hidden><button class="credit-close" type="button" aria-label="關閉資料來源與授權">✕</button>'+
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · '+
    '<a href="https://data.gov.tw/dataset/176927" target="_blank" rel="noopener noreferrer">內政部地政司 2025 20 m DTM</a>（'+
    '<a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">OGDL 1.0</a>） · '+
    '<a href="https://github.com/CesiumGS/cesium/tree/main/Apps/SampleData/models/CesiumDrone" target="_blank" rel="noopener noreferrer">CesiumDrone</a> — © 2017, 2018 Analytical Graphics, Inc.; mesh &amp; textures by Ed Mackey ('+
    '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>) · '+
    '<a href="https://kenney.nl/assets/car-kit" target="_blank" rel="noopener noreferrer">Van model: Kenney Car Kit</a> ('+
    '<a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0</a>)</div>'+
    '<div class="credit-bar"><span class="credit-intro"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a><span class="credit-extra"> · 內政部 DTM · CesiumDrone CC BY 4.0</span></span><button class="credit-toggle" type="button" aria-label="地圖資料來源與授權" aria-expanded="false" aria-controls="daily-credit-details">ⓘ</button></div>';
  creditHost.append(credit); document.body.append(creditHost);
  const actors = new Map(), labels = [], off = [], pickOff = [];
  off.push(initMapCredit(credit, document.body));
  let init = null, snapshot = null, disposed = false;
  let cameraMode = {mode: 'free', resourceId: 'D-01'}, trialPlan = null, trialActor = null;
  let pendingTrialFrame = false, lastFrame = null;
  const followCamera = new FollowCamera(api);
  const trialRoot = new THREE.Group(); trialRoot.name = 'daily-trial'; api.scene.add(trialRoot);
  // The five fixture sites replace the viewer's default network annotations.
  const originalLabels = [];
  api.scene.traverse(object => {
    if (object.isSprite) {
      const original = object.material;
      object.material = original.clone();
      object.material.visible = false;
      originalLabels.push({object, original});
    }
  });
  const emit = (name, payload) => { if (!disposed) api.appEvent(name, payload); };
  const tools = document.createElement('section'); tools.className = 'daily-map-tools';
  tools.setAttribute('aria-label', '地圖工具'); tools.style.setProperty('display', 'none', 'important');
  // This toolbar is inside the map iframe: it shares the map's entire lifecycle.
  tools.innerHTML = '<details><summary>地圖工具 · 模擬資料</summary><div><button type="button" data-overview>全區視角</button><select aria-label="地圖追蹤對象"></select><div class="camera-modes"><button type="button" data-mode="free">自由</button><button type="button" data-mode="follow">跟隨</button><button type="button" data-mode="tail">尾隨</button></div><label><input type="checkbox" checked>風險場</label><output role="status">風險場載入中</output></div></details>';
  document.body.append(tools);
  const resourceSelect = tools.querySelector('select'), hazardToggle = tools.querySelector('input'), hazardStatus = tools.querySelector('output');
  const hazard = createDailyHazard(api, {onStatus(status) {
    emit('daily:field-status', status);
    hazardStatus.textContent = status.error ? `風險場：${status.error}` : !status.visible ? '風險場已隱藏' : status.loading ? '風險場載入中' : `合成風險場 · ${String(Math.floor(status.timeMin / 60)).padStart(2, '0')}:${String(Math.floor(status.timeMin % 60)).padStart(2, '0')}`;
  }});
  tools.querySelector('[data-overview]').addEventListener('click', () => overview());
  for (const button of tools.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setCamera({mode: button.dataset.mode, resourceId: resourceSelect.value}, true));
  resourceSelect.addEventListener('change', () => setCamera({...cameraMode, resourceId: resourceSelect.value}, true));
  hazardToggle.addEventListener('change', () => { hazard.setVisible(hazardToggle.checked); emit('daily:hazard-visibility', {visible: hazardToggle.checked}); });
  // Zoom keeps following. A drag or a navigation key hands the camera back; a
  // plain click or wheel does not. In tail mode the camera is re-posed every frame,
  // so the wheel here is the only zoom: it scales the tail distance.
  const outside = event => tools.contains(event.target) || credit.contains(event.target);
  const releaseFollow = () => {
    pendingTrialFrame = false;
    if (cameraMode.mode !== 'free') setCamera({...cameraMode, mode: 'free'}, true);
  };
  const downs = new Map();
  const onPointerDown = event => {
    if (outside(event)) return;
    pendingTrialFrame = false;
    downs.set(event.pointerId, {x: event.clientX, y: event.clientY});
  };
  const onPointerMove = event => {
    const start = downs.get(event.pointerId);
    // Two pointers down is a pinch zoom, not a drag.
    if (!start || downs.size > 1) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_CANCEL_PX) { downs.clear(); releaseFollow(); }
  };
  const onPointerEnd = event => { downs.delete(event.pointerId); };
  const onKey = event => {
    if (outside(event) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(event.key)) return;
    releaseFollow();
  };
  const onWheel = event => {
    if (outside(event)) return;
    pendingTrialFrame = false;
    if (cameraMode.mode !== 'tail' || !event.deltaY) return;
    event.preventDefault(); event.stopImmediatePropagation();
    followCamera.zoomTail(Math.exp(Math.max(-300, Math.min(300, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * TAIL_WHEEL_RATE));
    moveCamera();
  };
  const listen = (type, handler, passive = true) => {
    document.addEventListener(type, handler, {capture: true, passive});
    off.push(() => document.removeEventListener(type, handler, {capture: true}));
  };
  listen('pointerdown', onPointerDown); listen('pointermove', onPointerMove);
  listen('pointerup', onPointerEnd); listen('pointercancel', onPointerEnd);
  listen('keydown', onKey); listen('wheel', onWheel, false);
  const position = (point, air = false) => {
    const [x, y] = api.geoToLocal(point.lat, point.lng);
    const ground = api.sampleGround(x, y);
    if (!Number.isFinite(ground)) throw new Error('配送路徑缺少地形高度');
    return new THREE.Vector3(x, y, air ? Math.max(point.altitudeM ?? 100, ground + 5) : ground + 4);
  };
  function releaseChildren() {
    for (const unpick of pickOff.splice(0)) unpick();
    for (const actor of actors.values()) actor.visual?.dispose();
    root.traverse(object => {
      object.geometry?.dispose();
      for (const material of [object.material].flat().filter(Boolean)) {
        material.map?.dispose();
        material.dispose();
      }
    });
    root.clear(); actors.clear(); labels.length = 0;
  }
  function label(text, color, kind = 'site') {
    const canvas = document.createElement('canvas');
    const measure = canvas.getContext('2d');
    measure.font = '40px sans-serif';
    canvas.width = Math.ceil(measure.measureText(text).width + 36); canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#102735ed'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(2, 2, canvas.width-4, 60);
    ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width/2, 46);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthTest: false, depthWrite: false}));
    sprite.renderOrder = 32;
    labels.push({sprite, kind, aspect: canvas.width/canvas.height});
    return sprite;
  }
  function makeActor(resource) {
    const visual = resource.type === 'drone' ? new DroneVisual(api) : new VehicleVisual(api, {
      url:new URL('../data/models/kenney-van/van.glb',import.meta.url).href, lengthM:5,
    });
    const group = visual.group; group.name = `daily-resource-${resource.id}`;
    const color = COLORS[resource.id] || '#fff';
    const captionText = `${resource.id} · ${resource.typeLabel ?? (resource.type === 'drone' ? '無人機' : resource.id === 'V-01' ? '配送車' : '接駁車')}`;
    const caption = label(captionText, color, 'resource');
    caption.userData.label = captionText;
    caption.center.set(.5, resource.type === 'drone' ? -.4 : 1.6);
    group.add(caption); group.renderOrder = 30;
    group.traverse(object => { object.renderOrder = 30; });
    root.add(group);
    pickOff.push(api.registerPickable(group, {id: group.name, type: 'daily-resource', label: resource.label,
      properties: {resourceId: resource.id}}));
    const actor = {group, visual, caption, resource, headingRad: 0, wheels:[]};
    actors.set(resource.id, actor);
    visual.load().then(() => {
      if (disposed || actors.get(resource.id) !== actor) { visual.dispose(); return; }
      group.traverse(object => {
        object.renderOrder = 30;
        if (resource.type === 'van' && object.isMesh) {
          // Keep material depth/lighting, but draw above the transparent field.
          for (const material of [object.material].flat()) material.transparent = true;
          if (object.name.startsWith('wheel-')) actor.wheels.push(object);
        }
      });
      if (snapshot) turnWheels(actor, snapshot.timeMin);
      scale();
    }).catch(error => {
      if (!disposed && actors.get(resource.id) === actor) emit('daily:error', {message: `${resource.label}模型：${error.message}`});
    });
  }
  function turnWheels(actor, timeMin) {
    if (!actor.wheels.length) return;
    const meters = init.movements.filter(item => item.resourceId === actor.resource.id).reduce((total, item) =>
      total + item.distanceKm * 1000 * Math.max(0, Math.min(1, (timeMin - item.startMin) / (item.endMin - item.startMin))), 0);
    // The asset's wheel radius is 0.3 source units. Rotation is a deterministic
    // display of distance already supplied by the run, independent of wall time.
    const angle = meters / (.3 * actor.visual.unitScale);
    for (const wheel of actor.wheels) wheel.rotation.x = angle % (2 * Math.PI);
  }
  function updateTargets() {
    if (!init) return;
    const items = [...init.resources, ...(trialPlan ? [{id: 'trial', label: '航線試算 · 預覽機'}] : [])];
    resourceSelect.replaceChildren(...items.map(resource => {
      const option = document.createElement('option'); option.value = resource.id; option.textContent = resource.label; return option;
    }));
    resourceSelect.value = cameraMode.resourceId;
  }
  function build(payload) {
    releaseChildren(); init = payload;
    updateTargets();
    const unique = new Set();
    for (const movement of payload.movements) {
      const key = `${movement.mode}:${movement.fromSiteId}:${movement.toSiteId}`;
      if (unique.has(key)) continue;
      unique.add(key);
      const path = [];
      for (let i = 0; i < movement.path.length - 1; i++) {
        const a = movement.path[i], b = movement.path[i + 1];
        const count = movement.mode === 'air' ? 1 : Math.max(1, Math.ceil(Math.hypot(b.lat - a.lat, b.lng - a.lng) * 111000 / 80));
        for (let j = 0; j < count; j++) path.push(position({lat: a.lat + (b.lat-a.lat)*j/count, lng: a.lng+(b.lng-a.lng)*j/count}, movement.mode === 'air'));
      }
      path.push(position(movement.path.at(-1), movement.mode === 'air'));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path),
        new THREE.LineBasicMaterial({color: movement.mode === 'air' ? '#67e4dc' : COLORS[movement.resourceId], depthTest: false, transparent: true, opacity: .8}));
      line.name = `daily-path-${movement.id}`; line.renderOrder = 25; root.add(line);
    }
    for (const site of payload.sites) {
      const caption = label(site.label, '#8bafc2');
      caption.name = `daily-site-${site.id}`;
      caption.position.copy(position(site)); caption.position.z += 20; root.add(caption);
    }
    for (const resource of payload.resources) makeActor(resource);
    overview(false);
  }
  function overview(notify = true) {
    if (!init) return;
    setCamera({...cameraMode, mode: 'free'}, notify);
    const points = init.sites.map(site => position(site));
    const box = new THREE.Box3().setFromPoints(points), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const tangent = Math.tan(api.camera.fov * Math.PI / 360) / api.camera.zoom;
    const aspect = Math.max(.3, innerWidth / innerHeight);
    const phone = window.parent.innerWidth < 768;
    const insetY = Math.max(.25, (innerHeight - (phone ? 300 : 90)) / innerHeight);
    const insetX = Math.max(.3, (innerWidth - 70) / innerWidth);
    const distance = Math.max(size.y / (2 * tangent * insetY), size.x / (2 * tangent * aspect * insetX), 2500) * 1.1;
    api.setCameraPose([center.x, center.y - distance * .08, center.z + distance], center.toArray());
    scale();
  }
  function focus({resourceId, siteId, trial}) {
    // A programmatic focus is already retained by the bridge for reload. Do not
    // echo a free-camera event here and erase that target.
    setCamera({mode: 'free', resourceId: trial ? 'trial' : resourceId ?? cameraMode.resourceId}, false);
    if (trial) {
      frameTrial(); return;
    }
    const actor = actors.get(resourceId), site = init?.sites.find(item => item.id === siteId);
    const p = site ? position(site) : actor?.group.position;
    if (!p) return;
    const distance = !site && actor.resource.type === 'drone' ? 4500 : 1700;
    api.setCameraPose([p.x, p.y - distance * .4, p.z + distance], p.toArray());
    scale();
  }
  function heading(id, timeMin, point) {
    const movements = init?.movements.filter(item => item.resourceId === id && item.startMin <= timeMin) ?? [];
    const movement = movements.find(item => item.endMin >= timeMin) ?? movements.at(-1);
    if (!movement) return 0;
    let best = Infinity, angle = 0;
    for (let i = 0; i < movement.path.length - 1; i++) {
      const a = position(movement.path[i]), b = position(movement.path[i+1]);
      const dx = b.x - a.x, dy = b.y - a.y, squared = dx*dx + dy*dy;
      if (!squared) continue;
      const t = Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy)/squared));
      const distance = (point.x-a.x-dx*t)**2 + (point.y-a.y-dy*t)**2;
      if (distance < best) { best = distance; angle = Math.atan2(dx, dy); }
    }
    return angle;
  }
  function setCamera(value, notify = false) {
    if (!['free', 'follow', 'tail'].includes(value.mode)) return;
    if (value.mode !== cameraMode.mode || value.resourceId !== cameraMode.resourceId) followCamera.reset();
    if (value.mode !== 'free') pendingTrialFrame = false;
    cameraMode = {...value}; resourceSelect.value = value.resourceId;
    for (const button of tools.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === value.mode));
    if (notify) emit('daily:camera', cameraMode);
    moveCamera();
  }
  function moveCamera(delta = 0) {
    if (cameraMode.mode === 'free' || !snapshot) return;
    const target = cameraMode.resourceId === 'trial' ? trialActor?.drone : actors.get(cameraMode.resourceId)?.group;
    if (!target) return;
    const angle = cameraMode.resourceId === 'trial' ? trialActor.progress?.headingRad : actors.get(cameraMode.resourceId).headingRad;
    if (!Number.isFinite(angle)) return;
    // A 5 m van clips through the viewer's 10 m near plane in the drone's
    // 12 m tail view. Keep the whole vehicle visible without changing drone UX.
    const framing = actors.get(cameraMode.resourceId)?.resource.type === 'van' ? {behind:18, above:6} : undefined;
    try { followCamera.sync(target.position, angle, delta, cameraMode.mode, framing); }
    catch (error) { setCamera({...cameraMode, mode: 'free'}, true); emit('daily:error', {message:error.message}); }
  }
  function clearTrial() {
    trialActor?.dispose(); pendingTrialFrame = false;
    trialRoot.clear(); delete trialRoot.userData.trialState; trialActor = null;
  }
  function setTrial(value) {
    clearTrial(); trialPlan = value;
    updateTargets();
    if (!value) { if (cameraMode.resourceId === 'trial') setCamera({mode:'free',resourceId:'D-01'}, true); return; }
    const actor = new RouteActor(api, value.itinerary, 'daily-trial', {
      label: '航線試算 · 預覽機', entity: {id:'daily-trial-drone',label:'航線試算 · 預覽機',type:'drone'},
    });
    trialActor = actor;
    actor.load().then(() => {
      if (disposed || trialActor !== actor) { actor.dispose(); return; }
      trialRoot.add(actor.root);
      actor.root.traverse(object => { object.renderOrder = 35; });
      updateTrial();
      if (pendingTrialFrame) frameTrial();
      moveCamera(); scale();
    }).catch(error => {
      actor.dispose();
      if (!disposed && trialActor === actor) emit('daily:error', {message:`試算模型：${error.message}`});
    });
  }
  function frameTrial() {
    if (!trialPlan || cameraMode.mode !== 'free') return;
    pendingTrialFrame = !trialActor?.drone;
    if (!pendingTrialFrame) { trialActor.frameRoute(innerWidth, innerHeight); scale(); }
  }
  function updateTrial() {
    if (!trialActor?.drone || !snapshot) return;
    const pose = trialActor.sync(snapshot.timeMin / 60, 0, cameraMode.mode === 'tail' && cameraMode.resourceId === 'trial');
    trialActor.progress = pose;
    trialRoot.userData.trialState = {timeMin:snapshot.timeMin, phase:pose.phase, lat:pose.lat, lng:pose.lng};
  }
  function scale() {
    if (!api.camera) return;
    api.camera.updateMatrixWorld();
    for (const {visual, caption, resource} of actors.values()) {
      const tail = cameraMode.mode === 'tail' && cameraMode.resourceId === resource.id;
      caption.position.set(0, 0, visual.resize(tail) * 1.2);
    }
    updateTrial();
    const occupied = [];
    for (const {sprite, kind, aspect} of [...labels].sort((a,b) => (a.kind !== 'site' ? 0 : 1) - (b.kind !== 'site' ? 0 : 1))) {
      const world = sprite.getWorldPosition(new THREE.Vector3());
      const projection = world.clone().project(api.camera), depth = -world.applyMatrix4(api.camera.matrixWorldInverse).z;
      const height = labelWorldHeight(depth, api.camera.fov, innerHeight, kind === 'resource' ? 22 : 18);
      sprite.scale.set(height * aspect, height, 1);
      const x = (projection.x + 1) * innerWidth / 2, y = (1 - projection.y) * innerHeight / 2;
      const near = occupied.some(rect => Math.abs(rect.x - x) < 160 && Math.abs(rect.y - y) < 23);
      sprite.visible = depth > 0 && Math.abs(projection.x) < 1.1 && Math.abs(projection.y) < 1.1 && (kind !== 'site' || !near);
      if (sprite.visible) occupied.push({x, y});
    }
    if (cameraMode.mode === 'tail') {
      const actor = actors.get(cameraMode.resourceId);
      if (actor) actor.caption.visible = false;
    }
  }
  function update(payload) {
    snapshot = payload;
    for (const resource of payload.resources) {
      const actor = actors.get(resource.id);
      if (!actor) continue;
      actor.group.position.copy(position(resource.position, resource.type === 'drone' && resource.status === 'moving'));
      if (resource.type === 'van' || resource.status !== 'moving') actor.group.position.z -= 4;
      actor.headingRad = heading(resource.id, payload.timeMin, actor.group.position);
      actor.visual.sync(actor.group.position, actor.headingRad, 0, cameraMode.mode === 'tail' && cameraMode.resourceId === resource.id);
      turnWheels(actor, payload.timeMin);
      actor.group.userData.dailyState = {id: resource.id, timeMin: payload.timeMin, status: resource.status, lat: resource.position.lat, lng: resource.position.lng};
    }
    updateTrial(); hazard.setTime(payload.timeMin); moveCamera();
    scale(); emit('daily:rendered', {timeMin: payload.timeMin, runId: payload.runId});
  }
  off.push(api.onAppCommand((name, payload) => {
    try {
      if (name === 'daily:hello') emit('twin:ready', {daily: true});
      if (name === 'daily:init') build(payload);
      if (name === 'daily:snapshot') update(payload);
      if (name === 'daily:focus') focus(payload);
      if (name === 'daily:overview') overview(false);
      if (name === 'daily:trial') setTrial(payload);
      if (name === 'daily:frame-trial') frameTrial();
      if (name === 'daily:options') {
        hazardToggle.checked = payload.hazardVisible; hazard.setVisible(payload.hazardVisible);
        setCamera(payload.camera);
      }
    } catch (error) { emit('daily:error', {message: error.message}); }
  }));
  off.push(api.onFrame(now => {
    const delta = lastFrame === null ? 0 : Math.max(0, now - lastFrame); lastFrame = now;
    for (const actor of actors.values()) actor.visual?.animate(delta);
    trialActor?.visual?.animate(delta);
    moveCamera(delta); scale();
  }));
  const cleanup = () => {
    if (disposed) return;
    disposed = true; for (const unsubscribe of off) unsubscribe();
    hazard.dispose(); clearTrial(); trialRoot.removeFromParent();
    releaseChildren(); root.removeFromParent(); viewStyle.remove(); creditStyle.remove(); creditHost.remove(); tools.remove();
    for (const {object, original} of originalLabels) { object.material.dispose(); object.material = original; }
    snapshot = init = null;
  };
  api.onDispose(cleanup);
  emit('twin:ready', {daily: true});
  return cleanup;
}
