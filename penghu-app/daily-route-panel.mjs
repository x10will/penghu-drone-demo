import {aircraftReference} from './data-sources.mjs';
import {loadField, plan, label} from './planner.mjs';
import {delayWording, itinerarySummary, makeItinerary, poseAt, returnRequest, riskAt, safetyCost, TURNAROUND_MIN} from './timeline.mjs';
import {DEFAULT_RISK, deriveRiskField, normalizeRisk} from './risk-scenario.mjs';

const META_URL = new URL('../data/danger_frames/danger_meta.json', import.meta.url);
const FIELD_URL = new URL('../data/danger_frames/router_field.bin', import.meta.url);
const EPS_MIN = 1e-6;
// The same Magong–Qimei direction as D-01, with a verified same-day return.
export const DEFAULT_TRIAL_REQUEST = Object.freeze({
  fromId: 'N04', toId: 'N05', earliest: '09:00', latest: '10:00', roundtrip: true,
});
const PHASE = {
  'origin-hold': '地面待命（等待風險回落）', 'pad-wait': '地面停等',
  'turnaround-hold': '地面待命（折返整備）', airborne: '模擬飛行 · 100 m ASL', arrived: '已抵達',
};
const HOLD_PHASES = new Set(['origin-hold', 'pad-wait', 'turnaround-hold']);

const el = (tag, className = '', value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
};
const hours = value => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  const [h, m] = value.split(':').map(Number);
  return h + m / 60;
};
const refused = (reason_zh, outbound = null) => ({status: 'refused', reason_zh, outbound});

// This is also usable without the DOM for a direct check against the real field.
// The caller keeps only an accepted itinerary in the daily store.
export function calculateTrial({field, meta, request, startMin, endMin, risk, nodes}) {
  if (risk) field = deriveRiskField(field, risk, nodes ?? meta.pads, meta.pads);
  const {fromId, toId, earliest, latest, roundtrip} = request;
  const earlyH = hours(earliest), lateH = hours(latest);
  if (!Number.isFinite(earlyH) || !Number.isFinite(lateH)) return refused('請輸入有效的起飛時間。');
  if (!meta.pads.some(p => p.id === fromId) || !meta.pads.some(p => p.id === toId)) return refused('請選擇有效的起降點。');
  if (fromId === toId) return refused('起點與目的地不能相同。');
  if (earlyH > lateH) return refused('最晚起飛時間不能早於最早起飛時間。');
  if (earlyH * 60 < startMin - EPS_MIN || lateH * 60 > endMin + EPS_MIN) {
    return refused(`今日配送時鐘為 ${label(startMin / 60)}–${label(endMin / 60)}；請將起飛時間設在此範圍內。`);
  }

  const outbound = plan(field, meta.pads, fromId, toId, earlyH, lateH);
  if (outbound.status !== 'ok') return refused(outbound.reason_zh);
  if (outbound.arrive_h * 60 > endMin + EPS_MIN) {
    return refused(`出程預計 ${outbound.arrive_label} 抵達，已超過今日 ${label(endMin / 60)} 的試算時鐘。`, outbound);
  }

  let back = null, returnReason_zh = null;
  if (roundtrip) {
    const returnFields = returnRequest(outbound);
    if (!returnFields || hours(returnFields.depart_earliest) * 60 > endMin + EPS_MIN) {
      returnReason_zh = `出程抵達後須整備至少 ${TURNAROUND_MIN} 分鐘，無法在今日 ${label(endMin / 60)} 前起飛返程。`;
    } else {
      // The original helper has a 23:00 bound; this workspace ends at 18:00.
      const candidate = plan(field, meta.pads, returnFields.from_node, returnFields.to_node,
        hours(returnFields.depart_earliest), endMin / 60);
      if (candidate.status !== 'ok') returnReason_zh = `回程無安全航線：${candidate.reason_zh}`;
      else if (candidate.arrive_h * 60 > endMin + EPS_MIN) {
        returnReason_zh = `回程預計 ${candidate.arrive_label} 抵達，已超過今日 ${label(endMin / 60)} 的試算時鐘。`;
      } else back = candidate;
    }
  }

  return {status: 'ok', itinerary: makeItinerary(outbound, back), pads: meta.pads,
    safetyLimit: field.C?.SAFETY_LIMIT ?? meta.safety_limit, riskHash: field.riskHash,
    request: {...request}, returnReason_zh};
}

function addRoute(parent, route, heading, safetyLimit) {
  const section = el('section', 'trial-route');
  section.append(el('h3', '', `${heading} · ${route.depart_label} 出發 → ${route.arrive_label} 抵達`));
  const facts = el('dl', 'trial-facts');
  const cost = safetyCost(route, safetyLimit);
  for (const [name, value] of [
    ['延後起飛', delayWording(route.delay_min).row], ['途中停等', `${route.waited_min} 分鐘`],
    ['本程風險', route.total_risk.toFixed(4)],
    ['最大單格風險', `${route.max_cell_total.toFixed(3)}／門檻 ${safetyLimit}`],
    ['安全繞行與停等', `理想直飛 ${cost.directMin} 分鐘 → 實際 ${cost.actualMin} 分鐘（增加 ${cost.extraMin} 分鐘）`],
    ['門檻餘裕', cost.slack.toFixed(2)],
  ]) {
    facts.append(el('dt', '', name), el('dd', '', value));
  }
  section.append(facts);
  const legs = el('ol', 'trial-legs');
  for (const leg of route.legs) {
    legs.append(el('li', '', `${leg.from_name} → ${leg.to_name} · ${label(leg.t0_h)}–${label(leg.t1_h)} · 風險 ${leg.risk.toFixed(4)}`));
  }
  section.append(el('h4', '', '航段'), legs);
  if (route.waits.length) {
    const waits = el('ul', 'trial-waits');
    for (const wait of route.waits) waits.append(el('li', '', `${wait.name} · ${label(wait.t0_h)}–${label(wait.t1_h)} · ${wait.minutes} 分鐘`));
    section.append(el('h4', '', '途中停等'), waits);
  }
  section.append(el('p', 'trial-rationale', route.rationale_zh));
  parent.append(section);
}

export function createTrialPlanner({run, store, actions, risk = DEFAULT_RISK, world = null, compactResults = false}) {
  let scenario = normalizeRisk(risk), scenarioNodes = world?.nodes ?? [];
  const riskViews = new Set();
  return {
    id: 'trialPlanner', title: '航線試算', icon: '◇', defaultSize: {w: 4, h: 7}, streams: [],
    setRisk(nextRisk, nodesOrWorld = scenarioNodes) {
      scenario = normalizeRisk(nextRisk);
      scenarioNodes = Array.isArray(nodesOrWorld) ? nodesOrWorld : nodesOrWorld?.nodes ?? [];
      for (const apply of riskViews) apply();
    },
    render(container) {
      const root = el('section', 'daily-trial-panel');
      const intro = el('p', 'trial-intro', '試算不會改動今日配送計畫');
      const mockNote = el('p', 'trial-mock-note', '依模擬風險場資料試算；結果僅供情境展示。');
      const form = el('form', 'trial-form');
      const from = el('select'), to = el('select');
      from.setAttribute('aria-label', '起點起降點');
      to.setAttribute('aria-label', '目的地起降點');
      from.required = to.required = true;
      from.disabled = to.disabled = true;
      const earliest = el('input'), latest = el('input');
      for (const input of [earliest, latest]) { input.type = 'time'; input.required = true; input.step = 60; }
      earliest.value = DEFAULT_TRIAL_REQUEST.earliest; latest.value = DEFAULT_TRIAL_REQUEST.latest;
      earliest.setAttribute('aria-label', '最早起飛時間');
      latest.setAttribute('aria-label', '最晚起飛時間');
      const roundtrip = el('input');
      roundtrip.type = 'checkbox'; roundtrip.checked = DEFAULT_TRIAL_REQUEST.roundtrip;
      roundtrip.setAttribute('aria-label', '試算同日往返');
      const labelled = (title, control) => { const wrapper = el('label', 'trial-field'); wrapper.append(el('span', '', title), control); return wrapper; };
      const roundtripLabel = el('label', 'trial-check');
      roundtripLabel.append(roundtrip, el('span', '', '同日往返（含 30 分鐘整備；18:00 前抵達）'));
      const submit = el('button', 'trial-submit', '規劃航線');
      submit.type = 'submit'; submit.disabled = true;
      form.append(labelled('起點', from), labelled('目的地', to),
        labelled('最早起飛', earliest), labelled('最晚起飛', latest), roundtripLabel, submit);
      const status = el('p', 'trial-status', '載入模擬風險場…');
      status.setAttribute('role', 'status');
      const clock = el('output', 'trial-clock');
      clock.setAttribute('aria-label', '今日試算時鐘');
      const live = el('output', 'trial-live');
      live.setAttribute('aria-label', '試算飛行狀態');
      const controls = el('div', 'trial-controls');
      const start = el('button', '', '查看試算起飛時刻');
      const fly = el('button', '', '模擬飛行');
      const replay = el('button', '', '重播試算飛行');
      const clear = el('button', '', '清除試算');
      start.type = fly.type = replay.type = clear.type = 'button';
      start.disabled = fly.disabled = replay.disabled = clear.disabled = true;
      controls.append(start, fly, replay, clear);
      const result = el('div', 'trial-result');
      result.setAttribute('aria-live', 'polite');
      const resultDetails = el('details', 'trial-result-details');
      resultDetails.open = !compactResults;
      resultDetails.append(el('summary', '', '航線結果詳情'), result);
      root.append(intro, mockNote, el('p', 'daily-aircraft-reference', aircraftReference(world?.meta, run.fixture)), form, status, clock, live, controls, resultDetails);
      container.append(root);

      const initial = store.get().trialPlan;
      if (initial?.request) {
        earliest.value = initial.request.earliest;
        latest.value = initial.request.latest;
        roundtrip.checked = initial.request.roundtrip;
      }
      let disposed = false, ready = false, busy = false, sequence = 0, timer = null;
      let field = null, baseField = null, meta = null, localMessage = '', localOutbound = null;
      let lastRequest = initial?.request ?? null;
      let loadError = '';
      let displayedPlan = undefined, displayedMessage = undefined, displayedOutbound = undefined;
      const abort = new AbortController();
      const selectPads = pads => {
        const previousFrom = initial?.request?.fromId ?? from.value;
        const previousTo = initial?.request?.toId ?? to.value;
        for (const select of [from, to]) select.replaceChildren();
        for (const pad of pads) {
          for (const select of [from, to]) {
            const option = el('option', '', pad.name);
            option.value = pad.id;
            select.append(option);
          }
        }
        from.value = pads.some(p => p.id === previousFrom) ? previousFrom : DEFAULT_TRIAL_REQUEST.fromId;
        to.value = pads.some(p => p.id === previousTo) ? previousTo : DEFAULT_TRIAL_REQUEST.toId;
      };
      if (initial?.pads) selectPads(initial.pads);

      const planningBlock = state => {
        if (loadError) return loadError;
        if (state.mapStatus?.error) return `地圖尚未就緒：${state.mapStatus.error}`;
        if (!state.mapStatus?.ready) return '地圖載入中；就緒後可規劃。';
        if (state.hazardVisible !== false) {
          if (state.fieldStatus?.error) return `風險場尚未就緒：${state.fieldStatus.error}`;
          if (state.fieldStatus?.loading !== false || !Number.isFinite(state.fieldStatus?.timeMin)) {
            return '風險場載入中；就緒後可規劃。';
          }
        }
        return ready ? '' : '航線資料載入中；就緒後可規劃。';
      };
      const refresh = state => {
        const accepted = state.trialPlan;
        const message = accepted ? '' : localMessage;
        const blocked = planningBlock(state);
        submit.disabled = !!blocked || busy;
        start.disabled = !accepted;
        fly.disabled = replay.disabled = !accepted;
        clear.disabled = !accepted && (!localMessage || !!loadError);
        status.textContent = blocked || (busy ? '正在計算安全航線…'
          : accepted?.returnReason_zh ? `僅出程可行；回程未成立 · ${itinerarySummary(accepted.itinerary)}`
          : accepted ? `航線試算完成 · ${itinerarySummary(accepted.itinerary)}`
          : message || '選擇起降點與時間後規劃航線。');
        clock.textContent = `今日時鐘 ${label(state.snapshot.timeMin / 60)} · ${label(run.startMin / 60)}–${label(run.endMin / 60)}`;
        if (accepted !== displayedPlan || message !== displayedMessage || localOutbound !== displayedOutbound) {
          displayedPlan = accepted; displayedMessage = message; displayedOutbound = localOutbound;
          result.replaceChildren();
          if (accepted) {
            for (const [index, route] of accepted.itinerary.routes.entries()) {
              addRoute(result, route, index ? '回程' : '出程', accepted.safetyLimit);
            }
            if (accepted.itinerary.routes.length > 1) {
              result.append(el('p', 'trial-turnaround', `折返整備與地面待命 ${Math.round(accepted.itinerary.turnaround_min)} 分鐘。`));
            }
            if (accepted.returnReason_zh) result.append(el('p', 'trial-return-warning', `回程未成立；可模擬已規劃的出程。${accepted.returnReason_zh}`));
            result.append(el('p', 'trial-total', `共 ${accepted.itinerary.routes.length} 程 · 合計風險 ${accepted.itinerary.total_risk.toFixed(4)}`));
          } else if (message) {
            if (localOutbound) {
              result.append(el('p', 'trial-refusal', localOutbound.arrive_h * 60 > run.endMin
                ? '航線超出今日時鐘，未建立試算預覽。'
                : '僅出程可行；往返未成立，未建立試算預覽。'));
              addRoute(result, localOutbound, '出程', field?.C?.SAFETY_LIMIT ?? meta.safety_limit);
            }
            result.append(el('p', 'trial-refusal', message));
          }
        }
        if (accepted) {
          const pose = poseAt(accepted.itinerary, state.snapshot.timeMin / 60);
          const leg = pose?.legIndex === 1 ? '回程' : '出程';
          const risk = riskAt(accepted.itinerary, state.snapshot.timeMin / 60);
          live.textContent = `試算航線 · ${leg} · ${PHASE[pose?.phase] ?? '待命'} · 累計風險 ${risk.toFixed(4)} / ${accepted.itinerary.total_risk.toFixed(4)}${HOLD_PHASES.has(pose?.phase) ? ' · 等待不累積' : ''}`;
        } else live.textContent = '';
      };
      const stop = store.subscribe(refresh);
      const invalidate = message => {
        sequence++;
        if (timer != null) { clearTimeout(timer); timer = null; }
        busy = false;
        localMessage = message;
        localOutbound = null;
        if (store.get().trialPlan) actions.setTrialPlan(null);
        else refresh(store.get());
      };
      const requestPlan = (request, automatic = false) => {
        if (!ready || (!automatic && (planningBlock(store.get()) || busy))) return;
        invalidate('');
        lastRequest = {...request};
        busy = true;
        const current = ++sequence;
        refresh(store.get());
        // Let the loading state paint before the synchronous original A* planner runs.
        timer = setTimeout(() => {
          timer = null;
          if (disposed || current !== sequence) return;
          if (!automatic && planningBlock(store.get())) { busy = false; refresh(store.get()); return; }
          try {
            const outcome = calculateTrial({field, meta, request, startMin: run.startMin, endMin: run.endMin});
            if (disposed || current !== sequence) return;
            busy = false;
            if (outcome.status === 'ok') {
              localMessage = '';
              actions.setTrialPlan(outcome);
            } else {
              localMessage = outcome.reason_zh;
              localOutbound = outcome.outbound;
              refresh(store.get());
            }
          } catch (error) {
            if (disposed || current !== sequence) return;
            busy = false;
            localMessage = `航線試算失敗：${error.message}`;
            localOutbound = null;
            refresh(store.get());
          }
        }, 0);
      };
      const applyScenario = () => {
        if (!baseField || disposed) return;
        field = deriveRiskField(baseField, scenario, scenarioNodes.length ? scenarioNodes : meta.pads, meta.pads);
        if (lastRequest) requestPlan(lastRequest, true);
      };
      riskViews.add(applyScenario);
      for (const control of [from, to, earliest, latest, roundtrip]) {
        const changed = () => { lastRequest = null; invalidate('條件已變更；請重新規劃。'); };
        control.addEventListener('input', changed);
        control.addEventListener('change', changed);
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        requestPlan({fromId: from.value, toId: to.value,
          earliest: earliest.value, latest: latest.value, roundtrip: roundtrip.checked});
      });
      start.addEventListener('click', () => {
        const accepted = store.get().trialPlan;
        if (!accepted) return;
        actions.seekMinute(accepted.itinerary.depart_h * 60);
        actions.focusTrial?.();
      });
      fly.addEventListener('click', () => actions.playTrial?.());
      replay.addEventListener('click', () => actions.playTrial?.());
      clear.addEventListener('click', () => { lastRequest = null; invalidate(''); });

      (async () => {
        try {
          const response = await fetch(META_URL, {signal: abort.signal});
          if (!response.ok) throw new Error(`風險場資料 HTTP ${response.status}`);
          const loadedMeta = await response.json();
          if (disposed) return;
          const loadedField = await loadField(loadedMeta, FIELD_URL, {signal: abort.signal});
          if (disposed) return;
          meta = loadedMeta; baseField = loadedField; ready = true;
          applyScenario();
          selectPads(meta.pads);
          from.disabled = to.disabled = false;
          refresh(store.get());
        } catch (error) {
          if (disposed || error.name === 'AbortError') return;
          loadError = `航線資料載入失敗：${error.message}`;
          localMessage = loadError;
          refresh(store.get());
        }
      })();
      return {root, stop, abort, dispose: () => {
        disposed = true; sequence++;
        riskViews.delete(applyScenario);
        abort.abort();
        if (timer != null) clearTimeout(timer);
        stop();
      }};
    },
    update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'trial-route', visibleFields: [], summary: '模擬風險場航線試算；不改動今日配送。'}; },
    dispose(view) { view.dispose(); },
  };
}
