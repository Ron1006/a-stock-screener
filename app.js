'use strict';

// ── DOM refs ──
const els = {
  code:           document.getElementById('code'),
  loadBtn:        document.getElementById('loadBtn'),
  kline:          document.getElementById('kline'),
  subchart:       document.getElementById('subchart'),
  basic:          document.getElementById('basic'),
  analysis:       document.getElementById('analysis'),
  advanced:       document.getElementById('advanced'),
  scanBtn:        document.getElementById('scanBtn'),
  scanDepth:      document.getElementById('scanDepth'),
  scanStatus:     document.getElementById('scanStatus'),
  scanResult:     document.getElementById('scanResult'),
  historyList:    document.getElementById('historyList'),
  clearHistoryBtn:document.getElementById('clearHistoryBtn'),
  kdjBtn:         document.getElementById('kdjBtn'),
  kdjLookback:    document.getElementById('kdjLookback'),
  kdjOversold:    document.getElementById('kdjOversold'),
  kdjJUp:         document.getElementById('kdjJUp'),
  kdjStatus:      document.getElementById('kdjStatus'),
  kdjResult:      document.getElementById('kdjResult'),
  confluenceBtn:  document.getElementById('confluenceBtn'),
  cfLookback:     document.getElementById('cfLookback'),
  cfOversold:     document.getElementById('cfOversold'),
  cfZeroAxis:     document.getElementById('cfZeroAxis'),
  cfJUp:          document.getElementById('cfJUp'),
  cfStatus:       document.getElementById('cfStatus'),
  cfResult:       document.getElementById('cfResult'),
};

// ── URL helpers ──
const urlQt  = pref => `https://qt.gtimg.cn/q=${pref}`;
const urlDayK = (pref, lmt = 240) =>
  `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${pref},day,,,${lmt},qfq&_=${Date.now()}`;

// ── Fetch helpers ──
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

// ── Code normalisation ──
function normalizeCode(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (/^s[hz][0-9]{6}$/.test(raw)) return raw;
  if (/^[0-9]{6}$/.test(raw)) return (raw[0] === '6' || raw[0] === '9' ? 'sh' : 'sz') + raw;
  throw new Error('请输入 6 位代码或 sh/sz 前缀代码');
}

// ── Qt quote parser ──
function parseQtBasic(text) {
  const m = text.match(/"([^"]+)"/);
  if (!m) return null;
  const a = m[1].split('~');
  const price = a[3] ? +a[3] : null;
  const yclose = a[4] ? +a[4] : null;
  return {
    name: a[1] || '-', code: a[2] || '-', price, yclose,
    open: a[5] ? +a[5] : null,
    chgPct: (price != null && yclose) ? (price - yclose) / yclose * 100 : null,
  };
}

// ── Technical indicators ──
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
        p = s / n;
        ema[i] = +p.toFixed(4);
      }
    } else {
      p = closes[i] * k + p * (1 - k);
      ema[i] = +p.toFixed(4);
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
  let p = null;
  const k = 2 / 10;
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
  for (let i = n; i < tr.length; i++) atr[i] = +((atr[i - 1] * (n - 1) + tr[i]) / n).toFixed(4);
  return atr;
}

// ── Money Flow Index ──
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

// ── OBV trend (rising/falling over N bars) ──
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

// ── Nearest swing support / resistance (60-bar window, 3-bar pivot) ──
function nearestLevels(highs, lows, closes) {
  const C = closes[closes.length - 1];
  const start = Math.max(3, closes.length - 63); // look back ~60 bars, leave room for pivot check
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
      K[i] = prevK; D[i] = prevD; J[i] = 3 * prevK - 2 * prevD;
      continue;
    }
    const RSV = (closes[i] - ll) / (hh - ll) * 100;
    const k = (2 / 3) * prevK + (1 / 3) * RSV;
    const d = (2 / 3) * prevD + (1 / 3) * k;
    K[i] = k; D[i] = d; J[i] = 3 * k - 2 * d;
    prevK = k; prevD = d;
  }
  return { K, D, J };
}

// ── Linear regression with R² (goodness-of-fit) ──
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

  // ── Indicators ──
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

  // ── Expanded score (0–8) ──
  let score = 0;
  if (C > (ma20[last] ?? 0))                 score++; // above MA20
  if ((ma20[last] ?? 0) > (ma60[last] ?? 0)) score++; // MA20 > MA60
  if ((macd.hist[last] ?? 0) > 0)            score++; // MACD positive
  if ((rsi[last] ?? 50) > 50)                score++; // RSI bullish
  if ((kdj.K[last] ?? 50) > (kdj.D[last] ?? 50)) score++; // KDJ K > D
  if ((mfi[last] ?? 50) > 50)                score++; // MFI bullish
  if (obv.up)                                score++; // OBV rising
  if (vol20 && volumes[last] > vol20)         score++; // volume above avg

  const mood = score >= 6 ? 'bull' : score <= 2 ? 'bear' : 'neutral';

  // ── ATR & stop loss ──
  const atrNow  = atr[atr.length - 1] ?? 0;
  const stopRef = atrNow ? C - 2 * atrNow : null;
  const atrPct  = C > 0 ? atrNow / C * 100 : 0;

  // ── Short-term trend: 15-day log-linear regression + R² ──
  //   Model: ln(price) = a·t + b  →  a ≈ daily log-return (%)
  //   R² tells us how "trendlike" the last 15 days actually are.
  //   R² < 0.4 → sideways chop, slope is meaningless noise.
  const N_TREND = Math.min(15, closes.length);
  const segT  = closes.slice(-N_TREND);
  const xsT   = segT.map((_, i) => i + 1);
  const trend = linearRegressionFull(xsT, segT.map(v => Math.log(Math.max(v, 1e-6))));
  const slopeD = trend.a * 100; // daily % (log-return approximation)
  const r2     = trend.r2;

  // ── ATR scenario ranges (random-walk model: σ ∝ √t) ──
  //   NOT point predictions — these are ±1σ move bands based on recent volatility.
  //   Think of them as "if the stock behaves like its recent self, this is the likely range."
  const bull1 =  atrPct,                    bear1 = -atrPct;
  const bull3 =  atrPct * Math.sqrt(3),     bear3 = -atrPct * Math.sqrt(3);
  const bull7 =  atrPct * Math.sqrt(7),     bear7 = -atrPct * Math.sqrt(7);

  // ── Trend quality label ──
  let trendQuality;
  if (r2 < 0.4) {
    trendQuality = `震荡无方向（R²=${r2.toFixed(2)}，斜率不可信）`;
  } else {
    const dir = trend.a > 0 ? '↑上升' : '↓下降';
    const str = r2 > 0.75 ? '强' : r2 > 0.55 ? '中' : '弱';
    trendQuality = `${dir}趋势（强度：${str}  斜率：${slopeD >= 0 ? '+' : ''}${slopeD.toFixed(2)}%/日  R²=${r2.toFixed(2)}）`;
  }

  // ── Scan sort proxy ──
  //   pct1 = slope × R² × 3  (statistically-weighted 3-day trend projection)
  //   Zero when R²<0.4 → don't mislead the sorter with noisy slope
  //   pct3/pct7 = ATR upper bounds (used only for scan table display)
  const pct1 = r2 >= 0.4 ? slopeD * r2 * 3 : 0;
  const pct3 = bull3;
  const pct7 = bull7;

  // ── Volume note ──
  const volNote = (vol20 && volumes[last])
    ? volumes[last] > vol20 * 1.8 ? '放量' : volumes[last] < vol20 * 0.6 ? '缩量' : '量能中性'
    : '—';

  // ── BOLL width ──
  const bw = (boll.up[last] != null && boll.down[last] != null)
    ? (boll.up[last] - boll.down[last]) / (boll.down[last] || 1)
    : null;

  const text = [
    `总体：${mood === 'bull' ? '偏多' : mood === 'bear' ? '偏空' : '震荡'}（${score}/8）`,
    `价位：C=${C.toFixed(2)}  MA20=${ma20[last]?.toFixed(2) ?? '-'}  MA60=${ma60[last]?.toFixed(2) ?? '-'}`,
    `KDJ：K=${kdj.K[last]?.toFixed(1) ?? '-'}  D=${kdj.D[last]?.toFixed(1) ?? '-'}  J=${kdj.J[last]?.toFixed(1) ?? '-'}`,
    `MACD：DIF=${macd.dif[last]?.toFixed(4) ?? '-'}  DEA=${macd.dea[last]?.toFixed(4) ?? '-'}  柱=${macd.hist[last] != null ? (macd.hist[last] > 0 ? '正' : '负') : '—'}`,
    `RSI14：${rsi[last]?.toFixed(1) ?? '—'}  MFI14：${mfi[last]?.toFixed(1) ?? '—'}  OBV：${obv.up ? '上升' : '下降'}`,
    `量能：${volNote}（vs 20日均量）  BOLL带宽：${bw ? (bw * 100).toFixed(1) + '%' : '—'}  ATR14：${atrNow.toFixed(2)}`,
    `支撑：${lvl.support?.toFixed(2) ?? '无'}  压力：${lvl.resistance?.toFixed(2) ?? '无'}  止损参考：${stopRef?.toFixed(2) ?? '—'}（2×ATR）`,
    ``,
    `【近期走势 15日】${trendQuality}`,
    `【波动区间 ATR模型】±N×ATR×√t，非价格预测`,
    `  +1日：${bear1.toFixed(1)}% ～ +${bull1.toFixed(1)}%`,
    `  +3日：${bear3.toFixed(1)}% ～ +${bull3.toFixed(1)}%`,
    `  +7日：${bear7.toFixed(1)}% ～ +${bull7.toFixed(1)}%`,
  ].join('\n');

  // Extra fields exposed for scan filtering
  const rsiLast  = rsi[last]  ?? 50;
  const kLast    = kdj.K[last] ?? 50;
  const bias20   = ma20[last] ? (C - ma20[last]) / ma20[last] * 100 : 0;

  return { score, pct1, pct3, pct7, text, mood, rsiLast, kLast, bias20 };
}

// ── Advanced indicators ──
let shIndexData = null;

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

  // ── Current price position relative to pivot ──
  const aboveP  = C >= P;
  const pctToP  = (C - P)  / P  * 100;
  const pctToR1 = (R1 - C) / C  * 100;
  const pctToS1 = (C - S1) / C  * 100;
  const posNote = aboveP
    ? `P 上方 +${pctToP.toFixed(1)}%，距压力 R1 还有 ${pctToR1.toFixed(1)}%`
    : `P 下方 ${Math.abs(pctToP).toFixed(1)}%，距支撑 S1 还有 ${pctToS1.toFixed(1)}%`;

  // ── Confluence: check if any pivot level is near MA / BOLL bands ──
  // "Near" = within 0.8% of each other → double-layer key zone
  const NEAR = 0.008;
  const isNear = (a, b) => b != null && Math.abs(a - b) / Math.max(Math.abs(b), 1e-9) < NEAR;
  const refLevels = [
    { val: ma20[last],       label: 'MA20'    },
    { val: ma60[last],       label: 'MA60'    },
    { val: boll.up[last],    label: 'BOLL上轨' },
    { val: boll.mid[last],   label: 'BOLL中轨' },
    { val: boll.down[last],  label: 'BOLL下轨' },
  ];
  const confluences = [];
  [{ name: 'R2', val: R2 }, { name: 'R1', val: R1 },
   { name: 'P',  val: P  }, { name: 'S1', val: S1 }, { name: 'S2', val: S2 }]
  .forEach(({ name, val }) => {
    const hits = refLevels.filter(r => isNear(val, r.val)).map(r => r.label);
    if (hits.length) confluences.push(`${name}≈${hits.join('/')}`);
  });

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
  const lines = [
    `枢轴点：P=${P.toFixed(2)}  R1=${R1.toFixed(2)}  R2=${R2.toFixed(2)}  S1=${S1.toFixed(2)}  S2=${S2.toFixed(2)}`,
    `当前位置：${posNote}`,
  ];
  if (confluences.length)
    lines.push(`⚠ 双重关键位：${confluences.join('  ')}（枢轴与均线/BOLL重合，支撑/压力更强）`);
  lines.push(
    `距离：距MA20 ${fmt((C - ma20[last]) / ma20[last] * 100)}  距MA60 ${fmt((C - ma60[last]) / ma60[last] * 100)}`,
    `%B：${fmt(bPercent * 100)}  BIAS20：${fmt(bias20)}  52周百分位：${fmt(pct52)}`,
    `ATR14：${atr[atr.length - 1]?.toFixed(2) ?? '—'}  量能热度：${heat ? heat.toFixed(2) + 'x' : '—'}`,
    `缺口监测：${gapNote}`,
    `相对强弱（20日）：${rs20}`,
  );
  return lines.join('\n');
}

// ── Data builder ──
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

// ── Charts ──
let kChart = null, subChart = null;

function ensureCharts() {
  if (!kChart)    kChart    = echarts.init(els.kline);
  if (!subChart)  subChart  = echarts.init(els.subchart);
}

function drawK(data) {
  ensureCharts();
  const { category, values, closes } = data;
  const boll = calcBOLL(closes);
  const macd = calcMACD(closes);

  kChart.setOption({
    animation: false, backgroundColor: 'transparent',
    grid: { left: 50, right: 20, top: 20, bottom: 10 },
    xAxis: { type: 'category', data: category, boundaryGap: true, axisLine: { lineStyle: { color: '#334' } }, axisLabel: { color: '#9fb' } },
    yAxis: { scale: true, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1f2833' } }, axisLabel: { color: '#9fb' } },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#cbd5e1' } },
    series: [
      { name: 'K',        type: 'candlestick', data: values, itemStyle: { color: '#ec6a6a', color0: '#3fbf7f', borderColor: '#ec6a6a', borderColor0: '#3fbf7f' } },
      { name: 'MA5',      type: 'line', data: calcMA(closes, 5),  smooth: true, showSymbol: false },
      { name: 'MA10',     type: 'line', data: calcMA(closes, 10), smooth: true, showSymbol: false },
      { name: 'MA20',     type: 'line', data: calcMA(closes, 20), smooth: true, showSymbol: false },
      { name: 'MA60',     type: 'line', data: calcMA(closes, 60), smooth: true, showSymbol: false },
      { name: 'BOLL-MID', type: 'line', data: boll.mid,  smooth: true, showSymbol: false },
      { name: 'BOLL-UP',  type: 'line', data: boll.up,   smooth: true, showSymbol: false },
      { name: 'BOLL-LOW', type: 'line', data: boll.down, smooth: true, showSymbol: false },
    ],
  });

  subChart.setOption({
    animation: false, backgroundColor: 'transparent',
    grid: { left: 50, right: 20, top: 10, bottom: 28 },
    xAxis: { type: 'category', data: category, axisLine: { lineStyle: { color: '#334' } }, axisLabel: { color: '#9fb' } },
    yAxis: { scale: true, axisLine: { show: false }, splitLine: { lineStyle: { color: '#1f2833' } }, axisLabel: { color: '#9fb' } },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#cbd5e1' } },
    series: [
      { name: 'MACD-HIST', type: 'bar',  data: macd.hist, itemStyle: { color: p => p.value >= 0 ? '#ec6a6a' : '#3fbf7f' } },
      { name: 'DIF',       type: 'line', data: macd.dif,  smooth: true, showSymbol: false },
      { name: 'DEA',       type: 'line', data: macd.dea,  smooth: true, showSymbol: false },
    ],
  });
}

// ── History ──
const HISTORY_KEY = 'stock_history';
const HISTORY_MAX = 30;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

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
  if (!items.length) {
    els.historyList.innerHTML = '<span class="muted" style="padding:8px 4px;">暂无记录</span>';
    return;
  }
  els.historyList.innerHTML = items.map(h => {
    const cls = (h.chgPct ?? 0) >= 0 ? 'pos' : 'neg';
    const chg = h.chgPct != null ? ((h.chgPct >= 0 ? '+' : '') + h.chgPct.toFixed(2) + '%') : '—';
    return `<div class="history-item" data-code="${h.code}">
      <div class="hi-left">
        <span class="hi-name">${h.name}</span>
        <span class="hi-code">${h.code}</span>
      </div>
      <div class="hi-right">
        <span class="hi-time">${formatRelTime(h.ts)}</span>
        <span class="hi-chg ${cls}">${chg}</span>
      </div>
    </div>`;
  }).join('');

  els.historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      els.code.value = el.dataset.code;
      loadOne();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ── Load single stock ──
async function loadOne() {
  try {
    const pref     = normalizeCode(els.code.value);
    const basicTxt = await fetchTextGBK(urlQt(pref));
    const basic    = parseQtBasic(basicTxt);

    const js   = await fetchJson(urlDayK(pref));
    const node = js?.data?.[pref] || {};
    const arr  = node['qfqday'] || node['day'] || [];
    const data = buildFromKArray(arr);
    drawK(data);

    const chgCls = (basic.chgPct ?? 0) >= 0 ? 'pos' : 'neg';
    els.basic.innerHTML = `
      <div>名称/代码</div><div>${basic.name} <span class="muted">(${basic.code})</span></div>
      <div>最新/涨跌</div><div>${basic.price ?? '-'} <span class="${chgCls}">(${basic.chgPct != null ? basic.chgPct.toFixed(2) + '%' : '-'})</span></div>
      <div>今开/昨收</div><div>${basic.open ?? '-'} / ${basic.yclose ?? '-'}</div>`;

    const res = analyzePlus(data);
    els.analysis.textContent = res.text;

    if (!shIndexData) {
      try {
        const j    = await fetchJson(urlDayK('sh000001'));
        const n2   = j?.data?.['sh000001'] || {};
        const arr2 = n2['day'] || n2['qfqday'] || n2['hfqday'] || [];
        shIndexData = buildFromKArray(arr2);
      } catch { shIndexData = null; }
    }
    els.advanced.textContent = computeAdvanced(data, shIndexData);

    if (basic?.name) {
      pushHistory({ code: pref, name: basic.name, price: basic.price, chgPct: basic.chgPct, ts: Date.now() });
    }
  } catch (e) {
    console.error(e);
    els.analysis.textContent = '加载失败：' + (e.message || e);
  }
}

// ── Market universe ──
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

function isExcludedName(name) { return /(^|\*)ST|＊ST|退/.test(name); }

// 10 calendar-day recency threshold — catches long suspensions and delisted stocks
const STALE_MS = 10 * 86400000;

async function getBasic(pref) {
  try {
    const raw = await fetchTextGBK(urlQt(pref));
    const b   = parseQtBasic(raw);
    // No data or placeholder name means the code doesn't exist / is delisted
    if (!b?.name || b.name === '-' || b.name.trim() === '') return null;
    if (isExcludedName(b.name)) return null;
    // Price of 0 or missing = suspended / effectively dead
    if (!b.price || b.price <= 0) return null;
    // Already hit upper limit today — skip to reduce noise
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
    // Reject stale data: last trading date must be within STALE_MS
    const lastDate = data.category[data.category.length - 1];
    if (lastDate) {
      const ts = new Date(lastDate).getTime();
      if (!isNaN(ts) && Date.now() - ts > STALE_MS) return null;
    }
    return data;
  } catch { return null; }
}

// ── Parallel batch runner ──
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

// ── Attach "查看" buttons in a scan result container ──
function attachViewBtns(container) {
  container.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      els.code.value = btn.dataset.view;
      loadOne();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ── Scan: multi-indicator confluence Top20 ──
// Criteria (ALL must pass):
//   1. score ≥ 5/8   — majority of indicators bullish
//   2. pct1 > 0      — statistically-backed 15-day uptrend (R² ≥ 0.4)
//   3. RSI < 75      — not overbought
//   4. KDJ-K < 80    — not in hot zone
//   5. BIAS20 < 15%  — not excessively extended above MA20 (avoid chasing)
// Sort: score DESC → pct1 (trend quality) DESC
let scanRunning = false;

async function scanSH() {
  if (scanRunning) return;
  scanRunning = true;
  els.scanBtn.disabled = true;
  els.scanStatus.textContent = '准备扫描…';
  els.scanResult.textContent = '—';

  const universe = buildShUniverse(els.scanDepth.value);
  const results  = [];
  let   scanned  = 0, passed = 0;

  await runBatch(universe, async code => {
    const b = await getBasic(code);
    if (!b) return;
    const data = await getDayK(code);
    if (!data) return;
    scanned++;

    const res = analyzePlus(data);

    // ── Gate 1: majority of indicators must be bullish ──
    if (res.score < 5) return;

    // ── Gate 2: must have a statistically-confirmed uptrend ──
    if (!res.pct1 || res.pct1 <= 0) return;

    // ── Gate 3: not overbought (RSI and KDJ) ──
    if (res.rsiLast >= 75) return;
    if (res.kLast   >= 80) return;

    // ── Gate 4: not too extended above MA20 (avoid chasing breakouts) ──
    if (res.bias20 >= 15) return;

    passed++;
    results.push({
      code, name: b.name,
      score:  res.score,
      pct1:   res.pct1,
      pct3:   res.pct3,
      rsi:    res.rsiLast,
      kVal:   res.kLast,
      bias20: res.bias20,
      mood:   res.mood,
    });
  }, (done, total) => { els.scanStatus.textContent = `进度 ${done}/${total}  候选 ${passed}`; });

  // Primary sort: score DESC; secondary: trend quality DESC
  results.sort((a, b) => b.score !== a.score ? b.score - a.score : b.pct1 - a.pct1);

  if (!results.length) {
    els.scanResult.innerHTML = `<div class="muted" style="padding:8px;">
      本次扫描 ${scanned} 只有效标的，无股票同时满足全部条件。<br>
      条件：评分≥5/8、趋势向上、RSI&lt;75、KDJ-K&lt;80、偏离MA20&lt;15%
    </div>`;
  } else {
    const scoreBar = s => '█'.repeat(s) + '░'.repeat(8 - s);
    els.scanResult.innerHTML = `
      <div class="muted" style="margin-bottom:6px;font-size:12px;">
        扫描 ${scanned} 只 → 通过全部条件 <strong style="color:var(--pos)">${results.length} 只</strong>，全部显示（可上下滚动）<br>
        条件：评分≥5/8 · 15日上升趋势(R²≥0.4) · RSI&lt;75 · KDJ-K&lt;80 · 偏离MA20&lt;15%
      </div>
      <div class="scan-panel scan-scrollable">
        <table>
          <thead><tr>
            <th>#</th><th>代码</th><th>名称</th>
            <th title="8项指标综合评分，越高越强">评分</th>
            <th title="趋势斜率×R²×3，衡量趋势质量">趋势质量</th>
            <th title="RSI14，低于75为合理区间">RSI</th>
            <th title="KDJ-K值，低于80为合理区间">K值</th>
            <th title="当前价相对MA20的偏离度，正值代表在均线上方">偏MA20</th>
            <th></th>
          </tr></thead>
          <tbody>${results.map((r, i) => `<tr>
            <td>${i + 1}</td>
            <td class="code">${r.code}</td>
            <td>${r.name}</td>
            <td class="pos" title="${scoreBar(r.score)}">${r.score}/8</td>
            <td class="pos">${r.pct1.toFixed(2)}%</td>
            <td>${r.rsi.toFixed(1)}</td>
            <td>${r.kVal.toFixed(1)}</td>
            <td class="${r.bias20 >= 0 ? 'pos' : 'neg'}">${r.bias20 >= 0 ? '+' : ''}${r.bias20.toFixed(1)}%</td>
            <td><button data-view="${r.code}">查看</button></td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    attachViewBtns(els.scanResult);
  }

  els.scanStatus.textContent = `完成：${scanned} 只有效 → ${results.length} 只通过全部条件`;
  els.scanBtn.disabled = false;
  scanRunning = false;
}

// ── KDJ golden cross detection ──
// Returns the most recent cross in [n-lookback, n-1], BUT only if K is STILL above D
// at the latest bar — i.e. the cross hasn't been invalidated by a subsequent death cross.
function kdjGoldenCross(highs, lows, closes, dates, lookback, requireOversold, requireJUp) {
  if (!closes || closes.length < 2) return null;
  const { K, D, J } = calcKDJ(highs, lows, closes);
  const n = closes.length, last = n - 1;

  // Reject immediately if K is currently below D — any past golden cross is stale
  if ((K[last] ?? 0) <= (D[last] ?? 0)) return null;

  const start = Math.max(1, n - lookback);
  for (let i = last; i >= start; i--) {
    if (K[i - 1] == null || D[i - 1] == null || K[i] == null || D[i] == null) continue;
    // Upward cross: K was at or below D yesterday, above D today
    if (!(K[i - 1] <= D[i - 1] && K[i] > D[i])) continue;
    // Oversold origin: cross must emerge from below the 20 line
    if (requireOversold && !(K[i - 1] < 20 || D[i - 1] < 20)) continue;
    // J must be rising on the cross day
    if (requireJUp && J[i] != null && J[i - 1] != null && !(J[i] > J[i - 1])) continue;
    return {
      crossDate: dates?.[i] ?? '-',
      // Cross-day snapshot (for reference)
      Kx: K[i], Dx: D[i], Jx: J?.[i] ?? null,
      // Current values (what matters now)
      K: K[last], D: D[last], J: J?.[last] ?? null,
      kdDiff: K[last] - D[last],   // gap as of TODAY, not cross day
    };
  }
  return null;
}

// ── MACD golden cross detection ──
// Same logic: find the most recent cross AND verify DIF is still above DEA today.
function macdGoldenCross(closes, dates, lookback, requireZeroAxis) {
  const macd = calcMACD(closes);
  const n = closes.length, last = n - 1;

  // Reject if DIF is currently below DEA — signal already invalidated
  if ((macd.dif[last] ?? 0) <= (macd.dea[last] ?? 0)) return null;

  const start = Math.max(1, n - lookback);
  for (let i = last; i >= start; i--) {
    const dif0 = macd.dif[i - 1], dea0 = macd.dea[i - 1];
    const dif1 = macd.dif[i],     dea1 = macd.dea[i];
    if (dif0 == null || dea0 == null || dif1 == null || dea1 == null) continue;
    if (!(dif0 <= dea0 && dif1 > dea1)) continue;
    if (requireZeroAxis && !(dif1 > 0 && dea1 > 0)) continue;
    return {
      crossDate: dates?.[i] ?? '-',
      // Current MACD values (what matters now)
      dif:  macd.dif[last],
      dea:  macd.dea[last],
      hist: macd.hist?.[last] ?? null,
    };
  }
  return null;
}

// ── Scan: KDJ golden cross ──
let kdjRunning = false;

async function scanKDJ() {
  if (kdjRunning) return;
  kdjRunning = true;
  els.kdjBtn.disabled = true;
  els.kdjStatus.textContent = '准备扫描…';
  els.kdjResult.textContent = '—';

  const lookback        = parseInt(els.kdjLookback.value) || 1;
  const requireOversold = els.kdjOversold.checked;
  const requireJUp      = els.kdjJUp.checked;
  const universe        = buildShUniverse(els.scanDepth.value);
  const results         = [];

  await runBatch(universe, async code => {
    const b = await getBasic(code);
    if (!b) return;
    const data = await getDayK(code);
    if (!data) return;
    const cross = kdjGoldenCross(data.highs, data.lows, data.closes, data.category, lookback, requireOversold, requireJUp);
    if (!cross) return;
    const extra = analyzePlus(data);
    // Minimum quality: at least 3/8 bullish indicators — reject pure-noise signals
    if (extra.score < 3) return;
    results.push({
      code, name: b.name,
      crossDate: cross.crossDate,
      K: cross.K, D: cross.D, J: cross.J,   // current values (not cross-day)
      kdDiff: cross.kdDiff,                   // current K-D gap
      rsi:   extra.rsiLast,
      score: extra.score,
      pct1:  extra.pct1,
    });
  }, (done, total) => { els.kdjStatus.textContent = `进度 ${done}/${total}`; });

  // Sort: most recent cross first → then by current K-D spread (momentum strength)
  results.sort((a, b) => {
    if (a.crossDate !== b.crossDate) return (b.crossDate || '').localeCompare(a.crossDate || '');
    return (b.kdDiff ?? 0) - (a.kdDiff ?? 0);
  });

  if (!results.length) {
    els.kdjResult.innerHTML = '<div class="muted">（未命中：近期未出现符合条件的KDJ金叉，或数据接口受限）</div>';
  } else {
    els.kdjResult.innerHTML = `
      <div class="muted" style="margin-bottom:6px;">
        命中 <strong>${results.length}</strong> 条（K 当前仍 > D，金叉信号未失效），全部显示<br>
        <span style="font-size:11px;">K / D / J 为当前值；金叉日 = 金叉发生日期；趋势质量 = 15日斜率×R²×3（R²&lt;0.4时为"—"）</span>
      </div>
      <div class="scan-panel scan-scrollable"><table>
        <thead><tr>
          <th>#</th><th>代码</th><th>名称</th><th>金叉日</th>
          <th title="当前 K 值">K</th><th title="当前 D 值">D</th>
          <th title="当前 J 值" class="hide-sm">J</th>
          <th title="当前 K-D 间距，越大惯性越强">K-D差</th>
          <th title="RSI14 当前值">RSI</th>
          <th title="8项综合评分">评分</th>
          <th title="15日趋势质量（R²≥0.4才有值）">趋势质量</th>
          <th></th>
        </tr></thead>
        <tbody>${results.map((r, i) => `<tr>
          <td>${i + 1}</td><td class="code">${r.code}</td><td>${r.name}</td>
          <td>${r.crossDate}</td>
          <td class="pos">${r.K?.toFixed(1) ?? '-'}</td>
          <td>${r.D?.toFixed(1) ?? '-'}</td>
          <td class="hide-sm">${r.J?.toFixed(1) ?? '-'}</td>
          <td class="pos">${r.kdDiff?.toFixed(1) ?? '-'}</td>
          <td>${r.rsi?.toFixed(1) ?? '-'}</td>
          <td>${r.score != null ? r.score + '/8' : '-'}</td>
          <td class="${(r.pct1 ?? 0) >= 0 ? 'pos' : 'neg'}">${r.pct1 != null ? r.pct1.toFixed(2) + '%' : '—'}</td>
          <td><button data-view="${r.code}">查看</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    attachViewBtns(els.kdjResult);
  }

  els.kdjStatus.textContent = `完成，命中 ${results.length} 条`;
  els.kdjBtn.disabled = false;
  kdjRunning = false;
}

// ── Scan: KDJ + MACD confluence ──
let cfRunning = false;

async function scanConfluence() {
  if (cfRunning) return;
  cfRunning = true;
  els.confluenceBtn.disabled = true;
  els.cfStatus.textContent = '准备扫描…';
  els.cfResult.textContent = '—';

  const look     = parseInt(els.cfLookback.value) || 1;
  const needLow  = els.cfOversold.checked;
  const needZero = els.cfZeroAxis.checked;
  const needJUp  = els.cfJUp.checked;
  const universe = buildShUniverse(els.scanDepth.value);
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
    // Require at least 4/8 bullish indicators for a true confluence signal
    if (extra.score < 4) return;
    out.push({
      code, name: b.name,
      kdjCrossDate:  kdj.crossDate,
      macdCrossDate: macdRes.crossDate,
      // Current KDJ values (not cross-day snapshots)
      K: kdj.K, D: kdj.D, J: kdj.J,
      kdDiff: kdj.kdDiff,
      // Current MACD values
      dif:  macdRes.dif,
      dea:  macdRes.dea,
      hist: macdRes.hist,
      // Analysis
      rsi:   extra.rsiLast,
      score: extra.score,
      pct1:  extra.pct1,
    });
  }, (done, total) => { els.cfStatus.textContent = `进度 ${done}/${total}`; });

  // Sort: score DESC → MACD hist DESC (bigger green bar = stronger) → KDJ gap DESC → trend quality DESC
  out.sort((a, b) => {
    if (b.score !== a.score)           return b.score - a.score;
    if ((b.hist ?? -99) !== (a.hist ?? -99)) return (b.hist ?? -99) - (a.hist ?? -99);
    if ((b.kdDiff ?? 0) !== (a.kdDiff ?? 0)) return (b.kdDiff ?? 0) - (a.kdDiff ?? 0);
    return (b.pct1 ?? -99) - (a.pct1 ?? -99);
  });

  if (!out.length) {
    els.cfResult.innerHTML = '<div class="neg">（未命中：最近无满足共振买入条件的标的，或数据接口受限）</div>';
  } else {
    els.cfResult.innerHTML = `
      <div class="muted" style="margin-bottom:6px;">
        命中 <strong>${out.length}</strong> 条（KDJ & MACD 双金叉当前均有效），全部显示<br>
        <span style="font-size:11px;">K/D/J/DIF/DEA/HIST 均为当前值；K叉日 = KDJ金叉日，M叉日 = MACD金叉日</span>
      </div>
      <div class="scan-panel scan-scrollable"><table>
        <thead><tr>
          <th>#</th><th>代码</th><th>名称</th>
          <th title="KDJ 金叉发生日期">K叉日</th>
          <th title="MACD 金叉发生日期">M叉日</th>
          <th title="当前 K 值">K</th><th title="当前 D 值">D</th>
          <th title="当前 J 值" class="hide-sm">J</th>
          <th title="当前 DIF（快线）">DIF</th>
          <th title="当前 DEA（慢线）">DEA</th>
          <th title="当前 MACD 柱（DIF-DEA），正值越大越强" class="hide-sm">HIST</th>
          <th title="RSI14 当前值">RSI</th>
          <th title="8项综合评分">评分</th>
          <th title="15日趋势质量（R²≥0.4才有值）">趋势质量</th>
          <th></th>
        </tr></thead>
        <tbody>${out.map((r, i) => `<tr>
          <td>${i + 1}</td><td class="code">${r.code}</td><td>${r.name}</td>
          <td>${r.kdjCrossDate}</td><td>${r.macdCrossDate}</td>
          <td class="pos">${r.K?.toFixed(1) ?? '-'}</td>
          <td>${r.D?.toFixed(1) ?? '-'}</td>
          <td class="hide-sm">${r.J?.toFixed(1) ?? '-'}</td>
          <td class="${(r.dif ?? 0) >= 0 ? 'pos' : 'neg'}">${r.dif?.toFixed(3) ?? '-'}</td>
          <td class="${(r.dea ?? 0) >= 0 ? 'pos' : 'neg'}">${r.dea?.toFixed(3) ?? '-'}</td>
          <td class="hide-sm pos">${r.hist?.toFixed(3) ?? '-'}</td>
          <td>${r.rsi?.toFixed(1) ?? '-'}</td>
          <td>${r.score != null ? r.score + '/8' : '-'}</td>
          <td class="${(r.pct1 ?? 0) >= 0 ? 'pos' : 'neg'}">${r.pct1 != null ? r.pct1.toFixed(2) + '%' : '—'}</td>
          <td><button data-view="${r.code}">查看</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    attachViewBtns(els.cfResult);
  }

  els.cfStatus.textContent = `完成，命中 ${out.length} 条`;
  els.confluenceBtn.disabled = false;
  cfRunning = false;
}

// ── Event listeners ──
els.loadBtn.addEventListener('click', loadOne);
els.scanBtn.addEventListener('click', scanSH);
els.kdjBtn.addEventListener('click', scanKDJ);
els.confluenceBtn.addEventListener('click', scanConfluence);
els.clearHistoryBtn.addEventListener('click', () => { saveHistory([]); renderHistory(); });

// ── Init ──
renderHistory();
loadOne();
