import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { CATEGORIES, getCategoriesForProduct, getFundsForCategory, classifyFund } from "./utils/classifier";
import { PRODUCT_LABELS, getAllFunds, calcAverages } from "./utils/dataLoader";
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
  'general','equities','bonds','israel','foreign',
  'forex','equitiesIsrael','equitiesForeign','bondsIsrael','bondsForeign',
  'illiquid','liquid','sp500',
];
const GEMEL_ORDER = [
  'gemel_under50','gemel_50_60','gemel_over60',
  'equities','bonds','israel','foreign',
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

const TH = { padding:'6px 7px', fontSize:10.5, fontWeight:700, whiteSpace:'nowrap' };
const TD = { padding:'5px 7px', fontSize:11.5 };

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
  const [compare, setCompare]     = useState([]);      // extra fund_ids added by user
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ]     = useState('');
  const [hoverIdx, setHoverIdx]   = useState(null);
  const svgRef = useRef(null);

  const fundPoints = useMemo(
    () => fund.fund_id ? histData[fund.fund_id] ?? [] : [],
    [fund.fund_id, histData]
  );

  const ranges = useMemo(() => availableRanges(fundPoints), [fundPoints]);

  // auto-select best available range
  useEffect(() => {
    if (ranges.length && !ranges.find(r => r.key === range)) {
      setRange(ranges[ranges.length - 1].key);
    }
  }, [ranges]);

  const mainSeries  = useMemo(() => computeSeries(fundPoints, range),          [fundPoints, range]);
  const avgSeries   = useMemo(
    () => computeAvgSeries(catFundIds, histData, range),
    [catFundIds, histData, range]
  );

  // Extra compare series
  const compareSeries = useMemo(() =>
    compare.map(id => ({
      id,
      name: histData[id]
        ? (Object.values(histData).length ? id : id)  // fallback; name resolved below
        : id,
      series: computeSeries(histData[id] ?? [], range),
    })),
    [compare, histData, range]
  );

  // Search across all funds (from raw_data via histData keys and a name map)
  // We pass allFunds as prop from parent
  const allFunds = fund._allFunds ?? [];
  const searchResults = useMemo(() => {
    if (!searchQ.trim()) return [];
    const q = searchQ.trim().toLowerCase();
    return allFunds
      .filter(f => f.fund_id && f.name.includes(searchQ.trim()) && f.fund_id !== fund.fund_id)
      .slice(0, 8);
  }, [searchQ, allFunds, fund.fund_id]);

  if (!mainSeries.length) {
    return (
      <div style={{ padding:'28px 20px', textAlign:'center', color:C.muted, fontSize:13 }}>
        <div style={{ fontSize:24, marginBottom:8 }}>📊</div>
        אין מספיק נתונים היסטוריים להצגת גרף
      </div>
    );
  }

  // SVG chart
  const W = 520, H = 180, PAD = { t:12, r:12, b:28, l:44 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  function seriesPath(series, allVals) {
    if (!series.length) return '';
    const [minV, maxV] = [Math.min(...allVals), Math.max(...allVals)];
    const range_ = maxV - minV || 1;
    return series.map((p, i) => {
      const x = PAD.l + (i / (series.length - 1)) * cW;
      const y = PAD.t + cH - ((p.cumRet - minV) / range_) * cH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  const allSeries = [mainSeries, avgSeries, ...compareSeries.map(c => c.series)].filter(s => s.length);
  const allVals   = allSeries.flatMap(s => s.map(p => p.cumRet));
  const [minV, maxV] = [Math.min(...allVals, 0), Math.max(...allVals, 0)];
  const valRange = maxV - minV || 1;

  function xForIdx(i, total) {
    return PAD.l + (i / Math.max(total - 1, 1)) * cW;
  }
  function yForVal(v) {
    return PAD.t + cH - ((v - minV) / valRange) * cH;
  }

  // Hover: find closest point in mainSeries
  function handleMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (W / rect.width);
    const relX   = mouseX - PAD.l;
    const idx    = Math.round((relX / cW) * (mainSeries.length - 1));
    setHoverIdx(Math.max(0, Math.min(idx, mainSeries.length - 1)));
  }

  const hoverPoint  = hoverIdx != null ? mainSeries[hoverIdx] : null;
  const hoverX      = hoverPoint ? xForIdx(hoverIdx, mainSeries.length) : null;
  const hoverY      = hoverPoint ? yForVal(hoverPoint.cumRet) : null;

  // Y-axis ticks
  const yTicks = [minV, (minV+maxV)/2, maxV].map(v => ({
    v: Math.round(v*10)/10,
    y: yForVal(v),
  }));

  const CHART_COLORS = ['#8B1A3A', '#2563EB', '#D97706', '#059669', '#7C3AED'];

  return (
    <div style={{ padding:'0 0 4px' }}>
      {/* Range tabs */}
      <div style={{ display:'flex', gap:4, padding:'10px 14px 8px', borderBottom:`1px solid ${C.border}` }}>
        <span style={{ fontSize:11, color:C.muted, alignSelf:'center', marginLeft:6 }}>טווח:</span>
        {ranges.map(r => (
          <button key={r.key} onClick={() => setRange(r.key)} style={{
            padding:'3px 10px', borderRadius:12, border:`1px solid ${range===r.key ? C.crimson : C.border}`,
            background: range===r.key ? C.crimson : C.white,
            color: range===r.key ? C.white : C.mid,
            fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
            transition:'all 0.12s',
          }}>{r.label}</button>
        ))}
      </div>

      {/* SVG chart */}
      <div style={{ padding:'8px 14px 4px', position:'relative' }}>
        <svg
          ref={svgRef}
          width="100%" viewBox={`0 0 ${W} ${H}`}
          style={{ display:'block', overflow:'visible', cursor:'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Zero line */}
          <line
            x1={PAD.l} y1={yForVal(0)} x2={PAD.l+cW} y2={yForVal(0)}
            stroke={C.border} strokeWidth="1" strokeDasharray="3 3"
          />

          {/* Y-axis ticks */}
          {yTicks.map(t => (
            <g key={t.v}>
              <line x1={PAD.l-3} y1={t.y} x2={PAD.l} y2={t.y} stroke={C.border} strokeWidth="1"/>
              <text x={PAD.l-5} y={t.y+4} textAnchor="end" fontSize="8.5"
                fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">
                {t.v > 0 ? '+' : ''}{t.v.toFixed(1)}%
              </text>
            </g>
          ))}

          {/* Category average (dashed gray) */}
          {avgSeries.length > 0 && (
            <path
              d={seriesPath(avgSeries, allVals)}
              fill="none" stroke={C.chartGray} strokeWidth="1.5"
              strokeDasharray="5 3"
            />
          )}

          {/* Compare series */}
          {compareSeries.map((c, ci) => c.series.length > 0 && (
            <path key={c.id}
              d={seriesPath(c.series, allVals)}
              fill="none" stroke={CHART_COLORS[ci+2] ?? '#888'} strokeWidth="1.5"
              opacity="0.7"
            />
          ))}

          {/* Main fund series */}
          <path
            d={seriesPath(mainSeries, allVals)}
            fill="none" stroke={C.crimson} strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          />

          {/* X-axis labels (every ~3 months) */}
          {mainSeries.filter((_, i) => {
            const step = mainSeries.length > 60 ? 12 : mainSeries.length > 24 ? 6 : 3;
            return i % step === 0 || i === mainSeries.length - 1;
          }).map((p, _, arr) => {
            const i = mainSeries.indexOf(p);
            const x = xForIdx(i, mainSeries.length);
            return (
              <text key={p.period} x={x} y={H-6}
                textAnchor="middle" fontSize="8" fill={C.muted}
                fontFamily="Assistant,Heebo,sans-serif">
                {fmtPeriod(p.period)}
              </text>
            );
          })}

          {/* Hover line */}
          {hoverPoint && (
            <>
              <line
                x1={hoverX} y1={PAD.t} x2={hoverX} y2={PAD.t+cH}
                stroke={C.crimson} strokeWidth="1" strokeDasharray="3 2" opacity="0.5"
              />
              <circle cx={hoverX} cy={hoverY} r="4" fill={C.crimson} stroke={C.white} strokeWidth="1.5"/>
            </>
          )}
        </svg>

        {/* Hover tooltip */}
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
            {hoverPoint.retMonth != null && (
              <div style={{ color:'rgba(255,255,255,0.55)', fontSize:10 }}>
                חודשי: {hoverPoint.retMonth > 0 ? '+' : ''}{hoverPoint.retMonth.toFixed(2)}%
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        padding:'4px 14px 8px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center',
      }}>
        <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10.5, color:C.dark }}>
          <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={C.crimson} strokeWidth="2.5"/></svg>
          {fund.name.slice(0, 22)}{fund.name.length > 22 ? '…' : ''}
        </span>
        {avgSeries.length > 0 && (
          <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10.5, color:C.muted }}>
            <svg width="18" height="8">
              <line x1="0" y1="4" x2="18" y2="4" stroke={C.chartGray} strokeWidth="1.5" strokeDasharray="4 2"/>
            </svg>
            ממוצע קטגוריה
          </span>
        )}
        {compareSeries.map((c, ci) => c.series.length > 0 && (
          <span key={c.id} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10.5, color:C.muted }}>
            <svg width="18" height="8">
              <line x1="0" y1="4" x2="18" y2="4" stroke={CHART_COLORS[ci+2] ?? '#888'} strokeWidth="1.5"/>
            </svg>
            {c.name.slice(0,20)}…
            <button onClick={() => setCompare(prev => prev.filter(x => x !== c.id))} style={{
              background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:11, padding:0,
            }}>×</button>
          </span>
        ))}
      </div>

      {/* Add to compare */}
      <div style={{ padding:'0 14px 10px', borderTop:`1px solid ${C.border}` }}>
        {!showSearch ? (
          <button onClick={() => setShowSearch(true)} style={{
            background:'none', border:`1px dashed ${C.border}`, borderRadius:8,
            color:C.muted, fontSize:11, padding:'4px 10px', cursor:'pointer',
            fontFamily:'inherit', marginTop:8, transition:'all 0.12s',
          }}>
            + השוואה למוצר נוסף
          </button>
        ) : (
          <div style={{ marginTop:8 }}>
            <input
              autoFocus
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="חפש קופה להשוואה..."
              style={{
                width:'100%', padding:'6px 10px', border:`1px solid ${C.border}`,
                borderRadius:7, fontSize:12, fontFamily:'inherit', direction:'rtl',
                outline:'none', background:C.bg,
              }}
            />
            {searchResults.length > 0 && (
              <div style={{
                background:C.white, border:`1px solid ${C.border}`, borderRadius:7,
                marginTop:3, maxHeight:140, overflowY:'auto',
                boxShadow:'0 6px 18px rgba(0,0,0,0.1)',
              }}>
                {searchResults.map(f => (
                  <div key={f.fund_id} onClick={() => {
                    if (!compare.includes(f.fund_id) && compare.length < 3) {
                      setCompare(prev => [...prev, f.fund_id]);
                    }
                    setSearchQ(''); setShowSearch(false);
                  }} style={{
                    padding:'6px 10px', fontSize:11.5, cursor:'pointer',
                    borderBottom:`1px solid ${C.border}`, direction:'rtl',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background=C.bg}
                  onMouseLeave={e => e.currentTarget.style.background=C.white}
                  >
                    {f.name}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => { setShowSearch(false); setSearchQ(''); }} style={{
              background:'none', border:'none', color:C.muted, fontSize:11,
              cursor:'pointer', fontFamily:'inherit', marginTop:4,
            }}>ביטול</button>
          </div>
        )}
      </div>
    </div>
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
            display:'flex', alignItems:'center', gap:6, padding:'8px 14px',
            border:`2px solid ${active ? C.crimson : C.border}`,
            borderRadius:8, background: active ? C.crimson : C.white,
            color: active ? C.white : C.dark, cursor:'pointer',
            fontFamily:'inherit', fontSize:13, fontWeight:600,
            transition:'all 0.15s',
            boxShadow: active ? '0 3px 12px rgba(139,26,58,0.2)' : 'none',
          }}>
            <span style={{ fontSize:15 }}>{icon}</span>{label}
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
      display:'flex', gap:5, flexWrap:'wrap', padding:'8px 14px',
      background:C.white, borderBottom:`1px solid ${C.border}`,
      position:'sticky', top:56, zIndex:90,
    }}>
      {catIds.map(id => {
        if (!getFundsForCategory(funds, id).length) return null;
        return (
          <button key={id} onClick={() => scrollTo(id)} style={{
            padding:'3px 10px', borderRadius:12,
            border:`1px solid ${C.border}`, background:C.white,
            color:C.mid, fontSize:11, fontWeight:600,
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

// ─── Fund Detail Panel ────────────────────────────────────────────────────────
function FundDetail({ fund, onClose, catAvg, catFundIds, histData, allFunds }) {
  if (!fund) return null;

  const [activeTab, setActiveTab] = useState('returns');  // 'returns' | 'history'

  const cats  = classifyFund(fund).map(id => CATEGORIES[id]?.label).filter(Boolean);
  const bonds = calcBonds(fund);

  // Inject allFunds for search inside chart
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

  // Returns comparison mini chart (bar chart with category avg dots)
  function ReturnBars() {
    const [hoveredAvg, setHoveredAvg] = useState(null);
    const periods = [
      { key:'ret_month', label:'חודש' },
      { key:'ret_ytd',   label:'YTD'  },
      { key:'ret_1y',    label:'שנה'  },
      { key:'ret_3y',    label:'3 שנ׳'},
      { key:'ret_5y',    label:'5 שנ׳'},
      { key:'ret_10y',   label:'10 שנ׳'},
    ].filter(p => fund[p.key] != null);

    if (!periods.length) return (
      <p style={{ textAlign:'center', color:C.muted, fontSize:11, margin:0 }}>אין נתוני תשואה</p>
    );

    const vals    = periods.map(p => fund[p.key]);
    const avgVals = catAvg ? periods.map(p => catAvg[p.key]).filter(v => v != null) : [];
    const maxAbs  = Math.max(...[...vals, ...avgVals].map(v => Math.abs(v)), 1);
    const W=280, H=110, PAD=8;
    const barW  = (W - PAD*2) / periods.length - 5;
    const zeroY = PAD + (H-16) * 0.5;

    return (
      <div style={{ position:'relative' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H+4}`} style={{ display:'block', overflow:'visible' }}>
          <line x1={PAD} y1={zeroY} x2={W-PAD} y2={zeroY} stroke={C.border} strokeWidth="1"/>
          {periods.map((p, i) => {
            const val  = fund[p.key];
            const barH = Math.max(2, Math.abs(val) / maxAbs * ((H-16)/2 - 4));
            const x    = PAD + i * ((W-PAD*2) / periods.length) + 2.5;
            const y    = val >= 0 ? zeroY - barH : zeroY;
            const color= val >= 0 ? C.pos : C.neg;
            const avg  = catAvg?.[p.key];
            const cx   = x + barW / 2;
            return (
              <g key={p.key}>
                <rect x={x} y={y} width={barW} height={barH} fill={color} rx="2" opacity="0.85"/>
                <text x={cx} y={val >= 0 ? y-3 : y+barH+10}
                  textAnchor="middle" fontSize="8.5" fill={color} fontWeight="700"
                  fontFamily="Assistant,Heebo,sans-serif">{pctFmt(val)}</text>
                {avg != null && (() => {
                  const ah = Math.abs(avg) / maxAbs * ((H-16)/2 - 4);
                  const ay = avg >= 0 ? zeroY - ah : zeroY + ah;
                  return (
                    <circle cx={cx} cy={ay} r="5" fill={C.crimson} opacity="0.85"
                      style={{ cursor:'pointer' }}
                      onMouseEnter={() => setHoveredAvg({ label:p.label, val:avg, cx, cy:ay })}
                      onMouseLeave={() => setHoveredAvg(null)}/>
                  );
                })()}
                <text x={cx} y={H+2} textAnchor="middle" fontSize="8.5" fill={C.muted}
                  fontFamily="Assistant,Heebo,sans-serif">{p.label}</text>
              </g>
            );
          })}
        </svg>
        {hoveredAvg && (
          <div style={{
            position:'absolute',
            left:`calc(${(hoveredAvg.cx/W)*100}% - 55px)`,
            top:`calc(${(hoveredAvg.cy/(H+4))*100}% - 42px)`,
            background:C.dark, color:C.white, borderRadius:7,
            padding:'5px 10px', fontSize:11, fontWeight:600,
            whiteSpace:'nowrap', boxShadow:'0 4px 14px rgba(0,0,0,0.35)',
            pointerEvents:'none', zIndex:500, direction:'rtl',
          }}>
            ממוצע ({hoveredAvg.label}): {pctFmt(hoveredAvg.val)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      width:340, height:'100%', background:C.white,
      boxShadow:'-4px 0 28px rgba(0,0,0,0.12)',
      overflowY:'auto', direction:'rtl',
      display:'flex', flexDirection:'column',
    }}>
      {/* Header */}
      <div style={{ background:C.crimson, padding:'13px 13px 11px', color:C.white, flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <h2 style={{ margin:0, fontSize:12, fontWeight:700, lineHeight:1.5, flex:1, paddingLeft:8 }}>
            {fund.name}
          </h2>
          <button onClick={onClose} style={{
            background:'rgba(255,255,255,0.2)', border:'none', color:C.white,
            width:24, height:24, borderRadius:'50%', cursor:'pointer',
            fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>×</button>
        </div>
        <div style={{ marginTop:6, display:'flex', gap:4, flexWrap:'wrap' }}>
          {cats.slice(0,3).map(c => (
            <span key={c} style={{ background:'rgba(255,255,255,0.2)', borderRadius:8, padding:'1px 7px', fontSize:9, fontWeight:600 }}>{c}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display:'flex', borderBottom:`1px solid ${C.border}`, flexShrink:0,
        background:C.white,
      }}>
        {[
          { id:'returns', label:'תשואות וחשיפות' },
          { id:'history', label:'📈 גרף היסטורי' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex:1, padding:'9px 0', border:'none', background:'none',
            color: activeTab===tab.id ? C.crimson : C.muted,
            fontFamily:'inherit', fontSize:12, fontWeight:700, cursor:'pointer',
            borderBottom: activeTab===tab.id ? `2px solid ${C.crimson}` : '2px solid transparent',
            transition:'all 0.12s',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {activeTab === 'returns' && (
          <div style={{ padding:'11px 13px' }}>
            {/* Profit index */}
            {fund.profit_index != null && (
              <div style={{
                background:'linear-gradient(135deg,#FFF0F3,#FFE4EA)', border:`1px solid #F8C8D0`,
                borderRadius:9, padding:'8px 12px', marginBottom:11,
                display:'flex', alignItems:'center', justifyContent:'space-between',
              }}>
                <div>
                  <div style={{ fontSize:11, color:C.crimson, fontWeight:700 }}>מדד פרופיט</div>
                  <div style={{ fontSize:9.5, color:C.muted }}>שירות ואיכות ניהול</div>
                </div>
                <span style={{ fontSize:26, fontWeight:900, color:C.crimson }}>
                  {fund.profit_index.toFixed(1)}
                </span>
              </div>
            )}

            {/* Return bars */}
            <div style={{ marginBottom:11 }}>
              <div style={{ fontSize:11.5, fontWeight:700, color:C.dark, marginBottom:5 }}>
                תשואות
                {catAvg && <span style={{ fontSize:9.5, color:C.muted, fontWeight:400, marginRight:5 }}>| עיגול = ממוצע קטגוריה</span>}
              </div>
              <div style={{ background:C.bg, borderRadius:8, padding:'9px 7px' }}>
                <ReturnBars/>
              </div>
            </div>

            {/* Exposures */}
            <div style={{ marginBottom:11 }}>
              <div style={{ fontSize:11.5, fontWeight:700, color:C.dark, marginBottom:7 }}>הרכב החשיפות</div>
              <Bar label="מניות"           val={fund.stocks}   color="#2563EB"/>
              <Bar label={'אג"ח (מחושב)'}  val={bonds}         color="#D97706"/>
              <Bar label={'חו"ל'}          val={fund.foreign}  color="#7C3AED"/>
              <Bar label={'מט"ח'}          val={fund.forex}    color="#059669"/>
              <Bar label="לא סחיר"         val={fund.illiquid} color="#9CA3AF"/>
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

            {/* AI placeholder */}
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
          <HistoricalChart
            fund={fundWithAll}
            catFundIds={catFundIds}
            histData={histData}
            onClose={() => setActiveTab('returns')}
          />
        )}
      </div>
    </div>
  );
}

// ─── Fund Table ───────────────────────────────────────────────────────────────
function sortByKey(funds, key, dir) {
  return [...funds].sort((a, b) => {
    const av = a[key] ?? -Infinity, bv = b[key] ?? -Infinity;
    return dir === 'desc' ? bv - av : av - bv;
  });
}

function FundTable({ funds, catId, onSelect, selFund }) {
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
      <th onClick={() => onSortClick(col.key)} style={{
        ...TH, textAlign:'center', cursor:'pointer', userSelect:'none',
        color: active ? '#FFD6DE' : 'rgba(255,255,255,0.8)',
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
      }}>
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
        <th style={{ ...TH, width:24, color:'rgba(255,255,255,0.4)' }}>#</th>
        <th style={{ ...TH, textAlign:'right', color:'rgba(255,255,255,0.8)', minWidth:130, maxWidth:180 }}>שם המוצר</th>
        {SORT_COLS.map(c => <SortTh key={c.key} col={c}/>)}
      </tr>
    </thead>
  );

  function Row({ fund, rank }) {
    const isAvg = !!fund.isAverage;
    const isSel = !isAvg && selFund?.name === fund.name;
    return (
      <tr onClick={() => !isAvg && onSelect(fund)} style={{
        background: isAvg ? C.avgBg : isSel ? '#FFF0F3' : C.white,
        cursor: isAvg ? 'default' : 'pointer',
        borderBottom:`1px solid #F0EBE6`,
      }}
      onMouseEnter={e => { if (!isAvg && !isSel) e.currentTarget.style.background='#FDF8F6'; }}
      onMouseLeave={e => { if (!isAvg && !isSel) e.currentTarget.style.background=C.white; }}
      >
        <td style={{ ...TD, color:C.muted, textAlign:'center', fontSize:10, width:24 }}>
          {isAvg ? '⌀' : rank}
        </td>
        <td style={{ ...TD, color:isSel?C.crimson:isAvg?C.dark:C.darkMid, fontWeight:isAvg?700:500, maxWidth:180 }}>
          <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={fund.name}>
            {fund.name}
          </div>
        </td>
        {SORT_COLS.map(col => (
          <td key={col.key} style={{
            ...TD, textAlign:'center',
            color: numColor(fund[col.key]),
            fontWeight:600, fontVariantNumeric:'tabular-nums',
            background: sortKey===col.key ? 'rgba(139,26,58,0.03)' : 'transparent',
          }}>
            {pctFmt(fund[col.key])}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div id={`sec-${catId}`} style={{ marginBottom:22, scrollMarginTop:104 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 11px', background:C.darkMid, borderRadius:'8px 8px 0 0' }}>
        <span style={{ fontSize:12.5, fontWeight:800, color:C.white }}>{cat?.label}</span>
        <span style={{ fontSize:10.5, color:'rgba(255,255,255,0.45)' }}>{cat?.desc}</span>
        <span style={{ marginRight:'auto', fontSize:10.5, color:'rgba(255,255,255,0.3)' }}>{funds.length} מוצרים</span>
      </div>
      <div style={{ overflowX:'auto', border:`1px solid ${C.border}`, borderTop:'none', borderRadius:'0 0 8px 8px' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
          {thead}
          <tbody>
            {top12.map((f, i) => <Row key={f.name} fund={f} rank={i+1}/>)}
            <Row fund={avg} rank={null}/>
            {showAll && rest.map((f, i) => <Row key={f.name} fund={f} rank={13+i}/>)}
          </tbody>
        </table>
      </div>
      {rest.length > 0 && (
        <button onClick={() => setShowAll(!showAll)} style={{
          background:'transparent', border:'none', color:C.crimson,
          fontSize:11, cursor:'pointer', fontFamily:'inherit', fontWeight:600,
          display:'flex', alignItems:'center', gap:4, padding:'4px 2px',
        }}>
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
  const [histData, setHistData] = useState(null);
  const profitIndex = useProfitIndex();

  // Load history.json once on mount
  useEffect(() => {
    loadHistory().then(data => setHistData(data));
  }, []);

  const rawFunds = useMemo(() => getAllFunds(product), [product]);
  const funds    = useMemo(() =>
    rawFunds.map(f => ({ ...f, profit_index: profitIndex[f.name] ?? f.profit_index ?? null })),
    [rawFunds, profitIndex]
  );
  // allFunds across ALL products for the compare search
  const allFunds = useMemo(() => {
    return Object.keys(PRODUCT_LABELS).flatMap(p => getAllFunds(p));
  }, []);

  const order  = product === 'גמל' ? GEMEL_ORDER : BASE_ORDER;
  const catIds = useMemo(
    () => order.filter(id => getFundsForCategory(funds, id).length > 0),
    [funds, order]
  );

  const selCatId = useMemo(() => {
    if (!selFund) return null;
    const fc = classifyFund(selFund);
    return order.find(id => fc.includes(id) && getFundsForCategory(funds, id).length > 0) ?? null;
  }, [selFund, funds, order]);

  const catAvg = useMemo(() =>
    selCatId ? calcAverages(getFundsForCategory(funds, selCatId)) : null,
    [selCatId, funds]
  );

  // Fund IDs in same category (for avg chart line)
  const catFundIds = useMemo(() => {
    if (!selCatId) return [];
    return getFundsForCategory(funds, selCatId)
      .map(f => f.fund_id)
      .filter(Boolean);
  }, [selCatId, funds]);

  const panelOpen = selFund !== null;

  return (
    <div style={{ minHeight:'100vh', background:C.bg, fontFamily:"'Assistant','Heebo',Arial,sans-serif", direction:'rtl' }}>

      {/* Nav */}
      <nav style={{
        background:C.dark, padding:'0 20px', display:'flex', alignItems:'center',
        justifyContent:'space-between', height:56, position:'sticky', top:0, zIndex:100,
        boxShadow:'0 2px 10px rgba(0,0,0,0.3)',
      }}>
        <img src="/logo_white.png" alt="Profit Financial Group"
          style={{ height:30, objectFit:'contain', display:'block' }}/>
        <div style={{ color:C.white, fontSize:18, fontWeight:800, letterSpacing:'0.01em' }}>
          ProGemel<span style={{ color:C.crimsonLt }}>Net</span>
        </div>
      </nav>

      {/* Split layout */}
      <div style={{ display:'flex', minHeight:'calc(100vh - 56px)' }}>

        {/* Main content */}
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'12px 16px 10px', background:C.white, borderBottom:`1px solid ${C.border}` }}>
            <ProductSelector selected={product} onChange={k => { setProduct(k); setSelFund(null); }}/>
          </div>
          <CategoryNav catIds={catIds} funds={funds}/>
          <div style={{ padding:'16px 16px 48px' }}>
            {catIds.map(id => (
              <FundTable key={`${product}-${id}`} catId={id}
                funds={getFundsForCategory(funds, id)}
                onSelect={setSelFund} selFund={selFund}/>
            ))}
          </div>
          <footer style={{
            background:C.dark, color:'rgba(255,255,255,0.3)',
            textAlign:'center', padding:'13px', fontSize:11,
          }}>
            © {new Date().getFullYear()} Profit Financial Group · הנתונים לצורך מידע בלבד ואינם מהווים ייעוץ השקעות
          </footer>
        </div>

        {/* Detail panel */}
        <div style={{
          width: panelOpen ? 340 : 0, flexShrink:0,
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
