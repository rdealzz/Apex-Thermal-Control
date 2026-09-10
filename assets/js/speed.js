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
  var play = { on: false, i: 0, t: 0 };
  var nitro = { charge: 0, ready: false };
  var dyno = { running: false };

  function $(s) { return document.querySelector(s); }
  function S() { return app ? app.state() : null; }

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
    ctx.fillStyle = o.needleColor || '#e9eef7';
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
  var geo = { w: 0, h: 0, ctx: null, face: null, dials: null, dirty: true };
  window.addEventListener('resize', function () { geo.dirty = true; }, { passive: true });
  SP.invalidate = function () { geo.dirty = true; };

  /* a configuracao dos tres mostradores, sem o valor: e o que a face
     precisa saber, e o que o quadro reaproveita                    */
  function dialSpecs(w, h) {
    var p = S() ? S().params : { tCrit: 105, tWarn: 100 };
    var narrow = w < 620;
    var Rc = Math.min(h * 0.42, w * (narrow ? 0.29 : 0.19));
    var Rs = Rc * (narrow ? 0.60 : 0.70);
    var cy = h * 0.50;
    var labelY = Rc * 0.94;          /* mesma linha de base para os tres */
    var int0 = function (v) { return String(Math.round(v)); };
    return [
      { key: 'temp', cx: narrow ? w * 0.20 : w * 0.19, cy: cy, R: Rs, labelY: labelY,
        min: 0, max: 130, label: 'COOLANT', unit: '°C',
        color: '#12b6ff', warnAt: p.tWarn, critAt: p.tCrit,
        redFrom: p.tWarn, ticks: 13, tickMajor: 3, tickFmt: int0 },
      { key: 'rpm', cx: w * 0.5, cy: cy, R: Rc, labelY: labelY,
        min: 0, max: 7000, label: 'ENGINE', unit: '× 1000 rpm',
        color: '#3ff0e0', redFrom: 5800, ticks: 14, tickMajor: 2,
        tickFmt: function (v) { return String(Math.round(v / 1000)); } },
      { key: 'spd', cx: narrow ? w * 0.80 : w * 0.81, cy: cy, R: Rs, labelY: labelY,
        min: 0, max: 180, label: 'SPEED', unit: 'km/h',
        color: '#2fe08a', ticks: 12, tickMajor: 3, tickFmt: int0 }
    ];
  }

  function rebuild(cv) {
    var host = cv.parentNode;
    var w = host.clientWidth || 800;
    var h = Math.round(U.clamp(w * 0.40, 260, 400));
    var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
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
      var sc = $('#spdScrub');
      if (sc) sc.value = Math.round(1000 * play.i / Math.max(rows.length - 1, 1)) / 10;
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
    paintLeds(dial.rpm ? dial.rpm.x : 0);
    paintCells(d);

    var tt = $('#spdTime'), tc = $('#teleClock');
    var total = rows[rows.length - 1].t - rows[0].t;
    if (tt) tt.textContent = U.mmss(d.t - rows[0].t) + ' / ' + U.mmss(total);
    if (tc) tc.textContent = U.mmss(d.t - rows[0].t);
  }

  SP.mount = function () {
    geo.dirty = true;
    buildLeds(); buildCells(); buildEcuRail();
    if (!stopFrame && M) stopFrame = M.onFrame(function (dt) { frame(dt); });
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
    { id: 'injectors', l: 'Injectors' }, { id: 'logger', l: 'Logger' },
    { id: 'maps', l: 'Maps' }, { id: 'diag', l: 'Diagnostics' },
    { id: 'telemetry', l: 'Telemetry' }
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
    var T = ATC.Thermal, p = st.params, G = ATC.Charts;
    var COL = app.colors();

    /* ponto de operacao de referencia: media da parte util */
    var rows = st.proc.rows.filter(function (d) { return !d.warmup && isFinite(d.eps); });
    if (!rows.length) rows = st.proc.rows;
    var tHot = 0, tAmb = 0, n = 0;
    rows.forEach(function (d) { if (isFinite(d.tHotIn)) { tHot += d.tHotIn; tAmb += d.tAmb; n++; } });
    tHot /= n || 1; tAmb /= n || 1;

    dyno.running = true;
    $('#btnDyno').disabled = true;
    if (A) A.play('ignition');

    var rpm0 = 800, rpm1 = 6300, dur = 3.0, t = 0;
    var qs = [], eps = [], uas = [];

    M.onFrame(function (dt) {
      t += dt;
      var f = U.clamp(t / dur, 0, 1);
      /* a rotacao sobe como um motor sob carga: rapido no comeco,
         arrastado perto do corte                                  */
      var rpm = rpm0 + (rpm1 - rpm0) * (1 - Math.pow(1 - f, 1.7));
      var speed = U.clamp((rpm - 800) / (rpm1 - 800) * 150, 0, 150);

      var cf = T.coolantFlow(rpm, tHot, p);
      /* o eletroventilador sai de cena exatamente na velocidade em que
         o ar de marcha iguala o que ele entrega — assim a curva nao
         ganha um degrau que a fisica nao tem                          */
      var vSwitch = p.vFan / Math.max(p.kRam, 1e-3) * 3.6;
      var af = T.airFlow(speed, speed < vSwitch ? 1 : 0, tAmb, p);
      var um = T.uaModel(af.mdot, tAmb, cf.mdot, tHot, p);
      var Ch = cf.mdot * cf.prop.cp, Cc = af.mdot * af.prop.cp;
      var Cmin = Math.min(Ch, Cc), Cmax = Math.max(Ch, Cc);
      var Cr = Cmax > 0 ? Cmin / Cmax : 0;
      var ntu = Cmin > 0 ? um.UA / Cmin : 0;
      var e = T.epsCrossflow(ntu, Cr);
      var q = e * Cmin * (tHot - tAmb) / 1000;

      qs.push([rpm, q]); eps.push([rpm, e]); uas.push([rpm, um.UA]);

      var series = [
        { name: 'calor rejeitado', color: COL.q, width: 2.2, area: COL.qArea,
          data: qs, tipFmt: function (v) { return U.br(v, 1) + ' kW'; } },
        { name: 'condutância UA', color: COL.gen, width: 1.7, axis: 'r', dash: true,
          data: uas, tipFmt: function (v) { return U.br(v, 0) + ' W/K'; } }
      ];
      G.update($('#dynoChart'), {
        height: 300, series: series, xMin: rpm0, xMax: rpm1, yMin: 0,
        xLabel: 'rotação do motor (rpm)', yLabel: 'calor rejeitado (kW)', yLabelRight: 'UA (W/K)',
        xFmt: function (v) { return U.br(v, 0); }, yFmt: function (v) { return U.br(v, 0); },
        yFmtRight: function (v) { return U.br(v, 0); },
        tipTitle: function (v) { return U.br(v, 0) + ' rpm'; }
      });
      if (app.legend) app.legend('#legDyno', series);

      txtId('dynoQ', U.br(q, 1));
      txtId('dynoEps', U.br(e, 3));
      txtId('dynoUA', U.br(um.UA, 0));
      txtId('dynoRpm', U.br(rpm, 0));
      paintLeds(rpm);

      if (f >= 1) {
        dyno.running = false;
        $('#btnDyno').disabled = false;
        if (A) A.play('turbo');
        var best = qs.reduce(function (a, b) { return b[1] > a[1] ? b : a; }, qs[0]);
        var e0 = eps[0][1], e1 = eps[eps.length - 1][1];
        var ganho = qs[0][1] > 0.01 ? best[1] / qs[0][1] : NaN;
        $('#dynoRead').innerHTML = 'Pico de <b>' + U.br(best[1], 1) + ' kW</b> a <b>' + U.br(best[0], 0) +
          ' rpm</b>' + (isFinite(ganho) ? ', <b>' + U.br(ganho, 1) + '×</b> o que saía na marcha lenta' : '') +
          '. Repare no que a efetividade fez no mesmo intervalo: caiu de ' + U.br(e0, 3) + ' para ' + U.br(e1, 3) +
          '. As duas coisas são verdade ao mesmo tempo — passa mais líquido, então sai mais calor no total, ' +
          'mas cada quilo de líquido fica menos tempo no núcleo e volta menos resfriado. ' +
          'Ponto de referência desta passada: líquido a ' + U.br(tHot, 1) + ' °C, ar a ' + U.br(tAmb, 1) + ' °C.';
        return false;
      }
    });
  }
  function txtId(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  /* ============================================================
     8. Conteudo estatico das telas do speed mode
     ============================================================ */
  SP.renderStatic = function () {
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
    geo.dirty = true;
    nitro.charge = 0; nitro.ready = false; play.i = 0;
    SP.renderStatic();
  };

  ATC.Speed = SP;
})(window.ATC = window.ATC || {});
