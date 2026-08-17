/* JDG Clockwork — the optional floating HUD.
 *
 * Off by default: the top-bar chip and the dashboard panel now carry the same
 * numbers inside the portal itself. Turn it on in the popup if you want the
 * readout to follow you over every page regardless of scroll position.
 */
(function (root) {
  'use strict';

  var J = root.JDG, S = root.JDG_STYLES, PUMP = root.JDG_PUMP;
  var cfg = null, host = null, shadow = null;

  function classFor(v) { return v ? 'bad' : ''; }

  function build() {
    host = document.createElement('div');
    host.id = 'jdg-clockwork-hud';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + S.HUD + '</style>' +
      '<div class="jdg-root" data-theme="' + J.resolveTheme(cfg) + '">' +
      '<div class="wrap">' +
      '<div class="head">' +
      '<span class="dot"></span>' +
      '<span class="title">Clockwork</span>' +
      '<button class="iconbtn mini" title="Collapse">–</button>' +
      '<button class="iconbtn hide" title="Hide until next page load">✕</button>' +
      '</div>' +
      '<div class="body"></div>' +
      '<div class="foot">' +
      '<button class="btn primary insights">Insights</button>' +
      '<button class="btn sync">Refresh</button>' +
      '</div>' +
      '</div></div>';
    document.body.appendChild(host);

    var wrap = shadow.querySelector('.wrap');
    shadow.querySelector('.mini').onclick = function () {
      wrap.classList.toggle('collapsed');
      var c = wrap.classList.contains('collapsed');
      this.textContent = c ? '+' : '–';
      J.setSettings({ hudCollapsed: c });
    };
    shadow.querySelector('.hide').onclick = function () { host.style.display = 'none'; };
    shadow.querySelector('.insights').onclick = function () { root.JDG_INSIGHTS.open(); };
    shadow.querySelector('.sync').onclick = function () {
      var b = shadow.querySelector('.sync');
      b.textContent = 'Syncing…';
      PUMP.refresh().then(function () { b.textContent = 'Refresh'; });
    };

    if (cfg.hudCollapsed) {
      wrap.classList.add('collapsed');
      shadow.querySelector('.mini').textContent = '+';
    }

    J.cacheGet('hudPos', null).then(function (p) {
      if (p && typeof p.right === 'number') {
        host.style.right = p.right + 'px';
        host.style.bottom = p.bottom + 'px';
      }
    });
    makeDraggable(shadow.querySelector('.head'));
  }

  function makeDraggable(handle) {
    var sx, sy, sr, sb, dragging = false;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('iconbtn')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      var r = host.getBoundingClientRect();
      sr = window.innerWidth - r.right;
      sb = window.innerHeight - r.bottom;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      host.style.right = Math.max(4, Math.min(window.innerWidth - 120, sr - (e.clientX - sx))) + 'px';
      host.style.bottom = Math.max(4, Math.min(window.innerHeight - 60, sb - (e.clientY - sy))) + 'px';
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      var r = host.getBoundingClientRect();
      J.cacheSet('hudPos', {
        right: Math.round(window.innerWidth - r.right),
        bottom: Math.round(window.innerHeight - r.bottom)
      });
    });
  }

  function cell(k, v, cls) {
    return '<div class="cell"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
  }

  function paint(l, data) {
    if (!shadow) return;
    var body = shadow.querySelector('.body');
    var dot = shadow.querySelector('.dot');

    if (data.loggedOut) {
      dot.className = 'dot';
      body.innerHTML = '<div class="caption">Session expired — sign in to the portal to resume tracking.</div>';
      return;
    }
    if (!data.ts) {
      dot.className = 'dot';
      body.innerHTML = '<div class="caption">Loading your day…</div>';
      return;
    }

    var now = J.nowMinutes();
    var required = cfg.requiredMinutes;
    var progress = Math.min(100, (l.worked / required) * 100);
    var cleared = l.worked >= required;

    if (l.isHoliday && l.clockIn == null) {
      dot.className = 'dot done';
      body.innerHTML =
        '<div class="hero ok"><span class="big">Rest day</span></div>' +
        '<div class="caption">Portal marks today as <b>' + (l.status || 'off') + '</b>. Nothing to clock.</div>';
      return;
    }

    if (l.state === 'not-clocked-in') {
      var delta = cfg.shiftStart - now;
      if (delta > 0) {
        dot.className = 'dot';
        body.innerHTML =
          '<div class="hero"><span class="big">' + J.fmtDur(delta) + '</span><span class="unit">until ' + J.fmtClock(cfg.shiftStart) + '</span></div>' +
          '<div class="caption">Not clocked in yet. Grace runs out at <b>' + J.fmtClock(cfg.shiftStart + cfg.graceMinutes) + '</b>.</div>' +
          '<div class="grid">' +
          cell('Shift starts', J.fmtClock(cfg.shiftStart)) +
          cell('Late mark at', J.fmtClock(cfg.shiftStart + cfg.graceMinutes)) +
          '</div>';
      } else {
        var over = -delta;
        dot.className = 'dot late';
        body.innerHTML =
          '<div class="hero ' + (over >= cfg.graceMinutes ? 'bad' : 'warn') + '">' +
          '<span class="big">' + J.fmtDur(over) + '</span><span class="unit">late, counting</span></div>' +
          '<div class="caption">' + (over >= cfg.graceMinutes
            ? 'Past the grace window — this will land as a red <b>Late</b>.'
            : 'Still inside grace. Clock in within <b>' + J.fmtDur(cfg.graceMinutes - over) + '</b> to avoid the Late mark.') +
          '</div>' +
          '<div class="grid">' +
          cell('Shift start', J.fmtClock(cfg.shiftStart)) +
          cell('If in now', J.fmtClock(now + required + 40) + ' out', 'warn') +
          '</div>';
      }
      return;
    }

    if (l.state === 'done') {
      var short = required - l.worked;
      dot.className = 'dot done';
      body.innerHTML =
        '<div class="hero ' + (short > 0 ? 'bad' : 'ok') + '">' +
        '<span class="big">' + J.fmtDurShort(l.worked) + '</span><span class="unit">logged today</span></div>' +
        '<div class="caption">' + (short > 0
          ? 'Clocked out <b>' + J.fmtDur(short) + '</b> short — this day carries an ⚡ Early Exit.'
          : 'Full day cleared. <b>+' + J.fmtDur(-short) + '</b> over the requirement.') + '</div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(l.clockIn), classFor(l.hardLate)) +
        cell('Out', J.fmtClock(l.clockOut)) +
        cell('Late by', l.lateBy ? l.lateBy + ' min' : 'on time', classFor(l.hardLate)) +
        cell('Breaks', J.fmtDur(l.breaks)) +
        '</div>';
      return;
    }

    if (l.state === 'break') {
      dot.className = 'dot break';
      body.innerHTML =
        '<div class="hero warn"><span class="big">' + J.fmtDur(l.breakSoFar) + '</span><span class="unit">on break</span></div>' +
        '<div class="caption">Resume now and you clear ' + J.fmtDurShort(required) + ' at <b>' +
        J.fmtClock(l.resumeTarget) + '</b>. Every minute here pushes that later.</div>' +
        '<div class="bar"><i class="' + (cleared ? 'ok' : 'warn') + '" style="width:' + progress + '%"></i></div>' +
        '<div class="barlabels"><span>' + J.fmtDurShort(l.worked) + ' worked</span><span>' + J.fmtDurShort(required) + '</span></div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(l.clockIn), classFor(l.hardLate)) +
        cell('Paused', J.fmtClock(l.onBreakSince)) +
        cell('Still owed', J.fmtDur(l.remaining), l.remaining ? 'warn' : 'ok') +
        cell('Breaks today', J.fmtDur(l.breaks)) +
        '</div>';
      return;
    }

    dot.className = 'dot working';
    if (cleared) {
      body.innerHTML =
        '<div class="hero ok"><span class="big">Free to go</span></div>' +
        '<div class="caption">' + J.fmtDurShort(required) + ' cleared. You are <b>+' + J.fmtDur(l.worked - required) +
        '</b> over — no Early Exit if you leave now.</div>' +
        '<div class="bar"><i class="ok" style="width:100%"></i></div>' +
        '<div class="barlabels"><span>' + J.fmtDurShort(l.worked) + ' worked</span><span>' + J.fmtDurShort(required) + ' required</span></div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(l.clockIn), classFor(l.hardLate)) +
        cell('Late by', l.lateBy ? l.lateBy + ' min' : 'on time', classFor(l.hardLate)) +
        cell('Breaks', J.fmtDur(l.breaks)) +
        cell('Overtime', '+' + J.fmtDur(l.worked - required), 'ok') +
        '</div>';
    } else {
      body.innerHTML =
        '<div class="hero"><span class="big">' + J.fmtClock(l.targetOut) + '</span><span class="unit">clock-out target</span></div>' +
        '<div class="caption">Leave at or after this to clear ' + J.fmtDurShort(required) + '. <b>' +
        J.fmtDur(l.remaining) + '</b> to go.</div>' +
        '<div class="bar"><i class="warn" style="width:' + progress + '%"></i></div>' +
        '<div class="barlabels"><span>' + J.fmtDurShort(l.worked) + ' worked</span><span>' + J.fmtDurShort(required) + ' required</span></div>' +
        '<div class="grid">' +
        cell('In', J.fmtClock(l.clockIn), classFor(l.hardLate)) +
        cell('Late by', l.lateBy ? l.lateBy + ' min' : 'on time', classFor(l.hardLate)) +
        cell('Breaks', J.fmtDur(l.breaks)) +
        cell('If out now', '−' + J.fmtDur(l.remaining), 'bad') +
        '</div>';
    }
  }

  PUMP.ready.then(function (c) {
    cfg = c;
    if (!cfg.hudEnabled) return;
    build();
    PUMP.subscribe(paint);
  });
})(typeof self !== 'undefined' ? self : this);
