/**
 * ProGemel — Fund Classifier
 * Classifies funds into categories based on exposure thresholds.
 * Identical logic to original app — pension uses same exposure-based classification.
 */

export const CATEGORIES = {
  equities:         { id:'equities',        label:'מסלולים מנייתיים',         desc:'מעל 90% חשיפה למניות' },
  bonds:            { id:'bonds',           label:'מסלולים אג"חיים',           desc:'פחות מ-10% חשיפה למניות' },
  foreign:          { id:'foreign',         label:'מסלולי חו"ל',              desc:'מעל 90% חשיפה לחו"ל' },
  israel:           { id:'israel',          label:'מסלולי ישראל',             desc:'פחות מ-10% חשיפה לחו"ל' },
  forex:            { id:'forex',           label:'מסלולי מט"ח',              desc:'לפחות 90% חשיפה למט"ח' },
  general:          { id:'general',         label:'מסלולים כלליים',           desc:'מסלול כללי או כולל המילה "כללי"' },
  equitiesIsrael:   { id:'equitiesIsrael',  label:'מניות ישראל',              desc:'לפחות 90% מניות + מקסימום 10% חו"ל' },
  equitiesForeign:  { id:'equitiesForeign', label:'מניות חו"ל',               desc:'לפחות 90% מניות + לפחות 90% חו"ל' },
  bondsIsrael:      { id:'bondsIsrael',     label:'אג"ח ישראל',               desc:'מקסימום 10% מניות + מקסימום 10% חו"ל' },
  bondsForeign:     { id:'bondsForeign',    label:'אג"ח חו"ל',                desc:'מקסימום 10% מניות + לפחות 90% חו"ל' },
  illiquid:         { id:'illiquid',        label:'מסלולים מוטי לא-סחיר',    desc:'לפחות 10% לא סחיר' },
  liquid:           { id:'liquid',          label:'מסלולים סחירים',           desc:'עד 3% לא סחיר' },
  sp500:            { id:'sp500',           label:'מסלולי S&P 500',           desc:'מסלול עוקב מדד S&P 500' },
  gemel_under50:    { id:'gemel_under50',   label:'מובילות עד גיל 50',        desc:'מסלול ייעודי לבני 50 ומטה' },
  gemel_50_60:      { id:'gemel_50_60',     label:'מובילות 50–60',            desc:'מסלול ייעודי לבני 50 עד 60' },
  gemel_over60:     { id:'gemel_over60',    label:'מובילות מעל 60',           desc:'מסלול ייעודי לבני 60 ומעלה' },
};

function isGeneral(fund) {
  const n = (fund.name || '').toLowerCase();
  const sh = fund.sheet || '';
  return n.includes('כללי') || sh.includes('כללי') || sh.includes('מובילות-כללי') || sh === 'כללי';
}

function isSP500(fund) {
  const n = (fund.name || '').toLowerCase();
  const sh = (fund.sheet || '').toLowerCase();
  return n.includes('s&p') || n.includes('s&amp;p') || n.includes('500') ||
    sh.includes('s&p') || sh.includes('500');
}

export function classifyFund(fund) {
  const cats = [];
  const sh = fund.sheet || '';
  const s  = fund.stocks   ?? null;
  const f  = fund.foreign  ?? null;
  const fx = fund.forex    ?? null;
  const il = fund.illiquid ?? null;

  if (isSP500(fund))   cats.push('sp500');
  if (isGeneral(fund)) cats.push('general');

  // Gemel age-based tracks
  if (sh.includes('עד50') || sh.includes('עד 50') || sh.includes('מובילות-עד50'))     cats.push('gemel_under50');
  if (sh.includes('50-60') || sh.includes('50 עד 60') || sh.includes('מובילות-50-60')) cats.push('gemel_50_60');
  if (sh.includes('60+') || sh.includes('60 ומעלה') || sh.includes('מובילות-60+'))    cats.push('gemel_over60');

  // Exposure-based (same for ALL products including pension)
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
