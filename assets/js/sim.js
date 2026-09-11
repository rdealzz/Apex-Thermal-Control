/* ============================================================
   APEX SPEED MODE — simulacao de bancada
   ------------------------------------------------------------
   Ficcao inteira, e assumida como tal em cada tela. O que ela nao
   e: numeros aleatorios. Cada grandeza sai de um estado unico que
   avanca no tempo, entao mexer numa coisa move todas as outras
   pela cadeia certa — subir a pressao enche o coletor, o coletor
   pede combustivel, o bico sobe de ciclo de trabalho, o ar entra
   mais quente, a agua sobe atras e a detonacao fica mais provavel.

   Duas coisas fazem a tela parecer viva em vez de parada:

   1. Um piloto virtual. Ninguem fica com o dedo no acelerador o
      tempo todo, entao quando o pedal esta livre e um gerador de
      ciclo de conducao que comanda — acelera, troca de marcha,
      cruza, alivia. O painel nunca fica congelado.
   2. Oscilacao com forma. Ruido branco parece chuvisco; o que
      instrumento de verdade mostra e ondulacao lenta com umas
      poucas frequencias somadas. Cada canal tem as suas, entao
      as agulhas respiram em ritmos diferentes e nenhuma repete a
      outra.

   A temperatura da agua nao precisa de ruido nenhum: com
   termostato e ventoinha com histerese ela oscila sozinha, que e
   exatamente o que ela faz num carro parado no transito.

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
    /* turbo e transmissao */
    boostTarget: 0.8,      // bar
    wgDuty: 45,            // % de ciclo da valvula de alivio
    launchRpm: 4200,       // rpm de saida
    gear: 3,
    boostByGear: [0.5, 0.7, 0.9, 1.0, 1.0, 1.0],   // fator por marcha
    tps: 0,                // 0..100, comandado pelo pedal virtual

    /* mistura */
    afrTarget: 12.6,       // :1
    fuelTrim: 0,           // % de enriquecimento global (+ enriquece)
    railBase: 3.0,         // bar de base no trilho

    /* admissao */
    ambT: 28,              // °C do ar que entra no filtro
    icEff: 62,             // % de eficiencia do intercooler
    intakeRestr: 12,       // % de restricao do filtro e dutos

    /* arrefecimento */
    thermo: 92,            // °C de abertura do termostato
    fanOn: 101,            // °C que liga a ventoinha
    radCap: 100,           // % da capacidade do radiador

    /* piloto virtual */
    auto: true
  };

  /* ---------- o que evolui no tempo ---------- */
  var st = {
    rpm: IDLE, rpmV: 0,
    boost: 0, map: P_ATM * 100,
    tpsSm: 0,
    iat: 32, ect: 88, oil: 2.4, fuelReal: 3.0, fuelTarget: 3.0,
    lambda: 1, afr: 14.7, afrCmd: 12.6,
    knock: 0, knockCount: 0,
    battery: 13.9,
    duty: 8, inj: [8, 8, 8, 8],
    power: 0, torque: 0,
    fan: false, thermoOpen: 0,
    limiter: false, launch: false, popcorn: 0,
    phase: 'marcha lenta', manual: false,
    t: 0
  };

  var rnd = U.rng ? U.rng(20260910) : Math.random;
  function noise(a) { return (rnd() - 0.5) * 2 * a; }

  /* ============================================================
     Ondulacao com forma
     ------------------------------------------------------------
     Tres senoides de periodos que nao fecham entre si: o resultado
     nunca se repete de forma perceptivel, mas e continuo, derivavel
     e igual em toda recarga — nada pisca de um quadro para o outro
     como ruido sorteado faria.
     ============================================================ */
  var WAVE = [
    [0.37, 1.10, 2.90, 0.0, 1.7, 4.1],   // 0 marcha lenta
    [0.21, 0.63, 1.70, 2.3, 5.1, 0.6],   // 1 ar de admissao
    [0.17, 0.49, 1.31, 4.7, 2.2, 3.3],   // 2 agua
    [0.90, 2.30, 6.10, 1.2, 3.8, 5.5],   // 3 tensao
    [0.44, 1.37, 3.70, 3.1, 0.4, 2.8],   // 4 oleo
    [1.20, 3.10, 7.90, 5.9, 4.4, 1.1],   // 5 sonda lambda
    [0.29, 0.87, 2.20, 2.6, 1.3, 6.0],   // 6 ciclo de conducao
    [0.61, 1.90, 4.30, 0.8, 5.7, 2.0]    // 7 coletor
  ];
  function wave(i, t) {
    var w = WAVE[i];
    return Math.sin(t * w[0] + w[3]) * 0.60 +
           Math.sin(t * w[1] + w[4]) * 0.29 +
           Math.sin(t * w[2] + w[5]) * 0.11;
  }

  /* ============================================================
     Piloto virtual
     ------------------------------------------------------------
     Maquina de fases curta. Nao tenta ser um modelo de transito:
     tenta so garantir que a tela tenha sempre alguma coisa
     acontecendo, e que o que acontece seja a mesma cadeia fisica
     que o pedal manual dispara.
     ============================================================ */
  var drv = { phase: 'idle', left: 2.0, goal: 0, since: 0 };
  var PHASE_PT = {
    idle: 'marcha lenta', accel: 'acelerando', cruise: 'cruzeiro',
    lift: 'alivio', pull: 'retomada'
  };

  function nextPhase() {
    var r = rnd();
    if (drv.phase === 'idle') {
      drv.phase = r < 0.65 ? 'accel' : 'pull';
      drv.left = 3.0 + rnd() * 3.5;
      drv.goal = 55 + rnd() * 45;
    } else if (drv.phase === 'accel' || drv.phase === 'pull') {
      drv.phase = r < 0.62 ? 'cruise' : 'lift';
      drv.left = drv.phase === 'cruise' ? 5.0 + rnd() * 7.0 : 1.6 + rnd() * 2.0;
      drv.goal = drv.phase === 'cruise' ? 16 + rnd() * 26 : 0;
    } else if (drv.phase === 'cruise') {
      drv.phase = r < 0.45 ? 'pull' : (r < 0.8 ? 'lift' : 'accel');
      drv.left = 2.4 + rnd() * 3.6;
      drv.goal = drv.phase === 'lift' ? 0 : 45 + rnd() * 50;
    } else {
      drv.phase = r < 0.35 ? 'idle' : 'pull';
      drv.left = drv.phase === 'idle' ? 2.0 + rnd() * 3.0 : 2.5 + rnd() * 3.0;
      drv.goal = drv.phase === 'idle' ? 0 : 50 + rnd() * 45;
    }
  }

  function drive(dt) {
    drv.left -= dt;
    if (drv.left <= 0) nextPhase();
    st.phase = PHASE_PT[drv.phase] || drv.phase;
    /* a mao no acelerador nao e firme: o alvo respira junto */
    var jit = drv.goal > 0 ? wave(6, st.t) * (drv.phase === 'cruise' ? 5 : 9) : 0;
    ctl.tps = U.clamp(drv.goal + jit, 0, 100);

    /* cambio automatico: sobe perto do corte, desce quando afoga */
    if (st.rpm > 6250 && ctl.gear < 6 && st.tpsSm > 30) {
      ctl.gear++;
      st.rpm *= 0.72; st.rpmV *= 0.4;
      st.shifted = st.t;
    } else if (st.rpm < 1450 && ctl.gear > 1) {
      ctl.gear--;
      st.rpm *= 1.28;
      st.shifted = st.t;
    }
  }

  /* quanto de rotacao cada marcha alcanca no mesmo pedal */
  var GEAR_SPAN = [1.0, 0.985, 0.965, 0.94, 0.915, 0.885];

  /* ============================================================
     Um passo da simulacao
     ============================================================ */
  SIM.tick = function (dt) {
    dt = Math.min(dt || 1 / 60, 0.05);
    st.t += dt;

    /* --- quem manda no pedal --- */
    if (st.manualUntil && st.t > st.manualUntil) { st.manualUntil = 0; st.manual = false; }
    if (ctl.auto && !st.manual && !ctl.launchActive) drive(dt);
    else if (!ctl.auto) st.phase = st.manual ? 'pedal' : 'em espera';

    /* --- pedal: o acelerador tem massa, nao pula --- */
    var tpsGoal = ctl.launchActive ? 100 : ctl.tps;
    st.tpsSm += (tpsGoal - st.tpsSm) * Math.min(1, dt * 9);

    /* --- rotacao: mola com inercia, corte no limitador --- */
    var loadFrac = st.tpsSm / 100;
    var span = GEAR_SPAN[U.clamp(ctl.gear, 1, 6) - 1];
    /* na lenta a rotacao nao fica cravada: ela caca o alvo */
    var idleHunt = IDLE + wave(0, st.t) * 34 + (ctl.ambT > 34 ? 25 : 0);
    var rpmGoal = ctl.launchActive
      ? ctl.launchRpm
      : idleHunt + (CUT - IDLE) * Math.pow(loadFrac, 0.75) * span;
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

    /* --- admissao: restricao tira enchimento, e o que sobra vira calor --- */
    var restr = U.clamp(ctl.intakeRestr, 0, 60) / 100;
    var ve = 1 - restr * 0.42;                   // enchimento volumetrico relativo

    /* --- pressao: o turbo tem atraso e depende de rotacao e pedal --- */
    var gearF = ctl.boostByGear[U.clamp(ctl.gear, 1, 6) - 1];
    var spool = U.clamp((st.rpm - 1900) / 2200, 0, 1);
    var wg = U.clamp(ctl.wgDuty / 100, 0, 1);
    var reach = ctl.boostTarget * gearF * (0.55 + 0.45 * wg) * spool * loadFrac * ve;
    /* enche rapido, alivia devagar: a valvula abre mais facil do que
       a turbina acelera                                            */
    var k = reach > st.boost ? 2.6 : 4.2;
    st.boost += (reach - st.boost) * Math.min(1, dt * k);
    st.boost = Math.max(st.boost, -0.15 * (1 - loadFrac));   // vacuo em desaceleracao
    /* o coletor pulsa: cada cilindro que admite puxa a coluna de ar */
    st.map = (P_ATM + st.boost) * 100 + wave(7, st.t) * (0.7 + 1.5 * loadFrac);

    /* --- ar de admissao: comprimir aquece, o intercooler devolve --- */
    var comp = 62 * Math.max(st.boost, 0);                   // aquecimento da compressao
    var ic = U.clamp(ctl.icEff, 0, 95) / 100;
    var iatGoal = ctl.ambT + comp * (1 - ic * 0.88) + 4 * loadFrac + restr * 14
                + Math.max(st.ect - 95, 0) * 0.12            // calor do vao do motor
                + wave(1, st.t) * 0.8;
    st.iat += (iatGoal - st.iat) * Math.min(1, dt * 0.7);

    /* --- agua: termostato e ventoinha com histerese --- */
    var heat = (0.38 + 1.85 * loadFrac * (1 + Math.max(st.boost, 0))) *
               (1 + Math.max(st.iat - 30, 0) / 240);
    st.thermoOpen = U.clamp((st.ect - ctl.thermo) / 6, 0, 1);
    if (st.ect > ctl.fanOn) st.fan = true;
    else if (st.ect < ctl.fanOn - 4) st.fan = false;         // a histerese e o que faz oscilar
    var rad = U.clamp(ctl.radCap, 20, 130) / 100;
    var cool = 0.10 + rad * st.thermoOpen *
               (0.42 + 0.78 * U.clamp(st.rpm / 5000, 0, 1.4) + (st.fan ? 0.95 : 0));
    st.ect += (heat - cool) * dt * 5.5 + wave(2, st.t) * dt * 0.6;
    st.ect = U.clamp(st.ect, Math.min(ctl.ambT + 4, 70), 132);

    /* --- combustivel: o trilho acompanha o coletor --- */
    st.fuelTarget = ctl.railBase + Math.max(st.boost, 0);
    var lag = st.fuelTarget - st.fuelReal;
    st.fuelReal += lag * Math.min(1, dt * 6) + noise(0.012);
    /* ondulacao da bomba, presa a rotacao: e o que da vida ao grafico */
    st.fuelReal += Math.sin(st.t * (18 + st.rpm / 260)) * 0.022 * (0.4 + loadFrac);

    /* --- mistura: alvo, mais o que o hardware consegue entregar ---
       o trim desloca o alvo inteiro; o trilho fraco entrega menos
       combustivel pelo mesmo tempo de bico, entao empobrece sozinho */
    var railF = Math.sqrt(3.0 / U.clamp(st.fuelReal, 1.2, 7));
    var cmd = ctl.afrTarget * (1 - U.clamp(ctl.fuelTrim, -25, 25) / 100) * railF;
    /* bico saturado nao entrega o que foi pedido: a mistura abre */
    if (st.duty > 100) cmd += (st.duty - 100) * 0.07;
    st.afrCmd = U.clamp(cmd, 9, 20);
    /* a sonda de banda estreita nunca para quieta: ela busca em torno
       do alvo, e em carga parcial esse vaivem e maior              */
    var swing = (1 - loadFrac * 0.75) * 0.26;
    st.afr += (st.afrCmd - st.afr) * Math.min(1, dt * 3.5);
    st.afr += (wave(5, st.t) * swing - (st.afr - st.afrCmd) * 0.02) * dt * 6 + noise(0.02);
    st.lambda = st.afr / 14.7;

    /* --- bicos: ciclo de trabalho pela massa de ar sobre a mistura --- */
    var airMass = (st.map / 101.3) * (st.rpm / 6000) * ve;
    /* a constante e calibrada para o bico saturar perto de 2 bar, nao
       em 0,8: se ele satura no primeiro preset, subir a pressao
       depois nao muda mais nada e a cadeia perde a graca         */
    var demanda = airMass * (14.7 / Math.max(st.afrCmd, 8)) * 30 * (0.25 + 0.75 * loadFrac);
    demanda *= Math.sqrt(3.0 / U.clamp(st.fuelReal, 1.2, 7));
    st.duty = U.clamp(demanda, 3, 119);
    for (var i = 0; i < 4; i++) {
      /* cada bico tem seu desvio: bancada nenhuma e perfeita */
      st.inj[i] = U.clamp(st.duty * (1 + [0.012, -0.008, 0.004, -0.016][i]) + noise(0.5), 0, 125);
    }

    /* --- detonacao: pressao alta com mistura pobre e o caminho --- */
    var risco = Math.max(0, st.boost - 0.55) * 2.2 + Math.max(0, st.afr - 13.2) * 0.55
              + Math.max(0, st.iat - 58) * 0.02 + Math.max(0, st.ect - 108) * 0.03;
    st.knock = U.clamp(risco * loadFrac, 0, 1);
    if (st.knock > 0.45 && rnd() < st.knock * dt * 9) st.knockCount++;

    /* --- resto do barramento --- */
    st.oil = U.clamp(1.1 + 3.3 * (st.rpm / CUT) - 0.15 * Math.max(st.ect - 100, 0) / 10, 0.4, 7.5)
           + wave(4, st.t) * 0.05;
    st.battery = 13.9 - 0.5 * loadFrac - (st.fan ? 0.22 : 0) + wave(3, st.t) * 0.09 + noise(0.02);

    /* --- potencia: usa os mapas da bancada quando existirem --- */
    var airPenalty = 1 - U.clamp((st.iat - 35) * 0.0024, 0, 0.28);
    if (ATC.Tune) {
      var e = ATC.Tune.engine(U.clamp(st.rpm, 800, 6400), U.clamp(20 + st.tpsSm * 0.8, 20, 100));
      st.torque = e.torque * (1 + Math.max(st.boost, 0) * 0.55) * (1 - st.knock * 0.35) * airPenalty * ve;
    } else {
      st.torque = 150 * (1 + Math.max(st.boost, 0)) * loadFrac * airPenalty * ve;
    }
    st.power = st.torque * st.rpm / 7121;
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
  /* o pedal manual tem prioridade, e o piloto so volta depois de um
     tempinho — senao ele arranca o carro da sua mao no mesmo quadro */
  SIM.blip = function (on) {
    st.manual = !!on;
    ctl.tps = on ? 100 : 0;
    st.manualUntil = on ? 0 : st.t + 1.4;
  };
  SIM.throttle = function (pct) {
    st.manual = true;
    st.manualUntil = st.t + 1.4;
    ctl.tps = U.clamp(pct, 0, 100);
  };
  SIM.launch = function (on) {
    ctl.launchActive = !!on;
    if (!on) ctl.tps = 0;
  };
  SIM.auto = function (on) {
    ctl.auto = !!on;
    if (!ctl.auto) { ctl.tps = 0; st.manual = false; }
    return ctl.auto;
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
      { id: 'amb',  l: 'AMBIENT',    v: ctl.ambT,     u: '°C',    d: 0, max: 55 },
      { id: 'iat',  l: 'IAT',        v: st.iat,       u: '°C',    d: 0, max: 110, warn: st.iat > 65 },
      { id: 'ect',  l: 'ECT',        v: st.ect,       u: '°C',    d: 0, max: 130, warn: st.ect > 105 },
      { id: 'fan',  l: 'FAN',        v: st.fan ? 1 : 0, u: '',    d: 0, max: 1 },
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
