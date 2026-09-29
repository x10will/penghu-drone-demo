// OSMF interactive-map pattern: initial credit, then a persistent licence button.
// The map and optional same-origin iframe are owned by the caller.
export function initMapCredit(credit, map, iframe) {
  const toggle = credit.querySelector('.credit-toggle');
  const intro = credit.querySelector('.credit-intro');
  const extra = credit.querySelector('.credit-extra');
  const panel = credit.querySelector('.credit-full');
  const close = credit.querySelector('.credit-close');
  const doc = credit.ownerDocument;
  const listeners = [];
  let frameDoc, timer;
  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function collapse(restoreFocus = false) {
    clearTimeout(timer);
    const focused = credit.contains(doc.activeElement);
    credit.dataset.creditState = 'collapsed';
    intro.hidden = panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus || focused) toggle.focus({preventScroll:true});
  }
  function open() {
    clearTimeout(timer);
    credit.dataset.creditState = 'open';
    intro.hidden = true;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    close.focus({preventScroll:true});
  }
  function escape(event) {
    if (event.key === 'Escape' && !panel.hidden) {
      collapse(true);
      event.stopPropagation();
    }
  }
  function mapInteraction(event) {
    // Legend and attribution controls are overlays, not map gestures.
    if (event.currentTarget === map && event.target.closest?.('.map-overlays')) return;
    collapse();
  }
  function attachFrame() {
    if (!iframe?.contentDocument || iframe.contentDocument === frameDoc) return;
    frameDoc = iframe.contentDocument;
    for (const type of ['pointerdown', 'wheel', 'touchstart']) listen(frameDoc, type, mapInteraction, {capture:true,passive:true});
    listen(frameDoc, 'keydown', escape, true);
  }
  function fitIntro() {
    if (intro.hidden) return;
    extra.hidden = false;
    extra.hidden = intro.scrollWidth > intro.clientWidth;
  }
  const start = () => { if (credit.dataset.creditState === 'intro') timer = setTimeout(() => collapse(), 5000); };
  if (doc.readyState === 'complete') start();
  else listen(doc.defaultView, 'load', start, {once:true});
  listen(toggle, 'click', () => panel.hidden ? open() : collapse(true));
  listen(close, 'click', () => collapse(true));
  listen(doc, 'keydown', escape, true);
  listen(doc, 'pointerdown', event => { if (!panel.hidden && !credit.contains(event.target)) collapse(); }, true);
  for (const type of ['pointerdown', 'wheel', 'touchstart']) listen(map, type, mapInteraction, {capture:true,passive:true});
  if (iframe) listen(iframe, 'load', attachFrame);
  attachFrame();
  const resize = new ResizeObserver(fitIntro);
  resize.observe(map);
  fitIntro();
  return () => {
    clearTimeout(timer);
    resize.disconnect();
    for (const remove of listeners) remove();
  };
}
