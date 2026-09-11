/* ============================================================
   APEX — SPEED MODE
   ------------------------------------------------------------
   O modo divertido, e agora com um centro so: a tela de
   remapeamento. Tudo o que sobrou existe para servir a ela — o
   que se programa (mapas, pressao, mistura) fica na tela
   principal, o que se observa fica na bancada, e o dinamometro
   diz se o radiador de verdade aguentaria o que voce pediu.

   O que saiu daqui saiu por acumulo, nao por defeito: as telas
   que reetiquetavam o dado termico como grandeza de motor
   (Engine, Turbo, Injectors, Logger, Maps, Diagnostics,
   Telemetry) e o painel de ponteiros com a telemetria. Eram
   bonitas e nao levavam a lugar nenhum — e eram justamente o que
   fazia o speed mode parecer preso a coleta carregada.
   ============================================================ */
(function (ATC) {
  'use strict';

  var SP = {};
  var U = ATC.U, M = ATC.Motion, A = ATC.Audio;
  var app = null;                 /* preenchido por app.js */
  var dyno = { running: false };

  function $(s) { return document.querySelector(s); }

  /* ============================================================
     De onde o speed mode tira numero
     ------------------------------------------------------------
     Antes ele lia direto o estado do aplicativo, e sem coleta
     carregada ficava tudo vazio — painel morto, ECU dizendo "no
     data", dinamometro sem rodar. Isso esta errado para o que esta
     parte e: um brinquedo, que tem de estar vivo no primeiro clique.

     Entao ele passa a ter telemetria propria. Quando ha coleta de
     verdade carregada, usa a coleta. Quando nao ha, gera a coleta
     sintetica pelo mesmo gerador e pelo mesmo pipeline termico do
     projeto — nada de numero inventado a mao, que sairia incoerente
     entre uma tela e outra. Fica claramente rotulado como
     demonstracao, e o painel comeca rodando sozinho.
     ============================================================ */
  var demoCache = null;

  function demoData() {
    if (demoCache) return demoCache;
    var D = ATC.Demo, T = ATC.Thermal;
    if (!D || !T) return null;
    var p = (app && app.state() && app.state().params) || T.defaults();
    var ds = D.generate(D.datasets[0].id);
    var t0 = ds.rows[0].t;
    var rows = ds.rows.map(function (r) {
      return {
        t: r.t - t0, ts: r.ts, ect: r.ect, rpm: r.rpm, speed: r.speed, load: r.load,
        iat: r.iat, tAmb: r.tAmb, tIn: r.tIn, tOut: r.tOut, fan: r.fan
      };
    });
    var proc = T.process(rows, p);
    demoCache = {
      proc: proc, sum: T.summary(proc), params: p,
      meta: ds.meta, fit: null, alerts: null, anom: null, isDemo: true
    };
    return demoCache;
  }

  /* a fonte de dados do speed mode: a coleta real quando existe,
     a de demonstracao quando nao                                  */
  function S() {
    var st = app ? app.state() : null;
    if (st && st.proc && st.proc.rows && st.proc.rows.length) return st;
    return demoData();
  }
  function usingDemo() {
    var st = app ? app.state() : null;
    return !(st && st.proc && st.proc.rows && st.proc.rows.length);
  }

  /* ============================================================
     1. PARTIDA
     ============================================================ */
  var BOOT = [
    ['Connecting ECU', 'ok'],
    ['Searching CAN network', 'ok'],
    ['ECU found — APEX-PERF 4.2.1', 'ok'],
    ['Reading firmware', 'ok'],
    ['Fuel maps loaded', 'ok'],
    ['Ignition maps loaded', 'ok'],
    ['Sensors connected', 'ok'],
    ['Injectors online', 'ok'],
    ['Turbo control active', 'ok'],
    ['Lambda connected', 'ok'],
    ['Knock sensor online', 'ok'],
    ['Data logger running', 'ok'],
    ['Thermal core linked', 'ok'],
    ['Vehicle ready', 'k'],
    ['APEX Performance connected', 'k']
  ];

  function boot(done) {
    var layer = $('#bootLayer'), log = $('#bootLog'), bar = $('#bootBar'), sig = $('#bootSig');
    if (!layer) { done(); return; }
    layer.hidden = false;
    sig.hidden = true;
    log.textContent = '';
    bar.style.transform = 'scaleX(0)';
    requestAnimationFrame(function () { layer.classList.add('on'); });

    if (A) A.play('ignition', 0.05);

    var reduced = M && M.reduced();
    var step = reduced ? 34 : 118;
    var i = 0, html = '';

    function line() {
      if (i >= BOOT.length) { finish(); return; }
      var l = BOOT[i++];
      html += '<span class="' + (l[1] === 'k' ? 'k' : '') + '">' + l[0] + '</span>' +
              '<span class="d"> ' + dots(l[0]) + ' </span>' +
              (l[1] === 'k' ? '<span class="k">READY</span>' : '<span>OK</span>') + '\n';
      log.innerHTML = html + '<span class="caret"></span>';
      bar.style.transform = 'scaleX(' + (i / BOOT.length).toFixed(3) + ')';
      if (A && i % 2 === 0) A.play('tick');
      setTimeout(line, step);
    }
    function dots(s) {
      var n = Math.max(2, 30 - s.length);
      return new Array(n).join('.');
    }
    function finish() {
      sig.hidden = false;
      if (A) A.play('turbo');
      setTimeout(function () {
        layer.classList.add('out');
        var shell = $('#shell');
        if (shell && !reduced) {
          shell.classList.add('glitch');
          setTimeout(function () { shell.classList.remove('glitch'); }, 700);
        }
        setTimeout(function () {
          layer.hidden = true;
          layer.classList.remove('on', 'out');
          done();
        }, 360);
      }, reduced ? 200 : 760);
    }
    setTimeout(line, reduced ? 60 : 220);
  }

  /* ============================================================
     2. TROCA DE MODO
     ============================================================ */
  SP.enter = function () {
    if (document.documentElement.dataset.mode === 'speed') return;
    boot(function () {
      document.documentElement.dataset.mode = 'speed';
      document.querySelector('meta[name=theme-color]').setAttribute('content', '#06070a');
      $('#btnSpeed').setAttribute('aria-pressed', 'true');
      try { localStorage.setItem('apex.mode', 'speed'); } catch (e) {}
      if (app) app.modeChanged('speed');
      SP.mount();
      if (M) M.toast('Speed mode ativo — os dados continuam os mesmos', null, 3200);
    });
  };

  SP.exit = function () {
    if (document.documentElement.dataset.mode !== 'speed') return;
    SP.unmount();
    document.documentElement.dataset.mode = 'work';
    document.querySelector('meta[name=theme-color]').setAttribute('content', '#f6f7f9');
    $('#btnSpeed').setAttribute('aria-pressed', 'false');
    try { localStorage.setItem('apex.mode', 'work'); } catch (e) {}
    if (A) A.play('relay');
    if (app) app.modeChanged('work');
  };

  SP.toggle = function () {
    if (document.documentElement.dataset.mode === 'speed') SP.exit(); else SP.enter();
  };

  SP.mount = function () {
    if (ATC.Cockpit) ATC.Cockpit.mount();
    /* o ponto de operacao ao vivo le o simulador; quem faz ele
       avancar e o laco do cockpit, entao aqui so se olha */
    if (!stopLive && M) stopLive = M.onFrame(function (dt) { liveFrame(dt); });
    SP.renderStatic();
  };
  SP.unmount = function () {
    if (ATC.Cockpit) ATC.Cockpit.unmount();
    if (stopLive) { stopLive(); stopLive = null; }
  };

  function tile(l, v, u, cls, frac) {
    return '<div class="ecu-tile ' + (cls || '') + '">' +
      '<div class="et-l">' + l + '</div>' +
      '<div class="et-v">' + v + (u ? '<small>' + u + '</small>' : '') + '</div>' +
      (frac === undefined ? '' : '<div class="et-bar"><i style="--f:' + U.clamp(frac, 0, 1).toFixed(3) + '"></i></div>') +
      '</div>';
  }

  /* ============================================================
     Tela de remapeamento
     ------------------------------------------------------------
     Uma tabela rotacao x carga que se edita celula a celula, com a
     superficie do mapa ao lado e o resultado da mudanca aparecendo
     na hora em potencia, torque e nos dois jeitos de estragar tudo.
     Ficcao — mas ficcao com os compromissos certos.
     ============================================================ */
  /* ------------------------------------------------------------
     Estado da tela: onde esta o cursor, o que esta selecionado, o
     que da para desfazer, e por onde o motor andou.
     ------------------------------------------------------------ */
  var TSEL = { i: 4, j: 4 };              /* celula ancora */
  var TBOX = { i0: 4, j0: 4, i1: 4, j1: 4 };  /* bloco selecionado */
  var drag = null;                        /* arrasto em curso */
  var clip = null;                        /* area copiada */
  var undoS = [], redoS = [];             /* pilhas de desfazer */
  var UNDO_MAX = 40;
  var deltaView = false;                  /* mostrar diferenca do original */
  var trace = null, traceOn = true;       /* por onde o motor passou */
  var liveCell = { i: -1, j: -1 };
  var stopLive = null;

  function TNaxes() { return { ni: ATC.Tune.rpmAxis.length, nj: ATC.Tune.loadAxis.length }; }

  function traceGrid() {
    var a = TNaxes();
    if (trace && trace.length === a.nj && trace[0].length === a.ni) return trace;
    trace = [];
    for (var j = 0; j < a.nj; j++) {
      var r = [];
      for (var i = 0; i < a.ni; i++) r.push(0);
      trace.push(r);
    }
    return trace;
  }

  function box() {
    return {
      i0: Math.min(TBOX.i0, TBOX.i1), i1: Math.max(TBOX.i0, TBOX.i1),
      j0: Math.min(TBOX.j0, TBOX.j1), j1: Math.max(TBOX.j0, TBOX.j1)
    };
  }
  function boxCount() { var b = box(); return (b.i1 - b.i0 + 1) * (b.j1 - b.j0 + 1); }
  function inBox(i, j) { var b = box(); return i >= b.i0 && i <= b.i1 && j >= b.j0 && j <= b.j1; }
  function eachSel(fn) {
    var b = box();
    for (var j = b.j0; j <= b.j1; j++) for (var i = b.i0; i <= b.i1; i++) fn(i, j);
  }
  function setAnchor(i, j, extend) {
    var a = TNaxes();
    i = U.clamp(i, 0, a.ni - 1); j = U.clamp(j, 0, a.nj - 1);
    TSEL.i = i; TSEL.j = j;
    if (extend) { TBOX.i1 = i; TBOX.j1 = j; }
    else { TBOX.i0 = TBOX.i1 = i; TBOX.j0 = TBOX.j1 = j; }
  }

  /* ------------------------------------------------------------
     Desfazer: guarda o estado inteiro antes de cada edicao. Sao
     quatro tabelas de 48 numeros — copiar tudo custa menos que
     manter um diario de alteracoes correto.
     ------------------------------------------------------------ */
  function mark() {
    undoS.push(ATC.Tune.snapshot());
    if (undoS.length > UNDO_MAX) undoS.shift();
    redoS.length = 0;
  }
  function undo() {
    if (!undoS.length) return false;
    redoS.push(ATC.Tune.snapshot());
    ATC.Tune.restore(undoS.pop());
    return true;
  }
  function redo() {
    if (!redoS.length) return false;
    undoS.push(ATC.Tune.snapshot());
    ATC.Tune.restore(redoS.pop());
    return true;
  }

  /* A tela principal do speed mode. Desenha e religa de uma vez: o
     conteudo e refeito por inteiro a cada troca de mapa ou preset,
     entao os ouvintes ficam no painel, que sobrevive, e nao nas
     celulas, que somem. */
  function renderRemap() {
    var pane = $('#remapPane');
    if (!pane) return;
    pane.innerHTML = tuneHtml();
    wireTune();
  }

  function tuneHtml() {
    var TN = ATC.Tune;
    if (!TN) return '<h3>Mapas</h3><p class="ep-sub">Módulo indisponível.</p>';
    var st = TN.state();
    var key = TN.openMap();
    var m = TN.maps[key];
    var grid = st[key];
    var stock = TN.stock(key);

    var h = '<p class="ep-sub">' + m.note + '</p>';

    h += '<div class="tune-bar">';
    Object.keys(TN.maps).forEach(function (k) {
      h += '<button class="tune-tab" data-map="' + k + '" aria-selected="' + (k === key) + '">' +
        TN.maps[k].name + '</button>';
    });
    h += '<span class="tune-sp"></span>';
    Object.keys(TN.presets).forEach(function (k) {
      h += '<button class="tune-preset" data-preset="' + k + '">' + TN.presets[k].name + '</button>';
    });
    h += '</div>';

    h += '<div class="tune-wrap">';
    h += '<div class="tune-grid-box"><table class="tune-grid' + (deltaView ? ' delta' : '') +
      '"><thead><tr><th class="corner">carga \\ rpm</th>' +
      TN.rpmAxis.map(function (r) { return '<th>' + U.br(r, 0) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var j = TN.loadAxis.length - 1; j >= 0; j--) {
      h += '<tr><th>' + U.br(TN.loadAxis[j], 0) + ' %</th>';
      for (var i = 0; i < TN.rpmAxis.length; i++) {
        h += cellHtml(i, j, grid, stock, m);
      }
      h += '</tr>';
    }
    h += '</tbody></table>';

    /* ---- barra de ferramentas ---- */
    h += '<div class="tune-ctl">' +
      '<button class="btn sm" data-adj="-1" title="Diminuir a seleção (tecla −)">−</button>' +
      '<button class="btn sm" data-adj="1" title="Aumentar a seleção (tecla +)">+</button>' +
      '<input type="number" id="tuneVal" step="' + m.step + '" value="' + grid[TSEL.j][TSEL.i].toFixed(m.dec) + '" aria-label="Valor da célula">' +
      '<span class="tune-unit">' + m.unit + '</span>' +
      '<span class="tune-div"></span>' +
      '<input type="number" id="tuneScale" step="1" value="100" aria-label="Escala em porcento">' +
      '<span class="tune-unit">%</span>' +
      '<button class="btn sm ghost" data-scale="1" title="Multiplicar a seleção por esta porcentagem">escalar</button>' +
      '</div>';
    h += '<div class="tune-ctl">' +
      '<button class="btn sm ghost" data-interp="1" title="Interpolar entre as bordas da seleção (tecla I)">interpolar</button>' +
      '<button class="btn sm ghost" data-smooth="1" title="Suavizar a seleção (tecla S)">suavizar</button>' +
      '<button class="btn sm ghost" data-copy="1" title="Copiar a seleção (Ctrl+C)">copiar</button>' +
      '<button class="btn sm ghost" data-paste="1" title="Colar a partir da âncora (Ctrl+V)">colar</button>' +
      '<span class="tune-div"></span>' +
      '<button class="btn sm ghost" data-undo="1" title="Desfazer (Ctrl+Z)">↶</button>' +
      '<button class="btn sm ghost" data-redo="1" title="Refazer (Ctrl+Y)">↷</button>' +
      '<span class="tune-div"></span>' +
      '<button class="btn sm ghost' + (deltaView ? ' on' : '') + '" data-delta="1" title="Mostrar a diferença para o mapa de fábrica">Δ original</button>' +
      '<button class="btn sm ghost' + (traceOn ? ' on' : '') + '" data-trace="1" title="Marcar as células por onde o motor passou">rastro</button>' +
      '<button class="btn sm ghost" data-reset="1" title="Voltar todos os mapas de fábrica">original</button>' +
      '</div>';
    h += '<p class="tune-sel" id="tuneSel"></p>';
    h += '<p class="tune-hint">Arraste para selecionar um bloco. Setas andam, <b>Shift+setas</b> esticam a seleção, ' +
      '<b>+</b> e <b>−</b> ajustam, <b>I</b> interpola, <b>S</b> suaviza, <b>Ctrl+C/V</b> copia e cola, ' +
      '<b>Ctrl+Z</b> desfaz. O anel branco é onde o motor está agora.</p>';
    h += '</div>';

    h += '<div class="tune-side">' +
      '<div class="chart-box"><canvas id="tuneSurf"></canvas></div>' +
      '<div class="tune-live" id="tuneLive"></div>' +
      '<div id="tuneOut"></div></div>';
    h += '</div>';
    return h;
  }

  /* uma celula: valor, cor pela faixa do mapa, e as marcas de
     selecao, ancora, rastro e ponto de operacao */
  function cellHtml(i, j, grid, stock, m) {
    var v = grid[j][i];
    var t = (v - m.min) / Math.max(m.max - m.min, 1e-9);
    var cls = 'tc';
    if (i === TSEL.i && j === TSEL.j) cls += ' on';
    if (inBox(i, j)) cls += ' sel';
    var tg = traceGrid();
    var hit = traceOn && tg[j] ? U.clamp(tg[j][i] / 40, 0, 1) : 0;
    var txt, style;
    if (deltaView) {
      var d = v - stock[j][i];
      var rel = U.clamp(d / Math.max(m.max - m.min, 1e-9) * 3, -1, 1);
      txt = (d > 0 ? '+' : '') + U.br(d, m.dec);
      style = '--t:' + t.toFixed(3) + ';--d:' + rel.toFixed(3) + ';--hit:' + hit.toFixed(2);
      if (Math.abs(d) < Math.pow(10, -m.dec) / 2) cls += ' same';
    } else {
      txt = U.br(v, m.dec);
      style = '--t:' + t.toFixed(3) + ';--hit:' + hit.toFixed(2);
    }
    return '<td class="' + cls + '" data-i="' + i + '" data-j="' + j + '" style="' + style + '">' + txt + '</td>';
  }

  function tunePaint() {
    var TN = ATC.Tune, G = ATC.Charts;
    if (!TN || !app) return;
    var key = TN.openMap(), m = TN.maps[key], grid = TN.state()[key];

    G.surface($('#tuneSurf'), {
      height: 300, z: grid, zMin: m.min, zMax: m.max,
      title: 'Mapa de ' + m.name.toLowerCase(),
      x: { min: TN.rpmAxis[0], max: TN.rpmAxis[TN.rpmAxis.length - 1],
           fmt: function (v) { return U.br(v / 1000, 1) + 'k'; } },
      y: { min: TN.loadAxis[0], max: TN.loadAxis[TN.loadAxis.length - 1],
           fmt: function (v) { return U.br(v, 0); } },
      xLabel: 'rotação (rpm)', yLabel: 'carga (%)', zLabel: m.name + ' (' + m.unit + ')',
      zFmt: function (v) { return U.br(v, m.dec); }, zTicks: 4, contours: 7,
      ramp: m.ramp, markerColor: '#ffffff',
      marker: { x: TN.rpmAxis[TSEL.i], y: TN.loadAxis[TSEL.j], label: U.br(grid[TSEL.j][TSEL.i], m.dec) + ' ' + m.unit },
      hint: 'arraste para girar'
    });

    paintSelInfo();

    var sw = TN.sweep();
    var danger = sw.knockPct > 2 || sw.leanPct > 2;
    var out = $('#tuneOut');
    if (!out) return;
    out.innerHTML =
      '<div class="ecu-grid" style="margin-top:12px">' +
      tile('POTÊNCIA MÁXIMA', U.br(sw.peakPower.power, 0), 'cv a ' + U.br(sw.peakPower.rpm, 0) + ' rpm',
           danger ? 'warn' : 'good', sw.peakPower.power / 400) +
      tile('TORQUE MÁXIMO', U.br(sw.peakTorque.torque, 0), 'N·m a ' + U.br(sw.peakTorque.rpm, 0) + ' rpm',
           danger ? 'warn' : 'good', sw.peakTorque.torque / 500) +
      '</div>' +
      '<div class="tune-alert' + (danger ? ' bad' : ' ok') + '">' +
      (sw.knockPct > 2
        ? '<b>DETONAÇÃO</b> em ' + U.br(sw.knockPct, 0) + '% da faixa — o avanço passou do limite que esta pressão aguenta. Recue a ignição ou baixe a pressão.'
        : sw.leanPct > 2
          ? '<b>MISTURA POBRE</b> em ' + U.br(sw.leanPct, 0) + '% da faixa sob carga alta — falta combustível para o ar que está entrando. É assim que se derrete pistão.'
          : '<b>MAPA LIMPO</b> — sem detonação e sem empobrecimento na faixa varrida.') +
      '</div>';
  }

  /* a linha que resume a selecao: quantas celulas, e o que ha
     dentro delas. Editar em bloco sem ver o bloco e chute. */
  function paintSelInfo() {
    var e = $('#tuneSel');
    if (!e) return;
    var TN = ATC.Tune, m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
    var vs = [];
    eachSel(function (i, j) { vs.push(g[j][i]); });
    var b = box();
    var n = vs.length;
    var stock = TN.stock(TN.openMap());
    var dsum = 0;
    eachSel(function (i, j) { dsum += g[j][i] - stock[j][i]; });
    e.innerHTML =
      'seleção <b>' + (b.i1 - b.i0 + 1) + '×' + (b.j1 - b.j0 + 1) + '</b> (' + n + ' célula' + (n > 1 ? 's' : '') + ')' +
      ' · mín ' + U.br(U.min(vs), m.dec) + ' · méd ' + U.br(U.mean(vs), m.dec) +
      ' · máx ' + U.br(U.max(vs), m.dec) + ' ' + m.unit +
      ' · média ' + (dsum / n >= 0 ? '+' : '') + U.br(dsum / n, m.dec) + ' sobre o original' +
      (clip ? ' · área copiada ' + clip[0].length + '×' + clip.length : '');
  }

  function tuneSet(i, j, v) {
    var TN = ATC.Tune, m = TN.maps[TN.openMap()];
    var g = TN.state()[TN.openMap()];
    g[j][i] = U.clamp(v, m.min, m.max);
    TN.save();
  }

  /* ------------------------------------------------------------
     Operacoes de bloco
     ------------------------------------------------------------ */
  function opAdjust(dir) {
    var m = ATC.Tune.maps[ATC.Tune.openMap()], g = ATC.Tune.state()[ATC.Tune.openMap()];
    mark();
    eachSel(function (i, j) { tuneSet(i, j, g[j][i] + dir * m.step); });
  }
  function opScale(pct) {
    var g = ATC.Tune.state()[ATC.Tune.openMap()];
    mark();
    eachSel(function (i, j) { tuneSet(i, j, g[j][i] * pct / 100); });
  }
  /* interpolacao bilinear a partir dos quatro cantos da selecao: e
     a operacao que mais se usa numa mesa de verdade, porque mapa
     bom e mapa liso entre dois pontos que voce mediu */
  function opInterp() {
    var b = box(), g = ATC.Tune.state()[ATC.Tune.openMap()];
    var ni = b.i1 - b.i0, nj = b.j1 - b.j0;
    if (ni === 0 && nj === 0) return false;
    mark();
    var c00 = g[b.j0][b.i0], c10 = g[b.j0][b.i1], c01 = g[b.j1][b.i0], c11 = g[b.j1][b.i1];
    for (var j = b.j0; j <= b.j1; j++) {
      for (var i = b.i0; i <= b.i1; i++) {
        var tx = ni ? (i - b.i0) / ni : 0, ty = nj ? (j - b.j0) / nj : 0;
        tuneSet(i, j, c00 * (1 - tx) * (1 - ty) + c10 * tx * (1 - ty) +
                      c01 * (1 - tx) * ty + c11 * tx * ty);
      }
    }
    return true;
  }
  function opSmooth() {
    var g = ATC.Tune.state()[ATC.Tune.openMap()];
    var cp = g.map(function (r) { return r.slice(); });
    mark();
    eachSel(function (i, j) {
      var sum = 0, n = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var jj = j + dj, ii = i + di;
        if (cp[jj] && isFinite(cp[jj][ii])) { sum += cp[jj][ii]; n++; }
      }
      tuneSet(i, j, sum / n);
    });
  }
  function opCopy() {
    var b = box(), g = ATC.Tune.state()[ATC.Tune.openMap()];
    clip = [];
    for (var j = b.j0; j <= b.j1; j++) clip.push(g[j].slice(b.i0, b.i1 + 1));
  }
  function opPaste() {
    if (!clip) return false;
    var a = TNaxes();
    mark();
    for (var j = 0; j < clip.length; j++) {
      for (var i = 0; i < clip[j].length; i++) {
        var jj = TSEL.j + j, ii = TSEL.i + i;
        if (jj < a.nj && ii < a.ni) tuneSet(ii, jj, clip[j][i]);
      }
    }
    TBOX.i0 = TSEL.i; TBOX.j0 = TSEL.j;
    TBOX.i1 = Math.min(TSEL.i + clip[0].length - 1, a.ni - 1);
    TBOX.j1 = Math.min(TSEL.j + clip.length - 1, a.nj - 1);
    return true;
  }

  function wireTune() {
    var TN = ATC.Tune;
    var pane = $('#remapPane');
    if (!pane || !TN) return;
    tunePaint();

    /* os campos sao refeitos a cada render, entao sao religados a
       cada render; o resto vive no painel, que sobrevive */
    var val = document.getElementById('tuneVal');
    if (val) val.addEventListener('change', function () {
      mark();
      tuneSet(TSEL.i, TSEL.j, parseFloat(val.value));
      refreshTune();
    });

    if (pane.__w) return;
    pane.__w = 1;

    /* ---- arrasto para selecionar ---- */
    pane.addEventListener('pointerdown', function (ev) {
      var cell = ev.target.closest('.tc');
      if (!cell) return;
      ev.preventDefault();
      pane.focus();
      var i = +cell.dataset.i, j = +cell.dataset.j;
      if (ev.shiftKey) { TSEL.i = i; TSEL.j = j; TBOX.i1 = i; TBOX.j1 = j; }
      else { setAnchor(i, j, false); }
      drag = true;
      paintCells();
      if (A) A.play('tick');
    });
    pane.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var cell = ev.target.closest('.tc');
      if (!cell) return;
      var i = +cell.dataset.i, j = +cell.dataset.j;
      if (i === TBOX.i1 && j === TBOX.j1) return;
      TBOX.i1 = i; TBOX.j1 = j; TSEL.i = i; TSEL.j = j;
      paintCells();
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      refreshTune();
    });

    /* ---- botoes ---- */
    pane.addEventListener('click', function (ev) {
      var tab = ev.target.closest('[data-map]');
      if (tab) { TN.openMap(tab.dataset.map); renderRemap(); if (A) A.play('tick'); return; }

      var pre = ev.target.closest('[data-preset]');
      if (pre) {
        mark();
        TN.applyPreset(pre.dataset.preset);
        renderRemap();
        if (A) A.play('relay');
        if (M) M.toast('Mapa ' + TN.presets[pre.dataset.preset].name + ' carregado', null, 2400);
        return;
      }
      var adj = ev.target.closest('[data-adj]');
      if (adj) { opAdjust(+adj.dataset.adj); refreshTune(); return; }

      var sc = ev.target.closest('[data-scale]');
      if (sc) {
        var pct = parseFloat((document.getElementById('tuneScale') || {}).value);
        if (!isFinite(pct)) return;
        opScale(pct); refreshTune(); if (A) A.play('press');
        if (M) M.toast('Seleção escalada para ' + U.br(pct, 0) + ' %', null, 1800);
        return;
      }
      if (ev.target.closest('[data-interp]')) {
        if (opInterp()) { refreshTune(); if (A) A.play('turbo'); }
        else if (M) M.toast('Selecione um bloco antes de interpolar', null, 2200);
        return;
      }
      if (ev.target.closest('[data-smooth]')) { opSmooth(); refreshTune(); if (A) A.play('turbo'); return; }
      if (ev.target.closest('[data-copy]')) {
        opCopy(); paintSelInfo(); if (A) A.play('tick');
        if (M) M.toast('Área copiada', null, 1500);
        return;
      }
      if (ev.target.closest('[data-paste]')) {
        if (opPaste()) { refreshTune(); if (A) A.play('press'); }
        else if (M) M.toast('Nada copiado ainda', null, 1800);
        return;
      }
      if (ev.target.closest('[data-undo]')) {
        if (undo()) { refreshTune(); if (A) A.play('relay'); }
        else if (M) M.toast('Nada a desfazer', null, 1500);
        return;
      }
      if (ev.target.closest('[data-redo]')) {
        if (redo()) { refreshTune(); if (A) A.play('relay'); }
        else if (M) M.toast('Nada a refazer', null, 1500);
        return;
      }
      if (ev.target.closest('[data-delta]')) {
        deltaView = !deltaView; renderRemap(); if (A) A.play('tick');
        if (M) M.toast(deltaView ? 'Mostrando a diferença para o mapa de fábrica' : 'Mostrando os valores do mapa', null, 2400);
        return;
      }
      if (ev.target.closest('[data-trace]')) {
        traceOn = !traceOn;
        if (!traceOn) trace = null;
        renderRemap(); if (A) A.play('tick');
        if (M) M.toast(traceOn ? 'Rastro ligado — as células acesas são por onde o motor passou' : 'Rastro desligado', null, 2600);
        return;
      }
      if (ev.target.closest('[data-reset]')) {
        mark();
        TN.reset(); renderRemap(); if (A) A.play('relay');
        if (M) M.toast('Mapas de fábrica restaurados', null, 2200);
      }
    });

    /* ---- teclado ---- */
    pane.addEventListener('keydown', function (ev) {
      var g = TN.state()[TN.openMap()], m = TN.maps[TN.openMap()];
      var k = ev.key, done = true;
      var ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && (k === 'z' || k === 'Z')) { if (!(ev.shiftKey ? redo() : undo())) done = false; }
      else if (ctrl && (k === 'y' || k === 'Y')) { if (!redo()) done = false; }
      else if (ctrl && (k === 'c' || k === 'C')) { opCopy(); paintSelInfo(); done = false; ev.preventDefault(); }
      else if (ctrl && (k === 'v' || k === 'V')) { if (!opPaste()) done = false; }
      else if (ctrl && (k === 'a' || k === 'A')) {
        var a = TNaxes();
        TBOX.i0 = 0; TBOX.j0 = 0; TBOX.i1 = a.ni - 1; TBOX.j1 = a.nj - 1;
      }
      else if (k === 'ArrowRight') setAnchor(TSEL.i + 1, TSEL.j, ev.shiftKey);
      else if (k === 'ArrowLeft') setAnchor(TSEL.i - 1, TSEL.j, ev.shiftKey);
      else if (k === 'ArrowUp') setAnchor(TSEL.i, TSEL.j + 1, ev.shiftKey);
      else if (k === 'ArrowDown') setAnchor(TSEL.i, TSEL.j - 1, ev.shiftKey);
      else if (k === '+' || k === '=') opAdjust(1);
      else if (k === '-' || k === '_') opAdjust(-1);
      else if (k === 'i' || k === 'I') opInterp();
      else if (k === 's' || k === 'S') opSmooth();
      else done = false;
      if (done) { ev.preventDefault(); refreshTune(); }
    });
    pane.setAttribute('tabindex', '0');
  }

  /* redesenha so as celulas, sem tocar no resto da tela */
  function paintCells() {
    var TN = ATC.Tune, m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
    var stock = TN.stock(TN.openMap()), tg = traceGrid();
    var pane = $('#remapPane');
    if (!pane) return;
    pane.querySelectorAll('.tc').forEach(function (c) {
      var i = +c.dataset.i, j = +c.dataset.j, v = g[j][i];
      var txt = deltaView ? (function () {
        var d = v - stock[j][i];
        return (d > 0 ? '+' : '') + U.br(d, m.dec);
      })() : U.br(v, m.dec);
      if (c.textContent !== txt) c.textContent = txt;
      c.style.setProperty('--t', ((v - m.min) / Math.max(m.max - m.min, 1e-9)).toFixed(3));
      if (deltaView) {
        var d2 = v - stock[j][i];
        c.style.setProperty('--d', U.clamp(d2 / Math.max(m.max - m.min, 1e-9) * 3, -1, 1).toFixed(3));
        c.classList.toggle('same', Math.abs(d2) < Math.pow(10, -m.dec) / 2);
      }
      if (traceOn) c.style.setProperty('--hit', U.clamp(tg[j][i] / 40, 0, 1).toFixed(2));
      c.classList.toggle('on', i === TSEL.i && j === TSEL.j);
      c.classList.toggle('sel', inBox(i, j));
      c.classList.toggle('live', i === liveCell.i && j === liveCell.j);
    });
  }

  /* redesenha a tabela, a lateral e a leitura da selecao */
  function refreshTune() {
    paintCells();
    var TN = ATC.Tune, m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
    var val = document.getElementById('tuneVal');
    if (val) val.value = g[TSEL.j][TSEL.i].toFixed(m.dec);
    tunePaint();
  }

  /* ------------------------------------------------------------
     Ponto de operacao ao vivo
     ------------------------------------------------------------
     A celula por onde o motor esta passando agora ganha um anel, e
     o rastro conta quantas vezes cada uma foi visitada. E o que
     transforma a tabela de planilha em instrumento: da para ver
     que metade do mapa nunca e usada na rua.
     ------------------------------------------------------------ */
  var liveAcc = 0;
  function liveFrame(dt) {
    if (!SP.isOn() || !ATC.Sim || !ATC.Tune) return;
    var tab = document.getElementById('tab-remap');
    if (!tab || tab.hidden) return;
    liveAcc += dt;
    if (liveAcc < 0.09) return;
    liveAcc = 0;

    var s = ATC.Sim.read();
    var TN = ATC.Tune;
    var load = U.clamp(20 + s.tpsSm * 0.8, 20, 100);
    var i = nearest(TN.rpmAxis, s.rpm), j = nearest(TN.loadAxis, load);
    var tg = traceGrid();
    if (traceOn) tg[j][i] = Math.min(tg[j][i] + 1, 60);

    var live = $('#tuneLive');
    if (live) {
      var m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
      live.innerHTML =
        '<span class="tl-l">ONDE O MOTOR ESTÁ</span>' +
        '<span class="tl-v">' + U.br(s.rpm, 0) + ' rpm · ' + U.br(load, 0) + ' % carga</span>' +
        '<span class="tl-m">' + m.name + ' aplicado: <b>' +
        U.br(TN.at(g, U.clamp(s.rpm, TN.rpmAxis[0], TN.rpmAxis[TN.rpmAxis.length - 1]), load), m.dec) +
        ' ' + m.unit + '</b></span>';
    }
    /* repintar as 48 celulas dez vezes por segundo por causa de uma
       so que mudou e desperdicio: mexe-se apenas nas afetadas */
    var pane = $('#remapPane');
    if (!pane) return;
    if (traceOn) {
      var hot = pane.querySelector('.tc[data-i="' + i + '"][data-j="' + j + '"]');
      if (hot) hot.style.setProperty('--hit', U.clamp(tg[j][i] / 40, 0, 1).toFixed(2));
    }
    if (i === liveCell.i && j === liveCell.j) return;
    var old = pane.querySelector('.tc.live');
    if (old) old.classList.remove('live');
    liveCell.i = i; liveCell.j = j;
    var now = pane.querySelector('.tc[data-i="' + i + '"][data-j="' + j + '"]');
    if (now) now.classList.add('live');
  }
  function nearest(axis, v) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < axis.length; i++) {
      var d = Math.abs(axis[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /* ============================================================
     7. DYNO — varredura de rotacao
     ============================================================ */
  function runDyno() {
    if (dyno.running) return;
    var st = S();
    if (!st || !st.proc) { if (M) M.toast('Carregue uma coleta primeiro', 'warn'); return; }
    var TN = ATC.Tune, G = ATC.Charts;
    var COL = app.colors();

    /* ponto termico de referencia: media da parte util da coleta */
    var rows = st.proc.rows.filter(function (d) { return !d.warmup && isFinite(d.eps); });
    if (!rows.length) rows = st.proc.rows;
    var tAmb = 0, n = 0;
    rows.forEach(function (d) { if (isFinite(d.tAmb)) { tAmb += d.tAmb; n++; } });
    tAmb /= n || 1;
    /* A capacidade do radiador tem de ser avaliada na condicao do pico,
       nao na media do ciclo urbano: la o ar mal passa pelo nucleo. A
       condicao declarada e 100 km/h com ventilador, liquido a 100 C —
       e o modelo usado carrega o fator de calibracao da coleta.      */
    var vRef = 100, tHot = 100;

    dyno.running = true;
    $('#btnDyno').disabled = true;
    if (A) A.play('ignition');

    var rpm0 = 1200, rpm1 = 6400, dur = 3.0, t = 0;
    var pw = [], tq = [], heat = [];
    var peakP = 0, peakPRpm = 0, peakT = 0, peakTRpm = 0, peakHeat = 0, knock = false, lean = false;

    M.onFrame(function (dt) {
      t += dt;
      var f = U.clamp(t / dur, 0, 1);
      /* a rotacao sobe como um motor sob carga no rolo */
      var rpm = rpm0 + (rpm1 - rpm0) * (1 - Math.pow(1 - f, 1.7));

      var e = TN ? TN.engine(rpm, 100) : { power: 0, torque: 0, heatFactor: 1, knock: false, lean: false };
      /* Calor a dissipar: um motor a combustao joga no liquido algo da
         ordem da propria potencia de eixo. E o gancho com a parte seria
         — quanto mais missil, mais radiador ele exige.               */
      var qNeed = e.power * 0.7355 * st.params.heatFrac;   // cv -> kW -> calor ao liquido

      pw.push([rpm, e.power]); tq.push([rpm, e.torque]); heat.push([rpm, qNeed]);
      if (e.power > peakP) { peakP = e.power; peakPRpm = rpm; }
      if (e.torque > peakT) { peakT = e.torque; peakTRpm = rpm; }
      if (qNeed > peakHeat) peakHeat = qNeed;
      if (e.knock) knock = true;
      if (e.lean) lean = true;

      var series = [
        { name: 'potência', color: COL.q, width: 2.2, area: COL.qArea,
          data: pw, tipFmt: function (v) { return U.br(v, 0) + ' cv'; } },
        { name: 'torque', color: COL.gen, width: 1.9, axis: 'r',
          data: tq, tipFmt: function (v) { return U.br(v, 0) + ' N·m'; } },
        { name: 'calor a dissipar', color: COL.pred, width: 1.5, dash: true,
          data: heat, tipFmt: function (v) { return U.br(v, 0) + ' kW'; } }
      ];
      G.update($('#dynoChart'), {
        height: 300, series: series, xMin: rpm0, xMax: rpm1, yMin: 0,
        xLabel: 'rotação do motor (rpm)', yLabel: 'potência (cv) e calor (kW)', yLabelRight: 'torque (N·m)',
        xFmt: function (v) { return U.br(v, 0); }, yFmt: function (v) { return U.br(v, 0); },
        yFmtRight: function (v) { return U.br(v, 0); },
        tipTitle: function (v) { return U.br(v, 0) + ' rpm'; }
      });
      if (app.legend) app.legend('#legDyno', series);

      txtId('dynoQ', U.br(e.power, 0));
      txtId('dynoEps', U.br(e.torque, 0));
      txtId('dynoUA', U.br(qNeed, 0));
      txtId('dynoRpm', U.br(rpm, 0));

      if (f >= 1) {
        dyno.running = false;
        $('#btnDyno').disabled = false;
        if (A) A.play('turbo');

        /* O veredito: este nucleo aguenta o que o mapa pede? */
        var T2 = ATC.Thermal, pp = st.params;
        var af2 = T2.airFlow(vRef, 1, tAmb, pp);
        var cf2 = T2.coolantFlow(peakPRpm, tHot, pp);
        var um2 = T2.uaModel(af2.mdot, tAmb, cf2.mdot, tHot, pp);
        var Cc2 = af2.mdot * af2.prop.cp, Ch2 = cf2.mdot * cf2.prop.cp;
        var Cmin2 = Math.min(Ch2, Cc2), Cmax2 = Math.max(Ch2, Cc2);
        var eps2 = T2.epsCrossflow(Cmin2 > 0 ? um2.UA / Cmin2 : 0, Cmax2 > 0 ? Cmin2 / Cmax2 : 0);
        var qMaxReal = eps2 * Cmin2 * (tHot - tAmb) / 1000;
        var uaReal = um2.UA;
        var folga = qMaxReal - peakHeat;
        /* Radiador de serie nao e dimensionado para potencia maxima
           indefinida — e para um ciclo de uso. Entao a pergunta util
           nao e "aguenta?", e "por quanto tempo?". A capacitancia
           concentrada do proprio modelo termico responde: com o
           desequilibrio de calor conhecido, quanto tempo o liquido
           leva de 100 C ate o limite critico.                       */
        var margem = qMaxReal > 0 ? folga / qMaxReal : NaN;
        var segAte = folga < 0
          ? st.params.cTh * (st.params.tCrit - tHot) / (-folga * 1000)
          : Infinity;

        var veredito;
        if (knock) {
          veredito = '<b style="color:var(--crit)">DETONAÇÃO NO MAPA.</b> A passada rodou com a ignição acima do limite que esta pressão aguenta, e a potência de pico caiu por causa disso. Recue o avanço na aba <b>Tune</b> antes de olhar qualquer outro número.';
        } else if (lean) {
          veredito = '<b style="color:var(--crit)">MISTURA POBRE SOB CARGA.</b> Falta combustível para o ar que o mapa está colocando. Suba o mapa de combustível na proporção da pressão antes de subir mais nada.';
        } else if (margem >= 0.15) {
          veredito = '<b style="color:var(--ok)">SOBRA RADIADOR.</b> No pico o mapa pede <b>' + U.br(peakHeat, 0) +
            ' kW</b> e este núcleo entrega <b>' + U.br(qMaxReal, 0) + ' kW</b> a ' + U.br(vRef, 0) +
            ' km/h com o líquido a ' + U.br(tHot, 0) + ' °C. Dá para segurar potência máxima sem a temperatura subir.';
        } else if (margem >= -0.25) {
          veredito = '<b style="color:var(--warn)">NO LIMITE.</b> O mapa pede <b>' + U.br(peakHeat, 0) +
            ' kW</b> contra <b>' + U.br(qMaxReal, 0) + ' kW</b> de capacidade a ' + U.br(vRef, 0) +
            ' km/h. Serve para arrancada, não para manter — é mais ou menos onde um carro de série vive, porque radiador de fábrica é dimensionado para ciclo de uso e não para potência máxima indefinida.';
        } else {
          veredito = '<b style="color:var(--crit)">FALTA RADIADOR.</b> O mapa pede <b>' + U.br(peakHeat, 0) +
            ' kW</b> e o núcleo entrega <b>' + U.br(qMaxReal, 0) + ' kW</b> — faltam ' + U.br(-folga, 0) + ' kW.';
          if (M) M.toast('Este mapa cozinha o motor', 'crit', 3600);
        }
        if (isFinite(segAte) && !knock && !lean) {
          veredito += ' Com esse desequilíbrio e a capacitância térmica de ' +
            U.br(st.params.cTh / 1000, 0) + ' kJ/K do conjunto, o líquido sai de ' + U.br(tHot, 0) +
            ' °C e chega ao limite crítico de ' + U.br(st.params.tCrit, 0) + ' °C em <b>' +
            U.mmss(segAte) + '</b> de pé embaixo.';
        }

        $('#dynoRead').innerHTML =
          'Pico de <b>' + U.br(peakP, 0) + ' cv</b> a ' + U.br(peakPRpm, 0) + ' rpm e <b>' +
          U.br(peakT, 0) + ' N·m</b> a ' + U.br(peakTRpm, 0) + ' rpm, com os mapas que estão na tela <b>Remap</b>. ' +
          veredito +
          ' <span style="color:var(--ink-4)">A potência é ficção. O UA de ' + U.br(uaReal, 0) +
          ' W/K vem das correlações' + (usingDemo() ? ' sobre a coleta de demonstração' : ' com o fator de calibração da coleta carregada') + ', avaliadas a ' +
          U.br(vRef, 0) + ' km/h e ' + U.br(tAmb, 0) + ' °C de ar' +
          (pp.uaCalibrated ? '.' : ' — e a calibração ainda está pendente, então trate como ordem de grandeza.') +
          '</span>';
        return false;
      }
    });
  }

  function txtId(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  /* ============================================================
     8. Conteudo estatico das telas do speed mode
     ============================================================ */
  SP.renderStatic = function () {
    renderRemap();
  };

  /* ============================================================
     9. Ligacao com a interface
     ============================================================ */
  SP.init = function (application) {
    app = application;

    var bs = $('#btnSpeed');
    if (bs) bs.addEventListener('click', function () { SP.toggle(); });

    /* tema da bancada: so mexe em tokens, entao todo modulo segue
       junto — inclusive os canvas, que leem cor na hora de desenhar */
    var sk = $('#skinPick');
    if (sk) {
      var saved = 'carbon';
      try { saved = localStorage.getItem('apex.skin') || 'carbon'; } catch (e) {}
      applySkin(saved);
      sk.value = saved;
      sk.addEventListener('change', function () {
        applySkin(sk.value);
        try { localStorage.setItem('apex.skin', sk.value); } catch (e) {}
        if (A) A.play('relay');
      });
    }

    var bd = $('#btnDyno');
    if (bd) bd.addEventListener('click', runDyno);

    /* restaura o modo escolhido na visita anterior, sem a partida:
       quem ja optou pelo speed mode nao quer ver o boot toda vez  */
    var saved = null;
    try { saved = localStorage.getItem('apex.mode'); } catch (e) {}
    if (saved === 'speed') {
      document.documentElement.dataset.mode = 'speed';
      document.querySelector('meta[name=theme-color]').setAttribute('content', '#06070a');
      if (bs) bs.setAttribute('aria-pressed', 'true');
      if (app) app.modeChanged('speed');
      SP.mount();
    }
  };

  function applySkin(name) {
    var root = document.documentElement;
    if (name && name !== 'carbon') root.dataset.skin = name;
    else delete root.dataset.skin;
    /* os desenhos guardam assinatura do ultimo quadro: invalidar
       obriga todos a se redesenharem com a paleta nova            */
    if (ATC.Cockpit) ATC.Cockpit.invalidate();
    if (ATC.Charts) ATC.Charts.syncTheme();
    if (SP.isOn()) renderRemap();
  }

  SP.isOn = function () { return document.documentElement.dataset.mode === 'speed'; };
  SP.refresh = function () {
    if (!SP.isOn()) return;
    demoCache = null;          /* parametros mudaram: refaz a demonstracao */
    SP.renderStatic();
  };

  ATC.Speed = SP;
})(window.ATC = window.ATC || {});
