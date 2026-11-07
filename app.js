/* =========================================================
   app.js — Utilitas bersama (siswa & admin)
   api() ke Apps Script · toast · modal · loading · ikon · unduhan
   ========================================================= */
(function () {
  'use strict';
  var U = window.U = {};

  U.$ = function (s, r) { return (r || document).querySelector(s); };
  U.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  /** Hanya URL gambar aman (https / data:image) yang dipakai sebagai src. */
  U.safeImg = function (u) {
    u = String(u || '');
    return /^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(u) ? u : '';
  };

  /* ---------- Penyimpanan lokal (aman jika diblokir browser) ---------- */
  U.store = {
    get: function (k) { try { var v = window.localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
  };

  /* ---------- API ke backend Google Apps Script (fetch lintas-origin) ----------
     Body dikirim sebagai text/plain agar browser tidak mengirim preflight CORS
     (Apps Script tidak melayani OPTIONS). Balasan: {ok, data} | {ok:false, code, msg}. */
  var CONF = window.APP_CONFIG || {};
  U.apiUrl = String(CONF.API_URL || '').trim();
  U.apiReady = /^https?:\/\/\S+$/.test(U.apiUrl) && !/GANTI|XXXX/i.test(U.apiUrl);
  /** URL folder frontend (mis. https://akun.github.io/repo/). */
  U.frontUrl = function () { return location.href.replace(/[?#].*$/, '').replace(/[^\/]*$/, ''); };

  var netListeners = [];
  /** Pemberitahuan status jaringan: fn(true) saat server terjangkau, fn(false, err) saat gagal karena jaringan. */
  U.onNet = function (fn) { netListeners.push(fn); };
  function emitNet(ok, err) { netListeners.forEach(function (fn) { try { fn(ok, err); } catch (e) { /* noop */ } }); }

  function request(fn, args, timeoutMs, track) {
    return new Promise(function (resolve, reject) {
      var settled = false, timer = null;
      function fail(code, msg) {
        if (settled) return; settled = true; clearTimeout(timer);
        var e = new Error(msg); e.code = code;
        if (code === 'NETWORK') emitNet(false, e);
        reject(e);
      }
      if (!U.apiReady) { fail('NO_API', 'Alamat server (API_URL) belum diatur di config.js. Hubungi admin.'); return; }
      var ctrl = window.AbortController ? new AbortController() : null;
      var job = { abort: function () { if (ctrl) ctrl.abort(); fail('NETWORK', 'Permintaan dibatalkan (koneksi terputus).'); } };
      if (track) track.push(job);
      function untrack() { if (track) { var i = track.indexOf(job); if (i >= 0) track.splice(i, 1); } }
      var oresolve = resolve, oreject = reject;
      resolve = function (v) { untrack(); oresolve(v); };
      reject = function (e) { untrack(); oreject(e); };
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); fail('NETWORK', 'Koneksi ke server terputus.'); }, timeoutMs || 30000);
      fetch(U.apiUrl, {
        method: 'POST', body: JSON.stringify({ fn: fn, args: args || [] }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (!r.ok) { var he = new Error('HTTP ' + r.status); he.http = r.status; throw he; }
        return r.text();
      }).then(function (txt) {
        var res;
        try { res = JSON.parse(txt); } catch (e) { fail('SERVER', 'Server memberi balasan yang tidak dikenali. Hubungi admin (periksa deployment Apps Script).'); return; }
        if (settled) return; settled = true; clearTimeout(timer);
        emitNet(true);
        if (res && res.ok) resolve(res.data);
        else { var e2 = new Error((res && res.msg) || 'Terjadi kesalahan.'); e2.code = (res && res.code) || 'APP'; reject(e2); }
      }, function (err) {
        if (err && err.http) fail(err.http === 429 || err.http >= 500 ? 'SERVER' : 'NETWORK', 'Server sedang sibuk. Coba lagi sebentar.');
        else fail('NETWORK', 'Koneksi ke server terputus.');
      });
    });
  }

  /** Panggilan API dengan batas 3 request paralel. */
  var MAX_PARALLEL = 3, active = 0, queue = [], running = [], held = false;
  /** Menahan antrean (dipakai saat ujian dijeda karena koneksi putus) dan membatalkan request yang menggantung. */
  U.hold = function (on) {
    held = !!on;
    if (held) running.slice().forEach(function (j) { j.abort(); });
    else pump();
  };
  U.api = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return U.apiT.apply(null, [30000, fn].concat(args));
  };
  /** Sama seperti U.api, dengan batas waktu (ms) di argumen pertama. */
  U.apiT = function (timeoutMs, fn) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
      queue.push({ fn: fn, args: args, t: timeoutMs, resolve: resolve, reject: reject });
      pump();
    });
  };
  /** Tanpa antrean (untuk cek koneksi & melanjutkan ujian, agar tidak tertahan request yang menggantung). */
  U.apiDirect = function (fn, args, timeoutMs) { return request(fn, args, timeoutMs); };
  function pump() {
    while (!held && active < MAX_PARALLEL && queue.length) {
      active++;
      (function (job) {
        request(job.fn, job.args, job.t, running).then(function (d) { active--; pump(); job.resolve(d); },
          function (e) { active--; pump(); job.reject(e); });
      })(queue.shift());
    }
  }

  /* ---------- Ikon (SVG garis) ---------- */
  var P = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
    book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 20a6 6 0 00-3-5.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    file: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    power: '<path d="M12 3v8"/><path d="M6.3 7.3a8 8 0 1011.4 0"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    wifiOff: '<path d="M2 8.8a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 20h.01"/><path d="M3 3l18 18"/>',
    school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><path d="M22 9v6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
  };
  U.icon = function (name, cls) {
    return '<svg class="icon ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || '') + '</svg>';
  };

  /* ---------- Toast ---------- */
  U.toast = function (msg, type, ms) {
    var root = document.getElementById('toasts');
    if (!root) { root = document.createElement('div'); root.id = 'toasts'; root.className = 'toasts'; root.setAttribute('aria-live', 'polite'); document.body.appendChild(root); }
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = U.icon(type === 'ok' ? 'checkCircle' : type === 'error' || type === 'warn' ? 'alert' : 'info') + '<div>' + U.esc(msg) + '</div>';
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms || (type === 'error' ? 5200 : 3000));
  };

  /* ---------- Loading overlay ---------- */
  var loadCount = 0, loadEl = null;
  U.loading = function (text) {
    loadCount++;
    if (!loadEl) {
      loadEl = document.createElement('div');
      loadEl.className = 'loading';
      loadEl.setAttribute('role', 'status');
      loadEl.innerHTML = '<div class="loading-box"><span class="spin"></span><span class="loading-text"></span></div>';
      document.body.appendChild(loadEl);
    }
    loadEl.querySelector('.loading-text').textContent = text || 'Memuat...';
    loadEl.hidden = false;
    var closed = false;
    return function hide() {
      if (closed) return; closed = true;
      loadCount = Math.max(0, loadCount - 1);
      if (!loadCount && loadEl) loadEl.hidden = true;
    };
  };
  U.loadingText = function (t) { if (loadEl) loadEl.querySelector('.loading-text').textContent = t; };

  /** Menonaktifkan tombol selama request berjalan. */
  U.busy = function (btn, text) {
    if (!btn) return function () {};
    var html = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spin"></span>' + (text ? '<span>' + U.esc(text) + '</span>' : '');
    return function () { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = html; };
  };

  /* ---------- Modal ---------- */
  /**
   * U.modal({title, body, actions:[{label, cls, value}], size, tone, dismissible, onAction(value, root)})
   * onAction boleh async; kembalikan false agar modal tetap terbuka.
   * Resolve dengan value tombol (atau null jika ditutup).
   */
  U.modal = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      var actions = o.actions || [{ label: 'Tutup', cls: 'btn-primary', value: true }];
      wrap.innerHTML =
        '<div class="modal ' + (o.size || '') + ' ' + (o.tone || '') + '" role="dialog" aria-modal="true" aria-labelledby="mdl-t">' +
        '<div class="modal-grip"></div>' +
        '<div class="modal-head"><h3 id="mdl-t">' + U.esc(o.title || '') + '</h3>' +
        (o.dismissible === false ? '' : '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Tutup">' + U.icon('x') + '</button>') + '</div>' +
        '<div class="modal-body">' + (o.body || '') + '</div>' +
        (actions.length ? '<div class="modal-foot">' + actions.map(function (a, i) {
          return '<button type="button" class="btn ' + (a.cls || 'btn-outline') + '" data-act="' + i + '">' + a.label + '</button>';
        }).join('') + '</div>' : '') +
        '</div>';
      document.body.appendChild(wrap);
      var prevFocus = document.activeElement;
      var closed = false;
      function close(v) {
        if (closed) return; closed = true;
        document.removeEventListener('keydown', onKey);
        wrap.classList.add('closing');
        var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, reduce ? 0 : 210);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ }
        resolve(v);
      }
      function onKey(e) { if (e.key === 'Escape' && o.dismissible !== false) close(null); }
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', function (e) {
        if (e.target === wrap && o.dismissible !== false) close(null);
        var c = e.target.closest('[data-close]');
        if (c) close(null);
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var a = actions[+b.getAttribute('data-act')];
        if (!o.onAction || a.value === null || a.value === false) { close(a.value); return; }
        var restore = U.busy(b, a.busyText || '');
        U.$$('[data-act]', wrap).forEach(function (x) { x.disabled = true; });
        Promise.resolve(o.onAction(a.value, wrap)).then(function (keep) {
          restore();
          U.$$('[data-act]', wrap).forEach(function (x) { x.disabled = false; });
          if (keep !== false) close(a.value);
        }, function (err) {
          restore();
          U.$$('[data-act]', wrap).forEach(function (x) { x.disabled = false; });
          U.toast(err && err.message ? err.message : 'Terjadi kesalahan.', 'error');
        });
      });
      if (o.onOpen) o.onOpen(wrap);
      var first = wrap.querySelector('[data-autofocus]') || wrap.querySelector('[data-act]:last-child');
      if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 50);
    });
  };

  U.confirm = function (title, body, okLabel, tone) {
    return U.modal({
      title: title, body: body, tone: tone,
      actions: [{ label: 'Batal', cls: 'btn-outline', value: false }, { label: okLabel || 'Ya, lanjutkan', cls: tone === 'danger' ? 'btn-danger' : 'btn-primary', value: true }]
    }).then(function (v) { return v === true; });
  };

  /* ---------- Unduhan ---------- */
  U.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  };
  U.downloadBase64 = function (b64, mime, filename) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    U.downloadBlob(new Blob([bytes], { type: mime }), filename);
  };

  /** Memuat script eksternal (HTTPS) sekali saja. */
  var loadedScripts = {};
  U.loadScript = function (src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = function () { delete loadedScripts[src]; rej(new Error('Gagal memuat pustaka. Periksa koneksi internet.')); };
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  };

  U.pad = function (n) { return (n < 10 ? '0' : '') + n; };
  U.fmtHMS = function (ms) {
    ms = Math.max(0, ms);
    var s = Math.floor(ms / 1000);
    return U.pad(Math.floor(s / 3600)) + ':' + U.pad(Math.floor(s % 3600 / 60)) + ':' + U.pad(s % 60);
  };
  U.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  };

  /** Logo default (topi wisuda). */
  U.logoHtml = function (url) {
    var safe = U.safeImg(url);
    return safe ? '<img src="' + U.esc(safe) + '" alt="Logo sekolah" referrerpolicy="no-referrer">' :
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand)">' + P.school + '</svg>';
  };
})();
