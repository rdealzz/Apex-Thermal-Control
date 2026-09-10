/* ============================================================
   Apex Thermal Control — interface e orquestracao
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U, T = ATC.Thermal, C = ATC.CsvIO, G = ATC.Charts, M = ATC.Model, D = ATC.Demo;
  var $ = U.$, $$ = U.$$;

  /* ============================================================
     Paleta das series
     ------------------------------------------------------------
     Duas paletas, uma por modo. O modo de trabalho e desenhado
     sobre papel claro e precisa de cores com peso suficiente para
     nao sumir; o speed mode e HUD sobre carbono e usa o vermelho
     so onde ha alarme de verdade. COL e mutado no lugar em vez de
     substituido, para que todo modulo que ja guardou a referencia
     continue vendo a paleta certa depois da troca.
     ============================================================ */
  var PALETTES = {
    work: {
      hot: '#d1592a', cold: '#2450e0', amb: '#9aa1b0', pred: '#7a4fd8',
      ok: '#0f8f62', warn: '#b0770d', crit: '#c72c1f', eps: '#b0770d',
      q: '#2450e0', qArea: 'rgba(36,80,224,.10)', rpm: '#7a4fd8', spd: '#0f8f62', load: '#b0770d',
      ua: '#2450e0', uaMod: '#9aa1b0', gen: '#d1592a', mark: '#0d0f14',
      grid: '#eceef3', ideal: '#c3c8d2', train: '#9aa1b0',
      epsFrom: '#e0c07a', dtFrom: '#efc4ae', uaFrom: '#a9beff', healthFrom: '#a5ddc6', critFrom: '#f0b3ac',
      resAir: '#2450e0', resWall: '#d9dce2', resCool: '#d1592a',
      zoneCold: '#e3e8fb', zoneOk: '#dff0e8', zoneWarn: '#f7ecd5', zoneCrit: '#f8dfdc',
      bandWarn: 'rgba(176,119,13,.08)',
      crCurve: ['#2450e0', '#0f8f62', '#b0770d', '#d1592a', '#c72c1f'],
      surfRamp: ['#10265f', '#1f6fb2', '#3aa6a0', '#8dbf4a', '#e6b13c', '#c9452a']
    },
    speed: {
      hot: '#ff7a3d', cold: '#12b6ff', amb: '#5a6376', pred: '#3ff0e0',
      ok: '#2fe08a', warn: '#ffb020', crit: '#ff3b30', eps: '#ffb020',
      q: '#12b6ff', qArea: 'rgba(18,182,255,.14)', rpm: '#3ff0e0', spd: '#2fe08a', load: '#ff8a1f',
      ua: '#12b6ff', uaMod: '#5a6376', gen: '#ff8a1f', mark: '#e9eef7',
      grid: '#161c27', ideal: '#333d4d', train: '#5a6376',
      epsFrom: '#8a5f10', dtFrom: '#8a3a18', uaFrom: '#0a4a6b', healthFrom: '#14653f', critFrom: '#7a1c16',
      resAir: '#12b6ff', resWall: '#5a6376', resCool: '#ff8a1f',
      zoneCold: '#123246', zoneOk: '#123f2e', zoneWarn: '#3e3216', zoneCrit: '#45191a',
      bandWarn: 'rgba(255,176,32,.10)',
      crCurve: ['#12b6ff', '#2fe08a', '#ffb020', '#ff8a1f', '#ff3b30'],
      surfRamp: ['#071b2e', '#0a6a9e', '#12b6ff', '#3ff0e0', '#ffb020', '#ff5a2a']
    }
  };
  var COL = {};
  function syncPalette() {
    var mode = document.documentElement.dataset.mode === 'speed' ? 'speed' : 'work';
    var src = PALETTES[mode];
    Object.keys(src).forEach(function (k) { COL[k] = src[k]; });
    return COL;
  }
  syncPalette();

  var S = {
    params: T.defaults(),
    obd: null, esp: null,
    rows: null, proc: null, sum: null,
    fit: null, alerts: null, anom: null, calib: null,
    meta: null, cursor: 0, playing: false, playTimer: null,
    log: []
  };

  /* ============================================================
     Parametros
     ============================================================ */
  var PARAM_GROUPS = [
    { title: 'Geometria do núcleo do radiador', note: 'Medir no radiador do veículo. É o que mais afeta o UA teórico.', items: [
      ['coreW', 'Largura do núcleo', 'm', 0.005],
      ['coreH', 'Altura do núcleo', 'm', 0.005],
      ['coreD', 'Profundidade do núcleo', 'm', 0.001],
      ['sigma', 'Razão de área livre σ', '–', 0.01],
      ['areaDens', 'Densidade de área — lado ar', 'm²/m³', 25],
      ['finEff', 'Eficiência da superfície aletada η_s', '–', 0.01],
      ['nTubes', 'Número de tubos planos', '–', 1],
      ['tubeW', 'Largura interna do tubo', 'm', 0.0005],
      ['tubeH', 'Altura interna do tubo', 'm', 0.0001],
      ['wallT', 'Espessura da parede', 'm', 0.0001],
      ['wallK', 'Condutividade do alumínio', 'W/(m·K)', 5]
    ] },
    { title: 'Lado ar', note: 'k_ram é a fração da velocidade do veículo que chega à face do núcleo — calibrável com anemômetro.', items: [
      ['kRam', 'Fração ram-air k_ram', '–', 0.01],
      ['vFan', 'Velocidade de face com ventilador', 'm/s', 0.1],
      ['cAir', 'Coeficiente C · Nu = C·Re^m·Pr^⅓', '–', 0.01],
      ['mAir', 'Expoente m', '–', 0.01],
      ['uaScale', 'Fator de calibração do UA', '–', 0.01]
    ] },
    { title: 'Lado líquido e termostato', note: 'A vazão da bomba é o parâmetro mais incerto: medir com vazonômetro quando possível.', items: [
      ['pumpDisp', 'Vazão por rotação do motor', 'L/rev', 0.002],
      ['tStatOpen', 'Início de abertura do termostato', '°C', 1],
      ['tStatFull', 'Abertura plena do termostato', '°C', 1],
      ['bypassMin', 'Fração mínima pelo radiador', '–', 0.01]
    ] },
    { title: 'Incerteza dos instrumentos', note: 'Semi-amplitude do erro (±) declarada pelo fabricante ou pela resolução. A plataforma trata cada uma como limite com distribuição retangular e usa o valor dividido por √3 como incerteza padrão, conforme o GUM.', items: [
      ['uTliq', 'Sensor de temperatura do líquido', '°C', 0.1],
      ['uTobd', 'Leitura de temperatura do OBD-II', '°C', 0.1],
      ['uTamb', 'Temperatura do ar de entrada', '°C', 0.1],
      ['uPumpRel', 'Vazão da bomba (relativa)', '–', 0.01],
      ['uAirRel', 'Vazão de ar na face (relativa)', '–', 0.01],
      ['uCpRel', 'Correlações de propriedade (relativa)', '–', 0.005]
    ] },
    { title: 'Perda de carga e acionamento', note: 'Usados no cálculo do custo de bombeamento e ventilação. A razão f/j típica de aletas persianadas fica entre 3 e 5.', items: [
      ['fjRatio', 'Razão f/j do lado ar', '–', 0.1],
      ['etaFan', 'Rendimento do eletroventilador', '–', 0.01],
      ['etaPump', 'Rendimento da bomba', '–', 0.01]
    ] },
    { title: 'Mapa térmico do motor', note: 'Usado para estimar o calor entregue ao líquido e fechar o balanço de energia.', items: [
      ['pEngMax', 'Potência máxima', 'W', 1000],
      ['rpmMax', 'Rotação de potência máxima', 'rpm', 100],
      ['idleHeat', 'Calor sem trabalho útil', 'W', 100],
      ['heatFrac', 'Calor ao líquido / potência de eixo', '–', 0.05],
      ['cTh', 'Capacidade térmica motor + líquido', 'J/K', 5000]
    ] },
    { title: 'Ambiente e limites', note: 'Curitiba fica a ~935 m: a pressão atmosférica média é próxima de 91 kPa, não 101 kPa.', items: [
      ['ambFromIat', 'T_amb = IAT − offset', '°C', 0.5],
      ['pAtm', 'Pressão atmosférica', 'Pa', 500],
      ['fanOn', 'Liga eletroventilador', '°C', 1],
      ['fanOff', 'Desliga eletroventilador', '°C', 1],
      ['tWarn', 'Limite de atenção', '°C', 1],
      ['tCrit', 'Limite crítico', '°C', 1],
      ['horizon', 'Horizonte de previsão', 's', 30],
      ['leadReq', 'Antecedência mínima exigida', 's', 30]
    ] }
  ];

  function renderParamForm() {
    var host = $('#paramForm');
    if (!host) return;
    host.innerHTML = '';
    PARAM_GROUPS.forEach(function (g) {
      var fs = U.el('fieldset');
      fs.appendChild(U.el('legend', null, g.title));
      if (g.note) { var n = U.el('p', 'hint', g.note); n.style.marginTop = '-4px'; fs.appendChild(n); }
      var grid = U.el('div', 'param-grid');
      g.items.forEach(function (it) {
        var key = it[0], lab = it[1], unit = it[2], step = it[3];
        var f = U.el('div', 'field');
        var l = U.el('label', 'fld');
        l.setAttribute('for', 'p-' + key);
        l.innerHTML = U.esc(lab) + ' <span class="unit">' + U.esc(unit) + '</span>';
        var i = U.el('input');
        i.type = 'number'; i.id = 'p-' + key; i.step = step;
        i.value = S.params[key];
        i.addEventListener('change', function () {
          var v = parseFloat(i.value);
          if (!isFinite(v)) return;
          S.params[key] = v;
          /* mexer na mao no fator de UA invalida a linha de base */
          if (key === 'uaScale') {
            S.params.uaCalibrated = 0;
            S.calib = null;
            var cn = $('#calibNote');
            if (cn) {
              cn.hidden = false; cn.className = 'note warn';
              cn.innerHTML = '<b>Fator de UA alterado manualmente.</b> A linha de base foi invalidada: ' +
                'o índice de saúde volta a ser apenas indicativo até nova calibração contra uma coleta com o radiador em bom estado.';
            }
          }
          persistParams(); syncParamInputs();
          if (S.rows) { recompute(); renderAll(); }
        });
        f.appendChild(l); f.appendChild(i); grid.appendChild(f);
      });
      fs.appendChild(grid); host.appendChild(fs);
    });
  }

  function persistParams() { U.store.set('params', S.params); }

  function syncParamInputs() {
    [['#inTWarn', 'tWarn'], ['#inTCrit', 'tCrit'], ['#inLead', 'leadReq'], ['#inHorizon', 'horizon']]
      .forEach(function (pair) {
        var e = $(pair[0]);
        if (e) e.value = S.params[pair[1]];
      });
    PARAM_GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        var e = $('#p-' + it[0]);
        if (e) e.value = S.params[it[0]];
      });
    });
  }

  /* ============================================================
     Abas
     ============================================================ */
  var shuttle = null;

  function setTab(name) {
    /* as abas exclusivas do speed mode nao existem no modo de
       trabalho: cair numa delas depois de sair volta ao painel  */
    var btn = $('nav.tabs button[data-tab="' + name + '"]');
    if (!btn || (btn.classList.contains('speed-only') && document.documentElement.dataset.mode !== 'speed')) {
      name = 'painel';
    }
    $$('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    $$('section.tab').forEach(function (s) { s.hidden = s.id !== 'tab-' + name; });
    U.store.set('tab', name);
    if (shuttle) shuttle.sync();
    if (ATC.Audio) ATC.Audio.play('tick');
    setTimeout(G.redrawAll, 30);
    if (window.scrollY > 4) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     Registro de importacao
     ============================================================ */
  function logLine(msg, lvl) {
    S.log.push({ msg: msg, lvl: lvl || 'dim' });
    var box = $('#importLog');
    if (box) {
      box.innerHTML = S.log.map(function (l) {
        return '<span class="' + l.lvl + '">' + U.esc(l.msg) + '</span>';
      }).join('\n');
      box.scrollTop = box.scrollHeight;
    }
  }

  /* ============================================================
     Importacao de arquivos
     ============================================================ */
  function readFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(null, String(fr.result)); };
    fr.onerror = function () { cb(new Error('Falha ao ler o arquivo.')); };
    fr.readAsText(file, 'UTF-8');
  }

  function handleFile(kind, file) {
    if (!file) return;
    readFile(file, function (err, text) {
      if (err) { logLine('ERRO: ' + err.message, 'err'); return; }
      var parsed = C.parse(text);
      if (!parsed.header.length) { logLine('ERRO: arquivo sem cabeçalho reconhecível.', 'err'); return; }
      var map = C.autoMap(parsed.header);
      var store = { parsed: parsed, map: map, name: file.name, size: file.size };
      if (kind === 'obd') S.obd = store; else S.esp = store;

      var info = $(kind === 'obd' ? '#dzObdInfo' : '#dzEspInfo');
      if (info) info.textContent = file.name + ' — ' + parsed.rows.length + ' linhas, ' + parsed.header.length + ' colunas';
      logLine('Arquivo ' + (kind === 'obd' ? 'OBD-II' : 'do logger') + ' lido: ' + file.name +
              ' (' + parsed.rows.length + ' linhas, separador "' + parsed.delim.replace('\t', 'TAB') + '")', 'ok');
      S.meta = null;
      buildMapUI();
      $('#mapCard').hidden = false;
      autoSync();
    });
  }

  function buildMapUI() {
    ['obd', 'esp'].forEach(function (kind) {
      var host = $(kind === 'obd' ? '#mapObd' : '#mapEsp');
      if (!host) return;
      host.innerHTML = '';
      var st = kind === 'obd' ? S.obd : S.esp;
      if (!st) { host.innerHTML = '<p class="hint">Nenhum arquivo carregado.</p>'; return; }
      C.FIELDS.forEach(function (f) {
        var wrap = U.el('div', 'field');
        var l = U.el('label', 'fld');
        l.innerHTML = U.esc(f.label) + ' <span class="unit">' + U.esc(f.unit) + '</span>' +
                      (f.req && kind === 'obd' ? ' <span style="color:var(--hot)">*</span>' : '');
        var sel = U.el('select');
        var opt0 = U.el('option', null, '— não usar —');
        opt0.value = '-1'; sel.appendChild(opt0);
        st.parsed.header.forEach(function (h, i) {
          var o = U.el('option', null, h || ('coluna ' + (i + 1)));
          o.value = String(i);
          if (st.map[f.key] === i) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { st.map[f.key] = parseInt(sel.value, 10); });
        wrap.appendChild(l); wrap.appendChild(sel); host.appendChild(wrap);
      });
    });
  }

  /* alinha as duas fontes assumindo inicio simultaneo de gravacao */
  function autoSync() {
    if (!S.obd || !S.esp) return;
    var o = C.extract(S.obd.parsed, S.obd.map).rows;
    var e = C.extract(S.esp.parsed, S.esp.map).rows;
    if (!o.length || !e.length) return;
    var off = Math.round(o[0].time - e[0].time);
    var inp = $('#syncOffset');
    if (inp) inp.value = off;
    logLine('Offset de sincronização estimado: ' + off + ' s (início simultâneo das gravações).', 'dim');
  }

  /* ============================================================
     Processamento
     ============================================================ */
  function processData() {
    if (!S.obd && !S.esp) { logLine('Nada para processar.', 'warn'); return; }

    var rowsObd = [], rowsEsp = [];
    if (S.obd) {
      var xo = C.extract(S.obd.parsed, S.obd.map);
      xo.warns.forEach(function (w) { logLine('OBD-II: ' + w, 'warn'); });
      rowsObd = xo.rows;
      C.fillGaps(rowsObd, ['ect', 'rpm', 'speed', 'load', 'iat', 'tAmb'], 8);
    }
    if (S.esp) {
      var xe = C.extract(S.esp.parsed, S.esp.map);
      xe.warns.forEach(function (w) { logLine('Logger: ' + w, 'warn'); });
      rowsEsp = xe.rows;
      C.fillGaps(rowsEsp, ['tIn', 'tOut', 'tAmb'], 8);
    }

    var merged;
    if (rowsObd.length && rowsEsp.length) {
      var off = parseFloat($('#syncOffset').value) || 0;
      var tol = parseFloat($('#syncTol').value) || 2;
      var mg = C.merge(rowsObd, rowsEsp, off, tol);
      mg.log.forEach(function (l) { logLine(l, /ATEN/.test(l) ? 'warn' : 'ok'); });
      merged = mg.rows;
    } else {
      merged = rowsObd.length ? rowsObd : rowsEsp;
      if (!rowsObd.length) logLine('Somente o arquivo do logger foi carregado: sem RPM e velocidade o cálculo de vazão fica indisponível.', 'warn');
    }
    finishLoad(merged, S.meta || { name: (S.obd && S.obd.name) || (S.esp && S.esp.name) || 'Coleta importada', demo: false });
  }

  /* normaliza tempo para segundos desde o inicio e carrega */
  function finishLoad(rows, meta) {
    if (!rows || !rows.length) { logLine('ERRO: nenhuma amostra válida após o processamento.', 'err'); return; }
    var t0 = rows[0].time !== undefined ? rows[0].time : rows[0].t;
    S.rows = rows.map(function (r) {
      var abs = r.time !== undefined ? r.time : r.t;
      var o = {
        t: abs - t0, ts: r.ts || (abs > 1e8 ? new Date(abs * 1000) : null),
        ect: r.ect, rpm: r.rpm, speed: r.speed, load: r.load,
        iat: r.iat, tAmb: r.tAmb, tIn: r.tIn, tOut: r.tOut, fan: r.fan
      };
      return o;
    });
    S.meta = meta;
    S.fit = null; S.alerts = null; S.anom = null;
    recompute();

    var a = C.audit(S.rows.map(function (r) { return { time: r.t, ect: r.ect, rpm: r.rpm, speed: r.speed, load: r.load, iat: r.iat, tAmb: r.tAmb, tIn: r.tIn, tOut: r.tOut }; }));
    renderAudit(a);
    logLine('Coleta processada: ' + S.rows.length + ' amostras, ' + U.mmss(a.duration) + ' de duração, modo ' +
            (S.proc.mode === 'exp' ? 'EXPERIMENTAL (ΔT medido)' : 'MODELO (estimado)') + '.', 'ok');
    $('#auditCard').hidden = false;
    renderAll();
  }

  function recompute() {
    S.proc = T.process(S.rows, S.params);
    S.sum = T.summary(S.proc);
    S.anom = M.anomalies(S.proc);
    S.cursor = S.proc.rows.length - 1;
  }

  /* ============================================================
     Coleta de demonstracao
     ============================================================ */
  function loadDemo(id) {
    var ds = D.generate(id);
    S.obd = null; S.esp = null;
    $('#dzObdInfo').textContent = ''; $('#dzEspInfo').textContent = '';
    $('#mapCard').hidden = true;
    S.log = [];
    logLine('Coleta de demonstração gerada: ' + ds.meta.name, 'ok');
    logLine('ATENÇÃO: dados sintéticos, produzidos por simulação física. Não são medições do veículo.', 'warn');
    logLine('Parâmetros da simulação: T_amb ' + U.br(ds.meta.tAmb, 0) + ' °C, fator de UA ' +
            U.br(ds.meta.uaScaleSim, 2) + ', ventilador ' + U.br(ds.meta.vFanSim, 2) + ' m/s.', 'dim');
    finishLoad(ds.rows.map(function (r) {
      return { time: r.t, ts: r.ts, ect: r.ect, rpm: r.rpm, speed: r.speed, load: r.load,
               iat: r.iat, tAmb: r.tAmb, tIn: r.tIn, tOut: r.tOut, fan: r.fan };
    }), ds.meta);
  }

  function downloadDemo(id) {
    var ds = D.generate(id);
    U.download('apex_' + id + '_obd2.csv', D.toCsvObd(ds), 'text/csv;charset=utf-8');
    setTimeout(function () {
      U.download('apex_' + id + '_logger_temperatura.csv', D.toCsvEsp(ds), 'text/csv;charset=utf-8');
    }, 700);
  }

  ATC.App = { S: S, setTab: setTab, recompute: recompute, logLine: logLine };

  /* ============================================================
     Blocos de KPI
     ============================================================ */
  function kpi(lab, val, unit, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '">' +
      '<div class="k-lab">' + U.esc(lab) + '</div>' +
      '<div class="k-val">' + val + (unit ? '<small>' + U.esc(unit) + '</small>' : '') + '</div>' +
      '<div class="k-sub">' + (sub || '') + '</div></div>';
  }

  function tempClass(t) {
    if (!isFinite(t)) return 'mut';
    if (t >= S.params.tCrit) return 'crit';
    if (t >= S.params.tWarn) return 'hot';
    if (t >= S.params.tStatOpen) return 'ok';
    return 'mut';
  }

  /* ============================================================
     Cabecalho
     ============================================================ */
  function renderHeader() {
    var li = $('#loadedInfo');
    if (li) {
      li.textContent = S.proc
        ? 'Carregado: ' + (S.meta ? S.meta.name : 'coleta') + ' — ' + S.proc.rows.length + ' amostras'
        : 'Nenhuma coleta carregada.';
    }
    var n = $('#dsName'), b = $('#modeBadge'), isl = $('#island');
    if (n) n.textContent = S.meta ? S.meta.name : 'Nenhuma coleta carregada';
    if (b) {
      if (!S.proc) b.textContent = 'sem dados';
      else if (S.proc.mode === 'exp') b.textContent = S.proc.rows.length + ' amostras · ΔT medido';
      else b.textContent = S.proc.rows.length + ' amostras · ΔT estimado';
    }
    if (isl) {
      isl.className = 'island' + (S.proc ? (S.meta && S.meta.demo ? ' demo' : ' live') : '');
      isl.title = S.proc
        ? (S.proc.mode === 'exp' ? 'Modo experimental — o ΔT vem dos sensores' : 'Modo modelo — o ΔT é estimado pelas correlações')
        : 'Nenhuma coleta carregada';
    }
  }

  /* ============================================================
     PAINEL
     ============================================================ */
  function renderPainel() {
    var has = !!(S.proc && S.proc.rows.length);
    $('#painelEmpty').hidden = has;
    $('#painelBody').hidden = !has;
    $('#demoBanner').hidden = !(has && S.meta && S.meta.demo);
    if (has && S.meta && S.meta.demo) {
      $('#demoBannerTxt').textContent = S.meta.desc + ' Os dados foram gerados por simulação física, não são medição real do veículo.';
    }
    if (!has) return;

    var cb = $('#calibBanner');
    if (cb) {
      var pend = !S.params.uaCalibrated && S.proc.mode === 'exp';
      cb.hidden = !pend;
    }

    var rows = S.proc.rows, p = S.params;
    var hz = $('#hzLabel');
    if (hz) hz.textContent = '+' + U.br(p.horizon / 60, p.horizon % 60 ? 1 : 0) + ' min';

    /* ---- grafico de temperaturas ---- */
    var sTemp = [
      { name: 'T entrada do radiador', color: COL.hot, width: 2,
        data: rows.map(function (d) { return [d.t, d.tHotIn]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' °C'; } }
    ];
    if (S.proc.mode === 'exp') {
      sTemp.push({ name: 'T saída do radiador', color: COL.cold, width: 1.8,
        data: rows.map(function (d) { return [d.t, d.tOut]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' °C'; } });
    } else {
      sTemp.push({ name: 'T saída (estimada)', color: COL.cold, width: 1.6, dash: true,
        data: rows.map(function (d) { return [d.t, d.tOutEst]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' °C'; } });
    }
    sTemp.push({ name: 'T ambiente', color: COL.amb, width: 1.4,
      data: rows.map(function (d) { return [d.t, d.tAmb]; }),
      tipFmt: function (v) { return U.br(v, 1) + ' °C'; } });
    if (S.fit && S.fit.ok) {
      sTemp.push({ name: 'Previsão da IA', color: COL.pred, width: 1.8, dash: [6, 4],
        data: S.fit.series.map(function (s) { return [s.tTarget, s.pred]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' °C'; } });
    }
    G.update($('#chartTemp'), {
      height: 320, series: sTemp, xFmt: U.mmss, yFmt: function (v) { return U.br(v, 0); },
      xLabel: 'tempo de coleta (mm:ss)', yLabel: 'temperatura (°C)',
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); },
      cursorX: rows[S.cursor] ? rows[S.cursor].t : undefined,
      yBands: [
        { y0: p.tWarn, y1: p.tCrit, color: COL.bandWarn },
        { y0: p.tCrit, y1: 200, color: 'rgba(255,59,48,.10)' }
      ],
      hlines: [
        { y: p.tWarn, color: COL.warn, label: 'atenção ' + U.br(p.tWarn, 0) + ' °C' },
        { y: p.tCrit, color: COL.crit, label: 'crítico ' + U.br(p.tCrit, 0) + ' °C' }
      ],
      onHover: function (x) { setCursorByTime(x, false); },
      onClick: function (x) { setCursorByTime(x, true); }
    });
    legend('#legTemp', sTemp);

    /* ---- calor e efetividade ---- */
    var sQ = [
      { name: 'Calor rejeitado Q̇', color: COL.q, width: 1.8, axis: 'l', area: COL.qArea,
        data: rows.map(function (d) { return [d.t, d.q / 1000]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' kW'; } },
      { name: 'Efetividade ε', color: COL.eps, width: 1.6, axis: 'r',
        data: rows.map(function (d) { return [d.t, d.warmup ? NaN : d.eps]; }),
        tipFmt: function (v) { return U.br(v, 3); } }
    ];
    G.update($('#chartQ'), {
      height: 250, series: sQ, xFmt: U.mmss,
      xLabel: 'tempo (mm:ss)', yLabel: 'potência térmica (kW)', yLabelRight: 'efetividade ε (–)',
      yMin: 0, yMinRight: 0, yMaxRight: 1,
      yFmtRight: function (v) { return U.br(v, 2); },
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); },
      cursorX: rows[S.cursor] ? rows[S.cursor].t : undefined
    });
    legend('#legQ', sQ);

    /* ---- condicao de operacao ---- */
    var sOp = [
      { name: 'Rotação', color: COL.rpm, width: 1.5, axis: 'l',
        data: rows.map(function (d) { return [d.t, d.rpm]; }),
        tipFmt: function (v) { return U.br(v, 0) + ' rpm'; } },
      { name: 'Velocidade', color: COL.spd, width: 1.7, axis: 'r',
        data: rows.map(function (d) { return [d.t, d.speed]; }),
        tipFmt: function (v) { return U.br(v, 0) + ' km/h'; } },
      { name: 'Carga do motor', color: COL.load, width: 1.3, axis: 'r',
        data: rows.map(function (d) { return [d.t, d.load]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' %'; } },
      { name: 'Ventilador', color: COL.hot, width: 1.2, axis: 'r', step: true,
        data: rows.map(function (d) { return [d.t, d.fan >= 0.5 ? 115 : 0]; }),
        tipFmt: function (v) { return v > 50 ? 'ligado' : 'desligado'; } }
    ];
    G.update($('#chartOp'), {
      height: 250, series: sOp, xFmt: U.mmss,
      xLabel: 'tempo (mm:ss)', yLabel: 'rotação (rpm)', yLabelRight: 'velocidade (km/h) · carga (%)',
      yMin: 0, yMinRight: 0, yMaxRight: 125,
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); },
      cursorX: rows[S.cursor] ? rows[S.cursor].t : undefined
    });
    legend('#legOp', sOp);

    var sc = $('#scrub');
    if (sc) { sc.max = String(rows.length - 1); sc.value = String(S.cursor); }
    renderInstant();
  }

  /* limite superior robusto para eixos: evita que um pico transitorio
     de aceleracao comprima todo o resto do grafico                     */
  function capMax(vals, q) {
    var v = vals.filter(isFinite);
    if (!v.length) return undefined;
    var hi = U.percentile(v, q === undefined ? 0.99 : q);
    return isFinite(hi) ? hi * 1.08 : undefined;
  }

  /* media movel temporal de uma grandeza da serie processada */
  function movAvg(rows, key, win) {
    var vals = rows.map(function (d) { return d[key]; });
    var n = Math.max(3, Math.round(win / Math.max(1, (rows[rows.length - 1].t - rows[0].t) / rows.length)));
    return U.smooth(vals, n);
  }

  function legend(sel, series) {
    var e = $(sel);
    if (!e) return;
    e.innerHTML = series.map(function (s) {
      var sw = s.dash
        ? 'background:repeating-linear-gradient(90deg,' + s.color + ' 0 4px,transparent 4px 7px)'
        : (s.type === 'scatter'
            ? 'background:' + s.color + ';height:7px;width:7px;border-radius:50%'
            : 'background:' + s.color);
      return '<span><i style="' + sw + '"></i>' +
             '<span style="color:var(--ink-2)">' + U.esc(s.name) + '</span></span>';
    }).join('');
  }

  function setCursorByTime(x, force) {
    if (!S.proc) return;
    var rows = S.proc.rows, bi = 0, bd = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var d = Math.abs(rows[i].t - x);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi === S.cursor && !force) return;
    S.cursor = bi;
    var sc = $('#scrub');
    if (sc) sc.value = String(bi);
    renderInstant();
    renderGauges();
  }

  /* ---- estado do instante selecionado ---- */
  function renderInstant() {
    if (!S.proc) return;
    var d = S.proc.rows[S.cursor];
    if (!d) return;
    var rows = S.proc.rows;
    var dur = rows[rows.length - 1].t;
    var st = $('#scrubT');
    if (st) st.textContent = U.mmss(d.t) + ' / ' + U.mmss(dur);

    var reg = $('#instRegime');
    if (reg) {
      reg.textContent = d.regime + (d.warmup ? ' · aquecimento' : '') + (d.fan >= 0.5 ? ' · ventilador ligado' : '');
      reg.className = 'badge ' + (d.warmup ? '' : 'info');
    }

    /* previsao valida para este instante */
    var pred = null;
    if (S.fit && S.fit.ok) {
      var best = null, bd = Infinity;
      S.fit.series.forEach(function (s) {
        var dd = Math.abs(s.tNow - d.t);
        if (dd < bd) { bd = dd; best = s; }
      });
      if (best && bd < 5) pred = best;
    }

    /* KPIs do painel */
    var kr = $('#kpiRow');
    if (kr) {
      var h = '';
      h += kpi('Temp. do líquido', U.br(d.tHotIn, 1), '°C',
        (isFinite(d.dTdt) ? (d.dTdt >= 0 ? '↑ ' : '↓ ') + U.br(Math.abs(d.dTdt), 2) + ' °C/min' : ''), tempClass(d.tHotIn));
      h += kpi('Previsão +' + U.br(S.params.horizon / 60, 0) + ' min',
        pred ? U.br(pred.pred, 1) : '--', '°C',
        pred ? (pred.delta >= 0 ? '+' : '') + U.br(pred.delta, 1) + ' °C em ' + U.mmss(S.params.horizon)
             : (S.fit && S.fit.ok ? 'sem alvo conhecido no fim da coleta' : 'treine o modelo na aba IA'),
        pred ? tempClass(pred.pred) : 'mut');
      h += kpi('Efetividade ε', d.warmup ? '--' : U.br(d.eps, 3), '',
        d.warmup ? 'termostato fechado' : 'NTU ' + U.br(d.ntu, 2) + ' · C_r ' + U.br(d.Cr, 2),
        d.warmup ? 'mut' : (d.eps >= 0.4 ? 'ok' : 'warn'));
      h += kpi('Calor rejeitado', U.br(d.q / 1000, 1), 'kW',
        'ΔT ' + U.br(d.dT, 1) + ' °C · ' + U.br(d.vdotCool, 0) + ' L/min', 'ok');
      h += kpi('UA', U.br(d.ua, 0), 'W/K', 'teórico ' + U.br(d.uaModel, 0) + ' W/K', 'ok');
      var cal = !!S.params.uaCalibrated;
      var hs = d.healthValid ? d.healthSmooth : NaN;
      h += kpi('Saúde do radiador', isFinite(hs) ? U.br(hs * 100, 0) : '--', '%',
        !d.healthValid ? (d.warmup ? 'aquecimento — sem vazão pelo radiador' : 'termostato quase fechado — fora da faixa de validade')
          : cal ? 'mediana móvel de UA medido ÷ previsto' : 'sem linha de base — calibre na aba Análise',
        !isFinite(hs) ? 'mut' : !cal ? 'mut' : (hs >= 0.9 ? 'ok' : hs >= 0.8 ? 'warn' : 'crit'));
      var alerta = statusAt(d, pred);
      h += kpi('Situação', alerta.txt, '', alerta.sub, alerta.cls);
      kr.innerHTML = h;
    }

    /* tabela detalhada */
    var tb = $('#tblInstant');
    if (tb) {
      var items = [
        ['Tempo de coleta', U.mmss(d.t), d.ts ? d.ts.toLocaleTimeString('pt-BR') : ''],
        ['Temperatura de entrada do radiador', U.br(d.tHotIn, 2) + ' °C', S.proc.mode === 'exp' ? 'DS18B20 na mangueira superior' : 'PID 0105 (ECT)'],
        ['Temperatura de saída do radiador', U.br(S.proc.mode === 'exp' ? d.tOut : d.tOutEst, 2) + ' °C', S.proc.mode === 'exp' ? 'DS18B20 na mangueira inferior' : 'estimada pelo modelo'],
        ['Queda de temperatura ΔT', U.br(d.dT, 2) + ' °C', 'no radiador'],
        ['Temperatura do ar na entrada', U.br(d.tAmb, 2) + ' °C', d.ambEstimated ? 'estimada a partir da IAT' : 'medida'],
        ['Rotação do motor', U.br(d.rpm, 0) + ' rpm', 'PID 010C'],
        ['Velocidade', U.br(d.speed, 0) + ' km/h', 'PID 010D'],
        ['Carga do motor', U.br(d.load, 1) + ' %', 'PID 0104'],
        ['Eletroventilador', d.fan >= 0.5 ? 'ligado' : 'desligado', d.fanInferred ? 'inferido por histerese' : 'medido'],
        ['Abertura do termostato', U.br(d.tStatFrac * 100, 0) + ' %', 'modelo de smoothstep entre ' + U.br(S.params.tStatOpen, 0) + ' e ' + U.br(S.params.tStatFull, 0) + ' °C'],
        ['Vazão do líquido', U.br(d.vdotCool, 1) + ' L/min', U.br(d.mdotCool, 3) + ' kg/s'],
        ['Velocidade de face do ar', U.br(d.vFace, 2) + ' m/s', U.br(d.mdotAir, 3) + ' kg/s'],
        ['Capacidade térmica — líquido', U.br(d.Ch, 0) + ' W/K', 'C_h'],
        ['Capacidade térmica — ar', U.br(d.Cc, 0) + ' W/K', 'C_c'],
        ['C_mín / C_r', U.br(d.Cmin, 0) + ' W/K · ' + U.br(d.Cr, 3), 'lado limitante: ' + d.cminSide],
        ['Calor máximo possível', U.br(d.qMax / 1000, 1) + ' kW', 'C_mín·(T_h,ent − T_c,ent)'],
        ['Calor rejeitado', U.br(d.q / 1000, 2) + ' kW', S.proc.mode === 'exp' ? 'balanço de energia' : 'modelo ε–NTU'],
        ['Calor gerado pelo motor', U.br(d.qGen / 1000, 2) + ' kW', 'mapa carga × rotação'],
        ['Efetividade ε', U.br(d.eps, 4), 'Q̇ / Q̇_máx'],
        ['NTU', U.br(d.ntu, 3), 'invertido de ε'],
        ['UA experimental', U.br(d.ua, 0) + ' W/K', 'NTU · C_mín'],
        ['Índice de saúde (mediana móvel)', d.healthValid && isFinite(d.healthSmooth) ? U.br(d.healthSmooth * 100, 0) + ' %' : '—',
          d.healthValid ? (S.params.uaCalibrated ? 'contra a linha de base calibrada' : 'sem linha de base — apenas indicativo')
                        : 'fora da faixa de validade do modelo'],
        ['UA pelas correlações', U.br(d.uaModel, 0) + ' W/K', 'resistências em série · ' + U.br(d.shareAir * 100, 0) + ' % no lado ar'],
        ['h — lado ar', U.br(d.hAir, 0) + ' W/(m²·K)', 'Re ' + U.br(d.reAir, 0) + ' · Nu ' + U.br(d.nuAir, 1)],
        ['h — lado líquido', U.br(d.hCool, 0) + ' W/(m²·K)', 'Re ' + U.br(d.reCool, 0) + ' · Nu ' + U.br(d.nuCool, 1)]
      ];
      tb.innerHTML = '<thead><tr><th>Grandeza</th><th class="num">Valor</th><th>Origem / observação</th></tr></thead><tbody>' +
        items.map(function (r) {
          return '<tr><td>' + U.esc(r[0]) + '</td><td class="num">' + U.esc(r[1]) + '</td><td style="color:var(--ink-4)">' + U.esc(r[2]) + '</td></tr>';
        }).join('') + '</tbody>';
    }
    renderGauges();
  }

  function statusAt(d, pred) {
    var p = S.params;
    if (d.tHotIn >= p.tCrit) return { txt: 'CRÍTICO', sub: 'limite crítico atingido', cls: 'crit' };
    if (pred && pred.pred >= p.tCrit) return { txt: 'ALERTA', sub: 'previsão cruza o limite crítico', cls: 'crit' };
    if (d.tHotIn >= p.tWarn) return { txt: 'ATENÇÃO', sub: 'acima do limite de atenção', cls: 'hot' };
    if (pred && pred.pred >= p.tWarn) return { txt: 'ATENÇÃO', sub: 'previsão cruza o limite de atenção', cls: 'warn' };
    if (S.params.uaCalibrated && d.healthValid && isFinite(d.healthSmooth) && d.healthSmooth < 0.8)
      return { txt: 'DEGRADADO', sub: 'desempenho do radiador abaixo do previsto', cls: 'warn' };
    if (d.warmup) return { txt: 'AQUECENDO', sub: 'termostato ainda fechado', cls: 'mut' };
    return { txt: 'NORMAL', sub: 'dentro da faixa de operação', cls: 'ok' };
  }

  function renderGauges() {
    if (!S.proc) return;
    var d = S.proc.rows[S.cursor], p = S.params;
    if (!d) return;
    G.gauge($('#gaugeEct'), {
      height: 186, value: d.tHotIn, min: 20, max: 120, unit: '°C do líquido', dec: 1,
      label: 'TEMPERATURA DO LÍQUIDO',
      color: d.tHotIn >= p.tCrit ? COL.crit : d.tHotIn >= p.tWarn ? COL.warn : COL.cold,
      zones: [{ to: p.tStatOpen, color: COL.zoneCold }, { to: p.tWarn, color: COL.zoneOk },
              { to: p.tCrit, color: COL.zoneWarn }, { to: 120, color: COL.zoneCrit }]
    });
    G.gauge($('#gaugeEps'), {
      height: 186, value: d.warmup ? NaN : d.eps, min: 0, max: 1, unit: 'efetividade ε', dec: 3, decScale: 1,
      label: 'EFETIVIDADE DO RADIADOR', color: COL.eps,
      zones: [{ to: 0.4, color: COL.zoneWarn }, { to: 0.7, color: COL.zoneOk }, { to: 1, color: COL.zoneCold }]
    });
    var calH = !!S.params.uaCalibrated;
    var hv = d.healthValid ? d.healthSmooth : NaN;
    G.gauge($('#gaugeHealth'), {
      height: 186, value: isFinite(hv) ? hv * 100 : NaN, min: 0, max: 120, unit: '% do previsto', dec: 0,
      label: !d.healthValid ? 'SAÚDE — FORA DA FAIXA' : (calH ? 'SAÚDE DO RADIADOR' : 'SAÚDE — SEM LINHA DE BASE'),
      color: !isFinite(hv) || !calH ? COL.amb : hv >= 0.9 ? COL.ok : hv >= 0.8 ? COL.warn : COL.crit,
      zones: [{ to: 80, color: COL.zoneCrit }, { to: 90, color: COL.zoneWarn }, { to: 120, color: COL.zoneOk }]
    });
  }

  /* ---- reproducao da coleta ---- */
  function togglePlay() {
    S.playing = !S.playing;
    var b = $('#btnPlay');
    if (b) b.textContent = S.playing ? '⏸ Pausar' : '▶ Reproduzir coleta';
    if (S.playTimer) { clearInterval(S.playTimer); S.playTimer = null; }
    if (!S.playing || !S.proc) return;
    if (S.cursor >= S.proc.rows.length - 1) S.cursor = 0;
    S.playTimer = setInterval(function () {
      var step = Math.max(1, Math.round(S.proc.rows.length / 220));
      S.cursor += step;
      if (S.cursor >= S.proc.rows.length - 1) {
        S.cursor = S.proc.rows.length - 1;
        togglePlay();
      }
      var sc = $('#scrub');
      if (sc) sc.value = String(S.cursor);
      renderInstant();
      G.update($('#chartTemp'), Object.assign({}, $('#chartTemp').__atcCfg, { cursorX: S.proc.rows[S.cursor].t }));
      G.update($('#chartQ'), Object.assign({}, $('#chartQ').__atcCfg, { cursorX: S.proc.rows[S.cursor].t }));
      G.update($('#chartOp'), Object.assign({}, $('#chartOp').__atcCfg, { cursorX: S.proc.rows[S.cursor].t }));
    }, 55);
  }

  /* ============================================================
     Qualidade da base
     ============================================================ */
  function renderAudit(a) {
    var k = $('#auditKpis');
    if (k) {
      k.innerHTML =
        kpi('Amostras', U.br(a.n, 0), '', 'linhas válidas', 'ok') +
        kpi('Duração', U.mmss(a.duration), '', 'da sessão', 'ok') +
        kpi('Taxa média', U.br(a.rate, 2), 'Hz', 'intervalo mediano ' + U.br(a.dtMedian, 2) + ' s', a.rate >= 0.5 ? 'ok' : 'warn') +
        kpi('Lacunas', U.br(a.gaps, 0), '', 'intervalos anômalos', a.gaps ? 'warn' : 'ok');
    }
    var iss = $('#auditIssues');
    if (iss) {
      iss.innerHTML = a.issues.map(function (i) {
        var cls = i.lvl === 'err' ? 'note hot' : i.lvl === 'warn' ? 'note warn' : 'note';
        var ico = i.lvl === 'err' ? '✕ ' : i.lvl === 'warn' ? '⚠ ' : '✓ ';
        return '<div class="' + cls + '">' + ico + U.esc(i.msg) + '</div>';
      }).join('');
    }
    var cov = $('#tblCoverage');
    if (cov) {
      var LAB = { ect: 'Temp. do líquido (ECT)', rpm: 'Rotação', speed: 'Velocidade', load: 'Carga do motor',
                  iat: 'Temp. ar de admissão', tAmb: 'Temp. ambiente', tIn: 'T entrada do radiador', tOut: 'T saída do radiador' };
      cov.innerHTML = '<thead><tr><th>Variável</th><th class="num">Cobertura</th><th class="num">Mín</th><th class="num">Média</th><th class="num">Máx</th></tr></thead><tbody>' +
        Object.keys(LAB).map(function (key) {
          var s = a.stats[key];
          var c = !s || !s.n ? '<span style="color:var(--hot)">ausente</span>'
                : U.br(s.pct, 0) + ' %';
          return '<tr><td>' + U.esc(LAB[key]) + '</td><td class="num">' + c + '</td>' +
                 '<td class="num">' + (s && s.n ? U.br(s.min, 1) : '—') + '</td>' +
                 '<td class="num">' + (s && s.n ? U.br(s.mean, 1) : '—') + '</td>' +
                 '<td class="num">' + (s && s.n ? U.br(s.max, 1) : '—') + '</td></tr>';
        }).join('') + '</tbody>';
    }
    var pv = $('#tblPreview');
    if (pv && S.proc) {
      var cols = [['t', 'tempo'], ['tHotIn', 'T ent (°C)'], ['tOut', 'T saí (°C)'], ['dT', 'ΔT (°C)'],
                  ['tAmb', 'T amb (°C)'], ['rpm', 'rpm'], ['speed', 'km/h'], ['load', 'carga %'],
                  ['vdotCool', 'L/min'], ['vFace', 'v_ar m/s'], ['q', 'Q̇ (W)'], ['eps', 'ε'], ['ua', 'UA']];
      var sample = S.proc.rows.filter(function (d, i) { return i % Math.ceil(S.proc.rows.length / 12) === 0; }).slice(0, 12);
      pv.innerHTML = '<thead><tr>' + cols.map(function (c) { return '<th class="num">' + U.esc(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        sample.map(function (d) {
          return '<tr>' + cols.map(function (c) {
            var v = d[c[0]];
            if (c[0] === 't') return '<td class="num">' + U.mmss(v) + '</td>';
            if (c[0] === 'q') return '<td class="num">' + U.br(v, 0) + '</td>';
            if (c[0] === 'eps') return '<td class="num">' + (d.warmup ? '—' : U.br(v, 3)) + '</td>';
            return '<td class="num">' + U.br(v, 1) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>';
    }
  }

  /* ============================================================
     ANALISE TERMICA
     ============================================================ */
  function renderAnalise() {
    var has = !!(S.proc && S.sum);
    $('#anaResults').hidden = !has;
    var note = $('#modeNote');
    if (!has) { if (note) note.textContent = 'Carregue uma coleta para ver os resultados.'; return; }

    var s = S.sum, p = S.params;
    if (note) {
      note.className = S.proc.mode === 'exp' ? 'note' : 'note warn';
      note.innerHTML = S.proc.mode === 'exp'
        ? '<b>Modo experimental.</b> Há ΔT medido nas mangueiras: o calor rejeitado vem do balanço de energia e a efetividade é um <b>resultado experimental</b>. O UA pelas correlações serve de comparação (ideal × real).'
        : '<b>Modo modelo.</b> Não há ΔT medido nesta coleta, então o calor rejeitado e a efetividade são <b>estimados</b> pelas correlações de convecção — não são medição. Para fechar o balanço de energia é preciso instrumentar as mangueiras superior e inferior.';
    }

    /* ---- tabela por regime ---- */
    var tr = $('#tblRegimes');
    if (tr) {
      var head = ['Regime', 'Amostras', 'T líquido (°C)', 'ΔT (°C)', 'Q̇ (kW)', 'ε', 'NTU', 'C_r', 'UA (W/K)', 'v_ar (m/s)', 'Ventilador'];
      tr.innerHTML = '<thead><tr>' + head.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + U.esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        s.byRegime.map(function (r) {
          return '<tr><td><b>' + U.esc(r.regime) + '</b></td>' +
            '<td class="num">' + U.br(r.n, 0) + '</td>' +
            '<td class="num">' + U.br(r.ect, 1) + '</td>' +
            '<td class="num">' + U.br(r.dT, 1) + '</td>' +
            '<td class="num">' + U.br(r.q / 1000, 1) + '</td>' +
            '<td class="num">' + U.br(r.eps, 3) + '</td>' +
            '<td class="num">' + U.br(r.ntu, 2) + '</td>' +
            '<td class="num">' + U.br(r.cr, 2) + '</td>' +
            '<td class="num">' + U.br(r.ua, 0) + '</td>' +
            '<td class="num">' + U.br(r.vFace, 2) + '</td>' +
            '<td class="num">' + U.br(r.fanPct, 0) + ' %</td></tr>';
        }).join('') +
        '<tr class="sum-row"><td><b>Sessão útil</b></td>' +
        '<td class="num">' + U.br(s.nUseful, 0) + '</td><td class="num">' + U.br(s.ectMeanUseful, 1) + '</td>' +
        '<td class="num">' + U.br(s.dtMean, 1) + '</td><td class="num">' + U.br(s.qMean / 1000, 1) + '</td>' +
        '<td class="num"><b>' + U.br(s.epsMean, 3) + '</b></td><td class="num">' + U.br(s.ntuMean, 2) + '</td>' +
        '<td class="num">' + U.br(s.crMean, 2) + '</td><td class="num">' + U.br(s.uaMean, 0) + '</td>' +
        '<td class="num">—</td><td class="num">' + U.br(s.fanPct, 0) + ' %</td></tr>' +
        '</tbody>';
    }

    var useful = S.proc.rows.filter(function (d) { return !d.warmup && isFinite(d.eps) && d.tStatFrac > 0.3 && d.qMax > 500; });

    /* ---- efetividade x velocidade de face ---- */
    G.update($('#chartEpsAir'), {
      height: 260, xLabel: 'velocidade de face do ar (m/s)', yLabel: 'efetividade ε (–)',
      yMin: 0, yMax: 1, xMin: 0,
      series: [
        { name: 'ventilador desligado', color: COL.cold, type: 'scatter', r: 2.2,
          data: useful.filter(function (d) { return d.fan < 0.5; }).map(function (d) { return [d.vFace, d.eps]; }),
          tipFmt: function (v) { return U.br(v, 3); } },
        { name: 'ventilador ligado', color: COL.hot, type: 'scatter', r: 2.4,
          data: useful.filter(function (d) { return d.fan >= 0.5; }).map(function (d) { return [d.vFace, d.eps]; }),
          tipFmt: function (v) { return U.br(v, 3); } }
      ],
      hlines: [{ y: 0.4, color: COL.warn, label: 'faixa de referência 0,40' }, { y: 0.7, color: COL.warn, label: '0,70' }],
      xFmt: function (v) { return U.br(v, 1); }, yFmt: function (v) { return U.br(v, 2); }
    });

    /* ---- curva eps-NTU teorica com pontos medidos ---- */
    var curves = [0, 0.25, 0.5, 0.75, 1].map(function (cr, i) {
      var data = [];
      for (var n = 0.02; n <= 5; n += 0.02) data.push([n, T.epsCrossflow(n, cr)]);
      var cols = COL.crCurve;
      return { name: 'C_r = ' + U.br(cr, 2), color: cols[i], width: 1.4, data: data,
               tipFmt: function (v) { return U.br(v, 3); } };
    });
    curves.push({ name: 'pontos medidos', color: COL.pred, type: 'scatter', r: 2.2, alpha: 0.5,
      data: useful.map(function (d) { return [d.ntu, d.eps]; }),
      tipFmt: function (v) { return U.br(v, 3); } });
    var ntuHi = Math.max(1.2, Math.min(5, (capMax(useful.map(function (d) { return d.ntu; }), 0.98) || 2) * 1.25));
    G.update($('#chartEpsNtu'), {
      height: 260, series: curves, xMin: 0, xMax: ntuHi, yMin: 0, yMax: 1,
      xLabel: 'NTU (–)', yLabel: 'efetividade ε (–)',
      xFmt: function (v) { return U.br(v, 1); }, yFmt: function (v) { return U.br(v, 2); }
    });
    legend('#legEpsNtu', curves);

    /* ---- UA experimental x teorico ---- */
    var sUA = [
      { name: 'UA experimental', color: COL.ua, width: 1.6,
        data: S.proc.rows.map(function (d) { return [d.t, d.warmup ? NaN : d.ua]; }),
        tipFmt: function (v) { return U.br(v, 0) + ' W/K'; } },
      { name: 'UA pelas correlações', color: COL.uaMod, width: 1.5, dash: true,
        data: S.proc.rows.map(function (d) { return [d.t, d.warmup ? NaN : d.uaModel]; }),
        tipFmt: function (v) { return U.br(v, 0) + ' W/K'; } }
    ];
    G.update($('#chartUA'), {
      height: 250, series: sUA, xFmt: U.mmss, yMin: 0,
      yMax: capMax(S.proc.rows.filter(function (d) { return !d.warmup; })
        .map(function (d) { return Math.max(d.ua || 0, d.uaModel || 0); }), 0.98),
      xLabel: 'tempo (mm:ss)', yLabel: 'UA (W/K)',
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); }
    });
    legend('#legUA', sUA);

    /* ---- balanco de energia ---- */
    /* Medias moveis de 15 s: os picos instantaneos de aceleracao nao
       chegam ao liquido, que integra a entrada de calor pela propria
       inercia termica. Sem isso um unico pico domina toda a escala.   */
    var qGenS = movAvg(S.proc.rows, 'qGen', 15);
    var qS = movAvg(S.proc.rows, 'q', 15);
    renderLmtd(useful);
    renderEpsSurface(useful);
    renderUncertainty(useful);
    renderCompact(useful);

    var sBal = [
      { name: 'Calor gerado pelo motor (média 15 s)', color: COL.gen, width: 1.6, area: 'rgba(255,159,67,.16)',
        data: S.proc.rows.map(function (d, i) { return [d.t, qGenS[i] / 1000]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' kW'; } },
      { name: 'Calor rejeitado pelo radiador (média 15 s)', color: COL.q, width: 1.6,
        data: S.proc.rows.map(function (d, i) { return [d.t, qS[i] / 1000]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' kW'; } },
      { name: 'Desequilíbrio (gerado − rejeitado)', color: COL.pred, width: 1.3, dash: true,
        data: S.proc.rows.map(function (d, i) { return [d.t, (qGenS[i] - qS[i]) / 1000]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' kW'; } }
    ];
    G.update($('#chartBal'), {
      height: 250, series: sBal, xFmt: U.mmss,
      yMax: capMax(qGenS.map(function (v) { return v / 1000; }), 0.99),
      xLabel: 'tempo (mm:ss)', yLabel: 'potência térmica (kW)',
      hlines: [{ y: 0, color: COL.ideal, dash: false }],
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); }
    });
    legend('#legBal', sBal);
  }

  /* a media logaritmica e o fator de correcao do ponto de operacao */
  function renderLmtd(useful) {
    var blk = $('#lmtdBlock');
    if (!blk) return;
    var s = S.sum;
    var ok = useful.length > 10 && isFinite(s.dTmlMean);
    blk.hidden = !ok;
    if (!ok) return;

    var fOk = isFinite(s.fCorrMean) && s.fCorrMean > 0.75;
    $('#lmtdKpis').innerHTML =
      kpi('ΔT média logarítmica', U.br(s.dTmlMean, 1), '°C', 'entre os dois fluidos', 'mut') +
      kpi('Fator de correção F', U.br(s.fCorrMean, 3), '', fOk ? 'próximo do contracorrente' : 'longe do contracorrente', fOk ? 'ok' : 'warn') +
      kpi('UA por Q̇ / (F·ΔT_ml)', U.br(s.uaMean, 0), 'W/K', 'idêntico ao ε–NTU, por construção', 'mut');

    $('#lmtdRead').innerHTML =
      'A diferença média logarítmica entre líquido e ar ficou em <b>' + U.br(s.dTmlMean, 1) +
      ' °C</b>, e o fator de correção implícito no ponto de operação, em <b>' + U.br(s.fCorrMean, 3) + '</b>. ' +
      (fOk
        ? 'F perto de 1 diz que, nesta faixa, o escoamento cruzado está rendendo quase o mesmo que um contracorrente puro renderia com a mesma área — é o regime em que o método da ΔT_ml se aplica sem penalidade relevante.'
        : 'F bem abaixo de 1 diz que o escoamento cruzado está longe do contracorrente nesta faixa: boa parte da área do núcleo trabalha com diferença de temperatura pequena. É informação de projeto — indica que alongar o núcleo no sentido do ar renderia menos do que aumentar a área frontal.') +
      ' Vale registrar no relatório que a temperatura de saída do ar não é medida: ela sai do próprio balanço, então esta ΔT_ml é coerente com o resultado por construção, não uma verificação independente dele.';
  }

  /* a superficie eps(NTU, C_r): a familia inteira de curvas de uma vez */
  function renderEpsSurface(useful) {
    var cv = $('#chartEpsSurf');
    if (!cv || !G.surface) return;
    var NX = 30, NY = 22;
    var Z = [];
    for (var j = 0; j < NY; j++) {
      var cr = j / (NY - 1);
      var row = [];
      for (var i = 0; i < NX; i++) row.push(T.epsCrossflow(0.05 + (5 - 0.05) * i / (NX - 1), cr));
      Z.push(row);
    }
    var s = S.sum;
    G.surface(cv, {
      height: 500, z: Z, zMin: 0, zMax: 1,
      title: 'Efetividade do escoamento cruzado, fluidos não-misturados',
      subtitle: 'ε = 1 − exp{ (NTU^0,22 / C_r) · [ exp(−C_r·NTU^0,78) − 1 ] }',
      x: { min: 0.05, max: 5, fmt: function (v) { return U.br(v, 1); } },
      y: { min: 0, max: 1, fmt: function (v) { return U.br(v, 2); } },
      xLabel: 'NTU', yLabel: 'C_r', zLabel: 'ε',
      zFmt: function (v) { return U.br(v, 2); }, zTicks: 5, contours: 10,
      ramp: COL.surfRamp, markerColor: COL.mark,
      marker: isFinite(s.ntuMean) ? { x: s.ntuMean, y: s.crMean, label: 'esta coleta' } : null,
      hint: 'arraste para girar'
    });
    $('#epsSurfRead').innerHTML =
      'O gráfico ao lado mostra cinco fatias desta superfície. Aqui está ela inteira: a efetividade sobe rápido com o NTU até cerca de 2 e depois satura — construir um radiador com NTU 4 em vez de 2 custa o dobro de área e entrega pouco. E quanto maior o C_r, mais baixo o teto: quando os dois fluidos têm capacidades térmicas parecidas, nem a área infinita salva. Esta coleta operou em NTU ' +
      U.br(s.ntuMean, 2) + ' e C_r ' + U.br(s.crMean, 2) + ', marcado na superfície.';
  }

  /* ============================================================
     Incerteza e compacidade
     ------------------------------------------------------------
     Duas coisas que faltavam para o estudo se sustentar como
     trabalho experimental: a barra de erro em cima de cada
     resultado, e o preco que se paga em potencia de acionamento
     para conseguir aquela troca.
     ============================================================ */
  function renderUncertainty(useful) {
    var card = $('#uncCard');
    if (!card) return;
    var s = S.sum, p = S.params;
    var ok = useful.length > 10 && isFinite(s.relEps);
    card.hidden = !ok;
    if (!ok) return;

    var pm = function (v, u, dec, unit) {
      return U.br(v, dec) + ' <small>± ' + U.br(u, dec) + (unit ? ' ' + unit : '') + '</small>';
    };
    $('#uncKpis').innerHTML =
      kpi('Calor rejeitado', pm(s.qMean / 1000, s.relQ * s.qMean / 1000, 1, 'kW'), '',
          U.br(100 * s.relQ, 0) + ' % do valor', 'mut') +
      kpi('Efetividade', pm(s.epsMean, s.relEps * s.epsMean, 3, ''), '',
          U.br(100 * s.relEps, 0) + ' % do valor', s.relEps < 0.15 ? 'ok' : s.relEps < 0.35 ? 'warn' : 'hot') +
      kpi('Condutância UA', pm(s.uaMean, s.relUA * s.uaMean, 0, 'W/K'), '',
          U.br(100 * s.relUA, 0) + ' % do valor', s.relUA < 0.25 ? 'ok' : 'hot') +
      kpi('Incerteza do ΔT', U.br(s.uDT, 2), '°C', 'sobre ΔT médio de ' + U.br(s.dtMean, 1) + ' °C', 'mut') +
      kpi('Amplificação NTU', '×' + U.br(s.ampMean, 2), '', 'quanto ε vira em UA', 'mut');

    var badge = $('#uncBadge');
    badge.textContent = 'k = 1 · ' + U.br(100 * s.relEps, 0) + ' % em ε';
    badge.className = 'badge ' + (s.relEps < 0.15 ? 'ok' : s.relEps < 0.35 ? 'warn' : 'hot');

    /* contribuicoes em quadratura, medianas sobre a parte util */
    var R3 = Math.sqrt(3);
    var med = function (f) { return U.percentile(useful.map(f).filter(isFinite), 0.5); };
    var uHot = med(function (d) { return (isFinite(d.tIn) ? p.uTliq : p.uTobd) / R3; });
    var uOut = p.uTliq / R3, uAmb = p.uTamb / R3;
    var cDT = med(function (d) { return Math.pow(Math.sqrt(uHot * uHot + uOut * uOut) / d.dT, 2); });
    var cMax = med(function (d) { return Math.pow(Math.sqrt(uHot * uHot + uAmb * uAmb) / (d.tHotIn - d.tAmb), 2); });
    var airFrac = 1 - s.liqLimitsPct / 100;
    var relLiq2 = (p.uPumpRel * p.uPumpRel + p.uCpRel * p.uCpRel) * airFrac;
    var relAir2 = (p.uAirRel * p.uAirRel + p.uCpRel * p.uCpRel) * airFrac;

    G.stack($('#chartUnc'), {
      height: 120,
      title: 'PARTICIPAÇÃO NA VARIÂNCIA DE ε',
      parts: [
        { label: 'ΔT medido', value: cDT, color: COL.hot },
        { label: 'ΔT até o ambiente', value: cMax, color: COL.warn, dark: true },
        { label: 'vazão do líquido', value: relLiq2, color: COL.q },
        { label: 'vazão de ar', value: relAir2, color: COL.uaMod }
      ]
    });

    /* como a incerteza do UA cresce com a efetividade */
    var crMed = s.crMean;
    var amp = [];
    for (var e = 0.05; e <= 0.95; e += 0.01) {
      var h = 0.002;
      var n0 = T.ntuFromEps(e - h, crMed), n1 = T.ntuFromEps(e + h, crMed);
      var nt = T.ntuFromEps(e, crMed);
      if (!isFinite(nt) || nt <= 0) continue;
      amp.push([e, Math.abs((n1 - n0) / (2 * h)) * e / nt]);
    }
    G.update($('#chartAmp'), {
      height: 220,
      series: [{ name: 'amplificação', color: COL.pred, width: 2,
        data: amp, tipFmt: function (v) { return '×' + U.br(v, 2); } }],
      xMin: 0, xMax: 1, yMin: 0,
      marks: [{ x: s.epsMean, color: COL.mark }],
      xLabel: 'efetividade ε', yLabel: 'fator de amplificação (×)',
      xFmt: function (v) { return U.br(v, 1); }, yFmt: function (v) { return U.br(v, 1); },
      tipTitle: function (v) { return 'ε = ' + U.br(v, 2); }
    });

    var canc = s.liqLimitsPct > 50;
    $('#uncRead').innerHTML =
      'Com os instrumentos declarados, a efetividade sai <b>' + U.br(s.epsMean, 3) + ' ± ' +
      U.br(s.relEps * s.epsMean, 3) + '</b> e o UA, <b>' + U.br(s.uaMean, 0) + ' ± ' +
      U.br(s.relUA * s.uaMean, 0) + ' W/K</b>. ' +
      (canc
        ? 'Em <b>' + U.br(s.liqLimitsPct, 0) + '%</b> das amostras o líquido é o lado de menor capacidade térmica, e aí acontece algo que vale escrever no relatório: a vazão aparece no calor rejeitado <i>e</i> no calor máximo, e cancela. A efetividade vira ΔT dividido por (T_líquido − T_ar) — só temperaturas. O parâmetro mais incerto da montagem, a vazão da bomba, não contamina o resultado principal.'
        : 'Em <b>' + U.br(100 - s.liqLimitsPct, 0) + '%</b> das amostras quem limita é o ar, e nesse regime a vazão <i>não</i> cancela: as incertezas das duas vazões entram inteiras na efetividade. É por isso que a barra de erro está grande — reduzi-la exige medir a velocidade de face com anemômetro, não um sensor melhor de temperatura.') +
      ' O UA sai ainda pior porque o NTU é muito não-linear: neste ponto de operação, cada 1% de incerteza em ε vira <b>' +
      U.br(s.ampMean, 2) + '%</b> em NTU, e a curva ao lado mostra que isso piora rápido conforme ε sobe.';
  }

  function renderCompact(useful) {
    var card = $('#compactCard');
    if (!card) return;
    var s = S.sum;
    var ok = useful.length > 10 && isFinite(s.jAirMean);
    card.hidden = !ok;
    if (!ok) return;

    var inRange = s.jAirMean >= 0.008 && s.jAirMean <= 0.035;
    $('#compactKpis').innerHTML =
      kpi('Fator j de Colburn', U.br(s.jAirMean, 4), '', inRange ? 'dentro da faixa de aletas persianadas' : 'fora da faixa típica 0,008–0,035', inRange ? 'ok' : 'warn') +
      kpi('Stanton do ar', U.br(s.stAirMean, 4), '', 'j · Pr^(−2/3)', 'mut') +
      kpi('Perda de carga — ar', U.br(s.dpAirMean, 0), 'Pa', 'no núcleo', 'mut') +
      kpi('Perda de carga — líquido', U.br(s.dpCoolMean, 0), 'Pa', 'nos tubos planos', 'mut') +
      kpi('Custo de acionamento', U.br(s.wDriveMean, 0), 'W', 'ventilador + bomba + arrasto', 'mut') +
      kpi('Figura de mérito', U.br(s.meritMean, 0), '', 'W de calor por W gasto', 'ok');

    G.update($('#chartJ'), {
      height: 230, padL: 64,
      series: [{ name: 'fator j', color: COL.q, type: 'scatter', r: 2,
        data: useful.map(function (d) { return [d.reAir, d.jAir]; }),
        tipFmt: function (v) { return U.br(v, 4); } }],
      yMin: 0, xMin: 0,
      hlines: [{ y: 0.008, color: COL.warn, label: 'faixa típica 0,008' },
               { y: 0.035, color: COL.warn, label: '0,035' }],
      xLabel: 'Reynolds do ar no canal', yLabel: 'fator j de Colburn',
      xFmt: function (v) { return U.br(v, 0); }, yFmt: function (v) { return U.br(v, 3); }
    });

    var sp = [
      { name: 'arrasto do veículo', color: COL.hot, width: 1.6, area: COL.qArea,
        data: S.proc.rows.map(function (d) { return [d.t, d.warmup ? NaN : d.wRam]; }),
        tipFmt: function (v) { return U.br(v, 0) + ' W'; } },
      { name: 'eletroventilador', color: COL.q, width: 1.6,
        data: S.proc.rows.map(function (d) { return [d.t, d.warmup ? NaN : d.wFan]; }),
        tipFmt: function (v) { return U.br(v, 0) + ' W'; } },
      { name: 'bomba d\'água', color: COL.spd, width: 1.4,
        data: S.proc.rows.map(function (d) { return [d.t, d.warmup ? NaN : d.wPump]; }),
        tipFmt: function (v) { return U.br(v, 1) + ' W'; } }
    ];
    G.update($('#chartPower'), {
      height: 230, series: sp, xFmt: U.mmss, yMin: 0,
      yMax: capMax(S.proc.rows.filter(function (d) { return !d.warmup; })
        .map(function (d) { return Math.max(d.wRam || 0, d.wFan || 0); }), 0.98),
      xLabel: 'tempo (mm:ss)', yLabel: 'potência de acionamento (W)',
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); }
    });
    legend('#legPower', sp);

    $('#compactRead').innerHTML =
      'O fator j médio deu <b>' + U.br(s.jAirMean, 4) + '</b>' +
      (inRange
        ? ', dentro da faixa que a literatura reporta para aletas persianadas de radiador automotivo — ou seja, os coeficientes C e m adotados no modelo são plausíveis para esta geometria.'
        : ', fora da faixa típica de aletas persianadas. Vale revisar C, m e a densidade de área do núcleo antes de confiar no UA teórico.') +
      ' Mover os dois fluidos custou <b>' + U.br(s.wDriveMean, 0) + ' W</b> em média — ' +
      U.br(s.wRamMean, 0) + ' W de arrasto que o carro paga para empurrar ar pelo núcleo, ' +
      U.br(s.wFanMean, 0) + ' W do eletroventilador e apenas ' + U.br(s.wPumpMean, 1) +
      ' W da bomba. Para cada watt gasto nisso, o radiador tirou <b>' + U.br(s.meritMean, 0) +
      ' W</b> de calor do líquido. É esse o número que um núcleo mais denso teria de melhorar: mais área aumenta a troca, mas aumenta a perda de carga junto.';
  }

  function doCalibrate() {
    if (!S.rows) { alert('Carregue uma coleta primeiro.'); return; }
    var res = T.calibrate(S.rows, S.params);
    S.calib = res;
    var note = $('#calibNote');
    note.hidden = false;
    if (!res.ok) {
      note.className = 'note warn';
      note.innerHTML = res.reason === 'sem-dt'
        ? '<b>Calibração indisponível.</b> É preciso ΔT medido (temperaturas de entrada e saída do radiador) para calibrar o modelo contra o balanço de energia. Sem isso, o UA teórico não tem referência experimental.'
        : '<b>Calibração indisponível.</b> Amostras válidas insuficientes (' + U.br(res.n || 0, 0) + '). São necessárias pelo menos 30 amostras com o termostato aberto.';
      return;
    }
    S.params.uaScale = Math.round(res.uaScale * 10000) / 10000;
    S.params.uaCalibrated = 1;
    persistParams(); syncParamInputs();
    recompute();
    note.className = 'note';
    note.innerHTML = '<b>Modelo calibrado.</b> Fator de UA ajustado para <b>' + U.br(res.uaScale, 3) +
      '</b> a partir de ' + U.br(res.n, 0) + ' amostras (razão mediana UA medido ÷ UA teórico: ' + U.br(res.ratioMedian, 3) +
      '; erro residual em Q̇: ' + U.br(res.rmseKw, 2) + ' kW). ' +
      'Este fator absorve o que as correlações não capturam da geometria real do núcleo. ' +
      '<b>Use uma coleta com o radiador em bom estado como linha de base</b> — depois disso, a queda do índice de saúde passa a indicar degradação real.';
    renderAll();
  }

  /* ============================================================
     IA / PREVISAO
     ============================================================ */
  function trainModel() {
    if (!S.proc) { alert('Carregue uma coleta primeiro.'); return; }
    var hz = parseFloat($('#inHorizon').value) || 300;
    var lamRaw = $('#inLambda').value;
    var lam = lamRaw === 'auto' ? 'auto' : parseFloat(lamRaw);
    var split = U.clamp(parseFloat($('#inSplit').value) || 0.7, 0.4, 0.9);
    var skipWarm = $('#inSkipWarm').checked;

    S.params.horizon = hz; persistParams(); syncParamInputs();

    var ds = M.buildDataset(S.proc.rows, { horizon: hz, skipWarmup: skipWarm });
    var fit = M.train(ds, { lambda: lam, split: split });
    S.fit = fit;
    S.dataset = ds;

    if (!fit.ok) {
      $('#iaEmpty').hidden = false;
      $('#iaBody').hidden = true;
      $('#iaEmpty').innerHTML = '<div class="empty"><span class="big">⚠︎</span>' +
        (fit.reason === 'poucas-amostras'
          ? 'Amostras insuficientes para treinar (' + U.br(fit.n || 0, 0) + '). Com horizonte de ' + U.mmss(hz) +
            ', uma sessão precisa ter pelo menos ' + U.mmss(hz + 300) + ' de duração.'
          : 'Não foi possível ajustar o modelo (' + U.esc(fit.reason) + ').') + '</div>';
      return;
    }
    /* leva o cursor para o ultimo instante que ainda tem previsao:
       depois disso a coleta acaba e nao ha alvo conhecido            */
    if (fit.series.length) {
      var lastNow = fit.series[fit.series.length - 1].tNow;
      for (var ci = S.proc.rows.length - 1; ci >= 0; ci--) {
        if (S.proc.rows[ci].t <= lastNow) { S.cursor = ci; break; }
      }
    }
    recomputeAlerts();
    renderIa();
    renderPainel();
    renderAlerts();
  }

  function renderIa() {
    var fit = S.fit;
    $('#iaEmpty').hidden = !!(fit && fit.ok);
    $('#iaBody').hidden = !(fit && fit.ok);
    if (!fit || !fit.ok) return;

    var target = parseFloat($('#inMaeTarget').value) || 2.0;
    var v = M.verdict(fit, target);

    var vb = $('#verdictBadge');
    vb.textContent = v.pass ? '✓ ' + v.txt : '✕ ' + v.txt;
    vb.className = 'badge ' + (v.pass ? 'ok' : 'warn');

    $('#iaProto').innerHTML =
      'Protocolo: validação cruzada em <b>' + (fit.cv && fit.cv.ok ? fit.cv.k : 5) + ' blocos contíguos</b> ' +
      '(a série temporal não é embaralhada — amostras vizinhas são quase idênticas e o modelo veria o próprio alvo). ' +
      'λ = <b>' + U.br(fit.lambda, fit.lambda < 10 ? 1 : 0) + '</b>' +
      (fit.cv && fit.cv.ok ? ' escolhido automaticamente' : '') +
      '. Variáveis padronizadas com trava de extrapolação em ±' + U.br(fit.clip, 1) + ' desvios. ' +
      'Amostras: ' + U.br(fit.n, 0) + ' (holdout final: ' + U.br(fit.nTest, 0) + ').';

    $('#iaKpis').innerHTML =
      kpi('MAE', U.br(fit.test.mae, 2), '°C', 'validação cruzada · critério ≤ ' + U.br(target, 1) + ' °C', v.pass ? 'ok' : 'warn') +
      kpi('RMSE', U.br(fit.test.rmse, 2), '°C', 'validação cruzada', 'ok') +
      kpi('MAE no holdout', U.br(fit.holdout.mae, 2), '°C', 'último trecho, nunca visto', fit.holdout.mae <= target ? 'ok' : 'warn') +
      kpi('Erro p95', U.br(fit.holdout.p95, 2), '°C', '95 % das previsões abaixo disto', 'ok') +
      kpi('Linha de base', U.br(fit.test.maeBase, 2), '°C', 'prever "continua igual"', 'mut') +
      kpi('Ganho sobre a base', U.br(v.better, 0), '%', 'redução do erro médio', v.better > 0 ? 'ok' : 'crit') +
      kpi('Extrapolar tendência', U.br(fit.test.maeLin, 2), '°C', 'segunda linha de base', 'mut') +
      kpi('Viés', (fit.holdout.bias >= 0 ? '+' : '') + U.br(fit.holdout.bias, 2), '°C', 'erro médio com sinal', Math.abs(fit.holdout.bias) < 0.5 ? 'ok' : 'warn');

    var note = $('#iaNote');
    note.className = v.pass ? 'note' : 'note warn';
    var lines = [];
    lines.push(v.pass
      ? '<b>Critério atendido.</b> O erro médio de previsão para ' + U.mmss(fit.horizon) + ' à frente ficou em ' + U.br(fit.test.mae, 2) + ' °C.'
      : '<b>Critério não atendido nesta coleta.</b> O erro médio ficou em ' + U.br(fit.test.mae, 2) + ' °C, acima do limite de ' + U.br(target, 1) + ' °C.');
    lines.push('O modelo reduz o erro em <b>' + U.br(v.better, 0) + ' %</b> em relação a simplesmente supor que a temperatura permanece igual.');
    if (S.meta && S.meta.demo) lines.push('Lembre-se de que esta é uma coleta sintética: o resultado definitivo depende dos dados reais do veículo.');
    if (fit.n < 400) lines.push('Com apenas ' + U.br(fit.n, 0) + ' amostras o resultado é instável — sessões mais longas e em número maior tendem a reduzir o erro.');
    lines.push('Uma fração do erro é irredutível: o PID 0105 devolve a temperatura com resolução de <b>1 °C</b>, o que já introduz cerca de 0,3 °C de ruído no próprio alvo.');
    note.innerHTML = lines.join(' ');

    /* medido x previsto no tempo */
    var sPred = [
      { name: 'Temperatura medida', color: COL.hot, width: 1.8,
        data: S.proc.rows.map(function (d) { return [d.t, d.tHotIn]; }),
        tipFmt: function (x) { return U.br(x, 1) + ' °C'; } },
      { name: 'Previsão', color: COL.pred, width: 1.7,
        data: fit.series.map(function (s) { return [s.tTarget, s.pred]; }),
        tipFmt: function (x) { return U.br(x, 1) + ' °C'; } }
    ];
    G.update($('#chartPred'), {
      height: 300, series: sPred, xFmt: U.mmss,
      xLabel: 'tempo (mm:ss)', yLabel: 'temperatura (°C)',
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); },
      marks: fit.splitTime ? [{ x: fit.splitTime + fit.horizon, color: COL.pred }] : [],
      hlines: [{ y: S.params.tCrit, color: COL.crit, label: 'crítico' }]
    });
    legend('#legPred', sPred);

    /* dispersao previsto x medido */
    var lo = U.min(fit.series.map(function (s) { return Math.min(s.real, s.pred); }));
    var hi = U.max(fit.series.map(function (s) { return Math.max(s.real, s.pred); }));
    G.update($('#chartParity'), {
      height: 300, xMin: lo - 1, xMax: hi + 1, yMin: lo - 1, yMax: hi + 1,
      xLabel: 'temperatura medida (°C)', yLabel: 'temperatura prevista (°C)',
      series: [
        { name: 'ideal', color: COL.ideal, width: 1.4, data: [[lo - 1, lo - 1], [hi + 1, hi + 1]], noTip: true },
        { name: 'treino', color: COL.train, type: 'scatter', r: 1.9, alpha: 0.35,
          data: fit.series.filter(function (s) { return !s.isTest; }).map(function (s) { return [s.real, s.pred]; }),
          tipFmt: function (x) { return U.br(x, 1) + ' °C'; } },
        { name: 'holdout', color: COL.pred, type: 'scatter', r: 2.2, alpha: 0.7,
          data: fit.series.filter(function (s) { return s.isTest; }).map(function (s) { return [s.real, s.pred]; }),
          tipFmt: function (x) { return U.br(x, 1) + ' °C'; } }
      ],
      xFmt: function (v) { return U.br(v, 0); }, yFmt: function (v) { return U.br(v, 0); }
    });

    /* erro por lambda */
    if (fit.cv && fit.cv.ok) {
      G.bars($('#chartLambda'), {
        height: Math.max(150, fit.cv.results.length * 30 + 24), labelWidth: 74,
        items: fit.cv.results.map(function (r) {
          return { label: 'λ = ' + U.br(r.lambda, 0), value: r.mae,
                   color: r.lambda === fit.lambda ? COL.ok : COL.uaMod };
        }),
        fmt: function (v) { return U.br(v, 2) + ' °C'; }
      });
      $('#legLambda').innerHTML = '<span style="color:var(--ink-4)">MAE médio dos blocos · em verde o λ escolhido · linha de base: <b>' +
        U.br(fit.test.maeBase, 2) + ' °C</b></span>';
    }

    /* pesos */
    G.bars($('#chartWeights'), {
      height: Math.max(180, fit.weights.length * 27 + 24), labelWidth: 196,
      items: fit.weights.map(function (w) {
        return { label: w.label, value: w.w, color: w.w >= 0 ? COL.hot : COL.cold };
      }),
      fmt: function (v) { return (v >= 0 ? '+' : '') + U.br(v, 2); }
    });

    /* anomalias */
    renderAnomalies();
  }

  function renderAnomalies() {
    var t = $('#tblAnom');
    if (!t || !S.anom) return;
    if (!S.anom.events.length) {
      var extra = S.anom.calibrated ? ''
        : '<br><span style="color:var(--warn)">A regra de perda de desempenho está inativa: sem calibração contra uma coleta de referência, ' +
          'o UA teórico carrega o viés das correlações e um limiar absoluto geraria falso positivo. Calibre na aba Análise térmica.</span>';
      t.innerHTML = '<tbody><tr><td style="color:var(--ok)">✓ Nenhuma anomalia sustentada detectada. Índice de saúde mediano: ' +
        U.br(S.anom.healthMedian * 100, 0) + ' % do previsto.' + extra + '</td></tr></tbody>';
      return;
    }
    t.innerHTML = '<thead><tr><th>Início</th><th class="num">Duração</th><th>Tipo</th><th class="num">Saúde</th><th class="num">ε medido</th><th>Severidade</th></tr></thead><tbody>' +
      S.anom.events.map(function (e) {
        var cls = e.sev === 'alta' ? 'crit' : e.sev === 'media' ? 'warn' : '';
        return '<tr><td>' + U.mmss(e.t0) + '</td><td class="num">' + U.mmss(e.dur) + '</td>' +
          '<td>' + U.esc(e.desc) + '<br><span style="color:var(--ink-4);font-size:11.5px">' + U.esc(e.regime) + '</span></td>' +
          '<td class="num">' + (isFinite(e.health) ? U.br(e.health * 100, 0) + ' %' : '—') + '</td>' +
          '<td class="num">' + U.br(e.eps, 3) + ' <span style="color:var(--ink-4)">(prev. ' + U.br(e.epsModel, 3) + ')</span></td>' +
          '<td><span class="badge ' + cls + '">' + U.esc(e.sev) + '</span></td></tr>';
      }).join('') + '</tbody>';
  }

  /* ============================================================
     ALERTAS
     ============================================================ */
  function recomputeAlerts() {
    if (!S.proc) return;
    S.params.tWarn = parseFloat($('#inTWarn').value) || S.params.tWarn;
    S.params.tCrit = parseFloat($('#inTCrit').value) || S.params.tCrit;
    S.params.leadReq = parseFloat($('#inLead').value) || S.params.leadReq;
    persistParams();
    S.alerts = M.alerts(S.proc, S.fit, S.params);
  }

  function renderAlerts() {
    var ready = !!(S.alerts && S.fit && S.fit.ok);
    $('#alertEmpty').hidden = ready;
    $('#alertBody').hidden = !ready;
    if (!ready) return;

    var a = S.alerts, p = S.params;
    $('#alertKpis').innerHTML =
      kpi('Alertas preditivos', U.br(a.nPred, 0), '', 'previsão cruzou o limite crítico', a.nPred ? 'warn' : 'ok') +
      kpi('Cruzamentos reais', U.br(a.nReal, 0), '', 'temperatura medida ≥ ' + U.br(p.tCrit, 0) + ' °C', a.nReal ? 'crit' : 'ok') +
      kpi('Alertas de atenção', U.br(a.list.filter(function (x) { return x.lvl === 'warn'; }).length, 0), '', '≥ ' + U.br(p.tWarn, 0) + ' °C', 'mut') +
      kpi('Antecedência média', isFinite(a.leadMean) ? U.mmss(a.leadMean) : '—', '', 'entre alerta e cruzamento', isFinite(a.leadMean) ? 'ok' : 'mut') +
      kpi('Antecedência mínima', isFinite(a.leadMin) ? U.mmss(a.leadMin) : '—', '', 'exigido ' + U.mmss(p.leadReq), a.passLead ? 'ok' : (isFinite(a.leadMin) ? 'warn' : 'mut')) +
      kpi('Falsos positivos', U.br(a.falsePos, 0), '', 'alerta sem cruzamento subsequente', a.falsePos ? 'warn' : 'ok');

    var v = $('#alertVerdict');
    if (a.nReal === 0) {
      v.className = 'note';
      v.innerHTML = '<b>Nenhum cruzamento do limite crítico nesta coleta.</b> Não há como medir a antecedência do alerta: ' +
        'o critério de 2 minutos só pode ser verificado numa sessão em que a temperatura efetivamente atinja ' + U.br(p.tCrit, 0) + ' °C. ' +
        'Para exercitar o critério, carregue a coleta de demonstração com radiador degradado, ou reduza o limite crítico para dentro da faixa observada nesta sessão.';
    } else if (a.passLead) {
      v.className = 'note';
      v.innerHTML = '<b>Critério de antecedência atendido.</b> Todos os ' + U.br(a.nReal, 0) + ' cruzamento(s) do limite crítico ' +
        'foram precedidos de alerta com pelo menos ' + U.mmss(a.leadMin) + ' de antecedência (exigido: ' + U.mmss(p.leadReq) + ').';
    } else {
      v.className = 'note warn';
      v.innerHTML = '<b>Critério de antecedência não atendido.</b> ' +
        (isFinite(a.leadMin)
          ? 'A menor antecedência observada foi de ' + U.mmss(a.leadMin) + ', abaixo do exigido (' + U.mmss(p.leadReq) + ').'
          : 'Houve cruzamento do limite crítico sem alerta preditivo prévio. Aumente o horizonte de previsão ou reduza o limite de disparo.');
    }

    var sA = [
      { name: 'Temperatura medida', color: COL.hot, width: 2,
        data: S.proc.rows.map(function (d) { return [d.t, d.tHotIn]; }),
        tipFmt: function (x) { return U.br(x, 1) + ' °C'; } },
      { name: 'Previsão', color: COL.pred, width: 1.6, dash: [6, 4],
        data: S.fit.series.map(function (s) { return [s.tTarget, s.pred]; }),
        tipFmt: function (x) { return U.br(x, 1) + ' °C'; } }
    ];
    G.update($('#chartAlert'), {
      height: 300, series: sA, xFmt: U.mmss,
      xLabel: 'tempo (mm:ss)', yLabel: 'temperatura (°C)',
      tipTitle: function (x) { return 'tempo ' + U.mmss(x); },
      yBands: [{ y0: p.tWarn, y1: p.tCrit, color: COL.bandWarn },
               { y0: p.tCrit, y1: 200, color: 'rgba(255,59,48,.10)' }],
      hlines: [{ y: p.tWarn, color: COL.warn, label: 'atenção' }, { y: p.tCrit, color: COL.crit, label: 'crítico' }],
      marks: a.list.filter(function (x) { return x.kind === 'pred-crit'; }).map(function (x) { return { x: x.t, color: COL.pred }; })
        .concat(a.crossings.map(function (x) { return { x: x.t, color: COL.crit }; }))
    });
    legend('#legAlert', sA);

    var KIND = {
      'pred-crit': ['Alerta preditivo — crítico', 'crit'],
      'pred-warn': ['Alerta preditivo — atenção', 'warn'],
      'real-crit': ['Limite crítico atingido', 'crit'],
      'real-warn': ['Limite de atenção atingido', 'warn']
    };
    var tb = $('#tblAlerts');
    if (!a.list.length) {
      tb.innerHTML = '<tbody><tr><td style="color:var(--ok)">✓ Nenhum alerta emitido nesta coleta.</td></tr></tbody>';
    } else {
      tb.innerHTML = '<thead><tr><th>Instante</th><th>Tipo</th><th class="num">T medida</th><th class="num">T prevista</th><th>Observação</th></tr></thead><tbody>' +
        a.list.slice(0, 200).map(function (x) {
          var k = KIND[x.kind] || [x.kind, ''];
          var lead = null;
          if (x.kind === 'pred-crit') {
            a.leads.forEach(function (l) { if (l.lead !== null && Math.abs(l.t - l.lead - x.t) < 2) lead = l.lead; });
          }
          return '<tr><td>' + U.mmss(x.t) + '</td>' +
            '<td><span class="badge ' + k[1] + '"><span class="dot"></span>' + U.esc(k[0]) + '</span></td>' +
            '<td class="num">' + U.br(x.ect, 1) + '</td>' +
            '<td class="num">' + (isFinite(x.pred) ? U.br(x.pred, 1) : '—') + '</td>' +
            '<td style="color:var(--ink-4)">' + (lead !== null ? 'antecedência de ' + U.mmss(lead)
              : (x.kind === 'pred-crit' ? 'previsão para ' + U.mmss(x.tTarget) : '')) + '</td></tr>';
        }).join('') + '</tbody>';
    }
  }

  /* ============================================================
     RELATORIO
     ============================================================ */
  function buildReport() {
    var host = $('#reportBody');
    if (!S.proc || !S.sum) {
      host.innerHTML = '<div class="empty"><span class="big">📄</span>Carregue uma coleta antes de gerar o relatório.</div>';
      return;
    }
    var s = S.sum, p = S.params, fit = S.fit, a = S.alerts;
    var now = new Date();
    var g = T.geom(p);
    var h = [];

    h.push('<h2 style="font-size:18px">Relatório técnico da campanha de coleta</h2>');
    h.push('<p style="color:var(--ink-4);font-size:12.5px">Apex Thermal Control · gerado em ' +
      now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR') + '</p>');

    if (S.meta && S.meta.demo) {
      h.push('<div class="note warn"><b>Coleta sintética.</b> Este relatório foi gerado a partir de dados de demonstração ' +
        'produzidos por simulação física, e não de medições no veículo. Serve para validar a cadeia de cálculo e o formato do relatório.</div>');
    }

    h.push('<h3>1. Identificação</h3>');
    h.push('<dl class="dl">' +
      '<dt>Coleta</dt><dd>' + U.esc(S.meta ? S.meta.name : '—') + '</dd>' +
      '<dt>Bancada</dt><dd>' + U.esc((S.meta && S.meta.vehicle) || 'Chevrolet Cruze LT 1.8 (2016)') + '</dd>' +
      '<dt>Amostras</dt><dd>' + U.br(s.n, 0) + ' registros · ' + U.mmss(s.duration) + ' de duração</dd>' +
      '<dt>Modo de cálculo</dt><dd>' + (s.mode === 'exp'
        ? 'Experimental — ΔT medido nas mangueiras, calor rejeitado obtido por balanço de energia'
        : 'Modelo — sem ΔT medido, calor e efetividade estimados pelas correlações de convecção') + '</dd>' +
      '<dt>Amostras úteis</dt><dd>' + U.br(s.nUseful, 0) + ' (termostato aberto, fora do aquecimento a frio)</dd>' +
      '</dl>');

    h.push('<h3>2. Condições térmicas observadas</h3>');
    h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
      row('Temperatura máxima do líquido', U.br(s.ectMax, 1) + ' °C') +
      row('Temperatura média do líquido', U.br(s.ectMean, 1) + ' °C') +
      row('Temperatura ambiente média', U.br(s.ambMean, 1) + ' °C') +
      row('Queda de temperatura no radiador (ΔT médio)', U.br(s.dtMean, 1) + ' °C') +
      row('Calor rejeitado médio', U.br(s.qMean / 1000, 1) + ' kW') +
      row('Calor rejeitado máximo', U.br(s.qMax / 1000, 1) + ' kW') +
      row('Energia total rejeitada', U.br(s.energy, 1) + ' MJ') +
      row('Tempo com eletroventilador acionado', U.br(s.fanPct, 0) + ' % da sessão') +
      '</tbody></table></div>');

    h.push('<h3>3. Desempenho do trocador de calor</h3>');
    h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
      row('Efetividade média ε', U.br(s.epsMean, 3)) +
      row('Efetividade — percentis 10 e 90', U.br(s.epsP10, 3) + ' a ' + U.br(s.epsP90, 3)) +
      row('NTU médio', U.br(s.ntuMean, 2)) +
      row('Razão de capacidades C_r média', U.br(s.crMean, 3)) +
      row('UA experimental médio', U.br(s.uaMean, 0) + ' W/K') +
      row('UA previsto pelas correlações', U.br(s.uaModelMean, 0) + ' W/K') +
      row('Índice de saúde (UA medido ÷ UA previsto)', U.br(s.healthMean * 100, 1) + ' %') +
      '</tbody></table></div>');
    h.push('<p>' + (s.epsInRange
      ? 'A efetividade média de <b>' + U.br(s.epsMean, 3) + '</b> está dentro da faixa de referência de radiadores automotivos de fluxo cruzado (0,40 a 0,70), o que atende ao critério de coerência física do projeto.'
      : 'A efetividade média de <b>' + U.br(s.epsMean, 3) + '</b> está fora da faixa de referência de 0,40 a 0,70. ' +
        (s.epsMean < 0.4
          ? 'Valores abaixo da faixa indicam ou perda real de desempenho do radiador, ou superestimação da vazão do líquido — que é o parâmetro mais incerto do modelo e deve ser calibrado.'
          : 'Valores acima da faixa costumam indicar subestimação da vazão de ar ou do líquido no modelo.')) + '</p>');

    /* incerteza: o que transforma os numeros acima em resultado */
    if (isFinite(s.relEps)) {
      h.push('<h3>4. Incerteza dos resultados</h3>');
      h.push('<p>Incertezas padrão (k = 1) propagadas pela cadeia de cálculo a partir das especificações dos instrumentos: ±' +
        U.br(p.uTliq, 1) + ' °C nos sensores das mangueiras, ±' + U.br(p.uTobd, 1) +
        ' °C na leitura do PID <code>0105</code>, ±' + U.br(100 * p.uPumpRel, 0) +
        ' % na vazão da bomba e ±' + U.br(100 * p.uAirRel, 0) +
        ' % na vazão de ar na face. As especificações são tratadas como limites de erro com distribuição retangular, ' +
        'conforme o GUM, de modo que a incerteza padrão de cada uma é o limite dividido por √3.</p>');
      h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
        row('Calor rejeitado Q̇', U.br(s.qMean / 1000, 1) + ' ± ' + U.br(s.relQ * s.qMean / 1000, 1) + ' kW  (' + U.br(100 * s.relQ, 0) + ' %)') +
        row('Efetividade ε', U.br(s.epsMean, 3) + ' ± ' + U.br(s.relEps * s.epsMean, 3) + '  (' + U.br(100 * s.relEps, 0) + ' %)') +
        row('Condutância UA', U.br(s.uaMean, 0) + ' ± ' + U.br(s.relUA * s.uaMean, 0) + ' W/K  (' + U.br(100 * s.relUA, 0) + ' %)') +
        row('Incerteza do ΔT medido', U.br(s.uDT, 2) + ' °C sobre ΔT médio de ' + U.br(s.dtMean, 1) + ' °C') +
        row('Amplificação NTU(ε)', '× ' + U.br(s.ampMean, 2)) +
        row('Amostras limitadas pelo líquido', U.br(s.liqLimitsPct, 0) + ' %') +
        '</tbody></table></div>');
      h.push('<p>' + (s.liqLimitsPct > 50
        ? 'Na maior parte da coleta o líquido é o fluido de menor capacidade térmica. Nesse regime a vazão aparece tanto no calor rejeitado quanto no calor máximo e cancela algebricamente: a efetividade se reduz a ΔT / (T_líquido − T_ar), função apenas de temperaturas. A vazão da bomba, que é o parâmetro mais incerto da montagem, portanto não contamina o resultado principal.'
        : 'Na maior parte da coleta é o ar que limita a troca. Nesse regime a vazão não cancela, e as incertezas das duas vazões entram integralmente na efetividade — motivo pelo qual a barra de erro é dominada por elas e não pelos sensores de temperatura. Reduzi-la exige medir a velocidade de face com anemômetro.') +
        ' A condutância UA carrega ainda a não-linearidade da inversão NTU(ε): neste ponto de operação, cada 1 % de incerteza em ε corresponde a ' +
        U.br(s.ampMean, 2) + ' % em NTU.</p>');
    }

    /* compacidade e custo de acionamento */
    if (isFinite(s.jAirMean)) {
      h.push('<h3>5. Compacidade e custo de acionamento</h3>');
      h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
        row('Fator j de Colburn (lado ar)', U.br(s.jAirMean, 4)) +
        row('Número de Stanton (lado ar)', U.br(s.stAirMean, 4)) +
        row('Perda de carga — ar', U.br(s.dpAirMean, 0) + ' Pa') +
        row('Perda de carga — líquido', U.br(s.dpCoolMean, 0) + ' Pa') +
        row('Potência de arrasto do veículo', U.br(s.wRamMean, 0) + ' W') +
        row('Potência do eletroventilador', U.br(s.wFanMean, 0) + ' W') +
        row('Potência de bombeamento', U.br(s.wPumpMean, 1) + ' W') +
        row('Figura de mérito Q̇ / W acionamento', U.br(s.meritMean, 0)) +
        '</tbody></table></div>');
      h.push('<p>O fator j de Colburn ' + (s.jAirMean >= 0.008 && s.jAirMean <= 0.035
        ? 'situa-se na faixa reportada na literatura para aletas persianadas de radiadores automotivos, o que sustenta os coeficientes C e m adotados na correlação do lado ar.'
        : 'situa-se fora da faixa usual de aletas persianadas, o que recomenda revisão dos coeficientes C e m e da densidade de área antes de utilizar o UA teórico como referência.') +
        ' O custo de acionamento é dominado pelo arrasto que o veículo paga para forçar ar pelo núcleo, não pela bomba d\'água — o que localiza corretamente onde um ganho de projeto seria mais caro.</p>');
    }

    h.push('<h3>6. Resultados por regime de operação</h3>');
    h.push('<div class="tbl-scroll"><table class="compact"><thead><tr><th>Regime</th><th class="num">n</th>' +
      '<th class="num">T líquido</th><th class="num">ΔT</th><th class="num">Q̇</th><th class="num">ε</th>' +
      '<th class="num">NTU</th><th class="num">C_r</th><th class="num">UA</th></tr></thead><tbody>' +
      s.byRegime.map(function (r) {
        return '<tr><td>' + U.esc(r.regime) + '</td><td class="num">' + U.br(r.n, 0) + '</td>' +
          '<td class="num">' + U.br(r.ect, 1) + ' °C</td><td class="num">' + U.br(r.dT, 1) + ' °C</td>' +
          '<td class="num">' + U.br(r.q / 1000, 1) + ' kW</td><td class="num">' + U.br(r.eps, 3) + '</td>' +
          '<td class="num">' + U.br(r.ntu, 2) + '</td><td class="num">' + U.br(r.cr, 2) + '</td>' +
          '<td class="num">' + U.br(r.ua, 0) + ' W/K</td></tr>';
      }).join('') + '</tbody></table></div>');

    h.push('<h3>7. Previsão de temperatura</h3>');
    if (fit && fit.ok) {
      var target = parseFloat($('#inMaeTarget').value) || 2.0;
      var v = M.verdict(fit, target);
      h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
        row('Horizonte de previsão', U.mmss(fit.horizon)) +
        row('Amostras do conjunto', U.br(fit.n, 0)) +
        row('Regularização λ', U.br(fit.lambda, fit.lambda < 10 ? 1 : 0) + (fit.cv && fit.cv.ok ? ' (validação cruzada)' : '')) +
        row('MAE — validação cruzada em blocos', U.br(fit.test.mae, 2) + ' °C') +
        row('RMSE — validação cruzada', U.br(fit.test.rmse, 2) + ' °C') +
        row('MAE — holdout final', U.br(fit.holdout.mae, 2) + ' °C') +
        row('Erro no percentil 95', U.br(fit.holdout.p95, 2) + ' °C') +
        row('Linha de base: prever "continua igual"', U.br(fit.test.maeBase, 2) + ' °C') +
        row('Linha de base: extrapolar a tendência', U.br(fit.test.maeLin, 2) + ' °C') +
        row('Ganho sobre a melhor linha de base', U.br(v.better, 0) + ' %') +
        row('Critério de aprovação (MAE ≤ ' + U.br(target, 1) + ' °C)', v.pass ? 'ATENDIDO' : 'NÃO ATENDIDO') +
        '</tbody></table></div>');
      h.push('<h4>Variáveis mais influentes</h4><ul class="clean">' +
        fit.weights.slice(0, 5).map(function (w) {
          return '<li>' + U.esc(w.label) + ' — coeficiente padronizado ' + (w.w >= 0 ? '+' : '') + U.br(w.w, 2) + '</li>';
        }).join('') + '</ul>');
    } else {
      h.push('<p>Modelo não treinado nesta sessão.</p>');
    }

    h.push('<h3>8. Alertas e anomalias</h3>');
    if (a) {
      h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
        row('Alertas preditivos de nível crítico', U.br(a.nPred, 0)) +
        row('Cruzamentos reais do limite crítico (' + U.br(p.tCrit, 0) + ' °C)', U.br(a.nReal, 0)) +
        row('Antecedência média do alerta', isFinite(a.leadMean) ? U.mmss(a.leadMean) : 'não aplicável') +
        row('Antecedência mínima', isFinite(a.leadMin) ? U.mmss(a.leadMin) : 'não aplicável') +
        row('Critério de antecedência (≥ ' + U.mmss(p.leadReq) + ')', a.nReal === 0 ? 'não verificável nesta coleta' : (a.passLead ? 'ATENDIDO' : 'NÃO ATENDIDO')) +
        row('Falsos positivos', U.br(a.falsePos, 0)) +
        '</tbody></table></div>');
    }
    if (S.anom) {
      if (!S.anom.events.length) {
        h.push('<p>Nenhuma anomalia sustentada detectada. Índice de saúde mediano de ' + U.br(S.anom.healthMedian * 100, 0) + ' % do previsto.</p>');
      } else {
        h.push('<ul class="clean">' + S.anom.events.map(function (e) {
          return '<li><b>' + U.mmss(e.t0) + '</b> por ' + U.mmss(e.dur) + ' — ' + U.esc(e.desc) +
            ' (saúde ' + (isFinite(e.health) ? U.br(e.health * 100, 0) + ' %' : '—') +
            ', ε medido ' + U.br(e.eps, 3) + ' contra ' + U.br(e.epsModel, 3) + ' previsto; severidade ' + U.esc(e.sev) + ')</li>';
        }).join('') + '</ul>');
      }
    }

    h.push('<h3>9. Parâmetros e geometria adotados</h3>');
    h.push('<div class="tbl-scroll"><table class="compact"><tbody>' +
      row('Núcleo do radiador', U.br(p.coreW * 1000, 0) + ' × ' + U.br(p.coreH * 1000, 0) + ' × ' + U.br(p.coreD * 1000, 0) + ' mm') +
      row('Área frontal', U.br(g.aFront, 3) + ' m²') +
      row('Área de troca — lado ar', U.br(g.aAir, 2) + ' m²') +
      row('Área de troca — lado líquido', U.br(g.aCool, 3) + ' m²') +
      row('Diâmetro hidráulico — canal de ar', U.br(g.dhAir * 1000, 2) + ' mm') +
      row('Diâmetro hidráulico — tubo do líquido', U.br(g.dhCool * 1000, 2) + ' mm') +
      row('Vazão da bomba por rotação do motor', U.br(p.pumpDisp, 3) + ' L/rev') +
      row('Fração ram-air k_ram', U.br(p.kRam, 2)) +
      row('Velocidade de face com ventilador', U.br(p.vFan, 2) + ' m/s') +
      row('Correlação do lado ar', 'Nu = ' + U.br(p.cAir, 2) + '·Re^' + U.br(p.mAir, 2) + '·Pr^(1/3)') +
      row('Fator de calibração do UA', U.br(p.uaScale, 3) + (S.calib && S.calib.ok ? ' (calibrado nesta coleta)' : ' (não calibrado)')) +
      row('Termostato', 'abre em ' + U.br(p.tStatOpen, 0) + ' °C, pleno em ' + U.br(p.tStatFull, 0) + ' °C') +
      row('Fluido', 'mistura água / etilenoglicol 50 % em volume') +
      '</tbody></table></div>');

    h.push('<h3>10. Limitações e próximos passos</h3><ul class="clean">');
    if (s.mode !== 'exp') h.push('<li>Sem ΔT medido, a efetividade apresentada é uma estimativa do modelo, não um resultado experimental. Instrumentar as mangueiras é a próxima ação prioritária.</li>');
    h.push('<li>A vazão do líquido é estimada em função da rotação (' + U.br(p.pumpDisp, 3) +
      ' L/rev) e é a maior fonte de incerteza do balanço de energia: um erro de 20 % na vazão se propaga integralmente para Q̇ e para ε.</li>');
    h.push('<li>A velocidade de face do ar é modelada como fração da velocidade do veículo (k_ram = ' + U.br(p.kRam, 2) +
      '); medir com anemômetro na face do radiador reduziria essa incerteza.</li>');
    if (S.proc.rows.some(function (d) { return d.ambEstimated; })) h.push('<li>A temperatura ambiente foi estimada a partir da temperatura do ar de admissão, que sofre encharcamento térmico com o veículo parado. Um sensor dedicado fora do compartimento do motor corrige isso.</li>');
    h.push('<li>A geometria do núcleo do radiador está preenchida com valores estimados; substituí-la por medições reais é o que mais melhora o UA teórico.</li>');
    h.push('<li>O modelo de previsão foi treinado com uma única sessão. Mais campanhas, em dias e condições distintas, são necessárias para um resultado estável.</li>');
    h.push('</ul>');

    host.innerHTML = h.join('\n');
    function row(k, v) { return '<tr><td>' + U.esc(k) + '</td><td class="num"><b>' + U.esc(v) + '</b></td></tr>'; }
  }

  function row(k, v) { return '<tr><td>' + U.esc(k) + '</td><td class="num"><b>' + U.esc(v) + '</b></td></tr>'; }

  function exportJson() {
    if (!S.sum) { alert('Carregue uma coleta primeiro.'); return; }
    var out = {
      projeto: 'Apex Thermal Control',
      titulo: 'Análise térmica do radiador automotivo com monitoramento e previsão de temperatura',
      gerado: new Date().toISOString(),
      coleta: S.meta,
      modo: S.proc.mode,
      resumo: S.sum,
      parametros: S.params,
      geometria: T.geom(S.params),
      calibracao: S.calib,
      previsao: S.fit && S.fit.ok ? {
        horizonte: S.fit.horizon, lambda: S.fit.lambda, n: S.fit.n,
        validacaoCruzada: S.fit.test, holdout: S.fit.holdout, pesos: S.fit.weights
      } : null,
      alertas: S.alerts ? {
        preditivos: S.alerts.nPred, reais: S.alerts.nReal,
        antecedenciaMedia: S.alerts.leadMean, antecedenciaMinima: S.alerts.leadMin,
        falsosPositivos: S.alerts.falsePos
      } : null,
      anomalias: S.anom ? S.anom.events : null
    };
    U.download('apex_resumo_' + (S.meta && S.meta.id ? S.meta.id : 'coleta') + '.json',
      JSON.stringify(out, null, 2), 'application/json');
  }

  /* ============================================================
     Render geral
     ============================================================ */
  /* Os valores dos indicadores sobem ate o numero em vez de saltar
     para ele. Nao e enfeite: a subida mostra a ordem de grandeza da
     mudanca antes de o olho ler o digito. Como a fonte e tabular, a
     largura nao muda durante a contagem e nada reflui.             */
  function animateNumbers(root) {
    if (!ATC.Motion || !root) return;
    root.querySelectorAll('.k-val').forEach(function (el) {
      var raw = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue : null;
      if (raw === null) return;
      var txt = raw.trim();
      var v = parseFloat(txt.replace(/\./g, '').replace(',', '.'));
      if (!isFinite(v) || !/^[-−]?[\d.,]+$/.test(txt)) return;
      var dec = (txt.split(',')[1] || '').length;
      var node = el.firstChild;
      var sp = ATC.Motion.spring(0, { k: 120, c: 22, eps: Math.pow(10, -dec) / 4 });
      sp.onStep = function (x) { node.nodeValue = U.br(x, dec); };
      sp.set(0); node.nodeValue = U.br(0, dec);
      sp.to(v);
    });
  }

  function renderAll() {
    renderHeader();
    renderPainel();
    renderAnalise();
    renderIa();
    renderAlerts();
    if (ATC.Explain) ATC.Explain.render(S, G, COL);
    if (ATC.Speed) ATC.Speed.refresh();
    animateNumbers($('#kpiRow'));
    setTimeout(G.redrawAll, 30);
  }

  /* ============================================================
     Superficie publica do aplicativo
     ------------------------------------------------------------
     Os modulos de apresentacao (explicacao, speed mode, paleta de
     comandos) leem o estado por aqui em vez de alcançar variaveis
     internas. Assim ha um so lugar por onde eles entram.
     ============================================================ */
  var API = {
    state: function () { return S; },
    colors: function () { return COL; },
    legend: legend,
    setTab: setTab,
    render: renderAll,
    recompute: function () { recompute(); S.fit = null; S.alerts = null; renderAll(); },
    loadDemo: loadDemo,
    /* chamada pelo speed mode quando a pele troca: paleta, tema dos
       graficos e um redesenho completo                             */
    modeChanged: function () {
      syncPalette();
      G.syncTheme();
      var cur = U.store.get('tab', 'painel');
      setTab(cur);
      renderAll();
    }
  };
  ATC.App = API;

  /* ============================================================
     Comandos da paleta
     ------------------------------------------------------------
     Cada acao da interface aparece aqui com o mesmo nome que tem
     na tela. A lista e a unica fonte: se um botao existe e nao
     esta nesta lista, ele nao e alcancavel pelo teclado — e isso
     conta como defeito.
     ============================================================ */
  function registerCommands() {
    var temColeta = function () { return !!S.proc; };
    var TABS = [
      ['painel', 'Painel', '◧'], ['entenda', 'Entenda o cálculo', '◎'],
      ['importar', 'Importar dados', '↧'], ['analise', 'Análise térmica', '∑'],
      ['ia', 'Previsão', '◈'], ['alertas', 'Alertas', '!'],
      ['relatorio', 'Relatório', '▤'], ['projeto', 'Projeto', '⬡']
    ];
    var list = TABS.map(function (t) {
      return { group: 'Ir para', icon: t[2], label: t[1], keys: t[0], run: function () { setTab(t[0]); } };
    });

    var SPEED_TABS = [['cockpit', 'Cockpit', '◈'], ['cluster', 'Cluster', '◉'],
                      ['ecu', 'ECU', '▣'], ['dyno', 'Dyno', '◭'], ['term', 'Terminal', '>_']];
    SPEED_TABS.forEach(function (t) {
      list.push({
        group: 'Speed mode', icon: t[2], label: 'Ir para ' + t[1], keys: t[0],
        when: function () { return document.documentElement.dataset.mode === 'speed'; },
        run: function () { setTab(t[0]); }
      });
    });

    D.datasets.forEach(function (d) {
      list.push({
        group: 'Dados', icon: '⟐', label: 'Carregar ' + d.name, keys: 'demo demonstracao',
        run: function () { loadDemo(d.id); setTab('painel'); }
      });
    });
    list.push({ group: 'Dados', icon: '↧', label: 'Baixar a coleta de demonstração em CSV', keys: 'download csv',
      run: function () { downloadDemo($('#demoSelect').value); } });
    list.push({ group: 'Dados', icon: '⌫', label: 'Descartar a coleta carregada', keys: 'limpar',
      when: temColeta, run: function () { $('#btnClearData').click(); } });

    list.push({ group: 'Análise', icon: '⊚', label: 'Calibrar pelos dados desta coleta', keys: 'calibrar ua',
      when: temColeta, run: function () { setTab('analise'); doCalibrate(); } });
    list.push({ group: 'Análise', icon: '↻', label: 'Recalcular com os parâmetros atuais', keys: 'recalcular',
      when: temColeta, run: function () { API.recompute(); } });
    list.push({ group: 'Análise', icon: '⌂', label: 'Restaurar os parâmetros padrão', keys: 'reset padroes',
      run: function () { $('#btnResetParams').click(); } });

    list.push({ group: 'Previsão', icon: '◈', label: 'Treinar o modelo de previsão', keys: 'treinar ia modelo',
      when: temColeta, run: function () { setTab('ia'); trainModel(); } });
    list.push({ group: 'Previsão', icon: '!', label: 'Reavaliar os alertas preditivos', keys: 'alertas',
      when: function () { return !!(S.fit && S.fit.ok); }, run: function () { setTab('alertas'); $('#btnAlerts').click(); } });

    list.push({ group: 'Saída', icon: '▤', label: 'Gerar o relatório técnico', keys: 'relatorio',
      when: temColeta, run: function () { setTab('relatorio'); buildReport(); } });
    list.push({ group: 'Saída', icon: '⎙', label: 'Imprimir ou salvar em PDF', keys: 'print pdf imprimir',
      when: temColeta, run: function () { $('#btnPrint').click(); } });
    list.push({ group: 'Saída', icon: '⇩', label: 'Exportar a série processada em CSV', keys: 'csv exportar',
      when: temColeta, run: function () { $('#btnExportCsv').click(); } });
    list.push({ group: 'Saída', icon: '{}', label: 'Exportar o resumo em JSON', keys: 'json exportar',
      when: temColeta, run: function () { exportJson(); } });

    list.push({ group: 'Interface', icon: '◐', label: 'Alternar o speed mode', keys: 'speed modo tema',
      hint: 'easter egg', run: function () { if (ATC.Speed) ATC.Speed.toggle(); } });
    list.push({ group: 'Interface', icon: '♪', label: 'Ligar ou desligar o som da interface', keys: 'som audio',
      run: function () { var b = $('#btnSound'); if (b) b.click(); } });

    ATC.Cmd.register(list);
  }

  /* ============================================================
     Inicializacao
     ============================================================ */
  function init() {
    /* parametros persistidos */
    var saved = U.store.get('params', null);
    if (saved) {
      var def = T.defaults();
      Object.keys(def).forEach(function (k) {
        S.params[k] = isFinite(saved[k]) ? saved[k] : def[k];
      });
    }
    renderParamForm();
    syncParamInputs();

    /* abas, com o cursor deslizante governado por mola */
    var nav = $('nav.tabs');
    if (ATC.Motion && nav) shuttle = ATC.Motion.shuttle(nav);
    $$('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.goto); });
    });

    /* som da interface: comeca desligado e fica lembrado */
    var snd = $('#btnSound');
    if (snd && ATC.Audio) {
      var paint = function () {
        var on = ATC.Audio.enabled();
        snd.setAttribute('aria-pressed', String(on));
        snd.classList.toggle('on', on);
        snd.title = 'Som da interface — ' + (on ? 'ligado' : 'desligado');
      };
      paint();
      snd.addEventListener('click', function () { ATC.Audio.toggle(); paint(); });
    }

    /* paleta de comandos */
    if (ATC.Cmd) {
      registerCommands();
      var bc = $('#btnCmd');
      if (bc) bc.addEventListener('click', function () { ATC.Cmd.open(); });
      var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      var kk = $('#cmdKey');
      if (kk && mac) kk.textContent = '⌘K';
    }

    /* speed mode */
    if (ATC.Speed) ATC.Speed.init(API);
    G.syncTheme();

    /* seletor de demonstracao */
    var sel = $('#demoSelect');
    D.datasets.forEach(function (d) {
      var o = U.el('option', null, d.name);
      o.value = d.id; sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      var d = D.datasets.filter(function (x) { return x.id === sel.value; })[0];
      logLine(d ? d.desc : '', 'dim');
    });
    $('#btnLoadDemo').addEventListener('click', function () { loadDemo(sel.value); setTab('painel'); });
    $('#btnDownloadDemo').addEventListener('click', function () { downloadDemo(sel.value); });
    $('#btnQuickDemo').addEventListener('click', function () { loadDemo(D.datasets[0].id); });
    var bex = $('#btnExDemo');
    if (bex) bex.addEventListener('click', function () { loadDemo(D.datasets[0].id); });

    /* arquivos */
    $('#fileObd').addEventListener('change', function (e) { handleFile('obd', e.target.files[0]); });
    $('#fileEsp').addEventListener('change', function (e) { handleFile('esp', e.target.files[0]); });
    [['#dzObd', 'obd'], ['#dzEsp', 'esp']].forEach(function (pair) {
      var dz = $(pair[0]);
      if (!dz) return;
      ['dragenter', 'dragover'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
      });
      dz.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(pair[1], f);
      });
    });
    $('#btnProcess').addEventListener('click', function () { processData(); setTab('painel'); });
    $('#btnAutoSync').addEventListener('click', autoSync);
    $('#btnClearData').addEventListener('click', function () {
      S.obd = S.esp = S.rows = S.proc = S.sum = S.fit = S.alerts = S.anom = S.meta = null;
      S.log = []; S.calib = null; S.cursor = 0;
      $('#dzObdInfo').textContent = ''; $('#dzEspInfo').textContent = '';
      /* limpa os campos de arquivo: sem isso, reenviar o mesmo arquivo
         nao dispara o evento de mudanca e nada acontece               */
      ['#fileObd', '#fileEsp'].forEach(function (id) { var e = $(id); if (e) e.value = ''; });
      $('#mapCard').hidden = true; $('#auditCard').hidden = true;
      $('#calibNote').hidden = true;
      $('#importLog').innerHTML = '';
      $('#reportBody').innerHTML = '<div class="empty"><span class="big">📄</span>Clique em <b>Gerar relatório</b>.</div>';
      renderAll();
    });

    /* analise */
    $('#btnRecalc').addEventListener('click', function () {
      if (!S.rows) { alert('Carregue uma coleta primeiro.'); return; }
      recompute(); S.fit = null; S.alerts = null; renderAll();
    });
    $('#btnResetParams').addEventListener('click', function () {
      S.params = T.defaults(); persistParams();
      renderParamForm(); syncParamInputs();
      $('#calibNote').hidden = true; S.calib = null;
      if (S.rows) { recompute(); S.fit = null; S.alerts = null; }
      renderAll();
    });
    $('#btnCalibrate').addEventListener('click', doCalibrate);

    /* IA */
    $('#btnTrain').addEventListener('click', trainModel);
    $('#inMaeTarget').addEventListener('change', function () { if (S.fit) renderIa(); });

    /* alertas */
    $('#btnAlerts').addEventListener('click', function () {
      if (!S.fit || !S.fit.ok) { alert('Treine o modelo na aba Previsão (IA) antes de avaliar os alertas.'); return; }
      recomputeAlerts(); syncParamInputs(); renderAlerts(); renderPainel();
    });

    /* relatorio */
    $('#btnBuildReport').addEventListener('click', buildReport);
    $('#btnPrint').addEventListener('click', function () { buildReport(); setTimeout(function () { window.print(); }, 120); });
    $('#btnExportCsv').addEventListener('click', function () {
      if (!S.proc) { alert('Carregue uma coleta primeiro.'); return; }
      U.download('apex_serie_processada.csv', C.exportCsv(S.proc), 'text/csv;charset=utf-8');
    });
    $('#btnExportJson').addEventListener('click', exportJson);

    /* linha do tempo */
    $('#scrub').addEventListener('input', function (e) {
      if (!S.proc) return;
      S.cursor = U.clamp(parseInt(e.target.value, 10) || 0, 0, S.proc.rows.length - 1);
      renderInstant();
      ['#chartTemp', '#chartQ', '#chartOp'].forEach(function (id) {
        var c = $(id);
        if (c && c.__atcCfg) G.update(c, Object.assign({}, c.__atcCfg, { cursorX: S.proc.rows[S.cursor].t }));
      });
    });
    $('#btnPlay').addEventListener('click', togglePlay);

    /* rodape */
    $('#footBuild').textContent = 'versão da página: ' + new Date().toLocaleDateString('pt-BR');

    setTab(U.store.get('tab', 'painel'));
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window.ATC = window.ATC || {});
