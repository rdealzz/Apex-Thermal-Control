/* ============================================================
   Apex Thermal Control — importacao de dados
   Le CSV de apps OBD-II (Car Scanner ELM OBD2, Torque Pro) e de
   loggers proprios (ESP32 + DS18B20), detecta colunas, normaliza
   unidades e sincroniza as duas fontes pelo horario.
   ============================================================ */
(function (ATC) {
  'use strict';

  var U = ATC.U;
  var C = {};

  /* ---------- deteccao do separador ---------- */
  C.sniffDelim = function (text) {
    var head = text.split(/\r?\n/).slice(0, 6).join('\n');
    var cands = [',', ';', '\t', '|'];
    var best = ',', bestScore = -1;
    cands.forEach(function (d) {
      var lines = head.split('\n').filter(function (l) { return l.trim(); });
      if (!lines.length) return;
      var counts = lines.map(function (l) { return C.splitLine(l, d).length; });
      var min = Math.min.apply(null, counts), max = Math.max.apply(null, counts);
      var score = min > 1 && min === max ? min * 10 : min;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  };

  /* divisao respeitando campos entre aspas */
  C.splitLine = function (line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  };

  /* ---------- parse generico ---------- */
  C.parse = function (text, delim) {
    text = text.replace(/^﻿/, '');                 // remove BOM
    var d = delim || C.sniffDelim(text);
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (lines.length < 2) return { header: [], rows: [], delim: d };
    var header = C.splitLine(lines[0], d).map(function (h) { return h.replace(/^"|"$/g, ''); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = C.splitLine(lines[i], d);
      if (cells.length === 1 && cells[0] === '') continue;
      rows.push(cells);
    }
    return { header: header, rows: rows, delim: d };
  };

  /* ---------- numero tolerante (virgula decimal, unidade colada) ---------- */
  C.toNum = function (v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (!s || /^(-|--|n\/?a|nan|null|inf)$/i.test(s)) return NaN;
    s = s.replace(/[^\d,.\-+eE]/g, '');
    /* 1.234,56 -> 1234.56  |  1,234.56 -> 1234.56  |  93,5 -> 93.5 */
    if (/,/.test(s) && /\./.test(s)) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (/,/.test(s)) s = s.replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  };

  /* ---------- tempo: aceita ISO, dd/mm/aaaa, hh:mm:ss, epoch, segundos ---------- */
  C.toTime = function (v, header) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim();
    if (!s) return NaN;

    /* coluna declarada em milissegundos (loggers Arduino/ESP32: millis()) */
    if (header && /millis|\bms\b|\(ms\)/i.test(header)) {
      var ms = C.toNum(s);
      return isFinite(ms) ? ms / 1000 : NaN;
    }

    /* epoch em ms ou s */
    if (/^\d{9,}$/.test(s)) {
      var e = parseInt(s, 10);
      return s.length >= 13 ? e / 1000 : e;
    }
    /* dd/mm/aaaa hh:mm:ss(.mmm) */
    var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?/);
    if (m) {
      var yr = parseInt(m[3], 10); if (yr < 100) yr += 2000;
      var dt = new Date(yr, parseInt(m[2], 10) - 1, parseInt(m[1], 10),
        parseInt(m[4], 10), parseInt(m[5], 10), 0, 0);
      var sec = m[6] ? parseFloat(String(m[6]).replace(',', '.')) : 0;
      return dt.getTime() / 1000 + sec;
    }
    /* ISO 8601 */
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
      var t = Date.parse(s.replace(' ', 'T'));
      if (isFinite(t)) return t / 1000;
    }
    /* somente hora hh:mm:ss(.mmm) */
    var h = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/);
    if (h) {
      return parseInt(h[1], 10) * 3600 + parseInt(h[2], 10) * 60 +
             (h[3] ? parseFloat(String(h[3]).replace(',', '.')) : 0);
    }
    /* numero puro = segundos decorridos */
    var n = C.toNum(s);
    return isFinite(n) ? n : NaN;
  };

  /* ---------- dicionario de deteccao automatica de colunas ---------- */
  C.FIELDS = [
    { key: 'time',  label: 'Tempo / timestamp', unit: '-',    req: true,
      pats: [/^(device )?time$/i, /timestamp/i, /gps ?time/i, /\bhora|horario|horário\b/i, /^tempo/i, /elapsed/i, /seconds/i, /millis/i] },
    { key: 'ect',   label: 'Temp. do líquido (ECT)', unit: '°C', req: true,
      pats: [/coolant/i, /arrefec/i, /l[ií]quido/i, /\bect\b/i, /engine ?temp/i, /temp.*motor/i] },
    { key: 'rpm',   label: 'Rotação do motor',  unit: 'rpm',  req: false,
      pats: [/\brpm\b/i, /rota[cç][aã]o/i, /engine ?speed/i, /giro/i] },
    { key: 'speed', label: 'Velocidade',        unit: 'km/h', req: false,
      pats: [/speed/i, /velocidade/i, /\bvss\b/i, /km\/?h/i] },
    { key: 'load',  label: 'Carga do motor',    unit: '%',    req: false,
      pats: [/\bload\b/i, /carga/i, /throttle.*load/i] },
    { key: 'iat',   label: 'Temp. ar admissão (IAT)', unit: '°C', req: false,
      pats: [/intake ?air/i, /admiss[aã]o/i, /\biat\b/i, /air ?intake/i] },
    { key: 'tAmb',  label: 'Temp. ambiente',    unit: '°C',   req: false,
      pats: [/t_?amb/i, /ambient/i, /ambiente/i, /outside ?air/i, /\baat\b/i, /externa/i] },
    { key: 'tIn',   label: 'T entrada radiador (mangueira superior)', unit: '°C', req: false,
      pats: [/t_?in\b/i, /entrada/i, /upper/i, /superior/i, /\bhot\b/i, /t1\b/i, /ds18.*1/i] },
    { key: 'tOut',  label: 'T saída radiador (mangueira inferior)', unit: '°C', req: false,
      pats: [/t_?out\b/i, /sa[ií]da/i, /lower/i, /inferior/i, /\bcold\b/i, /t2\b/i, /ds18.*2/i] },
    { key: 'fan',   label: 'Estado do ventilador', unit: '0/1', req: false,
      pats: [/\bfan\b/i, /ventil/i, /eletroventil/i] }
  ];

  /* pontuacao de compatibilidade coluna x campo */
  C.autoMap = function (header) {
    var map = {}, used = {};
    C.FIELDS.forEach(function (f) {
      var best = -1, bestScore = 0;
      header.forEach(function (h, i) {
        if (used[i]) return;
        var score = 0;
        for (var k = 0; k < f.pats.length; k++) {
          if (f.pats[k].test(h)) { score = f.pats.length - k + 3; break; }
        }
        /* desempate: campos de temperatura preferem colunas com unidade C */
        if (score && /(°|deg)\s*c\b/i.test(h) && /^(ect|iat|tAmb|tIn|tOut)$/.test(f.key)) score += 1;
        /* evita casar "coolant" em coluna de pressao/tensao */
        if (/press|volt|bar|kpa|psi/i.test(h) && f.key !== 'time') score = 0;
        if (score > bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0) { map[f.key] = best; used[best] = true; }
      else map[f.key] = -1;
    });
    return map;
  };

  /* ---------- normalizacao de unidades ---------- */
  C.normTemp = function (v, header) {
    if (!isFinite(v)) return NaN;
    if (header && /fahrenheit|(?:°|deg\s*|\(\s*)f\s*\)?(?![a-z])/i.test(header)) return (v - 32) * 5 / 9;
    if (v > 200 && v < 500) return v - 273.15;                 // provavelmente Kelvin
    return v;
  };
  C.normSpeed = function (v, header) {
    if (!isFinite(v)) return NaN;
    if (header && /\bmph\b/i.test(header)) return v * 1.609344;
    if (header && /\bm\/s\b/i.test(header)) return v * 3.6;
    return v;
  };

  /* ---------- extracao para registros normalizados ---------- */
  C.extract = function (parsed, map) {
    var H = parsed.header, out = [], warns = [];
    var g = function (cells, key) {
      var i = map[key];
      return (i === undefined || i < 0 || i >= cells.length) ? undefined : cells[i];
    };
    for (var r = 0; r < parsed.rows.length; r++) {
      var c = parsed.rows[r];
      var rec = {
        time: C.toTime(g(c, 'time'), H[map.time]),
        ect: C.normTemp(C.toNum(g(c, 'ect')), H[map.ect]),
        rpm: C.toNum(g(c, 'rpm')),
        speed: C.normSpeed(C.toNum(g(c, 'speed')), H[map.speed]),
        load: C.toNum(g(c, 'load')),
        iat: C.normTemp(C.toNum(g(c, 'iat')), H[map.iat]),
        tAmb: C.normTemp(C.toNum(g(c, 'tAmb')), H[map.tAmb]),
        tIn: C.normTemp(C.toNum(g(c, 'tIn')), H[map.tIn]),
        tOut: C.normTemp(C.toNum(g(c, 'tOut')), H[map.tOut])
      };
      var fv = g(c, 'fan');
      if (fv !== undefined && String(fv).trim() !== '') {
        rec.fan = /^(on|lig|true|sim|yes|1)/i.test(String(fv).trim()) ? 1
                : (/^(off|desl|false|nao|não|no|0)/i.test(String(fv).trim()) ? 0 : C.toNum(fv));
      }
      if (isFinite(rec.time)) out.push(rec);
    }
    if (!out.length) warns.push('Nenhuma linha com tempo válido — verifique o mapeamento da coluna de tempo.');
    out.sort(function (a, b) { return a.time - b.time; });

    /* remove tempos duplicados mantendo o ultimo valor conhecido */
    var dedup = [];
    for (var i = 0; i < out.length; i++) {
      if (dedup.length && Math.abs(out[i].time - dedup[dedup.length - 1].time) < 1e-6) {
        var prev = dedup[dedup.length - 1];
        Object.keys(out[i]).forEach(function (k) {
          if (isFinite(out[i][k])) prev[k] = out[i][k];
        });
      } else dedup.push(out[i]);
    }
    if (dedup.length !== out.length) warns.push((out.length - dedup.length) + ' linha(s) com horário duplicado foram mescladas.');
    return { rows: dedup, warns: warns };
  };

  /* ---------- preenchimento de lacunas (ELM327 le PIDs em sequencia) ----------
     Cada PID chega em instantes diferentes; o app grava celulas vazias.
     Interpolamos linearmente com limite de tempo para nao inventar dado. */
  C.fillGaps = function (rows, keys, maxGapSec) {
    var lim = maxGapSec === undefined ? 8 : maxGapSec;
    keys.forEach(function (k) {
      var idx = [], val = [];
      for (var i = 0; i < rows.length; i++) if (isFinite(rows[i][k])) { idx.push(rows[i].time); val.push(rows[i][k]); }
      if (idx.length < 2) return;
      for (var j = 0; j < rows.length; j++) {
        if (isFinite(rows[j][k])) continue;
        var t = rows[j].time;
        /* acha vizinhos */
        var lo = -1, hi = -1;
        for (var m = 0; m < idx.length; m++) { if (idx[m] <= t) lo = m; if (idx[m] >= t) { hi = m; break; } }
        if (lo < 0 && hi < 0) continue;
        if (lo < 0) {                                  /* antes da 1a leitura do PID */
          if (idx[hi] - t <= lim) { rows[j][k] = val[hi]; rows[j]['_interp_' + k] = true; }
          continue;
        }
        if (hi < 0 || hi === lo) {                     /* apos a ultima leitura: retencao */
          if (t - idx[lo] <= lim) { rows[j][k] = val[lo]; rows[j]['_interp_' + k] = true; }
          continue;
        }
        if (idx[hi] - idx[lo] > lim) continue;
        rows[j][k] = U.interp(idx, val, t);
        rows[j]['_interp_' + k] = true;
      }
    });
    return rows;
  };

  /* ---------- sincronizacao OBD + ESP32 ----------
     offset: segundos somados ao tempo do arquivo do ESP32
     tol:    tolerancia de casamento (vizinho mais proximo)          */
  C.merge = function (obd, esp, offset, tol) {
    var off = offset || 0, t0 = tol === undefined ? 2 : tol;
    var log = [];
    if (!obd || !obd.length) return { rows: esp || [], log: ['Sem dados OBD-II.'] };
    if (!esp || !esp.length) return { rows: obd, log: ['Sem dados do logger de temperatura — o cálculo usará o modo modelo.'] };

    var et = esp.map(function (r) { return r.time + off; });
    var matched = 0;
    var out = obd.map(function (r) {
      var rec = {};
      Object.keys(r).forEach(function (k) { rec[k] = r[k]; });
      /* busca binaria pelo vizinho mais proximo */
      var lo = 0, hi = et.length - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (et[mid] <= r.time) lo = mid; else hi = mid; }
      var pick = Math.abs(et[lo] - r.time) <= Math.abs(et[hi] - r.time) ? lo : hi;
      if (Math.abs(et[pick] - r.time) <= t0) {
        ['tIn', 'tOut', 'tAmb', 'fan'].forEach(function (k) {
          if (isFinite(esp[pick][k])) rec[k] = esp[pick][k];
        });
        matched++;
      }
      return rec;
    });
    log.push(matched + ' de ' + obd.length + ' amostras OBD-II casadas com o logger (tolerância ' + t0 + ' s, offset ' + off + ' s).');
    if (matched === 0) log.push('ATENÇÃO: nenhum casamento. Ajuste o offset — os relógios das duas fontes estão distantes.');
    else if (matched < obd.length * 0.5) log.push('ATENÇÃO: menos de metade das amostras casou. Verifique o offset ou aumente a tolerância.');
    return { rows: out, log: log };
  };

  /* ---------- validacao / relatorio de qualidade ---------- */
  C.audit = function (rows) {
    var a = { n: rows.length, issues: [], stats: {} };
    if (!rows.length) { a.issues.push({ lvl: 'err', msg: 'Nenhuma amostra válida.' }); return a; }
    var t0 = rows[0].time, t1 = rows[rows.length - 1].time;
    a.duration = t1 - t0;
    var dts = [];
    for (var i = 1; i < rows.length; i++) dts.push(rows[i].time - rows[i - 1].time);
    a.dtMedian = U.percentile(dts, 0.5);
    a.rate = a.dtMedian > 0 ? 1 / a.dtMedian : NaN;
    a.gaps = dts.filter(function (d) { return d > Math.max(5, a.dtMedian * 6); }).length;

    ['ect', 'rpm', 'speed', 'load', 'iat', 'tAmb', 'tIn', 'tOut'].forEach(function (k) {
      var v = rows.map(function (r) { return r[k]; }).filter(isFinite);
      a.stats[k] = { n: v.length, pct: 100 * v.length / rows.length, min: U.min(v), max: U.max(v), mean: U.mean(v) };
    });

    if (a.duration < 120) a.issues.push({ lvl: 'warn', msg: 'Sessão muito curta (' + U.mmss(a.duration) + '). O ideal são pelo menos 20 min com trecho urbano e rodoviário.' });
    if (a.gaps > 0) a.issues.push({ lvl: 'warn', msg: a.gaps + ' lacuna(s) de amostragem detectada(s) — possível queda de conexão Bluetooth do ELM327.' });
    if (!a.stats.ect.n) a.issues.push({ lvl: 'err', msg: 'Sem temperatura do líquido: é o dado central do projeto.' });
    if (a.stats.rpm.pct < 50) a.issues.push({ lvl: 'warn', msg: 'RPM ausente em mais de metade das amostras — verifique o PID 010C e o barramento CAN.' });
    if (a.stats.speed.pct < 50) a.issues.push({ lvl: 'warn', msg: 'Velocidade ausente em mais de metade das amostras — verifique o PID 010D ou use GPS.' });
    if (a.stats.rpm.n && a.stats.rpm.max < 100) a.issues.push({ lvl: 'err', msg: 'RPM sempre próximo de zero: o PID responde mas não traz dado válido (verificar cluster/CAN).' });
    if (!a.stats.tIn.n || !a.stats.tOut.n) a.issues.push({ lvl: 'warn', msg: 'Sem ΔT medido (T entrada/saída do radiador). O cálculo roda em MODO MODELO — a efetividade é estimada, não medida.' });
    if (!a.stats.tAmb.n) a.issues.push({ lvl: 'warn', msg: 'Sem temperatura ambiente: será estimada a partir da IAT (offset configurável).' });
    if (a.stats.ect.n && a.stats.ect.max < 70) a.issues.push({ lvl: 'warn', msg: 'O motor não atingiu a temperatura de operação (máx ' + U.br(a.stats.ect.max, 1) + ' °C). Sessão só de aquecimento.' });
    if (a.rate < 0.25) a.issues.push({ lvl: 'warn', msg: 'Taxa de amostragem baixa (' + U.br(a.rate, 2) + ' Hz). Reduza a quantidade de PIDs ativos no app.' });
    if (!a.issues.length) a.issues.push({ lvl: 'ok', msg: 'Nenhum problema relevante encontrado na base.' });
    return a;
  };

  /* ---------- exportacao da serie processada ---------- */
  C.exportCsv = function (proc) {
    var cols = [
      ['t', 't_s'], ['tHotIn', 'T_entrada_C'], ['tOut', 'T_saida_C'], ['dT', 'dT_C'],
      ['tAmb', 'T_amb_C'], ['ect', 'ECT_obd_C'], ['iat', 'IAT_C'],
      ['rpm', 'RPM'], ['speed', 'v_kmh'], ['load', 'carga_pct'], ['fan', 'ventilador'],
      ['mdotCool', 'mdot_liq_kg_s'], ['vdotCool', 'vazao_L_min'], ['tStatFrac', 'termostato_frac'],
      ['mdotAir', 'mdot_ar_kg_s'], ['vFace', 'v_face_m_s'],
      ['Ch', 'C_quente_W_K'], ['Cc', 'C_frio_W_K'], ['Cmin', 'C_min_W_K'], ['Cr', 'Cr'],
      ['q', 'Q_W'], ['qMax', 'Q_max_W'], ['eps', 'efetividade'], ['ntu', 'NTU'], ['ua', 'UA_W_K'],
      ['uaModel', 'UA_modelo_W_K'], ['epsModel', 'eps_modelo'], ['health', 'saude_UA'],
      ['dTdt', 'dTdt_C_min'], ['regime', 'regime']
    ];
    var lines = [cols.map(function (c) { return c[1]; }).join(',')];
    proc.rows.forEach(function (d) {
      lines.push(cols.map(function (c) {
        var v = d[c[0]];
        if (typeof v === 'string') return v;
        return isFinite(v) ? Number(v).toFixed(4) : '';
      }).join(','));
    });
    return lines.join('\n');
  };

  ATC.CsvIO = C;
})(typeof window !== 'undefined' ? (window.ATC = window.ATC || {}) : (globalThis.ATC = globalThis.ATC || {}));
