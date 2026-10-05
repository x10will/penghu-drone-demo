import {createDefaultState} from './ops-world.mjs';

export const OPS_STORAGE_KEY = 'penghu-ops-v2';
let memory = null;
const failedWrites = new WeakSet();
const clone = value => structuredClone(value);
function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
function normalized(value) {
  if (!value || !Array.isArray(value.orders) || !Array.isArray(value.vehicles)
    || !value.risk || !Array.isArray(value.risk.events) || !value.ai) return null;
  if (value.adopted && (!value.adopted.plan || !value.adopted.run)) return null;
  return {...value, ai: {...createDefaultState().ai, mode: 'auto', ...value.ai, enableThinking: false}};
}
export function loadOpsState(storage = browserStorage()) {
  if (storage && failedWrites.has(storage) && memory) return clone(memory);
  try {
    const raw = storage?.getItem(OPS_STORAGE_KEY);
    if (raw) {
      const state = normalized(JSON.parse(raw));
      if (state) { memory = clone(state); return clone(state); }
    }
  } catch { /* Private browsing, quota, or damaged JSON: retain this session. */ }
  return clone(memory ?? {...createDefaultState(), ai: {...createDefaultState().ai, mode: 'auto'}});
}
export function saveOpsState(state, storage = browserStorage()) {
  memory = clone(state);
  try {
    storage?.setItem(OPS_STORAGE_KEY, JSON.stringify(state));
    if (storage) failedWrites.delete(storage);
  } catch { if (storage) failedWrites.add(storage); /* Memory remains authoritative. */ }
  return clone(state);
}
export function resetOpsState(storage = browserStorage()) {
  return saveOpsState({...createDefaultState(), ai: {...createDefaultState().ai, mode: 'auto'}}, storage);
}
export function createOpsStore(storage = browserStorage()) {
  let state = loadOpsState(storage);
  const listeners = new Set();
  return {
    get: () => state,
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    set(next) {
      state = saveOpsState(typeof next === 'function' ? next(state) : {...state, ...next}, storage);
      for (const fn of listeners) fn(state);
      return state;
    },
    reset() { state = resetOpsState(storage); for (const fn of listeners) fn(state); return state; },
  };
}
