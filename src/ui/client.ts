/** Inline client script (no build step). Progressive: every page works without it. */
export const CLIENT_JS = /* js */ `
(() => {
  const tz = document.body.dataset.tz || undefined;
  const fmtTime = new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtHour = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const msText = (v) => v == null ? '—' : v >= 10000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v).toLocaleString('en-CA') + ' ms';

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'status');
  document.body.appendChild(tip);
  let tipOn = false;

  function label(range, start, bucket) {
    if (range === '24h') return fmtTime.format(start);
    if (range === '90d') return fmtDay.format(start);
    return fmtTime.format(start) + '–' + fmtHour.format(start + bucket);
  }
  function stateOf(b) {
    const [, checks, ok, slow] = b;
    if (!checks) return ['No data', ''];
    if (ok === 0) return [checks === 1 ? 'Failed' : 'All checks failed', 'var(--fail-ink)'];
    if (ok < checks) return [(checks - ok) + ' of ' + checks + ' checks failed', 'var(--fail-ink)'];
    if (slow) return [checks === 1 ? 'Passed, slow' : slow + ' slow of ' + checks, 'var(--slow-ink)'];
    return [checks === 1 ? 'Passed' : 'All ' + checks + ' passed', 'var(--pass-ink)'];
  }
  function show(e, html) {
    tip.innerHTML = html;
    tip.classList.add('is-on');
    tipOn = true;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 12;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hide() { tip.classList.remove('is-on'); tipOn = false; }

  function attach(el, onIndex, onLeave) {
    const data = JSON.parse(el.dataset.series || '[]');
    const range = el.dataset.range, bucket = Number(el.dataset.bucket);
    const svg = el.querySelector('svg');
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(data.length - 1, Math.floor(((e.clientX - r.left) / r.width) * data.length)));
      const b = data[i];
      const [state, color] = stateOf(b);
      onIndex(i, data.length);
      show(e, '<b>' + label(range, b[0], bucket) + '</b>' +
        '<div style="color:' + (color || 'var(--ink-3)') + ';font-weight:600">' + state + '</div>' +
        (b[4] != null ? '<div class="row"><span class="k">' + (b[1] === 1 ? 'Response' : 'Median') + '</span><span>' + msText(b[4]) + '</span></div>' : '') +
        (b[5] != null && b[1] > 1 ? '<div class="row"><span class="k">p95</span><span>' + msText(b[5]) + '</span></div>' : ''));
    });
    svg.addEventListener('pointerleave', () => { hide(); onLeave(); });
  }

  document.querySelectorAll('[data-ribbon]').forEach((el) => {
    const col = el.querySelector('.hover-col');
    attach(el, (i) => { col.setAttribute('x', String(i * 3)); col.setAttribute('visibility', 'visible'); },
      () => col.setAttribute('visibility', 'hidden'));
  });
  document.querySelectorAll('[data-chart]').forEach((el) => {
    const cursor = el.querySelector('.cursor');
    attach(el, (i, n) => { const x = ((i + 0.5) / n) * 1000; cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); el.classList.add('is-hover'); },
      () => el.classList.remove('is-hover'));
  });

  // Whole site rows are clickable; real links inside keep working.
  document.querySelectorAll('tr[data-href]').forEach((tr) => {
    tr.addEventListener('click', (e) => { if (!e.target.closest('a, button, form')) location.href = tr.dataset.href; });
  });

  // "Run checks now" takes ~10–20 s: show it working.
  document.querySelectorAll('form[data-run]').forEach((f) => {
    f.addEventListener('submit', () => {
      const b = f.querySelector('button');
      b.setAttribute('aria-busy', 'true');
      b.querySelector('.btn-label').textContent = 'Checking all sites…';
      setTimeout(() => (b.disabled = true), 0);
    });
  });

  // Keep "x min ago" honest without reloading.
  const rel = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 36 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
  };
  const tick = () => document.querySelectorAll('[data-ts]').forEach((el) => { if (el.dataset.ts) el.textContent = rel(Number(el.dataset.ts)); });
  setInterval(tick, 30000);

  // The overview refreshes itself each minute while visible and idle.
  if (document.body.dataset.refresh) {
    setInterval(() => {
      if (document.visibilityState === 'visible' && !tipOn && !document.querySelector('[aria-busy="true"]')) location.reload();
    }, Number(document.body.dataset.refresh) * 1000);
  }
})();
`;
