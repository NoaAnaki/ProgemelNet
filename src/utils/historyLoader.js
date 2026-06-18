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
 * Compute category average series — AVERAGE OF CUMULATIVE CURVES
 *
 * For each fund we build its own cumulative curve over the selected range
 * (normalised to 0% at the range start), then average the cumulative values
 * across funds at each period. Only funds that have data at the range start
 * are included, so every fund in the average shares the same baseline.
 *
 * This makes the chart's average consistent with the table: the average's
 * value at the final period equals the average of each fund's cumulative
 * return over the range — the same quantity the table column reports.
 */
export function computeAvgSeries(fundIds, histData, range) {
  const allSeries = fundIds.map(id => histData[id]).filter(Boolean);
  if (!allSeries.length) return [];

  // Determine the global latest period across the selected funds
  let latest = '';
  for (const s of allSeries) {
    if (s.length) {
      const p = s[s.length - 1].period;
      if (p > latest) latest = p;
    }
  }
  if (!latest) return [];
  const start = rangeStartPeriod(latest, range);

  // The earliest period that actually appears across the selected funds,
  // bounded by the requested range start. Funds that begin *after* this
  // are newer than the range and would distort the average (their short
  // cumulative curve isn't comparable to a full-range curve), so we exclude
  // them — mirroring the table, where a fund without a full-range return
  // (e.g. ret_3y = —) is not part of the average either.
  //
  // We define the range baseline as the earliest period >= start that the
  // longest-running funds share, then keep only funds present at that baseline.
  let baseline = null;
  for (const s of allSeries) {
    const slice = s.filter(p => p.period >= start);
    if (!slice.length) continue;
    const firstP = slice[0].period;
    if (baseline === null || firstP < baseline) baseline = firstP;
  }
  if (baseline === null) return [];

  // Allow a small grace window (one month) so funds that start one period
  // late due to reporting gaps aren't wrongly excluded.
  function periodPlus(p, months) {
    let y = +p.slice(0,4), m = +p.slice(4,6) + months;
    while (m > 12) { m -= 12; y++; }
    while (m <= 0) { m += 12; y--; }
    return `${y}${String(m).padStart(2,'0')}`;
  }
  const baselineGrace = periodPlus(baseline, 1);

  // Build each qualifying fund's cumulative curve, normalised to 0% at its
  // first in-range point. Only funds that begin at/around the baseline (i.e.
  // cover the full range) are included.
  const perFund = [];
  for (const s of allSeries) {
    const slice = s.filter(p => p.period >= start);
    if (slice.length < 2) continue;
    if (slice[0].period > baselineGrace) continue;   // newer than the range — skip
    let cum = 1.0;
    const curve = {};
    for (const p of slice) {
      if (p.ret != null) cum *= (1 + p.ret / 100);
      curve[p.period] = (cum - 1) * 100;
    }
    perFund.push(curve);
  }
  if (!perFund.length) return [];

  // Union of all periods, ascending
  const periodSet = new Set();
  for (const c of perFund) for (const p of Object.keys(c)) periodSet.add(p);
  const periods = [...periodSet].sort((a, b) => a < b ? -1 : 1);

  // Average the cumulative values across funds at each period.
  // Only funds that have a value at that period contribute.
  return periods.map(period => {
    let sum = 0, n = 0;
    for (const c of perFund) {
      if (c[period] != null) { sum += c[period]; n++; }
    }
    return {
      period,
      label:    fmtPeriod(period),
      cumRet:   n ? Math.round(sum / n * 100) / 100 : 0,
      retMonth: null,
    };
  });
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
