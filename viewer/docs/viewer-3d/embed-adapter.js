import * as THREE from 'three';
import { normalizePick, PICK_FAILED } from './embed-selection.js';
import { parseFrameMs, createFrameClock, createCanonicalEmbedClock } from './embed-time.js';
import { connectProtocol } from './embed-protocol.js';
import { createExtensions } from './embed-extensions.js';

// Entire module is loaded only by the embed=1 bootstrap.
// Capabilities and ready info are an initial-scene snapshot. Live scenario
// replacement cannot renegotiate them until the kit supports repeatable ready.
const params = new URLSearchParams(location.search);
if (params.get('embed') === '1') install();

function install() {
  let dt, map, timedMap, clock, extensions, started = false, disposed = false, resizeFrame, viewTimer, counterObserver, resizeObserver;
  const highlights = [];
  const cleanups = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    cleanups.push(() => target.removeEventListener(name, fn));
  };
  const api = window.__dtEmbed = {
    normalizePick: hit => {
      try {
        const extensionPick = extensions?.resolvePick(hit);
        if (extensionPick !== undefined) return extensionPick;
        return normalizePick(hit, { dt: window.__dt, runtime: window.smlViewerRuntime,
          site: window.DT_SITE.id, localToGeo: window.DT_localToGeo });
      } catch (error) { console.error('Embed pick normalization failed', error); return PICK_FAILED; }
    },
    destroy,
  };
  const canonicalRequested = params.get('canonical') === '1';
  const frameMs = window.DT_SITE.scenarios && !canonicalRequested ? parseFrameMs(location.search) : null;
  const handlers = { flyTo, highlight, setLayers };
  if (params.has('ext')) handlers.appCommand = (name, payload) => extensions?.command(name, payload);
  // Listen for the host's iframe-load hello while assets are still loading.
  // The client gates these handlers until ready(), so dt is not used early.
  // Capabilities are fixed at client creation. Both candidates capture hello;
  // only the one matching the landed scene is ever announced as ready.
  const connection = Promise.resolve().then(() => {
    const plainMap = connectProtocol(handlers);
    if (frameMs || canonicalRequested) timedMap = connectProtocol({ ...handlers, setTime: ({ t } = {}) => clock?.setTime(t) });
    return plainMap;
  }).catch(error => {
    api.error = `Embed client unavailable: ${error.message}`;
    console.error(api.error);
    return null;
  });
  listen(window, 'dt:select', event => { if (event.detail !== PICK_FAILED) map?.select(event.detail); });
  listen(window, 'dt:ready', start);
  listen(window, 'pagehide', event => { if (!event.persisted) destroy(); });
  // A dynamic import can finish after main's ready hook. The success marker
  // distinguishes a landed scene from main's caught-error debug API.
  if (window.__dt && document.getElementById('loading').classList.contains('done')) {
    requestAnimationFrame(start);
  }

  function objectsForId(id) {
    const authored = dt.authoredPropRegistry.get(id)?.scene;
    if (authored) return [authored];
    const context = dt.contextRegistry.get(id)?.root;
    if (context) return [context];
    const twin = dt.twinRegistry.get(id);
    if (twin) return [twin];
    const matches = [];
    dt.scene.traverse(object => {
      if (object.userData?.typedSetId === id) matches.push(object);
    });
    return matches;
  }

  function clearHighlight() {
    for (const helper of highlights.splice(0)) {
      helper.removeFromParent(); helper.geometry.dispose(); helper.material.dispose();
    }
  }

  function flyTo({ target } = {}) {
    // The vendored client also validates the legacy string form {target: "id"}.
    if (typeof target === 'string') target = { id: target };
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;
    // Client precedence (map-client.js): a string id wins and any coordinates
    // beside it are ignored; only a target without a string id is lon/lat.
    if (typeof target.id === 'string') {
      const objects = objectsForId(target.id);
      if (objects.length) frameObjects(objects);
      else if (dt.goto.edgeEntries.some(entry => entry.id === target.id)
          || window.smlViewerRuntime?.getElement(target.id)) dt.gotoTwin(target.id);
      return;
    }
    if (!Number.isFinite(target.lon) || !Number.isFinite(target.lat)
        || Math.abs(target.lon) > 180 || Math.abs(target.lat) > 90
        || (target.alt !== undefined && !Number.isFinite(target.alt))) return;
    const [x, y] = dt.geoToLocal(target.lat, target.lon);
    const z = target.alt ?? dt.terrainSampler?.(x, y);
    if (!Number.isFinite(z)) return;
    const offset = dt.camera.position.clone().sub(dt.controls.target);
    dt.flyTo({ target: [x, y, z], pos: [x + offset.x, y + offset.y, z + offset.z] });
  }

  function frameObjects(objects) {
    const box = new THREE.Box3();
    for (const object of objects) box.expandByObject(object, true);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const halfFov = Math.min(dt.camera.fov * Math.PI / 360,
      Math.atan(Math.tan(dt.camera.fov * Math.PI / 360) * dt.camera.aspect));
    const range = Math.max(80, sphere.radius * 1.3 / Math.sin(halfFov));
    const tilt = 25 * Math.PI / 180;
    const position = center.clone().add(new THREE.Vector3(0, -Math.sin(tilt) * range, Math.cos(tilt) * range));
    const ground = dt.terrainSampler?.(position.x, position.y);
    if (Number.isFinite(ground)) position.z = Math.max(position.z, ground + 10);
    dt.flyTo({ target: center.toArray(), pos: position.toArray() });
  }

  function highlight({ ids } = {}) {
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return;
    const objects = ids.flatMap(objectsForId);
    if (ids.length && !objects.length) return; // Unknown ids do not clear a known highlight.
    clearHighlight();
    for (const object of new Set(objects)) {
      const helper = new THREE.BoxHelper(object, 0xffd166);
      helper.name = 'dt-embed-highlight';
      helper.material.depthTest = false;
      helper.renderOrder = 1000;
      helper.raycast = () => {}; // Presentation only; never intercept a feature pick.
      dt.scene.add(helper); highlights.push(helper);
    }
  }

  function layers() {
    return Object.entries(dt.layers).filter(([, root]) => root?.isObject3D).map(([id, root]) => ({
      id, label: root.userData?.label || root.name || id, visible: root.visible,
    }));
  }

  function setLayers({ layers: visible } = {}) {
    if (!Array.isArray(visible) || !visible.every(id => typeof id === 'string')) return;
    const known = layers();
    if (visible.some(id => !known.some(layer => layer.id === id))) return;
    const enabled = new Set(visible);
    for (const { id } of known) dt.setLayerVisible(id, enabled.has(id));
  }

  function resize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const box = document.getElementById('canvas-container').getBoundingClientRect();
      if (box.width > 0 && box.height > 0) window.dispatchEvent(new Event('resize'));
    });
  }

  function installNavigation() {
    const nav = document.createElement('nav');
    nav.id = 'dt-embed-navigation'; nav.setAttribute('aria-label', 'Map camera controls');
    document.body.append(nav);
    const nodes = ['mobile-compass', 'btn-zoom-in', 'btn-zoom-out', 'btn-reset-view', 'viewpoints']
      .map(id => document.getElementById(id)).filter(Boolean);
    const homes = nodes.map(node => ({ node, parent: node.parentNode, next: node.nextSibling }));
    const move = () => { for (const node of nodes) if (node.parentNode !== nav) nav.append(node); };
    move();
    // The existing mobile layout moves viewpoints on breakpoint changes.
    const observer = new MutationObserver(move);
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
    cleanups.push(() => {
      observer.disconnect();
      for (const { node, parent, next } of homes) parent.insertBefore(node, next?.parentNode === parent ? next : null);
      nav.remove();
    });
  }

  async function start() {
    if (started || disposed || !window.__dt || !document.getElementById('loading').classList.contains('done')) return;
    started = true;
    dt = window.__dt;
    const counter = document.getElementById('frame-counter');
    const scrubber = document.getElementById('scrubber');
    const read = () => {
      const match = counter.textContent.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
      return { frame: match ? Math.max(0, Number(match[1]) - 1) : 0, count: match ? Number(match[2]) : 0 };
    };
    clock = (api.canonical ? createCanonicalEmbedClock(api.canonical, t => map?.time(t)) : createFrameClock({ frameMs, read,
      scrub: frame => {
        const play = document.getElementById('btn-play');
        if (play.classList.contains('active')) play.click();
        scrubber.value = frame; scrubber.dispatchEvent(new Event('input', { bubbles: true }));
      },
      emit: t => map?.time(t),
    })) || { info: () => null, observe() {}, setTime() {} };
    try {
      map = await connection;
      if (!map) return;
      if (timedMap && clock.info()) {
        map.destroy();
        map = timedMap;
      } else timedMap?.destroy();
      if (disposed) { map.destroy(); return; }
      const readyInfo = { layers: layers(), ...(clock.info() || {}) };
      let lastCounter = counter.textContent;
      counterObserver = new MutationObserver(() => {
        if (counter.textContent === lastCounter) return;
        lastCounter = counter.textContent; clock.observe();
      });
      counterObserver.observe(counter, { childList: true, characterData: true, subtree: true });
      const container = document.getElementById('canvas-container');
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      listen(document, 'visibilitychange', resize);
      listen(window, 'pageshow', resize);
      listen(container, 'pointerenter', resize);
      if (window.visualViewport) listen(window.visualViewport, 'resize', resize);
      resize();
      installNavigation();
      let lastView = '';
      viewTimer = setInterval(() => {
        const target = dt.controls.target;
        const offset = dt.camera.position.clone().sub(target);
        const range = offset.length();
        const view = { ...window.DT_localToGeo(target.x, target.y), range,
          heading: (Math.atan2(-offset.x, -offset.y) * 180 / Math.PI + 360) % 360,
          tilt: range ? Math.acos(Math.max(-1, Math.min(1, offset.z / range))) * 180 / Math.PI : 0 };
        const signature = JSON.stringify(view);
        if (signature !== lastView && Object.values(view).every(Number.isFinite)) {
          lastView = signature; map.viewChanged(view);
        }
      }, 250);
      requestAnimationFrame(() => {
        if (!disposed) {
          map.ready(readyInfo); api.ready = true;
          extensions = createExtensions({ THREE, dt, site: window.DT_SITE,
            translateCameraTarget: api.translateCameraTarget,
            setCameraPose: api.setCameraPose,
            localToGeo: window.DT_localToGeo, emit: (name, payload) => map.appEvent(name, payload) });
          extensions.load(params.getAll('ext'));
        }
      });
    } catch (error) {
      api.error = `Embed client unavailable: ${error.message}`;
      console.error(api.error);
    }
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(resizeFrame); clearInterval(viewTimer);
    counterObserver?.disconnect(); resizeObserver?.disconnect();
    for (const cleanup of cleanups.splice(0)) cleanup();
    extensions?.destroy();
    clearHighlight(); map?.destroy();
    connection.then(client => { client?.destroy(); timedMap?.destroy(); });
    if (window.__dtEmbed === api) delete window.__dtEmbed;
  }
}
