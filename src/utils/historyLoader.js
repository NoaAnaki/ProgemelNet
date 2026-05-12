/**
 * ProGemel — History Loader
 * Fetches history.json from /public/ at runtime (5MB, not bundled)
 * Provides cumulative return computation for the historical chart
 */

let _cache = null;
let _promise = null;

export async function loadHistory() {
  if (_cache) return _cache;
  if (_promise) return _promise;
  _promise = fetch('/history.json')
    .then(r => r.json())
    .then(data => { _cache = data; return data; })
    .catch(() => { _cache = {}; return {}; });
  return _promise;
}

/** Format YYYYMM → "אוג׳ 23" */
export function fmtPeriod(p) {
  const MONTHS = ['','ינו','פבר','מרץ','אפר','מאי','יוני','יולי','אוג','ספט','אוק','נוב','דצמ'];
  return `${MONTHS[+p.slice(4,6)]}׳ ${p.slice(2,4)}`;
}

/** YYYYMM → Date object (first of month) */
function periodToDate(p) {
  return new Date(+p.slice(0,4), +p.slice(4,6) - 1, 1);
}

/**
 * Compute the start period for a given range
 * relative to the latest period in the series
 */
function rangeStartPeriod(latestPeriod, range) {
  const y = +latestPeriod.slice(0,4);
  const m = +latestPeriod.slice(4,6);
  if (range === 'ytd') return `${y}01`;
  const monthsBack = { '1y':12, '3y':36, '5y':60, '10y':120 }[range] ?? 12;
  let ny = y, nm = m - monthsBack;
  while (nm <= 0) { nm += 12; ny--; }
  return `${ny}${String(nm).padStart(2,'0')}`;
}

/**
 * Compute cumulative return series for one fund
 * @param {Array} points  [{period, ret}, ...] sorted ascending
 * @param {string} range  'ytd' | '1y' | '3y' | '5y' | '10y'
 * @returns {Array} [{period, label, cumRet, retMonth}, ...]
 */
export function computeSeries(points, range) {
  if (!points?.length) return [];
  const latest = points[points.length - 1].period;
  const start  = rangeStartPeriod(latest, range);
  const slice  = points.filter(p => p.period >= start);
  if (!slice.length) return [];

  let cum = 1.0;
  return slice.map(p => {
    if (p.ret != null) cum *= (1 + p.ret / 100);
    return {
      period:   p.period,
      label:    fmtPeriod(p.period),
      cumRet:   Math.round((cum - 1) * 10000) / 100,
      retMonth: p.ret,
    };
  });
}

/**
 * Compute category average series
 * Averages monthly returns across multiple funds, then computes cumulative
 */
export function computeAvgSeries(fundIds, histData, range) {
  const allPoints = fundIds.map(id => histData[id]).filter(Boolean);
  if (!allPoints.length) return [];

  // Find union of periods and average ret per period
  const map = {};
  for (const series of allPoints) {
    for (const { period, ret } of series) {
      if (ret == null) continue;
      if (!map[period]) map[period] = { sum: 0, n: 0 };
      map[period].sum += ret;
      map[period].n++;
    }
  }
  const merged = Object.entries(map)
    .sort(([a],[b]) => a < b ? -1 : 1)
    .map(([period, { sum, n }]) => ({ period, ret: Math.round(sum/n*100)/100 }));

  return computeSeries(merged, range);
}

/** Returns available range options for a points array */
export function availableRanges(points) {
  const n = points?.length ?? 0;
  return [
    { key:'ytd',  label:'מתחילת שנה', min:1   },
    { key:'1y',   label:'שנה',         min:12  },
    { key:'3y',   label:'3 שנים',      min:36  },
    { key:'5y',   label:'5 שנים',      min:60  },
    { key:'10y',  label:'10 שנים',     min:120 },
  ].filter(r => n >= r.min);
}
