/* ============================================================
   APEX — paleta de comandos
   ------------------------------------------------------------
   Ctrl+K (ou ⌘K) abre uma busca sobre tudo que a plataforma sabe
   fazer. Existe porque um aplicativo com oito abas e quatro
   dezenas de acoes fica mais rapido de operar pelo teclado do
   que pelo mouse — e porque quem ja sabe onde quer chegar nao
   deveria precisar procurar.
   ============================================================ */
(function (ATC) {
  'use strict';

  var K = {};
  var items = [], veil = null, input = null, list = null, sel = 0, shown = [];

  K.register = function (arr) { items = items.concat(arr); };

  function build() {
    veil = document.createElement('div');
    veil.className = 'cmdk-veil';
    veil.innerHTML =
      '<div class="cmdk" role="dialog" aria-modal="true" aria-label="Paleta de comandos">' +
      '<input type="text" placeholder="O que você quer fazer?" aria-label="Buscar ação" autocomplete="off" spellcheck="false">' +
      '<div class="cmd-list" role="listbox"></div></div>';
    document.body.appendChild(veil);
    input = veil.querySelector('input');
    list = veil.querySelector('.cmd-list');

    veil.addEventListener('mousedown', function (e) { if (e.target === veil) K.close(); });
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); K.close(); }
    });
    list.addEventListener('click', function (e) {
      var el = e.target.closest('[data-i]');
      if (el) run(parseInt(el.dataset.i, 10));
    });
    list.addEventListener('mousemove', function (e) {
      var el = e.target.closest('[data-i]');
      if (el) { sel = parseInt(el.dataset.i, 10); paint(); }
    });
  }

  /* correspondencia por subsequencia: "cadm" encontra
     "CArregar Demonstracao" sem precisar digitar tudo    */
  function score(item, q) {
    if (!q) return 1;
    var hay = (item.label + ' ' + (item.group || '') + ' ' + (item.keys || '')).toLowerCase();
    var qi = 0, s = 0, run = 0;
    for (var i = 0; i < hay.length && qi < q.length; i++) {
      if (hay[i] === q[qi]) { qi++; run++; s += run; }
      else run = 0;
    }
    return qi === q.length ? s : 0;
  }

  function render(q) {
    q = (q || '').trim().toLowerCase();
    shown = items
      .filter(function (it) { return !it.when || it.when(); })
      .map(function (it) { return { it: it, s: score(it, q) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .map(function (r) { return r.it; });

    if (!shown.length) {
      list.innerHTML = '<div class="cmd-empty">Nada encontrado para “' + q + '”.</div>';
      return;
    }
    var html = '', group = null;
    shown.forEach(function (it, i) {
      if (it.group !== group) { group = it.group; html += '<div class="cmd-group">' + group + '</div>'; }
      html += '<div class="cmd" role="option" data-i="' + i + '" aria-selected="false">' +
        '<span class="c-ico">' + (it.icon || '›') + '</span>' +
        '<span>' + it.label + '</span>' +
        (it.hint ? '<span class="c-hint">' + it.hint + '</span>' : '') +
        '</div>';
    });
    list.innerHTML = html;
    sel = 0; paint();
  }

  function paint() {
    list.querySelectorAll('[data-i]').forEach(function (el) {
      var on = parseInt(el.dataset.i, 10) === sel;
      el.setAttribute('aria-selected', String(on));
      if (on) {
        var r = el.getBoundingClientRect(), lr = list.getBoundingClientRect();
        if (r.bottom > lr.bottom) list.scrollTop += r.bottom - lr.bottom + 6;
        else if (r.top < lr.top) list.scrollTop -= lr.top - r.top + 6;
      }
    });
  }

  function move(d) {
    if (!shown.length) return;
    sel = (sel + d + shown.length) % shown.length;
    paint();
    if (ATC.Audio) ATC.Audio.play('tick');
  }

  function run(i) {
    var it = shown[i];
    if (!it) return;
    K.close();
    if (ATC.Audio) ATC.Audio.play('press');
    setTimeout(function () { it.run(); }, 60);
  }

  K.open = function () {
    if (!veil) build();
    veil.classList.add('open');
    input.value = '';
    render('');
    setTimeout(function () { input.focus(); }, 30);
    if (ATC.Audio) ATC.Audio.play('blip');
  };
  K.close = function () {
    if (veil) veil.classList.remove('open');
  };
  K.toggle = function () {
    if (veil && veil.classList.contains('open')) K.close(); else K.open();
  };

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault(); K.toggle();
    }
  });

  ATC.Cmd = K;
})(window.ATC = window.ATC || {});
