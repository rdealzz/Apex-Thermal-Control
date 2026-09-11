/* ============================================================
   APEX SPEED MODE — cockpit e terminal
   ------------------------------------------------------------
   Os modulos desta tela nao tem estado proprio: todos leem o
   mesmo objeto do simulador, que avanca uma vez por quadro. E por
   isso que mexer na pressao move o bico, a temperatura e a
   detonacao juntos — nao ha nada sincronizando, eles sao a mesma
   coisa vista de angulos diferentes.

   Cada canvas guarda sua propria assinatura do ultimo desenho e
   pula o quadro quando nada mudou, entao a tela parada nao custa.
   ============================================================ */
(function (ATC) {
  'use strict';

  var CK = {};
  var U = ATC.U, M = ATC.Motion;
  var SIM = null, A = null;
  var stop = null, built = false;
  var traceFuel = [], traceAfr = [];
  var TRACE_N = 190;

  function $(s) { return document.querySelector(s); }
  function pad(v, n) { v = String(v); while (v.length < n) v = ' ' + v; return v; }
  function on() { return document.documentElement.dataset.mode === 'speed'; }
  function visible(id) { var e = document.getElementById(id); return e && !e.hidden; }

  /* ============================================================
     Canvas com cache de dimensao e assinatura
     ============================================================ */
  function surf(id, ratio, minH, maxH) {
    var cv = document.getElementById(id);
    if (!cv) return null;
    var host = cv.parentNode;
    var w = host.clientWidth || 320;
    var h = Math.round(U.clamp(w * ratio, minH, maxH));
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.height = h + 'px';
      cv.__ctx = cv.getContext('2d');
      cv.__ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cv.__sig = null;
    }
    if (!cv.__ctx) { cv.__ctx = cv.getContext('2d'); cv.__ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    return { cv: cv, ctx: cv.__ctx, w: w, h: h };
  }
  function fresh(f, sig) {
    if (f.cv.__sig === sig) return false;
    f.cv.__sig = sig;
    f.ctx.clearRect(0, 0, f.w, f.h);
    return true;
  }
  function css(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : fb;
  }

  /* ============================================================
     Conta-giros
     ============================================================ */
  function drawTach(s) {
    var f = surf('ckTach', 0.62, 190, 330);
    if (!f) return;
    var sig = U.br(s.rpm, 0) + '|' + U.br(s.tpsSm, 0) + '|' + (s.limiter ? 1 : 0);
    if (!fresh(f, sig)) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var R = Math.min(H * 0.46, W * 0.30);
    var cx = W / 2, cy = H * 0.54;
    var a0 = Math.PI * 0.74, a1 = Math.PI * 2.26, span = a1 - a0;
    var lim = ATC.Sim.limits;
    /* a escala vai ate 8000 para os numeros cairem em milhares
       inteiros; o corte continua onde a fisica diz que ele esta */
    var SCALE = 8000;
    var frac = U.clamp(s.rpm / SCALE, 0, 1);

    /* aro */
    var g = ctx.createLinearGradient(0, cy - R * 1.1, 0, cy + R * 1.1);
    g.addColorStop(0, '#f4f7fc'); g.addColorStop(0.35, '#98a1b1');
    g.addColorStop(0.55, '#3e4553'); g.addColorStop(1, '#d6dce6');
    ctx.strokeStyle = g; ctx.lineWidth = R * 0.05;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.07, 0, 6.284); ctx.stroke();

    /* trilha e zona vermelha */
    ctx.lineCap = 'butt';
    ctx.lineWidth = R * 0.10;
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    ctx.strokeStyle = css('--crit', '#ff3b30');
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0 + span * (lim.cut / SCALE), a1); ctx.stroke();
    ctx.globalAlpha = 1;

    /* marcas */
    for (var i = 0; i <= 16; i++) {
      var t = i / 16, ang = a0 + span * t, big = i % 2 === 0;
      var r0 = R - R * (big ? 0.22 : 0.15), r1 = R - R * 0.06;
      ctx.strokeStyle = big ? 'rgba(233,238,247,.8)' : 'rgba(233,238,247,.24)';
      ctx.lineWidth = big ? R * 0.024 : R * 0.012;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
      if (big) {
        ctx.fillStyle = 'rgba(170,180,198,.9)';
        ctx.font = '600 ' + Math.round(R * 0.11) + 'px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var rt = R - R * 0.34;
        ctx.fillText(String(Math.round(t * SCALE / 1000)), cx + Math.cos(ang) * rt, cy + Math.sin(ang) * rt);
      }
    }

    /* arco de valor com halo */
    /* a cor vem dos tokens: trocar de tema troca o mostrador junto,
       sem uma linha aqui */
    var col = s.rpm > lim.cut ? css('--crit', '#ff3b30')
            : s.rpm > 5800 ? css('--warn', '#ffb020')
            : css('--cyan', '#3ff0e0');
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.16; ctx.lineWidth = R * 0.24; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * Math.max(frac, 0.002)); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = R * 0.10;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * Math.max(frac, 0.002)); ctx.stroke();

    /* ponteiro */
    var ang2 = a0 + span * frac;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang2);
    var ng = ctx.createLinearGradient(0, -R * 0.04, 0, R * 0.04);
    ng.addColorStop(0, '#fff'); ng.addColorStop(0.5, '#c2c8d4'); ng.addColorStop(1, '#79808f');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.moveTo(-R * 0.07, -R * 0.034); ctx.lineTo(R * 0.86, -R * 0.011);
    ctx.lineTo(R * 0.86, R * 0.011); ctx.lineTo(-R * 0.07, R * 0.034);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = css('--canvas', '#0a0d13');
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 6.284); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = R * 0.018;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 6.284); ctx.stroke();

    /* leitura */
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = css('--ink', '#e9eef7');
    ctx.font = '600 ' + Math.round(R * 0.30) + 'px ui-monospace,monospace';
    ctx.fillText(U.br(s.rpm, 0), cx, cy + R * 0.46);
    ctx.font = '600 ' + Math.max(9, Math.round(R * 0.10)) + 'px ui-monospace,monospace';
    ctx.fillStyle = css('--ink-3', '#7b8699');
    ctx.fillText('rpm', cx, cy + R * 0.64);
    if (s.limiter) {
      ctx.fillStyle = css('--crit', '#ff3b30');
      ctx.font = '700 ' + Math.max(10, Math.round(R * 0.11)) + 'px ui-monospace,monospace';
      ctx.fillText('REV LIMIT', cx, cy - R * 0.42);
    }
  }

  /* ============================================================
     Manometro de pressao
     ============================================================ */
  function drawBoost(s) {
    var f = surf('ckBoost', 0.72, 150, 250);
    if (!f) return;
    if (!fresh(f, U.br(s.boost, 3))) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var R = Math.min(H * 0.44, W * 0.36), cx = W / 2, cy = H * 0.52;
    var a0 = Math.PI * 0.76, a1 = Math.PI * 2.24, span = a1 - a0;
    var lo = -1, hi = 2.2;
    var frac = U.clamp((s.boost - lo) / (hi - lo), 0, 1);

    var g = ctx.createLinearGradient(0, cy - R * 1.1, 0, cy + R * 1.1);
    g.addColorStop(0, '#f4f7fc'); g.addColorStop(0.4, '#98a1b1');
    g.addColorStop(0.6, '#3e4553'); g.addColorStop(1, '#d6dce6');
    ctx.strokeStyle = g; ctx.lineWidth = R * 0.055;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, 6.284); ctx.stroke();

    ctx.lineWidth = R * 0.11; ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    ctx.strokeStyle = css('--crit', '#ff3b30');
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0 + span * ((1.7 - lo) / (hi - lo)), a1); ctx.stroke();
    ctx.globalAlpha = 1;

    for (var i = 0; i <= 8; i++) {
      var ang = a0 + span * (i / 8);
      ctx.strokeStyle = 'rgba(233,238,247,.5)'; ctx.lineWidth = R * 0.018;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (R - R * 0.19), cy + Math.sin(ang) * (R - R * 0.19));
      ctx.lineTo(cx + Math.cos(ang) * (R - R * 0.07), cy + Math.sin(ang) * (R - R * 0.07));
      ctx.stroke();
    }

    var col = s.boost > 1.7 ? css('--crit', '#ff3b30') : css('--boost', '#ff8a1f');
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.18; ctx.lineWidth = R * 0.26; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * Math.max(frac, 0.002)); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = R * 0.11;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * Math.max(frac, 0.002)); ctx.stroke();

    var a2 = a0 + span * frac;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a2);
    ctx.fillStyle = css('--ink', '#e9eef7');
    ctx.beginPath();
    ctx.moveTo(-R * 0.07, -R * 0.03); ctx.lineTo(R * 0.84, -R * 0.01);
    ctx.lineTo(R * 0.84, R * 0.01); ctx.lineTo(-R * 0.07, R * 0.03);
    ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = css('--canvas', '#0a0d13');
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 6.284); ctx.fill();

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = css('--ink', '#e9eef7');
    ctx.font = '600 ' + Math.round(R * 0.34) + 'px ui-monospace,monospace';
    ctx.fillText(U.br(s.boost, 2), cx, cy + R * 0.48);
    ctx.font = '600 ' + Math.max(9, Math.round(R * 0.12)) + 'px ui-monospace,monospace';
    ctx.fillStyle = css('--ink-3', '#7b8699');
    ctx.fillText('bar', cx, cy + R * 0.68);
  }

  /* ============================================================
     Tracos de linha: pressao de combustivel e mistura
     ============================================================ */
  function drawTrace(id, ratio, minH, maxH, data, opt) {
    var f = surf(id, ratio, minH, maxH);
    if (!f || !data.length) return;
    if (!fresh(f, data.length + '|' + U.br(data[data.length - 1].a, 3) + '|' + U.br(data[data.length - 1].b, 3))) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var padL = 34, padR = 8, padT = 8, padB = 14;
    var pw = W - padL - padR, ph = H - padT - padB;

    ctx.strokeStyle = css('--chart-grid', '#161c27'); ctx.lineWidth = 1;
    for (var k = 0; k <= 3; k++) {
      var y = padT + ph * k / 3;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
      ctx.fillStyle = css('--chart-ink', '#7b8699');
      ctx.font = '9.5px ui-monospace,monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(U.br(opt.hi - (opt.hi - opt.lo) * k / 3, opt.dec), padL - 5, y);
    }
    function px(i) { return padL + pw * i / Math.max(TRACE_N - 1, 1); }
    function py(v) { return padT + ph * (1 - U.clamp((v - opt.lo) / (opt.hi - opt.lo), 0, 1)); }

    if (opt.showB) {
      ctx.strokeStyle = '#7b8699'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      data.forEach(function (d, i) { i ? ctx.lineTo(px(i), py(d.b)) : ctx.moveTo(px(i), py(d.b)); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    /* o preenchimento sai da propria cor da linha, com transparencia:
       assim o tema troca os dois de uma vez */
    var base = opt.color || css('--acc', '#12b6ff');
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
    grad.addColorStop(0, 'color-mix(in srgb,' + base + ' 26%,transparent)');
    grad.addColorStop(1, 'color-mix(in srgb,' + base + ' 0%,transparent)');
    ctx.beginPath();
    data.forEach(function (d, i) { i ? ctx.lineTo(px(i), py(d.a)) : ctx.moveTo(px(i), py(d.a)); });
    ctx.lineTo(px(data.length - 1), padT + ph); ctx.lineTo(px(0), padT + ph); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.strokeStyle = opt.color || '#12b6ff'; ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach(function (d, i) { i ? ctx.lineTo(px(i), py(d.a)) : ctx.moveTo(px(i), py(d.a)); });
    ctx.stroke();

    var last = data[data.length - 1];
    ctx.fillStyle = opt.color || '#12b6ff';
    ctx.beginPath(); ctx.arc(px(data.length - 1), py(last.a), 3, 0, 6.284); ctx.fill();
  }

  /* ============================================================
     Data logger
     ------------------------------------------------------------
     Um anel de amostras a 10 Hz, tres minutos de memoria. Janela e
     posicao sao dois cursores em vez de uma roda do mouse: numa
     pagina que rola, roda do mouse sobre um grafico e armadilha.

     Cada canal tem escala propria e e desenhado normalizado, senao
     rotacao em milhares esmaga pressao em decimos no mesmo eixo. A
     leitura embaixo e que devolve as unidades.
     ============================================================ */
  var LOG_HZ = 10, LOG_MAX = 1800;
  var logBuf = [], logRec = true, logAcc = 0;
  var logView = { zoom: 1, pan: 1 };      /* fracao do buffer e posicao do fim */
  var logCur = null, logPins = [];

  var CH = [
    { k: 'rpm',   l: 'RPM',   u: '',     lo: 0,    hi: 7200, dec: 0, c: '--cyan',    on: true },
    { k: 'boost', l: 'BOOST', u: ' bar', lo: -0.3, hi: 2.2,  dec: 2, c: '--boost',   on: true },
    { k: 'iat',   l: 'IAT',   u: ' °C',  lo: 0,    hi: 110,  dec: 0, c: '--acc',     on: true },
    { k: 'ect',   l: 'ECT',   u: ' °C',  lo: 60,   hi: 135,  dec: 0, c: '--silver-2',on: true },
    { k: 'afr',   l: 'AFR',   u: ':1',   lo: 9,    hi: 18,   dec: 1, c: '--silver-4',on: false },
    { k: 'duty',  l: 'DUTY',  u: ' %',   lo: 0,    hi: 125,  dec: 0, c: '--acc-2',   on: false },
    { k: 'tpsSm', l: 'TPS',   u: ' %',   lo: 0,    hi: 100,  dec: 0, c: '--ink-4',   on: false }
  ];

  function logPush(s, dt) {
    if (!logRec) return;
    logAcc += dt;
    if (logAcc < 1 / LOG_HZ) return;
    logAcc = 0;
    logBuf.push({
      t: s.t, rpm: s.rpm, boost: s.boost, iat: s.iat, ect: s.ect,
      afr: s.afr, duty: s.duty, tpsSm: s.tpsSm, cut: s.cut, knk: s.knock > 0.45
    });
    if (logBuf.length > LOG_MAX) logBuf.shift();
  }

  /* a janela visivel, em indices */
  function logWin() {
    var n = logBuf.length;
    if (!n) return { a: 0, b: 0, n: 0 };
    var len = Math.max(12, Math.round(n * logView.zoom));
    var end = Math.round(len + (n - len) * logView.pan);
    return { a: Math.max(0, end - len), b: Math.min(n, end), n: n };
  }

  function drawLog() {
    var f = surf('ckLog', 0.34, 150, 260);
    if (!f) return;
    var w = logWin();
    var act = CH.filter(function (c) { return c.on; });
    var sig = [logBuf.length, w.a, w.b, act.length, logCur, logPins.join(','), logRec ? 1 : 0].join('|');
    if (!fresh(f, sig)) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var padL = 8, padR = 8, padT = 8, padB = 16;
    var pw = W - padL - padR, ph = H - padT - padB;
    var m = w.b - w.a;

    ctx.strokeStyle = css('--chart-grid', '#161c27'); ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var y = padT + ph * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
    }
    if (m < 2) {
      ctx.fillStyle = css('--ink-4', '#5a6376');
      ctx.font = '10.5px ui-monospace,monospace'; ctx.textAlign = 'center';
      ctx.fillText('aguardando amostras…', W / 2, H / 2);
      return;
    }
    function px(i) { return padL + pw * (i - w.a) / Math.max(m - 1, 1); }
    function py(v, c) { return padT + ph * (1 - U.clamp((v - c.lo) / (c.hi - c.lo), 0, 1)); }

    /* faixas de evento: corte e detonacao marcam o fundo, nao a linha */
    for (var i = w.a; i < w.b; i++) {
      var d = logBuf[i];
      if (!d.cut && !d.knk) continue;
      ctx.fillStyle = d.cut ? 'rgba(255,59,48,.16)' : 'rgba(255,176,32,.13)';
      ctx.fillRect(px(i) - 1, padT, Math.max(2, pw / m + 1), ph);
    }

    act.forEach(function (c) {
      ctx.strokeStyle = css(c.c, '#7b8699');
      ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
      for (var i = w.a; i < w.b; i++) {
        var x = px(i), y = py(logBuf[i][c.k], c);
        i === w.a ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    /* marcadores A e B, depois o cursor por cima */
    logPins.forEach(function (idx, n) {
      if (idx < w.a || idx >= w.b) return;
      var x = px(idx);
      ctx.strokeStyle = css('--ink-3', '#7b8699'); ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css('--ink-3', '#7b8699');
      ctx.font = '600 9.5px ui-monospace,monospace'; ctx.textAlign = 'center';
      ctx.fillText(n ? 'B' : 'A', x, padT + ph + 11);
    });
    if (logCur !== null && logCur >= w.a && logCur < w.b) {
      var xc = px(logCur);
      ctx.strokeStyle = css('--acc', '#12b6ff'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xc, padT); ctx.lineTo(xc, padT + ph); ctx.stroke();
      act.forEach(function (c) {
        ctx.fillStyle = css(c.c, '#7b8699');
        ctx.beginPath(); ctx.arc(xc, py(logBuf[logCur][c.k], c), 2.6, 0, 6.284); ctx.fill();
      });
    }

    /* eixo de tempo: so os extremos, o meio o cursor informa */
    ctx.fillStyle = css('--ink-4', '#5a6376');
    ctx.font = '9.5px ui-monospace,monospace';
    ctx.textAlign = 'left';
    ctx.fillText('-' + U.br((logBuf[w.b - 1].t - logBuf[w.a].t), 0) + ' s', padL, H - 4);
    ctx.textAlign = 'right';
    ctx.fillText(logRec ? 'agora' : 'pausado', padL + pw, H - 4);
  }

  function logReadout() {
    var e = $('#ckLogRead');
    if (!e) return;
    if (logCur === null || !logBuf[logCur]) {
      e.innerHTML = logPins.length
        ? 'marcadores em A' + (logPins.length > 1 ? ' e B' : '') + ' · clique de novo para trocar · passe o ponteiro para ler'
        : 'passe o ponteiro sobre o traço para ler o instante · clique para marcar A e B';
      return;
    }
    var d = logBuf[logCur];
    var partes = CH.filter(function (c) { return c.on; }).map(function (c) {
      return '<span style="color:' + css(c.c, '#7b8699') + '">' + c.l + '</span> ' +
        U.br(d[c.k], c.dec) + c.u;
    });
    var h = partes.join(' · ');
    if (logPins.length === 2) {
      var A = logBuf[logPins[0]], B = logBuf[logPins[1]];
      if (A && B) {
        h += '<br>A→B em ' + U.br(Math.abs(B.t - A.t), 1) + ' s: ' +
          CH.filter(function (c) { return c.on; }).map(function (c) {
            var dv = B[c.k] - A[c.k];
            return c.l + ' ' + (dv >= 0 ? '+' : '') + U.br(dv, c.dec) + c.u;
          }).join(' · ');
      }
    } else if (d.cut) {
      h += '<br><span class="e">corte de overboost neste instante</span>';
    }
    e.innerHTML = h;
  }

  function buildLog() {
    var host = $('#ckLogChans');
    if (!host || host.childNodes.length) return;
    host.innerHTML = CH.map(function (c, i) {
      return '<button class="log-ch' + (c.on ? ' on' : '') + '" data-ch="' + i + '"' +
        ' style="--c:' + css(c.c, '#7b8699') + '"><i></i>' + c.l + '</button>';
    }).join('');
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ch]');
      if (!b) return;
      var c = CH[+b.dataset.ch];
      /* nunca deixar a tela vazia: o ultimo canal aceso nao apaga */
      if (c.on && CH.filter(function (x) { return x.on; }).length === 1) return;
      c.on = !c.on;
      b.classList.toggle('on', c.on);
      if (A) A.play('tick');
      logReadout();
    });
  }

  function wireLog() {
    var cv = $('#ckLog');
    if (cv && !cv.__w) {
      cv.__w = 1;
      var pick = function (ev) {
        var r = cv.getBoundingClientRect();
        var w = logWin();
        if (w.b - w.a < 2) return null;
        var k = U.clamp((ev.clientX - r.left - 8) / Math.max(r.width - 16, 1), 0, 1);
        return w.a + Math.round(k * (w.b - w.a - 1));
      };
      cv.addEventListener('pointermove', function (ev) {
        var i = pick(ev);
        if (i === logCur) return;
        logCur = i; logReadout();
      });
      cv.addEventListener('pointerleave', function () { logCur = null; logReadout(); });
      cv.addEventListener('click', function (ev) {
        var i = pick(ev);
        if (i === null) return;
        /* dois marcadores bastam: o terceiro clique recomeca do A */
        if (logPins.length >= 2) logPins = [];
        logPins.push(i);
        logPins.sort(function (a, b) { return a - b; });
        if (A) A.play('tick');
        logReadout();
      });
    }
    var rec = $('#ckLogRec');
    if (rec && !rec.__w) {
      rec.__w = 1;
      rec.addEventListener('click', function () {
        logRec = !logRec;
        rec.setAttribute('aria-pressed', String(logRec));
        rec.textContent = logRec ? '⏸ PAUSAR' : '⏵ GRAVAR';
        var s = $('#ckLogS');
        if (s) s.textContent = logRec ? 'gravando' : 'pausado';
        if (A) A.play('relay');
      });
    }
    var z = $('#ckLogZoom');
    if (z && !z.__w) {
      z.__w = 1;
      z.addEventListener('input', function () { logView.zoom = +z.value / 100; });
    }
    var pn = $('#ckLogPan');
    if (pn && !pn.__w) {
      pn.__w = 1;
      pn.addEventListener('input', function () { logView.pan = +pn.value / 100; });
    }
    var cl = $('#ckLogClear');
    if (cl && !cl.__w) {
      cl.__w = 1;
      cl.addEventListener('click', function () {
        logBuf = []; logPins = []; logCur = null;
        if (A) A.play('relay');
        logReadout();
      });
    }
  }

  /* ============================================================
     Controle de pressao
     ============================================================ */
  var TB = [
    { id: 'ckSol',     k: 'solenoid',    dec: 0, u: ' %' },
    { id: 'ckOver',    k: 'overboost',   dec: 2, u: ' bar' },
    { id: 'ckLcRpm',   k: 'launchRpm',   dec: 0, u: '' },
    { id: 'ckLcBoost', k: 'launchBoost', dec: 2, u: ' bar' }
  ];

  function buildTurbo() {
    var host = $('#ckGb');
    if (!host || host.childNodes.length) return;
    var c = SIM.ctl();
    host.innerHTML = c.boostByGear.map(function (f, i) {
      return '<div class="gb" id="gb' + (i + 1) + '">' +
        '<input type="range" data-gb="' + (i + 1) + '" min="0" max="120" step="5" value="' +
        Math.round(f * 100) + '" aria-label="Fator de pressão da marcha ' + (i + 1) + '">' +
        '<span class="gb-n">' + (i + 1) + '</span>' +
        '<span class="gb-v" id="gbv' + (i + 1) + '">' + U.br(f * 100, 0) + '%</span></div>';
    }).join('');
    host.addEventListener('input', function (ev) {
      var el = ev.target.closest('[data-gb]');
      if (!el) return;
      var g = +el.dataset.gb;
      SIM.setGearBoost(g, +el.value / 100);
      var v = document.getElementById('gbv' + g);
      if (v) v.textContent = U.br(+el.value, 0) + '%';
      turboSig = '';
    });
  }

  function wireTurbo() {
    TB.forEach(function (b) {
      var el = document.getElementById(b.id);
      if (!el || el.__w) return;
      el.__w = 1;
      var paint = function () {
        var out = document.getElementById(b.id + 'V');
        if (out) out.textContent = U.br(parseFloat(el.value), b.dec) + b.u;
      };
      el.addEventListener('input', function () {
        SIM.set(b.k, parseFloat(el.value));
        paint(); turboSig = '';
      });
      el.addEventListener('change', function () { if (A) A.play('tick'); });
      el.value = SIM.ctl()[b.k];
      paint();
    });
  }

  var turboSig = '';
  function paintTurbo(s) {
    var c = SIM.ctl();
    var sig = [U.br(s.spool * 100, 0), U.br(s.boost, 2), c.gear, s.cut ? 1 : 0, s.cutCount].join('|');
    if (sig === turboSig) return;
    turboSig = sig;
    var hs = $('#ckTbS');
    if (hs) {
      hs.textContent = 'spool ' + U.br(s.spool * 100, 0) + ' %';
      hs.classList.toggle('warn', s.cut);
    }
    /* a marcha corrente fica marcada na fileira: e ela que decide o
       teto agora, as outras cinco sao intencao para depois */
    for (var g = 1; g <= 6; g++) {
      var el = document.getElementById('gb' + g);
      if (el) el.classList.toggle('live', g === c.gear);
    }
    var r = $('#ckTbRead');
    if (r) {
      r.innerHTML =
        'teto desta marcha <b>' + U.br(s.boostCmd, 2) + ' bar</b> · entregue ' +
        U.br(s.boost, 2) + ' bar<br>' +
        (s.cut ? '<span class="e">CORTE — pressão acima de ' + U.br(c.overboost, 2) + ' bar</span>'
               : s.cutCount ? '<span class="w">' + s.cutCount + ' corte(s) de overboost nesta sessão</span>'
                            : s.spool < 0.15 ? 'turbina fora da faixa — precisa de giro'
                                             : 'dentro do teto');
    }
  }

  /* ============================================================
     Blocos de DOM: bicos, sensores, LEDs
     ============================================================ */
  function buildOnce() {
    if (built) return;
    var inj = $('#ckInj');
    if (inj && !inj.childNodes.length) {
      inj.innerHTML = [1, 2, 3, 4].map(function (n) {
        return '<div class="inj"><div class="inj-l">INJ ' + n + '</div>' +
          '<div class="inj-bar"><i id="ckInjB' + n + '"></i></div>' +
          '<div class="inj-v" id="ckInjV' + n + '">0 %</div></div>';
      }).join('');
    }
    var strip = $('#ckShift');
    if (strip && !strip.childNodes.length) {
      ['g','g','g','g','y','y','y','r','r','r'].forEach(function (c) {
        var d = document.createElement('span'); d.className = 'led ' + c; strip.appendChild(d);
      });
      wireLeds(strip);
    }
    var pre = $('#ckBoostPresets');
    if (pre && !pre.childNodes.length) {
      pre.innerHTML = [0.4, 0.8, 1.2, 1.6, 2.0].map(function (b) {
        return '<button class="preset" data-boost="' + b + '">' + U.br(b, 1) + '</button>';
      }).join('');
    }
    var gears = $('#ckGears');
    if (gears && !gears.childNodes.length) {
      gears.innerHTML = '<span class="knob-l">GEAR</span>' + [1,2,3,4,5,6].map(function (g) {
        return '<button class="knob" data-gear="' + g + '">' + g + '</button>';
      }).join('');
    }
    var sens = $('#ckSens');
    if (sens && !sens.childNodes.length && ATC.Sim) {
      sens.innerHTML = ATC.Sim.sensors().map(function (x) {
        return '<div class="sens" id="sn-' + x.id + '"><span class="sn-led"></span>' +
          '<span class="sn-l">' + x.l + '</span>' +
          '<span class="sn-v" id="snv-' + x.id + '">--</span>' +
          '<span class="sn-u">' + x.u + '</span>' +
          '<span class="sn-bar"><i id="snb-' + x.id + '"></i></span></div>';
      }).join('');
      var bs = $('#ckBusS');
      if (bs) bs.textContent = ATC.Sim.sensors().length + ' sensores';
    }
    buildLog();
    buildTurbo();
    built = true;
  }

  /* ============================================================
     A regua de LEDs sob o dedo
     ------------------------------------------------------------
     Ensaiar a barra com a mao e o gesto de quem confere se a coisa
     funciona antes de usar. Aqui o ensaio nao mexe em nada: acende
     o LED sob o ponteiro e os anteriores, diz a que rotacao aquele
     LED responde, e some quando o ponteiro sai.
     ============================================================ */
  function ledRpm(i, n) {
    var lim = ATC.Sim.limits;
    return 2600 + (lim.cut - 2600) * ((i + 1) / n);
  }
  function wireLeds(strip) {
    if (strip.__w) return;
    strip.__w = 1;
    var tip = $('#ckLedTip');
    var leds = Array.prototype.slice.call(strip.children);
    strip.addEventListener('pointermove', function (ev) {
      var r = strip.getBoundingClientRect();
      var k = U.clamp((ev.clientX - r.left) / Math.max(r.width, 1), 0, 0.9999);
      var idx = Math.floor(k * leds.length);
      if (strip.__idx === idx) return;
      strip.__idx = idx;
      strip.dataset.probe = '1';
      leds.forEach(function (l, i) { l.classList.toggle('probe', i <= idx); });
      if (tip) tip.innerHTML = 'LED ' + (idx + 1) + ' · acende em <b>' +
        U.br(ledRpm(idx, leds.length), 0) + ' rpm</b>';
    });
    strip.addEventListener('pointerleave', function () {
      strip.__idx = -1;
      delete strip.dataset.probe;
      leds.forEach(function (l) { l.classList.remove('probe'); });
      if (tip) tip.textContent = '';
    });
  }

  var lastLed = -1;
  function paintDom(s) {
    /* LEDs de troca */
    var strip = $('#ckShift');
    if (strip) {
      var leds = strip.children, n = leds.length;
      var lit = Math.round(U.clamp((s.rpm - 2600) / (ATC.Sim.limits.cut - 2600), 0, 1) * n);
      if (lit !== lastLed) {
        for (var i = 0; i < n; i++) leds[i].classList.toggle('on', i < lit);
        lastLed = lit;
      }
      strip.classList.toggle('flash', s.limiter);
    }
    /* bicos */
    for (var j = 1; j <= 4; j++) {
      var b = document.getElementById('ckInjB' + j), v = document.getElementById('ckInjV' + j);
      if (b) b.style.transform = 'scaleX(' + (U.clamp(s.inj[j - 1] / 125, 0, 1)).toFixed(3) + ')';
      if (v) v.textContent = U.br(s.inj[j - 1], 0) + ' %';
    }
    var is = $('#ckInjS');
    if (is) is.textContent = 'duty ' + U.br(s.duty, 0) + ' %' + (s.duty > 92 ? ' · SATURANDO' : '');
    if (is) is.classList.toggle('warn', s.duty > 92);

    /* sensores */
    ATC.Sim.sensors().forEach(function (x) {
      var e = document.getElementById('snv-' + x.id);
      if (e) {
        var t = U.br(x.v, x.d);
        if (e.textContent !== t) e.textContent = t;
      }
      var bar = document.getElementById('snb-' + x.id);
      if (bar) bar.style.transform = 'scaleX(' + U.clamp(x.v / x.max, 0, 1).toFixed(3) + ')';
      var host = document.getElementById('sn-' + x.id);
      if (host) host.classList.toggle('warn', !!x.warn);
    });

    var lam = $('#ckLambda');
    if (lam) lam.textContent = 'λ ' + U.br(s.lambda, 3);
    var fs = $('#ckFuelS');
    if (fs) fs.textContent = 'alvo ' + U.br(s.fuelTarget, 2) + ' bar';

    paintBench(s);
  }

  /* ============================================================
     Leituras da bancada
     ------------------------------------------------------------
     Estas tres linhas sao o unico lugar da tela onde se ve o que
     o potenciometro produziu em vez do que ele pede. Sao escritas
     com a precisao arredondada de proposito: assim a assinatura
     muda umas poucas vezes por segundo e o DOM nao e reescrito a
     cada quadro so porque o terceiro decimal mexeu.
     ============================================================ */
  var benchSig = '';
  function paintBench(s) {
    var c = SIM.ctl();
    var sig = [U.br(s.afr, 1), U.br(s.duty, 0), U.br(s.iat, 0), U.br(s.ect, 0),
               s.fan ? 1 : 0, U.br(s.map, 0), s.phase, s.manual ? 1 : 0, c.auto ? 1 : 0].join('|');
    if (sig === benchSig) return;
    benchSig = sig;

    var restr = U.clamp(c.intakeRestr, 0, 60) / 100;
    var ve = (1 - restr * 0.42) * 100;

    var f = $('#calReadFuel');
    if (f) {
      var carga = s.tpsSm > 25;
      var rico = s.afr < 12.0, pobre = s.afr > 13.4, sat = s.duty > 92;
      f.innerHTML =
        'entregue <b>' + U.br(s.afr, 1) + ':1</b> · λ ' + U.br(s.lambda, 3) +
        ' · comando ' + U.br(s.afrCmd, 1) + ':1<br>' +
        'bico <span class="' + (sat ? 'w' : '') + '">' + U.br(s.duty, 0) + ' %</span> · trilho ' +
        U.br(s.fuelReal, 2) + ' bar · ' +
        (pobre ? (carga ? '<span class="e">pobre sob carga</span>'
                        : 'pobre, mas em carga leve')
               : rico ? 'rica — segura a detonação, gasta mais'
                      : 'dentro da janela');
    }

    var a = $('#calReadAir');
    if (a) {
      var sobre = s.iat - c.ambT;
      a.innerHTML =
        'IAT <b>' + U.br(s.iat, 0) + ' °C</b> · ' + (sobre >= 0 ? '+' : '') + U.br(sobre, 0) +
        ' °C sobre o ambiente<br>' +
        'enchimento ' + U.br(ve, 0) + ' % · MAP ' + U.br(s.map, 0) + ' kPa · ' +
        /* ar quente por compressao mal resfriada e problema de
           intercooler; ar quente porque o dia esta quente, nao e  */
        (s.iat > 65 ? '<span class="e">ar quente demais</span>'
                    : sobre > 18 ? '<span class="w">intercooler no limite</span>'
                                 : s.iat > 52 ? '<span class="w">o ambiente já entra quente</span>'
                                              : 'admissão fria');
    }

    var e = $('#calReadEct');
    if (e) {
      e.innerHTML =
        'ECT <b>' + U.br(s.ect, 0) + ' °C</b> · termostato ' + U.br(s.thermoOpen * 100, 0) + ' % aberto<br>' +
        'ventoinha ' + (s.fan ? '<b>LIGADA</b>' : 'desligada') + ' · ' +
        (s.ect < 115 ? 'margem ' + U.br(115 - s.ect, 0) + ' °C'
                     : '<span class="e">' + U.br(s.ect - 115, 0) + ' °C acima da margem</span>') + ' · ' +
        (s.ect > 108 ? '<span class="e">acima do limite</span>'
                     : s.ect > 103 ? '<span class="w">subindo</span>'
                                   : 'estável');
    }

    var ph = $('#ckPhase');
    if (ph) ph.textContent = s.phase;
    var cs = $('#ckCalS');
    if (cs) cs.textContent = (c.auto ? 'piloto virtual' : 'comando manual') + ' · ' + s.phase;
  }

  /* ============================================================
     Um quadro
     ============================================================ */
  function frame(dt) {
    if (!on() || !SIM) return;
    var s = SIM.tick(dt);

    /* o traco anda mesmo com a aba escondida, senao ao voltar o
       grafico aparece vazio                                      */
    traceFuel.push({ a: s.fuelReal, b: s.fuelTarget });
    traceAfr.push({ a: s.afr, b: 14.7 });
    if (traceFuel.length > TRACE_N) traceFuel.shift();
    if (traceAfr.length > TRACE_N) traceAfr.shift();
    logPush(s, dt);

    /* os modulos vivem em duas telas agora: pressao e mistura no
       Remap, motor e gravacao na Bancada. Desenhar o que esta
       escondido custa por nada, entao cada grupo checa a sua.    */
    var remap = visible('tab-remap'), banc = visible('tab-cockpit');
    if (!remap && !banc) return;
    buildOnce();

    if (remap) {
      drawBoost(s);
      drawTrace('ckFuel', 0.42, 92, 150, traceFuel, { lo: 2.4, hi: 5.4, dec: 1, color: css('--acc', '#12b6ff'), showB: true });
      drawTrace('ckAfrTrace', 0.30, 62, 104, traceAfr, { lo: 10, hi: 17, dec: 1, color: css('--cyan', '#3ff0e0'), showB: true });
      paintTurbo(s);
    }
    if (banc) {
      drawTach(s);
      drawLog();
      var thr = $('#ckThrFill');
      if (thr) thr.style.transform = 'scaleX(' + (s.tpsSm / 100).toFixed(3) + ')';
    }
    paintDom(s);
  }

  /* ============================================================
     Controles
     ============================================================ */
  function wire() {
    var ctl = SIM.ctl();

    /* pedal: segurar acelera, soltar alivia */
    var thr = $('#ckThrottle');
    if (thr && !thr.__w) {
      thr.__w = 1;
      var press = function (e) { e.preventDefault(); SIM.blip(true); thr.classList.add('on'); if (A) A.play('press'); };
      var rel = function () { SIM.blip(false); thr.classList.remove('on'); if (A) A.play('turbo'); };
      thr.addEventListener('pointerdown', press);
      thr.addEventListener('pointerup', rel);
      thr.addEventListener('pointercancel', rel);
      thr.addEventListener('pointerleave', rel);
    }

    var pre = $('#ckBoostPresets');
    if (pre && !pre.__w) {
      pre.__w = 1;
      pre.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-boost]');
        if (!b) return;
        SIM.set('boostTarget', parseFloat(b.dataset.boost));
        pre.querySelectorAll('.preset').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        if (A) A.play('relay');
        if (M) M.toast('Pressão alvo ' + b.dataset.boost.replace('.', ',') + ' bar', null, 1800);
      });
    }

    var gears = $('#ckGears');
    if (gears && !gears.__w) {
      gears.__w = 1;
      gears.addEventListener('click', function (ev) {
        var g = ev.target.closest('[data-gear]');
        if (!g) return;
        SIM.set('gear', +g.dataset.gear);
        gears.querySelectorAll('.knob').forEach(function (x) { x.classList.toggle('on', x === g); });
        var lab = $('#ckGearLab');
        if (lab) lab.textContent = 'GEAR ' + g.dataset.gear;
        if (A) A.play('tick');
      });
    }

    var wg = $('#ckWg');
    if (wg && !wg.__w) {
      wg.__w = 1;
      wg.addEventListener('input', function () {
        SIM.set('wgDuty', +wg.value);
        $('#ckWgV').textContent = wg.value + ' %';
        $('#ckBoostS').textContent = 'wastegate ' + wg.value + ' %';
      });
    }

    var afr = $('#ckAfr');
    if (afr && !afr.__w) {
      afr.__w = 1;
      afr.addEventListener('input', function () {
        var v = parseFloat(afr.value);
        SIM.set('afrTarget', v);
        $('#ckAfrV').textContent = U.br(v, 1);
        var pot = $('#calAfr');
        if (pot) { pot.value = v; benchPaintOne({ id: 'calAfr', k: 'afrTarget', dec: 1, u: '' }); }
      });
      afr.addEventListener('change', function () { benchSave(); });
    }

    var lc = $('#ckLaunch');
    if (lc && !lc.__w) {
      lc.__w = 1;
      lc.addEventListener('click', function () {
        var now = lc.getAttribute('aria-pressed') !== 'true';
        lc.setAttribute('aria-pressed', String(now));
        lc.classList.toggle('on', now);
        SIM.launch(now);
        if (A) A.play(now ? 'ignition' : 'relay');
        if (M) M.toast(now ? 'Launch control armado' : 'Launch control desarmado', null, 2000);
      });
    }

    wireBench();
    wireTurbo();
    wireLog();

    /* estado inicial dos botoes */
    var d = document.querySelector('[data-boost="0.8"]');
    if (d) d.classList.add('on');
    var g3 = document.querySelector('[data-gear="3"]');
    if (g3) g3.classList.add('on');
  }

  /* ============================================================
     Bancada: mistura, admissao e temperatura
     ------------------------------------------------------------
     Nove potenciometros, um objeto de controle, nenhum caminho
     paralelo: cada um escreve direto na mesma estrutura que a
     simulacao le no quadro seguinte. Nao ha "aplicar" porque nao
     ha nada a sincronizar — e por isso que a agulha responde
     enquanto o dedo ainda esta no controle.
     ============================================================ */
  var BENCH = [
    { id: 'calAfr',    k: 'afrTarget',   dec: 1, u: '' },
    { id: 'calTrim',   k: 'fuelTrim',    dec: 0, u: ' %' },
    { id: 'calRail',   k: 'railBase',    dec: 1, u: ' bar' },
    { id: 'calAmb',    k: 'ambT',        dec: 0, u: ' °C' },
    { id: 'calIc',     k: 'icEff',       dec: 0, u: ' %' },
    { id: 'calRestr',  k: 'intakeRestr', dec: 0, u: ' %' },
    { id: 'calThermo', k: 'thermo',      dec: 0, u: ' °C' },
    { id: 'calFan',    k: 'fanOn',       dec: 0, u: ' °C' },
    { id: 'calRad',    k: 'radCap',      dec: 0, u: ' %' }
  ];
  var BENCH_DEF = null;

  function benchPaintOne(b) {
    var el = document.getElementById(b.id);
    var out = document.getElementById(b.id + 'V');
    if (!el) return;
    var v = parseFloat(el.value);
    if (out) out.textContent = (b.k === 'fuelTrim' && v > 0 ? '+' : '') + U.br(v, b.dec) + b.u;
  }

  function benchSave() {
    var c = SIM.ctl(), o = {};
    BENCH.forEach(function (b) { o[b.k] = c[b.k]; });
    o.auto = c.auto;
    U.store.set('bench', o);
  }

  function benchApply(vals, quiet) {
    BENCH.forEach(function (b) {
      if (!(b.k in vals)) return;
      var el = document.getElementById(b.id);
      var v = parseFloat(vals[b.k]);
      if (!isFinite(v)) return;
      if (el) {
        v = U.clamp(v, parseFloat(el.min), parseFloat(el.max));
        el.value = v;
      }
      SIM.set(b.k, v);
      benchPaintOne(b);
    });
    /* a mistura tem dois controles na tela: o potenciometro da
       bancada e o cursor grande do modulo AIR/FUEL. Sao o mesmo
       numero, entao os dois andam juntos                        */
    if ('afrTarget' in vals) {
      var big = $('#ckAfr');
      if (big) { big.value = SIM.ctl().afrTarget; }
      var bv = $('#ckAfrV');
      if (bv) bv.textContent = U.br(SIM.ctl().afrTarget, 1);
    }
    if (!quiet) benchSave();
  }

  function wireBench() {
    var c = SIM.ctl();
    if (!BENCH_DEF) {
      BENCH_DEF = {};
      BENCH.forEach(function (b) { BENCH_DEF[b.k] = c[b.k]; });
      BENCH_DEF.auto = c.auto;
    }

    BENCH.forEach(function (b) {
      var el = document.getElementById(b.id);
      if (!el || el.__w) return;
      el.__w = 1;
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        SIM.set(b.k, v);
        benchPaintOne(b);
        if (b.k === 'afrTarget') {
          var big = $('#ckAfr'); if (big) big.value = v;
          var bv = $('#ckAfrV'); if (bv) bv.textContent = U.br(v, 1);
        }
        benchSig = '';
      });
      el.addEventListener('change', function () { benchSave(); if (A) A.play('tick'); });
    });

    var auto = $('#ckAuto');
    if (auto && !auto.__w) {
      auto.__w = 1;
      auto.addEventListener('click', function () {
        var now = auto.getAttribute('aria-pressed') !== 'true';
        auto.setAttribute('aria-pressed', String(now));
        auto.classList.toggle('on', now);
        SIM.auto(now);
        benchSave();
        if (A) A.play('relay');
        if (M) M.toast(now ? 'Piloto virtual conduzindo' : 'Piloto virtual desligado — use o pedal', null, 2100);
      });
    }

    var rst = $('#ckCalReset');
    if (rst && !rst.__w) {
      rst.__w = 1;
      rst.addEventListener('click', function () {
        benchApply(BENCH_DEF);
        SIM.auto(BENCH_DEF.auto);
        SIM.resetKnock();
        benchSave();
        if (A) A.play('relay');
        if (M) M.toast('Calibração restaurada', null, 1800);
        benchSig = '';
      });
    }

    /* o que ficou guardado da ultima visita volta antes do primeiro
       quadro, senao a agulha salta assim que a tela abre */
    var saved = U.store.get('bench', null);
    if (saved && typeof saved === 'object') {
      benchApply(saved, true);
      if ('auto' in saved) SIM.auto(!!saved.auto);
    }
    var on2 = SIM.ctl().auto;
    if (auto) {
      auto.setAttribute('aria-pressed', String(on2));
      auto.classList.toggle('on', on2);
    }
    BENCH.forEach(benchPaintOne);
  }

  /* ============================================================
     Terminal
     ============================================================ */
  var histo = [], hIdx = -1;

  var CMDS = {
    help: function () {
      return ['comandos disponiveis:',
        '  status      resumo da central',
        '  scan        varredura do barramento CAN',
        '  diagnostic  codigos de falha armazenados',
        '  boost <bar> define a pressao alvo',
        '  afr <valor> define a mistura alvo',
        '  rpm         leitura de rotacao',
        '  turbo       estado do controle de pressao',
        '  injectors   ciclo de trabalho por bico',
        '  launch      arma ou desarma o launch control',
        '  log         estatistica da janela do data logger',
        '  bancada     calibracao atual dos nove ajustes',
        '  mistura <trim>      enriquece (+) ou empobrece (-) em %',
        '  admissao <temp>     temperatura do ar ambiente em °C',
        '  temperatura <ect>   abertura do termostato em °C',
        '  auto [on|off]       liga ou desliga o piloto virtual',
        '  clear       limpa a tela'].join('\n');
    },
    status: function (s) {
      return ['<ok>ECU ONLINE</ok>',
        'Firmware        APEX-PERF 4.2.1',
        'Fuel System     ' + (s.duty > 92 ? '<w>SATURADO</w>' : '<ok>ESTAVEL</ok>'),
        'Turbo           ' + (s.boost > 0.05 ? '<ok>PRESSURIZANDO</ok>' : 'EM ESPERA'),
        'Knock           ' + (s.knockCount ? '<e>' + s.knockCount + ' EVENTOS</e>' : '<ok>NENHUM</ok>'),
        'Vehicle Health  ' + U.br(U.clamp(100 - s.knockCount * 1.4 - Math.max(s.ect - 100, 0) * 2, 40, 100), 0) + ' %'].join('\n');
    },
    scan: function () {
      return ['varrendo barramento...',
        '  0x0C  ENGINE SPEED      <ok>OK</ok>',
        '  0x0D  VEHICLE SPEED     <ok>OK</ok>',
        '  0x11  THROTTLE POS      <ok>OK</ok>',
        '  0x0B  MANIFOLD PRESS    <ok>OK</ok>',
        '  0x0F  INTAKE AIR TEMP   <ok>OK</ok>',
        '  0x05  COOLANT TEMP      <ok>OK</ok>',
        '  0x24  LAMBDA BANK 1     <ok>OK</ok>',
        '  0x33  BARO              <ok>OK</ok>',
        '<ok>8 modulos respondendo</ok>'].join('\n');
    },
    diagnostic: function (s) {
      var out = [];
      if (s.knockCount > 0) out.push('<e>P0325</e>  Knock sensor — ' + s.knockCount + ' eventos registrados');
      if (s.ect > 105) out.push('<e>P0217</e>  Temperatura do liquido acima do limite');
      if (s.duty > 92) out.push('<w>P0172</w>  Bicos proximos da saturacao');
      if (s.iat > 65) out.push('<w>P0111</w>  Ar de admissao quente — intercooler saturado');
      if (s.afr > 13.4) out.push('<w>P0171</w>  Mistura pobre sob carga');
      return out.length ? out.join('\n') : '<ok>nenhum codigo armazenado</ok>';
    },
    boost: function (s, arg) {
      if (!arg) return 'pressao alvo atual: ' + U.br(SIM.ctl().boostTarget, 2) + ' bar';
      var v = parseFloat(String(arg).replace(',', '.'));
      if (!isFinite(v)) return '<e>valor invalido</e>';
      v = U.clamp(v, 0, 2.2);
      SIM.set('boostTarget', v);
      return '<ok>pressao alvo -> ' + U.br(v, 2) + ' bar</ok>';
    },
    afr: function (s, arg) {
      if (!arg) return 'mistura alvo atual: ' + U.br(SIM.ctl().afrTarget, 1) + ':1';
      var v = parseFloat(String(arg).replace(',', '.'));
      if (!isFinite(v)) return '<e>valor invalido</e>';
      v = U.clamp(v, 10.5, 16.5);
      SIM.set('afrTarget', v);
      var el = $('#ckAfr'); if (el) el.value = v;
      return '<ok>mistura alvo -> ' + U.br(v, 1) + ':1</ok>';
    },
    rpm: function (s) { return U.br(s.rpm, 0) + ' rpm  ·  corte em ' + ATC.Sim.limits.cut; },
    turbo: function (s) {
      var c = SIM.ctl();
      return ['Boost alvo      ' + U.br(c.boostTarget, 2) + ' bar',
        'Boost atual     ' + U.br(s.boost, 2) + ' bar',
        'Teto da marcha  ' + U.br(s.boostCmd, 2) + ' bar   (marcha ' + c.gear + ')',
        'Wastegate duty  ' + U.br(c.wgDuty, 0) + ' %',
        'Solenoide       ' + U.br(c.solenoid, 0) + ' %',
        'Spool           ' + U.br(s.spool * 100, 0) + ' %',
        'Corte em        ' + U.br(c.overboost, 2) + ' bar   ' +
          (s.cut ? '<e>CORTANDO</e>' : s.cutCount ? '<w>' + s.cutCount + ' corte(s)</w>' : '<ok>livre</ok>'),
        'Launch          ' + U.br(c.launchRpm, 0) + ' rpm a ' + U.br(c.launchBoost, 2) + ' bar',
        'Por marcha      ' + c.boostByGear.map(function (f) { return U.br(f * 100, 0) + '%'; }).join('  '),
        'IAT             ' + U.br(s.iat, 0) + ' °C'].join('\n');
    },
    log: function () {
      var w = logWin();
      if (w.b - w.a < 2) return 'logger sem amostras suficientes ainda';
      var out = ['gravacao ' + (logRec ? '<ok>ATIVA</ok>' : '<w>PAUSADA</w>') +
        '  ·  ' + logBuf.length + ' amostras  ·  janela ' + (w.b - w.a) + ''];
      var act = CH.filter(function (c) { return c.on; });
      out.push('canais: ' + act.map(function (c) { return c.l; }).join(', '));
      act.forEach(function (c) {
        var v = [];
        for (var i = w.a; i < w.b; i++) v.push(logBuf[i][c.k]);
        out.push(pad(c.l, 6) + ' min ' + pad(U.br(U.min(v), c.dec), 7) +
          '  med ' + pad(U.br(U.mean(v), c.dec), 7) +
          '  max ' + pad(U.br(U.max(v), c.dec), 7) + ' ' + c.u);
      });
      return out.join('\n');
    },
    injectors: function (s) {
      return s.inj.map(function (v, i) {
        var n = Math.round(U.clamp(v / 125, 0, 1) * 24);
        return 'INJ ' + (i + 1) + '  ' + U.br(v, 0).padStart(3) + ' %  [' +
          new Array(n + 1).join('#') + new Array(25 - n).join('.') + ']';
      }).join('\n');
    },
    launch: function () {
      var el = $('#ckLaunch');
      if (el) el.click();
      return '<ok>launch control alternado</ok>';
    },
    bancada: function (s) {
      var c = SIM.ctl();
      return ['MISTURA',
        '  AFR alvo       ' + U.br(c.afrTarget, 1) + ':1   (entregue ' + U.br(s.afr, 1) + ')',
        '  Trim global    ' + (c.fuelTrim > 0 ? '+' : '') + U.br(c.fuelTrim, 0) + ' %',
        '  Trilho base    ' + U.br(c.railBase, 1) + ' bar',
        'ADMISSAO',
        '  Ar ambiente    ' + U.br(c.ambT, 0) + ' °C   (IAT ' + U.br(s.iat, 0) + ')',
        '  Intercooler    ' + U.br(c.icEff, 0) + ' %',
        '  Restricao      ' + U.br(c.intakeRestr, 0) + ' %',
        'TEMPERATURA',
        '  Termostato     ' + U.br(c.thermo, 0) + ' °C   (ECT ' + U.br(s.ect, 0) + ')',
        '  Ventoinha liga ' + U.br(c.fanOn, 0) + ' °C   ' + (s.fan ? '<ok>LIGADA</ok>' : 'desligada'),
        '  Radiador       ' + U.br(c.radCap, 0) + ' %',
        'PILOTO          ' + (c.auto ? '<ok>VIRTUAL</ok> — ' + s.phase : 'manual')].join('\n');
    },
    mistura: function (s, arg) {
      return benchCmd('fuelTrim', 'calTrim', arg, -25, 25, 0, ' %',
        'trim de combustivel', 'mistura entregue ' + U.br(s.afr, 1) + ':1');
    },
    admissao: function (s, arg) {
      return benchCmd('ambT', 'calAmb', arg, -5, 50, 0, ' °C',
        'ar de admissao', 'IAT agora em ' + U.br(s.iat, 0) + ' °C');
    },
    temperatura: function (s, arg) {
      return benchCmd('thermo', 'calThermo', arg, 78, 104, 0, ' °C',
        'abertura do termostato', 'ECT agora em ' + U.br(s.ect, 0) + ' °C');
    },
    auto: function (s, arg) {
      var el = $('#ckAuto');
      var want = arg == null ? !SIM.ctl().auto
        : /^(on|1|liga|ligado|sim)$/i.test(String(arg));
      if (el && (el.getAttribute('aria-pressed') === 'true') !== want) el.click();
      else SIM.auto(want);
      return want ? '<ok>piloto virtual conduzindo</ok>' : 'piloto virtual desligado — use o pedal';
    }
  };

  /* um so caminho para os comandos que mexem na bancada: valida,
     escreve no controle, devolve o cursor para o mesmo lugar */
  function benchCmd(key, slider, arg, lo, hi, dec, unit, nome, eco) {
    var c = SIM.ctl();
    if (arg == null) return nome + ': ' + U.br(c[key], dec) + unit;
    var v = parseFloat(String(arg).replace(',', '.'));
    if (!isFinite(v)) return '<e>valor invalido</e>';
    v = U.clamp(v, lo, hi);
    SIM.set(key, v);
    var el = document.getElementById(slider);
    if (el) { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
    return '<ok>' + nome + ' -> ' + U.br(v, dec) + unit + '</ok>\n' + eco;
  }

  function termPrint(html) {
    var out = $('#termOut');
    if (!out) return;
    out.innerHTML += html
      .replace(/<ok>/g, '<span class="ok">').replace(/<\/ok>/g, '</span>')
      .replace(/<w>/g, '<span class="w">').replace(/<\/w>/g, '</span>')
      .replace(/<e>/g, '<span class="e">').replace(/<\/e>/g, '</span>') + '\n';
    out.scrollTop = out.scrollHeight;
  }

  function termRun(line) {
    var parts = line.trim().split(/\s+/);
    var cmd = (parts[0] || '').toLowerCase();
    termPrint('<span class="ps">apex@ecu:~$</span> ' + U.esc(line));
    if (!cmd) return;
    if (cmd === 'clear') { $('#termOut').innerHTML = ''; return; }
    var fn = CMDS[cmd];
    if (!fn) { termPrint('<e>comando desconhecido: ' + U.esc(cmd) + '</e>  —  digite <span class="ok">help</span>'); return; }
    termPrint(fn(SIM.read(), parts[1]));
    if (A) A.play('tick');
  }

  function wireTerm() {
    var input = $('#termIn');
    if (!input || input.__w) return;
    input.__w = 1;
    termPrint('<ok>APEX PERFORMANCE OS 4.2.1</ok>  —  central conectada.\ndigite <span class="ok">help</span> para os comandos.');
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var v = input.value;
        if (v.trim()) { histo.push(v); hIdx = histo.length; }
        termRun(v);
        input.value = '';
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (hIdx > 0) { hIdx--; input.value = histo[hIdx]; }
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (hIdx < histo.length - 1) { hIdx++; input.value = histo[hIdx]; }
        else { hIdx = histo.length; input.value = ''; }
      }
    });
    var term = $('#term');
    if (term) term.addEventListener('click', function () { input.focus(); });
  }

  /* ============================================================
     Ciclo de vida
     ============================================================ */
  CK.mount = function () {
    SIM = ATC.Sim; A = ATC.Audio;
    if (!SIM) return;
    buildOnce(); wire(); wireTerm();
    if (!stop && M) stop = M.onFrame(function (dt) { frame(dt); });
  };
  CK.unmount = function () { if (stop) { stop(); stop = null; } };
  CK.invalidate = function () {
    ['ckTach', 'ckBoost', 'ckFuel', 'ckAfrTrace', 'ckLog'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) { e.__sig = null; e.__ctx = null; e.width = 0; }
    });
  };
  window.addEventListener('resize', function () { CK.invalidate(); }, { passive: true });

  ATC.Cockpit = CK;
})(window.ATC = window.ATC || {});
