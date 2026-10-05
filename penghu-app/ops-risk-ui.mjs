import {DEFAULT_RISK, normalizeRisk} from './risk-scenario.mjs';
import {applyRiskPatch as checkedApply, validateRiskPatch as checkPatch} from './ops-ai.mjs';
import {STAGE_GUST_SENTENCE, STAGE_GUST_HELPER} from './ops-stage.mjs';

const clone = value => structuredClone(value);
const nodeList = world => Array.isArray(world) ? world : world?.nodes ?? [];

/** A patch replaces supplied risk fields; unknown fields and nodes are refused. */
export function validateRiskPatch(input, world) {
  const checked = checkPatch(input, nodeList(world));
  if (!checked.valid) throw new Error(checked.errors_zh.join(' '));
  return checked.patch;
}

export function applyRiskPatch(risk, patch, world) {
  return checkedApply(risk, patch, nodeList(world));
}

const timeLabel = hour => {
  const minute = Math.round(hour * 60);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};
const timeValue = value => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) return NaN;
  const [hour, minute] = value.split(':').map(Number);
  return hour + minute / 60;
};
const eventFieldValue = (key, value) => key === 'fromH' || key === 'toH' ? timeLabel(value) : String(value);
const el = (tag, className = '', content) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (content != null) result.textContent = String(content);
  return result;
};
const button = caption => { const result = el('button', '', caption); result.type = 'button'; return result; };

export function riskSummary(risk, world) {
  const nodes = nodeList(world), parts = [];
  if (risk.windMultiplier !== 1) parts.push(`全域風速 ×${risk.windMultiplier}`);
  if (risk.safetyLimit !== 1) parts.push(`安全門檻 ${risk.safetyLimit}`);
  for (const event of risk.events) {
    const name = nodes.find(node => node.id === event.nodeId)?.label ?? event.nodeId;
    parts.push(`${name} 半徑 ${event.radiusKm} km ${timeLabel(event.fromH)}–${timeLabel(event.toH)} ${event.kind === 'gust' ? `風速 ×${event.multiplier}` : '禁飛'}`);
  }
  return parts.join('；') || '風速 ×1.0，安全門檻 1.0，無局部事件';
}

function changedFields(before, after) {
  const changes = new Set();
  for (const key of ['windMultiplier', 'safetyLimit']) if (before[key] !== after[key]) changes.add(key);
  if (JSON.stringify(before.events) !== JSON.stringify(after.events)) changes.add('events');
  for (let i = 0; i < after.events.length; i++) {
    for (const key of ['kind', 'nodeId', 'radiusKm', 'fromH', 'toH', 'multiplier']) {
      if (before.events[i]?.[key] !== after.events[i][key]) changes.add(`events.${i}.${key}`);
    }
  }
  return changes;
}

const STYLE = `
.ops-risk-panel{padding:0;color:#d9eeee;font:12px/1.45 system-ui,sans-serif;display:grid;gap:4px}
.ops-risk-panel p{margin:0}.ops-risk-panel button{min-height:30px;font-size:11px}
.ops-risk-panel input,.ops-risk-panel select,.ops-risk-panel textarea{box-sizing:border-box;width:100%;min-width:0;font:12px system-ui,sans-serif}
.ops-risk-panel input[type=range]{accent-color:#67d4c7;min-height:25px}.ops-risk-panel textarea{resize:vertical;height:40px;min-height:40px;padding:5px;background:#0c2531;border:1px solid #426a71;border-radius:7px;color:#e3eeee}
.ops-risk-field{display:grid;gap:3px;min-width:0;color:#b2d1d4;font-size:11px;padding:3px;border-radius:4px}
.ops-risk-field input:not([type=range]),.ops-risk-field select{min-height:25px}
.ops-risk-field.changed{background:#345249;outline:1px solid #e5cb75}.ops-risk-field.changed>span{color:#ffe6a0}
.ops-risk-row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;padding:5px;border:1px solid #365e66;border-radius:6px;background:#102e39}.ops-risk-row>.ops-risk-field:first-of-type{grid-column:span 2}
.ops-risk-events{display:grid;gap:7px}.ops-risk-events.changed{outline:1px solid #e5cb75;border-radius:6px}.ops-risk-event-heading{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:8px}
.ops-risk-event-heading strong{font-size:12px}.ops-risk-actions{display:flex;flex-wrap:wrap;gap:6px}
.ops-risk-ai{border-bottom:1px solid #365e66;padding-bottom:5px;display:grid;gap:2px}.ops-risk-summary{color:#dcefd9;font-size:12px;overflow-wrap:anywhere}.ops-risk-summary:not(:empty){background:#223d35;border-left:3px solid #e5cb75;padding:5px 7px;border-radius:4px}
.ops-risk-status{color:#afced1;font-size:11px}.ops-risk-status[data-error=true]{color:#ffc0ba}.ops-risk-chip{font-size:10px;color:#d9e5b5;background:#304238;border-radius:10px;padding:3px 7px;width:fit-content}
.ops-risk-knobs{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end}.ops-risk-ai .ops-primary{min-height:40px;padding:7px 18px;font-size:15px;font-weight:750;background:#66d6c6;color:#07322d;border-color:#8beadd}.ops-risk-ai .ops-risk-actions{align-items:center}.ops-risk-chip{max-width:100%;overflow-wrap:anywhere}.ops-risk-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.ops-risk-heading strong{font-size:12px}.ops-risk-ai .ops-risk-preset{font-size:11px;min-height:27px;padding:3px 9px;border-radius:14px}
@media(max-width:767px){.ops-risk-row{grid-template-columns:1fr 1fr}.ops-risk-row>.ops-risk-field:first-of-type{grid-column:auto}.ops-risk-knobs{grid-template-columns:1fr}.ops-risk-panel textarea{min-height:65px}}
`;

/** Dependency-injected view. onRiskChange owns persistence and other consumers. */
export function renderRiskScenario({container, state, world, onRiskChange = () => {}, proposeRiskPatch}) {
  const readState = () => typeof state === 'function' ? state() : state?.get ? state.get() : state;
  let current = normalizeRisk(readState()?.risk ?? DEFAULT_RISK), undoRisk = null, disposed = false, busy = false, lastApplied = null;
  let changed = new Set();
  const root = el('section', 'ops-risk-panel'), style = el('style'); style.textContent = STYLE;
  const wind = el('input'); wind.type = 'range'; wind.min = '.5'; wind.max = '2'; wind.step = '.05';
  const safety = el('input'); safety.type = 'range'; safety.min = '.6'; safety.max = '1.2'; safety.step = '.01';
  const label = (name, control, path) => {
    const wrapper = el('label', 'ops-risk-field'); wrapper.dataset.riskField = path;
    wrapper.classList.toggle('changed', changed.has(path));
    wrapper.append(el('span', '', name), control); control.setAttribute('aria-label', name); return wrapper;
  };
  const windLabel = label('全域風速 ×1.00', wind, 'windMultiplier');
  const safetyLabel = label('安全門檻 1.00', safety, 'safetyLimit');
  const events = el('div', 'ops-risk-events');
  const addGust = button('＋強風區'), addNofly = button('＋禁飛區'), reset = button('重設');
  const actions = el('div', 'ops-risk-actions'); actions.append(addGust, addNofly, reset);
  const ai = el('section', 'ops-risk-ai');
  const sentence = el('textarea'); sentence.placeholder = STAGE_GUST_SENTENCE; sentence.setAttribute('aria-label', '用一句話描述狀況');
  const gustPreset = button('用範例'); gustPreset.className = 'ops-risk-preset';
  gustPreset.title = STAGE_GUST_SENTENCE;
  gustPreset.addEventListener('click', () => { sentence.value = STAGE_GUST_SENTENCE; sentence.focus(); });
  const apply = button('AI 設定'), undo = button('復原'); undo.hidden = true;
  apply.className = 'ops-primary';
  const aiActions = el('div', 'ops-risk-actions');
  const chip = el('span', 'ops-risk-chip');
  const updateMode = () => {
    const mode = readState()?.ai?.mode;
    chip.textContent = mode === 'rule' ? '規則排程（非 AI）' : mode === 'live' ? '即時 AI' : mode === 'replay' ? '示範回放' : 'AI · 自動選擇';
    chip.hidden = false;
  };
  updateMode(); aiActions.append(gustPreset, apply, chip, undo);
  const summary = el('p', 'ops-risk-summary'); summary.setAttribute('aria-live', 'polite');
  const status = el('p', 'ops-risk-status'); status.setAttribute('role', 'status');
  const heading = el('div', 'ops-risk-heading'); heading.append(el('strong', '', '用一句話描述狀況'));
  ai.append(heading, sentence, el('p', 'ops-risk-status', STAGE_GUST_HELPER), aiActions, summary, status);
  const knobs = el('div', 'ops-risk-knobs'); knobs.append(windLabel, safetyLabel, actions);
  root.append(style, el('p', 'daily-control-note', '調整天氣與管制，看風險場、航線與方案驗證如何改變'), ai, knobs, events); container.append(root);

  const report = (message, error = false) => { status.textContent = message; status.dataset.error = String(error); };
  const persist = (next, source = 'knob') => {
    current = normalizeRisk(next);
    if (source !== 'ai') { changed.clear(); undoRisk = null; undo.hidden = true; summary.textContent = ''; updateMode(); }
    paint(); onRiskChange(clone(current), {source});
  };
  const eventChange = (index, key, value) => {
    const patch = clone(current);
    patch.events[index][key] = value;
    try { validateRiskPatch(patch, world); report(''); persist(patch); return true; }
    catch (error) { report(error.message, true); return false; }
  };
  const paint = () => {
    wind.value = current.windMultiplier; safety.value = current.safetyLimit;
    const windCaption = `全域風速 ×${current.windMultiplier.toFixed(2)}`;
    const safetyCaption = `安全門檻 ${current.safetyLimit.toFixed(2)}`;
    windLabel.firstElementChild.textContent = windCaption; wind.setAttribute('aria-label', windCaption);
    safetyLabel.firstElementChild.textContent = safetyCaption; safety.setAttribute('aria-label', safetyCaption);
    for (const [key, wrapper] of [['windMultiplier', windLabel], ['safetyLimit', safetyLabel]]) wrapper.classList.toggle('changed', changed.has(key));
    events.replaceChildren();
    events.classList.toggle('changed', changed.has('events'));
    if (!current.events.length) events.append(el('p', 'ops-risk-status', '尚無局部事件'));
    current.events.forEach((event, index) => {
      const row = el('div', 'ops-risk-row'), heading = el('div', 'ops-risk-event-heading');
      const remove = button('刪除'); remove.setAttribute('aria-label', `刪除事件 ${index + 1}`);
      remove.addEventListener('click', () => { const next = clone(current); next.events.splice(index, 1); persist(next); });
      heading.append(el('strong', '', `${index + 1}. ${event.kind === 'gust' ? '強風區' : '禁飛區'}`), remove); row.append(heading);
      const place = el('select');
      for (const node of nodeList(world)) { const option = el('option', '', node.label ?? node.name ?? node.id); option.value = node.id; place.append(option); }
      place.value = event.nodeId; place.addEventListener('change', () => eventChange(index, 'nodeId', place.value));
      row.append(label('中心起降點', place, `events.${index}.nodeId`));
      for (const [key, caption, type] of [['radiusKm', '半徑（km）', 'number'], ['fromH', '開始時間', 'text'], ['toH', '結束時間', 'text'],
        ...(event.kind === 'gust' ? [['multiplier', '局部風速倍率', 'number']] : [])]) {
        const control = el('input'); control.type = type;
        if (type === 'number') { control.min = '.1'; control.step = '.1'; control.value = event[key]; }
        else { control.value = timeLabel(event[key]); control.placeholder = '09:00'; control.inputMode = 'numeric'; }
        control.addEventListener('change', () => {
          const previous = current.events[index]?.[key];
          if (control.value.trim() === '') { control.value = eventFieldValue(key, previous); return; }
          const value = type === 'number' ? Number(control.value) : timeValue(control.value);
          if (!Number.isFinite(value) || !eventChange(index, key, value)) {
            control.value = eventFieldValue(key, current.events[index]?.[key]);
          }
        });
        row.append(label(caption, control, `events.${index}.${key}`));
      }
      events.append(row);
    });
  };
  for (const [control, key] of [[wind, 'windMultiplier'], [safety, 'safetyLimit']]) {
    control.addEventListener('input', () => persist({...current, [key]: Number(control.value)}));
  }
  const addEvent = kind => {
    const nodes = nodeList(world), nodeId = nodes.find(node => node.id === 'N02')?.id ?? nodes[0]?.id;
    if (!nodeId) { report('起降點資料尚未就緒。', true); return; }
    persist({...current, events: [...current.events, {kind, nodeId, radiusKm: 8, fromH: 9, toH: 12,
      ...(kind === 'gust' ? {multiplier: 1.8} : {})}]});
  };
  addGust.addEventListener('click', () => addEvent('gust')); addNofly.addEventListener('click', () => addEvent('nofly'));
  reset.addEventListener('click', () => { report('風險情境已重設。'); persist(DEFAULT_RISK, 'reset'); });
  undo.addEventListener('click', () => {
    if (!undoRisk) return;
    const previous = undoRisk; persist(previous, 'undo'); report('已復原上一個 AI 設定。');
  });
  apply.addEventListener('click', async () => {
    if (busy || !sentence.value.trim()) { if (!busy) report('請先描述狀況。', true); return; }
    if (typeof proposeRiskPatch !== 'function') { report('AI 風險設定尚未就緒。', true); return; }
    // Same sentence, scenario still carries its result: nothing to redo, keep the chip and summary.
    if (lastApplied && lastApplied.sentence === sentence.value.trim() && lastApplied.risk === JSON.stringify(current)) { report('已套用。'); return; }
    busy = true; apply.disabled = true; updateMode(); report('正在理解情境…');
    const before = clone(current);
    try {
      const result = await proposeRiskPatch({sentence: sentence.value.trim(), risk: clone(before), world});
      if (disposed) return;
      // A manual edit made during the request must not be overwritten.
      if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error('等待期間情境已變更，請再套用一次。');
      const patch = result?.patch ?? result;
      const next = applyRiskPatch(before, patch, world);
      undoRisk = before; changed = changedFields(before, next); undo.hidden = false;
      persist(next, 'ai'); lastApplied = {sentence: sentence.value.trim(), risk: JSON.stringify(current)};
      const mode = result?.modeChip ?? result?.modeLabel ?? result?.chip;
      chip.textContent = typeof mode === 'string' ? mode : mode?.label ?? ''; chip.hidden = !chip.textContent;
      summary.textContent = `${result.mode === 'rule' ? '規則已設定' : 'AI 已設定'}：${riskSummary(next, world)}`; report('設定已套用，風險場與航線試算已更新。');
    } catch (error) { if (!disposed) report(error.message || String(error), true); }
    finally { if (!disposed) { busy = false; apply.disabled = false; } }
  });
  paint();
  const stopState = state?.subscribe?.(updateMode);
  return {root, update(risk) { current = normalizeRisk(risk); paint(); }, dispose() { disposed = true; stopState?.(); root.remove(); }};
}

export function createRiskScenarioPanel(options) {
  return {
    id: 'riskScenario', title: '風險情境', icon: '◈', defaultSize: {w: 3, h: 9}, streams: [],
    render(container) { return renderRiskScenario({...options, container}); }, update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'risk-scenario', summary: '全域風速、局部事件與安全門檻。'}; },
    dispose(view) { view.dispose(); },
  };
}
