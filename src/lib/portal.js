/*
 * JDG Clockwork — shared portal model.
 *
 * Loaded three ways:
 *   - content script (has DOM + same-origin cookies -> can fetch & parse)
 *   - service worker via importScripts (no DOM -> parse* functions unused there)
 *   - popup page (has DOM, but NO portal cookies -> talks to a portal tab instead)
 *
 * Everything that touches the network lives in the page context on purpose: the
 * Laravel session cookie is SameSite=Lax, so a fetch originating from the
 * extension origin would arrive logged-out. Content script fetches are
 * same-origin and always carry the session.
 */
(function (root) {
  'use strict';

  var PORTAL = 'https://team.justdigitalgurus.com';

  var DEFAULTS = {
    shiftStart: 8 * 60,        // minutes after midnight the shift begins
    graceMinutes: 15,          // late_by >= this renders the red "Late" badge
    requiredMinutes: 8 * 60,   // below this the portal stamps "Early Exit"
    leadTimes: [30, 15, 5],    // pre-shift nudges, minutes before shiftStart
    breakWarnMinutes: 45,      // warn once a single break runs this long
    guardEarlyExit: true,      // intercept clock-out that would land under 8h
    theme: 'light',            // 'light' | 'dark' | 'auto' — extension surfaces only
    hudEnabled: false,         // the floating panel; off by default now that the
                               // portal itself carries the same numbers inline
    hudCollapsed: false,
    chipEnabled: true,         // top-bar readout on every portal page
    dashboardCards: true,      // "today" + month panels on /dashboard
    calendarMarks: true,       // tint late / early-exit days on the dashboard calendar
    attendanceEnrich: true,    // summary strip + vs-8h column on /attendance
    notifyTargetReached: true,
    morningAlarms: true,
    calibrated: false,         // set once shift times are derived from real data

    /* One-click pause. The button picks the reason from the clock so you never
       open the dropdown. All four boundaries are editable. */
    oneClickPause: true,
    lunchFrom: 12 * 60 + 30,   // before this a pause is a SMALL BREAK
    lunchUntil: 15 * 60 + 30,  // between the two it is BREAK TIME (lunch)
    clockOutFrom: 17 * 60,     // from here the button clocks out instead
    halfDayOutFrom: 12 * 60,   // on an approved half day, leave from here

    /* Lunch is a fixed fixture of the day, so a leaving time worked out before
       lunch has to allow for it. Small breaks are not predictable and are never
       assumed — only counted once actually taken. */
    lunchWindowStart: 13 * 60 + 20,
    lunchWindowEnd: 14 * 60 + 45,
    expectedLunchMinutes: 55,

    /* JDG does not pay overtime, so extra time is reported as a plain fact
       rather than as a balance being accrued. */
    treatOvertimeAsBanked: false,

    version: 2                 // settings schema; see migrate()
  };

  /** 'auto' follows the OS; anything else is taken literally. */
  function resolveTheme(cfg) {
    var t = (cfg && cfg.theme) || 'light';
    if (t !== 'auto') return t;
    return (typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  /* ---------------------------------------------------------------- time -- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // "08:27 AM" -> 507 ; returns null for blanks / junk
  function parseClock12(s) {
    if (!s) return null;
    var m = String(s).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    var h = parseInt(m[1], 10) % 12;
    if (/PM/i.test(m[3])) h += 12;
    return h * 60 + parseInt(m[2], 10);
  }

  // "00:27" or "8:26" -> minutes ; null when empty or "00:00" placeholder rows
  function parseDuration(s) {
    if (!s) return null;
    var m = String(s).match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function fmtDur(mins) {
    if (mins == null || isNaN(mins)) return '—';
    var neg = mins < 0;
    mins = Math.abs(Math.round(mins));
    var h = Math.floor(mins / 60), m = mins % 60;
    var s = h ? h + 'h ' + pad2(m) + 'm' : m + 'm';
    return (neg ? '-' : '') + s;
  }

  function fmtDurShort(mins) {
    if (mins == null || isNaN(mins)) return '—';
    mins = Math.max(0, Math.round(mins));
    return Math.floor(mins / 60) + ':' + pad2(mins % 60);
  }

  function fmtClock(mins) {
    if (mins == null || isNaN(mins)) return '—';
    mins = Math.round(mins);
    var day = ((mins % 1440) + 1440) % 1440;
    var h = Math.floor(day / 60), m = day % 60;
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + pad2(m) + ' ' + ap;
  }

  function nowMinutes(d) {
    d = d || new Date();
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  }

  // "17-08-2026" -> "2026-08-17"
  function toISO(ddmmyyyy) {
    var m = String(ddmmyyyy || '').match(/(\d{2})-(\d{2})-(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
  }

  function todayDMY(d) {
    d = d || new Date();
    return pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '-' + d.getFullYear();
  }

  /* ------------------------------------------------------------- settings -- */

  var SCHEMA_VERSION = 2;

  /**
   * Version 1 wrote its entire default set to storage the first time it
   * calibrated, so an old install carries `hudEnabled: true` even though the
   * user never chose it. Without this, the new default (the portal now shows
   * the same numbers inline) could never take effect. Drop only the keys the
   * user cannot have set deliberately, then stamp the version.
   */
  function migrate(stored) {
    if (!stored || !Object.keys(stored).length) return { changed: false, settings: stored };
    var v = stored.version || 1;
    if (v >= SCHEMA_VERSION) return { changed: false, settings: stored };

    if (v < 2) delete stored.hudEnabled;
    stored.version = SCHEMA_VERSION;
    return { changed: true, settings: stored };
  }

  function getSettings() {
    return new Promise(function (resolve) {
      chrome.storage.local.get({ settings: {} }, function (o) {
        var m = migrate(o.settings || {});
        var s = {};
        for (var k in DEFAULTS) s[k] = DEFAULTS[k];
        for (var j in m.settings) s[j] = m.settings[j];
        if (m.changed) chrome.storage.local.set({ settings: m.settings });
        resolve(s);
      });
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (cur) {
      for (var k in patch) cur[k] = patch[k];
      return new Promise(function (resolve) {
        chrome.storage.local.set({ settings: cur }, function () { resolve(cur); });
      });
    });
  }

  function cacheGet(key, fallback) {
    return new Promise(function (resolve) {
      var q = {}; q[key] = fallback;
      chrome.storage.local.get(q, function (o) { resolve(o[key]); });
    });
  }

  function cacheSet(key, value) {
    return new Promise(function (resolve) {
      var q = {}; q[key] = value;
      chrome.storage.local.set(q, function () { resolve(value); });
    });
  }

  /* ------------------------------------------------------------- caching --- */
  /*
   * The portal is server-rendered HTML, so every panel used to cost its own
   * round trip and a full parse — about ten requests per page load before
   * anything appeared. Results are memoised for the life of the page, shared
   * between in-flight callers, and persisted in chrome.storage so a second page
   * load usually needs no network at all.
   */

  var _memo = {};       // key -> { ts, v } for this page
  var _inflight = {};   // key -> promise, so two panels asking at once cost one fetch

  var TTL = {
    pastMonth: 7 * 24 * 60 * 60 * 1000,   // a finished month never changes again
    thisMonth: 60 * 1000,
    holidays: 12 * 60 * 60 * 1000,
    leave: 30 * 60 * 1000
  };

  function cacheFetch(key, ttlMs, fetcher) {
    var hit = _memo[key];
    if (hit && (Date.now() - hit.ts) < ttlMs) return Promise.resolve(hit.v);
    if (_inflight[key]) return _inflight[key];

    var storeKey = 'cache_' + key;
    var p = new Promise(function (resolve) {
      chrome.storage.local.get([storeKey], function (o) {
        var stored = o[storeKey];
        if (stored && (Date.now() - stored.ts) < ttlMs) {
          _memo[key] = stored;
          delete _inflight[key];
          resolve(stored.v);
          return;
        }
        fetcher().then(function (v) {
          var rec = { ts: Date.now(), v: v };
          _memo[key] = rec;
          var put = {}; put[storeKey] = rec;
          chrome.storage.local.set(put);
          delete _inflight[key];
          resolve(v);
        }).catch(function () {
          delete _inflight[key];
          resolve(stored ? stored.v : null);   // stale beats blank
        });
      });
    });
    _inflight[key] = p;
    return p;
  }

  /** Month rows, cached. Finished months are kept for a week. */
  function month(m, y) {
    var now = new Date();
    var isCurrent = (m === now.getMonth() + 1 && y === now.getFullYear());
    return cacheFetch('m' + y + '-' + m, isCurrent ? TTL.thisMonth : TTL.pastMonth, function () {
      return fetchMonth(m, y).then(function (r) { return r.loggedOut ? null : r.days; });
    }).then(function (v) { return v || []; });
  }

  function holidays(year) {
    return cacheFetch('h' + year, TTL.holidays, function () {
      return fetchHolidays(year).then(function (r) { return r.loggedOut ? null : r.holidays; });
    }).then(function (v) { return v || []; });
  }

  function leave(m, y) {
    return cacheFetch('l' + y + '-' + m, TTL.leave, function () {
      return fetchLeave(m, y).then(function (r) { return r.loggedOut ? null : r.leaves; });
    }).then(function (v) { return v || []; });
  }

  /** Drop every cached page so the next read goes to the portal. */
  function clearCache() {
    _memo = {}; _inflight = {};
    return new Promise(function (resolve) {
      chrome.storage.local.get(null, function (all) {
        var kill = Object.keys(all).filter(function (k) { return k.indexOf('cache_') === 0; });
        if (!kill.length) { resolve(0); return; }
        chrome.storage.local.remove(kill, function () { resolve(kill.length); });
      });
    });
  }

  /* ---------------------------------------------------------- HTML -> data -- */

  function looksLoggedOut(doc) {
    return !!doc.querySelector('input[type=password]');
  }

  /**
   * Parse a /attendance?month=&year= response. The server renders every day of
   * the month; the portal's own JS only paginates what is already in the DOM.
   */
  function parseMonthHTML(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (looksLoggedOut(doc)) return { loggedOut: true, days: [] };

    var days = [];
    var rows = doc.querySelectorAll('tbody tr');
    for (var i = 0; i < rows.length; i++) {
      var td = rows[i].querySelectorAll('td');
      if (td.length < 7) continue;

      var txt = function (n) { return (td[n].textContent || '').replace(/\s+/g, ' ').trim(); };
      var date = txt(1).match(/\d{2}-\d{2}-\d{4}/);
      if (!date) continue;
      date = date[0];

      var inCell = txt(2), outCell = txt(3), hourCell = txt(5);
      var statusCell = td[6];
      var badge = statusCell.querySelector('.att-badge');
      var status = (badge ? badge.textContent : statusCell.textContent).replace(/\s+/g, ' ').trim();

      var link = rows[i].querySelector('a[href*="/attendance/"]');
      var detailId = link ? (link.getAttribute('href').match(/\/attendance\/(\d+)/) || [])[1] : null;

      var iso = toISO(date);
      days.push({
        date: date,
        iso: iso,
        dow: iso ? new Date(iso + 'T00:00:00').getDay() : null,
        clockIn: parseClock12(inCell),
        clockOut: parseClock12(outCell),
        lateBy: parseDuration(txt(4)) || 0,
        total: parseDuration(hourCell.split(' ')[0]),
        status: status,
        hardLate: /(^|\s)Late(\s|$)/.test(inCell) && !/Running/.test(inCell),
        runningLate: /Running Late/.test(inCell),
        earlyExit: /Early Exit/.test(hourCell),
        fullDay: /present/i.test(status),
        detailId: detailId ? parseInt(detailId, 10) : null
      });
    }
    return { loggedOut: false, days: days };
  }

  /** Parse /attendance/{id} -> the day's work segments (breaks are the gaps). */
  function parseDayHTML(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (looksLoggedOut(doc)) return { loggedOut: true, segments: [] };

    var segments = [];
    var rows = doc.querySelectorAll('tbody tr');
    for (var i = 0; i < rows.length; i++) {
      var td = rows[i].querySelectorAll('td');
      if (td.length < 2) continue;
      var start = parseClock12(td[0].textContent);
      if (start == null) continue;
      segments.push({
        start: start,
        stop: parseClock12(td[1].textContent),
        message: td[2] ? (td[2].textContent || '').replace(/\s+/g, ' ').trim() : ''
      });
    }
    return { loggedOut: false, segments: segments };
  }

  /* ----------------------------------------------------------- networking -- */
  /* Only usable from the portal's own origin (content script). */

  function fetchMonth(month, year) {
    return fetch(PORTAL + '/attendance?month=' + month + '&year=' + year, {
      credentials: 'same-origin'
    }).then(function (r) { return r.text(); }).then(parseMonthHTML);
  }

  function fetchDay(id) {
    return fetch(PORTAL + '/attendance/' + id, { credentials: 'same-origin' })
      .then(function (r) { return r.text(); }).then(parseDayHTML);
  }

  /** Everything needed to render today: the row plus its segment breakdown. */
  function fetchToday() {
    var d = new Date();
    // Goes through the shared month cache, so the dashboard panels and the
    // attendance page reuse this one response instead of each fetching it.
    return month(d.getMonth() + 1, d.getFullYear()).then(function (days) {
      if (!days.length) return { loggedOut: false, row: null, segments: [], month: [] };
      var key = todayDMY(d);
      var row = null;
      for (var i = 0; i < days.length; i++) if (days[i].date === key) row = days[i];
      if (!row) return { loggedOut: false, row: null, segments: [], month: days };
      if (!row.detailId) return { loggedOut: false, row: row, segments: [], month: days };
      return fetchDay(row.detailId).then(function (dr) {
        return { loggedOut: dr.loggedOut, row: row, segments: dr.segments, month: days };
      });
    });
  }

  /* -------------------------------------------------------------- compute -- */

  /**
   * Turn (row, segments, clock) into the live picture.
   *
   * targetOut is anchored to the current segment's start rather than to "now",
   * so it is a fixed wall-clock time that does not drift as the minutes tick.
   */
  function computeLive(row, segments, now, cfg) {
    cfg = cfg || DEFAULTS;
    segments = segments || [];

    var out = {
      state: 'off', clockIn: null, clockOut: null, lateBy: 0, hardLate: false,
      worked: 0, workedClosed: 0, breaks: 0, longestBreak: 0, remaining: cfg.requiredMinutes,
      targetOut: null, resumeTarget: null, short: cfg.requiredMinutes,
      onBreakSince: null, breakSoFar: 0, isHoliday: false, status: row ? row.status : null
    };

    if (row) {
      out.status = row.status;
      out.isHoliday = /holiday|leave|week off|absent/i.test(row.status || '');
      out.clockIn = row.clockIn;
      out.clockOut = row.clockOut;
      out.lateBy = row.lateBy || 0;
      out.hardLate = out.lateBy >= cfg.graceMinutes;
    }

    if (!segments.length) {
      out.state = out.isHoliday ? 'off' : 'not-clocked-in';
      return out;
    }

    var open = null;
    var lunchTaken = false;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      if (s.stop == null) {
        open = s;
        out.worked += Math.max(0, now - s.start);
      } else {
        out.workedClosed += s.stop - s.start;
      }
      if (i > 0 && segments[i - 1].stop != null) {
        var gapStart = segments[i - 1].stop, gapEnd = s.start;
        var gap = gapEnd - gapStart;
        if (gap > 0) {
          out.breaks += gap;
          out.longestBreak = Math.max(out.longestBreak, gap);
          if (overlapsLunch(gapStart, gapEnd, gap, cfg)) lunchTaken = true;
        }
      }
    }
    out.worked += out.workedClosed;

    var last = segments[segments.length - 1];

    // A break running now, inside the lunch window, is lunch happening.
    if (!open && last.stop != null && overlapsLunch(last.stop, Math.max(now, last.stop), now - last.stop, cfg)) {
      lunchTaken = true;
    }
    out.lunchTaken = lunchTaken;

    // Lunch still ahead of you is time you will not be working, so the leaving
    // time has to be pushed out by it. Small breaks are deliberately not
    // predicted — they only count once taken.
    out.pendingLunch = (!lunchTaken && now < cfg.lunchWindowEnd) ? cfg.expectedLunchMinutes : 0;

    if (row && row.clockOut != null) {
      out.state = 'done';
      out.worked = row.total != null ? row.total : out.workedClosed;
      out.pendingLunch = 0;
    } else if (open) {
      out.state = 'working';
      out.targetOut = open.start + (cfg.requiredMinutes - out.workedClosed) + out.pendingLunch;
    } else {
      out.state = 'break';
      out.onBreakSince = last.stop;
      out.breakSoFar = Math.max(0, now - last.stop);
      out.resumeTarget = now + (cfg.requiredMinutes - out.worked) + out.pendingLunch;
    }

    out.remaining = Math.max(0, cfg.requiredMinutes - out.worked);
    out.short = Math.max(0, cfg.requiredMinutes - out.worked);
    return out;
  }

  /** A gap counts as lunch if it is substantial and lands in the lunch window. */
  function overlapsLunch(gapStart, gapEnd, gap, cfg) {
    if (gap < 15) return false;
    return gapStart < cfg.lunchWindowEnd && gapEnd > cfg.lunchWindowStart;
  }

  /* ------------------------------------------------------------ analytics -- */

  function isWorkingDay(d) {
    return d.clockIn != null || /present|half/i.test(d.status || '');
  }

  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /**
   * Punctuality stats are computed over full "Present" days whose own numbers
   * are self-consistent.
   *
   * Two kinds of row have to be held out or the averages lie:
   *  - half days / leave days worked partially: a 4-hour day is not an early exit
   *  - rows where the portal's own Late By does not equal (clock-in − shift start),
   *    e.g. 11-03-2026 shows an 8:05 AM arrival charged as 230 minutes late.
   *    Those are surfaced separately rather than silently averaged in.
   */
  function summarize(days, cfg) {
    cfg = cfg || DEFAULTS;
    var work = days.filter(isWorkingDay);

    var anomalies = [], consistent = [];
    work.forEach(function (d) {
      if (d.clockIn == null) { consistent.push(d); return; }
      // Late By is clamped at zero, so the identity only holds once you are late;
      // an on-time row just has to have arrived at or before the shift start.
      var bad = d.lateBy > 0
        ? Math.abs((d.clockIn - d.lateBy) - cfg.shiftStart) > 2
        : d.clockIn > cfg.shiftStart + 2;
      (bad ? anomalies : consistent).push(d);
    });
    var full = consistent.filter(function (d) { return d.fullDay; });
    var partial = consistent.filter(function (d) { return !d.fullDay; });

    var s = {
      days: full.length,
      allDays: work.length,
      partialDays: partial.length,
      anomalies: anomalies,
      onTime: 0, runningLate: 0, hardLate: 0,
      earlyExits: 0, minutesShort: 0,
      lateMinutes: 0, clockInSum: 0, clockInN: 0,
      totalWorked: 0, totalWorkedN: 0,
      overtime: 0, lates: [],
      byDow: [], streakBest: 0, streakCurrent: 0,
      earliest: null, latest: null
    };
    for (var i = 0; i < 7; i++) s.byDow.push({ dow: i, n: 0, lateSum: 0, lateN: 0, hardLate: 0, lates: [] });

    var streak = 0;
    full.forEach(function (d) {
      var late = d.lateBy || 0;
      s.lateMinutes += late;
      s.lates.push(late);
      if (late === 0) { s.onTime++; streak++; }
      else { streak = 0; if (late >= cfg.graceMinutes) s.hardLate++; else s.runningLate++; }
      s.streakBest = Math.max(s.streakBest, streak);

      if (d.clockIn != null) {
        s.clockInSum += d.clockIn; s.clockInN++;
        if (s.earliest == null || d.clockIn < s.earliest.clockIn) s.earliest = d;
        if (s.latest == null || d.clockIn > s.latest.clockIn) s.latest = d;
      }
      if (d.total != null) {
        s.totalWorked += d.total; s.totalWorkedN++;
        if (d.total > cfg.requiredMinutes) s.overtime += d.total - cfg.requiredMinutes;
        if (d.earlyExit) {
          s.earlyExits++;
          s.minutesShort += Math.max(0, cfg.requiredMinutes - d.total);
        }
      }
      if (d.dow != null) {
        var b = s.byDow[d.dow];
        b.n++; b.lateSum += late; b.lateN++; b.lates.push(late);
        if (late >= cfg.graceMinutes) b.hardLate++;
      }
    });

    s.byDow.forEach(function (b) { b.median = median(b.lates) || 0; });

    s.streakCurrent = streak;
    s.avgClockIn = s.clockInN ? s.clockInSum / s.clockInN : null;
    s.avgLate = s.days ? s.lateMinutes / s.days : 0;
    s.medianLate = median(s.lates) || 0;
    s.avgWorked = s.totalWorkedN ? s.totalWorked / s.totalWorkedN : null;
    s.onTimeRate = s.days ? s.onTime / s.days : 0;
    s.cleanRate = s.days ? (s.days - s.hardLate) / s.days : 0;
    s.net = s.totalWorked - cfg.requiredMinutes * s.totalWorkedN;
    return s;
  }

  /* ------------------------------------------------------- calendar maths -- */

  function isoAdd(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isoDow(iso) { return new Date(iso + 'T00:00:00').getDay(); }
  function isoToday(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isoLabel(iso) {
    return new Date(iso + 'T00:00:00')
      .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /**
   * Which weekdays this employee does not work — derived, not assumed.
   *
   * Judged by proportion rather than "never": one stray Saturday clock-in (the
   * 18-04-2026 row logs 9:54 PM on a paid holiday) should not turn Saturday
   * into a working day.
   */
  function weekendDays(days) {
    var worked = [0, 0, 0, 0, 0, 0, 0], seen = [0, 0, 0, 0, 0, 0, 0];
    days.forEach(function (d) {
      if (d.dow == null) return;
      seen[d.dow]++;
      if (d.clockIn != null) worked[d.dow]++;
    });
    var out = [];
    for (var i = 0; i < 7; i++) {
      if (seen[i] >= 3 && (worked[i] / seen[i]) <= 0.2) out.push(i);
    }
    return out.length ? out : [0, 6];
  }

  /* -------------------------------------------------------------- holidays -- */

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseHolidayDate(s) {
    var m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (!m) return null;
    var mon = MONTHS[m[2].toLowerCase()];
    if (mon == null) return null;
    return m[3] + '-' + pad2(mon + 1) + '-' + pad2(parseInt(m[1], 10));
  }

  /** The holiday page renders .hol-item blocks; ranges use an en dash. */
  function parseHolidaysHTML(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (looksLoggedOut(doc)) return { loggedOut: true, holidays: [] };
    var out = [];
    doc.querySelectorAll('.hol-item').forEach(function (it) {
      var nameEl = it.querySelector('.hol-name');
      var dateEl = it.querySelector('.hol-dates');
      if (!nameEl || !dateEl) return;
      var txt = (dateEl.textContent || '').replace(/\s+/g, ' ').trim();
      var parts = txt.split(/[–—]|(?:\s-\s)/);
      var start = parseHolidayDate(parts[0]);
      var end = parts[1] ? parseHolidayDate(parts[1]) : start;
      if (!start) return;
      out.push({ name: nameEl.textContent.trim(), start: start, end: end || start });
    });
    return { loggedOut: false, holidays: out };
  }

  function fetchHolidays(year) {
    var url = PORTAL + '/holiday' + (year ? '?year=' + year : '');
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.text(); }).then(parseHolidaysHTML);
  }

  /** Expand ranges into a { iso: name } lookup. */
  function holidayMap(holidays) {
    var map = {};
    (holidays || []).forEach(function (h) {
      var cur = h.start, guard = 0;
      while (guard++ < 40) {
        map[cur] = h.name;
        if (cur === h.end) break;
        cur = isoAdd(cur, 1);
      }
    });
    return map;
  }

  /* -------------------------------------------------------- leave planner -- */

  /**
   * Find the leave days that buy the longest continuous break.
   * A "bridge" is one or two working days wedged between days already off;
   * spending leave there converts a normal weekend into a long one.
   */
  function leaveSuggestions(holidays, weekend, fromISO, horizonDays, maxCost) {
    var hmap = holidayMap(holidays);
    var wk = {};
    (weekend || [0, 6]).forEach(function (d) { wk[d] = true; });
    maxCost = maxCost || 2;
    horizonDays = horizonDays || 180;

    function isOff(iso, extra) {
      if (extra && extra[iso]) return true;
      return !!hmap[iso] || !!wk[isoDow(iso)];
    }

    var out = [];
    for (var i = 1; i <= horizonDays; i++) {
      var start = isoAdd(fromISO, i);
      if (isOff(start, null)) continue;

      for (var cost = 1; cost <= maxCost; cost++) {
        var extra = {}, ok = true, cur = start;
        for (var c = 0; c < cost; c++) {
          if (isOff(cur, null)) { ok = false; break; }
          extra[cur] = true;
          cur = isoAdd(cur, 1);
        }
        if (!ok) continue;

        // Grow outwards while the surrounding days are also off.
        var lo = start, hi = isoAdd(start, cost - 1), guard = 0;
        while (guard++ < 30 && isOff(isoAdd(lo, -1), extra)) lo = isoAdd(lo, -1);
        guard = 0;
        while (guard++ < 30 && isOff(isoAdd(hi, 1), extra)) hi = isoAdd(hi, 1);

        var total = Math.round((new Date(hi + 'T00:00:00') - new Date(lo + 'T00:00:00')) / 86400000) + 1;
        if (total < cost + 3) continue;   // must beat an ordinary weekend

        var names = {};
        var scan = lo, g2 = 0;
        while (g2++ < 40) {
          if (hmap[scan]) names[hmap[scan]] = true;
          if (scan === hi) break;
          scan = isoAdd(scan, 1);
        }

        var leaveDates = [];
        for (var k = 0; k < cost; k++) leaveDates.push(isoAdd(start, k));

        out.push({
          leaveDates: leaveDates, cost: cost,
          runStart: lo, runEnd: hi, totalDays: total,
          ratio: total / cost,
          holidays: Object.keys(names)
        });
      }
    }

    // Best value first; drop suggestions whose run is already covered better.
    out.sort(function (a, b) { return (b.ratio - a.ratio) || (b.totalDays - a.totalDays) || (a.runStart < b.runStart ? -1 : 1); });
    var seen = {}, top = [];
    out.forEach(function (s) {
      var key = s.runStart + '|' + s.runEnd;
      if (seen[key]) return;
      seen[key] = true;
      top.push(s);
    });
    return top;
  }

  /* ------------------------------------------------------------- forecast -- */

  /**
   * Where this month's hours balance lands if the rest of it looks like the
   * days already worked. Median daily delta, so one long day does not flatter it.
   */
  function forecastMonth(monthDays, cfg, holidays, weekend, todayISO) {
    cfg = cfg || DEFAULTS;
    todayISO = todayISO || isoToday();
    var s = summarize(monthDays, cfg);

    var deltas = monthDays.filter(function (d) {
      return d.fullDay && d.total != null && d.iso && d.iso <= todayISO;
    }).map(function (d) { return d.total - cfg.requiredMinutes; });

    var hmap = holidayMap(holidays);
    var wk = {};
    (weekend || [0, 6]).forEach(function (d) { wk[d] = true; });

    var y = parseInt(todayISO.slice(0, 4), 10), m = parseInt(todayISO.slice(5, 7), 10);
    var lastDay = new Date(y, m, 0).getDate();
    var remaining = 0;
    for (var day = parseInt(todayISO.slice(8, 10), 10) + 1; day <= lastDay; day++) {
      var iso = y + '-' + pad2(m) + '-' + pad2(day);
      if (hmap[iso] || wk[isoDow(iso)]) continue;
      remaining++;
    }

    var typical = deltas.length ? median(deltas) : 0;
    return {
      netSoFar: s.net,
      daysCounted: s.totalWorkedN,
      remainingWorkdays: remaining,
      typicalDelta: typical,
      projectedNet: s.net + remaining * typical,
      earlyExits: s.earlyExits,
      monthEnd: y + '-' + pad2(m) + '-' + pad2(lastDay)
    };
  }

  /* ------------------------------------------- regularization candidates -- */

  /** Days worth raising, ordered by how hard they are to argue with. */
  function regularizationCandidates(days, cfg, todayISO) {
    cfg = cfg || DEFAULTS;
    todayISO = todayISO || isoToday();
    var s = summarize(days, cfg);
    var anomalous = {};
    s.anomalies.forEach(function (d) { anomalous[d.date] = true; });

    var out = [];
    days.forEach(function (d) {
      if (!d.iso || d.iso >= todayISO) return;   // today is still in progress

      if (anomalous[d.date] && d.clockIn != null) {
        out.push({
          day: d, severity: 3, kind: 'contradiction',
          title: 'Late By does not match your clock-in',
          detail: 'Clocked in ' + fmtClock(d.clockIn) + ' but charged ' + fmtDur(d.lateBy) +
            ' late, which implies a ' + fmtClock(d.clockIn - d.lateBy) + ' shift start.'
        });
        return;
      }
      if (d.clockIn != null && d.clockOut == null) {
        out.push({
          day: d, severity: 2, kind: 'no-clockout',
          title: 'No clock-out recorded',
          detail: 'Clocked in at ' + fmtClock(d.clockIn) + ' with no matching clock-out, so the day logged ' +
            (d.total != null ? fmtDurShort(d.total) : 'nothing') + '.'
        });
        return;
      }
      if (/absent/i.test(d.status || '')) {
        out.push({
          day: d, severity: 2, kind: 'absent',
          title: 'Marked Absent',
          detail: 'No attendance recorded. Worth checking against leave you had approved.'
        });
        return;
      }
      if (d.fullDay && d.earlyExit && d.total != null) {
        out.push({
          day: d, severity: 1, kind: 'early-exit',
          title: 'Early Exit by ' + fmtDur(cfg.requiredMinutes - d.total),
          detail: 'Logged ' + fmtDurShort(d.total) + ' against ' + fmtDurShort(cfg.requiredMinutes) + '.'
        });
      }
    });

    out.sort(function (a, b) { return (b.severity - a.severity) || (a.day.iso < b.day.iso ? 1 : -1); });
    return out;
  }

  /* ------------------------------------------------------------ half days -- */

  /**
   * Approved leave, from /leave?month=&year=. Columns are
   * name | details | applied on | date range | leave type | type | days | status
   */
  function parseLeaveHTML(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (looksLoggedOut(doc)) return { loggedOut: true, leaves: [] };
    var out = [];
    doc.querySelectorAll('tbody tr').forEach(function (tr) {
      var td = tr.querySelectorAll('td');
      if (td.length < 8) return;
      var txt = function (n) { return (td[n].textContent || '').replace(/\s+/g, ' ').trim(); };
      var range = txt(3).match(/(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}-\d{2}-\d{4})/);
      if (!range) return;
      out.push({
        from: toISO(range[1]),
        to: toISO(range[2]),
        kind: txt(4),
        paid: txt(5),
        days: parseFloat(txt(6)) || 0,
        status: txt(7),
        approved: /approved/i.test(txt(7))
      });
    });
    return { loggedOut: false, leaves: out };
  }

  function fetchLeave(month, year) {
    return fetch(PORTAL + '/leave?month=' + month + '&year=' + year, { credentials: 'same-origin' })
      .then(function (r) { return r.text(); }).then(parseLeaveHTML);
  }

  /** Is `iso` covered by an approved leave of half a day? */
  function isHalfDayOn(leaves, iso) {
    return (leaves || []).some(function (l) {
      return l.approved && l.days > 0 && l.days < 1 && l.from <= iso && iso <= l.to;
    });
  }

  /* ------------------------------------------------------ one-click pause -- */

  var PAUSE_REASONS = { LUNCH: 'BREAK TIME', SHORT: 'SMALL BREAK', HOME: 'LEAVING FOR HOME' };

  /**
   * Pick what a single click should do, purely from the clock:
   *
   *   approved half day, from halfDayOutFrom  -> clock out ("leaving for home")
   *   from clockOutFrom                       -> clock out
   *   lunchFrom .. lunchUntil                 -> pause, BREAK TIME
   *   anything else                           -> pause, SMALL BREAK
   */
  function resolvePauseAction(nowMins, isHalfDay, cfg) {
    cfg = cfg || DEFAULTS;

    if (isHalfDay && nowMins >= cfg.halfDayOutFrom) {
      return { action: 'clockout', reason: PAUSE_REASONS.HOME, label: 'Leaving for home', why: 'half day' };
    }
    if (nowMins >= cfg.clockOutFrom) {
      return { action: 'clockout', reason: PAUSE_REASONS.HOME, label: 'Clock out', why: 'after ' + fmtClock(cfg.clockOutFrom) };
    }
    if (nowMins >= cfg.lunchFrom && nowMins < cfg.lunchUntil) {
      return { action: 'pause', reason: PAUSE_REASONS.LUNCH, label: 'Lunch break', why: fmtClock(cfg.lunchFrom) + '–' + fmtClock(cfg.lunchUntil) };
    }
    return { action: 'pause', reason: PAUSE_REASONS.SHORT, label: 'Small break', why: nowMins < cfg.lunchFrom ? 'before ' + fmtClock(cfg.lunchFrom) : 'after ' + fmtClock(cfg.lunchUntil) };
  }

  /* --------------------------------------------------------- break budget -- */

  /** The clock-out time you actually keep to, from your own history. */
  function usualClockOut(days) {
    var outs = days.filter(function (d) {
      return d.fullDay && d.clockOut != null && d.clockIn != null;
    }).map(function (d) { return d.clockOut; });
    return outs.length >= 3 ? median(outs) : null;
  }

  /**
   * How much break is left before your usual leaving time stops being enough.
   * Negative means you are already committed to staying later than usual.
   */
  function breakBudget(l, usualOut, cfg) {
    cfg = cfg || DEFAULTS;
    if (usualOut == null || l.clockIn == null) return null;
    var window = usualOut - l.clockIn;
    var allowance = window - cfg.requiredMinutes;
    return {
      usualOut: usualOut,
      allowance: allowance,
      used: l.breaks,
      left: allowance - l.breaks
    };
  }

  /**
   * Derive shiftStart and grace from real rows instead of trusting a default.
   * shiftStart is exactly (clockIn - lateBy); grace is the smallest lateBy that
   * the portal chose to render as a hard "Late".
   */
  function calibrate(days) {
    var starts = {}, bestStart = null, bestN = 0;
    var minHard = null, maxRunning = null;

    days.forEach(function (d) {
      if (d.clockIn == null || !d.lateBy) return;
      var st = d.clockIn - d.lateBy;
      starts[st] = (starts[st] || 0) + 1;
      if (starts[st] > bestN) { bestN = starts[st]; bestStart = st; }
      if (d.hardLate) minHard = minHard == null ? d.lateBy : Math.min(minHard, d.lateBy);
      if (d.runningLate) maxRunning = maxRunning == null ? d.lateBy : Math.max(maxRunning, d.lateBy);
    });

    // The true cutoff sits somewhere in (maxRunning, minHard]. Prefer the lower
    // bound: over-estimating grace would tell you there is time left when the
    // portal has already decided you are Late.
    var grace = null;
    if (maxRunning != null) grace = maxRunning + 1;
    if (minHard != null) grace = grace == null ? minHard : Math.min(grace, minHard);

    return {
      shiftStart: bestStart,
      graceMinutes: grace,
      confidence: bestN
    };
  }

  root.JDG = {
    PORTAL: PORTAL,
    DEFAULTS: DEFAULTS,
    pad2: pad2,
    parseClock12: parseClock12,
    parseDuration: parseDuration,
    fmtDur: fmtDur,
    fmtDurShort: fmtDurShort,
    fmtClock: fmtClock,
    nowMinutes: nowMinutes,
    toISO: toISO,
    todayDMY: todayDMY,
    getSettings: getSettings,
    setSettings: setSettings,
    resolveTheme: resolveTheme,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    parseMonthHTML: parseMonthHTML,
    parseDayHTML: parseDayHTML,
    fetchMonth: fetchMonth,
    fetchDay: fetchDay,
    fetchToday: fetchToday,
    cacheFetch: cacheFetch,
    clearCache: clearCache,
    month: month,
    holidays: holidays,
    leave: leave,
    computeLive: computeLive,
    summarize: summarize,
    median: median,
    calibrate: calibrate,
    isoAdd: isoAdd,
    isoDow: isoDow,
    isoToday: isoToday,
    isoLabel: isoLabel,
    weekendDays: weekendDays,
    parseHolidaysHTML: parseHolidaysHTML,
    fetchHolidays: fetchHolidays,
    holidayMap: holidayMap,
    leaveSuggestions: leaveSuggestions,
    forecastMonth: forecastMonth,
    regularizationCandidates: regularizationCandidates,
    usualClockOut: usualClockOut,
    breakBudget: breakBudget,
    parseLeaveHTML: parseLeaveHTML,
    fetchLeave: fetchLeave,
    isHalfDayOn: isHalfDayOn,
    resolvePauseAction: resolvePauseAction,
    PAUSE_REASONS: PAUSE_REASONS,
    isWorkingDay: isWorkingDay
  };
})(typeof self !== 'undefined' ? self : this);
