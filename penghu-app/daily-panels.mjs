const SVG_NS = 'http://www.w3.org/2000/svg';
const ORDER_STATUS = {
  'awaiting-supply': '等待批次／分配', packing: '包裝中', ready: '待裝運', loading: '裝載中',
  'in-transit': '運送中', handover: '交接中', receiving: '驗收中', delivered: '完成驗收',
  'pending-assessment': '待專業評估',
};
const RESOURCE_STATUS = {
  idle: '待命', loading: '裝載中', moving: '移動中', handover: '交接中', waiting: '等候中',
  receiving: '驗收中', parked: '停車', 'recovery-required': '待回收',
};
const resultStatus = status => status === 'delivered' ? '完成驗收' : '待專業評估';
const round = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const text = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
};
const svg = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};
const set = (node, value) => { const next = String(value); if (node.textContent !== next) node.textContent = next; };

export function minuteLabel(timeMin) {
  if (!Number.isFinite(timeMin)) return '—';
  const minute = Math.max(0, Math.floor(timeMin + 1e-7));
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function makeMetric(label, value = '—') {
  const box = text('div', 'daily-metric');
  const heading = text('span', 'daily-metric-label', label);
  const output = text('strong', 'daily-metric-value', value);
  box.append(heading, output);
  return {box, output};
}

function makeLine(label, value = '—') {
  const row = text('div', 'daily-kv-row');
  const term = text('dt', '', label);
  const output = text('dd', '', value);
  row.append(term, output);
  return {row, output};
}

function siteName(fixture, id) {
  return fixture.sites.find(site => site.id === id)?.label ??
    fixture.resources.find(resource => resource.id === id)?.label ?? (id || '移動中');
}

function renderChart(trace, bounds) {
  const root = text('div', 'daily-thermal');
  const heading = text('div', 'daily-thermal-heading');
  const title = text('strong', '', '模擬溫度軌跡');
  const current = text('output', '', '—');
  heading.append(title, current);
  const plot = svg('svg', {viewBox: '0 0 330 112', role: 'img', 'aria-label': `溫度軌跡，模擬界限 ${bounds[0]}–${bounds[1]} °C`});
  const samples = trace.temperature;
  const first = samples[0]?.timeMin ?? 0;
  const last = samples.at(-1)?.timeMin ?? first + 1;
  const low = Math.min(bounds[0] - 1, ...samples.map(item => item.celsius)) - .25;
  const high = Math.max(bounds[1] + 1, ...samples.map(item => item.celsius)) + .25;
  const x = timeMin => 28 + 292 * (timeMin - first) / Math.max(1, last - first);
  const y = temp => 94 - 76 * (temp - low) / Math.max(1, high - low);
  const points = rows => rows.map(item => `${x(item.timeMin).toFixed(1)},${y(item.celsius).toFixed(1)}`).join(' ');
  const band = svg('rect', {x: 28, y: y(bounds[1]), width: 292, height: y(bounds[0]) - y(bounds[1]), class: 'daily-thermal-band'});
  const forecast = svg('polyline', {points: points(samples), class: 'daily-thermal-forecast'});
  const elapsed = svg('polyline', {points: '', class: 'daily-thermal-elapsed'});
  const marker = svg('circle', {cx: 28, cy: 94, r: 4, class: 'daily-thermal-marker'});
  plot.append(band, forecast, elapsed, marker);
  const ticks = text('div', 'daily-chart-ticks', `${minuteLabel(first)}　　模擬界限 ${bounds[0]}–${bounds[1]} °C　　${minuteLabel(last)}`);
  const note = text('small', 'daily-forecast-note', '淡線為全日推演；亮線為目前播放時間以前。');
  root.append(heading, plot, ticks, note);
  return {
    root,
    update(timeMin, temperatureC) {
      const visible = samples.filter(item => item.timeMin <= timeMin);
      if (Number.isFinite(temperatureC) && timeMin >= first) visible.push({timeMin, celsius: temperatureC});
      elapsed.setAttribute('points', points(visible));
      const markerVisible = Number.isFinite(temperatureC) && timeMin >= first;
      marker.style.display = markerVisible ? '' : 'none';
      if (markerVisible) {
        marker.setAttribute('cx', x(timeMin).toFixed(1));
        marker.setAttribute('cy', y(temperatureC).toFixed(1));
      }
      set(current, Number.isFinite(temperatureC) ? `${round(temperatureC, 2)} °C` : '尚未分裝');
    },
  };
}

function makeOrderDetail(run, order) {
  const root = text('section', 'daily-order-detail');
  const spec = run.fixture.orders.find(item => item.id === order.id);
  const outcome = run.summary.orders.find(item => item.id === order.id);
  const title = text('h3', '', `${order.label} · ${order.quantity} 劑`);
  const info = text('dl', 'daily-kv');
  const deadline = makeLine('配送期限', minuteLabel(spec.deadlineMin));
  const window = makeLine('收貨時段', `${minuteLabel(spec.receivingWindow[0])}–${minuteLabel(spec.receivingWindow[1])}`);
  const packageLine = makeLine('包裝量', `${round(spec.massKg)} kg · ${round(spec.volumeL)} L`);
  const custodian = makeLine('目前保管', '—');
  const status = makeLine('目前狀態', '—');
  const receiving = makeLine('驗收完成', '—');
  const exposure = makeLine('累計超界', '—');
  info.append(deadline.row, window.row, packageLine.row, status.row, custodian.row, receiving.row, exposure.row);
  const chart = renderChart(run.traces[order.id], run.fixture.profile.temperatureBoundsC);
  const custodyTitle = text('h4', '', '保管交接 · 含預計行程');
  const custody = text('ol', 'daily-custody');
  const custodyRows = run.traces[order.id].custody.map(segment => {
    const item = text('li', '', `${minuteLabel(segment.startMin)}–${minuteLabel(segment.endMin)}　${segment.label ?? segment.custodianId}`);
    custody.append(item);
    return {segment, item};
  });
  const forecast = text('p', 'daily-outcome', `全日推演：${resultStatus(outcome.status)} · 約 ${minuteLabel(outcome.deliveredAtMin)} 驗收 · ${outcome.onTime ? '期限內' : '逾期限'} · ${round(outcome.minTemperatureC, 2)}–${round(outcome.maxTemperatureC, 2)} °C`);
  const exceptions = text('p', 'daily-exceptions', outcome.exceptions.length ? outcome.exceptions.join('；') : '全日推演無例外');
  root.append(title, info, chart.root, custodyTitle, custody, forecast, exceptions);
  return {
    root,
    update(snapshotOrder, timeMin) {
      set(status.output, ORDER_STATUS[snapshotOrder?.status] ?? snapshotOrder?.status ?? '—');
      set(custodian.output, snapshotOrder?.custodianId ? siteName(run.fixture, snapshotOrder.custodianId) : '尚未分配');
      set(receiving.output, snapshotOrder?.deliveredAtMin == null ? `預估 ${minuteLabel(outcome.deliveredAtMin)}` : minuteLabel(snapshotOrder.deliveredAtMin));
      set(exposure.output, `${round(snapshotOrder?.excursionMinutes ?? 0, 1)} 分鐘`);
      chart.update(timeMin, snapshotOrder?.temperatureC);
      for (const {segment, item} of custodyRows) {
        item.classList.toggle('is-current', segment.startMin <= timeMin && timeMin < segment.endMin);
        set(item, `${segment.startMin > timeMin ? '預計 ' : ''}${minuteLabel(segment.startMin)}–${minuteLabel(segment.endMin)}　${segment.label ?? segment.custodianId}`);
      }
      forecast.dataset.phase = timeMin >= run.endMin ? 'final' : 'forecast';
      set(forecast, `${timeMin >= run.endMin ? '日終結果' : '全日推演'}：${resultStatus(outcome.status)} · ${minuteLabel(outcome.deliveredAtMin)} 驗收 · ${outcome.onTime ? '期限內' : '逾期限'} · ${round(outcome.minTemperatureC, 2)}–${round(outcome.maxTemperatureC, 2)} °C`);
    },
  };
}

function createPlanPanel({run, store, actions}) {
  return {
    id: 'dailyPlan', title: '今日配送計畫', icon: '▤', defaultSize: {w: 3, h: 7}, streams: [],
    render(container) {
      const root = text('div', 'daily-plan');
      const mast = text('div', 'daily-mast');
      const title = text('div');
      title.append(text('strong', 'daily-pill', '模擬資料'), text('span', 'daily-run-id', `${run.fixture.date} · ${run.fixture.timezone}`));
      const now = text('output', 'daily-now', minuteLabel(run.startMin));
      mast.append(title, now);
      const phase = text('p', 'daily-phase', '固定計畫 · 無人機交接優先');
      const shortcuts = text('div', 'daily-shortcuts');
      const replay = text('button', '', '從頭播放'); replay.type = 'button';
      replay.addEventListener('click', () => actions.replay());
      const toEnd = text('button', '', '日終結果'); toEnd.type = 'button';
      toEnd.addEventListener('click', () => { actions.seekMinute(run.endMin); summary.scrollIntoView({block: 'nearest'}); });
      shortcuts.append(replay, toEnd);
      const stock = text('div', 'daily-metrics');
      const batch = makeMetric('到貨批次', `${run.fixture.batch.quantity} 劑`);
      const allocated = makeMetric('兩筆訂單', `${run.fixture.orders.reduce((sum, item) => sum + item.quantity, 0)} 劑`);
      const remaining = makeMetric('當前可用', '—');
      stock.append(batch.box, allocated.box, remaining.box);
      const release = text('p', 'daily-release', `${run.fixture.batch.id} · ${minuteLabel(run.fixture.batch.availableAtMin)} 於模擬收貨冷庫放行`);

      const ordersTitle = text('h3', '', '訂單');
      const orders = text('div', 'daily-order-list');
      const orderButtons = new Map();
      for (const order of run.fixture.orders) {
        const button = text('button', 'daily-order-card');
        button.type = 'button';
        button.dataset.orderId = order.id;
        const top = text('span', 'daily-order-top');
        top.append(text('strong', '', order.label), text('span', '', `${order.quantity} 劑`));
        const status = text('span', 'daily-order-status', '—');
        const outcome = run.summary.orders.find(item => item.id === order.id);
        const eta = text('small', '', `全日推演約 ${minuteLabel(outcome.deliveredAtMin)} 驗收 · 期限 ${minuteLabel(outcome.deadlineMin)}`);
        button.append(top, status, eta);
        button.addEventListener('click', () => actions.selectOrder(order.id, {focus: true}));
        orders.append(button);
        orderButtons.set(order.id, {button, status, eta, outcome});
      }
      const eventsTitle = text('h3', '', '今日事件 · 點選可跳轉');
      const eventList = text('ol', 'daily-events');
      const eventRows = run.events.map(event => {
        const item = text('li');
        const button = text('button', 'daily-event');
        button.type = 'button';
        button.append(text('time', '', minuteLabel(event.timeMin)), text('span', '', event.label));
        button.addEventListener('click', () => actions.seekMinute(event.timeMin, event.id));
        item.append(button);
        eventList.append(item);
        return {event, item, button};
      });
      const summary = text('section', 'daily-summary');
      const summaryTitle = text('h3', '', '全日推演結果');
      const summaryLedger = text('p', 'daily-summary-ledger', `${run.summary.inventory.totalQuantity} 劑批次 · ${run.summary.inventory.deliveredQuantity} 劑配送 · ${run.summary.inventory.remainingQuantity} 劑留庫`);
      const summaryOrders = text('ul', 'daily-summary-list');
      for (const outcome of run.summary.orders) {
        const source = run.fixture.orders.find(item => item.id === outcome.id);
        summaryOrders.append(text('li', '', `${source.label} ${outcome.quantity} 劑 · ${resultStatus(outcome.status)} · ${minuteLabel(outcome.deliveredAtMin)} · ${outcome.onTime ? '期限內' : '逾期限'}${outcome.exceptions.length ? ` · ${outcome.exceptions.join('；')}` : ''}`));
      }
      const summaryFleet = text('ul', 'daily-summary-list');
      for (const item of run.summary.resources) {
        summaryFleet.append(text('li', '', `${item.id} · ${siteName(run.fixture, item.siteId)} · ${RESOURCE_STATUS[item.status] ?? item.status} · ${round(item.energyWh, 1)} Wh（保留 ${round(item.reserveWh, 1)} Wh，${item.reserveMet ? '達標' : '未達標'}）`));
      }
      const notes = text('p', 'daily-summary-notes', run.summary.notes.join(' '));
      summary.append(summaryTitle, summaryLedger, summaryOrders, summaryFleet, notes);

      const inputs = text('details', 'daily-inputs');
      const inputsTitle = text('summary', '', '查看模擬輸入與假設');
      const inputsBody = text('div', 'daily-inputs-body');
      inputsBody.append(text('p', '', `${run.fixture.batch.source} · ${run.fixture.batch.label} · ${run.fixture.batch.quantity} 劑 · 到貨溫度 ${round(run.fixture.batch.initialTemperatureC, 1)} °C`));
      inputsBody.append(text('p', '', `上游模擬溫度：${run.fixture.batch.upstreamHistory.map(sample => `${minuteLabel(sample.timeMin)} ${round(sample.celsius, 1)} °C`).join(' → ')}`));
      const assumptionList = text('ul');
      for (const assumption of run.fixture.assumptions) assumptionList.append(text('li', '', assumption));
      inputsBody.append(assumptionList);
      inputsBody.append(text('p', '', run.fixture.profile.label));
      inputsBody.append(text('p', '', `模擬溫控界限 ${run.fixture.profile.temperatureBoundsC.join('–')} °C；圖表取樣每 ${run.fixture.profile.sampleEveryMin} 分鐘，超界時數由連續區間計算。`));
      inputsBody.append(text('p', '', `路線：${run.fixture.routes.map(route => `${siteName(run.fixture, route.fromSiteId)} → ${siteName(run.fixture, route.toSiteId)} ${route.speedKph} km/h`).join('；')}`));
      const serviceNames = {packQimei:'七美包裝',packMagong:'馬公包裝',loadQimei:'七美訂單裝車',loadMagong:'馬公訂單裝車',handoverOrigin:'馬公交接',handoverQimei:'七美交接',receiveQimei:'七美驗收',receiveMagong:'馬公驗收'};
      inputsBody.append(text('p', '', `作業時間：${Object.entries(run.fixture.plan.durationsMin).map(([name, value]) => `${serviceNames[name] ?? name} ${value} 分`).join(' · ')}`));
      const modelInputs = text('details', 'daily-model-inputs');
      modelInputs.append(text('summary', '', '完整模擬參數（唯讀）'), text('pre', '', JSON.stringify(run.fixture, null, 2)));
      inputsBody.append(modelInputs);
      inputs.append(inputsTitle, inputsBody);
      // Keep changing order/status content below the event list so a click does
      // not move its own target. The full history lives in a separate panel.
      root.append(mast, shortcuts, stock, release, eventsTitle, eventList, ordersTitle, orders, phase, summary, inputs);
      container.append(root);

      const stop = store.subscribe(state => {
        const {snapshot, selectedOrderId, selectedEventId} = state;
        const atEnd = snapshot.timeMin >= run.endMin - 1e-7;
        set(now, minuteLabel(snapshot.timeMin));
        set(phase, atEnd ? '18:00 日終 · 固定計畫' : `固定計畫 · 無人機交接優先 · ${snapshot.inventory.released ? '批次已放行' : '等待批次放行'}`);
        set(remaining.output, `${snapshot.inventory.availableQuantity} 劑`);
        for (const [id, row] of orderButtons) {
          const current = snapshot.orders.find(item => item.id === id);
          row.button.classList.toggle('is-selected', id === selectedOrderId);
          row.button.setAttribute('aria-pressed', String(id === selectedOrderId));
          set(row.status, ORDER_STATUS[current?.status] ?? current?.status ?? '—');
          set(row.eta, `${current?.deliveredAtMin == null ? '預估' : '已於'} ${minuteLabel(row.outcome.deliveredAtMin)} 驗收 · 期限 ${minuteLabel(row.outcome.deadlineMin)}`);
        }
        for (const {event, item, button} of eventRows) {
          item.classList.toggle('is-past', event.timeMin <= snapshot.timeMin);
          button.classList.toggle('is-selected', event.id === selectedEventId);
          button.setAttribute('aria-pressed', String(event.id === selectedEventId));
        }
        set(summaryTitle, atEnd ? '18:00 日終結果' : '全日推演結果 · 尚未到日終');
      });
      return {root, stop};
    },
    update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'daily-plan', visibleFields: [], summary: '固定模擬情境；AI 解說未啟用。'}; },
    dispose(view) { view.stop(); },
  };
}

function createOrderPanel({run, store, actions}) {
  return {
    id: 'orderDetail', title: '訂單詳情', icon: '▧', defaultSize: {w: 3, h: 7}, streams: [],
    render(container) {
      const root = text('div', 'daily-order-panel');
      const selector = text('label', 'daily-order-selector', '配送訂單');
      const select = text('select');
      for (const order of run.fixture.orders) {
        const option = text('option', '', `${order.label} · ${order.quantity} 劑`);
        option.value = order.id; select.append(option);
      }
      select.addEventListener('change', () => actions.selectOrder(select.value));
      selector.append(select);
      const now = text('output', 'daily-order-time');
      const detailSlot = text('div', 'daily-detail-slot');
      root.append(selector, now, detailSlot); container.append(root);
      let detail = null, detailOrderId = null;
      const stop = store.subscribe(({snapshot, selectedOrderId}) => {
        select.value = selectedOrderId;
        set(now, `目前時間 ${minuteLabel(snapshot.timeMin)}`);
        if (selectedOrderId !== detailOrderId) {
          detailOrderId = selectedOrderId;
          const source = run.fixture.orders.find(item => item.id === selectedOrderId);
          detail = source ? makeOrderDetail(run, source) : null;
          detailSlot.replaceChildren(...(detail ? [detail.root] : []));
        }
        detail?.update(snapshot.orders.find(item => item.id === selectedOrderId), snapshot.timeMin);
      });
      return {root, stop};
    },
    update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'delivery-order', visibleFields: [], summary: '模擬配送訂單；AI 解說未啟用。'}; },
    dispose(view) { view.stop(); },
  };
}

function createResourcePanel({run, store, actions}) {
  return {
    id: 'resource', title: '運具狀態', icon: '▣', defaultSize: {w: 4, h: 4}, streams: [],
    render(container, ctx) {
      const source = run.fixture.resources.find(item => item.id === ctx.entry.resourceId);
      if (!source) return {stop: () => {}};
      const root = text('div', 'daily-resource');
      const heading = text('div', 'daily-resource-heading');
      heading.append(text('strong', '', source.label), text('span', 'daily-resource-kind', source.type === 'drone' ? '無人機' : '接駁車'));
      const status = text('p', 'daily-resource-status', '待命');
      const activity = text('p', 'daily-resource-activity', '—');
      const metrics = text('div', 'daily-metrics');
      const energy = makeMetric('剩餘能源', '—');
      const reserve = makeMetric('高於保留量', '—');
      metrics.append(energy.box, reserve.box);
      const gauge = text('progress', 'daily-energy-gauge');
      gauge.max = 100;
      const facts = text('dl', 'daily-kv');
      const position = makeLine('目前位置', '—');
      const cargo = makeLine('載運訂單', '—');
      const capacity = makeLine('模擬載運上限', `${round(source.capacityKg, 1)} kg · ${round(source.capacityL, 1)} L`);
      facts.append(position.row, cargo.row, capacity.row);
      const focus = text('button', 'daily-focus', '地圖聚焦此運具');
      focus.type = 'button';
      focus.addEventListener('click', () => actions.selectResource(source.id));
      const scheduleTitle = text('h3', '', '當日行程');
      const schedule = text('ol', 'daily-resource-schedule');
      const rows = run.events.filter(event => event.resourceIds.includes(source.id)).map(event => {
        const li = text('li');
        const button = text('button', 'daily-resource-event', `${minuteLabel(event.timeMin)}　${event.label}`);
        button.type = 'button';
        button.addEventListener('click', () => actions.seekMinute(event.timeMin, event.id));
        li.append(button);
        schedule.append(li);
        return {event, li};
      });
      const outcome = run.summary.resources.find(item => item.id === source.id);
      const end = text('p', 'daily-resource-end');
      const recovery = source.id === 'D-01' ? text('p', 'daily-recovery-note', 'D-01 本日停留七美轉運點，需另行回收；未模擬返航。') : null;
      root.append(heading, status, activity, metrics, gauge, facts, focus, scheduleTitle, schedule, end);
      if (recovery) root.append(recovery);
      container.append(root);
      const stop = store.subscribe(state => {
        const snapshot = state.snapshot;
        const current = snapshot.resources.find(item => item.id === source.id);
        if (!current) return;
        set(status, RESOURCE_STATUS[current.status] ?? current.status);
        set(activity, current.activity || '—');
        set(energy.output, `${round(current.energyWh, 1)} Wh`);
        set(reserve.output, `${round(current.energyWh - current.reserveWh, 1)} Wh`);
        reserve.box.dataset.state = current.energyWh >= current.reserveWh ? 'ok' : 'alert';
        gauge.value = Math.max(0, Math.min(100, current.energyPercent));
        gauge.setAttribute('aria-label', `剩餘能源 ${round(current.energyPercent, 1)}%`);
        set(position.output, current.siteId ? siteName(run.fixture, current.siteId) : `${round(current.position.lat, 4)}, ${round(current.position.lng, 4)} · ${round(current.position.altitudeM, 0)} m`);
        set(cargo.output, current.orderIds.length ? current.orderIds.join('、') : '無');
        focus.setAttribute('aria-pressed', String(state.focusedResourceId === source.id));
        for (const {event, li} of rows) li.classList.toggle('is-past', event.timeMin <= snapshot.timeMin);
        set(end, `${snapshot.timeMin >= run.endMin ? '日終' : '全日推演'}：${siteName(run.fixture, outcome.siteId)} · ${RESOURCE_STATUS[outcome.status] ?? outcome.status} · ${round(outcome.energyWh, 1)} Wh（保留 ${round(outcome.reserveWh, 1)} Wh）`);
      });
      return {root, stop};
    },
    update() {},
    describeForAI() { return {schemaVersion: 1, kind: 'resource', visibleFields: [], summary: '固定模擬情境；AI 解說未啟用。'}; },
    dispose(view) { view.stop(); },
  };
}

export function createDailyPanels(options) {
  return {dailyPlan: createPlanPanel(options), orderDetail: createOrderPanel(options), resource: createResourcePanel(options)};
}
