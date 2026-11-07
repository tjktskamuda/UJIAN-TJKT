/* =========================================================
   exam.js — Alur siswa:
   landing → mulai → ujian (timer server, autosave batch, anti-cheating,
   jeda otomatis saat koneksi putus) → hasil
   ========================================================= */
(function () {
  'use strict';
  var $ = U.$, $$ = U.$$, esc = U.esc, api = U.api, toast = U.toast, store = U.store;
  var CFG = store.get('uo_cfg') || {};          // identitas sekolah terakhir (tampil instan)
  var BOOT = { config: CFG, subjects: [], classes: [], exams: [], loading: true };
  var LETTERS = 'ABCDE';
  var STUDENT_ERR = 'Terjadi gangguan koneksi. Jawaban Anda yang sudah tersimpan tetap aman. Silakan coba kembali.';
  var K_SID = 'uo_sid';
  function kAns(s) { return 'uo_ans_' + s; }
  function kFlag(s) { return 'uo_flag_' + s; }
  function kIdx(s) { return 'uo_idx_' + s; }
  function kPause(s) { return 'uo_pause_' + s; }

  var S = {
    boot: BOOT, sess: null, idx: 0, answers: {}, dirty: {}, flags: {}, offset: 0,
    inflight: false, retry: 0, saveTimer: null, tickTimer: null, hbTimer: null,
    ended: false, submitting: false, warned5: false, warned1: false,
    paused: false, pauseRemain: 0
  };

  /** Perkiraan jam server saat ini (untuk menandai waktu kirim request). */
  function srvNow() { return Date.now() + (S.offset || 0); }

  function errMsg(e) {
    if (!e) return STUDENT_ERR;
    if (e.code === 'NETWORK') return STUDENT_ERR;
    return e.message || STUDENT_ERR;
  }

  function show(view) {
    ['view-landing', 'view-exam', 'view-result'].forEach(function (id) { $('#' + id).hidden = id !== view; });
    document.body.setAttribute('data-view', view.replace('view-', ''));
    var el = $('#' + view);
    el.classList.remove('view-enter'); void el.offsetWidth; el.classList.add('view-enter');
    window.scrollTo(0, 0);
  }

  /** Animasi perpindahan soal: 'next' | 'prev' | 'jump' */
  function animateCard(dir) {
    var c = $('#q-card');
    c.classList.remove('q-anim-next', 'q-anim-prev', 'q-anim-jump');
    void c.offsetWidth;
    c.classList.add('q-anim-' + dir);
  }

  /** Angka nilai naik bertahap (count-up). */
  function countUp(el, target) {
    var t = Number(target) || 0, start = null, dur = 900;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = String(t).replace('.', ','); return; }
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - p, 3);
      var v = t * e;
      el.textContent = (p < 1 ? String(Math.round(v)) : String(t)).replace('.', ',');
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = '0';
    setTimeout(function () { requestAnimationFrame(step); }, 350);
  }

  /* =====================================================
     LANDING
     ===================================================== */
  function applyBrand(c) {
    c = c || {};
    $('#s-logo').innerHTML = U.logoHtml(c.logoUrl);
    $('#s-school').textContent = c.schoolName || '';
    $('#s-app').textContent = c.appName || 'SISTEM UJIAN ONLINE';
    document.title = (c.appName || 'Ujian Online') + (c.schoolName ? ' — ' + c.schoolName : '');
  }

  function initLanding() {
    applyBrand(CFG);
    $('#admin-link').href = 'admin.html';
    var last = store.get('uo_last') || {};
    if (last.nama) $('#f-nama').value = last.nama;
    renderSubjects(last);
    $('#f-mapel').addEventListener('change', function () { onMapel(); });
    $('#f-kelas').addEventListener('change', function () { onKelas(); });
    $('#f-ujian').addEventListener('change', updatePreview);
    $('#start-form').addEventListener('submit', onStart);
    $('#btn-reload').addEventListener('click', refreshBootstrap);
    $('#btn-home').addEventListener('click', goHome);
  }

  /** Mengambil data awal (mapel, kelas, ujian aktif, identitas sekolah) dari API. */
  function loadBootstrap(silent) {
    var be = $('#boot-error');
    return api('getStudentBootstrap').then(function (d) {
      S.boot = d;
      if (d.config) { CFG = d.config; store.set('uo_cfg', d.config); applyBrand(d.config); }
      be.hidden = true;
      renderSubjects(store.get('uo_last') || {});
      if (!silent && !(d.subjects || []).length) toast('Belum ada ujian yang dibuka.', 'warn');
    }, function (e) {
      S.boot.loading = false;
      $('#start-card').hidden = true;
      $('#no-exam').hidden = true;
      be.innerHTML = '<div style="flex:1">' + esc(e.code === 'NETWORK' ? 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.' : errMsg(e)) +
        '</div><button type="button" class="btn btn-sm btn-outline" id="btn-boot-retry">Coba lagi</button>';
      be.style.display = 'flex'; be.style.gap = '10px'; be.style.alignItems = 'center';
      be.hidden = false;
      $('#btn-boot-retry').addEventListener('click', function () {
        var r = U.busy(this, ''); loadBootstrap().then(r, r);
      });
      throw e;
    });
  }

  function refreshBootstrap() {
    var btn = $('#btn-reload');
    var restore = U.busy(btn, 'Memeriksa...');
    return loadBootstrap().then(restore, restore);
  }

  function renderSubjects(last) {
    var subs = S.boot.subjects || [];
    $('#start-card').hidden = !subs.length && !S.boot.loading;
    $('#no-exam').hidden = !!subs.length || !!S.boot.loading;
    var sel = $('#f-mapel');
    if (S.boot.loading) { sel.innerHTML = '<option value="">Memuat...</option>'; return; }
    sel.innerHTML = '<option value="">— Pilih mata pelajaran —</option>' + subs.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.nama) + '</option>';
    }).join('');
    if (subs.length === 1) sel.value = subs[0].id;
    else if (last && last.mapelId && subs.some(function (m) { return m.id === last.mapelId; })) sel.value = last.mapelId;
    onMapel(last && last.kelasId);
  }

  function examsFor(mapelId, kelasId) {
    return (S.boot.exams || []).filter(function (e) {
      return e.mapelId === mapelId && (!kelasId || e.kelasIds.indexOf('ALL') >= 0 || e.kelasIds.indexOf(kelasId) >= 0);
    });
  }

  function onMapel(prefKelas) {
    var mapelId = $('#f-mapel').value;
    var ks = $('#f-kelas');
    var prev = typeof prefKelas === 'string' ? prefKelas : ks.value;
    if (!mapelId) {
      ks.innerHTML = '<option value="">Pilih mata pelajaran dahulu</option>';
      ks.disabled = true;
      updateExamField();
      return;
    }
    var classes = (S.boot.classes || []).filter(function (k) { return examsFor(mapelId, k.id).length > 0; });
    ks.innerHTML = '<option value="">— Pilih kelas —</option>' + classes.map(function (k) {
      return '<option value="' + esc(k.id) + '">' + esc(k.nama) + '</option>';
    }).join('');
    ks.disabled = false;
    if (prev && classes.some(function (k) { return k.id === prev; })) ks.value = prev;
    updateExamField();
  }

  function onKelas() { updateExamField(); }

  function updateExamField() {
    var list = examsFor($('#f-mapel').value, $('#f-kelas').value);
    var fu = $('#fld-ujian'), su = $('#f-ujian');
    if ($('#f-mapel').value && $('#f-kelas').value && list.length > 1) {
      su.innerHTML = list.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.nama) + '</option>'; }).join('');
      fu.hidden = false;
    } else {
      su.innerHTML = list.length === 1 ? '<option value="' + esc(list[0].id) + '">' + esc(list[0].nama) + '</option>' : '';
      fu.hidden = true;
    }
    updatePreview();
  }

  function selectedExam() {
    var id = $('#f-ujian').value;
    var list = examsFor($('#f-mapel').value, $('#f-kelas').value);
    if (!$('#f-kelas').value) return null;
    return list.filter(function (e) { return e.id === id; })[0] || list[0] || null;
  }

  function updatePreview() {
    var ex = selectedExam();
    $('#exam-preview').hidden = !ex;
    if (!ex) return;
    $('#pv-jumlah').textContent = ex.jumlah;
    $('#pv-durasi').textContent = ex.durasi;
    $('#pv-mode').textContent = ex.mode === 'LATIHAN' ? 'Latihan' : 'Ujian';
  }

  function setFieldError(id, on) { $('#' + id).classList.toggle('field-error', !!on); }

  function onStart(ev) {
    ev.preventDefault();
    var errBox = $('#form-error');
    errBox.hidden = true;
    var mapelId = $('#f-mapel').value, kelasId = $('#f-kelas').value;
    var nama = $('#f-nama').value.replace(/\s+/g, ' ').trim();
    var errs = [];
    setFieldError('fld-mapel', !mapelId); if (!mapelId) errs.push('Pilih mata pelajaran.');
    setFieldError('fld-kelas', !kelasId); if (!kelasId) errs.push('Pilih kelas.');
    var badName = nama.length < 3 || !/^[\p{L}\p{M}][\p{L}\p{M}' .\-]*$/u.test(nama);
    setFieldError('fld-nama', badName);
    if (!nama) errs.push('Nama siswa wajib diisi.');
    else if (badName) errs.push('Nama minimal 3 huruf dan hanya berisi huruf, spasi, titik, atau tanda hubung.');
    var ex = selectedExam();
    if (mapelId && kelasId && !ex) errs.push('Tidak ada ujian aktif untuk pilihan ini.');
    if (errs.length) { errBox.textContent = errs[0]; errBox.hidden = false; return; }

    var kelasNama = ($('#f-kelas').selectedOptions[0] || {}).textContent || '';
    var mapelNama = ($('#f-mapel').selectedOptions[0] || {}).textContent || '';
    var rules = ex.mode === 'UJIAN'
      ? '<ul class="rules">' +
        '<li>Jangan keluar dari halaman ini atau membuka aplikasi lain — akan <b>tercatat sebagai pelanggaran</b>.</li>' +
        '<li>Jawaban <b>tersimpan otomatis</b> setiap kali Anda memilih.</li>' +
        '<li>Ujian <b>ditutup otomatis</b> saat waktu habis.</li>' +
        '<li>Gunakan ponsel dalam posisi <b>tegak (portrait)</b>.</li></ul>'
      : '<ul class="rules"><li>Mode latihan: tidak ada pencatatan pelanggaran.</li><li>Jawaban tersimpan otomatis.</li><li>Waktu tetap dibatasi.</li></ul>';
    U.modal({
      title: 'Konfirmasi Mulai Ujian',
      body: '<div class="kv" style="border:1px solid var(--border);border-radius:12px;overflow:hidden">' +
        '<div>Nama</div><div>' + esc(nama) + '</div><div>Kelas</div><div>' + esc(kelasNama) + '</div>' +
        '<div>Mapel</div><div>' + esc(mapelNama) + '</div><div>Ujian</div><div>' + esc(ex.nama) + '</div>' +
        '<div>Soal / Waktu</div><div>' + ex.jumlah + ' soal · ' + ex.durasi + ' menit</div></div>' +
        '<p class="mt-2" style="font-weight:700">Aturan:</p>' + rules,
      actions: [{ label: 'Batal', cls: 'btn-outline', value: false }, { label: 'Mulai Sekarang', cls: 'btn-primary', value: true }]
    }).then(function (ok) {
      if (ok !== true) return;
      if (ex.mode === 'UJIAN') requestFs(); // harus di dalam gestur pengguna
      store.set('uo_last', { mapelId: mapelId, kelasId: kelasId, nama: nama });
      doStart({ mapelId: mapelId, kelasId: kelasId, nama: nama, ujianId: ex.id, device: CFG.collectDevice ? deviceInfo() : null });
    });
  }

  function deviceInfo() {
    var ua = navigator.userAgent || '';
    var dev = /iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' :
      /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : 'Lainnya';
    var br = /EdgA?\/|EdgiOS/.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' :
      /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Lainnya';
    return { browser: br, device: dev };
  }

  function doStart(payload) {
    var hide = U.loading('Menyiapkan soal...');
    var attempt = 0;
    (function go() {
      attempt++;
      U.apiT(45000, 'startExam', payload).then(function (r) {
        hide();
        store.set(K_SID, r.sessionId);
        if (r.resumed) toast('Melanjutkan ujian Anda yang belum selesai.', 'ok');
        loadSession(r.sessionId).catch(function (e) { toast(errMsg(e), 'error'); exitFs(); });
      }, function (e) {
        if ((e.code === 'BUSY' || e.code === 'NETWORK') && attempt < 4) {
          U.loadingText('Server sibuk, mencoba lagi (' + attempt + ')...');
          setTimeout(go, 1500 * attempt);
          return;
        }
        hide();
        exitFs();
        var errBox = $('#form-error');
        errBox.textContent = errMsg(e);
        errBox.hidden = false;
        if (e.code === 'NO_EXAM') refreshBootstrap();
      });
    })();
  }

  function goHome() {
    if (S.sess) clearLocal(S.sess.sessionId);
    S.sess = null;
    show('view-landing');
    refreshBootstrap();
  }

  /* =====================================================
     SESI UJIAN
     ===================================================== */
  /** Memuat sesi. Jika sebelumnya ujian DIJEDA karena koneksi putus (mis. halaman dimuat ulang), klaim jeda ikut dikirim. */
  function loadSession(sid) {
    var hide = U.loading('Memuat soal...');
    var mk = store.get(kPause(sid));
    var opts = mk && mk.at ? { pausedMs: Math.max(0, Date.now() - mk.at), hiddenMs: mk.hidden || 0, pauseStart: mk.atSrv || 0 } : {};
    return U.apiT(45000, 'getExamSession', sid, opts).then(function (d) {
      hide();
      store.del(kPause(sid));
      if (d.final) { clearLocal(sid); showResult(d.result); return; }
      startExamView(d);
      if (d.compensated) toast('Ujian dilanjutkan. Waktu jeda ' + fmtDur(d.compensated) + ' telah dikembalikan.', 'ok', 6000);
    }, function (e) { hide(); throw e; });
  }

  function clearLocal(sid) {
    store.del(K_SID); store.del(kAns(sid)); store.del(kFlag(sid)); store.del(kIdx(sid)); store.del(kPause(sid));
  }

  function persist() {
    if (!S.sess) return;
    store.set(kAns(S.sess.sessionId), { dirty: S.dirty, t: Date.now() });
  }

  function startExamView(d) {
    S.sess = d;
    S.ended = false; S.submitting = false; S.warned5 = false; S.warned1 = false;
    if (S.paused) exitPause();
    NET.downSince = 0;
    S.offset = d.serverNow - Date.now();
    S.answers = {};
    Object.keys(d.answers || {}).forEach(function (k) { S.answers[k] = d.answers[k]; });
    S.dirty = {};
    var valid = {};
    d.questions.forEach(function (q) { valid[q.id] = q; });
    var backup = store.get(kAns(d.sessionId));
    if (backup && backup.dirty) {
      Object.keys(backup.dirty).forEach(function (k) {
        if (valid[k]) { S.answers[k] = backup.dirty[k]; S.dirty[k] = backup.dirty[k]; }
      });
    }
    S.flags = store.get(kFlag(d.sessionId)) || {};
    S.idx = Math.min(Math.max(0, store.get(kIdx(d.sessionId)) || 0), d.questions.length - 1);

    $('#ex-mapel').textContent = d.mapel + (d.mode === 'LATIHAN' ? ' · Latihan' : '');
    $('#ex-who').textContent = d.nama + ' · ' + d.kelas;
    show('view-exam');
    renderQuestion();
    animateCard('jump');
    setSave(Object.keys(S.dirty).length ? 'pending' : 'saved');
    startTimer();
    clearInterval(S.hbTimer);
    S.hbTimer = setInterval(heartbeat, 45000);
    if (d.antiCheat) AC.enable(d); else AC.disable();
    if (Object.keys(S.dirty).length) scheduleSave(300);
  }

  function answeredCount() {
    var n = 0;
    S.sess.questions.forEach(function (q) { if (S.answers[q.id]) n++; });
    return n;
  }

  function renderQuestion() {
    var qs = S.sess.questions, q = qs[S.idx], total = qs.length;
    if (!q) return;
    store.set(kIdx(S.sess.sessionId), S.idx);
    $('#q-no').textContent = 'Soal ' + q.no + ' dari ' + total;
    var tchip = $('#q-type');
    tchip.hidden = q.type !== 'BS';
    tchip.textContent = q.type === 'BS' ? 'Benar / Salah' : '';
    $('#q-text').textContent = q.text;
    var img = U.safeImg(q.img);
    $('#q-img-wrap').innerHTML = img
      ? '<button type="button" class="q-img" data-zoom="' + esc(img) + '" aria-label="Perbesar gambar"><img src="' + esc(img) + '" alt="Gambar soal nomor ' + q.no + '" loading="lazy" referrerpolicy="no-referrer" draggable="false"></button><div class="q-zoomhint">Ketuk gambar untuk memperbesar</div>'
      : '';
    var imgEl = $('#q-img-wrap img');
    if (imgEl) imgEl.addEventListener('error', function () {
      this.parentNode.innerHTML = '<div class="img-err">Gambar tidak dapat dimuat. Periksa koneksi lalu buka soal ini lagi.</div>';
    });
    var sel = S.answers[q.id] || '';
    $('#q-opts').innerHTML = q.opts.map(function (o, i) {
      var on = sel === o.k;
      return '<button type="button" class="opt' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-k="' + esc(o.k) + '">' +
        '<span class="opt-letter">' + LETTERS.charAt(i) + '</span><span class="opt-text">' + esc(o.t) + '</span>' +
        '<svg class="opt-check icon" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></button>';
    }).join('');
    var flag = !!S.flags[q.id];
    var fb = $('#btn-flag');
    fb.classList.toggle('on', flag);
    fb.setAttribute('aria-pressed', String(flag));
    $('#btn-prev').disabled = S.idx === 0;
    var nb = $('#btn-next'), last = S.idx === total - 1;
    nb.className = 'btn ' + (last ? 'btn-success' : 'btn-primary');
    nb.innerHTML = last ? '<svg class="icon" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg><span>SELESAI UJIAN</span>'
      : '<span>Berikutnya</span><svg class="icon" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
    $('#grid-cur').textContent = q.no;
    updateProgress();
  }

  function updateProgress() {
    var n = answeredCount(), total = S.sess.questions.length;
    $('#ex-count').textContent = n + '/' + total + ' dijawab';
    $('#ex-bar').style.width = (total ? Math.round(n / total * 100) : 0) + '%';
  }

  function go(i) {
    if (!S.sess) return;
    var total = S.sess.questions.length;
    var next = Math.max(0, Math.min(total - 1, i));
    if (next === S.idx) return;
    var dir = Math.abs(next - S.idx) > 1 ? 'jump' : (next > S.idx ? 'next' : 'prev');
    S.idx = next;
    renderQuestion();
    animateCard(dir);
    window.scrollTo(0, 0);
  }

  function selectAnswer(k) {
    if (S.ended || S.submitting || S.paused || !S.sess) return;
    var q = S.sess.questions[S.idx];
    if (!q || S.answers[q.id] === k) return;
    S.answers[q.id] = k;
    S.dirty[q.id] = k;
    persist();
    $$('#q-opts .opt').forEach(function (b) {
      var on = b.getAttribute('data-k') === k;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
      b.classList.remove('pop');
      if (on) { void b.offsetWidth; b.classList.add('pop'); }
    });
    updateProgress();
    setSave('pending');
    scheduleSave(1000);
  }

  /* ---------- Autosave (debounce + batch + retry) ---------- */
  function setSave(state) {
    var el = $('#save-state');
    el.className = 'save-state ' + state;
    el.innerHTML = state === 'saved' ? '✓ Jawaban tersimpan' : state === 'saving' ? 'Menyimpan...' :
      state === 'offline' ? '⚠ Offline – akan disimpan' : state === 'pending' ? 'Menyimpan...' : '';
  }

  function scheduleSave(ms) {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flush, ms);
  }

  function flush() {
    if (!S.sess || S.inflight || S.ended || S.submitting || S.paused) return;
    var keys = Object.keys(S.dirty);
    if (!keys.length) return;
    var batch = {};
    keys.forEach(function (k) { batch[k] = S.dirty[k]; });
    S.inflight = true;
    setSave('saving');
    U.apiT(20000, 'saveAnswersBatch', S.sess.sessionId, batch, srvNow()).then(function (res) {
      S.inflight = false;
      S.retry = 0;
      if (S.paused) return;
      keys.forEach(function (k) { if (S.dirty[k] === batch[k]) delete S.dirty[k]; });
      persist();
      sync(res);
      if (S.ended) return;
      if (Object.keys(S.dirty).length) { setSave('pending'); scheduleSave(600); }
      else setSave('saved');
      sendPendingViolations();
    }, function (e) {
      S.inflight = false;
      if (e.code === 'NO_SESSION' || e.code === 'BAD_SESSION') { sessionLost(); return; }
      S.retry++;
      setSave('offline');
      if (S.paused) return;
      scheduleSave(Math.min(30000, 2000 * Math.pow(2, Math.min(S.retry - 1, 4))));
    });
  }

  function heartbeat() {
    if (!S.sess || S.ended || S.submitting || S.paused) return;
    if (Object.keys(S.dirty).length) { flush(); return; }
    if (S.inflight) return;
    S.inflight = true;
    U.apiT(20000, 'saveAnswersBatch', S.sess.sessionId, {}, srvNow()).then(function (res) {
      S.inflight = false;
      if (S.paused) return;
      sync(res);
      sendPendingViolations();
    }, function (e) {
      S.inflight = false;
      if (e.code === 'NO_SESSION' || e.code === 'BAD_SESSION') sessionLost();
    });
  }

  function sync(res) {
    if (!res) return;
    if (res.serverNow) S.offset = res.serverNow - Date.now();
    if (res.deadline) S.sess.deadline = Math.max(S.sess.deadline || 0, res.deadline); // batas waktu hanya bisa maju (jeda)
    if (res.ended) onEnded();
  }

  function sessionLost() {
    S.ended = true;
    cleanup();
    U.modal({
      title: 'Sesi tidak ditemukan', tone: 'danger',
      body: '<p>Sesi ujian Anda tidak ditemukan di server. Silakan hubungi pengawas.</p>',
      actions: [{ label: 'Kembali ke awal', cls: 'btn-primary', value: true }]
    }).then(goHome);
  }

  /* ---------- Timer (acuan waktu server) ---------- */
  function startTimer() {
    clearInterval(S.tickTimer);
    tick();
    S.tickTimer = setInterval(tick, 1000);
  }

  function tick() {
    if (!S.sess || S.ended) return;
    var el = $('#ex-timer');
    if (S.paused) {                       // waktu berhenti selama jeda koneksi
      $('#ex-time').textContent = U.fmtHMS(S.pauseRemain);
      el.classList.add('paused');
      updatePauseOverlay();
      return;
    }
    el.classList.remove('paused');
    if (navigator.onLine === false) netDown();
    var rem = S.sess.deadline - (Date.now() + S.offset);
    $('#ex-time').textContent = U.fmtHMS(rem);
    el.classList.toggle('warn', rem <= 300000 && rem > 60000);
    el.classList.toggle('danger', rem <= 60000);
    if (rem <= 300000 && !S.warned5 && rem > 60000) { S.warned5 = true; toast('Sisa waktu 5 menit. Periksa kembali jawaban Anda.', 'warn', 5000); }
    if (rem <= 60000 && !S.warned1 && rem > 0) { S.warned1 = true; toast('Sisa waktu 1 menit!', 'warn', 5000); }
    if (rem <= 0 && !S.submitting) {
      // Waktu habis tepat saat koneksi diduga putus (belum terkonfirmasi) → jeda dulu, bukan dikumpulkan
      if (NET.downSince && canPause()) { enterPause(NET.downSince); return; }
      doSubmit('timeout');
    }
  }

  function cleanup() {
    clearInterval(S.tickTimer);
    clearInterval(S.hbTimer);
    clearTimeout(S.saveTimer);
    if (S.paused) exitPause();
    clearTimeout(NET.checkT);
    NET.downSince = 0;
    AC.disable();
  }

  function onEnded() {
    if (S.submitting) return;
    S.ended = true;
    var sid = S.sess.sessionId;
    cleanup();
    var hide = U.loading('Memuat hasil...');
    api('getStudentResult', sid).then(function (r) {
      hide(); clearLocal(sid); showResult(r);
    }, function (e) {
      hide();
      U.modal({ title: 'Ujian telah ditutup', body: '<p>' + esc(errMsg(e)) + '</p>', actions: [{ label: 'Coba lagi', cls: 'btn-primary', value: true }] })
        .then(function () { S.submitting = false; onEnded(); });
    });
  }

  /* ---------- Submit ---------- */
  function finishManual() {
    if (S.ended || S.submitting || S.paused) return;
    var total = S.sess.questions.length, n = answeredCount();
    var flagged = S.sess.questions.filter(function (q) { return S.flags[q.id]; }).length;
    U.modal({
      title: 'Selesaikan ujian?',
      body: '<p>Apakah Anda yakin ingin menyelesaikan ujian?</p>' +
        '<div class="nav-summary"><div><b style="color:var(--ok)">' + n + '</b><span>Soal dijawab</span></div>' +
        '<div><b style="color:var(--danger)">' + (total - n) + '</b><span>Belum dijawab</span></div>' +
        '<div><b style="color:var(--warn)">' + flagged + '</b><span>Ragu-ragu</span></div></div>' +
        (total - n > 0 ? '<div class="notice notice-warn mt-2">Masih ada ' + (total - n) + ' soal yang belum dijawab.</div>' : '') +
        '<p class="muted small mt-2">Setelah diselesaikan, jawaban tidak dapat diubah lagi.</p>',
      actions: [{ label: 'KEMBALI', cls: 'btn-outline', value: false }, { label: 'SELESAIKAN UJIAN', cls: 'btn-success', value: true }]
    }).then(function (v) { if (v === true) doSubmit('manual'); });
  }

  function doSubmit(reason) {
    if (S.submitting || S.ended || !S.sess) return;
    S.submitting = true;
    clearTimeout(S.saveTimer);
    var sid = S.sess.sessionId;
    // Simpan seluruh jawaban sebagai cadangan lokal sampai server mengonfirmasi
    store.set(kAns(sid), { dirty: S.answers, t: Date.now() });
    AC.pause = true;
    var hide = U.loading(reason === 'timeout' ? 'Waktu habis. Mengirim jawaban...' : 'Menghitung nilai...');
    var attempt = 0;
    (function send() {
      attempt++;
      U.apiT(45000, 'submitExam', sid, S.answers, reason).then(function (r) {
        hide();
        S.ended = true;
        cleanup();
        clearLocal(sid);
        showResult(r);
      }, function (e) {
        if (e.code === 'NETWORK' || e.code === 'BUSY' || e.code === 'SERVER') {
          U.loadingText('Koneksi bermasalah. Jawaban Anda aman. Mengirim ulang (' + attempt + ')...');
          setTimeout(send, Math.min(15000, 2000 * attempt));
          return;
        }
        hide();
        S.submitting = false;
        AC.pause = false;
        if (e.code === 'NO_SESSION' || e.code === 'BAD_SESSION') { sessionLost(); return; }
        toast(errMsg(e), 'error');
      });
    })();
  }

  /* =====================================================
     HASIL
     ===================================================== */
  function showResult(r) {
    cleanup();
    exitFs();
    show('view-result');
    var blocked = r.status === 'BLOCKED';
    var ic = $('#r-icon');
    ic.classList.toggle('blocked', blocked);
    ic.innerHTML = blocked ? U.icon('alert') : U.icon('check');
    $('#r-title').textContent = blocked ? 'UJIAN DIHENTIKAN' : 'UJIAN SELESAI';
    $('#r-status').textContent = (r.statusLabel || '') + (r.mode === 'LATIHAN' ? ' · Mode Latihan' : '');
    var kv = [['Nama', r.nama], ['Kelas', r.kelas], ['Mata Pelajaran', r.mapel], ['Ujian', r.ujian]];
    if (r.showScore) kv.push(['Jumlah Soal', r.total]);
    $('#r-kv').innerHTML = kv.map(function (p) { return '<div>' + esc(p[0]) + '</div><div>' + esc(p[1]) + '</div>'; }).join('');
    $('#r-score-wrap').hidden = !r.showScore;
    $('#r-trio').hidden = !r.showScore;
    if (r.showScore) {
      countUp($('#r-score'), r.score);
      $('#r-benar').textContent = r.correct;
      $('#r-salah').textContent = r.wrong;
      $('#r-kosong').textContent = r.unanswered;
      $('#r-lulus').innerHTML = r.lulus ? '<span class="chip chip-ok">LULUS · KKM ' + esc(r.kkm) + '</span>' : '<span class="chip chip-warn">BELUM LULUS · KKM ' + esc(r.kkm) + '</span>';
    }
    var msg = $('#r-message');
    msg.className = 'notice' + (blocked ? ' notice-danger' : '');
    msg.textContent = r.message || (r.showScore ? '' : 'Jawaban Anda telah tersimpan. Nilai akan diumumkan oleh guru.');
    msg.hidden = !msg.textContent;
    var rc = $('#r-review-card');
    rc.hidden = !(r.showReview && r.review && r.review.length);
    if (!rc.hidden) {
      $('#r-review').innerHTML = r.review.map(function (it) {
        var img = U.safeImg(it.img);
        return '<div class="review-item"><div class="row"><b>Soal ' + it.no + '</b>' +
          (it.ok ? '<span class="chip chip-ok">Benar</span>' : it.your ? '<span class="chip chip-danger">Salah</span>' : '<span class="chip">Tidak dijawab</span>') + '</div>' +
          '<div class="q-text mt-1" style="font-size:.97rem">' + esc(it.text) + '</div>' +
          (img ? '<img src="' + esc(img) + '" alt="" style="max-height:200px;margin-top:8px;border-radius:8px" referrerpolicy="no-referrer">' : '') +
          it.opts.map(function (o, i) {
            var cls = o.k === it.correct ? 'correct' : (o.k === it.your ? 'wrong' : '');
            return '<div class="rv-opt ' + cls + '"><b>' + LETTERS.charAt(i) + '.</b><span style="flex:1">' + esc(o.t) + '</span>' +
              (o.k === it.your ? '<span class="tiny">(jawaban Anda)</span>' : '') + '</div>';
          }).join('') +
          (it.bahas ? '<div class="rv-bahas"><b>Pembahasan:</b> ' + esc(it.bahas) + '</div>' : '') + '</div>';
      }).join('');
    }
    S.sess = null;
  }

  /* =====================================================
     NAVIGASI & PANEL NOMOR
     ===================================================== */
  function openGrid() {
    if (!S.sess) return;
    var qs = S.sess.questions, n = answeredCount();
    var flagged = qs.filter(function (q) { return S.flags[q.id]; }).length;
    U.modal({
      title: 'Daftar Soal',
      body: '<div class="nav-legend"><span><i class="lg-box lg-ans">✓</i>Sudah dijawab</span><span><i class="lg-box"></i>Belum dijawab</span>' +
        '<span><i class="lg-box lg-cur"></i>Soal aktif</span><span><i class="lg-box lg-flag">?</i>Ragu-ragu</span></div>' +
        '<div class="nav-grid">' + qs.map(function (q, i) {
          var cls = (S.answers[q.id] ? ' ans' : '') + (i === S.idx ? ' cur' : '') + (S.flags[q.id] ? ' flag' : '');
          var lbl = 'Soal ' + q.no + (S.answers[q.id] ? ', sudah dijawab' : ', belum dijawab') + (S.flags[q.id] ? ', ragu-ragu' : '');
          return '<button type="button" class="nav-num' + cls + '" data-go="' + i + '" aria-label="' + lbl + '">' + q.no + '</button>';
        }).join('') + '</div>' +
        '<div class="nav-summary"><div><b>' + n + '</b><span>Dijawab</span></div><div><b>' + (qs.length - n) + '</b><span>Belum</span></div><div><b>' + flagged + '</b><span>Ragu-ragu</span></div></div>',
      actions: [{ label: 'Tutup', cls: 'btn-outline', value: false }, { label: 'Selesai Ujian', cls: 'btn-success', value: 'finish' }],
      onOpen: function (wrap) {
        wrap.addEventListener('click', function (e) {
          var b = e.target.closest('[data-go]');
          if (!b) return;
          go(+b.getAttribute('data-go'));
          var c = wrap.querySelector('[data-close]');
          if (c) c.click();
        });
      }
    }).then(function (v) { if (v === 'finish') finishManual(); });
  }

  function bindExamUi() {
    $('#q-opts').addEventListener('click', function (e) {
      var b = e.target.closest('.opt');
      if (b) selectAnswer(b.getAttribute('data-k'));
    });
    $('#btn-prev').addEventListener('click', function () { go(S.idx - 1); });
    $('#btn-next').addEventListener('click', function () {
      if (!S.sess) return;
      if (S.idx >= S.sess.questions.length - 1) finishManual(); else go(S.idx + 1);
    });
    $('#btn-grid').addEventListener('click', openGrid);
    $('#btn-flag').addEventListener('click', function () {
      if (!S.sess) return;
      var q = S.sess.questions[S.idx];
      if (S.flags[q.id]) delete S.flags[q.id]; else S.flags[q.id] = 1;
      store.set(kFlag(S.sess.sessionId), S.flags);
      renderQuestion();
    });
    $('#q-img-wrap').addEventListener('click', function (e) {
      var b = e.target.closest('[data-zoom]');
      if (b) zoomImage(b.getAttribute('data-zoom'));
    });
    $('#btn-fs').addEventListener('click', requestFs);
    document.addEventListener('keydown', function (e) {
      if (!S.sess || S.ended || document.querySelector('.modal-wrap')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') go(S.idx + 1);
      else if (e.key === 'ArrowLeft') go(S.idx - 1);
      else if (/^[a-eA-E]$/.test(e.key)) {
        var q = S.sess.questions[S.idx], i = 'abcde'.indexOf(e.key.toLowerCase());
        if (q.opts[i]) selectAnswer(q.opts[i].k);
      }
    });
    window.addEventListener('online', function () {
      if (!S.sess || S.ended) return;
      if (S.paused) { probeNow(); return; }
      NET.downSince = 0; flush(); heartbeat(); sendPendingViolations();
    });
    window.addEventListener('offline', function () { if (S.sess && !S.ended) { setSave('offline'); netDown(); } });
    document.addEventListener('visibilitychange', onPauseVisibility);
    window.addEventListener('blur', onPauseBlur);
    window.addEventListener('focus', onPauseFocus);
    $('#pz-retry').addEventListener('click', function () { probeNow(true); });
    U.onNet(function (ok, err) {
      if (!S.sess || S.ended) return;
      if (ok) { if (!S.paused) NET.downSince = 0; }
      else if (err && err.code === 'NETWORK') netDown();
    });
    window.addEventListener('beforeunload', function (e) {
      if (S.sess && !S.ended) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function zoomImage(src) {
    var w = document.createElement('div');
    w.className = 'zoom-wrap';
    w.innerHTML = '<button type="button" class="btn btn-icon zoom-close" aria-label="Tutup">' + U.icon('x') + '</button><img src="' + esc(src) + '" alt="Gambar soal diperbesar" referrerpolicy="no-referrer">';
    w.addEventListener('click', function () { w.remove(); });
    document.body.appendChild(w);
  }

  /* =====================================================
     ANTI-CHEATING (realistis untuk browser)
     Catatan: browser TIDAK dapat mengunci ponsel, mencegah screenshot,
     atau mencegah perangkat kedua. Yang dilakukan: deteksi, peringatan, pencatatan.
     ===================================================== */
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported() {
    var d = document.documentElement;
    return !!((d.requestFullscreen || d.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
  }
  function requestFs() {
    try {
      if (!fsSupported() || fsEl()) return;
      var d = document.documentElement;
      var p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen();
      if (p && p.catch) p.catch(function () { /* ditolak browser — diabaikan */ });
    } catch (e) { /* tidak didukung */ }
  }
  function exitFs() {
    try { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* noop */ }
  }

  var AC = { on: false, fsEntered: false, hiddenAt: 0, blurT: null, blurAt: 0, pause: false, warnOpen: false, pending: [], sess: null };

  var VMSG = {
    TAB_HIDDEN: 'Anda meninggalkan halaman ujian.',
    FOCUS_LOST: 'Halaman ujian kehilangan fokus (membuka aplikasi atau jendela lain).',
    FULLSCREEN_EXIT: 'Anda keluar dari mode layar penuh.',
    SCREENSHOT_KEY: 'Tombol Print Screen terdeteksi.'
  };

  function onVisibility() {
    if (S.paused) { AC.hiddenAt = 0; return; }   // selama jeda: dicatat terpisah (lihat onPauseVisibility)
    if (document.hidden) { AC.hiddenAt = Date.now(); return; }
    if (AC.hiddenAt) {
      var secs = Math.round((Date.now() - AC.hiddenAt) / 1000);
      AC.hiddenAt = 0;
      report('TAB_HIDDEN', 'Kembali setelah ' + secs + ' detik');
    }
    if (S.sess && !S.ended) { tick(); heartbeat(); }
  }
  function onBlur() {
    if (document.hidden || S.paused) return;
    clearTimeout(AC.blurT);
    AC.blurT = setTimeout(function () {
      if (!document.hidden && !document.hasFocus()) AC.blurAt = Date.now() - 2500;
    }, 2500);
  }
  function onFocus() {
    clearTimeout(AC.blurT);
    if (S.paused) { AC.blurAt = 0; return; }
    if (AC.blurAt) {
      var secs = Math.round((Date.now() - AC.blurAt) / 1000);
      AC.blurAt = 0;
      if (!AC.hiddenAt) report('FOCUS_LOST', 'Fokus hilang ±' + secs + ' detik');
    }
  }
  function onFsChange() {
    if (fsEl()) { AC.fsEntered = true; updateFsBanner(); return; }
    if (AC.fsEntered && AC.on && !S.paused) report('FULLSCREEN_EXIT', '');
    updateFsBanner();
  }
  function block(e) {
    if (!AC.on) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (e.type === 'copy' || e.type === 'cut' || e.type === 'paste') {
      report('COPY_ATTEMPT', e.type);
      toast('Menyalin dan menempel tidak diizinkan selama ujian.', 'warn');
    }
  }
  function onKey(e) {
    if (!AC.on) return;
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'v', 'a', 'p', 's', 'u'].indexOf(k) >= 0) {
      e.preventDefault();
      report(['c', 'x', 'v'].indexOf(k) >= 0 ? 'COPY_ATTEMPT' : 'DEVTOOLS_KEY', 'Ctrl+' + k.toUpperCase());
    }
    if (k === 'f12' || ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].indexOf(k) >= 0)) {
      e.preventDefault();
      report('DEVTOOLS_KEY', k.toUpperCase());
    }
  }
  function onKeyUp(e) {
    if (AC.on && (e.key === 'PrintScreen' || e.keyCode === 44)) report('SCREENSHOT_KEY', '');
  }

  var EVENTS = [
    [document, 'visibilitychange', onVisibility], [window, 'blur', onBlur], [window, 'focus', onFocus],
    [document, 'fullscreenchange', onFsChange], [document, 'webkitfullscreenchange', onFsChange],
    [document, 'contextmenu', block], [document, 'copy', block], [document, 'cut', block], [document, 'paste', block],
    [document, 'selectstart', block], [document, 'dragstart', block], [document, 'keydown', onKey], [document, 'keyup', onKeyUp]
  ];

  AC.enable = function (sess) {
    AC.sess = sess;
    AC.pause = false;
    if (AC.on) { updateFsBanner(); return; }
    AC.on = true;
    AC.fsEntered = !!fsEl();
    document.body.classList.add('exam-lock');
    EVENTS.forEach(function (ev) { ev[0].addEventListener(ev[1], ev[2]); });
    updateFsBanner();
  };
  AC.disable = function () {
    if (!AC.on) { $('#fs-banner').hidden = true; return; }
    AC.on = false;
    clearTimeout(AC.blurT);
    document.body.classList.remove('exam-lock');
    EVENTS.forEach(function (ev) { ev[0].removeEventListener(ev[1], ev[2]); });
    $('#fs-banner').hidden = true;
  };

  function updateFsBanner() {
    $('#fs-banner').hidden = !(AC.on && fsSupported() && !fsEl());
  }

  function report(type, detail) {
    if (!AC.on || AC.pause || S.paused || !S.sess || S.ended || S.submitting) return;
    var sid = S.sess.sessionId;
    api('logViolation', sid, type, detail || '', srvNow()).then(function (r) { handleViolation(type, r); }, function () {
      if (VMSG[type]) {
        AC.pending.push([type, detail]);
        warn(type, { count: (S.sess.vc || 0) + AC.pending.length, max: S.sess.maxViolations, autoStop: S.sess.autoStop });
      }
    });
  }

  function sendPendingViolations() {
    if (!AC.pending.length || !S.sess || S.ended || S.paused) return;
    var list = AC.pending.splice(0);
    list.forEach(function (p, i) {
      setTimeout(function () {
        if (!S.sess || S.ended || S.paused) { if (S.sess && !S.ended) AC.pending.push(p); return; }
        api('logViolation', S.sess.sessionId, p[0], (p[1] || '') + ' (tertunda/offline)', srvNow()).then(function (r) {
          if (r.blocked) handleViolation(p[0], r);
          else if (S.sess) S.sess.vc = r.count;
        }, function () { AC.pending.push(p); });
      }, i * 4500); // jeda agar tidak dianggap duplikat oleh server
    });
  }

  function handleViolation(type, r) {
    if (!r || r.throttled || !S.sess) return;
    S.sess.vc = r.count;
    if (r.blocked) {
      S.ended = true;
      var sid = S.sess.sessionId;
      cleanup();
      clearLocal(sid);
      U.modal({
        title: 'UJIAN DIHENTIKAN', tone: 'danger', dismissible: false,
        body: '<p>Jumlah pelanggaran Anda mencapai batas (' + r.max + '). Ujian dihentikan otomatis dan jawaban yang sudah tersimpan telah dinilai.</p>',
        actions: [{ label: 'Lihat hasil', cls: 'btn-danger', value: true }]
      }).then(function () { showResult(r.result); });
      return;
    }
    if (VMSG[type]) warn(type, r);
  }

  function warn(type, r) {
    if (AC.warnOpen) { toast('PERINGATAN: ' + VMSG[type], 'error'); return; }
    var n = r.count, max = r.max;
    var title, body, tone = 'warn';
    if (n <= 1) {
      title = 'PERINGATAN';
      body = '<p><b>' + esc(VMSG[type]) + '</b></p><p class="mt-1">Kejadian ini tercatat sebagai pelanggaran ke-1. Tetap berada di halaman ujian sampai selesai.</p>';
    } else if (n === 2) {
      title = 'PERINGATAN KERAS'; tone = 'danger';
      body = '<p><b>' + esc(VMSG[type]) + '</b></p><p class="mt-1">Ini pelanggaran ke-2 dan telah dilaporkan ke pengawas.' +
        (r.autoStop ? ' <b>Jika mencapai ' + max + ' pelanggaran, ujian Anda akan dihentikan otomatis.</b>' : '') + '</p>';
    } else {
      title = 'PELANGGARAN BERULANG'; tone = 'danger';
      body = '<p><b>' + esc(VMSG[type]) + '</b></p><p class="mt-1">Tercatat ' + n + ' pelanggaran. Pengawas dapat melihat seluruh catatan ini.</p>';
    }
    AC.warnOpen = true;
    U.modal({ title: title, tone: tone, body: body, actions: [{ label: 'Saya mengerti, lanjutkan', cls: tone === 'danger' ? 'btn-danger' : 'btn-primary', value: true }] })
      .then(function () { AC.warnOpen = false; });
  }

  /* =====================================================
     JEDA OTOMATIS SAAT KONEKSI INTERNET TERPUTUS
     - Koneksi putus (event offline / request gagal karena jaringan, dipastikan dengan ping)
       → ujian DIJEDA: soal disembunyikan, timer berhenti, jawaban tetap aman di HP.
     - Saat internet kembali → resumeExam(sid, lamaJeda) → server menggeser batas waktu
       sebesar lama jeda → siswa lanjut dengan soal & sisa waktu yang sama.
     - Waktu ketika halaman ditinggalkan (membuka aplikasi lain) selama jeda tidak dikembalikan.
     ===================================================== */
  var NET = { downSince: 0, checkT: null, probeT: null, probing: false, resuming: false, pauseAt: 0, pauseAtSrv: 0, hiddenAt: 0, hiddenMs: 0, blurAt: 0 };
  var PAUSE_CONFIRM_MS = 4000;   // gangguan < 4 detik tidak menjeda ujian
  var PROBE_EVERY_MS = 4000;

  function fmtDur(ms) {
    var t = Math.round(ms / 1000), m = Math.floor(t / 60), d = t % 60;
    return (m ? m + ' menit ' : '') + d + ' detik';
  }
  function canPause() { return !!(S.sess && !S.ended && !S.submitting && !S.paused && S.sess.pauseEnabled !== false); }

  /** Dipanggil saat ada tanda jaringan putus. Ujian dijeda bila kondisi ini bertahan. */
  function netDown() {
    if (!canPause()) return;
    if (!NET.downSince) NET.downSince = Date.now();
    if (NET.checkT) return;
    var wait = Math.max(0, PAUSE_CONFIRM_MS - (Date.now() - NET.downSince));
    NET.checkT = setTimeout(confirmDown, wait);
  }

  function confirmDown() {
    NET.checkT = null;
    if (!canPause() || !NET.downSince) return;
    var since = NET.downSince;
    if (navigator.onLine === false) { enterPause(since); return; }
    U.apiDirect('ping', [], 6000).then(function () {
      NET.downSince = 0;                      // hanya gangguan sesaat
      if (Object.keys(S.dirty).length) scheduleSave(300);
    }, function (e) {
      if (e.code === 'NETWORK' && NET.downSince) enterPause(since); else NET.downSince = 0;
    });
  }

  function enterPause(since) {
    if (!canPause()) return;
    // Pelanggaran yang sudah terjadi SEBELUM jeda tetap dicatat (dikirim setelah tersambung)
    if (AC.on && AC.hiddenAt) AC.pending.push(['TAB_HIDDEN', 'Meninggalkan halaman ' + Math.round((Date.now() - AC.hiddenAt) / 1000) + ' detik sebelum koneksi terputus']);
    else if (AC.on && AC.blurAt) AC.pending.push(['FOCUS_LOST', 'Fokus hilang sebelum koneksi terputus']);
    S.paused = true;
    U.hold(true);                         // tahan & batalkan request lain sampai ujian dilanjutkan
    NET.pauseAt = since;
    NET.pauseAtSrv = since + (S.offset || 0);
    NET.hiddenMs = 0; NET.blurAt = 0;
    NET.hiddenAt = document.hidden ? Date.now() : 0;
    S.pauseRemain = Math.max(0, S.sess.deadline - (since + S.offset));
    store.set(kPause(S.sess.sessionId), { at: since, atSrv: NET.pauseAtSrv, remain: S.pauseRemain, hidden: 0 });
    clearTimeout(S.saveTimer);
    S.inflight = false;
    AC.hiddenAt = 0; AC.blurAt = 0; clearTimeout(AC.blurT);
    U.$$('.zoom-wrap').forEach(function (z) { z.remove(); });
    document.body.classList.add('net-paused');
    $('#pz-hidden-tip').hidden = !(S.sess && S.sess.antiCheat);
    $('#pause-ov').hidden = false;
    setPauseStatus('wait');
    setSave('offline');
    tick();
    scheduleProbe(PROBE_EVERY_MS);
  }

  function exitPause() {
    S.paused = false;
    U.hold(false);
    NET.downSince = 0; NET.resuming = false; NET.probing = false;
    clearTimeout(NET.probeT); clearTimeout(NET.checkT); NET.checkT = null;
    document.body.classList.remove('net-paused');
    $('#pause-ov').hidden = true;
    $('#ex-timer').classList.remove('paused');
    AC.hiddenAt = 0; AC.blurAt = 0;
  }

  function hiddenTotal() {
    return NET.hiddenMs + (NET.hiddenAt ? Date.now() - NET.hiddenAt : 0) + (NET.blurAt ? Date.now() - NET.blurAt : 0);
  }

  function setPauseStatus(st) {
    var el = $('#pz-status');
    el.className = 'pause-status ' + st;
    el.innerHTML = st === 'ok' ? U.icon('check') + '<span>Tersambung. Melanjutkan ujian…</span>'
      : st === 'retry' ? '<span class="spin"></span><span>Belum tersambung. Mencoba lagi…</span>'
      : '<span class="spin"></span><span>Mencoba menyambung kembali…</span>';
  }

  function updatePauseOverlay() {
    if (!S.paused) return;
    $('#pz-remain').textContent = U.fmtHMS(S.pauseRemain);
    var el = Math.max(0, Date.now() - NET.pauseAt), sec = Math.floor(el / 1000);
    $('#pz-elapsed').textContent = (sec >= 3600 ? U.pad(Math.floor(sec / 3600)) + ':' : '') + U.pad(Math.floor(sec % 3600 / 60)) + ':' + U.pad(sec % 60);
    var left = S.sess && S.sess.pauseLeft ? S.sess.pauseLeft - el : null;
    $('#pz-left').textContent = left !== null && left < 5 * 60000
      ? (left > 0 ? 'Batas jeda tersisa ' + Math.ceil(left / 60000) + ' menit' : 'Batas jeda terlampaui') : '';
    var mk = store.get(kPause(S.sess.sessionId));
    if (mk) { mk.hidden = hiddenTotal(); store.set(kPause(S.sess.sessionId), mk); }
  }

  function scheduleProbe(ms) {
    clearTimeout(NET.probeT);
    NET.probeT = setTimeout(function () { probeNow(); }, ms);
  }

  /** Cek apakah server sudah terjangkau; bila ya → lanjutkan ujian. Hanya saat halaman terlihat. */
  function probeNow(manual) {
    if (!S.paused || NET.probing || NET.resuming) return;
    if (document.hidden) { scheduleProbe(PROBE_EVERY_MS); return; }
    if (navigator.onLine === false && !manual) { setPauseStatus('wait'); scheduleProbe(PROBE_EVERY_MS); return; }
    NET.probing = true;
    U.apiDirect('ping', [], 8000).then(function () {
      NET.probing = false;
      resumeAfterPause();
    }, function () {
      NET.probing = false;
      setPauseStatus('retry');
      scheduleProbe(PROBE_EVERY_MS);
    });
  }

  function resumeAfterPause() {
    if (!S.paused || NET.resuming || !S.sess) return;
    NET.resuming = true;
    setPauseStatus('ok');
    var sid = S.sess.sessionId;
    var pausedMs = Math.max(0, Date.now() - NET.pauseAt);
    var hidden = hiddenTotal();
    var batch = {};
    Object.keys(S.dirty).forEach(function (k) { batch[k] = S.dirty[k]; });
    U.apiDirect('resumeExam', [sid, pausedMs, batch, hidden, NET.pauseAtSrv || 0], 30000).then(function (r) {
      NET.resuming = false;
      store.del(kPause(sid));
      Object.keys(batch).forEach(function (k) { if (S.dirty[k] === batch[k]) delete S.dirty[k]; });
      persist();
      if (r.ended) {
        exitPause();
        S.ended = true;
        cleanup(); clearLocal(sid);
        toast('Koneksi kembali, tetapi ujian sudah ditutup.', 'warn', 6000);
        showResult(r.result);
        return;
      }
      S.offset = r.serverNow - Date.now();
      S.sess.deadline = r.deadline;
      if (typeof r.vc === 'number') S.sess.vc = r.vc;
      if (typeof r.pauseLeft === 'number') S.sess.pauseLeft = r.pauseLeft;
      exitPause();
      tick();
      setSave(Object.keys(S.dirty).length ? 'pending' : 'saved');
      if (Object.keys(S.dirty).length) scheduleSave(300);
      toast('Koneksi kembali. Ujian dilanjutkan' + (r.compensated ? ' — waktu jeda ' + fmtDur(r.compensated) + ' dikembalikan.' : '.'), 'ok', 6000);
      setTimeout(sendPendingViolations, 1500);
    }, function (e) {
      NET.resuming = false;
      if (e.code === 'NO_SESSION' || e.code === 'BAD_SESSION') { exitPause(); sessionLost(); return; }
      setPauseStatus('retry');
      scheduleProbe(PROBE_EVERY_MS);
    });
  }

  /** Lama halaman ditinggalkan selama jeda (membuka aplikasi/jendela lain) — tidak dikembalikan sebagai waktu. */
  function onPauseVisibility() {
    if (!S.paused) return;
    if (document.hidden) {
      if (NET.blurAt) { NET.hiddenMs += Date.now() - NET.blurAt; NET.blurAt = 0; }
      if (!NET.hiddenAt) NET.hiddenAt = Date.now();
      return;
    }
    if (NET.hiddenAt) { NET.hiddenMs += Date.now() - NET.hiddenAt; NET.hiddenAt = 0; }
    probeNow();
  }
  /** Jendela lain aktif (laptop/Chromebook) selama jeda; > 3 detik dihitung sebagai meninggalkan halaman. */
  var pauseBlurT = null;
  function onPauseBlur() {
    if (!S.paused || document.hidden) return;
    clearTimeout(pauseBlurT);
    pauseBlurT = setTimeout(function () { if (S.paused && !document.hidden && !document.hasFocus() && !NET.blurAt) NET.blurAt = Date.now() - 3000; }, 3000);
  }
  function onPauseFocus() {
    clearTimeout(pauseBlurT);
    if (NET.blurAt) { NET.hiddenMs += Date.now() - NET.blurAt; NET.blurAt = 0; }
  }

  /* =====================================================
     START
     ===================================================== */
  function boot() {
    initLanding();
    $('#view-landing').classList.add('view-enter');
    bindExamUi();
    renderSubjects({});
    loadBootstrap(true).catch(function () { /* pesan sudah ditampilkan */ });
    var sid = store.get(K_SID);
    if (sid) resumeStored(sid);
  }

  /** Melanjutkan sesi yang tersimpan di HP (setelah halaman dimuat ulang / browser ditutup). */
  function resumeStored(sid) {
    loadSession(sid).catch(function (e) {
      if (e.code === 'BAD_SESSION' || e.code === 'NO_SESSION') { clearLocal(sid); return; }
      var paused = !!store.get(kPause(sid));
      var rb = $('#resume-box');
      rb.className = 'card resume-card';
      rb.innerHTML = '<div style="flex:1"><b>' + (paused ? 'Ujian Anda sedang dijeda' : 'Ujian Anda belum selesai') + '</b><div class="small muted">' +
        (paused ? 'Koneksi internet terputus. Waktu tidak berkurang. Ujian dilanjutkan otomatis saat internet kembali.' : 'Koneksi terputus saat memuat. Ketuk untuk melanjutkan.') +
        '</div></div><button type="button" class="btn btn-primary btn-sm" id="btn-resume">Lanjutkan</button>';
      rb.hidden = false;
      function retry() {
        window.removeEventListener('online', retry);
        loadSession(sid).then(function () { rb.hidden = true; }, function (er) {
          if (er.code === 'NETWORK') window.addEventListener('online', retry);
          toast(errMsg(er), 'error');
        });
      }
      $('#btn-resume').addEventListener('click', retry);
      window.addEventListener('online', retry);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
