/*
 * ProGemel — Fund Classifier v3
 * דף ראשי: סיווג לפי תנאים/חשיפות
 * "כללי" — בדיקה לפי שם הקרן בלבד (לא sheet), מילה שלמה בדיוק
 */

export const CATEGORIES = {
  equities:         { id:'equities',        label:'מסלולים מנייתיים',         desc:'מעל 90% חשיפה למניות' },
  bonds:            { id:'bonds',           label:'מסלולים אגחיים',           desc:'פחות מ-10% חשיפה למניות' },
  govBonds:         { id:'govBonds',        label:'מסלולי אגח ממשלות',        desc:'מסלולים שבשמם מופיעה המילה "ממשלות"' },
  moneyMarket:      { id:'moneyMarket',     label:'מסלולים כספיים שקליים',    desc:'מסלולים שבשמם מופיעה המילה "כספי"' },
  foreign:          { id:'foreign',         label:'מסלולי חול',               desc:'מעל 90% חשיפה לחו"ל' },
  israel:           { id:'israel',          label:'מסלולי ישראל',             desc:'פחות מ-10% חשיפה לחו"ל' },
  forex:            { id:'forex',           label:'מסלולי מטח',               desc:'לפחות 90% חשיפה למט"ח' },
  general:          { id:'general',         label:'מסלולים כלליים',           desc:'מסלול כללי — המילה "כללי" בשם (לא "כללית")' },
  equitiesIsrael:   { id:'equitiesIsrael',  label:'מניות ישראל',              desc:'לפחות 90% מניות + מקסימום 10% חו"ל' },
  equitiesForeign:  { id:'equitiesForeign', label:'מניות חול',                desc:'לפחות 90% מניות + לפחות 90% חו"ל' },
  bondsIsrael:      { id:'bondsIsrael',     label:'אגח ישראל',                desc:'מקסימום 10% מניות + מקסימום 10% חו"ל' },
  bondsForeign:     { id:'bondsForeign',    label:'אגח חול',                  desc:'מקסימום 10% מניות + לפחות 90% חו"ל' },
  illiquid:         { id:'illiquid',        label:'מסלולים מוטי לא-סחיר',    desc:'לפחות 10% לא סחיר' },
  liquid:           { id:'liquid',          label:'מסלולים סחירים',           desc:'עד 3% לא סחיר' },
  sp500:            { id:'sp500',           label:'מסלולי S&P 500',           desc:'מסלול עוקב מדד S&P 500' },
  gemel_under50:    { id:'gemel_under50',   label:'מובילות עד גיל 50',        desc:'מסלול ייעודי לחוסכים עד גיל 50' },
  gemel_50_60:      { id:'gemel_50_60',     label:'מובילות 50–60',            desc:'מסלול ייעודי לחוסכים בני 50 עד 60' },
  gemel_over60:     { id:'gemel_over60',    label:'מובילות מעל 60',           desc:'מסלול ייעודי לחוסכים מעל גיל 60' },
};

// ── "כללי" מדויק: שם הקרן בלבד, מילה שלמה ──────────────────────────────────
// ✅ "מסלול כללי"  →  true
// ✅ "כלל פנסיה כללי"  →  true
// ❌ "פנסיה כללית מניות"  →  false  (כללית ≠ כללי)
// ❌ "כללית-כללי" (sheet)  →  לא נבדק כאן
function isGeneral(fund) {
  const name = fund.name || '';
  return /(^|[\s\-—,()/])כללי($|[\s\-—,()/])/.test(name);
}

function isSP500(fund) {
  const n = (fund.name || '').toLowerCase();
  return n.includes('s&p') || n.includes('s&amp;p') ||
         (n.includes('500') && !n.includes('עד'));
}

function isGovBonds(fund) {
  return (fund.name || '').includes('ממשלות');
}

function isMoneyMarket(fund) {
  return (fund.name || '').includes('כספי');
}

// ── גיל — גמל / השתלמות / ביטוח (לא פנסיה) ─────────────────────────────────
function getAgeCategory(fund) {
  if (fund.source === 'pension') return null;
  const sh = fund.sheet || '';
  const n  = fund.name  || '';
  if (sh.includes('מובילות-עד50') || sh.includes('עד50') ||
      ['לבני 50 ומטה','עד 50','גילאי  50 ומטה','גילאי 50 ומטה'].some(k => n.includes(k)))
    return 'gemel_under50';
  if (sh.includes('מובילות-50-60') || sh.includes('50-60') ||
      ['לבני 50 עד 60','50 עד 60','גילאי 50 עד 60'].some(k => n.includes(k)))
    return 'gemel_50_60';
  if (sh.includes('מובילות-60+') || sh.includes('60+') ||
      ['60 ומעלה','לבני 60','גילאי 60 ומעלה'].some(k => n.includes(k)))
    return 'gemel_over60';
  return null;
}

// ── classifyFund ─────────────────────────────────────────────────────────────
export function classifyFund(fund) {
  const cats = [];
  const s  = fund.stocks   ?? null;
  const f  = fund.foreign  ?? null;
  const fx = fund.forex    ?? null;
  const il = fund.illiquid ?? null;

  // גיל (גמל/השתלמות/ביטוח בלבד — לא פנסיה)
  const age = getAgeCategory(fund);
  if (age) cats.push(age);

  // מסלולי שם
  if (isSP500(fund))       cats.push('sp500');
  if (isGeneral(fund))     cats.push('general');
  if (isGovBonds(fund))    cats.push('govBonds');
  if (isMoneyMarket(fund)) cats.push('moneyMarket');

  // חשיפות
  if (s  !== null && s  >= 90) cats.push('equities');
  if (s  !== null && s  <  10) cats.push('bonds');
  if (f  !== null && f  >= 90) cats.push('foreign');
  if (f  !== null && f  <  10) cats.push('israel');
  if (fx !== null && fx >= 90) cats.push('forex');

  if (s !== null && f !== null) {
    if (s >= 90 && f <  10) cats.push('equitiesIsrael');
    if (s >= 90 && f >= 90) cats.push('equitiesForeign');
    if (s <  10 && f <  10) cats.push('bondsIsrael');
    if (s <  10 && f >= 90) cats.push('bondsForeign');
  }

  if (il !== null && il >= 10) cats.push('illiquid');
  if (il !== null && il <=  3) cats.push('liquid');

  return cats;
}

export function getCategoriesForProduct() { return []; }

export function getFundsForCategory(funds, categoryId) {
  return funds.filter(f => classifyFund(f).includes(categoryId));
}
