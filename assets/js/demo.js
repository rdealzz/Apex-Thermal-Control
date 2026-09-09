/* ============================================================
   Apex Thermal Control — gerador de dados de DEMONSTRACAO
   ------------------------------------------------------------
   ATENCAO: estes dados NAO sao medicoes reais. Sao gerados por
   um modelo de capacitancia concentrada do motor acoplado ao
   modelo epsilon-NTU do radiador, com ruido e quantizacao iguais
   aos dos sensores previstos (OBD-II 1 C, DS18B20 0,0625 C).
   Servem para validar o site e a cadeia de calculo antes da
   primeira campanha de coleta no veiculo.
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U, T = ATC.Thermal;
  var D = {};

  D.datasets = [
    {
      id: 'nominal',
      name: 'Coleta 01 — radiador em estado nominal',
      desc: 'Ciclo urbano + rodovia + congestionamento, 30 min. Radiador e eletroventilador íntegros.',
      seed: 20250909,
      tAmb: 28,
      uaScaleSim: 1.00,
      vFanSim: 3.0,
      acOn: true,
      dur: 1800
    },
    {
      id: 'degradado',
      name: 'Coleta 02 — radiador com obstrução de aletas',
      desc: 'Mesmo ciclo, com 45% de perda de UA (aletas obstruídas) e eletroventilador enfraquecido. Cenário de falha para validar a detecção de anomalia.',
      seed: 771203,
      tAmb: 34,
      uaScaleSim: 0.46,
      vFanSim: 0.95,
      acOn: true,
      dur: 1800
    }
  ];

  /* ---------- ciclo de conducao: velocidade em funcao do tempo ---------- */
  function speedAt(t, rand) {
    var v;
    if (t < 120) v = 0;                                              // partida a frio, motor em marcha lenta
    else if (t < 420) {                                              // urbano leve
      v = 32 + 14 * Math.sin(t / 41) + 8 * Math.sin(t / 17);
      if ((t % 95) < 22) v = 0;                                      // semaforo
    } else if (t < 780) {                                            // urbano congestionado
      v = 12 + 10 * Math.sin(t / 23);
      if ((t % 60) < 26) v = 0;
    } else if (t < 810) v = (t - 780) / 30 * 98;                     // entrada na rodovia
    else if (t < 1260) v = 98 + 7 * Math.sin(t / 63) + 3 * Math.sin(t / 11);  // rodovia
    else if (t < 1300) v = 98 * (1 - (t - 1260) / 40);               // desaceleracao
    else if (t < 1590) {                                             // congestionamento severo
      v = 7 + 6 * Math.sin(t / 19);
      if ((t % 48) < 30) v = 0;
    } else v = 38 + 12 * Math.sin(t / 29);                           // saida, urbano
    return Math.max(0, v);
  }

  /* rotacao estimada a partir da velocidade (marchas do Cruze 1.8) */
  function rpmAt(v, accel) {
    if (v < 2) return 780;
    var k = v < 15 ? 70 : v < 30 ? 55 : v < 50 ? 42 : v < 70 ? 32 : v < 90 ? 26 : 22;
    return U.clamp(v * k + Math.max(0, accel) * 900, 780, 5200);
  }

  /* potencia maxima disponivel (1.8 L aspirado, ~104 kW a 6300 rpm) */
  function pMax(rpm) {
    return 104000 * Math.pow(U.clamp(rpm / 6300, 0.05, 1), 0.9);
  }

  /* ---------- simulacao ---------- */
  D.generate = function (id) {
    var cfg = D.datasets.filter(function (d) { return d.id === id; })[0] || D.datasets[0];
    var rand = U.rng(cfg.seed);
    var p = T.defaults();
    p.uaScale = cfg.uaScaleSim;
    p.vFan = cfg.vFanSim;

    var dt = 1, dur = cfg.dur;
    var Cth = 95000;                    // J/K  capacidade termica motor + liquido
    var Tc = cfg.tAmb + 1.5;            // motor frio
    var fan = 0;
    var stoppedFor = 0;
    var raw = [];
    var tStart = Date.now() / 1000 - dur - 3600;   // horario plausivel de coleta

    var vPrev = 0;
    for (var t = 0; t <= dur; t += dt) {
      var v = speedAt(t, rand);
      var accel = (v - vPrev) / 3.6 / dt;          // m/s2
      vPrev = v;
      var rpm = rpmAt(v, accel);
      var load = U.clamp(16 + 0.32 * v + 55 * Math.max(accel, 0) + 3 * U.gauss(rand), 12, 96);

      /* calor rejeitado ao liquido de arrefecimento.
         O termo constante representa o combustivel queimado sem
         producao de trabalho util (marcha lenta e atrito), que e
         a maior parcela com o veiculo parado. */
      var pAc = cfg.acOn ? 1500 : 0;               // W  compressor do ar-condicionado
      var pOut = (load / 100) * pMax(rpm) + pAc;
      var qGen = 1.10 * pOut + 4500;

      /* ar de entrada do radiador: ambiente + encharcamento termico quando parado */
      stoppedFor = v < 5 ? stoppedFor + dt : Math.max(0, stoppedFor - 3 * dt);
      var soak = Math.min(9, stoppedFor / 60 * 3.2);
      /* o condensador do ar-condicionado fica na frente do radiador
         e pre-aquece o ar que entra no nucleo */
      var acHeat = cfg.acOn ? (v < 5 ? 6.5 : 4.0) : 0;
      var tAirIn = cfg.tAmb + soak * 0.45 + acHeat;
      var iat = cfg.tAmb + soak;

      /* eletroventilador com histerese */
      if (Tc >= p.fanOn) fan = 1;
      else if (Tc <= p.fanOff) fan = 0;

      /* --- troca termica no radiador (mesmo modelo da analise) --- */
      var cf = T.coolantFlow(rpm, Tc, p);
      var vRam = p.kRam * (v / 3.6);
      var vFanEff = fan ? p.vFan : 0;
      var vNat = 0.20;                             // conveccao natural com veiculo parado
      var vFace = Math.sqrt(vRam * vRam + vFanEff * vFanEff + vNat * vNat);
      var pa = T.air(tAirIn, p.pAtm);
      var g = T.geom(p);
      var mdotAir = pa.rho * g.aFront * vFace;
      var um = T.uaModel(mdotAir, tAirIn, cf.mdot, Tc, p);
      var Ch = cf.mdot * cf.prop.cp, Cc = mdotAir * pa.cp;
      var Cmin = Math.min(Ch, Cc), Cr = Cmin / Math.max(Ch, Cc, 1e-9);
      var ntu = Cmin > 0 ? um.UA / Cmin : 0;
      var eps = T.epsCrossflow(ntu, Cr);
      var qRad = Math.max(0, eps * Cmin * (Tc - tAirIn));
      var qMisc = 350 + 12 * v;                    // perdas por radiacao/oleo

      /* --- balanco de energia no volume de controle do motor --- */
      Tc += (qGen - qRad - qMisc) / Cth * dt;
      Tc = U.clamp(Tc, cfg.tAmb, 130);

      /* --- temperaturas de mangueira --- */
      var dTrad = Ch > 1 ? qRad / Ch : 0;
      var tOut = Math.max(tAirIn + 2.0, Tc - dTrad);

      raw.push({
        t: t,
        wall: tStart + t,
        ectTrue: Tc,
        tInTrue: Tc - 0.8,                        // sensor externo na mangueira le um pouco menos
        tOutTrue: tOut - 0.6,
        tAmbTrue: cfg.tAmb,
        iatTrue: iat,
        rpm: rpm, speed: v, load: load, fan: fan,
        qGen: qGen, qRad: qRad, eps: eps, ua: um.UA
      });
    }

    /* ---------- aplica resolucao e ruido de cada instrumento ---------- */
    var rows = raw.map(function (r) {
      return {
        t: r.t,
        wall: r.wall,
        ts: new Date(r.wall * 1000),
        ect: U.quant(r.ectTrue + 0.25 * U.gauss(rand), 1),                    // OBD-II: 1 C
        rpm: U.quant(r.rpm + 6 * U.gauss(rand), 0.25),
        speed: U.quant(r.speed, 1),
        load: U.quant(r.load, 0.392157),
        iat: U.quant(r.iatTrue + 0.3 * U.gauss(rand), 1),
        tAmb: U.quant(r.tAmbTrue + 0.2 * U.gauss(rand), 0.0625),
        tIn: U.quant(r.tInTrue + 0.16 * U.gauss(rand), 0.0625),               // DS18B20
        tOut: U.quant(r.tOutTrue + 0.16 * U.gauss(rand), 0.0625),
        fan: r.fan,
        _truth: { eps: r.eps, ua: r.ua, q: r.qRad, qGen: r.qGen }
      };
    });

    /* lacunas de Bluetooth: o ELM327 perde amostras de vez em quando */
    rows = rows.filter(function (r, i) {
      if (i === 0 || i === rows.length - 1) return true;
      var inGap = (r.t > 640 && r.t < 646) || (r.t > 1122 && r.t < 1127);
      return !inGap && rand() > 0.02;
    });

    return {
      rows: rows,
      meta: {
        id: cfg.id, name: cfg.name, desc: cfg.desc, demo: true,
        tAmb: cfg.tAmb, uaScaleSim: cfg.uaScaleSim, vFanSim: cfg.vFanSim,
        vehicle: 'Chevrolet Cruze LT 1.8 (2016) — banco de ensaio',
        truthUa: U.mean(rows.map(function (r) { return r._truth.ua; })),
        truthEps: U.mean(rows.map(function (r) { return r._truth.eps; }))
      }
    };
  };

  /* ---------- exportacao no formato dos apps reais ----------
     Permite exercitar a rotina de importacao com um arquivo que
     tem exatamente o cabecalho do Car Scanner em portugues.      */
  function stamp(d) {
    var p = function (n, w) { return String(n).padStart(w || 2, '0'); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  D.toCsvObd = function (ds) {
    var head = ['Device Time',
      'Temperatura do líquido de arrefecimento(°C)',
      'Rotação do motor(rpm)',
      'Velocidade do veículo(km/h)',
      'Carga calculada do motor(%)',
      'Temperatura do ar de admissão(°C)'];
    var lines = [head.join(';')];
    ds.rows.forEach(function (r) {
      lines.push([
        stamp(r.ts),
        U.num(r.ect, 0).replace('.', ','),
        U.num(r.rpm, 2).replace('.', ','),
        U.num(r.speed, 0),
        U.num(r.load, 1).replace('.', ','),
        U.num(r.iat, 0).replace('.', ',')
      ].join(';'));
    });
    return lines.join('\r\n');
  };

  D.toCsvEsp = function (ds) {
    var lines = ['millis,t_in,t_out,t_amb,fan'];
    ds.rows.forEach(function (r) {
      lines.push([
        Math.round(r.t * 1000),
        U.num(r.tIn, 4), U.num(r.tOut, 4), U.num(r.tAmb, 4), r.fan
      ].join(','));
    });
    return lines.join('\n');
  };

  ATC.Demo = D;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
