/* ============================================================
   APEX — bancada de remapeamento (SPEED MODE)
   ------------------------------------------------------------
   Ficcao assumida. Nenhum destes mapas sai daqui, nenhum deles
   toca na analise termica e o Cruze da bancada continua sendo um
   1.8 aspirado. E uma homenagem ao universo de preparacao, no
   formato em que ele realmente acontece: uma tabela rotacao x
   carga que voce edita celula a celula e ve virar superficie.

   O que faz valer a brincadeira e o modelo por tras nao ser
   aleatorio. Combustivel, ignicao, pressao e AFR alvo entram numa
   conta com os mesmos compromissos do mundo real: avanco demais
   detona, mistura pobre em carga alta derrete, pressao sem
   combustivel nao vira potencia. Da para montar um missil — e da
   para fundir o motor, o que e metade da graca.
   ============================================================ */
(function (ATC) {
  'use strict';

  var TN = {};
  var U = ATC.U;
  var KEY = 'apex.tune';

  /* eixos da tabela: rotacao nas colunas, carga nas linhas */
  var RPM = [800, 1600, 2400, 3200, 4000, 4800, 5600, 6400];
  var LOAD = [20, 40, 60, 80, 90, 100];

  var MAPS = {
    fuel: {
      name: 'Combustível', unit: '%', dec: 0, min: 40, max: 340, step: 2,
      ramp: ['#0c0f14', '#1e242d', '#3d4553', '#7b8593', '#c2c8d4', '#e02b1d'],
      note: 'Massa injetada em relação ao que o ar que está entrando pede. O mapa de fábrica anda alguns por cento abaixo do ponto de melhor potência — é calibração de consumo. Subir daqui rende; exagerar afoga e rouba potência de volta.',
      base: function (rpm, load) { return 88 + 6 * (load / 100) + 4 * Math.sin(rpm / 1500); }
    },
    ign: {
      name: 'Ignição', unit: '° APMS', dec: 1, min: 0, max: 42, step: 0.5,
      ramp: ['#0c0f14', '#242a34', '#4e5765', '#98a1ae', '#d8a24a', '#ff3b30'],
      note: 'Avanço em graus antes do ponto morto superior. Mais avanço é mais potência até o limite de detonação — depois disso é prejuízo, e barulho de martelo.',
      base: function (rpm, load) { return 12 + 14 * (rpm / 6400) - 6 * (load / 100); }
    },
    boost: {
      name: 'Pressão', unit: 'bar', dec: 2, min: 0, max: 2.2, step: 0.05,
      ramp: ['#0a0d12', '#1c222b', '#3a4250', '#8e96a6', '#d64a35', '#ff5a2a'],
      note: 'Pressão de sobrealimentação. O Cruze da bancada é aspirado, então o mapa de fábrica é zero — a pressão aqui é a do turbo que existe só nesta tela. Cada bar acima da atmosférica quase dobra a massa de ar, e exige combustível na mesma proporção.',
      base: function () { return 0; }
    },
    afr: {
      name: 'AFR alvo', unit: ':1', dec: 1, min: 10, max: 16, step: 0.1,
      ramp: ['#e02b1d', '#a8523f', '#6d6a68', '#8e96a6', '#aeb6c4', '#5c6b7d'],
      note: 'Relação ar-combustível desejada. 12,5:1 é onde mora a potência; 14,7:1 economiza; abaixo de 11 lava o cilindro.',
      base: function (rpm, load) { return 14.7 - 2.4 * Math.pow(load / 100, 1.6); }
    }
  };

  /* Cada preset e um mapa que fecha: quem sobe pressao sobe
     combustivel na mesma proporcao e recua ignicao, senao detona.
     O trim f e o ajuste fino por cima disso — e o que sobra para
     alguem exagerar por conta propria.                            */
  var PRESETS = {
    stock:   { name: 'Original', f: 1.00, i: 1.00, b: 0.00, a: 0.0 },
    street:  { name: 'Rua',      f: 1.07, i: 1.12, b: 0.00, a: +0.2 },
    track:   { name: 'Pista',    f: 1.09, i: 1.16, b: 0.07, a: +0.1 },
    missile: { name: 'Míssil',   f: 1.11, i: 1.19, b: 0.12, a: 0.0 }
  };

  var P_ATM = 1.013;                      /* bar, pressao ambiente */
  /* calibrado para o mapa de fabrica fechar nos 140 cv / 179 N.m que
     a Chevrolet publica para o Cruze LT 1.8 a gasolina */
  var T_REF = 213;
  var state = null, open = 'fuel', sel = { i: 3, j: 4 };

  function blank(key) {
    var m = MAPS[key], out = [];
    for (var j = 0; j < LOAD.length; j++) {
      var row = [];
      for (var i = 0; i < RPM.length; i++) {
        row.push(U.clamp(m.base(RPM[i], LOAD[j]), m.min, m.max));
      }
      out.push(row);
    }
    return out;
  }

  function fresh() {
    return { fuel: blank('fuel'), ign: blank('ign'), boost: blank('boost'), afr: blank('afr') };
  }

  function ensure() {
    if (state) return state;
    state = fresh();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var v = JSON.parse(raw);
        Object.keys(MAPS).forEach(function (k) {
          if (v && Array.isArray(v[k]) && v[k].length === LOAD.length &&
              v[k][0] && v[k][0].length === RPM.length) state[k] = v[k];
        });
      }
    } catch (e) { /* armazenamento bloqueado: fica com o mapa de fabrica */ }
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function applyPreset(id) {
    var pr = PRESETS[id];
    if (!pr) return;
    ensure();
    /* o combustivel acompanha a razao de pressao que o preset pede */
    var rp = (P_ATM + pr.b) / P_ATM;
    state.fuel = blank('fuel').map(function (r) { return r.map(function (v) { return U.clamp(v * rp * pr.f, MAPS.fuel.min, MAPS.fuel.max); }); });
    state.ign = blank('ign').map(function (r) { return r.map(function (v) { return U.clamp(v * pr.i, MAPS.ign.min, MAPS.ign.max); }); });
    state.boost = blank('boost').map(function (r) { return r.map(function (v) { return U.clamp(v + pr.b, MAPS.boost.min, MAPS.boost.max); }); });
    state.afr = blank('afr').map(function (r) { return r.map(function (v) { return U.clamp(v + pr.a, MAPS.afr.min, MAPS.afr.max); }); });
    save();
  }

  /* ============================================================
     O motor de mentira
     ------------------------------------------------------------
     Uma conta simples com os compromissos certos. Cada fator vale
     1 quando o mapa esta no ponto e cai quando sai dele, e os dois
     modos de estragar tudo — detonacao e mistura pobre sob carga —
     tem consequencia, senao "mais avanco" seria sempre melhor e
     nao haveria o que ajustar.
     ============================================================ */
  function at(map, rpm, load) {
    /* interpolacao bilinear na tabela */
    var fi = 0, fj = 0;
    while (fi < RPM.length - 2 && RPM[fi + 1] < rpm) fi++;
    while (fj < LOAD.length - 2 && LOAD[fj + 1] < load) fj++;
    var tx = U.clamp((rpm - RPM[fi]) / (RPM[fi + 1] - RPM[fi]), 0, 1);
    var ty = U.clamp((load - LOAD[fj]) / (LOAD[fj + 1] - LOAD[fj]), 0, 1);
    return map[fj][fi] * (1 - tx) * (1 - ty) + map[fj][fi + 1] * tx * (1 - ty) +
           map[fj + 1][fi] * (1 - tx) * ty + map[fj + 1][fi + 1] * tx * ty;
  }

  TN.engine = function (rpm, load) {
    load = load === undefined ? 100 : load;
    var s = ensure();
    var fuel = at(s.fuel, rpm, load);
    var ign = at(s.ign, rpm, load);
    var boost = at(s.boost, rpm, load);
    var afr = at(s.afr, rpm, load);

    /* Curva do 1.8 Ecotec de verdade: pico de torque a 4.000 e pico de
       potencia perto de 6.200, com a queda depois do pico mais rapida
       do que a subida antes dele — que e como motor aspirado se
       comporta. Com o mapa de fabrica isto tem que dar os 140 cv e os
       179 N.m de catalogo; os numeros de folheto sao a unica ancora
       que esta tela tem com a realidade.                            */
    var x = rpm / 4000;
    var d = x - 1;
    var base = T_REF * (1 - (d < 0 ? 0.55 : 0.42) * d * d - 0.16 * Math.max(d, 0) * d * d);
    base = Math.max(base, 20);

    /* Pressao. A massa de ar escala com a razao de pressao, mas o
       torque nao acompanha na proporcao: o ar chega mais quente, a
       calibracao tem de recuar avanco e enriquecer, e o proprio turbo
       come parte do que produz. O expoente abaixo de 1 e o que impede
       a tela de prometer 200 cv num 1.8 com meio bar — que e o tipo
       de numero que so existe em anuncio.                          */
    var fPress = (P_ATM + boost) / P_ATM;
    var fBoost = Math.pow(fPress, 0.72);

    /* Combustivel. A melhor potencia nao esta no exato do ar: esta uns
       cinco por cento acima dele, porque o excesso resfria a camara e
       deixa avancar mais. O mapa de fabrica anda abaixo disso, entao
       ha o que ganhar subindo — e o que perder exagerando, que e o
       que faz esta tabela valer a pena mexer.                       */
    var need = 100 * fPress;
    var ratio = fuel / need;
    var fFuel = 1 - 2.2 * Math.pow(ratio - 1.05, 2);
    var lean = ratio < 0.90 && load > 70;

    /* Ignicao. O avanco de melhor rendimento nao e um numero so: sobe
       com a rotacao, porque ha menos tempo para queimar. O mapa de
       fabrica anda alguns graus abaixo dele — e por isso que remap de
       aspirado rende alguma coisa, e pouca: uns 5 a 8 %, nao 50.
       O limite de detonacao segue o mesmo caminho e desaba com a
       pressao, que e o que impede subir avanco e turbo juntos.      */
    var optIgn = 14 + 10 * (rpm / 6400);
    var knockLimit = 24 + 6 * (rpm / 6400) - 9 * boost;
    var fIgn = 1 - 0.0038 * Math.pow(ign - optIgn, 2);
    var knock = ign > knockLimit;
    if (knock) fIgn -= 0.05 * (ign - knockLimit);

    /* AFR: potencia mora perto de 12,5 */
    var fAfr = 1 - 0.035 * Math.pow(afr - 12.5, 2);

    var f = U.clamp(fFuel, 0.3, 1.2) * U.clamp(fIgn, 0.3, 1.15) * U.clamp(fAfr, 0.3, 1.05);
    var torque = base * fBoost * f;
    var power = torque * rpm / 7121;      // cv = N.m x rpm / 7121

    return {
      torque: torque, power: power, boost: boost, afr: afr, ign: ign, fuel: fuel,
      knock: knock, lean: lean, knockLimit: knockLimit,
      /* o calor rejeitado cresce junto: e o gancho com a parte seria */
      heatFactor: fPress * U.clamp(ratio, 0.8, 1.4)
    };
  };

  TN.sweep = function () {
    var out = [], best = { power: 0, rpm: 0 }, bestT = { torque: 0, rpm: 0 };
    var knock = 0, lean = 0, n = 0;
    for (var rpm = 1200; rpm <= 6400; rpm += 100) {
      var e = TN.engine(rpm, 100);
      out.push({ rpm: rpm, power: e.power, torque: e.torque, knock: e.knock, lean: e.lean });
      if (e.power > best.power) best = { power: e.power, rpm: rpm };
      if (e.torque > bestT.torque) bestT = { torque: e.torque, rpm: rpm };
      if (e.knock) knock++;
      if (e.lean) lean++;
      n++;
    }
    return {
      curve: out, peakPower: best, peakTorque: bestT,
      knockPct: 100 * knock / n, leanPct: 100 * lean / n
    };
  };

  TN.maps = MAPS;
  TN.presets = PRESETS;
  TN.rpmAxis = RPM;
  TN.loadAxis = LOAD;
  TN.state = ensure;
  TN.save = save;
  TN.applyPreset = applyPreset;
  TN.reset = function () { state = fresh(); save(); };
  /* o mapa de fabrica, para a tela poder mostrar a diferenca */
  TN.stock = function (k) { return blank(k); };
  /* copia inteira do estado, para desfazer e refazer */
  TN.snapshot = function () {
    ensure();
    var o = {};
    Object.keys(MAPS).forEach(function (k) {
      o[k] = state[k].map(function (r) { return r.slice(); });
    });
    return o;
  };
  TN.restore = function (snap) {
    if (!snap) return;
    ensure();
    Object.keys(MAPS).forEach(function (k) {
      if (snap[k]) state[k] = snap[k].map(function (r) { return r.slice(); });
    });
    save();
  };
  TN.openMap = function (k) { if (k) open = k; return open; };
  TN.sel = sel;
  TN.at = at;

  ATC.Tune = TN;
})(window.ATC = window.ATC || {});
