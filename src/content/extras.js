/* JDG Clockwork — the planning surfaces.
 *
 *   /dashboard    "Month outlook" — where your hours balance lands, and the
 *                 next leave day that buys a long weekend
 *   /attendance   "Worth raising" — days with a defensible regularization case
 *   /holiday      "Best leave days" — every bridge day ranked by days-off-per-
 *                 day-spent, for the rest of the year
 *
 * Also computes the usual-clock-out median that the Today card's break budget
 * depends on, and publishes it for portal-ui.js to read.
 */
(function (root) {
  'use strict';

  var J = root.JDG, PUMP = root.JDG_PUMP;
  var cfg = null;
  var historyP = null, holidaysP = null;

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* --------------------------------------------------------------- data --- */

  /** Four months is enough to spot the weekend pattern and a stable leave time. */
  function history() {
    if (historyP) return historyP;
    var specs = [], d = new Date();
    for (var i = 0; i < 4; i++) {
      specs.push({ month: d.getMonth() + 1, year: d.getFullYear() });
      d.setMonth(d.getMonth() - 1);
    }
    historyP = Promise.all(specs.map(function (s) {
      return J.fetchMonth(s.month, s.year)
        .then(function (r) { return r.loggedOut ? [] : r.days; })
        .catch(function () { return []; });
    })).then(function (chunks) {
      var seen = {};
      chunks.forEach(function (c) { c.forEach(function (d) { seen[d.date] = d; }); });
      return Object.keys(seen).map(function (k) { return seen[k]; })
        .sort(function (a, b) { return (a.iso || '') < (b.iso || '') ? -1 : 1; });
    });
    return historyP;
  }

  /** This year plus next, so a December lookahead still finds January. */
  function holidays() {
    if (holidaysP) return holidaysP;
    var y = new Date().getFullYear();
    holidaysP = Promise.all([J.fetchHolidays(y), J.fetchHolidays(y + 1)])
      .then(function (rs) {
        var out = [];
        rs.forEach(function (r) { if (!r.loggedOut) out = out.concat(r.holidays); });
        return out;
      }).catch(function () { return []; });
    return holidaysP;
  }

  function context() {
    return Promise.all([history(), holidays()]).then(function (r) {
      var days = r[0], hol = r[1];
      return {
        days: days,
        holidays: hol,
        weekend: J.weekendDays(days),
        usualOut: J.usualClockOut(days)
      };
    });
  }

  /* ------------------------------------------------------------ dashboard -- */

  function stat(k, v, cls, note) {
    return '<div class="jdgc-stat"><div class="jdgc-k">' + k + '</div>' +
      '<div class="jdgc-val jdgc-num ' + (cls || '') + '">' + v + '</div>' +
      (note ? '<div class="jdgc-note" style="font-size:10.5px;color:#64748b;margin-top:2px">' + note + '</div>' : '') +
      '</div>';
  }

  function renderOutlook(ctx) {
    if (!cfg.dashboardCards) return;
    if (!/\/dashboard\/?$/.test(location.pathname) && location.pathname !== '/') return;

    var todayWrap = document.getElementById('jdgc-today-wrap');
    var grid = document.querySelector('.report-box') && document.querySelector('.report-box').closest('.grid');
    if (!todayWrap && !grid) return;

    var todayISO = J.isoToday();
    var ym = todayISO.slice(0, 7);
    var monthDays = ctx.days.filter(function (d) { return d.iso && d.iso.slice(0, 7) === ym; });
    var f = J.forecastMonth(monthDays, cfg, ctx.holidays, ctx.weekend, todayISO);

    var sugg = J.leaveSuggestions(ctx.holidays, ctx.weekend, todayISO, 200, 2);
    var best = sugg[0];

    var monthName = new Date(todayISO + 'T00:00:00')
      .toLocaleDateString(undefined, { month: 'long' });

    var projCls = f.projectedNet >= 0 ? 'ok' : 'bad';
    var sign = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + J.fmtDur(Math.abs(v)); };

    var card = document.getElementById('jdgc-outlook');
    if (!card) {
      var wrap = el('<div class="col-span-12" id="jdgc-outlook-wrap" style="margin-bottom:2px">' +
        '<div class="jdgc jdgc-card" id="jdgc-outlook"></div></div>');
      // Sits directly under the Today card when there is one, otherwise above
      // the portal's own stat boxes.
      if (todayWrap) todayWrap.parentElement.insertBefore(wrap, todayWrap.nextSibling);
      else grid.parentElement.insertBefore(wrap, grid);
      card = wrap.querySelector('#jdgc-outlook');
    }

    card.innerHTML =
      '<h3>Month outlook</h3>' +
      '<div class="jdgc-sub">Projected from the ' + f.daysCounted + ' day' + (f.daysCounted === 1 ? '' : 's') +
      ' you have already completed this month.</div>' +
      '<div class="jdgc-today">' +
      '<div class="jdgc-main">' +
      '<div class="jdgc-hero jdgc-num ' + projCls + '">' + sign(f.projectedNet) + '</div>' +
      '<div class="jdgc-herolbl">is where ' + monthName + ' ends up if the remaining ' +
      f.remainingWorkdays + ' working day' + (f.remainingWorkdays === 1 ? '' : 's') +
      ' look like your usual one.</div>' +
      '</div>' +
      '<div class="jdgc-stats">' +
      stat('Banked so far', sign(f.netSoFar), f.netSoFar >= 0 ? 'ok' : 'bad') +
      stat('Typical day', sign(f.typicalDelta), f.typicalDelta >= 0 ? 'ok' : 'warn', 'vs ' + J.fmtDurShort(cfg.requiredMinutes)) +
      stat('Days left', f.remainingWorkdays, '', 'to ' + J.isoLabel(f.monthEnd)) +
      stat('Early exits', f.earlyExits, f.earlyExits ? 'warn' : 'ok', 'this month') +
      '</div></div>' +
      (best
        ? '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #eef2f7;font-size:12.5px;color:#52627a">' +
          '<b style="color:#0369a1">Next best leave day:</b> take <b>' +
          best.leaveDates.map(J.isoLabel).join('</b> and <b>') + '</b> for <b>' + best.totalDays +
          ' days off</b> in a row (' + J.isoLabel(best.runStart) + ' – ' + J.isoLabel(best.runEnd) + ')' +
          (best.holidays.length ? ', around ' + best.holidays.join(' and ') : '') + '.' +
          ' <a href="' + J.PORTAL + '/holiday" style="color:#0369a1;text-decoration:underline">See every option →</a>' +
          '</div>'
        : '');
  }

  /* ----------------------------------------------------------- attendance -- */

  function displayedMonth() {
    var p = new URLSearchParams(location.search);
    var m = parseInt(p.get('month'), 10), y = parseInt(p.get('year'), 10);
    if (!m) {
      var sm = document.querySelector('select[name=month]'), sy = document.querySelector('select[name=year]');
      m = sm && parseInt(sm.value, 10);
      y = sy && parseInt(sy.value, 10);
    }
    var now = new Date();
    return { month: m || (now.getMonth() + 1), year: y || now.getFullYear() };
  }

  function renderRegularization() {
    if (!cfg.attendanceEnrich) return;
    if (!/^\/attendance\/?$/.test(location.pathname)) return;

    var dm = displayedMonth();
    J.fetchMonth(dm.month, dm.year).then(function (r) {
      if (r.loggedOut || !r.days.length) return;
      var items = J.regularizationCandidates(r.days, cfg);
      var card = document.getElementById('jdgc-regular');

      if (!items.length) {
        if (card) card.parentElement.remove();
        return;
      }

      var host = document.querySelector('.att-table-card');
      if (!host) return;

      if (!card) {
        var wrap = el('<div id="jdgc-regular-wrap"><div class="jdgc jdgc-card" id="jdgc-regular" ' +
          'style="margin-top:16px;border-left:3px solid #b45309"></div></div>');
        host.parentElement.insertBefore(wrap, host.nextSibling);
        card = wrap.querySelector('#jdgc-regular');
      }

      var sevPill = function (n) {
        return n >= 3 ? '<span class="jdgc-tag" style="background:#fef2f2;color:#b91c1c">strong case</span>'
          : n === 2 ? '<span class="jdgc-tag" style="background:#fffbeb;color:#b45309">worth checking</span>'
            : '<span class="jdgc-tag" style="background:#f1f5f9;color:#64748b">minor</span>';
      };

      card.innerHTML =
        '<h3>Worth raising · ' + items.length + ' day' + (items.length === 1 ? '' : 's') + '</h3>' +
        '<div class="jdgc-sub">Each of these has a case for regularization. Open the day from the table above ' +
        'and use its <b>Regularization</b> tab.</div>' +
        '<div>' + items.map(function (it) {
          return '<div style="display:flex;gap:12px;padding:10px 0;border-top:1px solid #f1f5f9;align-items:flex-start">' +
            '<div class="jdgc-num" style="min-width:92px;font-weight:600">' + it.day.date + '</div>' +
            '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:600;font-size:12.5px">' + it.title + ' ' + sevPill(it.severity) + '</div>' +
            '<div style="font-size:11.5px;color:#64748b;margin-top:2px">' + it.detail + '</div>' +
            '</div>' +
            (it.day.detailId
              ? '<a class="jdgc-btn" style="text-decoration:none" href="' + J.PORTAL + '/attendance/' +
                it.day.detailId + '">Open</a>'
              : '') +
            '</div>';
        }).join('') + '</div>';
    });
  }

  /* -------------------------------------------------------------- holiday -- */

  function renderLeavePlanner(ctx) {
    if (!/^\/holiday\/?$/.test(location.pathname)) return;
    var content = document.querySelector('.content');
    if (!content) return;
    if (document.getElementById('jdgc-planner')) return;

    var todayISO = J.isoToday();
    var sugg = J.leaveSuggestions(ctx.holidays, ctx.weekend, todayISO, 220, 2).slice(0, 8);

    var card = el('<div class="jdgc jdgc-card" id="jdgc-planner" style="margin:0 0 20px"></div>');
    var anchor = content.querySelector('.top-bar');
    if (anchor && anchor.nextSibling) content.insertBefore(card, anchor.nextSibling);
    else content.insertBefore(card, content.firstChild);

    if (!sugg.length) {
      card.innerHTML = '<h3>Best leave days</h3>' +
        '<div class="jdgc-sub">No bridge days left in the next few months — every remaining holiday already ' +
        'sits against a weekend.</div>';
      return;
    }

    card.innerHTML =
      '<h3>Best leave days</h3>' +
      '<div class="jdgc-sub">Working days that sit between days you are already off. Spending leave here buys ' +
      'the most time away per day used. Weekends detected from your own attendance: ' +
      ctx.weekend.map(function (d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]; }).join(' + ') + '.</div>' +
      '<div>' + sugg.map(function (s) {
        var ratio = (s.totalDays / s.cost).toFixed(s.totalDays % s.cost ? 1 : 0);
        return '<div style="display:flex;gap:14px;align-items:center;padding:11px 0;border-top:1px solid #f1f5f9">' +
          '<div style="min-width:58px;text-align:center">' +
          '<div class="jdgc-num" style="font-size:20px;font-weight:600;color:#047857;letter-spacing:-.03em">' +
          s.totalDays + '</div>' +
          '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:700">days off</div>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:13px">Take ' +
          s.leaveDates.map(J.isoLabel).join(' + ') + '</div>' +
          '<div style="font-size:11.5px;color:#64748b;margin-top:2px">' +
          J.isoLabel(s.runStart) + ' → ' + J.isoLabel(s.runEnd) +
          (s.holidays.length ? ' · covers ' + s.holidays.join(', ') : '') +
          '</div></div>' +
          '<div class="jdgc-tag" style="background:#f0f9ff;color:#0369a1;white-space:nowrap">' +
          ratio + '× per leave day</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  /* =================================================================== go = */

  PUMP.ready.then(function (c) {
    cfg = c;
    context().then(function (ctx) {
      // portal-ui reads this to show the Today card's break budget; the card is
      // already on screen by now, so ask the pump for a redraw.
      root.JDG_EXTRAS = { usualOut: ctx.usualOut, weekend: ctx.weekend };
      PUMP.poke();
      renderOutlook(ctx);
      renderLeavePlanner(ctx);
    });
    renderRegularization();
  });
})(typeof self !== 'undefined' ? self : this);
