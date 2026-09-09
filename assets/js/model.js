/* ============================================================
   Apex Thermal Control — previsao e deteccao de anomalias
   Modelo supervisionado (regressao linear regularizada / ridge)
   sobre janela deslizante de variaveis OBD-II + grandezas termicas.
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U;
  var M = {};

  /* ---------- media de uma variavel na janela [t-w, t] ---------- */
  function winMean(rows, i, key, w) {
    var t = rows[i].t, s = 0, n = 0;
    for (var j = i; j >= 0; j--) {
      if (rows[j].t < t - w) break;
      var v = rows[j][key];
      if (isFinite(v)) { s += v; n++; }
    }
    return n ? s / n : NaN;
  }

  /* taxa de variacao da temperatura na janela (C/min) */
  function slope(rows, i, key, w) {
    var t = rows[i].t, k = i;
    for (var j = i; j >= 0; j--) { if (rows[j].t < t - w) break; k = j; }
    var dt = rows[i].t - rows[k].t;
    if (dt < 1) return 0;
    var a = rows[k][key], b = rows[i][key];
    return (isFinite(a) && isFinite(b)) ? (b - a) / dt * 60 : 0;
  }

  /* ---------- previsao puramente fisica da variacao de temperatura ----------
     Sob condicao de operacao constante, a capacitancia concentrada da
        T(t+H) = T_eq + (T - T_eq)*exp(-H/tau)
     com T_eq = T_ar + Q_gerado/UA_efetivo  e  tau = C_termica/UA_efetivo.
     Entra como variavel de entrada do modelo estatistico: e a parcela
     que a fisica ja explica, e o modelo aprende apenas o residuo.
     Essa e a abordagem hibrida declarada no projeto.                  */
  function physDelta(rows, i, H) {
    /* As medias entram ANTES da divisao: um pico isolado de carga leva
       o calor gerado a valores altos e, dividido por uma condutancia
       pequena, produziria uma temperatura de equilibrio absurda.      */
    var ua = winMean(rows, i, 'uaEff', 90);
    var qg = winMean(rows, i, 'qGen', 90);
    var amb = winMean(rows, i, 'tAmb', 90);
    var t = rows[i].tHotIn;
    var cTh = rows[i].cTh || 95000;
    if (!isFinite(ua) || !isFinite(qg) || !isFinite(amb) || !isFinite(t)) return 0;
    ua = U.clamp(ua, 30, 20000);
    qg = U.clamp(qg, 0, 80000);
    var tEq = U.clamp(amb + qg / ua, amb, 200);
    var tau = U.clamp(cTh / ua, 30, 6000);
    return U.clamp((tEq - t) * (1 - Math.exp(-H / tau)), -60, 60);
  }

  M.FEATURES = [
    { key: 'ect',      label: 'Temp. do líquido (atual)',        unit: '°C' },
    { key: 'dTdt60',   label: 'Tendência 60 s',                  unit: '°C/min' },
    { key: 'dTdt180',  label: 'Tendência 180 s',                  unit: '°C/min' },
    { key: 'dExc',     label: 'Líquido − ambiente',     unit: '°C' },
    { key: 'rpm',      label: 'Rotação média 60 s',              unit: 'krpm' },
    { key: 'speed',    label: 'Velocidade média 60 s',           unit: 'km/h' },
    { key: 'load',     label: 'Carga média 60 s',                unit: '%' },
    { key: 'iat',      label: 'Temp. ar de admissão',            unit: '°C' },
    { key: 'tAmb',     label: 'Temp. ambiente',                  unit: '°C' },
    { key: 'runtime',  label: 'Tempo de motor ligado',           unit: 'min' },
    { key: 'fanDuty',  label: 'Ciclo do ventilador 120 s',       unit: '0–1' },
    { key: 'qKw',      label: 'Calor rejeitado 60 s',      unit: 'kW' },
    { key: 'eps',      label: 'Efetividade média 60 s',          unit: '–' },
    { key: 'tStat',    label: 'Abertura do termostato',          unit: '0–1' },
    { key: 'qGen',     label: 'Calor gerado pelo motor',  unit: 'kW' },
    { key: 'qNet',     label: 'Desequilíbrio gerado − rejeitado', unit: 'kW' },
    { key: 'dTdtMod',  label: 'Tendência da capacitância', unit: '°C/min' },
    { key: 'dPhys',    label: 'Variação do modelo físico', unit: '°C' }
  ];

  /* ---------- montagem da matriz de projeto ----------
     O alvo NAO e a temperatura absoluta em t+H, e sim a VARIACAO
     em relacao ao instante atual:  y = T(t+H) - T(t).
     Isso remove o nivel (que percorre 60 C durante o aquecimento),
     melhora muito o condicionamento e faz a linha de base trivial
     (persistencia) equivaler a prever y = 0.                        */
  M.buildDataset = function (rows, opts) {
    opts = opts || {};
    if (typeof opts === 'number') opts = { horizon: opts };
    var H = opts.horizon || 300;
    var skipWarmup = opts.skipWarmup !== false;
    var ts = rows.map(function (d) { return d.t; });
    var ys = rows.map(function (d) { return d.tHotIn; });
    var t0 = rows.length ? rows[0].t : 0;
    var X = [], y = [], at = [], now = [], base = [], nWarm = 0;

    for (var i = 0; i < rows.length; i++) {
      var d = rows[i];
      var tTarget = d.t + H;
      if (tTarget > ts[ts.length - 1]) break;                 // sem alvo conhecido
      var target = U.interp(ts, ys, tTarget);
      if (!isFinite(target) || !isFinite(d.tHotIn)) continue;

      /* o aquecimento a frio e um transitorio unico por sessao: nao
         representa o regime que o sistema precisa antecipar */
      if (skipWarmup && d.warmup) { nWarm++; continue; }

      var f = [
        d.ectSmooth !== undefined && isFinite(d.ectSmooth) ? d.ectSmooth : d.tHotIn,
        slope(rows, i, 'ectSmooth', 60),
        slope(rows, i, 'ectSmooth', 180),
        d.tHotIn - (isFinite(d.tAmb) ? d.tAmb : 25),
        (winMean(rows, i, 'rpm', 60) || 0) / 1000,
        winMean(rows, i, 'speed', 60) || 0,
        winMean(rows, i, 'load', 60) || 0,
        isFinite(d.iat) ? d.iat : 30,
        isFinite(d.tAmb) ? d.tAmb : 25,
        Math.min((d.t - t0) / 60, 60),
        winMean(rows, i, 'fan', 120) || 0,
        (winMean(rows, i, 'q', 60) || 0) / 1000,
        winMean(rows, i, 'eps', 60) || 0,
        isFinite(d.tStatFrac) ? d.tStatFrac : 0,
        (winMean(rows, i, 'qGen', 60) || 0) / 1000,
        (winMean(rows, i, 'qNet', 60) || 0) / 1000,
        winMean(rows, i, 'dTdtModel', 60) || 0,
        physDelta(rows, i, H)
      ];
      if (f.some(function (v) { return !isFinite(v); })) continue;
      X.push(f);
      y.push(target - d.tHotIn);            // alvo: variacao em H segundos
      base.push(d.tHotIn);                  // temperatura no instante atual
      at.push(tTarget); now.push(d.t);
    }
    return {
      X: X, y: y, base: base, tTarget: at, tNow: now,
      horizon: H, names: M.FEATURES, nWarmupSkipped: nWarm, skipWarmup: skipWarmup
    };
  };

  /* ---------- resolve A w = b (eliminacao de Gauss com pivotamento) ---------- */
  function solve(A, b) {
    var n = b.length;
    var m = A.map(function (r, i) { return r.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      if (Math.abs(m[piv][c]) < 1e-12) return null;
      var tmp = m[c]; m[c] = m[piv]; m[piv] = tmp;
      for (var r2 = c + 1; r2 < n; r2++) {
        var fac = m[r2][c] / m[c][c];
        if (!fac) continue;
        for (var k = c; k <= n; k++) m[r2][k] -= fac * m[c][k];
      }
    }
    var w = new Array(n).fill(0);
    for (var i2 = n - 1; i2 >= 0; i2--) {
      var sum = m[i2][n];
      for (var j2 = i2 + 1; j2 < n; j2++) sum -= m[i2][j2] * w[j2];
      w[i2] = sum / m[i2][i2];
    }
    return w;
  }

  /* ---------- ajuste ridge com padronizacao e trava de extrapolacao ----------
     CLIP: no momento da previsao, cada variavel padronizada e limitada
     a +/- CLIP desvios. Sem isso, um regime nunca visto no treino
     (por exemplo um congestionamento severo) leva o modelo linear a
     extrapolar sem limite e produzir erros de dezenas de graus.        */
  var CLIP = 3.0;

  function fitRidge(Xtr, ytr, lambda) {
    var n = Xtr.length, p = n ? Xtr[0].length : 0;
    if (n < 15 || !p) return null;

    var mu = [], sd = [];
    for (var j = 0; j < p; j++) {
      var col = Xtr.map(function (r) { return r[j]; });
      mu[j] = U.mean(col);
      sd[j] = U.std(col);
      if (!isFinite(sd[j]) || sd[j] < 1e-9) sd[j] = 1;
      if (!isFinite(mu[j])) mu[j] = 0;
    }
    var z = function (r) {
      return r.map(function (v, k) { return U.clamp((v - mu[k]) / sd[k], -CLIP, CLIP); });
    };
    var Ztr = Xtr.map(z);
    var yMu = U.mean(ytr);

    var A = [], b = [];
    for (var a = 0; a < p; a++) { A[a] = new Array(p).fill(0); b[a] = 0; }
    for (var i = 0; i < n; i++) {
      var zi = Ztr[i], yi = ytr[i] - yMu;
      for (var r1 = 0; r1 < p; r1++) {
        b[r1] += zi[r1] * yi;
        for (var c1 = r1; c1 < p; c1++) A[r1][c1] += zi[r1] * zi[c1];
      }
    }
    for (var r3 = 0; r3 < p; r3++) {
      for (var c3 = 0; c3 < r3; c3++) A[r3][c3] = A[c3][r3];
      A[r3][r3] += lambda * n / 100;
    }
    var w = solve(A, b);
    if (!w) return null;

    return {
      w: w, mu: mu, sd: sd, yMu: yMu, lambda: lambda, n: n,
      predict: function (row) {
        var zz = z(row), acc = yMu;
        for (var k = 0; k < p; k++) acc += w[k] * zz[k];
        return acc;
      }
    };
  }

  /* ---------- metricas, sempre em temperatura absoluta (C) ----------
     y e a VARIACAO prevista; base e a temperatura no instante atual.
     Como o erro da variacao e igual ao erro do valor absoluto, o MAE
     abaixo pode ser comparado direto com o critério do projeto.      */
  function metrics(model, Xs, ys, bs, horizon) {
    if (!Xs.length) return { n: 0 };
    var e = [], ae = [], persist = [], lin = [], abs = [];
    for (var i = 0; i < Xs.length; i++) {
      var err = model.predict(Xs[i]) - ys[i];
      e.push(err); ae.push(Math.abs(err));
      abs.push(bs[i] + ys[i]);
      persist.push(Math.abs(ys[i]));                          // prever "continua igual"
      lin.push(Math.abs(Xs[i][1] * (horizon / 60) - ys[i]));  // extrapolar a tendencia atual
    }
    var yMean = U.mean(abs);
    var sse = e.reduce(function (s, v) { return s + v * v; }, 0);
    var sst = abs.reduce(function (s, v) { return s + (v - yMean) * (v - yMean); }, 0);
    return {
      n: Xs.length, mae: U.mean(ae), rmse: Math.sqrt(sse / Xs.length),
      maxErr: U.max(ae), p95: U.percentile(ae, 0.95), bias: U.mean(e),
      r2: sst > 0 ? 1 - sse / sst : NaN,
      maeBase: U.mean(persist), maeLin: U.mean(lin)
    };
  }

  /* ---------- validacao cruzada em blocos contiguos ----------
     Serie temporal nao pode ser embaralhada: as amostras vizinhas
     sao praticamente identicas e o modelo veria o proprio alvo.
     Dividimos a sessao em k blocos contiguos e testamos um por vez.  */
  M.crossval = function (ds, opts) {
    opts = opts || {};
    var k = opts.k || 5;
    var lambdas = opts.lambdas || [1, 3, 10, 30, 80, 200, 500];
    var n = ds.X.length;
    if (n < 80) return { ok: false, reason: 'poucas-amostras', n: n };

    var bounds = [];
    for (var i = 0; i <= k; i++) bounds.push(Math.round(n * i / k));

    var results = lambdas.map(function (lam) {
      var folds = [];
      for (var f = 0; f < k; f++) {
        var a = bounds[f], b = bounds[f + 1];
        var Xtr = ds.X.slice(0, a).concat(ds.X.slice(b));
        var ytr = ds.y.slice(0, a).concat(ds.y.slice(b));
        if (Xtr.length < 30 || b - a < 10) continue;
        var m = fitRidge(Xtr, ytr, lam);
        if (!m) continue;
        folds.push(metrics(m, ds.X.slice(a, b), ds.y.slice(a, b), ds.base.slice(a, b), ds.horizon));
      }
      if (!folds.length) return { lambda: lam, ok: false };
      return {
        lambda: lam, ok: true, nFolds: folds.length,
        mae: U.mean(folds.map(function (x) { return x.mae; })),
        rmse: U.mean(folds.map(function (x) { return x.rmse; })),
        maeWorst: U.max(folds.map(function (x) { return x.mae; })),
        r2: U.mean(folds.map(function (x) { return x.r2; })),
        maeBase: U.mean(folds.map(function (x) { return x.maeBase; })),
        folds: folds
      };
    }).filter(function (r) { return r.ok; });

    if (!results.length) return { ok: false, reason: 'falha-ajuste' };
    var best = results.reduce(function (a, b) { return b.mae < a.mae ? b : a; });
    return { ok: true, k: k, results: results, best: best, lambda: best.lambda };
  };

  /* ---------- treino final ----------
     Reporta duas avaliacoes independentes:
       cv       - validacao cruzada em blocos (usa toda a sessao)
       holdout  - ultimo trecho da sessao, nunca visto no treino
     O modelo entregue e ajustado com todas as amostras.              */
  M.train = function (ds, opts) {
    opts = opts || {};
    var splitFrac = opts.split === undefined ? 0.7 : opts.split;
    var n = ds.X.length;
    if (n < 60) return { ok: false, reason: 'poucas-amostras', n: n };

    /* escolha do fator de regularizacao por validacao cruzada */
    var cv = null, lambda = opts.lambda;
    if (lambda === undefined || lambda === 'auto') {
      cv = M.crossval(ds, { k: opts.k || 5 });
      lambda = cv.ok ? cv.lambda : 30;
    } else if (opts.cv !== false) {
      cv = M.crossval(ds, { k: opts.k || 5, lambdas: [lambda] });
    }

    /* holdout temporal */
    var nTr = U.clamp(Math.floor(n * splitFrac), 30, n - 20);
    var hoModel = fitRidge(ds.X.slice(0, nTr), ds.y.slice(0, nTr), lambda);
    if (!hoModel) return { ok: false, reason: 'sistema-singular' };
    var ho = metrics(hoModel, ds.X.slice(nTr), ds.y.slice(nTr), ds.base.slice(nTr), ds.horizon);
    var trM = metrics(hoModel, ds.X.slice(0, nTr), ds.y.slice(0, nTr), ds.base.slice(0, nTr), ds.horizon);

    /* modelo final com a sessao inteira */
    var full = fitRidge(ds.X, ds.y, lambda);
    if (!full) return { ok: false, reason: 'sistema-singular' };

    var weights = ds.names.map(function (f, j) {
      return { key: f.key, label: f.label, unit: f.unit, w: full.w[j], abs: Math.abs(full.w[j]) };
    }).sort(function (a, b) { return b.abs - a.abs; });

    /* metrica principal: media da validacao cruzada (mais estavel e
       honesta que um unico corte, com uma sessao so de dados)        */
    var main = cv && cv.ok ? cv.best : ho;

    return {
      ok: true, lambda: lambda, cv: cv, clip: CLIP,
      nTrain: nTr, nTest: n - nTr, n: n,
      splitTime: ds.tNow[nTr] || null,
      predict: full.predict, w: full.w, weights: weights,
      horizon: ds.horizon,
      test: { mae: main.mae, rmse: main.rmse, r2: main.r2, maeBase: main.maeBase,
              maeLin: ho.maeLin, p95: ho.p95, maxErr: ho.maxErr, bias: ho.bias,
              n: main.n || ho.n, source: cv && cv.ok ? 'cv' : 'holdout' },
      holdout: ho, train: trM,
      series: ds.X.map(function (r, i) {
        var dlt = full.predict(r);
        return {
          tNow: ds.tNow[i], tTarget: ds.tTarget[i],
          pred: ds.base[i] + dlt, real: ds.base[i] + ds.y[i],
          delta: dlt, now: ds.base[i], isTest: i >= nTr
        };
      })
    };
  };

  /* ---------- criterio de aprovacao tecnica do projeto ---------- */
  M.verdict = function (fit, target) {
    var lim = target === undefined ? 2.0 : target;
    if (!fit || !fit.ok) return { pass: false, txt: 'Modelo não treinado' };
    var mae = fit.test.mae;
    var better = fit.test.maeBase > 0 ? (1 - mae / fit.test.maeBase) * 100 : 0;
    return {
      pass: mae <= lim,
      mae: mae, lim: lim, better: better,
      txt: mae <= lim
        ? 'APROVADO — MAE de ' + U.br(mae, 2) + ' °C (critério ≤ ' + U.br(lim, 1) + ' °C)'
        : 'REPROVADO — MAE de ' + U.br(mae, 2) + ' °C excede o critério de ' + U.br(lim, 1) + ' °C'
    };
  };

  /* ============================================================
     Deteccao de anomalias
     1) queda sustentada do indice de saude UA_exp/UA_modelo
     2) aquecimento durante condicao que deveria refrigerar
     3) efetividade fora da faixa esperada pelo modelo (z-robusto)
     ============================================================ */
  M.anomalies = function (proc, opts) {
    opts = opts || {};
    var rows = proc.rows;
    /* O indice de saude compara UA medido com UA teorico. Sem calibracao
       contra uma coleta de referencia, o UA teorico carrega o vies das
       correlacoes e um limiar absoluto produziria falso positivo. */
    var calibrated = !!(proc.params && proc.params.uaCalibrated);
    var healthLim = opts.healthLim === undefined ? 0.80 : opts.healthLim;
    var minDur = opts.minDur === undefined ? 45 : opts.minDur;
    var zLim = opts.zLim === undefined ? 3.0 : opts.zLim;

    var valid = rows.filter(function (d) { return d.healthValid; });
    var hv = valid.map(function (d) { return d.health; }).filter(isFinite).sort(function (a, b) { return a - b; });
    var med = hv.length ? hv[Math.floor(hv.length / 2)] : NaN;
    var mad = hv.length ? U.percentile(hv.map(function (v) { return Math.abs(v - med); }), 0.5) : NaN;
    var sigma = isFinite(mad) && mad > 1e-6 ? mad * 1.4826 : U.std(hv);

    var flags = rows.map(function (d) {
      var f = [];
      if (d.healthValid) {
        var hs = isFinite(d.healthSmooth) ? d.healthSmooth : d.health;
        if (calibrated && hs < healthLim) f.push('saude');
        if (isFinite(sigma) && sigma > 1e-6 && (d.health - med) / sigma < -zLim) f.push('desvio');
      }
      if (d.speed > 60 && d.dTdt > 2.5 && d.tHotIn > 95) f.push('aquecimento');
      if (d.fan >= 0.5 && d.dTdt > 3 && d.tHotIn > 98) f.push('ventilador');
      return f;
    });

    /* agrupa flags consecutivas em eventos */
    var events = [], cur = null;
    for (var i = 0; i < rows.length; i++) {
      if (flags[i].length) {
        if (!cur) cur = { i0: i, i1: i, t0: rows[i].t, t1: rows[i].t, kinds: {} };
        cur.i1 = i; cur.t1 = rows[i].t;
        flags[i].forEach(function (k) { cur.kinds[k] = (cur.kinds[k] || 0) + 1; });
      } else if (cur) {
        if (rows[i].t - cur.t1 > 10) { events.push(cur); cur = null; }
      }
    }
    if (cur) events.push(cur);

    var KIND = {
      saude: 'Perda de desempenho do radiador (UA abaixo do previsto)',
      desvio: 'Efetividade estatisticamente fora do padrão da sessão',
      aquecimento: 'Aquecimento com o veículo em velocidade de rodovia',
      ventilador: 'Aquecimento com ventilador acionado'
    };

    var out = events.filter(function (e) { return e.t1 - e.t0 >= minDur; }).map(function (e) {
      var seg = rows.slice(e.i0, e.i1 + 1);
      var kinds = Object.keys(e.kinds).sort(function (a, b) { return e.kinds[b] - e.kinds[a]; });
      var h = U.mean(seg.map(function (d) { return d.healthSmooth; }).filter(isFinite));
      return {
        t0: e.t0, t1: e.t1, dur: e.t1 - e.t0,
        kind: kinds[0], kinds: kinds,
        desc: KIND[kinds[0]] || kinds[0],
        health: h,
        eps: U.mean(seg.map(function (d) { return d.eps; }).filter(isFinite)),
        epsModel: U.mean(seg.map(function (d) { return d.epsModel; }).filter(isFinite)),
        ect: U.max(seg.map(function (d) { return d.tHotIn; })),
        regime: seg[Math.floor(seg.length / 2)].regime,
        sev: (isFinite(h) && h < 0.65) || kinds.indexOf('aquecimento') >= 0 ? 'alta'
           : (isFinite(h) && h < healthLim ? 'media' : 'baixa')
      };
    });

    return {
      events: out, healthMedian: med, healthSigma: sigma,
      nValid: valid.length, healthLim: healthLim, calibrated: calibrated
    };
  };

  /* ============================================================
     Alertas: cruzamento previsto e real dos limites
     ============================================================ */
  M.alerts = function (proc, fit, p) {
    var rows = proc.rows;
    var tCrit = p.tCrit, tWarn = p.tWarn, leadReq = p.leadReq;
    var list = [];

    /* --- alerta preditivo: previsao ultrapassa o limite --- */
    var predByT = {};
    if (fit && fit.ok) {
      fit.series.forEach(function (s) { predByT[Math.round(s.tNow)] = s; });
    }
    var openPred = null, openWarn = null;
    rows.forEach(function (d) {
      var s = predByT[Math.round(d.t)];
      if (s) {
        if (s.pred >= tCrit && !openPred) {
          openPred = { t: d.t, kind: 'pred-crit', lvl: 'crit', ect: d.tHotIn, pred: s.pred, tTarget: s.tTarget };
          list.push(openPred);
        } else if (s.pred < tCrit - 1 && openPred) { openPred.tEnd = d.t; openPred = null; }

        if (s.pred >= tWarn && s.pred < tCrit && !openWarn && !openPred) {
          openWarn = { t: d.t, kind: 'pred-warn', lvl: 'warn', ect: d.tHotIn, pred: s.pred, tTarget: s.tTarget };
          list.push(openWarn);
        } else if (s.pred < tWarn - 1 && openWarn) { openWarn.tEnd = d.t; openWarn = null; }
      }
    });

    /* --- cruzamentos reais --- */
    var crossings = [];
    for (var i = 1; i < rows.length; i++) {
      if (rows[i - 1].tHotIn < tCrit && rows[i].tHotIn >= tCrit) {
        crossings.push({ t: rows[i].t, lvl: 'crit', ect: rows[i].tHotIn });
        list.push({ t: rows[i].t, kind: 'real-crit', lvl: 'crit', ect: rows[i].tHotIn });
      } else if (rows[i - 1].tHotIn < tWarn && rows[i].tHotIn >= tWarn) {
        list.push({ t: rows[i].t, kind: 'real-warn', lvl: 'warn', ect: rows[i].tHotIn });
      }
    }

    /* --- antecedencia conseguida em cada cruzamento real --- */
    var leads = crossings.map(function (cr) {
      var first = null;
      list.forEach(function (a) {
        if (a.kind !== 'pred-crit') return;
        if (a.t <= cr.t && (first === null || a.t < first)) first = a.t;
      });
      return { t: cr.t, lead: first === null ? null : cr.t - first };
    });

    list.sort(function (a, b) { return a.t - b.t; });
    var withLead = leads.filter(function (l) { return l.lead !== null; });
    return {
      list: list,
      crossings: crossings,
      leads: leads,
      leadMean: withLead.length ? U.mean(withLead.map(function (l) { return l.lead; })) : NaN,
      leadMin: withLead.length ? U.min(withLead.map(function (l) { return l.lead; })) : NaN,
      leadReq: leadReq,
      passLead: withLead.length > 0 && U.min(withLead.map(function (l) { return l.lead; })) >= leadReq,
      nPred: list.filter(function (a) { return a.kind === 'pred-crit'; }).length,
      nReal: crossings.length,
      /* alerta emitido sem cruzamento real = falso positivo (conservador, mas contabilizado) */
      falsePos: list.filter(function (a) {
        return a.kind === 'pred-crit' && !crossings.some(function (cr) { return cr.t >= a.t && cr.t <= a.t + p.horizon * 1.5; });
      }).length
    };
  };

  ATC.Model = M;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
