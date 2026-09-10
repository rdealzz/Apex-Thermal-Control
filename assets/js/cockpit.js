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
    ctx.strokeStyle = 'rgba(255,59,48,.85)';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0 + span * (lim.cut / SCALE), a1); ctx.stroke();

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
    var col = s.rpm > lim.cut ? '#ff3b30' : s.rpm > 5800 ? '#ffb020' : '#3ff0e0';
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
    ctx.fillStyle = '#0a0d13';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 6.284); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = R * 0.018;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 6.284); ctx.stroke();

    /* leitura */
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e9eef7';
    ctx.font = '600 ' + Math.round(R * 0.30) + 'px ui-monospace,monospace';
    ctx.fillText(U.br(s.rpm, 0), cx, cy + R * 0.46);
    ctx.font = '600 ' + Math.max(9, Math.round(R * 0.10)) + 'px ui-monospace,monospace';
    ctx.fillStyle = '#7b8699';
    ctx.fillText('rpm', cx, cy + R * 0.64);
    if (s.limiter) {
      ctx.fillStyle = '#ff3b30';
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
    ctx.strokeStyle = 'rgba(255,59,48,.8)';
    ctx.beginPath(); ctx.arc(cx, cy, R, a0 + span * ((1.7 - lo) / (hi - lo)), a1); ctx.stroke();

    for (var i = 0; i <= 8; i++) {
      var ang = a0 + span * (i / 8);
      ctx.strokeStyle = 'rgba(233,238,247,.5)'; ctx.lineWidth = R * 0.018;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (R - R * 0.19), cy + Math.sin(ang) * (R - R * 0.19));
      ctx.lineTo(cx + Math.cos(ang) * (R - R * 0.07), cy + Math.sin(ang) * (R - R * 0.07));
      ctx.stroke();
    }

    var col = s.boost > 1.7 ? '#ff3b30' : '#ff8a1f';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.18; ctx.lineWidth = R * 0.26; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * Math.max(frac, 0.002)); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = R * 0.11;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + span * Math.max(frac, 0.002)); ctx.stroke();

    var a2 = a0 + span * frac;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a2);
    ctx.fillStyle = '#e9eef7';
    ctx.beginPath();
    ctx.moveTo(-R * 0.07, -R * 0.03); ctx.lineTo(R * 0.84, -R * 0.01);
    ctx.lineTo(R * 0.84, R * 0.01); ctx.lineTo(-R * 0.07, R * 0.03);
    ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#0a0d13';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, 6.284); ctx.fill();

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e9eef7';
    ctx.font = '600 ' + Math.round(R * 0.34) + 'px ui-monospace,monospace';
    ctx.fillText(U.br(s.boost, 2), cx, cy + R * 0.48);
    ctx.font = '600 ' + Math.max(9, Math.round(R * 0.12)) + 'px ui-monospace,monospace';
    ctx.fillStyle = '#7b8699';
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
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
    grad.addColorStop(0, opt.fill || 'rgba(18,182,255,.22)');
    grad.addColorStop(1, 'rgba(18,182,255,0)');
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
    }
    built = true;
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

    if (!visible('tab-cockpit')) return;
    buildOnce();
    drawTach(s);
    drawBoost(s);
    drawTrace('ckFuel', 0.42, 92, 150, traceFuel, { lo: 2.4, hi: 5.4, dec: 1, color: '#12b6ff', showB: true });
    drawTrace('ckAfrTrace', 0.30, 62, 104, traceAfr, { lo: 10, hi: 17, dec: 1, color: '#3ff0e0', fill: 'rgba(63,240,224,.20)', showB: true });
    paintDom(s);

    var thr = $('#ckThrFill');
    if (thr) thr.style.transform = 'scaleX(' + (s.tpsSm / 100).toFixed(3) + ')';
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
        SIM.set('afrTarget', parseFloat(afr.value));
        $('#ckAfrV').textContent = U.br(parseFloat(afr.value), 1);
      });
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

    /* estado inicial dos botoes */
    var d = document.querySelector('[data-boost="0.8"]');
    if (d) d.classList.add('on');
    var g3 = document.querySelector('[data-gear="3"]');
    if (g3) g3.classList.add('on');
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
      return ['Boost alvo      ' + U.br(SIM.ctl().boostTarget, 2) + ' bar',
        'Boost atual     ' + U.br(s.boost, 2) + ' bar',
        'Wastegate duty  ' + U.br(SIM.ctl().wgDuty, 0) + ' %',
        'Marcha          ' + SIM.ctl().gear,
        'IAT             ' + U.br(s.iat, 0) + ' °C'].join('\n');
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
    }
  };

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
    ['ckTach', 'ckBoost', 'ckFuel', 'ckAfrTrace'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) { e.__sig = null; e.__ctx = null; e.width = 0; }
    });
  };
  window.addEventListener('resize', function () { CK.invalidate(); }, { passive: true });

  ATC.Cockpit = CK;
})(window.ATC = window.ATC || {});
