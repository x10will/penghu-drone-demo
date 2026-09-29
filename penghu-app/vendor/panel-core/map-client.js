// packages/core/src/map-protocol.js
var CHANNEL = "panel-core.map";
var COMMANDS = ["flyTo", "highlight", "setLayers", "setTime", "setTheme", "appCommand"];
var object = (p) => p !== null && typeof p === "object" && !Array.isArray(p);
var entity = (p) => object(p) && typeof p.id === "string" && typeof p.label === "string";
var strings = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
var appMessage = (p) => {
  if (typeof p.name !== "string" || !p.name.length || p.name.length > 64 || !Object.hasOwn(p, "payload")) return false;
  try {
    structuredClone(p.payload);
    return true;
  } catch {
    return false;
  }
};
function command(type, p) {
  if (!object(p)) return false;
  if (type === "flyTo") return typeof p.target === "string" || object(p.target) && (typeof p.target.id === "string" || Number.isFinite(p.target.lon) && Math.abs(p.target.lon) <= 180 && Number.isFinite(p.target.lat) && Math.abs(p.target.lat) <= 90 && (p.target.alt === void 0 || Number.isFinite(p.target.alt)));
  if (type === "highlight") return strings(p.ids);
  if (type === "setLayers") return strings(p.layers);
  if (type === "setTime") return Number.isFinite(p.t);
  if (type === "setTheme") return typeof p.theme === "string";
  if (type === "appCommand") return appMessage(p);
  return false;
}
function event(type, p) {
  if (!object(p)) return false;
  return type === "ready" ? strings(p.capabilities) : ["select", "hover"].includes(type) ? p.entity === null || entity(p.entity) : type === "time" ? Number.isFinite(p.t) : type === "appEvent" ? appMessage(p) : type === "viewChanged" && Object.hasOwn(p, "view");
}
var message = (type, payload) => ({ channel: CHANNEL, version: 1, type, payload });

// packages/core/src/map-client.js
function createMapClient({ handlers = {} } = {}) {
  const target = window.parent, embedded = target !== window, origin = location.origin, pending = /* @__PURE__ */ new Map();
  const capabilities = COMMANDS.filter((type) => typeof handlers[type] === "function");
  let localReady = false, known = false, destroyed = false, info = {};
  function post(type, payload) {
    if (embedded && !destroyed) target.postMessage(message(type, payload), origin);
  }
  function announce() {
    if (!localReady || !embedded || destroyed) return;
    post("ready", { ...info, capabilities });
    if (known) {
      for (const [type, payload] of pending) post(type, payload);
      pending.clear();
    }
  }
  function receive(e) {
    const m = e.data;
    if (destroyed || !embedded || e.source !== target || e.origin !== origin || m?.channel !== CHANNEL || m.version !== 1 || !object(m.payload)) return;
    if (m.type === "hello") {
      known = true;
      announce();
      return;
    }
    if (localReady && capabilities.includes(m.type) && command(m.type, m.payload)) {
      if (m.type === "appCommand") handlers.appCommand(m.payload.name, m.payload.payload);
      else handlers[m.type](m.payload);
    }
  }
  window.addEventListener("message", receive);
  function send(type, payload) {
    if (destroyed || !event(type, payload)) return false;
    let copy;
    try {
      copy = structuredClone(payload);
    } catch {
      return false;
    }
    if (localReady && known && embedded) post(type, copy);
    else pending.set(type, copy);
    return true;
  }
  return {
    ready(description = {}) {
      if (destroyed || !object(description)) return;
      try {
        info = structuredClone(description);
      } catch {
        return;
      }
      localReady = true;
      announce();
    },
    select: (entity2) => send("select", { entity: entity2 }),
    hover: (entity2) => send("hover", { entity: entity2 }),
    time: (t) => send("time", { t }),
    viewChanged: (view) => send("viewChanged", { view }),
    appEvent: (name, payload) => send("appEvent", { name, payload }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("message", receive);
      pending.clear();
    }
  };
}
export {
  createMapClient
};
