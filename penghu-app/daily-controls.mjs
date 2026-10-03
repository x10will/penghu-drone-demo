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
      for (const item of scenarioId === 'delivery' ? run.fixture.resources : []) {
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
export function createHazardControls({store, actions, legendOpen = false}) {
  return {
    id: 'hazardControls', title: '風險場', icon: '◐', defaultSize: {w: 4, h: 5},
    render(container) {
      const root = node('section', null, 'daily-hazard-panel');
      const hazardLabel = node('label', null, 'daily-hazard-toggle');
      const hazard = node('input'); hazard.type = 'checkbox'; hazard.setAttribute('aria-label', '顯示風險場');
      hazard.addEventListener('change', () => actions.setHazardVisible(hazard.checked));
      hazardLabel.append(hazard, node('span', '顯示風險場'));
      const fieldStatus = node('output'); fieldStatus.setAttribute('role', 'status'); fieldStatus.className = 'daily-field-status';
      const details = node('details', null, 'daily-hazard-legend-box'); details.open = legendOpen;
      details.append(node('summary', '圖例'));
      const legend = node('div', null, 'daily-hazard-legend');
      for (const [kind, caption] of [
        ['low', '0 低風險'], ['medium', '0.5'], ['high', '1.0'], ['very-high', '>1 高風險'],
        ['blocked', '粉紅邊界：危險＋邊際 > 1.0 禁飛'],
        ['uncertain', `斜線：邊際 > ${HATCH_MARGIN}`], ['land', '淡藍：陸地／上限（透明 18%）'],
      ]) {
        const item = node('span', caption); item.dataset.kind = kind; legend.append(item);
      }
      details.append(legend);
      root.append(hazardLabel, fieldStatus, details,
        node('p', '風險場是合成示範資料，隨同一時間軸變化。今日配送使用已提供的模擬航線，尚未用此風險場重新規劃。', 'daily-control-note'));
      container.append(root);
      const stop = store.subscribe(state => {
        hazard.checked = state.hazardVisible;
        const field = state.fieldStatus;
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
