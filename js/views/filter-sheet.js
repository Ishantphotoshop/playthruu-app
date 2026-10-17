// The shared filter pop-up (same look as Browse and the log pages): categories on the left, choices on the right,
// Reset and Show below. cats = [{ id, label, options: [[value, text], ...] }]; values/defaults are { id: value } maps.
import { iconClose } from '../components.js';

export function openFilterSheet({ cats, values, defaults, onApply, showLabel = 'Show' }) {
  document.querySelector('.browse-filters[data-generic]')?.remove();
  const draft = { ...values };
  let cat = cats[0].id;
  const sheet = document.createElement('div');
  sheet.className = 'browse-filters';
  sheet.dataset.generic = '1';
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.__dismiss = close;
  const differs = (k) => String(draft[k]) !== String(defaults[k]);
  const opt = (k, v, name) => `<button type="button" class="bf-opt" data-k="${k}" data-v="${v}"><span class="bf-mark bf-mark--radio${String(draft[k]) === String(v) ? ' is-on' : ''}"></span><span class="bf-opt__name">${name}</span></button>`;
  const paint = () => {
    const c = cats.find((x) => x.id === cat);
    sheet.innerHTML = `
      <div class="browse-filters__top">
        <button type="button" class="browse-filters__icon" data-act="close" aria-label="Close">${iconClose()}</button>
        <h2>Filters</h2>
      </div>
      <div class="bf-split">
        <nav class="bf-side">${cats.map((x) => `<button type="button" class="bf-cat${x.id === cat ? ' is-on' : ''}" data-cat="${x.id}"><span>${x.label}</span>${differs(x.id) ? '<i aria-label="set"></i>' : ''}</button>`).join('')}</nav>
        <div class="bf-pane">${c.options.map(([v, t]) => opt(c.id, v, t)).join('')}</div>
      </div>
      <div class="bf-foot">
        <button type="button" class="bf-reset" data-act="reset"${cats.some((x) => differs(x.id)) ? '' : ' disabled'}>Reset</button>
        <button type="button" class="bf-show" data-act="apply">${showLabel}</button>
      </div>`;
  };
  sheet.addEventListener('click', (e) => {
    const el = e.target.closest('[data-k],[data-cat],[data-act]');
    if (!el) return;
    if (el.dataset.cat) cat = el.dataset.cat;
    else if (el.dataset.k) draft[el.dataset.k] = el.dataset.v;
    else if (el.dataset.act === 'reset') Object.assign(draft, defaults);
    else if (el.dataset.act === 'close') { close(); return; }
    else if (el.dataset.act === 'apply') { close(); onApply({ ...draft }); return; }
    paint();
  });
  paint();
}
