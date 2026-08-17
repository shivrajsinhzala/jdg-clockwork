/* JDG Clockwork — styles.
 *
 * Two families of surface, deliberately styled differently:
 *
 *  - Extension surfaces (HUD, insights overlay, guard, popup) live in shadow
 *    roots and follow the user's theme setting. Light is the default.
 *  - Injected portal panels (top-bar chip, dashboard cards, attendance strip)
 *    live in the portal's own DOM and always match the portal's light look, so
 *    they read as part of the page rather than as something bolted on.
 */
(function (root) {
  'use strict';

  /* Swap these two lines to restyle every surface at once. */
  var FONTS = `
    --font-ui: "Segoe UI Variable Text", "Segoe UI", Inter, system-ui, -apple-system,
               "Helvetica Neue", Arial, sans-serif;
    --font-display: "Segoe UI Variable Display", "Segoe UI Semibold", "Segoe UI",
               Inter, system-ui, -apple-system, sans-serif;
    --font-num: "Cascadia Mono", ui-monospace, "SF Mono", "Segoe UI Mono",
               Consolas, "Roboto Mono", monospace;
  `;

  var LIGHT = `
    --bg: #ffffff;
    --bg-soft: #f8fafc;
    --bg-lift: #f1f5f9;
    --line: #e3e8ef;
    --line-soft: #eef2f7;
    --txt: #0f172a;
    --txt-dim: #52627a;
    --txt-faint: #94a3b8;
    --ok: #047857;
    --ok-bg: #ecfdf5;
    --warn: #b45309;
    --warn-bg: #fffbeb;
    --bad: #b91c1c;
    --bad-bg: #fef2f2;
    --accent: #0369a1;
    --accent-bg: #f0f9ff;
    --shadow: 0 10px 34px rgba(15, 23, 42, .10), 0 2px 6px rgba(15, 23, 42, .04);
  `;

  var DARK = `
    --bg: #0f1720;
    --bg-soft: #16212d;
    --bg-lift: #1d2b3a;
    --line: #263647;
    --line-soft: #1e2b3a;
    --txt: #e6edf5;
    --txt-dim: #8fa3b8;
    --txt-faint: #63788f;
    --ok: #34d399;
    --ok-bg: rgba(52, 211, 153, .12);
    --warn: #fbbf24;
    --warn-bg: rgba(251, 191, 36, .12);
    --bad: #f87171;
    --bad-bg: rgba(248, 113, 113, .12);
    --accent: #38bdf8;
    --accent-bg: rgba(56, 189, 248, .12);
    --shadow: 0 18px 48px rgba(2, 8, 16, .55);
  `;

  /* Applied to the themed root element inside each shadow tree. */
  var THEME = `
    :host { ${FONTS} }
    .jdg-root { ${LIGHT} ${FONTS} }
    .jdg-root[data-theme="dark"] { ${DARK} }
    * { box-sizing: border-box; }
  `;

  var HUD = THEME + `
    :host {
      position: fixed; right: 18px; bottom: 18px;
      z-index: 2147483000; all: initial;
    }
    .wrap {
      width: 296px;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: var(--shadow);
      color: var(--txt);
      overflow: hidden;
      font-family: var(--font-ui);
      font-size: 13px; line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .wrap.collapsed .body, .wrap.collapsed .foot { display: none; }

    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      background: var(--bg-soft);
      border-bottom: 1px solid var(--line-soft);
      cursor: grab; user-select: none;
    }
    .head:active { cursor: grabbing; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--txt-faint); flex: none; }
    .dot.working { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-bg); animation: pulse 2.4s infinite; }
    .dot.break   { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-bg); }
    .dot.done    { background: var(--accent); }
    .dot.late    { background: var(--bad); box-shadow: 0 0 0 3px var(--bad-bg); }
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }

    .title {
      font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
      color: var(--txt-faint); font-weight: 700; flex: 1; font-family: var(--font-display);
    }
    .iconbtn {
      all: unset; cursor: pointer; color: var(--txt-faint);
      width: 22px; height: 22px; display: grid; place-items: center;
      border-radius: 6px; font-size: 13px; line-height: 1;
    }
    .iconbtn:hover { background: var(--bg-lift); color: var(--txt); }

    .body { padding: 13px 12px; }

    .hero { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
    .hero .big {
      font-family: var(--font-num); font-size: 26px; font-weight: 600;
      letter-spacing: -.03em; font-variant-numeric: tabular-nums;
    }
    .hero .unit { font-size: 11.5px; color: var(--txt-dim); }
    .hero.ok .big { color: var(--ok); }
    .hero.warn .big { color: var(--warn); }
    .hero.bad .big { color: var(--bad); }
    .caption { font-size: 11.5px; color: var(--txt-dim); margin-bottom: 11px; }
    .caption b { color: var(--txt); font-weight: 600; }

    .bar { height: 6px; border-radius: 99px; background: var(--bg-lift); overflow: hidden; margin-bottom: 4px; }
    .bar > i { display: block; height: 100%; border-radius: 99px; transition: width .6s cubic-bezier(.4,0,.2,1); }
    .bar > i.ok { background: var(--ok); }
    .bar > i.warn { background: var(--warn); }
    .barlabels {
      display: flex; justify-content: space-between; font-size: 10px;
      color: var(--txt-faint); margin-bottom: 12px;
      font-family: var(--font-num); font-variant-numeric: tabular-nums;
    }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .cell { background: var(--bg-soft); border: 1px solid var(--line-soft); border-radius: 9px; padding: 7px 9px; }
    .cell .k { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--txt-faint); font-weight: 600; }
    .cell .v {
      font-family: var(--font-num); font-size: 13.5px; font-weight: 600;
      font-variant-numeric: tabular-nums; margin-top: 2px; color: var(--txt);
    }
    .cell .v.bad { color: var(--bad); }
    .cell .v.warn { color: var(--warn); }
    .cell .v.ok { color: var(--ok); }

    .foot { display: flex; gap: 6px; padding: 0 12px 12px; }
    .btn {
      all: unset; flex: 1; text-align: center; cursor: pointer;
      padding: 7px 0; border-radius: 8px; font-size: 11.5px; font-weight: 600;
      background: var(--bg-soft); color: var(--txt-dim); border: 1px solid var(--line);
    }
    .btn:hover { color: var(--txt); background: var(--bg-lift); }
    .btn.primary { background: var(--accent-bg); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
  `;

  var OVERLAY = THEME + `
    :host { all: initial; }
    .scrim {
      position: fixed; inset: 0; z-index: 2147483100;
      background: rgba(15, 23, 42, .42);
      backdrop-filter: blur(5px);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 26px 20px; overflow: auto;
      font-family: var(--font-ui);
    }
    .jdg-root[data-theme="dark"] .scrim { background: rgba(6, 11, 18, .72); }
    .panel {
      width: min(1120px, 100%);
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: var(--shadow);
      color: var(--txt);
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .ohead {
      display: flex; align-items: center; gap: 12px;
      padding: 15px 20px; border-bottom: 1px solid var(--line);
      background: var(--bg-soft); position: sticky; top: 0; z-index: 2;
    }
    .ohead h1 { all: unset; font-family: var(--font-display); font-size: 15px; font-weight: 700; letter-spacing: -.015em; }
    .ohead .sub { font-size: 11.5px; color: var(--txt-faint); }
    .spacer { flex: 1; }
    .ctl {
      all: unset; cursor: pointer; font-size: 12px; color: var(--txt-dim);
      background: var(--bg); border: 1px solid var(--line);
      padding: 6px 11px; border-radius: 8px; font-family: var(--font-ui);
    }
    .ctl:hover { color: var(--txt); background: var(--bg-lift); }
    select.ctl option { background: var(--bg); color: var(--txt); }
    .obody { padding: 18px 20px 26px; }

    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(152px, 1fr)); gap: 10px; margin-bottom: 20px; }
    .tile { background: var(--bg-soft); border: 1px solid var(--line); border-radius: 12px; padding: 12px 13px; }
    .tile .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .09em; color: var(--txt-faint); font-weight: 700; }
    .tile .v {
      font-family: var(--font-num); font-size: 21px; font-weight: 600;
      margin-top: 4px; letter-spacing: -.035em; font-variant-numeric: tabular-nums; color: var(--txt);
    }
    .tile .s { font-size: 11px; color: var(--txt-dim); margin-top: 3px; line-height: 1.4; }
    .tile .v.ok { color: var(--ok); } .tile .v.warn { color: var(--warn); } .tile .v.bad { color: var(--bad); }

    .card { background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 15px 16px 11px; margin-bottom: 16px; }
    .card > h2 { all: unset; display: block; font-family: var(--font-display); font-size: 12.5px; font-weight: 700; margin-bottom: 3px; color: var(--txt); }
    .card > .hint { font-size: 11.5px; color: var(--txt-dim); margin-bottom: 13px; line-height: 1.5; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 880px) { .two { grid-template-columns: 1fr; } }

    table.tbl { width: 100%; border-collapse: collapse; font-size: 12px; font-family: var(--font-num); font-variant-numeric: tabular-nums; }
    table.tbl th {
      text-align: right; font-family: var(--font-ui); font-size: 9.5px; text-transform: uppercase;
      letter-spacing: .08em; color: var(--txt-faint); padding: 6px 8px;
      border-bottom: 1px solid var(--line); font-weight: 700;
    }
    table.tbl th:first-child, table.tbl td:first-child { text-align: left; }
    table.tbl td { text-align: right; padding: 7px 8px; border-bottom: 1px solid var(--line-soft); color: var(--txt-dim); }
    table.tbl td.strong { color: var(--txt); font-weight: 600; }
    table.tbl tr:hover td { background: var(--bg-soft); }
    .pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 10.5px; font-weight: 700; font-family: var(--font-ui); }
    .pill.ok { background: var(--ok-bg); color: var(--ok); }
    .pill.warn { background: var(--warn-bg); color: var(--warn); }
    .pill.bad { background: var(--bad-bg); color: var(--bad); }

    .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--txt-dim); margin-top: 8px; }
    .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }

    .loading { padding: 60px 0; text-align: center; color: var(--txt-dim); font-size: 13px; }
    .spinner { width: 22px; height: 22px; margin: 0 auto 12px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    svg text { font-family: var(--font-ui); }
  `;

  var GUARD = THEME + `
    :host { all: initial; }
    .scrim {
      position: fixed; inset: 0; z-index: 2147483200;
      background: rgba(15, 23, 42, .45); backdrop-filter: blur(4px);
      display: grid; place-items: center; font-family: var(--font-ui);
    }
    .box {
      width: 392px; background: var(--bg); border: 1px solid var(--line);
      border-radius: 16px; box-shadow: var(--shadow); color: var(--txt); overflow: hidden;
    }
    .top { padding: 20px 20px 0; }
    .icn { font-size: 24px; }
    h2 { all: unset; display: block; font-family: var(--font-display); font-size: 16px; font-weight: 700; margin: 8px 0 6px; }
    p { margin: 0 0 13px; font-size: 13px; color: var(--txt-dim); line-height: 1.55; }
    p b { color: var(--txt); }
    .num {
      background: var(--bg-soft); border: 1px solid var(--line-soft); border-radius: 10px;
      padding: 10px 13px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;
    }
    .num .k { font-size: 10px; color: var(--txt-faint); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
    .num .v { font-family: var(--font-num); font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .num .v.bad { color: var(--bad); }
    .num .v.ok { color: var(--ok); }
    .acts { display: flex; gap: 8px; padding: 14px 20px 18px; }
    .btn {
      all: unset; cursor: pointer; flex: 1; text-align: center; padding: 10px 0;
      border-radius: 10px; font-size: 12.5px; font-weight: 600; border: 1px solid var(--line);
    }
    .btn.stay { background: var(--ok-bg); color: var(--ok); border-color: color-mix(in srgb, var(--ok) 28%, transparent); }
    .btn.go { background: transparent; color: var(--txt-faint); }
    .btn.go:hover { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
  `;

  /* ------------------------------------------------------------------------
   * Injected into the portal's own <head>. Namespaced .jdgc-*, tuned to the
   * Rubick template already in place: white .box cards, #2d3748 ink, 6px radii.
   * ---------------------------------------------------------------------- */
  var PORTAL = `
    .jdgc {
      --p-txt: #2d3748;
      --p-dim: #64748b;
      --p-faint: #94a3b8;
      --p-line: #e6ebf2;
      --p-soft: #f7f9fc;
      --p-ok: #047857;
      --p-ok-bg: #ecfdf5;
      --p-warn: #b45309;
      --p-warn-bg: #fffbeb;
      --p-bad: #b91c1c;
      --p-bad-bg: #fef2f2;
      --p-accent: #0369a1;
      --p-accent-bg: #f0f9ff;
      --p-num: "Cascadia Mono", ui-monospace, "SF Mono", "Segoe UI Mono", Consolas, "Roboto Mono", monospace;
      box-sizing: border-box;
    }
    .jdgc *, .jdgc *::before, .jdgc *::after { box-sizing: border-box; }
    .jdgc-num { font-family: var(--p-num); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }

    /* ---- top-bar chip, present on every portal page ---- */
    .jdgc-chip {
      display: inline-flex; align-items: center; gap: 9px;
      background: #fff; border: 1px solid var(--p-line); border-radius: 8px;
      padding: 6px 12px 6px 10px; margin-right: 12px; cursor: pointer;
      box-shadow: 0 3px 20px rgba(0,0,0,.043);
      color: var(--p-txt); line-height: 1.2; white-space: nowrap;
      transition: border-color .15s, box-shadow .15s;
    }
    .jdgc-chip:hover { border-color: #cbd5e1; box-shadow: 0 4px 22px rgba(0,0,0,.08); }
    .jdgc-chip .jdgc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--p-faint); flex: none; }
    .jdgc-chip.is-working .jdgc-dot { background: var(--p-ok); box-shadow: 0 0 0 3px var(--p-ok-bg); }
    .jdgc-chip.is-break   .jdgc-dot { background: var(--p-warn); box-shadow: 0 0 0 3px var(--p-warn-bg); }
    .jdgc-chip.is-late    .jdgc-dot { background: var(--p-bad); box-shadow: 0 0 0 3px var(--p-bad-bg); }
    .jdgc-chip.is-done    .jdgc-dot { background: var(--p-accent); }
    .jdgc-chip .jdgc-k { font-size: 9px; text-transform: uppercase; letter-spacing: .09em; color: var(--p-faint); font-weight: 700; display: block; }
    .jdgc-chip .jdgc-v { font-size: 14px; font-weight: 600; display: block; margin-top: 1px; }
    .jdgc-chip .jdgc-v.ok { color: var(--p-ok); }
    .jdgc-chip .jdgc-v.warn { color: var(--p-warn); }
    .jdgc-chip .jdgc-v.bad { color: var(--p-bad); }
    .jdgc-chip .jdgc-sep { width: 1px; height: 24px; background: var(--p-line); }
    @media (max-width: 767px) { .jdgc-chip .jdgc-opt { display: none; } }

    /* ---- one-click pause button, top bar ---- */
    .jdgc-quick {
      display: inline-flex; align-items: center; gap: 7px;
      background: #fff; border: 1px solid var(--p-line); border-radius: 8px;
      padding: 8px 13px; margin-right: 10px; cursor: pointer;
      box-shadow: 0 3px 20px rgba(0,0,0,.043);
      font-family: inherit; font-size: 12.5px; font-weight: 600;
      color: var(--p-txt); white-space: nowrap; line-height: 1.2;
      transition: border-color .15s, background .15s, box-shadow .15s;
    }
    .jdgc-quick:hover { border-color: #cbd5e1; box-shadow: 0 4px 22px rgba(0,0,0,.08); }
    .jdgc-quick .jdgc-ic { font-size: 12px; opacity: .75; }
    .jdgc-quick.is-resume { background: var(--p-ok-bg); border-color: #a7f3d0; color: var(--p-ok); }
    .jdgc-quick.is-resume:hover { border-color: #6ee7b7; }
    .jdgc-quick.is-out { background: var(--p-warn-bg); border-color: #fde68a; color: var(--p-warn); }
    .jdgc-quick.is-out:hover { border-color: #fcd34d; }

    /* ---- generic injected card ---- */
    .jdgc-card { background: #fff; border-radius: 6px; box-shadow: 0 3px 20px rgba(0,0,0,.043); padding: 18px 20px; color: var(--p-txt); }
    .jdgc-card h3 {
      font-size: 11px; text-transform: uppercase; letter-spacing: .09em;
      color: var(--p-faint); font-weight: 700; margin: 0 0 2px;
    }
    .jdgc-card .jdgc-sub { font-size: 12px; color: var(--p-dim); margin-bottom: 14px; }

    /* ---- dashboard "today" panel ---- */
    .jdgc-today { display: flex; align-items: stretch; gap: 26px; flex-wrap: wrap; }
    .jdgc-today .jdgc-main { min-width: 208px; }
    .jdgc-hero { font-size: 34px; font-weight: 600; line-height: 1.05; letter-spacing: -.035em; }
    .jdgc-hero.ok { color: var(--p-ok); } .jdgc-hero.warn { color: var(--p-warn); } .jdgc-hero.bad { color: var(--p-bad); }
    .jdgc-herolbl { font-size: 11.5px; color: var(--p-dim); margin-top: 4px; }
    .jdgc-herolbl b { color: var(--p-txt); font-weight: 600; }
    .jdgc-stats { display: flex; gap: 22px; flex-wrap: wrap; align-content: center; }
    .jdgc-stat .jdgc-k { font-size: 9px; text-transform: uppercase; letter-spacing: .09em; color: var(--p-faint); font-weight: 700; }
    .jdgc-stat .jdgc-val { font-size: 17px; font-weight: 600; margin-top: 2px; }
    .jdgc-stat .jdgc-val.ok { color: var(--p-ok); } .jdgc-stat .jdgc-val.warn { color: var(--p-warn); } .jdgc-stat .jdgc-val.bad { color: var(--p-bad); }
    .jdgc-prog { flex: 1 1 220px; min-width: 200px; display: flex; flex-direction: column; justify-content: center; }
    .jdgc-track { height: 8px; border-radius: 99px; background: #eef2f7; overflow: hidden; }
    .jdgc-track > i { display: block; height: 100%; border-radius: 99px; transition: width .6s cubic-bezier(.4,0,.2,1); }
    .jdgc-track > i.ok { background: var(--p-ok); } .jdgc-track > i.warn { background: var(--p-warn); }
    .jdgc-tracklbl { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--p-faint); margin-top: 6px; }

    /* ---- attendance page summary strip ---- */
    .jdgc-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 0; }
    .jdgc-strip .jdgc-cellx { padding: 2px 18px; border-left: 1px solid var(--p-line); }
    .jdgc-strip .jdgc-cellx:first-child { border-left: 0; padding-left: 0; }
    .jdgc-strip .jdgc-k { font-size: 9px; text-transform: uppercase; letter-spacing: .09em; color: var(--p-faint); font-weight: 700; }
    .jdgc-strip .jdgc-val { font-size: 20px; font-weight: 600; margin-top: 3px; letter-spacing: -.03em; }
    .jdgc-strip .jdgc-val.ok { color: var(--p-ok); } .jdgc-strip .jdgc-val.warn { color: var(--p-warn); } .jdgc-strip .jdgc-val.bad { color: var(--p-bad); }
    .jdgc-strip .jdgc-note { font-size: 10.5px; color: var(--p-dim); margin-top: 2px; }

    .jdgc-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
    .jdgc-head .jdgc-grow { flex: 1; }
    .jdgc-btn {
      background: #fff; border: 1px solid var(--p-line); color: var(--p-dim);
      border-radius: 7px; padding: 6px 12px; font-size: 11.5px; font-weight: 600;
      cursor: pointer; white-space: nowrap; font-family: inherit;
    }
    .jdgc-btn:hover { color: var(--p-txt); border-color: #cbd5e1; }
    .jdgc-btn.on { background: var(--p-accent-bg); color: var(--p-accent); border-color: #bae6fd; }

    /* ---- decorations applied to the portal's own attendance table ---- */
    tr.jdgc-row-late > td { background: var(--p-bad-bg) !important; }
    tr.jdgc-row-early > td { background: var(--p-warn-bg) !important; }
    tr.jdgc-row-today > td { box-shadow: inset 0 0 0 9999px rgba(3,105,161,.045); }
    td.jdgc-delta, th.jdgc-delta { text-align: center !important; font-family: var(--p-num); font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    td.jdgc-delta.pos { color: var(--p-ok); }
    td.jdgc-delta.neg { color: var(--p-bad); }
    td.jdgc-delta.zero { color: var(--p-faint); }

    /* ---- calendar day tinting on the dashboard ---- */
    .fc-daygrid-day.jdgc-cal-late .fc-daygrid-day-number { color: var(--p-bad) !important; font-weight: 700; }
    .fc-daygrid-day.jdgc-cal-ontime .fc-daygrid-day-number { color: var(--p-ok) !important; font-weight: 700; }
    /* The bolt lives in the day-number row, not the frame: event chips fill the
       frame and were painting straight over it (5 Aug 2026 had a birthday). */
    .fc-daygrid-day.jdgc-cal-early .fc-daygrid-day-top { position: relative; }
    .fc-daygrid-day.jdgc-cal-early .fc-daygrid-day-top::before {
      content: "⚡"; position: absolute; left: 2px; top: 0;
      font-size: 10px; line-height: 1.4; opacity: .85; pointer-events: none;
    }

    .jdgc-tag {
      display: inline-block; padding: 1px 8px; border-radius: 99px;
      font-size: 10px; font-weight: 700; vertical-align: 1px;
      background: var(--p-soft); color: var(--p-dim);
    }
    #jdgc-planner .jdgc-btn, #jdgc-regular .jdgc-btn { align-self: center; }

    .jdgc-legend { display: flex; gap: 15px; flex-wrap: wrap; font-size: 10.5px; color: var(--p-dim); margin-top: 12px; }
    .jdgc-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  `;

  root.JDG_STYLES = { HUD: HUD, OVERLAY: OVERLAY, GUARD: GUARD, PORTAL: PORTAL, FONTS: FONTS, LIGHT: LIGHT, DARK: DARK };
})(typeof self !== 'undefined' ? self : this);
