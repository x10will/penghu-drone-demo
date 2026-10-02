/** The daily page runs one check at a time; the URL names it (default: delivery). */
export const SCENARIOS = [
  {id: 'delivery', param: null, title: '配送計畫', blurb: '今日兩筆訂單、三台運具的整日配送與冷鏈。'},
  {id: 'drone', param: 'drone', title: '無人機航線', blurb: '選起降點與時段，試算避開風險場的航線並模擬飛行。'},
  {id: 'hazard', param: 'hazard', title: '風險場', blurb: '看合成風險場隨時間的變化與禁飛區。'},
];

/** Strict: an unknown or empty value is refused, never played as another check. */
export function resolveScenario(search) {
  const params = new URLSearchParams(search || '');
  if (!params.has('scenario')) return {scenario: SCENARIOS[0]};
  const requested = params.get('scenario');
  const scenario = SCENARIOS.find(item => item.param !== null && item.param === requested);
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
