const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };

export function isValidModelBaseUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

/** Extend the app-owned settings adapter; credentials never leave this browser except its chosen endpoint. */
export function appendOpsSettings(container, {opsStore, testConnection}) {
  const root = el('section'); root.className = 'ops-settings';
  root.append(el('h3', '情境'));
  const reset = el('button', '重設情境'); reset.type = 'button';
  reset.addEventListener('click', () => { opsStore.reset(); location.reload(); }); root.append(reset, el('h3', 'AI 模型'));
  const fields = {};
  for (const [key, caption, placeholder, type] of [
    ['baseUrl', 'Base URL', 'https://api.openai.com/v1', 'url'],
    ['model', '模型', 'gpt-6.1-sol', 'text'],
    ['apiKey', '金鑰（選填）', '', 'password'],
  ]) {
    const label = el('label', caption), input = el('input');
    input.type = type; input.placeholder = placeholder; input.value = opsStore.get().ai[key];
    input.autocomplete = 'off'; input.setAttribute('aria-label', caption);
    input.addEventListener('change', () => opsStore.set({ai: {...opsStore.get().ai, [key]: input.value.trim(), enableThinking: false}}));
    fields[key] = input; label.append(input); root.append(label);
  }
  const label = el('label', '模式'), mode = el('select'); mode.setAttribute('aria-label', 'AI 模式');
  for (const [id, caption] of [['auto', '自動'], ['replay', '示範回放'], ['live', '即時模型'], ['rule', '規則排程']]) {
    const option = el('option', caption); option.value = id; mode.append(option);
  }
  mode.value = opsStore.get().ai.mode ?? 'auto';
  mode.addEventListener('change', () => opsStore.set({ai: {...opsStore.get().ai, mode: mode.value}}));
  label.append(mode); root.append(label);
  const test = el('button', '測試連線'), status = el('output'); test.type = 'button'; status.setAttribute('role', 'status');
  test.addEventListener('click', async () => {
    // Capture even fields the user is still editing when they press the button.
    const ai = {...opsStore.get().ai, ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()])), enableThinking: false};
    opsStore.set({ai});
    if (!isValidModelBaseUrl(ai.baseUrl)) { status.textContent = '模型網址格式不正確'; return; }
    test.disabled = true; status.textContent = '測試中…';
    try { await testConnection(ai); status.textContent = '連線成功'; }
    catch (error) { status.textContent = `連線失敗：${error.message}`; }
    finally { test.disabled = false; }
  });
  root.append(test, status, el('p', '金鑰只儲存在此瀏覽器。網址與模型提示文字不會作為預設值儲存。'));
  container.append(root);
  return root;
}
