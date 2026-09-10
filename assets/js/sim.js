/* ============================================================
   APEX SPEED MODE — simulacao de bancada
   ------------------------------------------------------------
   Ficcao inteira, e assumida como tal em cada tela. O que ela nao
   e: numeros aleatorios. Cada grandeza sai de um estado unico que
   avanca no tempo, entao mexer numa coisa move todas as outras
   pela cadeia certa — subir a pressao enche o coletor, o coletor
   pede combustivel, o bico sobe de ciclo de trabalho, o ar entra
   mais quente, a agua sobe atras e a detonacao fica mais provavel.

   E o que faz a diferenca entre parecer um software de preparacao
   e parecer um protetor de tela: nao a quantidade de mostradores,
   e o fato de eles concordarem entre si.

   Nada aqui toca na analise termica do projeto.
   ============================================================ */
(function (ATC) {
  'use strict';

  var SIM = {};
  var U = ATC.U;

  var P_ATM = 1.013;
  var IDLE = 850, REDLINE = 7200, CUT = 7000;

  /* ---------- o que o usuario controla ---------- */
  var ctl = {
    boostTarget: 0.8,      // bar
    afrTarget: 12.6,       // :1
    wgDuty: 45,            // % de ciclo da valvula de alivio
    launchRpm: 4200,       // rpm de saida
    gear: 3,
    boostByGear: [0.5, 0.7, 0.9, 1.0, 1.0, 1.0],   // fator por marcha
    tps: 0,                // 0..100, comandado pelo pedal virtual
    idleUp: false
  };

  /* ---------- o que evolui no tempo ---------- */
  var st = {
    rpm: IDLE, rpmV: 0,
    boost: 0, map: P_ATM * 100,
    tpsSm: 0,
    iat: 32, ect: 88, oil: 2.4, fuelReal: 3.0, fuelTarget: 3.0,
    lambda: 1, afr: 14.7,
    knock: 0, knockCount: 0,
    battery: 13.9,
    duty: 8, inj: [8, 8, 8, 8],
    power: 0, torque: 0,
    limiter: false, launch: false, popcorn: 0,
    t: 0
  };

  var rnd = U.rng ? U.rng(20260910) : Math.random;
  function noise(a) { return (rnd() - 0.5) * 2 * a; }

  /* ============================================================
     Um passo da simulacao
     ============================================================ */
  SIM.tick = function (dt) {
    dt = Math.min(dt || 1 / 60, 0.05);
    st.t += dt;

    /* --- pedal: o acelerador tem massa, nao pula --- */
    var tpsGoal = ctl.launchActive ? 100 : ctl.tps;
    st.tpsSm += (tpsGoal - st.tpsSm) * Math.min(1, dt * 9);

    /* --- rotacao: mola com inercia, corte no limitador --- */
    var loadFrac = st.tpsSm / 100;
    var rpmGoal = ctl.launchActive
      ? ctl.launchRpm
      : IDLE + (CUT - IDLE) * Math.pow(loadFrac, 0.75);
    /* marcha alta segura a subida: rotacao demora mais a crescer */
    var inertia = 2.4 + ctl.gear * 0.9;
    st.rpmV += ((rpmGoal - st.rpm) / inertia - st.rpmV * 2.6) * dt * 6;
    st.rpm += st.rpmV * dt * 60;

    st.limiter = st.rpm >= CUT;
    if (st.limiter) {
      /* corte: a rotacao bate e volta, como um limitador de verdade */
      st.rpm = CUT - Math.abs(noise(120));
      st.rpmV = -Math.abs(st.rpmV) * 0.35;
      st.popcorn = 1;
    }
    st.popcorn = Math.max(0, st.popcorn - dt * 3);
    st.rpm = U.clamp(st.rpm, IDLE * 0.75, REDLINE);

    /* --- pressao: o turbo tem atraso e depende de rotacao e pedal --- */
    var gearF = ctl.boostByGear[U.clamp(ctl.gear, 1, 6) - 1];
    var spool = U.clamp((st.rpm - 1900) / 2200, 0, 1);
    var wg = U.clamp(ctl.wgDuty / 100, 0, 1);
    var reach = ctl.boostTarget * gearF * (0.55 + 0.45 * wg) * spool * loadFrac;
    /* enche rapido, alivia devagar: a valvula abre mais facil do que
       a turbina acelera                                            */
    var k = reach > st.boost ? 2.6 : 4.2;
    st.boost += (reach - st.boost) * Math.min(1, dt * k);
    st.boost = Math.max(st.boost, -0.15 * (1 - loadFrac));   // vacuo em desaceleracao
    st.map = (P_ATM + st.boost) * 100;

    /* --- ar de admissao: comprimir aquece --- */
    var iatGoal = 30 + 46 * Math.max(st.boost, 0) + 4 * loadFrac;
    st.iat += (iatGoal - st.iat) * Math.min(1, dt * 0.7);

    /* --- agua: sobe com carga, desce com o que o radiador tira --- */
    var heat = 0.4 + 1.7 * loadFrac * (1 + Math.max(st.boost, 0));
    var cool = 0.55 + 0.9 * U.clamp(st.rpm / 5000, 0, 1.4);
    st.ect += (heat - cool) * dt * 5.5;
    st.ect = U.clamp(st.ect, 76, 128);

    /* --- combustivel: o trilho acompanha o coletor --- */
    st.fuelTarget = 3.0 + Math.max(st.boost, 0);
    var lag = st.fuelTarget - st.fuelReal;
    st.fuelReal += lag * Math.min(1, dt * 6) + noise(0.012);
    /* ondulacao da bomba, presa a rotacao: e o que da vida ao grafico */
    st.fuelReal += Math.sin(st.t * (18 + st.rpm / 260)) * 0.022 * (0.4 + loadFrac);

    /* --- mistura: persegue o alvo, com o erro que sobra --- */
    st.afr += (ctl.afrTarget - st.afr) * Math.min(1, dt * 3.5) + noise(0.05);
    st.lambda = st.afr / 14.7;

    /* --- bicos: ciclo de trabalho pela massa de ar sobre a mistura --- */
    var airMass = (st.map / 101.3) * (st.rpm / 6000);
    /* a constante e calibrada para o bico saturar perto de 2 bar, nao
       em 0,8: se ele satura no primeiro preset, subir a pressao
       depois nao muda mais nada e a cadeia perde a graca         */
    var demanda = airMass * (14.7 / Math.max(st.afr, 8)) * 30 * (0.25 + 0.75 * loadFrac);
    st.duty = U.clamp(demanda, 3, 119);
    for (var i = 0; i < 4; i++) {
      /* cada bico tem seu desvio: bancada nenhuma e perfeita */
      st.inj[i] = U.clamp(st.duty * (1 + [0.012, -0.008, 0.004, -0.016][i]) + noise(0.5), 0, 125);
    }

    /* --- detonacao: pressao alta com mistura pobre e o caminho --- */
    var risco = Math.max(0, st.boost - 0.55) * 2.2 + Math.max(0, st.afr - 13.2) * 0.55
              + Math.max(0, st.iat - 58) * 0.02;
    st.knock = U.clamp(risco * loadFrac, 0, 1);
    if (st.knock > 0.45 && rnd() < st.knock * dt * 9) st.knockCount++;

    /* --- resto do barramento --- */
    st.oil = U.clamp(1.1 + 3.3 * (st.rpm / CUT) - 0.15 * Math.max(st.ect - 100, 0) / 10, 0.4, 7.5);
    st.battery = 13.9 - 0.5 * loadFrac + noise(0.05);

    /* --- potencia: usa os mapas da bancada quando existirem --- */
    if (ATC.Tune) {
      var e = ATC.Tune.engine(U.clamp(st.rpm, 800, 6400), U.clamp(20 + st.tpsSm * 0.8, 20, 100));
      st.torque = e.torque * (1 + Math.max(st.boost, 0) * 0.55) * (1 - st.knock * 0.35);
      st.power = st.torque * st.rpm / 7121;
    } else {
      st.torque = 150 * (1 + Math.max(st.boost, 0)) * loadFrac;
      st.power = st.torque * st.rpm / 7121;
    }
    return st;
  };

  /* ============================================================
     Leitura e comando
     ============================================================ */
  SIM.read = function () { return st; };
  SIM.ctl = function () { return ctl; };
  SIM.set = function (k, v) {
    if (!(k in ctl)) return ctl;
    ctl[k] = v;
    return ctl;
  };
  SIM.blip = function (on) { ctl.tps = on ? 100 : 0; };
  SIM.throttle = function (pct) { ctl.tps = U.clamp(pct, 0, 100); };
  SIM.launch = function (on) {
    ctl.launchActive = !!on;
    if (!on) ctl.tps = 0;
  };
  SIM.resetKnock = function () { st.knockCount = 0; };

  /* lista de sensores para as telas que mostram o barramento inteiro */
  SIM.sensors = function () {
    return [
      { id: 'rpm',  l: 'RPM',        v: st.rpm,       u: '',      d: 0, max: REDLINE, warn: st.rpm > 6600 },
      { id: 'tps',  l: 'TPS',        v: st.tpsSm,     u: '%',     d: 0, max: 100 },
      { id: 'map',  l: 'MAP',        v: st.map,       u: 'kPa',   d: 0, max: 300 },
      { id: 'boost',l: 'BOOST',      v: st.boost,     u: 'bar',   d: 2, max: 2.2, warn: st.boost > 1.7 },
      { id: 'maf',  l: 'MAF',        v: st.map * st.rpm / 26000, u: 'g/s', d: 1, max: 220 },
      { id: 'iat',  l: 'IAT',        v: st.iat,       u: '°C',    d: 0, max: 110, warn: st.iat > 65 },
      { id: 'ect',  l: 'ECT',        v: st.ect,       u: '°C',    d: 0, max: 130, warn: st.ect > 105 },
      { id: 'lam',  l: 'LAMBDA',     v: st.lambda,    u: 'λ',     d: 3, max: 1.3 },
      { id: 'afr',  l: 'AFR',        v: st.afr,       u: ':1',    d: 1, max: 18, warn: st.afr > 13.4 },
      { id: 'knk',  l: 'KNOCK',      v: st.knockCount, u: 'ev',   d: 0, max: 40, warn: st.knock > 0.45 },
      { id: 'bat',  l: 'BATTERY',    v: st.battery,   u: 'V',     d: 1, max: 15 },
      { id: 'oil',  l: 'OIL PRESS',  v: st.oil,       u: 'bar',   d: 1, max: 8, warn: st.oil < 1.2 },
      { id: 'fp',   l: 'FUEL PRESS', v: st.fuelReal,  u: 'bar',   d: 2, max: 6 },
      { id: 'duty', l: 'INJ DUTY',   v: st.duty,      u: '%',     d: 0, max: 125, warn: st.duty > 92 }
    ];
  };

  SIM.limits = { idle: IDLE, cut: CUT, redline: REDLINE, atm: P_ATM };

  ATC.Sim = SIM;
})(window.ATC = window.ATC || {});
