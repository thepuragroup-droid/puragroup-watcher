/** The whole stylesheet, inlined into every page (one request, no build step). */
export const CSS = /* css */ `
:root {
  color-scheme: light;
  --ground: #EDF0EE;
  --surface: #FFFFFF;
  --surface-2: #F5F7F6;
  --line: #D9DFDB;
  --line-strong: #C2CBC6;
  --ink: #16201D;
  --ink-2: #3F4D48;
  --ink-3: #5B6964;
  --shell: #123A35;
  --shell-2: #1A4A43;
  --shell-line: #2A5A52;
  --shell-ink: #EAF2EF;
  --shell-ink-2: #A8C4BC;
  --accent: #1D5C53;
  --accent-ink: #FFFFFF;
  --focus: #2F8F80;
  --pass: #2E8B62;
  --slow: #C88A12;
  --fail: #C2372D;
  --none: #CBD3CF;
  --pass-wash: #E5F2EB;  --pass-ink: #1D6646;
  --slow-wash: #FBF2DE;  --slow-ink: #7E5A08;
  --fail-wash: #FBEAE8;  --fail-ink: #9C271F;
  --series: #1D5C53;
  --series-band: rgba(29, 92, 83, 0.13);
  --fail-band: rgba(194, 55, 45, 0.10);
  --grid: #E6EAE8;
  --shadow-pop: 0 6px 20px rgba(18, 38, 33, 0.16), 0 1px 3px rgba(18, 38, 33, 0.10);
  --radius: 8px;
  --radius-sm: 6px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "DejaVu Sans Mono", "Liberation Mono", monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ground: #0E1412;
    --surface: #151D1A;
    --surface-2: #1A2420;
    --line: #26312D;
    --line-strong: #34423C;
    --ink: #E3ECE8;
    --ink-2: #B4C3BD;
    --ink-3: #8E9E98;
    --shell: #0A231F;
    --shell-2: #113029;
    --shell-line: #1F3F38;
    --shell-ink: #E3EEEA;
    --shell-ink-2: #93B3AA;
    --accent: #5DB6A2;
    --accent-ink: #0A1F1B;
    --focus: #6FC7B3;
    --pass: #3DAA7A;
    --slow: #DDA431;
    --fail: #E2574B;
    --none: #34413B;
    --pass-wash: #14281F;  --pass-ink: #7FD1A9;
    --slow-wash: #2A2312;  --slow-ink: #EBC46E;
    --fail-wash: #2E1715;  --fail-ink: #F2958C;
    --series: #6CC1AD;
    --series-band: rgba(108, 193, 173, 0.16);
    --fail-band: rgba(226, 87, 75, 0.16);
    --grid: #202A26;
    --shadow-pop: 0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.4);
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font: 14px/1.5 var(--font);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  scrollbar-color: var(--line-strong) transparent;
}
::selection { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
a { color: inherit; text-underline-offset: 3px; text-decoration-thickness: 1px; }
input { caret-color: var(--accent); accent-color: var(--accent); }
h1, h2, h3 { margin: 0; line-height: 1.25; text-wrap: balance; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.muted { color: var(--ink-3); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---------- Shell ---------- */
.topbar {
  background: var(--shell);
  color: var(--shell-ink);
  border-bottom: 1px solid var(--shell-line);
}
.topbar-inner {
  max-width: 1360px; margin: 0 auto; padding: 0 24px;
  min-height: 60px; display: flex; align-items: center; gap: 24px;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 15px; text-decoration: none; white-space: nowrap; }
.brand svg { flex: none; }
.fleet { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 14px; padding-left: 24px; border-left: 1px solid var(--shell-line); }
.fleet-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fleet-text b { font-weight: 600; }
.fleet .dot { width: 9px; height: 9px; }
.topbar-meta { margin-left: auto; display: flex; align-items: center; gap: 16px; color: var(--shell-ink-2); font-size: 13px; white-space: nowrap; }
.topbar form { margin: 0; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 34px; padding: 0 14px; border-radius: var(--radius-sm);
  font: 600 13px/1 var(--font); cursor: pointer; text-decoration: none; white-space: nowrap;
  border: 1px solid transparent; transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.btn:disabled, .btn[aria-busy="true"] { cursor: progress; opacity: .7; }
.btn-shell { background: var(--shell-2); color: var(--shell-ink); border-color: var(--shell-line); }
.btn-shell:hover:not(:disabled) { background: var(--shell-line); }
.btn-primary { background: var(--accent); color: var(--accent-ink); }
.btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, var(--ink)); }
.btn-quiet { background: var(--surface); color: var(--ink); border-color: var(--line-strong); }
.btn-quiet:hover { border-color: var(--ink-3); }
.btn .spin { display: none; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
.btn[aria-busy="true"] .spin { display: inline-block; }
.btn[aria-busy="true"] .btn-icon { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }

.container { max-width: 1360px; margin: 0 auto; padding: 24px 24px 64px; }

.banner {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 12px 14px; margin-bottom: 20px; border-radius: var(--radius);
  background: var(--slow-wash); color: var(--slow-ink); border: 1px solid color-mix(in srgb, var(--slow) 35%, transparent);
}
.banner.is-fail { background: var(--fail-wash); color: var(--fail-ink); border-color: color-mix(in srgb, var(--fail) 35%, transparent); }
.banner svg { flex: none; margin-top: 2px; }
.banner p { margin: 0; }

/* ---------- Toolbar ---------- */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.toolbar h2 { font-size: 16px; font-weight: 650; }
.tabs { display: inline-flex; padding: 3px; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.tabs a {
  display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 5px;
  color: var(--ink-2); text-decoration: none; font-size: 13px; font-weight: 550;
  transition: background-color .15s ease, color .15s ease;
}
.tabs a:hover { color: var(--ink); background: var(--surface-2); }
.tabs a[aria-current="page"] { background: var(--accent); color: var(--accent-ink); }
.legend { display: flex; flex-wrap: wrap; gap: 14px; color: var(--ink-3); font-size: 12.5px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { display: inline-block; width: 3px; height: 12px; border-radius: 1px; }

/* ---------- Status ---------- */
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--none); }
.is-up .dot, .dot.is-up { background: var(--pass); }
.is-down .dot, .dot.is-down { background: var(--fail); box-shadow: 0 0 0 3px color-mix(in srgb, var(--fail) 22%, transparent); }
.is-unknown .dot, .dot.is-unknown { background: var(--none); }
.status { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; white-space: nowrap; }
.status.is-up { color: var(--pass-ink); }
.status.is-down { color: var(--fail-ink); }
.status.is-unknown { color: var(--ink-3); }
.pill { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; border-radius: 999px; font-weight: 600; font-size: 13px; }
.pill.is-up { background: var(--pass-wash); color: var(--pass-ink); }
.pill.is-down { background: var(--fail-wash); color: var(--fail-ink); }
.pill.is-unknown { background: var(--surface-2); color: var(--ink-3); }

/* ---------- Panels & tables ---------- */
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.panel + .section, .section + .section { margin-top: 32px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.panel-head h2 { font-size: 15px; font-weight: 650; }
.panel-head p { margin: 0; color: var(--ink-3); font-size: 13px; }
.panel-body { padding: 16px; }

table { width: 100%; border-collapse: collapse; }
th {
  text-align: left; font-weight: 600; font-size: 12px; color: var(--ink-3);
  padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--surface-2); white-space: nowrap;
}
th:first-child { border-top-left-radius: var(--radius); }
th:last-child { border-top-right-radius: var(--radius); }
td { padding: 12px 16px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
.num { text-align: right; white-space: nowrap; }

/* Sites table */
.sites td { padding-top: 16px; padding-bottom: 16px; }
.sites tbody tr { cursor: pointer; transition: background-color .15s ease; }
.sites tbody tr:hover { background: var(--surface-2); }
.sites tbody tr.is-down { background: color-mix(in srgb, var(--fail-wash) 55%, var(--surface)); }
.sites tbody tr.is-down:hover { background: var(--fail-wash); }
.site-name { font-weight: 650; font-size: 15px; text-decoration: none; display: block; }
.site-name:hover { text-decoration: underline; }
.site-host { color: var(--ink-3); font-size: 12.5px; }
.col-status { width: 88px; }
.col-site { width: 168px; }
.col-ribbon { min-width: 280px; }
.col-uptime { width: 92px; }
.col-resp { width: 130px; }
.col-latest { width: 220px; }
.big { font-size: 15px; font-weight: 650; }
.sub { display: block; color: var(--ink-3); font-size: 12.5px; }
.latest { font-size: 13px; }
.latest .sub { max-width: 220px; }
.cause-sub { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.uptime-low { color: var(--fail-ink); }
.uptime-mid { color: var(--slow-ink); }

/* ---------- The tick ribbon (signature) ---------- */
.ribbon { position: relative; padding-bottom: 18px; }
.ribbon svg { display: block; width: 100%; height: 40px; overflow: visible; }
.ribbon rect { shape-rendering: geometricPrecision; }
.ribbon .t-up { fill: var(--pass); }
.ribbon .t-slow { fill: var(--slow); }
.ribbon .t-partial { fill: var(--fail); opacity: .55; }
.ribbon .t-down { fill: var(--fail); }
.ribbon .t-none { fill: var(--none); }
.ribbon .hover-col { fill: var(--ink-2); opacity: .45; }
.ribbon-axis { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; display: flex; justify-content: space-between; color: var(--ink-3); font-size: 11px; line-height: 14px; pointer-events: none; }
.outage {
  position: absolute; bottom: 14px; height: 0; border-top: 2px solid var(--fail);
  pointer-events: none;
}
.outage::before, .outage::after { content: ""; position: absolute; top: -6px; width: 2px; height: 6px; background: var(--fail); }
.outage::before { left: 0; } .outage::after { right: 0; }
.outage span {
  position: absolute; top: 1px; left: 50%; transform: translateX(-50%);
  font-size: 11px; font-weight: 650; color: var(--fail-ink); white-space: nowrap;
  background: var(--surface); padding: 0 4px; line-height: 13px; border-radius: 3px;
}
.outage.at-end span { left: auto; right: -2px; transform: none; }
.outage.at-start span { left: -2px; transform: none; }
.sites tbody tr:hover .outage span { background: var(--surface-2); }
.sites tbody tr.is-down .outage span { background: transparent; }

/* Tooltip readout */
.tip {
  position: fixed; z-index: 50; pointer-events: none; min-width: 168px;
  background: var(--surface); color: var(--ink); border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm); box-shadow: var(--shadow-pop);
  padding: 8px 10px; font-size: 12.5px; line-height: 1.45;
  opacity: 0; transform: translateY(2px); transition: opacity .12s ease, transform .12s ease;
}
.tip.is-on { opacity: 1; transform: none; }
.tip b { font-weight: 650; }
.tip .row { display: flex; justify-content: space-between; gap: 16px; }
.tip .k { color: var(--ink-3); }

/* ---------- Incidents & log ---------- */
.state-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.state-tag.is-open { color: var(--fail-ink); }
.state-tag.is-closed { color: var(--ink-3); }
.cause { color: var(--ink-2); font-size: 13px; max-width: 520px; overflow-wrap: anywhere; }
.code { font-family: var(--mono); font-size: 12.5px; }
.code.bad { color: var(--fail-ink); font-weight: 600; }
.log td { padding-top: 9px; padding-bottom: 9px; font-size: 13px; }
.log tr.is-fail td { background: color-mix(in srgb, var(--fail-wash) 60%, transparent); }
.log tr.is-slow td { background: color-mix(in srgb, var(--slow-wash) 55%, transparent); }
.res { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px; white-space: nowrap; }
.res.ok { color: var(--pass-ink); } .res.slow { color: var(--slow-ink); } .res.fail { color: var(--fail-ink); }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 13px; }

.scroll-x { overflow-x: auto; }
.show-sm { display: none; }
.empty { padding: 28px 16px; text-align: center; color: var(--ink-3); }
.empty strong { display: block; color: var(--ink-2); font-weight: 600; margin-bottom: 2px; }

/* ---------- Site page ---------- */
.crumbs { font-size: 13px; color: var(--ink-3); margin-bottom: 10px; }
.crumbs a { color: var(--ink-2); }
.site-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.site-head h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.site-head .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 8px; color: var(--ink-3); font-size: 13px; }
.site-head .meta a { color: var(--ink-2); }
.site-actions { display: flex; gap: 8px; }

.stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); margin: 0; }
.stats div { padding: 14px 16px; border-left: 1px solid var(--line); }
.stats div:first-child { border-left: 0; }
.stats dt { color: var(--ink-3); font-size: 12px; font-weight: 600; }
.stats dd { margin: 2px 0 0; font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
.stats dd small { font-size: 12.5px; font-weight: 500; color: var(--ink-3); letter-spacing: 0; }

.chart { position: relative; padding: 8px 16px 28px 56px; }
.chart svg { display: block; width: 100%; height: 220px; overflow: hidden; }
.chart .p50 { fill: none; stroke: var(--series); stroke-width: 1.75; stroke-linejoin: round; }
.chart .p95 { fill: none; stroke: var(--series); stroke-width: 1; opacity: .45; stroke-linejoin: round; }
.chart .fail { fill: var(--fail-band); }
.chart .fail-tick { fill: var(--fail); }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .cursor { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0; }
.chart.is-hover .cursor { opacity: 1; }
.y-label { position: absolute; left: 0; width: 48px; white-space: nowrap; text-align: right; color: var(--ink-3); font-size: 11.5px; transform: translateY(-50%); }
.x-labels { position: absolute; left: 56px; right: 16px; bottom: 6px; height: 16px; color: var(--ink-3); font-size: 11.5px; }
.x-labels span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.clip-note { position: absolute; top: 4px; right: 16px; font-size: 11.5px; color: var(--ink-3); background: var(--surface); padding: 0 4px; }
.chart-key { display: flex; gap: 16px; color: var(--ink-3); font-size: 12.5px; }
.chart-key span { display: inline-flex; align-items: center; gap: 6px; }
.chart-key i { display: inline-block; width: 14px; height: 8px; border-radius: 2px; }

.split { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 24px; align-items: start; }
.avail { display: grid; grid-template-columns: repeat(30, minmax(0, 1fr)); gap: 3px; }
.avail i { display: block; height: 22px; border-radius: 2px; background: var(--none); }
.avail i.a-up { background: var(--pass); }
.avail i.a-minor { background: var(--slow); }
.avail i.a-major { background: var(--fail); }
.avail-foot { display: flex; justify-content: space-between; margin-top: 8px; color: var(--ink-3); font-size: 12px; }

.filters { display: flex; gap: 2px; }

.channels { list-style: none; margin: 0; padding: 0; }
.channel { display: grid; grid-template-columns: 112px 1fr; gap: 12px; align-items: baseline; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.channel b { font-weight: 600; }
.channels-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 16px; margin: 0; }
.channels-foot p { margin: 0; font-size: 13px; }

/* ---------- Top nav ---------- */
.topnav { display: flex; gap: 2px; padding-left: 24px; border-left: 1px solid var(--shell-line); }
.topnav a {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 5px;
  color: var(--shell-ink-2); text-decoration: none; font-size: 13.5px; font-weight: 550;
  transition: background-color .15s ease, color .15s ease;
}
.topnav a:hover { color: var(--shell-ink); background: var(--shell-2); }
.topnav a[aria-current="page"] { color: var(--shell-ink); background: var(--shell-2); }

/* ---------- Server errors ---------- */
.errors tbody tr[data-href] { cursor: pointer; transition: background-color .15s ease; }
.errors tbody tr[data-href]:hover { background: var(--surface-2); }
.errors tr.is-regressed td { background: color-mix(in srgb, var(--fail-wash) 55%, var(--surface)); }
.errors td { vertical-align: top; }
.col-prio { width: 76px; }
.errors .col-n { width: 72px; }
.errors .col-seen { width: 116px; }
.errors .col-estatus { width: 116px; }
.errors .col-site { width: 168px; }
.err-cell { min-width: 280px; }
.err-title {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  font-weight: 600; text-decoration: none; overflow-wrap: anywhere;
}
.err-title:hover { text-decoration: underline; }
.err-title.inline { display: inline; -webkit-line-clamp: unset; }
.err-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 4px; color: var(--ink-3); font-size: 12.5px; }
.err-meta .mono { color: var(--ink-2); }
.prio {
  display: inline-flex; align-items: center; justify-content: center; min-width: 40px; height: 24px; padding: 0 6px;
  border-radius: var(--radius-sm); font-weight: 700; font-size: 12.5px; border: 1px solid transparent;
}
.prio.is-crit { background: var(--fail-wash); color: var(--fail-ink); border-color: color-mix(in srgb, var(--fail) 40%, transparent); }
.prio.is-high { background: var(--slow-wash); color: var(--slow-ink); border-color: color-mix(in srgb, var(--slow) 40%, transparent); }
.prio.is-med { background: var(--surface-2); color: var(--ink-2); border-color: var(--line-strong); }
.prio.is-low { background: var(--surface-2); color: var(--ink-3); border-color: var(--line); }
.prio.is-est { border-style: dashed; font-weight: 600; }
.sev { font-size: 12px; font-weight: 650; }
.sev.is-critical { color: var(--fail-ink); }
.sev.is-high { color: var(--slow-ink); }
.sev.is-medium, .sev.is-low { color: var(--ink-3); }
.estatus { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--ink-2); }
.estatus.is-open { color: var(--slow-ink); }
.estatus.is-fix_pending { color: var(--accent); }
.estatus.is-fixed { color: var(--pass-ink); }
.estatus.is-ignored { color: var(--ink-3); }
.estatus.is-regressed { color: var(--fail-ink); }
.tab-n { margin-left: 4px; font-size: 11.5px; opacity: .8; }

.filter-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 12px 16px; margin: 0; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ink-3); }
.field.grow { flex: 1 1 240px; }
.field input, .field select {
  height: 34px; padding: 0 10px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong);
  background: var(--surface); color: var(--ink); font: 14px var(--font);
}
.field input:focus, .field select:focus { outline: 2px solid var(--focus); outline-offset: 0; border-color: transparent; }
.err-sites dt a { color: inherit; }
.foot-note { font-size: 12.5px; margin-top: 12px; }

.err-h1 { font-size: 20px !important; overflow-wrap: anywhere; }
.dd-time { font-size: 15px !important; }
.split-even { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.prose p { margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.prose p:last-child { margin-bottom: 0; }
.files { display: flex; flex-wrap: wrap; gap: 6px; }
.files .mono { background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; }
.copy { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.copy .mono { background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; padding: 3px 8px; overflow-wrap: anywhere; }
.btn-sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
.message {
  margin: 0; padding: 14px 16px; max-height: 360px; overflow: auto;
  font: 12.5px/1.5 var(--mono); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere;
}
.show-md, .show-sm-inline { display: none; }
.status-tabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.status-tabs a { white-space: nowrap; flex: none; }

/* ---------- Login ---------- */
.login { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--shell); }
.login form, .login .card { width: 100%; max-width: 360px; background: var(--surface); border-radius: 10px; padding: 28px; }
.login h1 { font-size: 20px; margin: 14px 0 4px; }
.login .card .btn { width: auto; padding: 0 16px; }
.login p { margin: 0 0 20px; color: var(--ink-3); }
.login label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.login input[type=password] {
  width: 100%; height: 40px; padding: 0 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); font: 14px var(--font);
}
.login input[type=password]:focus { outline: 2px solid var(--focus); outline-offset: 0; border-color: transparent; }
.login .btn { width: 100%; height: 40px; margin-top: 16px; }
.login .err { color: var(--fail-ink); font-size: 13px; margin: 10px 0 0; }

/* ---------- Responsive ---------- */
@media (max-width: 1100px) {
  .col-latest, .sites td.latest-cell { display: none; }
  .errors .hide-md { display: none; }
  .errors .show-md { display: inline; }
  .split-even { grid-template-columns: 1fr; }
  .err-sites { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .err-sites div:nth-child(odd) { border-left: 0; }
  .err-sites div:nth-child(n+3) { border-top: 1px solid var(--line); }
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stats div:nth-child(4) { border-left: 0; }
  .stats div:nth-child(n+4) { border-top: 1px solid var(--line); }
  .split { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .topbar-inner { padding: 10px 16px; flex-wrap: wrap; gap: 8px 16px; }
  .fleet { order: 2; width: 100%; padding-left: 0; border-left: 0; }
  .topnav { padding-left: 0; border-left: 0; margin-left: auto; }
  .errors .hide-sm { display: none; }
  .errors .show-sm-inline { display: inline-flex; }
  .err-cell { min-width: 0; }
  .filter-bar .field { flex: 1 1 140px; }
  .topbar-meta { order: 3; width: 100%; margin-left: 0; }
  .topbar-meta form[data-run] { flex: 1; }
  .topbar-meta form[data-run] .btn { width: 100%; }
  .topbar-meta .last-run { display: none; }
  .show-sm { display: block !important; }
  .container { padding: 16px 16px 48px; }
  .sites thead { display: none; }
  .sites, .sites tbody { display: block; }
  .sites tbody tr {
    display: grid; grid-template-columns: 1fr auto; grid-template-areas: "site uptime" "ribbon ribbon" "status resp" "latest latest";
    gap: 6px 12px; padding: 14px 16px; border-bottom: 1px solid var(--line);
  }
  .sites tbody tr:last-child { border-bottom: 0; }
  .sites td { display: block; padding: 0; border: 0; }
  .sites td.site-cell { grid-area: site; }
  .sites td.ribbon-cell { grid-area: ribbon; }
  .sites td.uptime-cell { grid-area: uptime; text-align: right; }
  .sites td.status-cell { grid-area: status; }
  .sites td.resp-cell { grid-area: resp; text-align: right; }
  .sites td.resp-cell .sub { display: inline; margin-left: 6px; }
  .sites tr.is-down td.latest-cell { display: block; grid-area: latest; }
  .sites tr.is-down .latest .sub { max-width: none; }
  .cause-sm { white-space: normal; font-weight: 400; color: var(--ink-3); margin-top: 2px; overflow-wrap: anywhere; }
  .incidents td { vertical-align: top; }
  .col-ribbon { min-width: 0; }
  .incidents .hide-sm, .log .hide-sm { display: none; }
  .channel { grid-template-columns: 56px 1fr; padding-left: 12px; padding-right: 12px; }
  th, td { padding-left: 12px; padding-right: 12px; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stats div:nth-child(odd) { border-left: 0; }
  .stats div:nth-child(4) { border-left: 1px solid var(--line); }
  .stats div:nth-child(n+3) { border-top: 1px solid var(--line); }
  .avail { grid-template-columns: repeat(15, minmax(0, 1fr)); }
  .chart { padding-left: 44px; padding-right: 8px; }
  .y-label { width: 38px; }
  .x-labels { left: 44px; right: 8px; }
  .x-labels span:nth-child(even) { display: none; }
  .site-head h1 { font-size: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation-duration: 0.01ms !important; }
}
`;
