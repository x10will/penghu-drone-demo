import {resolveScenario, SCENARIOS, scenarioHref} from './scenario.mjs';

const resolved = resolveScenario(location.search);
if (resolved.error) {
  document.title = '無法辨識的檢查｜澎湖疫苗配送模擬';
  const box = document.createElement('section');
  box.className = 'daily-refusal'; box.setAttribute('role', 'alert');
  const text = document.createElement('p'); text.textContent = resolved.error;
  const link = document.createElement('a');
  const monitor = SCENARIOS.find(item => item.id === 'monitor');
  link.textContent = `改開${monitor.title}`; link.href = scenarioHref(monitor, location.href);
  box.append(text, link);
  document.querySelector('#app').replaceChildren(box);
} else {
  try { await import('./daily-app.mjs'); } catch (error) {
    // A failed data fetch used to leave a blank page; say so, unless the app already mounted.
    const app = document.querySelector('#app');
    if (app && !app.children.length) {
      document.title = '載入失敗｜澎湖疫苗配送模擬';
      const box = document.createElement('section');
      box.className = 'daily-refusal'; box.setAttribute('role', 'alert');
      const text = document.createElement('p'); text.textContent = `資料載入失敗：${error?.message ?? error}`;
      const link = document.createElement('a'); link.textContent = '重新載入'; link.href = location.href;
      box.append(text, link); app.replaceChildren(box);
    }
    console.error(error);
  }
}
