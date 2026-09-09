/* Apex Thermal Control — utilitarios gerais */
(function (ATC) {
  'use strict';

  var U = {};

  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  U.num = function (v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    return Number(v).toFixed(dec === undefined ? 1 : dec);
  };

  /* separador decimal brasileiro para exibicao */
  U.br = function (v, dec) {
    var s = U.num(v, dec);
    return s === '--' ? s : s.replace('.', ',');
  };

  U.mmss = function (sec) {
    if (!isFinite(sec)) return '--:--';
    var s = Math.max(0, Math.round(sec));
    var m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  U.mean = function (a) {
    if (!a || !a.length) return NaN;
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) { if (isFinite(a[i])) { s += a[i]; n++; } }
    return n ? s / n : NaN;
  };

  U.std = function (a) {
    var m = U.mean(a);
    if (!isFinite(m)) return NaN;
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) { if (isFinite(a[i])) { s += (a[i] - m) * (a[i] - m); n++; } }
    return n > 1 ? Math.sqrt(s / (n - 1)) : 0;
  };

  U.percentile = function (a, p) {
    var v = a.filter(isFinite).slice().sort(function (x, y) { return x - y; });
    if (!v.length) return NaN;
    var i = U.clamp((v.length - 1) * p, 0, v.length - 1);
    var lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };

  U.min = function (a) { var m = Infinity; for (var i = 0; i < a.length; i++) if (isFinite(a[i]) && a[i] < m) m = a[i]; return m; };
  U.max = function (a) { var m = -Infinity; for (var i = 0; i < a.length; i++) if (isFinite(a[i]) && a[i] > m) m = a[i]; return m; };

  /* gerador pseudo-aleatorio deterministico (mulberry32) */
  U.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ruido gaussiano a partir de rng uniforme */
  U.gauss = function (rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /* quantizacao (resolucao de sensor / PID) */
  U.quant = function (v, step) { return step > 0 ? Math.round(v / step) * step : v; };

  /* media movel centrada, ignorando NaN */
  U.smooth = function (arr, win) {
    var n = arr.length, out = new Array(n), h = Math.floor(win / 2);
    for (var i = 0; i < n; i++) {
      var s = 0, c = 0;
      for (var j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) {
        if (isFinite(arr[j])) { s += arr[j]; c++; }
      }
      out[i] = c ? s / c : NaN;
    }
    return out;
  };

  /* interpolacao linear em serie ordenada por x */
  U.interp = function (xs, ys, x) {
    var n = xs.length;
    if (!n) return NaN;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    var t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  };

  /* dom helpers */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.el = function (tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };
  U.setText = function (sel, txt) { var e = U.$(sel); if (e) e.textContent = txt; };
  U.setHTML = function (sel, html) { var e = U.$(sel); if (e) e.innerHTML = html; };

  /* escape para injecao segura em html */
  U.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* armazenamento local tolerante a falha (file:// e modo privado) */
  U.store = {
    get: function (k, def) {
      try { var v = localStorage.getItem('atc.' + k); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem('atc.' + k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem('atc.' + k); } catch (e) {} }
  };

  U.download = function (name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      return true;
    } catch (e) { return false; }
  };

  ATC.U = U;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
