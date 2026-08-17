/* JDG Clockwork — toolbar popup.
 * The popup has no portal cookies, so it reads the mirror the content script
 * writes and delegates anything live to an open portal tab.
 */
(function () {
  'use strict';

  var J = window.JDG;
  var $ = function (id) { return document.getElementById(id); };
  var cfg = null, mirror = null;

  /* ------------------------------------------------------------- rendering */

  function cell(k, v, cls) {
    return '<div class="cell"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
  }

  function render() {
    var box = $('today'), dot = $('dot'), sub = $('sub');

    if (!mirror) {
      dot.className = 'dot';
      sub.textContent = 'no data yet';
      box.innerHTML = '<div class="warnbox">Open the team portal once so Clockwork can read today\'s attendance.</div>';
      $('stamp').textContent = 'never synced';
      return;
    }

    var age = Math.round((Date.now() - mirror.ts) / 60000);
    $('stamp').textContent = age < 1 ? 'synced just now' : 'synced ' + age + ' min ago';

    if (mirror.date !== J.todayDMY()) {
      dot.className = 'dot';
      sub.textContent = 'stale';
      box.innerHTML = '<div class="warnbox">Last sync was ' + mirror.date + '. Open the portal to refresh today.</div>';
      return;
    }

    var required = mirror.requiredMinutes;
    var now = J.nowMinutes();

    // Extend the mirror forward so the popup is live between syncs.
    var elapsed = (Date.now() - mirror.ts) / 60000;
    var worked = mirror.worked + (mirror.state === 'working' ? elapsed : 0);
    var breakSoFar = mirror.breakSoFar + (mirror.state === 'break' ? elapsed : 0);
    var remaining = Math.max(0, required - worked);
    var progress = Math.min(100, (worked / required) * 100);

    if (mirror.isHoliday && mirror.clockIn == null) {
      dot.className = 'dot done'; sub.textContent = 'rest day';
      box.innerHTML = '<div class="hero ok"><span class="big">Rest day</span></div>' +
        '<div class="cap">Portal marks today as <b>' + (mirror.status || 'off') + '</b>.</div>';
      return;
    }

    if (mirror.state === 'not-clocked-in') {
      var delta = mirror.shiftStart - now;
      if (delta > 0) {
        dot.className = 'dot'; sub.textContent = 'not clocked in';
        box.innerHTML = '<div class="hero"><span class="big">' + J.fmtDur(delta) + '</span><span class="unit">until ' + J.fmtClock(mirror.shiftStart) + '</span></div>' +
          '<div class="cap">Grace closes at <b>' + J.fmtClock(mirror.shiftStart + mirror.graceMinutes) + '</b>.</div>';
      } else {
        var over = -delta;
        dot.className = 'dot late'; sub.textContent = 'late, not clocked in';
        box.innerHTML = '<div class="hero ' + (over >= mirror.graceMinutes ? 'bad' : 'warn') + '">' +
          '<span class="big">' + J.fmtDur(over) + '</span><span class="unit">past start</span></div>' +
          '<div class="cap">' + (over >= mirror.graceMinutes
            ? 'Already past grace — today will carry a <b>Late</b> mark.'
            : '<b>' + J.fmtDur(mirror.graceMinutes - over) + '</b> of grace left.') + '</div>';
      }
      return;
    }

    if (mirror.state === 'done') {
      var short = required - mirror.worked;
      dot.className = 'dot done'; sub.textContent = 'clocked out';
      box.innerHTML = '<div class="hero ' + (short > 0 ? 'bad' : 'ok') + '">' +
        '<span class="big">' + J.fmtDurShort(mirror.worked) + '</span><span class="unit">logged</span></div>' +
        '<div class="cap">' + (short > 0
          ? '<b>' + J.fmtDur(short) + '</b> short — flagged ⚡ Early Exit.'
          : '<b>+' + J.fmtDur(-short) + '</b> over the requirement.') + '</div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(mirror.clockIn), mirror.hardLate ? 'bad' : '') +
        cell('Out', J.fmtClock(mirror.clockOut)) +
        cell('Late by', mirror.lateBy ? mirror.lateBy + ' min' : 'on time', mirror.hardLate ? 'bad' : '') +
        cell('Breaks', J.fmtDur(mirror.breaks)) +
        '</div>';
      return;
    }

    if (mirror.state === 'break') {
      dot.className = 'dot break'; sub.textContent = 'on break';
      box.innerHTML = '<div class="hero warn"><span class="big">' + J.fmtDur(breakSoFar) + '</span><span class="unit">on break</span></div>' +
        '<div class="cap">Resume now → 8h clears at <b>' + J.fmtClock(now + remaining) + '</b>.</div>' +
        '<div class="bar"><i class="warn" style="width:' + progress + '%"></i></div>' +
        '<div class="barlabels"><span>' + J.fmtDurShort(worked) + ' worked</span><span>' + J.fmtDurShort(required) + '</span></div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(mirror.clockIn), mirror.hardLate ? 'bad' : '') +
        cell('Still owed', J.fmtDur(remaining), 'warn') +
        '</div>';
      return;
    }

    // working
    dot.className = 'dot working';
    if (remaining <= 0) {
      sub.textContent = 'full day cleared';
      box.innerHTML = '<div class="hero ok"><span class="big">Free to go</span></div>' +
        '<div class="cap">8h cleared — <b>+' + J.fmtDur(worked - required) + '</b> over.</div>' +
        '<div class="bar"><i class="ok" style="width:100%"></i></div>' +
        '<div class="barlabels"><span>' + J.fmtDurShort(worked) + ' worked</span><span>' + J.fmtDurShort(required) + '</span></div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(mirror.clockIn), mirror.hardLate ? 'bad' : '') +
        cell('Breaks', J.fmtDur(mirror.breaks)) +
        '</div>';
    } else {
      sub.textContent = 'working';
      box.innerHTML = '<div class="hero"><span class="big">' + J.fmtClock(mirror.targetOut) + '</span><span class="unit">clock-out target</span></div>' +
        '<div class="cap"><b>' + J.fmtDur(remaining) + '</b> to go before you clear 8h.</div>' +
        '<div class="bar"><i class="warn" style="width:' + progress + '%"></i></div>' +
        '<div class="barlabels"><span>' + J.fmtDurShort(worked) + ' worked</span><span>' + J.fmtDurShort(required) + '</span></div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(mirror.clockIn), mirror.hardLate ? 'bad' : '') +
        cell('Late by', mirror.lateBy ? mirror.lateBy + ' min' : 'on time', mirror.hardLate ? 'bad' : '') +
        cell('Breaks', J.fmtDur(mirror.breaks)) +
        cell('If out now', '−' + J.fmtDur(remaining), 'bad') +
        '</div>';
    }
  }

  /* ---------------------------------------------------------- portal tabs -- */

  function withPortalTab(action) {
    chrome.tabs.query({ url: J.PORTAL + '/*' }, function (tabs) {
      if (tabs && tabs.length) {
        var tab = tabs[0];
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
        chrome.tabs.sendMessage(tab.id, { type: action }, function () {
          void chrome.runtime.lastError; // tab may still be loading; the flag below covers it
          window.close();
        });
      } else {
        // Nothing open: leave a short-lived flag the content script picks up on boot.
        J.cacheSet('pendingAction', { action: action, ts: Date.now() }).then(function () {
          chrome.tabs.create({ url: J.PORTAL + '/dashboard' });
          window.close();
        });
      }
    });
  }

  /* ------------------------------------------------------------- settings -- */

  var TOGGLES = ['chipEnabled', 'dashboardCards', 'calendarMarks', 'attendanceEnrich',
    'hudEnabled', 'oneClickPause', 'guardEarlyExit', 'morningAlarms', 'notifyTargetReached'];
  var TIMES = ['lunchFrom', 'lunchUntil', 'clockOutFrom', 'halfDayOutFrom'];

  function toTimeValue(mins) { return J.pad2(Math.floor(mins / 60)) + ':' + J.pad2(mins % 60); }
  function fromTimeValue(v, fallback) {
    var p = String(v || '').split(':');
    if (p.length < 2) return fallback;
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', J.resolveTheme(cfg));
  }

  function fillSettings() {
    $('shiftStart').value = J.pad2(Math.floor(cfg.shiftStart / 60)) + ':' + J.pad2(cfg.shiftStart % 60);
    $('requiredHours').value = (cfg.requiredMinutes / 60).toString();
    $('grace').value = cfg.graceMinutes;
    $('breakWarn').value = cfg.breakWarnMinutes;
    $('leads').value = (cfg.leadTimes || []).join(', ');
    $('theme').value = cfg.theme || 'light';
    TOGGLES.forEach(function (id) { $(id).checked = !!cfg[id]; });
    TIMES.forEach(function (id) { $(id).value = toTimeValue(cfg[id]); });
    $('calNote').textContent = cfg.calibrated
      ? 'Shift window was detected from your own attendance rows.'
      : 'Using defaults — open the portal once and Clockwork will detect your real shift window.';
    applyTheme();
  }

  function save() {
    var t = ($('shiftStart').value || '08:00').split(':');
    var leads = ($('leads').value || '').split(/[,\s]+/)
      .map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x) && x > 0 && x < 240; });

    var patch = {
      shiftStart: parseInt(t[0], 10) * 60 + parseInt(t[1] || '0', 10),
      requiredMinutes: Math.round(parseFloat($('requiredHours').value || '8') * 60),
      graceMinutes: parseInt($('grace').value || '15', 10),
      breakWarnMinutes: parseInt($('breakWarn').value || '45', 10),
      leadTimes: leads.length ? leads : [30, 15, 5],
      theme: $('theme').value,
      calibrated: true
    };
    TOGGLES.forEach(function (id) { patch[id] = $(id).checked; });
    TIMES.forEach(function (id) { patch[id] = fromTimeValue($(id).value, cfg[id]); });

    J.setSettings(patch).then(function (c) {
      cfg = c;
      applyTheme();
      chrome.runtime.sendMessage({ type: 'TICK' });
      // Portal tabs pick the change up on their next render.
      chrome.tabs.query({ url: J.PORTAL + '/*' }, function (tabs) {
        (tabs || []).forEach(function (tb) {
          chrome.tabs.sendMessage(tb.id, { type: 'REFRESH' }, function () { void chrome.runtime.lastError; });
        });
      });
    });
  }

  /* ----------------------------------------------------------------- boot -- */

  Promise.all([J.getSettings(), J.cacheGet('today', null)]).then(function (r) {
    cfg = r[0]; mirror = r[1];
    fillSettings();
    render();
    setInterval(render, 15000);
  });

  $('insights').onclick = function () { withPortalTab('OPEN_INSIGHTS'); };
  $('portal').onclick = function () {
    chrome.tabs.create({ url: J.PORTAL + '/dashboard' });
    window.close();
  };
  $('refresh').onclick = function () {
    chrome.tabs.query({ url: J.PORTAL + '/*' }, function (tabs) {
      if (!tabs || !tabs.length) { withPortalTab('REFRESH'); return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'REFRESH' }, function () {
        void chrome.runtime.lastError;
        J.cacheGet('today', null).then(function (t) { mirror = t; render(); });
      });
    });
  };
  $('recal').onclick = function () {
    J.setSettings({ calibrated: false }).then(function () {
      $('calNote').textContent = 'Cleared — open the portal and Clockwork will re-detect on next sync.';
    });
  };

  ['shiftStart', 'requiredHours', 'grace', 'breakWarn', 'leads', 'theme']
    .concat(TOGGLES).concat(TIMES)
    .forEach(function (id) { $(id).addEventListener('change', save); });
})();
