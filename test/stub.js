/* Minimal chrome.* stand-in so the real extension sources run on a plain page. */
(function () {
  var store = {};
  window.chrome = {
    storage: {
      local: {
        get: function (q, cb) {
          var out = {};
          if (typeof q === 'string') out[q] = store[q];
          else for (var k in q) out[k] = (k in store) ? store[k] : q[k];
          setTimeout(function () { cb(out); }, 0);
        },
        set: function (o, cb) {
          for (var k in o) store[k] = o[k];
          setTimeout(function () { cb && cb(); }, 0);
        }
      }
    },
    runtime: {
      lastError: null,
      onMessage: { addListener: function () {} },
      sendMessage: function (m, cb) { window.__sent = (window.__sent || []).concat([m]); cb && cb({ ok: true }); },
      getURL: function (p) { return p; }
    },
    tabs: { query: function (q, cb) { cb([]); }, create: function () {}, update: function () {}, sendMessage: function () {} },
    windows: { update: function () {} },
    action: { setBadgeText: function () {}, setBadgeBackgroundColor: function () {}, setTitle: function () {} },
    alarms: { create: function () {}, onAlarm: { addListener: function () {} } },
    notifications: { create: function () {} }
  };
})();
