/* JDG Clockwork — in-portal surfaces.
 *
 * Everything here renders inside the portal's own DOM, using the Rubick
 * template's existing card look, so the numbers appear where you are already
 * looking instead of behind a button.
 *
 *   top bar     every page   clock-out target / remaining / late-by
 *   dashboard   /dashboard   today panel, month panel, calendar tinting
 *   attendance  /attendance  month summary strip, vs-8h column, full-month table
 *   guard       every page   intercepts a clock-out that lands under a full day
 */
(function (root) {
  'use strict';

  var J = root.JDG, S = root.JDG_STYLES, PUMP = root.JDG_PUMP;
  var cfg = null;
  var monthCache = {};      // 'YYYY-M' -> day rows, for the calendar and the table
  var overrideClockOut = false;

  /* ------------------------------------------------------------- plumbing -- */

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function injectStyles() {
    if (document.getElementById('jdgc-portal-styles')) return;
    var st = document.createElement('style');
    st.id = 'jdgc-portal-styles';
    st.textContent = S.PORTAL;
    document.head.appendChild(st);
  }

  function fetchMonthCached(month, year) {
    var key = year + '-' + month;
    var now = new Date();
    var isCurrent = month === now.getMonth() + 1 && year === now.getFullYear();
    if (monthCache[key] && !isCurrent) return Promise.resolve(monthCache[key]);
    return J.fetchMonth(month, year).then(function (r) {
      if (r.loggedOut) return [];
      monthCache[key] = r.days;
      return r.days;
    }).catch(function () { return monthCache[key] || []; });
  }

  function signed(mins) {
    var v = Math.round(mins);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + J.fmtDur(Math.abs(v));
  }

  /* ============================================================ top bar === */

  var chipEl = null;

  function chipParts(l) {
    var required = cfg.requiredMinutes;

    if (l.isHoliday && l.clockIn == null) {
      return { cls: 'is-done', parts: [['Today', 'Rest day', '']] };
    }
    if (l.state === 'not-clocked-in') {
      var delta = cfg.shiftStart - J.nowMinutes();
      if (delta > 0) {
        return { cls: '', parts: [
          ['Shift starts', J.fmtClock(cfg.shiftStart), ''],
          ['Clock in within', J.fmtDur(delta), delta <= 15 ? 'warn' : '']
        ] };
      }
      var over = -delta;
      return { cls: 'is-late', parts: [
        ['Not clocked in', J.fmtDur(over) + ' late', over >= cfg.graceMinutes ? 'bad' : 'warn'],
        [over >= cfg.graceMinutes ? 'Marked' : 'Grace left',
         over >= cfg.graceMinutes ? 'Late' : J.fmtDur(cfg.graceMinutes - over),
         over >= cfg.graceMinutes ? 'bad' : 'warn']
      ] };
    }
    if (l.state === 'done') {
      var short = required - l.worked;
      return { cls: 'is-done', parts: [
        ['Logged today', J.fmtDurShort(l.worked), short > 0 ? 'bad' : 'ok'],
        [short > 0 ? 'Short by' : 'Over by', J.fmtDur(Math.abs(short)), short > 0 ? 'bad' : 'ok']
      ] };
    }
    if (l.state === 'break') {
      return { cls: 'is-break', parts: [
        ['On break', J.fmtDur(l.breakSoFar), 'warn'],
        ['Still owed', J.fmtDur(l.remaining), ''],
        ['Resume now → out', J.fmtClock(l.resumeTarget), '']
      ] };
    }
    if (l.worked >= required) {
      return { cls: 'is-working', parts: [
        ['Eight hours', 'Cleared', 'ok'],
        ['Over by', J.fmtDur(l.worked - required), 'ok']
      ] };
    }
    return { cls: 'is-working', parts: [
      ['Leave at', J.fmtClock(l.targetOut), ''],
      ['Remaining', J.fmtDur(l.remaining), l.remaining <= 30 ? 'ok' : ''],
      ['Worked', J.fmtDurShort(l.worked), '']
    ] };
  }

  function renderChip(l) {
    if (!cfg.chipEnabled) return;
    var bar = document.querySelector('.top-bar');
    if (!bar) return;

    if (!chipEl || !chipEl.isConnected) {
      chipEl = el('<div class="jdgc jdgc-chip" title="Open Clockwork insights"></div>');
      chipEl.addEventListener('click', function () {
        if (root.JDG_INSIGHTS) root.JDG_INSIGHTS.open();
      });
      // Sits after the breadcrumb (which carries mr-auto), before the alerts bell.
      var anchor = bar.querySelector('.intro-x.mr-4') || bar.querySelector('.dropdown');
      if (anchor) bar.insertBefore(chipEl, anchor); else bar.appendChild(chipEl);
    }

    var d = PUMP.data();
    if (d.loggedOut) { chipEl.style.display = 'none'; return; }
    chipEl.style.display = '';

    var c = chipParts(l);
    chipEl.className = 'jdgc jdgc-chip ' + c.cls;
    chipEl.innerHTML =
      '<span class="jdgc-dot"></span>' +
      c.parts.map(function (p, i) {
        return (i ? '<span class="jdgc-sep' + (i > 1 ? ' jdgc-opt' : '') + '"></span>' : '') +
          '<span' + (i > 1 ? ' class="jdgc-opt"' : '') + '>' +
          '<span class="jdgc-k">' + p[0] + '</span>' +
          '<span class="jdgc-v jdgc-num ' + (p[2] || '') + '">' + p[1] + '</span></span>';
      }).join('');
  }

  /* ================================================== one-click pause === */

  var pauseBtn = null, halfDayToday = null;

  /** Approved half-day leave covering today, resolved once per page load. */
  function loadHalfDay() {
    if (halfDayToday !== null) return Promise.resolve(halfDayToday);
    var d = new Date();
    return J.fetchLeave(d.getMonth() + 1, d.getFullYear()).then(function (r) {
      halfDayToday = r.loggedOut ? false : J.isHalfDayOn(r.leaves, J.isoToday());
      return halfDayToday;
    }).catch(function () { halfDayToday = false; return false; });
  }

  function submitPause(reason) {
    var form = document.querySelector('form[action*="/attendance/clock-pause"]');
    if (!form) return false;
    var sel = form.querySelector('[name=pause_massage]');
    if (!sel) return false;
    sel.value = reason;
    var other = form.querySelector('[name=pause_massage_other]');
    if (other) other.value = '';
    form.submit();
    return true;
  }

  function submitClockOut() {
    var form = document.querySelector('form[action*="/attendance/clockout"]');
    if (!form) return false;
    overrideClockOut = true;   // already confirmed here; do not double-prompt
    form.submit();
    return true;
  }

  /**
   * The portal renders no resume control while you are working, so its markup
   * cannot be read ahead of time. Find whatever it puts on the page once you
   * are paused, rather than guessing at an endpoint.
   */
  function findResumeControl() {
    var forms = [].slice.call(document.querySelectorAll('form[action*="/attendance/"]'));
    for (var i = 0; i < forms.length; i++) {
      var a = forms[i].getAttribute('action') || '';
      if (a.indexOf('clockout') === -1 && a.indexOf('clock-pause') === -1) return { kind: 'form', el: forms[i] };
    }
    var clickable = [].slice.call(document.querySelectorAll('.top-bar a, .top-bar button, .content a.btn, .content button'));
    for (var j = 0; j < clickable.length; j++) {
      if (/^\s*(resume|start|continue work|clock ?in)\s*$/i.test(clickable[j].textContent || '')) {
        return { kind: 'click', el: clickable[j] };
      }
    }
    return null;
  }

  function doResume() {
    var c = findResumeControl();
    if (!c) {
      confirmDialog({
        icon: '▶',
        title: 'Resume control not found',
        body: 'Clockwork could not spot the portal\'s own resume button on this page, so it will not guess ' +
          'at how to restart your timer. Use the portal\'s control this once — and tell the extension author ' +
          'what it is called so this can be wired up.',
        rows: [], cancelLabel: 'Close', okLabel: 'Close'
      });
      return;
    }
    if (c.kind === 'form') c.el.submit(); else c.el.click();
  }

  function runPauseAction(l) {
    var plan = J.resolvePauseAction(J.nowMinutes(), halfDayToday, cfg);

    if (plan.action === 'pause') {
      if (!submitPause(plan.reason)) {
        confirmDialog({
          icon: '⏸', title: 'Pause form not available',
          body: 'The portal\'s pause form is not on this page. Open the dashboard and try again.',
          rows: [], cancelLabel: 'Close', okLabel: 'Close'
        });
      }
      return;
    }

    // Clocking out ends the day, so it always asks first — the one exception to
    // "one click". The early-exit numbers ride along when you are short.
    var short = cfg.requiredMinutes - l.worked;
    confirmDialog({
      icon: short > 0 ? '⚡' : '⏻',
      title: short > 0 ? 'Clock out ' + J.fmtDur(short) + ' short?' : 'Clock out for the day?',
      body: short > 0
        ? 'It is ' + J.fmtClock(J.nowMinutes()) + ' (' + plan.why + '), so this button clocks out. You have logged <b>' +
          J.fmtDurShort(l.worked) + '</b> — leaving now stamps today with an <b>Early Exit</b>.'
        : 'It is ' + J.fmtClock(J.nowMinutes()) + ' (' + plan.why + '). You have logged <b>' +
          J.fmtDurShort(l.worked) + '</b>, a full day.',
      rows: short > 0
        ? [['Short by', J.fmtDur(short), 'bad'],
           ['Clear ' + J.fmtDurShort(cfg.requiredMinutes) + ' at',
            J.fmtClock(l.targetOut != null ? l.targetOut : J.nowMinutes() + short), 'ok']]
        : [['Logged today', J.fmtDurShort(l.worked), 'ok'],
           ['Over by', J.fmtDur(-short), 'ok']],
      cancelLabel: short > 0 ? 'Stay' : 'Not yet',
      okLabel: 'Clock out',
      reverse: short <= 0
    }).then(function (go) { if (go) submitClockOut(); });
  }

  function renderPauseButton(l) {
    if (!cfg.oneClickPause) { if (pauseBtn) pauseBtn.style.display = 'none'; return; }
    var bar = document.querySelector('.top-bar');
    if (!bar) return;

    var usable = (l.state === 'working' || l.state === 'break') && !PUMP.data().loggedOut;
    if (!usable) { if (pauseBtn) pauseBtn.style.display = 'none'; return; }

    if (!pauseBtn || !pauseBtn.isConnected) {
      pauseBtn = el('<button class="jdgc jdgc-quick" type="button"></button>');
      pauseBtn.addEventListener('click', function () {
        var live = PUMP.live();
        if (live.state === 'break') doResume(); else runPauseAction(live);
      });
      var anchor = bar.querySelector('.intro-x.mr-4') || bar.querySelector('.dropdown');
      if (anchor) bar.insertBefore(pauseBtn, anchor); else bar.appendChild(pauseBtn);
    }
    pauseBtn.style.display = '';

    if (l.state === 'break') {
      pauseBtn.className = 'jdgc jdgc-quick is-resume';
      pauseBtn.innerHTML = '<span class="jdgc-ic">▶</span> Resume';
      pauseBtn.title = 'Restart the timer — paused ' + J.fmtDur(l.breakSoFar) + ' ago';
      return;
    }

    var plan = J.resolvePauseAction(J.nowMinutes(), halfDayToday, cfg);
    pauseBtn.className = 'jdgc jdgc-quick' + (plan.action === 'clockout' ? ' is-out' : '');
    pauseBtn.innerHTML = '<span class="jdgc-ic">' + (plan.action === 'clockout' ? '⏻' : '⏸') + '</span> ' + plan.label;
    pauseBtn.title = plan.action === 'clockout'
      ? 'Clock out — chosen because it is ' + plan.why + (halfDayToday ? ' (approved half day today)' : '') + '. Asks first.'
      : 'Pause as "' + plan.reason + '" — chosen because it is ' + plan.why + '. One click, no dropdown.';
  }

  /* ========================================================== dashboard === */

  var todayCard = null;

  function statBlock(k, v, cls) {
    return '<div class="jdgc-stat"><div class="jdgc-k">' + k + '</div>' +
      '<div class="jdgc-val jdgc-num ' + (cls || '') + '">' + v + '</div></div>';
  }

  /**
   * How much break is left before today stops fitting inside the time you
   * normally leave. extras.js supplies the median clock-out; without it this
   * simply renders nothing.
   */
  function breakBudgetLine(l) {
    var ex = root.JDG_EXTRAS;
    if (!ex || ex.usualOut == null) return '';
    var b = J.breakBudget(l, ex.usualOut, cfg);
    if (!b || b.allowance <= 0) return '';

    var pctUsed = Math.min(100, (b.used / b.allowance) * 100);
    var over = b.left < 0;
    return '<div style="margin:0 0 16px;padding:10px 13px;border-radius:8px;background:' +
      (over ? '#fef2f2' : '#f7f9fc') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">' +
      '<span style="font-size:11.5px;color:#52627a">Break budget — you usually leave at <b>' +
      J.fmtClock(ex.usualOut) + '</b></span>' +
      '<span class="jdgc-num" style="font-size:13px;font-weight:600;color:' +
      (over ? '#b91c1c' : '#047857') + '">' +
      (over ? J.fmtDur(-b.left) + ' over' : J.fmtDur(b.left) + ' left') + '</span>' +
      '</div>' +
      '<div class="jdgc-track" style="height:5px;margin-top:7px"><i class="' + (over ? '' : 'ok') +
      '" style="width:' + pctUsed + '%;background:' + (over ? '#b91c1c' : '') + '"></i></div>' +
      '<div style="font-size:10.5px;color:#94a3b8;margin-top:5px">' +
      J.fmtDur(b.used) + ' of ' + J.fmtDur(b.allowance) + ' used' +
      (over ? ' — at this rate you clear ' + J.fmtDurShort(cfg.requiredMinutes) + ' at ' +
        J.fmtClock(l.targetOut != null ? l.targetOut : ex.usualOut - b.left) + ' instead.' : '') +
      '</div></div>';
  }

  function renderDashboard(l) {
    if (!cfg.dashboardCards) return;
    if (!/\/dashboard\/?$/.test(location.pathname) && location.pathname !== '/') return;

    var host = document.querySelector('.report-box');
    if (!host) return;
    var grid = host.closest('.grid');
    if (!grid) return;

    if (!todayCard || !todayCard.isConnected) {
      todayCard = el('<div class="col-span-12" id="jdgc-today-wrap" style="margin-bottom:2px">' +
        '<div class="jdgc jdgc-card"></div></div>');
      grid.parentElement.insertBefore(todayCard, grid);
    }
    var card = todayCard.firstElementChild;
    var required = cfg.requiredMinutes;

    if (PUMP.data().loggedOut) { todayCard.style.display = 'none'; return; }
    todayCard.style.display = '';

    /* ---- rest day ---- */
    if (l.isHoliday && l.clockIn == null) {
      card.innerHTML = '<h3>Today</h3><div class="jdgc-sub">' + J.todayDMY() + '</div>' +
        '<div class="jdgc-hero ok">Rest day</div>' +
        '<div class="jdgc-herolbl">The portal marks today as <b>' + (l.status || 'off') + '</b>. Nothing to clock.</div>';
      return;
    }

    /* ---- not clocked in ---- */
    if (l.state === 'not-clocked-in') {
      var delta = cfg.shiftStart - J.nowMinutes();
      var late = delta <= 0;
      var over = -delta;
      card.innerHTML =
        '<h3>Today</h3><div class="jdgc-sub">' + J.todayDMY() + '</div>' +
        '<div class="jdgc-today">' +
        '<div class="jdgc-main">' +
        '<div class="jdgc-hero jdgc-num ' + (late ? (over >= cfg.graceMinutes ? 'bad' : 'warn') : '') + '">' +
        (late ? J.fmtDur(over) + ' late' : J.fmtDur(delta)) + '</div>' +
        '<div class="jdgc-herolbl">' + (late
          ? (over >= cfg.graceMinutes
            ? 'Past the grace window — today will carry a red <b>Late</b>.'
            : 'Still inside grace for another <b>' + J.fmtDur(cfg.graceMinutes - over) + '</b>.')
          : 'until your <b>' + J.fmtClock(cfg.shiftStart) + '</b> start.') + '</div>' +
        '</div>' +
        '<div class="jdgc-stats">' +
        statBlock('Shift start', J.fmtClock(cfg.shiftStart)) +
        statBlock('Late mark at', J.fmtClock(cfg.shiftStart + cfg.graceMinutes)) +
        statBlock('If you clock in now', J.fmtClock(J.nowMinutes() + required + 40) + ' out', 'warn') +
        '</div></div>';
      return;
    }

    /* ---- finished ---- */
    if (l.state === 'done') {
      var short = required - l.worked;
      card.innerHTML =
        '<h3>Today</h3><div class="jdgc-sub">' + J.todayDMY() + ' · clocked out</div>' +
        '<div class="jdgc-today">' +
        '<div class="jdgc-main">' +
        '<div class="jdgc-hero jdgc-num ' + (short > 0 ? 'bad' : 'ok') + '">' + J.fmtDurShort(l.worked) + '</div>' +
        '<div class="jdgc-herolbl">' + (short > 0
          ? 'Logged <b>' + J.fmtDur(short) + '</b> under a full day — this carries an ⚡ Early Exit.'
          : '<b>' + J.fmtDur(-short) + '</b> over the requirement.') + '</div>' +
        '</div>' +
        '<div class="jdgc-stats">' +
        statBlock('In', J.fmtClock(l.clockIn), l.hardLate ? 'bad' : '') +
        statBlock('Out', J.fmtClock(l.clockOut)) +
        statBlock('Late by', l.lateBy ? l.lateBy + ' min' : 'on time', l.hardLate ? 'bad' : 'ok') +
        statBlock('Breaks', J.fmtDur(l.breaks)) +
        '</div></div>';
      return;
    }

    /* ---- working / on break ---- */
    var cleared = l.worked >= required;
    var pctDone = Math.min(100, (l.worked / required) * 100);
    var heroVal, heroLbl, heroCls;

    if (l.state === 'break') {
      heroCls = 'warn';
      heroVal = J.fmtDur(l.breakSoFar) + ' on break';
      heroLbl = 'Resume now and you clear ' + J.fmtDurShort(required) +
        ' at <b>' + J.fmtClock(l.resumeTarget) + '</b>. Every minute here pushes that later.';
    } else if (cleared) {
      heroCls = 'ok';
      heroVal = 'Free to go';
      heroLbl = 'Full day cleared — <b>' + J.fmtDur(l.worked - required) + '</b> over. No Early Exit if you leave now.';
    } else {
      heroCls = '';
      heroVal = J.fmtClock(l.targetOut);
      heroLbl = 'Clock out at or after this to clear ' + J.fmtDurShort(required) +
        '. <b>' + J.fmtDur(l.remaining) + '</b> to go.';
    }

    card.innerHTML =
      '<h3>Today</h3><div class="jdgc-sub">' + J.todayDMY() + ' · ' +
      (l.state === 'break' ? 'paused' : 'clocked in') + '</div>' +
      breakBudgetLine(l) +
      '<div class="jdgc-today">' +
      '<div class="jdgc-main">' +
      '<div class="jdgc-hero jdgc-num ' + heroCls + '">' + heroVal + '</div>' +
      '<div class="jdgc-herolbl">' + heroLbl + '</div>' +
      '</div>' +
      '<div class="jdgc-prog">' +
      '<div class="jdgc-track"><i class="' + (cleared ? 'ok' : 'warn') + '" style="width:' + pctDone + '%"></i></div>' +
      '<div class="jdgc-tracklbl"><span class="jdgc-num">' + J.fmtDurShort(l.worked) + ' worked</span>' +
      '<span class="jdgc-num">' + J.fmtDurShort(required) + ' required</span></div>' +
      '</div>' +
      '<div class="jdgc-stats">' +
      statBlock('In', J.fmtClock(l.clockIn), l.hardLate ? 'bad' : '') +
      statBlock('Late by', l.lateBy ? l.lateBy + ' min' : 'on time', l.hardLate ? 'bad' : 'ok') +
      statBlock('Breaks', J.fmtDur(l.breaks)) +
      statBlock(cleared ? 'Overtime' : 'If out now', cleared ? '+' + J.fmtDur(l.worked - required) : '−' + J.fmtDur(l.remaining),
        cleared ? 'ok' : 'bad') +
      '</div></div>';
  }

  /* ---- calendar tinting ------------------------------------------------- */

  var calObserver = null;

  function paintCalendar() {
    if (!cfg.calendarMarks) return;
    var cal = document.querySelector('.fc-daygrid-body, .fc-view-harness');
    if (!cal) return;

    var cells = document.querySelectorAll('.fc-daygrid-day[data-date]');
    if (!cells.length) return;

    // Which months are on screen right now?
    var months = {};
    cells.forEach(function (c) {
      var d = c.getAttribute('data-date');
      if (d) months[d.slice(0, 7)] = true;
    });

    Object.keys(months).forEach(function (ym) {
      var parts = ym.split('-');
      fetchMonthCached(parseInt(parts[1], 10), parseInt(parts[0], 10)).then(function (days) {
        var byIso = {};
        days.forEach(function (d) { if (d.iso) byIso[d.iso] = d; });
        document.querySelectorAll('.fc-daygrid-day[data-date^="' + ym + '"]').forEach(function (cell) {
          var d = byIso[cell.getAttribute('data-date')];
          cell.classList.remove('jdgc-cal-late', 'jdgc-cal-ontime', 'jdgc-cal-early', 'jdgc-cal-marked');
          if (!d || d.clockIn == null) return;
          cell.classList.add('jdgc-cal-marked');
          // Same rule as the attendance rows: only judge full "Present" days.
          // A half day or a part-worked leave day is not late and not an early exit.
          if (d.fullDay) {
            if ((d.lateBy || 0) >= cfg.graceMinutes) cell.classList.add('jdgc-cal-late');
            else if ((d.lateBy || 0) === 0) cell.classList.add('jdgc-cal-ontime');
            if (d.earlyExit) cell.classList.add('jdgc-cal-early');
          }
          var bits = [J.fmtClock(d.clockIn) + ' in'];
          if (d.clockOut != null) bits.push(J.fmtClock(d.clockOut) + ' out');
          if (d.total != null) bits.push(J.fmtDurShort(d.total) + ' worked');
          if (d.lateBy) bits.push(d.lateBy + ' min late');
          cell.setAttribute('title', bits.join(' · '));
        });
      });
    });

    if (!document.querySelector('.jdgc-callegend')) {
      var wrap = document.querySelector('.fc');
      if (wrap && wrap.parentElement) {
        wrap.parentElement.appendChild(el(
          '<div class="jdgc jdgc-legend jdgc-callegend">' +
          '<span><i style="background:#047857"></i>On time</span>' +
          '<span><i style="background:#b91c1c"></i>Flagged Late</span>' +
          '<span>⚡ Early Exit</span>' +
          '<span style="color:#94a3b8">hover a day for its times</span>' +
          '</div>'));
      }
    }
  }

  function watchCalendar() {
    if (!cfg.calendarMarks || calObserver) return;
    var host = document.querySelector('.fc-view-harness');
    if (!host) return;
    calObserver = new MutationObserver(function () {
      clearTimeout(watchCalendar._t);
      watchCalendar._t = setTimeout(paintCalendar, 120);
    });
    calObserver.observe(host, { childList: true, subtree: true });
  }

  /* ========================================================= attendance === */

  var stripEl = null, fullTable = null, showingFull = false, tableObserver = null;
  var shownMonth = null;

  function displayedMonth() {
    var p = new URLSearchParams(location.search);
    var m = parseInt(p.get('month'), 10), y = parseInt(p.get('year'), 10);
    if (!m) {
      var sel = document.querySelector('select[name=month]'), sy = document.querySelector('select[name=year]');
      m = sel && parseInt(sel.value, 10);
      y = sy && parseInt(sy.value, 10);
    }
    var now = new Date();
    return { month: m || (now.getMonth() + 1), year: y || now.getFullYear() };
  }

  function stripCell(k, v, note, cls) {
    return '<div class="jdgc-cellx"><div class="jdgc-k">' + k + '</div>' +
      '<div class="jdgc-val jdgc-num ' + (cls || '') + '">' + v + '</div>' +
      (note ? '<div class="jdgc-note">' + note + '</div>' : '') + '</div>';
  }

  function renderStrip(days, label) {
    var s = J.summarize(days, cfg);
    var totalWorked = s.totalWorked;

    var body =
      stripCell('Days present', s.days, s.partialDays ? '+' + s.partialDays + ' half/leave' : 'full days') +
      stripCell('Typical arrival', J.fmtClock(cfg.shiftStart + s.medianLate),
        'median ' + s.medianLate.toFixed(0) + ' min late',
        s.medianLate >= cfg.graceMinutes ? 'bad' : s.medianLate > 0 ? 'warn' : 'ok') +
      stripCell('Flagged Late', s.hardLate, s.onTime + ' on time', s.hardLate ? 'bad' : 'ok') +
      stripCell('Early exits', s.earlyExits, J.fmtDur(s.minutesShort) + ' short', s.earlyExits ? 'warn' : 'ok') +
      stripCell('Hours logged', J.fmtDurShort(totalWorked), 'over ' + s.totalWorkedN + ' days') +
      stripCell('Net vs ' + J.fmtDurShort(cfg.requiredMinutes) + '/day', signed(s.net),
        s.net >= 0 ? 'banked' : 'owed', s.net >= 0 ? 'ok' : 'bad');

    var warn = s.anomalies.length
      ? '<div class="jdgc-note" style="margin-top:14px;color:#b45309">⚠ ' + s.anomalies.length +
        ' row' + (s.anomalies.length === 1 ? '' : 's') + ' this month where the portal\'s Late By does not match your clock-in ' +
        '(' + s.anomalies.map(function (d) { return d.date.slice(0, 5); }).join(', ') +
        ') — held out of these figures. Open Insights for the detail.</div>'
      : '';

    return '<div class="jdgc-head">' +
      '<div class="jdgc-grow"><h3>' + label + '</h3>' +
      '<div class="jdgc-sub">Computed from the whole month, not just the page below.</div></div>' +
      '<button class="jdgc-btn jdgc-toggle' + (showingFull ? ' on' : '') + '">' +
      (showingFull ? 'Back to paged view' : 'Show all ' + days.length + ' days') + '</button>' +
      '<button class="jdgc-btn jdgc-insights">Insights</button>' +
      '</div>' +
      '<div class="jdgc-strip">' + body + '</div>' + warn;
  }

  /** Append a "vs 8h" cell to each row of the portal's own table. */
  function decorateRows(byDate) {
    var table = document.querySelector('.att-table-card table');
    if (!table) return;

    var headRow = table.querySelector('thead tr');
    if (headRow && !headRow.querySelector('.jdgc-delta')) {
      headRow.appendChild(el('<th class="jdgc-delta tc">vs ' + J.fmtDurShort(cfg.requiredMinutes) + '</th>'));
    }

    var today = J.todayDMY();
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      var tds = tr.querySelectorAll('td');
      if (tds.length < 7) return;
      var m = (tds[1].textContent || '').match(/\d{2}-\d{2}-\d{4}/);
      if (!m) return;
      var d = byDate[m[0]];

      tr.classList.remove('jdgc-row-late', 'jdgc-row-early', 'jdgc-row-today');
      if (m[0] === today) tr.classList.add('jdgc-row-today');

      var cell = tr.querySelector('.jdgc-delta');
      if (!cell) { cell = el('<td class="jdgc-delta tc"></td>'); tr.appendChild(cell); }

      if (!d || d.total == null || !d.fullDay) {
        cell.textContent = '—';
        cell.className = 'jdgc-delta tc zero';
        return;
      }
      if ((d.lateBy || 0) >= cfg.graceMinutes) tr.classList.add('jdgc-row-late');
      if (d.earlyExit) tr.classList.add('jdgc-row-early');

      var dev = d.total - cfg.requiredMinutes;
      cell.textContent = (dev > 0 ? '+' : dev < 0 ? '−' : '') + J.fmtDur(Math.abs(dev));
      cell.className = 'jdgc-delta tc ' + (dev > 0 ? 'pos' : dev < 0 ? 'neg' : 'zero');
    });
  }

  function buildFullTable(days) {
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var today = J.todayDMY();
    var rows = days.map(function (d) {
      var dev = (d.total != null && d.fullDay) ? d.total - cfg.requiredMinutes : null;
      var cls = [];
      // Only tint full "Present" days: a half day starting at 2 p.m. is not a
      // discipline problem and should not read like one.
      if (d.fullDay && d.clockIn != null && (d.lateBy || 0) >= cfg.graceMinutes) cls.push('jdgc-row-late');
      if (d.earlyExit && d.fullDay) cls.push('jdgc-row-early');
      if (d.date === today) cls.push('jdgc-row-today');
      return '<tr class="' + cls.join(' ') + '">' +
        '<td class="jdgc-num">' + d.date + '</td>' +
        '<td>' + (d.dow != null ? names[d.dow] : '') + '</td>' +
        '<td class="tc jdgc-num">' + (d.clockIn != null ? J.fmtClock(d.clockIn) : '') + '</td>' +
        '<td class="tc jdgc-num">' + (d.clockOut != null ? J.fmtClock(d.clockOut) : '') + '</td>' +
        '<td class="tc jdgc-num">' + (d.lateBy ? (d.lateBy >= 90 ? J.fmtDur(d.lateBy) : d.lateBy + 'm') : '') + '</td>' +
        '<td class="tc jdgc-num">' + (d.total != null ? J.fmtDurShort(d.total) : '') + '</td>' +
        '<td class="jdgc-delta tc ' + (dev == null ? 'zero' : dev > 0 ? 'pos' : dev < 0 ? 'neg' : 'zero') + '">' +
        (dev == null ? '—' : (dev > 0 ? '+' : dev < 0 ? '−' : '') + J.fmtDur(Math.abs(dev))) + '</td>' +
        '<td>' + (d.status || '') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="jdgc jdgc-card" style="margin-top:16px;overflow-x:auto">' +
      '<h3>All ' + days.length + " days</h3><div class=\"jdgc-sub\">Every day of the month in one view — no pagination.</div>" +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr>' +
      ['Date', 'Day', 'Clock in', 'Clock out', 'Late by', 'Worked', 'vs ' + J.fmtDurShort(cfg.requiredMinutes), 'Status']
        .map(function (h, i) {
          return '<th style="text-align:' + (i >= 2 && i <= 6 ? 'center' : 'left') +
            ';padding:8px;border-bottom:1px solid #e6ebf2;font-size:10px;text-transform:uppercase;' +
            'letter-spacing:.08em;color:#94a3b8;font-weight:700">' + h + '</th>';
        }).join('') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderAttendance() {
    if (!cfg.attendanceEnrich) return;
    if (!/^\/attendance\/?$/.test(location.pathname)) return;

    var card = document.querySelector('.att-table-card');
    if (!card) return;

    var dm = displayedMonth();
    var key = dm.year + '-' + dm.month;

    fetchMonthCached(dm.month, dm.year).then(function (days) {
      if (!days.length) return;
      var byDate = {};
      days.forEach(function (d) { byDate[d.date] = d; });

      var label = new Date(dm.year, dm.month - 1, 1)
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      if (!stripEl || !stripEl.isConnected) {
        stripEl = el('<div class="jdgc jdgc-card" style="margin-bottom:16px"></div>');
        card.parentElement.insertBefore(stripEl, card);
      }
      if (shownMonth !== key || !stripEl.innerHTML) {
        shownMonth = key;
      }
      stripEl.innerHTML = renderStrip(days, label);
      stripEl.querySelector('.jdgc-insights').onclick = function () {
        if (root.JDG_INSIGHTS) root.JDG_INSIGHTS.open();
      };
      stripEl.querySelector('.jdgc-toggle').onclick = function () {
        showingFull = !showingFull;
        applyFullView(days);
        renderAttendance();
      };

      applyFullView(days);
      decorateRows(byDate);

      // The portal re-renders tbody on paginate and on column sort; put the
      // extra column back each time it does.
      if (!tableObserver) {
        var tbody = card.querySelector('tbody');
        if (tbody) {
          tableObserver = new MutationObserver(function () {
            clearTimeout(renderAttendance._t);
            renderAttendance._t = setTimeout(function () { decorateRows(byDate); }, 40);
          });
          tableObserver.observe(tbody, { childList: true });
        }
      }
    });
  }

  function applyFullView(days) {
    var card = document.querySelector('.att-table-card');
    if (!card) return;
    if (showingFull) {
      card.style.display = 'none';
      if (!fullTable || !fullTable.isConnected) {
        fullTable = el(buildFullTable(days));
        card.parentElement.insertBefore(fullTable, card.nextSibling);
      } else {
        fullTable.outerHTML = buildFullTable(days);
        fullTable = card.nextElementSibling;
      }
      fullTable.style.display = '';
    } else {
      card.style.display = '';
      if (fullTable && fullTable.isConnected) fullTable.style.display = 'none';
    }
  }

  /* ============================================== early clock-out guard === */

  /**
   * Shared modal. Resolves true when the confirming button is pressed.
   * `rows` is a list of [label, value, tone] read-outs.
   */
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var gh = document.createElement('div');
      var gs = gh.attachShadow({ mode: 'open' });
      gs.innerHTML =
        '<style>' + S.GUARD + '</style>' +
        '<div class="jdg-root" data-theme="' + J.resolveTheme(cfg) + '">' +
        '<div class="scrim"><div class="box">' +
        '<div class="top">' +
        '<div class="icn">' + (o.icon || '⏸') + '</div>' +
        '<h2>' + o.title + '</h2>' +
        '<p>' + o.body + '</p>' +
        (o.rows || []).map(function (r) {
          return '<div class="num"><span class="k">' + r[0] + '</span>' +
            '<span class="v ' + (r[2] || '') + '">' + r[1] + '</span></div>';
        }).join('') +
        '</div>' +
        '<div class="acts">' +
        '<button class="btn ' + (o.reverse ? 'go' : 'stay') + ' a">' + o.cancelLabel + '</button>' +
        '<button class="btn ' + (o.reverse ? 'stay' : 'go') + ' b">' + o.okLabel + '</button>' +
        '</div></div></div></div>';

      document.body.appendChild(gh);
      var done = function (v) { gh.remove(); resolve(v); };
      gs.querySelector('.a').onclick = function () { done(false); };
      gs.querySelector('.b').onclick = function () { done(true); };
    });
  }

  function guardDialog(l, form) {
    var waitUntil = l.targetOut != null ? J.fmtClock(l.targetOut) : J.fmtClock(J.nowMinutes() + l.remaining);
    confirmDialog({
      icon: '⚡',
      title: 'That clock-out lands short',
      body: 'You have logged <b>' + J.fmtDurShort(l.worked) + '</b> of the ' +
        J.fmtDurShort(cfg.requiredMinutes) + ' required. Clocking out now stamps today with an <b>Early Exit</b>.',
      rows: [
        ['Short by', J.fmtDur(l.remaining), 'bad'],
        ['Clear ' + J.fmtDurShort(cfg.requiredMinutes) + ' at', waitUntil, 'ok']
      ],
      cancelLabel: 'Stay until ' + waitUntil,
      okLabel: 'Clock out anyway'
    }).then(function (go) {
      if (!go) return;
      overrideClockOut = true;
      form.submit(); // native submit: does not re-fire the submit event
    });
  }

  function installGuard() {
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || !form.getAttribute) return;
      if ((form.getAttribute('action') || '').indexOf('/attendance/clockout') === -1) return;
      if (!cfg.guardEarlyExit || overrideClockOut) return;

      var l = PUMP.live();
      if (l.state !== 'working' && l.state !== 'break') return;
      if (l.worked >= cfg.requiredMinutes) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      guardDialog(l, form);
    }, true);
  }

  /* =================================================================== go = */

  PUMP.ready.then(function (c) {
    cfg = c;
    injectStyles();
    installGuard();
    renderAttendance();
    watchCalendar();
    paintCalendar();
    if (cfg.oneClickPause) loadHalfDay().then(function () { PUMP.poke(); });

    PUMP.subscribe(function (l) {
      renderChip(l);
      renderPauseButton(l);
      renderDashboard(l);
    });
  });

  root.JDG_PORTAL_UI = { paintCalendar: paintCalendar, renderAttendance: renderAttendance };
})(typeof self !== 'undefined' ? self : this);
