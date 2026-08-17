/* JDG Clockwork — hand-rolled SVG charts (no libraries: extension CSP forbids CDNs). */
(function (root) {
  'use strict';

  var PALETTES = {
    light: {
      ok: '#059669', warn: '#d97706', bad: '#dc2626',
      accent: '#0284c7', accent2: '#7c3aed',
      line: '#e3e8ef', dim: '#94a3b8', txt: '#475569',
      band: 'rgba(220,38,38,.045)'
    },
    dark: {
      ok: '#34d399', warn: '#fbbf24', bad: '#f87171',
      accent: '#38bdf8', accent2: '#a78bfa',
      line: '#263647', dim: '#63788f', txt: '#8fa3b8',
      band: 'rgba(248,113,113,.06)'
    }
  };

  // Mutated in place so every chart function keeps its reference to `C`.
  var C = {};
  function setTheme(name) {
    var p = PALETTES[name] || PALETTES.light;
    for (var k in p) C[k] = p[k];
  }
  setTheme('light');

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function svg(w, h, inner) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h +
      '" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible">' + inner + '</svg>';
  }

  function txt(x, y, s, opts) {
    opts = opts || {};
    return '<text x="' + x + '" y="' + y + '" fill="' + (opts.fill || C.dim) +
      '" font-size="' + (opts.size || 9) + '" text-anchor="' + (opts.anchor || 'start') +
      '"' + (opts.weight ? ' font-weight="' + opts.weight + '"' : '') + '>' + esc(s) + '</text>';
  }

  function line(x1, y1, x2, y2, color, opts) {
    opts = opts || {};
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
      '" stroke="' + color + '" stroke-width="' + (opts.w || 1) + '"' +
      (opts.dash ? ' stroke-dasharray="' + opts.dash + '"' : '') +
      (opts.opacity ? ' opacity="' + opts.opacity + '"' : '') + '/>';
  }

  function rect(x, y, w, h, fill, r) {
    if (h < 0) { y += h; h = -h; }
    return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + Math.max(0, h) +
      '" fill="' + fill + '" rx="' + (r == null ? 2 : r) + '"/>';
  }

  function tip(label) { return '<title>' + esc(label) + '</title>'; }

  /* ------------------------------------------------- clock-in timeline ---- */
  /**
   * One dot per working day: y is the actual clock-in time, with the shift
   * start and the grace cutoff drawn as reference lines. A 5-day moving mean
   * shows whether the habit is drifting.
   */
  function clockInChart(days, cfg, fmtClock) {
    var pts = days.filter(function (d) { return d.clockIn != null; });
    var W = 900, H = 250, P = { t: 14, r: 12, b: 26, l: 52 };
    if (!pts.length) return svg(W, H, txt(W / 2, H / 2, 'No clock-in data in this range', { anchor: 'middle' }));

    var ins = pts.map(function (d) { return d.clockIn; });
    var lo = Math.min.apply(null, ins.concat([cfg.shiftStart - 10]));
    var hi = Math.max.apply(null, ins.concat([cfg.shiftStart + cfg.graceMinutes + 10]));
    var pad = Math.max(10, (hi - lo) * 0.12);
    lo -= pad; hi += pad;

    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var X = function (i) { return P.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw); };
    var Y = function (v) { return P.t + ih - ((v - lo) / (hi - lo)) * ih; };

    var s = '';

    // y gridlines every 15 minutes
    var step = (hi - lo) > 180 ? 60 : 15;
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      s += line(P.l, Y(t), W - P.r, Y(t), C.line, { opacity: .45 });
      s += txt(P.l - 8, Y(t) + 3, fmtClock(t), { anchor: 'end' });
    }

    // reference bands
    s += rect(P.l, Y(cfg.shiftStart + cfg.graceMinutes), iw, Y(lo) - Y(cfg.shiftStart + cfg.graceMinutes), C.band, 0);
    s += line(P.l, Y(cfg.shiftStart), W - P.r, Y(cfg.shiftStart), C.ok, { w: 1.5, dash: '5 4', opacity: .85 });
    s += txt(W - P.r, Y(cfg.shiftStart) - 5, 'shift start ' + fmtClock(cfg.shiftStart), { anchor: 'end', fill: C.ok });
    s += line(P.l, Y(cfg.shiftStart + cfg.graceMinutes), W - P.r, Y(cfg.shiftStart + cfg.graceMinutes), C.bad, { w: 1.5, dash: '5 4', opacity: .7 });
    s += txt(W - P.r, Y(cfg.shiftStart + cfg.graceMinutes) - 5, '"Late" cutoff', { anchor: 'end', fill: C.bad });

    // 5-day moving mean
    var mv = [];
    for (var i = 0; i < pts.length; i++) {
      var a = Math.max(0, i - 4), sum = 0, n = 0;
      for (var j = a; j <= i; j++) { sum += pts[j].clockIn; n++; }
      mv.push(sum / n);
    }
    var path = mv.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
    s += '<path d="' + path + '" fill="none" stroke="' + C.accent + '" stroke-width="1.8" opacity=".55" stroke-linejoin="round"/>';

    // dots
    pts.forEach(function (d, i) {
      var late = d.lateBy || 0;
      var col = late === 0 ? C.ok : (late >= cfg.graceMinutes ? C.bad : C.warn);
      s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(d.clockIn).toFixed(1) + '" r="3.4" fill="' + col + '">' +
        tip(d.date + ' · in ' + fmtClock(d.clockIn) + (late ? ' · ' + late + ' min late' : ' · on time')) + '</circle>';
    });

    // x labels: first, middle, last
    [0, Math.floor(pts.length / 2), pts.length - 1].forEach(function (i, k) {
      if (i < 0 || i >= pts.length) return;
      s += txt(X(i), H - 8, pts[i].date.slice(0, 5), { anchor: k === 0 ? 'start' : (k === 2 ? 'end' : 'middle') });
    });

    return svg(W, H, s);
  }

  /* ---------------------------------------------- hours worked, diverging -- */
  /** Bars show minutes above/below the 8h requirement — the shape of the debt. */
  function hoursChart(days, cfg) {
    var pts = days.filter(function (d) { return d.total != null && d.total > 0; });
    var W = 900, H = 210, P = { t: 14, r: 12, b: 24, l: 46 };
    if (!pts.length) return svg(W, H, txt(W / 2, H / 2, 'No completed days in this range', { anchor: 'middle' }));

    var devs = pts.map(function (d) { return d.total - cfg.requiredMinutes; });
    var mx = Math.max(30, Math.max.apply(null, devs.map(Math.abs)));
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var mid = P.t + ih / 2;
    var bw = Math.max(2, Math.min(16, iw / pts.length - 2));
    var X = function (i) { return P.l + (i + .5) * (iw / pts.length) - bw / 2; };
    var Yv = function (v) { return (v / mx) * (ih / 2); };

    var s = '';
    [-mx, -mx / 2, 0, mx / 2, mx].forEach(function (v) {
      var y = mid - Yv(v);
      s += line(P.l, y, W - P.r, y, C.line, { opacity: v === 0 ? 1 : .4 });
      s += txt(P.l - 8, y + 3, (v > 0 ? '+' : '') + Math.round(v) + 'm', { anchor: 'end' });
    });
    s += txt(P.l - 8, mid - 12, '8h', { anchor: 'end', fill: C.txt, weight: 600 });

    pts.forEach(function (d, i) {
      var dev = d.total - cfg.requiredMinutes;
      var col = dev >= 0 ? C.ok : (d.earlyExit ? C.bad : C.warn);
      s += '<g>' + rect(X(i), mid, bw, -Yv(dev), col, 2) +
        tip(d.date + ' · worked ' + Math.floor(d.total / 60) + 'h' + ('0' + (d.total % 60)).slice(-2) +
          ' · ' + (dev >= 0 ? '+' : '') + dev + ' min' + (d.earlyExit ? ' · Early Exit' : '')) + '</g>';
    });

    [0, pts.length - 1].forEach(function (i, k) {
      s += txt(X(i) + bw / 2, H - 6, pts[i].date.slice(0, 5), { anchor: k === 0 ? 'start' : 'end' });
    });
    return svg(W, H, s);
  }

  /* -------------------------------------------------- weekday profile ----- */
  /** Which day of the week actually costs you — usually not the one you think. */
  function dowChart(summary, cfg) {
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var rows = summary.byDow.filter(function (b) { return b.n > 0; });
    var W = 420, H = 200, P = { t: 10, r: 40, b: 10, l: 40 };
    if (!rows.length) return svg(W, H, txt(W / 2, H / 2, 'No data', { anchor: 'middle' }));

    // Median, not mean: a single 10 a.m. arrival should not redraw the whole week.
    var mx = Math.max.apply(null, rows.map(function (b) { return b.median || 0; }));
    mx = Math.max(mx, 5);
    var iw = W - P.l - P.r;
    var rh = (H - P.t - P.b) / rows.length;
    var s = '';

    rows.forEach(function (b, i) {
      var med = b.median || 0;
      var y = P.t + i * rh + rh / 2;
      var w = (med / mx) * iw;
      var col = med === 0 ? C.ok : (med >= cfg.graceMinutes ? C.bad : C.warn);
      s += txt(P.l - 8, y + 3, names[b.dow], { anchor: 'end', fill: C.txt });
      s += rect(P.l, y - rh * .3, iw, rh * .6, 'rgba(255,255,255,.03)', 4);
      s += '<g>' + rect(P.l, y - rh * .3, w, rh * .6, col, 4) +
        tip(names[b.dow] + ' · median ' + med.toFixed(0) + ' min late over ' + b.n + ' days · ' + b.hardLate + ' flagged Late') + '</g>';
      s += txt(P.l + iw + 6, y + 3, med.toFixed(0) + 'm', { anchor: 'start', fill: col, weight: 600 });
    });

    // grace marker
    if (cfg.graceMinutes <= mx) {
      var gx = P.l + (cfg.graceMinutes / mx) * iw;
      s += line(gx, P.t, gx, H - P.b, C.bad, { dash: '3 3', opacity: .5 });
    }
    return svg(W, H, s);
  }

  /* ------------------------------------------------ arrival histogram ----- */
  /** Distribution of "late by" in 5-minute buckets. */
  function lateHistogram(days, cfg) {
    var work = days.filter(function (d) { return d.clockIn != null; });
    var W = 420, H = 200, P = { t: 12, r: 10, b: 26, l: 30 };
    if (!work.length) return svg(W, H, txt(W / 2, H / 2, 'No data', { anchor: 'middle' }));

    // Everything past 60 minutes collapses into one tail bucket, so a single
    // odd arrival cannot stretch the axis into uselessness.
    var CAP = 60;
    var buckets = {}, maxB = 0;
    work.forEach(function (d) {
      var v = d.lateBy || 0;
      var b = v >= CAP ? CAP : Math.floor(v / 5) * 5;
      buckets[b] = (buckets[b] || 0) + 1;
      if (b > maxB) maxB = b;
    });
    var keys = [];
    for (var b = 0; b <= maxB; b += 5) keys.push(b);

    var mx = Math.max.apply(null, keys.map(function (k) { return buckets[k] || 0; }));
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var bw = Math.max(3, iw / keys.length - 3);
    var s = '';

    s += line(P.l, H - P.b, W - P.r, H - P.b, C.line);
    keys.forEach(function (k, i) {
      var n = buckets[k] || 0;
      var h = (n / mx) * ih;
      var x = P.l + i * (iw / keys.length);
      var col = k === 0 ? C.ok : (k >= cfg.graceMinutes ? C.bad : C.warn);
      var label = k === 0 ? 'On time' : (k >= CAP ? '60+ min late' : k + '–' + (k + 4) + ' min late');
      s += '<g>' + rect(x, H - P.b - h, bw, h, col, 3) +
        tip(label + ' · ' + n + ' day' + (n === 1 ? '' : 's')) + '</g>';
      if (n) s += txt(x + bw / 2, H - P.b - h - 4, n, { anchor: 'middle', fill: col, weight: 600 });
      if (i % 2 === 0) s += txt(x + bw / 2, H - 8, k >= CAP ? '60+' : k, { anchor: 'middle' });
    });
    s += txt(W - P.r, H - 8, 'min late', { anchor: 'end', fill: C.dim });
    return svg(W, H, s);
  }

  root.JDG_CHARTS = {
    colors: C,
    setTheme: setTheme,
    clockInChart: clockInChart,
    hoursChart: hoursChart,
    dowChart: dowChart,
    lateHistogram: lateHistogram
  };
})(typeof self !== 'undefined' ? self : this);
