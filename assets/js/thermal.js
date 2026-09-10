/* ============================================================
   Apex Thermal Control — nucleo termico
   Metodo efetividade-NTU (escoamento cruzado, ambos os fluidos
   nao-misturados) + balanco de energia em volume de controle.
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U;
  var T = {};

  /* ---------- propriedades: mistura agua/etilenoglicol 50/50 ---------- */
  /* T em graus Celsius. Correlacoes lineares/exponenciais ajustadas
     a tabelas de fabricante na faixa 20-110 C.                        */
  T.coolant = function (Tc) {
    var t = U.clamp(Tc, -20, 130);
    var cp = 3280 + 2.4 * (t - 20);              // J/(kg K)
    var rho = 1082 - 0.75 * (t - 20);            // kg/m3
    var k = 0.385 + 0.0005 * (t - 20);           // W/(m K)
    var mu = 3.8e-3 * Math.exp(-0.0232 * (t - 20)); // Pa s
    return { cp: cp, rho: rho, k: k, mu: mu, Pr: mu * cp / k };
  };

  /* ---------- propriedades do ar (gas ideal + Sutherland) ---------- */
  T.air = function (Ta, P) {
    var t = U.clamp(Ta, -30, 150), Tk = t + 273.15;
    var p = P || 101325;
    var rho = p / (287.05 * Tk);                 // kg/m3
    var cp = 1006 + 0.03 * (t - 20);             // J/(kg K)
    var k = 0.0242 + 7.6e-5 * t;                 // W/(m K)
    var mu = 1.716e-5 * Math.pow(Tk / 273.15, 1.5) * (383.55 / (Tk + 110.4));
    return { cp: cp, rho: rho, k: k, mu: mu, Pr: mu * cp / k };
  };

  /* ---------- efetividade: escoamento cruzado, ambos nao-misturados ----------
     eps = 1 - exp{ (NTU^0.22 / Cr) * [ exp(-Cr * NTU^0.78) - 1 ] }
     Cr -> 0 recai em eps = 1 - exp(-NTU) (um fluido com mudanca de fase). */
  T.epsCrossflow = function (NTU, Cr) {
    if (!(NTU > 0)) return 0;
    if (!(Cr > 1e-6)) return 1 - Math.exp(-NTU);
    var c = U.clamp(Cr, 1e-6, 1);
    var e = 1 - Math.exp((Math.pow(NTU, 0.22) / c) * (Math.exp(-c * Math.pow(NTU, 0.78)) - 1));
    return U.clamp(e, 0, 1);
  };

  /* NTU a partir da efetividade (inversao numerica por bissecao) */
  T.ntuFromEps = function (eps, Cr) {
    if (!(eps > 0)) return 0;
    var lim = T.epsCrossflow(60, Cr);
    if (eps >= lim) return NaN;                 // efetividade fisicamente inatingivel
    var lo = 1e-6, hi = 60, mid = 0;
    for (var i = 0; i < 80; i++) {
      mid = 0.5 * (lo + hi);
      if (T.epsCrossflow(mid, Cr) < eps) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  };

  /* ---------- parametros default: Chevrolet Cruze 1.8 2016 ----------
     Os valores geometricos sao estimativas de projeto e devem ser
     substituidos pela medicao do radiador real (aba Analise termica). */
  T.defaults = function () {
    return {
      // --- geometria do radiador (nucleo) ---
      coreW: 0.620,        // m   largura do nucleo
      coreH: 0.400,        // m   altura do nucleo
      coreD: 0.026,        // m   profundidade do nucleo
      sigma: 0.55,         // -   razao de area livre de escoamento do ar
      areaDens: 1200,      // m2/m3 densidade de area do lado ar
      finEff: 0.85,        // -   eficiencia global da superficie aletada
      nTubes: 34,          // -   numero de tubos planos
      tubeW: 0.018,        // m   largura interna do tubo plano
      tubeH: 0.0018,       // m   altura interna do tubo plano
      wallK: 170,          // W/(m K) condutividade do aluminio
      wallT: 0.0003,       // m   espessura da parede do tubo

      // --- lado ar ---
      kRam: 0.30,          // -   fracao da velocidade do veiculo na face do radiador
      vFan: 3.0,           // m/s velocidade de face adicional com ventilador ligado
      cAir: 0.25,          // -   coeficiente C da correlacao Nu = C Re^m Pr^(1/3)
      uaScale: 1.00,       // -   fator de calibracao do UA teorico (ajustado pelos dados)
      uaCalibrated: 0,     // 0/1 indica se uaScale veio de calibracao contra dados medidos
      mAir: 0.60,          // -   expoente m

      // --- lado liquido ---
      pumpDisp: 0.036,     // L/rev vazao volumetrica por rotacao do motor (bomba + relacao de polias)
      tStatOpen: 87,       // C   inicio de abertura do termostato
      tStatFull: 96,       // C   abertura plena do termostato
      bypassMin: 0.02,     // -   fracao minima de vazao pelo radiador

      // --- mapa termico do motor (1.8 L aspirado, ~104 kW a 6300 rpm) ---
      pEngMax: 104000,     // W   potencia maxima
      rpmMax: 6300,        // rpm rotacao de potencia maxima
      idleHeat: 4500,      // W   calor ao liquido sem trabalho util (marcha lenta, atrito)
      heatFrac: 1.10,      // -   calor ao liquido por unidade de potencia de eixo
      cTh: 95000,          // J/K capacidade termica motor + liquido

      // --- ambiente / fallback ---
      ambFromIat: 3.0,     // C   T_amb = IAT - offset, quando nao houver sensor de ambiente
      pAtm: 101325,        // Pa  pressao atmosferica (Curitiba ~ 92 kPa; ajustar se necessario)

      // --- incerteza dos instrumentos (semi-amplitude do erro, +/-) ---
      uTliq: 0.5,          // C   exatidao do DS18B20 nas mangueiras
      uTobd: 1.0,          // C   resolucao do PID 0105 (1 grau)
      uTamb: 1.0,          // C   exatidao da temperatura do ar de entrada
      uPumpRel: 0.20,      // -   incerteza relativa da vazao da bomba
      uAirRel: 0.25,       // -   incerteza relativa da vazao de ar na face
      uCpRel: 0.02,        // -   incerteza das correlacoes de propriedade

      // --- perda de carga e potencia de acionamento ---
      fjRatio: 4.0,        // -   razao f/j tipica de aletas persianadas
      etaFan: 0.35,        // -   rendimento do conjunto eletroventilador
      etaPump: 0.55,       // -   rendimento da bomba d'agua

      // --- limites de alarme ---
      tCrit: 105,          // C   limite critico do liquido
      tWarn: 100,          // C   limite de atencao
      fanOn: 98,           // C   liga ventilador (usado quando o dado nao vem do scanner)
      fanOff: 92,          // C   desliga ventilador
      horizon: 300,        // s   horizonte de previsao
      leadReq: 120         // s   antecedencia minima exigida do alerta
    };
  };

  /* areas derivadas da geometria */
  T.geom = function (p) {
    var aFront = p.coreW * p.coreH;
    var vCore = aFront * p.coreD;
    var aAir = p.areaDens * vCore;                     // area de troca do lado ar
    var perim = 2 * (p.tubeW + p.tubeH);
    var aTube = p.tubeW * p.tubeH;
    var aCool = p.nTubes * perim * p.coreW;            // area de troca do lado liquido
    var dhAir = 4 * p.sigma * vCore / Math.max(aAir, 1e-9); // diametro hidraulico do canal de ar
    return {
      aFront: aFront, vCore: vCore, aAir: aAir, aCool: aCool,
      dhAir: dhAir, dhCool: 4 * aTube / perim,
      aFlowCool: p.nTubes * aTube
    };
  };

  /* ---------- calor gerado e entregue ao liquido de arrefecimento ----------
     Estimativa a partir do mapa do motor: potencia de eixo pela carga
     e rotacao, mais o termo de marcha lenta. Usada como variavel de
     entrada do modelo de previsao (abordagem hibrida: fisica + dados)
     e para fechar o balanco de energia do volume de controle.        */
  T.heatInput = function (rpm, load, p) {
    if (!isFinite(rpm) || !isFinite(load)) return NaN;
    var pmax = p.pEngMax * Math.pow(U.clamp(rpm / p.rpmMax, 0.05, 1), 0.9);
    var pOut = (U.clamp(load, 0, 100) / 100) * pmax;
    return p.heatFrac * pOut + p.idleHeat;
  };

  /* fracao de vazao que passa pelo radiador (termostato) */
  T.thermostat = function (Tc, p) {
    var x = (Tc - p.tStatOpen) / Math.max(p.tStatFull - p.tStatOpen, 0.1);
    x = U.clamp(x, 0, 1);
    var s = x * x * (3 - 2 * x);                      // smoothstep
    return p.bypassMin + (1 - p.bypassMin) * s;
  };

  /* vazao massica do liquido a partir da rotacao do motor */
  T.coolantFlow = function (rpm, Tc, p) {
    var frac = T.thermostat(Tc, p);
    var vdot = (p.pumpDisp / 1000) * (rpm / 60);      // m3/s (bomba, vazao total)
    var pr = T.coolant(Tc);
    return { mdot: pr.rho * vdot * frac, vdot: vdot * frac, frac: frac, prop: pr };
  };

  /* velocidade de face e vazao massica de ar */
  T.airFlow = function (speedKmh, fanOn, Tamb, p) {
    var vRam = p.kRam * (speedKmh / 3.6);
    /* fanOn aceita 0/1, true/false ou uma fracao. A fracao serve as
       varreduras de "e se": o ventilador nao liga e desliga no meio
       de uma curva sem deixar um degrau que a fisica nao tem.      */
    var vFan = p.vFan * U.clamp(fanOn === true ? 1 : (+fanOn || 0), 0, 1);
    /* composicao sub-aditiva: o ventilador nao soma linearmente ao ram-air */
    var vFace = Math.sqrt(vRam * vRam + vFan * vFan);
    var pr = T.air(Tamb, p.pAtm);
    var g = T.geom(p);
    return {
      vFace: vFace, mdot: pr.rho * g.aFront * vFace, prop: pr, aFront: g.aFront,
      vRam: vRam, vFan: vFan,
      /* como vFace^2 = vRam^2 + vFan^2, a razao dos quadrados reparte a
         energia cinetica do escoamento entre quem a forneceu          */
      fanShare: vFace > 1e-6 ? (vFan * vFan) / (vFace * vFace) : 0
    };
  };

  /* ---------- UA teorico por correlacoes (resistencias em serie) ----------
     1/UA = 1/(eta_s h_ar A_ar) + t/(k A) + 1/(h_liq A_liq)              */
  T.uaModel = function (mdotAir, Tamb, mdotCool, Tcool, p) {
    var g = T.geom(p);

    // ---- lado ar: Nu = C Re^m Pr^(1/3), Re na velocidade maxima do canal
    var pa = T.air(Tamb, p.pAtm);
    var gAir = mdotAir / Math.max(g.aFront * p.sigma, 1e-9);   // fluxo massico maximo kg/(s m2)
    var reAir = gAir * g.dhAir / pa.mu;
    var nuAir = p.cAir * Math.pow(Math.max(reAir, 1), p.mAir) * Math.pow(pa.Pr, 1 / 3);
    var hAir = nuAir * pa.k / g.dhAir;
    var rAir = 1 / Math.max(p.finEff * hAir * g.aAir, 1e-9);

    // ---- lado liquido: Dittus-Boelter (turbulento) ou placas paralelas (laminar)
    var pc = T.coolant(Tcool);
    var gCool = mdotCool / Math.max(g.aFlowCool, 1e-9);
    var reCool = gCool * g.dhCool / pc.mu;
    var nuCool = reCool > 2300
      ? 0.023 * Math.pow(reCool, 0.8) * Math.pow(pc.Pr, 0.3)   // resfriamento
      : 7.54;                                                   // limite laminar, canal plano
    var hCool = nuCool * pc.k / g.dhCool;
    var rCool = 1 / Math.max(hCool * g.aCool, 1e-9);

    // ---- parede
    var rWall = p.wallT / (p.wallK * g.aCool);

    var UA = (p.uaScale || 1) / (rAir + rWall + rCool);
    return {
      UA: UA, hAir: hAir, hCool: hCool, reAir: reAir, reCool: reCool,
      nuAir: nuAir, nuCool: nuCool, rAir: rAir, rCool: rCool, rWall: rWall,
      shareAir: rAir / (rAir + rWall + rCool)
    };
  };


  /* ============================================================
     MEDIA LOGARITMICA DAS DIFERENCAS DE TEMPERATURA
     ------------------------------------------------------------
     O outro metodo que a disciplina cobre. Aqui ele nao e um
     caminho independente — ele e algebricamente equivalente ao
     efetividade-NTU para a mesma correlacao — mas entrega duas
     grandezas que o relatorio precisa mostrar: a propria DT_ml e o
     fator de correcao F que a analise implica para este ponto de
     operacao. F longe de 1 avisa que o trocador esta operando fora
     da faixa em que o escoamento cruzado se aproxima do contra-
     corrente, e isso e informacao de projeto.
     ============================================================ */
  T.lmtd = function (tHotIn, tHotOut, tColdIn, tColdOut) {
    var d1 = tHotIn - tColdOut;
    var d2 = tHotOut - tColdIn;
    if (!isFinite(d1) || !isFinite(d2) || d1 <= 0 || d2 <= 0) return NaN;
    if (Math.abs(d1 - d2) < 1e-6) return d1;          // limite dos extremos iguais
    return (d1 - d2) / Math.log(d1 / d2);
  };

  /* ============================================================
     COMPACIDADE E CUSTO DE ACIONAMENTO
     ------------------------------------------------------------
     Um trocador compacto se descreve pelo fator j de Colburn, nao
     pelo Nusselt cru: j = Nu / (Re Pr^(1/3)) = St Pr^(2/3) e a
     forma adimensional em que os catalogos de nucleo publicam
     desempenho, entao e o unico numero que permite comparar este
     radiador com um de referencia.

     E toda troca de calor se paga em perda de carga. Sem a potencia
     de ventilacao e de bombeamento ao lado, "aumentar a area" parece
     de graca — e nao e.
     ============================================================ */
  T.compact = function (um, mdotAir, Tamb, mdotCool, Tcool, p, fanShare) {
    var g = T.geom(p);
    var pa = T.air(Tamb, p.pAtm);
    var pc = T.coolant(Tcool);

    // ---- lado ar ----
    var aFlowAir = Math.max(g.aFront * p.sigma, 1e-9);
    var gAir = mdotAir / aFlowAir;                       // fluxo massico maximo
    var jAir = um.reAir > 1 ? um.nuAir / (um.reAir * Math.pow(pa.Pr, 1 / 3)) : NaN;
    var stAir = isFinite(jAir) ? jAir / Math.pow(pa.Pr, 2 / 3) : NaN;
    var fAir = isFinite(jAir) ? p.fjRatio * jAir : NaN;
    /* nucleo compacto (Kays & London): dP = f (A/Ac) G^2 / (2 rho) */
    var dpAir = isFinite(fAir) ? fAir * (g.aAir / aFlowAir) * gAir * gAir / (2 * pa.rho) : NaN;
    var vdotAir = mdotAir / pa.rho;
    /* Potencia para empurrar o ar pelo nucleo. Ela nao e toda do
       eletroventilador: em rodovia quem paga e o proprio veiculo, na
       forma de arrasto. A repartição vem da fracao de energia
       cinetica que cada fonte colocou no escoamento.                */
    var wAir = isFinite(dpAir) ? dpAir * vdotAir : NaN;
    var share = U.clamp(fanShare === undefined ? 1 : fanShare, 0, 1);
    var wFan = isFinite(wAir) ? wAir * share / Math.max(p.etaFan, 0.05) : NaN;
    var wRam = isFinite(wAir) ? wAir * (1 - share) : NaN;

    // ---- lado liquido ----
    var vCool = mdotCool / Math.max(pc.rho * g.aFlowCool, 1e-9);
    var fCool = um.reCool > 2300
      ? 0.316 * Math.pow(um.reCool, -0.25)               // Blasius, tubo liso
      : (um.reCool > 1 ? 64 / um.reCool : NaN);          // laminar plenamente desenvolvido
    var dpCool = isFinite(fCool)
      ? fCool * (p.coreW / Math.max(g.dhCool, 1e-9)) * pc.rho * vCool * vCool / 2
      : NaN;
    var vdotCool = mdotCool / pc.rho;
    var wPump = isFinite(dpCool) ? dpCool * vdotCool / Math.max(p.etaPump, 0.05) : NaN;

    /* o custo total de mover os dois fluidos inclui o arrasto: ignorar
       o que o veiculo paga faria o radiador parecer de graca em
       rodovia, que e justamente onde ele mais consome                */
    var wTotal = (isFinite(wFan) ? wFan : 0) + (isFinite(wPump) ? wPump : 0) + (isFinite(wRam) ? wRam : 0);
    return {
      jAir: jAir, stAir: stAir, fAir: fAir, dpAir: dpAir,
      wAir: wAir, wFan: wFan, wRam: wRam,
      vCool: vCool, fCool: fCool, dpCool: dpCool, wPump: wPump, wTotal: wTotal
    };
  };

  /* ============================================================
     PROPAGACAO DE INCERTEZA
     ------------------------------------------------------------
     Sem isto, "efetividade 0,55" nao e um resultado — e um numero.
     A lei de propagacao aplicada a cadeia inteira, com as
     incertezas dos instrumentos declaradas nos parametros.

     Um resultado importante cai fora da conta: quando o liquido e
     o lado de menor capacidade termica, a vazao aparece no calor
     rejeitado E no calor maximo, e cancela. A efetividade vira
     DT / (T_liq - T_ar), so temperaturas — ou seja, o parametro
     mais incerto da montagem, a vazao da bomba, nao contamina o
     resultado principal. Vale escrever isso no relatorio.

     Ja o UA nao escapa: o NTU e uma funcao muito nao-linear da
     efetividade, e perto do teto dela a derivada explode. O fator
     de amplificacao devolvido aqui diz quantas vezes a incerteza
     relativa da efetividade aparece ampliada no UA.
     ============================================================ */
  T.uncertainty = function (d, p) {
    /* especificacao +/- a com distribuicao retangular vira desvio
       padrao a/raiz(3): e o que o GUM manda usar quando o fabricante
       so publica o limite de erro                                  */
    var R3 = Math.sqrt(3);
    var uHot = (isFinite(d.tIn) ? p.uTliq : p.uTobd) / R3;
    var uOut = p.uTliq / R3;
    var uAmb = p.uTamb / R3;

    var uDT = Math.sqrt(uHot * uHot + uOut * uOut);
    var uDTmax = Math.sqrt(uHot * uHot + uAmb * uAmb);
    var dTmax = d.tHotIn - d.tAmb;

    var relFlowLiq = Math.sqrt(p.uPumpRel * p.uPumpRel + p.uCpRel * p.uCpRel);
    var relFlowAir = Math.sqrt(p.uAirRel * p.uAirRel + p.uCpRel * p.uCpRel);
    var liqLimits = d.Ch <= d.Cc;
    var relCmin = liqLimits ? relFlowLiq : relFlowAir;

    var out = { liqLimits: liqLimits, uDT: uDT, uDTmax: uDTmax, relCmin: relCmin };

    /* calor rejeitado */
    out.relQ = isFinite(d.dT) && Math.abs(d.dT) > 1e-6
      ? Math.sqrt(relFlowLiq * relFlowLiq + Math.pow(uDT / d.dT, 2))
      : NaN;
    out.uQ = isFinite(out.relQ) ? out.relQ * Math.abs(d.q) : NaN;

    /* efetividade: a vazao cancela quando o liquido limita */
    var termDT = isFinite(d.dT) && Math.abs(d.dT) > 1e-6 ? uDT / d.dT : NaN;
    var termMax = isFinite(dTmax) && Math.abs(dTmax) > 1e-6 ? uDTmax / dTmax : NaN;
    if (isFinite(termDT) && isFinite(termMax)) {
      var quad = termDT * termDT + termMax * termMax;
      if (!liqLimits) quad += relFlowLiq * relFlowLiq + relFlowAir * relFlowAir;
      out.relEps = Math.sqrt(quad);
      out.uEps = out.relEps * Math.abs(d.eps);
    } else { out.relEps = NaN; out.uEps = NaN; }

    /* UA: a nao-linearidade de NTU(eps) amplifica o que vem antes */
    if (isFinite(d.eps) && isFinite(d.ntu) && d.ntu > 0 && isFinite(out.relEps)) {
      var h = 0.002;
      var e1 = U.clamp(d.eps + h, 0.001, 0.999), e0 = U.clamp(d.eps - h, 0.001, 0.999);
      var dNdE = (T.ntuFromEps(e1, d.Cr) - T.ntuFromEps(e0, d.Cr)) / Math.max(e1 - e0, 1e-9);
      out.amp = Math.abs(dNdE) * d.eps / d.ntu;
      out.relNtu = out.amp * out.relEps;
      out.relUA = Math.sqrt(out.relNtu * out.relNtu + relCmin * relCmin);
      out.uUA = out.relUA * Math.abs(d.ua);
    } else { out.amp = NaN; out.relNtu = NaN; out.relUA = NaN; out.uUA = NaN; }

    return out;
  };

  /* ============================================================
     Calibracao do modelo: ajusta o fator uaScale para minimizar o
     erro quadratico entre o calor medido (balanco de energia) e o
     calor previsto pelas correlacoes. Só faz sentido no modo 'exp'.
     ============================================================ */
  T.calibrate = function (rows, p) {
    var base = JSON.parse(JSON.stringify(p || T.defaults()));
    base.uaScale = 1;
    var probe = T.process(rows, base);
    if (probe.mode !== 'exp') return { ok: false, reason: 'sem-dt', uaScale: 1 };

    var useful = probe.rows.filter(function (d) {
      return !d.warmup && isFinite(d.q) && d.q > 1000 && d.tStatFrac > 0.3 && isFinite(d.ua);
    });
    if (useful.length < 30) return { ok: false, reason: 'amostras-insuficientes', uaScale: 1, n: useful.length };

    /* razao mediana entre UA experimental e UA teorico (robusta a outliers) */
    var ratios = useful.map(function (d) { return d.ua / d.uaModel; }).filter(isFinite)
                       .sort(function (a, b) { return a - b; });
    var med = ratios[Math.floor(ratios.length / 2)];

    /* refino por varredura fina minimizando erro em Q */
    var best = med, bestErr = Infinity;
    for (var k = -20; k <= 20; k++) {
      var sc = med * (1 + k * 0.02);
      if (sc <= 0.05) continue;
      var tp = JSON.parse(JSON.stringify(base)); tp.uaScale = sc;
      var pr = T.process(rows, tp);
      var err = 0, n = 0;
      for (var i = 0; i < pr.rows.length; i++) {
        var d = pr.rows[i];
        if (d.warmup || !isFinite(d.q) || !isFinite(d.qModel) || d.tStatFrac <= 0.3) continue;
        var e = (d.q - d.qModel) / 1000;
        err += e * e; n++;
      }
      if (n > 20 && err / n < bestErr) { bestErr = err / n; best = sc; }
    }
    return {
      ok: true, uaScale: best, ratioMedian: med, n: useful.length,
      rmseKw: Math.sqrt(bestErr), spread: (ratios[Math.floor(ratios.length * 0.9)] - ratios[Math.floor(ratios.length * 0.1)])
    };
  };

  /* ============================================================
     Pipeline principal: recebe as amostras cruas e devolve a serie
     com todas as grandezas termicas calculadas por instante.

     Dois modos:
       'exp'  - ha T_in e T_out medidos (ESP32/termopar): Q e eps
                vem do balanco de energia -> resultado experimental.
       'model'- so ha OBD-II (uma temperatura): Q e eps vem do
                UA teorico -> resultado estimado, claramente rotulado.
     ============================================================ */
  T.process = function (rows, p) {
    p = p || T.defaults();
    var hasDT = rows.some(function (r) { return isFinite(r.tIn) && isFinite(r.tOut); });
    var mode = hasDT ? 'exp' : 'model';
    var out = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var d = {
        t: r.t, ts: r.ts,
        ect: r.ect, rpm: r.rpm, speed: r.speed, load: r.load, iat: r.iat,
        fan: r.fan, tIn: r.tIn, tOut: r.tOut, mode: mode
      };

      /* temperatura do ar na entrada do radiador */
      d.tAmb = isFinite(r.tAmb) ? r.tAmb
             : (isFinite(r.iat) ? r.iat - p.ambFromIat : NaN);
      d.ambEstimated = !isFinite(r.tAmb);

      /* temperatura de entrada do liquido no radiador */
      var tHotIn = isFinite(r.tIn) ? r.tIn : r.ect;
      d.tHotIn = tHotIn;

      /* estado do ventilador: medido ou inferido por histerese */
      if (!isFinite(d.fan)) {
        var prev = out.length ? out[out.length - 1].fan : 0;
        d.fan = tHotIn >= p.fanOn ? 1 : (tHotIn <= p.fanOff ? 0 : prev);
        d.fanInferred = true;
      }

      /* --- vazoes e capacidades termicas --- */
      var cf = T.coolantFlow(r.rpm, tHotIn, p);
      var af = T.airFlow(r.speed, d.fan >= 0.5, d.tAmb, p);
      d.mdotCool = cf.mdot; d.vdotCool = cf.vdot * 60000; // L/min
      d.tStatFrac = cf.frac;
      d.mdotAir = af.mdot; d.vFace = af.vFace; d.fanShare = af.fanShare;
      d.cpCool = cf.prop.cp; d.cpAir = af.prop.cp;

      d.Ch = d.mdotCool * d.cpCool;      // W/K  lado quente (liquido)
      d.Cc = d.mdotAir * d.cpAir;        // W/K  lado frio (ar)
      d.Cmin = Math.min(d.Ch, d.Cc);
      d.Cmax = Math.max(d.Ch, d.Cc);
      d.Cr = d.Cmax > 0 ? d.Cmin / d.Cmax : 0;
      d.cminSide = d.Ch <= d.Cc ? 'liquido' : 'ar';

      /* --- calor maximo termodinamicamente possivel --- */
      d.qMax = d.Cmin * (tHotIn - d.tAmb);

      /* --- UA teorico (sempre calculado: base de comparacao) --- */
      var um = T.uaModel(d.mdotAir, d.tAmb, d.mdotCool, tHotIn, p);
      d.uaModel = um.UA;
      d.hAir = um.hAir; d.hCool = um.hCool;
      d.reAir = um.reAir; d.reCool = um.reCool;
      d.nuAir = um.nuAir; d.nuCool = um.nuCool;
      d.shareAir = um.shareAir;
      d.ntuModel = d.Cmin > 0 ? d.uaModel / d.Cmin : 0;
      d.epsModel = T.epsCrossflow(d.ntuModel, d.Cr);
      d.qModel = d.epsModel * d.qMax;

      if (mode === 'exp') {
        /* --- balanco de energia com dT medido --- */
        d.dT = tHotIn - r.tOut;
        d.q = d.mdotCool * d.cpCool * d.dT;
        d.eps = d.qMax > 1 ? U.clamp(d.q / d.qMax, 0, 1) : NaN;
        d.ntu = isFinite(d.eps) ? T.ntuFromEps(d.eps, d.Cr) : NaN;
        d.ua = isFinite(d.ntu) ? d.ntu * d.Cmin : NaN;
        /* saida do ar por balanco (nao medida) */
        d.tAirOut = d.Cc > 0 ? d.tAmb + d.q / d.Cc : NaN;
      } else {
        /* --- sem dT medido: usa o modelo como estimativa --- */
        d.dT = d.Ch > 0 ? d.qModel / d.Ch : NaN;
        d.tOutEst = tHotIn - d.dT;
        d.q = d.qModel;
        d.eps = d.epsModel;
        d.ntu = d.ntuModel;
        d.ua = d.uaModel;
        d.tAirOut = d.Cc > 0 ? d.tAmb + d.q / d.Cc : NaN;
        d.estimated = true;
      }

      /* --- indice de saude: UA observado / UA teorico no mesmo ponto ---
         So tem significado dentro da faixa de validade do modelo: fora
         do aquecimento e com o termostato suficientemente aberto. Com o
         termostato quase fechado, a vazao pelo radiador e dominada pela
         fracao de bypass estimada, cuja incerteza domina o resultado. */
      d.health = (isFinite(d.ua) && d.uaModel > 0) ? d.ua / d.uaModel : NaN;
      d.healthValid = !d.warmup && d.tStatFrac > 0.3 && d.qMax > 500 && isFinite(d.health);

      /* --- condutancia efetiva, equilibrio e constante de tempo ---
         UA_ef = eps*Cmin e a condutancia que o circuito realmente
         apresenta no ponto de operacao. Com ela, o modelo de
         capacitancia concentrada da a temperatura de equilibrio e a
         constante de tempo do motor, usadas na previsao hibrida.   */
      d.uaEff = (isFinite(d.eps) && isFinite(d.Cmin)) ? d.eps * d.Cmin : NaN;
      d.cTh = p.cTh;

      /* --- balanco de energia do motor: entrada vs rejeicao --- */
      d.qGen = T.heatInput(r.rpm, r.load, p);
      d.qNet = (isFinite(d.qGen) && isFinite(d.q)) ? d.qGen - d.q : NaN;
      /* taxa de variacao prevista pela capacitancia concentrada (C/min) */
      d.dTdtModel = isFinite(d.qNet) ? d.qNet / p.cTh * 60 : NaN;
      /* temperatura de equilibrio e constante de tempo no ponto atual */
      if (isFinite(d.uaEff) && d.uaEff > 1 && isFinite(d.qGen)) {
        d.tEq = d.tAmb + d.qGen / d.uaEff;
        d.tau = p.cTh / d.uaEff;
      } else { d.tEq = NaN; d.tau = NaN; }

      /* --- media logaritmica e fator de correcao implicito ---
         A temperatura de saida do ar nao e medida: ela sai do proprio
         balanco. Entao a DT_ml aqui e coerente com o resultado, nao
         uma verificacao independente — e assim que ela deve ser lida
         no relatorio.                                                */
      d.dTml = T.lmtd(tHotIn, tHotIn - d.dT, d.tAmb, d.tAirOut);
      d.fCorr = (isFinite(d.dTml) && d.dTml > 0.1 && isFinite(d.ua) && d.ua > 1)
        ? (d.q / d.dTml) / d.ua : NaN;

      /* --- compacidade e o que custa mover os dois fluidos --- */
      var cp2 = T.compact(um, d.mdotAir, d.tAmb, d.mdotCool, tHotIn, p, af.fanShare);
      d.jAir = cp2.jAir; d.stAir = cp2.stAir;
      d.dpAir = cp2.dpAir; d.dpCool = cp2.dpCool;
      d.wFan = cp2.wFan; d.wPump = cp2.wPump; d.wRam = cp2.wRam; d.wDrive = cp2.wTotal;
      /* quantos watts de calor por watt gasto para mover os fluidos */
      d.merit = (isFinite(d.q) && cp2.wTotal > 0.1) ? d.q / cp2.wTotal : NaN;

      /* --- incerteza do resultado deste instante --- */
      d.unc = T.uncertainty(d, p);

      /* --- regime de operacao --- */
      d.regime = r.speed < 3 ? 'Marcha lenta'
               : (r.speed < 60 ? 'Urbano' : 'Rodovia');
      d.warmup = tHotIn < p.tStatOpen;

      out.push(d);
    }

    /* mediana movel do indice de saude sobre as amostras validas:
       o valor instantaneo e ruidoso demais para diagnostico          */
    (function () {
      var validIdx = [];
      for (var v = 0; v < out.length; v++) if (out[v].healthValid) validIdx.push(v);
      for (var i2 = 0; i2 < out.length; i2++) {
        if (!out[i2].healthValid) { out[i2].healthSmooth = NaN; continue; }
        var t0 = out[i2].t, win = [];
        for (var j2 = 0; j2 < validIdx.length; j2++) {
          var k2 = validIdx[j2];
          if (Math.abs(out[k2].t - t0) <= 90) win.push(out[k2].health);
        }
        win.sort(function (a, b) { return a - b; });
        out[i2].healthSmooth = win.length ? win[Math.floor(win.length / 2)] : NaN;
      }
    })();

    /* taxa de variacao da temperatura (C/min), suavizada */
    var ect = out.map(function (d) { return d.tHotIn; });
    var sm = U.smooth(ect, 11);
    for (var j = 0; j < out.length; j++) {
      var a = Math.max(0, j - 15), b = Math.min(out.length - 1, j + 15);
      var dt = out[b].t - out[a].t;
      out[j].dTdt = dt > 0 ? (sm[b] - sm[a]) / dt * 60 : 0;
      out[j].ectSmooth = sm[j];
    }
    return { rows: out, mode: mode, params: p };
  };

  /* ---------- estatisticas agregadas ---------- */
  T.summary = function (proc) {
    var rows = proc.rows;
    var useful = rows.filter(function (d) {
      return !d.warmup && isFinite(d.eps) && d.qMax > 500 && d.tStatFrac > 0.3;
    });
    var pick = function (arr, f) { return arr.map(f).filter(isFinite); };
    var s = {
      n: rows.length,
      nUseful: useful.length,
      duration: rows.length ? rows[rows.length - 1].t - rows[0].t : 0,
      mode: proc.mode,
      ectMax: U.max(pick(rows, function (d) { return d.tHotIn; })),
      ectMean: U.mean(pick(rows, function (d) { return d.tHotIn; })),
      ectMeanUseful: U.mean(pick(useful, function (d) { return d.tHotIn; })),
      ambMean: U.mean(pick(rows, function (d) { return d.tAmb; })),
      epsMean: U.mean(pick(useful, function (d) { return d.eps; })),
      epsP10: U.percentile(pick(useful, function (d) { return d.eps; }), 0.10),
      epsP90: U.percentile(pick(useful, function (d) { return d.eps; }), 0.90),
      qMean: U.mean(pick(useful, function (d) { return d.q; })),
      qMax: U.max(pick(useful, function (d) { return d.q; })),
      uaMean: U.mean(pick(useful, function (d) { return d.ua; })),
      uaModelMean: U.mean(pick(useful, function (d) { return d.uaModel; })),
      ntuMean: U.mean(pick(useful, function (d) { return d.ntu; })),
      crMean: U.mean(pick(useful, function (d) { return d.Cr; })),
      healthMean: U.mean(pick(useful, function (d) { return d.health; })),
      dtMean: U.mean(pick(useful, function (d) { return d.dT; })),
      fanPct: 100 * rows.filter(function (d) { return d.fan >= 0.5; }).length / Math.max(rows.length, 1),
      /* incerteza: a mediana e mais representativa que a media, porque
         nas amostras de DT pequeno a relativa dispara e distorce       */
      relEps: U.percentile(pick(useful, function (d) { return d.unc && d.unc.relEps; }), 0.5),
      relQ: U.percentile(pick(useful, function (d) { return d.unc && d.unc.relQ; }), 0.5),
      relUA: U.percentile(pick(useful, function (d) { return d.unc && d.unc.relUA; }), 0.5),
      ampMean: U.percentile(pick(useful, function (d) { return d.unc && d.unc.amp; }), 0.5),
      uDT: U.mean(pick(useful, function (d) { return d.unc && d.unc.uDT; })),
      liqLimitsPct: 100 * useful.filter(function (d) { return d.unc && d.unc.liqLimits; }).length / Math.max(useful.length, 1),
      dTmlMean: U.mean(pick(useful, function (d) { return d.dTml; })),
      fCorrMean: U.mean(pick(useful, function (d) { return d.fCorr; })),
      jAirMean: U.mean(pick(useful, function (d) { return d.jAir; })),
      stAirMean: U.mean(pick(useful, function (d) { return d.stAir; })),
      dpAirMean: U.mean(pick(useful, function (d) { return d.dpAir; })),
      dpCoolMean: U.mean(pick(useful, function (d) { return d.dpCool; })),
      wFanMean: U.mean(pick(useful, function (d) { return d.wFan; })),
      wPumpMean: U.mean(pick(useful, function (d) { return d.wPump; })),
      wRamMean: U.mean(pick(useful, function (d) { return d.wRam; })),
      fanShareMean: U.mean(pick(useful, function (d) { return d.fanShare; })),
      /* razao das medias, nao media das razoes: em marcha lenta o
         denominador vai a quase zero e a media das razoes dispara    */
      energy: 0
    };
    /* figura de merito: calor rejeitado por watt gasto para mover os
       dois fluidos, agregada sobre a parte util da coleta            */
    var wSum = (isFinite(s.wFanMean) ? s.wFanMean : 0) +
               (isFinite(s.wPumpMean) ? s.wPumpMean : 0) +
               (isFinite(s.wRamMean) ? s.wRamMean : 0);
    s.meritMean = wSum > 0.1 && isFinite(s.qMean) ? s.qMean / wSum : NaN;
    s.wDriveMean = wSum;

    /* energia total rejeitada pelo radiador (MJ) via integracao trapezoidal */
    for (var i = 1; i < rows.length; i++) {
      var dt = rows[i].t - rows[i - 1].t;
      var qa = rows[i - 1].q, qb = rows[i].q;
      if (isFinite(qa) && isFinite(qb) && dt > 0 && dt < 30) s.energy += 0.5 * (qa + qb) * dt;
    }
    s.energy /= 1e6;

    /* faixa tipica de radiadores automotivos de fluxo cruzado */
    s.epsInRange = isFinite(s.epsMean) && s.epsMean >= 0.40 && s.epsMean <= 0.70;

    /* por regime */
    s.byRegime = ['Marcha lenta', 'Urbano', 'Rodovia'].map(function (name) {
      var g = useful.filter(function (d) { return d.regime === name; });
      return {
        regime: name, n: g.length,
        eps: U.mean(pick(g, function (d) { return d.eps; })),
        q: U.mean(pick(g, function (d) { return d.q; })),
        ua: U.mean(pick(g, function (d) { return d.ua; })),
        ntu: U.mean(pick(g, function (d) { return d.ntu; })),
        cr: U.mean(pick(g, function (d) { return d.Cr; })),
        vFace: U.mean(pick(g, function (d) { return d.vFace; })),
        ect: U.mean(pick(g, function (d) { return d.tHotIn; })),
        dT: U.mean(pick(g, function (d) { return d.dT; })),
        fanPct: 100 * g.filter(function (d) { return d.fan >= 0.5; }).length / Math.max(g.length, 1)
      };
    }).filter(function (r) { return r.n > 0; });

    return s;
  };

  ATC.Thermal = T;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
