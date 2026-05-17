'use strict';

// ══════════════════════════════════════════════════════════════
//  URL helpers
// ══════════════════════════════════════════════════════════════
const urlQt   = pref => `https://qt.gtimg.cn/q=${pref}`;
const urlDayK = (pref, lmt = 240) =>
  `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${pref},day,,,${lmt},qfq&_=${Date.now()}`;

// ══════════════════════════════════════════════════════════════
//  Fetch helpers
// ══════════════════════════════════════════════════════════════
async function fetchTextGBK(url) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('网络错误:' + r.status);
  return new TextDecoder('gbk').decode(await r.arrayBuffer());
}

async function fetchJson(url) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('网络错误:' + r.status);
  return r.json();
}

// ══════════════════════════════════════════════════════════════
//  Code normalisation & quote parsing
// ══════════════════════════════════════════════════════════════
function normalizeCode(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (/^s[hz][0-9]{6}$/.test(raw)) return raw;
  if (/^[0-9]{6}$/.test(raw))
    return (raw[0] === '6' || raw[0] === '9' ? 'sh' : 'sz') + raw;
  throw new Error('请输入 6 位代码或 sh/sz 前缀代码');
}

function parseQtBasic(text) {
  const m = text.match(/"([^"]+)"/);
  if (!m) return null;
  const a = m[1].split('~');
  const price  = a[3]  ? +a[3]  : null;
  const yclose = a[4]  ? +a[4]  : null;
  return {
    name: a[1] || '-', code: a[2] || '-', price, yclose,
    open:   a[5] ? +a[5] : null,
    chgPct: (price != null && yclose) ? (price - yclose) / yclose * 100 : null,
  };
}

// ══════════════════════════════════════════════════════════════
//  Technical indicator calculations  (pure functions)
// ══════════════════════════════════════════════════════════════
function calcMA(closes, n) {
  const r = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += closes[i - j];
    r[i] = +(s / n).toFixed(2);
  }
  return r;
}

function calcEMA(closes, n) {
  const k = 2 / (n + 1);
  const ema = new Array(closes.length).fill(null);
  let p = null;
  for (let i = 0; i < closes.length; i++) {
    if (p == null) {
      if (i === n - 1) {
        let s = 0;
        for (let j = 0; j < n; j++) s += closes[i - j];
        p = s / n; ema[i] = +p.toFixed(4);
      }
    } else {
      p = closes[i] * k + p * (1 - k); ema[i] = +p.toFixed(4);
    }
  }
  return ema;
}

function calcMACD(closes) {
  const e12 = calcEMA(closes, 12), e26 = calcEMA(closes, 26);
  const dif = closes.map((_, i) =>
    (e12[i] != null && e26[i] != null) ? +(e12[i] - e26[i]).toFixed(4) : null
  );
  const dea = new Array(closes.length).fill(null);
  let p = null; const k = 2 / 10;
  for (let i = 0; i < dif.length; i++) {
    if (dif[i] == null) continue;
    p = p == null ? dif[i] : dif[i] * k + p * (1 - k);
    dea[i] = +p.toFixed(4);
  }
  const hist = dif.map((v, i) =>
    (v != null && dea[i] != null) ? +(v - dea[i]).toFixed(4) : null
  );
  return { dif, dea, hist };
}

function calcRSI(closes, n = 14) {
  const r = new Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) g += ch; else l -= ch;
  }
  let avgG = g / n, avgL = l / n;
  r[n] = +(100 - 100 / (1 + avgG / (avgL || 1e-9))).toFixed(2);
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgG = (avgG * (n - 1) + Math.max(ch, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-ch, 0)) / n;
    r[i] = +(100 - 100 / (1 + (avgL === 0 ? 99 : avgG / avgL))).toFixed(2);
  }
  return r;
}

function calcBOLL(closes, n = 20, k = 2) {
  const mid = [], up = [], down = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { mid.push(null); up.push(null); down.push(null); continue; }
    let s = 0;
    for (let j = 0; j < n; j++) s += closes[i - j];
    const ma = s / n;
    let v = 0;
    for (let j = 0; j < n; j++) { const d = closes[i - j] - ma; v += d * d; }
    const sd = Math.sqrt(v / n);
    mid.push(+ma.toFixed(2));
    up.push(+(ma + k * sd).toFixed(2));
    down.push(+(ma - k * sd).toFixed(2));
  }
  return { mid, up, down };
}

function calcATR(highs, lows, closes, n = 14) {
  const tr = highs.map((h, i) => i === 0
    ? h - lows[i]
    : Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
  );
  const atr = new Array(tr.length).fill(null);
  let s = 0;
  for (let i = 0; i < n; i++) s += tr[i];
  atr[n - 1] = +(s / n).toFixed(4);
  for (let i = n; i < tr.length; i++)
    atr[i] = +((atr[i - 1] * (n - 1) + tr[i]) / n).toFixed(4);
  return atr;
}

function calcMFI(highs, lows, closes, volumes, n = 14) {
  const tp = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const mf = tp.map((t, i) => t * (volumes[i] || 0));
  const r  = new Array(closes.length).fill(null);
  for (let i = n; i < closes.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - n + 1; j <= i; j++) {
      if (tp[j] >= tp[j - 1]) pos += mf[j]; else neg += mf[j];
    }
    r[i] = neg === 0 ? 100 : +(100 - 100 / (1 + pos / neg)).toFixed(2);
  }
  return r;
}

function calcOBVTrend(closes, volumes, n = 20) {
  let obv = 0;
  const arr = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1])      obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    arr.push(obv);
  }
  const last = arr.length - 1, prev = Math.max(0, last - n);
  return { up: arr[last] >= arr[prev] };
}

function nearestLevels(highs, lows, closes) {
  const C = closes[closes.length - 1];
  const start = Math.max(3, closes.length - 63);
  const res = [], sup = [];
  for (let i = start; i < closes.length - 3; i++) {
    const hi = highs[i], lo = lows[i];
    const isHigh = highs[i-1] < hi && highs[i-2] < hi && highs[i+1] < hi && highs[i+2] < hi;
    const isLow  = lows[i-1]  > lo && lows[i-2]  > lo && lows[i+1]  > lo && lows[i+2]  > lo;
    if (isHigh && hi > C) res.push(hi);
    if (isLow  && lo < C) sup.push(lo);
  }
  return {
    resistance: res.length ? Math.min(...res) : null,
    support:    sup.length ? Math.max(...sup) : null,
  };
}

function calcKDJ(highs, lows, closes, n = 9) {
  const len = closes.length;
  const K = new Array(len).fill(null);
  const D = new Array(len).fill(null);
  const J = new Array(len).fill(null);
  let prevK = 50, prevD = 50;
  for (let i = 0; i < len; i++) {
    const start = Math.max(0, i - n + 1);
    let hh = -Infinity, ll = Infinity;
    for (let j = start; j <= i; j++) {
      if (highs[j] != null) hh = Math.max(hh, highs[j]);
      if (lows[j]  != null) ll = Math.min(ll, lows[j]);
    }
    if (!isFinite(hh) || !isFinite(ll) || hh === ll) {
      K[i] = prevK; D[i] = prevD; J[i] = 3 * prevK - 2 * prevD; continue;
    }
    const RSV = (closes[i] - ll) / (hh - ll) * 100;
    const k = (2 / 3) * prevK + (1 / 3) * RSV;
    const d = (2 / 3) * prevD + (1 / 3) * k;
    K[i] = k; D[i] = d; J[i] = 3 * k - 2 * d;
    prevK = k; prevD = d;
  }
  return { K, D, J };
}

function linearRegressionFull(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i]; }
  const denom = n * sxx - sx * sx || 1e-9;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  const yMean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - yMean) ** 2;
    ssRes += (ys[i] - (a * xs[i] + b)) ** 2;
  }
  return { a, b, r2: ssTot > 1e-10 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
}

function analyzePlus(data) {
  if (!data || data.closes.length < 30)
    return { score: 0, pct1: null, pct3: null, pct7: null, text: '样本不足', mood: 'neutral' };

  const { closes, volumes, highs, lows } = data;
  const last = closes.length - 1, C = closes[last];

  const ma20 = calcMA(closes, 20), ma60 = calcMA(closes, 60);
  const macd = calcMACD(closes);
  const rsi  = calcRSI(closes);
  const boll = calcBOLL(closes);
  const atr  = calcATR(highs, lows, closes);
  const mfi  = calcMFI(highs, lows, closes, volumes);
  const obv  = calcOBVTrend(closes, volumes);
  const kdj  = calcKDJ(highs, lows, closes);
  const lvl  = nearestLevels(highs, lows, closes);

  const vol20 = volumes?.length
    ? volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length)
    : null;

  let score = 0;
  if (C > (ma20[last] ?? 0))                           score++;
  if ((ma20[last] ?? 0) > (ma60[last] ?? 0))           score++;
  if ((macd.hist[last] ?? 0) > 0)                      score++;
  if ((rsi[last] ?? 50) > 50)                          score++;
  if ((kdj.K[last] ?? 50) > (kdj.D[last] ?? 50))      score++;
  if ((mfi[last] ?? 50) > 50)                          score++;
  if (obv.up)                                          score++;
  if (vol20 && volumes[last] > vol20)                  score++;

  const mood = score >= 6 ? 'bull' : score <= 2 ? 'bear' : 'neutral';

  const atrNow  = atr[atr.length - 1] ?? 0;
  const stopRef = atrNow ? C - 2 * atrNow : null;
  const atrPct  = C > 0 ? atrNow / C * 100 : 0;

  const N_TREND = Math.min(15, closes.length);
  const segT  = closes.slice(-N_TREND);
  const xsT   = segT.map((_, i) => i + 1);
  const trend = linearRegressionFull(xsT, segT.map(v => Math.log(Math.max(v, 1e-6))));
  const slopeD = trend.a * 100;
  const r2     = trend.r2;

  const bull1 =  atrPct,                bear1 = -atrPct;
  const bull3 =  atrPct * Math.sqrt(3), bear3 = -atrPct * Math.sqrt(3);
  const bull7 =  atrPct * Math.sqrt(7), bear7 = -atrPct * Math.sqrt(7);

  let trendQuality;
  if (r2 < 0.4) {
    trendQuality = `震荡无方向（R²=${r2.toFixed(2)}，斜率不可信）`;
  } else {
    const dir = trend.a > 0 ? '↑上升' : '↓下降';
    const str = r2 > 0.75 ? '强' : r2 > 0.55 ? '中' : '弱';
    trendQuality = `${dir}趋势（${str}  斜率：${slopeD >= 0 ? '+' : ''}${slopeD.toFixed(2)}%/日  R²=${r2.toFixed(2)}）`;
  }

  const pct1 = r2 >= 0.4 ? slopeD * r2 * 3 : 0;
  const pct3 = bull3, pct7 = bull7;

  const volNote = (vol20 && volumes[last])
    ? volumes[last] > vol20 * 1.8 ? '放量' : volumes[last] < vol20 * 0.6 ? '缩量' : '量能中性'
    : '—';

  const bw = (boll.up[last] != null && boll.down[last] != null)
    ? (boll.up[last] - boll.down[last]) / (boll.down[last] || 1)
    : null;

  const text = [
    `总体：${mood === 'bull' ? '偏多' : mood === 'bear' ? '偏空' : '震荡'}（${score}/8）`,
    `价位：C=${C.toFixed(2)}  MA20=${ma20[last]?.toFixed(2) ?? '-'}  MA60=${ma60[last]?.toFixed(2) ?? '-'}`,
    `KDJ：K=${kdj.K[last]?.toFixed(1) ?? '-'}  D=${kdj.D[last]?.toFixed(1) ?? '-'}  J=${kdj.J[last]?.toFixed(1) ?? '-'}`,
    `MACD：DIF=${macd.dif[last]?.toFixed(4) ?? '-'}  DEA=${macd.dea[last]?.toFixed(4) ?? '-'}  柱=${macd.hist[last] != null ? (macd.hist[last] > 0 ? '正' : '负') : '—'}`,
    `RSI14：${rsi[last]?.toFixed(1) ?? '—'}  MFI14：${mfi[last]?.toFixed(1) ?? '—'}  OBV：${obv.up ? '上升' : '下降'}`,
    `量能：${volNote}  BOLL带宽：${bw ? (bw * 100).toFixed(1) + '%' : '—'}  ATR14：${atrNow.toFixed(2)}`,
    `支撑：${lvl.support?.toFixed(2) ?? '无'}  压力：${lvl.resistance?.toFixed(2) ?? '无'}  止损参考：${stopRef?.toFixed(2) ?? '—'}（2×ATR）`,
    ``,
    `【近期走势 15日】${trendQuality}`,
    `【波动区间 ATR模型】±N×ATR×√t，非价格预测`,
    `  +1日：${bear1.toFixed(1)}% ～ +${bull1.toFixed(1)}%`,
    `  +3日：${bear3.toFixed(1)}% ～ +${bull3.toFixed(1)}%`,
    `  +7日：${bear7.toFixed(1)}% ～ +${bull7.toFixed(1)}%`,
  ].join('\n');

  const rsiLast = rsi[last]  ?? 50;
  const kLast   = kdj.K[last] ?? 50;
  const bias20  = ma20[last] ? (C - ma20[last]) / ma20[last] * 100 : 0;

  return { score, pct1, pct3, pct7, text, mood, rsiLast, kLast, bias20 };
}

function computeAdvanced(data, shIndex) {
  if (!data || data.closes.length < 30) return '样本不足';
  const { closes, volumes, highs, lows } = data;
  const last = closes.length - 1, C = closes[last];
  const ma20 = calcMA(closes, 20), ma60 = calcMA(closes, 60);
  const boll = calcBOLL(closes);
  const atr  = calcATR(highs, lows, closes);

  const bUp = boll.up[last], bDn = boll.down[last];
  const bPercent = (bUp != null && bDn != null)
    ? Math.max(0, Math.min(1, (C - bDn) / Math.max(1e-9, bUp - bDn)))
    : null;
  const bias20 = ma20[last] ? (C - ma20[last]) / ma20[last] * 100 : null;

  const wnd = closes.slice(-240);
  const hi52 = Math.max(...wnd), lo52 = Math.min(...wnd);
  const pct52 = (C - lo52) / Math.max(1e-9, hi52 - lo52) * 100;

  const vol20 = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length);
  const heat  = volumes[last] ? (volumes[last] / Math.max(1, vol20)) : null;

  // ── Pivot points: use PREVIOUS bar's H/L/C (standard formula) ──
  const pH = highs[last - 1] ?? highs[last];
  const pL = lows[last - 1]  ?? lows[last];
  const pC = closes[last - 1] ?? closes[last];
  const P  = (pH + pL + pC) / 3;
  const R1 = 2 * P - pL,      S1 = 2 * P - pH;
  const R2 = P + (pH - pL),   S2 = P - (pH - pL);

  // ── Pivot validity check ──
  const gapUpInvalid   = C > R2;
  const gapDownInvalid = C < S2;

  // ── Current price position relative to pivot ──
  const aboveP  = C >= P;
  const pctToP  = (C - P) / P * 100;
  const pctToR1 = (R1 - C) / C * 100;
  const pctToS1 = (C - S1) / C * 100;
  let posNote;
  if (gapUpInvalid) {
    const pctAboveR2 = (C - R2) / R2 * 100;
    posNote = `已突破全部压力位，高于 R2 达 +${pctAboveR2.toFixed(1)}%（昨收 ${pC.toFixed(2)} 可作回调支撑参考）`;
  } else if (gapDownInvalid) {
    const pctBelowS2 = (S2 - C) / S2 * 100;
    posNote = `已跌破全部支撑位，低于 S2 达 ${pctBelowS2.toFixed(1)}%（昨收 ${pC.toFixed(2)} 可作反弹压力参考）`;
  } else {
    posNote = aboveP
      ? `P 上方 +${pctToP.toFixed(1)}%，距压力 R1 还有 ${pctToR1.toFixed(1)}%`
      : `P 下方 ${Math.abs(pctToP).toFixed(1)}%，距支撑 S1 还有 ${pctToS1.toFixed(1)}%`;
  }

  // ── Confluence: only when pivot is valid ──
  const NEAR = 0.008;
  const isNear = (a, b) => b != null && Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) < NEAR;
  const refLevels = [
    { val: ma20[last],      label: 'MA20'    },
    { val: ma60[last],      label: 'MA60'    },
    { val: boll.up[last],   label: 'BOLL上轨' },
    { val: boll.mid[last],  label: 'BOLL中轨' },
    { val: boll.down[last], label: 'BOLL下轨' },
  ];
  const confluences = [];
  if (!gapUpInvalid && !gapDownInvalid) {
    [{ name: 'R2', val: R2 }, { name: 'R1', val: R1 },
     { name: 'P',  val: P  }, { name: 'S1', val: S1 }, { name: 'S2', val: S2 }]
    .forEach(({ name, val }) => {
      const hits = refLevels.filter(r => isNear(val, r.val)).map(r => r.label);
      if (hits.length) confluences.push(`${name}≈${hits.join('/')}`);
    });
  }

  // ── Gap detection ──
  let gapNote = '无';
  for (let i = Math.max(1, closes.length - 30); i < closes.length; i++) {
    if (lows[i] > highs[i - 1])
      gapNote = '向上缺口：' + (closes.slice(i + 1).some(c => c <= highs[i - 1]) ? '已回补' : '未回补');
    if (highs[i] < lows[i - 1])
      gapNote = '向下缺口：' + (closes.slice(i + 1).some(c => c >= lows[i - 1]) ? '已回补' : '未回补');
  }

  // ── Relative strength vs SH index ──
  let rs20 = '—';
  try {
    if (shIndex?.closes?.length >= 21) {
      const sl = shIndex.closes.length;
      const diff = (closes[last] / closes[last - 20] - shIndex.closes[sl - 1] / shIndex.closes[sl - 21]) * 100;
      rs20 = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%（${diff >= 0 ? '跑赢' : '跑输'}上证20日）`;
    }
  } catch {}

  const fmt = v => v == null || isNaN(v) ? '—' : v.toFixed(2) + '%';
  const pivotHeader = (gapUpInvalid || gapDownInvalid)
    ? `枢轴点（今日失效）：P=${P.toFixed(2)}  R1=${R1.toFixed(2)}  R2=${R2.toFixed(2)}  S1=${S1.toFixed(2)}  S2=${S2.toFixed(2)}`
    : `枢轴点：P=${P.toFixed(2)}  R1=${R1.toFixed(2)}  R2=${R2.toFixed(2)}  S1=${S1.toFixed(2)}  S2=${S2.toFixed(2)}`;

  const lines = [ pivotHeader, `当前位置：${posNote}` ];

  if (gapUpInvalid)
    lines.push(`⚠ 枢轴失效：大幅跳空高开/涨停，请参考自动分析中的摆动支撑位`);
  else if (gapDownInvalid)
    lines.push(`⚠ 枢轴失效：大幅跳空低开/跌停，请参考自动分析中的摆动压力位`);
  else if (confluences.length)
    lines.push(`⚠ 双重关键位：${confluences.join('  ')}（枢轴与均线/BOLL重合，支撑/压力更强）`);

  lines.push(
    `距MA20：${fmt((C - ma20[last]) / ma20[last] * 100)}  距MA60：${fmt((C - ma60[last]) / ma60[last] * 100)}`,
    `%B：${fmt(bPercent * 100)}  BIAS20：${fmt(bias20)}  52周百分位：${fmt(pct52)}`,
    `ATR14：${atr[atr.length - 1]?.toFixed(2) ?? '—'}  量能热度：${heat ? heat.toFixed(2) + 'x' : '—'}`,
    `缺口：${gapNote}`,
    `相对强弱（20日）：${rs20}`,
  );
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════
//  K-line data builder
// ══════════════════════════════════════════════════════════════
function buildFromKArray(arr) {
  const category = [], values = [], closes = [], volumes = [], highs = [], lows = [];
  for (const p of arr) {
    const a = Array.isArray(p) ? p : String(p).split(',');
    const [date, open, close, high, low, vol] = [a[0], +a[1], +a[2], +a[3], +a[4], +a[5] || 0];
    if (!isNaN(open) && !isNaN(close) && !isNaN(high) && !isNaN(low)) {
      category.push(date); values.push([open, close, low, high]);
      closes.push(close); volumes.push(vol); highs.push(high); lows.push(low);
    }
  }
  return { category, values, closes, volumes, highs, lows };
}

// ══════════════════════════════════════════════════════════════
//  Stock filtering helpers
// ══════════════════════════════════════════════════════════════
function isExcludedName(name) { return /(^|\*)ST|＊ST|退/.test(name); }

const STALE_MS = 10 * 86400000;

async function getBasic(pref) {
  try {
    const raw = await fetchTextGBK(urlQt(pref));
    const b   = parseQtBasic(raw);
    if (!b?.name || b.name === '-' || b.name.trim() === '') return null;
    if (isExcludedName(b.name)) return null;
    if (!b.price || b.price <= 0) return null;
    if (b.chgPct != null && b.chgPct >= 10) return null;
    return b;
  } catch { return null; }
}

async function getDayK(pref) {
  try {
    const js   = await fetchJson(urlDayK(pref));
    const node = js?.data?.[pref] || {};
    const arr  = node['qfqday'] || node['day'] || [];
    if (!arr.length) return null;
    const data = buildFromKArray(arr);
    if (data.closes.length < 40) return null;
    const lastDate = data.category[data.category.length - 1];
    if (lastDate) {
      const ts = new Date(lastDate).getTime();
      if (!isNaN(ts) && Date.now() - ts > STALE_MS) return null;
    }
    return data;
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════
//  Market universe builder
// ══════════════════════════════════════════════════════════════
function* range(s, e) { for (let i = s; i <= e; i++) yield i; }

function buildShUniverse(depth) {
  const arr = [];
  if (depth === 'fast') {
    for (const n of range(600000, 600499)) arr.push('sh' + n);
  } else if (depth === 'std') {
    for (const n of range(600000, 600999)) arr.push('sh' + n);
    for (const n of range(601000, 601499)) arr.push('sh' + n);
    for (const n of range(603000, 603499)) arr.push('sh' + n);
    for (const n of range(605000, 605199)) arr.push('sh' + n);
    for (const n of range(688000, 688199)) arr.push('sh' + n);
  } else {
    for (const n of range(600000, 600999)) arr.push('sh' + n);
    for (const n of range(601000, 601999)) arr.push('sh' + n);
    for (const n of range(603000, 603999)) arr.push('sh' + n);
    for (const n of range(605000, 605999)) arr.push('sh' + n);
    for (const n of range(688000, 688399)) arr.push('sh' + n);
  }
  return arr;
}

async function runBatch(universe, workerFn, onProgress, concurrency = 8) {
  let done = 0;
  for (let i = 0; i < universe.length; i += concurrency) {
    await Promise.all(universe.slice(i, i + concurrency).map(async code => {
      await workerFn(code);
      done++;
      if (done % 20 === 0) onProgress(done, universe.length);
    }));
  }
}

// ══════════════════════════════════════════════════════════════
//  Cross detection functions
// ══════════════════════════════════════════════════════════════

// KDJ golden cross — only valid if K is STILL above D today
function kdjGoldenCross(highs, lows, closes, dates, lookback, requireOversold, requireJUp) {
  if (!closes || closes.length < 2) return null;
  const { K, D, J } = calcKDJ(highs, lows, closes);
  const n = closes.length, last = n - 1;
  if ((K[last] ?? 0) <= (D[last] ?? 0)) return null;
  const start = Math.max(1, n - lookback);
  for (let i = last; i >= start; i--) {
    if (K[i-1] == null || D[i-1] == null || K[i] == null || D[i] == null) continue;
    if (!(K[i-1] <= D[i-1] && K[i] > D[i])) continue;
    if (requireOversold && !(K[i-1] < 20 || D[i-1] < 20)) continue;
    if (requireJUp && J[i] != null && J[i-1] != null && !(J[i] > J[i-1])) continue;
    return {
      crossDate: dates?.[i] ?? '-',
      Kx: K[i], Dx: D[i], Jx: J?.[i] ?? null,
      K: K[last], D: D[last], J: J?.[last] ?? null,
      kdDiff: K[last] - D[last],
    };
  }
  return null;
}

// MACD golden cross — only valid if DIF is STILL above DEA today
function macdGoldenCross(closes, dates, lookback, requireZeroAxis) {
  const macd = calcMACD(closes);
  const n = closes.length, last = n - 1;
  if ((macd.dif[last] ?? 0) <= (macd.dea[last] ?? 0)) return null;
  const start = Math.max(1, n - lookback);
  for (let i = last; i >= start; i--) {
    const dif0 = macd.dif[i-1], dea0 = macd.dea[i-1];
    const dif1 = macd.dif[i],   dea1 = macd.dea[i];
    if (dif0 == null || dea0 == null || dif1 == null || dea1 == null) continue;
    if (!(dif0 <= dea0 && dif1 > dea1)) continue;
    if (requireZeroAxis && !(dif1 > 0 && dea1 > 0)) continue;
    return {
      crossDate: dates?.[i] ?? '-',
      dif:  macd.dif[last],
      dea:  macd.dea[last],
      hist: macd.hist?.[last] ?? null,
    };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  Mobile DOM & Modal system
// ══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

function openModal(id) {
  $(id).classList.add('open');
  $('overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  $(id).classList.remove('open');
  if (!document.querySelector('.modal.open')) {
    $('overlay').classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Overlay tap → close all modals
$('overlay').addEventListener('click', () => {
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  $('overlay').classList.remove('active');
  document.body.style.overflow = '';
});

// Data-close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// ══════════════════════════════════════════════════════════════
//  History
// ══════════════════════════════════════════════════════════════
const HISTORY_KEY = 'stock_history';
const HISTORY_MAX = 30;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(items) { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); }

function pushHistory(entry) {
  let items = loadHistory().filter(h => h.code !== entry.code);
  items.unshift(entry);
  saveHistory(items.slice(0, HISTORY_MAX));
  renderHistory();
}

function formatRelTime(ts) {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1)  return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderHistory() {
  const items = loadHistory();
  const el = $('historyList');
  if (!items.length) {
    el.innerHTML = '<div class="empty-hint">暂无历史记录</div>';
    return;
  }
  el.innerHTML = items.map(h => {
    const cls = (h.chgPct ?? 0) >= 0 ? 'pos' : 'neg';
    const chg = h.chgPct != null ? ((h.chgPct >= 0 ? '+' : '') + h.chgPct.toFixed(2) + '%') : '—';
    return `<div class="history-item" data-code="${h.code}">
      <div>
        <div class="hi-name">${h.name}</div>
        <div class="hi-code">${h.code}</div>
      </div>
      <div style="text-align:right">
        <div class="hi-chg ${cls}">${chg}</div>
        <div class="hi-time">${formatRelTime(h.ts)}</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      $('code').value = item.dataset.code;
      closeModal('modalHistory');
      loadOne();
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  Load single stock
// ══════════════════════════════════════════════════════════════
let shIndexData = null;

async function loadOne() {
  const codeInput = $('code');
  const basicCard = $('basicCard');
  try {
    const pref = normalizeCode(codeInput.value);
    basicCard.innerHTML = '<div class="muted" style="font-size:13px;">加载中…</div>';
    $('analysis').textContent  = '分析中…';
    $('advanced').textContent  = '—';

    const [basicTxt, js] = await Promise.all([
      fetchTextGBK(urlQt(pref)),
      fetchJson(urlDayK(pref)),
    ]);

    const basic = parseQtBasic(basicTxt);
    const node  = js?.data?.[pref] || {};
    const arr   = node['qfqday'] || node['day'] || [];
    const data  = buildFromKArray(arr);

    const chgCls = (basic.chgPct ?? 0) >= 0 ? 'pos' : 'neg';
    const chgStr = basic.chgPct != null
      ? (basic.chgPct >= 0 ? '+' : '') + basic.chgPct.toFixed(2) + '%'
      : '—';

    basicCard.innerHTML = `
      <div class="basic-row">
        <div>
          <div class="stock-name">${basic.name ?? '—'}</div>
          <div class="stock-code">${basic.code ?? pref}</div>
        </div>
        <div>
          <div class="stock-price">${basic.price ?? '—'}</div>
          <div class="stock-chg ${chgCls}">${chgStr}</div>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-kv"><span class="lbl">今开</span>${basic.open ?? '—'}</div>
        <div class="info-kv"><span class="lbl">昨收</span>${basic.yclose ?? '—'}</div>
      </div>`;

    const res = analyzePlus(data);
    $('analysis').textContent = res.text;

    // Load sh index for RS calc (background, non-blocking)
    if (!shIndexData) {
      fetchJson(urlDayK('sh000001')).then(j2 => {
        const n2 = j2?.data?.['sh000001'] || {};
        shIndexData = buildFromKArray(n2['day'] || n2['qfqday'] || []);
        $('advanced').textContent = computeAdvanced(data, shIndexData);
      }).catch(() => {
        $('advanced').textContent = computeAdvanced(data, null);
      });
    } else {
      $('advanced').textContent = computeAdvanced(data, shIndexData);
    }

    if (basic?.name && basic.name !== '-') {
      pushHistory({ code: pref, name: basic.name, price: basic.price, chgPct: basic.chgPct, ts: Date.now() });
    }
  } catch (e) {
    basicCard.innerHTML = `<div class="neg" style="font-size:13px;">加载失败：${e.message || e}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════
//  Helper: wire up "查看" buttons inside a result container
// ══════════════════════════════════════════════════════════════
function attachViewBtns(container, closeModalId) {
  container.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      $('code').value = btn.dataset.view;
      closeModal(closeModalId);
      loadOne();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  Scan: multi-indicator confluence
// ══════════════════════════════════════════════════════════════
let scanRunning = false;

async function scanSH() {
  if (scanRunning) return;
  scanRunning = true;
  $('reScanBtn').disabled = true;
  $('scanStatus').textContent = '扫描中…';
  $('scanResult').innerHTML = '<div class="empty-hint">扫描进行中，请稍候…</div>';

  const universe = buildShUniverse($('scanDepth').value);
  const results  = [];
  let scanned = 0, passed = 0;

  await runBatch(universe, async code => {
    const b = await getBasic(code);
    if (!b) return;
    const data = await getDayK(code);
    if (!data) return;
    scanned++;
    const res = analyzePlus(data);
    if (res.score < 5)            return;
    if (!res.pct1 || res.pct1 <= 0) return;
    if (res.rsiLast >= 75)        return;
    if (res.kLast   >= 80)        return;
    if (res.bias20  >= 15)        return;
    passed++;
    results.push({ code, name: b.name, score: res.score, pct1: res.pct1, rsi: res.rsiLast, kVal: res.kLast, bias20: res.bias20 });
  }, (done, total) => {
    $('scanStatus').textContent = `${done}/${total} · ${passed}只`;
  });

  results.sort((a, b) => b.score !== a.score ? b.score - a.score : b.pct1 - a.pct1);

  if (!results.length) {
    $('scanResult').innerHTML = `<div class="muted" style="padding:16px 4px;">
      扫描 ${scanned} 只有效标的，无同时满足全部条件的股票。<br>
      <span style="font-size:12px;">条件：评分≥5/8 · 15日上升趋势(R²≥0.4) · RSI&lt;75 · KDJ-K&lt;80 · 偏离MA20&lt;15%</span>
    </div>`;
  } else {
    $('scanResult').innerHTML = `
      <div class="muted" style="font-size:12px;margin-bottom:8px;">
        扫描 ${scanned} 只 → 通过全部条件 <strong style="color:var(--pos)">${results.length} 只</strong>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>#</th><th>代码</th><th>名称</th>
          <th title="8项综合评分">评分</th>
          <th title="RSI14">RSI</th>
          <th title="KDJ-K">K值</th>
          <th title="15日趋势质量">趋势</th>
          <th></th>
        </tr></thead>
        <tbody>${results.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td class="code">${r.code}</td>
          <td>${r.name}</td>
          <td class="pos">${r.score}/8</td>
          <td>${r.rsi.toFixed(1)}</td>
          <td>${r.kVal.toFixed(1)}</td>
          <td class="${r.pct1 >= 0 ? 'pos' : 'neg'}">${r.pct1.toFixed(2)}%</td>
          <td><button class="mini-btn" data-view="${r.code}">查看</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    attachViewBtns($('scanResult'), 'modalScan');
  }

  $('scanStatus').textContent = `完成 · ${results.length} 只`;
  $('reScanBtn').disabled = false;
  scanRunning = false;
}

// ══════════════════════════════════════════════════════════════
//  Scan: KDJ golden cross
// ══════════════════════════════════════════════════════════════
let kdjRunning = false;

async function scanKDJ() {
  if (kdjRunning) return;
  kdjRunning = true;
  $('reKdjBtn').disabled = true;
  $('kdjStatus').textContent = '筛选中…';
  $('kdjResult').innerHTML = '<div class="empty-hint">筛选中，请稍候…</div>';

  const lookback        = parseInt($('kdjLookback').value) || 1;
  const requireOversold = $('kdjOversold').checked;
  const requireJUp      = $('kdjJUp').checked;
  const universe        = buildShUniverse($('kdjDepth').value);
  const results         = [];

  await runBatch(universe, async code => {
    const b = await getBasic(code);
    if (!b) return;
    const data = await getDayK(code);
    if (!data) return;
    const cross = kdjGoldenCross(data.highs, data.lows, data.closes, data.category, lookback, requireOversold, requireJUp);
    if (!cross) return;
    const extra = analyzePlus(data);
    if (extra.score < 3) return;
    results.push({
      code, name: b.name,
      crossDate: cross.crossDate,
      K: cross.K, D: cross.D, J: cross.J,
      kdDiff: cross.kdDiff,
      rsi:   extra.rsiLast,
      score: extra.score,
      pct1:  extra.pct1,
    });
  }, (done, total) => {
    $('kdjStatus').textContent = `${done}/${total}`;
  });

  results.sort((a, b) => {
    if (a.crossDate !== b.crossDate) return (b.crossDate || '').localeCompare(a.crossDate || '');
    return (b.kdDiff ?? 0) - (a.kdDiff ?? 0);
  });

  if (!results.length) {
    $('kdjResult').innerHTML = '<div class="muted" style="padding:16px 4px;">未命中，可尝试放宽筛选条件（增大回溯窗口、取消超卖区限制）。</div>';
  } else {
    $('kdjResult').innerHTML = `
      <div class="muted" style="font-size:12px;margin-bottom:8px;">
        命中 <strong>${results.length}</strong> 条（K 当前仍 > D，金叉信号有效）<br>
        <span style="font-size:11px;">K / D / J 为当前值</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>#</th><th>代码</th><th>名称</th><th>金叉日</th>
          <th>K</th><th>D</th><th>K-D差</th>
          <th>RSI</th><th>评分</th><th>趋势</th><th></th>
        </tr></thead>
        <tbody>${results.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td class="code">${r.code}</td>
          <td>${r.name}</td>
          <td>${r.crossDate}</td>
          <td class="pos">${r.K?.toFixed(1) ?? '-'}</td>
          <td>${r.D?.toFixed(1) ?? '-'}</td>
          <td class="pos">${r.kdDiff?.toFixed(1) ?? '-'}</td>
          <td>${r.rsi?.toFixed(1) ?? '-'}</td>
          <td>${r.score}/8</td>
          <td class="${(r.pct1 ?? 0) >= 0 ? 'pos' : 'neg'}">${r.pct1 != null ? r.pct1.toFixed(2) + '%' : '—'}</td>
          <td><button class="mini-btn" data-view="${r.code}">查看</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    attachViewBtns($('kdjResult'), 'modalKdj');
  }

  $('kdjStatus').textContent = `完成 · ${results.length} 条`;
  $('reKdjBtn').disabled = false;
  kdjRunning = false;
}

// ══════════════════════════════════════════════════════════════
//  Scan: KDJ + MACD confluence
// ══════════════════════════════════════════════════════════════
let cfRunning = false;

async function scanConfluence() {
  if (cfRunning) return;
  cfRunning = true;
  $('reCfBtn').disabled = true;
  $('cfStatus').textContent = '筛选中…';
  $('cfResult').innerHTML = '<div class="empty-hint">筛选中，请稍候…</div>';

  const look     = parseInt($('cfLookback').value) || 1;
  const needLow  = $('cfOversold').checked;
  const needZero = $('cfZeroAxis').checked;
  const needJUp  = $('cfJUp').checked;
  const universe = buildShUniverse($('cfDepth').value);
  const out      = [];

  await runBatch(universe, async code => {
    const b = await getBasic(code);
    if (!b) return;
    const data = await getDayK(code);
    if (!data || data.closes.length < 35) return;
    const kdj     = kdjGoldenCross(data.highs, data.lows, data.closes, data.category, look, needLow, needJUp);
    if (!kdj) return;
    const macdRes = macdGoldenCross(data.closes, data.category, look, needZero);
    if (!macdRes) return;
    const extra = analyzePlus(data);
    if (extra.score < 4) return;
    out.push({
      code, name: b.name,
      kdjCrossDate:  kdj.crossDate,
      macdCrossDate: macdRes.crossDate,
      K: kdj.K, D: kdj.D, J: kdj.J,
      kdDiff: kdj.kdDiff,
      dif:  macdRes.dif,
      dea:  macdRes.dea,
      hist: macdRes.hist,
      rsi:   extra.rsiLast,
      score: extra.score,
      pct1:  extra.pct1,
    });
  }, (done, total) => {
    $('cfStatus').textContent = `${done}/${total}`;
  });

  out.sort((a, b) => {
    if (b.score !== a.score)               return b.score - a.score;
    if ((b.hist ?? -99) !== (a.hist ?? -99)) return (b.hist ?? -99) - (a.hist ?? -99);
    return (b.kdDiff ?? 0) - (a.kdDiff ?? 0);
  });

  if (!out.length) {
    $('cfResult').innerHTML = '<div class="muted" style="padding:16px 4px;">未命中，可尝试放宽条件（增大回溯窗口、取消零轴限制）。</div>';
  } else {
    $('cfResult').innerHTML = `
      <div class="muted" style="font-size:12px;margin-bottom:8px;">
        命中 <strong>${out.length}</strong> 条（KDJ & MACD 双金叉当前均有效）<br>
        <span style="font-size:11px;">K叉日 = KDJ金叉日 · M叉日 = MACD金叉日 · 所有数值为当前值</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>#</th><th>代码</th><th>名称</th>
          <th>K叉日</th><th>M叉日</th>
          <th>K</th><th>D</th>
          <th>DIF</th><th>DEA</th>
          <th>RSI</th><th>评分</th><th>趋势</th><th></th>
        </tr></thead>
        <tbody>${out.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td class="code">${r.code}</td>
          <td>${r.name}</td>
          <td>${r.kdjCrossDate}</td>
          <td>${r.macdCrossDate}</td>
          <td class="pos">${r.K?.toFixed(1) ?? '-'}</td>
          <td>${r.D?.toFixed(1) ?? '-'}</td>
          <td class="${(r.dif ?? 0) >= 0 ? 'pos' : 'neg'}">${r.dif?.toFixed(3) ?? '-'}</td>
          <td class="${(r.dea ?? 0) >= 0 ? 'pos' : 'neg'}">${r.dea?.toFixed(3) ?? '-'}</td>
          <td>${r.rsi?.toFixed(1) ?? '-'}</td>
          <td>${r.score}/8</td>
          <td class="${(r.pct1 ?? 0) >= 0 ? 'pos' : 'neg'}">${r.pct1 != null ? r.pct1.toFixed(2) + '%' : '—'}</td>
          <td><button class="mini-btn" data-view="${r.code}">查看</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    attachViewBtns($('cfResult'), 'modalCf');
  }

  $('cfStatus').textContent = `完成 · ${out.length} 条`;
  $('reCfBtn').disabled = false;
  cfRunning = false;
}

// ══════════════════════════════════════════════════════════════
//  Collapsible sections
// ══════════════════════════════════════════════════════════════
[['analysisToggle', 'analysisBody', 'analysisArrow'],
 ['advancedToggle',  'advancedBody',  'advancedArrow']].forEach(([toggleId, bodyId, arrowId]) => {
  $(toggleId).addEventListener('click', () => {
    const body    = $(bodyId);
    const arrow   = $(arrowId);
    const isNowCollapsed = body.classList.toggle('collapsed');
    arrow.classList.toggle('open', !isNowCollapsed);
  });
});

// ══════════════════════════════════════════════════════════════
//  Event listeners
// ══════════════════════════════════════════════════════════════
$('loadBtn').addEventListener('click', loadOne);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); loadOne(); } });

$('historyBtn').addEventListener('click', () => openModal('modalHistory'));
$('clearHistoryBtn').addEventListener('click', () => { saveHistory([]); renderHistory(); });

// Bottom nav — open modal only, results from last scan are preserved
$('scanBtn').addEventListener('click', () => openModal('modalScan'));
$('kdjBtn').addEventListener('click',  () => openModal('modalKdj'));
$('confluenceBtn').addEventListener('click', () => openModal('modalCf'));

// Re-scan buttons inside modals
$('reScanBtn').addEventListener('click', scanSH);
$('reKdjBtn').addEventListener('click', scanKDJ);
$('reCfBtn').addEventListener('click', scanConfluence);

// ══════════════════════════════════════════════════════════════
//  Init
// ══════════════════════════════════════════════════════════════
renderHistory();
loadOne();
