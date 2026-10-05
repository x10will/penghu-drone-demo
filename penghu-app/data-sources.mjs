import {AIRCRAFT_SPEC} from './aircraft-spec.mjs';
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
const valueText = value => Array.isArray(value) ? value.join('–')
  : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '未提供');
const clock = minutes => {
  if (!Number.isFinite(minutes)) return '未提供';
  const value = Math.round(minutes);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export function aircraftReference(meta = {}, fixture = {}) {
  const values = new Map((meta.assumptions ?? []).map(item => [item.key, item.value]));
  const aircraft = fixture.aircraft ?? meta.aircraft ?? AIRCRAFT_SPEC;
  const speed = aircraft.cruiseMs ?? values.get('cruise_ms');
  const speedKph = Number.isFinite(speed) ? Math.round(speed * 3.6) : '未提供';
  const operating = aircraft.operatingWindMs ?? values.get('u_ref_ms');
  const body = aircraft.bodyWindMs ?? values.get('body_wind_ms');
  const payload = aircraft.payloadKg ?? values.get('payload_kg');
  const range = aircraft.rangeKm ?? values.get('range_km');
  const ids = aircraft.source_ids ?? ['S5', 'S6', 'S7', 'S8', 'S9'];
  return `參考機型：${aircraft.name ?? values.get('drone_type') ?? 'JEDSY Jedsy X'} 公開規格（推定為極現科技 2026-09-07 澎科大校區示範（報導情境為馬公至吉貝島醫療物資運送）所用機型，未獲業者確認）— 作業風速上限 ${valueText(operating)} m/s、機體上限 ${valueText(body)} m/s、巡航 ${speedKph} km/h、酬載 ${valueText(payload)} kg、航程 ${valueText(range)} km ${ids.map(id => `[${id}]`).join('')}`;
}

export function fixtureReferenceLines(fixture = {}) {
  const parameters = fixture.parameterMetadata ?? [];
  const notes = parameters.filter(item => ['drone_energy_wh', 'payload_box', 'thermal_profiles', 'temperature_bounds_c'].includes(item.key));
  return [`情境日期：${fixture.date ?? '未提供'}`, ...notes.map(item =>
    `${item.key === 'payload_box' || item.key === 'temperature_bounds_c' ? `${item.zh}：${valueText(item.value)} ${item.unit ?? ''}；` : ''}${item.basis ?? item.zh ?? item.key} ${(item.source_ids ?? []).filter(id => !item.basis?.includes(`[${id}]`)).map(id => `[${id}]`).join('')}`)];
}

let sourceSequence = 0;

/** Shared disclosure; its host supplies panel styling and runtime artifacts. */
export function createDataSource({kind, meta = {}, landmask, fixture = {}, opsStore} = {}) {
  const synthetic = ['hazard', 'trial', 'risk', 'schedule', 'map'].includes(kind);
  const delivery = ['fixture', 'schedule', 'map'].includes(kind);
  const map = kind === 'map' || kind === 'camera';
  const root = el('details', null, 'daily-data-source');
  root.dataset.sourceKind = kind ?? '';
  const summary = el('summary');
  const scenarioLabel = meta.scenario?.label ?? '離線風場模擬';
  const label = kind === 'camera' ? '地圖與模擬配送顯示'
    : kind === 'map' ? '地圖、合成情境與模擬配送'
      : kind === 'schedule' ? '模擬配送與合成風險'
        : synthetic ? `合成情境：${scenarioLabel}` : '模擬配送資料';
  summary.append(el('span', `資料來源：${label}`));
  const info = el('span', ' ⓘ'); info.setAttribute('aria-hidden', 'true'); summary.append(info);
  summary.setAttribute('aria-label', `資料來源：${label}；展開查看來源與假設`);
  const body = el('div', null, 'daily-data-source-body'); root.append(summary, body);
  const section = (title, description) => {
    const node = el('section'); node.append(el('strong', title));
    if (description) node.append(el('p', description));
    body.append(node); return node;
  };
  const line = (node, text) => node.append(el('p', text));
  const assumptions = Array.isArray(meta.assumptions) ? meta.assumptions : [];
  const assumptionByKey = new Map(assumptions.map(item => [item.key, item]));
  const assumptionValue = key => assumptionByKey.get(key)?.value;
  const registry = Array.isArray(meta.sources) ? Object.fromEntries(meta.sources.map(item => [item.id, item])) : meta.sources ?? {};
  const era5 = registry.S16;
  const sourceIds = new Set();
  const sourcePrefix = `source-${kind}-${++sourceSequence}`;
  const parameterTable = (node, items) => {
    if (!items.length) return;
    const table = el('table', null, 'daily-source-table');
    const caption = el('caption', '參數與依據（依執行時資料）');
    const head = el('thead'), header = el('tr');
    for (const title of ['參數', '數值', '依據', '來源']) header.append(el('th', title));
    head.append(header);
    const rows = el('tbody');
    for (const item of items) {
      const row = el('tr');
      const references = el('td');
      const check = era5?.parameter_checks?.[item.key];
      const altitude = item.key === 'u_ref_ms' && era5?.altitude_note;
      const ids = [...(item.source_ids ?? []), ...(check || altitude ? ['S16'] : [])];
      for (const id of ids) {
        sourceIds.add(id);
        const link = el('a', `[${id}]`); link.href = `#${sourcePrefix}-${id}`; references.append(link);
      }
      if (!ids.length) references.append(el('span', item.status_zh ?? '無參考（假設值）'));
      // Replace the superseded height footnote only in the disclosure, never the field.
      const basis = altitude ? item.basis?.split('約 100 m 高度風速')[0] : item.basis;
      row.append(el('th', item.zh ?? item.key), el('td', `${valueText(item.value)} ${item.unit ?? ''}`),
        el('td', [basis ?? item.status_zh ?? '依據未提供', check].filter(Boolean).join(' ')), references);
      rows.append(row);
    }
    table.append(caption, head, rows); node.append(table);
  };

  if (synthetic) {
    const source = section(`合成情境：${scenarioLabel}`,
      '依中央氣象署測站冬季統計校準的合成情境，非單日實測。觀測統計、外推假設與模型設計值分別列於下表。');
    line(source, aircraftReference(meta, fixture));
    for (const id of fixture.aircraft?.source_ids ?? ['S5', 'S6', 'S7', 'S8', 'S9']) sourceIds.add(id);
    line(source, `情境日期 ${meta.scenario?.date ?? fixture.date ?? '未提供'}；生成流程：scenario.py → terrain.py → danger.py → frames.py；重現種子 ${valueText(meta.scenario?.seed ?? assumptionValue('seed'))}。`);
    parameterTable(source, assumptions);
    if (era5?.altitude_note) line(source, `${era5.altitude_note}；僅作註腳，未套用於風場。`);
    if (!delivery && fixture.parameterMetadata?.length) parameterTable(source, fixture.parameterMetadata);
    const ref = assumptionValue('u_ref_ms');
    line(source, `風險 = (U／${ref})²；σ = U × (${assumptionValue('margin_a')} + ${assumptionValue('margin_b')} × 預報時數)。預報時距自 ${clock(assumptionValue('anchor_hour') * 60)} 起算，最小為 0。`);
    line(source, `不確定度 = min(${assumptionValue('danger_clamp')}, ((U＋σ)／${ref})²) − min(${assumptionValue('danger_clamp')}, (U／${ref})²)。風險＋不確定度超過安全門檻才禁飛。`);
    section('風險地形因子', '以陸海幾何推算經驗性峽道加速與背風遮蔽；無澎湖專屬參考，設計值。未解流體 PDE，也未以場景 DTM 高程計算風場。');
  }
  if (synthetic || map) {
    const geometry = section('陸海遮罩與起降點');
    const provenance = landmask?._meta ?? landmask?.meta;
    if (provenance) {
      line(geometry, `陸海遮罩：${provenance.source ?? '來源未提供'}；查詢 ${provenance.queried ?? '日期未提供'}。`);
      if (provenance.grid) line(geometry, `格網 ${valueText(provenance.grid)}；${provenance.rings == null ? '' : `島嶼環 ${provenance.rings}；`}範圍 ${valueText(provenance.bbox)}。`);
      if (provenance.notes) line(geometry, provenance.notes);
    } else line(geometry, '陸海遮罩取自 OpenStreetMap／Overpass 島嶼環；目前尚未提供查詢日期與遮罩 provenance。');
    line(geometry, `起降點為專案定義的配送／試算節點（${meta.pads?.length ?? '未提供'} 個），不是核准起降場或飛行許可。`);
    const osm = el('a', '© OpenStreetMap contributors · ODbL'); osm.href = 'https://www.openstreetmap.org/copyright';
    osm.target = '_blank'; osm.rel = 'noopener noreferrer'; geometry.append(osm);
  }
  if (map) {
    section('立體地圖與視角', '場景地形使用內政部 20 m DTM（OGDL），僅供地圖呈現與地面高度取樣；風險仍使用合成風場及陸海幾何啟發式。運具模型、視角與放大比例是顯示設定，不會改變性能或風險。');
    if (kind === 'camera') section('模擬運具顯示', `視角追蹤當前配送／試算的運具；配送情境日期 ${fixture.date ?? '未提供'}，${fixture.label ?? '模擬配送資料'}。動畫依共享時鐘顯示，沒有獨立的即時感測來源。`);
  }
  if (delivery) {
    const source = section('模擬配送資料', `${fixture.label ?? '配送情境'}；日期 ${fixture.date ?? '未提供'}（${fixture.timezone ?? '時區未提供'}）。訂單、批次與服務時間為情境設計；機型引用公開規格，其餘假設與推算依據見下表。`);
    line(source, aircraftReference(meta, fixture));
    for (const id of fixture.aircraft?.source_ids ?? ['S5', 'S6', 'S7', 'S8', 'S9']) sourceIds.add(id);
    parameterTable(source, fixture.parameterMetadata ?? []);
    line(source, `情境 ${fixture.id ?? '未提供'}；保冷模型 ${fixture.profile?.label ?? fixture.profile?.id ?? '未提供'}；溫度界線 ${valueText(fixture.profile?.temperatureBoundsC)} °C；取樣間距 ${valueText(fixture.profile?.sampleEveryMin)} min。`);
    const batch = fixture.batch ?? {};
    line(source, `批次 ${batch.id ?? '未提供'}：${batch.source ?? '來源未提供'}；${valueText(batch.quantity)} 劑；${clock(batch.availableAtMin)} 放行；初始 ${valueText(batch.initialTemperatureC)} °C。上游運輸不在配送模型內。`);
    for (const item of fixture.orders ?? []) line(source, `訂單 ${item.id}：${valueText(item.quantity)} 劑；${valueText(item.massKg)} kg／${valueText(item.volumeL)} L；期限 ${clock(item.deadlineMin)}；收貨窗 ${(item.receivingWindow ?? []).map(clock).join('–')}。`);
    for (const item of fixture.resources ?? []) {
      const profile = item.mockProfile ?? {};
      line(source, `${item.id}（假設性能）：初始／保留能源 ${valueText(item.initialEnergyWh)}／${valueText(item.reserveWh)} Wh；載重 ${valueText(item.capacityKg)} kg／${item.type === 'drone' ? `${fixture.aircraft?.payloadBox ?? AIRCRAFT_SPEC.payloadBox} [S5]；容積未公布（佔位值）` : `${valueText(item.capacityL)} L；無參考（假設值）`}；待機 ${valueText(profile.idleW)} W；作業 ${valueText(profile.handlingW)} W；移動 ${valueText(profile.movingW)} W；里程 ${valueText(profile.travelWhPerKm)} Wh/km。`);
    }
    for (const [name, profile] of Object.entries(fixture.profile?.thermal ?? {})) line(source, `溫控 ${name}：箱內平衡溫度（假設） ${valueText(profile.ambientC)} °C；時間常數 ${valueText(profile.tauMin)} min。`);
    if (fixture.source) line(source, `配送來源：${valueText(fixture.source)}`);
    if (fixture.provenance) line(source, `配送 provenance：${valueText(fixture.provenance)}`);
    for (const note of fixture.assumptions ?? []) line(source, note);
  }

  if (kind === 'camera') parameterTable(section('情境顯示所用參數'), fixture.parameterMetadata ?? []);

  if (sourceIds.size) {
    const sources = section('參考來源');
    if (synthetic) for (const id of Object.keys(registry)) sourceIds.add(id);
    for (const id of [...sourceIds].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
      const item = registry[id];
      if (!item) { line(sources, `[${id}] 來源資料未提供`); continue; }
      const row = el('p'); row.id = `${sourcePrefix}-${id}`;
      row.append(el('span', `[${id}] ${item.title} · ${item.publisher} · ${item.date ?? '未註日期'} · `));
      const link = el('a', item.url); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      row.append(link, el('span', ` · 查閱 ${item.accessed ?? '2026-10-05'}`));
      sources.append(row);
      if (item.coverage) line(sources, item.coverage);
      if (item.acquisition) line(sources, item.acquisition);
      for (const extra of item.links ?? []) {
        const link = el('a', extra.title); link.href = extra.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const row = el('p'); row.append(link); sources.append(row);
      }
      if (item.attribution) line(sources, item.attribution);
      if (item.licence_note) line(sources, item.licence_note);
    }
  }

  let stopped = false;
  const userSection = synthetic && opsStore ? section('使用者調整') : null;
  if (userSection) body.prepend(userSection);
  const updateRisk = state => {
    if (stopped || !userSection) return;
    const risk = (state ?? opsStore.get?.())?.risk;
    userSection.replaceChildren(el('strong', '使用者調整'));
    if (!risk) { line(userSection, '尚無風險設定。'); return; }
    line(userSection, `全域風速 ×${valueText(risk.windMultiplier)}；安全門檻 ${valueText(risk.safetyLimit)}。這些是使用者設定，不是觀測資料。`);
    const pads = meta.pads ?? [];
    if (!risk.events?.length) line(userSection, '無局部事件。');
    for (const event of risk.events ?? []) {
      const name = pads.find(pad => pad.id === event.nodeId)?.name ?? fixture.sites?.find(site => site.id === event.nodeId)?.label ?? event.nodeId;
      line(userSection, `${name}：半徑 ${valueText(event.radiusKm)} km；${clock(event.fromH * 60)}–${clock(event.toH * 60)}；${event.kind === 'gust' ? `風速 ×${valueText(event.multiplier)}` : '禁飛'}。`);
    }
  };
  updateRisk(opsStore?.get?.());
  const unsubscribe = userSection ? opsStore.subscribe?.(updateRisk) : null;
  let aiLine, aiLink;
  if (kind === 'schedule' || kind === 'risk') {
    const ai = section('AI 來源', 'AI 來源見本面板模式標籤；模式與模型由當次提案標示。引擎驗證結果另行判定。');
    aiLine = el('p'); aiLink = el('a', '查看本面板 AI 模式'); aiLink.href = '#ops-ai-source-mode'; aiLine.append(aiLink); ai.append(aiLine);
  }
  const modeChip = () => {
    let parent = root.parentElement;
    while (parent) {
      const chip = parent.querySelector('[id^="ops-ai-source-mode"], .ops-mode-chip, .ops-risk-chip');
      if (chip && !root.contains(chip)) return chip;
      if (parent.matches?.('.panel, .panel-content, .panel-body')) break;
      parent = parent.parentElement;
    }
    return null;
  };
  const updateMode = () => {
    if (!aiLink || stopped) return;
    const chip = modeChip();
    aiLink.textContent = chip?.textContent?.trim() ? `本面板 AI 模式：${chip.textContent.trim()}` : '查看本面板 AI 模式';
    aiLink.href = `#${chip?.id || 'ops-ai-source-mode'}`;
  };
  const toggle = () => { if (root.open) updateMode(); };
  const focusMode = event => {
    const chip = modeChip();
    if (!chip) { event.preventDefault(); return; }
    event.preventDefault(); updateMode();
    chip.scrollIntoView({block: 'nearest'});
    if (!chip.hasAttribute('tabindex')) chip.setAttribute('tabindex', '-1');
    chip.focus({preventScroll: true});
  };
  root.addEventListener('toggle', toggle); aiLink?.addEventListener('click', focusMode);
  const host = el('section', null, 'daily-source-block');
  host.dataset.sourceKind = kind ?? '';
  if (delivery && kind === 'fixture') {
    const note = el('div', null, 'daily-fixture-reference');
    note.append(el('p', aircraftReference(meta, fixture)));
    for (const value of fixtureReferenceLines(fixture)) note.append(el('p', value));
    host.append(note);
  }
  host.append(root);
  return {root: host, stop() {
    stopped = true; if (typeof unsubscribe === 'function') unsubscribe();
    root.removeEventListener('toggle', toggle); aiLink?.removeEventListener('click', focusMode);
  }};
}
