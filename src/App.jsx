import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { CATEGORIES, getCategoriesForProduct, getFundsForCategory, classifyFund } from "./utils/classifier";
import { PRODUCT_LABELS, getAllFunds, calcAverages, getSheets, getFundsBySheet } from "./utils/dataLoader";
import { loadHistory, computeSeries, computeAvgSeries, availableRanges, fmtPeriod } from "./utils/historyLoader";

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
  crimson:'#8B1A3A', crimsonLt:'#B02248', crimsonPale:'#FFF0F3',
  dark:'#1A1A1A', darkMid:'#2C2C2C', mid:'#3D3D3D', muted:'#6B6B6B',
  border:'#E5E0DC', bg:'#F8F5F2', white:'#FFFFFF',
  pos:'#16A34A', neg:'#DC2626', avgBg:'#F5F0EA',
  chartBlue:'#2563EB', chartAmber:'#D97706', chartGray:'rgba(139,26,58,0.25)',
};

const BASE_ORDER = [
  'general','equities','bonds','govBonds','moneyMarket','israel','foreign',
  'forex','equitiesIsrael','equitiesForeign','bondsIsrael','bondsForeign',
  'illiquid','liquid','sp500',
];
const GEMEL_ORDER = [
  'gemel_under50','gemel_50_60','gemel_over60',
  'equities','bonds','govBonds','moneyMarket','israel','foreign',
  'forex','equitiesIsrael','equitiesForeign','bondsIsrael','bondsForeign',
  'illiquid','liquid','sp500',
];

const pctFmt    = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pctFmtRaw = v => v == null ? '—' : `${v.toFixed(1)}%`;
const numColor  = v => v == null ? C.dark : v >= 0 ? C.pos : C.neg;

function calcBonds(fund) {
  return Math.max(0, Math.round((100 - (fund.stocks ?? 0) - (fund.illiquid ?? 0)) * 10) / 10);
}

const SORT_COLS = [
  { key:'ret_month', label:'חודש',        tip:'תשואה בחודש האחרון' },
  { key:'ret_ytd',   label:'מתחילת שנה',  tip:'תשואה מצטברת מתחילת השנה' },
  { key:'ret_1y',    label:'שנה',          tip:'תשואה מצטברת 12 חודשים' },
  { key:'ret_3y',    label:'3 שנים',       tip:'תשואה מצטברת 36 חודשים' },
  { key:'ret_5y',    label:'5 שנים',       tip:'תשואה מצטברת 60 חודשים' },
  { key:'ret_10y',   label:'10 שנים',      tip:'תשואה מצטברת 120 חודשים' },
];

const TH = { padding:'5px 6px', fontSize:10, fontWeight:700, whiteSpace:'nowrap' };
const TD = { padding:'4px 6px', fontSize:11 };

// ─── Profit Index ─────────────────────────────────────────────────────────────
const PROFIT_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTBaP0TxMSmULSqhQb3ORgKHEwb8MB2jNuSOFn-3rsUofFZNTsj2RuDUkTihBGTdPjvSaw1e5TLfUjm/pub?output=csv";

function useProfitIndex() {
  const [map, setMap] = useState({});
  useEffect(() => {
    fetch(PROFIT_CSV).then(r => r.text()).then(csv => {
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return;
      const sep   = lines[0].includes('\t') ? '\t' : ',';
      const names = lines[0].split(sep).map(c => c.replace(/^"|"$/g,'').trim());
      const scores= lines[1].split(sep).map(c => c.replace(/^"|"$/g,'').trim());
      const m = {};
      for (let i = 1; i < names.length; i++) {
        const v = parseFloat(scores[i]);
        if (names[i] && !isNaN(v)) m[names[i]] = v;
      }
      setMap(m);
    }).catch(() => {});
  }, []);
  return map;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
function Tooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:'relative', display:'inline-flex', alignItems:'center' }}>
      <span onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
        style={{
          width:12, height:12, borderRadius:'50%', background:'rgba(255,255,255,0.18)',
          color:'rgba(255,255,255,0.7)', fontSize:7.5, fontWeight:700,
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          cursor:'help', marginRight:2, border:'1px solid rgba(255,255,255,0.3)',
        }}>?</span>
      {show && (
        <div style={{
          position:'absolute', bottom:'calc(100% + 6px)', right:0, width:200,
          background:C.dark, color:C.white, borderRadius:7, padding:'7px 11px',
          fontSize:11, lineHeight:1.6, zIndex:3000, boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
          direction:'rtl', fontWeight:400, pointerEvents:'none',
        }}>{text}</div>
      )}
    </span>
  );
}

// ─── Historical Chart ─────────────────────────────────────────────────────────
function HistoricalChart({ fund, catFundIds, histData, onClose }) {
  const [range, setRange]         = useState('3y');
  const [expanded, setExpanded]   = useState(false);
  const [compare, setCompare]     = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ]     = useState('');
  const [hoverIdx, setHoverIdx]   = useState(null);
  const svgRef = useRef(null);

  const fundPoints = useMemo(
    () => fund.fund_id ? histData[fund.fund_id] ?? [] : [],
    [fund.fund_id, histData]
  );
  const ranges = useMemo(() => availableRanges(fundPoints), [fundPoints]);
  useEffect(() => {
    if (ranges.length && !ranges.find(r => r.key === range)) {
      setRange(ranges[ranges.length - 1].key);
    }
  }, [ranges]);

  const mainSeries  = useMemo(() => computeSeries(fundPoints, range), [fundPoints, range]);
  const avgSeries   = useMemo(() => computeAvgSeries(catFundIds, histData, range), [catFundIds, histData, range]);
  const compareSeries = useMemo(() =>
    compare.map(id => ({ id, series: computeSeries(histData[id] ?? [], range) })),
    [compare, histData, range]
  );

  const allFunds = fund._allFunds ?? [];
  const searchResults = useMemo(() => {
    if (!searchQ.trim()) return [];
    return allFunds.filter(f => f.fund_id && f.name.includes(searchQ.trim()) && f.fund_id !== fund.fund_id).slice(0, 8);
  }, [searchQ, allFunds, fund.fund_id]);

  if (!mainSeries.length) return (
    <div style={{ padding:'28px 20px', textAlign:'center', color:C.muted, fontSize:13 }}>
      <div style={{ fontSize:24, marginBottom:8 }}>📊</div>
      אין מספיק נתונים היסטוריים להצגת גרף
    </div>
  );

  const W = expanded ? 700 : 480, H = expanded ? 280 : 175, PAD = { t:12, r:10, b:28, l:44 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;

  const allSeries = [mainSeries, avgSeries, ...compareSeries.map(c => c.series)].filter(s => s.length);
  const allVals   = allSeries.flatMap(s => s.map(p => p.cumRet));
  const [minV, maxV] = [Math.min(...allVals, 0), Math.max(...allVals, 0)];
  const valRange = maxV - minV || 1;

  function xForIdx(i, total) { return PAD.l + (i / Math.max(total - 1, 1)) * cW; }
  function yForVal(v) { return PAD.t + cH - ((v - minV) / valRange) * cH; }
  function seriesPath(series) {
    return series.map((p, i) => {
      const x = xForIdx(i, series.length);
      const y = yForVal(p.cumRet);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  function handleMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (W / rect.width);
    const relX = mouseX - PAD.l;
    const idx = Math.round((relX / cW) * (mainSeries.length - 1));
    setHoverIdx(Math.max(0, Math.min(idx, mainSeries.length - 1)));
  }

  const hoverPoint = hoverIdx != null ? mainSeries[hoverIdx] : null;
  const hoverX = hoverPoint ? xForIdx(hoverIdx, mainSeries.length) : null;
  const hoverY = hoverPoint ? yForVal(hoverPoint.cumRet) : null;
  const yTicks = [minV, (minV+maxV)/2, maxV].map(v => ({ v: Math.round(v*10)/10, y: yForVal(v) }));
  const CHART_COLORS = ['#8B1A3A','#2563EB','#D97706','#059669','#7C3AED'];

  return (
    <>
    {/* Modal overlay */}
    {expanded && (
      <div onClick={() => setExpanded(false)} style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:9000,
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background:C.white, borderRadius:14, width:'min(92vw, 860px)',
          boxShadow:'0 24px 64px rgba(0,0,0,0.4)', overflow:'hidden',
          direction:'rtl',
        }}>
          {/* Modal header */}
          <div style={{ background:C.crimson, padding:'11px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ color:C.white, fontSize:13, fontWeight:700 }}>{fund.name}</span>
            <button onClick={() => setExpanded(false)} style={{ background:'rgba(255,255,255,0.2)', border:'none', color:C.white, width:26, height:26, borderRadius:'50%', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
          </div>
          {/* Range tabs */}
          <div style={{ display:'flex', gap:4, padding:'10px 16px 8px', borderBottom:`1px solid ${C.border}`, alignItems:'center' }}>
            <span style={{ fontSize:11, color:C.muted, marginLeft:6 }}>טווח:</span>
            {ranges.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)} style={{
                padding:'3px 12px', borderRadius:12, border:`1px solid ${range===r.key ? C.crimson : C.border}`,
                background: range===r.key ? C.crimson : C.white,
                color: range===r.key ? C.white : C.mid,
                fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
              }}>{r.label}</button>
            ))}
          </div>
          {/* Big chart */}
          {(() => {
            const MW = 780, MH = 340, MPAD = { t:16, r:14, b:32, l:52 };
            const mcW = MW - MPAD.l - MPAD.r, mcH = MH - MPAD.t - MPAD.b;
            function mxForIdx(i, total) { return MPAD.l + (i / Math.max(total - 1, 1)) * mcW; }
            function myForVal(v) { return MPAD.t + mcH - ((v - minV) / valRange) * mcH; }
            function mSeriesPath(series) {
              return series.map((p, i) => {
                const x = mxForIdx(i, series.length);
                const y = myForVal(p.cumRet);
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
            }
            const myTicks = [minV, minV+(maxV-minV)*0.25, minV+(maxV-minV)*0.5, minV+(maxV-minV)*0.75, maxV].map(v => ({
              v: Math.round(v*10)/10, y: myForVal(v)
            }));
            return (
              <div style={{ padding:'12px 16px 8px' }}>
                <svg width="100%" viewBox={`0 0 ${MW} ${MH}`} style={{ display:'block', overflow:'visible' }}>
                  <line x1={MPAD.l} y1={myForVal(0)} x2={MPAD.l+mcW} y2={myForVal(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3 3"/>
                  {myTicks.map(t => (
                    <g key={t.v}>
                      <line x1={MPAD.l-4} y1={t.y} x2={MPAD.l} y2={t.y} stroke={C.border} strokeWidth="1"/>
                      <text x={MPAD.l-6} y={t.y+4} textAnchor="end" fontSize="10" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">
                        {t.v > 0 ? '+' : ''}{t.v.toFixed(1)}%
                      </text>
                    </g>
                  ))}
                  {avgSeries.length > 0 && <path d={mSeriesPath(avgSeries)} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeDasharray="8 4" opacity="0.9"/>}
                  <path d={mSeriesPath(mainSeries)} fill="none" stroke={C.crimson} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  {mainSeries.filter((_, i) => {
                    const step = mainSeries.length > 60 ? 12 : mainSeries.length > 24 ? 6 : 3;
                    return i % step === 0 || i === mainSeries.length - 1;
                  }).map((p) => {
                    const i = mainSeries.indexOf(p);
                    return <text key={p.period} x={mxForIdx(i, mainSeries.length)} y={MH-6} textAnchor="middle" fontSize="9.5" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{fmtPeriod(p.period)}</text>;
                  })}
                </svg>
                {/* Legend */}
                <div style={{ display:'flex', gap:14, padding:'4px 0 8px', alignItems:'center' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:C.dark }}>
                    <svg width="22" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke={C.crimson} strokeWidth="3"/></svg>
                    {fund.name.slice(0,30)}{fund.name.length>30?'…':''}
                  </span>
                  {avgSeries.length > 0 && (
                    <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#2563EB', fontWeight:600 }}>
                      <svg width="22" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke="#2563EB" strokeWidth="2.5" strokeDasharray="6 3"/></svg>
                      ממוצע קטגוריה
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    )}
    <div style={{ padding:'0 0 4px' }}>
      <div style={{ display:'flex', gap:4, padding:'10px 14px 8px', borderBottom:`1px solid ${C.border}`, alignItems:'center' }}>
        <span style={{ fontSize:11, color:C.muted, alignSelf:'center', marginLeft:6 }}>טווח:</span>
        {ranges.map(r => (
          <button key={r.key} onClick={() => setRange(r.key)} style={{
            padding:'3px 10px', borderRadius:12, border:`1px solid ${range===r.key ? C.crimson : C.border}`,
            background: range===r.key ? C.crimson : C.white,
            color: range===r.key ? C.white : C.mid,
            fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
          }}>{r.label}</button>
        ))}
      </div>
      <div style={{ padding:'8px 14px 4px', position:'relative' }}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
          style={{ display:'block', overflow:'visible', cursor:'crosshair' }}
          onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
          <line x1={PAD.l} y1={yForVal(0)} x2={PAD.l+cW} y2={yForVal(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3 3"/>
          {yTicks.map(t => (
            <g key={t.v}>
              <line x1={PAD.l-3} y1={t.y} x2={PAD.l} y2={t.y} stroke={C.border} strokeWidth="1"/>
              <text x={PAD.l-5} y={t.y+4} textAnchor="end" fontSize="8.5" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">
                {t.v > 0 ? '+' : ''}{t.v.toFixed(1)}%
              </text>
            </g>
          ))}
          {avgSeries.length > 0 && <path d={seriesPath(avgSeries)} fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="6 3" opacity="0.85"/>}
          {compareSeries.map((c, ci) => c.series.length > 0 && (
            <path key={c.id} d={seriesPath(c.series)} fill="none" stroke={CHART_COLORS[ci+2] ?? '#888'} strokeWidth="1.5" opacity="0.7"/>
          ))}
          <path d={seriesPath(mainSeries)} fill="none" stroke={C.crimson} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          {mainSeries.filter((_, i) => {
            const step = mainSeries.length > 60 ? 12 : mainSeries.length > 24 ? 6 : 3;
            return i % step === 0 || i === mainSeries.length - 1;
          }).map((p) => {
            const i = mainSeries.indexOf(p);
            return <text key={p.period} x={xForIdx(i, mainSeries.length)} y={H-6} textAnchor="middle" fontSize="8" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{fmtPeriod(p.period)}</text>;
          })}
          {hoverPoint && (
            <>
              <line x1={hoverX} y1={PAD.t} x2={hoverX} y2={PAD.t+cH} stroke={C.crimson} strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/>
              <circle cx={hoverX} cy={hoverY} r="4" fill={C.crimson} stroke={C.white} strokeWidth="1.5"/>
            </>
          )}
        </svg>
        {hoverPoint && (
          <div style={{
            position:'absolute',
            top: Math.max(8, (hoverY / H) * 100 - 20) + '%',
            right: hoverX / W > 0.6 ? (100 - hoverX / W * 100 + 2) + '%' : 'auto',
            left: hoverX / W <= 0.6 ? (hoverX / W * 100 + 1) + '%' : 'auto',
            background:C.dark, color:C.white, borderRadius:7,
            padding:'5px 9px', fontSize:11, pointerEvents:'none', zIndex:100,
            boxShadow:'0 4px 14px rgba(0,0,0,0.3)', direction:'rtl', lineHeight:1.7,
          }}>
            <div style={{ fontWeight:700 }}>{hoverPoint.label}</div>
            <div style={{ color: hoverPoint.cumRet >= 0 ? '#6EE7A0' : '#FCA5A5' }}>
              מצטבר: {hoverPoint.cumRet > 0 ? '+' : ''}{hoverPoint.cumRet.toFixed(2)}%
            </div>
          </div>
        )}
      </div>
      <div style={{ padding:'4px 14px 8px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10.5, color:C.dark }}>
          <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={C.crimson} strokeWidth="2.5"/></svg>
          {fund.name.slice(0, 22)}{fund.name.length > 22 ? '…' : ''}
        </span>
        {avgSeries.length > 0 && (
          <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10.5, color:C.muted }}>
            <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#2563EB" strokeWidth="2" strokeDasharray="6 3"/></svg>
            ממוצע קטגוריה
          </span>
        )}
      </div>
      <div style={{ padding:'0 14px 10px', borderTop:`1px solid ${C.border}` }}>
        {!showSearch ? (
          <button onClick={() => setShowSearch(true)} style={{
            background:'none', border:`1px dashed ${C.border}`, borderRadius:8,
            color:C.muted, fontSize:11, padding:'4px 10px', cursor:'pointer', fontFamily:'inherit', marginTop:8,
          }}>+ השוואה למוצר נוסף</button>
        ) : (
          <div style={{ marginTop:8 }}>
            <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="חפש קופה להשוואה..."
              style={{ width:'100%', padding:'6px 10px', border:`1px solid ${C.border}`, borderRadius:7, fontSize:12, fontFamily:'inherit', direction:'rtl', outline:'none', background:C.bg }}
            />
            {searchResults.length > 0 && (
              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:7, marginTop:3, maxHeight:140, overflowY:'auto', boxShadow:'0 6px 18px rgba(0,0,0,0.1)' }}>
                {searchResults.map(f => (
                  <div key={f.fund_id} onClick={() => { if (!compare.includes(f.fund_id) && compare.length < 3) setCompare(prev => [...prev, f.fund_id]); setSearchQ(''); setShowSearch(false); }}
                    style={{ padding:'6px 10px', fontSize:11.5, cursor:'pointer', borderBottom:`1px solid ${C.border}`, direction:'rtl' }}
                    onMouseEnter={e => e.currentTarget.style.background=C.bg}
                    onMouseLeave={e => e.currentTarget.style.background=C.white}
                  >{f.name}</div>
                ))}
              </div>
            )}
            <button onClick={() => { setShowSearch(false); setSearchQ(''); }} style={{ background:'none', border:'none', color:C.muted, fontSize:11, cursor:'pointer', fontFamily:'inherit', marginTop:4 }}>ביטול</button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

// ─── Product Selector ─────────────────────────────────────────────────────────
function ProductSelector({ selected, onChange }) {
  return (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
      {Object.entries(PRODUCT_LABELS).map(([key, { label, icon }]) => {
        const active = selected === key;
        return (
          <button key={key} onClick={() => onChange(key)} style={{
            display:'flex', alignItems:'center', gap:6, padding:'7px 13px',
            border:`2px solid ${active ? C.crimson : C.border}`,
            borderRadius:8, background: active ? C.crimson : C.white,
            color: active ? C.white : C.dark, cursor:'pointer',
            fontFamily:'inherit', fontSize:12.5, fontWeight:600,
            transition:'all 0.15s',
            boxShadow: active ? '0 3px 12px rgba(139,26,58,0.2)' : 'none',
          }}>
            <span style={{ fontSize:14 }}>{icon}</span>{label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Category Quick-Nav ───────────────────────────────────────────────────────
function CategoryNav({ catIds, funds }) {
  const scrollTo = id => {
    const el = document.getElementById(`sec-${id}`);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  };
  return (
    <div style={{
      display:'flex', gap:5, flexWrap:'wrap', padding:'7px 14px',
      background:C.white, borderBottom:`1px solid ${C.border}`,
      position:'sticky', top:56, zIndex:90,
    }}>
      {catIds.map(id => {
        if (!getFundsForCategory(funds, id).length) return null;
        return (
          <button key={id} onClick={() => scrollTo(id)} style={{
            padding:'3px 9px', borderRadius:12,
            border:`1px solid ${C.border}`, background:C.white,
            color:C.mid, fontSize:10.5, fontWeight:600,
            cursor:'pointer', fontFamily:'inherit', transition:'all 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor=C.crimson; e.currentTarget.style.color=C.crimson; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.mid; }}
          >{CATEGORIES[id].label}</button>
        );
      })}
    </div>
  );
}

// ─── Track Browser (מסלולי השקעה) ─────────────────────────────────────────────
function TrackBrowser({ product, onSelectFund, selFund }) {
  const [open, setOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);

  const sheets = useMemo(() => getSheets(product), [product]);
  const sheetFunds = useMemo(() => activeSheet ? getFundsBySheet(product, activeSheet) : [], [product, activeSheet]);

  const avg = useMemo(() => calcAverages(sheetFunds), [sheetFunds]);

  return (
    <div style={{ borderBottom:`1px solid ${C.border}`, background:C.white }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'11px 16px', background:'none', border:'none', cursor:'pointer',
        fontFamily:'inherit', direction:'rtl',
      }}>
        <span style={{ fontSize:13, fontWeight:700, color:C.dark }}>📂 מסלולי השקעה</span>
        <span style={{ fontSize:12, color:C.muted }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding:'0 14px 14px' }}>
          {/* Sheet buttons */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:12 }}>
            {sheets.map(sh => (
              <button key={sh} onClick={() => setActiveSheet(activeSheet === sh ? null : sh)} style={{
                padding:'4px 11px', borderRadius:14,
                border:`1.5px solid ${activeSheet===sh ? C.crimson : C.border}`,
                background: activeSheet===sh ? C.crimson : C.white,
                color: activeSheet===sh ? C.white : C.mid,
                fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                transition:'all 0.12s',
              }}>{sh}</button>
            ))}
          </div>

          {/* Funds table for selected sheet */}
          {activeSheet && sheetFunds.length > 0 && (
            <div style={{ overflowX:'auto', border:`1px solid ${C.border}`, borderRadius:8 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'auto' }}>
                <thead>
                  <tr style={{ background:C.darkMid }}>
                    <th style={{ ...TH, textAlign:'right', color:'rgba(255,255,255,0.8)', whiteSpace:'nowrap', paddingRight:10 }}>שם המוצר</th>
                    {SORT_COLS.map(c => (
                      <th key={c.key} style={{ ...TH, textAlign:'center', color:'rgba(255,255,255,0.7)' }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheetFunds.map(f => {
                    const isSel = selFund?.name === f.name;
                    return (
                      <tr key={f.name} onClick={() => onSelectFund(f)} style={{
                        background: isSel ? '#FFF0F3' : C.white,
                        cursor:'pointer', borderBottom:`1px solid ${C.border}`,
                      }}
                      onMouseEnter={e => { if (!isSel) e.currentTarget.style.background='#FDF8F6'; }}
                      onMouseLeave={e => { if (!isSel) e.currentTarget.style.background=C.white; }}>
                        <td style={{ ...TD, color: isSel ? C.crimson : C.darkMid, fontWeight:500, whiteSpace:'nowrap', paddingRight:10 }}>{f.name}</td>
                        {SORT_COLS.map(col => (
                          <td key={col.key} style={{ ...TD, textAlign:'center', color:numColor(f[col.key]), fontWeight:600, fontVariantNumeric:'tabular-nums' }}>
                            {pctFmt(f[col.key])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {/* Average row */}
                  <tr style={{ background:C.avgBg, borderTop:`2px solid ${C.border}` }}>
                    <td style={{ ...TD, fontWeight:700, color:C.dark, paddingRight:10 }}>⌀ ממוצע</td>
                    {SORT_COLS.map(col => (
                      <td key={col.key} style={{ ...TD, textAlign:'center', color:numColor(avg[col.key]), fontWeight:700 }}>
                        {pctFmt(avg[col.key])}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Comparison Search ────────────────────────────────────────────────────────
function ComparisonSearch({ allFunds }) {
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    if (!query) return allFunds.slice(0, 12); // show first 12 when empty
    const q = query.toLowerCase();
    return allFunds.filter(f => f.name.toLowerCase().includes(q)).slice(0, 12);
  }, [query, allFunds]);

  const addFund = f => {
    if (selected.length < 10 && !selected.find(s => s.name === f.name)) {
      setSelected(prev => [...prev, f]);
    }
    setQuery('');
    setShowDropdown(false);
  };

  const removeFund = name => setSelected(prev => prev.filter(f => f.name !== name));

  return (
    <div style={{ borderBottom:`1px solid ${C.border}`, background:C.white }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'11px 16px', background:'none', border:'none', cursor:'pointer',
        fontFamily:'inherit', direction:'rtl',
      }}>
        <span style={{ fontSize:13, fontWeight:700, color:C.dark }}>⚖️ השוואת מסלולי השקעה</span>
        <span style={{ fontSize:12, color:C.muted }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding:'0 14px 14px' }}>
          {/* Search input */}
          <div style={{ position:'relative', marginBottom:10 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="חפש קרן להשוואה... (עד 10)"
              style={{
                width:'100%', padding:'8px 12px', border:`1.5px solid ${C.border}`,
                borderRadius:8, fontSize:12.5, fontFamily:'inherit', direction:'rtl',
                outline:'none', background:C.bg, boxSizing:'border-box',
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && results.length > 0 && (
              <div style={{
                position:'absolute', top:'calc(100% + 4px)', right:0, left:0, zIndex:500,
                background:C.white, border:`1px solid ${C.border}`, borderRadius:8,
                maxHeight:220, overflowY:'auto', boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
              }}>
                {results.map(f => (
                  <div key={f.name} onMouseDown={() => addFund(f)} style={{
                    padding:'7px 12px', fontSize:12, cursor:'pointer',
                    borderBottom:`1px solid ${C.border}`, direction:'rtl',
                    color: selected.find(s => s.name === f.name) ? C.crimson : C.dark,
                    fontWeight: selected.find(s => s.name === f.name) ? 700 : 400,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background=C.bg}
                  onMouseLeave={e => e.currentTarget.style.background=C.white}>
                    {selected.find(s => s.name === f.name) ? '✓ ' : ''}{f.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected chips */}
          {selected.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:10 }}>
              {selected.map(f => (
                <span key={f.name} style={{
                  display:'inline-flex', alignItems:'center', gap:4,
                  background:C.crimsonPale, border:`1px solid #F8C8D0`,
                  borderRadius:12, padding:'3px 8px 3px 4px', fontSize:11,
                  color:C.crimson, fontWeight:600,
                }}>
                  {f.name.slice(0, 28)}{f.name.length > 28 ? '…' : ''}
                  <button onClick={() => removeFund(f.name)} style={{
                    background:'none', border:'none', cursor:'pointer', color:C.crimson,
                    fontSize:13, padding:0, lineHeight:1, display:'flex', alignItems:'center',
                  }}>×</button>
                </span>
              ))}
              <button onClick={() => setSelected([])} style={{
                background:'none', border:`1px solid ${C.border}`, borderRadius:12,
                padding:'3px 8px', fontSize:10.5, color:C.muted, cursor:'pointer', fontFamily:'inherit',
              }}>נקה הכל</button>
            </div>
          )}

          {/* Comparison table */}
          {selected.length > 0 && (
            <div style={{ overflowX:'auto', border:`1px solid ${C.border}`, borderRadius:8 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'auto' }}>
                <thead>
                  <tr style={{ background:C.darkMid }}>
                    <th style={{ ...TH, textAlign:'right', color:'rgba(255,255,255,0.8)', whiteSpace:'nowrap', paddingRight:10 }}>שם המוצר</th>
                    {SORT_COLS.map(c => (
                      <th key={c.key} style={{ ...TH, textAlign:'center', color:'rgba(255,255,255,0.7)' }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.map(f => (
                    <tr key={f.name} style={{ background:C.white, borderBottom:`1px solid ${C.border}` }}>
                      <td style={{ ...TD, fontWeight:500, color:C.darkMid, whiteSpace:'nowrap', paddingRight:10 }}>{f.name}</td>
                      {SORT_COLS.map(col => (
                        <td key={col.key} style={{ ...TD, textAlign:'center', color:numColor(f[col.key]), fontWeight:600, fontVariantNumeric:'tabular-nums' }}>
                          {pctFmt(f[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Fund Detail Panel ────────────────────────────────────────────────────────
function FundDetail({ fund, onClose, catAvg, catFundIds, histData, allFunds }) {
  if (!fund) return null;
  const [activeTab, setActiveTab] = useState('returns');
  const cats  = classifyFund(fund).map(id => CATEGORIES[id]?.label).filter(Boolean);
  const bonds = calcBonds(fund);
  const fundWithAll = useMemo(() => ({ ...fund, _allFunds: allFunds }), [fund, allFunds]);

  const Bar = ({ label, val, color }) => {
    if (val == null) return null;
    return (
      <div style={{ marginBottom:6 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ fontSize:11, color:C.muted }}>{label}</span>
          <span style={{ fontSize:11, fontWeight:700, color:color||C.dark }}>{pctFmtRaw(val)}</span>
        </div>
        <div style={{ height:5, background:C.border, borderRadius:3 }}>
          <div style={{ height:5, borderRadius:3, width:`${Math.min(Math.abs(val),100)}%`, background:color||C.crimson }}/>
        </div>
      </div>
    );
  };

  function ReturnBars() {
    const [hoveredAvg, setHoveredAvg] = useState(null);
    const periods = [
      { key:'ret_month', label:'חודש' }, { key:'ret_ytd', label:'YTD' },
      { key:'ret_1y', label:'שנה' }, { key:'ret_3y', label:'3 שנ׳'},
      { key:'ret_5y', label:'5 שנ׳'}, { key:'ret_10y', label:'10 שנ׳'},
    ].filter(p => fund[p.key] != null);
    if (!periods.length) return <p style={{ textAlign:'center', color:C.muted, fontSize:11, margin:0 }}>אין נתוני תשואה</p>;
    const vals = periods.map(p => fund[p.key]);
    const avgVals = catAvg ? periods.map(p => catAvg[p.key]).filter(v => v != null) : [];
    const maxAbs = Math.max(...[...vals, ...avgVals].map(v => Math.abs(v)), 1);
    const W=280, H=110, PAD=8;
    const barW = (W - PAD*2) / periods.length - 5;
    const zeroY = PAD + (H-16) * 0.5;
    return (
      <div style={{ position:'relative' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H+4}`} style={{ display:'block', overflow:'visible' }}>
          <line x1={PAD} y1={zeroY} x2={W-PAD} y2={zeroY} stroke={C.border} strokeWidth="1"/>
          {periods.map((p, i) => {
            const val = fund[p.key];
            const barH = Math.max(2, Math.abs(val) / maxAbs * ((H-16)/2 - 4));
            const x = PAD + i * ((W-PAD*2) / periods.length) + 2.5;
            const y = val >= 0 ? zeroY - barH : zeroY;
            const color = val >= 0 ? C.pos : C.neg;
            const avg = catAvg?.[p.key];
            const cx = x + barW / 2;
            return (
              <g key={p.key}>
                <rect x={x} y={y} width={barW} height={barH} fill={color} rx="2" opacity="0.85"/>
                <text x={cx} y={val >= 0 ? y-3 : y+barH+10} textAnchor="middle" fontSize="8.5" fill={color} fontWeight="700" fontFamily="Assistant,Heebo,sans-serif">{pctFmt(val)}</text>
                {avg != null && (() => {
                  const ah = Math.abs(avg) / maxAbs * ((H-16)/2 - 4);
                  const ay = avg >= 0 ? zeroY - ah : zeroY + ah;
                  return <circle cx={cx} cy={ay} r="5" fill={C.crimson} opacity="0.85" style={{ cursor:'pointer' }} onMouseEnter={() => setHoveredAvg({ label:p.label, val:avg, cx, cy:ay })} onMouseLeave={() => setHoveredAvg(null)}/>;
                })()}
                <text x={cx} y={H+2} textAnchor="middle" fontSize="8.5" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{p.label}</text>
              </g>
            );
          })}
        </svg>
        {hoveredAvg && (
          <div style={{ position:'absolute', left:`calc(${(hoveredAvg.cx/W)*100}% - 55px)`, top:`calc(${(hoveredAvg.cy/(H+4))*100}% - 42px)`, background:C.dark, color:C.white, borderRadius:7, padding:'5px 10px', fontSize:11, fontWeight:600, whiteSpace:'nowrap', boxShadow:'0 4px 14px rgba(0,0,0,0.35)', pointerEvents:'none', zIndex:500, direction:'rtl' }}>
            ממוצע ({hoveredAvg.label}): {pctFmt(hoveredAvg.val)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ width:'100%', height:'100%', background:C.white, boxShadow:'-4px 0 28px rgba(0,0,0,0.12)', overflowY:'auto', direction:'rtl', display:'flex', flexDirection:'column' }}>
      <div style={{ background:C.crimson, padding:'13px 13px 11px', color:C.white, flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <h2 style={{ margin:0, fontSize:12, fontWeight:700, lineHeight:1.5, flex:1, paddingLeft:8 }}>{fund.name}</h2>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.2)', border:'none', color:C.white, width:24, height:24, borderRadius:'50%', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>×</button>
        </div>
        <div style={{ marginTop:6, display:'flex', gap:4, flexWrap:'wrap' }}>
          {cats.slice(0,3).map(c => (
            <span key={c} style={{ background:'rgba(255,255,255,0.2)', borderRadius:8, padding:'1px 7px', fontSize:9, fontWeight:600 }}>{c}</span>
          ))}
        </div>
      </div>
      <div style={{ display:'flex', borderBottom:`1px solid ${C.border}`, flexShrink:0, background:C.white }}>
        {[{ id:'returns', label:'תשואות וחשיפות' }, { id:'history', label:'📈 גרף היסטורי' }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex:1, padding:'9px 0', border:'none', background:'none', color: activeTab===tab.id ? C.crimson : C.muted, fontFamily:'inherit', fontSize:12, fontWeight:700, cursor:'pointer', borderBottom: activeTab===tab.id ? `2px solid ${C.crimson}` : '2px solid transparent' }}>{tab.label}</button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto' }}>
        {activeTab === 'returns' && (
          <div style={{ padding:'11px 13px' }}>
            {fund.profit_index != null && (
              <div style={{ background:'linear-gradient(135deg,#FFF0F3,#FFE4EA)', border:`1px solid #F8C8D0`, borderRadius:9, padding:'8px 12px', marginBottom:11, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:11, color:C.crimson, fontWeight:700 }}>מדד פרופיט</div>
                  <div style={{ fontSize:9.5, color:C.muted }}>שירות ואיכות ניהול</div>
                </div>
                <span style={{ fontSize:26, fontWeight:900, color:C.crimson }}>{fund.profit_index.toFixed(1)}</span>
              </div>
            )}
            <div style={{ marginBottom:11 }}>
              <div style={{ fontSize:11.5, fontWeight:700, color:C.dark, marginBottom:5 }}>
                תשואות
                {catAvg && <span style={{ fontSize:9.5, color:C.muted, fontWeight:400, marginRight:5 }}>| עיגול = ממוצע קטגוריה</span>}
              </div>
              <div style={{ background:C.bg, borderRadius:8, padding:'9px 7px' }}><ReturnBars/></div>
            </div>
            <div style={{ marginBottom:11 }}>
              <div style={{ fontSize:11.5, fontWeight:700, color:C.dark, marginBottom:7 }}>הרכב החשיפות</div>
              <Bar label="מניות" val={fund.stocks} color="#2563EB"/>
              <Bar label={'אג"ח (מחושב)'} val={bonds} color="#D97706"/>
              <Bar label={'חו"ל'} val={fund.foreign} color="#7C3AED"/>
              <Bar label={'מט"ח'} val={fund.forex} color="#059669"/>
              <Bar label="לא סחיר" val={fund.illiquid} color="#9CA3AF"/>
              {fund.fees != null && (
                <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderTop:`1px solid ${C.border}`, marginTop:4 }}>
                  <span style={{ fontSize:11, color:C.muted }}>דמי ניהול</span>
                  <span style={{ fontSize:11, fontWeight:700 }}>{fund.fees.toFixed(2)}%</span>
                </div>
              )}
              {fund.sharpe != null && (
                <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderTop:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:11, color:C.muted }}>מדד שארפ</span>
                  <span style={{ fontSize:11, fontWeight:700 }}>{fund.sharpe.toFixed(2)}</span>
                </div>
              )}
            </div>
            <div style={{ background:C.bg, border:`1.5px dashed ${C.border}`, borderRadius:9, padding:'10px 12px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                <span style={{ fontSize:14 }}>🤖</span>
                <span style={{ fontSize:11.5, fontWeight:700, color:C.dark }}>ניתוח AI</span>
                <span style={{ fontSize:9.5, color:C.muted, background:C.border, borderRadius:7, padding:'1px 6px' }}>בקרוב</span>
              </div>
              <p style={{ margin:0, fontSize:11, color:C.muted, lineHeight:1.7 }}>
                כאן יופיע תיאור AI על הגוף המנהל, אסטרטגיית ניהול ההשקעות, וה"סיפור" של המוצר.
              </p>
            </div>
          </div>
        )}
        {activeTab === 'history' && (
          <HistoricalChart fund={fundWithAll} catFundIds={catFundIds} histData={histData} onClose={() => setActiveTab('returns')}/>
        )}
      </div>
    </div>
  );
}

// ─── Fund Table (2-column grid layout) ───────────────────────────────────────
function sortByKey(funds, key, dir) {
  return [...funds].sort((a, b) => {
    const av = a[key] ?? -Infinity, bv = b[key] ?? -Infinity;
    return dir === 'desc' ? bv - av : av - bv;
  });
}

function FundTable({ funds, catId, onSelect, selFund, selCatId }) {
  const [sortKey, setSortKey] = useState('ret_3y');
  const [sortDir, setSortDir] = useState('desc');
  const [showAll, setShowAll]  = useState(false);
  const cat = CATEGORIES[catId];

  const sorted = useMemo(() => sortByKey(funds, sortKey, sortDir), [funds, sortKey, sortDir]);
  const top12  = sorted.slice(0, 12);
  const rest   = sorted.slice(12);
  const avg    = useMemo(() => calcAverages(sorted), [sorted]);

  function onSortClick(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function SortTh({ col }) {
    const active = sortKey === col.key;
    return (
      <th onClick={() => onSortClick(col.key)} style={{ ...TH, textAlign:'center', cursor:'pointer', userSelect:'none', color: active ? '#FFD6DE' : 'rgba(255,255,255,0.8)', background: active ? 'rgba(255,255,255,0.08)' : 'transparent', minWidth:50 }}>
        <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:2 }}>
          <Tooltip text={col.tip}/>
          {col.label}
          {active && <span style={{ fontSize:8 }}>{sortDir==='desc'?'↓':'↑'}</span>}
        </span>
      </th>
    );
  }

  const thead = (
    <thead>
      <tr style={{ background:'#2A2A2A' }}>
        <th style={{ ...TH, width:18, color:'rgba(255,255,255,0.4)', padding:'5px 3px' }}>#</th>
        <th style={{ ...TH, textAlign:'right', color:'rgba(255,255,255,0.8)' }}>שם המוצר</th>
        {SORT_COLS.map(c => <SortTh key={c.key} col={c}/>)}
      </tr>
    </thead>
  );

  function Row({ fund, rank }) {
    const isAvg = !!fund.isAverage;
    const isSel = !isAvg && selFund?.name === fund.name && selCatId === catId;
    return (
      <tr onClick={() => !isAvg && onSelect(fund, catId)} style={{ background: isAvg ? C.avgBg : isSel ? '#FFF0F3' : C.white, cursor: isAvg ? 'default' : 'pointer', borderBottom:`1px solid #F0EBE6` }}
        onMouseEnter={e => { if (!isAvg && !isSel) e.currentTarget.style.background='#FDF8F6'; }}
        onMouseLeave={e => { if (!isAvg && !isSel) e.currentTarget.style.background=C.white; }}>
        <td style={{ ...TD, color:C.muted, textAlign:'center', fontSize:9.5, width:18, padding:'4px 3px' }}>{isAvg ? '⌀' : rank}</td>
        <td style={{ ...TD, color:isSel?C.crimson:isAvg?C.dark:C.darkMid, fontWeight:isAvg?700:500 }}>
          <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={fund.name}>{fund.name}</div>
        </td>
        {SORT_COLS.map(col => (
          <td key={col.key} style={{ ...TD, textAlign:'center', color:numColor(fund[col.key]), fontWeight:600, fontVariantNumeric:'tabular-nums', background: sortKey===col.key ? 'rgba(139,26,58,0.03)' : 'transparent' }}>
            {pctFmt(fund[col.key])}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div id={`sec-${catId}`} style={{ marginBottom:14, scrollMarginTop:104 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:C.darkMid, borderRadius:'8px 8px 0 0' }}>
        <span style={{ fontSize:11.5, fontWeight:800, color:C.white }}>{cat?.label}</span>
        <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>{cat?.desc}</span>
        <span style={{ marginRight:'auto', fontSize:10, color:'rgba(255,255,255,0.3)' }}>{funds.length} מוצרים</span>
      </div>
      <div style={{ overflowX:'auto', border:`1px solid ${C.border}`, borderTop:'none', borderRadius:'0 0 8px 8px' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'auto' }}>
          {thead}
          <tbody>
            {top12.map((f, i) => <Row key={f.name} fund={f} rank={i+1}/>)}
            <Row fund={avg} rank={null}/>
            {showAll && rest.map((f, i) => <Row key={f.name} fund={f} rank={13+i}/>)}
          </tbody>
        </table>
      </div>
      {rest.length > 0 && (
        <button onClick={() => setShowAll(!showAll)} style={{ background:'transparent', border:'none', color:C.crimson, fontSize:11, cursor:'pointer', fontFamily:'inherit', fontWeight:600, display:'flex', alignItems:'center', gap:4, padding:'4px 2px' }}>
          {showAll ? '▲ הסתר' : `▼ הצג עוד ${rest.length} מוצרים`}
        </button>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [product, setProduct]   = useState('השתלמות');
  const [selFund, setSelFund]   = useState(null);
  const [selCatId, setSelCatId] = useState(null);
  const [histData, setHistData] = useState(null);
  const profitIndex = useProfitIndex();

  useEffect(() => { loadHistory().then(data => setHistData(data)); }, []);

  const rawFunds = useMemo(() => getAllFunds(product), [product]);
  const funds    = useMemo(() =>
    rawFunds.map(f => ({ ...f, profit_index: profitIndex[f.name] ?? f.profit_index ?? null })),
    [rawFunds, profitIndex]
  );
  const allFunds = useMemo(() => Object.keys(PRODUCT_LABELS).flatMap(p => getAllFunds(p)), []);

  const order  = product === 'גמל' ? GEMEL_ORDER : BASE_ORDER;
  const catIds = useMemo(() => order.filter(id => getFundsForCategory(funds, id).length > 0), [funds, order]);

  // selCatId is set directly when user clicks a fund row

  const catAvg = useMemo(() => selCatId ? calcAverages(getFundsForCategory(funds, selCatId)) : null, [selCatId, funds]);
  const catFundIds = useMemo(() => {
    if (!selCatId) return [];
    return getFundsForCategory(funds, selCatId).map(f => f.fund_id).filter(Boolean);
  }, [selCatId, funds]);

  const panelOpen = selFund !== null;
  // Panel width: 420px when open
  const PANEL_W = 420;

  return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:"'Assistant','Heebo',Arial,sans-serif", direction:'rtl' }}>

      {/* Nav */}
      <nav style={{ background:C.dark, padding:'0 20px', display:'flex', alignItems:'center', justifyContent:'center', height:56, position:'sticky', top:0, zIndex:100, boxShadow:'0 2px 10px rgba(0,0,0,0.3)' }}>
        <div style={{ color:C.white, fontSize:20, fontWeight:800, letterSpacing:'0.01em' }}>
          ProGemel<span style={{ color:C.crimsonLt }}>Net</span>
        </div>
      </nav>

      {/* Split layout */}
      <div style={{ display:'flex', minHeight:'calc(100vh - 56px)' }}>

        {/* Main content */}
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
          {/* Product selector */}
          <div style={{ padding:'10px 16px 9px', background:C.white, borderBottom:`1px solid ${C.border}` }}>
            <ProductSelector selected={product} onChange={k => { setProduct(k); setSelFund(null); setSelCatId(null); }}/>
          </div>

          {/* Collapsible sections */}
          <TrackBrowser product={product} onSelectFund={setSelFund} selFund={selFund}/>
          <ComparisonSearch allFunds={allFunds}/>

          {/* Category quick-nav */}
          <CategoryNav catIds={catIds} funds={funds}/>

          {/* Tables — 2 columns */}
          <div style={{ padding:'14px 14px 48px' }}>
            <div style={{
              display:'grid',
              gridTemplateColumns: panelOpen ? '1fr' : 'repeat(2, 1fr)',
              gap:14,
              transition:'grid-template-columns 0.25s ease',
            }}>
              {catIds.map(id => (
                <FundTable key={`${product}-${id}`} catId={id}
                  funds={getFundsForCategory(funds, id)}
                  onSelect={(f, cid) => { setSelFund(f); setSelCatId(cid); }} selFund={selFund} selCatId={selCatId}/>
              ))}
            </div>
          </div>

          <footer style={{ background:C.dark, color:'rgba(255,255,255,0.3)', textAlign:'center', padding:'13px', fontSize:11 }}>
            © {new Date().getFullYear()} Profit Financial Group · הנתונים לצורך מידע בלבד ואינם מהווים ייעוץ השקעות
          </footer>
        </div>

        {/* Detail panel — wider: 420px */}
        <div style={{
          width: panelOpen ? PANEL_W : 0, flexShrink:0,
          transition:'width 0.25s ease', overflow:'hidden',
          position:'sticky', top:56, height:'calc(100vh - 56px)', alignSelf:'flex-start',
        }}>
          {panelOpen && (
            <FundDetail
              fund={selFund}
              onClose={() => setSelFund(null)}
              catAvg={catAvg}
              catFundIds={catFundIds}
              histData={histData ?? {}}
              allFunds={allFunds}
            />
          )}
        </div>
      </div>
    </div>
  );
}
