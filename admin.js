/* =========================================================
   admin.js — Dashboard admin (SPA) · frontend GitHub Pages → API Apps Script
   Token sesi disimpan di sessionStorage; password tidak pernah disimpan di browser.
   ========================================================= */
(function () {
  'use strict';
  var $ = U.$, $$ = U.$$, esc = U.esc, toast = U.toast, icon = U.icon;
  var CFG = {};
  try { CFG = JSON.parse(localStorage.getItem('uo_cfg') || '{}') || {}; } catch (e) { CFG = {}; }
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var A = { token: null, refs: null, refsAt: 0, section: 'ringkasan', st: {}, timers: [] };

  var SECTIONS = [
    ['ringkasan', 'Ringkasan', 'home'], ['ujian', 'Ujian', 'clipboard'], ['bank', 'Bank Soal', 'book'],
    ['import', 'Import Soal', 'upload'], ['mapel', 'Mata Pelajaran', 'layers'], ['kelas', 'Kelas', 'users'],
    ['peserta', 'Peserta', 'user'], ['rekap', 'Rekap Nilai', 'chart'], ['pelanggaran', 'Pelanggaran', 'alert'],
    ['export', 'Export', 'download'], ['pengaturan', 'Pengaturan', 'settings']
  ];

  /* ---------------- Sesi & API ---------------- */
  var ss = {
    get: function () { try { return sessionStorage.getItem('uo_admin'); } catch (e) { return null; } },
    set: function (v) { try { sessionStorage.setItem('uo_admin', v); } catch (e) { /* noop */ } },
    del: function () { try { sessionStorage.removeItem('uo_admin'); } catch (e) { /* noop */ } }
  };

  function call(fn) {
    var args = [fn, A.token].concat(Array.prototype.slice.call(arguments, 1));
    return U.api.apply(null, args).catch(function (e) {
      if (e.code === 'AUTH') { toLogin('Sesi admin berakhir. Silakan login kembali.'); }
      throw e;
    });
  }
  function showErr(e) {
    if (e && e.code === 'AUTH') return;
    toast(e && e.code === 'NETWORK' ? 'Koneksi ke server gagal. Periksa internet lalu coba lagi.' : (e && e.message) || 'Terjadi kesalahan.', 'error');
  }

  function loadRefs(force) {
    if (!force && A.refs && Date.now() - A.refsAt < 60000) return Promise.resolve(A.refs);
    return call('getAdminRefs').then(function (r) { A.refs = r; A.refsAt = Date.now(); return r; });
  }
  function dirty() { A.refsAt = 0; }

  /* ---------------- Helpers UI ---------------- */
  function opts(list, val, label, sel, placeholder) {
    return (placeholder !== undefined ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      list.map(function (x) {
        var v = typeof val === 'function' ? val(x) : x[val];
        var l = typeof label === 'function' ? label(x) : x[label];
        return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('');
  }
  function mapelName(id) { var m = (A.refs.mapel || []).filter(function (x) { return x.id === id; })[0]; return m ? m.nama : id; }
  function kelasNames(ids) {
    if (!ids || !ids.length || ids.indexOf('ALL') >= 0) return 'Semua kelas';
    return ids.map(function (id) { var k = A.refs.kelas.filter(function (x) { return x.id === id; })[0]; return k ? k.nama : id; }).join(', ');
  }
  function head(title, sub, actions) {
    return '<div class="a-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
  }
  function emptyState(text, ic) { return '<div class="empty">' + icon(ic || 'info') + '<div>' + esc(text) + '</div></div>'; }
  function skeleton() {
    return '<div class="skeleton" style="height:34px;width:220px;margin-bottom:18px"></div><div class="stats">' +
      '<div class="skeleton" style="height:110px"></div><div class="skeleton" style="height:110px"></div><div class="skeleton" style="height:110px"></div><div class="skeleton" style="height:110px"></div></div>' +
      '<div class="skeleton" style="height:260px;margin-top:14px"></div>';
  }
  function pager(p, pages, total, cb) {
    if (pages <= 1) return '<div class="pager small muted">' + total + ' data</div>';
    return '<div class="pager"><button class="btn btn-outline btn-sm" data-page="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + '>' + icon('left') + '</button>' +
      '<span class="small"><b>' + p + '</b> / ' + pages + ' · ' + total + ' data</span>' +
      '<button class="btn btn-outline btn-sm" data-page="' + (p + 1) + '"' + (p >= pages ? ' disabled' : '') + '>' + icon('right') + '</button></div>';
  }
  function bindPager(root, cb) {
    $$('[data-page]', root).forEach(function (b) { b.addEventListener('click', function () { cb(+b.getAttribute('data-page')); }); });
  }
  function fval(root, sel) { var el = $(sel, root); return el ? el.value.trim() : ''; }
  function sw(id, label, checked, sub) {
    return '<label class="switch"><span><span class="s-text">' + esc(label) + '</span>' + (sub ? '<span class="s-sub">' + esc(sub) + '</span>' : '') +
      '</span><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="track"></span></label>';
  }
  function statusChip(st) {
    var map = { AKTIF: 'chip-ok', NONAKTIF: '', DRAFT: 'chip-warn', SUBMITTED: 'chip-ok', AUTO_SUBMITTED: 'chip-brand', BLOCKED: 'chip-danger', IN_PROGRESS: 'chip-warn', STARTED: 'chip-warn', LULUS: 'chip-ok', 'BELUM LULUS': 'chip-danger', INFO: 'chip-brand', TINGGI: 'chip-danger', SEDANG: 'chip-warn' };
    return '<span class="chip ' + (map[st] || '') + '">' + esc(st) + '</span>';
  }
  function num(v) { return v === null || v === undefined || v === '' ? '-' : String(v).replace('.', ','); }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () { toast('Disalin.', 'ok'); }, function () { fallbackCopy(t); });
    }
    fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Disalin.', 'ok'); } catch (e) { toast('Salin manual: ' + t, 'warn', 8000); }
    ta.remove();
  }
  function clearTimers() { A.timers.forEach(clearInterval); A.timers = []; }

  /* ---------------- Login ---------------- */
  function brand() {
    var c = CFG;
    $('#l-logo').innerHTML = U.logoHtml(c.logoUrl);
    $('#l-school').textContent = c.schoolName || '';
    $('#l-app').textContent = c.appName || 'Sistem Ujian Online';
    $('#a-logo').innerHTML = U.logoHtml(c.logoUrl);
    $('#a-app').textContent = c.appName || 'SISTEM UJIAN ONLINE';
    $('#a-school').textContent = c.schoolName || '';
    var sl = $('#l-student');
    sl.href = './';
    document.title = 'Admin · ' + (c.appName || 'Ujian Online');
  }

  function toLogin(msg) {
    clearTimers();
    A.token = null; ss.del();
    $('#shell').hidden = true;
    $('#login-view').hidden = false;
    $('#l-pw').value = '';
    if (msg) { var e = $('#l-err'); e.textContent = msg; e.hidden = false; }
    setTimeout(function () { try { $('#l-pw').focus(); } catch (e) { /* noop */ } }, 50);
  }

  function initLogin() {
    $('#login-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = $('#l-pw').value, err = $('#l-err');
      err.hidden = true;
      if (!pw) { err.textContent = 'Password wajib diisi.'; err.hidden = false; return; }
      var restore = U.busy($('#l-btn'), 'Memeriksa...');
      U.api('adminLogin', pw).then(function (r) {
        restore();
        A.token = r.token; ss.set(r.token);
        if (r.config) Object.assign(CFG, r.config);
        enterShell(r.defaultPassword);
      }, function (e) {
        restore();
        err.textContent = e.code === 'NETWORK' ? 'Koneksi gagal. Coba lagi.' : e.message;
        err.hidden = false;
      });
    });
  }

  /* ---------------- Shell ---------------- */
  function enterShell(defaultPw) {
    brand();
    $('#login-view').hidden = true;
    $('#shell').hidden = false;
    $('#a-nav').innerHTML = SECTIONS.map(function (s, i) {
      return (i === 4 || i === 6 || i === 10 ? '<div class="sep"></div>' : '') +
        '<button type="button" data-sec="' + s[0] + '">' + icon(s[2]) + '<span>' + esc(s[1]) + '</span></button>';
    }).join('');
    navigate(A.section);
    if (defaultPw) {
      setTimeout(function () { toast('Anda masih memakai password default. Segera ganti di menu Pengaturan.', 'warn', 7000); }, 600);
    }
  }

  function initShell() {
    $('#a-nav').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sec]');
      if (b) navigate(b.getAttribute('data-sec'));
    });
    $('#btn-menu').addEventListener('click', function () { $('#shell').classList.add('nav-open'); });
    $('#a-overlay').addEventListener('click', function () { $('#shell').classList.remove('nav-open'); });
    $('#btn-logout').addEventListener('click', function () {
      U.confirm('Logout', '<p>Keluar dari dashboard admin?</p>', 'Logout').then(function (ok) {
        if (!ok) return;
        U.api('adminLogout', A.token).catch(function () {});
        toLogin('Anda telah logout.');
      });
    });
  }

  function navigate(sec, state) {
    clearTimers();
    A.section = sec;
    if (state) A.st[sec] = Object.assign(A.st[sec] || {}, state);
    $('#shell').classList.remove('nav-open');
    $$('#a-nav [data-sec]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-sec') === sec); });
    var label = (SECTIONS.filter(function (s) { return s[0] === sec; })[0] || [])[1] || '';
    $('#a-top-title').textContent = label;
    // Ganti elemen konten agar event listener bagian sebelumnya ikut terbuang
    var old = $('#content');
    var c = old.cloneNode(false);
    old.parentNode.replaceChild(c, old);
    c.innerHTML = skeleton();
    window.scrollTo(0, 0);
    var fn = RENDER[sec] || RENDER.ringkasan;
    loadRefs().then(function () { return fn(c); }).catch(function (e) {
      showErr(e);
      if (e.code !== 'AUTH') c.innerHTML = head(label) + '<div class="card">' + emptyState('Gagal memuat data. ' + (e.message || ''), 'alert') +
        '<div style="text-align:center;padding-bottom:20px"><button class="btn btn-primary" id="retry">Coba lagi</button></div></div>';
      var r = $('#retry'); if (r) r.addEventListener('click', function () { navigate(sec); });
    });
  }

  /* ---------------- Chart ringan (SVG) ---------------- */
  function barChart(data, alt) {
    var w = 520, h = 210, pl = 30, pb = 26, pt = 18, max = Math.max.apply(null, data.map(function (d) { return d.n; }).concat([1]));
    var bw = (w - pl - 10) / data.length;
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">';
    for (var g = 0; g <= 4; g++) {
      var y = pt + (h - pt - pb) * g / 4;
      s += '<line class="grid" x1="' + pl + '" x2="' + w + '" y1="' + y + '" y2="' + y + '"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(max * (4 - g) / 4) + '</text>';
    }
    data.forEach(function (d, i) {
      var bh = (h - pt - pb) * d.n / max, x = pl + i * bw + bw * 0.18, y2 = h - pb - bh;
      s += '<rect class="bar' + (alt ? ' alt' : '') + '" x="' + x + '" y="' + y2 + '" width="' + (bw * 0.64) + '" height="' + Math.max(bh, 0) + '" rx="5"/>' +
        (d.n ? '<text class="val" x="' + (x + bw * 0.32) + '" y="' + (y2 - 5) + '" text-anchor="middle">' + d.n + '</text>' : '') +
        '<text x="' + (x + bw * 0.32) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(d.label) + '</text>';
    });
    return s + '</svg>';
  }

  /* =========================================================
     RENDER PER BAGIAN
     ========================================================= */
  var RENDER = {};

  /* ---------- Ringkasan ---------- */
  RENDER.ringkasan = function (c) {
    return call('getDashboard').then(function (d) {
      var url = U.frontUrl();
      c.innerHTML = head('Ringkasan', 'Statistik ujian secara keseluruhan.', '<button class="btn btn-outline btn-sm" id="rk-refresh">' + icon('refresh') + 'Muat ulang</button>') +
        (d.defaultPassword ? '<div class="notice notice-warn" style="margin-bottom:14px">' + icon('lock') + '<div>Password admin masih default (<b>admin123</b>). <a href="#" id="go-set">Ganti sekarang</a>.</div></div>' : '') +
        '<div class="stats">' +
        statCard('users', d.totalPeserta, 'Total Peserta') + statCard('clipboard', d.totalUjian, 'Total Ujian') +
        statCard('layers', d.totalMapel, 'Total Mata Pelajaran') + statCard('book', d.totalSoal, 'Total Bank Soal') +
        '</div><div class="stats mt-2">' +
        statCard('user', d.pesertaHariIni, 'Peserta Hari Ini') + statCard('clock', d.ujianAktif, 'Ujian Aktif') +
        statCard('checkCircle', d.ujianSelesai, 'Ujian Selesai (sesi)') + statCard('chart', num(d.rataRata), 'Rata-rata Nilai') +
        '</div>' +
        '<div class="panels">' +
        '<section class="card"><div class="panel-title">' + icon('chart') + 'Distribusi Nilai <span class="chip" style="margin-left:auto">KKM ' + d.kkm + ' · Lulus ' + d.lulus + '</span></div><div class="chart">' + barChart(d.distribusi) + '</div></section>' +
        '<section class="card"><div class="panel-title">' + icon('users') + 'Peserta 7 Hari Terakhir</div><div class="chart">' + barChart(d.harian, true) + '</div></section>' +
        '<section class="card"><div class="panel-title">' + icon('clock') + 'Ujian Aktif <span class="chip chip-warn" style="margin-left:auto">' + d.sedangMengerjakan + ' sedang mengerjakan</span></div>' +
        (d.activeExams.length ? '<div class="tbl-wrap"><table class="tbl resp"><thead><tr><th>Ujian</th><th>Mode</th><th class="num">Mengerjakan</th><th class="num">Selesai</th></tr></thead><tbody>' +
          d.activeExams.map(function (e) {
            return '<tr><td class="main" data-label="Ujian">' + esc(e.nama) + '</td><td data-label="Mode">' + esc(e.mode) + '</td><td class="num" data-label="Mengerjakan">' + e.berjalan + '</td><td class="num" data-label="Selesai">' + e.selesai + '</td></tr>';
          }).join('') + '</tbody></table></div>' : emptyState('Tidak ada ujian aktif.')) + '</section>' +
        '<section class="card"><div class="panel-title">' + icon('file') + 'Aktivitas Terbaru</div><div class="log-list mt-1">' +
        (d.logs.length ? d.logs.map(function (l) { return '<div><time>' + esc(l.t) + '</time><span><b>' + esc(l.aksi) + '</b> · ' + esc(l.aktor) + '<br><span class="muted">' + esc(l.detail) + '</span></span></div>'; }).join('') : emptyState('Belum ada aktivitas.')) +
        '</div></section></div>' +
        (url ? '<section class="card card-pad mt-2"><div class="label">Tautan untuk siswa (salin ke Google Sites / grup kelas)</div><code class="url mt-1">' + esc(url) + '</code>' +
          '<div class="row wrap mt-1"><button class="btn btn-soft btn-sm" id="copy-url">' + icon('copy') + 'Salin tautan siswa</button></div></section>' : '');
      $('#rk-refresh').addEventListener('click', function () { navigate('ringkasan'); });
      var gs = $('#go-set'); if (gs) gs.addEventListener('click', function (e) { e.preventDefault(); navigate('pengaturan'); });
      var cu = $('#copy-url'); if (cu) cu.addEventListener('click', function () { copyText(url); });
    });
  };
  function statCard(ic, val, label) {
    return '<div class="card stat"><div class="s-ico">' + icon(ic) + '</div><b>' + esc(val) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ---------- Ujian ---------- */
  RENDER.ujian = function (c) {
    return call('getExams').then(function (list) {
      c.innerHTML = head('Manajemen Ujian', 'Buat dan atur ujian: jumlah soal, durasi, pengacakan, mode, dan tampilan hasil.',
        '<button class="btn btn-primary" id="ex-add">' + icon('plus') + 'Buat Ujian</button>') +
        (list.length ? '<div class="exam-cards">' + list.map(examCard).join('') + '</div>' : '<div class="card">' + emptyState('Belum ada ujian. Klik "Buat Ujian".', 'clipboard') + '</div>');
      $('#ex-add').addEventListener('click', function () { examForm(null); });
      c.addEventListener('click', examActions);
    });
  };
  function examCard(e) {
    var warnBank = e.bank < e.jumlah;
    return '<article class="card exam-card" data-id="' + esc(e.id) + '">' +
      '<div class="row" style="align-items:flex-start"><div style="flex:1;min-width:0"><div class="tiny muted">' + esc(e.id) + ' · ' + esc(mapelName(e.mapelId)) + '</div><h4>' + esc(e.nama) + '</h4></div>' +
      statusChip(e.status) + '</div>' +
      '<div class="row wrap"><span class="chip ' + (e.mode === 'LATIHAN' ? 'chip-brand' : '') + '">' + esc(e.mode) + '</span>' +
      (e.open ? '<span class="chip chip-ok">Sedang dibuka</span>' : '<span class="chip">Tertutup</span>') +
      '<span class="chip">' + esc(kelasNames(e.kelasIds)) + '</span></div>' +
      '<div class="meta-grid"><div><b>' + e.jumlah + '</b>Soal/peserta</div><div><b style="' + (warnBank ? 'color:var(--danger)' : '') + '">' + e.bank + '</b>Bank soal</div>' +
      '<div><b>' + e.durasi + ' mnt</b>Durasi</div><div><b>' + e.peserta.selesai + '/' + e.peserta.total + '</b>Selesai/peserta</div>' +
      '<div><b>' + (e.acakSoal ? 'Ya' : 'Tidak') + '</b>Acak soal</div><div><b>' + (e.acakPilihan ? 'Ya' : 'Tidak') + '</b>Acak pilihan</div>' +
      '<div><b>' + ({ TIDAK: 'Disembunyikan', NILAI: 'Hasil saja', LENGKAP: 'Lengkap' }[e.tampilan] || e.tampilan) + '</b>Hasil siswa</div>' +
      '<div><b>' + e.maxPelanggaran + (e.autoStop ? ' · stop' : '') + '</b>Batas pelanggaran</div></div>' +
      (warnBank ? '<div class="notice notice-warn small">' + icon('alert') + '<div>Bank soal (' + e.bank + ') lebih sedikit dari jumlah soal. Siswa hanya mendapat ' + e.bank + ' soal.</div></div>' : '') +
      (e.mulaiStr || e.selesaiStr ? '<div class="small muted">Jadwal: ' + esc(e.mulaiStr.replace('T', ' ') || '—') + ' s/d ' + esc(e.selesaiStr.replace('T', ' ') || '—') + '</div>' : '') +
      '<div class="row wrap"><button class="btn btn-outline btn-sm" data-ex="edit">' + icon('edit') + 'Edit</button>' +
      '<button class="btn btn-outline btn-sm" data-ex="toggle">' + icon('power') + (e.status === 'AKTIF' ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
      '<button class="btn btn-outline btn-sm" data-ex="peserta">' + icon('users') + 'Peserta</button>' +
      '<button class="btn btn-outline btn-sm" data-ex="rekap">' + icon('chart') + 'Rekap</button>' +
      '<button class="btn btn-ghost btn-sm" data-ex="del" style="color:var(--danger)">' + icon('trash') + 'Hapus</button></div></article>';
  }
  function examActions(ev) {
    var b = ev.target.closest('[data-ex]');
    if (!b) return;
    var id = b.closest('[data-id]').getAttribute('data-id');
    var ex = A.refs.ujian.filter(function (x) { return x.id === id; })[0];
    var act = b.getAttribute('data-ex');
    if (act === 'edit') { loadRefs(true).then(function () { examForm(A.refs.ujian.filter(function (x) { return x.id === id; })[0]); }); }
    else if (act === 'peserta') navigate('peserta', { ujianId: id, page: 1 });
    else if (act === 'rekap') navigate('rekap', { tab: 'siswa', f: { ujianId: id }, page: 1 });
    else if (act === 'toggle') {
      var restore = U.busy(b);
      call('setExamStatus', id, ex && ex.status === 'AKTIF' ? 'NONAKTIF' : 'AKTIF').then(function (r) {
        toast('Ujian ' + (r.status === 'AKTIF' ? 'diaktifkan' : 'dinonaktifkan') + '.', 'ok'); dirty(); navigate('ujian');
      }, function (e) { restore(); showErr(e); });
    } else if (act === 'del') {
      U.confirm('Hapus ujian?', '<p>Ujian <b>' + esc(ex ? ex.nama : id) + '</b> akan dihapus permanen.</p>', 'Hapus', 'danger').then(function (ok) {
        if (!ok) return;
        var hide = U.loading('Menghapus...');
        call('deleteExam', id).then(function () { hide(); toast('Ujian dihapus.', 'ok'); dirty(); navigate('ujian'); }, function (e) { hide(); showErr(e); });
      });
    }
  }

  function examForm(ex) {
    var cfg = A.refs.config || {};
    var e = ex || {
      nama: '', mapelId: '', kelasIds: ['ALL'], jumlah: +cfg.DEFAULT_QUESTION_COUNT || 20, durasi: +cfg.DEFAULT_DURATION || 60,
      acakSoal: /true/i.test(cfg.DEFAULT_ACAK_SOAL), acakPilihan: /true/i.test(cfg.DEFAULT_ACAK_PILIHAN), status: 'AKTIF',
      mode: cfg.DEFAULT_MODE || 'UJIAN', tampilan: cfg.DEFAULT_TAMPILAN_HASIL || 'NILAI', izinkanUlang: false,
      maxPelanggaran: +cfg.MAX_VIOLATIONS || 3, autoStop: /true/i.test(cfg.AUTO_STOP_ON_MAX), mulaiStr: '', selesaiStr: '', kategoriStr: ''
    };
    var all = e.kelasIds.indexOf('ALL') >= 0;
    var durOpts = [30, 45, 60, 90, 120];
    var body = '<form class="stack" id="exf" novalidate>' +
      '<div class="field"><label>Nama Ujian</label><input class="input" id="exf-nama" value="' + esc(e.nama) + '" maxlength="150" placeholder="Ujian Sumatif Administrasi Sistem Jaringan" data-autofocus></div>' +
      '<div class="grid-2"><div class="field"><label>Mata Pelajaran</label><select class="select" id="exf-mapel">' + opts(A.refs.mapel, 'id', 'nama', e.mapelId, '— Pilih —') + '</select></div>' +
      '<div class="field"><label>Kategori soal (opsional)</label><input class="input" id="exf-kat" list="exf-katlist" value="' + esc(e.kategoriStr) + '" placeholder="Kosong = semua kategori">' +
      '<datalist id="exf-katlist">' + A.refs.kategori.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist><span class="help">Pisahkan dengan koma, mis. DNS, DHCP</span></div></div>' +
      '<div class="field"><label>Kelas</label><div class="check-grid" id="exf-kelas">' +
      '<label class="check"><input type="checkbox" value="ALL"' + (all ? ' checked' : '') + '>Semua kelas</label>' +
      A.refs.kelas.filter(function (k) { return k.status === 'AKTIF' || e.kelasIds.indexOf(k.id) >= 0; }).map(function (k) {
        return '<label class="check"><input type="checkbox" value="' + esc(k.id) + '"' + (!all && e.kelasIds.indexOf(k.id) >= 0 ? ' checked' : '') + '>' + esc(k.nama) + '</label>';
      }).join('') + '</div></div>' +
      '<div class="notice small" id="exf-bank">' + icon('book') + '<div>Pilih mata pelajaran untuk melihat jumlah soal tersedia.</div></div>' +
      '<div class="grid-2"><div class="field"><label>Jumlah Soal per Peserta</label><input class="input" type="number" inputmode="numeric" min="1" max="500" id="exf-jumlah" value="' + esc(e.jumlah) + '"></div>' +
      '<div class="field"><label>Durasi (menit)</label><input class="input" type="number" inputmode="numeric" min="1" max="600" id="exf-durasi" value="' + esc(e.durasi) + '" list="exf-durlist">' +
      '<datalist id="exf-durlist">' + durOpts.map(function (d) { return '<option value="' + d + '">'; }).join('') + '</datalist>' +
      '<div class="row wrap mt-1">' + durOpts.map(function (d) { return '<button type="button" class="btn btn-outline btn-sm" data-dur="' + d + '">' + d + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="grid-2">' + sw('exf-acaks', 'Acak Soal', e.acakSoal, 'Setiap siswa mendapat soal & urutan berbeda') + sw('exf-acakp', 'Acak Pilihan', e.acakPilihan, 'Urutan A–E diacak (kecuali Benar/Salah)') + '</div>' +
      '<div class="grid-2"><div class="field"><label>Mode</label><select class="select" id="exf-mode">' +
      opts([{ v: 'UJIAN', l: 'MODE UJIAN — anti-cheating aktif' }, { v: 'LATIHAN', l: 'MODE LATIHAN — tanpa anti-cheating' }], 'v', 'l', e.mode) + '</select></div>' +
      '<div class="field"><label>Tampilkan Nilai ke Siswa</label><select class="select" id="exf-tampil">' +
      opts([{ v: 'TIDAK', l: 'Tidak ditampilkan' }, { v: 'NILAI', l: 'HASIL SAJA (nilai, tanpa pembahasan)' }, { v: 'LENGKAP', l: 'Nilai + pembahasan (khusus mode latihan)' }], 'v', 'l', e.tampilan) + '</select></div></div>' +
      '<div class="grid-2"><div class="field"><label>Batas Pelanggaran</label><input class="input" type="number" min="1" max="50" id="exf-maxv" value="' + esc(e.maxPelanggaran) + '"></div>' +
      sw('exf-autostop', 'Hentikan otomatis', e.autoStop, 'Ujian dihentikan saat pelanggaran mencapai batas') + '</div>' +
      sw('exf-ulang', 'Izinkan mengulang', e.izinkanUlang, 'Siswa boleh mengerjakan ujian yang sama lebih dari sekali') +
      '<div class="grid-2"><div class="field"><label>Mulai (opsional)</label><input class="input" type="datetime-local" id="exf-mulai" value="' + esc(e.mulaiStr) + '"></div>' +
      '<div class="field"><label>Selesai (opsional)</label><input class="input" type="datetime-local" id="exf-selesai" value="' + esc(e.selesaiStr) + '"><span class="help">Waktu peserta tidak melewati jadwal selesai.</span></div></div>' +
      '<div class="field"><label>Status</label><select class="select" id="exf-status">' + opts([{ v: 'AKTIF', l: 'AKTIF — dapat dikerjakan' }, { v: 'NONAKTIF', l: 'NONAKTIF' }, { v: 'DRAFT', l: 'DRAFT' }], 'v', 'l', e.status) + '</select></div>' +
      '</form>';
    U.modal({
      title: ex ? 'Edit Ujian' : 'Buat Ujian', size: 'lg', body: body,
      actions: [{ label: 'Batal', cls: 'btn-outline', value: false }, { label: ex ? 'Simpan Perubahan' : 'Buat Ujian', cls: 'btn-primary', value: true, busyText: 'Menyimpan...' }],
      onOpen: function (w) {
        var upd = U.debounce(function () { bankCount(w); }, 300);
        $('#exf-mapel', w).addEventListener('change', upd);
        $('#exf-kat', w).addEventListener('input', upd);
        $('#exf-jumlah', w).addEventListener('input', upd);
        $('#exf-kelas', w).addEventListener('change', function (ev) {
          var t = ev.target;
          if (t.value === 'ALL' && t.checked) $$('#exf-kelas input', w).forEach(function (i) { if (i.value !== 'ALL') i.checked = false; });
          else if (t.checked) $('#exf-kelas input[value="ALL"]', w).checked = false;
          upd();
        });
        $$('[data-dur]', w).forEach(function (b) { b.addEventListener('click', function () { $('#exf-durasi', w).value = b.getAttribute('data-dur'); }); });
        $('#exf-mode', w).addEventListener('change', function () {
          if (this.value === 'UJIAN' && $('#exf-tampil', w).value === 'LENGKAP') $('#exf-tampil', w).value = 'NILAI';
        });
        if (e.mapelId) bankCount(w);
      },
      onAction: function (v, w) {
        var kel = $$('#exf-kelas input:checked', w).map(function (i) { return i.value; });
        var d = {
          nama: fval(w, '#exf-nama'), mapelId: fval(w, '#exf-mapel'), kelasIds: kel.indexOf('ALL') >= 0 ? ['ALL'] : kel,
          kategori: fval(w, '#exf-kat'), jumlah: +fval(w, '#exf-jumlah'), durasi: +fval(w, '#exf-durasi'),
          acakSoal: $('#exf-acaks', w).checked, acakPilihan: $('#exf-acakp', w).checked, mode: fval(w, '#exf-mode'),
          tampilan: fval(w, '#exf-tampil'), maxPelanggaran: +fval(w, '#exf-maxv'), autoStop: $('#exf-autostop', w).checked,
          izinkanUlang: $('#exf-ulang', w).checked, mulai: fval(w, '#exf-mulai'), selesai: fval(w, '#exf-selesai'), status: fval(w, '#exf-status')
        };
        if (d.nama.length < 3) throw new Error('Nama ujian minimal 3 karakter.');
        if (!d.mapelId) throw new Error('Pilih mata pelajaran.');
        if (!d.kelasIds.length) throw new Error('Pilih minimal satu kelas.');
        if (!(d.jumlah >= 1)) throw new Error('Jumlah soal minimal 1.');
        if (!(d.durasi >= 1)) throw new Error('Durasi minimal 1 menit.');
        return (ex ? call('updateExam', ex.id, d) : call('createExam', d)).then(function () {
          toast(ex ? 'Ujian diperbarui.' : 'Ujian dibuat.', 'ok'); dirty(); navigate('ujian');
        });
      }
    });
  }
  function bankCount(w) {
    var m = fval(w, '#exf-mapel'), box = $('#exf-bank', w);
    if (!m) return;
    var kel = $$('#exf-kelas input:checked', w).map(function (i) { return i.value; });
    box.innerHTML = icon('book') + '<div>Menghitung soal tersedia...</div>';
    call('getBankCount', m, kel.length ? kel : ['ALL'], fval(w, '#exf-kat')).then(function (n) {
      var j = +fval(w, '#exf-jumlah') || 0;
      box.className = 'notice small ' + (n < j ? 'notice-warn' : 'notice-ok');
      box.innerHTML = icon(n < j ? 'alert' : 'checkCircle') + '<div>Bank soal tersedia: <b>' + n + '</b> soal aktif.' +
        (n < j ? ' Jumlah soal per peserta (' + j + ') melebihi bank soal.' : n ? ' Sistem memilih ' + j + ' soal acak dari ' + n + ' soal.' : '') + '</div>';
    }, function () { box.innerHTML = icon('alert') + '<div>Gagal menghitung bank soal.</div>'; });
  }

  /* ---------- Bank Soal ---------- */
  RENDER.bank = function (c) {
    var st = A.st.bank = Object.assign({ page: 1, q: '', mapelId: '', kelasId: '', kategori: '', status: '', type: '' }, A.st.bank || {});
    c.innerHTML = head('Bank Soal', 'Cari, filter, edit, pratinjau, dan aktifkan/nonaktifkan soal.',
      '<button class="btn btn-outline" id="bk-imp">' + icon('upload') + 'Import</button><button class="btn btn-primary" id="bk-add">' + icon('plus') + 'Tambah Soal</button>') +
      '<div class="card toolbar">' +
      '<div class="field"><label>Cari</label><input class="input" id="bk-q" type="search" placeholder="Kata kunci / ID soal" value="' + esc(st.q) + '"></div>' +
      '<div class="field"><label>Mapel</label><select class="select" id="bk-mapel">' + opts(A.refs.mapel, 'id', 'nama', st.mapelId, 'Semua mapel') + '</select></div>' +
      '<div class="field"><label>Kelas</label><select class="select" id="bk-kelas">' + opts(A.refs.kelas, 'id', 'nama', st.kelasId, 'Semua kelas') + '</select></div>' +
      '<div class="field"><label>Kategori</label><select class="select" id="bk-kat">' + opts(A.refs.kategori.map(function (k) { return { k: k }; }), 'k', 'k', st.kategori, 'Semua kategori') + '</select></div>' +
      '<div class="field"><label>Tipe</label><select class="select" id="bk-type">' + opts([{ v: 'PG', l: 'Pilihan Ganda' }, { v: 'PG_GAMBAR', l: 'PG Bergambar' }, { v: 'BS', l: 'Benar/Salah' }], 'v', 'l', st.type, 'Semua tipe') + '</select></div>' +
      '<div class="field"><label>Status</label><select class="select" id="bk-status">' + opts([{ v: 'AKTIF', l: 'Aktif' }, { v: 'NONAKTIF', l: 'Nonaktif' }], 'v', 'l', st.status, 'Semua status') + '</select></div>' +
      '</div><section class="card" id="bk-list"><div class="empty"><span class="spin"></span></div></section>';
    $('#bk-add').addEventListener('click', function () { questionForm(null); });
    $('#bk-imp').addEventListener('click', function () { navigate('import'); });
    var reload = function () { st.page = 1; loadBank(); };
    $('#bk-q').addEventListener('input', U.debounce(function () { st.q = this.value.trim(); reload(); }.bind($('#bk-q')), 400));
    [['#bk-mapel', 'mapelId'], ['#bk-kelas', 'kelasId'], ['#bk-kat', 'kategori'], ['#bk-type', 'type'], ['#bk-status', 'status']].forEach(function (p) {
      $(p[0]).addEventListener('change', function () { st[p[1]] = this.value; reload(); });
    });
    $('#bk-list').addEventListener('click', bankActions);
    return loadBank();
  };
  function loadBank() {
    var st = A.st.bank, box = $('#bk-list');
    if (!box) return;
    box.innerHTML = '<div class="empty"><span class="spin"></span><div>Mengambil data...</div></div>';
    return call('getQuestionBank', { page: st.page, pageSize: 20, q: st.q, mapelId: st.mapelId, kelasId: st.kelasId, kategori: st.kategori, status: st.status, type: st.type }).then(function (r) {
      A.st.bank.items = r.items;
      if (!r.items.length) { box.innerHTML = emptyState('Tidak ada soal yang cocok dengan filter.', 'book'); return; }
      box.innerHTML = r.items.map(function (q) {
        var img = U.safeImg(q.img);
        return '<div class="q-item" data-id="' + esc(q.id) + '"><div class="row wrap"><span class="chip chip-brand">' + esc(q.id) + '</span><span class="chip">' + esc(q.typeLabel) + '</span>' +
          (q.kat ? '<span class="chip">' + esc(q.kat) + '</span>' : '') + statusChip(q.status) +
          '<span class="tiny muted">' + esc(mapelName(q.mapelId)) + ' · ' + esc(kelasNames(q.kelasIds)) + ' · bobot ' + esc(q.bobot) + '</span></div>' +
          '<div class="row" style="align-items:flex-start">' + (img ? '<img class="q-thumb" src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
          '<div class="q-txt" style="flex:1">' + esc(q.text) + '</div></div>' +
          '<div class="q-opts-mini">' + 'ABCDE'.split('').filter(function (k) { return q[k]; }).map(function (k) {
            return '<div class="' + (k === q.ans ? 'key' : '') + '">' + k + '. ' + esc(q[k]) + (k === q.ans ? ' ✓' : '') + '</div>';
          }).join('') + '</div>' +
          '<div class="row wrap"><button class="btn btn-outline btn-sm" data-q="preview">' + icon('eye') + 'Pratinjau</button>' +
          '<button class="btn btn-outline btn-sm" data-q="edit">' + icon('edit') + 'Edit</button>' +
          '<button class="btn btn-outline btn-sm" data-q="toggle">' + icon('power') + (q.status === 'AKTIF' ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-q="del" style="color:var(--danger)">' + icon('trash') + 'Hapus</button></div></div>';
      }).join('') + pager(r.page, r.pages, r.total);
      bindPager(box, function (p) { st.page = p; loadBank(); window.scrollTo(0, 0); });
    }).catch(function (e) { showErr(e); box.innerHTML = emptyState('Gagal memuat bank soal.', 'alert'); });
  }
  function bankActions(ev) {
    var b = ev.target.closest('[data-q]');
    if (!b) return;
    var id = b.closest('[data-id]').getAttribute('data-id');
    var q = (A.st.bank.items || []).filter(function (x) { return x.id === id; })[0];
    if (!q) return;
    var act = b.getAttribute('data-q');
    if (act === 'preview') previewQuestion(q);
    else if (act === 'edit') questionForm(q);
    else if (act === 'toggle') {
      var restore = U.busy(b);
      call('setQuestionStatus', id, q.status === 'AKTIF' ? 'NONAKTIF' : 'AKTIF').then(function (r) {
        toast('Soal ' + id + ' ' + (r.status === 'AKTIF' ? 'diaktifkan' : 'dinonaktifkan') + '.', 'ok'); loadBank();
      }, function (e) { restore(); showErr(e); });
    } else if (act === 'del') {
      U.confirm('Hapus soal?', '<p>Soal <b>' + esc(id) + '</b> akan dihapus permanen dari bank soal.</p><p class="small muted mt-1">Tips: gunakan "Nonaktifkan" bila soal pernah dipakai dalam ujian.</p>', 'Hapus', 'danger').then(function (ok) {
        if (!ok) return;
        var hide = U.loading('Menghapus soal...');
        call('deleteQuestion', id).then(function () { hide(); toast('Soal dihapus.', 'ok'); dirty(); loadBank(); }, function (e) { hide(); showErr(e); });
      });
    }
  }
  function previewQuestion(q) {
    var img = U.safeImg(q.img);
    U.modal({
      title: 'Pratinjau ' + q.id,
      body: '<div class="q-card card" style="box-shadow:none"><div class="q-meta"><span class="q-no">Soal 1 dari 1</span><span class="chip">' + esc(q.typeLabel) + '</span></div>' +
        '<div class="q-text">' + esc(q.text) + '</div>' + (img ? '<div class="q-img" style="cursor:default"><img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer"></div>' : '') +
        '<div class="opts">' + 'ABCDE'.split('').filter(function (k) { return q[k]; }).map(function (k, i) {
          return '<div class="opt' + (k === q.ans ? ' is-selected' : '') + '"><span class="opt-letter">' + 'ABCDE'.charAt(i) + '</span><span class="opt-text">' + esc(q[k]) + '</span></div>';
        }).join('') + '</div>' + (q.bahas ? '<div class="rv-bahas"><b>Pembahasan:</b> ' + esc(q.bahas) + '</div>' : '') + '</div>' +
        '<p class="small muted mt-1">Pilihan yang ditandai adalah kunci jawaban (hanya terlihat oleh admin). Saat ujian, urutan pilihan dapat diacak.</p>'
    });
  }

  function questionForm(q) {
    var e = q || { mapelId: A.st.bank && A.st.bank.mapelId || '', kelasIds: ['ALL'], kat: '', type: 'PG', text: '', img: '', A: '', B: '', C: '', D: '', E: '', ans: 'A', bobot: 1, bahas: '', status: 'AKTIF' };
    var all = e.kelasIds.indexOf('ALL') >= 0;
    var body = '<form class="stack" id="qf" novalidate>' +
      '<div class="grid-2"><div class="field"><label>Mata Pelajaran</label><select class="select" id="qf-mapel">' + opts(A.refs.mapel, 'id', 'nama', e.mapelId, '— Pilih —') + '</select></div>' +
      '<div class="field"><label>Tipe Soal</label><select class="select" id="qf-type">' + opts([{ v: 'PG', l: 'Pilihan Ganda' }, { v: 'PG_GAMBAR', l: 'Pilihan Ganda Bergambar' }, { v: 'BS', l: 'Benar/Salah' }], 'v', 'l', e.type) + '</select></div></div>' +
      '<div class="field"><label>Kelas</label><div class="check-grid" id="qf-kelas"><label class="check"><input type="checkbox" value="ALL"' + (all ? ' checked' : '') + '>Semua kelas</label>' +
      A.refs.kelas.map(function (k) { return '<label class="check"><input type="checkbox" value="' + esc(k.id) + '"' + (!all && e.kelasIds.indexOf(k.id) >= 0 ? ' checked' : '') + '>' + esc(k.nama) + '</label>'; }).join('') + '</div></div>' +
      '<div class="grid-2"><div class="field"><label>Kategori</label><input class="input" id="qf-kat" list="qf-katlist" value="' + esc(e.kat) + '" maxlength="100">' +
      '<datalist id="qf-katlist">' + A.refs.kategori.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist></div>' +
      '<div class="field"><label>Bobot</label><input class="input" type="number" min="0.5" step="0.5" id="qf-bobot" value="' + esc(e.bobot) + '"></div></div>' +
      '<div class="field"><label>Pertanyaan</label><textarea class="textarea" id="qf-text" maxlength="5000">' + esc(e.text) + '</textarea></div>' +
      '<div class="field"><label>Gambar (URL https / link Google Drive)</label><input class="input" id="qf-img" value="' + esc(/^data:/.test(e.img) ? '' : e.img) + '" placeholder="https://..."' + (/^data:/.test(e.img) ? ' data-keep="1"' : '') + '>' +
      (/^data:/.test(e.img) ? '<span class="help">Soal ini memakai gambar bawaan (data contoh). Kosongkan kolom untuk tetap memakainya.</span>' : '') +
      '<div class="row wrap mt-1"><label class="btn btn-soft btn-sm"><input type="file" id="qf-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>' + icon('upload') + 'Upload gambar</label><span class="small muted" id="qf-imginfo"></span></div>' +
      '<img class="img-preview mt-1" id="qf-prev" alt="Pratinjau" hidden referrerpolicy="no-referrer"></div>' +
      '<div id="qf-opts" class="stack" style="gap:10px">' + 'ABCDE'.split('').map(function (k) {
        return '<div class="field" data-optk="' + k + '"><label>Pilihan ' + k + '</label><input class="input" id="qf-' + k + '" value="' + esc(e[k]) + '" maxlength="1000"></div>';
      }).join('') + '</div>' +
      '<div class="grid-2"><div class="field"><label>Jawaban Benar</label><select class="select" id="qf-ans"></select></div>' +
      '<div class="field"><label>Status</label><select class="select" id="qf-status">' + opts([{ v: 'AKTIF', l: 'Aktif' }, { v: 'NONAKTIF', l: 'Nonaktif' }], 'v', 'l', e.status) + '</select></div></div>' +
      '<div class="field"><label>Pembahasan (opsional)</label><textarea class="textarea" id="qf-bahas" maxlength="3000" style="min-height:80px">' + esc(e.bahas) + '</textarea></div></form>';
    U.modal({
      title: q ? 'Edit Soal ' + q.id : 'Tambah Soal', size: 'lg', body: body,
      actions: [{ label: 'Batal', cls: 'btn-outline', value: false }, { label: 'Simpan Soal', cls: 'btn-primary', value: true, busyText: 'Menyimpan...' }],
      onOpen: function (w) {
        function syncType() {
          var t = $('#qf-type', w).value, bs = t === 'BS';
          $$('[data-optk]', w).forEach(function (f) {
            var k = f.getAttribute('data-optk');
            f.hidden = bs && (k === 'C' || k === 'D' || k === 'E');
            var inp = $('input', f);
            if (bs && k === 'A' && !inp.value) inp.value = 'Benar';
            if (bs && k === 'B' && !inp.value) inp.value = 'Salah';
          });
          var cur = $('#qf-ans', w).value || e.ans;
          $('#qf-ans', w).innerHTML = bs ? opts([{ v: 'A', l: 'Benar (A)' }, { v: 'B', l: 'Salah (B)' }], 'v', 'l', cur) : opts('ABCDE'.split('').map(function (k) { return { k: k }; }), 'k', 'k', cur);
        }
        $('#qf-type', w).addEventListener('change', syncType);
        syncType();
        $('#qf-kelas', w).addEventListener('change', function (ev) {
          var t = ev.target;
          if (t.value === 'ALL' && t.checked) $$('#qf-kelas input', w).forEach(function (i) { if (i.value !== 'ALL') i.checked = false; });
          else if (t.checked) $('#qf-kelas input[value="ALL"]', w).checked = false;
        });
        var prev = $('#qf-prev', w);
        function showPrev() {
          var u = $('#qf-img', w).value.trim() || ($('#qf-img', w).getAttribute('data-keep') ? e.img : '');
          var m = u.match(/\/file\/d\/([\w-]{20,})/) || u.match(/[?&]id=([\w-]{20,})/);
          if (m) u = 'https://lh3.googleusercontent.com/d/' + m[1];
          var s = U.safeImg(u);
          prev.hidden = !s; if (s) prev.src = s;
        }
        $('#qf-img', w).addEventListener('change', showPrev);
        prev.addEventListener('error', function () { $('#qf-imginfo', w).textContent = 'Gambar tidak dapat dimuat — periksa URL/izin berbagi.'; });
        showPrev();
        $('#qf-file', w).addEventListener('change', function () {
          var f = this.files[0]; if (!f) return;
          uploadImageFile(f, $('#qf-imginfo', w)).then(function (r) { $('#qf-img', w).value = r.url; $('#qf-img', w).removeAttribute('data-keep'); showPrev(); }, function () {});
          this.value = '';
        });
      },
      onAction: function (v, w) {
        var kel = $$('#qf-kelas input:checked', w).map(function (i) { return i.value; });
        var imgVal = fval(w, '#qf-img') || ($('#qf-img', w).getAttribute('data-keep') ? e.img : '');
        var d = {
          Soal_ID: q ? q.id : '', Mapel_ID: fval(w, '#qf-mapel'), Kelas_ID: kel.indexOf('ALL') >= 0 || !kel.length ? 'ALL' : kel.join(','),
          Kategori: fval(w, '#qf-kat'), Tipe_Soal: { PG: 'Pilihan Ganda', PG_GAMBAR: 'Pilihan Ganda Bergambar', BS: 'Benar/Salah' }[fval(w, '#qf-type')],
          Pertanyaan: $('#qf-text', w).value, Gambar_URL: imgVal, Jawaban_Benar: fval(w, '#qf-ans'), Bobot: fval(w, '#qf-bobot'),
          Pembahasan: $('#qf-bahas', w).value, Status: fval(w, '#qf-status')
        };
        'ABCDE'.split('').forEach(function (k) { d['Pilihan_' + k] = fval(w, '#qf-' + k); });
        if (d.Tipe_Soal === 'Benar/Salah') d.Jawaban_Benar = d.Jawaban_Benar === 'A' ? 'Benar' : 'Salah';
        if (!d.Mapel_ID) throw new Error('Pilih mata pelajaran.');
        if (!d.Pertanyaan.trim()) throw new Error('Pertanyaan wajib diisi.');
        return call('saveQuestion', d).then(function (r) {
          toast('Soal ' + r.id + ' tersimpan.', 'ok'); dirty();
          if (A.section === 'bank') loadBank();
        });
      }
    });
  }

  function readFileB64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej(new Error('Gagal membaca file.')); };
      fr.readAsDataURL(file);
    });
  }
  function uploadImageFile(file, infoEl) {
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].indexOf(file.type) < 0) { toast('Format gambar harus PNG/JPG/GIF/WEBP.', 'error'); return Promise.reject(); }
    if (file.size > 2 * 1024 * 1024) { toast('Ukuran gambar maksimal 2 MB.', 'error'); return Promise.reject(); }
    if (infoEl) infoEl.textContent = 'Mengunggah ' + file.name + '...';
    return readFileB64(file).then(function (b64) {
      return call('uploadImage', { name: file.name, mimeType: file.type, base64: b64 });
    }).then(function (r) {
      if (infoEl) infoEl.textContent = r.warning || 'Terunggah ke Drive (BANK_SOAL_IMAGES).';
      toast(r.warning || 'Gambar berhasil diunggah.', r.warning ? 'warn' : 'ok');
      return r;
    }, function (e) { if (infoEl) infoEl.textContent = ''; showErr(e); throw e; });
  }

  /* ---------- Import ---------- */
  RENDER['import'] = function (c) {
    c.innerHTML = '';
    c.appendChild(document.getElementById('tpl-import').content.cloneNode(true));
    var rows = null;
    call('getImportTemplate').then(function (t) {
      A.st.tpl = t;
      $('#imp-notes').innerHTML = t.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    }).catch(showErr);
    $('#imp-tpl-csv').addEventListener('click', function () {
      var t = A.st.tpl; if (!t) return;
      var csv = '﻿' + [t.headers].concat(t.rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
      U.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'Template_Import_Soal.csv');
    });
    $('#imp-tpl-xlsx').addEventListener('click', function () {
      var t = A.st.tpl; if (!t) return;
      var hide = U.loading('Menyiapkan template...');
      U.loadScript(XLSX_URL).then(function () {
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet([t.headers].concat(t.rows));
        ws['!cols'] = t.headers.map(function (h) { return { wch: h === 'Pertanyaan' ? 50 : h === 'Pembahasan' ? 40 : /Pilihan/.test(h) ? 24 : 14 }; });
        XLSX.utils.book_append_sheet(wb, ws, 'SOAL');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['PETUNJUK']].concat(t.notes.map(function (n) { return [n]; }))), 'PETUNJUK');
        var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        hide();
        U.downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Template_Import_Soal.xlsx');
      }, function (e) { hide(); toast(e.message + ' Gunakan template CSV.', 'error'); });
    });
    $('#imp-file').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      $('#imp-fname').textContent = f.name + ' · ' + Math.round(f.size / 1024) + ' KB';
      var hide = U.loading('Membaca file...');
      parseImportFile(f).then(function (data) {
        rows = data;
        if (!rows.length) throw new Error('File tidak berisi data soal.');
        U.loadingText('Memvalidasi ' + rows.length + ' baris di server...');
        return call('validateQuestionImport', rows, $('#imp-check-img').checked);
      }).then(function (r) { hide(); showImportPreview(r); }, function (e) { hide(); showErr(e); });
      this.value = '';
    });
    $('#imp-cancel').addEventListener('click', function () { rows = null; $('#imp-result').hidden = true; $('#imp-fname').textContent = ''; toast('Import dibatalkan.'); });
    $('#imp-do').addEventListener('click', function () {
      if (!rows) return;
      var b = this, restore = U.busy(b, 'Mengimport...');
      call('importQuestions', rows).then(function (r) {
        restore(); rows = null; dirty();
        $('#imp-result').hidden = true; $('#imp-fname').textContent = '';
        U.modal({ title: 'Import selesai', body: '<div class="notice notice-ok">' + icon('checkCircle') + '<div><b>' + r.imported + '</b> soal berhasil diimport. ' + (r.skipped ? r.skipped + ' baris bermasalah dilewati.' : '') + '</div></div>',
          actions: [{ label: 'Import lagi', cls: 'btn-outline', value: false }, { label: 'Lihat Bank Soal', cls: 'btn-primary', value: true }] })
          .then(function (v) { if (v) navigate('bank', { page: 1 }); });
      }, function (e) { restore(); showErr(e); });
    });
    // Upload gambar
    var pending = null;
    $('#img-file').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      pending = f;
      $('#img-info').textContent = f.name + ' · ' + Math.round(f.size / 1024) + ' KB' + (f.size > 2097152 ? ' (terlalu besar!)' : '');
      $('#img-prev').src = URL.createObjectURL(f);
      $('#img-out').hidden = false;
      $('#img-url').textContent = 'Belum diunggah.';
      $('#img-copy').hidden = true;
      this.value = '';
    });
    $('#img-upload').addEventListener('click', function () {
      if (!pending) return;
      var restore = U.busy(this, 'Mengunggah...');
      uploadImageFile(pending, $('#img-info')).then(function (r) {
        restore(); $('#img-url').textContent = r.url; $('#img-copy').hidden = false; pending = null;
      }, function () { restore(); });
    });
    $('#img-copy').addEventListener('click', function () { copyText($('#img-url').textContent); });
  };
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = [';', ',', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function rowsToObjects(aoa) {
    var hi = aoa.findIndex(function (r) { return r.some(function (c) { return /^pertanyaan$/i.test(String(c).trim()); }); });
    if (hi < 0) throw new Error('Kolom "Pertanyaan" tidak ditemukan. Gunakan template yang disediakan.');
    var h = aoa[hi].map(function (x) { return String(x).trim(); });
    return aoa.slice(hi + 1).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); }).map(function (r) {
      var o = {}; h.forEach(function (k, i) { if (k) o[k] = r[i] == null ? '' : String(r[i]); }); return o;
    });
  }
  function parseImportFile(f) {
    var isCsv = /\.csv$/i.test(f.name) || f.type === 'text/csv';
    if (isCsv) {
      return f.text().then(function (t) { return rowsToObjects(parseCsv(t)); });
    }
    return U.loadScript(XLSX_URL).then(function () { return f.arrayBuffer(); }).then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      var name = wb.SheetNames.filter(function (n) { return /soal/i.test(n); })[0] || wb.SheetNames[0];
      return rowsToObjects(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }));
    });
  }
  function showImportPreview(r) {
    $('#imp-result').hidden = false;
    $('#imp-total').textContent = r.total;
    $('#imp-valid').textContent = r.validCount;
    $('#imp-invalid').textContent = r.invalidCount;
    $('#imp-errors-wrap').hidden = !r.errors.length;
    $('#imp-errors').innerHTML = r.errors.map(function (e) {
      return '<div><b>Baris ' + e.row + ':</b> ' + e.messages.map(esc).join(' ') + '</div>';
    }).join('');
    $('#imp-prev-note').textContent = r.validCount > r.preview.length ? '(menampilkan ' + r.preview.length + ' dari ' + r.validCount + ')' : '';
    $('#imp-preview').innerHTML = r.preview.length ? '<thead><tr><th>Baris</th><th>Pertanyaan</th><th>Gambar</th><th>Mapel / Kelas</th><th>Tipe</th><th>Kunci</th></tr></thead><tbody>' +
      r.preview.map(function (p) {
        var img = U.safeImg(p.gambar);
        return '<tr><td data-label="Baris">' + p.line + '</td><td class="main" data-label="Pertanyaan">' + esc(p.pertanyaan) + '</td>' +
          '<td data-label="Gambar">' + (img ? '<img class="q-thumb" src="' + esc(img) + '" alt="" referrerpolicy="no-referrer">' : '-') + '</td>' +
          '<td data-label="Mapel/Kelas">' + esc(p.mapel) + '<br><span class="tiny muted">' + esc(p.kelas) + '</span></td><td data-label="Tipe">' + esc(p.tipe) + '</td>' +
          '<td data-label="Kunci"><b>' + esc(p.jawaban) + '</b> <span class="tiny muted">' + esc(String(p[p.jawaban] || '').slice(0, 40)) + '</span></td></tr>';
      }).join('') + '</tbody>' : '<tbody><tr><td>' + emptyState('Tidak ada soal valid.') + '</td></tr></tbody>';
    $('#imp-do').disabled = !r.validCount;
    $('#imp-do').textContent = 'IMPORT ' + r.validCount + ' SOAL VALID';
    $('#imp-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Mapel & Kelas ---------- */
  RENDER.mapel = function (c) {
    return loadRefs(true).then(function (refs) {
      c.innerHTML = head('Mata Pelajaran', 'Kelola daftar mata pelajaran yang muncul di halaman siswa.', '<button class="btn btn-primary" id="mp-add">' + icon('plus') + 'Tambah</button>') +
        '<section class="card tbl-wrap"><table class="tbl resp"><thead><tr><th>ID</th><th>Nama Mata Pelajaran</th><th>Kode</th><th>Status</th><th></th></tr></thead><tbody>' +
        (refs.mapel.length ? refs.mapel.map(function (m) {
          return '<tr data-id="' + esc(m.id) + '"><td data-label="ID">' + esc(m.id) + '</td><td class="main" data-label="Nama">' + esc(m.nama) + '</td><td data-label="Kode">' + esc(m.kode) + '</td><td data-label="Status">' + statusChip(m.status) + '</td>' +
            '<td class="act"><button class="btn btn-outline btn-sm" data-m="edit">' + icon('edit') + 'Edit</button> <button class="btn btn-ghost btn-sm" data-m="del" style="color:var(--danger)">' + icon('trash') + '</button></td></tr>';
        }).join('') : '<tr><td colspan="5">' + emptyState('Belum ada mata pelajaran.') + '</td></tr>') + '</tbody></table></section>';
      $('#mp-add').addEventListener('click', function () { mapelForm(null); });
      c.querySelector('tbody').addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-m]'); if (!b) return;
        var id = b.closest('[data-id]').getAttribute('data-id');
        var m = refs.mapel.filter(function (x) { return x.id === id; })[0];
        if (b.getAttribute('data-m') === 'edit') mapelForm(m);
        else U.confirm('Hapus mata pelajaran?', '<p><b>' + esc(m.nama) + '</b> akan dihapus. Hanya bisa jika belum dipakai bank soal/ujian.</p>', 'Hapus', 'danger').then(function (ok) {
          if (ok) call('deleteSubject', id).then(function () { toast('Dihapus.', 'ok'); dirty(); navigate('mapel'); }, showErr);
        });
      });
    });
  };
  function mapelForm(m) {
    m = m || { nama: '', kode: '', status: 'AKTIF' };
    U.modal({
      title: m.id ? 'Edit Mata Pelajaran' : 'Tambah Mata Pelajaran',
      body: '<div class="stack"><div class="field"><label>Nama Mata Pelajaran</label><input class="input" id="mf-nama" value="' + esc(m.nama) + '" maxlength="120" data-autofocus></div>' +
        '<div class="grid-2"><div class="field"><label>Kode (singkatan)</label><input class="input" id="mf-kode" value="' + esc(m.kode) + '" maxlength="20" placeholder="ASJ"></div>' +
        '<div class="field"><label>Status</label><select class="select" id="mf-status">' + opts([{ v: 'AKTIF', l: 'Aktif' }, { v: 'NONAKTIF', l: 'Nonaktif' }], 'v', 'l', m.status) + '</select></div></div></div>',
      actions: [{ label: 'Batal', cls: 'btn-outline', value: false }, { label: 'Simpan', cls: 'btn-primary', value: true }],
      onAction: function (v, w) {
        return call('saveSubject', { id: m.id || '', nama: fval(w, '#mf-nama'), kode: fval(w, '#mf-kode'), status: fval(w, '#mf-status') })
          .then(function () { toast('Mata pelajaran tersimpan.', 'ok'); dirty(); navigate('mapel'); });
      }
    });
  }
  RENDER.kelas = function (c) {
    return loadRefs(true).then(function (refs) {
      c.innerHTML = head('Kelas', 'Kelola daftar kelas.', '<button class="btn btn-primary" id="kl-add">' + icon('plus') + 'Tambah</button>') +
        '<section class="card tbl-wrap"><table class="tbl resp"><thead><tr><th>ID</th><th>Nama Kelas</th><th>Jurusan</th><th>Tingkat</th><th>Status</th><th></th></tr></thead><tbody>' +
        (refs.kelas.length ? refs.kelas.map(function (k) {
          return '<tr data-id="' + esc(k.id) + '"><td data-label="ID">' + esc(k.id) + '</td><td class="main" data-label="Nama">' + esc(k.nama) + '</td><td data-label="Jurusan">' + esc(k.jurusan) + '</td><td data-label="Tingkat">' + esc(k.tingkat) + '</td><td data-label="Status">' + statusChip(k.status) + '</td>' +
            '<td class="act"><button class="btn btn-outline btn-sm" data-k="edit">' + icon('edit') + 'Edit</button> <button class="btn btn-ghost btn-sm" data-k="del" style="color:var(--danger)">' + icon('trash') + '</button></td></tr>';
        }).join('') : '<tr><td colspan="6">' + emptyState('Belum ada kelas.') + '</td></tr>') + '</tbody></table></section>';
      $('#kl-add').addEventListener('click', function () { kelasForm(null); });
      c.querySelector('tbody').addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-k]'); if (!b) return;
        var id = b.closest('[data-id]').getAttribute('data-id');
        var k = refs.kelas.filter(function (x) { return x.id === id; })[0];
        if (b.getAttribute('data-k') === 'edit') kelasForm(k);
        else U.confirm('Hapus kelas?', '<p><b>' + esc(k.nama) + '</b> akan dihapus. Hanya bisa jika belum ada peserta.</p>', 'Hapus', 'danger').then(function (ok) {
          if (ok) call('deleteClass', id).then(function () { toast('Dihapus.', 'ok'); dirty(); navigate('kelas'); }, showErr);
        });
      });
    });
  };
  function kelasForm(k) {
    k = k || { nama: '', jurusan: 'TJKT', tingkat: 'X', status: 'AKTIF' };
    U.modal({
      title: k.id ? 'Edit Kelas' : 'Tambah Kelas',
      body: '<div class="stack"><div class="field"><label>Nama Kelas</label><input class="input" id="kf-nama" value="' + esc(k.nama) + '" maxlength="60" placeholder="XI TJKT 1" data-autofocus></div>' +
        '<div class="grid-2"><div class="field"><label>Jurusan</label><input class="input" id="kf-jur" value="' + esc(k.jurusan) + '" maxlength="60"></div>' +
        '<div class="field"><label>Tingkat</label><select class="select" id="kf-ting">' + opts(['X', 'XI', 'XII', 'XIII'].map(function (t) { return { t: t }; }), 't', 't', k.tingkat) + '</select></div></div>' +
        '<div class="field"><label>Status</label><select class="select" id="kf-status">' + opts([{ v: 'AKTIF', l: 'Aktif' }, { v: 'NONAKTIF', l: 'Nonaktif' }], 'v', 'l', k.status) + '</select></div></div>',
      actions: [{ label: 'Batal', cls: 'btn-outline', value: false }, { label: 'Simpan', cls: 'btn-primary', value: true }],
      onAction: function (v, w) {
        return call('saveClass', { id: k.id || '', nama: fval(w, '#kf-nama'), jurusan: fval(w, '#kf-jur'), tingkat: fval(w, '#kf-ting'), status: fval(w, '#kf-status') })
          .then(function () { toast('Kelas tersimpan.', 'ok'); dirty(); navigate('kelas'); });
      }
    });
  }

  /* ---------- Peserta (monitoring) ---------- */
  RENDER.peserta = function (c) {
    var st = A.st.peserta = Object.assign({ page: 1, ujianId: '', kelasId: '', status: '', nama: '', auto: true }, A.st.peserta || {});
    c.innerHTML = head('Peserta Ujian', 'Pantau peserta yang sedang mengerjakan, paksa selesai, atau izinkan mengulang.',
      '<button class="btn btn-outline" id="ps-refresh">' + icon('refresh') + 'Muat ulang</button>') +
      '<div class="card toolbar">' +
      '<div class="field"><label>Ujian</label><select class="select" id="ps-ujian">' + opts(A.refs.ujian, 'id', 'nama', st.ujianId, 'Semua ujian') + '</select></div>' +
      '<div class="field"><label>Kelas</label><select class="select" id="ps-kelas">' + opts(A.refs.kelas, 'id', 'nama', st.kelasId, 'Semua kelas') + '</select></div>' +
      '<div class="field"><label>Status</label><select class="select" id="ps-status">' + opts([{ v: 'BERJALAN', l: 'Sedang mengerjakan' }, { v: 'SUBMITTED', l: 'Selesai' }, { v: 'AUTO_SUBMITTED', l: 'Selesai otomatis' }, { v: 'BLOCKED', l: 'Dihentikan' }], 'v', 'l', st.status, 'Semua status') + '</select></div>' +
      '<div class="field"><label>Nama</label><input class="input" id="ps-nama" type="search" value="' + esc(st.nama) + '" placeholder="Cari nama"></div>' +
      '<label class="switch" style="min-height:44px"><span class="s-text">Muat otomatis (30 dtk)</span><input type="checkbox" id="ps-auto"' + (st.auto ? ' checked' : '') + '><span class="track"></span></label>' +
      '</div><section class="card" id="ps-list"><div class="empty"><span class="spin"></span></div></section>';
    var reload = function () { st.page = 1; loadPeserta(); };
    ['ujian', 'kelas', 'status'].forEach(function (k) { $('#ps-' + k).addEventListener('change', function () { st[k === 'ujian' ? 'ujianId' : k === 'kelas' ? 'kelasId' : 'status'] = this.value; reload(); }); });
    $('#ps-nama').addEventListener('input', U.debounce(function () { st.nama = $('#ps-nama').value.trim(); reload(); }, 400));
    $('#ps-refresh').addEventListener('click', loadPeserta);
    $('#ps-auto').addEventListener('change', function () { st.auto = this.checked; setAuto(); });
    $('#ps-list').addEventListener('click', pesertaActions);
    function setAuto() { clearTimers(); if (st.auto) A.timers.push(setInterval(function () { if (!document.querySelector('.modal-wrap')) loadPeserta(true); }, 30000)); }
    setAuto();
    return loadPeserta();
  };
  function loadPeserta(silent) {
    var st = A.st.peserta, box = $('#ps-list');
    if (!box) return;
    if (!silent) box.innerHTML = '<div class="empty"><span class="spin"></span><div>Mengambil data...</div></div>';
    return call('getParticipants', { ujianId: st.ujianId, kelasId: st.kelasId, status: st.status, nama: st.nama }, st.page).then(function (r) {
      st.items = r.items;
      box.innerHTML = '<div class="panel-title" style="padding-bottom:10px">' + r.total + ' sesi <span class="chip chip-warn">' + r.running + ' sedang mengerjakan</span></div>' +
        (r.items.length ? '<div class="tbl-wrap"><table class="tbl resp"><thead><tr><th>Nama</th><th>Kelas</th><th>Ujian</th><th>Mulai</th><th>Status</th><th class="num">Dijawab</th><th class="num">Pelanggaran</th><th class="num">Nilai</th><th></th></tr></thead><tbody>' +
          r.items.map(function (p) {
            var running = ['STARTED', 'IN_PROGRESS'].indexOf(p.status) >= 0;
            return '<tr data-sid="' + esc(p.sid) + '"><td class="main" data-label="Nama">' + esc(p.nama) + '<div class="tiny muted">' + esc(p.sid) + '</div></td><td data-label="Kelas">' + esc(p.kelas) + '</td>' +
              '<td data-label="Ujian">' + esc(p.ujian) + '</td><td data-label="Mulai">' + esc(p.mulai) + '</td>' +
              '<td data-label="Status"><span class="chip ' + (running ? 'chip-warn' : p.status === 'BLOCKED' ? 'chip-danger' : 'chip-ok') + '">' + esc(p.statusLabel) + '</span>' + (running ? '<div class="tiny muted">sisa ' + p.sisaMenit + ' mnt · simpan ' + esc(p.lastSaved) + '</div>' : '') + '</td>' +
              '<td class="num" data-label="Dijawab">' + p.answered + '/' + p.total + '</td>' +
              '<td class="num" data-label="Pelanggaran">' + (p.vc ? '<span class="chip chip-danger">' + p.vc + '</span>' : '0') + '</td>' +
              '<td class="num" data-label="Nilai"><b>' + num(p.nilai) + '</b></td>' +
              '<td class="act"><button class="btn btn-outline btn-sm" data-p="detail">' + icon('eye') + 'Detail</button> ' +
              (running ? '<button class="btn btn-outline btn-sm" data-p="force">Paksa selesai</button>' :
                (p.retakeAllowed ? '<span class="chip">Boleh ulang</span>' : '<button class="btn btn-outline btn-sm" data-p="retake">Izinkan ulang</button>')) + '</td></tr>';
          }).join('') + '</tbody></table></div>' + pager(r.page, r.pages, r.total) : emptyState('Belum ada peserta.', 'users'));
      bindPager(box, function (p) { st.page = p; loadPeserta(); });
    }).catch(function (e) { if (!silent) { showErr(e); box.innerHTML = emptyState('Gagal memuat data peserta.', 'alert'); } });
  }
  function pesertaActions(ev) {
    var b = ev.target.closest('[data-p]'); if (!b) return;
    var sid = b.closest('[data-sid]').getAttribute('data-sid');
    var p = (A.st.peserta.items || []).filter(function (x) { return x.sid === sid; })[0] || { nama: sid };
    var act = b.getAttribute('data-p');
    if (act === 'detail') sessionDetail(sid);
    else if (act === 'force') U.confirm('Paksa selesai?', '<p>Ujian <b>' + esc(p.nama) + '</b> akan dikunci dan dinilai berdasarkan jawaban yang sudah tersimpan.</p>', 'Paksa selesai', 'danger').then(function (ok) {
      if (!ok) return;
      var hide = U.loading('Menghitung nilai...');
      call('adminForceSubmit', sid).then(function (r) { hide(); toast('Sesi diselesaikan. Nilai: ' + r.score, 'ok'); loadPeserta(); }, function (e) { hide(); showErr(e); });
    });
    else if (act === 'retake') U.confirm('Izinkan mengulang?', '<p><b>' + esc(p.nama) + '</b> dapat memulai ujian ini lagi. Hasil sesi lama tetap tersimpan di rekap.</p>', 'Izinkan').then(function (ok) {
      if (!ok) return;
      call('adminAllowRetake', sid).then(function () { toast('Siswa dapat mengulang ujian.', 'ok'); loadPeserta(); }, showErr);
    });
  }
  function sessionDetail(sid) {
    var hide = U.loading('Mengambil detail...');
    call('getSessionDetail', sid).then(function (d) {
      hide();
      U.modal({
        title: d.nama + ' · ' + d.kelas, size: 'lg',
        body: '<div class="kv" style="border:1px solid var(--border);border-radius:12px;overflow:hidden">' +
          [['Ujian', d.ujian], ['Status', d.statusLabel], ['Mulai', d.mulai], ['Selesai', d.selesai], ['Batas waktu', d.batas], ['Jeda koneksi', d.jeda || '-'], ['Session_ID', d.sid]].map(function (p) {
            return '<div>' + esc(p[0]) + '</div><div>' + esc(p[1]) + '</div>';
          }).join('') + '</div>' +
          '<div class="sum-grid mt-2" style="grid-template-columns:repeat(4,1fr)"><div class="card"><b>' + num(d.score) + '</b><span>Nilai' + (d.provisional ? ' (sementara)' : '') + '</span></div>' +
          '<div class="card"><b style="color:var(--ok)">' + d.correct + '</b><span>Benar</span></div><div class="card"><b style="color:var(--danger)">' + d.wrong + '</b><span>Salah</span></div>' +
          '<div class="card"><b>' + d.unanswered + '</b><span>Kosong</span></div></div>' +
          '<div class="label">Jawaban</div><div class="tbl-wrap card mt-1" style="max-height:300px"><table class="tbl"><thead><tr><th>No</th><th>Soal</th><th>Jawab</th><th>Kunci</th></tr></thead><tbody>' +
          d.answers.map(function (a) {
            return '<tr><td>' + a.no + '</td><td><span class="tiny muted">' + esc(a.id) + '</span><div class="small">' + esc(String(a.text).slice(0, 120)) + '</div></td><td><span class="chip ' + (a.benar ? 'chip-ok' : a.jawab ? 'chip-danger' : '') + '">' + esc(a.jawab || '-') + '</span></td><td>' + esc(a.kunci) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="label mt-2">Pelanggaran (' + d.violations.length + ')</div>' +
          (d.violations.length ? '<div class="err-list mt-1">' + d.violations.map(function (v) { return '<div><b>' + esc(v.waktu) + '</b> · ' + statusChip(v.severity) + ' ' + esc(v.detail) + '</div>'; }).join('') + '</div>' : '<p class="small muted mt-1">Tidak ada pelanggaran.</p>')
      });
    }, function (e) { hide(); showErr(e); });
  }

  /* ---------- Rekap nilai ---------- */
  function filterBar(prefix, f, fields) {
    var h = '<div class="card toolbar">';
    if (fields.indexOf('mapel') >= 0) h += '<div class="field"><label>Mata Pelajaran</label><select class="select" id="' + prefix + '-mapel">' + opts(A.refs.mapel, 'id', 'nama', f.mapelId, 'Semua mapel') + '</select></div>';
    if (fields.indexOf('kelas') >= 0) h += '<div class="field"><label>Kelas</label><select class="select" id="' + prefix + '-kelas">' + opts(A.refs.kelas, 'id', 'nama', f.kelasId, fields.indexOf('kelasReq') >= 0 ? '— Pilih kelas —' : 'Semua kelas') + '</select></div>';
    if (fields.indexOf('ujian') >= 0) h += '<div class="field"><label>Ujian</label><select class="select" id="' + prefix + '-ujian">' + opts(A.refs.ujian, 'id', 'nama', f.ujianId, 'Semua ujian') + '</select></div>';
    if (fields.indexOf('date') >= 0) h += '<div class="field"><label>Dari tanggal</label><input class="input" type="date" id="' + prefix + '-from" value="' + esc(f.dateFrom || '') + '"></div>' +
      '<div class="field"><label>Sampai tanggal</label><input class="input" type="date" id="' + prefix + '-to" value="' + esc(f.dateTo || '') + '"></div>';
    if (fields.indexOf('nama') >= 0) h += '<div class="field"><label>Nama siswa</label><input class="input" type="search" id="' + prefix + '-nama" value="' + esc(f.nama || '') + '" placeholder="Cari nama"></div>';
    if (fields.indexOf('lulus') >= 0) h += '<div class="field"><label>Status</label><select class="select" id="' + prefix + '-lulus">' + opts([{ v: 'LULUS', l: 'LULUS' }, { v: 'BELUM', l: 'BELUM LULUS' }], 'v', 'l', f.lulus, 'Semua') + '</select></div>';
    if (fields.indexOf('jenis') >= 0) h += '<div class="field"><label>Jenis</label><select class="select" id="' + prefix + '-jenis"><option value="">Semua jenis</option>' +
      ['TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'SCREENSHOT_KEY', 'COPY_ATTEMPT', 'DEVTOOLS_KEY'].map(function (j) { return '<option' + (f.jenis === j ? ' selected' : '') + '>' + j + '</option>'; }).join('') + '</select></div>';
    return h + '</div>';
  }
  function readFilters(prefix, root) {
    var g = function (s) { var el = $('#' + prefix + '-' + s, root); return el ? el.value.trim() : ''; };
    return { mapelId: g('mapel'), kelasId: g('kelas'), ujianId: g('ujian'), dateFrom: g('from'), dateTo: g('to'), nama: g('nama'), lulus: g('lulus'), jenis: g('jenis') };
  }
  function bindFilters(prefix, root, cb) {
    $$('[id^="' + prefix + '-"]', root).forEach(function (el) {
      el.addEventListener(el.type === 'search' ? 'input' : 'change', el.type === 'search' ? U.debounce(cb, 400) : cb);
    });
  }
  function exportButtons(kind) {
    return '<div class="row wrap"><span class="small muted" style="font-weight:700">Export:</span>' +
      '<button class="btn btn-outline btn-sm" data-exp="csv" data-kind="' + kind + '">CSV</button>' +
      '<button class="btn btn-outline btn-sm" data-exp="xlsx" data-kind="' + kind + '">XLSX</button>' +
      '<button class="btn btn-outline btn-sm" data-exp="pdf" data-kind="' + kind + '">PDF</button>' +
      '<button class="btn btn-ghost btn-sm" data-exp="gsheet" data-kind="' + kind + '">' + icon('link') + 'Simpan ke Drive</button></div>';
  }

  RENDER.rekap = function (c) {
    var st = A.st.rekap = Object.assign({ tab: 'siswa', page: 1, f: {} }, A.st.rekap || {});
    c.innerHTML = head('Rekap Nilai', 'Filter berdasarkan mata pelajaran, kelas, ujian, tanggal, dan nama. Export mengikuti filter aktif.') +
      '<div class="pill-tabs" role="tablist">' + [['siswa', 'Per Siswa'], ['mapel', 'Per Mata Pelajaran'], ['kelas', 'Per Kelas']].map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" class="' + (st.tab === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
      }).join('') + '</div><div id="rk-body"></div>';
    $$('[data-tab]', c).forEach(function (b) {
      b.addEventListener('click', function () { st.tab = b.getAttribute('data-tab'); st.page = 1; navigate('rekap'); });
    });
    var body = $('#rk-body');
    body.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-exp]'); if (!b) return;
      doExport(b.getAttribute('data-kind'), readFilters('rf', body), b.getAttribute('data-exp'), b);
    });
    if (st.tab === 'kelas') {
      if (!st.f.kelasId && A.refs.kelas.length) st.f.kelasId = A.refs.kelas[0].id;
      body.innerHTML = filterBar('rf', st.f, ['kelas', 'kelasReq', 'ujian', 'date']) + '<section class="card"><div class="panel-title" style="padding-bottom:12px">' + exportButtons('kelas') + '</div><div id="rk-out"></div></section>';
      bindFilters('rf', body, function () { st.f = readFilters('rf', body); loadClassRecap(); });
      return loadClassRecap();
    }
    if (st.tab === 'mapel') {
      body.innerHTML = filterBar('rf', st.f, ['mapel', 'kelas', 'ujian', 'date']) + '<section class="card" id="rk-out"></section>';
      bindFilters('rf', body, function () { st.f = readFilters('rf', body); loadStats(); });
      return loadStats();
    }
    body.innerHTML = filterBar('rf', st.f, ['mapel', 'kelas', 'ujian', 'date', 'nama', 'lulus']) +
      '<div class="sum-grid" id="rk-sum"></div><section class="card"><div class="panel-title" style="padding-bottom:12px">' + exportButtons('nilai') + '</div><div id="rk-out"></div></section>';
    bindFilters('rf', body, function () { st.f = readFilters('rf', body); st.page = 1; loadResults(); });
    return loadResults();
  };
  function loadResults() {
    var st = A.st.rekap, out = $('#rk-out');
    if (!out) return;
    out.innerHTML = '<div class="empty"><span class="spin"></span><div>Mengambil data...</div></div>';
    return call('getResults', st.f, st.page, 50).then(function (r) {
      var s = r.summary;
      $('#rk-sum').innerHTML = [['Jumlah peserta', s.jumlah], ['Nilai tertinggi', num(s.tertinggi)], ['Nilai terendah', num(s.terendah)], ['Rata-rata', num(s.rataRata)],
        ['Lulus (≥' + s.kkm + ')', s.lulus], ['Belum lulus', s.belumLulus]].map(function (p, i) {
        return '<div class="card"><b style="' + (i === 4 ? 'color:var(--ok)' : i === 5 ? 'color:var(--danger)' : '') + '">' + esc(p[1]) + '</b><span>' + esc(p[0]) + '</span></div>';
      }).join('');
      out.innerHTML = r.items.length ? '<div class="tbl-wrap"><table class="tbl resp"><thead><tr><th>No</th><th>Nama</th><th>Kelas</th><th>Mapel</th><th>Ujian</th><th>Tanggal</th><th class="num">Benar</th><th class="num">Salah</th><th class="num">Kosong</th><th class="num">Nilai</th><th>Status</th></tr></thead><tbody>' +
        r.items.map(function (x) {
          return '<tr><td data-label="No">' + x.no + '</td><td class="main" data-label="Nama">' + esc(x.nama) + '</td><td data-label="Kelas">' + esc(x.kelas) + '</td><td data-label="Mapel">' + esc(x.mapel) + '</td>' +
            '<td data-label="Ujian">' + esc(x.ujian) + '</td><td data-label="Tanggal">' + esc(x.tanggal) + '</td><td class="num" data-label="Benar">' + x.benar + '</td><td class="num" data-label="Salah">' + x.salah + '</td>' +
            '<td class="num" data-label="Kosong">' + x.kosong + '</td><td class="num" data-label="Nilai"><b>' + num(x.nilai) + '</b></td><td data-label="Status">' + statusChip(x.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + pager(r.page, r.pages, r.total) : emptyState('Belum ada nilai untuk filter ini.', 'chart');
      bindPager(out, function (p) { st.page = p; loadResults(); });
    }).catch(function (e) { showErr(e); out.innerHTML = emptyState('Gagal memuat rekap.', 'alert'); });
  }
  function loadStats() {
    var out = $('#rk-out');
    out.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    return call('getStatistics', A.st.rekap.f).then(function (r) {
      out.innerHTML = r.perMapel.length ? '<div class="tbl-wrap"><table class="tbl resp"><thead><tr><th>Mata Pelajaran</th><th class="num">Peserta</th><th class="num">Tertinggi</th><th class="num">Terendah</th><th class="num">Rata-rata</th><th class="num">Lulus</th><th class="num">Belum Lulus</th></tr></thead><tbody>' +
        r.perMapel.map(function (m) {
          return '<tr><td class="main" data-label="Mapel">' + esc(m.mapel) + '</td><td class="num" data-label="Peserta">' + m.jumlah + '</td><td class="num" data-label="Tertinggi">' + num(m.tertinggi) + '</td><td class="num" data-label="Terendah">' + num(m.terendah) + '</td>' +
            '<td class="num" data-label="Rata-rata"><b>' + num(m.rataRata) + '</b></td><td class="num" data-label="Lulus" style="color:var(--ok)">' + m.lulus + '</td><td class="num" data-label="Belum Lulus" style="color:var(--danger)">' + m.belumLulus + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="small muted" style="padding:12px 16px">Total: ' + r.overall.jumlah + ' peserta · rata-rata ' + num(r.overall.rataRata) + ' · KKM ' + r.overall.kkm + '. Pilih mapel di tab "Per Siswa" untuk tabel detail.</p>'
        : emptyState('Belum ada nilai untuk filter ini.', 'chart');
    }).catch(function (e) { showErr(e); out.innerHTML = emptyState('Gagal memuat statistik.', 'alert'); });
  }
  function loadClassRecap() {
    var out = $('#rk-out'), f = A.st.rekap.f;
    if (!f.kelasId) { out.innerHTML = emptyState('Pilih kelas.'); return Promise.resolve(); }
    out.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    return call('getClassRecap', f).then(function (r) {
      out.innerHTML = '<div class="panel-title" style="padding:0 16px 10px">Kelas ' + esc(r.kelas) + ' <span class="tiny muted">(nilai terakhir per mapel)</span></div>' +
        (r.rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>No</th><th>Nama</th>' + r.mapel.map(function (m) { return '<th class="num" title="' + esc(m.nama) + '">' + esc(m.kode) + '</th>'; }).join('') + '<th class="num">Rata-rata</th></tr></thead><tbody>' +
          r.rows.map(function (x) {
            return '<tr><td>' + x.no + '</td><td style="font-weight:700">' + esc(x.nama) + '</td>' + x.scores.map(function (v) { return '<td class="num">' + num(v) + '</td>'; }).join('') + '<td class="num"><b>' + num(x.rata) + '</b></td></tr>';
          }).join('') + '</tbody></table></div>' : emptyState('Belum ada nilai di kelas ini.', 'chart'));
    }).catch(function (e) { showErr(e); out.innerHTML = emptyState('Gagal memuat rekap kelas.', 'alert'); });
  }

  /* ---------- Export ---------- */
  function doExport(kind, f, format, btn) {
    var restore = U.busy(btn, '');
    var done = function () { restore(); };
    if (kind === 'kelas' && !f.kelasId) { done(); toast('Pilih kelas terlebih dahulu.', 'warn'); return; }
    if (format === 'xlsx') {
      Promise.all([call('exportResults', kind, f, 'json'), U.loadScript(XLSX_URL)]).then(function (res) {
        var d = res[0];
        var aoa = [[d.title], [d.subtitle || 'Semua data']].concat(d.summary ? [[d.summary]] : []).concat([[]]).concat([d.headers]).concat(d.rows);
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = d.headers.map(function (h) { return { wch: /Nama|Ujian|Pertanyaan|Detail/.test(h) ? 30 : 12 }; });
        XLSX.utils.book_append_sheet(wb, ws, 'Rekap');
        var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        U.downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), d.filename + '.xlsx');
        done(); toast('File XLSX diunduh. Jika tidak muncul, gunakan "Simpan ke Drive".', 'ok', 4500);
      }).catch(function (e) { done(); showErr(e); });
      return;
    }
    if (format === 'gsheet') {
      call('exportResults', kind, f, 'gsheet', true).then(function (r) {
        done();
        U.modal({ title: 'Tersimpan di Google Drive', body: '<p>File <b>' + esc(r.filename) + '</b> dibuat di folder Drive <b>EXPORT_UJIAN_ONLINE</b>.</p>',
          actions: [{ label: 'Tutup', cls: 'btn-outline', value: false }, { label: '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">Buka file</a>', cls: 'btn-primary', value: true }] });
      }, function (e) { done(); showErr(e); });
      return;
    }
    call('exportResults', kind, f, format).then(function (r) {
      U.downloadBase64(r.base64, r.mimeType, r.filename);
      done(); toast('File ' + format.toUpperCase() + ' diunduh. Jika tidak muncul, gunakan "Simpan ke Drive".', 'ok', 4500);
    }, function (e) { done(); showErr(e); });
  }

  RENDER.export = function (c) {
    var f = A.st.exportF = A.st.exportF || {};
    c.innerHTML = head('Export Data', 'Unduh rekap dalam format CSV, XLSX, atau PDF — atau simpan langsung ke Google Drive.') +
      filterBar('rf', f, ['mapel', 'kelas', 'ujian', 'date', 'nama']) +
      '<div class="exam-cards">' +
      [['nilai', 'Rekap Nilai', 'Semua nilai sesuai filter (No, Nama, Kelas, Mapel, Ujian, Benar, Salah, Kosong, Nilai, Status).'],
        ['kelas', 'Rekap per Kelas', 'Tabel nilai per siswa × mata pelajaran untuk kelas terpilih (filter Kelas wajib).'],
        ['pelanggaran', 'Log Pelanggaran', 'Catatan pelanggaran anti-cheating sesuai filter.'],
        ['bank', 'Backup Bank Soal', 'Seluruh bank soal (filter Mapel) dalam format template import.']].map(function (x) {
        return '<section class="card exam-card"><h4>' + esc(x[1]) + '</h4><p class="small muted">' + esc(x[2]) + '</p>' + exportButtons(x[0]) + '</section>';
      }).join('') + '</div>' +
      '<div class="notice mt-2 small">' + icon('info') + '<div>Beberapa browser ponsel memblokir unduhan dari dalam Google Sites/iframe. Gunakan tombol <b>Simpan ke Drive</b> sebagai alternatif.</div></div>';
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-exp]'); if (!b) return;
      A.st.exportF = readFilters('rf', c);
      doExport(b.getAttribute('data-kind'), A.st.exportF, b.getAttribute('data-exp'), b);
    });
  };

  /* ---------- Pelanggaran ---------- */
  RENDER.pelanggaran = function (c) {
    var st = A.st.pel = Object.assign({ page: 1, f: {} }, A.st.pel || {});
    c.innerHTML = head('Pelanggaran', 'Catatan anti-cheating: keluar halaman, hilang fokus, keluar layar penuh, dan lainnya.') +
      filterBar('rf', st.f, ['ujian', 'kelas', 'jenis', 'nama', 'date']) +
      '<section class="card"><div class="panel-title" style="padding-bottom:12px">' + exportButtons('pelanggaran') + '</div><div id="pl-out"></div></section>' +
      '<div class="notice mt-2 small">' + icon('info') + '<div>Aplikasi berbasis browser tidak dapat mengunci ponsel, mencegah screenshot, atau mencegah perangkat kedua. Catatan ini adalah alat bantu pengawasan.</div></div>';
    bindFilters('rf', c, function () { st.f = readFilters('rf', c); st.page = 1; loadPel(); });
    c.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-exp]'); if (!b) return;
      doExport('pelanggaran', readFilters('rf', c), b.getAttribute('data-exp'), b);
    });
    return loadPel();
  };
  function loadPel() {
    var st = A.st.pel, out = $('#pl-out');
    out.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    return call('getViolations', st.f, st.page).then(function (r) {
      out.innerHTML = r.items.length ? '<div class="tbl-wrap"><table class="tbl resp"><thead><tr><th>Waktu</th><th>Nama</th><th>Kelas</th><th>Ujian</th><th>Jenis</th><th>Tingkat</th></tr></thead><tbody>' +
        r.items.map(function (v) {
          return '<tr><td data-label="Waktu">' + esc(v.waktu) + '</td><td class="main" data-label="Nama">' + esc(v.nama) + '</td><td data-label="Kelas">' + esc(v.kelas) + '</td><td data-label="Ujian">' + esc(v.ujian) + '</td>' +
            '<td data-label="Jenis">' + esc(v.label) + '<div class="tiny muted">' + esc(v.detail) + '</div></td><td data-label="Tingkat">' + statusChip(v.severity) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + pager(r.page, r.pages, r.total) : emptyState('Tidak ada pelanggaran tercatat.', 'checkCircle');
      bindPager(out, function (p) { st.page = p; loadPel(); });
    }).catch(function (e) { showErr(e); out.innerHTML = emptyState('Gagal memuat data.', 'alert'); });
  }

  /* ---------- Pengaturan ---------- */
  RENDER.pengaturan = function (c) {
    return call('getSettings').then(function (list) {
      var v = {}; list.forEach(function (s) { v[s.key] = s.value; });
      var b = function (k) { return /^true$/i.test(v[k]); };
      var url = U.frontUrl();
      c.innerHTML = head('Pengaturan', 'Identitas sekolah, default ujian, anti-cheating, dan keamanan.') +
        '<form id="set-form" class="stack" novalidate>' +
        '<section class="card set-group"><h3>Identitas</h3><div class="grid-2">' +
        '<div class="field"><label>Nama Aplikasi</label><input class="input" id="s-APP_NAME" value="' + esc(v.APP_NAME) + '" maxlength="80"></div>' +
        '<div class="field"><label>Nama Sekolah</label><input class="input" id="s-SCHOOL_NAME" value="' + esc(v.SCHOOL_NAME) + '" maxlength="120"></div></div>' +
        '<div class="field"><label>URL Logo (https / link Google Drive)</label><input class="input" id="s-LOGO_URL" value="' + esc(v.LOGO_URL) + '" placeholder="https://..."><span class="help">Upload logo lewat menu Import Soal → Upload gambar, lalu tempel URL-nya di sini.</span></div>' +
        '<div class="field"><label>Pesan setelah ujian</label><textarea class="textarea" id="s-FINISH_MESSAGE" style="min-height:80px" maxlength="500">' + esc(v.FINISH_MESSAGE) + '</textarea></div></section>' +
        '<section class="card set-group"><h3>Default ujian baru</h3><div class="grid-3">' +
        '<div class="field"><label>Durasi default (menit)</label><input class="input" type="number" id="s-DEFAULT_DURATION" value="' + esc(v.DEFAULT_DURATION) + '"></div>' +
        '<div class="field"><label>Jumlah soal default</label><input class="input" type="number" id="s-DEFAULT_QUESTION_COUNT" value="' + esc(v.DEFAULT_QUESTION_COUNT) + '"></div>' +
        '<div class="field"><label>KKM (batas lulus)</label><input class="input" type="number" id="s-KKM" value="' + esc(v.KKM) + '"></div></div>' +
        '<div class="grid-2">' + sw('s-DEFAULT_ACAK_SOAL', 'Acak soal', b('DEFAULT_ACAK_SOAL')) + sw('s-DEFAULT_ACAK_PILIHAN', 'Acak pilihan', b('DEFAULT_ACAK_PILIHAN')) + '</div>' +
        '<div class="grid-2"><div class="field"><label>Mode ujian default</label><select class="select" id="s-DEFAULT_MODE">' + opts([{ v: 'UJIAN', l: 'MODE UJIAN' }, { v: 'LATIHAN', l: 'MODE LATIHAN' }], 'v', 'l', v.DEFAULT_MODE) + '</select></div>' +
        '<div class="field"><label>Tampilkan nilai (default)</label><select class="select" id="s-DEFAULT_TAMPILAN_HASIL">' + opts([{ v: 'TIDAK', l: 'Tidak ditampilkan' }, { v: 'NILAI', l: 'HASIL SAJA' }, { v: 'LENGKAP', l: 'Nilai + pembahasan (latihan)' }], 'v', 'l', v.DEFAULT_TAMPILAN_HASIL) + '</select></div></div></section>' +
        '<section class="card set-group"><h3>Anti-cheating & waktu</h3><div class="grid-2">' +
        '<div class="field"><label>Maksimum pelanggaran (default)</label><input class="input" type="number" id="s-MAX_VIOLATIONS" value="' + esc(v.MAX_VIOLATIONS) + '"></div>' +
        sw('s-AUTO_STOP_ON_MAX', 'Hentikan otomatis saat batas tercapai', b('AUTO_STOP_ON_MAX')) + '</div>' +
        sw('s-AUTO_SUBMIT', 'Auto-submit sesi yang ditinggalkan', b('AUTO_SUBMIT'), 'Server mengumpulkan sesi saat waktu habis (perlu trigger installTriggers)') +
        '<div class="grid-2">' + sw('s-OFFLINE_PAUSE', 'Jeda otomatis saat koneksi siswa terputus', b('OFFLINE_PAUSE'), 'Siswa melanjutkan dengan soal & sisa waktu yang sama setelah internet kembali') +
        '<div class="field"><label>Batas total jeda per siswa (menit, 1–240)</label><input class="input" type="number" min="1" max="240" id="s-OFFLINE_MAX_PAUSE_MINUTES" value="' + esc(v.OFFLINE_MAX_PAUSE_MINUTES) + '"><span class="help">Lewat dari ini, sesi yang terputus dikumpulkan otomatis.</span></div></div></section>' +
        '<section class="card set-group"><h3>Privasi & keamanan</h3>' +
        sw('s-COLLECT_DEVICE_INFO', 'Catat jenis browser & perangkat siswa', b('COLLECT_DEVICE_INFO'), 'Opsional. Alamat IP tidak pernah dicatat.') +
        '<div class="field"><label>Auto-logout admin (menit, 10–360)</label><input class="input" type="number" id="s-ADMIN_SESSION_MINUTES" value="' + esc(v.ADMIN_SESSION_MINUTES) + '"></div></section>' +
        '<div class="row wrap"><button class="btn btn-primary" type="submit" id="set-save">Simpan Pengaturan</button></div></form>' +
        '<section class="card set-group mt-3"><h3>Ganti password admin</h3><div class="grid-3">' +
        '<div class="field"><label>Password lama</label><input class="input" type="password" id="pw-old" autocomplete="current-password"></div>' +
        '<div class="field"><label>Password baru</label><input class="input" type="password" id="pw-new" autocomplete="new-password"><span class="help">Min. 8 karakter, huruf & angka</span></div>' +
        '<div class="field"><label>Ulangi password baru</label><input class="input" type="password" id="pw-new2" autocomplete="new-password"></div></div>' +
        '<div><button class="btn btn-outline" id="pw-save">' + icon('lock') + 'Ganti Password</button></div></section>' +
        '<section class="card set-group mt-2"><h3>Sistem</h3>' +
        '<div class="field"><label>URL halaman siswa (GitHub Pages)</label><code class="url">' + esc(url) + '</code></div>' +
        '<div class="field"><label>URL halaman admin</label><code class="url">' + esc(url) + 'admin.html</code></div>' +
        '<div class="field"><label>URL API (Apps Script, di config.js)</label><code class="url">' + esc(U.apiUrl) + '</code></div>' +
        '<div class="row wrap"><button class="btn btn-outline" id="cache-clear">' + icon('refresh') + 'Bersihkan cache</button><span class="small muted">Gunakan setelah mengedit data langsung di Supabase.</span></div>' +
        '<div class="small muted">Versi aplikasi ' + esc(CFG.version || '') + '</div></section>';
      $('#set-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var vals = {};
        list.forEach(function (s) {
          var el = $('#s-' + s.key); if (!el) return;
          vals[s.key] = el.type === 'checkbox' ? (el.checked ? 'TRUE' : 'FALSE') : el.value;
        });
        var restore = U.busy($('#set-save'), 'Menyimpan...');
        call('saveSettings', vals).then(function (cfg) {
          restore(); Object.assign(CFG, cfg); brand(); dirty(); toast('Pengaturan tersimpan.', 'ok');
        }, function (e) { restore(); showErr(e); });
      });
      $('#pw-save').addEventListener('click', function () {
        var o = $('#pw-old').value, n = $('#pw-new').value, n2 = $('#pw-new2').value;
        if (n !== n2) { toast('Konfirmasi password baru tidak sama.', 'error'); return; }
        var restore = U.busy(this, 'Menyimpan...');
        call('changeAdminPassword', o, n).then(function () {
          restore(); $('#pw-old').value = $('#pw-new').value = $('#pw-new2').value = ''; toast('Password admin berhasil diganti.', 'ok');
        }, function (e) { restore(); showErr(e); });
      });
      $('#cache-clear').addEventListener('click', function () {
        var restore = U.busy(this, '');
        call('clearAppCache').then(function () { restore(); dirty(); toast('Cache dibersihkan.', 'ok'); }, function (e) { restore(); showErr(e); });
      });
    });
  };

  /* ---------------- Start ---------------- */
  function boot() {
    brand();
    initLogin();
    initShell();
    if (!U.apiReady) { var le = $('#l-err'); le.textContent = 'API_URL belum diatur di config.js. Isi dengan URL Web App Apps Script.'; le.hidden = false; return; }
    U.api('getAppConfig').then(function (cfg) {
      Object.assign(CFG, cfg); brand();
      try { localStorage.setItem('uo_cfg', JSON.stringify(cfg)); } catch (e) { /* noop */ }
    }, function () { /* tetap bisa login */ });
    var t = ss.get();
    if (!t) { toLogin(); return; }
    A.token = t;
    var hide = U.loading('Memeriksa sesi...');
    U.api('checkAdmin', t).then(function (r) {
      hide();
      if (r.config) Object.assign(CFG, r.config);
      enterShell(false);
    }, function () { hide(); toLogin(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
