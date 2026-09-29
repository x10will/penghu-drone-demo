// Two-state sheet controller. No routing, iframe or application-state dependency.
// Pair with bottom-sheet.css; callers supply the live one-line summary.
export function createBottomSheet(sheet, media = matchMedia('(max-width:700px)')) {
  const toggle = sheet.querySelector('[data-sheet-toggle]');
  const body = sheet.querySelector('[data-sheet-body]');
  const summary = sheet.querySelector('[data-sheet-summary]');
  body.tabIndex = -1;
  let expanded = false;
  function setExpanded(value) {
    expanded = media.matches && value;
    if (!expanded && media.matches && body.contains(document.activeElement)) toggle.focus();
    sheet.dataset.expanded = String(expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? '收合航線面板' : '展開航線面板');
    body.inert = media.matches && !expanded;
  }
  const click = () => setExpanded(!expanded);
  const escape = event => { if (event.key === 'Escape' && expanded) { setExpanded(false); event.stopPropagation(); } };
  const resize = () => {
    const toggleFocused = document.activeElement === toggle;
    setExpanded(false);
    if (!media.matches && toggleFocused) body.focus();
  };
  toggle.addEventListener('click', click);
  sheet.addEventListener('keydown', escape);
  media.addEventListener('change', resize);
  setExpanded(false);
  return {
    collapse: () => setExpanded(false),
    setSummary: text => { summary.textContent = text; },
    destroy() {
      toggle.removeEventListener('click', click);
      sheet.removeEventListener('keydown', escape);
      media.removeEventListener('change', resize);
      body.inert = false;
    },
  };
}
