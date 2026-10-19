/* Teacher panel (Turkish UI). Kept separate from the children's screens. */
window.MP = window.MP || {};

(function () {
  const ui = MP.ui, h = ui.h, st = MP.store;
  const T = { tab: 'students', classId: null, selected: new Set(), historyStudent: '' };
  const root = function () { return document.getElementById('teacher'); };
  const app = function () { return MP.app; };

  /* ---------- PIN (local only, NOT real security) ---------- */
  async function hashPin(pin, salt) {
    const text = salt + ':' + pin;
    try {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return 'sha256:' + Array.from(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
    } catch (_) { /* fall through */ }
    let x = 2166136261;
    for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
    return 'fnv:' + x.toString(16);
  }

  function pinPad(title, sub) {
    return new Promise(function (resolve) {
      let val = '', done = false;
      const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
      const draw = function () { dots.replaceChildren.apply(dots, [0, 1, 2, 3, 4, 5].map(function (i) { return h('span', { class: i < val.length ? 'on' : '' }); })); };
      draw();
      const ok = h('button', { class: 'tbtn primary' }, 'Tamam');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map(function (k) {
        return h('button', {
          type: 'button', 'aria-label': k === '⌫' ? 'Sil' : k === '✓' ? 'Tamam' : k, onclick: function () {
            if (k === '⌫') val = val.slice(0, -1);
            else if (k === '✓') { finish(); return; }
            else if (val.length < 6) val += k;
            draw();
          }
        }, k);
      });
      function finish() { if (val.length < 4) { ui.toast('PIN en az 4 haneli olmalı.', 'error'); return; } done = true; m.close(); resolve(val); }
      ok.onclick = finish;
      const m = ui.modal(h('div', { class: 'center' },
        h('h2', null, title), sub ? h('p', null, sub) : null, dots, h('div', { class: 'pin-pad' }, keys),
        h('div', { class: 'actions' }, h('button', { class: 'tbtn', onclick: function () { m.close(); } }, 'Vazgeç'), ok)),
      { onClose: function () { if (!done) resolve(null); } });
      function onKey(e) {
        if (!m.el.isConnected) { document.removeEventListener('keydown', onKey); return; }
        if (/^[0-9]$/.test(e.key) && val.length < 6) { val += e.key; draw(); }
        else if (e.key === 'Backspace') { val = val.slice(0, -1); draw(); }
        else if (e.key === 'Enter') finish();
      }
      document.addEventListener('keydown', onKey);
    });
  }

  async function open() {
    const s = app().state;
    if (!s.teacher && s.settings.pin) {
      const pin = await pinPad('Öğretmen PIN', 'Öğretmen araçlarını açmak için PIN girin.');
      if (pin == null) return;
      const hsh = await hashPin(pin, s.settings.pin.salt);
      if (hsh !== s.settings.pin.hash) { MP.sound.play('error'); ui.toast('PIN yanlış.', 'error'); return; }
    }
    if (!s.teacher) app().setTeacher(true);
    T.classId = s.classId || T.classId;
    root().hidden = false;
    document.body.style.overflow = 'hidden';
    await render();
  }

  function close() {
    root().hidden = true;
    document.body.style.overflow = '';
    T.selected.clear();
    app().route();
  }

  /* ---------- helpers ---------- */
  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) ui.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok');
      await render();
      return r;
    } catch (e) {
      console.error(e);
      ui.toast('Kaydedilemedi: ' + trError(e), 'error', 8000);
      await render();
      throw e;
    }
  }
  function trError(e) {
    const map = {
      DUPLICATE_CLASS: 'Bu isimde bir sınıf zaten var.', BAD_VALUE: 'Geçersiz değer.', NO_CLASS: 'Sınıf bulunamadı.',
      NO_STUDENT: 'Öğrenci bulunamadı.', ARCHIVED: 'Arşivlenmiş öğrenciye yıldız verilemez.', NOTHING_TO_UNDO: 'Geri alınacak işlem yok.',
      CANNOT_UNDO: 'Bu yıldızlar harcanmış; önce kart işlemini geri alın.', CHANGED: 'Bu arada başka bir işlem yapıldı, tekrar deneyin.',
      INVALID_BACKUP: 'Yedek dosyası geçersiz.', DEMO_EXISTS: 'Demo verisi zaten yüklü.', DUPLICATE_REQUEST: 'Bu işlem zaten yapıldı.',
      QuotaExceededError: 'Depolama alanı dolu.'
    };
    return map[e && (e.code || e.name)] || (e && e.message) || String(e);
  }
  function txLabel(x) {
    if (x.type === 'stars') return '+' + x.amount + ' yıldız';
    if (x.type === 'card') { const c = MP.CARD_BY_ID[x.cardId]; return 'Kart: ' + (c ? MP.collectionName(c.collection) + ' ' + c.number + ' – ' + c.name : x.cardId) + ' (−' + x.cost + ' yıldız' + (x.mode === 'surprise' ? ', Surprise Me' : '') + ')'; }
    if (x.type === 'move') return 'Sınıf değiştirildi';
    if (x.type === 'reset') return 'Yıldız ve kartlar sıfırlandı';
    return x.type;
  }

  /* ---------- main render ---------- */
  async function render() {
    const classes = await st.listClasses({ includeArchived: true });
    if (!classes.find(function (c) { return c.id === T.classId; })) T.classId = (classes.find(function (c) { return !c.archived; }) || classes[0] || {}).id || null;
    const cls = classes.find(function (c) { return c.id === T.classId; });
    const s = app().state;

    const classSel = h('select', { class: 'select', style: { width: 'auto', minWidth: '160px' }, 'aria-label': 'Sınıf seç' },
      classes.map(function (c) { return h('option', { value: c.id, selected: c.id === T.classId ? true : null }, c.name + (c.archived ? ' (arşiv)' : '') + (c.isDemo ? ' (demo)' : '')); }));
    classSel.onchange = function () { T.classId = classSel.value; T.selected.clear(); T.historyStudent = ''; render(); };

    const undoInfo = T.classId ? await st.peekUndo(T.classId) : null;
    const undoBtn = h('button', { class: 'tbtn gold', disabled: undoInfo ? null : true }, '↶ Son işlemi geri al');
    undoBtn.onclick = function () { undoFlow(undoInfo); };
    const undoText = undoInfo
      ? (undoInfo.length > 1 ? undoInfo.length + ' öğrenciye ' + txLabel(undoInfo[0].tx) : undoInfo[0].studentName + ': ' + txLabel(undoInfo[0].tx))
      : 'Bu sınıfta geri alınacak işlem yok.';

    const tabs = [['students', 'Öğrenciler'], ['classes', 'Sınıflar'], ['history', 'Geçmiş'], ['settings', 'Ayarlar'], ['data', 'Yedek ve Veri']];
    const content = h('div');
    const panel = h('div', { class: 't-wrap' },
      h('div', { class: 't-head' },
        h('h1', null, 'Öğretmen Paneli'),
        h('div', { class: 'row' },
          h('label', { style: { fontWeight: 600 } }, 'Sınıf: '), classSel,
          h('button', { class: 'tbtn on-dark', onclick: function () { app().setTeacher(false); close(); ui.toast('Teacher tools locked.'); } }, 'Kilitle ve çık'),
          h('button', { class: 'tbtn gold', onclick: close }, 'Çocuk ekranına dön'))),
      h('div', { class: 't-note' },
        'Veriler yalnızca bu cihazdaki bu tarayıcıda (IndexedDB) saklanır; cihazlar arasında otomatik eşitlenmez ve bulut yedeği yoktur. Düzenli olarak “Yedek ve Veri” sekmesinden JSON yedek indirin.',
        s.settings.pin ? ' PIN yalnızca bu ekranda öğretmen araçlarını gizler; gerçek bir sunucu kimlik doğrulaması değildir.' : ' PIN ayarlı değil: öğretmen araçlarını herkes açabilir (Ayarlar sekmesinden PIN koyabilirsiniz).'),
      h('div', { class: 't-card', style: { marginTop: '14px' } },
        h('div', { class: 'undo-bar' }, undoBtn, h('span', null, h('b', null, 'Son işlem: '), undoText))),
      h('div', { class: 't-tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { class: 't-tab', role: 'tab', 'aria-selected': T.tab === t[0] ? 'true' : 'false', onclick: function () { T.tab = t[0]; render(); } }, t[1]);
      })),
      content);

    const scroll = root().scrollTop;
    root().replaceChildren(panel);
    if (T.tab === 'students') await tabStudents(content, cls, classes);
    else if (T.tab === 'classes') await tabClasses(content, classes);
    else if (T.tab === 'history') await tabHistory(content, cls);
    else if (T.tab === 'settings') await tabSettings(content);
    else await tabData(content);
    root().scrollTop = scroll;
  }

  async function undoFlow(info) {
    if (!info) return;
    const lines = info.map(function (p) { return p.studentName + ': ' + txLabel(p.tx) + ' (' + ui.fmtDateTimeTR(p.tx.createdAt) + ')'; });
    const ok = await ui.confirmDialog({
      title: 'Son işlemi geri al?',
      message: ['Şu işlem geri alınacak:'].concat(lines).concat(info[0].tx.type === 'card' ? ['Kart albümden çıkarılır ve harcanan yıldızlar bakiyeye geri eklenir.'] : ['Bu yıldızlar hem bakiyeden hem toplam kazanılandan düşülür.']),
      okText: 'Geri al'
    });
    if (!ok) return;
    act(function () { return st.undoLast(T.classId, { expectTxId: info[0].tx.id, requestId: st.uuid() }); }, 'İşlem geri alındı.').catch(function () {});
  }

  /* ---------- Students tab ---------- */
  async function tabStudents(el, cls, classes) {
    if (!cls) { el.appendChild(h('div', { class: 't-card' }, h('p', null, 'Önce bir sınıf oluşturun.'))); return; }
    const all = await st.listStudents(cls.id, { includeArchived: true });
    const active = all.filter(function (s) { return !s.archived; });
    const archived = all.filter(function (s) { return s.archived; });
    const cost = app().state.settings.starsPerCard;
    const nameCount = {};
    active.forEach(function (s) { const k = s.name.toLowerCase(); nameCount[k] = (nameCount[k] || 0) + 1; });
    T.selected.forEach(function (id) { if (!active.some(function (s) { return s.id === id; })) T.selected.delete(id); });

    // add students
    const one = h('input', { class: 'input', placeholder: 'Öğrenci adı', maxlength: '60' });
    const addOne = h('button', { class: 'tbtn primary' }, 'Ekle');
    const doAddOne = ui.once(async function () {
      const v = one.value.trim(); if (!v) return;
      await act(function () { return st.addStudents(cls.id, [v]); }, v + ' eklendi.').catch(function () {});
    });
    addOne.onclick = doAddOne;
    one.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAddOne(); });
    const many = h('textarea', { class: 'textarea', placeholder: 'Her satıra bir isim yazın veya listeyi yapıştırın' });
    const addMany = h('button', { class: 'tbtn primary' }, 'Hepsini ekle');
    addMany.onclick = ui.once(async function () {
      const names = many.value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!names.length) return;
      await act(function () { return st.addStudents(cls.id, names); }, names.length + ' öğrenci eklendi.').catch(function () {});
    });

    el.appendChild(h('div', { class: 't-grid2' },
      h('div', { class: 't-card' }, h('h2', null, cls.name + ' – öğrenci ekle'),
        h('div', { class: 'field' }, h('label', null, 'Tek tek'), h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, one), addOne)),
        h('p', { style: { fontSize: '.92rem', color: '#5b507c' } }, 'Aynı isimli öğrenciler ayrı kimliklerle tutulur; çocuklar karıştırmasın diye soyadının baş harfini eklemeniz önerilir (örn. “Ali K.”).')),
      h('div', { class: 't-card' }, h('h2', null, 'Toplu ekle'), many, h('div', { class: 'row', style: { marginTop: '10px' } }, addMany))));

    // bulk stars
    const bulkAmt = h('input', { class: 'input', type: 'number', min: '1', max: '100', value: '1', style: { width: '90px' }, 'aria-label': 'Yıldız miktarı' });
    const bulkGive = function (n) {
      const ids = Array.from(T.selected);
      if (!ids.length) { ui.toast('Önce öğrenci seçin.', 'error'); return; }
      app().award(ids, n).then(render, function () {});
    };
    const selAll = h('input', { type: 'checkbox', 'aria-label': 'Tümünü seç', checked: active.length && T.selected.size === active.length ? true : null });
    selAll.onchange = function () { if (selAll.checked) active.forEach(function (s) { T.selected.add(s.id); }); else T.selected.clear(); render(); };

    const rows = active.map(function (s) {
      const cb = h('input', { type: 'checkbox', 'aria-label': s.name + ' seç', checked: T.selected.has(s.id) ? true : null });
      cb.onchange = function () { if (cb.checked) T.selected.add(s.id); else T.selected.delete(s.id); selCount.textContent = T.selected.size + ' seçili'; };
      const star = function (n) {
        const b = h('button', { class: 'tbtn teal', title: '+' + n + ' yıldız' }, '+' + n);
        b.onclick = function () { app().award([s.id], n, b).then(render, function () {}); };
        return b;
      };
      const custom = h('button', { class: 'tbtn' }, 'Özel');
      custom.onclick = async function () {
        const n = await askNumber('Özel yıldız miktarı', s.name + ' kaç yıldız alsın? (1–100)');
        if (n) app().award([s.id], n, custom).then(render, function () {});
      };
      return h('tr', null,
        h('td', null, cb),
        h('td', null, h('b', null, s.name), nameCount[s.name.toLowerCase()] > 1 ? h('span', { class: 'warn-dup', title: 'Bu sınıfta aynı isimde başka öğrenci var' }, 'aynı isim') : null),
        h('td', { class: 'num' }, String(s.balance), s.balance >= cost ? ' ✦' : ''),
        h('td', { class: 'num' }, String(s.totalEarned)),
        h('td', { class: 'num' }, s.cardCount + '/40'),
        h('td', null, h('div', { class: 'btn-row' }, star(1), star(2), star(3), custom)),
        h('td', null, h('div', { class: 'btn-row' },
          h('button', { class: 'tbtn', onclick: function () { studentDetail(s.id); } }, 'Detay / Düzenle'))));
    });
    const selCount = h('span', null, T.selected.size + ' seçili');
    el.appendChild(h('div', { class: 't-card' },
      h('h2', null, 'Öğrenciler (' + active.length + ')'),
      h('p', { style: { fontSize: '.95rem' } }, 'Bakiye = harcanabilir yıldız. Toplam = şimdiye kadar kazanılan tüm yıldızlar. Şu anki kural: ' + cost + ' yıldız = 1 kart. ✦ = kart seçebilir.'),
      active.length ? h('div', { class: 'row', style: { margin: '6px 0 12px', padding: '10px', background: '#f3ecdc', borderRadius: '12px' } },
        h('b', null, 'Seçili öğrencilere toplu yıldız:'), selCount,
        [1, 2, 3].map(function (n) { return h('button', { class: 'tbtn teal', onclick: function () { bulkGive(n); } }, '+' + n); }),
        bulkAmt, h('button', { class: 'tbtn primary', onclick: function () { const n = parseInt(bulkAmt.value, 10); if (n >= 1 && n <= 100) bulkGive(n); else ui.toast('1–100 arası bir sayı girin.', 'error'); } }, 'Ver')) : null,
      active.length ? h('div', { class: 't-scroll' }, h('table', { class: 't-table' },
        h('thead', null, h('tr', null, h('th', null, selAll), h('th', null, 'Ad'), h('th', { class: 'num' }, 'Bakiye'), h('th', { class: 'num' }, 'Toplam'), h('th', { class: 'num' }, 'Kart'), h('th', null, 'Yıldız ver'), h('th', null, ''))),
        h('tbody', null, rows))) : h('p', null, 'Bu sınıfta henüz öğrenci yok.')));

    if (archived.length) {
      el.appendChild(h('div', { class: 't-card' }, h('h2', null, 'Arşivlenmiş öğrenciler (' + archived.length + ')'),
        h('p', { style: { fontSize: '.95rem' } }, 'Arşivdeki öğrenciler çocuk ekranında ve öğrenci seçiminde görünmez; yıldız ve kartları korunur.'),
        h('table', { class: 't-table' }, h('tbody', null, archived.map(function (s) {
          return h('tr', { class: 'archived' }, h('td', null, s.name), h('td', { class: 'num' }, s.balance + ' / ' + s.totalEarned), h('td', { class: 'num' }, s.cardCount + '/40'),
            h('td', null, h('div', { class: 'btn-row' },
              h('button', { class: 'tbtn', onclick: function () { act(function () { return st.setStudentArchived(s.id, false); }, s.name + ' arşivden çıkarıldı.').catch(function () {}); } }, 'Arşivden çıkar'),
              h('button', { class: 'tbtn', onclick: function () { studentDetail(s.id); } }, 'Detay'))));
        })))));
    }
  }

  function askNumber(title, msg) {
    return new Promise(function (resolve) {
      let done = false;
      const inp = h('input', { class: 'input', type: 'number', min: '1', max: '100', value: '5', autofocus: true });
      const ok = h('button', { class: 'tbtn primary' }, 'Ver');
      const m = ui.modal(h('div', null, h('h2', null, title), h('p', null, msg), inp,
        h('div', { class: 'actions' }, h('button', { class: 'tbtn', onclick: function () { m.close(); } }, 'Vazgeç'), ok)),
      { onClose: function () { if (!done) resolve(null); } });
      const submit = function () {
        const n = parseInt(inp.value, 10);
        if (!(n >= 1 && n <= 100)) { ui.toast('1–100 arası bir tam sayı girin.', 'error'); return; }
        done = true; m.close(); resolve(n);
      };
      ok.onclick = submit;
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });
  }

  /* ---------- Student detail ---------- */
  async function studentDetail(sid) {
    const s = await st.getStudent(sid);
    if (!s) return;
    const classes = await st.listClasses({ includeArchived: true });
    const cls = classes.find(function (c) { return c.id === s.classId; });
    const owned = Object.values(await st.getOwned(sid)).sort(function (a, b) { return a.cardId.localeCompare(b.cardId); });
    const hist = await st.listTxs({ studentId: sid, limit: 60 });

    const nameIn = h('input', { class: 'input', value: s.name, maxlength: '60' });
    const moveSel = h('select', { class: 'select' }, classes.filter(function (c) { return !c.archived || c.id === s.classId; }).map(function (c) {
      return h('option', { value: c.id, selected: c.id === s.classId ? true : null }, c.name);
    }));
    let m;
    const reopen = function () { m.close(); studentDetail(sid); };
    const run = function (fn, msg, reopenAfter) {
      return act(fn, msg).then(function () { if (reopenAfter) reopen(); else m.close(); }, function () {});
    };

    const printBtn = function (kind, label) {
      return h('button', { class: 'tbtn', onclick: function () { m.close(); root().hidden = true; document.body.style.overflow = ''; app().go('#/print/student/' + sid + '/' + kind); } }, label);
    };

    m = ui.modal(h('div', null,
      h('h2', null, s.name + (s.archived ? ' (arşivde)' : '')),
      h('p', null, 'Sınıf: ', h('b', null, cls ? cls.name : '?'), ' · Bakiye: ', h('b', null, String(s.balance)), ' · Toplam kazanılan: ', h('b', null, String(s.totalEarned)), ' · Kart: ', h('b', null, owned.length + '/40')),
      h('p', { style: { fontSize: '.85rem', color: '#5b507c' } }, 'Kimlik: ' + s.id),
      h('div', { class: 'row', style: { marginBottom: '12px' } },
        h('button', { class: 'tbtn primary', onclick: function () { m.close(); close(); app().go('#/album/' + sid); } }, 'Albümü aç'),
        h('button', { class: 'tbtn', onclick: function () { m.close(); close(); app().go('#/student/' + sid); } }, 'Öğrenci ekranı')),
      h('h3', null, 'Yazdır (A5)'),
      h('div', { class: 'btn-row' }, printBtn('filled', 'Dolu albüm'), printBtn('blank', 'Boş albüm'), printBtn('cards-earned', 'Kazanılan kart sayfaları')),
      h('h3', null, 'İsim düzelt'),
      h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, nameIn), h('button', { class: 'tbtn primary', onclick: function () { run(function () { return st.renameStudent(sid, nameIn.value); }, 'İsim güncellendi.', true); } }, 'Kaydet')),
      h('h3', null, 'Sınıf değiştir'),
      h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, moveSel), h('button', {
        class: 'tbtn primary', onclick: async function () {
          if (moveSel.value === s.classId) return;
          const target = classes.find(function (c) { return c.id === moveSel.value; });
          if (await ui.confirmDialog({ title: 'Sınıf değiştir', message: s.name + ' → ' + target.name + '. Yıldızları, kartları ve geçmişi de taşınır.', okText: 'Taşı' })) {
            run(function () { return st.moveStudent(sid, moveSel.value); }, s.name + ' taşındı.', true);
          }
        }
      }, 'Taşı')),
      h('h3', null, 'Kartlar (' + owned.length + ')'),
      owned.length ? h('div', { class: 'mini-cards' }, owned.map(function (o) {
        const c = MP.CARD_BY_ID[o.cardId];
        return h('figure', null, h('img', { src: c.src, alt: c.name }), h('figcaption', null, MP.collectionName(c.collection) + ' ' + c.number + ' · ' + ui.fmtDateTimeTR(o.earnedAt)));
      })) : h('p', null, 'Henüz kart yok.'),
      h('h3', null, 'Geçmiş'),
      hist.length ? h('div', { class: 't-scroll', style: { maxHeight: '260px', overflow: 'auto' } }, h('table', { class: 't-table' }, h('tbody', null, hist.map(function (x) {
        return h('tr', { class: 'history-item' + (x.undone ? ' undone' : '') }, h('td', null, ui.fmtDateTimeTR(x.createdAt)), h('td', null, txLabel(x)), h('td', null, x.undone ? 'geri alındı' : ''));
      })))) : h('p', null, 'Kayıt yok.'),
      h('h3', null, 'Diğer işlemler'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'tbtn', onclick: function () { run(function () { return st.setStudentArchived(sid, !s.archived); }, s.archived ? 'Arşivden çıkarıldı.' : 'Arşivlendi.', false); } }, s.archived ? 'Arşivden çıkar' : 'Arşivle'),
        h('button', {
          class: 'tbtn danger', onclick: async function () {
            if (await ui.confirmDialog({ title: s.name + ': yıldız ve kartları sıfırla', message: ['Bu öğrencinin TÜM kartları, yıldız bakiyesi, toplam yıldızı ve işlem geçmişi silinir.', 'Bu işlem geri alınamaz. İsterseniz önce yedek indirin.'], okText: 'Sıfırla', danger: true, typeToConfirm: 'SIFIRLA' })) {
              run(function () { return st.resetStudent(sid); }, s.name + ' sıfırlandı.', true);
            }
          }
        }, 'Sıfırla'),
        h('button', {
          class: 'tbtn danger', onclick: async function () {
            if (await ui.confirmDialog({ title: s.name + ' silinsin mi?', message: ['Öğrenci, tüm kartları ve yıldız geçmişi kalıcı olarak silinir. Geri alınamaz.', 'Sadece listeden kaldırmak istiyorsanız “Arşivle”yi kullanın.'], okText: 'Kalıcı olarak sil', danger: true, typeToConfirm: 'SİL' })) {
              run(function () { return st.deleteStudent(sid); }, 'Öğrenci silindi.', false);
            }
          }
        }, 'Sil')),
      h('div', { class: 'actions' }, h('button', { class: 'tbtn gold', onclick: function () { m.close(); } }, 'Kapat'))), { className: 'wide' });
  }

  /* ---------- Classes tab ---------- */
  async function tabClasses(el, classes) {
    const nameIn = h('input', { class: 'input', placeholder: 'Yeni sınıf adı (örn. J6F)', maxlength: '60' });
    const create = ui.once(async function () {
      const v = nameIn.value.trim(); if (!v) return;
      const c = await act(function () { return st.createClass(v); }, v + ' oluşturuldu.').catch(function () { return null; });
      if (c) { T.classId = c.id; render(); }
    });
    nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
    const counts = {};
    for (const c of classes) counts[c.id] = (await st.listStudents(c.id, { includeArchived: true })).length;

    el.appendChild(h('div', { class: 't-card' }, h('h2', null, 'Sınıf oluştur'),
      h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, nameIn), h('button', { class: 'tbtn primary', onclick: create }, 'Oluştur'))));
    el.appendChild(h('div', { class: 't-card' }, h('h2', null, 'Sınıflar'),
      h('p', { style: { fontSize: '.95rem' } }, 'Her sınıfın öğrencileri, yıldızları ve koleksiyonları ayrı tutulur. Arşivlenen sınıf çocuk ekranında görünmez.'),
      h('div', { class: 't-scroll' }, h('table', { class: 't-table' },
        h('thead', null, h('tr', null, h('th', null, 'Sınıf'), h('th', { class: 'num' }, 'Öğrenci'), h('th', null, ''))),
        h('tbody', null, classes.map(function (c) {
          return h('tr', { class: c.archived ? 'archived' : '' },
            h('td', null, h('b', null, c.name), c.isDemo ? ' (demo)' : '', c.archived ? ' (arşiv)' : ''),
            h('td', { class: 'num' }, String(counts[c.id])),
            h('td', null, h('div', { class: 'btn-row' },
              h('button', { class: 'tbtn', onclick: function () { T.classId = c.id; T.tab = 'students'; render(); } }, 'Öğrenciler'),
              h('button', {
                class: 'tbtn', onclick: async function () {
                  const v = await askText('Sınıf adını değiştir', c.name);
                  if (v && v !== c.name) act(function () { return st.renameClass(c.id, v); }, 'Sınıf adı güncellendi.').catch(function () {});
                }
              }, 'Yeniden adlandır'),
              h('button', { class: 'tbtn', onclick: function () { act(function () { return st.setClassArchived(c.id, !c.archived); }, c.archived ? 'Arşivden çıkarıldı.' : 'Arşivlendi.').catch(function () {}); } }, c.archived ? 'Arşivden çıkar' : 'Arşivle'),
              h('button', { class: 'tbtn', onclick: function () { root().hidden = true; document.body.style.overflow = ''; app().go('#/print/class/' + c.id + '/filled'); } }, 'Sınıfı yazdır'),
              h('button', {
                class: 'tbtn danger', onclick: async function () {
                  if (await ui.confirmDialog({ title: c.name + ' silinsin mi?', message: ['Sınıf, içindeki ' + counts[c.id] + ' öğrenci, tüm kartları ve yıldız geçmişi kalıcı olarak silinir. Geri alınamaz.', 'Önce yedek indirmeniz önerilir.'], okText: 'Sınıfı sil', danger: true, typeToConfirm: c.name })) {
                    act(function () { return st.deleteClass(c.id); }, c.name + ' silindi.').catch(function () {});
                  }
                }
              }, 'Sil'))));
        }))))));
  }

  function askText(title, value) {
    return new Promise(function (resolve) {
      let done = false;
      const inp = h('input', { class: 'input', value: value || '', maxlength: '60', autofocus: true });
      const ok = h('button', { class: 'tbtn primary' }, 'Kaydet');
      const m = ui.modal(h('div', null, h('h2', null, title), inp,
        h('div', { class: 'actions' }, h('button', { class: 'tbtn', onclick: function () { m.close(); } }, 'Vazgeç'), ok)),
      { onClose: function () { if (!done) resolve(null); } });
      const submit = function () { done = true; m.close(); resolve(inp.value.trim()); };
      ok.onclick = submit;
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });
  }

  /* ---------- History tab ---------- */
  async function tabHistory(el, cls) {
    if (!cls) return;
    const students = await st.listStudents(cls.id, { includeArchived: true });
    const sel = h('select', { class: 'select', style: { width: 'auto' } },
      h('option', { value: '' }, 'Tüm öğrenciler'),
      students.map(function (s) { return h('option', { value: s.id, selected: T.historyStudent === s.id ? true : null }, s.name); }));
    sel.onchange = function () { T.historyStudent = sel.value; render(); };
    const list = T.historyStudent ? await st.listTxs({ studentId: T.historyStudent, limit: 300 }) : await st.listTxs({ classId: cls.id, limit: 300 });
    el.appendChild(h('div', { class: 't-card' },
      h('h2', null, cls.name + ' – yıldız ve kart geçmişi'),
      h('div', { class: 'row', style: { marginBottom: '10px' } }, sel, h('span', { style: { color: '#5b507c' } }, 'Son 300 kayıt, en yeni üstte.')),
      list.length ? h('div', { class: 't-scroll' }, h('table', { class: 't-table' },
        h('thead', null, h('tr', null, h('th', null, 'Tarih'), h('th', null, 'Öğrenci'), h('th', null, 'İşlem'), h('th', null, 'Durum'))),
        h('tbody', null, list.map(function (x) {
          return h('tr', { class: 'history-item' + (x.undone ? ' undone' : '') },
            h('td', null, ui.fmtDateTimeTR(x.createdAt)), h('td', null, x.studentName), h('td', null, txLabel(x)),
            h('td', null, x.undone ? 'geri alındı ' + ui.fmtDateTimeTR(x.undoneAt) : ''));
        })))) : h('p', null, 'Henüz kayıt yok.')));
  }

  /* ---------- Settings tab ---------- */
  async function tabSettings(el) {
    const s = app().state.settings;
    const costIn = h('input', { class: 'input', type: 'number', min: '1', max: '100', value: String(s.starsPerCard), style: { width: '120px' } });
    const saveCost = h('button', { class: 'tbtn primary' }, 'Kaydet');
    saveCost.onclick = async function () {
      const n = parseInt(costIn.value, 10);
      if (!(n >= 1 && n <= 100)) { ui.toast('1–100 arası bir tam sayı girin.', 'error'); return; }
      if (n === s.starsPerCard) return;
      if (!(await ui.confirmDialog({ title: 'Kart eşiğini değiştir', message: ['Yeni kural: ' + n + ' yıldız = 1 kart.', 'Geçmiş işlemler yeniden hesaplanmaz: daha önce alınan kartlar ve bakiyeler aynen kalır. Sadece bundan sonraki kart alımları yeni eşikle yapılır.'], okText: 'Değiştir' }))) return;
      act(async function () { await st.updateSettings({ starsPerCard: n }); await app().refreshSettings(); }, 'Kart eşiği ' + n + ' yıldız oldu.').catch(function () {});
    };
    const motionSel = h('select', { class: 'select', style: { width: 'auto' } },
      [['system', 'Cihaz ayarına uy (önerilen)'], ['reduce', 'Hareketleri azalt'], ['full', 'Tüm animasyonlar açık']].map(function (o) {
        return h('option', { value: o[0], selected: s.motion === o[0] ? true : null }, o[1]);
      }));
    motionSel.onchange = function () { act(async function () { await st.updateSettings({ motion: motionSel.value }); await app().refreshSettings(); }, 'Kaydedildi.').catch(function () {}); };
    const soundSel = h('select', { class: 'select', style: { width: 'auto' } },
      h('option', { value: '1', selected: s.sound ? true : null }, 'Ses açık'), h('option', { value: '0', selected: s.sound ? null : true }, 'Ses kapalı'));
    soundSel.onchange = function () { act(async function () { await st.updateSettings({ sound: soundSel.value === '1' }); await app().refreshSettings(); }, 'Kaydedildi.').catch(function () {}); };

    const setPin = async function () {
      const a = await pinPad('Yeni PIN', '4–6 haneli bir PIN girin.');
      if (!a) return;
      const b = await pinPad('PIN tekrar', 'Aynı PIN’i tekrar girin.');
      if (!b) return;
      if (a !== b) { ui.toast('PIN’ler aynı değil.', 'error'); return; }
      const salt = st.uuid();
      const hash = await hashPin(a, salt);
      act(async function () { await st.updateSettings({ pin: { salt: salt, hash: hash } }); await app().refreshSettings(); }, 'PIN kaydedildi.').catch(function () {});
    };
    const removePin = async function () {
      if (await ui.confirmDialog({ title: 'PIN kaldırılsın mı?', message: 'Öğretmen araçlarını herkes açabilir hale gelir.', okText: 'Kaldır' })) {
        act(async function () { await st.updateSettings({ pin: null }); await app().refreshSettings(); }, 'PIN kaldırıldı.').catch(function () {});
      }
    };

    el.appendChild(h('div', { class: 't-grid2' },
      h('div', { class: 't-card' }, h('h2', null, 'Kart kazanma kuralı'),
        h('div', { class: 'row' }, costIn, h('span', null, 'yıldız = 1 kart'), saveCost),
        h('p', { style: { marginTop: '10px', fontSize: '.95rem' } }, 'Eşik değişince geçmiş yeniden hesaplanmaz; yeni kart alımları güncel eşikten yapılır. Bakiye hiçbir zaman eksiye düşmez.')),
      h('div', { class: 't-card' }, h('h2', null, 'Öğretmen PIN’i'),
        h('p', null, s.pin ? 'PIN ayarlı.' : 'PIN ayarlı değil.'),
        h('p', { style: { fontSize: '.95rem' } }, 'PIN, öğretmen araçlarını (yıldız verme, panel) bu cihazda çocuk ekranından ayırır. Tarayıcıda yerel olarak saklanır; gerçek sunucu kimlik doğrulaması değildir ve verileri şifrelemez. PIN ayarlıysa 20 dakika işlem yapılmazsa araçlar kilitlenir.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'tbtn primary', onclick: setPin }, s.pin ? 'PIN değiştir' : 'PIN belirle'), s.pin ? h('button', { class: 'tbtn danger', onclick: removePin }, 'PIN kaldır') : null)),
      h('div', { class: 't-card' }, h('h2', null, 'Ses ve hareket'),
        h('div', { class: 'field' }, h('label', null, 'Ses'), soundSel),
        h('div', { class: 'field' }, h('label', null, 'Animasyonlar'), motionSel),
        h('p', { style: { fontSize: '.95rem' } }, 'Ses ve animasyonlar hiçbir işlemi beklemez veya engellemez; kayıt önce yapılır, kutlama sonra gösterilir.'))));
  }

  /* ---------- Data tab ---------- */
  async function tabData(el) {
    const s = app().state;
    const classes = await st.listClasses({ includeArchived: true });
    const hasDemo = classes.some(function (c) { return c.isDemo; });

    const downloadBackup = async function () {
      try {
        const b = await st.exportBackup();
        const d = new Date();
        const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
        await ui.download('magic-picker-backup-' + stamp + '.json', JSON.stringify(b, null, 1));
        ui.toast('Yedek dosyası indirildi.', 'ok');
        return true;
      } catch (e) {
        if (e && e.code === 'declined') ui.toast('İndirme iptal edildi; yedek kaydedilmedi.', 'error');
        else ui.toast('Yedek indirilemedi: ' + trError(e), 'error');
        return false;
      }
    };

    const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'input' });
    const report = h('div');
    file.onchange = async function () {
      report.replaceChildren();
      const f = file.files && file.files[0];
      if (!f) return;
      let obj;
      try { obj = JSON.parse(await f.text()); }
      catch (_) { report.appendChild(h('p', { style: { color: 'var(--danger)', fontWeight: 600 } }, 'Dosya okunamadı: geçerli bir JSON değil. Mevcut veriler değişmedi.')); return; }
      const v = st.validateBackup(obj);
      if (!v.ok) {
        report.appendChild(h('div', null, h('p', { style: { color: 'var(--danger)', fontWeight: 600 } }, 'Yedek geçersiz, geri yüklenmeyecek. Mevcut veriler değişmedi.'),
          h('ul', null, v.errors.map(function (e) { return h('li', null, e); }))));
        return;
      }
      const sm = v.summary;
      const restoreBtn = h('button', { class: 'tbtn danger solid' }, 'Bu yedeği geri yükle');
      restoreBtn.onclick = async function () {
        const ok = await ui.confirmDialog({
          title: 'Yedeği geri yükle?', danger: true, okText: 'Geri yükle', typeToConfirm: 'GERİ YÜKLE',
          message: ['Bu cihazdaki TÜM mevcut Magic Picker verileri (sınıflar, öğrenciler, yıldızlar, kartlar, geçmiş, ayarlar) bu yedekle değiştirilecek.', 'Önce mevcut verinin yedeğini indirdiğinizden emin olun.']
        });
        if (!ok) return;
        try {
          await st.restoreBackup(obj);
          await app().refreshSettings();
          ui.toast('Yedek geri yüklendi: ' + sm.students + ' öğrenci, ' + sm.cards + ' kart.', 'ok', 5000);
          T.classId = null; file.value = '';
          render();
        } catch (e) {
          ui.toast('Geri yükleme başarısız; mevcut veriler değişmedi. ' + trError(e), 'error', 9000);
        }
      };
      report.appendChild(h('div', { style: { background: '#eef8f1', borderRadius: '12px', padding: '12px', marginTop: '10px' } },
        h('p', null, h('b', null, 'Yedek geçerli. '), sm.classes + ' sınıf, ' + sm.students + ' öğrenci, ' + sm.cards + ' kart, ' + sm.history + ' geçmiş kaydı. Oluşturulma: ' + (sm.exportedAt ? ui.fmtDateTimeTR(sm.exportedAt) : '?')),
        h('div', { class: 'btn-row' }, h('button', { class: 'tbtn primary', onclick: downloadBackup }, '1) Önce mevcut verinin yedeğini indir'), restoreBtn)));
    };

    let usage = '';
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); usage = Math.round((e.usage || 0) / 1024) + ' KB kullanılıyor.'; } } catch (_) { /* ignore */ }

    el.appendChild(h('div', { class: 't-grid2' },
      h('div', { class: 't-card' }, h('h2', null, 'Yedek indir (JSON)'),
        h('p', null, 'Tüm sınıflar, öğrenciler, yıldızlar, kartlar, geçmiş ve ayarlar tek bir dosyaya kaydedilir. Başka bir cihaza taşımak için bu dosyayı orada geri yükleyin.'),
        h('button', { class: 'tbtn primary', onclick: downloadBackup }, 'Yedeği indir')),
      h('div', { class: 't-card' }, h('h2', null, 'Yedekten geri yükle'),
        h('p', null, 'Dosya önce doğrulanır. Bozuk veya eksik yedek mevcut verileri değiştirmez. Geri yükleme tek işlemde yapılır: bir hata olursa hiçbir şey değişmez.'),
        file, report),
      h('div', { class: 't-card' }, h('h2', null, 'Depolama durumu'),
        h('p', null, 'Depolama: bu tarayıcının IndexedDB alanı (yalnızca bu cihaz, bu tarayıcı profili). Sunucu veya bulut eşitlemesi yoktur.'),
        h('p', null, s.persisted ? 'Tarayıcı kalıcı depolamaya izin verdi (otomatik temizlenme riski düşük).' : 'Tarayıcı kalıcı depolama izni vermedi; disk dolarsa veya tarayıcı verileri temizlenirse veri silinebilir. Düzenli yedek alın.'),
        h('p', null, 'Gizli/özel pencerede kullanmayın: pencere kapanınca veriler silinir. ' + usage)),
      h('div', { class: 't-card' }, h('h2', null, 'Demo modu'),
        h('p', null, 'Deneme için “DEMO” adlı ayrı bir sınıf ve “Demo Student …” isimli 6 sahte öğrenci oluşturur (ikisi bilerek aynı isimde). Gerçek sınıflara dokunmaz; tek tıkla tamamen silinir.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'tbtn', disabled: hasDemo ? true : null, onclick: function () { act(function () { return st.loadDemo(); }, 'Demo verisi yüklendi (DEMO sınıfı).').catch(function () {}); } }, 'Demo verisi yükle'),
          h('button', {
            class: 'tbtn danger', disabled: hasDemo ? null : true, onclick: async function () {
              if (await ui.confirmDialog({ title: 'Demo verisi silinsin mi?', message: 'DEMO sınıfı ve içindeki tüm demo öğrenciler, kartlar ve geçmiş silinir.', okText: 'Demo verisini sil', danger: true })) {
                act(function () { return st.removeDemo(); }, 'Demo verisi silindi.').catch(function () {});
              }
            }
          }, 'Demo verisini sil'))),
      h('div', { class: 't-card' }, h('h2', null, 'Tümünü sıfırla'),
        h('p', null, 'Bütün sınıflar, öğrenciler, yıldızlar, kartlar, geçmiş ve ayarlar silinir; varsayılan 7 sınıf (J5A–J6E) boş olarak yeniden oluşturulur.'),
        h('button', {
          class: 'tbtn danger', onclick: async function () {
            if (await ui.confirmDialog({ title: 'TÜM veriler silinsin mi?', message: ['Bu işlem geri alınamaz.', 'Önce “Yedeği indir” ile yedek almanız önerilir.'], okText: 'Her şeyi sil', danger: true, typeToConfirm: 'SIFIRLA' })) {
              act(async function () { await st.resetAll(); await app().refreshSettings(); app().setTeacher(true); T.classId = null; }, 'Tüm veriler sıfırlandı.').catch(function () {});
            }
          }
        }, 'Tümünü sıfırla'))));
  }

  MP.teacher = { open: open, close: close, render: render };
})();
