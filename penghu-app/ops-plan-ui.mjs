import {createDefaultState, createVehicle} from './ops-world.mjs';
import {riskHash} from './risk-scenario.mjs';
import {minuteLabel} from './daily-panels.mjs';
import {urgentOrder, STAGE_EXTRA_DRONE_BASE} from './ops-stage.mjs';

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (caption, action) => {
  const node = el('button', caption); node.type = 'button'; node.addEventListener('click', action); return node;
};
const inputKey = state => JSON.stringify([state.orders, state.vehicles, state.risk]);
const asTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.round(minute % 60)).padStart(2, '0')}`;
const fromTime = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
const configuredMode = ai => ai.mode === 'rule' ? '規則排程（非 AI）' : ai.mode === 'live' ? '即時 AI' : ai.mode === 'replay' ? '示範回放' : 'AI · 自動選擇';

export function scheduleOutcome(value) {
  const noOrders = Boolean(value) && !value.evaluation?.orders?.length;
  const allPass = Boolean(value?.evaluation?.allPass) && !noOrders;
  return {
    noOrders,
    allPass,
    status: noOrders ? '沒有訂單可排程' : allPass ? '方案可採用。' : '已保留引擎未通過的結果。',
  };
}

/** Editable inputs stay visible; a proposal is adopted only by this explicit button. */
export function createOpsPlanPanels({opsStore, world, scheduleAI, onPreview = () => {}, onAdopt = () => {}}) {
  function nodeSelect(value, update, label) {
    const select = el('select'); select.setAttribute('aria-label', label);
    for (const node of world.nodes) {
      const name = node.id === 'qimei-clinic' ? '七美模擬配送點' : node.label.replace(/（(?:示意|岸上道路)）/g, '');
      const option = el('option', `${name} · ${node.island}`);
      option.title = `${node.label} · ${node.island}`; option.value = node.id; select.append(option);
    }
    select.value = value; select.title = select.selectedOptions[0]?.title ?? '';
    select.addEventListener('change', () => update(select.value)); return select;
  }
  function field(type, value, update, label, min = 0, step = 1) {
    const node = el('input'); node.type = type; node.value = type === 'time' ? asTime(value) : value;
    if (type === 'number') { node.min = min; node.step = step; }
    node.setAttribute('aria-label', label);
    node.addEventListener('change', () => {
      if (!node.checkValidity()) { node.reportValidity(); return; }
      // An emptied cell is not a 0: restore the stored value instead of saving it.
      if (type !== 'text' && node.value.trim() === '') { node.value = type === 'time' ? asTime(value) : value; return; }
      const next = type === 'time' ? fromTime(node.value) : type === 'number' ? Number(node.value) : node.value;
      if (typeof next === 'number' && !Number.isFinite(next)) return;
      update(next);
    });
    return node;
  }
  function table(headers) {
    const table = el('table', null, 'ops-table'), head = el('thead'), row = el('tr'), body = el('tbody');
    for (const caption of headers) row.append(el('th', caption));
    head.append(row); table.append(head, body); return {table, body};
  }
  function cells(row, controls) { for (const control of controls) { const cell = el('td'); cell.append(control); row.append(cell); } }
  function editCollection(key, id, patch) {
    opsStore.set(state => ({...state, [key]: state[key].map(item => item.id === id ? {...item, ...patch} : item)}));
  }
  function nextId(prefix, items) {
    let n = 1; while (items.some(item => item.id === `${prefix}-${String(n).padStart(2, '0')}`)) n++;
    return `${prefix}-${String(n).padStart(2, '0')}`;
  }
  const ordersPanel = {
    id: 'opsOrders', title: '訂單', icon: '▤',
    render(container) {
      const root = el('section', null, 'ops-editor');
      root.append(button('新增訂單', () => {
        const state = opsStore.get(), id = nextId('ORD', state.orders);
        opsStore.set({orders: [...state.orders, {id, label: id, destinationNodeId: 'magong-clinic', doses: 30,
          deadlineMin: 690, receivingWindow: [540, 720], priority: 'normal'}]});
      }));
      const {table: grid, body} = table(['訂單／目的地', '劑數', '期限', '收貨起', '收貨迄', '']);
      const batch = world.fixture?.batch;
      root.append(grid, el('p', `批次 ${batch?.quantity ?? '未提供'} 劑，${batch ? asTime(batch.availableAtMin) : '未提供'} 釋出。排程逐筆驗證庫存、容量、冷鏈與期限。`, 'daily-control-note'));
      container.append(root);
      const stop = opsStore.subscribe(state => {
        body.replaceChildren();
        for (const order of state.orders) {
          const row = el('tr'), identity = el('div', null, 'ops-identity');
          identity.append(field('text', order.label, label => editCollection('orders', order.id, {label}), `${order.id} 名稱`),
            nodeSelect(order.destinationNodeId, destinationNodeId => editCollection('orders', order.id, {destinationNodeId}), `${order.id} 目的地`));
          const window = (i, value) => editCollection('orders', order.id, {receivingWindow: order.receivingWindow.map((x, j) => j === i ? value : x)});
          cells(row, [identity, field('number', order.doses, doses => editCollection('orders', order.id, {doses}), `${order.id} 劑數`, 1),
            field('time', order.deadlineMin, deadlineMin => editCollection('orders', order.id, {deadlineMin}), `${order.id} 期限`),
            field('time', order.receivingWindow[0], value => window(0, value), `${order.id} 收貨起`),
            field('time', order.receivingWindow[1], value => window(1, value), `${order.id} 收貨迄`),
            button('刪除', () => opsStore.set({orders: opsStore.get().orders.filter(item => item.id !== order.id)}))]);
          body.append(row);
        }
      });
      return {root, stop};
    }, update() {}, dispose(view) { view.stop(); view.root.remove(); },
  };
  const vehiclesPanel = {
    id: 'opsVehicles', title: '運具', icon: '▣',
    render(container) {
      const root = el('section', null, 'ops-editor'), tools = el('div', null, 'ops-toolbar');
      for (const [type, caption, prefix, base] of [['drone', '新增無人機', 'D', 'magong-transfer'], ['van', '新增配送車', 'V', 'depot']])
        tools.append(button(caption, () => {
          const state = opsStore.get(); opsStore.set({vehicles: [...state.vehicles, createVehicle(type, nextId(prefix, state.vehicles), base)]});
        }));
      const {table: grid, body} = table(['運具／基地', '電量 Wh', '保留 Wh', 'kg', 'L', '']);
      root.append(tools, grid); container.append(root);
      const stop = opsStore.subscribe(state => {
        body.replaceChildren();
        for (const vehicle of state.vehicles) {
          const row = el('tr'), identity = el('div', null, 'ops-identity');
          identity.append(el('strong', `${vehicle.id} · ${vehicle.type === 'drone' ? '無人機' : '配送車'}`),
            nodeSelect(vehicle.baseNodeId, baseNodeId => editCollection('vehicles', vehicle.id, {baseNodeId}), `${vehicle.id} 基地`));
          cells(row, [identity, ...['energyWh', 'reserveWh', 'capacityKg', 'capacityL'].map(key =>
            key === 'capacityL' && vehicle.type === 'drone'
              ? el('span', '容積未公布（佔位值）')
              : field('number', vehicle[key], value => editCollection('vehicles', vehicle.id, {[key]: value}), `${vehicle.id} ${key}`, key === 'reserveWh' ? 0 : .1, .1)),
            button('刪除', () => opsStore.set({vehicles: opsStore.get().vehicles.filter(item => item.id !== vehicle.id)}))]);
          body.append(row);
        }
      });
      return {root, stop};
    }, update() {}, dispose(view) { view.stop(); view.root.remove(); },
  };
  const schedulePanel = {
    id: 'opsSchedule', title: '排程', icon: '⌁',
    render(container) {
      const root = el('section', null, 'ops-schedule'), tools = el('div', null, 'ops-toolbar ops-schedule-hero');
      const chip = el('span', configuredMode(opsStore.get().ai), 'ops-mode-chip'), status = el('output'), result = el('div', null, 'ops-plan-results');
      const steps = el('ol', null, 'ops-ai-steps'); steps.setAttribute('aria-live', 'polite');
      const showSteps = (phase, repairs = 0, allPass, rule = false) => {
        steps.replaceChildren();
        const labels = [rule ? '規則提出方案' : 'AI 提出方案', '驗證', `修正 ${repairs} 次`,
          phase === 'complete' ? allPass ? '✓ 結果通過' : '✗ 結果未通過' : '結果'];
        for (const [index, text] of labels.entries()) {
          const name = ['proposing', 'validating', 'repairing', 'complete'][index];
          const item = el('li', text, name === phase ? 'is-current' : '');
          item.dataset.phase = name; steps.append(item);
        }
        steps.dataset.phase = phase;
      };
      const onProgress = event => {
        if (!busy || progressRevision !== inputKey(opsStore.get())) return;
        const current = opsStore.get(), rule = (event.modeLabel ?? configuredMode(current.ai)).includes('規則');
        showSteps(event.phase, (event.attempt ?? 0) + (event.phase === 'repairing' ? 1 : 0), event.allPass && current.orders.length > 0, rule);
        if (event.modeLabel) chip.textContent = event.modeLabel;
      };
      status.setAttribute('role', 'status');
      let proposal = null, revision = inputKey(opsStore.get()), progressRevision = revision, busy = false;
      const adopt = button('採用', () => {
        if (!proposal?.run || !proposal.evaluation?.allPass || !Array.isArray(proposal.plan?.assignments) || !proposal.evaluation?.orders?.length || inputKey(opsStore.get()) !== revision) return;
        const current = opsStore.get();
        opsStore.set({adopted: {plan: {...proposal.plan, mode: proposal.mode, model: proposal.model ?? '', modeLabel: proposal.modeLabel}, run: proposal.run,
          verifiedAt: new Date().toISOString(), adoptedAt: new Date().toISOString(), riskHash: riskHash(current.risk)}});
        status.textContent = '方案已採用，可切換監控播放。'; onAdopt(proposal);
      }); adopt.disabled = true;
      adopt.className = 'ops-adopt';
      const adoption = el('div', null, 'ops-adoption'); adoption.append(adopt);
      const renderProposal = value => {
        proposal = value; result.replaceChildren();
        const outcome = scheduleOutcome(value), {noOrders} = outcome;
        adopt.disabled = !value?.run || !Array.isArray(value?.plan?.assignments) || !outcome.allPass;
        if (!value) { chip.textContent = configuredMode(opsStore.get().ai); delete root.dataset.verdict; delete root.dataset.mode; delete root.dataset.repairs; return; }
        chip.textContent = value.modeLabel; root.dataset.verdict = outcome.allPass ? 'pass' : 'fail';
        root.dataset.mode = value.mode; root.dataset.repairs = String(value.repairs ?? 0);
        showSteps('complete', value.repairs ?? 0, outcome.allPass, value.mode === 'rule');
        result.append(el('p', noOrders ? '✗ 沒有訂單可排程' : outcome.allPass ? '✓ 引擎驗證：全部訂單通過' : '✗ 引擎驗證：仍有未通過訂單', 'ops-verdict'));
        const nodes = new Map(world.nodes.map(node => [node.id, node.label]));
        const assignments = Array.isArray(value.plan?.assignments) ? value.plan.assignments : [];
        for (const order of value.evaluation.orders) {
          const group = el('details', null, 'ops-plan-order'); group.dataset.verdict = order.pass ? 'pass' : 'fail';
          const assigned = assignments.find(item => item?.orderId === order.id);
          const proposedLegs = Array.isArray(assigned?.legs) ? assigned.legs : [];
          const summary = el('summary', null, 'ops-order-summary');
          const name = opsStore.get().orders.find(item => item.id === order.id)?.label ?? order.id;
          const chain = proposedLegs.map(leg => leg?.vehicleId ?? '未指定').filter((id, index, ids) => index === 0 || id !== ids[index - 1]).join(' → ');
          const arrival = order.legs.at(-1)?.arriveMin;
          summary.append(el('strong', `${order.pass ? '✓' : '✗'} ${name}`), el('span', chain || '未指派運具', 'ops-vehicle-chain'),
            el('time', `抵達 ${minuteLabel(arrival)}`));
          summary.setAttribute('aria-label', `${name} ${order.pass ? '通過' : '未通過'}，展開路段與原因`);
          const detail = el('div', null, 'ops-order-detail');
          group.append(summary, detail);
          for (const [index, leg] of proposedLegs.entries()) {
            const timed = order.legs[index];
            const row = el('div', null, 'ops-itinerary-leg');
            const heading = el('div', null, 'ops-leg-heading');
            heading.append(el('strong', leg?.vehicleId ?? '未指定運具'), el('time', `${minuteLabel(timed?.departMin)} → ${minuteLabel(timed?.arriveMin)}`));
            row.append(heading, el('p', `${nodes.get(leg?.from) ?? leg?.from ?? '未指定'} → ${nodes.get(leg?.to) ?? leg?.to ?? '未指定'}`));
            if (timed?.estimated || !timed) row.append(el('small', timed ? '道路距離估算' : '未能執行'));
            detail.append(row);
          }
          if (!proposedLegs.length) detail.append(el('p', '尚無指派路段'));
          if (order.pass) detail.append(el('p', '✓ 庫存、容量、冷鏈、能源與期限均符合引擎檢查。', 'ops-pass-reason'));
          for (const reason of order.reasons_zh) detail.append(el('p', reason, 'ops-failure-reason'));
          result.append(group);
        }
        const notes = String(value.plan?.notes_zh ?? '').replace(/\s+/g, ' ').trim();
        const note = el('p', notes.length > 140 ? `${notes.slice(0, 139)}…` : notes, 'daily-control-note ops-plan-notes');
        note.title = notes; result.append(note);
        const context = el('details', null, 'ops-plan-context'); context.append(el('summary', '驗證提醒與方案比較'));
        for (const warning of value.evaluation.warnings) context.append(el('p', warning, 'daily-control-note'));
        const prior = opsStore.get().adopted?.run;
        const last = run => Math.max(run.startMin, ...run.summary.orders.map(order => order.deliveredAtMin ?? run.endMin));
        const distance = run => run.movements.reduce((sum, movement) => sum + (movement.distanceKm ?? 0), 0);
        context.append(el('p', !value.run ? '此方案沒有可播放的行程。' : prior ? `與目前採用方案比較：完成 ${minuteLabel(last(value.run))}（原 ${minuteLabel(last(prior))}）；配送 ${value.run.summary.inventory.deliveredQuantity} 劑（原 ${prior.summary.inventory.deliveredQuantity}）；路程 ${distance(value.run).toFixed(1)} km（原 ${distance(prior).toFixed(1)}）` : '與目前採用方案比較：尚無採用方案', 'ops-comparison'));
        result.append(context);
      };
      const schedule = button('AI 排程', async () => {
        if (busy) return;
        busy = true; schedule.disabled = true; steps.replaceChildren(); renderProposal(null); onPreview(null); status.textContent = '排程與引擎驗證中…';
        const source = structuredClone(opsStore.get()), key = inputKey(source);
        progressRevision = key;
        try {
          const value = await scheduleAI(source, {onProgress});
          if (key !== inputKey(opsStore.get())) { status.textContent = '輸入已變更，請重新排程。'; return; }
          revision = key; renderProposal(value); onPreview(value.run);
          status.textContent = scheduleOutcome(value).status;
        } catch (error) { status.textContent = `排程失敗：${error.message}`; }
        finally { busy = false; schedule.disabled = false; }
      });
      schedule.className = 'ops-primary';
      tools.append(schedule, chip);
      const presets = el('div', null, 'ops-presets');
      const preset = modify => {
        const current = opsStore.get(), fresh = createDefaultState();
        fresh.ai = current.ai; fresh.risk = structuredClone(current.risk); modify(fresh); opsStore.set(fresh);
        steps.replaceChildren(); renderProposal(null); onPreview(null); status.textContent = '已套用情境，請排程。';
      };
      presets.append(button('追加急單：吉貝衛生所 30 劑 11:30 前', () => preset(state => state.orders.push(urgentOrder()))),
        button('新增無人機 D-02 駐馬公轉運點', () => {
          const state = opsStore.get();
          if (!state.vehicles.some(vehicle => vehicle.id === 'D-02'))
            opsStore.set({vehicles: [...state.vehicles, createVehicle('drone', 'D-02', STAGE_EXTRA_DRONE_BASE)]});
          status.textContent = '已新增 D-02，保留目前訂單，請重新排程。';
        }));
      root.append(tools, presets, status, steps, result, adoption); container.append(root);
      const stop = opsStore.subscribe(state => {
        schedule.textContent = state.ai.mode === 'rule' ? '規則排程（非 AI）' : 'AI 排程';
        if (!proposal && !busy) chip.textContent = configuredMode(state.ai);
        const key = inputKey(state);
        if (key !== revision) { revision = key; steps.replaceChildren(); renderProposal(null); onPreview(null); status.textContent = '輸入已變更，請重新排程。'; }
      });
      return {root, stop};
    }, update() {}, dispose(view) { view.stop(); view.root.remove(); },
  };
  return {ordersPanel, vehiclesPanel, schedulePanel};
}
