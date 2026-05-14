/**
 * ProGemel — Data Loader v2
 */
import rawData from '../data/raw_data.json';

export const PRODUCT_LABELS = {
  'השתלמות':      { label: 'קרנות השתלמות',    icon: '🎓' },
  'פוליסות':      { label: 'פוליסות חיסכון',    icon: '📋' },
  'פנסיה':        { label: 'קרנות פנסיה',       icon: '🔐' },
  'גמל':          { label: 'קופות גמל',          icon: '💰' },
  'גמל_להשקעה':   { label: 'גמל להשקעה',        icon: '📈' },
  'ביטוח_מנהלים': { label: 'ביטוח מנהלים',      icon: '🏦' },
};

// Funds to exclude (legacy/non-standard entries)
const EXCLUDED_FUNDS = new Set(["מנורה-קרן י' חדשה"]);

export function getAllFunds(productKey) {
  const productData = rawData[productKey];
  if (!productData) return [];
  return Object.values(productData).flat().filter(f => !EXCLUDED_FUNDS.has(f.name));
}

export function getFundsBySheet(productKey, sheetName) {
  return (rawData[productKey]?.[sheetName] ?? []).filter(f => !EXCLUDED_FUNDS.has(f.name));
}

export function getSheets(productKey) {
  return Object.keys(rawData[productKey] ?? {});
}

export function calcAverages(funds) {
  const keys = ['ret_month','ret_ytd','ret_1y','ret_3y','ret_5y','ret_10y',
                 'stocks','foreign','forex','illiquid','fees','sharpe'];
  const result = { name: 'ממוצע', isAverage: true };
  keys.forEach(k => {
    const vals = funds.map(f => f[k]).filter(v => v != null);
    result[k] = vals.length
      ? Math.round((vals.reduce((a,b) => a+b, 0) / vals.length) * 100) / 100
      : null;
  });
  return result;
}

export { rawData };
