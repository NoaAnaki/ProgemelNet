/**
 * ProGemel — Data Loader v4
 *
 * קובץ דאטה יחיד: history.json
 * - כל הנתונים ההיסטוריים לכל קרן
 * - השורה האחרונה = נתונים עדכניים לטבלה הראשית
 * - אין צורך ב-raw_data.json
 */

export const PRODUCT_LABELS = {
  'השתלמות':      { label: 'קרנות השתלמות',  icon: '🎓' },
  'פוליסות':      { label: 'פוליסות חיסכון',  icon: '📋' },
  'פנסיה':        { label: 'קרנות פנסיה',     icon: '🔐' },
  'גמל':          { label: 'קופות גמל',        icon: '💰' },
  'גמל_להשקעה':   { label: 'גמל להשקעה',      icon: '📈' },
};

const EXCLUDED_FUNDS = new Set(["מנורה-קרן י' חדשה"]);

// ── Global state ──────────────────────────────────────────────────────────────
let historyData = null;   // { fund_id: [...months] }
let currentData = null;   // { product: { sheet: [fund,...] } }
let loadPromise = null;

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadData() {
  if (historyData) return { historyData, currentData };
  if (loadPromise) return loadPromise;

  loadPromise = fetch('/history.json')
    .then(r => { if (!r.ok) throw new Error(`history.json: ${r.status}`); return r.json(); })
    .then(data => {
      historyData = data;
      currentData = buildCurrentData(data);
      return { historyData, currentData };
    });

  return loadPromise;
}

// ── Build current snapshot from last entry of each fund ───────────────────────
function buildCurrentData(history) {
  const result = {};

  for (const [fund_id, entries] of Object.entries(history)) {
    if (!entries || entries.length === 0) continue;

    // Last entry has metadata + exposures
    const last = entries[entries.length - 1];
    if (!last.name || !last.product) continue;
    if (EXCLUDED_FUNDS.has(last.name)) continue;

    const product = last.product;
    const sheet   = last.sheet || 'כללי';

    if (!result[product]) result[product] = {};
    if (!result[product][sheet]) result[product][sheet] = [];

    result[product][sheet].push({
      fund_id,
      name:      last.name,
      sheet,
      stocks:    last.stocks   ?? null,
      foreign:   last.foreign  ?? null,
      forex:     last.forex    ?? null,
      illiquid:  last.illiquid ?? null,
      sharpe:    last.sharpe   ?? null,
      fees:      last.fees     ?? null,
      ret_month: last.ret      ?? null,
      ret_ytd:   last.ret_ytd  ?? null,
      ret_1y:    last.ret_1y   ?? null,
      ret_3y:    last.ret_3y   ?? null,
      ret_5y:    last.ret_5y   ?? null,
      ret_10y:   last.ret_10y  ?? null,
    });
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────
export function getAllFunds(productKey) {
  if (!currentData) return [];
  return Object.values(currentData[productKey] ?? {}).flat();
}

export function getFundsBySheet(productKey, sheetName) {
  if (!currentData) return [];
  return currentData[productKey]?.[sheetName] ?? [];
}

export function getSheets(productKey) {
  if (!currentData) return [];
  return Object.keys(currentData[productKey] ?? {});
}

export function getHistory(fund_id) {
  if (!historyData) return [];
  return historyData[fund_id] ?? [];
}

export function calcAverages(funds) {
  const keys = ['ret_month','ret_ytd','ret_1y','ret_3y','ret_5y','ret_10y',
                 'stocks','foreign','forex','illiquid','fees','sharpe'];
  const result = { name: 'ממוצע', isAverage: true };
  keys.forEach(k => {
    const vals = funds.map(f => f[k]).filter(v => v != null);
    result[k] = vals.length
      ? Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*100)/100
      : null;
  });
  return result;
}

export { historyData, currentData };
