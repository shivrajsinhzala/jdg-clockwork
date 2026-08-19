/* JDG Clockwork — the data pump.
 *
 * Single owner of "what is true right now". The floating HUD and the injected
 * portal panels are both subscribers, so they never fetch independently and can
 * never disagree with each other.
 */
(function (root) {
  'use strict';

  var J = root.JDG;

  var cfg = null;
  var data = { row: null, segments: [], month: [], loggedOut: false, ts: 0 };
  var subs = [];
  var breakWarned = false;
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  function live() {
    return J.computeLive(data.row, data.segments, J.nowMinutes(), cfg || J.DEFAULTS);
  }

  function emit() {
    var l = live();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](l, data, cfg); } catch (e) { /* one bad subscriber must not stall the rest */ }
    }
  }

  function subscribe(fn) {
    subs.push(fn);
    if (cfg) { try { fn(live(), data, cfg); } catch (e) {} }
    return function () { subs = subs.filter(function (f) { return f !== fn; }); };
  }

  /** Mirror today into storage so the popup and badge work with no tab fetch. */
  function publish() {
    var l = live();
    J.cacheSet('today', {
      ts: Date.now(),
      date: J.todayDMY(),
      state: l.state, status: l.status, isHoliday: l.isHoliday,
      clockIn: l.clockIn, clockOut: l.clockOut,
      lateBy: l.lateBy, hardLate: l.hardLate,
      worked: Math.round(l.worked), breaks: Math.round(l.breaks),
      breakSoFar: Math.round(l.breakSoFar), remaining: Math.round(l.remaining),
      targetOut: l.targetOut,
      pendingLunch: Math.round(l.pendingLunch || 0),
      shiftStart: cfg.shiftStart, graceMinutes: cfg.graceMinutes,
      requiredMinutes: cfg.requiredMinutes
    });
  }

  /**
   * Paint before the network. Today's segments are stable — a clock-in at 08:27
   * is still 08:27 a page load later — so recomputing yesterday's cached copy
   * against the current clock gives the correct answer immediately, and the
   * refresh behind it only ever confirms or corrects it.
   */
  function paintFromCache() {
    return J.cacheGet('todayRaw', null).then(function (raw) {
      if (!raw || raw.date !== J.todayDMY() || data.ts) return false;
      data.row = raw.row;
      data.segments = raw.segments || [];
      data.month = raw.month || [];
      data.ts = raw.ts;
      data.fromCache = true;
      emit();
      return true;
    });
  }

  /** force=true drops every cached page first, for a user-initiated refresh. */
  function refresh(force) {
    var pre = force ? J.clearCache() : Promise.resolve();
    return pre.then(function () { return J.fetchToday(); }).then(function (r) {
      if (r.loggedOut) { data.loggedOut = true; emit(); return; }
      data.loggedOut = false;
      data.row = r.row;
      data.segments = r.segments || [];
      data.month = r.month || [];
      data.ts = Date.now();
      data.fromCache = false;

      J.cacheSet('todayRaw', {
        date: J.todayDMY(), ts: data.ts,
        row: data.row, segments: data.segments, month: data.month
      });

      // Derive the real shift window from the user's own rows, once.
      if (!cfg.calibrated && data.month.length) {
        var cal = J.calibrate(data.month);
        if (cal.shiftStart != null && cal.confidence >= 3) {
          cfg.shiftStart = cal.shiftStart;
          if (cal.graceMinutes) cfg.graceMinutes = cal.graceMinutes;
          cfg.calibrated = true;
          J.setSettings({ shiftStart: cfg.shiftStart, graceMinutes: cfg.graceMinutes, calibrated: true });
        }
      }

      publish();
      emit();
    }).catch(function () { /* transient failure: keep the last good state on screen */ });
  }

  function tick() {
    emit();
    var l = live();
    if (l.state === 'break' && l.breakSoFar >= cfg.breakWarnMinutes && !breakWarned) {
      breakWarned = true;
      chrome.runtime.sendMessage({
        type: 'NOTIFY', key: 'long-break',
        title: 'Break running long',
        message: 'On break ' + J.fmtDur(l.breakSoFar) + '. Resume now and you clear ' +
          J.fmtDurShort(cfg.requiredMinutes) + ' at ' + J.fmtClock(l.resumeTarget) + '.'
      });
    }
    if (l.state !== 'break') breakWarned = false;
  }

  /* The popup leaves a flag when it had to open the portal itself. */
  function consumePendingAction() {
    J.cacheGet('pendingAction', null).then(function (p) {
      if (!p || Date.now() - p.ts > 30000) return;
      J.cacheSet('pendingAction', null);
      if (p.action === 'OPEN_INSIGHTS' && root.JDG_INSIGHTS) root.JDG_INSIGHTS.open();
      if (p.action === 'REFRESH') refresh();
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || !msg.type) return;
    if (msg.type === 'OPEN_INSIGHTS') {
      if (root.JDG_INSIGHTS) root.JDG_INSIGHTS.open();
      reply({ ok: true });
      return;
    }
    if (msg.type === 'REFRESH') { refresh(true).then(function () { reply({ ok: true }); }); return true; }
    if (msg.type === 'GET_TODAY') {
      var send = function () { reply({ ok: true, live: live(), cfg: cfg, ts: data.ts, loggedOut: data.loggedOut }); };
      if (Date.now() - data.ts > 60000) refresh().then(send); else send();
      return true;
    }
  });

  J.getSettings().then(function (c) {
    cfg = c;
    readyResolve(cfg);
    paintFromCache();
    refresh().then(consumePendingAction);
    setInterval(tick, 20000);
    setInterval(refresh, 90000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && Date.now() - data.ts > 45000) refresh();
    });
  });

  root.JDG_PUMP = {
    ready: ready,
    cfg: function () { return cfg; },
    data: function () { return data; },
    live: live,
    refresh: refresh,
    subscribe: subscribe,
    // Force a redraw when something outside the pump changes what subscribers
    // can render — e.g. extras.js resolving the usual clock-out.
    poke: emit
  };
})(typeof self !== 'undefined' ? self : this);
