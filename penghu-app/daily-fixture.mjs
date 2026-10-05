import {AIRCRAFT_SPEC, AIRCRAFT_CRUISE_KPH, AIRCRAFT_PACK_WH, AIRCRAFT_RESERVE_WH, AIRCRAFT_ENERGY_BASIS} from './aircraft-spec.mjs';

// Facilities, demand and handling times are mock data; aircraft limits cite public specifications.
// Road centerlines are fixed excerpts of the existing OSM snapshot (2026-09-22).
// Short facility access links are mock; one-way/access restrictions are not modeled.
// Transfer locations are onshore road nodes, not the legacy N04/N05 port markers.
// © OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright

// way/73775037, way/332472675, way/332496828, way/335602294
const DEPOT_TO_TRANSFER = [
  [23.5678, 119.5672],
  [23.5678842, 119.5673862],
  [23.5674589, 119.567275],
  [23.5667292, 119.5671179],
  [23.5662814, 119.5669842],
  [23.5660958, 119.5669288],
  [23.5657421, 119.5668844],
  [23.5652347, 119.5667892],
  [23.5647803, 119.5667446],
  [23.564451, 119.5666915],
  [23.5642835, 119.5666529],
  [23.5637332, 119.566526],
  [23.5635336, 119.5665011],
  [23.5635331, 119.5664102],
  [23.5635313, 119.5660599],
  [23.5635293, 119.5656741],
  [23.5635198, 119.5651669],
  [23.5631858, 119.5650547],
  [23.5628218, 119.5650003],
  [23.5627434, 119.5649863],
].map(([lat, lng]) => ({lat, lng}));

// way/73775037, way/332472678, way/332474340, way/928645762, way/928878888, way/928878910, way/987151512
const DEPOT_TO_CLINIC = [
  [23.5678, 119.5672],
  [23.5678842, 119.5673862],
  [23.568826, 119.5676381],
  [23.5687962, 119.5683074],
  [23.5687413, 119.5690773],
  [23.5690862, 119.5694787],
  [23.569429, 119.5699183],
  [23.5696516, 119.5703178],
  [23.5698844, 119.5708004],
  [23.5699033, 119.5708397],
  [23.5699668, 119.570971],
  [23.5700027, 119.5710453],
  [23.5700769, 119.5711986],
  [23.5701123, 119.5712718],
  [23.5701762, 119.5714075],
  [23.5702371, 119.5715055],
  [23.5703986, 119.5716922],
  [23.5704299, 119.5717313],
  [23.5706002, 119.5719516],
  [23.5707194, 119.5721023],
  [23.5707816, 119.5721815],
  [23.5708751, 119.5723051],
  [23.5709583, 119.5724323],
  [23.5709917, 119.572493],
  [23.5711591, 119.5728003],
  [23.5713811, 119.5732682],
  [23.5716039, 119.5737578],
  [23.5718277, 119.574999],
  [23.5719188, 119.575394],
  [23.5720242, 119.5755718],
  [23.5720351, 119.5755903],
  [23.5723427, 119.5761996],
  [23.5723701, 119.5764305],
  [23.5724008, 119.576633],
  [23.5723639, 119.5768719],
  [23.5720327, 119.5777879],
  [23.5718645, 119.5782217],
  [23.5718, 119.578],
].map(([lat, lng]) => ({lat, lng}));

// way/60872548, way/258635740, way/258635742, way/258635752, way/258642463, way/294268225, way/1078983752
const QIMEI_TO_TRANSFER = [
  [23.2041, 119.4309],
  [23.2042984, 119.4311536],
  [23.2044184, 119.4304406],
  [23.2045122, 119.4298578],
  [23.2047231, 119.4287881],
  [23.2048548, 119.4280242],
  [23.2050017, 119.4271477],
  [23.2052266, 119.4257807],
  [23.2045084, 119.4255583],
  [23.2043457, 119.4254726],
  [23.2043064, 119.4254528],
  [23.2041601, 119.425134],
  [23.2040607, 119.4250116],
  [23.2039464, 119.4249076],
  [23.2038582, 119.4248402],
  [23.2037043, 119.4246673],
  [23.2035022, 119.4244898],
  [23.2032031, 119.4241849],
  [23.2024632, 119.4240851],
  [23.2016789, 119.4238804],
  [23.2016319, 119.4238852],
  [23.2015336, 119.4239169],
  [23.201357, 119.4240419],
  [23.2012232, 119.4240608],
  [23.2005959, 119.4238342],
  [23.1998572, 119.4235955],
  [23.199679, 119.423531],
  [23.1994429, 119.4233148],
  [23.199124, 119.4230355],
  [23.19898, 119.4229035],
  [23.1984799, 119.4224278],
  [23.1986706, 119.421366],
  [23.1979752, 119.4209969],
  [23.1974794, 119.4207182],
  [23.1972132, 119.4205332],
  [23.1971664, 119.4204823],
  [23.1971296, 119.4204022],
  [23.1967797, 119.4192891],
  [23.1966877, 119.419049],
  [23.196624, 119.418947],
  [23.1962839, 119.4188429],
  [23.1961138, 119.4187887],
  [23.1959649, 119.4187413],
].map(([lat, lng]) => ({lat, lng}));

const MAGONG_TRANSFER = DEPOT_TO_TRANSFER.at(-1);
const QIMEI_TRANSFER = QIMEI_TO_TRANSFER.at(-1);
const SCENARIO_DATE = '2027-01-13';
const THERMAL_NOTE = '假設為未認證的輕量保冷箱；WHO PQS 認證冷藏箱在 43 °C 下可維持 ≥ 48 小時不超過 10 °C [S12]，本日不會出現溫度偏離';

export const BASELINE_FIXTURE = {
  id: 'penghu-vaccine-day-2027-01-13',
  label: '冬季東北季風日疫苗配送計畫',
  date: SCENARIO_DATE,
  aircraft: AIRCRAFT_SPEC,
  timezone: 'Asia/Taipei',
  startMin: 6 * 60,
  endMin: 18 * 60,
  assumptions: [
    '訂單、批次、服務時間與溫控參數為假設；無人機參考 JEDSY Jedsy X 公開規格。',
    '設施與轉運功能為模擬；轉運點設於岸上道路節點，車行路徑採既有 OSM 道路線形與短距離示意進出路段，未模擬單行道或通行限制。',
    '航線是合成情境，非單日實測或核准路線；風場依中央氣象署測站冬季統計校準。',
    '上游運輸不在本次模型內；07:00 批次於馬公收貨冷庫完成放行，以冬季早晨可飛窗口排程。',
    '模擬冷庫有分裝與裝車兩個獨立作業位，可同時作業；本日兩筆訂單於出車前已分別標記。',
    '基準監控使用引擎試算：交貨後依風險場及保留電量嘗試返航；無安全返航才標記待回收。',
    '待機能源持續消耗：V-01 18 Wh/h、D-01 3 Wh/h、V-02 14 Wh/h；作業與移動另依模擬性能計算。',
  ],
  sites: [
    { id: 'depot', label: '馬公模擬收貨冷庫', kind: 'mock-depot', lat: 23.5678, lng: 119.5672 },
    { id: 'magong-clinic', label: '馬公市第一衛生所（示意）', kind: 'health-center', lat: 23.5718, lng: 119.5780 },
    { id: 'magong-transfer', label: '馬公模擬轉運點（岸上道路）', kind: 'mock-transfer', ...MAGONG_TRANSFER },
    { id: 'qimei-transfer', label: '七美模擬轉運點（岸上道路）', kind: 'mock-transfer', ...QIMEI_TRANSFER },
    { id: 'qimei-clinic', label: '七美鄉衛生所', kind: 'health-center', lat: 23.2041, lng: 119.4309 },
  ],
  resources: [
    { id: 'V-01', label: 'V-01 馬公配送車', type: 'van', typeLabel: '配送車', initialSiteId: 'depot',
      initialEnergyWh: 8000, reserveWh: 500, capacityKg: 20, capacityL: 30,
      mockProfile: { idleW: 18, handlingW: 35, movingW: 65, travelWhPerKm: 85 } },
    { id: 'D-01', label: 'D-01 七美配送無人機', type: 'drone', typeLabel: '無人機', initialSiteId: 'magong-transfer',
      initialEnergyWh: AIRCRAFT_PACK_WH, reserveWh: AIRCRAFT_RESERVE_WH, capacityKg: AIRCRAFT_SPEC.payloadKg, capacityL: 5,
      capacityLLabel: '容積未公布（佔位值）', payloadBox: AIRCRAFT_SPEC.payloadBox,
      mockProfile: { idleW: 3, handlingW: 8, movingW: 25, travelWhPerKm: AIRCRAFT_SPEC.travelWhPerKm } },
    { id: 'V-02', label: 'V-02 七美接駁車', type: 'van', typeLabel: '接駁車', initialSiteId: 'qimei-clinic',
      initialEnergyWh: 3500, reserveWh: 300, capacityKg: 8, capacityL: 12,
      mockProfile: { idleW: 14, handlingW: 30, movingW: 55, travelWhPerKm: 90 } },
  ],
  orders: [
    { id: 'ORD-MAGONG', label: '馬公市第一衛生所', destinationId: 'magong-clinic',
      quantity: 80, massKg: 2.4, volumeL: 3.2, deadlineMin: 11 * 60,
      receivingWindow: [8 * 60, 13 * 60], priority: 'routine' },
    { id: 'ORD-QIMEI', label: '七美鄉衛生所', destinationId: 'qimei-clinic',
      quantity: 40, massKg: 1.2, volumeL: 1.6, deadlineMin: 9 * 60 + 30,
      receivingWindow: [8 * 60 + 30, 14 * 60], priority: 'island' },
  ],
  batch: {
    id: 'MOCK-BATCH-0113', label: '模擬冷鏈疫苗批次', source: '臺灣本島供應（上游情境）',
    quantity: 200, availableAtMin: 7 * 60, initialTemperatureC: 4.4,
    upstreamHistory: [
      { timeMin: 6 * 60, celsius: 4.2 },
      { timeMin: 6 * 60 + 30, celsius: 4.3 },
      { timeMin: 7 * 60, celsius: 4.4 },
    ],
  },
  routes: [
    { id: 'road-depot-origin', mode: 'road', fromSiteId: 'depot', toSiteId: 'magong-transfer',
      speedKph: 20, path: DEPOT_TO_TRANSFER },
    { id: 'road-origin-depot', mode: 'road', fromSiteId: 'magong-transfer', toSiteId: 'depot',
      speedKph: 20, path: [...DEPOT_TO_TRANSFER].reverse() },
    { id: 'road-depot-magong', mode: 'road', fromSiteId: 'depot', toSiteId: 'magong-clinic',
      speedKph: 24, path: DEPOT_TO_CLINIC },
    { id: 'road-qimei-approach', mode: 'road', fromSiteId: 'qimei-clinic', toSiteId: 'qimei-transfer',
      speedKph: 24, path: QIMEI_TO_TRANSFER },
    { id: 'road-qimei-delivery', mode: 'road', fromSiteId: 'qimei-transfer', toSiteId: 'qimei-clinic',
      speedKph: 24, path: [...QIMEI_TO_TRANSFER].reverse() },
    { id: 'synthetic-air-qimei', mode: 'air', fromSiteId: 'magong-transfer', toSiteId: 'qimei-transfer',
      speedKph: AIRCRAFT_CRUISE_KPH, cruiseAltitudeM: 120, path: [MAGONG_TRANSFER, { lat: 23.3786, lng: 119.4918 }, QIMEI_TRANSFER] },
  ],
  profile: {
    id: 'mock-cold-vaccine-passive-box-v1',
    label: '模擬 2–8°C 冷藏疫苗／被動保冷箱 v1',
    temperatureBoundsC: [2, 8],
    equilibriumLabel: '箱內平衡溫度（假設）',
    thermalNote: THERMAL_NOTE,
    airTemperatureContext: null,
    sampleEveryMin: 10,
    // Newton cooling: T(t)=ambientC+(T0-ambientC)*exp(-t/tauMin).
    // Handover and receiving exposures stay with the outgoing custodian until completion.
    thermal: {
      depotCold: { ambientC: 4.2, tauMin: 40 },
      packing: { ambientC: 7.2, tauMin: 80 },
      handling: { ambientC: 9.5, tauMin: 90 },
      vanCold: { ambientC: 5.0, tauMin: 55 },
      droneBox: { ambientC: 7.8, tauMin: 130 },
      transferWait: { ambientC: 7.8, tauMin: 130 },
      receiving: { ambientC: 8.5, tauMin: 75 },
      clinicCold: { ambientC: 4.4, tauMin: 40 },
    },
  },
  parameterMetadata: [
    {key: 'scenario_date', value: SCENARIO_DATE, unit: '', zh: '配送情境日期', source_ids: ['S1'], basis: '配合 12–2 月測站統計的冬季合成情境，非單日實測。', status_zh: '設計情境'},
    {key: 'cruise_ms', value: AIRCRAFT_SPEC.cruiseMs, unit: 'm/s', zh: '無人機巡航速度（約 100 km/h）', source_ids: ['S5', 'S7'], basis: '澎湖試飛業者說明 100 km/h；廠商巡航 30 m/s、失速 17 m/s。', status_zh: '公開規格'},
    {key: 'operating_wind_ms', value: AIRCRAFT_SPEC.operatingWindMs, unit: 'm/s', zh: '作業風速上限', source_ids: ['S6'], basis: 'Jedsy X 作業風速上限，以 10 m 風速比對。', status_zh: '公開規格'},
    {key: 'body_wind_ms', value: AIRCRAFT_SPEC.bodyWindMs, unit: 'm/s', zh: '機體風速上限', source_ids: ['S5'], basis: '廠商機體風速上限；本日採更低的作業上限。', status_zh: '公開規格'},
    {key: 'drone_energy_wh', value: AIRCRAFT_PACK_WH, unit: 'Wh', zh: 'D-01／D-02 電池容量', source_ids: ['S5'], basis: AIRCRAFT_ENERGY_BASIS, status_zh: '依航程推算'},
    {key: 'drone_reserve_wh', value: AIRCRAFT_RESERVE_WH, unit: 'Wh', zh: '無人機保留電量', source_ids: ['S5'], basis: '依公布航程保留 10%；非廠商公布的電池參數。', status_zh: '依航程推算'},
    {key: 'drone_wh_per_km', value: AIRCRAFT_SPEC.travelWhPerKm, unit: 'Wh/km', zh: '無人機每公里耗能', source_ids: ['S5'], basis: '設計值；與公布 120 km 航程共同反推電池容量，非廠商實測耗能。', status_zh: '設計值'},
    {key: 'payload_kg', value: AIRCRAFT_SPEC.payloadKg, unit: 'kg', zh: '無人機酬載', source_ids: ['S5'], basis: '廠商公布最大酬載 3 kg。', status_zh: '公開規格'},
    {key: 'payload_box', value: AIRCRAFT_SPEC.payloadBox, unit: '', zh: '酬載運輸箱', source_ids: ['S5'], basis: '廠商規格列明相容運輸箱；容積未公布，模型容量為佔位值。', status_zh: '公開規格'},
    {key: 'drone_volume_placeholder', value: '容積未公布（佔位值）', unit: '', zh: '無人機箱內容積', source_ids: [], basis: '引擎保留容積容量供方案驗證，無公開容積參考。', status_zh: '佔位值'},
    {key: 'endurance_min', value: AIRCRAFT_SPEC.enduranceMin, unit: 'min', zh: '單段飛行續航', source_ids: ['S5'], basis: '廠商最長 118 min，扣 10% 備用後取 106 min。', status_zh: '公開規格扣備用'},
    {key: 'temperature_bounds_c', value: null, unit: '°C', zh: '疫苗冷藏界限', source_ids: ['S13'], basis: '疾病管制署疫苗冷運冷藏指引。', status_zh: '參考指引'},
    {key: 'thermal_profiles', value: '箱內平衡溫度（假設）', unit: '', zh: '輕量保冷箱熱模型', source_ids: ['S12'], basis: THERMAL_NOTE, status_zh: '假設值，非 WHO 認證'},
    {key: 'january_air_temperature_c', value: 17.3, unit: '°C', zh: '澎湖 1 月月均溫', source_ids: ['S14'], basis: '中央氣象署每月氣象 2016–2025；僅作背景，未視為箱內平衡溫度。', status_zh: '觀測統計'},
    {key: 'van_speed_kph', value: null, unit: 'km/h', zh: '配送車速度', source_ids: [], basis: '無參考（假設值）。', status_zh: '無參考（假設值）'},
    {key: 'van_energy', value: null, unit: 'Wh', zh: '配送車能源／保留電量', source_ids: [], basis: '無參考（假設值）；非廠商耗能規格。', status_zh: '無參考（假設值）'},
  ],
  plan: {
    sequence: ['ORD-QIMEI', 'ORD-MAGONG'],
    v02ApproachStartMin: 7 * 60 + 45,
    durationsMin: {
      packQimei: 12, packMagong: 10, loadQimei: 8, loadMagong: 7,
      handoverOrigin: 6, handoverQimei: 8, receiveQimei: 10, receiveMagong: 10,
    },
  },
};

// The panel reads these derived rows at runtime so displayed mock values follow
// the actual fixture, including assumptions that have no published reference.
const metadata = BASELINE_FIXTURE.parameterMetadata;
metadata.find(row => row.key === 'temperature_bounds_c').value = BASELINE_FIXTURE.profile.temperatureBoundsC;
BASELINE_FIXTURE.profile.airTemperatureContext = `澎湖 1 月月均溫 ${metadata.find(row => row.key === 'january_air_temperature_c').value} °C [S14]`;
const thermalLabels = {depotCold: '冷庫', packing: '分裝', handling: '交接', vanCold: '冷藏車',
  droneBox: '無人機保冷箱', transferWait: '轉運等待', receiving: '收貨', clinicCold: '衛生所冷藏'};
metadata.find(row => row.key === 'van_speed_kph').value = [...new Set(BASELINE_FIXTURE.routes.filter(route => route.mode === 'road').map(route => route.speedKph))];
metadata.find(row => row.key === 'van_energy').value = BASELINE_FIXTURE.resources.filter(resource => resource.type === 'van')
  .map(resource => `${resource.id} ${resource.initialEnergyWh}／${resource.reserveWh}`);
for (const [key, thermal] of Object.entries(BASELINE_FIXTURE.profile.thermal)) {
  metadata.push({key: `thermal_${key}`, value: thermal.ambientC, unit: '°C', zh: `${thermalLabels[key]}箱內平衡溫度（假設）`,
    source_ids: [], basis: '未認證輕量保冷箱的設計假設，非外氣溫或實測。', status_zh: '無參考（假設值）'},
  {key: `thermal_tau_${key}`, value: thermal.tauMin, unit: 'min', zh: `${thermalLabels[key]}熱平衡時間常數`,
    source_ids: [], basis: '牛頓冷卻模型設計值，未經產品測試。', status_zh: '無參考（假設值）'});
}
for (const resource of BASELINE_FIXTURE.resources) {
  metadata.push({key: `energy_profile_${resource.id}`, value: resource.mockProfile, unit: '', zh: `${resource.id} 待機／作業／移動功率及行駛耗能`,
    source_ids: [], basis: resource.type === 'drone' ? '功率為設計假設；12 Wh/km 與公開航程共同反推電池容量。' : '無參考（假設值）。', status_zh: '無參考（假設值）'});
}
metadata.push({key: 'batch_release_min', value: BASELINE_FIXTURE.batch.availableAtMin, unit: '當日分鐘', zh: '批次放行時間',
  source_ids: ['S1'], basis: '07:00 放行為配送設計值；依校準風場早晨可飛窗口安排，非真實供應商時刻。', status_zh: '設計值'},
{key: 'qimei_deadline_min', value: BASELINE_FIXTURE.orders.find(order => order.id === 'ORD-QIMEI').deadlineMin, unit: '當日分鐘', zh: '七美配送期限',
  source_ids: [], basis: '09:30 為本示範的早診配送需求，未引用真實衛生所班表。', status_zh: '無參考（假設值）'},
{key: 'service_times', value: BASELINE_FIXTURE.plan.durationsMin, unit: 'min', zh: '分裝／裝載／交接／收貨',
  source_ids: [], basis: '情境作業時間，未引用實測服務時間。', status_zh: '無參考（假設值）'});
