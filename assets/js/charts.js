/* ============================================================
   Apex Thermal Control — graficos em canvas (sem dependencias)
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U;
  var G = {};
  /* O tema dos graficos nao e escrito aqui: e lido dos tokens CSS,
     entao a troca de modo (work / speed) leva os graficos junto sem
     duplicar paleta em dois lugares.                               */
  var THEME = {
    grid: '#eceef3', gridStrong: '#d9dce2', axis: '#c3c8d2',
    txt: '#697080', txtStrong: '#0d0f14', bg: '#ffffff',
    pane: 'rgba(15,18,26,.035)', mesh: 'rgba(18,22,30,.30)'
  };

  function readVar(cs, name, fallback) {
    var v = cs.getPropertyValue(name);
    return v ? v.trim() : fallback;
  }
  function syncTheme() {
    if (typeof window === 'undefined') return THEME;
    var cs = getComputedStyle(document.documentElement);
    THEME.bg = readVar(cs, '--chart-bg', THEME.bg);
    THEME.grid = readVar(cs, '--chart-grid', THEME.grid);
    THEME.gridStrong = readVar(cs, '--hair-strong', THEME.gridStrong);
    THEME.axis = readVar(cs, '--chart-axis', THEME.axis);
    THEME.txt = readVar(cs, '--chart-ink', THEME.txt);
    THEME.txtStrong = readVar(cs, '--chart-ink-strong', THEME.txtStrong);
    THEME.pane = readVar(cs, '--chart-pane', THEME.pane);
    THEME.mesh = readVar(cs, '--chart-mesh', THEME.mesh);
    return THEME;
  }

  /* ---------- escalas ---------- */
  function niceStep(range, target) {
    var raw = range / Math.max(target, 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var n = raw / mag;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * mag;
  }
  function ticks(min, max, target) {
    if (!isFinite(min) || !isFinite(max)) return [0];
    if (max - min < 1e-12) return [min];
    var st = niceStep(max - min, target || 5);
    var out = [], v = Math.ceil(min / st) * st;
    for (; v <= max + st * 1e-6 && out.length < 40; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
    return out;
  }
  function extent(series, axis) {
    var lo = Infinity, hi = -Infinity;
    series.forEach(function (s) {
      if ((s.axis || 'l') !== axis || s.hidden) return;
      for (var i = 0; i < s.data.length; i++) {
        var y = s.data[i][1];
        if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
      }
    });
    return [lo, hi];
  }

  /* ---------- infraestrutura de canvas ---------- */
  function box(canvas) {
    var b = canvas.parentNode;
    if (!b || !b.classList.contains('chart-box')) return null;
    return b;
  }
  function tipEl(canvas) {
    var b = box(canvas);
    if (!b) return null;
    var t = b.querySelector('.tip');
    if (!t) { t = document.createElement('div'); t.className = 'tip'; b.appendChild(t); }
    return t;
  }
  /* Atribuir canvas.width realoca o buffer e limpa tudo. Fazer isso a
     cada quadro de uma animacao custa caro sem motivo, entao so mexe
     nas dimensoes quando elas mudaram de verdade.                   */
  function fit(canvas, h) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentNode ? canvas.parentNode.clientWidth : 600;
    w = Math.max(w || 600, 200);
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      canvas.style.height = h + 'px';
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  var registry = [];
  function register(canvas, drawFn) {
    canvas.__atcDraw = drawFn;
    if (registry.indexOf(canvas) < 0) registry.push(canvas);
  }
  G.redrawAll = function () {
    registry.forEach(function (c) {
      if (c.__atcDraw && c.offsetParent !== null) { try { c.__atcDraw(); } catch (e) {} }
    });
  };
  if (typeof window !== 'undefined') {
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt); rt = setTimeout(G.redrawAll, 120);
    });
  }

  /* ============================================================
     Grafico de linhas / dispersao, com eixo Y duplo opcional
     ============================================================ */
  G.line = function (canvas, cfg) {
    canvas.__atcCfg = cfg;

    function draw() {
      var c = canvas.__atcCfg;
      var H = c.height || 280;
      var f = fit(canvas, H), ctx = f.ctx, W = f.w;
      var series = (c.series || []).filter(function (s) { return s.data && s.data.length; });

      var padL = c.padL === undefined ? 54 : c.padL;
      var padR = (c.series || []).some(function (s) { return s.axis === 'r'; }) ? 54 : 16;
      var padT = 12, padB = c.xLabel ? 40 : 28;
      var pw = Math.max(W - padL - padR, 10), ph = Math.max(H - padT - padB, 10);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);
      if (!series.length) {
        ctx.fillStyle = THEME.txt; ctx.font = '13px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(c.emptyMsg || 'Sem dados', W / 2, H / 2);
        return;
      }

      /* --- dominio X --- */
      var xlo = Infinity, xhi = -Infinity;
      series.forEach(function (s) {
        if (s.hidden) return;
        for (var i = 0; i < s.data.length; i++) {
          var x = s.data[i][0];
          if (isFinite(x)) { if (x < xlo) xlo = x; if (x > xhi) xhi = x; }
        }
      });
      if (c.xMin !== undefined) xlo = c.xMin;
      if (c.xMax !== undefined) xhi = c.xMax;
      if (!isFinite(xlo) || !isFinite(xhi)) { xlo = 0; xhi = 1; }
      if (xhi - xlo < 1e-9) { xhi = xlo + 1; }

      /* --- dominio Y (esq/dir) --- */
      function yDomain(axis, cMin, cMax) {
        var e = extent(series, axis);
        var lo = e[0], hi = e[1];
        if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
        var pad = (hi - lo) * 0.10 || Math.abs(hi) * 0.1 || 1;
        lo = cMin !== undefined ? cMin : lo - pad;
        hi = cMax !== undefined ? cMax : hi + pad;
        if (hi - lo < 1e-9) hi = lo + 1;
        return [lo, hi];
      }
      var dl = yDomain('l', c.yMin, c.yMax);
      var dr = yDomain('r', c.yMinRight, c.yMaxRight);

      var X = function (v) { return padL + (v - xlo) / (xhi - xlo) * pw; };
      var YL = function (v) { return padT + ph - (v - dl[0]) / (dl[1] - dl[0]) * ph; };
      var YR = function (v) { return padT + ph - (v - dr[0]) / (dr[1] - dr[0]) * ph; };
      var Y = function (v, axis) { return axis === 'r' ? YR(v) : YL(v); };

      var xFmt = c.xFmt || function (v) { return U.br(v, 0); };
      var yFmt = c.yFmt || function (v) { return U.br(v, Math.abs(v) < 10 ? 1 : 0); };
      var yFmtR = c.yFmtRight || yFmt;

      /* --- faixas verticais de fundo (regimes) --- */
      (c.xBands || []).forEach(function (b) {
        ctx.fillStyle = b.color;
        var x0 = X(Math.max(b.x0, xlo)), x1 = X(Math.min(b.x1, xhi));
        ctx.fillRect(x0, padT, Math.max(x1 - x0, 0), ph);
      });
      /* --- faixas horizontais (zonas de temperatura) --- */
      (c.yBands || []).forEach(function (b) {
        ctx.fillStyle = b.color;
        var y0 = YL(Math.min(b.y1, dl[1])), y1 = YL(Math.max(b.y0, dl[0]));
        ctx.fillRect(padL, y0, pw, Math.max(y1 - y0, 0));
      });

      /* --- grade --- */
      var yt = ticks(dl[0], dl[1], c.yTicks || 5);
      ctx.font = '10.5px ui-monospace,monospace';
      ctx.textBaseline = 'middle';
      yt.forEach(function (v) {
        var y = YL(v);
        if (y < padT - 1 || y > padT + ph + 1) return;
        ctx.strokeStyle = THEME.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + .5); ctx.lineTo(padL + pw, Math.round(y) + .5); ctx.stroke();
        ctx.fillStyle = THEME.txt; ctx.textAlign = 'right';
        ctx.fillText(yFmt(v), padL - 7, y);
      });
      if (padR > 20) {
        ticks(dr[0], dr[1], c.yTicks || 5).forEach(function (v) {
          var y = YR(v);
          if (y < padT - 1 || y > padT + ph + 1) return;
          ctx.fillStyle = '#8ea3bc'; ctx.textAlign = 'left';
          ctx.fillText(yFmtR(v), padL + pw + 7, y);
        });
      }
      var xt = ticks(xlo, xhi, c.xTicks || 6);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      xt.forEach(function (v) {
        var x = X(v);
        if (x < padL - 1 || x > padL + pw + 1) return;
        ctx.strokeStyle = THEME.grid;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, padT); ctx.lineTo(Math.round(x) + .5, padT + ph); ctx.stroke();
        ctx.fillStyle = THEME.txt;
        ctx.fillText(xFmt(v), x, padT + ph + 7);
      });

      /* --- eixos --- */
      ctx.strokeStyle = THEME.axis; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL + .5, padT); ctx.lineTo(padL + .5, padT + ph + .5); ctx.lineTo(padL + pw, padT + ph + .5);
      ctx.stroke();

      /* --- linhas de referencia --- */
      (c.hlines || []).forEach(function (h) {
        var y = Y(h.y, h.axis);
        if (y < padT || y > padT + ph) return;
        ctx.save();
        ctx.strokeStyle = h.color || '#ff6b4a'; ctx.lineWidth = 1.2;
        ctx.setLineDash(h.dash === false ? [] : [5, 4]);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
        ctx.restore();
        if (h.label) {
          ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = h.color || '#ff6b4a';
          ctx.fillText(h.label, padL + 5, y - 2);
        }
      });

      /* --- series --- */
      series.forEach(function (s) {
        if (s.hidden) return;
        var ax = s.axis || 'l';
        if (s.type === 'scatter') {
          ctx.fillStyle = s.color;
          var r = s.r || 2.1;
          for (var i = 0; i < s.data.length; i++) {
            var p = s.data[i];
            if (!isFinite(p[0]) || !isFinite(p[1])) continue;
            ctx.globalAlpha = s.alpha === undefined ? 0.62 : s.alpha;
            ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1], ax), r, 0, 6.284); ctx.fill();
          }
          ctx.globalAlpha = 1;
          return;
        }
        /* area sob a curva */
        if (s.area) {
          ctx.save();
          var grd = ctx.createLinearGradient(0, padT, 0, padT + ph);
          grd.addColorStop(0, s.area); grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grd; ctx.beginPath();
          var started = false, lastX = padL;
          for (var a = 0; a < s.data.length; a++) {
            var q = s.data[a];
            if (!isFinite(q[0]) || !isFinite(q[1])) continue;
            var xx = X(q[0]), yy = Y(q[1], ax);
            if (!started) { ctx.moveTo(xx, padT + ph); ctx.lineTo(xx, yy); started = true; }
            else ctx.lineTo(xx, yy);
            lastX = xx;
          }
          if (started) { ctx.lineTo(lastX, padT + ph); ctx.closePath(); ctx.fill(); }
          ctx.restore();
        }
        ctx.save();
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (s.dash) ctx.setLineDash(s.dash === true ? [5, 4] : s.dash);
        ctx.beginPath();
        var pen = false, px = 0, py = 0;
        for (var j = 0; j < s.data.length; j++) {
          var d = s.data[j];
          if (!isFinite(d[0]) || !isFinite(d[1])) { pen = false; continue; }
          var x = X(d[0]), y = Y(d[1], ax);
          if (!pen) { ctx.moveTo(x, y); pen = true; }
          else if (s.step) { ctx.lineTo(x, py); ctx.lineTo(x, y); }
          else ctx.lineTo(x, y);
          px = x; py = y;
        }
        ctx.stroke(); ctx.restore();
      });

      /* --- marcadores de evento --- */
      (c.marks || []).forEach(function (m) {
        var x = X(m.x);
        if (x < padL || x > padL + pw) return;
        ctx.save();
        ctx.strokeStyle = m.color || '#ffb02e'; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = m.color || '#ffb02e';
        ctx.beginPath(); ctx.arc(x, padT + 5, 3.2, 0, 6.284); ctx.fill();
        ctx.restore();
      });

      /* --- cursor do instante atual --- */
      if (c.cursorX !== undefined && isFinite(c.cursorX)) {
        var cx = X(c.cursorX);
        if (cx >= padL && cx <= padL + pw) {
          ctx.save();
          ctx.strokeStyle = 'rgba(155,140,255,.85)'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + ph); ctx.stroke();
          ctx.restore();
        }
      }

      /* --- rotulos de eixo --- */
      ctx.font = '11px system-ui,sans-serif'; ctx.fillStyle = THEME.txt;
      if (c.xLabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(c.xLabel, padL + pw / 2, H - 3); }
      if (c.yLabel) {
        ctx.save(); ctx.translate(11, padT + ph / 2); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(c.yLabel, 0, 0); ctx.restore();
      }
      if (c.yLabelRight) {
        ctx.save(); ctx.translate(W - 3, padT + ph / 2); ctx.rotate(Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(c.yLabelRight, 0, 0); ctx.restore();
      }

      /* guarda geometria para o hover */
      canvas.__geo = { padL: padL, padT: padT, pw: pw, ph: ph, xlo: xlo, xhi: xhi, X: X, YL: YL, YR: YR, dl: dl, dr: dr };
    }

    register(canvas, draw);
    draw();
    bindHover(canvas);
    return { draw: draw };
  };

  /* ---------- hover com crosshair e tooltip ---------- */
  function bindHover(canvas) {
    if (canvas.__atcHover) return;
    canvas.__atcHover = true;
    var tip = tipEl(canvas);
    if (!tip) return;

    function move(ev) {
      var c = canvas.__atcCfg, geo = canvas.__geo;
      if (!c || !geo) return;
      var rect = canvas.getBoundingClientRect();
      var mx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      var my = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
      if (mx < geo.padL - 4 || mx > geo.padL + geo.pw + 4) { tip.style.opacity = 0; return; }

      var xv = geo.xlo + (mx - geo.padL) / geo.pw * (geo.xhi - geo.xlo);
      var xFmt = c.xFmt || function (v) { return U.br(v, 0); };
      var rows = [];
      (c.series || []).forEach(function (s) {
        if (!s.data || !s.data.length || s.hidden || s.noTip) return;
        /* ponto mais proximo em x */
        var bi = -1, bd = Infinity;
        for (var i = 0; i < s.data.length; i++) {
          var d = s.data[i];
          if (!isFinite(d[0]) || !isFinite(d[1])) continue;
          var dd = Math.abs(d[0] - xv);
          if (dd < bd) { bd = dd; bi = i; }
        }
        if (bi < 0) return;
        var span = (geo.xhi - geo.xlo) / Math.max(geo.pw, 1) * 14;
        if (bd > span) return;
        rows.push({ name: s.name, color: s.color, v: s.data[bi][1], x: s.data[bi][0], fmt: s.tipFmt });
      });
      if (!rows.length) { tip.style.opacity = 0; return; }

      var head = c.tipTitle ? c.tipTitle(rows[0].x) : xFmt(rows[0].x);
      var html = '<b>' + U.esc(head) + '</b>';
      rows.forEach(function (r) {
        var val = r.fmt ? r.fmt(r.v) : U.br(r.v, 2);
        html += '<div class="row"><span><span class="sw" style="background:' + r.color + '"></span>' +
                U.esc(r.name) + '</span><span>' + U.esc(val) + '</span></div>';
      });
      tip.innerHTML = html;
      tip.style.opacity = 1;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = mx + 14, top = my - th - 10;
      if (left + tw > canvas.clientWidth - 4) left = mx - tw - 14;
      if (left < 2) left = 2;
      if (top < 2) top = my + 16;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';

      if (c.onHover) c.onHover(rows[0].x);
    }
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('touchmove', function (e) { move(e); }, { passive: true });
    canvas.addEventListener('mouseleave', function () { tip.style.opacity = 0; if (canvas.__atcCfg && canvas.__atcCfg.onLeave) canvas.__atcCfg.onLeave(); });
    canvas.addEventListener('click', function (ev) {
      var c = canvas.__atcCfg, geo = canvas.__geo;
      if (!c || !geo || !c.onClick) return;
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left;
      c.onClick(geo.xlo + (mx - geo.padL) / geo.pw * (geo.xhi - geo.xlo));
    });
  }

  G.update = function (canvas, cfg) {
    if (!canvas) return;
    if (canvas.__atcDraw) { canvas.__atcCfg = cfg; canvas.__atcDraw(); }
    else G.line(canvas, cfg);
  };

  /* ============================================================
     Barras horizontais rotuladas
     ============================================================ */
  G.bars = function (canvas, cfg) {
    canvas.__atcCfg = cfg;
    function draw() {
      var c = canvas.__atcCfg;
      var items = c.items || [];
      var H = c.height || (items.length * 30 + 28);
      var f = fit(canvas, H), ctx = f.ctx, W = f.w;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);
      if (!items.length) {
        ctx.fillStyle = THEME.txt; ctx.font = '13px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(c.emptyMsg || 'Sem dados', W / 2, H / 2); return;
      }
      var labW = c.labelWidth || 130;
      var valW = 66;
      var pw = Math.max(W - labW - valW - 14, 20);
      var maxAbs = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value) || 0; })) || 1;
      var hasNeg = items.some(function (i) { return i.value < 0; });
      var zero = hasNeg ? labW + pw / 2 : labW;
      var scale = hasNeg ? (pw / 2) / maxAbs : pw / maxAbs;
      var bh = Math.min(18, (H - 22) / items.length - 6);

      items.forEach(function (it, i) {
        var y = 12 + i * ((H - 22) / items.length);
        ctx.font = '11.5px system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = THEME.txt;
        var lab = it.label.length > 22 ? it.label.slice(0, 21) + '…' : it.label;
        ctx.fillText(lab, labW - 8, y + bh / 2);
        var w = Math.abs(it.value) * scale;
        ctx.fillStyle = it.color || '#c9ced9';
        var x = it.value < 0 ? zero - w : zero;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, Math.max(w, 1.5), bh, 3); else ctx.rect(x, y, Math.max(w, 1.5), bh);
        ctx.fill();
        ctx.textAlign = 'left'; ctx.fillStyle = THEME.txtStrong; ctx.font = '11px ui-monospace,monospace';
        ctx.fillText(c.fmt ? c.fmt(it.value) : U.br(it.value, 2), labW + pw + 8, y + bh / 2);
      });
      if (hasNeg) {
        ctx.strokeStyle = THEME.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(zero + .5, 6); ctx.lineTo(zero + .5, H - 8); ctx.stroke();
      }
    }
    register(canvas, draw); draw();
    return { draw: draw };
  };

  /* ============================================================
     Mostrador radial (temperatura / efetividade)
     ============================================================ */
  G.gauge = function (canvas, cfg) {
    canvas.__atcCfg = cfg;
    function draw() {
      var c = canvas.__atcCfg;
      var H = c.height || 168;
      var f = fit(canvas, H), ctx = f.ctx, W = f.w;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);

      /* O arco tem abertura inferior de ~115 graus, entao seu ponto mais
         baixo fica em cy + 0,536R e os rotulos de escala em cy + 0,729R.
         Resolvendo cy = R + topo e cy + 0,729R <= H - 4 obtem-se o raio
         maximo que cabe no canvas sem cortar nada.                     */
      var topo = 23;
      var R = Math.min(W * 0.36, (H - topo - 6) / 1.729);
      var cx = W / 2, cy = R + topo;
      var a0 = Math.PI * 0.82, a1 = Math.PI * 2.18;   // arco de ~245 graus
      var min = c.min, max = c.max;
      var val = c.value;
      var frac = isFinite(val) ? U.clamp((val - min) / (max - min || 1), 0, 1) : 0;

      /* trilha por zonas */
      var zones = c.zones || [{ to: max, color: '#2a2d38' }];
      var prev = min;
      ctx.lineWidth = R * 0.20; ctx.lineCap = 'butt';
      zones.forEach(function (z) {
        var f0 = U.clamp((prev - min) / (max - min || 1), 0, 1);
        var f1 = U.clamp((z.to - min) / (max - min || 1), 0, 1);
        ctx.strokeStyle = z.color;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0 + (a1 - a0) * f0, a0 + (a1 - a0) * f1); ctx.stroke();
        prev = z.to;
      });

      /* arco de valor */
      if (isFinite(val)) {
        ctx.lineWidth = R * 0.20; ctx.lineCap = 'round';
        ctx.strokeStyle = c.color || '#e51d34';
        ctx.shadowColor = c.color || '#e51d34'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac); ctx.stroke();
        ctx.shadowBlur = 0;
        /* ponteiro */
        var ang = a0 + (a1 - a0) * frac;
        ctx.strokeStyle = '#edeff4'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * (R - R * 0.16), cy + Math.sin(ang) * (R - R * 0.16));
        ctx.lineTo(cx + Math.cos(ang) * (R + R * 0.15), cy + Math.sin(ang) * (R + R * 0.15));
        ctx.stroke();
      }

      /* escala min/max */
      ctx.font = '10px ui-monospace,monospace'; ctx.fillStyle = THEME.txt;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(U.br(min, c.decScale === undefined ? 0 : c.decScale), cx + Math.cos(a0) * (R + R * 0.36), cy + Math.sin(a0) * (R + R * 0.36));
      ctx.fillText(U.br(max, c.decScale === undefined ? 0 : c.decScale), cx + Math.cos(a1) * (R + R * 0.36), cy + Math.sin(a1) * (R + R * 0.36));

      /* valor central */
      ctx.textAlign = 'center';
      ctx.fillStyle = isFinite(val) ? THEME.txtStrong : THEME.txt;
      ctx.font = '600 ' + Math.round(R * 0.44) + 'px ui-monospace,monospace';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(isFinite(val) ? U.br(val, c.dec === undefined ? 1 : c.dec) : '--', cx, cy + R * 0.05);
      ctx.font = '11.5px system-ui,sans-serif'; ctx.fillStyle = THEME.txt;
      ctx.fillText(c.unit || '', cx, cy + R * 0.30);
      if (c.label) {
        ctx.font = '600 11px system-ui,sans-serif'; ctx.fillStyle = '#98a0b0';
        ctx.textBaseline = 'top'; ctx.fillText(c.label, cx, 4);
      }
    }
    register(canvas, draw); draw();
    return { draw: draw };
  };

  /* ============================================================
     Barra de proporcao: quanto do maximo possivel foi alcancado.
     Le-se sem eixo nem escala — e a leitura visual de uma razao
     como a efetividade (Q rejeitado / Q maximo).
     ============================================================ */
  G.ratio = function (canvas, cfg) {
    canvas.__atcCfg = cfg;
    function draw() {
      var c = canvas.__atcCfg;
      var H = c.height || 96;
      var f = fit(canvas, H), ctx = f.ctx, W = f.w;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);

      var padX = 16, barY = 34, barH = c.barH || 30;
      var pw = Math.max(W - padX * 2, 20);
      var frac = isFinite(c.value) && c.max > 0 ? U.clamp(c.value / c.max, 0, 1) : 0;

      /* rotulos de topo */
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = '600 12px system-ui,sans-serif'; ctx.fillStyle = THEME.txt;
      ctx.fillText(c.label || '', padX, 18);
      if (c.right) {
        ctx.textAlign = 'right'; ctx.fillStyle = THEME.txtStrong;
        ctx.font = '600 13px ui-monospace,monospace';
        ctx.fillText(c.right, W - padX, 18);
      }

      /* trilho = o total possivel */
      ctx.fillStyle = THEME.grid;
      ctx.strokeStyle = THEME.gridStrong; ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(padX, barY, pw, barH, 7); else ctx.rect(padX, barY, pw, barH);
      ctx.fill(); ctx.stroke();

      /* preenchimento = o que de fato aconteceu */
      var fw = Math.max(pw * frac, frac > 0 ? 3 : 0);
      if (fw > 0) {
        var g = ctx.createLinearGradient(padX, 0, padX + pw, 0);
        g.addColorStop(0, c.colorFrom || '#7a0f22');
        g.addColorStop(1, c.colorTo || '#e51d34');
        ctx.fillStyle = g;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(padX, barY, fw, barH, 7); else ctx.rect(padX, barY, fw, barH);
        ctx.fill();
      }

      /* faixa de referencia opcional (ex.: 0,40 a 0,70 de efetividade) */
      if (c.band) {
        var b0 = padX + pw * U.clamp(c.band[0] / c.max, 0, 1);
        var b1 = padX + pw * U.clamp(c.band[1] / c.max, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = THEME.txt;
        ctx.fillRect(b0, barY, Math.max(b1 - b0, 1), barH);
        ctx.restore();
        ctx.strokeStyle = THEME.axis;
        ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
        [b0, b1].forEach(function (x) {
          ctx.beginPath(); ctx.moveTo(x + .5, barY - 4); ctx.lineTo(x + .5, barY + barH + 4); ctx.stroke();
        });
        ctx.setLineDash([]);
        if (c.bandLabel) {
          ctx.font = '10.5px system-ui,sans-serif'; ctx.fillStyle = THEME.txt;
          ctx.textAlign = 'center';
          ctx.fillText(c.bandLabel, (b0 + b1) / 2, barY + barH + 16);
        }
      }

      /* valor sobre a barra */
      ctx.font = '700 14px ui-monospace,monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      var txt = c.valueText || U.br(c.value, 2);
      var tw = ctx.measureText(txt).width;
      var inside = fw > tw + 20;
      ctx.fillStyle = inside ? '#fff' : THEME.txtStrong;
      if (inside) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 3; }
      ctx.fillText(txt, inside ? padX + fw - tw - 10 : padX + fw + 10, barY + barH / 2 + 1);
      if (inside) ctx.restore();

      /* rodape */
      if (c.foot) {
        ctx.font = '11.5px system-ui,sans-serif'; ctx.fillStyle = THEME.txt;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(c.foot, padX, H - 8);
      }
    }
    register(canvas, draw); draw();
    return { draw: draw };
  };

  /* ============================================================
     Barra empilhada 100%: mostra a repartição de um total, com o
     rotulo dentro de cada fatia que couber. Usada para as
     resistencias termicas em serie.
     ============================================================ */
  G.stack = function (canvas, cfg) {
    canvas.__atcCfg = cfg;
    function draw() {
      var c = canvas.__atcCfg;
      var parts = (c.parts || []).filter(function (p) { return isFinite(p.value) && p.value > 0; });
      var H = c.height || 108;
      var f = fit(canvas, H), ctx = f.ctx, W = f.w;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);
      if (!parts.length) {
        ctx.fillStyle = THEME.txt; ctx.font = '13px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.emptyMsg || 'Sem dados', W / 2, H / 2); return;
      }
      var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
      var padX = 16, barY = c.title ? 30 : 14, barH = c.barH || 34;
      var pw = Math.max(W - padX * 2, 20);

      if (c.title) {
        ctx.font = '600 12px system-ui,sans-serif'; ctx.fillStyle = THEME.txt;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(c.title, padX, 18);
      }

      var x = padX;
      parts.forEach(function (p, i) {
        var w = pw * (p.value / total);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        var r0 = i === 0 ? 7 : 0, r1 = i === parts.length - 1 ? 7 : 0;
        if (ctx.roundRect) ctx.roundRect(x, barY, Math.max(w, 1), barH, [r0, r1, r1, r0]);
        else ctx.rect(x, barY, Math.max(w, 1), barH);
        ctx.fill();
        var pct = 100 * p.value / total;
        var lab = U.br(pct, 0) + ' %';
        ctx.font = '700 12.5px ui-monospace,monospace';
        if (ctx.measureText(lab).width + 12 < w) {
          ctx.fillStyle = p.dark ? THEME.txtStrong : '#fff';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(lab, x + w / 2, barY + barH / 2 + 1);
        }
        x += w;
      });

      /* legenda embaixo, na ordem das fatias */
      var ly = barY + barH + 20, lx = padX;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      parts.forEach(function (p) {
        var lab = p.label + '  ' + U.br(100 * p.value / total, 0) + ' %';
        ctx.font = '11.5px system-ui,sans-serif';
        var w = ctx.measureText(lab).width + 22;
        if (lx + w > W - padX && lx > padX) { lx = padX; ly += 17; }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(lx, ly - 4, 10, 8, 2); else ctx.rect(lx, ly - 4, 10, 8);
        ctx.fill();
        ctx.fillStyle = THEME.txt;
        ctx.fillText(lab, lx + 15, ly);
        lx += w;
      });
    }
    register(canvas, draw); draw();
    return { draw: draw };
  };

  /* ============================================================
     Superficie 3D
     ------------------------------------------------------------
     Uma grandeza que depende de duas outras nao cabe numa curva.
     Efetividade em funcao de velocidade e rotacao e uma superficie,
     e mostrar superficie como superficie poupa a conversa toda de
     "imagine varias curvas sobrepostas".

     Sem biblioteca: projecao propria, algoritmo do pintor e uma luz
     direcional. Cada quadrilatero e sombreado pela sua inclinacao —
     e o que faz o relevo aparecer, mais do que a cor.

     Gira com o ponteiro e sai girando por inercia quando solta. O
     laco de quadro so existe enquanto ha rotacao acontecendo.
     ============================================================ */
  function hexRgb(h) {
    h = h.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rampAt(stops, t) {
    t = U.clamp(t, 0, 1);
    var seg = 1 / (stops.length - 1);
    var i = Math.min(Math.floor(t / seg), stops.length - 2);
    var f = (t - i * seg) / seg;
    var a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  G.surface = function (canvas, cfg) {
    canvas.__atcCfg = cfg;
    var st = canvas.__surf;
    if (!st) {
      st = canvas.__surf = {
        yaw: -0.72, el: 0.56,      /* giro e elevacao da camera, em radianos */
        yawV: 0, elV: 0,
        drag: null, stop: null
      };
    }

    /* Camera: gira a cena em torno do eixo vertical, depois inclina.
       A profundidade sai da mesma conta e serve para ordenar as faces
       da mais distante para a mais proxima.                          */
    /* A camera olha a cena de frente e de cima. Quanto maior o Y do
       mundo, mais longe o ponto esta E mais alto ele aparece na tela:
       as duas coisas tem que concordar, senao a ordenacao por
       profundidade desenha o fundo por cima da frente e as paredes vao
       parar do lado errado da caixa.                                  */
    function project(x, y, z, sy_, cy_, se, ce) {
      var xr = x * cy_ - y * sy_;
      var yr = x * sy_ + y * cy_;
      return { x: xr, y: -yr * se - z * ce, d: yr * ce - z * se };
    }

    /* ------------------------------------------------------------
       Curvas de nivel por marching squares. Cada celula da grade e
       classificada pelos quatro cantos e devolve os segmentos onde a
       superficie cruza aquele nivel. Projetadas na base, sao o mapa
       topografico do relevo: dizem onde ele e ingreme sem depender
       do angulo em que a superficie esta girada.
       ------------------------------------------------------------ */
    function isoSegments(Z, gx, gy, level) {
      var out = [];
      var ny = Z.length, nx = Z[0].length;
      for (var j = 0; j < ny - 1; j++) {
        for (var i = 0; i < nx - 1; i++) {
          var v0 = Z[j][i], v1 = Z[j][i + 1], v2 = Z[j + 1][i + 1], v3 = Z[j + 1][i];
          if (!isFinite(v0) || !isFinite(v1) || !isFinite(v2) || !isFinite(v3)) continue;
          var idx = (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
          if (idx === 0 || idx === 15) continue;
          var x0 = gx[i], x1 = gx[i + 1], y0 = gy[j], y1 = gy[j + 1];
          var e = {
            0: function () { var t = (level - v0) / ((v1 - v0) || 1e-9); return [x0 + t * (x1 - x0), y0]; },
            1: function () { var t = (level - v1) / ((v2 - v1) || 1e-9); return [x1, y0 + t * (y1 - y0)]; },
            2: function () { var t = (level - v3) / ((v2 - v3) || 1e-9); return [x0 + t * (x1 - x0), y1]; },
            3: function () { var t = (level - v0) / ((v3 - v0) || 1e-9); return [x0, y0 + t * (y1 - y0)]; }
          };
          var pairs;
          switch (idx) {
            case 1: case 14: pairs = [[3, 0]]; break;
            case 2: case 13: pairs = [[0, 1]]; break;
            case 3: case 12: pairs = [[3, 1]]; break;
            case 4: case 11: pairs = [[1, 2]]; break;
            case 6: case 9:  pairs = [[0, 2]]; break;
            case 7: case 8:  pairs = [[3, 2]]; break;
            /* casos ambiguos: a escolha nao muda a leitura do mapa */
            case 5:  pairs = [[3, 0], [1, 2]]; break;
            case 10: pairs = [[0, 1], [3, 2]]; break;
            default: pairs = [];
          }
          for (var q = 0; q < pairs.length; q++) out.push([e[pairs[q][0]](), e[pairs[q][1]]()]);
        }
      }
      return out;
    }

    function draw() {
      var c = canvas.__atcCfg;
      if (!c) return;
      var H = c.height || 380;
      /* Em tela estreita quem limita o desenho e a largura, e a altura
         cheia so vira espaco vazio em cima e embaixo do relevo.     */
      var wGuess = canvas.parentNode ? canvas.parentNode.clientWidth : 600;
      if (wGuess && wGuess < 620) H = Math.min(H, Math.round(wGuess * 1.02));
      var f = fit(canvas, H), ctx = f.ctx, W = f.w;
      ctx.clearRect(0, 0, W, H);
      /* fundo com um degrade de cima para baixo em vez de chapado: da
         ao volume um ceu contra o qual se destacar, e e o que separa
         "desenho tecnico" de "cena" */
      var bgRGB = hexRgb(THEME.bg);
      /* o quanto o degrade abre depende do tema: no escuro da para
         clarear bastante o alto sem estranheza, no claro qualquer
         exagero vira mancha cinza embaixo do desenho */
      var lum = (bgRGB[0] * 0.299 + bgRGB[1] * 0.587 + bgRGB[2] * 0.114) / 255;
      var up = lum < 0.5 ? 1.55 : 1.0, dn = lum < 0.5 ? 0.74 : 0.965;
      var bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      function sh(mul, add) {
        return 'rgb(' + Math.round(U.clamp(bgRGB[0] * mul + add, 0, 255)) + ',' +
          Math.round(U.clamp(bgRGB[1] * mul + add * 1.1, 0, 255)) + ',' +
          Math.round(U.clamp(bgRGB[2] * mul + add * 1.5, 0, 255)) + ')';
      }
      bgGrad.addColorStop(0, sh(up, lum < 0.5 ? 6 : 0));
      bgGrad.addColorStop(0.62, THEME.bg);
      bgGrad.addColorStop(1, sh(dn, 0));
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

      var Z = c.z;
      if (!Z || !Z.length) {
        ctx.fillStyle = THEME.txt; ctx.font = '13px system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.emptyMsg || 'Sem dados', W / 2, H / 2);
        return;
      }
      var ny0 = Z.length, nx0 = Z[0].length;
      var i, j, k;

      /* ------------------------------------------------------------
         Refino da malha
         ------------------------------------------------------------
         Uma tabela 8x6 desenhada crua vira um origami: seis faces de
         cada lado, cada uma com o proprio tom, e o relevo some nas
         quinas. Interpolar por Catmull-Rom entre os nos existentes
         nao inventa dado nenhum — os nos continuam exatamente onde
         estavam — e devolve a superficie continua que a tabela ja
         descrevia. E de longe o que mais muda a aparencia.
         ------------------------------------------------------------ */
      function cr(p0, p1, p2, p3, t) {
        var t2 = t * t, t3 = t2 * t;
        return 0.5 * ((2 * p1) + (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      }
      function refine(src, n) {
        if (n <= 1) return src;
        var h = src.length, w = src[0].length;
        function at(jj, ii) {
          return src[U.clamp(jj, 0, h - 1)][U.clamp(ii, 0, w - 1)];
        }
        /* primeiro nas colunas, depois nas linhas do resultado */
        var rows = [], jj, ii, q;
        for (jj = 0; jj < h; jj++) {
          var row = [];
          for (ii = 0; ii < w - 1; ii++) {
            for (q = 0; q < n; q++) {
              row.push(cr(at(jj, ii - 1), at(jj, ii), at(jj, ii + 1), at(jj, ii + 2), q / n));
            }
          }
          row.push(at(jj, w - 1));
          rows.push(row);
        }
        var out = [], w2 = rows[0].length;
        for (jj = 0; jj < h - 1; jj++) {
          for (q = 0; q < n; q++) {
            var nr = [];
            for (ii = 0; ii < w2; ii++) {
              nr.push(cr(rows[U.clamp(jj - 1, 0, h - 1)][ii], rows[jj][ii],
                         rows[U.clamp(jj + 1, 0, h - 1)][ii], rows[U.clamp(jj + 2, 0, h - 1)][ii], q / n));
            }
            out.push(nr);
          }
        }
        out.push(rows[h - 1].slice());
        return out;
      }
      var fine = Math.max(1, Math.round(c.smooth || 1));
      /* refinar uma malha que ja e fina so gasta quadro */
      if (nx0 * fine > 90 || ny0 * fine > 90) fine = 1;
      var ZF = fine > 1 ? refine(Z, fine) : Z;
      var ny = ZF.length, nx = ZF[0].length;

      var zLo = c.zMin, zHi = c.zMax;
      if (zLo === undefined || zHi === undefined) {
        zLo = Infinity; zHi = -Infinity;
        for (j = 0; j < ny0; j++) for (i = 0; i < nx0; i++) {
          var v = Z[j][i];
          if (isFinite(v)) { if (v < zLo) zLo = v; if (v > zHi) zHi = v; }
        }
        /* uma folga em cima e embaixo: relevo encostado no teto da
           caixa parece cortado */
        var pad = (zHi - zLo) * 0.08;
        zLo -= pad; zHi += pad;
      }
      if (!isFinite(zLo) || zHi - zLo < 1e-9) { zLo = 0; zHi = 1; }

      var narrow = W < 620;
      var sy_ = Math.sin(st.yaw), cy_ = Math.cos(st.yaw);
      var se = Math.sin(st.el), ce = Math.cos(st.el);
      var zTop = c.zScale === undefined ? 0.9 : c.zScale;
      /* A base fica um degrau abaixo do vale da superficie. Sem essa
         folga as curvas de nivel projetadas ficam debaixo do proprio
         relevo e nao se ve nenhuma — que e justamente o que elas tem
         de melhor a oferecer.                                        */
      var zFloor = -0.16 * zTop;

      var gx = new Array(nx), gy = new Array(ny);
      for (i = 0; i < nx; i++) gx[i] = nx > 1 ? (i / (nx - 1)) * 2 - 1 : 0;
      for (j = 0; j < ny; j++) gy[j] = ny > 1 ? (j / (ny - 1)) * 2 - 1 : 0;
      /* as grades das paredes e as marcas continuam nos nos de verdade,
         nao nos pontos interpolados */
      var gx0 = new Array(nx0), gy0 = new Array(ny0);
      for (i = 0; i < nx0; i++) gx0[i] = nx0 > 1 ? (i / (nx0 - 1)) * 2 - 1 : 0;
      for (j = 0; j < ny0; j++) gy0[j] = ny0 > 1 ? (j / (ny0 - 1)) * 2 - 1 : 0;
      function norm(v) { return isFinite(v) ? U.clamp((v - zLo) / (zHi - zLo), 0, 1) : 0; }
      function zn(j2, i2) { return norm(ZF[j2][i2]) * zTop; }

      /* ---------- enquadramento ---------- */
      var bar = c.colorbar === false || narrow ? 0 : 78;
      var padL = 14, padR = 14 + bar, padT = c.title ? 40 : 16, padB = 14;

      var P = new Array(ny);
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      function grow(p) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      for (j = 0; j < ny; j++) {
        P[j] = new Array(nx);
        for (i = 0; i < nx; i++) { P[j][i] = project(gx[i], gy[j], zn(j, i), sy_, cy_, se, ce); grow(P[j][i]); }
      }
      /* a caixa de referencia e a faixa dos rotulos entram no enquadramento */
      var RIM = narrow ? 1.44 : 1.62;
      for (k = 0; k < 8; k++) {
        var rx = (k & 1) ? RIM : -RIM, ry = (k & 2) ? RIM : -RIM, rz = (k & 4) ? zTop : zFloor;
        grow(project(rx, ry, rz, sy_, cy_, se, ce));
      }

      var sw = Math.max(W - padL - padR, 20), sh = Math.max(H - padT - padB, 20);
      var scale = Math.min(sw / Math.max(maxX - minX, 1e-6), sh / Math.max(maxY - minY, 1e-6));
      var ox = padL + (sw - (maxX - minX) * scale) / 2 - minX * scale;
      var oy = padT + (sh - (maxY - minY) * scale) / 2 - minY * scale;
      function SX(p) { return ox + p.x * scale; }
      function SY(p) { return oy + p.y * scale; }
      function PT(x, y, z) { var p = project(x, y, z, sy_, cy_, se, ce); return [SX(p), SY(p)]; }
      function line(a, b, col, w2, dash) {
        ctx.strokeStyle = col; ctx.lineWidth = w2 || 1;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if (dash) ctx.setLineDash([]);
      }

      var stops = (c.ramp || ['#132a6b', '#1f6fb2', '#3aa6a0', '#8dbf4a', '#e6b13c', '#c9452a']).map(hexRgb);
      function rgb(t, shade) {
        var col = rampAt(stops, t), m = shade === undefined ? 1 : shade;
        return 'rgb(' + Math.round(col[0] * m) + ',' + Math.round(col[1] * m) + ',' + Math.round(col[2] * m) + ')';
      }

      var divs = narrow ? 2 : 4;
      var stepX = Math.max(1, Math.round((nx0 - 1) / divs));
      var stepY = Math.max(1, Math.round((ny0 - 1) / divs));
      var nz = c.zTicks || 5;
      if (narrow) nz = Math.min(nz, 3);   /* menos marcas: nao ha altura para mais */

      /* qual parede fica atras depende do giro: e a de maior profundidade */
      var xWall = project(-1, 0, 0, sy_, cy_, se, ce).d > project(1, 0, 0, sy_, cy_, se, ce).d ? -1 : 1;
      var yWall = project(0, -1, 0, sy_, cy_, se, ce).d > project(0, 1, 0, sy_, cy_, se, ce).d ? -1 : 1;
      /* e a escala vai na borda oposta, a que aparece mais a frente */
      var xEdge = -xWall, yEdge = -yWall;

      /* ---------- paredes de fundo ---------- */
      function wall(fixedAxis, at) {
        var pts = [];
        for (k = 0; k < 4; k++) {
          var a2 = (k === 1 || k === 2) ? 1 : -1, z2 = (k < 2) ? zFloor : zTop;
          pts.push(fixedAxis === 'x' ? PT(at, a2, z2) : PT(a2, at, z2));
        }
        /* ordem do quadrilatero: base esquerda, base direita, topo direita, topo esquerda */
        var quad = [pts[0], pts[1], pts[2], pts[3]];
        ctx.fillStyle = THEME.pane || 'rgba(127,127,127,.045)';
        ctx.beginPath();
        ctx.moveTo(quad[0][0], quad[0][1]);
        ctx.lineTo(quad[1][0], quad[1][1]);
        ctx.lineTo(quad[2][0], quad[2][1]);
        ctx.lineTo(quad[3][0], quad[3][1]);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = THEME.grid; ctx.lineWidth = 1; ctx.stroke();

        /* grade da parede: verticais no eixo livre, horizontais nos niveis */
        var freeStep = fixedAxis === 'x' ? stepY : stepX;
        var freeN = fixedAxis === 'x' ? ny0 : nx0;
        var freeG = fixedAxis === 'x' ? gy0 : gx0;
        for (var q = freeStep; q < freeN - 1; q += freeStep) {
          var lo = fixedAxis === 'x' ? PT(at, freeG[q], zFloor) : PT(freeG[q], at, zFloor);
          var hi = fixedAxis === 'x' ? PT(at, freeG[q], zTop) : PT(freeG[q], at, zTop);
          line(lo, hi, THEME.grid, 1);
        }
        for (q = 0; q <= nz; q++) {
          var zz = zTop * q / nz;
          var aa = fixedAxis === 'x' ? PT(at, -1, zz) : PT(-1, at, zz);
          var bb = fixedAxis === 'x' ? PT(at, 1, zz) : PT(1, at, zz);
          line(aa, bb, THEME.grid, 1);
        }
      }
      wall('x', xWall);
      wall('y', yWall);

      /* ---------- piso ---------- */
      ctx.fillStyle = THEME.pane || 'rgba(127,127,127,.045)';
      ctx.beginPath();
      var fc = [PT(-1, -1, zFloor), PT(1, -1, zFloor), PT(1, 1, zFloor), PT(-1, 1, zFloor)];
      ctx.moveTo(fc[0][0], fc[0][1]);
      for (k = 1; k < 4; k++) ctx.lineTo(fc[k][0], fc[k][1]);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = THEME.grid; ctx.lineWidth = 1; ctx.stroke();
      for (i = stepX; i < nx0 - 1; i += stepX) line(PT(gx0[i], -1, zFloor), PT(gx0[i], 1, zFloor), THEME.grid, 1);
      for (j = stepY; j < ny0 - 1; j += stepY) line(PT(-1, gy0[j], zFloor), PT(1, gy0[j], zFloor), THEME.grid, 1);

      /* ---------- curvas de nivel projetadas na base ---------- */
      var nIso = c.contours === undefined ? 9 : c.contours;
      if (nIso) {
        ctx.lineWidth = 1.25;
        for (k = 1; k < nIso; k++) {
          var lv = zLo + (zHi - zLo) * (k / nIso);
          var segs = isoSegments(ZF, gx, gy, lv);
          ctx.strokeStyle = rgb(k / nIso);
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          for (var t2 = 0; t2 < segs.length; t2++) {
            var a3 = PT(segs[t2][0][0], segs[t2][0][1], zFloor);
            var b3 = PT(segs[t2][1][0], segs[t2][1][1], zFloor);
            ctx.moveTo(a3[0], a3[1]); ctx.lineTo(b3[0], b3[1]);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      /* ---------- sombra do relevo no piso ---------- */
      /* Cada face achatada na base, com pouca opacidade. Onde o relevo
         e alto varias faces se sobrepoem e a mancha escurece sozinha:
         sai de graca a nocao de que a superficie flutua sobre o
         plano, que e metade da leitura de profundidade.            */
      if (c.shadow !== false) {
        ctx.globalAlpha = 0.055;
        ctx.fillStyle = '#000';
        for (j = 0; j < ny - 1; j++) {
          for (i = 0; i < nx - 1; i++) {
            var s00 = PT(gx[i] + 0.045, gy[j] + 0.045, zFloor);
            var s10 = PT(gx[i + 1] + 0.045, gy[j] + 0.045, zFloor);
            var s11 = PT(gx[i + 1] + 0.045, gy[j + 1] + 0.045, zFloor);
            var s01 = PT(gx[i] + 0.045, gy[j + 1] + 0.045, zFloor);
            var h4 = (zn(j, i) + zn(j, i + 1) + zn(j + 1, i + 1) + zn(j + 1, i)) / 4;
            if (h4 <= 0.02) continue;
            ctx.beginPath();
            ctx.moveTo(s00[0], s00[1]); ctx.lineTo(s10[0], s10[1]);
            ctx.lineTo(s11[0], s11[1]); ctx.lineTo(s01[0], s01[1]);
            ctx.closePath(); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      /* ---------- superficie ---------- */
      var quads = [];
      var dLo = Infinity, dHi = -Infinity;
      for (j = 0; j < ny - 1; j++) {
        for (i = 0; i < nx - 1; i++) {
          var p00 = P[j][i], p10 = P[j][i + 1], p11 = P[j + 1][i + 1], p01 = P[j + 1][i];
          var dd = (p00.d + p10.d + p11.d + p01.d) / 4;
          if (dd < dLo) dLo = dd;
          if (dd > dHi) dHi = dd;
          quads.push({
            d: dd,
            a: p00, b: p10, cc: p11, e: p01,
            t: (norm(ZF[j][i]) + norm(ZF[j][i + 1]) + norm(ZF[j + 1][i + 1]) + norm(ZF[j + 1][i])) / 4,
            ax: gx[i + 1] - gx[i], az: zn(j, i + 1) - zn(j, i),
            by: gy[j + 1] - gy[j], bz: zn(j + 1, i) - zn(j, i)
          });
        }
      }
      quads.sort(function (u, v2) { return v2.d - u.d; });

      /* Luz de cima e da esquerda, mais tres coisas que o modelo antigo
         (so ambiente + difusa pelo modulo) nao tinha:
           - brilho especular curto, que da a sensacao de material em
             vez de papel colorido;
           - luz de preenchimento fraca por baixo, senao a face voltada
             para longe da luz vira um buraco preto;
           - neblina pela profundidade, que afasta o fundo de verdade.
         Tudo em uma conta por face, entao nao custa quadro.        */
      var LX = -0.42, LY = -0.5, LZ = 0.76;
      var llen = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
      LX /= llen; LY /= llen; LZ /= llen;
      var HX = LX, HY = LY, HZ = LZ + 1;              /* meio caminho entre luz e olho */
      var hlen = Math.sqrt(HX * HX + HY * HY + HZ * HZ) || 1;
      HX /= hlen; HY /= hlen; HZ /= hlen;
      var dRange = Math.max(dHi - dLo, 1e-6);
      var fogR = bgRGB[0], fogG = bgRGB[1], fogB = bgRGB[2];
      var mesh = c.mesh === false ? null : (THEME.mesh || 'rgba(20,24,32,.34)');
      var meshFine = mesh && fine === 1;
      for (k = 0; k < quads.length; k++) {
        var q2 = quads[k];
        var nX = -q2.az * q2.by, nY = -q2.ax * q2.bz, nZ = q2.ax * q2.by;
        var len = Math.sqrt(nX * nX + nY * nY + nZ * nZ) || 1;
        nX /= len; nY /= len; nZ /= len;
        var lam = nX * LX + nY * LY + nZ * LZ;
        var up = Math.abs(lam);
        var spec = Math.pow(Math.max(nX * HX + nY * HY + nZ * HZ, 0), 26);
        var shade = 0.52 + 0.44 * up + 0.16 * Math.max(nZ, 0);
        var col = rampAt(stops, q2.t);
        var fog = U.clamp((q2.d - dLo) / dRange, 0, 1);
        fog = 0.30 * (1 - fog);                       /* o fundo e que some */
        var rr = col[0] * shade + 255 * spec * 0.55;
        var gg = col[1] * shade + 255 * spec * 0.55;
        var bb2 = col[2] * shade + 255 * spec * 0.6;
        ctx.fillStyle = 'rgb(' +
          Math.round(U.clamp(rr * (1 - fog) + fogR * fog, 0, 255)) + ',' +
          Math.round(U.clamp(gg * (1 - fog) + fogG * fog, 0, 255)) + ',' +
          Math.round(U.clamp(bb2 * (1 - fog) + fogB * fog, 0, 255)) + ')';
        ctx.beginPath();
        ctx.moveTo(SX(q2.a), SY(q2.a));
        ctx.lineTo(SX(q2.b), SY(q2.b));
        ctx.lineTo(SX(q2.cc), SY(q2.cc));
        ctx.lineTo(SX(q2.e), SY(q2.e));
        ctx.closePath();
        ctx.fill();
        /* na malha crua a borda de cada face e o proprio fio de malha;
           na refinada isso viraria uma teia, entao ela e desenhada
           depois, so nas linhas que existem na tabela */
        if (meshFine) { ctx.strokeStyle = mesh; ctx.lineWidth = 0.55; ctx.stroke(); }
        else { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke(); }
      }

      /* ---------- fio de malha sobre o relevo refinado ---------- */
      if (mesh && !meshFine) {
        ctx.strokeStyle = mesh; ctx.lineWidth = 0.9;
        ctx.lineJoin = 'round';
        for (j = 0; j < ny0; j++) {
          var jf = Math.min(j * fine, ny - 1);
          ctx.beginPath();
          for (i = 0; i < nx; i++) {
            var pp = P[jf][i];
            i ? ctx.lineTo(SX(pp), SY(pp)) : ctx.moveTo(SX(pp), SY(pp));
          }
          ctx.stroke();
        }
        for (i = 0; i < nx0; i++) {
          var iff = Math.min(i * fine, nx - 1);
          ctx.beginPath();
          for (j = 0; j < ny; j++) {
            var pq = P[j][iff];
            j ? ctx.lineTo(SX(pq), SY(pq)) : ctx.moveTo(SX(pq), SY(pq));
          }
          ctx.stroke();
        }
      }

      /* ---------- eixo vertical, na quina do fundo ---------- */
      /* De todas as quinas verticais da caixa, a que aparece mais a
         esquerda e a que menos disputa espaco com o relevo em
         qualquer giro. E onde a escala vertical fica.               */
      var zc = null;
      for (k = 0; k < 4; k++) {
        var cx2 = (k & 1) ? 1 : -1, cy2 = (k & 2) ? 1 : -1;
        var sxx = PT(cx2, cy2, zTop)[0];
        if (!zc || sxx < zc.sx) zc = { x: cx2, y: cy2, sx: sxx };
      }
      var axCol = THEME.axis;
      line(PT(zc.x, zc.y, zFloor), PT(zc.x, zc.y, zTop), axCol, 1.4);
      var zfmt = c.zFmt || function (v2) { return U.br(v2, 1); };
      var zTickLab = [];
      for (k = 0; k <= nz; k++) {
        var zz2 = zTop * k / nz;
        line(PT(zc.x, zc.y, zz2), PT(zc.x * 1.08, zc.y * 1.08, zz2), axCol, 1.2);
        zTickLab.push({ t: zfmt(zLo + (zHi - zLo) * k / nz), p: PT(zc.x * 1.24, zc.y * 1.24, zz2) });
      }

      /* ---------- marcador do ponto de operacao ---------- */
      var markerLabel = null;
      if (c.marker && isFinite(c.marker.x) && isFinite(c.marker.y)) {
        var mi = U.clamp((c.marker.x - c.x.min) / (c.x.max - c.x.min || 1), 0, 1) * 2 - 1;
        var mj = U.clamp((c.marker.y - c.y.min) / (c.y.max - c.y.min || 1), 0, 1) * 2 - 1;
        var fi = (mi + 1) / 2 * (nx - 1), fj = (mj + 1) / 2 * (ny - 1);
        var i0b = Math.min(Math.floor(fi), nx - 2), j0b = Math.min(Math.floor(fj), ny - 2);
        var tx = fi - i0b, ty = fj - j0b;
        var zm = zn(j0b, i0b) * (1 - tx) * (1 - ty) + zn(j0b, i0b + 1) * tx * (1 - ty) +
                 zn(j0b + 1, i0b) * (1 - tx) * ty + zn(j0b + 1, i0b + 1) * tx * ty;
        var mb = PT(mi, mj, zFloor), mt = PT(mi, mj, zm);
        line(mb, mt, c.markerColor || THEME.txtStrong, 1.4, [3, 3]);
        ctx.fillStyle = c.markerColor || THEME.txtStrong;
        ctx.beginPath(); ctx.arc(mt[0], mt[1], 4, 0, 6.284); ctx.fill();
        ctx.strokeStyle = THEME.bg; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(mt[0], mt[1], 4, 0, 6.284); ctx.stroke();
        if (c.marker.label) markerLabel = { t: c.marker.label, x: mt[0], y: mt[1] - 13 };
      }

      /* ---------- rotulos ----------
         Cada um leva a propria pastilha de fundo, entao continua legivel
         por cima do relevo. As pastilhas ja escritas entram numa lista: a
         proxima que colidir com uma delas e omitida, e como os nomes dos
         eixos sao escritos primeiro, nenhum numero os cobre.            */
      var taken = [];
      function chip(txt, px, py, font, strong, force) {
        ctx.font = font;
        var w2 = ctx.measureText(txt).width;
        var r2 = { l: px - w2 / 2 - 4, t: py - 8, rt: px + w2 / 2 + 4, b: py + 8 };
        if (!force) {
          for (var z3 = 0; z3 < taken.length; z3++) {
            var o3 = taken[z3];
            if (r2.l < o3.rt && r2.rt > o3.l && r2.t < o3.b && r2.b > o3.t) return false;
          }
        }
        taken.push(r2);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = THEME.bg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(r2.l, r2.t, r2.rt - r2.l, 16, 4);
        else ctx.rect(r2.l, r2.t, r2.rt - r2.l, 16);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = strong ? THEME.txtStrong : THEME.txt;
        ctx.fillText(txt, px, py);
        return true;
      }
      /* o nome do eixo se afasta ate achar lugar livre: empurrar o
         rotulo para fora custa uns pixels de moldura, enquanto
         deixa-lo por cima come um numero da escala */
      function axisChip(txt, axis, edge, r0) {
        for (var a4 = 0; a4 < 4; a4++) {
          var rr2 = r0 + a4 * 0.13;
          var pp2 = axis === 'x' ? PT(0, edge * rr2, zFloor) : PT(edge * rr2, 0, zFloor);
          if (chip(txt, pp2[0], pp2[1], axFont, true, a4 === 3)) return;
        }
      }

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var axFont = '600 11px system-ui,sans-serif';
      var tickFont = '10.5px ui-monospace,monospace';
      var xf = c.x.fmt || String, yf = c.y.fmt || String;
      /* o nome do eixo fica bem afastado das marcas: quando os dois
         disputavam o mesmo anel, a regra de colisao apagava quase
         todas as marcas e sobrava um numero solto por eixo */
      var axR = narrow ? 1.44 : 1.60, tkR = narrow ? 1.06 : 1.12;

      if (markerLabel) chip(markerLabel.t, markerLabel.x, markerLabel.y, axFont, true, true);
      for (k = 0; k < zTickLab.length; k++) {
        chip(zTickLab[k].t, zTickLab[k].p[0], zTickLab[k].p[1], tickFont, false, true);
      }
      /* as marcas primeiro, e elas e que reservam lugar */
      for (i = 0; i < nx0; i += stepX) {
        var t3 = PT(gx0[i], yEdge * tkR, zFloor);
        chip(xf(c.x.min + (c.x.max - c.x.min) * (i / (nx0 - 1))), t3[0], t3[1], tickFont, false);
      }
      for (j = 0; j < ny0; j += stepY) {
        var t4 = PT(xEdge * tkR, gy0[j], zFloor);
        chip(yf(c.y.min + (c.y.max - c.y.min) * (j / (ny0 - 1))), t4[0], t4[1], tickFont, false);
      }
      if (c.xLabel) axisChip(c.xLabel, 'x', yEdge, axR);
      if (c.yLabel) axisChip(c.yLabel, 'y', xEdge, axR);

      /* ---------- barra de cores ---------- */
      if (bar) {
        var bw = 15, bh = Math.min(H - padT - 44, 220);
        var bx = W - bar + 10, by = padT + (H - padT - padB - bh) / 2;
        var grad = ctx.createLinearGradient(0, by + bh, 0, by);
        for (k = 0; k <= 10; k++) grad.addColorStop(k / 10, rgb(k / 10));
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = THEME.axis; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
        ctx.font = tickFont; ctx.fillStyle = THEME.txt;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (k = 0; k <= nz; k++) {
          var yy = by + bh - bh * k / nz;
          ctx.strokeStyle = THEME.axis;
          ctx.beginPath(); ctx.moveTo(bx + bw, yy); ctx.lineTo(bx + bw + 4, yy); ctx.stroke();
          ctx.fillStyle = THEME.txt;
          ctx.fillText(zfmt(zLo + (zHi - zLo) * k / nz), bx + bw + 7, yy);
        }
        if (c.zLabel) {
          ctx.save();
          ctx.translate(bx - 5, by + bh / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.font = axFont; ctx.fillStyle = THEME.txtStrong;
          ctx.fillText(c.zLabel, 0, 0);
          ctx.restore();
        }
      } else if (c.zLabel) {
        /* sem barra de cores, o nome da grandeza vai para o rodape a
           esquerda, que e o unico canto que sobra livre                */
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.font = '600 11.5px system-ui,sans-serif';
        ctx.fillStyle = THEME.txtStrong;
        ctx.fillText(c.zLabel, 12, H - 7);
      }

      /* ---------- titulo e nota ---------- */
      if (c.title) {
        /* o titulo se encolhe ate caber; o subtitulo so aparece se
           couber inteiro, porque meia frase cortada nao informa nada */
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        var tSize = 13.5;
        do {
          ctx.font = '650 ' + tSize + 'px system-ui,sans-serif';
          if (ctx.measureText(c.title).width <= W - 24) break;
          tSize -= 0.5;
        } while (tSize > 10.5);
        ctx.fillStyle = THEME.txtStrong;
        ctx.fillText(c.title, W / 2, 10);
        if (c.subtitle) {
          ctx.font = '11.5px system-ui,sans-serif';
          if (ctx.measureText(c.subtitle).width <= W - 24) {
            ctx.fillStyle = THEME.txt;
            ctx.fillText(c.subtitle, W / 2, 12 + tSize + 3);
          }
        }
      }
      if (c.hint) {
        ctx.font = '10.5px system-ui,sans-serif';
        ctx.fillStyle = THEME.txt;
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(c.hint, W - 12, H - 7);
      }
    }

    /* ---- giro pelo ponteiro, com inercia ao soltar ---- */
    if (!st.bound) {
      st.bound = true;
      var M = ATC.Motion;

      function coast() {
        if (st.stop || !M) return;
        st.stop = M.onFrame(function (dt) {
          if (st.drag) return;                       /* arrastando: o dedo manda */
          st.yaw += st.yawV * dt;
          st.el = U.clamp(st.el + st.elV * dt, 0.12, 1.44);
          var kk = Math.exp(-2.6 * dt);              /* atrito */
          st.yawV *= kk; st.elV *= kk;
          draw();
          if (Math.abs(st.yawV) < 0.02 && Math.abs(st.elV) < 0.02) {
            st.yawV = st.elV = 0; st.stop = null;
            draw();
            return false;
          }
        });
      }

      canvas.addEventListener('pointerdown', function (ev) {
        st.drag = { x: ev.clientX, y: ev.clientY, t: performance.now(), vx: 0, vy: 0 };
        st.yawV = st.elV = 0;
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        canvas.style.cursor = 'grabbing';
      });
      canvas.addEventListener('pointermove', function (ev) {
        if (!st.drag) return;
        var now = performance.now();
        var dt = Math.max((now - st.drag.t) / 1000, 1 / 240);
        var dx = ev.clientX - st.drag.x, dy = ev.clientY - st.drag.y;
        st.yaw += dx * 0.008;
        st.el = U.clamp(st.el - dy * 0.006, 0.12, 1.44);
        st.drag.vx = (dx * 0.008) / dt;
        st.drag.vy = (-dy * 0.006) / dt;
        st.drag.x = ev.clientX; st.drag.y = ev.clientY; st.drag.t = now;
        draw();
      });
      function release() {
        if (!st.drag) return;
        /* a velocidade do gesto vira velocidade de giro: solta girando */
        st.yawV = U.clamp(st.drag.vx, -6, 6);
        st.elV = U.clamp(st.drag.vy, -4, 4);
        st.drag = null;
        canvas.style.cursor = 'grab';
        if (Math.abs(st.yawV) > 0.02 || Math.abs(st.elV) > 0.02) coast();
      }
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
      canvas.style.cursor = 'grab';
      /* pan-y deixa o dedo rolar a pagina verticalmente: so o arrasto
         horizontal gira. Prender os dois seria transformar o grafico
         numa armadilha no meio da rolagem.                          */
      canvas.style.touchAction = 'pan-y';
    }

    register(canvas, draw); draw();
    return { draw: draw };
  };

  G.theme = THEME;
  G.syncTheme = function () { var t = syncTheme(); G.redrawAll(); return t; };
  G.readTheme = syncTheme;
  ATC.Charts = G;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
