/*
 * Picture symbols: every child in a class gets their own coloured shape ("red star", "blue moon"),
 * so children who cannot read yet can still find their tile. 8 shapes x 6 colours = 48 symbols.
 */
window.MP = window.MP || {};

(function () {
  const SHAPES = [
    { id: 'star', name: 'star', d: 'M12 2.3l2.95 6.2 6.75.8-5 4.6 1.35 6.75L12 17.35l-6.05 3.3 1.35-6.75-5-4.6 6.75-.8z' },
    { id: 'heart', name: 'heart', d: 'M12 21s-7.6-4.7-9.7-9.3C.8 8.3 3 4.4 6.7 4.4c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.9 3.9 4.4 7.3C19.6 16.3 12 21 12 21z' },
    { id: 'moon', name: 'moon', d: 'M14.8 2.6a9.4 9.4 0 1 0 6.6 16.1A7.8 7.8 0 0 1 14.8 2.6z' },
    { id: 'sun', name: 'circle', d: 'M12 3.6a8.4 8.4 0 1 0 0 16.8a8.4 8.4 0 1 0 0-16.8z' },
    { id: 'triangle', name: 'triangle', d: 'M12 3l9.8 17H2.2z' },
    { id: 'square', name: 'square', d: 'M6.4 4.2h11.2a2.2 2.2 0 0 1 2.2 2.2v11.2a2.2 2.2 0 0 1-2.2 2.2H6.4a2.2 2.2 0 0 1-2.2-2.2V6.4a2.2 2.2 0 0 1 2.2-2.2z' },
    { id: 'drop', name: 'drop', d: 'M12 2.4c3.7 4.8 6.8 8.6 6.8 12a6.8 6.8 0 0 1-13.6 0c0-3.4 3.1-7.2 6.8-12z' },
    { id: 'diamond', name: 'diamond', d: 'M12 2.2l8.8 9.8-8.8 9.8-8.8-9.8z' }
  ];
  const COLORS = [
    { id: 'red', name: 'Red', fill: '#e5484d' },
    { id: 'blue', name: 'Blue', fill: '#3b7ff0' },
    { id: 'green', name: 'Green', fill: '#24a35a' },
    { id: 'orange', name: 'Orange', fill: '#f39a12' },
    { id: 'purple', name: 'Purple', fill: '#8b5cf6' },
    { id: 'pink', name: 'Pink', fill: '#ea4c9c' }
  ];

  // Order: the first 8 symbols all have different shapes, and every shape/colour pair is used once.
  const LIST = [];
  for (let k = 0; k < COLORS.length; k++) {
    for (let s = 0; s < SHAPES.length; s++) {
      const shape = SHAPES[s], color = COLORS[(s + k) % COLORS.length];
      LIST.push({ id: color.id + '-' + shape.id, label: color.name + ' ' + shape.name, d: shape.d, fill: color.fill });
    }
  }
  const BY_ID = {};
  LIST.forEach(function (x) { BY_ID[x.id] = x; });

  MP.SYMBOLS = LIST;
  MP.SYMBOL_IDS = LIST.map(function (x) { return x.id; });
  MP.symbolLabel = function (id) { return BY_ID[id] ? BY_ID[id].label : ''; };

  /* Returns an <svg> element: the coloured shape on a white disc. Markup is static (no user text). */
  MP.symbolEl = function (id, className) {
    const sym = BY_ID[id];
    const wrap = document.createElement('span');
    wrap.className = 'symbol ' + (className || '');
    if (!sym) { wrap.classList.add('symbol-none'); return wrap; }
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', sym.label);
    wrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="#fff"/>' +
      '<g transform="translate(2.4 2.4) scale(.8)"><path d="' + sym.d + '" fill="' + sym.fill + '" stroke="rgba(0,0,0,.18)" stroke-width=".6" stroke-linejoin="round"/></g></svg>';
    return wrap;
  };
})();
