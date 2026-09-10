/* ============================================================
   APEX — som da interface
   ------------------------------------------------------------
   Sintetizado na hora com WebAudio: nenhum arquivo, nenhuma
   requisicao, nada que atrapalhe abrir a pagina offline.

   Comeca desligado e so acorda depois de um gesto do usuario —
   navegador nenhum deixa tocar som antes disso, e ninguem gosta
   de abrir uma pagina que apita sozinha.
   ============================================================ */
(function (ATC) {
  'use strict';

  var A = {}, ctx = null, master = null, on = false;

  try { on = localStorage.getItem('apex.sound') === '1'; } catch (e) {}

  function ready() {
    if (!on) return null;
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.11;          /* discreto por principio */
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(node, t0, atk, dec, peak) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dec);
    node.connect(g); g.connect(master);
    return g;
  }

  function tone(freq, t0, dur, type, peak, slideTo) {
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(o, t0, 0.004, dur, peak === undefined ? 0.5 : peak);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  /* ruido curto, filtrado: e o que da o carater metalico */
  function noise(t0, dur, freq, q, peak) {
    var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q || 6;
    src.connect(bp);
    env(bp, t0, 0.003, dur, peak === undefined ? 0.4 : peak);
    src.start(t0);
    return src;
  }

  var VOICES = {
    /* clique metalico curto */
    tick: function (t) { noise(t, 0.035, 2600, 9, 0.30); tone(1750, t, 0.035, 'square', 0.06); },
    /* o botao chegando ao fundo */
    press: function (t) { noise(t, 0.045, 1500, 6, 0.34); tone(420, t, 0.05, 'triangle', 0.16, 300); },
    /* rele: dois estalos separados por um respiro */
    relay: function (t) { noise(t, 0.03, 3400, 12, 0.4); noise(t + 0.045, 0.05, 900, 7, 0.34); },
    /* aviso de HUD */
    blip: function (t) { tone(1320, t, 0.07, 'sine', 0.22); tone(1980, t + 0.05, 0.06, 'sine', 0.14); },
    /* partida: o motor pegando */
    ignition: function (t) {
      noise(t, 0.5, 220, 1.4, 0.5);
      tone(46, t, 0.62, 'sawtooth', 0.42, 128);
      tone(92, t + 0.06, 0.5, 'square', 0.14, 210);
      tone(140, t + 0.34, 0.42, 'sawtooth', 0.2, 320);
    },
    /* alivio do turbo */
    turbo: function (t) {
      noise(t, 0.42, 4200, 1.1, 0.42);
      tone(1500, t, 0.34, 'sine', 0.1, 320);
    },
    /* estouro do nitro */
    nitro: function (t) {
      noise(t, 0.72, 160, 0.9, 0.75);
      tone(70, t, 0.68, 'sawtooth', 0.55, 34);
      tone(880, t + 0.02, 0.3, 'square', 0.14, 120);
    }
  };

  A.play = function (name, delay) {
    if (!ready() || !VOICES[name]) return;
    try { VOICES[name](ctx.currentTime + (delay || 0)); } catch (e) {}
  };

  A.enabled = function () { return on; };
  A.set = function (v) {
    on = !!v;
    try { localStorage.setItem('apex.sound', on ? '1' : '0'); } catch (e) {}
    if (on) { ready(); A.play('tick'); }
    return on;
  };
  A.toggle = function () { return A.set(!on); };

  ATC.Audio = A;
})(window.ATC = window.ATC || {});
