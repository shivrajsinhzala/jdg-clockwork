/* JDG Clockwork — the analytics overlay.
 *
 * Renders inside the portal page (not an extension page) so every fetch is
 * same-origin and carries the session cookie.
 */
(function (root) {
  'use strict';

  var J = root.JDG, S = root.JDG_STYLES, CH = root.JDG_CHARTS;
  var host = null, shadow = null, cache = {}, cfg = null, lastDays = null;

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function monthsBack(n) {
    var out = [], d = new Date();
    for (var i = 0; i < n; i++) {
      out.unshift({ month: d.getMonth() + 1, year: d.getFullYear() });
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }

  function loadRange(n) {
    var specs = monthsBack(n);
    var chain = Promise.resolve([]);
    specs.forEach(function (sp) {
      chain = chain.then(function (acc) {
        // Shared cache: finished months are kept for a week, so reopening this
        // panel costs at most one request for the current month.
        return J.month(sp.month, sp.year).then(function (days) {
          return acc.concat(days || []);
        });
      });
    });
    // One row per date, in date order — a day counted twice would inflate
    // every total downstream.
    return chain.then(function (all) {
      var seen = {};
      all.forEach(function (d) { seen[d.date] = d; });
      return Object.keys(seen).map(function (k) { return seen[k]; })
        .sort(function (a, b) { return (a.iso || '') < (b.iso || '') ? -1 : 1; });
    });
  }

  function tile(k, v, s, cls) {
    return '<div class="tile"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v +
      '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  function verdictClass(rate) { return rate >= 0.85 ? 'ok' : rate >= 0.6 ? 'warn' : 'bad'; }

  function monthTable(days) {
    var by = {};
    days.forEach(function (d) {
      if (!d.iso) return;
      var k = d.iso.slice(0, 7);
      (by[k] = by[k] || []).push(d);
    });
    var keys = Object.keys(by).sort().reverse();
    var rows = keys.map(function (k) {
      var s = J.summarize(by[k], cfg);
      if (!s.days) return '';
      var net = s.net;
      var label = new Date(k + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      var cls = verdictClass(s.cleanRate);
      return '<tr>' +
        '<td class="strong">' + label + '</td>' +
        '<td>' + s.days + '</td>' +
        '<td>' + J.fmtClock(cfg.shiftStart + s.medianLate) + '</td>' +
        '<td>' + s.medianLate.toFixed(0) + 'm</td>' +
        '<td><span class="pill ' + cls + '">' + s.hardLate + '</span></td>' +
        '<td>' + s.earlyExits + '</td>' +
        '<td>' + (s.avgWorked != null ? J.fmtDurShort(s.avgWorked) : '—') + '</td>' +
        '<td class="strong" style="color:' + (net >= 0 ? CH.colors.ok : CH.colors.bad) + '">' +
        (net >= 0 ? '+' : '−') + J.fmtDur(Math.abs(net)) + '</td>' +
        '</tr>';
    }).join('');

    return '<table class="tbl"><thead><tr>' +
      '<th>Month</th><th>Days</th><th>Typical in</th><th>Median late</th><th>Late</th>' +
      '<th>Early exits</th><th>Avg worked</th><th>Net vs 8h</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function toCSV(days) {
    var head = ['date', 'weekday', 'status', 'clock_in', 'clock_out', 'late_by_min', 'worked_min', 'worked_hm', 'early_exit'];
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var lines = [head.join(',')];
    days.forEach(function (d) {
      lines.push([
        d.iso || d.date,
        d.dow != null ? names[d.dow] : '',
        '"' + (d.status || '').replace(/"/g, '""') + '"',
        d.clockIn != null ? J.fmtClock(d.clockIn) : '',
        d.clockOut != null ? J.fmtClock(d.clockOut) : '',
        d.lateBy || 0,
        d.total != null ? d.total : '',
        d.total != null ? J.fmtDurShort(d.total) : '',
        d.earlyExit ? 'yes' : 'no'
      ].join(','));
    });
    return lines.join('\n');
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function anomalyCard(s) {
    if (!s.anomalies.length) return '';
    var rows = s.anomalies.slice().sort(function (a, b) { return b.lateBy - a.lateBy; }).map(function (d) {
      var implied = d.clockIn != null ? d.clockIn - d.lateBy : null;
      return '<tr><td class="strong">' + d.date + '</td>' +
        '<td>' + J.fmtClock(d.clockIn) + '</td>' +
        '<td>' + J.fmtDur(d.lateBy) + '</td>' +
        '<td>' + (implied != null ? J.fmtClock(implied) : '—') + '</td>' +
        '<td>' + (d.status || '') + '</td></tr>';
    }).join('');

    return '<div class="card" style="border-color:rgba(251,191,36,.3)">' +
      '<h2>⚠ Rows the portal contradicts itself on</h2>' +
      '<div class="hint">On these days <b style="color:#e6edf5">Late By</b> does not equal your clock-in minus ' +
      J.fmtClock(cfg.shiftStart) + '. They are excluded from every figure above, because averaging them in would ' +
      'misstate your record — but they are still sitting in the portal against your name. The "implied start" ' +
      'column is the shift time the portal must have used.</div>' +
      '<table class="tbl"><thead><tr><th>Date</th><th>Clocked in</th><th>Charged late</th>' +
      '<th>Implied start</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function render(days) {
    lastDays = days;
    var body = shadow.querySelector('.obody');
    var s = J.summarize(days, cfg);
    var net = s.net;

    // Charts read the same clean set the numbers do.
    var anomalySet = {};
    s.anomalies.forEach(function (d) { anomalySet[d.date] = true; });
    var work = days.filter(function (d) {
      return J.isWorkingDay(d) && d.fullDay && !anomalySet[d.date];
    });

    // The single most actionable line: how much earlier you'd have to leave home.
    var fixMinutes = Math.max(5, Math.ceil(s.medianLate / 5) * 5);

    var tiles =
      tile('On-time rate', pct(s.onTimeRate), s.onTime + ' of ' + s.days + ' days at ' + J.fmtClock(cfg.shiftStart) + ' sharp', verdictClass(s.onTimeRate)) +
      tile('Clean rate', pct(s.cleanRate), s.hardLate + ' days flagged "Late"', verdictClass(s.cleanRate)) +
      tile('Typical arrival', J.fmtClock(cfg.shiftStart + s.medianLate), 'median ' + s.medianLate.toFixed(0) + ' min after start') +
      tile('Early exits', s.earlyExits, J.fmtDur(s.minutesShort) + ' short across full days', s.earlyExits ? 'bad' : 'ok') +
      tile('Net vs ' + J.fmtDurShort(cfg.requiredMinutes) + '/day', (net >= 0 ? '+' : '−') + J.fmtDur(Math.abs(net)),
        'across ' + s.totalWorkedN + ' full days — not a balance you can draw on', net >= 0 ? 'ok' : 'bad') +
      tile('Best on-time streak', s.streakBest + 'd', 'current streak ' + s.streakCurrent + 'd', s.streakBest >= 5 ? 'ok' : '') +
      tile('Average day length', s.avgWorked != null ? J.fmtDurShort(s.avgWorked) : '—', 'requirement ' + J.fmtDurShort(cfg.requiredMinutes)) +
      // JDG does not pay overtime. Reported as time given, not credit earned.
      tile('Extra time given', J.fmtDur(s.overtime), 'beyond ' + J.fmtDurShort(cfg.requiredMinutes) + ' — unpaid, not banked');

    var worstDow = s.byDow.slice().filter(function (b) { return b.n >= 3; })
      .sort(function (a, b) { return b.median - a.median; })[0];
    var dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    body.innerHTML =
      '<div class="tiles">' + tiles + '</div>' +

      '<div class="card">' +
      '<h2>Arrival timeline</h2>' +
      '<div class="hint">Every clock-in against your ' + J.fmtClock(cfg.shiftStart) + ' start. The blue line is a 5-day average — if it drifts upward, the habit is slipping, not the day.</div>' +
      CH.clockInChart(work, cfg, J.fmtClock) +
      '<div class="legend">' +
      '<span><i style="background:' + CH.colors.ok + '"></i>On time</span>' +
      '<span><i style="background:' + CH.colors.warn + '"></i>Running late (under ' + cfg.graceMinutes + ' min)</span>' +
      '<span><i style="background:' + CH.colors.bad + '"></i>Flagged "Late"</span>' +
      '<span><i style="background:' + CH.colors.accent + '"></i>5-day average</span>' +
      '</div></div>' +

      '<div class="card">' +
      '<h2>Hours banked vs. owed</h2>' +
      '<div class="hint">Minutes above or below the 8-hour requirement, per day. Red bars are the days the portal stamped ⚡ Early Exit.</div>' +
      CH.hoursChart(work, cfg) +
      '</div>' +

      '<div class="two">' +
      '<div class="card"><h2>Which weekday costs you</h2>' +
      '<div class="hint">Median minutes late, by day of week.' +
      (worstDow ? ' <b style="color:' + CH.colors.txt + '">' + dowNames[worstDow.dow] + '</b> is your weak spot.' : '') + '</div>' +
      CH.dowChart(s, cfg) + '</div>' +
      '<div class="card"><h2>How late, how often</h2>' +
      '<div class="hint">Arrivals bucketed in 5-minute bands.</div>' +
      CH.lateHistogram(work, cfg) + '</div>' +
      '</div>' +

      '<div class="card"><h2>Month by month</h2>' +
      '<div class="hint">Net vs 8h is the balance that actually matters at review time.' +
      (s.partialDays ? ' ' + s.partialDays + ' half/leave day' + (s.partialDays === 1 ? '' : 's') +
        ' held out of the punctuality figures.' : '') + '</div>' +
      monthTable(days) + '</div>' +

      anomalyCard(s) +

      (s.medianLate > 1 ? (function () {
        var wouldBeOnTime = work.filter(function (d) { return (d.lateBy || 0) <= fixMinutes; }).length;
        var eeFixed = work.filter(function (d) {
          return d.earlyExit && d.total != null && (cfg.requiredMinutes - d.total) <= fixMinutes;
        }).length;
        return '<div class="card" style="border-color:rgba(56,189,248,.25)">' +
          '<h2>The one change that fixes this</h2>' +
          '<div class="hint">On a typical day you arrive ' + s.medianLate.toFixed(0) + ' minutes after ' +
          J.fmtClock(cfg.shiftStart) + ', and ' + pct(1 - s.onTimeRate) + ' of days carry some late mark. ' +
          'Leaving home <b style="color:' + CH.colors.accent + '">' + fixMinutes + ' minutes earlier</b> would put ' +
          wouldBeOnTime + ' of these ' + s.days + ' days (' + pct(wouldBeOnTime / Math.max(1, s.days)) +
          ') on time' +
          (eeFixed ? ', and would have erased ' + eeFixed + ' of the ' + s.earlyExits +
            ' early exits outright — those were short by ' + fixMinutes + ' minutes or less' : '') +
          '. The remaining ' + (s.earlyExits - eeFixed) + ' need you to stay later, not arrive earlier; ' +
          'the HUD\'s clock-out target handles those.</div></div>';
      })() : '');

    shadow.querySelector('.csv').onclick = function () {
      download('jdg-attendance-' + new Date().toISOString().slice(0, 10) + '.csv', toCSV(days));
    };
  }

  function load() {
    var n = parseInt(shadow.querySelector('.range').value, 10);
    var body = shadow.querySelector('.obody');
    body.innerHTML = '<div class="loading"><div class="spinner"></div>Pulling ' + n + ' months from the portal…</div>';
    loadRange(n).then(function (days) {
      // Calibrate once against real rows rather than trusting the defaults.
      if (!days.length) throw new Error('logged-out');
      var cal = J.calibrate(days);
      if (cal.shiftStart != null && cal.confidence >= 3) {
        cfg.shiftStart = cal.shiftStart;
        if (cal.graceMinutes) cfg.graceMinutes = cal.graceMinutes;
        J.setSettings({ shiftStart: cfg.shiftStart, graceMinutes: cfg.graceMinutes, calibrated: true });
      }
      render(days);
    }).catch(function (e) {
      body.innerHTML = '<div class="loading">' +
        (e && e.message === 'logged-out'
          ? 'Your portal session expired — sign in again and reopen this.'
          : 'Could not load attendance: ' + (e && e.message ? e.message : e)) + '</div>';
    });
  }

  function close() {
    if (host) { host.remove(); host = null; shadow = null; }
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    if (host) return;
    J.getSettings().then(function (c) {
      cfg = c;
      var theme = J.resolveTheme(cfg);
      CH.setTheme(theme);

      host = document.createElement('div');
      host.id = 'jdg-clockwork-insights';
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<style>' + S.OVERLAY + '</style>' +
        '<div class="jdg-root" data-theme="' + theme + '">' +
        '<div class="scrim">' +
        '<div class="panel">' +
        '<div class="ohead">' +
        '<div><h1>Attendance Insights</h1><div class="sub">JDG Clockwork · read-only view of your own record</div></div>' +
        '<div class="spacer"></div>' +
        '<select class="ctl range">' +
        '<option value="3">Last 3 months</option>' +
        '<option value="6" selected>Last 6 months</option>' +
        '<option value="12">Last 12 months</option>' +
        '</select>' +
        '<button class="ctl themebtn" title="Switch theme">' + (theme === 'dark' ? '☀' : '☾') + '</button>' +
        '<button class="ctl csv">Export CSV</button>' +
        '<button class="ctl close" style="font-size:15px;padding:5px 10px">✕</button>' +
        '</div>' +
        '<div class="obody"></div>' +
        '</div></div></div>';

      document.body.appendChild(host);
      shadow.querySelector('.close').onclick = close;
      shadow.querySelector('.range').onchange = load;
      shadow.querySelector('.themebtn').onclick = function () {
        var next = J.resolveTheme(cfg) === 'dark' ? 'light' : 'dark';
        cfg.theme = next;
        J.setSettings({ theme: next });
        CH.setTheme(next);
        shadow.querySelector('.jdg-root').setAttribute('data-theme', next);
        this.textContent = next === 'dark' ? '☀' : '☾';
        if (lastDays) render(lastDays);
      };
      shadow.querySelector('.scrim').addEventListener('mousedown', function (e) {
        if (e.target === shadow.querySelector('.scrim')) close();
      });
      document.addEventListener('keydown', onKey, true);
      load();
    });
  }

  root.JDG_INSIGHTS = { open: open, close: close };
})(typeof self !== 'undefined' ? self : this);
