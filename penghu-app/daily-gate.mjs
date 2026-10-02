import {resolveScenario, SCENARIOS, scenarioHref} from './scenario.mjs';

const resolved = resolveScenario(location.search);
if (resolved.error) {
  document.title = '無法辨識的檢查｜澎湖疫苗配送模擬';
  const box = document.createElement('section');
  box.className = 'daily-refusal'; box.setAttribute('role', 'alert');
  const text = document.createElement('p'); text.textContent = resolved.error;
  const link = document.createElement('a');
  link.textContent = `改開${SCENARIOS[0].title}`; link.href = scenarioHref(SCENARIOS[0], location.href);
  box.append(text, link);
  document.querySelector('#app').replaceChildren(box);
} else await import('./daily-app.mjs');
