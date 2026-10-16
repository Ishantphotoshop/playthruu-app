// The date picker for a log: a bottom sheet with two tabs (Calendar / Wheels) and a typed DD / MM / YYYY box
// under both. Dates run from the game's release (min) to today (max). Resolves through onPick('YYYY-MM-DD').
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function openDatePicker({ value = null, min = null, max = null, onPick }) {
  document.querySelector('.dp-overlay')?.remove();
  const today = day0(new Date());
  const hi = max ? day0(parse(max) || today) : today;
  const lo = min ? day0(parse(min) || new Date(1970, 0, 1)) : new Date(1970, 0, 1);
  let cur = day0(parse(value) || today);
  if (cur > hi) cur = new Date(hi);
  if (cur < lo) cur = new Date(lo);
  let tab = 'cal';
  let view = new Date(cur.getFullYear(), cur.getMonth(), 1);

  const ov = document.createElement('div');
  ov.className = 'dp-overlay';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  const clamp = (d) => (d > hi ? new Date(hi) : d < lo ? new Date(lo) : d);
  const label = (d) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;

  const years = []; for (let y = hi.getFullYear(); y >= lo.getFullYear(); y--) years.push(y);

  function paint() {
    const y = view.getFullYear(), m = view.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7;
    let days = '';
    for (let i = 0; i < first; i++) days += '<span></span>';
    for (let d = 1; d <= dim(y, m); d++) {
      const dt = new Date(y, m, d);
      const off = dt > hi || dt < lo;
      const cls = `${dt.getTime() === today.getTime() ? ' is-today' : ''}${dt.getTime() === cur.getTime() ? ' is-sel' : ''}`;
      days += `<button type="button" class="dp-d${cls}" data-d="${d}" ${off ? 'disabled' : ''}>${d}</button>`;
    }
    if (!ov.firstChild) ov.innerHTML = '<div class="dp-sheet" role="dialog" aria-label="Pick a date"><div class="dp-grab"></div><div class="dp-top"><button type="button" class="dp-x" data-a="cancel">Cancel</button><b>Date</b><button type="button" class="dp-ok" data-a="ok">Done</button></div><div class="dp-in"></div></div>';
    ov.querySelector('.dp-in').innerHTML = `
        <div class="dp-big">${esc(label(cur))}</div>
        <div class="dp-tabs"><button type="button" class="${tab === 'cal' ? 'on' : ''}" data-t="cal">Calendar</button><button type="button" class="${tab === 'wheel' ? 'on' : ''}" data-t="wheel">Wheels</button></div>
        ${tab === 'cal' ? `
          <div class="dp-mh"><button type="button" data-a="prev" aria-label="Previous month">&lsaquo;</button><b>${MON[m]} ${y}</b><button type="button" data-a="next" aria-label="Next month">&rsaquo;</button></div>
          <div class="dp-wd">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
          <div class="dp-dg">${days}</div>` : `
          <div class="dp-wheels"><div class="dp-w" data-k="d"></div><div class="dp-w dp-w--m" data-k="m"></div><div class="dp-w" data-k="y"></div></div>`}
        <div class="dp-type"><input data-i="d" inputmode="numeric" maxlength="2" placeholder="DD" value="${cur.getDate()}"><input data-i="m" inputmode="numeric" maxlength="2" placeholder="MM" value="${cur.getMonth() + 1}"><input data-i="y" inputmode="numeric" maxlength="4" placeholder="YYYY" value="${cur.getFullYear()}"></div>
        <div class="dp-hint">or type any date</div>
`;
    if (tab === 'wheel') wheels();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function setDate(d, { redraw = true } = {}) {
    cur = clamp(day0(d));
    view = new Date(cur.getFullYear(), cur.getMonth(), 1);
    if (redraw) paint();
  }

  function wheels() {
    const wd = ov.querySelector('[data-k=d]'), wm = ov.querySelector('[data-k=m]'), wy = ov.querySelector('[data-k=y]');
    const n = dim(cur.getFullYear(), cur.getMonth());
    wd.innerHTML = Array.from({ length: 31 }, (_, i) => `<div${i + 1 > n ? ' style="opacity:.25"' : ''}>${i + 1}</div>`).join('');
    wm.innerHTML = MON.map((x) => `<div>${x}</div>`).join('');
    wy.innerHTML = years.map((y) => `<div>${y}</div>`).join('');
    let lock = true;
    const place = () => { wd.scrollTop = (cur.getDate() - 1) * 40; wm.scrollTop = cur.getMonth() * 40; wy.scrollTop = years.indexOf(cur.getFullYear()) * 40; };
    place(); setTimeout(() => { lock = false; }, 80);
    let t;
    const read = () => {
      if (lock) return;
      const yy = years[Math.min(Math.round(wy.scrollTop / 40), years.length - 1)];
      const mm = Math.min(Math.round(wm.scrollTop / 40), 11);
      const dd = Math.min(Math.round(wd.scrollTop / 40) + 1, dim(yy, mm));
      const nd = clamp(new Date(yy, mm, dd));
      if (nd.getTime() === cur.getTime()) return;
      const monthChanged = nd.getMonth() !== cur.getMonth() || nd.getFullYear() !== cur.getFullYear();
      cur = nd; view = new Date(cur.getFullYear(), cur.getMonth(), 1);
      ov.querySelector('.dp-big').textContent = label(cur);
      ov.querySelectorAll('.dp-type input').forEach((i) => { i.value = i.dataset.i === 'd' ? cur.getDate() : i.dataset.i === 'm' ? cur.getMonth() + 1 : cur.getFullYear(); });
      if (monthChanged) {
        const k = dim(cur.getFullYear(), cur.getMonth());
        [...wd.children].forEach((c, i) => { c.style.opacity = i + 1 > k ? '.25' : ''; });
      }
    };
    [wd, wm, wy].forEach((w) => w.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(read, 90); }, { passive: true }));
  }

  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const t = e.target.closest('[data-t]');
    if (t) { tab = t.dataset.t; paint(); return; }
    const d = e.target.closest('[data-d]');
    if (d) { setDate(new Date(view.getFullYear(), view.getMonth(), +d.dataset.d)); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') close();
    else if (a === 'prev') { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); paint(); }
    else if (a === 'next') { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); paint(); }
    else if (a === 'ok') { onPick?.(iso(cur)); close(); }
  });
  // Swipe the month grid left or right to go to the next or previous month (a sideways flick; up and down is left alone).
  let sx = 0, sy = 0, sw = false;
  ov.addEventListener('pointerdown', (e) => { sw = tab === 'cal' && !!e.target.closest('.dp-wd, .dp-dg, .dp-mh'); sx = e.clientX; sy = e.clientY; });
  ov.addEventListener('pointerup', (e) => {
    if (!sw) return; sw = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
    const step = dx < 0 ? 1 : -1;
    view = new Date(view.getFullYear(), view.getMonth() + step, 1);
    paint();
    const g = ov.querySelector('.dp-dg, .dp-wd'); void g;
    ov.querySelectorAll('.dp-wd, .dp-dg').forEach((n) => n.animate([{ transform: `translateX(${step * 36}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' }));
  });
  ov.addEventListener('input', (e) => {
    if (!e.target.dataset.i) return;
    const v = (k) => +ov.querySelector(`[data-i=${k}]`).value;
    const dd = v('d'), mm = v('m'), yy = v('y');
    if (dd > 0 && mm > 0 && mm < 13 && yy >= lo.getFullYear() && yy <= hi.getFullYear() && dd <= dim(yy, mm - 1)) {
      const nd = new Date(yy, mm - 1, dd);
      if (nd >= lo && nd <= hi) {
        cur = nd; view = new Date(yy, mm - 1, 1);
        ov.querySelector('.dp-big').textContent = label(cur);
        // keep the typing field as it is; only the other views follow
        const grid = ov.querySelector('.dp-dg');
        if (grid) { paint(); const f = ov.querySelector(`[data-i=${e.target.dataset.i}]`); f?.focus(); const l = f?.value.length || 0; f?.setSelectionRange?.(l, l); }
      }
    }
  });
  paint();
}
