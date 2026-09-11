/* ============================================================
   APEX — itens pendentes do projeto
   ------------------------------------------------------------
   A lista da disciplina era texto morto: seis coisas que faltam
   confirmar, escritas e esquecidas. Aqui elas viram itens que se
   marcam, com o estado guardado neste navegador.

   O que fica salvo e so o que a pessoa fez: quais itens marcou e
   quais itens proprios adicionou. Os seis itens da disciplina sao
   codigo, nao dado — se o enunciado mudar, muda aqui e todo mundo
   recebe a lista nova sem perder o que ja tinha marcado.
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U;
  var KEY = 'apex.tasks';

  /* Lista conferida contra os tres documentos entregues na disciplina
     — formulario de entrega, questionario de escopo e memoria de
     calculo. O que eles ja respondem saiu daqui: equipe, turma,
     professor, prazos e modelo do scanner estao preenchidos. O que
     sobrou e o que continua em branco neles, mais o que a memoria
     declara como estimativa a substituir. */
  var BUILTIN = [
    { id: 'horas',   t: 'Disponibilidade semanal em horas <em>(em branco no formulário e na pergunta 17 do questionário)</em>' },
    { id: 'aprova',  t: 'Aprovação do professor <em>(seção 08 do formulário e perguntas 25 a 27 do questionário, ainda sem preencher)</em>' },
    { id: 'medir',   t: 'Medir o radiador real e substituir as estimativas da seção 4.2 da memória: área frontal, espessura da matriz e área de troca do lado do ar' },
    { id: 'bomba',   t: 'Levantar a vazão da bomba d\'água por catálogo ou bancada <em>(é a maior fonte de incerteza do balanço)</em>' },
    { id: 'critica', t: 'Campanha de coleta que atinja o limite crítico de temperatura <em>(sem ela o critério C8, de antecedência do alerta, fica pendente)</em>' },
    { id: 'rev1',    t: 'Reemitir a memória de cálculo como Rev. 1, com os valores medidos no lugar dos estimados' }
  ];

  var state = { done: {}, custom: [] };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var v = JSON.parse(raw);
      if (v && typeof v === 'object') {
        state.done = v.done && typeof v.done === 'object' ? v.done : {};
        state.custom = Array.isArray(v.custom) ? v.custom : [];
      }
    } catch (e) { /* armazenamento bloqueado: segue com a lista limpa */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function all() {
    return BUILTIN.concat(state.custom.map(function (c) {
      return { id: c.id, t: U.esc(c.t), own: true };
    }));
  }

  function render() {
    var host = document.getElementById('taskBoard');
    if (!host) return;
    var items = all();
    var done = items.filter(function (i) { return state.done[i.id]; }).length;
    var frac = items.length ? done / items.length : 0;

    var h = '<div class="tk-head">' +
      '<div class="tk-bar"><div class="tk-fill" style="--f:' + frac.toFixed(3) + '"></div></div>' +
      '<div class="tk-count"><b>' + done + '</b> de ' + items.length + ' resolvidos</div>' +
      '</div><ul class="tk-list">';

    h += items.map(function (i) {
      var on = !!state.done[i.id];
      return '<li class="tk' + (on ? ' on' : '') + '" data-id="' + U.esc(i.id) + '">' +
        '<button class="tk-box" type="button" aria-pressed="' + on + '" ' +
        'aria-label="' + (on ? 'Desmarcar' : 'Marcar como resolvido') + '">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.4"/></svg></button>' +
        '<span class="tk-txt">' + i.t + '</span>' +
        (i.own ? '<button class="tk-del" type="button" aria-label="Remover este item">×</button>' : '') +
        '</li>';
    }).join('');

    h += '</ul>' +
      '<form class="tk-add" id="tkAdd">' +
      '<input type="text" id="tkNew" placeholder="Somar um item que faltou…" aria-label="Novo item pendente" maxlength="160">' +
      '<button class="btn sm" type="submit">Somar</button>' +
      '</form>';

    host.innerHTML = h;

    var badge = document.getElementById('taskBadge');
    if (badge) {
      var left = items.length - done;
      badge.textContent = left === 0 ? 'tudo resolvido' : left + (left === 1 ? ' item em aberto' : ' itens em aberto');
      badge.className = 'badge' + (left === 0 ? ' ok' : left <= 2 ? ' warn' : '');
    }
  }

  function toggle(id) {
    if (state.done[id]) delete state.done[id]; else state.done[id] = 1;
    save();
    var before = all().filter(function (i) { return state.done[i.id]; }).length;
    render();
    if (ATC.Audio) ATC.Audio.play(state.done[id] ? 'press' : 'tick');
    if (before === all().length && ATC.Motion) {
      ATC.Motion.toast('Todos os itens pendentes resolvidos', null, 3200);
    }
  }

  function init() {
    var host = document.getElementById('taskBoard');
    if (!host) return;
    load();
    render();

    /* um ouvinte no quadro inteiro: as linhas sao redesenhadas a cada
       marcacao, e religar ouvinte em cada uma seria trabalho a toa   */
    host.addEventListener('click', function (ev) {
      var box = ev.target.closest('.tk-box');
      if (box) { toggle(box.closest('.tk').dataset.id); return; }
      var del = ev.target.closest('.tk-del');
      if (del) {
        var id = del.closest('.tk').dataset.id;
        state.custom = state.custom.filter(function (c) { return c.id !== id; });
        delete state.done[id];
        save(); render();
        if (ATC.Audio) ATC.Audio.play('tick');
      }
    });

    host.addEventListener('submit', function (ev) {
      if (!ev.target.matches('#tkAdd')) return;
      ev.preventDefault();
      var input = document.getElementById('tkNew');
      var txt = (input.value || '').trim();
      if (!txt) return;
      state.custom.push({ id: 'own-' + Date.now().toString(36), t: txt });
      save(); render();
      var next = document.getElementById('tkNew');
      if (next) next.focus();
      if (ATC.Audio) ATC.Audio.play('press');
    });
  }

  ATC.Tasks = { init: init, render: render, pending: function () {
    var items = all();
    return items.length - items.filter(function (i) { return state.done[i.id]; }).length;
  } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.ATC = window.ATC || {});
