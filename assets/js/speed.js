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
    SP.renderStatic();
  };
  SP.unmount = function () {
    if (ATC.Cockpit) ATC.Cockpit.unmount();
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
  var TSEL = { i: 4, j: 4 };

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
    h += '<div class="tune-grid-box"><table class="tune-grid"><thead><tr><th class="corner">carga \\ rpm</th>' +
      TN.rpmAxis.map(function (r) { return '<th>' + U.br(r, 0) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var j = TN.loadAxis.length - 1; j >= 0; j--) {
      h += '<tr><th>' + U.br(TN.loadAxis[j], 0) + ' %</th>';
      for (var i = 0; i < TN.rpmAxis.length; i++) {
        var v = grid[j][i];
        var t = (v - m.min) / Math.max(m.max - m.min, 1e-9);
        var on = (i === TSEL.i && j === TSEL.j);
        h += '<td class="tc' + (on ? ' on' : '') + '" data-i="' + i + '" data-j="' + j + '"' +
          ' style="--t:' + t.toFixed(3) + '">' + U.br(v, m.dec) + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    h += '<div class="tune-ctl">' +
      '<button class="btn sm" data-adj="-1">−</button>' +
      '<button class="btn sm" data-adj="1">+</button>' +
      '<input type="number" id="tuneVal" step="' + m.step + '" value="' + grid[TSEL.j][TSEL.i].toFixed(m.dec) + '">' +
      '<span class="tune-unit">' + m.unit + '</span>' +
      '<button class="btn sm ghost" data-all="-1">− tudo</button>' +
      '<button class="btn sm ghost" data-all="1">+ tudo</button>' +
      '<button class="btn sm ghost" data-smooth="1">suavizar</button>' +
      '<button class="btn sm ghost" data-reset="1">original</button>' +
      '</div>' +
      '<p class="tune-hint">Clique numa célula e use as setas do teclado para andar, + e − para ajustar. A superfície e a potência respondem na hora.</p>';
    h += '</div>';
    h += '<div class="tune-side">' +
      '<div class="chart-box"><canvas id="tuneSurf"></canvas></div>' +
      '<div id="tuneOut"></div></div>';
    h += '</div>';
    return h;
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

  function tuneSet(i, j, v) {
    var TN = ATC.Tune, m = TN.maps[TN.openMap()];
    var g = TN.state()[TN.openMap()];
    g[j][i] = U.clamp(v, m.min, m.max);
    TN.save();
  }

  function wireTune() {
    var TN = ATC.Tune;
    var pane = $('#remapPane');
    if (!pane || !TN) return;
    tunePaint();

    /* o campo de valor e refeito a cada render, entao e religado a
       cada render; o resto vive no painel, que sobrevive */
    var val = document.getElementById('tuneVal');
    if (val) val.addEventListener('change', function () {
      tuneSet(TSEL.i, TSEL.j, parseFloat(val.value));
      refreshTune();
    });

    if (pane.__w) return;
    pane.__w = 1;

    pane.addEventListener('click', function (ev) {
      var m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
      var cell = ev.target.closest('.tc');
      if (cell) {
        TSEL.i = +cell.dataset.i; TSEL.j = +cell.dataset.j;
        refreshTune(); if (A) A.play('tick'); return;
      }
      var tab = ev.target.closest('[data-map]');
      if (tab) { TN.openMap(tab.dataset.map); renderRemap(); if (A) A.play('tick'); return; }
      var pre = ev.target.closest('[data-preset]');
      if (pre) {
        TN.applyPreset(pre.dataset.preset);
        renderRemap();
        if (A) A.play('relay');
        if (M) M.toast('Mapa ' + TN.presets[pre.dataset.preset].name + ' carregado', null, 2400);
        return;
      }
      var adj = ev.target.closest('[data-adj]');
      if (adj) { tuneSet(TSEL.i, TSEL.j, g[TSEL.j][TSEL.i] + (+adj.dataset.adj) * m.step); refreshTune(); return; }
      var all = ev.target.closest('[data-all]');
      if (all) {
        var d = (+all.dataset.all) * m.step;
        for (var j = 0; j < g.length; j++) for (var i = 0; i < g[j].length; i++) tuneSet(i, j, g[j][i] + d);
        refreshTune(); if (A) A.play('press'); return;
      }
      if (ev.target.closest('[data-smooth]')) {
        var cp = g.map(function (r) { return r.slice(); });
        for (var j2 = 0; j2 < g.length; j2++) for (var i2 = 0; i2 < g[j2].length; i2++) {
          var sum = 0, n = 0;
          for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
            var jj = j2 + dj, ii = i2 + di;
            if (cp[jj] && isFinite(cp[jj][ii])) { sum += cp[jj][ii]; n++; }
          }
          tuneSet(i2, j2, sum / n);
        }
        refreshTune(); if (A) A.play('turbo'); return;
      }
      if (ev.target.closest('[data-reset]')) {
        TN.reset(); renderRemap(); if (A) A.play('relay');
        if (M) M.toast('Mapas de fábrica restaurados', null, 2200);
      }
    });

    pane.addEventListener('keydown', function (ev) {
      var g = TN.state()[TN.openMap()], m = TN.maps[TN.openMap()];
      var k = ev.key, moved = true;
      if (k === 'ArrowRight') TSEL.i = Math.min(TSEL.i + 1, TN.rpmAxis.length - 1);
      else if (k === 'ArrowLeft') TSEL.i = Math.max(TSEL.i - 1, 0);
      else if (k === 'ArrowUp') TSEL.j = Math.min(TSEL.j + 1, TN.loadAxis.length - 1);
      else if (k === 'ArrowDown') TSEL.j = Math.max(TSEL.j - 1, 0);
      else if (k === '+' || k === '=') { tuneSet(TSEL.i, TSEL.j, g[TSEL.j][TSEL.i] + m.step); }
      else if (k === '-' || k === '_') { tuneSet(TSEL.i, TSEL.j, g[TSEL.j][TSEL.i] - m.step); }
      else moved = false;
      if (moved) { ev.preventDefault(); refreshTune(); }
    });
    pane.setAttribute('tabindex', '0');
  }

  /* redesenha so a tabela e a lateral, sem remontar a tela inteira */
  function refreshTune() {
    var TN = ATC.Tune, m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
    var pane = $('#remapPane');
    pane.querySelectorAll('.tc').forEach(function (c) {
      var i = +c.dataset.i, j = +c.dataset.j, v = g[j][i];
      c.textContent = U.br(v, m.dec);
      c.style.setProperty('--t', ((v - m.min) / Math.max(m.max - m.min, 1e-9)).toFixed(3));
      c.classList.toggle('on', i === TSEL.i && j === TSEL.j);
    });
    var val = document.getElementById('tuneVal');
    if (val) val.value = g[TSEL.j][TSEL.i].toFixed(m.dec);
    tunePaint();
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
