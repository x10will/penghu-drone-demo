/** Three operations jobs share state and switch by a full page reload. */
export const SCENARIOS = [
  {id: 'plan', param: 'plan', title: '規劃', blurb: '編輯訂單、運具並驗證與採用排程。'},
  {id: 'monitor', param: null, title: '監控', blurb: '播放採用方案，未採用時播放今日基準計畫。'},
  {id: 'risk', param: 'risk', title: '風險', blurb: '調整共同風險情境並試算無人機航線。'},
];

/** Unknown values are refused; legacy URLs resolve to the new jobs. */
export function resolveScenario(search) {
  const requested = new URLSearchParams(search || '').get('scenario') || '';
  const id = ({'': 'monitor', delivery: 'monitor', drone: 'risk', hazard: 'risk'})[requested] ?? requested;
  const scenario = SCENARIOS.find(item => item.id === id);
  return scenario ? {scenario}
    : {error: `不認得的檢查「${requested}」；為避免把錯誤連結當成另一項檢查播放，本頁不載入模擬。`};
}

/** Link to another check on the same page; switching is a full reload. */
export function scenarioHref(target, href) {
  const url = new URL(href);
  if (target.param === null) url.searchParams.delete('scenario');
  else url.searchParams.set('scenario', target.param);
  url.hash = '';
  return url.href;
}
