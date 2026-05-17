/**
 * ProGemel — Data Loader v4
 * קובץ דאטה יחיד: history.json
 * השורה האחרונה של כל קרן = נתונים עדכניים לטבלה הראשית
 */

export const PRODUCT_LABELS = {
  'השתלמות':      { label: 'קרנות השתלמות',  icon: '🎓' },
  'פוליסות':      { label: 'פוליסות חיסכון',  icon: '📋' },
  'פנסיה':        { label: 'קרנות פנסיה',     icon: '🔐' },
  'גמל':          { label: 'קופות גמל',        icon: '💰' },
  'גמל_להשקעה':   { label: 'גמל להשקעה',      icon: '📈' },
};

const EXCLUDED_FUNDS = new Set(["מנורה-קרן י' חדשה"]);

// ── Sheet assignment (mirrors ETL logic) ─────────────────────────────────────
function assignSheet(name, source) {
  const n = name.toLowerCase();

  if (source === 'pension') {
    const prefix = (name.includes('מקיפה') || name.includes('מקפת')) ? 'מקיפה' : 'כללית';
    if (['עד 50','עד50','לבני 50 ומטה','50 ומטה'].some(k=>name.includes(k))) return prefix+'-עד50';
    if (['50 עד 60','50-60','לבני 50 עד 60'].some(k=>name.includes(k))) return prefix+'-50-60';
    if (['60 ומעלה','60+','מעל 60','לבני 60'].some(k=>name.includes(k))) return prefix+'-60+';
    if (n.includes('s&p') || (name.includes('500') && !name.includes('עד'))) return prefix+'-S&P500';
    if (['הלכ','שריעה'].some(k=>name.includes(k))) return prefix+'-הלכתי';
    if (name.includes('עוקב מדדי מניות')) return prefix+'-עוקב-מניות';
    if (name.includes('עוקב מדדים גמיש')) return prefix+'-עוקב-גמיש';
    if (['עוקב מדדי אג','עוקב אגח'].some(k=>name.includes(k))) return prefix+'-עוקב-אגח';
    if (name.includes('מניות סחיר')) return prefix+'-מניות-סחיר';
    if (name.includes('מניות')) return prefix+'-מניות';
    if (['אגח סחיר','משולב סחיר'].some(k=>name.includes(k))) return prefix+'-אגח-סחיר';
    if (['אשראי','אגח'].some(k=>name.includes(k))) return prefix+'-אשראי-אגח';
    if (['כספי','שקל'].some(k=>name.includes(k))) return prefix+'-כספי-שקלי';
    if (name.includes('פנסיונרים')) return prefix+'-פנסיונרים';
    if (name.includes('מקבלי קצבה')) return prefix+'-מקבלי-קצבה';
    if (name.includes('זכאים')) return prefix+'-זכאים-קיימים';
    if (['קיימות','ירוק'].some(k=>name.includes(k))) return prefix+'-קיימות';
    if (name.includes('משולב')) return prefix+'-משולב-סחיר';
    return prefix+'-כללי';
  }

  if (n.includes('s&p') || (name.includes('500') && !name.includes('עד'))) return 'S&P 500';
  if (name.includes('שריעה')) return 'שריעה';
  if (['הלכה','הלכתי','כשרות'].some(k=>name.includes(k)) ||
      (name.includes('הלכ') && !name.includes('הכשר'))) return source==='bituch' ? 'הלכה' : 'הלכתי';
  if (['כספי','שקל'].some(k=>name.includes(k))) return 'כספי שקלי';
  if (['עד 50','עד50','לבני 50 ומטה'].some(k=>name.includes(k))) return 'מובילות-עד50';
  if (['50 עד 60','50-60','לבני 50 עד 60'].some(k=>name.includes(k))) return 'מובילות-50-60';
  if (['60 ומעלה','60+','מעל 60','לבני 60'].some(k=>name.includes(k))) return 'מובילות-60+';
  if (name.includes('ממשלתי')) return 'אגח ממשלתי';
  if (name.includes('ממשלות')) return 'אגח ממשלות';
  if (name.includes('מניות סחיר')) return 'מניות סחיר';
  if (['מניות חול','מניות חו'].some(k=>name.includes(k))) return 'מניות חול';
  if (name.includes('מניות')) return 'מניות';
  if (name.includes('עוקב מדדי מניות')) return 'עוקב מדדי מניות';
  if (name.includes('עוקב מדדים גמיש')) return 'עוקב מדדים גמיש';
  if (['עוקב מדדי אג','עוקב אגח'].some(k=>name.includes(k))) return 'עוקב מדדי אגח';
  if (name.includes('משולב סחיר')) return 'משולב סחיר';
  if (name.includes('אגח סחיר')) return 'אגח סחיר';
  if (['אשראי','אגח'].some(k=>name.includes(k))) return 'אשראי ואגח';
  if (['קיימות','ירוק'].some(k=>name.includes(k))) return 'קיימות';
  if (['חול','חו'].some(k=>name.includes(k))) return 'חול';
  if (name.includes('ניהול אישי')) return 'ניהול אישי';
  if (name.includes('מובילות')) return 'מובילות-כללי';
  return 'כללי';
}

// ── Global state ──────────────────────────────────────────────────────────────
let historyData = null;
let currentData = null;
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
    const last = entries[entries.length - 1];
    if (!last.name || !last.product) continue;
    if (EXCLUDED_FUNDS.has(last.name)) continue;

    const source  = fund_id.split('_')[0];
    const product = last.product;
    const sheet   = assignSheet(last.name, source);

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
