import {aircraftReference} from './data-sources.mjs';
import {minuteLabel} from './daily-panels.mjs';
import {HATCH_MARGIN} from './field-math.mjs';

const node = (tag, value, className) => {
  const el = document.createElement(tag);
  if (value) el.textContent = value;
  if (className) el.className = className;
  return el;
};

/** 視角 owns the camera controls; viewpoint presets remain inside the map. */
export function createCameraControls({run, store, actions, scenarioId = 'delivery'}) {
  return {
    id: 'cameraControls', title: '視角', icon: '◉', defaultSize: {w: 4, h: 5},
    render(container) {
      const root = node('section', null, 'daily-controls daily-camera');
      const status = node('output'); status.id = 'daily-map-status'; status.setAttribute('role', 'status');
      const clock = node('p', null, 'daily-control-time');
      const overview = node('button', '全區視角'); overview.type = 'button';
      overview.addEventListener('click', actions.overview);
      const label = node('label', '追蹤對象');
      const resource = node('select'); resource.setAttribute('aria-label', '追蹤對象');
      const trackableResources = ['monitor', 'delivery'].includes(scenarioId) ? run.fixture.resources : [];
      for (const item of trackableResources) {
        const option = node('option', item.label); option.value = item.id; resource.append(option);
      }
      label.append(resource);
      const modes = node('div', null, 'daily-control-buttons');
      const modeButtons = new Map();
      for (const [mode, caption] of [['free', '自由視角'], ['follow', '跟隨'], ['tail', '尾隨']]) {
        const button = node('button', caption); button.type = 'button';
        button.addEventListener('click', () => actions.setCamera({mode, resourceId: resource.value}));
        modes.append(button); modeButtons.set(mode, button);
      }
      resource.addEventListener('change', () => actions.setCamera({mode: store.get().camera.mode, resourceId: resource.value}));
      const note = node('p', '拖曳地圖會停止跟隨，縮放不會；尾隨時滾輪調整距離。點選事件也會停止跟隨。', 'daily-control-note');
      const modelNote = node('p', '載具動態顯示：尾隨或近距 500 m 內為模型原尺寸；概覽最寬 160 m。配送車為 5 m 長示意車型。', 'daily-control-note');
      root.append(clock, status, overview, label, modes,
        note, modelNote);
      container.append(root);
      const stop = store.subscribe(state => {
        const trialOption = resource.querySelector('option[value="trial"]');
        if (scenarioId !== 'hazard' && state.trialPlan && !trialOption) {
          const option = node('option', '試算航線無人機'); option.value = 'trial'; resource.append(option);
        } else if (!state.trialPlan && trialOption) trialOption.remove();
        clock.textContent = `${run.fixture.date} · ${minuteLabel(state.snapshot.timeMin)} · 模擬資料`;
        status.textContent = state.mapStatus.error ? `地圖：${state.mapStatus.error}` : state.mapStatus.ready ? '地圖已同步' : '地圖載入中';
        status.dataset.state = state.mapStatus.error ? 'error' : state.mapStatus.ready ? 'ready' : 'loading';
        const hasTargets = resource.options.length > 0;
        label.hidden = !hasTargets; note.hidden = !hasTargets; modelNote.hidden = !hasTargets;
        resource.value = resource.querySelector(`option[value="${state.camera.resourceId}"]`) ? state.camera.resourceId : resource.options[0]?.value ?? '';
        for (const [mode, button] of modeButtons) {
          button.hidden = mode !== 'free' && !hasTargets;
          button.disabled = mode !== 'free' && !state.mapStatus.ready;
        }
        for (const [mode, button] of modeButtons) button.setAttribute('aria-pressed', String(mode === state.camera.mode));
      });
      return {root, stop};
    },
    update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'camera', summary: 'Map camera controls only.'}; },
    dispose(view) { view.stop(); view.root.remove(); },
  };
}
/** 風險場: the synthetic hazard display. Its legend starts open in the 風險場 check. */
export function createHazardControls({store, actions, meta, fixture = {}, legendOpen = false, explanationCollapsed = false}) {
  return {
    id: 'hazardControls', title: '風險場', icon: '◐', defaultSize: {w: 4, h: 5},
    render(container) {
      const root = node('section', null, 'daily-hazard-panel');
      const hazardLabel = node('label', null, 'daily-hazard-toggle');
      const hazard = node('input'); hazard.type = 'checkbox'; hazard.setAttribute('aria-label', '顯示風險場');
      hazard.addEventListener('change', () => actions.setHazardVisible(hazard.checked));
      hazardLabel.append(hazard, node('span', '顯示風險場'));
      const fieldStatus = node('output'); fieldStatus.setAttribute('role', 'status'); fieldStatus.className = 'daily-field-status';
      const explanation = node('section', null, 'daily-hazard-explanation');
      const heading = node('div', null, 'daily-hazard-explanation-heading');
      const toggle = node('button', '收合'); toggle.type = 'button';
      const body = node('div', null, 'daily-hazard-explanation-body');
      heading.append(node('strong', '這張圖在說什麼'), toggle);
      const assumption = key => meta.assumptions.find(item => item.key === key)?.value;
      const hourLabel = hour => minuteLabel(hour * 60);
      const cellKm = (Math.sqrt(meta.cell_m[0] * meta.cell_m[1]) / 1000).toFixed(1).replace(/\.0$/, '');
      const nearClosed = (meta.scenario?.flyable_percent ?? []).filter(item => item.percent <= 3);
      const nearClosedWindow = nearClosed.length ? `${hourLabel(nearClosed[0].hour)}–${hourLabel(nearClosed.at(-1).hour)}` : '無近乎全面禁飛時段';
      const lines = [
        ['澎湖海面的無人機飛行風險地圖', `每格約 ${cellKm} 公里、每 ${meta.frame_minutes} 分鐘一張，涵蓋全天。`],
        [`風險值 ≈（風速 ÷ ${assumption('u_ref_ms')} m/s）²`, `風速 ${assumption('u_ref_ms')} m/s 時為 1.0，另加上預報不確定度（越晚的時刻越不確定）。`],
        ['顏色', '綠色低風險，黃、紅表示風險升高。風險＋不確定度超過安全門檻的海面以粉紅框標示為禁飛，航線規劃不會穿越。'],
        ['斜線', `不確定度 > ${HATCH_MARGIN}，標示校準情境中邊際分布的較高部分；純顯示門檻，不改變禁飛判定。`],
        ['今日情境', `北北東–東北風 ${assumption('base_wind_ms')} m/s（10 m），${hourLabel(assumption('surge_start_h'))} 起增強設定 +${assumption('surge_amp_ms')} m/s（漸變重疊後背景峰值增量 +${meta.scenario?.surge_peak_increment_ms ?? '未提供'} m/s）；約 ${nearClosedWindow} 海面幾乎全面禁飛（可飛格 ≤ 3%）；仍須逐條航線驗證。 [S1]`],
        ['這天算典型嗎？', meta.scenario?.typicality_note ?? '冬季外海風速經常超過作業上限；冬季統計與 2027 年 2 月抗風測試目的見來源 [S1][S7]。'],
        ...(meta.sources?.S16?.typicality_note ? [['ERA5 比對', meta.sources.S16.typicality_note]] : []),
        ['參考機型', aircraftReference(meta, fixture).replace(/^參考機型：/, '')],
        ['可調整', '在「風險情境」調整風速、強風區、禁飛區與安全門檻，會即時改變這張圖、航線試算與方案驗證。'],
        ['資料來源', `${meta.scenario?.date ?? fixture.date ?? ''} ${meta.scenario?.label ?? ''}`],
      ];
      let colorLine;
      for (const [title, value] of lines) {
        const line = node('p'); line.append(node('strong', `${title}：`), document.createTextNode(value));
        body.append(line); if (title === '顏色') colorLine = line;
      }
      let collapsed = explanationCollapsed;
      const storageKey = 'penghu-hazard-explanation-collapsed-v2';
      try { const saved = localStorage.getItem(storageKey); if (saved != null) collapsed = saved === 'true'; } catch {}
      const paintExplanation = () => {
        body.hidden = collapsed; toggle.textContent = collapsed ? '展開' : '收合';
        toggle.setAttribute('aria-expanded', String(!collapsed));
      };
      toggle.addEventListener('click', () => {
        collapsed = !collapsed; paintExplanation();
        try { localStorage.setItem(storageKey, String(collapsed)); } catch {}
      });
      paintExplanation(); explanation.append(heading, body);
      const readout = node('output', null, 'daily-hazard-readout'); readout.setAttribute('aria-live', 'polite');
      const details = node('details', null, 'daily-hazard-legend-box'); details.open = legendOpen;
      details.append(node('summary', '圖例'));
      const legend = node('div', null, 'daily-hazard-legend');
      for (const [kind, caption] of [
        ['low', '0 低風險'], ['medium', '0.5'], ['high', '1.0'], ['very-high', '>1 高風險'],
        ['blocked', '粉紅邊界：危險＋邊際 > 1.0 禁飛'],
        ['uncertain', `斜線：邊際 > ${HATCH_MARGIN}（較高部分，僅顯示）`], ['land', '淡藍：陸地／上限（透明 18%）'],
      ]) {
        const item = node('span', caption); item.dataset.kind = kind; legend.append(item);
      }
      details.append(legend);
      const toolbar = node('div', null, 'daily-hazard-toolbar'); toolbar.append(hazardLabel, fieldStatus);
      root.append(toolbar, explanation, details, readout);
      container.append(root);
      const stop = store.subscribe(state => {
        hazard.checked = state.hazardVisible;
        const field = state.fieldStatus;
        const limit = field.safetyLimit ?? assumption('safety_limit');
        colorLine.lastChild.textContent = `綠色低風險，黃、紅表示風險升高。風險＋不確定度超過安全門檻 ${Number(limit).toFixed(2)} 的海面以粉紅框標示為禁飛，航線規劃不會穿越。`;
        legend.querySelector('[data-kind=blocked]').textContent = `粉紅邊界：風險＋不確定度 > ${Number(limit).toFixed(2)} 禁飛`;
        legend.querySelector('[data-kind=uncertain]').textContent = `斜線：不確定度 > ${HATCH_MARGIN}（較高部分，僅顯示）`;
        const available = state.hazardVisible && Number.isFinite(field.noFlyCells) && !field.loading && !field.error;
        readout.textContent = available
          ? `目前時刻 ${minuteLabel(field.timeMin)}：禁飛海面 ${field.noFlyCells} 格（約 ${(field.noFlyCells * field.cellAreaKm2).toFixed(0)} km²）· 最高風險 ${field.maxDanger.toFixed(2)}`
          : `目前時刻 ${minuteLabel(state.snapshot.timeMin)}：${field.error ? '風險資料無法讀取' : !state.hazardVisible ? '風險場已隱藏（顯示後更新）' : '風險資料更新中'}`;
        fieldStatus.textContent = field.error ? `風險場：${field.error}` : !state.hazardVisible ? '風險場已隱藏' : field.loading ? '風險場載入中' : `風險場 ${minuteLabel(field.timeMin)} · ${field.noFlyCells ?? '—'} 格模型禁飛`;
        fieldStatus.dataset.state = field.error ? 'error' : field.loading ? 'loading' : 'ready';
      });
      return {root, stop};
    },
    update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'mock-hazard', summary: 'Synthetic hazard display; not observed weather or validation of the supplied daily plan.'}; },
    dispose(view) { view.stop(); view.root.remove(); },
  };
}
