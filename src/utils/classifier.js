/**
 * ProGemel — Fund Classifier v2
 * תיקון: "כללי" מדויק (לא "כללית"), כל הקטגוריות מהגדרה מקורית
 */

export const CATEGORIES = {
  // ── פנסיה — לפי גיל ──────────────────────────────────
  pension_mkifa_under50:  { id:'pension_mkifa_under50',  label:'מקיפה — עד 50',       desc:'פנסיה מקיפה, מסלול לבני 50 ומטה' },
  pension_mkifa_50_60:    { id:'pension_mkifa_50_60',    label:'מקיפה — 50–60',       desc:'פנסיה מקיפה, מסלול לבני 50 עד 60' },
  pension_mkifa_over60:   { id:'pension_mkifa_over60',   label:'מקיפה — 60+',         desc:'פנסיה מקיפה, מסלול לבני 60 ומעלה' },
  pension_klalit_under50: { id:'pension_klalit_under50', label:'כללית — עד 50',       desc:'פנסיה כללית, מסלול לבני 50 ומטה' },
  pension_klalit_50_60:   { id:'pension_klalit_50_60',   label:'כללית — 50–60',       desc:'פנסיה כללית, מסלול לבני 50 עד 60' },
  pension_klalit_over60:  { id:'pension_klalit_over60',  label:'כללית — 60+',         desc:'פנסיה כללית, מסלול לבני 60 ומעלה' },

  // ── גמל — לפי גיל ────────────────────────────────────
  gemel_under50:    { id:'gemel_under50',   label:'מובילות עד גיל 50',  desc:'מסלול ייעודי לחוסכים עד גיל 50' },
  gemel_50_60:      { id:'gemel_50_60',     label:'מובילות 50–60',      desc:'מסלול ייעודי לחוסכים בני 50 עד 60' },
  gemel_over60:     { id:'gemel_over60',    label:'מובילות מעל 60',     desc:'מסלול ייעודי לחוסכים מעל גיל 60' },

  // ── מסלולי השקעה — לפי חשיפות ─────────────────────────
  general:          { id:'general',         label:'מסלולים כלליים',           desc:'מסלול כללי — המילה "כללי" בדיוק (לא "כללית")' },
  equities:         { id:'equities',        label:'מסלולים מנייתיים',         desc:'מעל 90% חשיפה למניות' },
  bonds:            { id:'bonds',           label:'מסלולים אגחיים',           desc:'פחות מ-10% חשיפה למניות' },
  govBonds:         { id:'govBonds',        label:'מסלולי אגח ממשלות',        desc:'מסלולים שבשמם מופיעה המילה "ממשלות"' },
  moneyMarket:      { id:'moneyMarket',     label:'מסלולים כספיים שקליים',    desc:'מסלולים שבשמם מופיעה המילה "כספי"' },
  foreign:          { id:'foreign',         label:'מסלולי חול',               desc:'מעל 90% חשיפה לחו"ל' },
  israel:           { id:'israel',          label:'מסלולי ישראל',             desc:'פחות מ-10% חשיפה לחו"ל' },
  forex:            { id:'forex',           label:'מסלולי מטח',               desc:'לפחות 90% חשיפה למט"ח' },
  equitiesIsrael:   { id:'equitiesIsrael',  label:'מניות ישראל',              desc:'לפחות 90% מניות + מקסימום 10% חו"ל' },
  equitiesForeign:  { id:'equitiesForeign', label:'מניות חול',                desc:'לפחות 90% מניות + לפחות 90% חו"ל' },
  bondsIsrael:      { id:'bondsIsrael',     label:'אגח ישראל',                desc:'מקסימום 10% מניות + מקסימום 10% חו"ל' },
  bondsForeign:     { id:'bondsForeign',    label:'אגח חול',                  desc:'מקסימום 10% מניות + לפחות 90% חו"ל' },
  illiquid:         { id:'illiquid',        label:'מסלולים מוטי לא-סחיר',    desc:'לפחות 10% לא סחיר' },
  liquid:           { id:'liquid',          label:'מסלולים סחירים',           desc:'עד 3% לא סחיר' },
  sp500:            { id:'sp500',           label:'מסלולי S&P 500',           desc:'מסלול עוקב מדד S&P 500' },
};

// ── עזר: בדיקת מילה שלמה ─────────────────────────────────
// מחפש "כללי" כמילה שלמה — לא "כללית", לא "כלליים"
function hasExactWord(str, word) {
  // גבולות מילה: תחילת מחרוזת, סוף מחרוזת, רווח, מקף
  const re = new RegExp('(^|[\\s\\-—])' + word + '($|[\\s\\-—])');
  return re.test(str);
}

// ── סיווגי שם ────────────────────────────────────────────
function isGeneral(fund) {
  const n  = fund.name  || '';
  const sh = fund.sheet || '';
  // רק "כללי" מדויק — לא "כללית", לא "כלליים"
  return (
    hasExactWord(n, 'כללי') ||
    sh === 'כללי' ||
    sh === 'מובילות-כללי' ||
    sh.endsWith('-כללי')
  );
}

function isSP500(fund) {
  const n  = (fund.name  || '').toLowerCase();
  const sh = (fund.sheet || '').toLowerCase();
  return n.includes('s&p') || n.includes('s&amp;p') || sh.includes('s&p') ||
         sh.includes('500') || (n.includes('500') && !n.includes('עד'));
}

function isGovBonds(fund) {
  const n  = fund.name  || '';
  const sh = fund.sheet || '';
  return n.includes('ממשלות') || sh.includes('ממשלות') || sh.includes('אגח-ממשלות');
}

function isMoneyMarket(fund) {
  const n  = fund.name  || '';
  const sh = fund.sheet || '';
  return n.includes('כספי') || sh.includes('כספי');
}

// ── סיווג פנסיה לפי גיל ──────────────────────────────────
function getPensionAgeCategory(fund) {
  if (fund.source !== 'pension') return null;
  const sh = fund.sheet || '';
  const n  = fund.name  || '';
  const isMkifa  = sh.startsWith('מקיפה')  || n.includes('מקיפה') || n.includes('מקפת');
  const isKlalit = sh.startsWith('כללית')  || (!isMkifa && (n.includes('כללית') || n.includes('משלימה')));
  const prefix   = isMkifa ? 'pension_mkifa' : isKlalit ? 'pension_klalit' : null;
  if (!prefix) return null;

  if (sh.includes('עד50') || sh.includes('עד 50') || n.includes('לבני 50 ומטה') || n.includes('50 ומטה'))
    return prefix + '_under50';
  if (sh.includes('50-60') || sh.includes('50 עד 60') || n.includes('לבני 50 עד 60') || n.includes('50 עד 60'))
    return prefix + '_50_60';
  if (sh.includes('60+') || sh.includes('60 ומעלה') || n.includes('לבני 60') || n.includes('60 ומעלה'))
    return prefix + '_over60';
  return null;
}

// ── classifyFund ─────────────────────────────────────────
export function classifyFund(fund) {
  const cats = [];
  const sh   = fund.sheet || '';
  const s    = fund.stocks   ?? null;
  const f    = fund.foreign  ?? null;
  const fx   = fund.forex    ?? null;
  const il   = fund.illiquid ?? null;

  // פנסיה — קטגוריות גיל
  const pensionAge = getPensionAgeCategory(fund);
  if (pensionAge) cats.push(pensionAge);

  // גמל/השתלמות — קטגוריות גיל
  if (sh.includes('עד50') || sh.includes('עד 50') || sh.includes('מובילות-עד50'))      cats.push('gemel_under50');
  if (sh.includes('50-60') || sh.includes('50 עד 60') || sh.includes('מובילות-50-60')) cats.push('gemel_50_60');
  if (sh.includes('60+') || sh.includes('60 ומעלה') || sh.includes('מובילות-60+'))     cats.push('gemel_over60');

  // מסלולי שם
  if (isSP500(fund))       cats.push('sp500');
  if (isGeneral(fund))     cats.push('general');
  if (isGovBonds(fund))    cats.push('govBonds');
  if (isMoneyMarket(fund)) cats.push('moneyMarket');

  // מסלולי חשיפה
  if (s  !== null && s  >= 90) cats.push('equities');
  if (s  !== null && s  < 10)  cats.push('bonds');
  if (f  !== null && f  >= 90) cats.push('foreign');
  if (f  !== null && f  < 10)  cats.push('israel');
  if (fx !== null && fx >= 90) cats.push('forex');

  if (s !== null && f !== null) {
    if (s >= 90 && f < 10)  cats.push('equitiesIsrael');
    if (s >= 90 && f >= 90) cats.push('equitiesForeign');
    if (s < 10  && f < 10)  cats.push('bondsIsrael');
    if (s < 10  && f >= 90) cats.push('bondsForeign');
  }

  if (il !== null && il >= 10) cats.push('illiquid');
  if (il !== null && il <= 3)  cats.push('liquid');

  return cats;
}

export function getCategoriesForProduct() { return []; }

export function getFundsForCategory(funds, categoryId) {
  return funds.filter(f => classifyFund(f).includes(categoryId));
}
