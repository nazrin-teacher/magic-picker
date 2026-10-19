/*
 * Printable A5 album and card sheets.
 * Two layouts for albums:
 *   - separate A5 portrait pages (148 x 210 mm), one album page per sheet (default)
 *   - A4 fold-in-half booklet: two A5 pages per A4 landscape side, saddle-stitch page order
 * Card sheets are always A5 pages.
 * PDF: the browser's print dialog -> "Save as PDF".
 */
window.MP = window.MP || {};

(function () {
  const ui = MP.ui, h = ui.h, st = MP.store;
  const KINDS = {
    'filled': 'Filled album',
    'blank': 'Blank album',
    'cards-earned': 'Earned cards (to cut out and stick)',
    'cards-all': 'All 40 cards'
  };

  function page(cls, children) {
    return h('section', { class: 'ppage ' + (cls || '') }, h('div', { class: 'ppage-inner' }, children));
  }

  function coverPage(s, className, owned, blank) {
    const c = MP.app.countOwned(owned);
    const line = function (label, val) { return h('div', { class: 'pc-line' }, h('span', null, label), h('span', null, val)); };
    return page('p-cover', [
      h('div', { class: 'pc-title' }, 'My Magic Collection'),
      h('img', { class: 'pc-emblem', src: MP.CARD_BACK, alt: '' }),
      h('div', { class: 'pc-name' }, s.name),
      h('div', { class: 'pc-class' }, 'Class ' + className),
      h('div', { class: 'pc-progress' },
        line('Adventure', blank ? '____ / 20' : c.adventure + ' / 20'),
        line('Wonder', blank ? '____ / 20' : c.wonder + ' / 20'),
        line('Total', blank ? '____ / 40' : c.total + ' / 40'))
    ]);
  }

  function slotsPage(col, p, owned, blank, studentName) {
    const pages = Math.ceil(col.size / 4);
    return page('p-slots', [
      h('div', { class: 'ps-head' }, h('span', { class: 'ps-col' }, col.name), h('span', { class: 'ps-num' }, 'Page ' + (p + 1) + ' of ' + pages)),
      h('div', { class: 'ps-grid' }, MP.app.slotsFor(col.id, p).map(function (c) {
        const has = !blank && owned[c.id];
        return h('div', { class: 'ps-slot' + (has ? ' has' : '') },
          h('div', { class: 'ps-frame' }, has ? h('img', { src: c.src, alt: c.name }) : null),
          h('div', { class: 'ps-label' }, String(c.number)));
      })),
      h('div', { class: 'ps-foot' }, studentName)
    ]);
  }

  function backPage() {
    return page('p-back', [h('img', { src: MP.CARD_BACK, alt: '' }), h('div', { class: 'pb-title' }, 'Magic Picker')]);
  }

  function albumPages(s, className, owned, blank) {
    const out = [coverPage(s, className, owned, blank)];
    MP.COLLECTIONS.forEach(function (col) {
      for (let p = 0; p < Math.ceil(col.size / 4); p++) out.push(slotsPage(col, p, owned, blank, s.name));
    });
    out.push(backPage());
    return out;
  }

  function cardSheets(cards, title) {
    const out = [];
    for (let i = 0; i < cards.length; i += 6) {
      out.push(page('p-cards', [
        h('div', { class: 'pk-head' }, title, h('span', null, 'Cut along the dashed lines')),
        h('div', { class: 'pk-grid' }, cards.slice(i, i + 6).map(function (c) {
          return h('div', { class: 'pk-cell' },
            h('div', { class: 'pk-cut' }, h('img', { src: c.src, alt: c.name })),
            h('div', { class: 'pk-label' }, MP.collectionName(c.collection) + ' ' + c.number));
        }))
      ]));
    }
    return out;
  }

  function sortedOwned(owned) {
    return MP.CARDS.filter(function (c) { return owned[c.id]; });
  }

  /*
   * Saddle-stitch imposition: A5 pages placed two per A4 landscape side, printed double-sided
   * (flip on short edge), folded in the middle. Pages are padded with blanks to a multiple of 4.
   */
  function impose(pages) {
    const list = pages.slice();
    while (list.length % 4) list.push(page('p-empty', []));
    const n = list.length, sides = [];
    for (let i = 0; i < n / 4; i++) {
      sides.push([list[n - 1 - 2 * i], list[2 * i]]);       // front of sheet i+1
      sides.push([list[2 * i + 1], list[n - 2 - 2 * i]]);   // back of sheet i+1
    }
    return sides.map(function (pair) { return h('section', { class: 'psheet' }, pair); });
  }

  function setPageSize(booklet) {
    let el = document.getElementById('print-page-size');
    if (!el) { el = h('style', { id: 'print-page-size' }); document.head.appendChild(el); }
    el.textContent = booklet ? '@media print { @page { size: 297mm 210mm; margin: 0; } }' : '';
  }

  async function render(parts) {
    const scope = parts[0], id = parts[1];
    let kind = parts[2] && KINDS[parts[2]] ? parts[2] : 'filled';
    const root = document.getElementById('print-root');
    document.body.classList.add('print-mode');
    window.scrollTo(0, 0);

    let students = [], title = '', backHash = '#/';
    if (scope === 'student') {
      const s = await st.getStudent(id);
      if (!s) { MP.app.go('#/'); return; }
      students = [s];
      const c = await st.getClass(s.classId);
      title = s.name + ' (' + (c ? c.name : '') + ')';
      backHash = '#/student/' + s.id;
    } else if (scope === 'class') {
      const c = await st.getClass(id);
      if (!c) { MP.app.go('#/'); return; }
      students = await st.listStudents(c.id);
      title = 'Class ' + c.name + ' – ' + students.length + (students.length === 1 ? ' student' : ' students');
      backHash = '#/class/' + c.id;
      if (kind === 'cards-all') kind = 'filled';
    } else { MP.app.go('#/'); return; }

    const isAlbum = kind === 'filled' || kind === 'blank';
    const booklet = isAlbum && parts[3] === 'booklet';
    setPageSize(booklet);

    const nodes = [];
    let pageCount = 0, emptyMsg = '';
    for (const s of students) {
      const cls = await st.getClass(s.classId);
      const owned = await st.getOwned(s.id);
      if (isAlbum) {
        const album = albumPages(s, cls ? cls.name : '', owned, kind === 'blank');
        pageCount += album.length;
        // each student's album is imposed on its own sheets, so albums never share paper
        nodes.push.apply(nodes, booklet ? impose(album) : album);
      } else if (kind === 'cards-earned') {
        const list = sortedOwned(owned);
        if (list.length) { const sh = cardSheets(list, s.name + ' – Magic Picker cards'); pageCount += sh.length; nodes.push.apply(nodes, sh); }
      }
    }
    if (kind === 'cards-all') { const sh = cardSheets(MP.CARDS, 'Magic Picker cards'); pageCount += sh.length; nodes.push.apply(nodes, sh); }
    if (!nodes.length) emptyMsg = kind === 'cards-earned' ? 'No cards earned yet.' : 'There are no students in this class.';

    const go = function (k, layout) { MP.app.go('#/print/' + scope + '/' + id + '/' + k + (layout === 'booklet' ? '/booklet' : '')); };
    const printBtn = h('button', { class: 'tbtn gold', disabled: true }, 'Loading pictures…');
    const kindBtns = Object.keys(KINDS).filter(function (k) { return scope === 'student' || k !== 'cards-all'; }).map(function (k) {
      return h('button', { class: 'tbtn ' + (k === kind ? 'primary' : ''), onclick: function () { go(k, booklet ? 'booklet' : 'a5'); } }, KINDS[k]);
    });
    const layoutBtns = isAlbum ? h('div', { class: 'row', style: { marginTop: '10px' } },
      h('b', null, 'Layout:'),
      h('button', { class: 'tbtn ' + (booklet ? '' : 'primary'), onclick: function () { go(kind, 'a5'); } }, 'Separate A5 pages'),
      h('button', { class: 'tbtn ' + (booklet ? 'primary' : ''), onclick: function () { go(kind, 'booklet'); } }, 'A4 folded booklet')) : null;

    const sheets = Math.ceil(pageCount / 4) * (booklet ? 1 : 0);
    const note = booklet
      ? ['Output: A4 folded booklet. Two A5 pages are printed on each side of a landscape A4 sheet; ',
        Math.ceil(pageCount / students.length / 4) + ' A4 sheets per student (' + sheets + ' sheets in total, ' + (sheets * 2) + ' sides). ',
        'In the print dialog: paper “A4”, layout “Landscape”, scale “100% / Actual size”, margins “None”, “Background graphics” on, ',
        '“Two-sided – flip on short edge”. Stack the sheets in order, fold them in the middle and staple along the fold. ',
        'If your printer cannot print on both sides, print the odd pages, turn the paper over, then print the even pages. The A5 page size and card slots stay the same (57 × 47.5 mm).']
      : ['Output: separate A5 portrait pages (148 × 210 mm), one album page per sheet – ', pageCount + (pageCount === 1 ? ' page. ' : ' pages. '),
        'In the print dialog: paper size “A5”, scale “100% / Actual size”, margins “None” or “Default”, “Background graphics” on. ',
        'For a PDF, choose “Save as PDF” as the destination. ',
        isAlbum ? 'To print on A4 paper and fold it, choose the “A4 folded booklet” layout above. ' : '',
        'Printed cards are the same size as the album slots (57 × 47.5 mm): cut along the dashed line and stick them in.'];

    const toolbar = h('div', { class: 'print-toolbar' },
      h('div', { class: 'row' },
        h('b', { style: { fontSize: '1.15rem', marginRight: '8px' } }, 'Print: ' + title),
        kindBtns,
        h('span', { class: 'spacer' }),
        printBtn,
        h('button', { class: 'tbtn on-dark', onclick: function () { setPageSize(false); MP.app.go(backHash); } }, 'Close')),
      layoutBtns,
      h('div', { class: 't-note' }, note));

    const holder = h('div', { class: 'print-pages' + (booklet ? ' booklet' : '') }, emptyMsg ? h('div', { class: 't-card' }, emptyMsg) : nodes);
    root.replaceChildren(toolbar, holder);

    const imgs = Array.from(holder.querySelectorAll('img'));
    await Promise.all(imgs.map(function (img) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }));
    if (!holder.isConnected) return;
    printBtn.disabled = !nodes.length;
    printBtn.textContent = 'Print / Save as PDF';
    printBtn.onclick = function () { window.print(); };
  }

  /* Returns a list of elements that stick out of their A5 page (used for verification). */
  function checkOverflow() {
    const problems = [];
    document.querySelectorAll('.ppage').forEach(function (pg, i) {
      const inner = pg.querySelector('.ppage-inner').getBoundingClientRect();
      pg.querySelectorAll('.ppage-inner *').forEach(function (el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.left < inner.left - 0.5 || r.top < inner.top - 0.5 || r.right > inner.right + 0.5 || r.bottom > inner.bottom + 0.5) {
          problems.push({ page: i + 1, el: el.className || el.tagName });
        }
      });
    });
    return problems;
  }

  MP.print = { render: render, checkOverflow: checkOverflow };
})();
