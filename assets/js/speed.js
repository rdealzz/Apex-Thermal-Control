/* ============================================================
   APEX — SPEED MODE
   ------------------------------------------------------------
   O modo divertido. Nao substitui nada: e a mesma coleta, os
   mesmos calculos e os mesmos numeros, apresentados como painel
   de carro em vez de relatorio de engenharia.

   Nenhum indicador aqui e inventado. O conta-giros mostra a
   rotacao que veio do OBD-II, o "boost" e o calor rejeitado, a
   "pressao de oleo" e o indice de saude do nucleo e o nitro
   enche conforme a margem que ainda existe ate o limite critico.
   Fingir dado seria mais facil e valeria bem menos.
   ============================================================ */
(function (ATC) {
  'use strict';

  var SP = {};
  var U = ATC.U, M = ATC.Motion, A = ATC.Audio;
  var app = null;                 /* preenchido por app.js */
  var stopFrame = null;           /* encerra o laco do cluster */
  var play = { on: false, i: 0, t: 0, pos: -1, cellT: 0 };
  var nitro = { charge: 0, ready: false };
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
    ['Initializing ECU', 'ok'],
    ['Loading thermal modules', 'ok'],
    ['Reading coolant maps', 'ok'],
    ['Checking sensors', 'ok'],
    ['Loading ε–NTU solver', 'ok'],
    ['Pump flow model', 'ok'],
    ['Fan control strategy', 'ok'],
    ['Telemetry buffer', 'ok'],
    ['Performance profile loaded', 'k'],
    ['Engine ready', 'k']
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

  /* ============================================================
     3. CLUSTER
     ============================================================ */
  var dial = {};   /* molas dos ponteiros */
  function needle(name, k, c) {
    if (!dial[name]) dial[name] = M.spring(0, { k: k || 60, c: c || 13, eps: 0.0006 });
    return dial[name];
  }

  /* ------------------------------------------------------------
     Um mostrador e desenhado em duas metades.

     A face — trilha, zona de alarme, marcas, numeros da escala e o
     nome — nao muda enquanto a janela nao mudar de tamanho. Ela e
     rasterizada uma vez num canvas fora da tela e depois so copiada.
     Redesenhar tudo isso a cada quadro custava mais que todo o resto
     do painel somado: sao dezenas de trocas de fonte por quadro, e
     trocar de fonte obriga o navegador a remontar o texto.

     Por quadro sobra o que de fato se move: o arco de valor, o
     ponteiro e a leitura digital.
     ------------------------------------------------------------ */
  var A0 = Math.PI * 0.76, A1 = Math.PI * 2.24, SPAN = A1 - A0;

  function frac(o) {
    return U.clamp((o.value - o.min) / ((o.max - o.min) || 1), 0, 1);
  }

  function drawFace(ctx, o) {
    ctx.save();
    ctx.translate(o.cx, o.cy);

    /* Aro de metal. O degrade inverte no meio porque uma superficie
       curva reflete o claro em cima e o escuro embaixo — e o que faz
       o anel parecer aluminio em vez de um circulo cinza. Como a face
       fica em cache, isto custa uma vez, nao um quadro.             */
    if (o.bezel) {
      var g = ctx.createLinearGradient(0, -o.R * 1.1, 0, o.R * 1.1);
      g.addColorStop(0, '#f4f7fc');
      g.addColorStop(0.34, '#98a1b1');
      g.addColorStop(0.52, '#3e4553');
      g.addColorStop(0.72, '#8b94a4');
      g.addColorStop(1, '#d6dce6');
      ctx.strokeStyle = g;
      ctx.lineWidth = o.R * 0.055;
      ctx.beginPath(); ctx.arc(0, 0, o.R * 1.06, 0, 6.284); ctx.stroke();
      ctx.strokeStyle = 'rgba(6,7,10,.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, o.R * 1.09, 0, 6.284); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, o.R * 1.03, 0, 6.284); ctx.stroke();
    }

    ctx.lineWidth = o.R * 0.085;
    ctx.strokeStyle = o.track || 'rgba(255,255,255,.07)';
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(0, 0, o.R, A0, A1); ctx.stroke();

    if (o.redFrom !== undefined) {
      var rf = U.clamp((o.redFrom - o.min) / ((o.max - o.min) || 1), 0, 1);
      ctx.strokeStyle = o.redColor || '#ff3b30';
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(0, 0, o.R, A0 + SPAN * rf, A1); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    var n = o.ticks || 10;
    var tickFont = '600 ' + Math.max(9, Math.round(o.R * 0.1)) + 'px ui-monospace,monospace';
    for (var i = 0; i <= n; i++) {
      var t = i / n, ang = A0 + SPAN * t;
      var big = (i % (o.tickMajor || 1)) === 0;
      var r0 = o.R - o.R * (big ? 0.20 : 0.145), r1 = o.R - o.R * 0.055;
      ctx.strokeStyle = big ? 'rgba(233,238,247,.72)' : 'rgba(233,238,247,.26)';
      ctx.lineWidth = big ? o.R * 0.022 : o.R * 0.012;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
      ctx.stroke();
      /* as marcas das pontas ficam sem numero: e onde a leitura
         digital e o nome do mostrador ocupam o vao de baixo      */
      if (big && o.tickFmt && i > 0 && i < n) {
        ctx.fillStyle = 'rgba(170,180,198,.9)';
        ctx.font = tickFont;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var rt = o.R - o.R * 0.30;
        ctx.fillText(o.tickFmt(o.min + (o.max - o.min) * t), Math.cos(ang) * rt, Math.sin(ang) * rt);
      }
    }

    /* os nomes dos tres mostradores dividem a mesma linha de base,
       senao cada um flutua na altura do proprio raio               */
    ctx.font = '700 ' + Math.max(9, Math.round(o.R * 0.11)) + 'px ui-monospace,monospace';
    ctx.fillStyle = o.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(o.label, 0, o.labelY === undefined ? o.R * 0.99 : o.labelY);
    ctx.restore();
  }

  function drawLive(ctx, o) {
    var f = frac(o);
    ctx.save();
    ctx.translate(o.cx, o.cy);

    /* Arco de valor com halo. O halo e um segundo traco mais largo e
       transparente, nao um shadowBlur: o desfoque do canvas 2D e o
       item mais caro que existe aqui.                              */
    ctx.lineCap = 'round';
    ctx.strokeStyle = o.color;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = o.R * 0.20;
    ctx.beginPath(); ctx.arc(0, 0, o.R, A0, A0 + SPAN * Math.max(f, 0.001)); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = o.R * 0.085;
    ctx.beginPath(); ctx.arc(0, 0, o.R, A0, A0 + SPAN * Math.max(f, 0.001)); ctx.stroke();

    /* ponteiro */
    var ang = A0 + SPAN * f;
    ctx.rotate(ang);
    var ng = ctx.createLinearGradient(0, -o.R * 0.04, 0, o.R * 0.04);
    ng.addColorStop(0, '#ffffff');
    ng.addColorStop(0.5, '#c2c8d4');
    ng.addColorStop(1, '#79808f');
    ctx.fillStyle = o.needleColor || ng;
    ctx.beginPath();
    ctx.moveTo(-o.R * 0.055, -o.R * 0.032);
    ctx.lineTo(o.R * 0.84, -o.R * 0.012);
    ctx.lineTo(o.R * 0.84, o.R * 0.012);
    ctx.lineTo(-o.R * 0.055, o.R * 0.032);
    ctx.closePath(); ctx.fill();
    ctx.rotate(-ang);
    ctx.fillStyle = '#0a0d13';
    ctx.beginPath(); ctx.arc(0, 0, o.R * 0.075, 0, 6.284); ctx.fill();
    ctx.strokeStyle = o.color; ctx.lineWidth = o.R * 0.016;
    ctx.beginPath(); ctx.arc(0, 0, o.R * 0.075, 0, 6.284); ctx.stroke();

    /* leitura digital */
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e9eef7';
    ctx.font = '600 ' + Math.round(o.R * 0.32) + 'px ui-monospace,monospace';
    ctx.fillText(o.text, 0, o.R * 0.44);
    ctx.font = '600 ' + Math.max(9, Math.round(o.R * 0.105)) + 'px ui-monospace,monospace';
    ctx.fillStyle = '#7b8699';
    ctx.fillText(o.unit || '', 0, o.R * 0.64);
    ctx.restore();
  }

  function sampleNow() {
    var st = S();
    if (!st || !st.proc || !st.proc.rows.length) return null;
    var rows = st.proc.rows;
    var i = U.clamp(play.i | 0, 0, rows.length - 1);
    return rows[i];
  }

  /* A largura do canvas so muda quando a janela muda. Ler clientWidth
     todo quadro forcaria o navegador a recalcular layout 60 vezes por
     segundo — o jeito classico de perder quadros sem perceber.      */
  var geo = { w: 0, h: 0, ctx: null, face: null, dials: null, dirty: true, sig: null };
  window.addEventListener('resize', function () { geo.dirty = true; }, { passive: true });
  SP.invalidate = function () { geo.dirty = true; };

  /* a configuracao dos tres mostradores, sem o valor: e o que a face
     precisa saber, e o que o quadro reaproveita                    */
  function dialSpecs(w, h) {
    var p = S() ? S().params : { tCrit: 105, tWarn: 100 };
    var narrow = w < 620;
    /* Nas telas largas os tres mostradores encolhem um pouco e se
       afastam para caber o aro sem que um encoste no outro. Em tela
       estreita nao ha essa folga, entao o aro nao entra — melhor sem
       ele do que com os mostradores colidindo.                     */
    var bezel = !narrow;
    var Rc = Math.min(h * (bezel ? 0.40 : 0.42), w * (narrow ? 0.29 : 0.175));
    var Rs = Rc * (narrow ? 0.60 : 0.68);
    var cy = h * 0.50;
    var labelY = Rc * 0.94;          /* mesma linha de base para os tres */
    var sideX = narrow ? 0.20 : 0.17;
    var int0 = function (v) { return String(Math.round(v)); };
    return [
      { key: 'temp', cx: w * sideX, cy: cy, R: Rs, labelY: labelY, bezel: bezel,
        min: 0, max: 130, label: 'COOLANT', unit: '°C',
        color: '#12b6ff', warnAt: p.tWarn, critAt: p.tCrit,
        redFrom: p.tWarn, ticks: 13, tickMajor: 3, tickFmt: int0 },
      { key: 'rpm', cx: w * 0.5, cy: cy, R: Rc, labelY: labelY, bezel: bezel,
        min: 0, max: 7000, label: 'ENGINE', unit: '× 1000 rpm',
        color: '#3ff0e0', redFrom: 5800, ticks: 14, tickMajor: 2,
        tickFmt: function (v) { return String(Math.round(v / 1000)); } },
      { key: 'spd', cx: w * (1 - sideX), cy: cy, R: Rs, labelY: labelY, bezel: bezel,
        min: 0, max: 180, label: 'SPEED', unit: 'km/h',
        color: '#2fe08a', ticks: 12, tickMajor: 3, tickFmt: int0 }
    ];
  }

  function rebuild(cv) {
    var host = cv.parentNode;
    var w = host.clientWidth || 800;
    var h = Math.round(U.clamp(w * 0.40, 260, 400));
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    geo.ctx = cv.getContext('2d');
    geo.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geo.w = w; geo.h = h;
    geo.dials = dialSpecs(w, h);

    /* a face vai para um canvas fora da tela, rasterizada uma vez */
    var off = geo.face || (geo.face = document.createElement('canvas'));
    off.width = cv.width; off.height = cv.height;
    var oc = off.getContext('2d');
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
    oc.clearRect(0, 0, w, h);
    geo.dials.forEach(function (d) { drawFace(oc, d); });
    geo.dirty = false;
  }

  function drawCluster() {
    var cv = $('#spdCluster');
    if (!cv) return;
    if (geo.dirty || !geo.ctx) rebuild(cv);
    /* Se os ponteiros ja assentaram e a amostra e a mesma, o desenho
       sairia identico ao que ja esta na tela. Redesenhar assim mesmo
       obriga o navegador a rasterizar um canvas de mais de um milhao
       de pixels por quadro para nada.                               */
    var sig = (dial.rpm ? dial.rpm.x : 0).toFixed(1) + '|' +
              (dial.spd ? dial.spd.x : 0).toFixed(2) + '|' +
              (dial.temp ? dial.temp.x : 0).toFixed(2);
    if (sig === geo.sig) return;
    geo.sig = sig;

    var ctx = geo.ctx, w = geo.w, h = geo.h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(geo.face, 0, 0, w, h);

    var p = S() ? S().params : { tCrit: 105, tWarn: 100 };
    geo.dials.forEach(function (d) {
      var v, text, color = d.color;
      if (d.key === 'rpm') {
        v = dial.rpm ? dial.rpm.x : 0;
        text = U.br(v / 1000, 2);
        if (v > 5800) color = '#ff3b30';
      } else if (d.key === 'temp') {
        v = dial.temp ? dial.temp.x : 0;
        text = U.br(v, 0);
        if (v >= p.tCrit) color = '#ff3b30'; else if (v >= p.tWarn) color = '#ffb020';
      } else {
        v = dial.spd ? dial.spd.x : 0;
        text = U.br(v, 0);
      }
      drawLive(ctx, {
        cx: d.cx, cy: d.cy, R: d.R, min: d.min, max: d.max,
        value: v, text: text, unit: d.unit, color: color
      });
    });
  }

  /* ============================================================
     Manometros
     ------------------------------------------------------------
     Quatro mostradores menores embaixo do painel. Pressao de oleo e
     de combustivel sao ficcao derivada do que a coleta tem de real
     (indice de saude e vazao da bomba); pressao de turbo e AFR vem
     direto dos mapas da bancada de remapeamento — mexer na tabela
     move o ponteiro aqui, que e o que fecha o ciclo.
     ============================================================ */
  var geoAux = { w: 0, h: 0, ctx: null, face: null, dials: null, dirty: true, sig: null };
  window.addEventListener('resize', function () { geoAux.dirty = true; }, { passive: true });

  /* Mostrador pequeno nao comporta escala numerica: os numeros caem
     em cima da leitura central. Ficam so as marcas, e o valor exato
     e o digito no meio — que e para onde o olho vai de qualquer jeito. */
  function auxSpecs(w, h) {
    var R = Math.min(h * 0.38, w / 4 * 0.33);
    var cy = h * 0.44;
    var labelY = R * 1.30;
    return [
      { key: 'oil',   cx: w * 0.125, cy: cy, R: R, labelY: labelY, bezel: true,
        min: 0, max: 8, label: 'OIL PRESS', unit: 'bar', color: '#2fe08a', ticks: 8, tickMajor: 2 },
      { key: 'fuel',  cx: w * 0.375, cy: cy, R: R, labelY: labelY, bezel: true,
        min: 0, max: 6, label: 'FUEL PRESS', unit: 'bar', color: '#12b6ff', ticks: 6, tickMajor: 2 },
      { key: 'boost', cx: w * 0.625, cy: cy, R: R, labelY: labelY, bezel: true,
        min: -1, max: 2.5, label: 'BOOST', unit: 'bar', color: '#ff8a1f',
        redFrom: 1.6, ticks: 7, tickMajor: 2 },
      { key: 'afr',   cx: w * 0.875, cy: cy, R: R, labelY: labelY, bezel: true,
        min: 10, max: 18, label: 'AFR', unit: ':1', color: '#3ff0e0', ticks: 8, tickMajor: 2 }
    ];
  }

  function auxValues(d) {
    var TN = ATC.Tune;
    var e = TN ? TN.engine(U.clamp(d.rpm, 800, 6400), U.clamp(d.load, 20, 100)) : null;
    /* pressao de oleo cai com a saude do nucleo e sobe com a rotacao:
       ficcao, mas ficcao presa a um numero real da coleta            */
    var health = isFinite(d.health) ? U.clamp(d.health, 0.4, 1.2) : 1;
    return {
      oil: U.clamp(1.2 + 3.6 * (d.rpm / 6400) * health, 0, 8),
      fuel: U.clamp(3.0 + 0.9 * (d.load / 100) + 0.4 * (d.vdotCool / 60), 0, 6),
      boost: e ? e.boost : 0,
      afr: e ? e.afr : 14.7
    };
  }

  function drawAux(d) {
    var cv = $('#spdAux');
    if (!cv) return;
    if (geoAux.dirty || !geoAux.ctx) {
      var host = cv.parentNode;
      var w = host.clientWidth || 800;
      var h = Math.round(U.clamp(w * 0.18, 112, 190));
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.height = h + 'px';
      geoAux.ctx = cv.getContext('2d');
      geoAux.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geoAux.w = w; geoAux.h = h; geoAux.sig = null;
      geoAux.dials = auxSpecs(w, h);
      var off = geoAux.face || (geoAux.face = document.createElement('canvas'));
      off.width = cv.width; off.height = cv.height;
      var oc = off.getContext('2d');
      oc.setTransform(dpr, 0, 0, dpr, 0, 0);
      oc.clearRect(0, 0, w, h);
      geoAux.dials.forEach(function (x) { drawFace(oc, x); });
      geoAux.dirty = false;
    }

    var v = auxValues(d);
    var sig = U.br(v.oil, 2) + '|' + U.br(v.fuel, 2) + '|' + U.br(v.boost, 3) + '|' + U.br(v.afr, 2);
    if (sig === geoAux.sig) return;
    geoAux.sig = sig;

    var ctx = geoAux.ctx;
    ctx.clearRect(0, 0, geoAux.w, geoAux.h);
    ctx.drawImage(geoAux.face, 0, 0, geoAux.w, geoAux.h);
    geoAux.dials.forEach(function (x) {
      var val = v[x.key];
      var col = x.color;
      if (x.key === 'boost' && val > 1.6) col = '#ff3b30';
      if (x.key === 'afr' && (val < 11.5 || val > 15.5)) col = '#ffb020';
      drawLive(ctx, {
        cx: x.cx, cy: x.cy, R: x.R, min: x.min, max: x.max, value: val,
        text: U.br(val, x.key === 'boost' || x.key === 'afr' ? 2 : 1), unit: x.unit, color: col
      });
    });
  }

  /* fita de LEDs: acende conforme a rotacao se aproxima do corte */
  function buildLeds() {
    var strip = $('#shiftStrip');
    if (!strip || strip.childNodes.length) return;
    var cls = ['g', 'g', 'g', 'g', 'y', 'y', 'y', 'r', 'r', 'r'];
    for (var i = 0; i < cls.length; i++) {
      var d = document.createElement('span');
      d.className = 'led ' + cls[i];
      strip.appendChild(d);
    }
  }
  var ledRefs = null, ledLit = -1;
  function paintLeds(rpm) {
    var strip = $('#shiftStrip');
    if (!strip) return;
    if (!ledRefs) ledRefs = Array.prototype.slice.call(strip.children);
    var n = ledRefs.length;
    var lit = Math.round(U.clamp((rpm - 2200) / (6100 - 2200), 0, 1) * n);
    /* so escreve no DOM quando a contagem de LEDs acesos muda */
    if (lit !== ledLit) {
      for (var i = 0; i < n; i++) ledRefs[i].classList.toggle('on', i < lit);
      ledLit = lit;
    }
    strip.classList.toggle('flash', rpm > 6100 && (Date.now() % 260) < 130);
  }

  /* leituras digitais: o mapeamento entre grandeza termica e nome
     de painel esta escrito na propria celula, para ninguem achar
     que e dado automotivo inventado                               */
  var CELLS = [
    { id: 'boost', l: 'BOOST', u: 'kW', s: 'calor rejeitado', get: function (d) { return d.q / 1000; }, dec: 1, cls: function () { return 'boost'; } },
    { id: 'fuel', l: 'FUEL PRESS', u: 'L/min', s: 'vazão da bomba', get: function (d) { return d.vdotCool; }, dec: 1 },
    { id: 'oil', l: 'OIL PRESS', u: '%', s: 'índice de saúde', get: function (d) { return d.health * 100; }, dec: 0,
      cls: function (v) { return !isFinite(v) ? '' : v >= 90 ? 'good' : v >= 75 ? '' : 'alarm'; } },
    { id: 'volt', l: 'BATTERY', u: 'ε', s: 'efetividade', get: function (d) { return d.eps; }, dec: 3 },
    { id: 'duty', l: 'INJ DUTY', u: '%', s: 'carga do motor', get: function (d) { return d.load; }, dec: 0 },
    { id: 'afr', l: 'AFR', u: 'C_r', s: 'razão de capacidades', get: function (d) { return d.Cr; }, dec: 2 },
    { id: 'iat', l: 'AIR TEMP', u: '°C', s: 'ar na face', get: function (d) { return d.tAmb; }, dec: 1 },
    { id: 'hp', l: 'HEAT POWER', u: 'cv', s: 'calor em cavalos', get: function (d) { return d.q / 735.5; }, dec: 0 }
  ];

  function buildCells() {
    var strip = $('#hudStrip');
    if (!strip || strip.childNodes.length) return;
    strip.innerHTML = CELLS.map(function (c) {
      return '<div class="hud-cell" id="cell-' + c.id + '">' +
        '<div class="hl">' + c.l + '</div>' +
        '<div class="hv"><span id="cv-' + c.id + '">--</span><span class="hu">' + c.u + '</span></div>' +
        '<div class="hs">' + c.s + '</div></div>';
    }).join('');
  }

  var cellRefs = null;
  function paintCells(d) {
    if (!cellRefs) {
      cellRefs = CELLS.map(function (c) {
        return { c: c, v: document.getElementById('cv-' + c.id), h: document.getElementById('cell-' + c.id) };
      });
    }
    for (var i = 0; i < cellRefs.length; i++) {
      var r = cellRefs[i];
      var v = d ? r.c.get(d) : NaN;
      var txt = isFinite(v) ? U.br(v, r.c.dec) : '--';
      if (r.v && r.v.textContent !== txt) r.v.textContent = txt;
      if (r.h) {
        var k = r.c.cls ? r.c.cls(v) : '';
        var want = 'hud-cell' + (k ? ' ' + k : '');
        if (r.h.className !== want) r.h.className = want;
      }
    }
  }

  /* ============================================================
     4. NITRO — enche com a margem termica que sobrou
     ============================================================ */
  var nitroRefs = null;
  function updateNitro(d, dt) {
    if (!nitroRefs) {
      var f = $('#nitroFill');
      if (!f) return;
      nitroRefs = { fill: f, card: f.closest('.nitro-card'), bar: f.parentNode,
                    state: $('#nitroState'), btn: $('#btnNitro') };
    }
    var fill = nitroRefs.fill, card = nitroRefs.card;
    var p = S() ? S().params : null;
    if (!d || !p) return;
    /* margem: quantos graus faltam ate o critico, normalizados */
    var margin = U.clamp((p.tCrit - d.tHotIn) / Math.max(p.tCrit - p.tStatOpen, 1), 0, 1);
    if (!nitro.ready) {
      nitro.charge = U.clamp(nitro.charge + margin * dt * 0.055, 0, 1);
      if (nitro.charge >= 1) {
        nitro.ready = true;
        card.classList.add('ready');
        nitroRefs.btn.disabled = false;
        nitroRefs.state.textContent = 'READY';
        if (A) A.play('blip');
        if (M) M.toast('Nitro carregado', null, 2000);
      } else {
        var pct = U.br(nitro.charge * 100, 0) + ' %';
        if (nitroRefs.state.textContent !== pct) nitroRefs.state.textContent = pct;
      }
    }
    fill.style.transform = 'scaleX(' + nitro.charge.toFixed(3) + ')';
    nitroRefs.bar.classList.toggle('full', nitro.ready);
  }

  function fireNitro() {
    if (!nitro.ready) return;
    nitro.ready = false; nitro.charge = 0;
    var card = $('#nitroFill').closest('.nitro-card');
    card.classList.remove('ready');
    $('#btnNitro').disabled = true;
    $('#nitroState').textContent = 'PURGING';
    if (A) A.play('nitro');

    var flash = document.createElement('div');
    flash.className = 'nitro-flash';
    document.body.appendChild(flash);
    setTimeout(function () { flash.remove(); }, 760);

    if (M && !M.reduced()) sparks();
  }

  /* particulas: posicao integrada por quadro, so transform */
  function sparks() {
    var btn = $('#btnNitro');
    var r = btn.getBoundingClientRect();
    var ps = [];
    for (var i = 0; i < 26; i++) {
      var el = document.createElement('div');
      el.className = 'spark';
      document.body.appendChild(el);
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      var sp = 260 + Math.random() * 460;
      ps.push({
        el: el,
        x: r.left + r.width / 2, y: r.top + r.height / 2,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.55 + Math.random() * 0.5
      });
    }
    M.onFrame(function (dt) {
      var alive = 0;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        p.vy += 1500 * dt;                 /* gravidade */
        p.vx *= (1 - 2.2 * dt);            /* arrasto   */
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.el.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px,0)';
        p.el.style.opacity = Math.max(p.life, 0).toFixed(2);
        if (p.life <= 0) p.el.remove(); else alive++;
      }
      if (!alive) { ps.forEach(function (p) { p.el.remove(); }); return false; }
    });
  }

  /* ============================================================
     5. LACO DO CLUSTER
     ============================================================ */
  function frame(dt) {
    var st = S();
    if (!st || !st.proc) return;
    var rows = st.proc.rows;

    if (play.on) {
      /* 8x o tempo real: uma coleta de 30 min roda em pouco menos
         de 4 min, que e o que da para assistir sem tedio         */
      play.t += dt * 8;
      var dtRow = rows.length > 1 ? (rows[1].t - rows[0].t) : 1;
      while (play.t > dtRow && play.i < rows.length - 1) { play.t -= dtRow; play.i++; }
      if (play.i >= rows.length - 1) { play.on = false; $('#btnSpdPlay').textContent = '▶ Rodar telemetria'; }
      /* escrever num input range recalcula o estilo do widget; so vale
         a pena quando a posicao muda de fato                        */
      var pos = Math.round(1000 * play.i / Math.max(rows.length - 1, 1)) / 10;
      if (pos !== play.pos) {
        play.pos = pos;
        var sc = $('#spdScrub');
        if (sc) sc.value = pos;
      }
    }

    var d = sampleNow();
    if (!d) return;

    needle('rpm', 52, 12).to(isFinite(d.rpm) ? d.rpm : 0);
    needle('spd', 46, 12).to(isFinite(d.speed) ? d.speed : 0);
    needle('temp', 26, 10).to(isFinite(d.tHotIn) ? d.tHotIn : 0);

    updateNitro(d, dt);

    /* fora da aba do cluster nao ha o que desenhar: o nitro continua
       carregando, o resto do quadro nao custa nada                  */
    var tab = document.getElementById('tab-cluster');
    if (!tab || tab.hidden) return;

    drawCluster();
    drawAux(d);
    paintLeds(dial.rpm ? dial.rpm.x : 0);
    /* as leituras digitais andam a 12 Hz. Um numero que troca sessenta
       vezes por segundo nao e lido por ninguem, e cada troca custa uma
       escrita no DOM.                                               */
    play.cellT += dt;
    if (play.cellT >= 1 / 12) { play.cellT = 0; paintCells(d); }

    var tt = $('#spdTime'), tc = $('#teleClock');
    var total = rows[rows.length - 1].t - rows[0].t;
    if (tt) tt.textContent = U.mmss(d.t - rows[0].t) + ' / ' + U.mmss(total);
    if (tc) tc.textContent = U.mmss(d.t - rows[0].t);
  }

  SP.mount = function () {
    geo.dirty = true; geoAux.dirty = true;
    buildLeds(); buildCells(); buildEcuRail();
    if (!stopFrame && M) stopFrame = M.onFrame(function (dt) { frame(dt); });
    /* sem coleta real, a telemetria comeca rodando: um painel parado
       no zero nao mostra nada do que ele sabe fazer                 */
    if (usingDemo() && !play.on) {
      play.on = true;
      /* entra no trecho em que o carro esta andando, nao na partida a
         frio: um painel que abre em marcha lenta parece quebrado     */
      var st0 = S();
      if (st0 && st0.proc) play.i = Math.round(st0.proc.rows.length * 0.42);
      var bp = $('#btnSpdPlay');
      if (bp) bp.textContent = '‖ Pausar';
    }
    SP.renderStatic();
  };
  SP.unmount = function () {
    if (stopFrame) { stopFrame(); stopFrame = null; }
    play.on = false;
  };

  /* ============================================================
     6. ECU
     ============================================================ */
  var ECU = [
    { id: 'engine', l: 'Engine' }, { id: 'turbo', l: 'Turbo' },
    { id: 'injectors', l: 'Injectors' }, { id: 'tune', l: 'Tune' },
    { id: 'logger', l: 'Logger' }, { id: 'maps', l: 'Maps' },
    { id: 'diag', l: 'Diagnostics' }, { id: 'telemetry', l: 'Telemetry' }
  ];
  var ecuOpen = 'engine';

  function buildEcuRail() {
    var rail = $('#ecuRail');
    if (!rail || rail.childNodes.length) return;
    rail.innerHTML = ECU.map(function (e) {
      return '<button role="tab" data-ecu="' + e.id + '" aria-selected="' + (e.id === ecuOpen) + '">' +
        '<span class="e-led"></span>' + e.l + '</button>';
    }).join('');
    rail.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ecu]');
      if (!b) return;
      ecuOpen = b.dataset.ecu;
      rail.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-selected', String(x.dataset.ecu === ecuOpen));
      });
      if (A) A.play('tick');
      renderEcu();
    });
  }

  function tile(l, v, u, cls, frac) {
    return '<div class="ecu-tile ' + (cls || '') + '">' +
      '<div class="et-l">' + l + '</div>' +
      '<div class="et-v">' + v + (u ? '<small>' + u + '</small>' : '') + '</div>' +
      (frac === undefined ? '' : '<div class="et-bar"><i style="--f:' + U.clamp(frac, 0, 1).toFixed(3) + '"></i></div>') +
      '</div>';
  }

  function renderEcu() {
    var pane = $('#ecuPane');
    if (!pane) return;
    var st = S();
    if (!st || !st.sum) {
      pane.innerHTML = '<h3>No data</h3><p class="ep-sub">Carregue uma coleta para a ECU ter o que ler.</p>';
      return;
    }
    var s = st.sum, p = st.params, rows = st.proc.rows;
    var d = sampleNow() || rows[rows.length - 1];
    var h = '';

    if (ecuOpen === 'engine') {
      h = '<h3>Engine</h3><p class="ep-sub">Condição do motor no instante selecionado da telemetria. Rotação, carga e temperatura vêm direto dos PIDs do scanner; o calor gerado sai do mapa térmico configurado nos parâmetros.</p>' +
        '<div class="ecu-grid">' +
        tile('RPM', U.br(d.rpm, 0), '', '', d.rpm / 7000) +
        tile('LOAD', U.br(d.load, 0), '%', '', d.load / 100) +
        tile('COOLANT', U.br(d.tHotIn, 1), '°C', d.tHotIn >= p.tCrit ? 'crit' : d.tHotIn >= p.tWarn ? 'warn' : 'good', d.tHotIn / 130) +
        tile('HEAT OUT', U.br(d.qGen / 1000, 1), 'kW', '', d.qGen / 60000) +
        tile('THERMOSTAT', U.br(d.tStatFrac * 100, 0), '% aberto', '', d.tStatFrac) +
        tile('FAN', d.fan >= 0.5 ? 'ON' : 'OFF', '', d.fan >= 0.5 ? 'warn' : '', d.fan) +
        '</div>' +
        '<div class="ecu-code">' + engineNotes(st, d) + '</div>';

    } else if (ecuOpen === 'turbo') {
      h = '<h3>Turbo</h3><p class="ep-sub">Não existe turbina neste 1.8 aspirado. O que esta tela chama de pressão é o calor que o radiador está empurrando para fora, que é a grandeza que de fato sobe quando se exige do motor.</p>' +
        '<div class="ecu-grid">' +
        tile('BOOST', U.br(d.q / 1000, 1), 'kW', 'good', d.q / 60000) +
        tile('PEAK BOOST', U.br(s.qMax / 1000, 1), 'kW', '', s.qMax / 60000) +
        tile('AIR FLOW', U.br(d.mdotAir, 2), 'kg/s', '', d.mdotAir / 3) +
        tile('FACE SPEED', U.br(d.vFace, 2), 'm/s', '', d.vFace / 14) +
        tile('AIR OUT', U.br(d.tAirOut, 1), '°C', '', d.tAirOut / 90) +
        tile('EFFICIENCY', U.br(d.eps, 3), 'ε', d.eps >= 0.4 ? 'good' : 'warn', d.eps) +
        '</div>' +
        '<div class="ecu-code"><span class="d">// o “boost” desta tela é Q = ṁ·c_p·ΔT, o mesmo número da aba de análise</span>\n' +
        'Q_inst   = ' + U.br(d.q / 1000, 2) + ' kW\n' +
        'Q_médio  = ' + U.br(s.qMean / 1000, 2) + ' kW\n' +
        'Energia  = <span class="ok">' + U.br(s.energy, 1) + ' MJ</span> no total da coleta\n' +
        'Equivale a ferver ' + U.br(s.energy * 1e6 / (4186 * 80), 0) + ' litros de água da torneira</div>';

    } else if (ecuOpen === 'injectors') {
      var duty = d.load;
      h = '<h3>Injectors</h3><p class="ep-sub">Aqui o "duty cycle" é a carga calculada do motor (PID 0104) e a vazão é a da bomba d\'água, movida pela mesma árvore. Nenhum dado de injeção é lido pelo scanner nesta configuração.</p>' +
        '<div class="ecu-grid">' +
        tile('DUTY', U.br(duty, 0), '%', duty > 85 ? 'warn' : '', duty / 100) +
        tile('PUMP FLOW', U.br(d.vdotCool, 1), 'L/min', '', d.vdotCool / 120) +
        tile('MASS FLOW', U.br(d.mdotCool, 2), 'kg/s', '', d.mdotCool / 3) +
        tile('C_LIQUID', U.br(d.Ch, 0), 'W/K', '', d.Ch / 8000) +
        tile('C_AIR', U.br(d.Cc, 0), 'W/K', '', d.Cc / 8000) +
        tile('C_RATIO', U.br(d.Cr, 2), '', '', d.Cr) +
        '</div>' +
        '<div class="ecu-code"><span class="d">// quem limita a troca é o lado de menor capacidade térmica</span>\n' +
        'C_min = ' + U.br(d.Cmin, 0) + ' W/K  (' + (d.Ch <= d.Cc ? 'líquido' : 'ar') + ')\n' +
        'Nesse regime, aumentar a vazão do outro lado <span class="w">não muda quase nada</span>.</div>';

    } else if (ecuOpen === 'tune') {
      pane.innerHTML = tuneHtml();
      wireTune();
      return;

    } else if (ecuOpen === 'logger') {
      var last = rows.slice(-14);
      var lines = last.map(function (r) {
        return U.mmss(r.t - rows[0].t) + '  ' +
          pad(U.br(r.rpm, 0), 5) + ' rpm  ' +
          pad(U.br(r.speed, 0), 4) + ' km/h  ' +
          pad(U.br(r.tHotIn, 1), 6) + ' °C  ' +
          pad(U.br(r.q / 1000, 1), 6) + ' kW  ' +
          (r.tHotIn >= p.tWarn ? '<span class="w">WARN</span>' : '<span class="ok">OK</span>');
      }).join('\n');
      h = '<h3>Logger</h3><p class="ep-sub">As últimas linhas da série processada, no formato que um datalogger cuspiria. É a mesma tabela da aba de importação, sem as bordas.</p>' +
        '<div class="ecu-code">' + lines + '</div>';

    } else if (ecuOpen === 'maps') {
      h = '<h3>Maps</h3><p class="ep-sub">Os parâmetros que a plataforma usa para converter leitura em física. Editar qualquer um deles é feito na aba de análise térmica — aqui é só leitura.</p>' +
        '<div class="ecu-grid">' +
        tile('CORE', U.br(p.coreW * 1000, 0) + '×' + U.br(p.coreH * 1000, 0), 'mm') +
        tile('DEPTH', U.br(p.coreD * 1000, 0), 'mm') +
        tile('TUBES', U.br(p.nTubes, 0), '') +
        tile('PUMP', U.br(p.pumpDisp, 3), 'L/rev') +
        tile('RAM K', U.br(p.kRam, 2), '') +
        tile('UA SCALE', U.br(p.uaScale, 3), '', p.uaCalibrated ? 'good' : 'warn') +
        '</div>' +
        '<div class="ecu-code">Nu_ar     = ' + U.br(p.cAir, 2) + ' · Re^' + U.br(p.mAir, 2) + ' · Pr^(1/3)\n' +
        'Nu_liq    = 0,023 · Re^0,8 · Pr^0,3\n' +
        'Termostato: abre em ' + U.br(p.tStatOpen, 0) + ' °C, pleno em ' + U.br(p.tStatFull, 0) + ' °C\n' +
        'Calibração do UA: ' + (p.uaCalibrated ? '<span class="ok">aplicada</span>' : '<span class="w">pendente — o UA teórico ainda carrega o viés da geometria estimada</span>') + '</div>';

    } else if (ecuOpen === 'diag') {
      var codes = [];
      if (!st.proc || st.proc.mode !== 'exp') codes.push(['P0000', 'w', 'Sem sensor de temperatura de saída — análise em modo modelo']);
      if (!p.uaCalibrated) codes.push(['P0001', 'w', 'Linha de base de UA não definida — índice de saúde sem referência']);
      if (isFinite(s.healthMean) && s.healthMean < 0.75) codes.push(['P0128', 'e', 'Condutância abaixo da prevista — verificar obstrução do núcleo']);
      if (s.ectMax >= p.tCrit) codes.push(['P0217', 'e', 'Temperatura do líquido cruzou o limite crítico durante a coleta']);
      if (isFinite(s.epsMean) && !s.epsInRange) codes.push(['P0002', 'w', 'Efetividade fora da faixa típica 0,40–0,70']);
      if (st.anom && st.anom.length) codes.push(['P0003', 'w', st.anom.length + ' anomalia(s) detectada(s) pelo modelo']);
      h = '<h3>Diagnostics</h3><p class="ep-sub">Os códigos abaixo não vêm da central do carro: são as condições que a própria plataforma detectou na coleta, escritas no formato de código de falha.</p>' +
        '<div class="ecu-code">' + (codes.length
          ? codes.map(function (c) { return '<span class="' + c[1] + '">' + c[0] + '</span>  ' + c[2]; }).join('\n')
          : '<span class="ok">Nenhuma condição anormal detectada nesta coleta.</span>') +
        '\n\n<span class="d">// leitura concluída em ' + U.br(s.n, 0) + ' amostras, ' + U.mmss(s.duration) + ' de coleta</span></div>';

    } else {
      h = '<h3>Telemetry</h3><p class="ep-sub">Resumo da sessão inteira, como a central entregaria ao fim de uma volta.</p>' +
        '<div class="ecu-grid">' +
        tile('SAMPLES', U.br(s.n, 0), '') +
        tile('DURATION', U.mmss(s.duration), '') +
        tile('PEAK COOLANT', U.br(s.ectMax, 1), '°C', s.ectMax >= p.tCrit ? 'crit' : s.ectMax >= p.tWarn ? 'warn' : 'good') +
        tile('MEAN ε', U.br(s.epsMean, 3), '', s.epsInRange ? 'good' : 'warn', s.epsMean) +
        tile('MEAN UA', U.br(s.uaMean, 0), 'W/K') +
        tile('ENERGY', U.br(s.energy, 1), 'MJ') +
        tile('FAN TIME', U.br(s.fanPct, 0), '%', '', s.fanPct / 100) +
        tile('HEALTH', isFinite(s.healthMean) ? U.br(s.healthMean * 100, 0) : '--', '%',
             isFinite(s.healthMean) ? (s.healthMean >= 0.9 ? 'good' : s.healthMean >= 0.75 ? 'warn' : 'crit') : '', s.healthMean) +
        '</div>';
    }
    pane.innerHTML = h;
    if (M) M.reveal(pane.querySelectorAll('.ecu-tile'), 26);
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

  function tuneHtml() {
    var TN = ATC.Tune;
    if (!TN) return '<h3>Tune</h3><p class="ep-sub">Módulo indisponível.</p>';
    var st = TN.state();
    var key = TN.openMap();
    var m = TN.maps[key];
    var grid = st[key];

    var h = '<h3>Tune</h3><p class="ep-sub">' + m.note + '</p>';

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
    var pane = $('#ecuPane');
    if (!pane || !TN) return;
    tunePaint();

    pane.addEventListener('click', function (ev) {
      var m = TN.maps[TN.openMap()], g = TN.state()[TN.openMap()];
      var cell = ev.target.closest('.tc');
      if (cell) {
        TSEL.i = +cell.dataset.i; TSEL.j = +cell.dataset.j;
        refreshTune(); if (A) A.play('tick'); return;
      }
      var tab = ev.target.closest('[data-map]');
      if (tab) { TN.openMap(tab.dataset.map); renderEcu(); if (A) A.play('tick'); return; }
      var pre = ev.target.closest('[data-preset]');
      if (pre) {
        TN.applyPreset(pre.dataset.preset);
        renderEcu();
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
        TN.reset(); renderEcu(); if (A) A.play('relay');
        if (M) M.toast('Mapas de fábrica restaurados', null, 2200);
      }
    });

    var val = document.getElementById('tuneVal');
    if (val) val.addEventListener('change', function () {
      tuneSet(TSEL.i, TSEL.j, parseFloat(val.value));
      refreshTune();
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
    var pane = $('#ecuPane');
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

  function pad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  function engineNotes(st, d) {
    var p = st.params;
    var out = [];
    out.push('<span class="d">// leitura do instante ' + U.mmss(d.t - st.proc.rows[0].t) + '</span>');
    out.push('Regime          ' + d.regime);
    out.push('Termostato      ' + (d.tStatFrac > 0.9 ? '<span class="ok">pleno</span>' : d.tStatFrac > 0.3 ? 'parcial' : '<span class="w">fechado</span>'));
    out.push('Balanço         gerado ' + U.br(d.qGen / 1000, 1) + ' kW, rejeitado ' + U.br(d.q / 1000, 1) + ' kW');
    out.push('Tendência       ' + (isFinite(d.dTdtModel)
      ? (d.dTdtModel > 0.2 ? '<span class="w">aquecendo ' + U.br(d.dTdtModel, 1) + ' °C/min</span>'
        : d.dTdtModel < -0.2 ? '<span class="ok">resfriando ' + U.br(-d.dTdtModel, 1) + ' °C/min</span>'
        : 'estavel')
      : '--'));
    if (isFinite(d.tEq)) out.push('Equilíbrio      estabilizaria em ' + U.br(d.tEq, 1) + ' °C nesta condição');
    return out.join('\n');
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
      paintLeds(rpm);

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
          U.br(peakT, 0) + ' N·m</b> a ' + U.br(peakTRpm, 0) + ' rpm, com os mapas que estão na aba <b>Tune</b>. ' +
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
    var tag = $('#spdSource');
    if (tag) {
      var demo = usingDemo();
      tag.hidden = false;
      tag.textContent = demo ? 'telemetria de demonstração' : 'coleta carregada';
      tag.className = 'badge ' + (demo ? 'warn' : 'ok');
    }
    renderEcu();
    var st = S();
    var G = ATC.Charts, COL = app ? app.colors() : null;
    if (!st || !st.proc || !COL) return;
    var rows = st.proc.rows;
    var series = [
      { name: 'temperatura do líquido', color: COL.hot, width: 1.8,
        data: rows.map(function (d) { return [d.t, d.tHotIn]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' °C'; } },
      { name: 'calor rejeitado', color: COL.q, width: 1.5, axis: 'r',
        data: rows.map(function (d) { return [d.t, d.q / 1000]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' kW'; } }
    ];
    G.update($('#spdTrace'), {
      height: 210, series: series, xFmt: U.mmss,
      xLabel: 'tempo (mm:ss)', yLabel: 'temperatura (°C)', yLabelRight: 'kW',
      hlines: [{ y: st.params.tCrit, color: COL.crit, label: 'crítico' }],
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); },
      onClick: function (x) { seekTime(x); }
    });
  };

  function seekTime(x) {
    var st = S();
    if (!st || !st.proc) return;
    var rows = st.proc.rows, best = 0, bd = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var d = Math.abs(rows[i].t - x);
      if (d < bd) { bd = d; best = i; }
    }
    play.i = best;
  }

  /* ============================================================
     9. Ligacao com a interface
     ============================================================ */
  SP.init = function (application) {
    app = application;

    var bs = $('#btnSpeed');
    if (bs) bs.addEventListener('click', function () { SP.toggle(); });

    var bp = $('#btnSpdPlay');
    if (bp) bp.addEventListener('click', function () {
      play.on = !play.on;
      bp.textContent = play.on ? '‖ Pausar' : '▶ Rodar telemetria';
      if (A) A.play('tick');
    });

    var sc = $('#spdScrub');
    if (sc) sc.addEventListener('input', function () {
      var st = S();
      if (!st || !st.proc) return;
      play.on = false;
      $('#btnSpdPlay').textContent = '▶ Rodar telemetria';
      play.i = Math.round(parseFloat(sc.value) / 100 * (st.proc.rows.length - 1));
    });

    var bn = $('#btnNitro');
    if (bn) bn.addEventListener('click', fireNitro);

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

  SP.isOn = function () { return document.documentElement.dataset.mode === 'speed'; };
  SP.refresh = function () {
    if (!SP.isOn()) return;
    demoCache = null;          /* parametros mudaram: refaz a demonstracao */
    geo.dirty = true; geoAux.dirty = true;
    nitro.charge = 0; nitro.ready = false; play.i = 0;
    SP.renderStatic();
  };

  ATC.Speed = SP;
})(window.ATC = window.ATC || {});
