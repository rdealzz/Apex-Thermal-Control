/* ============================================================
   APEX — sistema de movimento
   ------------------------------------------------------------
   Tudo que se mexe na interface passa por aqui, e tudo que passa
   por aqui e integrado como uma mola real:

       a = -k(x - alvo) - c·v      v += a·dt      x += v·dt

   Nao ha curva de duracao fixa: o elemento tem rigidez e
   amortecimento, entao interromper um movimento no meio nao
   corta nada — a velocidade que ele ja tinha entra no proximo
   trecho. E o que faz a coisa parecer fisica em vez de animada.

   Um unico requestAnimationFrame serve todos os assinantes. Ele
   e cancelado quando nada mais se move, entao o custo em repouso
   e zero. Cada quadro escreve apenas variaveis CSS que alimentam
   transform e opacity: sem layout, sem repaint, o compositor
   resolve.
   ============================================================ */
(function (ATC) {
  'use strict';

  var M = {};

  /* ---------- preferencia do sistema ---------- */
  var reduce = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduce = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', function (e) { reduce = e.matches; });
  } catch (e) {}
  M.reduced = function () { return reduce; };

  /* ============================================================
     Nucleo: integrador de molas
     ============================================================ */
  var springs = [];      // molas vivas
  var frames = [];       // trabalhos por quadro (gauges, particulas)
  var raf = null, last = 0;

  function Spring(value, cfg) {
    this.x = value || 0;
    this.v = 0;
    this.target = this.x;
    this.k = (cfg && cfg.k) || 170;      // rigidez
    this.c = (cfg && cfg.c) || 24;       // amortecimento
    this.eps = (cfg && cfg.eps) || 0.002;
    this.live = false;
  }
  Spring.prototype.to = function (t) {
    if (t === this.target) return this;
    this.target = t;
    awaken(this);
    return this;
  };
  Spring.prototype.set = function (t) {
    this.x = this.target = t; this.v = 0;
    return this;
  };
  Spring.prototype.step = function (dt) {
    /* passos de no maximo 1/120 s: o integrador explicito perde
       estabilidade se o quadro atrasar (aba em segundo plano)    */
    var left = dt;
    while (left > 0) {
      var h = Math.min(left, 1 / 120);
      var a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
      left -= h;
    }
    if (Math.abs(this.x - this.target) < this.eps && Math.abs(this.v) < this.eps * 12) {
      this.x = this.target; this.v = 0;
      return true;   // assentou
    }
    return false;
  };

  function awaken(s) {
    if (!s.live) { s.live = true; springs.push(s); }
    start();
  }
  function start() {
    if (raf === null) { last = 0; raf = requestAnimationFrame(tick); }
  }
  function tick(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.064) : 1 / 60;
    last = now;

    for (var i = springs.length - 1; i >= 0; i--) {
      var s = springs[i];
      var done = s.step(dt);
      if (s.onStep) s.onStep(s.x, s);
      if (done) {
        s.live = false;
        springs.splice(i, 1);
        if (s.onRest) s.onRest(s);
      }
    }
    for (var j = frames.length - 1; j >= 0; j--) {
      if (frames[j](dt, now) === false) frames.splice(j, 1);
    }
    raf = (springs.length || frames.length) ? requestAnimationFrame(tick) : null;
  }

  M.spring = function (value, cfg) { return new Spring(value, cfg); };
  /* registra um trabalho por quadro; devolver false o encerra */
  M.onFrame = function (fn) {
    if (frames.indexOf(fn) < 0) frames.push(fn);
    start();
    return function () { var i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); };
  };

  /* ============================================================
     Superficies que respondem ao ponteiro
     ============================================================ */
  var KINDS = [
    { sel: 'button.btn, a.btn',        tilt: 9,   press: 1, glare: true,  scale: 1.012, k: 260, c: 22 },
    { sel: '.speed-btn, .icon-btn, .kbd-btn', tilt: 0, press: 1, glare: false, scale: 1.04, k: 300, c: 24 },
    { sel: 'nav.tabs button',          tilt: 0,   press: 1, glare: false, scale: 1,     k: 300, c: 26 },
    { sel: '.dz',                      tilt: 2.6, press: 0, glare: false, scale: 1,     k: 150, c: 22 },
    { sel: '.kpi',                     tilt: 3.4, press: 0, glare: false, scale: 1,     k: 140, c: 21 },
    { sel: '.card.lift',               tilt: 1.6, press: 0, glare: false, scale: 1,     k: 120, c: 20 }
  ];
  var SEL = KINDS.map(function (k) { return k.sel; }).join(', ');

  function surface(el) {
    if (el.__srf) return el.__srf;
    var kind = null;
    for (var i = 0; i < KINDS.length; i++) {
      if (el.matches(KINDS[i].sel)) { kind = KINDS[i]; break; }
    }
    if (!kind) return null;

    var st = el.style;
    var s = { el: el, kind: kind, rect: null };
    var cfg = { k: kind.k, c: kind.c };

    s.rx = new Spring(0, cfg);
    s.ry = new Spring(0, cfg);
    s.pz = new Spring(0, { k: 420, c: 26 });
    s.sc = new Spring(1, { k: 300, c: 24, eps: 0.0004 });
    s.gx = new Spring(0, { k: 200, c: 26, eps: 0.4 });
    s.gy = new Spring(0, { k: 200, c: 26, eps: 0.4 });

    s.rx.onStep = function (v) { st.setProperty('--rx', v.toFixed(3) + 'deg'); };
    s.ry.onStep = function (v) { st.setProperty('--ry', v.toFixed(3) + 'deg'); };
    s.pz.onStep = function (v) { st.setProperty('--press', v.toFixed(4)); };
    s.sc.onStep = function (v) { st.setProperty('--sc', v.toFixed(4)); };
    if (kind.glare) {
      s.gx.onStep = function (v) { st.setProperty('--gx', v.toFixed(1) + 'px'); };
      s.gy.onStep = function (v) { st.setProperty('--gy', v.toFixed(1) + 'px'); };
    }
    el.__srf = s;
    return s;
  }

  function rectOf(s) {
    if (!s.rect) s.rect = s.el.getBoundingClientRect();
    return s.rect;
  }

  function aim(s, ev) {
    var r = rectOf(s);
    if (!r.width || !r.height) return;
    var px = (ev.clientX - r.left) / r.width;
    var py = (ev.clientY - r.top) / r.height;
    if (s.kind.glare) { s.gx.to(px * r.width); s.gy.to(py * r.height); }
    if (reduce || !s.kind.tilt) return;
    /* a face acompanha o cursor: o lado apontado vem para a frente */
    var t = s.kind.tilt;
    s.rx.to((Math.min(Math.max(py, 0), 1) - 0.5) * 2 * t);
    s.ry.to((0.5 - Math.min(Math.max(px, 0), 1)) * 2 * t);
  }

  function rest(s) {
    s.rx.to(0); s.ry.to(0); s.pz.to(0); s.sc.to(1); s.rect = null;
    s.el.classList.remove('is-press');
  }

  function hit(node) {
    if (!node || !node.closest) return null;
    var el = node.closest(SEL);
    if (!el || el.disabled) return null;
    return surface(el);
  }

  document.addEventListener('pointerover', function (ev) {
    var s = hit(ev.target);
    if (!s || (ev.relatedTarget && s.el.contains(ev.relatedTarget))) return;
    s.rect = null;
    if (!reduce) s.sc.to(s.kind.scale);
    aim(s, ev);
  }, { passive: true });

  document.addEventListener('pointermove', function (ev) {
    var s = hit(ev.target);
    if (s) aim(s, ev);
  }, { passive: true });

  document.addEventListener('pointerout', function (ev) {
    var s = hit(ev.target);
    if (!s || (ev.relatedTarget && s.el.contains(ev.relatedTarget))) return;
    rest(s);
  }, { passive: true });

  document.addEventListener('pointerdown', function (ev) {
    var s = hit(ev.target);
    if (!s) return;
    s.rect = null;
    aim(s, ev);
    s.pz.to(s.kind.press);
    s.sc.to(s.kind.press ? 0.985 : 1);
    /* dedo e caneta nao tem hover: so o afundamento, sem inclinacao */
    if (ev.pointerType !== 'mouse') { s.rx.to(0); s.ry.to(0); }
    s.el.classList.add('is-press');
    if (s.kind.glare) ripple(s.el, ev);
  }, { passive: true });

  function letGo(ev) {
    var s = hit(ev.target);
    if (!s) return;
    s.pz.to(0);
    s.sc.to(s.el.matches(':hover') && !reduce ? s.kind.scale : 1);
    if (ev.pointerType !== 'mouse') { s.rx.to(0); s.ry.to(0); }
    s.el.classList.remove('is-press');
  }
  document.addEventListener('pointerup', letGo, { passive: true });
  document.addEventListener('pointercancel', letGo, { passive: true });

  /* onda de toque: um circulo que cresce e some. Vive ~0,5 s e se
     remove sozinho, entao nao acumula nada no documento.          */
  function ripple(el, ev) {
    if (reduce) return;
    var r = el.getBoundingClientRect();
    var d = Math.max(r.width, r.height) * 2.1;
    var n = document.createElement('span');
    n.className = 'ripple';
    n.style.width = n.style.height = d + 'px';
    n.style.left = (ev.clientX - r.left) + 'px';
    n.style.top = (ev.clientY - r.top) + 'px';
    el.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 560);
  }
  M.ripple = ripple;

  /* teclado: o botao tambem afunda no Enter e no Espaco */
  document.addEventListener('keydown', function (ev) {
    if ((ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') || ev.repeat) return;
    var s = hit(document.activeElement);
    if (!s || !s.kind.press) return;
    s.pz.to(s.kind.press); s.sc.to(0.985);
    s.el.classList.add('is-press');
  });
  document.addEventListener('keyup', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    var s = hit(document.activeElement);
    if (!s) return;
    s.pz.to(0); s.sc.to(1);
    s.el.classList.remove('is-press');
  });

  function stale() {
    document.querySelectorAll(SEL).forEach(function (el) { if (el.__srf) el.__srf.rect = null; });
  }
  var staleT = null;
  function staleSoon() { clearTimeout(staleT); staleT = setTimeout(stale, 90); }
  window.addEventListener('scroll', staleSoon, { passive: true });
  window.addEventListener('resize', staleSoon, { passive: true });

  /* ============================================================
     Cursor das abas — segue a aba ativa por mola
     ============================================================ */
  M.shuttle = function (nav) {
    var el = nav.querySelector('.shuttle');
    if (!el) return { sync: function () {} };
    var x = new Spring(0, { k: 320, c: 30 });
    var w = new Spring(0, { k: 320, c: 30, eps: 0.05 });
    var faded = true;

    x.onStep = function (v) { el.style.transform = 'translate3d(' + v.toFixed(2) + 'px,0,0)'; };
    /* o cursor e o unico elemento cuja largura muda por quadro. Ele e
       absoluto, entao o layout comeca e termina nele mesmo.          */
    w.onStep = function (v) { el.style.width = Math.max(v, 0).toFixed(2) + 'px'; };

    function sync(instant) {
      var b = nav.querySelector('button[aria-selected="true"]');
      if (!b) { el.style.opacity = 0; faded = true; return; }
      var tx = b.offsetLeft - nav.scrollLeft;
      var tw = b.offsetWidth;
      if (instant || faded || reduce) { x.set(tx); w.set(tw); x.onStep(tx); w.onStep(tw); }
      else { x.to(tx); w.to(tw); }
      if (faded) { el.style.opacity = 1; faded = false; }
    }
    nav.addEventListener('scroll', function () { sync(true); }, { passive: true });
    window.addEventListener('resize', function () { sync(true); }, { passive: true });
    return { sync: sync };
  };

  /* ============================================================
     Numeros que se movem
     ------------------------------------------------------------
     Um numero que salta de 82 para 97 nao conta a mesma historia
     que um numero que sobe. A mola faz a leitura acompanhar a
     variacao, e o passo por quadro so troca textContent — barato
     porque a fonte e tabular e a largura nao muda.
     ============================================================ */
  M.count = function (el, value, fmt, cfg) {
    if (!el) return;
    if (!isFinite(value)) { el.textContent = fmt ? fmt(NaN) : '--'; return; }
    if (!el.__num) {
      el.__num = new Spring(value, cfg || { k: 90, c: 20, eps: 0.004 });
      el.__num.onStep = function (v) { el.textContent = fmt ? fmt(v) : v.toFixed(1); };
      el.__num.set(value);
      el.textContent = fmt ? fmt(value) : value.toFixed(1);
      return;
    }
    el.__num.onStep = function (v) { el.textContent = fmt ? fmt(v) : v.toFixed(1); };
    if (reduce) { el.__num.set(value); el.__num.onStep(value); }
    else el.__num.to(value);
  };

  /* ============================================================
     Avisos flutuantes
     ============================================================ */
  var toaster = null;
  M.toast = function (msg, kind, ms) {
    if (!toaster) {
      toaster = document.createElement('div');
      toaster.className = 'toaster';
      document.body.appendChild(toaster);
    }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.innerHTML = '<span class="t-dot"></span><span></span>';
    t.lastChild.textContent = msg;
    toaster.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, ms || 2600);
    return t;
  };

  /* ============================================================
     Revelacao em cascata: usada quando uma secao ganha conteudo
     ============================================================ */
  M.reveal = function (nodes, step) {
    if (reduce) return;
    var d = step || 34;
    Array.prototype.slice.call(nodes).forEach(function (n, i) {
      n.style.animation = 'none';
      /* leitura forcada para reiniciar a animacao no mesmo elemento */
      void n.offsetWidth;
      n.style.animation = 'sectionIn .34s cubic-bezier(.22,.9,.3,1) ' + (i * d) + 'ms both';
    });
  };

  ATC.Motion = M;
})(window.ATC = window.ATC || {});
