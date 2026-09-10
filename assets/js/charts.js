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
    txt: '#697080', txtStrong: '#0d0f14', bg: '#ffffff'
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
  function fit(canvas, h) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentNode ? canvas.parentNode.clientWidth : 600;
    w = Math.max(w || 600, 200);
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
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

  G.theme = THEME;
  G.syncTheme = function () { var t = syncTheme(); G.redrawAll(); return t; };
  G.readTheme = syncTheme;
  ATC.Charts = G;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
