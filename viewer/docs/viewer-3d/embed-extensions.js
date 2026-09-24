// Loaded only through the embed adapter. Extensions own their scene resources.
import { PICK_FAILED } from './embed-selection.js';
export function createExtensions({ THREE, dt, site, localToGeo, emit, translateCameraTarget, setCameraPose,
  importModule = url => import(url), fetchModule = url => fetch(url, { mode: 'same-origin' }) }) {
  const entries = new Set();
  const picks = new Map();
  let destroyed = false, frame;
  const report = (url, error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Viewer extension ${url}: ${message}`);
    try { emit('extension-error', { url, message }); } catch { /* Reporting cannot escape. */ }
  };
  const invoke = (entry, fn, ...args) => {
    try { Promise.resolve(fn(...args)).catch(error => report(entry.url, error)); }
    catch (error) { report(entry.url, error); }
  };
  const tick = time => {
    frame = undefined;
    if (destroyed) return;
    for (const entry of entries) for (const fn of entry.frames) invoke(entry, fn, time);
    schedule();
  };
  const schedule = () => {
    if (!destroyed && frame === undefined && [...entries].some(entry => entry.frames.size)) {
      frame = requestAnimationFrame(tick);
    }
  };
  const subscribe = (entry, set, fn) => {
    if (typeof fn !== 'function') throw new TypeError('Callback must be a function');
    if (!entry.active) return () => {};
    set.add(fn);
    return () => set.delete(fn);
  };
  const dispose = entry => {
    if (!entry.active) return;
    entry.active = false;
    entries.delete(entry);
    entry.frames.clear(); entry.commands.clear();
    for (const [object, registration] of picks) if (registration.entry === entry) picks.delete(object);
    for (const fn of entry.disposals) invoke(entry, fn);
    entry.disposals.clear();
  };
  async function loadOne(raw) {
    let url = String(raw), entry;
    try {
      const parsed = new URL(url, location.href);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== location.origin
          || parsed.username || parsed.password) throw new Error('Extension URL must be same-origin HTTP(S) without credentials');
      url = parsed.href;
      if (destroyed) return;
      entry = { url, active: true, frames: new Set(), commands: new Set(), disposals: new Set() };
      entries.add(entry);
      const response = await fetchModule(url);
      const finalUrl = new URL(response.url);
      if (!response.ok || finalUrl.origin !== location.origin || !['http:', 'https:'].includes(finalUrl.protocol)
          || finalUrl.username || finalUrl.password) throw new Error('Extension response must remain same-origin HTTP(S)');
      url = finalUrl.href;
      if (!entry.active) return;
      const module = await importModule(url);
      if (!entry.active) return;
      if (typeof module.default !== 'function') throw new TypeError('Extension must export a default setup function');
      const facade = Object.freeze({
        THREE, scene: dt.scene, camera: dt.camera, site,
        geoToLocal: (lat, lon) => dt.geoToLocal(lat, lon), localToGeo,
        sampleGround: (x, y) => dt.terrainSampler?.(x, y),
        translateCameraTarget: (dx, dy, dz) => entry.active && !destroyed
          && (translateCameraTarget?.(dx, dy, dz) ?? false),
        setCameraPose: (position, target) => entry.active && !destroyed
          && (setCameraPose?.(position, target) ?? false),
        onFrame: fn => { const off = subscribe(entry, entry.frames, fn); schedule(); return off; },
        registerPickable: (object, entity) => {
          if (!entry.active) return () => {};
          if (!object?.isObject3D || !entity || typeof entity.id !== 'string' || !entity.id
              || typeof entity.label !== 'string' || !entity.label
              || (entity.type !== undefined && typeof entity.type !== 'string')
              || (entity.properties !== undefined && (!entity.properties || typeof entity.properties !== 'object' || Array.isArray(entity.properties)))) {
            throw new TypeError('Pick registration requires Object3D and an entity with id and label');
          }
          if (picks.has(object)) throw new Error('Object is already registered');
          const registration = { entry, entity: structuredClone(entity) };
          picks.set(object, registration);
          return () => { if (picks.get(object) === registration) picks.delete(object); };
        },
        onAppCommand: fn => subscribe(entry, entry.commands, fn),
        appEvent: (name, payload) => { if (entry.active) emit(name, payload); },
        onDispose: fn => {
          if (typeof fn !== 'function') throw new TypeError('Disposal must be a function');
          if (entry.active) entry.disposals.add(fn); else invoke(entry, fn);
        },
      });
      const cleanup = await module.default(facade);
      if (cleanup !== undefined && typeof cleanup !== 'function') throw new TypeError('Setup may return only a cleanup function');
      if (cleanup) {
        if (entry.active) entry.disposals.add(cleanup); else invoke(entry, cleanup);
      }
    } catch (error) {
      report(url, error);
      if (entry) dispose(entry);
    }
  }
  return {
    load: urls => Promise.all(urls.map(loadOne)),
    resolvePick(hit) {
      for (let object = hit?.object; object; object = object.parent) {
        const registration = picks.get(object);
        if (!registration) continue;
        try {
          const entity = structuredClone(registration.entity);
          const properties = entity.properties || {};
          let { lon, lat } = properties;
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            if (!Number.isFinite(hit.point?.x) || !Number.isFinite(hit.point?.y)) return null;
            ({ lon, lat } = localToGeo(hit.point.x, hit.point.y));
            properties.positionSource = 'rendered-hit';
          } else properties.positionSource ??= 'extension';
          if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
          return { id: entity.id, name: entity.label, kind: entity.type || 'feature', properties, lon, lat };
        } catch (error) { report(registration.entry.url, error); return PICK_FAILED; }
      }
      return undefined;
    },
    command(name, payload) {
      for (const entry of entries) for (const fn of entry.commands) invoke(entry, fn, name, payload);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const entry of [...entries]) dispose(entry);
    },
  };
}

