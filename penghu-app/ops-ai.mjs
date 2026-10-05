import { evaluatePlan } from './ops-engine.mjs';
import { proposeRulePlan } from './ops-rule-planner.mjs';
import { normalizeRisk, deriveRiskField } from './risk-scenario.mjs';
import { plan as planRoute } from './planner.mjs';
import {AIRCRAFT_SPEC} from './aircraft-spec.mjs';

export const AI_TIMEOUT_MS = 90_000;
export const RULE_MODE_LABEL = '規則排程（非 AI）';
let requestQueue = Promise.resolve();
let replayPromise;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Canonical JSON, independent of object insertion order. Array order is meaningful. */
export function normalizedJSON(value) {
  if (Array.isArray(value)) return `[${value.map(normalizedJSON).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${normalizedJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function replayHash(kind, inputs) {
  const text = normalizedJSON({ kind, inputs });
  let hash = 14695981039346656037n;
  for (let i = 0; i < text.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 1099511628211n);
  return `ops-replay-v1-${hash.toString(16).padStart(16, '0')}`;
}

export function lookupReplay(replay, kind, inputs) {
  const entry = replay?.[replayHash(kind, inputs)];
  return object(entry) && entry.response !== undefined && typeof entry.model === 'string'
    && typeof entry.recordedAt === 'string' ? entry : null;
}

function matchingReplay(replay, prompt) {
  const entry = lookupReplay(replay, prompt.kind, prompt.inputs);
  if (entry?.request?.messages && normalizedJSON(entry.request.messages) !== normalizedJSON(prompt.messages)) return null;
  return entry;
}

export async function loadReplay(fetchImpl = globalThis.fetch) {
  if (!replayPromise) replayPromise = Promise.resolve().then(async () => {
    const response = await fetchImpl(new URL('./data/ai-replay.json', import.meta.url));
    if (!response.ok) return {};
    const data = await response.json();
    return object(data) ? data : {};
  }).catch(() => ({}));
  return replayPromise;
}

/** Extract a JSON object from plain replies, fences or prose, respecting escaped strings. */
export function extractJSON(reply) {
  if (object(reply)) {
    if (reply.choices) return extractJSON(reply.choices[0]?.message?.content);
    if (typeof reply.content === 'string') return extractJSON(reply.content);
    return structuredClone(reply);
  }
  if (typeof reply !== 'string') throw new Error('模型未回傳 JSON 物件。');
  // Some compatible models include a reasoning block despite disabled thinking.
  const source = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try { const parsed = JSON.parse(source); if (object(parsed)) return parsed; } catch { /* Scan below. */ }
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < source.length; end++) {
      const char = source[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { const parsed = JSON.parse(source.slice(start, end + 1)); if (object(parsed)) return parsed; } catch { /* Try next opening brace. */ }
        break;
      }
    }
  }
  throw new Error('模型回覆沒有可解析的 JSON 物件。');
}

/** All browser model calls share one queue, including connection probes. */
function queued(task) {
  const result = requestQueue.then(task);
  requestQueue = result.catch(() => {});
  return result;
}

export function createOpenAIProvider(ai, { fetchImpl = globalThis.fetch, timeoutMs = AI_TIMEOUT_MS } = {}) {
  const baseUrl = String(ai?.baseUrl ?? '').trim().replace(/\/+$/, '');
  const model = String(ai?.model ?? '').trim();
  if (!baseUrl || !model) throw new Error('請在設定填入模型網址與模型名稱。');
  const url = new URL(`${baseUrl}/chat/completions`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模型網址必須使用 http 或 https。');
  let supportsJSON = true;
  let supportsThinkingOption = true;
  const provider = ({ messages }) => queued(async () => {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { reject(new Error(`模型連線逾時（${Math.round(timeoutMs / 1000)} 秒）。`)); controller.abort(); }, timeoutMs);
    });
    const operation = async () => {
      const headers = { 'Content-Type': 'application/json' };
      if (ai.apiKey?.trim()) headers.Authorization = `Bearer ${ai.apiKey.trim()}`;
      const send = async withFormat => {
        const response = await fetchImpl(url, { method: 'POST', headers, signal: controller.signal,
          body: JSON.stringify({ model, messages, stream: false,
            ...(withFormat ? { response_format: { type: 'json_object' } } : {}),
            ...(supportsThinkingOption ? { chat_template_kwargs: { enable_thinking: ai.enableThinking === true } } : {}) }) });
        const body = await response.text();
        return { response, body };
      };
      let result = await send(supportsJSON);
      // Strict compatible endpoints can reject optional extension fields. Send
      // them first, then omit only the specifically rejected option.
      for (let retry = 0; retry < 2 && [400, 422].includes(result.response.status); retry++) {
        if (supportsThinkingOption && /chat_template_kwargs|enable_thinking/i.test(result.body)) supportsThinkingOption = false;
        else if (supportsJSON && /response[_ ]format|json[_ ]object|json mode/i.test(result.body)) supportsJSON = false;
        else break;
        result = await send(supportsJSON);
      }
      if (!result.response.ok) throw new Error(`模型連線失敗（HTTP ${result.response.status}）。`);
      let payload;
      try { payload = JSON.parse(result.body); } catch { throw new Error('模型端點未回傳有效的 API JSON。'); }
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' && !object(content)) throw new Error('模型端點回覆缺少 message.content。');
      return content;
    };
    try { return await Promise.race([operation(), timeout]); } finally { clearTimeout(timer); }
  });
  provider.model = model;
  return provider;
}

export async function testConnection(ai, options) {
  const provider = createOpenAIProvider(ai, options);
  const reply = await provider({ messages: [{ role: 'system', content: 'Reply only with a JSON object.' },
    { role: 'user', content: 'Return {"ok":true}.' }], kind: 'probe' });
  const result = extractJSON(reply);
  if (result.ok !== true) throw new Error('模型已回覆，但 JSON 連線測試未通過。');
  return { ok: true, model: provider.model, message_zh: `連線成功：${provider.model}` };
}

const sortedById = values => [...values].sort((a, b) => compare(a.id, b.id));
const riskContext = risk => {
  const result = normalizeRisk(risk);
  result.events.sort((a, b) => compare(normalizedJSON(a), normalizedJSON(b)));
  return result;
};
const nodeContext = nodes => sortedById(nodes).map(node => ({ id: node.id, name: node.label ?? node.name,
  island: node.island, droneServable: node.droneServable, lat: node.lat, lng: node.lng }));

const routeHintCache = new WeakMap();
function routeHints(state, world, field) {
  if (!field) return [];
  const drones = sortedById(state.vehicles).filter(vehicle => vehicle.type === 'drone');
  if (!drones.length) return [];
  const orders = sortedById(state.orders);
  const key = normalizedJSON({risk: riskContext(state.risk), orders: orders.map(order => order.destinationNodeId),
    nodes: world.pads, stock: world.stock.nodeId, releaseMin: world.stock.releaseMin,
    endMin: world.endMin, durations: world.fixture.plan.durationsMin});
  let cache = routeHintCache.get(field);
  if (!cache) { cache = new Map(); routeHintCache.set(field, cache); }
  if (!cache.has(key)) {
    const riskField = {...deriveRiskField(field, state.risk, world.nodes), padDistances: undefined};
    const origin = world.nodes.find(node => node.id === world.stock.nodeId);
    const destinations = [...new Set(orders.map(order => order.destinationNodeId))];
    const hints = destinations.map(to => {
      const destination = world.nodes.find(node => node.id === to);
      if (!destination) return {from: origin.id, to, status: 'failed', reason_zh: '目的地不存在。'};
      const crossIsland = origin.island !== destination.island;
      const service = world.fixture.plan.durationsMin;
      const earliestRequestMin = world.stock.releaseMin + (crossIsland ? service.packQimei + service.loadQimei
        : service.packMagong + service.loadMagong);
      const route = planRoute(riskField, world.pads, origin.id, to, earliestRequestMin / 60,
        Math.min(world.endMin / 60, earliestRequestMin / 60 + field.C.HORIZON_H));
      return {from: origin.id, to, earliestRequestMin, status: route.status,
        ...(route.status === 'ok' ? {departMin: route.depart_h * 60, arriveMin: route.arrive_h * 60,
          delayMin: route.delay_min, waits: route.waits, rationale_zh: route.rationale_zh}
          : {reason_zh: route.reason_zh})};
    });
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(key, hints);
  }
  return drones.flatMap(drone => cache.get(key).map(hint => ({droneId: drone.id, ...hint})));
}

export function buildSchedulePrompt({ state, world, field }) {
  const inputs = structuredClone({ nodes: nodeContext(world.nodes), orders: sortedById(state.orders), vehicles: sortedById(state.vehicles),
    stock: world.stock, perDose: world.perDose, startMin: world.startMin, endMin: world.endMin,
    durationsMin: world.fixture.plan.durationsMin, risk: riskContext(state.risk),
    weatherTimeline: {baked: world.weatherTimeline ?? [], windMultiplier: state.risk.windMultiplier,
      userEvents: riskContext(state.risk).events},
    weatherContext: world.weatherContext,
    routeHints: routeHints(state, world, field),
    droneCapabilities: sortedById(state.vehicles).filter(vehicle => vehicle.type === 'drone').map(vehicle => ({
      id: vehicle.id, enduranceMin: field?.C?.ENDURANCE_MIN ?? AIRCRAFT_SPEC.enduranceMin, cruiseKph: (field?.C?.CRUISE_MS ?? AIRCRAFT_SPEC.cruiseMs) * 3.6,
      initialEnergyWh: vehicle.energyWh, reserveWh: vehicle.reserveWh,
      usableEnergyWh: vehicle.energyWh - vehicle.reserveWh, travelWhPerKm: vehicle.profile.travelWhPerKm,
      idleW: vehicle.profile.idleW, handlingW: vehicle.profile.handlingW, movingW: vehicle.profile.movingW,
    })) });
  const messages = [{ role: 'system', content: [
    '你是澎湖疫苗配送排程助理。只回覆 JSON 物件，不要宣稱通過驗證；數位孿生引擎會獨立驗證。',
    '格式：{"assignments":[{"orderId":"訂單ID","legs":[{"vehicleId":"運具ID","from":"節點ID","to":"節點ID","departAfterMin":540}]}],"notes_zh":"簡短繁體中文說明"}。departAfterMin 可省略。',
    '每個訂單恰好一次，一段只承載一筆訂單；第一段從 stock.nodeId 出發，後段從前段終點交接，末段抵達目的地。',
    '引擎依 assignments 順序排程，遵守批次放行、打包、裝載、交接、收貨、車輛空車調度與可用時間。',
    '配送車只能同島道路；無人機可以直接飛到節點表中的任何節點，包含衛生所、冷庫，droneServable 是建議轉運屬性，不是禁飛限制。末段可直接飛到訂單 destinationNodeId，省去接駁與交接。',
    'N15 與 qimei-clinic 是不同節點；訂單若目的地是 qimei-clinic，飛到 N15 後仍須補一段到 qimei-clinic，或直接飛到 qimei-clinic。',
    '無人機使用安全航線、單段 enduranceMin 續航與風險門檻，最後嘗試返航。droneCapabilities 給出各機可用 energyWh-reserveWh、每公里 travelWhPerKm 與待機/移動功率；空機調度也耗能源，不能只算載貨航段。',
    '必須守期限、收貨時窗、全程 2–8°C、保留電量、質量及體積容量與庫存；允許 departAfterMin 等待風險回落。',
    'departAfterMin 是該航段最早可出發的當日分鐘（09:00=540、10:30=630），引擎會在此前完成裝載/交接；不是飛行分鐘數。可讓貨件留在冷庫或冷藏車等風險回落，再交給無人機，避免在被動保冷箱內長時間等待。',
    '風險 danger=(風速/12)^2；windMultiplier 與 gust 乘數會疊加，nofly 的時間與半徑內禁止飛行。時鐘使用當日分鐘。',
    'weatherTimeline 包含基準風場強風時段及增量與使用者事件；使用者陣風結束不代表基準風險已回落。routeHints 是放行及打包裝載後，由同一航線規劃器選出的安全直飛時間（搜尋範圍受當日及規劃 horizon 限制），未計空機調度、共用運具、能源或冷鏈，不能當成方案通過證明；延後 departAfterMin 可能錯過強風前的可飛窗口。',
    'weatherContext 的日期與風速來自冬季統計校準的合成情境，非單日實測；基準風向北北東–東北、10 m 風速。午後增強設定幅度見 weatherTimeline.ampMs；兩端漸變在三小時脈衝內重疊，實際峰值增量為設定幅度的 75%。依實際 weatherTimeline、routeHints 與引擎判定。',
    '若無可行方案，可以在 notes_zh 明說不可行，指出不足的具體資源及可解決方法，例如新增哪個基地的無人機、增加多少能源、延後到何時；仍給最合理的完整指派供引擎判定，不能虛構已有運具或通過結果。',
  ].join('\n') }, { role: 'user', content: normalizedJSON(inputs) }];
  return { kind: 'schedule', inputs, messages };
}

export function buildRiskPrompt({ sentence, risk, nodes }) {
  const inputs = { promptVersion: 3, sentence: String(sentence).trim(), risk: riskContext(risk), nodes: nodeContext(nodes) };
  return { kind: 'risk', inputs, messages: [{ role: 'system', content: [
    '將使用者描述轉成澎湖風險情境修正。只回覆 JSON，不得宣稱驗證成功。',
    '格式：{"patch":{"windMultiplier":1,"events":[{"kind":"gust","nodeId":"有效節點ID","radiusKm":1,"fromH":7,"toH":10,"multiplier":1.25}],"safetyLimit":1},"summary_zh":"一行繁體中文摘要"}。',
    'patch 可以省略未改欄位；events 如果提供會取代全部事件，因此保留既有且未要求移除的事件。',
    'windMultiplier 限 0.5–2，safetyLimit 限 0.6–1.2。kind 只允許 gust 或 nofly；半徑正數公里，0≤fromH<toH≤24；gust multiplier 必須正數，nofly 不含 multiplier。',
    '只使用節點表 ID；上午九點到十二點是 9–12，上午九點到十點半是 9–10.5；七美泛指事件使用 qimei-transfer 作為中心。使用者指定半徑時以指定數值為準，未指定則半徑 1 公里。未指定強度的局部強風可用 multiplier 1.25，避免超出觀測範圍。',
    '本例為 2027-01-13 冬季東北季風合成情境，10 m 基礎風速 10.9 m/s，15–18 時增強設定 +5 m/s；2 小時漸變重疊後，實際背景峰值增量為 +3.75 m/s。使用者事件是 what-if，非單日觀測；指定風速乘數時忠實採用。範例局部強風的強度須維持在 CODiS 七美逐時風速 p99 約 17.6 m/s 的觀測範圍內。',
  ].join('\n') }, { role: 'user', content: normalizedJSON(inputs) }] };
}

export function validateRiskPatch(value, nodes = []) {
  const patch = object(value?.patch) ? value.patch : value;
  const errors_zh = [];
  const allowed = new Set(['windMultiplier', 'events', 'safetyLimit']);
  if (!object(patch) || !Object.keys(patch).length) return { valid: false, patch: null, errors_zh: ['風險修正必須是非空物件。'] };
  if (Object.keys(patch).some(key => !allowed.has(key))) errors_zh.push('風險修正含未支援的欄位。');
  for (const [key, low, high] of [['windMultiplier', .5, 2], ['safetyLimit', .6, 1.2]])
    if (Object.hasOwn(patch, key) && (!finite(patch[key]) || patch[key] < low || patch[key] > high))
      errors_zh.push(`${key} 必須介於 ${low} 與 ${high}。`);
  if (Object.hasOwn(patch, 'events')) {
    if (!Array.isArray(patch.events)) errors_zh.push('events 必須是陣列。');
    else for (const [index, event] of patch.events.entries()) {
      const keys = ['kind', 'nodeId', 'radiusKm', 'fromH', 'toH', ...(event?.kind === 'gust' ? ['multiplier'] : [])];
      if (!object(event) || Object.keys(event).some(key => !keys.includes(key))
        || !['gust', 'nofly'].includes(event.kind) || !nodes.some(node => node.id === event.nodeId)
        || !finite(event.radiusKm) || event.radiusKm <= 0 || !finite(event.fromH) || !finite(event.toH)
        || event.fromH < 0 || event.toH > 24 || event.fromH >= event.toH
        || (event.kind === 'gust' && (!finite(event.multiplier) || event.multiplier <= 0)))
        errors_zh.push(`事件 ${index + 1} 的類型、節點、半徑、時段或乘數無效。`);
    }
  }
  return { valid: !errors_zh.length, patch: errors_zh.length ? null : structuredClone(patch), errors_zh };
}

export function applyRiskPatch(risk, patch, nodes) {
  const checked = validateRiskPatch(patch, nodes);
  if (!checked.valid) throw new Error(checked.errors_zh.join(' '));
  return normalizeRisk({ ...normalizeRisk(risk), ...checked.patch });
}

const failureContext = evaluation => ({
  orders: (evaluation.orders ?? []).filter(order => !order.pass).map(order => {
    const input = evaluation.run?.fixture?.orders?.find(item => item.id === (order.orderId ?? order.id));
    return { orderId: order.orderId ?? order.id, reasons_zh: order.reasons_zh,
      arrivalMin: order.deliveredAtMin ?? null, deadlineMin: input?.deadlineMin, receivingWindow: input?.receivingWindow,
      lateByMin: input && order.deliveredAtMin != null ? Math.max(0, order.deliveredAtMin - input.deadlineMin) : null,
      minTemperatureC: order.minTemperatureC, maxTemperatureC: order.maxTemperatureC,
      temperatureBoundsC: evaluation.run?._bounds ?? [2, 8], excursionMinutes: order.excursionMinutes,
      legs: order.legs?.map(leg => ({ vehicleId: leg.vehicleId, from: leg.from, to: leg.to,
        departAfterMin: leg.departAfterMin, departMin: leg.departMin, arriveMin: leg.arriveMin,
        plannerDelayMin: leg.planner?.delay_min, waits: leg.planner?.waits,
        rationale_zh: leg.planner?.rationale_zh, maxRisk: leg.planner?.max_cell_total })) };
  }),
  vehicles: (evaluation.vehicles ?? []).map(vehicle => ({ id: vehicle.id, reasons_zh: vehicle.reasons_zh,
    energyWh: vehicle.energyWh, reserveWh: vehicle.reserveWh,
    reserveShortfallWh: finite(vehicle.energyWh) && finite(vehicle.reserveWh) ? Math.max(0, vehicle.reserveWh - vehicle.energyWh) : undefined })),
  errors_zh: evaluation.validation?.errors_zh ?? [],
});

/** The same bounded loop is used by the browser and replay recorder. */
export async function verifyAndRepair({ prompt, provider, evaluate, maxRepairs = 2,
  onProgress = () => {}, progressLabel = '', stepDelayMs = 0 }) {
  const messages = structuredClone(prompt.messages);
  const limit = Number.isFinite(maxRepairs) ? Math.max(0, Math.min(2, Math.floor(maxRepairs))) : 2;
  let plan = null, evaluation, response, parseError;
  const replies = [];
  const step = async event => {
    onProgress({...event, modeLabel: progressLabel});
    // Yield before provider work or synchronous routing so the view can paint.
    await new Promise(resolve => setTimeout(resolve, stepDelayMs));
  };
  for (let attempt = 0; attempt <= limit; attempt++) {
    await step({phase: 'proposing', attempt});
    response = await provider({ kind: prompt.kind, messages: structuredClone(messages) });
    replies.push(response);
    parseError = null;
    try { const decoded = extractJSON(response); plan = decoded.plan ?? decoded; }
    catch (error) { plan = null; parseError = error.message; }
    await step({phase: 'validating', attempt});
    evaluation = await evaluate(plan);
    if (evaluation.allPass || attempt === limit) {
      onProgress({phase: 'complete', attempt, allPass: evaluation.allPass, modeLabel: progressLabel});
      return { plan, evaluation, run: evaluation.run ?? null,
        response, replies, repairs: attempt, ...(parseError ? { error_zh: parseError } : {}) };
    }
    const failedCount = (evaluation.orders ?? []).filter(order => !order.pass)
      .reduce((sum, order) => sum + Math.max(1, order.reasons_zh?.length ?? 0), 0);
    await step({phase: 'repairing', attempt, failedCount});
    messages.push({ role: 'assistant', content: typeof response === 'string' ? response : JSON.stringify(response) },
      { role: 'user', content: `數位孿生未通過。請修正並只回覆完整方案 JSON：${normalizedJSON({ ...failureContext(evaluation), ...(parseError ? { parseError } : {}) })}` });
  }
}

function selectedMode(ai = {}, provider) {
  const mode = ai.mode ?? 'auto';
  if (['rule', 'rules'].includes(mode)) return 'rule';
  if (mode === 'replay') return 'replay';
  if (['live', 'model'].includes(mode)) return 'live';
  return provider || (ai.baseUrl?.trim() && ai.model?.trim()) ? 'live' : 'replay';
}
export function modeLabel(mode, model = '', recordedAt = '') {
  if (mode === 'live') return `即時模型：${model}`;
  if (mode === 'replay') return `示範回放（錄製自 ${model}，${recordedAt.slice(0, 10)}）`;
  return RULE_MODE_LABEL;
}

export async function schedule({ state, world, field, planner, evaluator, replay, provider,
  onProgress = () => {}, replayDelayMs = 650 }) {
  const prompt = buildSchedulePrompt({ state, world, field });
  const evaluate = evaluator ?? planner?.evaluatePlan ?? evaluatePlan;
  const check = plan => evaluate(plan, state, world, field);
  const mode = selectedMode(state.ai, provider);
  if (mode === 'live') {
    const liveProvider = provider ?? createOpenAIProvider(state.ai);
    const model = liveProvider.model ?? state.ai?.model ?? '';
    const result = await verifyAndRepair({ prompt, provider: liveProvider, evaluate: check,
      onProgress, progressLabel: modeLabel('live', model) });
    return { ...result, mode: 'live', model, modeLabel: modeLabel('live', model), request: prompt.inputs };
  }
  if (mode === 'replay') {
    const entry = matchingReplay(replay ?? await loadReplay(), prompt);
    if (entry) {
      // Preserve the real reply sequence. Final-only legacy entries have one
      // proposal; they cannot recreate repairs that were never recorded.
      const replies = Array.isArray(entry.replies) && entry.replies.length ? entry.replies.slice(0, 3) : [entry.response];
      let index = 0;
      const label = modeLabel('replay', entry.model, entry.recordedAt);
      const result = await verifyAndRepair({prompt, provider: async () => replies[index++], evaluate: check,
        maxRepairs: replies.length - 1, onProgress, progressLabel: label, stepDelayMs: replayDelayMs});
      return { ...result, mode: 'replay', model: entry.model, recordedRepairs: entry.repairs ?? null,
        recordedAt: entry.recordedAt, modeLabel: label, request: prompt.inputs };
    }
  }
  onProgress({phase: 'proposing', attempt: 0, modeLabel: RULE_MODE_LABEL});
  await new Promise(resolve => setTimeout(resolve, 0));
  const plan = proposeRulePlan(state, world);
  onProgress({phase: 'validating', attempt: 0, modeLabel: RULE_MODE_LABEL});
  await new Promise(resolve => setTimeout(resolve, 0));
  const evaluation = await check(plan);
  onProgress({phase: 'complete', attempt: 0, allPass: evaluation.allPass, modeLabel: RULE_MODE_LABEL});
  return { plan, evaluation, run: evaluation.run ?? null, mode: 'rule', modeLabel: RULE_MODE_LABEL, repairs: 0,
    request: prompt.inputs, ...(mode === 'replay' ? { note_zh: '沒有相符的示範回放，使用規則排程。' } : {}) };
}

/** Small deterministic sentence helper, always labelled non-AI when no replay exists. */
export function proposeRuleRiskPatch(sentence, risk, nodes) {
  if (/重設|還原預設/.test(sentence)) return { patch: { windMultiplier: 1, events: [], safetyLimit: 1 } };
  const selected = nodes.filter(node => String(sentence).includes(node.name ?? node.label) || String(sentence).includes(node.island))
    .sort((a, b) => Number(b.kind === 'mock-transfer') - Number(a.kind === 'mock-transfer') || compare(a.id, b.id))[0];
  if (!selected || !/風|禁飛/.test(sentence)) throw new Error('規則模式請描述地點、強風或禁飛；也可在設定連接模型。');
  const chineseHours = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  const hours = [...String(sentence).matchAll(/(十二|十一|十|[一二三四五六七八九]|\d{1,2})(?:[點点時时]|:00)(半)?/g)]
    .map(match => (chineseHours[match[1]] ?? Number(match[1])) + (match[2] ? .5 : 0));
  const afternoon = /下午/.test(sentence);
  const fromH = hours.length ? hours[0] + (afternoon && hours[0] < 12 ? 12 : 0) : 9;
  const toH = hours.length > 1 ? hours[1] + (afternoon && hours[1] < 12 ? 12 : 0) : 12;
  const radiusKm = Number(String(sentence).match(/(\d+(?:\.\d+)?)\s*(?:km|公里)/i)?.[1] ?? 8);
  const multiplier = Number(String(sentence).match(/(?:×|x|風速\s*)\s*(\d+(?:\.\d+)?)/i)?.[1] ?? 1.8);
  const kind = /禁飛/.test(sentence) ? 'nofly' : 'gust';
  return { patch: { events: [...normalizeRisk(risk).events, { kind, nodeId: selected.id, radiusKm, fromH, toH,
    ...(kind === 'gust' ? { multiplier } : {}) }] } };
}

export async function proposeRiskPatch({ sentence, risk, nodes, ai, state, world, replay, provider }) {
  risk ??= state?.risk;
  nodes ??= world?.nodes ?? [];
  ai ??= state?.ai ?? {};
  const prompt = buildRiskPrompt({ sentence, risk, nodes });
  let result, model = '', recordedAt = '', mode = selectedMode(ai, provider);
  if (mode === 'live') {
    const liveProvider = provider ?? createOpenAIProvider(ai);
    model = liveProvider.model ?? ai.model ?? '';
    result = extractJSON(await liveProvider({ kind: prompt.kind, messages: prompt.messages }));
  } else {
    const entry = mode === 'replay' ? matchingReplay(replay ?? await loadReplay(), prompt) : null;
    if (entry) { result = extractJSON(entry.response); model = entry.model; recordedAt = entry.recordedAt; }
    else {
      if (mode === 'replay' && !(ai.baseUrl?.trim() && ai.model?.trim()))
        throw new Error('此句沒有示範回放；請設定 AI 模型或使用範例');
      mode = 'rule'; result = proposeRuleRiskPatch(prompt.inputs.sentence, risk, nodes);
    }
  }
  const checked = validateRiskPatch(result, nodes);
  if (!checked.valid) throw new Error(checked.errors_zh.join(' '));
  const updated = applyRiskPatch(risk, checked.patch, nodes);
  const changedKeys = Object.keys(checked.patch).filter(key => normalizedJSON(normalizeRisk(risk)[key]) !== normalizedJSON(updated[key]));
  // Derive the visible summary from the checked patch rather than untrusted model claims.
  const events = checked.patch.events ?? [];
  const event = events.at(-1), node = nodes.find(item => item.id === event?.nodeId);
  const summary_zh = event ? `${node?.label ?? node?.name ?? event.nodeId} 半徑 ${event.radiusKm} km ${event.fromH}:00–${event.toH}:00 ${event.kind === 'nofly' ? '禁飛' : `風速 ×${event.multiplier}`}`
    : changedKeys.map(key => `${key === 'windMultiplier' ? '全域風速' : key === 'safetyLimit' ? '安全門檻' : '事件'} ${key === 'events' ? '已重設' : checked.patch[key]}`).join('、') || '情境沒有變更';
  return { patch: checked.patch, risk: updated, changedKeys, summary_zh, mode, model, recordedAt,
    modeLabel: modeLabel(mode, model, recordedAt), request: prompt.inputs };
}
