/* ============================================================
   APEX — camada de explicacao
   ------------------------------------------------------------
   A aba "Entenda o calculo" nao recalcula nada: ela le o mesmo
   resultado que a aba de analise usa e conta a historia dele em
   portugues, com desenho e barras de comparacao.

   A regra que orienta tudo aqui: nenhum numero aparece sem que
   esteja escrito de onde ele veio.
   ============================================================ */
(function (ATC) {
  'use strict';

  var E = {};
  var U = ATC.U;

  function $(sel) { return document.querySelector(sel); }
  function txt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  /* media de um campo entre as amostras uteis */
  function avg(rows, f) {
    var s = 0, n = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = f(rows[i]);
      if (isFinite(v)) { s += v; n++; }
    }
    return n ? s / n : NaN;
  }

  /* ============================================================
     1. Esquema do circuito
     ============================================================ */
  function renderCircuit(S, m) {
    txt('exTHot', U.br(m.tHot, 1));
    txt('exTCold', U.br(m.tCold, 1));
    txt('exDT', U.br(m.dT, 1));
    txt('exQ', U.br(m.q / 1000, 1));
    txt('exQgen', U.br(m.qGen / 1000, 1));
    txt('exRpm', U.br(m.rpm, 0));
    txt('exMdot', U.br(m.mdot, 2));
    txt('exTamb', U.br(m.tAmb, 1));
    txt('exVair', U.br(m.vFace, 1));
    txt('exTairOut', U.br(m.tAirOut, 1));

    /* o desenho anda no ritmo da coleta: mangueira mais rapida com
       mais vazao, ar mais rapido com mais velocidade de face       */
    var svg = document.querySelector('#tab-entenda .circuit');
    if (svg) {
      var flowDur = U.clamp(2.6 / Math.max(m.mdot, 0.05), 0.35, 3.2);
      var airDur = U.clamp(3.4 / Math.max(m.vFace, 0.3), 0.45, 3.4);
      svg.style.setProperty('--flow-dur', flowDur.toFixed(2) + 's');
      svg.style.setProperty('--air-dur', airDur.toFixed(2) + 's');
    }

    var modo = S.proc.mode === 'exp'
      ? 'O ΔT veio dos sensores nas mangueiras, então este calor é <b>medido</b>.'
      : 'Não há sensor nas mangueiras nesta coleta, então o ΔT e o calor são <b>estimados</b> pelas correlações — servem para acompanhar tendência, não como medição.';
    var r = $('#exFlowRead');
    if (r) {
      r.innerHTML = 'Em média, o líquido chegou ao radiador a <b>' + U.br(m.tHot, 1) + ' °C</b> e voltou a <b>' +
        U.br(m.tCold, 1) + ' °C</b>. Essa queda de <b>' + U.br(m.dT, 1) + ' °C</b>, multiplicada pelos <b>' +
        U.br(m.mdot, 2) + ' kg/s</b> de líquido que passam por lá, dá <b>' + U.br(m.q / 1000, 1) +
        ' kW</b> de calor jogado no ar — o equivalente a ' + U.br(m.q / 1000 / 5.5, 0) +
        ' chuveiros elétricos ligados. ' + modo;
    }
  }

  /* ============================================================
     2. As quatro comparacoes
     ============================================================ */
  function renderRatios(S, m, G, COL) {
    var s = S.sum;

    /* efetividade: o que saiu contra o teto termodinamico */
    G.ratio($('#exRatioEps'), {
      height: 108,
      label: 'CALOR REJEITADO CONTRA O MÁXIMO POSSÍVEL',
      right: U.br(m.q / 1000, 1) + ' de ' + U.br(m.qMax / 1000, 1) + ' kW',
      value: s.epsMean, max: 1,
      valueText: 'ε = ' + U.br(s.epsMean, 3),
      band: [0.40, 0.70], bandLabel: 'faixa esperada de um radiador automotivo',
      colorFrom: COL.epsFrom, colorTo: COL.eps
    });
    $('#exReadEps').innerHTML = 'O radiador entregou <b>' + U.br(100 * s.epsMean, 0) +
      '%</b> de tudo o que seria termodinamicamente possível com esse ar e esse líquido. ' +
      (s.epsInRange
        ? 'Está dentro da faixa esperada — o núcleo está fazendo o serviço dele.'
        : (s.epsMean > 0.70
          ? 'Está acima da faixa típica: vale conferir a vazão da bomba e a geometria do núcleo nos parâmetros, porque um dos dois pode estar subestimado.'
          : 'Está abaixo da faixa típica: pode ser obstrução no núcleo, pouca vazão de ar ou geometria mal estimada nos parâmetros.'));

    /* queda de temperatura contra a queda maxima concebivel */
    var dtMax = m.tHot - m.tAmb;
    G.ratio($('#exRatioDT'), {
      height: 108,
      label: 'QUEDA DE TEMPERATURA NO RADIADOR',
      right: 'teto: ' + U.br(dtMax, 1) + ' °C até o ambiente',
      value: m.dT, max: Math.max(dtMax, 1),
      valueText: 'ΔT = ' + U.br(m.dT, 1) + ' °C',
      colorFrom: COL.dtFrom, colorTo: COL.hot
    });
    $('#exReadDT').innerHTML = 'O líquido perdeu <b>' + U.br(m.dT, 1) +
      ' °C</b> na passagem. O limite absoluto seria sair na temperatura do ar, <b>' + U.br(m.tAmb, 1) +
      ' °C</b> — nenhum trocador chega lá, porque para isso precisaria de área infinita.';

    /* condutancia medida contra a prevista */
    var uaMax = Math.max(s.uaMean, s.uaModelMean, 1) * 1.15;
    G.ratio($('#exRatioUA'), {
      height: 108,
      label: 'CONDUTÂNCIA UA — MEDIDA CONTRA A PREVISTA',
      right: 'previsto: ' + U.br(s.uaModelMean, 0) + ' W/K',
      value: s.uaMean, max: uaMax,
      valueText: U.br(s.uaMean, 0) + ' W/K',
      band: [s.uaModelMean, s.uaModelMean], bandLabel: 'previsto pelas correlações',
      colorFrom: COL.uaFrom, colorTo: COL.ua
    });
    $('#exReadUA').innerHTML = 'Cada grau de diferença entre o líquido e o ar arrasta <b>' + U.br(s.uaMean, 0) +
      ' W</b> para fora. O modelo previa ' + U.br(s.uaModelMean, 0) + ' W/K' +
      (S.params.uaCalibrated
        ? ' — como o modelo já foi calibrado com uma coleta de referência, a diferença que sobra é desempenho real.'
        : ' — mas esse valor previsto ainda carrega o viés da geometria estimada. Rode a calibração na aba de análise para que a comparação signifique alguma coisa.');

    /* indice de saude */
    var h = s.healthMean;
    var cls = !isFinite(h) ? '' : (h >= 0.9 ? 'ok' : h >= 0.75 ? 'warn' : 'crit');
    G.ratio($('#exRatioHealth'), {
      height: 108,
      label: 'ÍNDICE DE SAÚDE DO NÚCLEO',
      right: isFinite(h) ? U.br(100 * h, 0) + ' % do previsto' : 'sem base de comparação',
      value: isFinite(h) ? h : 0, max: 1.2,
      valueText: isFinite(h) ? U.br(h, 2) : '--',
      band: [0.9, 1.2], bandLabel: 'saudável',
      colorFrom: cls === 'crit' ? COL.critFrom : COL.healthFrom,
      colorTo: cls === 'crit' ? COL.crit : (cls === 'warn' ? COL.warn : COL.ok)
    });
    $('#exReadHealth').innerHTML = !isFinite(h)
      ? 'Sem ΔT medido não existe UA experimental, então não há índice de saúde nesta coleta.'
      : (S.params.uaCalibrated
        ? 'O núcleo está entregando <b>' + U.br(100 * h, 0) + '%</b> do que entregava na coleta de referência. ' +
          (h >= 0.9 ? 'Nada a fazer.' : h >= 0.75 ? 'Queda perceptível: vale inspecionar as aletas.' : 'Queda grande: obstrução, incrustação ou fluido degradado.')
        : 'O índice está em <b>' + U.br(100 * h, 0) + '%</b>, mas ele compara com um UA teórico ainda não calibrado. Só depois de calibrar com o radiador em bom estado é que a queda dele significa degradação.');
  }

  /* ============================================================
     3. Passo a passo com os numeros substituidos
     ============================================================ */
  function step(n, title, plain, subst, outLabel, outValue, outUnit) {
    return '<div class="step">' +
      '<div class="n">' + n + '</div>' +
      '<div>' +
        '<h4>' + title + '</h4>' +
        '<p class="plain">' + plain + '</p>' +
        '<div class="subst">' + subst + '</div>' +
        '<div class="out">' + outLabel + ' <b>' + outValue + '</b> ' + (outUnit || '') + '</div>' +
      '</div></div>';
  }

  function renderSteps(S, m) {
    var s = S.sum, p = S.params;
    var host = $('#calcSteps');
    if (!host) return;
    var n = function (v, d) { return '<em>' + U.br(v, d) + '</em>'; };
    var h = '';

    h += step(1, 'Quanto líquido passa pelo radiador',
      'A bomba é movida pelo próprio motor, então a vazão acompanha a rotação. O termostato decide que fração dessa vazão vai para o radiador e quanto volta direto pelo desvio.',
      'ṁ = ρ · (rotação × ' + n(p.pumpDisp, 3) + ' L/rev) × abertura do termostato<br>' +
      'ṁ = ρ · (' + n(m.rpm, 0) + ' rpm × ' + n(p.pumpDisp, 3) + ') × ' + n(m.tStatFrac, 2),
      'vazão de líquido pelo núcleo', U.br(m.mdot, 2), 'kg/s');

    h += step(2, 'Quanto ar atravessa o núcleo',
      'Parte da velocidade do carro chega de fato à face do radiador — o resto se perde no para-choque e no cofre. O eletroventilador soma a isso, mas não de forma linear: os dois disputam o mesmo ar.',
      'v_face = √( (' + n(p.kRam, 2) + ' × velocidade)² + v_ventilador² )<br>' +
      'ṁ_ar = ρ_ar · área frontal · v_face = ρ · ' + n(p.coreW * p.coreH, 3) + ' m² · ' + n(m.vFace, 2) + ' m/s',
      'vazão de ar pela face', U.br(m.mdotAir, 2), 'kg/s');

    h += step(3, 'O calor que saiu do líquido',
      'Este é o balanço de energia, e é a conta mais direta de todas: massa que passa, vezes o calor que cada quilo carrega por grau, vezes os graus que ela perdeu.',
      'Q̇ = ṁ · c_p · ΔT<br>' +
      'Q̇ = ' + n(m.mdot, 2) + ' kg/s × ' + n(m.cp, 0) + ' J/(kg·K) × ' + n(m.dT, 1) + ' K',
      'calor rejeitado pelo radiador', U.br(m.q / 1000, 1), 'kW');

    h += step(4, 'O calor que era possível tirar',
      'Nenhum trocador consegue mais do que levar o fluido limitante até a temperatura de entrada do outro. Quem manda é o lado com menor capacidade térmica por segundo — aqui, o ' + m.cminSide + '.',
      'C_mín = mín(ṁ_liq·c_liq , ṁ_ar·c_ar) = mín(' + n(m.Ch, 0) + ' , ' + n(m.Cc, 0) + ') W/K<br>' +
      'Q̇_máx = C_mín · (T_líquido − T_ar) = ' + n(m.Cmin, 0) + ' × (' + n(m.tHot, 1) + ' − ' + n(m.tAmb, 1) + ')',
      'teto termodinâmico', U.br(m.qMax / 1000, 1), 'kW');

    h += step(5, 'A efetividade é a divisão dos dois',
      'Toda a teoria de trocadores existe para chegar neste número: a fração do possível que este radiador entregou. É adimensional, então compara radiadores de tamanhos diferentes em dias diferentes.',
      'ε = Q̇ / Q̇_máx = ' + n(m.q / 1000, 1) + ' kW / ' + n(m.qMax / 1000, 1) + ' kW',
      'efetividade média da coleta', U.br(s.epsMean, 3), '');

    h += step(6, 'Da efetividade se volta ao tamanho do trocador',
      'A relação ε–NTU do escoamento cruzado não se inverte com álgebra, então a plataforma resolve numericamente: procura o NTU cuja curva teórica devolve exatamente a efetividade medida.',
      'ε = 1 − exp{ (NTU^0,22 / C_r) · [ exp(−C_r·NTU^0,78) − 1 ] }, com C_r = ' + n(m.Cr, 2) + '<br>' +
      'resolvendo para ε = ' + n(s.epsMean, 3) + '  →  NTU = ' + n(s.ntuMean, 2),
      'unidades de transferência', U.br(s.ntuMean, 2), '');

    h += step(7, 'E do NTU sai a nota do radiador',
      'O UA é o que se acompanha ao longo do tempo: ele não depende do dia estar quente ou frio, só da condição do núcleo e do ar que passa por ele.',
      'UA = NTU · C_mín = ' + n(s.ntuMean, 2) + ' × ' + n(m.Cmin, 0) + ' W/K',
      'condutância global medida', U.br(s.uaMean, 0), 'W/K');

    host.innerHTML = h;
    if (ATC.Motion) ATC.Motion.reveal(host.children, 40);
  }

  /* ============================================================
     4. Resistencias em serie
     ============================================================ */
  function renderResistances(S, m, G, COL) {
    var T = ATC.Thermal;
    var um = T.uaModel(m.mdotAir, m.tAmb, m.mdot, m.tHot, S.params);
    var tot = um.rAir + um.rWall + um.rCool;

    G.stack($('#chartRes'), {
      height: 118,
      title: 'PARTICIPAÇÃO DE CADA BARREIRA NA RESISTÊNCIA TOTAL',
      parts: [
        { label: 'lado do ar', value: um.rAir, color: COL.resAir },
        { label: 'parede de alumínio', value: um.rWall, color: COL.resWall, dark: true },
        { label: 'lado do líquido', value: um.rCool, color: COL.resCool }
      ]
    });

    var pAir = 100 * um.rAir / tot, pWall = 100 * um.rWall / tot, pCool = 100 * um.rCool / tot;
    $('#exReadRes').innerHTML = 'O ar responde por <b>' + U.br(pAir, 0) +
      '%</b> de toda a dificuldade que o calor encontra; o líquido, por ' + U.br(pCool, 0) +
      '%; a parede de alumínio, por ' + U.br(pWall, 1) + '%. ' +
      (pAir > 60
        ? 'É o lado do ar que manda: dobrar a vazão da bomba quase não muda o resultado, enquanto limpar as aletas ou destravar o eletroventilador muda muito.'
        : 'Aqui os dois lados pesam de forma parecida, o que é incomum — vale conferir a vazão da bomba nos parâmetros.') +
      ' A parede quase não aparece, e é por isso que radiador de alumínio fino funciona.';
  }

  /* ============================================================
     5. Sensibilidade a velocidade
     ============================================================ */
  function renderWhatIf(S, m, G, COL) {
    var T = ATC.Thermal, p = S.params;

    /* duas varreduras: com o eletroventilador e sem ele. A distancia
       entre as duas curvas em velocidade baixa e exatamente a razao
       de o ventilador existir.                                      */
    function sweep(fanOn) {
      var q = [], eps = [];
      for (var v = 0; v <= 140; v += 2.5) {
        var af = T.airFlow(v, fanOn, m.tAmb, p);
        var um = T.uaModel(af.mdot, m.tAmb, m.mdot, m.tHot, p);
        var Cc = af.mdot * af.prop.cp;
        var Cmin = Math.min(m.Ch, Cc), Cmax = Math.max(m.Ch, Cc);
        var Cr = Cmax > 0 ? Cmin / Cmax : 0;
        var ntu = Cmin > 0 ? um.UA / Cmin : 0;
        var e = T.epsCrossflow(ntu, Cr);
        eps.push([v, e]);
        q.push([v, e * Cmin * (m.tHot - m.tAmb) / 1000]);
      }
      return { q: q, eps: eps };
    }
    var on = sweep(1), off = sweep(0);

    var series = [
      { name: 'calor rejeitado — ventilador ligado', color: COL.q, width: 2.1,
        data: on.q, tipFmt: function (x) { return U.br(x, 1) + ' kW'; } },
      { name: 'calor rejeitado — ventilador desligado', color: COL.uaMod, width: 1.6, dash: true,
        data: off.q, tipFmt: function (x) { return U.br(x, 1) + ' kW'; } },
      { name: 'efetividade ε — ventilador ligado', color: COL.eps, width: 1.5, axis: 'r',
        data: on.eps, tipFmt: function (x) { return U.br(x, 3); } }
    ];
    G.update($('#chartWhatIf'), {
      height: 250, series: series, xMin: 0, xMax: 140, yMin: 0,
      xLabel: 'velocidade do veículo (km/h)', yLabel: 'calor rejeitado (kW)', yLabelRight: 'efetividade ε',
      yMinRight: 0, yMaxRight: 1,
      marks: [{ x: m.speed, color: COL.mark }],
      xFmt: function (x) { return U.br(x, 0); },
      yFmt: function (x) { return U.br(x, 0); },
      yFmtRight: function (x) { return U.br(x, 2); },
      tipTitle: function (x) { return U.br(x, 0) + ' km/h'; }
    });
    if (ATC.App && ATC.App.legend) ATC.App.legend('#legWhatIf', series);

    var i60 = Math.round(60 / 2.5), i120 = Math.round(120 / 2.5);
    $('#exReadWhatIf').innerHTML = 'Parado no engarrafamento, o eletroventilador sozinho dá conta de <b>' +
      U.br(on.q[0][1], 1) + ' kW</b> — sem ele seriam ' + U.br(off.q[0][1], 1) +
      ' kW, e é aí que a temperatura sobe. A 60 km/h o ar de marcha já entrega <b>' + U.br(off.q[i60][1], 1) +
      ' kW</b> sem ajuda nenhuma, e a 120 km/h, <b>' + U.br(off.q[i120][1], 1) +
      ' kW</b>. A curva achata porque o ganho do lado do ar entra elevado a ' + U.br(p.mAir, 2) +
      ': dobrar a velocidade não dobra a troca. A linha vertical marca a velocidade média desta coleta.';
  }

  /* ============================================================
     6. Superficie interativa
     ------------------------------------------------------------
     Os parametros que mais mandam no resultado, com o efeito de cada
     um visivel no relevo. E deliberadamente uma caixa de areia: nada
     aqui toca na analise ate alguem clicar em aplicar, porque mexer
     num slider para entender nao pode reescrever a memoria de
     calculo de uma coleta real.
     ============================================================ */
  var KNOBS = [
    { k: 'kRam',     lab: 'Ar que chega à face',        min: 0.05, max: 0.60, step: 0.01, dec: 2, unit: '',
      why: 'Fração da velocidade do carro que vence o para-choque e chega ao núcleo. O resto se perde no cofre.' },
    { k: 'vFan',     lab: 'Ar do eletroventilador',      min: 0,    max: 6,    step: 0.1,  dec: 1, unit: 'm/s',
      why: 'O que a ventoinha entrega sozinha. É tudo que existe quando o carro está parado.' },
    { k: 'pumpDisp', lab: 'Vazão da bomba por rotação',  min: 0.010, max: 0.080, step: 0.001, dec: 3, unit: 'L/rev',
      why: 'A bomba é movida pelo motor. Mais vazão tira mais calor no total, mas cada quilo de líquido sai menos resfriado.' },
    { k: 'coreD',    lab: 'Profundidade do núcleo',      min: 0.012, max: 0.060, step: 0.001, dec: 3, unit: 'm',
      why: 'Núcleo mais fundo tem mais área de troca — e mais perda de carga no lado do ar.' },
    { k: 'areaDens', lab: 'Densidade de aletas',         min: 400,  max: 2200, step: 25,   dec: 0, unit: 'm²/m³',
      why: 'Área de troca por metro cúbico de núcleo. É o que se perde quando as aletas entopem de barro e inseto.' },
    { k: 'uaScale',  lab: 'Fator de calibração do UA',   min: 0.40, max: 1.80, step: 0.01, dec: 2, unit: '',
      why: 'A correção que a calibração aplica ao UA teórico. Mexer aqui é dizer que o núcleo real é melhor ou pior que o modelo.' }
  ];

  var NX = 26, NY = 22;                 /* resolucao da grade */
  var pg = { work: null, base: null, m: null, dirty: false, raf: null };

  /* Calor rejeitado para uma velocidade e uma rotacao, com os
     parametros dados. E a mesma cadeia da aba de analise: vazao da
     bomba, vazao de ar, UA pelas correlacoes, NTU, efetividade.   */
  function heatAt(speed, rpm, p, m) {
    var T = ATC.Thermal;
    var cf = T.coolantFlow(rpm, m.tHot, p);
    /* o ventilador sai de cena em torno da velocidade em que o ar de
       marcha iguala o que ele entrega, e sai gradualmente: um degrau
       ali seria artefato do modelo, nao comportamento do carro     */
    var vSwitch = p.vFan / Math.max(p.kRam, 1e-3) * 3.6;
    var fanF = U.clamp((vSwitch + 10 - speed) / 20, 0, 1);
    var af = T.airFlow(speed, fanF, m.tAmb, p);
    var um = T.uaModel(af.mdot, m.tAmb, cf.mdot, m.tHot, p);
    var Ch = cf.mdot * cf.prop.cp, Cc = af.mdot * af.prop.cp;
    var Cmin = Math.min(Ch, Cc), Cmax = Math.max(Ch, Cc);
    var Cr = Cmax > 0 ? Cmin / Cmax : 0;
    var ntu = Cmin > 0 ? um.UA / Cmin : 0;
    var e = ATC.Thermal.epsCrossflow(ntu, Cr);
    return { q: e * Cmin * (m.tHot - m.tAmb) / 1000, eps: e, ua: um.UA };
  }

  function surfaceOf(p, m) {
    var Z = new Array(NY);
    for (var j = 0; j < NY; j++) {
      Z[j] = new Array(NX);
      var rpm = 800 + (5200 - 800) * (j / (NY - 1));
      for (var i = 0; i < NX; i++) {
        var v = 140 * (i / (NX - 1));
        Z[j][i] = heatAt(v, rpm, p, m).q;
      }
    }
    return Z;
  }

  function paintSurface(G, COL) {
    var m = pg.m;
    var Z = surfaceOf(pg.work, m);
    /* a escala do eixo vertical fica presa aos parametros originais:
       sem isso a superficie inteira se reescala a cada slider e a
       mudanca some da vista                                        */
    if (!pg.zRange) {
      var Z0 = surfaceOf(pg.base, m), lo = Infinity, hi = -Infinity;
      for (var j = 0; j < Z0.length; j++) for (var i = 0; i < Z0[j].length; i++) {
        var v = Z0[j][i];
        if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      pg.zRange = [0, Math.max(hi * 1.12, 1)];
    }
    G.surface($('#chartPlay'), {
      height: 340, z: Z, zMin: pg.zRange[0], zMax: pg.zRange[1],
      x: { min: 0, max: 140, fmt: function (v) { return U.br(v, 0); } },
      y: { min: 800, max: 5200, fmt: function (v) { return U.br(v / 1000, 1) + 'k'; } },
      xLabel: 'velocidade (km/h)', yLabel: 'rotação (rpm)',
      zLabel: 'calor rejeitado (kW)',
      zNote: (function () {
        var lo = Infinity, hi = -Infinity;
        for (var a = 0; a < Z.length; a++) for (var b2 = 0; b2 < Z[a].length; b2++) {
          var v = Z[a][b2];
          if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
        }
        return U.br(hi, 1) + ' kW no pico  ·  ' + U.br(lo, 1) + ' kW parado em marcha lenta';
      })(),
      ramp: COL.surfRamp,
      markerColor: COL.mark,
      marker: { x: m.speed, y: m.rpm, label: 'esta coleta' },
      hint: 'arraste para girar'
    });
  }

  function paintOut(COL) {
    var m = pg.m;
    var now = heatAt(m.speed, m.rpm, pg.work, m);
    var was = heatAt(m.speed, m.rpm, pg.base, m);
    function cell(lab, v0, v1, dec, unit) {
      var d = v0 !== 0 ? 100 * (v1 - v0) / Math.abs(v0) : NaN;
      var cls = !isFinite(d) || Math.abs(d) < 0.5 ? '' : (d > 0 ? 'up' : 'down');
      var txt = !isFinite(d) || Math.abs(d) < 0.5 ? 'igual ao atual'
              : (d > 0 ? '+' : '−') + U.br(Math.abs(d), 0) + ' % do atual';
      return '<div class="pg-cell"><div class="pc-l">' + lab + '</div>' +
        '<div class="pc-v">' + U.br(v1, dec) + (unit ? '<small> ' + unit + '</small>' : '') + '</div>' +
        '<div class="pc-d ' + cls + '">' + txt + '</div></div>';
    }
    $('#pgOut').innerHTML =
      cell('CALOR', was.q, now.q, 1, 'kW') +
      cell('EFETIVIDADE', was.eps, now.eps, 3, '') +
      cell('CONDUTÂNCIA', was.ua, now.ua, 0, 'W/K');

    var pico = 0, picoV = 0;
    for (var v = 0; v <= 140; v += 5) {
      var h = heatAt(v, m.rpm, pg.work, m).q;
      if (h > pico) { pico = h; picoV = v; }
    }
    $('#exReadPlay').innerHTML = 'No ponto de operação médio desta coleta — <b>' + U.br(m.speed, 0) +
      ' km/h</b> a <b>' + U.br(m.rpm, 0) + ' rpm</b>, marcado na superfície — estes parâmetros dariam <b>' +
      U.br(now.q, 1) + ' kW</b> contra os ' + U.br(was.q, 1) +
      ' kW de agora. O relevo sobe para a direita porque velocidade traz ar, e sobe para o fundo porque rotação traz vazão. ' +
      'Onde ele achata, o lado do ar virou o gargalo e girar mais alto parou de ajudar.';
  }

  /* O redesenho e agendado para o proximo quadro: arrastar um slider
     dispara dezenas de eventos por segundo e recalcular a superficie
     em todos eles seria trabalho jogado fora.                      */
  function schedule(G, COL) {
    if (pg.raf) return;
    pg.raf = requestAnimationFrame(function () {
      pg.raf = null;
      paintSurface(G, COL);
      paintOut(COL);
    });
  }

  function changed() {
    for (var i = 0; i < KNOBS.length; i++) {
      var k = KNOBS[i].k;
      if (Math.abs(pg.work[k] - pg.base[k]) > 1e-9) return true;
    }
    return false;
  }

  function syncButtons() {
    var on = changed();
    $('#btnPgApply').disabled = !on;
    $('#btnPgReset').disabled = !on;
    KNOBS.forEach(function (kn) {
      var row = document.getElementById('pg-row-' + kn.k);
      if (row) row.classList.toggle('moved', Math.abs(pg.work[kn.k] - pg.base[kn.k]) > 1e-9);
    });
  }

  function renderPlayground(S, G, COL) {
    var host = $('#pgControls');
    if (!host) return;
    pg.m = operatingPoint(S);
    pg.base = JSON.parse(JSON.stringify(S.params));
    pg.work = JSON.parse(JSON.stringify(S.params));
    pg.zRange = null;

    host.innerHTML = KNOBS.map(function (kn) {
      return '<div class="pg-row" id="pg-row-' + kn.k + '">' +
        '<div class="pg-top"><span class="pg-lab">' + kn.lab + '</span>' +
        '<span class="pg-val" id="pg-val-' + kn.k + '">' + U.br(pg.work[kn.k], kn.dec) +
        (kn.unit ? '<em>' + kn.unit + '</em>' : '') + '</span></div>' +
        '<input type="range" id="pg-in-' + kn.k + '" min="' + kn.min + '" max="' + kn.max +
        '" step="' + kn.step + '" value="' + pg.work[kn.k] + '" aria-label="' + kn.lab + '">' +
        '<div class="pg-why">' + kn.why + '</div></div>';
    }).join('');

    KNOBS.forEach(function (kn) {
      var el = document.getElementById('pg-in-' + kn.k);
      el.addEventListener('input', function () {
        pg.work[kn.k] = parseFloat(el.value);
        var lab = document.getElementById('pg-val-' + kn.k);
        lab.innerHTML = U.br(pg.work[kn.k], kn.dec) + (kn.unit ? '<em>' + kn.unit + '</em>' : '');
        syncButtons();
        schedule(G, COL);
      });
    });

    $('#btnPgApply').onclick = function () {
      if (!ATC.App) return;
      var st = ATC.App.state();
      KNOBS.forEach(function (kn) { st.params[kn.k] = pg.work[kn.k]; });
      /* mexer na geometria invalida a calibracao anterior: ela foi
         ajustada contra outro nucleo                                */
      st.params.uaCalibrated = 0;
      ATC.App.recompute();
      if (ATC.Motion) ATC.Motion.toast('Parâmetros aplicados — a análise foi recalculada', null, 3000);
      if (ATC.Audio) ATC.Audio.play('relay');
    };
    $('#btnPgReset').onclick = function () {
      KNOBS.forEach(function (kn) {
        pg.work[kn.k] = pg.base[kn.k];
        var el = document.getElementById('pg-in-' + kn.k);
        if (el) el.value = pg.base[kn.k];
        var lab = document.getElementById('pg-val-' + kn.k);
        if (lab) lab.innerHTML = U.br(pg.base[kn.k], kn.dec) + (kn.unit ? '<em>' + kn.unit + '</em>' : '');
      });
      syncButtons();
      schedule(G, COL);
    };

    syncButtons();
    paintSurface(G, COL);
    paintOut(COL);
  }

  /* ============================================================
     Ponto de operacao medio da parte util da coleta
     ============================================================ */
  function operatingPoint(S) {
    var rows = S.proc.rows.filter(function (d) {
      return !d.warmup && isFinite(d.eps) && d.qMax > 500 && d.tStatFrac > 0.3;
    });
    if (!rows.length) rows = S.proc.rows;
    var m = {
      tHot: avg(rows, function (d) { return d.tHotIn; }),
      tAmb: avg(rows, function (d) { return d.tAmb; }),
      dT: avg(rows, function (d) { return d.dT; }),
      q: avg(rows, function (d) { return d.q; }),
      qMax: avg(rows, function (d) { return d.qMax; }),
      qGen: avg(rows, function (d) { return d.qGen; }),
      mdot: avg(rows, function (d) { return d.mdotCool; }),
      mdotAir: avg(rows, function (d) { return d.mdotAir; }),
      cp: avg(rows, function (d) { return d.cpCool; }),
      Ch: avg(rows, function (d) { return d.Ch; }),
      Cc: avg(rows, function (d) { return d.Cc; }),
      Cmin: avg(rows, function (d) { return d.Cmin; }),
      Cr: avg(rows, function (d) { return d.Cr; }),
      vFace: avg(rows, function (d) { return d.vFace; }),
      rpm: avg(rows, function (d) { return d.rpm; }),
      speed: avg(rows, function (d) { return d.speed; }),
      fan: avg(rows, function (d) { return d.fan; }),
      tStatFrac: avg(rows, function (d) { return d.tStatFrac; }),
      tAirOut: avg(rows, function (d) { return d.tAirOut; })
    };
    m.tCold = m.tHot - m.dT;
    m.cminSide = m.Ch <= m.Cc ? 'líquido' : 'ar';
    return m;
  }

  /* ============================================================
     Entrada do modulo
     ============================================================ */
  E.render = function (S, G, COL) {
    var has = !!(S.proc && S.sum && S.proc.rows.length);
    var empty = $('#exEmpty'), body = $('#exBody');
    if (empty) empty.hidden = has;
    if (body) body.hidden = !has;
    if (!has) return;

    var m = operatingPoint(S);
    renderCircuit(S, m);
    renderRatios(S, m, G, COL);
    renderSteps(S, m);
    renderResistances(S, m, G, COL);
    renderWhatIf(S, m, G, COL);
    renderPlayground(S, G, COL);
  };

  ATC.Explain = E;
})(window.ATC = window.ATC || {});
