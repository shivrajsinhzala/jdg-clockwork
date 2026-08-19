/* Integration checks over the real sources with a real-data fixture. */
(function () {
  var J = window.JDG;
  var results = [];

  function ok(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail == null ? '' : String(detail) });
  }
  function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.5 : tol); }

  var days = window.hydrate(window.FIXTURE_ROWS);

  /* ---- time formatting ---- */
  ok('parseClock12 morning', J.parseClock12('08:27 AM') === 507, J.parseClock12('08:27 AM'));
  ok('parseClock12 afternoon', J.parseClock12('02:48 PM') === 888, J.parseClock12('02:48 PM'));
  ok('parseClock12 noon', J.parseClock12('12:05 PM') === 725, J.parseClock12('12:05 PM'));
  ok('parseClock12 midnight', J.parseClock12('12:30 AM') === 30, J.parseClock12('12:30 AM'));
  ok('parseClock12 blank', J.parseClock12('') === null);
  ok('parseDuration', J.parseDuration('00:27') === 27 && J.parseDuration('8:26') === 506);
  ok('fmtClock roundtrip', J.fmtClock(1025) === '5:05 PM', J.fmtClock(1025));
  ok('fmtDur', J.fmtDur(141) === '2h 21m', J.fmtDur(141));
  ok('fmtDurShort', J.fmtDurShort(506) === '8:26', J.fmtDurShort(506));

  /* ---- calibration ---- */
  var cal = J.calibrate(days);
  ok('calibrate finds 08:00 start', cal.shiftStart === 480, cal.shiftStart);
  ok('calibrate grace is conservative', cal.graceMinutes === 16, cal.graceMinutes);
  ok('calibrate confidence high', cal.confidence > 50, cal.confidence);

  var cfg = {
    shiftStart: cal.shiftStart, graceMinutes: cal.graceMinutes,
    requiredMinutes: 480, leadTimes: [30, 15, 5], breakWarnMinutes: 45
  };

  /* ---- live day maths ---- */
  var today = days[days.length - 1];
  var L = J.computeLive(today, window.FIXTURE_SEGMENTS, 884, cfg); // 02:44 PM
  ok('live state is working', L.state === 'working', L.state);
  ok('closed work is 5h24', L.workedClosed === 324, L.workedClosed);
  ok('break total is 38m', L.breaks === 38, L.breaks);
  ok('worked = closed + open leg', near(L.worked, 324 + 15), L.worked);
  ok('clock-out target is 5:05 PM', L.targetOut === 1025 && J.fmtClock(L.targetOut) === '5:05 PM', J.fmtClock(L.targetOut));
  ok('target ignores the passing clock',
    J.computeLive(today, window.FIXTURE_SEGMENTS, 950, cfg).targetOut === 1025);

  /* ---- lunch is a fixture of the day, so the target must allow for it ---- */
  var LC = {
    shiftStart: 480, graceMinutes: 16, requiredMinutes: 480,
    lunchWindowStart: 13 * 60 + 20, lunchWindowEnd: 14 * 60 + 45, expectedLunchMinutes: 55
  };
  // Clocked in 08:27, still working at 10:00, lunch not taken yet.
  var preLunch = J.computeLive(today, [{ start: 507, stop: null, message: '' }], 600, LC);
  ok('lunch ahead is detected', preLunch.pendingLunch === 55 && !preLunch.lunchTaken, preLunch.pendingLunch);
  ok('target allows for the coming lunch',
    preLunch.targetOut === 507 + 480 + 55, J.fmtClock(preLunch.targetOut));
  ok('without the allowance it would be 55m early',
    J.computeLive(today, [{ start: 507, stop: null, message: '' }], 600,
      { shiftStart: 480, graceMinutes: 16, requiredMinutes: 480, lunchWindowStart: 800, lunchWindowEnd: 0, expectedLunchMinutes: 55 }
    ).targetOut === 507 + 480);

  // Same day after a 13:51-14:29 lunch: it is spent, so nothing more is added.
  var postLunch = J.computeLive(today, window.FIXTURE_SEGMENTS, 900, LC);
  ok('a taken lunch is recognised', postLunch.lunchTaken === true);
  ok('nothing is added once lunch is done', postLunch.pendingLunch === 0, postLunch.pendingLunch);
  ok('post-lunch target counts only real breaks',
    postLunch.targetOut === 869 + (480 - 324), J.fmtClock(postLunch.targetOut));

  // A short mid-morning break is not lunch.
  var smallBreak = J.computeLive(today,
    [{ start: 507, stop: 660, message: 'SMALL BREAK' }, { start: 670, stop: null, message: '' }], 700, LC);
  ok('a small break is not mistaken for lunch', smallBreak.lunchTaken === false);
  ok('lunch still pending after a small break', smallBreak.pendingLunch === 55, smallBreak.pendingLunch);

  // Sitting in the lunch break right now.
  var atLunch = J.computeLive(today, [{ start: 507, stop: 815, message: 'BREAK TIME' }], 840, LC);
  ok('lunch in progress counts as taken', atLunch.lunchTaken === true, atLunch.state);
  ok('resume target does not double-count lunch',
    atLunch.pendingLunch === 0 && atLunch.resumeTarget === 840 + (480 - 308), J.fmtClock(atLunch.resumeTarget));

  // Late afternoon with no lunch logged: the window has passed, assume none.
  var noLunchLate = J.computeLive(today, [{ start: 507, stop: null, message: '' }], 960, LC);
  ok('past the lunch window nothing is assumed', noLunchLate.pendingLunch === 0, noLunchLate.pendingLunch);

  var onBreak = J.computeLive(today, [{ start: 507, stop: 831, message: 'BREAK' }], 850, cfg);
  ok('paused day reads as break', onBreak.state === 'break', onBreak.state);
  ok('break elapsed is right', onBreak.breakSoFar === 19, onBreak.breakSoFar);
  ok('resume target shifts with the break', onBreak.resumeTarget === 850 + (480 - 324), onBreak.resumeTarget);

  var finished = days.filter(function (d) { return d.date === '11-08-2026'; })[0];
  var F = J.computeLive(finished, [{ start: 506, stop: 1056, message: '' }], 1200, cfg);
  ok('finished day reads as done', F.state === 'done', F.state);
  ok('finished day uses the portal total', F.worked === 461, F.worked);

  var holiday = days.filter(function (d) { return d.date === '15-08-2026'; })[0];
  var H = J.computeLive(holiday, [], 600, cfg);
  ok('holiday detected', H.isHoliday && H.state === 'off', H.state);

  var notIn = J.computeLive({ status: 'Present', clockIn: null, lateBy: 0 }, [], 470, cfg);
  ok('not-clocked-in detected', notIn.state === 'not-clocked-in', notIn.state);

  /* ---- summary robustness ---- */
  var s = J.summarize(days, cfg);
  ok('anomalous rows held out', s.anomalies.length === 7, s.anomalies.length + ' -> ' +
    s.anomalies.map(function (d) { return d.date; }).join(' '));
  ok('early arrivals are not anomalies',
    !s.anomalies.some(function (d) { return d.date === '02-03-2026' || d.date === '16-04-2026'; }));
  ok('half/leave days held out', s.partialDays >= 4, s.partialDays);
  ok('median late is the honest number', s.medianLate <= 12 && s.medianLate >= 5, s.medianLate);
  ok('mean is dragged higher than median', s.avgLate > s.medianLate, s.avgLate.toFixed(1));
  ok('early exits count only full days',
    s.earlyExits > 0 && s.earlyExits < 25, s.earlyExits);
  ok('minutes short is plausible', s.minutesShort > 0 && s.minutesShort < 900, s.minutesShort);
  ok('on-time rate in range', s.onTimeRate >= 0 && s.onTimeRate <= 1, (s.onTimeRate * 100).toFixed(1) + '%');
  ok('net computed', typeof s.net === 'number' && !isNaN(s.net), s.net);
  ok('weekday medians present', s.byDow.filter(function (b) { return b.n; }).every(function (b) {
    return typeof b.median === 'number' && !isNaN(b.median);
  }));
  ok('11-03 flagged as contradictory',
    s.anomalies.some(function (d) { return d.date === '11-03-2026'; }));
  ok('30-03 kept (genuinely 110 min late)',
    !s.anomalies.some(function (d) { return d.date === '30-03-2026'; }));

  /* ---- settings migration ---- */
  ok('defaults carry a schema version', J.DEFAULTS.version === 2, J.DEFAULTS.version);

  /* ---- calendar + holiday maths ---- */
  ok('isoAdd crosses a month', J.isoAdd('2026-08-31', 1) === '2026-09-01', J.isoAdd('2026-08-31', 1));
  ok('isoAdd goes backwards', J.isoAdd('2026-09-01', -1) === '2026-08-31');
  ok('weekend derived from real rows',
    J.weekendDays(days).join(',') === '0,6', J.weekendDays(days).join(','));

  var HOL = J.parseHolidaysHTML(
    '<div class="hol-item"><span class="hol-name">Rakshabandhan</span>' +
    '<div class="hol-dates">28 Aug 2026</div></div>' +
    '<div class="hol-item"><span class="hol-name">Janmashtami</span>' +
    '<div class="hol-dates">04 Sep 2026 – 06 Sep 2026</div></div>' +
    '<div class="hol-item"><span class="hol-name">Dusshera</span>' +
    '<div class="hol-dates">20 Oct 2026</div></div>' +
    '<div class="hol-item"><span class="hol-name">Diwali</span>' +
    '<div class="hol-dates">07 Nov 2026 – 09 Nov 2026</div></div>').holidays;

  ok('holiday page parses', HOL.length === 4, HOL.length);
  ok('single-day holiday', HOL[0].start === '2026-08-28' && HOL[0].end === '2026-08-28', HOL[0].start);
  ok('holiday range', HOL[1].start === '2026-09-04' && HOL[1].end === '2026-09-06', HOL[1].start + '..' + HOL[1].end);
  var hmap = J.holidayMap(HOL);
  ok('range expands to every day',
    hmap['2026-09-04'] && hmap['2026-09-05'] && hmap['2026-09-06'] && !hmap['2026-09-07']);

  /* Dusshera 2026 falls on a Tuesday: taking Monday 19 Oct should buy 4 days. */
  var sugg = J.leaveSuggestions(HOL, [0, 6], '2026-10-01', 60, 2);
  var dus = sugg.filter(function (s) { return s.leaveDates.indexOf('2026-10-19') !== -1 && s.cost === 1; })[0];
  ok('finds the Dusshera bridge', !!dus, dus && dus.totalDays + ' days');
  ok('Dusshera bridge is 4 days', dus && dus.totalDays === 4 && dus.runStart === '2026-10-17' && dus.runEnd === '2026-10-20',
    dus && dus.runStart + '..' + dus.runEnd);
  ok('bridge names its holiday', dus && dus.holidays.indexOf('Dusshera') !== -1);
  ok('suggestions never propose a day already off',
    sugg.every(function (s) {
      return s.leaveDates.every(function (d) { return !hmap[d] && [0, 6].indexOf(J.isoDow(d)) === -1; });
    }));
  ok('suggestions beat a plain weekend',
    sugg.every(function (s) { return s.totalDays >= s.cost + 3; }));
  ok('best suggestion ranks first by value',
    sugg.length > 1 && sugg[0].ratio >= sugg[sugg.length - 1].ratio, sugg[0].ratio.toFixed(2));

  /* ---- forecast ---- */
  var augDays = days.filter(function (d) { return d.iso && d.iso.slice(0, 7) === '2026-08'; });
  var fc = J.forecastMonth(augDays, cfg, HOL, [0, 6], '2026-08-17');
  // 18–21 (4) + 24–27 (4, 28 Aug is Rakshabandhan) + 31 (1) = 9
  ok('forecast counts remaining workdays', fc.remainingWorkdays === 9, fc.remainingWorkdays);
  ok('forecast excludes the Rakshabandhan holiday',
    J.forecastMonth(augDays, cfg, [], [0, 6], '2026-08-17').remainingWorkdays === 10,
    J.forecastMonth(augDays, cfg, [], [0, 6], '2026-08-17').remainingWorkdays);
  ok('forecast projects from a median day',
    fc.projectedNet === fc.netSoFar + fc.remainingWorkdays * fc.typicalDelta, fc.projectedNet);
  ok('forecast net matches summarize', fc.netSoFar === J.summarize(augDays, cfg).net, fc.netSoFar);

  /* ---- regularization ---- */
  var reg = J.regularizationCandidates(days, cfg, '2026-08-17');
  ok('regularization finds candidates', reg.length > 0, reg.length);
  ok('contradictions rank first', reg[0].severity === 3, reg[0].kind);
  ok('11-03 contradiction listed',
    reg.some(function (r) { return r.day.date === '11-03-2026' && r.kind === 'contradiction'; }));
  ok('missing clock-out listed',
    reg.some(function (r) { return r.day.date === '17-04-2026' && r.kind === 'no-clockout'; }));
  ok('absent day listed', reg.some(function (r) { return r.kind === 'absent'; }));
  ok('today is never a candidate',
    !reg.some(function (r) { return r.day.date === '17-08-2026'; }));
  ok('half days are not called early exits',
    !reg.some(function (r) { return r.kind === 'early-exit' && !r.day.fullDay; }));

  /* ---- break budget ---- */
  var usual = J.usualClockOut(days);
  ok('usual clock-out is a sane evening time', usual > 16 * 60 && usual < 19 * 60, J.fmtClock(usual));
  var bb = J.breakBudget(L, usual, cfg);
  ok('break budget computed', bb && typeof bb.left === 'number', bb && J.fmtDur(bb.left));
  ok('budget = window minus required', bb && bb.allowance === (usual - L.clockIn) - cfg.requiredMinutes, bb && bb.allowance);
  ok('budget left = allowance minus breaks', bb && bb.left === bb.allowance - L.breaks, bb && bb.left);
  ok('no budget without history', J.breakBudget(L, null, cfg) === null);

  /* ---- one-click pause rules ---- */
  var PC = {
    lunchFrom: 12 * 60 + 30, lunchUntil: 15 * 60 + 30,
    clockOutFrom: 17 * 60, halfDayOutFrom: 12 * 60
  };
  var plan = function (hhmm, half) {
    var p = hhmm.split(':');
    return J.resolvePauseAction(parseInt(p[0], 10) * 60 + parseInt(p[1], 10), !!half, PC);
  };

  ok('09:30 is a small break', plan('09:30').reason === 'SMALL BREAK' && plan('09:30').action === 'pause', plan('09:30').reason);
  ok('12:29 is still a small break', plan('12:29').reason === 'SMALL BREAK', plan('12:29').reason);
  ok('12:30 becomes lunch', plan('12:30').reason === 'BREAK TIME', plan('12:30').reason);
  ok('14:00 is lunch', plan('14:00').reason === 'BREAK TIME', plan('14:00').reason);
  ok('15:29 is still lunch', plan('15:29').reason === 'BREAK TIME', plan('15:29').reason);
  ok('15:30 flips back to small break', plan('15:30').reason === 'SMALL BREAK', plan('15:30').reason);
  ok('16:45 is a small break', plan('16:45').reason === 'SMALL BREAK', plan('16:45').reason);
  ok('16:59 still pauses', plan('16:59').action === 'pause', plan('16:59').action);
  ok('17:00 clocks out', plan('17:00').action === 'clockout', plan('17:00').action);
  ok('18:20 clocks out', plan('18:20').action === 'clockout', plan('18:20').action);
  ok('clock-out reason is leaving for home', plan('17:30').reason === 'LEAVING FOR HOME', plan('17:30').reason);

  ok('half day before noon still breaks normally',
    plan('11:00', true).action === 'pause' && plan('11:00', true).reason === 'SMALL BREAK');
  ok('half day at noon leaves for home',
    plan('12:00', true).action === 'clockout' && plan('12:00', true).reason === 'LEAVING FOR HOME',
    plan('12:00', true).action);
  ok('half day beats the lunch window',
    plan('13:00', true).action === 'clockout', plan('13:00', true).action);
  ok('full day at 13:00 is lunch, not a clock-out',
    plan('13:00', false).action === 'pause', plan('13:00', false).action);
  ok('every reason is a real portal option',
    ['09:00', '13:00', '16:00', '18:00'].every(function (t) {
      return ['BREAK TIME', 'SMALL BREAK', 'LEAVING FOR HOME'].indexOf(plan(t).reason) !== -1;
    }));
  ok('each plan explains itself', plan('13:00').why && plan('09:00').label, plan('13:00').why);

  /* ---- leave parsing / half-day detection ---- */
  var LEAVE = J.parseLeaveHTML(
    '<table><tbody>' +
    '<tr><td>Shivrajsinh Zala</td><td>Details</td><td>03-08-2026</td>' +
    '<td>03-08-2026 - 03-08-2026</td><td>medical leave</td><td>paid</td><td>0.5</td><td>✓ Approved</td><td></td></tr>' +
    '<tr><td>Shivrajsinh Zala</td><td>Details</td><td>07-08-2026</td>' +
    '<td>06-08-2026 - 06-08-2026</td><td>medical leave</td><td>paid</td><td>1</td><td>✓ Approved</td><td></td></tr>' +
    '<tr><td>Shivrajsinh Zala</td><td>Details</td><td>01-09-2026</td>' +
    '<td>10-09-2026 - 10-09-2026</td><td>casual</td><td>paid</td><td>0.5</td><td>Pending</td><td></td></tr>' +
    '</tbody></table>').leaves;

  ok('leave rows parse', LEAVE.length === 3, LEAVE.length);
  ok('leave date range parses', LEAVE[0].from === '2026-08-03' && LEAVE[0].to === '2026-08-03', LEAVE[0].from);
  ok('half day recognised', J.isHalfDayOn(LEAVE, '2026-08-03') === true);
  ok('full leave day is not a half day', J.isHalfDayOn(LEAVE, '2026-08-06') === false);
  ok('unrelated day is not a half day', J.isHalfDayOn(LEAVE, '2026-08-17') === false);
  ok('pending half day is ignored', J.isHalfDayOn(LEAVE, '2026-09-10') === false);

  /* ---- caching: the fix for waiting on every page load ---- */
  var calls = 0;
  var slowFetch = function () { calls++; return Promise.resolve({ n: calls }); };

  /* ---- charts produce sane SVG ---- */
  var work = days.filter(function (d) {
    return J.isWorkingDay(d) && d.fullDay &&
      !s.anomalies.some(function (a) { return a.date === d.date; });
  });
  var CH = window.JDG_CHARTS;
  var svgs = {
    clockIn: CH.clockInChart(work, cfg, J.fmtClock),
    hours: CH.hoursChart(work, cfg),
    dow: CH.dowChart(s, cfg),
    hist: CH.lateHistogram(work, cfg)
  };
  Object.keys(svgs).forEach(function (k) {
    var v = svgs[k];
    ok(k + ' chart: no NaN', v.indexOf('NaN') === -1);
    ok(k + ' chart: no undefined', v.indexOf('undefined') === -1);
    ok(k + ' chart: parses as XML',
      !new DOMParser().parseFromString(v, 'image/svg+xml').querySelector('parsererror'));
  });
  ok('histogram caps the tail at 60+', svgs.hist.indexOf('60+') !== -1);

  /* ---- caching behaviour (async, appended after the synchronous checks) ---- */
  function cacheChecks() {
    var k = 'test' + Math.random().toString(36).slice(2);
    return J.cacheFetch(k, 60000, slowFetch)
      .then(function (a) {
        ok('cacheFetch returns the fetched value', a && a.n === 1, a && a.n);
        return J.cacheFetch(k, 60000, slowFetch);
      })
      .then(function (b) {
        ok('second read is served from cache, no refetch', calls === 1 && b.n === 1, 'calls=' + calls);
        // Two panels asking at the same moment must cost one fetch, not two.
        var k2 = 'test' + Math.random().toString(36).slice(2);
        var before = calls;
        return Promise.all([
          J.cacheFetch(k2, 60000, slowFetch),
          J.cacheFetch(k2, 60000, slowFetch),
          J.cacheFetch(k2, 60000, slowFetch)
        ]).then(function (rs) {
          ok('concurrent readers share one fetch', calls === before + 1, 'calls went ' + before + ' -> ' + calls);
          ok('all concurrent readers get the same value',
            rs[0].n === rs[1].n && rs[1].n === rs[2].n);
          // A zero TTL must always go back to the source.
          return J.cacheFetch(k2, 0, slowFetch);
        });
      })
      .then(function () {
        ok('expired entries refetch', calls >= 3, 'calls=' + calls);
        return J.cacheFetch('never-set-' + Math.random(), 60000, function () {
          return Promise.reject(new Error('network down'));
        });
      })
      .then(function (v) {
        ok('a failed fetch with no cache resolves null rather than throwing', v === null, String(v));
      });
  }

  /* ---- render ---- */
  function paintResults() {
    var pass = results.filter(function (r) { return r.pass; }).length;
    document.getElementById('summary').innerHTML =
      '<strong>' + pass + ' / ' + results.length + ' checks passed</strong>';
    document.getElementById('summary').className = pass === results.length ? 'all-pass' : 'has-fail';
    document.getElementById('results').innerHTML = results.map(function (r) {
      return '<li class="' + (r.pass ? 'p' : 'f') + '"><span>' + (r.pass ? 'PASS' : 'FAIL') + '</span> ' +
        r.name + (r.detail ? ' <em>(' + r.detail + ')</em>' : '') + '</li>';
    }).join('');
    window.__testResults = results;
  }
  paintResults();
  cacheChecks().then(paintResults, function (e) {
    ok('cache checks ran without throwing', false, String(e));
    paintResults();
  });

  /* ---- live UI smoke test: point the sources at the fixture, then boot them ---- */
  // Stub the cached accessors too — month() calls the internal binding, so
  // replacing J.fetchMonth on its own would not be observed.
  var monthOf = function (month, year) {
    var tag = '-' + (month < 10 ? '0' + month : month) + '-' + year;
    return days.filter(function (d) { return d.date.indexOf(tag) === 2; });
  };
  J.fetchMonth = function (m, y) { return Promise.resolve({ loggedOut: false, days: monthOf(m, y) }); };
  J.month = function (m, y) { return Promise.resolve(monthOf(m, y)); };
  J.holidays = function () { return Promise.resolve([]); };
  J.leave = function () { return Promise.resolve([]); };
  J.fetchToday = function () {
    return Promise.resolve({ loggedOut: false, row: today, segments: window.FIXTURE_SEGMENTS, month: days });
  };
  cfg.hudEnabled = true;          // the harness wants the floating panel visible
  cfg.calibrated = true;
  J.setSettings(cfg).then(function () {
    // pump owns the data; portal-ui and hud subscribe. async=false preserves order.
    var bust = String(Date.now());
    ['../src/content/pump.js', '../src/content/portal-ui.js',
      '../src/content/extras.js', '../src/content/hud.js']
      .forEach(function (src) {
        var sc = document.createElement('script');
        sc.async = false;
        sc.src = src + '?t=' + bust;
        document.body.appendChild(sc);
      });
    document.getElementById('open').onclick = function () { window.JDG_INSIGHTS.open(); };
  });
})();
