import { useState, useMemo, useEffect, useRef } from "react";
import { CATEGORIES, getFundsForCategory, classifyFund } from "./utils/classifier";
import { PRODUCT_LABELS, getAllFunds, calcAverages, getSheets, getFundsBySheet, loadData, getHistory } from "./utils/dataLoader";
import { computeSeries, computeAvgSeries, availableRanges, fmtPeriod } from "./utils/historyLoader";

const C = {
  crimson:'#8B1A3A', crimsonLt:'#B02248', crimsonPale:'#FFF0F3',
  dark:'#1A1A1A', darkMid:'#2C2C2C', mid:'#3D3D3D', muted:'#6B6B6B',
  border:'#E5E0DC', bg:'#F8F5F2', white:'#FFFFFF',
  pos:'#16A34A', neg:'#DC2626', avgBg:'#F5F0EA',
};

const COMP_COLORS=['#E63946','#2563EB','#16A34A','#D97706','#7C3AED','#0891B2','#DB2777','#65A30D','#EA580C','#6366F1'];

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
const calcBonds = fund => Math.max(0, Math.round((100-(fund.stocks??0)-(fund.illiquid??0))*10)/10);

// שם חודש גלובלי — מתמלא פעם אחת כשהנתונים נטענים
let _latestMonthName = 'חודש';
function getLatestMonthName() { return _latestMonthName; }

const SORT_COLS = [
  { key:'ret_month', label:getLatestMonthName(), tip:'תשואה בחודש האחרון' },
  { key:'ret_ytd',   label:'מתחילת שנה', tip:'תשואה מצטברת מתחילת השנה' },
  { key:'ret_1y',    label:'שנה',         tip:'תשואה מצטברת 12 חודשים' },
  { key:'ret_3y',    label:'3 שנים',      tip:'תשואה מצטברת 36 חודשים' },
  { key:'ret_5y',    label:'5 שנים',      tip:'תשואה מצטברת 60 חודשים' },
  { key:'ret_10y',   label:'10 שנים',     tip:'תשואה מצטברת 120 חודשים' },
];

const TH = { padding:'5px 6px', fontSize:10, fontWeight:700, whiteSpace:'nowrap' };
const TD = { padding:'4px 6px', fontSize:11 };

// ─── Profit Index ─────────────────────────────────────────────────────────────
const PROFIT_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTBaP0TxMSmULSqhQb3ORgKHEwb8MB2jNuSOFn-3rsUofFZNTsj2RuDUkTihBGTdPjvSaw1e5TLfUjm/pub?output=csv";
function useProfitIndex() {
  const [map, setMap] = useState({});
  useEffect(() => {
    fetch(PROFIT_CSV).then(r=>r.text()).then(csv=>{
      const lines=csv.trim().split('\n'); if(lines.length<2) return;
      const sep=lines[0].includes('\t')?'\t':',';
      const names=lines[0].split(sep).map(c=>c.replace(/^"|"$/g,'').trim());
      const scores=lines[1].split(sep).map(c=>c.replace(/^"|"$/g,'').trim());
      const m={};
      for(let i=1;i<names.length;i++){const v=parseFloat(scores[i]);if(names[i]&&!isNaN(v))m[names[i]]=v;}
      setMap(m);
    }).catch(()=>{});
  },[]);
  return map;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function Tooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:'relative', display:'inline-flex', alignItems:'center' }}>
      <span onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)} style={{ width:12,height:12,borderRadius:'50%',background:'rgba(255,255,255,0.18)',color:'rgba(255,255,255,0.7)',fontSize:7.5,fontWeight:700,display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:'help',marginRight:2,border:'1px solid rgba(255,255,255,0.3)' }}>?</span>
      {show && <div style={{ position:'absolute',bottom:'calc(100% + 6px)',right:0,width:200,background:C.dark,color:C.white,borderRadius:7,padding:'7px 11px',fontSize:11,lineHeight:1.6,zIndex:3000,boxShadow:'0 8px 24px rgba(0,0,0,0.4)',direction:'rtl',fontWeight:400,pointerEvents:'none' }}>{text}</div>}
    </span>
  );
}

// ─── Chart Modal ──────────────────────────────────────────────────────────────
function ChartModal({ fund, mainSeries, avgSeries, compareSeries, allFunds, catLabel, ranges, range, setRange, minV, maxV, valRange, onClose }) {
  const MW=780, MH=340, MPAD={t:16,r:14,b:32,l:52};
  const mcW=MW-MPAD.l-MPAD.r, mcH=MH-MPAD.t-MPAD.b;
  const mxFor = (i,tot) => MPAD.l+(i/Math.max(tot-1,1))*mcW;
  const myFor = v => MPAD.t+mcH-((v-minV)/valRange)*mcH;
  const mPath = series => series.map((p,i) => `${i===0?'M':'L'}${mxFor(i,series.length).toFixed(1)},${myFor(p.cumRet).toFixed(1)}`).join(' ');
  const myTicks = [0,0.25,0.5,0.75,1].map(f=>({ v:Math.round((minV+(maxV-minV)*f)*10)/10, y:myFor(minV+(maxV-minV)*f) }));

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:14,width:'min(94vw, 860px)',boxShadow:'0 24px 64px rgba(0,0,0,0.4)',overflow:'hidden',direction:'rtl' }}>
        <div style={{ background:C.crimson,padding:'11px 16px',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <div style={{ display:'flex',gap:8,alignItems:'center' }}>
            <span style={{ color:C.white,fontSize:13,fontWeight:700 }}>{fund.name}</span>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.2)',border:'none',color:C.white,width:28,height:28,borderRadius:'50%',cursor:'pointer',fontSize:18,display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
        </div>
        <div style={{ display:'flex',gap:4,padding:'10px 16px 8px',borderBottom:`1px solid ${C.border}`,alignItems:'center' }}>
          <span style={{ fontSize:11,color:C.muted,marginLeft:6 }}>טווח:</span>
          {ranges.map(r=>(
            <button key={r.key} onClick={()=>setRange(r.key)} style={{ padding:'4px 14px',borderRadius:12,border:`1px solid ${range===r.key?C.crimson:C.border}`,background:range===r.key?C.crimson:C.white,color:range===r.key?C.white:C.mid,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>{r.label}</button>
          ))}
        </div>
        <div style={{ padding:'14px 18px 10px' }}>
          <svg width="100%" viewBox={`0 0 ${MW} ${MH}`} style={{ display:'block',overflow:'visible' }}>
            <line x1={MPAD.l} y1={myFor(0)} x2={MPAD.l+mcW} y2={myFor(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3 3"/>
            {myTicks.map(t=>(
              <g key={t.v}>
                <line x1={MPAD.l-4} y1={t.y} x2={MPAD.l} y2={t.y} stroke={C.border} strokeWidth="1"/>
                <text x={MPAD.l-6} y={t.y+4} textAnchor="end" fontSize="10" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{t.v>0?'+':''}{t.v.toFixed(1)}%</text>
              </g>
            ))}
            {avgSeries.length>0 && <path d={mPath(avgSeries)} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeDasharray="8 4" opacity="0.9"/>}
            {(compareSeries||[]).map((c,ci)=>c.series.length>0&&<path key={c.id} d={mPath(c.series)} fill="none" stroke={['#D97706','#059669','#7C3AED'][ci]??'#888'} strokeWidth="2" opacity="0.8"/>)}
            <path d={mPath(mainSeries)} fill="none" stroke={C.crimson} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            {mainSeries.filter((_,i)=>{ const step=mainSeries.length>60?12:mainSeries.length>24?6:3; return i%step===0||i===mainSeries.length-1; }).map(p=>{
              const i=mainSeries.indexOf(p);
              return <text key={p.period} x={mxFor(i,mainSeries.length)} y={MH-4} textAnchor="middle" fontSize="9.5" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{fmtPeriod(p.period)}</text>;
            })}
          </svg>
          <div style={{ display:'flex',gap:16,padding:'6px 0 4px',alignItems:'center' }}>
            <span style={{ display:'flex',alignItems:'center',gap:5,fontSize:12,color:C.dark }}>
              <svg width="22" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke={C.crimson} strokeWidth="3"/></svg>
              {fund.name}
            </span>
            {avgSeries.length>0 && (
              <span style={{ display:'flex',alignItems:'center',gap:5,fontSize:12,color:'#2563EB',fontWeight:600 }}>
                <svg width="22" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke="#2563EB" strokeWidth="2.5" strokeDasharray="6 3"/></svg>
                {catLabel ? `ממוצע מסלולי '${catLabel}'` : 'ממוצע קטגוריה'}
              </span>
            )}
            {(compareSeries||[]).map((c,ci)=>{
              const cf=allFunds?.find(f=>f.fund_id===c.id);
              const stroke=['#D97706','#059669','#7C3AED'][ci]??'#888';
              return c.series.length>0&&(
                <span key={c.id} style={{ display:'flex',alignItems:'center',gap:5,fontSize:12,color:stroke,fontWeight:600 }}>
                  <svg width="22" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke={stroke} strokeWidth="2"/></svg>
                  {cf?.name||c.id}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Historical Chart (panel) ─────────────────────────────────────────────────
function HistoricalChart({ fund, catFundIds, catLabel, histData, externalCompare }) {
  const [range, setRange]         = useState('3y');
  const [customFrom, setCustomFrom] = useState({ y:'', m:'' });
  const [customTo, setCustomTo]     = useState({ y:'', m:'' });
  const [showCustom, setShowCustom] = useState(false);
  const [showModal, setShowModal]   = useState(false);

  const YEARS = Array.from({length: new Date().getFullYear()-2009}, (_,i)=> String(2010+i));
  const MONTHS_HE = ['01-ינואר','02-פברואר','03-מרץ','04-אפריל','05-מאי','06-יוני','07-יולי','08-אוגוסט','09-ספטמבר','10-אוקטובר','11-נובמבר','12-דצמבר'];

  // YYYYMM string מהבחירה
  const fromPeriod = useMemo(()=> customFrom.y && customFrom.m ? customFrom.y + customFrom.m.slice(0,2) : null, [customFrom]);
  const toPeriod   = useMemo(()=> customTo.y   && customTo.m   ? customTo.y   + customTo.m.slice(0,2)   : null, [customTo]);
  const rangeError = useMemo(()=> fromPeriod && toPeriod && fromPeriod >= toPeriod ? 'תאריך ה"מ" חייב להיות לפני תאריך ה"עד"' : null, [fromPeriod, toPeriod]);
  const [compare, setCompare]   = useState([]);

  // מיזג עם קרנות שנשלחו מבחוץ
  useEffect(()=>{
    if(!externalCompare?.length) return;
    setCompare(prev=>{
      const toAdd = externalCompare.filter(id=>!prev.includes(id)&&id!==fund.fund_id);
      return toAdd.length ? [...prev,...toAdd].slice(0,3) : prev;
    });
  },[externalCompare]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ]   = useState('');
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const fundPoints = useMemo(() => fund.fund_id ? histData[fund.fund_id]??[] : [], [fund.fund_id, histData]);
  const ranges = useMemo(() => availableRanges(fundPoints), [fundPoints]);
  useEffect(() => { if(ranges.length && range!=='custom' && !ranges.find(r=>r.key===range)) setRange(ranges[ranges.length-1].key); }, [ranges]);

  const effectiveRange = useMemo(()=> (range==='custom'&&fromPeriod&&!rangeError) ? 'custom' : (range==='custom' ? '3y' : range), [range, fromPeriod, rangeError]);
  const mainSeries = useMemo(() => computeSeries(fundPoints, effectiveRange, fromPeriod, toPeriod), [fundPoints, effectiveRange, fromPeriod, toPeriod]);
  const avgSeries  = useMemo(() => computeAvgSeries(catFundIds, histData, effectiveRange), [catFundIds, histData, effectiveRange]);
  const compareSeries = useMemo(() => compare.map(id=>({ id, series:computeSeries(histData[id]??[], effectiveRange, fromPeriod, toPeriod) })), [compare, histData, effectiveRange, fromPeriod, toPeriod]);

  const allFunds = fund._allFunds ?? [];

  // בורר מוצר לחיפוש השוואה (ברירת מחדל = מוצר הקרן הנוכחית)
  const defaultProduct = useMemo(()=>{
    if(!fund.fund_id) return Object.keys(PRODUCT_LABELS)[0];
    const src = fund.fund_id.split('_')[0];
    // מצא את מפתח המוצר לפי ה-source
    const entry = Object.entries(PRODUCT_LABELS).find(([k])=>getAllFunds(k).some(f=>f.fund_id===fund.fund_id));
    return entry?.[0] ?? Object.keys(PRODUCT_LABELS)[0];
  },[fund.fund_id]);
  const [searchProduct, setSearchProduct] = useState(()=>defaultProduct);
  useEffect(()=>{ setSearchProduct(defaultProduct); setSearchQ(''); },[defaultProduct]);

  const productSearchFunds = useMemo(()=>{
    const funds = getAllFunds(searchProduct);
    const seen = new Set();
    return funds.filter(f=>{ if(!f.name||seen.has(f.name)) return false; seen.add(f.name); return true; });
  },[searchProduct, allFunds]);

  const [showFDDrop, setShowFDDrop] = useState(false);
  const fdSearchRef = useRef(null);

  // סגור dropdown בלחיצה מחוץ
  useEffect(()=>{
    const handler = e => { if(fdSearchRef.current && !fdSearchRef.current.contains(e.target)) setShowFDDrop(false); };
    document.addEventListener('mousedown', handler);
    return ()=>document.removeEventListener('mousedown', handler);
  },[]);

  const searchResults = useMemo(() => {
    const pool = productSearchFunds.filter(f=>f.fund_id && f.fund_id!==fund.fund_id);
    if(!searchQ.trim()) return pool.slice(0,10);
    const words = searchQ.trim().split(/\s+/);
    return pool.filter(f=>words.every(w=>f.name.includes(w))).slice(0,10);
  }, [searchQ, productSearchFunds, fund.fund_id]);

  if(!mainSeries.length) return (
    <div style={{ padding:'28px 20px',textAlign:'center',color:C.muted,fontSize:13 }}>
      <div style={{ fontSize:24,marginBottom:8 }}>📊</div>אין מספיק נתונים היסטוריים להצגת גרף
    </div>
  );

  const W=470, H=170, PAD={t:12,r:10,b:28,l:44};
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const allSeries=[mainSeries,avgSeries,...compareSeries.map(c=>c.series)].filter(s=>s.length);
  const allVals=allSeries.flatMap(s=>s.map(p=>p.cumRet));
  const minV=Math.min(...allVals,0), maxV=Math.max(...allVals,0);
  const valRange=maxV-minV||1;

  const xFor = (i,tot) => PAD.l+(i/Math.max(tot-1,1))*cW;
  const yFor = v => PAD.t+cH-((v-minV)/valRange)*cH;
  const sPath = series => series.map((p,i)=>`${i===0?'M':'L'}${xFor(i,series.length).toFixed(1)},${yFor(p.cumRet).toFixed(1)}`).join(' ');

  function handleMM(e) {
    const svg=svgRef.current; if(!svg) return;
    const rect=svg.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width)-PAD.l;
    setHoverIdx(Math.max(0,Math.min(Math.round((mx/cW)*(mainSeries.length-1)),mainSeries.length-1)));
  }

  const hp=hoverIdx!=null?mainSeries[hoverIdx]:null;
  const hx=hp?xFor(hoverIdx,mainSeries.length):null;
  const hy=hp?yFor(hp.cumRet):null;
  const yTicks=[minV,(minV+maxV)/2,maxV].map(v=>({ v:Math.round(v*10)/10, y:yFor(v) }));
  const CC=['#8B1A3A','#2563EB','#D97706','#059669','#7C3AED'];

  // Lock body scroll and hide sticky elements when modal open
  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = 'hidden';
      // Temporarily remove sticky positioning from nav elements
      document.querySelectorAll('[data-sticky]').forEach(el => {
        el.style.position = 'relative';
        el.style.zIndex = '0';
      });
    } else {
      document.body.style.overflow = '';
      document.querySelectorAll('[data-sticky]').forEach(el => {
        el.style.position = '';
        el.style.zIndex = '';
      });
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showModal]);

  return (
    <>
      {showModal && <ChartModal fund={fund} mainSeries={mainSeries} avgSeries={avgSeries} compareSeries={compareSeries} allFunds={allFunds} catLabel={catLabel} ranges={ranges} range={range} setRange={setRange} minV={minV} maxV={maxV} valRange={valRange} onClose={()=>setShowModal(false)}/>}
      <div style={{ padding:'0 0 4px' }}>
        <div style={{ display:'flex',gap:4,padding:'10px 14px 8px',borderBottom:`1px solid ${C.border}`,alignItems:'center' }}>
          <span style={{ fontSize:11,color:C.muted,marginLeft:6 }}>טווח:</span>
          {ranges.map(r=>(
            <button key={r.key} onClick={()=>{ setRange(r.key); setShowCustom(false); }} style={{ padding:'3px 10px',borderRadius:12,border:`1px solid ${range===r.key&&!showCustom?C.crimson:C.border}`,background:range===r.key&&!showCustom?C.crimson:C.white,color:range===r.key&&!showCustom?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>{r.label}</button>
          ))}
          <button onClick={()=>{ setShowCustom(s=>!s); if(!showCustom) setRange('custom'); }} style={{ padding:'3px 10px',borderRadius:12,border:`1px solid ${showCustom?C.crimson:C.border}`,background:showCustom?C.crimson:C.white,color:showCustom?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>טווח אישי</button>
          <div style={{ marginRight:'auto',display:'flex',gap:5 }}>
            <button onClick={()=>setShowModal(true)} style={{ background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 9px',fontSize:11,color:C.muted,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4 }}>🔍 הגדל</button>
            <button onClick={()=>{ setShowModal(true); setTimeout(()=>window.print(),400); }} style={{ background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 9px',fontSize:11,color:C.muted,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4 }}>🖨️ הדפס</button>
          </div>
        </div>
        {showCustom&&rangeError&&(
          <div style={{ display:'flex',alignItems:'center',gap:8,padding:'6px 14px',background:'#FEF2F2',borderBottom:`1px solid #FECACA`,direction:'rtl' }}>
            <span style={{ color:'#DC2626',fontSize:11,fontWeight:600 }}>⚠️ {rangeError}</span>
            <button onClick={()=>setCustomTo({y:'',m:''})} style={{ background:'none',border:`1px solid #DC2626`,borderRadius:6,color:'#DC2626',fontSize:10.5,padding:'1px 7px',cursor:'pointer',fontFamily:'inherit' }}>תקן</button>
          </div>
        )}
        {showCustom&&(
          <div style={{ display:'flex',gap:6,alignItems:'center',padding:'6px 14px',borderBottom:`1px solid ${C.border}`,direction:'rtl',flexWrap:'wrap',background:'#FAFAFA' }}>
            <span style={{ fontSize:11,color:C.muted,fontWeight:600 }}>מ:</span>
            <select value={customFrom.y} onChange={e=>{ setCustomFrom(p=>({...p,y:e.target.value})); }}
              style={{ padding:'3px 6px',border:`1px solid ${C.border}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none',background:C.white }}>
              <option value="">שנה</option>
              {YEARS.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <select value={customFrom.m} onChange={e=>setCustomFrom(p=>({...p,m:e.target.value}))}
              style={{ padding:'3px 6px',border:`1px solid ${C.border}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none',background:C.white }}>
              <option value="">חודש</option>
              {MONTHS_HE.map(m=><option key={m} value={m}>{m.slice(3)}</option>)}
            </select>
            <span style={{ fontSize:11,color:C.muted,fontWeight:600 }}>עד:</span>
            <select value={customTo.y} onChange={e=>setCustomTo(p=>({...p,y:e.target.value}))}
              style={{ padding:'3px 6px',border:`1px solid ${C.border}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none',background:C.white }}>
              <option value="">שנה</option>
              {YEARS.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <select value={customTo.m} onChange={e=>setCustomTo(p=>({...p,m:e.target.value}))}
              style={{ padding:'3px 6px',border:`1px solid ${C.border}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none',background:C.white }}>
              <option value="">חודש</option>
              {MONTHS_HE.map(m=><option key={m} value={m}>{m.slice(3)}</option>)}
            </select>
            <button onClick={()=>{ setCustomFrom({y:'',m:''}); setCustomTo({y:'',m:''}); setRange('3y'); setShowCustom(false); }}
              style={{ background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontFamily:'inherit' }}>איפוס</button>
          </div>
        )}
        <div style={{ padding:'8px 14px 4px',position:'relative' }}>
          <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block',overflow:'visible',cursor:'crosshair' }} onMouseMove={handleMM} onMouseLeave={()=>setHoverIdx(null)}>
            <line x1={PAD.l} y1={yFor(0)} x2={PAD.l+cW} y2={yFor(0)} stroke={C.border} strokeWidth="1" strokeDasharray="3 3"/>
            {yTicks.map(t=>(
              <g key={t.v}>
                <line x1={PAD.l-3} y1={t.y} x2={PAD.l} y2={t.y} stroke={C.border} strokeWidth="1"/>
                <text x={PAD.l-5} y={t.y+4} textAnchor="end" fontSize="8.5" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{t.v>0?'+':''}{t.v.toFixed(1)}%</text>
              </g>
            ))}
            {avgSeries.length>0 && <path d={sPath(avgSeries)} fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="6 3" opacity="0.85"/>}
            {compareSeries.map((c,ci)=>c.series.length>0&&<path key={c.id} d={sPath(c.series)} fill="none" stroke={CC[ci+2]??'#888'} strokeWidth="1.5" opacity="0.7"/>)}
            <path d={sPath(mainSeries)} fill="none" stroke={C.crimson} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            {mainSeries.filter((_,i)=>{ const s=mainSeries.length>60?12:mainSeries.length>24?6:3; return i%s===0||i===mainSeries.length-1; }).map(p=>{
              const i=mainSeries.indexOf(p);
              return <text key={p.period} x={xFor(i,mainSeries.length)} y={H-6} textAnchor="middle" fontSize="8" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{fmtPeriod(p.period)}</text>;
            })}
            {hp&&<><line x1={hx} y1={PAD.t} x2={hx} y2={PAD.t+cH} stroke={C.crimson} strokeWidth="1" strokeDasharray="3 2" opacity="0.5"/><circle cx={hx} cy={hy} r="4" fill={C.crimson} stroke={C.white} strokeWidth="1.5"/></>}
          </svg>
          {hp&&(
            <div style={{ position:'absolute',top:Math.max(8,(hy/H)*100-20)+'%',right:hx/W>0.6?(100-hx/W*100+2)+'%':'auto',left:hx/W<=0.6?(hx/W*100+1)+'%':'auto',background:C.dark,color:C.white,borderRadius:7,padding:'5px 9px',fontSize:11,pointerEvents:'none',zIndex:100,boxShadow:'0 4px 14px rgba(0,0,0,0.3)',direction:'rtl',lineHeight:1.7 }}>
              <div style={{ fontWeight:700 }}>{hp.label}</div>
              <div style={{ color:hp.cumRet>=0?'#6EE7A0':'#FCA5A5' }}>מצטבר: {hp.cumRet>0?'+':''}{hp.cumRet.toFixed(2)}%</div>
            </div>
          )}
        </div>

        <div style={{ padding:'4px 14px 8px',display:'flex',gap:10,flexWrap:'wrap',alignItems:'center' }}>
          <span style={{ display:'flex',alignItems:'center',gap:4,fontSize:10.5,color:C.dark }}>
            <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={C.crimson} strokeWidth="2.5"/></svg>
            {fund.name}
          </span>
          {avgSeries.length>0&&(
            <span style={{ display:'flex',alignItems:'center',gap:4,fontSize:10.5,color:'#2563EB',fontWeight:600 }}>
              <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#2563EB" strokeWidth="2" strokeDasharray="6 3"/></svg>
              {catLabel ? `ממוצע מסלולי '${catLabel}'` : 'ממוצע קטגוריה'}
            </span>
          )}
          {compareSeries.map((c,ci)=>{
            const cf=allFunds.find(f=>f.fund_id===c.id);
            const stroke=CC[ci+2]??'#888';
            return c.series.length>0&&(
              <span key={c.id} style={{ display:'flex',alignItems:'center',gap:4,fontSize:10.5,color:stroke,fontWeight:600 }}>
                <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={stroke} strokeWidth="1.5"/></svg>
                {cf?.name||c.id}
                <button onClick={()=>setCompare(p=>p.filter(id=>id!==c.id))} style={{ background:'none',border:'none',cursor:'pointer',color:stroke,fontSize:12,padding:0,lineHeight:1,marginRight:1,fontWeight:700 }}>×</button>
              </span>
            );
          })}
        </div>

        <div style={{ padding:'0 14px 10px',borderTop:`1px solid ${C.border}` }}>
          {!showSearch ? (
            <div style={{ display:'flex',gap:8,alignItems:'center',marginTop:8 }}>
              <button onClick={()=>setShowSearch(true)} style={{ background:'none',border:`1px dashed ${C.border}`,borderRadius:8,color:C.muted,fontSize:11,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit' }}>+ השוואה למוצר נוסף</button>
              {compare.length>0&&<button onClick={()=>setCompare([])} style={{ background:'none',border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:11,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit' }}>איפוס השוואה</button>}
            </div>
          ) : (
            <div ref={fdSearchRef} style={{ marginTop:8 }}>
              {/* בורר מוצר */}
              <div style={{ display:'flex',gap:4,flexWrap:'wrap',marginBottom:6,direction:'rtl' }}>
                {Object.entries(PRODUCT_LABELS).map(([key,{label,icon}])=>(
                  <button key={key} onClick={()=>{ setSearchProduct(key); setSearchQ(''); setShowFDDrop(true); }}
                    style={{ padding:'3px 10px',borderRadius:12,border:`1.5px solid ${searchProduct===key?C.crimson:C.border}`,background:searchProduct===key?C.crimson:C.white,color:searchProduct===key?C.white:C.mid,fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:3 }}>
                    <span>{icon}</span>{label}
                  </button>
                ))}
              </div>
              <div style={{ position:'relative' }}>
                <input autoFocus value={searchQ}
                  onChange={e=>{ setSearchQ(e.target.value); setShowFDDrop(true); }}
                  onFocus={()=>setShowFDDrop(true)}
                  placeholder={`חפש ב${PRODUCT_LABELS[searchProduct]?.label||''}…`}
                  style={{ width:'100%',padding:'6px 10px',border:`1px solid ${C.border}`,borderRadius:7,fontSize:12,fontFamily:'inherit',direction:'rtl',outline:'none',background:C.bg,boxSizing:'border-box' }}/>
                {showFDDrop && searchResults.length>0&&(
                  <div style={{ position:'absolute',top:'calc(100% + 3px)',right:0,left:0,zIndex:600,background:C.white,border:`1px solid ${C.border}`,borderRadius:7,maxHeight:160,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.12)' }}>
                    {searchResults.map(f=>(
                      <div key={f.fund_id} onMouseDown={()=>{ if(!compare.includes(f.fund_id)&&compare.length<3) setCompare(p=>[...p,f.fund_id]); setSearchQ(''); setShowFDDrop(false); setShowSearch(false); }} style={{ padding:'6px 10px',fontSize:11.5,cursor:'pointer',borderBottom:`1px solid ${C.border}`,direction:'rtl' }} onMouseEnter={e=>e.currentTarget.style.background=C.bg} onMouseLeave={e=>e.currentTarget.style.background=C.white}>{f.name}</div>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={()=>{setShowSearch(false);setSearchQ('');setShowFDDrop(false);}} style={{ background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontFamily:'inherit',marginTop:4 }}>ביטול</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Updated Label ────────────────────────────────────────────────────────────
const HE_MONTHS = ['','ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function UpdatedLabel() {
  const [label, setLabel] = useState('...');
  useEffect(()=>{
    loadData().then(({historyData})=>{
      if(!historyData) return;
      const periods = Object.values(historyData).flatMap(e=>Array.isArray(e)&&e.length?[e[e.length-1].period]:[]);
      if(periods.length){
        const latest = periods.sort().reverse()[0];
        const y=+latest.slice(0,4), mo=+latest.slice(4,6);
        _latestMonthName = HE_MONTHS[mo] || 'חודש';
        setLabel(`מעודכן לִ${HE_MONTHS[mo]} ${y}`);
      }
    }).catch(()=>{});
  },[]);
  return <span>{label}</span>;
}

// ─── Product Selector ─────────────────────────────────────────────────────────
function ProductSelector({ selected, onChange }) {
  return (
    <div style={{ display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center' }}>
      {Object.entries(PRODUCT_LABELS).map(([key,{label,icon}])=>{
        const active=selected===key;
        return <button key={key} onClick={()=>onChange(key)} style={{ display:'flex',alignItems:'center',gap:6,padding:'7px 13px',border:`2px solid ${active?C.crimson:C.border}`,borderRadius:8,background:active?C.crimson:C.white,color:active?C.white:C.dark,cursor:'pointer',fontFamily:'inherit',fontSize:12.5,fontWeight:600,transition:'all 0.15s',boxShadow:active?'0 3px 12px rgba(139,26,58,0.2)':'none' }}><span style={{ fontSize:14 }}>{icon}</span>{label}</button>;
      })}
    </div>
  );
}

// ─── Category Quick-Nav ───────────────────────────────────────────────────────
function CategoryNav({ catIds, funds }) {
  const scrollTo = id => { const el=document.getElementById(`sec-${id}`); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); };
  return (
    <div data-sticky style={{ display:'flex',gap:5,flexWrap:'wrap',padding:'7px 14px',background:C.white,borderBottom:`1px solid ${C.border}`,position:'sticky',top:56,zIndex:90 }}>
      {catIds.map(id=>{
        if(!getFundsForCategory(funds,id).length) return null;
        return <button key={id} onClick={()=>scrollTo(id)} style={{ padding:'3px 9px',borderRadius:12,border:`1px solid ${C.border}`,background:C.white,color:C.mid,fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all 0.12s' }} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.crimson;e.currentTarget.style.color=C.crimson;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.mid;}}>{CATEGORIES[id].label}</button>;
      })}
    </div>
  );
}

// ─── Company patterns ──────────────────────────────────────────────────────────
const COMPANY_PATTERNS = [
  { name:'הפניקס',      patterns:['הפניקס','אקסלנס'] },
  { name:'מיטב',        patterns:['מיטב'] },
  { name:'הראל',        patterns:['הראל'] },
  { name:'כלל',         patterns:['כלל ','כלל-','כלל ביטוח','כלל פנסיה'] },
  { name:'מנורה',       patterns:['מנורה'] },
  { name:'מגדל',        patterns:['מגדל'] },
  { name:'אלטשולר שחם', patterns:['אלטשולר'] },
  { name:'ילין לפידות', patterns:['ילין'] },
  { name:'מור',         patterns:['מור ','מור-'] },
  { name:'אינפיניטי',   patterns:['אינפיניטי'] },
  { name:'אנליסט',      patterns:['אנליסט'] },
  { name:'אלפא מור',    patterns:['אלפא מור'] },
  { name:'איילון',      patterns:['איילון'] },
  { name:'פסגות',       patterns:['פסגות'] },
  { name:'הכשרה',       patterns:['הכשרה'] },
  { name:'אי.די.אי.',   patterns:['אי.די.','איי. די.','איי.די.'] },
];

// מחלץ את שם החברה המנהלת בפועל — אחרי "מנוהל באמצעות" אם קיים
function getActualManager(name) {
  const match = name.match(/מנוהל(?:\s+ע["']?י|\s+באמצעות)\s+(.+?)(?:\s+(?:ניהול|בע|בע"מ|שקי|תיקי)|\s+-\s|$)/);
  return match ? match[1].trim() : null;
}

function matchesCompany(fundName, companyPatterns) {
  // אם זה מוצר "מנוהל באמצעות X" — בדוק רק את X
  const manager = getActualManager(fundName);
  if (manager) {
    return companyPatterns.some(p => manager.includes(p.trim()));
  }
  // אחרת — בדוק את שם הקרן כרגיל עם word boundary לכלל
  return companyPatterns.some(p => {
    if(p.endsWith(' ')||p.endsWith('-')) return fundName.includes(p);
    const idx = fundName.indexOf(p);
    if(idx === -1) return false;
    const after = fundName[idx + p.length];
    return !after || /[\s\-\(]/.test(after);
  });
}

function getCompanyFunds(funds, companyPatterns) {
  return funds.filter(f => matchesCompany(f.name, companyPatterns));
}

// ─── Track Browser ────────────────────────────────────────────────────────────

// ─── Home Page — 3 טבלאות מובילות לכל מוצר ───────────────────────────────────
const HOME_SHEETS = {
  'השתלמות':    ['מובילות-כללי', 'מניות', 'S&P 500'],
  'גמל':        ['מובילות-כללי', 'מניות', 'S&P 500'],
  'גמל_להשקעה': ['כללי',         'מניות', 'S&P 500'],
  'פוליסות':    ['כללי',         'מניות', 'S&P 500'],
  'פנסיה':      ['מקיפה-כללי',   'מקיפה-מניות', 'מקיפה-עד50'],
};

function HomePage({ onSelectProduct, onSelectFund, compSelected, setCompSelected, setAddedFund }) {
  const [ready, setReady] = useState(false);
  useEffect(()=>{ loadData().then(()=>setReady(true)); },[]);
  if(!ready) return <div style={{ padding:40,textAlign:'center',color:C.muted }}>טוען...</div>;

  return (
    <div style={{ padding:'16px 20px 48px' }}>
      {Object.entries(PRODUCT_LABELS).map(([productKey, productInfo])=>{
        const sheetNames = HOME_SHEETS[productKey]||[];
        const sheets = sheetNames.map(sh=>({ sh, funds:getFundsBySheet(productKey,sh) })).filter(s=>s.funds.length>0);
        if(!sheets.length) return null;
        return (
          <div key={productKey} style={{ marginBottom:32 }}>
            <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:12 }}>
              <span style={{ fontSize:20 }}>{productInfo.icon}</span>
              <h2 style={{ fontSize:15,fontWeight:800,color:C.dark,margin:0 }}>
                <span style={{ cursor:'pointer',borderBottom:`2px solid ${C.crimson}` }}
                  onClick={()=>onSelectProduct(productKey)}>
                  {productInfo.label}
                </span>
              </h2>
              <button onClick={()=>onSelectProduct(productKey)}
                style={{ marginRight:'auto',padding:'3px 12px',borderRadius:10,border:`1.5px solid ${C.crimson}`,background:'none',color:C.crimson,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>
                לכל המסלולים ←
              </button>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:14 }}>
              {sheets.map(({sh,funds})=>(
                <FundTable key={sh} catId={sh} catLabel={sh}
                  funds={funds}
                  onSelect={(f)=>onSelectFund(productKey,f)}
                  selFund={null} selCatId={null}
                  onAddToComparison={f=>{
                    setCompSelected(prev=>prev.find(s=>s.name===f.name)||prev.length>=10?prev:[...prev,f]);
                    setAddedFund(f.name);
                    setTimeout(()=>setAddedFund(null),2500);
                  }}/>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrackBrowser({ product, onSelectFund, selFund, order, funds, onAddToComparison, onAddToChart }) {
  const [activeSheet, setActiveSheet] = useState(null);
  const [viewMode, setViewMode]  = useState('category'); // 'category' | 'exposure' | 'company'
  const [activeCompany, setActiveCompany] = useState(null);

  // איפוס מצב כשמחליפים מוצר
  useEffect(()=>{
    setViewMode('category');
    setActiveCompany(null);
    setActiveSheet(null);
  },[product]);

  const sheets = useMemo(()=>getSheets(product),[product]);
  const sheetFunds = useMemo(()=>activeSheet?getFundsBySheet(product,activeSheet):[],[product,activeSheet]);

  // חברות שקיימות במוצר הנוכחי
  const availableCompanies = useMemo(()=>{
    const allProductFunds = sheets.flatMap(sh=>getFundsBySheet(product,sh));
    return COMPANY_PATTERNS.filter(co=>
      getCompanyFunds(allProductFunds, co.patterns).length > 0
    );
  },[product,sheets]);

  const companyFunds = useMemo(()=>{
    if(!activeCompany) return [];
    const co = COMPANY_PATTERNS.find(c=>c.name===activeCompany);
    if(!co) return [];
    return sheets.flatMap(sh=>getFundsBySheet(product,sh)).filter(f=>
      matchesCompany(f.name, co.patterns)
    );
  },[activeCompany,product,sheets]);

  const [trackSort, setTrackSort] = useState({ key:'ret_3y', dir:'desc' });
  const sortedDisplay = useMemo(()=>sortByKey(viewMode==='company'?companyFunds:sheetFunds, trackSort.key, trackSort.dir),[sheetFunds,companyFunds,viewMode,trackSort]);
  const displayFunds = sortedDisplay;
  const avg = useMemo(()=>calcAverages(displayFunds),[displayFunds]);

  function TrackSortTh({label, colKey, color}) {
    const active = trackSort.key===colKey;
    return <th onClick={()=>setTrackSort(s=>s.key===colKey?{key:colKey,dir:s.dir==='desc'?'asc':'desc'}:{key:colKey,dir:'desc'})}
      style={{ ...TH,textAlign:'center',cursor:'pointer',userSelect:'none',color:active?'#FFD6DE':(color||'rgba(255,255,255,0.7)'),background:active?'rgba(255,255,255,0.08)':'transparent',minWidth:50 }}>
      <span style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:2 }}>{label}{active&&<span style={{ fontSize:8 }}>{trackSort.dir==='desc'?'↓':'↑'}</span>}</span>
    </th>;
  }

  return (
    <div style={{ borderBottom:`1px solid ${C.border}`,background:C.white }}>
      <div style={{ display:'flex',alignItems:'center',gap:6,padding:'10px 16px',direction:'rtl' }}>
        <span style={{ fontSize:13,fontWeight:700,color:C.dark,marginLeft:8 }}>📂 מסלולי השקעה</span>
        <button onClick={()=>{setViewMode('category');setActiveCompany(null);}} style={{ padding:'4px 14px',borderRadius:12,border:`1.5px solid ${viewMode==='category'?C.crimson:C.border}`,background:viewMode==='category'?C.crimson:C.white,color:viewMode==='category'?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>לפי קטגוריות רשמיות</button>
        <button onClick={()=>{setViewMode('exposure');setActiveSheet(null);setActiveCompany(null);}} style={{ padding:'4px 14px',borderRadius:12,border:`1.5px solid ${viewMode==='exposure'?C.crimson:C.border}`,background:viewMode==='exposure'?C.crimson:C.white,color:viewMode==='exposure'?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>לפי חשיפות</button>
        <button onClick={()=>{setViewMode('company');setActiveSheet(null);}} style={{ padding:'4px 14px',borderRadius:12,border:`1.5px solid ${viewMode==='company'?C.crimson:C.border}`,background:viewMode==='company'?C.crimson:C.white,color:viewMode==='company'?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>לפי חברה מנהלת</button>
      </div>
      <div style={{ padding:'0 14px 14px',maxWidth:'60%' }}>

          {/* ── לפי קטגוריה: לחצנים + גלילה לטבלה ── */}
          {viewMode==='category'&&(<>
            <div style={{ display:'flex',flexWrap:'wrap',gap:5,marginBottom:12 }}>
              {sheets.map(sh=>(
                <button key={sh}
                  onClick={()=>{ setActiveSheet(sh); setTimeout(()=>{ const el=document.getElementById(`cat-table-${product}-${sh}`); if(el){ const y=el.getBoundingClientRect().top+window.scrollY-70; window.scrollTo({top:y,behavior:'smooth'}); } },80); }}
                  style={{ padding:'4px 11px',borderRadius:14,border:`1.5px solid ${activeSheet===sh?C.crimson:C.border}`,background:activeSheet===sh?C.crimson:C.white,color:activeSheet===sh?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all 0.12s' }}>
                  {sh}
                </button>
              ))}
            </div>
            <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
              {sheets.map(sh=>(
                <div key={sh} id={`cat-table-${product}-${sh}`}>
                  <FundTable catId={sh} catLabel={sh}
                    funds={getFundsBySheet(product,sh)}
                    onSelect={(f)=>{onSelectFund(f,sh);}}
                    selFund={selFund} selCatId={null}
                    onAddToComparison={onAddToComparison} onAddToChart={onAddToChart}/>
                </div>
              ))}
            </div>
          </>)}

          {/* ── לפי חשיפות: לחצנים + גלילה לטבלה ── */}
          {viewMode==='exposure'&&(<>
            <div style={{ display:'flex',flexWrap:'wrap',gap:5,marginBottom:12 }}>
              {order.filter(id=>getFundsForCategory(funds,id).length>0).map(id=>(
                <button key={id}
                  onClick={()=>{ setTimeout(()=>{ const el=document.getElementById(`exp-table-${product}-${id}`); if(el){ const y=el.getBoundingClientRect().top+window.scrollY-70; window.scrollTo({top:y,behavior:'smooth'}); } },80); }}
                  style={{ padding:'4px 11px',borderRadius:14,border:`1.5px solid ${C.border}`,background:C.white,color:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all 0.12s' }}>
                  {CATEGORIES[id]?.label||id}
                </button>
              ))}
            </div>
            <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
              {order.filter(id=>getFundsForCategory(funds,id).length>0).map(id=>(
                <div key={id} id={`exp-table-${product}-${id}`}>
                  <FundTable catId={id}
                    funds={getFundsForCategory(funds,id)}
                    onSelect={(f,cid)=>{onSelectFund(f,cid);}}
                    selFund={selFund} selCatId={null}
                    onAddToComparison={onAddToComparison} onAddToChart={onAddToChart}/>
                </div>
              ))}
            </div>
          </>)}

          {/* ── לפי חברה: לחצנים + טבלה ── */}
          {viewMode==='company'&&(<>
            <div style={{ display:'flex',flexWrap:'wrap',gap:5,marginBottom:12 }}>
              {availableCompanies.map(co=>(
                <button key={co.name}
                  onClick={()=>setActiveCompany(activeCompany===co.name?null:co.name)}
                  style={{ padding:'4px 11px',borderRadius:14,border:`1.5px solid ${activeCompany===co.name?C.crimson:C.border}`,background:activeCompany===co.name?C.crimson:C.white,color:activeCompany===co.name?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'all 0.12s' }}>
                  {co.name}
                </button>
              ))}
            </div>
          </>)}
          {(viewMode==='company'&&activeCompany&&companyFunds.length>0)&&(
            <FundTable catId={activeCompany} catLabel={activeCompany}
              funds={companyFunds}
              onSelect={(f)=>{
                const cats=order?classifyFund(f).filter(c=>order.includes(c)&&funds&&getFundsForCategory(funds,c).length>0):[];
                onSelectFund(f,cats.length>0?cats[0]:null);
              }}
              selFund={selFund} selCatId={null}
              onAddToComparison={onAddToComparison} onAddToChart={onAddToChart}/>
          )}
        </div>
      </div>
  );
}

// ─── Comparison Search ────────────────────────────────────────────────────────
const COMP_COLS = [
  { key:'ret_month', get label(){ return getLatestMonthName(); } },
  { key:'ret_ytd',   label:'YTD' },
  { key:'ret_1y',    label:'שנה' },
  { key:'ret_3y',    label:'3 שנים' },
  { key:'ret_5y',    label:'5 שנים' },
  { key:'ret_10y',   label:'10 שנים' },
  { key:'stocks',    label:'% מניות',   fmt: v=>v!=null?v.toFixed(1)+'%':'—', color:'#2563EB' },
  { key:'foreign',   label:'% חו"ל',    fmt: v=>v!=null?v.toFixed(1)+'%':'—', color:'#7C3AED' },
  { key:'forex',     label:'% מט"ח',    fmt: v=>v!=null?v.toFixed(1)+'%':'—', color:'#059669' },
  { key:'illiquid',  label:'% לא סחיר', fmt: v=>v!=null?v.toFixed(1)+'%':'—', color:'#9CA3AF' },
  { key:'sharpe',    label:'מדד שארפ',  fmt: v=>v!=null?v.toFixed(2):'—', color:'#1A1A1A' },
  { key:'profit_index', label:'מדד פרוגמלנט', fmt: v=>v!=null?v.toFixed(1):'—', color:'#8B1A3A' },
];


function ComparisonSearch({ allFunds, product, selected, setSelected, onSelectFund, setSentToChart }) {
  const [query, setQuery]             = useState('');
  const [showDrop, setShowDrop]       = useState(false);
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [searchProduct, setSearchProduct] = useState(product);
  const [weights, setWeights]         = useState({}); // fund.name → משקל (0-100)
  const wrapRef = useRef(null);

  // חישוב ממוצע משוקלל
  const totalWeight = selected.reduce((s,f)=>s+(parseFloat(weights[f.name])||0),0);
  const weightError = selected.length>0 && totalWeight>0 && Math.abs(totalWeight-100)>0.01;
  const weightedAvg = useMemo(()=>{
    if(!selected.length) return null;
    const hasWeights = selected.some(f=>parseFloat(weights[f.name])>0);
    const result = {};
    COMP_COLS.forEach(col=>{
      const vals = selected.map(f=>({ v:f[col.key], w: hasWeights ? (parseFloat(weights[f.name])||0) : 1 })).filter(x=>x.v!=null);
      if(!vals.length){ result[col.key]=null; return; }
      const totalW = vals.reduce((s,x)=>s+x.w,0);
      result[col.key] = totalW>0 ? vals.reduce((s,x)=>s+x.v*x.w,0)/totalW : null;
    });
    return result;
  },[selected, weights]);

  // סגור dropdown בלחיצה מחוץ לקומפוננטה
  useEffect(()=>{
    const handler = e => { if(wrapRef.current && !wrapRef.current.contains(e.target)) { setShowDrop(false); setShowProductSelector(false); } };
    document.addEventListener('mousedown', handler);
    return ()=>document.removeEventListener('mousedown', handler);
  },[]);

  // עדכן את בורר החיפוש כשמשתנה המוצר הראשי
  useEffect(()=>{ setSearchProduct(product); }, [product]);

  // קרנות לפי המוצר שנבחר בבורר — מאפשר השוואה חוצת-מוצרים
  const productFunds = useMemo(()=>{
    if(!searchProduct) return [];
    const funds = getAllFunds(searchProduct);
    const seen = new Set();
    return funds.filter(f=>{
      if(!f.name || seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });
  },[searchProduct, allFunds]);

  // תוצאות חיפוש — מציג top12 כשריק, מחפש לפי מילים כשיש קלט
  const results = useMemo(()=>{
    const pool = productFunds.filter(f=>!selected.find(s=>s.name===f.name));
    if(!query.trim()) return pool.slice(0,12);
    const words = query.trim().toLowerCase().split(/\s+/);
    return pool.filter(f=>{
      const n = f.name.toLowerCase().replace(/&amp;/g,'&');
      return words.every(w=>n.includes(w));
    }).slice(0,12);
  },[query, productFunds, selected]);

  const addFund = f => {
    if(selected.length<10 && !selected.find(s=>s.name===f.name))
      setSelected(p=>[...p,f]);
    setQuery('');
    setShowDrop(false);
  };

  return (
    <div ref={wrapRef} style={{ borderBottom:`1px solid ${C.border}`,background:C.white,padding:'10px 16px 12px' }}>
      <div style={{ fontSize:13,fontWeight:700,color:C.dark,marginBottom:8,direction:'rtl' }}>🔍 חיפוש והשוואת מוצרים</div>
      <div style={{ padding:'0' }}>
        {/* בורר מוצר — מוצג רק כשהשדה בפוקוס */}
        {showProductSelector&&(
          <div style={{ display:'flex',flexWrap:'wrap',gap:5,marginBottom:8,direction:'rtl' }}>
            {Object.entries(PRODUCT_LABELS).map(([key,{label,icon}])=>(
              <button key={key}
                onMouseDown={()=>{ setSearchProduct(key); setQuery(''); setShowDrop(true); }}
                style={{ padding:'4px 12px',borderRadius:12,border:`1.5px solid ${searchProduct===key?C.crimson:C.border}`,background:searchProduct===key?C.crimson:C.white,color:searchProduct===key?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4 }}>
                <span>{icon}</span>{label}
              </button>
            ))}
          </div>
        )}
        <div style={{ position:'relative',marginBottom:10,maxWidth:'60%' }}>
          <input
            value={query}
            onChange={e=>{ setQuery(e.target.value); setShowDrop(true); }}
            onFocus={()=>{ setShowDrop(true); setShowProductSelector(true); }}
            onBlur={()=>{}}
            placeholder={`חפש ב${PRODUCT_LABELS[searchProduct]?.label||''}… (עד 10)`}
            style={{ width:'100%',padding:'8px 12px 8px 32px',border:`1.5px solid ${C.border}`,borderRadius:8,fontSize:12.5,fontFamily:'inherit',direction:'rtl',outline:'none',background:C.bg,boxSizing:'border-box' }}
          />
          {(showDrop||query)&&(
            <button onMouseDown={()=>{ setQuery(''); setShowDrop(false); setShowProductSelector(false); }}
              style={{ position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:16,lineHeight:1,padding:0,zIndex:10 }}>×</button>
          )}
          {showDrop && results.length>0 && (
            <div style={{ position:'absolute',top:'calc(100% + 4px)',right:0,left:0,zIndex:500,background:C.white,border:`1px solid ${C.border}`,borderRadius:8,maxHeight:220,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.12)' }}>
              {results.map(f=>(
                <div key={f.name} onMouseDown={()=>addFund(f)}
                  style={{ padding:'7px 12px',fontSize:12,cursor:'pointer',borderBottom:`1px solid ${C.border}`,direction:'rtl',color:C.dark }}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bg}
                  onMouseLeave={e=>e.currentTarget.style.background=C.white}>
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
        {selected.length>0&&(
          <div style={{ display:'flex',flexWrap:'wrap',gap:5,marginBottom:10 }}>
            {selected.map((f,i)=>{
              const clr=COMP_COLORS[i%COMP_COLORS.length];
              return(
                <span key={f.name} style={{ display:'inline-flex',alignItems:'center',gap:4,background:clr+'18',border:'1.5px solid '+clr,borderRadius:12,padding:'3px 8px 3px 6px',fontSize:11,color:clr,fontWeight:600 }}>
                  <span style={{ width:8,height:8,borderRadius:'50%',background:clr,flexShrink:0,display:'inline-block' }}/>
                  {f.name.slice(0,28)}{f.name.length>28?'…':''}
                  <button onClick={()=>setSelected(p=>p.filter(s=>s.name!==f.name))} style={{ background:'none',border:'none',cursor:'pointer',color:clr,fontSize:13,padding:0,lineHeight:1,marginRight:1 }}>×</button>
                </span>
              );
            })}
            <button onClick={()=>setSelected([])} style={{ background:'none',border:`1px solid ${C.border}`,borderRadius:12,padding:'3px 8px',fontSize:10.5,color:C.muted,cursor:'pointer',fontFamily:'inherit' }}>נקה הכל</button>
          </div>
        )}
        {selected.length>0&&(
          <div style={{ overflowX:'auto',border:`1px solid ${C.border}`,borderRadius:8,maxWidth:'60%' }}>
            <table style={{ width:'100%',borderCollapse:'collapse',tableLayout:'auto' }}>
              <thead><tr style={{ background:C.darkMid }}>
                <th style={{ ...TH,width:5,padding:0 }}></th>
                <th style={{ ...TH,textAlign:'right',color:'rgba(255,255,255,0.8)',paddingRight:10 }}>שם המוצר</th>
                <th style={{ ...TH,textAlign:'center',color:'rgba(255,255,255,0.7)',minWidth:60 }}>משקל %</th>
                {COMP_COLS.map(c=><th key={c.key} style={{ ...TH,textAlign:'center',color:'rgba(255,255,255,0.7)' }}>{c.label}</th>)}
                <th style={{ ...TH,width:24 }}></th>
              </tr></thead>
              <tbody>
                {selected.map((f,i)=>{
                  const clr=COMP_COLORS[i%COMP_COLORS.length];
                  return(
                    <tr key={f.name} onClick={()=>onSelectFund&&onSelectFund(f)} style={{ background:C.white,borderBottom:`1px solid ${C.border}`,cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background='#FDF8F6'} onMouseLeave={e=>e.currentTarget.style.background=C.white}>
                      <td style={{ padding:0,width:5,background:clr }}/>
                      <td style={{ ...TD,fontWeight:500,color:C.darkMid,whiteSpace:'nowrap',paddingRight:10 }}>{f.name}</td>
                      <td style={{ ...TD,textAlign:'center' }} onClick={e=>e.stopPropagation()}>
                        <input type="number" min="0" max="100" step="10" value={weights[f.name]??''} onChange={e=>setWeights(p=>({...p,[f.name]:e.target.value}))}
                          placeholder="—"
                          style={{ width:48,padding:'2px 4px',border:`1px solid ${weightError?'#DC2626':C.border}`,borderRadius:5,fontSize:11,textAlign:'center',fontFamily:'inherit',outline:'none' }}/>
                      </td>
                      {COMP_COLS.map(col=>{
                        const v=f[col.key];
                        const fmt=col.fmt||pctFmt;
                        const color=col.color||(typeof v==='number'?numColor(v):C.dark);
                        return <td key={col.key} style={{ ...TD,textAlign:'center',color,fontWeight:600,fontVariantNumeric:'tabular-nums' }}>{fmt(v)}</td>;
                      })}
                      <td style={{ ...TD,width:48,textAlign:'center',padding:'4px 4px',whiteSpace:'nowrap' }}>
                        <button onClick={e=>{e.stopPropagation(); if(f.fund_id) setSentToChart(prev=>[...new Set([...prev,f.fund_id])]);}} title="שלח לגרף בפירוט" style={{ background:'none',border:'1px solid '+C.border,borderRadius:4,cursor:'pointer',fontSize:11,padding:'1px 5px',height:20,display:'inline-flex',alignItems:'center',justifyContent:'center',color:C.muted,marginLeft:3 }} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.crimson;e.currentTarget.style.color=C.crimson;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}>📈</button>
                        <button onClick={e=>{e.stopPropagation();setSelected(p=>p.filter(s=>s.name!==f.name));}} title="הסר" style={{ background:'none',border:'1px solid '+C.border,borderRadius:4,cursor:'pointer',fontSize:12,width:20,height:20,display:'inline-flex',alignItems:'center',justifyContent:'center',color:C.muted }} onMouseEnter={e=>{e.currentTarget.style.borderColor='#E63946';e.currentTarget.style.color='#E63946';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}>×</button>
                      </td>
                    </tr>
                  );
                })}
                {weightedAvg&&(
                  <tr style={{ background:C.avgBg,borderTop:`2px solid ${C.border}` }}>
                    <td style={{ padding:0,width:5 }}/>
                    <td style={{ ...TD,fontWeight:700,color:C.dark,paddingRight:10 }}>ממוצע {totalWeight>0?`(משוקלל ${totalWeight.toFixed(0)}%)`:'(שווה משקל)'}</td>
                    <td style={{ ...TD,textAlign:'center',fontSize:10,color:C.muted }}>{totalWeight>0?totalWeight.toFixed(0)+'%':'—'}</td>
                    {COMP_COLS.map(col=>{
                      const v=weightedAvg[col.key];
                      const fmt=col.fmt||pctFmt;
                      const color=col.color||(typeof v==='number'?numColor(v):C.dark);
                      return <td key={col.key} style={{ ...TD,textAlign:'center',color,fontWeight:700,fontVariantNumeric:'tabular-nums' }}>{fmt(v)}</td>;
                    })}
                    <td/>
                  </tr>
                )}
              </tbody>
            </table>
            {weightError&&(
              <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:'0 0 8px 8px',padding:'6px 12px',fontSize:11,color:'#DC2626',fontWeight:600,direction:'rtl' }}>
                ⚠️ סכום המשקולות הוא {totalWeight.toFixed(1)}% — חייב להיות 100% לממוצע משוקלל
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Mix Chart ────────────────────────────────────────────────────────────────
const MIX_PARAMS = [
  { key:'stocks',   label:'% מניות',    color:'#E63946' },
  { key:'foreign',  label:'% חו"ל',     color:'#2563EB' },
  { key:'forex',    label:'% מט"ח',     color:'#D97706' },
  { key:'illiquid', label:'% לא סחיר',  color:'#7C3AED' },
];

function MixChart({ fund, catFundIds, catLabel, histData, allFunds, externalIds }) {
  const [param, setParam]           = useState('stocks');
  const [showMixModal, setShowMixModal] = useState(false);
  const [extraIds, setExtraIds]     = useState([]);

  useEffect(()=>{
    if(!externalIds?.length) return;
    setExtraIds(prev=>{
      const toAdd = externalIds.filter(id=>!prev.includes(id)&&id!==fund.fund_id);
      return toAdd.length ? [...prev,...toAdd] : prev;
    });
  },[externalIds]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ]       = useState('');
  const [searchProduct, setSearchProduct] = useState(null);
  const [showDrop, setShowDrop]     = useState(false);
  const wrapRef = useRef(null);

  const COLORS = ['#E63946','#16A34A','#D97706','#7C3AED','#0891B2','#DB2777','#65A30D','#EA580C'];

  // ברירת מחדל לבורר מוצר
  useEffect(()=>{
    if(!searchProduct && fund.fund_id) {
      const entry = Object.entries(PRODUCT_LABELS).find(([k])=>getAllFunds(k).some(f=>f.fund_id===fund.fund_id));
      setSearchProduct(entry?.[0] ?? Object.keys(PRODUCT_LABELS)[0]);
    }
  },[fund.fund_id]);

  // סגור dropdown בלחיצה מחוץ
  useEffect(()=>{
    const h = e => { if(wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false); };
    document.addEventListener('mousedown', h);
    return ()=>document.removeEventListener('mousedown', h);
  },[]);

  // קרנות להשוואה: הקרן הנוכחית + הוספות
  const extraFunds = useMemo(()=>extraIds.map(id=>allFunds.find(f=>f.fund_id===id)).filter(Boolean),[extraIds, allFunds]);

  // ממוצע קטגוריה
  const catAvgData = useMemo(()=>{
    if(!catFundIds?.length) return {};
    const result = {};
    MIX_PARAMS.forEach(p=>{
      const vals = catFundIds.map(id=>{
        const last = (histData[id]??[]).slice(-1)[0];
        return last?.[p.key] ?? null;
      }).filter(v=>v!=null);
      result[p.key] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });
    return result;
  },[catFundIds, histData]);

  // כל הקרנות שמשווים: הנוכחית + extras + ממוצע קטגוריה
  const allEntries = useMemo(()=>{
    const getVal = (f, key) => {
      // ערך מה-fund object ישירות (נוכחי)
      return f[key] ?? null;
    };
    const rows = [
      { id:'main', name:fund.name, color:COLORS[0], isAvg:false,
        vals: Object.fromEntries(MIX_PARAMS.map(p=>[p.key, getVal(fund, p.key)])) },
      ...extraFunds.map((f,i)=>({
        id:f.fund_id, name:f.name, color:COLORS[(i+1)%COLORS.length], isAvg:false,
        vals: Object.fromEntries(MIX_PARAMS.map(p=>[p.key, getVal(f, p.key)]))
      })),
      { id:'avg', name:`ממוצע קטגוריה '${catLabel||''}'`, color:'#2563EB', isAvg:true,
        vals: catAvgData },
    ];
    return rows;
  },[fund, extraFunds, catAvgData, catLabel]);

  // חיפוש
  const searchFunds = useMemo(()=>{
    if(!searchProduct) return [];
    const funds = getAllFunds(searchProduct);
    const seen = new Set();
    return funds.filter(f=>{ if(!f.name||seen.has(f.name)) return false; seen.add(f.name); return true; });
  },[searchProduct, allFunds]);

  const searchResults = useMemo(()=>{
    const pool = searchFunds.filter(f=>f.fund_id && f.fund_id!==fund.fund_id && !extraIds.includes(f.fund_id));
    if(!searchQ.trim()) return pool.slice(0,10);
    const words = searchQ.trim().split(/\s+/);
    return pool.filter(f=>words.every(w=>f.name.includes(w))).slice(0,10);
  },[searchQ, searchFunds, fund.fund_id, extraIds]);

  // מקסימום לפרמטר הנוכחי
  const maxVal = useMemo(()=>Math.max(1,...allEntries.map(e=>e.vals[param]??0)),[allEntries, param]);

  // גרף אנכי — רוחב בר קבוע, גובה לפי ערך
  const barW = 56, gap = 16;
  const chartH = 160, PT = 24, PB = 10;
  const svgW = allEntries.length * (barW + gap) + gap;

  return (
    <div style={{ direction:'rtl' }}>
      {showMixModal&&(
        <div onClick={()=>setShowMixModal(false)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.white,borderRadius:14,width:'min(94vw,600px)',boxShadow:'0 24px 64px rgba(0,0,0,0.4)',overflow:'hidden',direction:'rtl' }}>
            <div style={{ background:C.crimson,padding:'11px 16px',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <span style={{ color:C.white,fontSize:13,fontWeight:700 }}>גרף תמהיל — {MIX_PARAMS.find(p=>p.key===param)?.label}</span>
              <button onClick={()=>setShowMixModal(false)} style={{ background:'rgba(255,255,255,0.2)',border:'none',color:C.white,width:28,height:28,borderRadius:'50%',cursor:'pointer',fontSize:18,display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
            </div>
            <div style={{ padding:'16px',display:'flex',justifyContent:'center' }}>
              <svg width={svgW*1.5} height={(chartH+PT+PB)*1.5} viewBox={`0 0 ${svgW} ${chartH+PT+PB}`} style={{ maxWidth:'100%' }}>
                <line x1={0} y1={PT+chartH} x2={svgW} y2={PT+chartH} stroke={C.border} strokeWidth="1"/>
                {allEntries.map((entry,ei)=>{
                  const val=entry.vals[param];
                  const bH=val!=null?Math.max(3,(val/maxVal)*chartH):0;
                  const x=gap+ei*(barW+gap), y=PT+chartH-bH;
                  return <g key={entry.id}>
                    <rect x={x} y={y} width={barW} height={bH} rx="3" fill={entry.color} opacity={entry.isAvg?0.55:0.85}/>
                    {val!=null&&<text x={x+barW/2} y={y-3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={entry.color}>{val.toFixed(1)}%</text>}
                  </g>;
                })}
              </svg>
            </div>
            <div style={{ padding:'8px 16px 14px',display:'flex',gap:10,flexWrap:'wrap',borderTop:`1px solid ${C.border}` }}>
              {allEntries.map(e=>(
                <span key={e.id} style={{ display:'flex',alignItems:'center',gap:4,fontSize:11,color:e.color,fontWeight:600 }}>
                  <span style={{ width:10,height:10,borderRadius:2,background:e.color,display:'inline-block' }}/>
                  {e.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* בחירת פרמטר */}
      <div style={{ padding:'10px 14px 6px',borderBottom:`1px solid ${C.border}`,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center' }}>
        <span style={{ fontSize:11,color:C.muted,fontWeight:600,marginLeft:4 }}>רכיב:</span>
        {MIX_PARAMS.map(p=>(
          <button key={p.key} onClick={()=>setParam(p.key)}
            style={{ padding:'3px 10px',borderRadius:12,border:`1.5px solid ${param===p.key?p.color:C.border}`,background:param===p.key?p.color:C.white,color:param===p.key?C.white:C.mid,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit' }}>
            {p.label}
          </button>
        ))}
        <div style={{ marginRight:'auto',display:'flex',gap:5 }}>
          <button onClick={()=>setShowMixModal(true)} style={{ background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 9px',fontSize:11,color:C.muted,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4 }}>🔍 הגדל</button>
          <button onClick={()=>window.print()} style={{ background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 9px',fontSize:11,color:C.muted,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4 }}>🖨️ הדפס</button>
        </div>
      </div>

      {/* גרף bars אנכי */}
      <div style={{ padding:'10px 14px 6px' }}>
        <svg width={svgW} height={chartH+PT+PB} viewBox={`0 0 ${svgW} ${chartH+PT+PB}`} style={{ display:'block', maxWidth:'100%' }}>
          {/* קו בסיס */}
          <line x1={0} y1={PT+chartH} x2={svgW} y2={PT+chartH} stroke={C.border} strokeWidth="1"/>
          {allEntries.map((entry, ei)=>{
            const val = entry.vals[param];
            const bH = val!=null ? Math.max(3,(val/maxVal)*chartH) : 0;
            const x = gap + ei*(barW+gap);
            const y = PT + chartH - bH;
            return (
              <g key={entry.id}>
                {/* בר */}
                <rect x={x} y={y} width={barW} height={bH} rx="3"
                  fill={entry.color} opacity={entry.isAvg?0.55:0.85}/>
                {/* ערך מעל הבר */}
                {val!=null&&(
                  <text x={x+barW/2} y={y-3} textAnchor="middle" fontSize="8.5" fontWeight="700"
                    fill={entry.color}>{val.toFixed(1)}%</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* מקרא */}
      <div style={{ padding:'4px 14px 8px',display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',borderTop:`1px solid ${C.border}` }}>
        {allEntries.map(e=>(
          <span key={e.id} style={{ display:'flex',alignItems:'center',gap:4,fontSize:10.5,color:e.color,fontWeight:e.isAvg?700:600 }}>
            <span style={{ width:10,height:10,borderRadius:2,background:e.color,display:'inline-block',opacity:e.isAvg?0.6:0.85 }}/>
            {e.name}
            {e.id!=='main'&&e.id!=='avg'&&(
              <button onClick={()=>setExtraIds(p=>p.filter(id=>id!==e.id))}
                style={{ background:'none',border:'none',cursor:'pointer',color:e.color,fontSize:13,padding:0,fontWeight:700,lineHeight:1 }}>×</button>
            )}
          </span>
        ))}
      </div>

      {/* הוספת מוצר להשוואה */}
      <div style={{ padding:'0 14px 10px' }}>
        {!showSearch ? (
          <button onClick={()=>setShowSearch(true)}
            style={{ background:'none',border:`1px dashed ${C.border}`,borderRadius:8,color:C.muted,fontSize:11,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',marginTop:4 }}>
            + השוואה למוצר נוסף
          </button>
        ) : (
          <div ref={wrapRef} style={{ marginTop:8 }}>
            <div style={{ display:'flex',gap:4,flexWrap:'wrap',marginBottom:6 }}>
              {Object.entries(PRODUCT_LABELS).map(([key,{label,icon}])=>(
                <button key={key} onClick={()=>{ setSearchProduct(key); setSearchQ(''); setShowDrop(true); }}
                  style={{ padding:'3px 10px',borderRadius:12,border:`1.5px solid ${searchProduct===key?C.crimson:C.border}`,background:searchProduct===key?C.crimson:C.white,color:searchProduct===key?C.white:C.mid,fontSize:10.5,fontWeight:600,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:3 }}>
                  <span>{icon}</span>{label}
                </button>
              ))}
            </div>
            <div style={{ position:'relative' }}>
              <input autoFocus value={searchQ}
                onChange={e=>{ setSearchQ(e.target.value); setShowDrop(true); }}
                onFocus={()=>setShowDrop(true)}
                placeholder={`חפש ב${PRODUCT_LABELS[searchProduct]?.label||''}…`}
                style={{ width:'100%',padding:'6px 10px',border:`1px solid ${C.border}`,borderRadius:7,fontSize:12,fontFamily:'inherit',direction:'rtl',outline:'none',background:C.bg,boxSizing:'border-box' }}/>
              {showDrop && searchResults.length>0&&(
                <div style={{ position:'absolute',top:'calc(100% + 3px)',right:0,left:0,zIndex:600,background:C.white,border:`1px solid ${C.border}`,borderRadius:7,maxHeight:160,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,0.12)' }}>
                  {searchResults.map(f=>(
                    <div key={f.fund_id} onMouseDown={()=>{ setExtraIds(p=>[...p,f.fund_id]); setSearchQ(''); setShowDrop(false); setShowSearch(false); }}
                      style={{ padding:'6px 10px',fontSize:11.5,cursor:'pointer',borderBottom:`1px solid ${C.border}`,direction:'rtl' }}
                      onMouseEnter={e=>e.currentTarget.style.background=C.bg}
                      onMouseLeave={e=>e.currentTarget.style.background=C.white}>{f.name}</div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={()=>{setShowSearch(false);setSearchQ('');setShowDrop(false);}}
              style={{ background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontFamily:'inherit',marginTop:4 }}>ביטול</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fund Detail Panel ────────────────────────────────────────────────────────
function FundDetail({ fund, onClose, catAvg, catFundIds, catLabel, histData, allFunds, externalCompare, onTabChange }) {
  if(!fund) return null;
  const [activeTab, setActiveTab] = useState('returns');
  const handleTabChange = (id) => { setActiveTab(id); onTabChange&&onTabChange(id); };
  const cats = classifyFund(fund).map(id=>CATEGORIES[id]?.label).filter(Boolean);
  const bonds = calcBonds(fund);
  const fundWithAll = useMemo(()=>({...fund,_allFunds:allFunds}),[fund,allFunds]);

  const Bar = ({label,val,color}) => {
    if(val==null) return null;
    return <div style={{ marginBottom:9 }}><div style={{ display:'flex',justifyContent:'space-between',marginBottom:3 }}><span style={{ fontSize:13,color:C.muted }}>{label}</span><span style={{ fontSize:14,fontWeight:700,color:color||C.dark }}>{pctFmtRaw(val)}</span></div><div style={{ height:7,background:C.border,borderRadius:4 }}><div style={{ height:7,borderRadius:4,width:`${Math.min(Math.abs(val),100)}%`,background:color||C.crimson }}/></div></div>;
  };

  function ReturnBars() {
    const [hov, setHov] = useState(null);
    const periods=[{key:'ret_month',label:getLatestMonthName()},{key:'ret_ytd',label:'YTD'},{key:'ret_1y',label:'שנה'},{key:'ret_3y',label:'3 שנ׳'},{key:'ret_5y',label:'5 שנ׳'},{key:'ret_10y',label:'10 שנ׳'}].filter(p=>fund[p.key]!=null);
    if(!periods.length) return <p style={{ textAlign:'center',color:C.muted,fontSize:11,margin:0 }}>אין נתוני תשואה</p>;
    const vals=periods.map(p=>fund[p.key]);
    const avgVals=catAvg?periods.map(p=>catAvg[p.key]).filter(v=>v!=null):[];
    const maxAbs=Math.max(...[...vals,...avgVals].map(v=>Math.abs(v)),1);
    const W=280,H=110,PAD=8;
    const barW=(W-PAD*2)/periods.length-5;
    const zeroY=PAD+(H-16)*0.5;
    return (
      <div style={{ position:'relative' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H+4}`} style={{ display:'block',overflow:'visible' }}>
          <line x1={PAD} y1={zeroY} x2={W-PAD} y2={zeroY} stroke={C.border} strokeWidth="1"/>
          {periods.map((p,i)=>{
            const val=fund[p.key], barH=Math.max(2,Math.abs(val)/maxAbs*((H-16)/2-4));
            const x=PAD+i*((W-PAD*2)/periods.length)+2.5;
            const y=val>=0?zeroY-barH:zeroY, color=val>=0?C.pos:C.neg;
            const avg=catAvg?.[p.key], cx=x+barW/2;
            return <g key={p.key}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx="2" opacity="0.85"/>
              <text x={cx} y={val>=0?y-3:y+barH+10} textAnchor="middle" fontSize="8.5" fill={color} fontWeight="700" fontFamily="Assistant,Heebo,sans-serif">{pctFmt(val)}</text>
              {avg!=null&&(()=>{ const ah=Math.abs(avg)/maxAbs*((H-16)/2-4), ay=avg>=0?zeroY-ah:zeroY+ah; return <circle cx={cx} cy={ay} r="3" fill={C.crimson} opacity="0.85" style={{ cursor:'pointer' }} onMouseEnter={()=>setHov({label:p.label,val:avg,cx,cy:ay})} onMouseLeave={()=>setHov(null)}/>; })()}
              <text x={cx} y={H+2} textAnchor="middle" fontSize="8.5" fill={C.muted} fontFamily="Assistant,Heebo,sans-serif">{p.label}</text>
            </g>;
          })}
        </svg>
        {hov&&<div style={{ position:'absolute',left:`calc(${(hov.cx/W)*100}% - 55px)`,top:`calc(${(hov.cy/(H+4))*100}% - 42px)`,background:C.dark,color:C.white,borderRadius:7,padding:'5px 10px',fontSize:11,fontWeight:600,whiteSpace:'nowrap',boxShadow:'0 4px 14px rgba(0,0,0,0.35)',pointerEvents:'none',zIndex:500,direction:'rtl' }}>ממוצע ({hov.label}): {pctFmt(hov.val)}</div>}
      </div>
    );
  }

  return (
    <div style={{ width:'100%',height:'100%',background:C.white,boxShadow:'-4px 0 28px rgba(0,0,0,0.12)',overflowY:'auto',direction:'rtl',display:'flex',flexDirection:'column' }}>
      <div style={{ background:C.darkMid,padding:'10px 13px 8px',flexShrink:0,direction:'rtl' }}>
        <span style={{ fontSize:15,color:C.white,fontWeight:800,letterSpacing:'0.01em' }}>📊 מערכת גרפים וניתוח מוצר</span>
      </div>
      <div style={{ background:C.crimson,padding:'9px 13px 8px',color:C.white,flexShrink:0 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
          <h2 style={{ margin:0,fontSize:11,fontWeight:600,lineHeight:1.5,flex:1,paddingLeft:8,opacity:0.9 }}>{fund.name}</h2>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.2)',border:'none',color:C.white,width:24,height:24,borderRadius:'50%',cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>×</button>
        </div>
        <div style={{ marginTop:6,display:'flex',gap:4,flexWrap:'wrap' }}>
          {cats.slice(0,3).map(c=><span key={c} style={{ background:'rgba(255,255,255,0.2)',borderRadius:8,padding:'1px 7px',fontSize:9,fontWeight:600 }}>{c}</span>)}
        </div>
      </div>
      <div style={{ display:'flex',borderBottom:`1px solid ${C.border}`,flexShrink:0,background:C.white }}>
        {[{id:'returns',label:'תשואות וחשיפות'},{id:'history',label:'📈 גרף תשואה מצטברת'},{id:'mix',label:'📊 גרף תמהיל'},{id:'risk',label:'⚠️ גרף סיכון'}].map(tab=>(
          <button key={tab.id} onClick={()=>handleTabChange(tab.id)} style={{ flex:1,padding:'9px 0',border:'none',background:'none',color:activeTab===tab.id?C.crimson:C.muted,fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',borderBottom:activeTab===tab.id?`2px solid ${C.crimson}`:'2px solid transparent' }}>{tab.label}</button>
        ))}
      </div>
      <div style={{ flex:1,overflowY:'auto' }}>
        {activeTab==='returns'&&(
          <div style={{ padding:'11px 13px' }}>
            {fund.profit_index!=null&&<div style={{ background:'linear-gradient(135deg,#FFF0F3,#FFE4EA)',border:`1px solid #F8C8D0`,borderRadius:9,padding:'8px 12px',marginBottom:11,display:'flex',alignItems:'center',justifyContent:'space-between' }}><div><div style={{ fontSize:13,color:C.crimson,fontWeight:700 }}>מדד פרוגמלנט</div><div style={{ fontSize:11,color:C.muted }}>שירות ואיכות ניהול</div></div><span style={{ fontSize:30,fontWeight:900,color:C.crimson }}>{fund.profit_index.toFixed(1)}</span></div>}
            <div style={{ marginBottom:11 }}>
              <div style={{ fontSize:11.5,fontWeight:700,color:C.dark,marginBottom:5 }}>תשואות{catAvg&&<span style={{ fontSize:9.5,color:C.muted,fontWeight:400,marginRight:5 }}>| עיגול = ממוצע קטגוריה</span>}</div>
              <div style={{ background:C.bg,borderRadius:8,padding:'9px 7px' }}><ReturnBars/></div>
            </div>


            <div style={{ background:'linear-gradient(135deg,#F8F5FF,#EEF2FF)',border:'1px solid #C4B5FD',borderRadius:9,padding:'12px 14px',margin:'8px 14px 12px',direction:'rtl' }}>
              <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:8 }}><span style={{ fontSize:14 }}>🤖</span><span style={{ fontSize:11.5,fontWeight:700,color:'#4C1D95' }}>ניתוח AI</span><span style={{ fontSize:9.5,color:'#7C3AED',background:'#EDE9FE',borderRadius:7,padding:'1px 6px' }}>בדיקה</span></div>
              <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>בתקופה שנבדקה (בין השנים 2016 ל־2026), המוצר השיג תשואה שנתית ממוצעת של כ־6.2%, מול ממוצע קטגוריאלי של כ־7.1%. המבנה הייחודי שלו, שכבת בסיס אג"חית צרה יחסית לצד גג מניות ומט"ח רחב – גבה לעיתים מחיר של תנודתיות מוגברת. תמהיל דומה* אליו רשם בשיא המשברים העולמיים (2000 ו-2008) ירידות שהגיעו לאזור ה־15%–20%, ואופיינו בזמן התאוששות שנמשך בשיא עד 3 שנים.</p>
              <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>הגוף המנהל: ההיסטוריה של הגוף המנהל מלמדת על גוף השקעות עם DNA יציב, שלא נבהל מזעזועים, וגם לא רודף אחרי טרנדים. ההתאמה המשמעותית ביותר במסלול נרשמה בשנים 2021–2023, כשהוגדלה משמעותית החשיפה לחו"ל ולמט"ח. המהלך הזה תרם לביצועים בטווח הקצר, ואף שהשארתו לאורך זמן הגדילה את התנודתיות, הוא מעיד על גוף שמאמין באסטרטגיה לטווח ארוך. העקביות הזו, לצד פתרונות אשראי אטרקטיביים יחסית כנגד הקופה, וצוות השקעות חזק, תמך בדירוג הגבוה בסקר שביעות רצון פנימי.</p>
              <p style={{ margin:'0 0 6px',fontSize:11,fontWeight:700,color:'#4C1D95' }}>מבט אל תוך המוצר</p>
              <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>תמהיל הנכסים של המוצר בנוי מ"שכבות" השקעה. רכיב האג"ח והנכסים הלא-סחירים (כ־58% ביחד): השכבה צפויה להעניק לתיק את היציבות וההכנסה השוטפת. משקל אגרות החוב הקלאסיות נמוך יחסית לענף ועומד על כ־44% בלבד (לעומת כ־56% בממוצע בקטגוריה), מול שכבה עבה יחסית של השקעות לא סחירות (כ־14% לעומת 11% בענף).</p>
              <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>• שכבת המניות הגלובלית (כ־42%): עם חשיפה של 42% למניות בחו"ל – גבוהה משמעותית מהממוצע בקטגוריה שעומד על כ־30% – התיק מעניק משקל גבוה למנועי הצמיחה הגלובליים.<br/>• מעטפת שכבת המט"ח (כ־35%): החשיפה למט"ח קרובה לחשיפה למניות חו"ל, כך שרוב החשיפה לחו"ל נותרת ללא גידור מטבעי. ברגעי משבר עשוי להפוך לשכבת הגנה — "ריצה אל הדולר".<br/>• שכבת הצמיחה הישראלית (כ־22%): מנוע תשואות משני, עם חשיפה מקומית של 22% לעומת כ־33% בממוצע בענף.</p>
              <p style={{ margin:0,fontSize:10,color:'#7C3AED',fontStyle:'italic' }}>**ניתן לקבל בדיקת התאמה אישית למוצר או הצעה לחלופות, באמצעות מתכנן פיננסי מאושר ע"י פרוגמלנט</p>
            </div>
          </div>
        )}
        {activeTab==='history'&&<div><HistoricalChart fund={fundWithAll} catFundIds={catFundIds} catLabel={catLabel} histData={histData} externalCompare={externalCompare}/>

      <div style={{ background:'linear-gradient(135deg,#F8F5FF,#EEF2FF)',border:'1px solid #C4B5FD',borderRadius:9,padding:'12px 14px',margin:'8px 14px 12px',direction:'rtl' }}>
        <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:8 }}><span style={{ fontSize:14 }}>🤖</span><span style={{ fontSize:11.5,fontWeight:700,color:'#4C1D95' }}>ניתוח AI</span><span style={{ fontSize:9.5,color:'#7C3AED',background:'#EDE9FE',borderRadius:7,padding:'1px 6px' }}>בדיקה</span></div>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>בתקופה שנבדקה (בין השנים 2016 ל־2026), המוצר השיג תשואה שנתית ממוצעת של כ־6.2%, מול ממוצע קטגוריאלי של כ־7.1%. המבנה הייחודי שלו, שכבת בסיס אג"חית צרה יחסית לצד גג מניות ומט"ח רחב – גבה לעיתים מחיר של תנודתיות מוגברת. תמהיל דומה* אליו רשם בשיא המשברים העולמיים (2000 ו-2008) ירידות שהגיעו לאזור ה־15%–20%, ואופיינו בזמן התאוששות שנמשך בשיא עד 3 שנים.</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>הגוף המנהל: ההיסטוריה של הגוף המנהל מלמדת על גוף השקעות עם DNA יציב, שלא נבהל מזעזועים, וגם לא רודף אחרי טרנדים. ההתאמה המשמעותית ביותר במסלול נרשמה בשנים 2021–2023, כשהוגדלה משמעותית החשיפה לחו"ל ולמט"ח. המהלך הזה תרם לביצועים בטווח הקצר, ואף שהשארתו לאורך זמן הגדילה את התנודתיות, הוא מעיד על גוף שמאמין באסטרטגיה לטווח ארוך. העקביות הזו, לצד פתרונות אשראי אטרקטיביים יחסית כנגד הקופה, וצוות השקעות חזק, תמך בדירוג הגבוה בסקר שביעות רצון פנימי.</p>
        <p style={{ margin:'0 0 6px',fontSize:11,fontWeight:700,color:'#4C1D95' }}>מבט אל תוך המוצר</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>תמהיל הנכסים של המוצר בנוי מ"שכבות" השקעה. רכיב האג"ח והנכסים הלא-סחירים (כ־58% ביחד): השכבה צפויה להעניק לתיק את היציבות וההכנסה השוטפת. משקל אגרות החוב הקלאסיות נמוך יחסית לענף ועומד על כ־44% בלבד (לעומת כ־56% בממוצע בקטגוריה), מול שכבה עבה יחסית של השקעות לא סחירות (כ־14% לעומת 11% בענף).</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>• שכבת המניות הגלובלית (כ־42%): עם חשיפה של 42% למניות בחו"ל – גבוהה משמעותית מהממוצע בקטגוריה שעומד על כ־30% – התיק מעניק משקל גבוה למנועי הצמיחה הגלובליים.<br/>• מעטפת שכבת המט"ח (כ־35%): החשיפה למט"ח קרובה לחשיפה למניות חו"ל, כך שרוב החשיפה לחו"ל נותרת ללא גידור מטבעי. ברגעי משבר עשוי להפוך לשכבת הגנה — "ריצה אל הדולר".<br/>• שכבת הצמיחה הישראלית (כ־22%): מנוע תשואות משני, עם חשיפה מקומית של 22% לעומת כ־33% בממוצע בענף.</p>
        <p style={{ margin:0,fontSize:10,color:'#7C3AED',fontStyle:'italic' }}>**ניתן לקבל בדיקת התאמה אישית למוצר או הצעה לחלופות, באמצעות מתכנן פיננסי מאושר ע"י פרוגמלנט</p>
      </div></div>}
        {activeTab==='mix'&&<div><MixChart fund={fund} catFundIds={catFundIds} catLabel={catLabel} histData={histData} allFunds={allFunds} externalIds={externalCompare}/>

      <div style={{ background:'linear-gradient(135deg,#F8F5FF,#EEF2FF)',border:'1px solid #C4B5FD',borderRadius:9,padding:'12px 14px',margin:'8px 14px 12px',direction:'rtl' }}>
        <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:8 }}><span style={{ fontSize:14 }}>🤖</span><span style={{ fontSize:11.5,fontWeight:700,color:'#4C1D95' }}>ניתוח AI</span><span style={{ fontSize:9.5,color:'#7C3AED',background:'#EDE9FE',borderRadius:7,padding:'1px 6px' }}>בדיקה</span></div>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>בתקופה שנבדקה (בין השנים 2016 ל־2026), המוצר השיג תשואה שנתית ממוצעת של כ־6.2%, מול ממוצע קטגוריאלי של כ־7.1%. המבנה הייחודי שלו, שכבת בסיס אג"חית צרה יחסית לצד גג מניות ומט"ח רחב – גבה לעיתים מחיר של תנודתיות מוגברת. תמהיל דומה* אליו רשם בשיא המשברים העולמיים (2000 ו-2008) ירידות שהגיעו לאזור ה־15%–20%, ואופיינו בזמן התאוששות שנמשך בשיא עד 3 שנים.</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>הגוף המנהל: ההיסטוריה של הגוף המנהל מלמדת על גוף השקעות עם DNA יציב, שלא נבהל מזעזועים, וגם לא רודף אחרי טרנדים. ההתאמה המשמעותית ביותר במסלול נרשמה בשנים 2021–2023, כשהוגדלה משמעותית החשיפה לחו"ל ולמט"ח. המהלך הזה תרם לביצועים בטווח הקצר, ואף שהשארתו לאורך זמן הגדילה את התנודתיות, הוא מעיד על גוף שמאמין באסטרטגיה לטווח ארוך. העקביות הזו, לצד פתרונות אשראי אטרקטיביים יחסית כנגד הקופה, וצוות השקעות חזק, תמך בדירוג הגבוה בסקר שביעות רצון פנימי.</p>
        <p style={{ margin:'0 0 6px',fontSize:11,fontWeight:700,color:'#4C1D95' }}>מבט אל תוך המוצר</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>תמהיל הנכסים של המוצר בנוי מ"שכבות" השקעה. רכיב האג"ח והנכסים הלא-סחירים (כ־58% ביחד): השכבה צפויה להעניק לתיק את היציבות וההכנסה השוטפת. משקל אגרות החוב הקלאסיות נמוך יחסית לענף ועומד על כ־44% בלבד (לעומת כ־56% בממוצע בקטגוריה), מול שכבה עבה יחסית של השקעות לא סחירות (כ־14% לעומת 11% בענף).</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>• שכבת המניות הגלובלית (כ־42%): עם חשיפה של 42% למניות בחו"ל – גבוהה משמעותית מהממוצע בקטגוריה שעומד על כ־30% – התיק מעניק משקל גבוה למנועי הצמיחה הגלובליים.<br/>• מעטפת שכבת המט"ח (כ־35%): החשיפה למט"ח קרובה לחשיפה למניות חו"ל, כך שרוב החשיפה לחו"ל נותרת ללא גידור מטבעי. ברגעי משבר עשוי להפוך לשכבת הגנה — "ריצה אל הדולר".<br/>• שכבת הצמיחה הישראלית (כ־22%): מנוע תשואות משני, עם חשיפה מקומית של 22% לעומת כ־33% בממוצע בענף.</p>
        <p style={{ margin:0,fontSize:10,color:'#7C3AED',fontStyle:'italic' }}>**ניתן לקבל בדיקת התאמה אישית למוצר או הצעה לחלופות, באמצעות מתכנן פיננסי מאושר ע"י פרוגמלנט</p>
      </div></div>}
        {activeTab==='risk'&&(
          <div>
            <div style={{ padding:'40px 20px',textAlign:'center',color:C.muted,fontSize:13 }}>
              <div style={{ fontSize:32,marginBottom:12 }}>⚠️</div>
              <div style={{ fontWeight:700,color:C.dark,marginBottom:6 }}>גרף סיכון</div>
              <div style={{ fontSize:11.5 }}>בקרוב — ציר X: ירידה מקסימלית | ציר Y: טווח השקעה | גודל נקודה: היקף נכסים</div>
            </div>

      <div style={{ background:'linear-gradient(135deg,#F8F5FF,#EEF2FF)',border:'1px solid #C4B5FD',borderRadius:9,padding:'12px 14px',margin:'8px 14px 12px',direction:'rtl' }}>
        <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:8 }}><span style={{ fontSize:14 }}>🤖</span><span style={{ fontSize:11.5,fontWeight:700,color:'#4C1D95' }}>ניתוח AI</span><span style={{ fontSize:9.5,color:'#7C3AED',background:'#EDE9FE',borderRadius:7,padding:'1px 6px' }}>בדיקה</span></div>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>בתקופה שנבדקה (בין השנים 2016 ל־2026), המוצר השיג תשואה שנתית ממוצעת של כ־6.2%, מול ממוצע קטגוריאלי של כ־7.1%. המבנה הייחודי שלו, שכבת בסיס אג"חית צרה יחסית לצד גג מניות ומט"ח רחב – גבה לעיתים מחיר של תנודתיות מוגברת. תמהיל דומה* אליו רשם בשיא המשברים העולמיים (2000 ו-2008) ירידות שהגיעו לאזור ה־15%–20%, ואופיינו בזמן התאוששות שנמשך בשיא עד 3 שנים.</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>הגוף המנהל: ההיסטוריה של הגוף המנהל מלמדת על גוף השקעות עם DNA יציב, שלא נבהל מזעזועים, וגם לא רודף אחרי טרנדים. ההתאמה המשמעותית ביותר במסלול נרשמה בשנים 2021–2023, כשהוגדלה משמעותית החשיפה לחו"ל ולמט"ח. המהלך הזה תרם לביצועים בטווח הקצר, ואף שהשארתו לאורך זמן הגדילה את התנודתיות, הוא מעיד על גוף שמאמין באסטרטגיה לטווח ארוך. העקביות הזו, לצד פתרונות אשראי אטרקטיביים יחסית כנגד הקופה, וצוות השקעות חזק, תמך בדירוג הגבוה בסקר שביעות רצון פנימי.</p>
        <p style={{ margin:'0 0 6px',fontSize:11,fontWeight:700,color:'#4C1D95' }}>מבט אל תוך המוצר</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>תמהיל הנכסים של המוצר בנוי מ"שכבות" השקעה. רכיב האג"ח והנכסים הלא-סחירים (כ־58% ביחד): השכבה צפויה להעניק לתיק את היציבות וההכנסה השוטפת. משקל אגרות החוב הקלאסיות נמוך יחסית לענף ועומד על כ־44% בלבד (לעומת כ־56% בממוצע בקטגוריה), מול שכבה עבה יחסית של השקעות לא סחירות (כ־14% לעומת 11% בענף).</p>
        <p style={{ margin:'0 0 8px',fontSize:11,color:'#3D3D3D',lineHeight:1.8 }}>• שכבת המניות הגלובלית (כ־42%): עם חשיפה של 42% למניות בחו"ל – גבוהה משמעותית מהממוצע בקטגוריה שעומד על כ־30% – התיק מעניק משקל גבוה למנועי הצמיחה הגלובליים.<br/>• מעטפת שכבת המט"ח (כ־35%): החשיפה למט"ח קרובה לחשיפה למניות חו"ל, כך שרוב החשיפה לחו"ל נותרת ללא גידור מטבעי. ברגעי משבר עשוי להפוך לשכבת הגנה — "ריצה אל הדולר".<br/>• שכבת הצמיחה הישראלית (כ־22%): מנוע תשואות משני, עם חשיפה מקומית של 22% לעומת כ־33% בממוצע בענף.</p>
        <p style={{ margin:0,fontSize:10,color:'#7C3AED',fontStyle:'italic' }}>**ניתן לקבל בדיקת התאמה אישית למוצר או הצעה לחלופות, באמצעות מתכנן פיננסי מאושר ע"י פרוגמלנט</p>
      </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fund Table ───────────────────────────────────────────────────────────────
function sortByKey(funds,key,dir) {
  return [...funds].sort((a,b)=>{ const av=a[key]??-Infinity,bv=b[key]??-Infinity; return dir==='desc'?bv-av:av-bv; });
}

function FundTable({ funds, catId, catLabel, onSelect, selFund, selCatId, onAddToComparison, onAddToChart }) {
  const [sortKey, setSortKey] = useState('ret_3y');
  const [sortDir, setSortDir] = useState('desc');
  const [showAll, setShowAll] = useState(false);
  const cat = CATEGORIES[catId] || { label: catLabel||catId, desc:'' };
  const sorted = useMemo(()=>sortByKey(funds,sortKey,sortDir),[funds,sortKey,sortDir]);
  const top12 = sorted.slice(0,12), rest = sorted.slice(12);
  const avg = useMemo(()=>calcAverages(sorted),[sorted]);

  function SortTh({col}) {
    const active=sortKey===col.key;
    const baseColor = col.color || 'rgba(255,255,255,0.8)';
    return <th onClick={()=>{ if(sortKey===col.key) setSortDir(d=>d==='desc'?'asc':'desc'); else{setSortKey(col.key);setSortDir('desc');} }} style={{ ...TH,textAlign:'center',cursor:'pointer',userSelect:'none',color:active?'#FFD6DE':baseColor,background:active?'rgba(255,255,255,0.08)':'transparent',minWidth:50 }}><span style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:2 }}><Tooltip text={col.tip}/>{col.label}{active&&<span style={{ fontSize:8 }}>{sortDir==='desc'?'↓':'↑'}</span>}</span></th>;
  }

  function Row({fund,rank}) {
    const isAvg=!!fund.isAverage;
    const isSel=!isAvg&&selFund?.name===fund.name&&selCatId===catId;
    return (
      <tr onClick={()=>!isAvg&&onSelect(fund,catId)} style={{ background:isAvg?C.avgBg:isSel?'#FFF0F3':C.white,cursor:isAvg?'default':'pointer',borderBottom:`1px solid #F0EBE6` }} onMouseEnter={e=>{if(!isAvg&&!isSel)e.currentTarget.style.background='#FDF8F6';}} onMouseLeave={e=>{if(!isAvg&&!isSel)e.currentTarget.style.background=C.white;}}>
        <td style={{ ...TD,color:C.muted,textAlign:'center',fontSize:9.5,width:18,padding:'4px 3px' }}>{isAvg?'⌀':rank}</td>
        {!isAvg
          ? <td style={{ ...TD,width:50,padding:'4px',textAlign:'center',whiteSpace:'nowrap' }}>
              <button title="הוסף לחיפוש והשוואת מוצרים"
                onClick={e=>{e.stopPropagation();onAddToComparison&&onAddToComparison(fund);}}
                style={{ background:'none',border:`1.5px solid ${C.border}`,borderRadius:5,cursor:'pointer',fontSize:14,width:22,height:22,display:'inline-flex',alignItems:'center',justifyContent:'center',color:C.muted,transition:'all 0.1s' }}
                onMouseEnter={e=>{e.currentTarget.style.background=C.crimson;e.currentTarget.style.color='white';e.currentTarget.style.borderColor=C.crimson;}}
                onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border;}}>+</button>
              {onAddToChart&&<button title="הוסף לגרף"
                onClick={e=>{e.stopPropagation();onAddToChart(fund);}}
                style={{ background:'none',border:`1.5px solid ${C.border}`,borderRadius:5,cursor:'pointer',fontSize:11,width:22,height:22,display:'inline-flex',alignItems:'center',justifyContent:'center',color:C.muted,transition:'all 0.1s',marginRight:2 }}
                onMouseEnter={e=>{e.currentTarget.style.background='#2563EB';e.currentTarget.style.color='white';e.currentTarget.style.borderColor='#2563EB';}}
                onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border;}}>📈</button>}
            </td>
          : <td style={{ ...TD,width:50 }}></td>}
        <td style={{ ...TD,color:isSel?C.crimson:isAvg?C.dark:C.darkMid,fontWeight:isAvg?700:500 }}><div style={{ whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }} title={fund.name}>{fund.name}</div></td>
        <td style={{ ...TD,textAlign:'center',color:numColor(fund.ret_month),fontWeight:600,fontVariantNumeric:'tabular-nums',background:sortKey==='ret_month'?'rgba(139,26,58,0.03)':'transparent' }}>{pctFmt(fund.ret_month)}</td>
        <td style={{ ...TD,textAlign:'center',color:numColor(fund.ret_ytd),fontWeight:600,fontVariantNumeric:'tabular-nums',background:sortKey==='ret_ytd'?'rgba(139,26,58,0.03)':'transparent' }}>{pctFmt(fund.ret_ytd)}</td>
        <td style={{ ...TD,textAlign:'center',color:numColor(fund.ret_1y),fontWeight:600,fontVariantNumeric:'tabular-nums',background:sortKey==='ret_1y'?'rgba(139,26,58,0.03)':'transparent' }}>{pctFmt(fund.ret_1y)}</td>
        <td style={{ ...TD,textAlign:'center',color:numColor(fund.ret_3y),fontWeight:600,fontVariantNumeric:'tabular-nums',background:sortKey==='ret_3y'?'rgba(139,26,58,0.03)':'transparent' }}>{pctFmt(fund.ret_3y)}</td>
        <td style={{ ...TD,textAlign:'center',color:numColor(fund.ret_5y),fontWeight:600,fontVariantNumeric:'tabular-nums',background:sortKey==='ret_5y'?'rgba(139,26,58,0.03)':'transparent' }}>{pctFmt(fund.ret_5y)}</td>
        <td style={{ ...TD,textAlign:'center',color:'#2563EB',fontWeight:600 }}>{fund.stocks!=null?fund.stocks.toFixed(1)+'%':'—'}</td>
        <td style={{ ...TD,textAlign:'center',color:'#7C3AED',fontWeight:600 }}>{fund.foreign!=null?fund.foreign.toFixed(1)+'%':'—'}</td>
        <td style={{ ...TD,textAlign:'center',color:'#059669',fontWeight:600 }}>{fund.forex!=null?fund.forex.toFixed(1)+'%':'—'}</td>
        <td style={{ ...TD,textAlign:'center',color:'#9CA3AF',fontWeight:600 }}>{fund.illiquid!=null?fund.illiquid.toFixed(1)+'%':'—'}</td>
        <td style={{ ...TD,textAlign:'center',color:C.dark,fontWeight:600 }}>{fund.sharpe!=null?fund.sharpe.toFixed(2):'—'}</td>
        <td style={{ ...TD,textAlign:'center',color:C.crimson,fontWeight:700 }}>{fund.profit_index!=null?fund.profit_index.toFixed(1):'—'}</td>
      </tr>
    );
  }

  return (
    <div id={`sec-${catId}`} style={{ marginBottom:14,scrollMarginTop:104 }}>
      <div style={{ display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:C.darkMid,borderRadius:'8px 8px 0 0' }}>
        <span style={{ fontSize:11.5,fontWeight:800,color:C.white }}>{cat?.label}</span>
        <span style={{ fontSize:10,color:'rgba(255,255,255,0.4)' }}>{cat?.desc}</span>
        <span style={{ marginRight:'auto',fontSize:10,color:'rgba(255,255,255,0.3)' }}>{funds.length} מוצרים</span>
      </div>
      <div style={{ overflowX:'auto',border:`1px solid ${C.border}`,borderTop:'none',borderRadius:'0 0 8px 8px' }}>
        <table style={{ width:'100%',borderCollapse:'collapse',tableLayout:'auto' }}>
          <thead><tr style={{ background:'#2A2A2A' }}>
            <th style={{ ...TH,width:18,color:'rgba(255,255,255,0.4)',padding:'5px 3px' }}>#</th>
            <th style={{ ...TH,width:28,padding:'4px' }}></th>
            <th style={{ ...TH,textAlign:'right',color:'rgba(255,255,255,0.8)' }}>שם המוצר</th>
            <SortTh col={{ key:'ret_month', label:`% ${getLatestMonthName()}`,    tip:'תשואה בחודש האחרון' }}/>
            <SortTh col={{ key:'ret_ytd',   label:'% YTD',      tip:'תשואה מתחילת שנה' }}/>
            <SortTh col={{ key:'ret_1y',    label:'% שנה',      tip:'תשואה שנתית' }}/>
            <SortTh col={{ key:'ret_3y',    label:'% 3 שנים',   tip:'תשואה מצטברת 36 חודשים' }}/>
            <SortTh col={{ key:'ret_5y',    label:'% 5 שנים',   tip:'תשואה מצטברת 60 חודשים' }}/>
            <SortTh col={{ key:'stocks',   label:'% מניות',    tip:'חשיפה למניות',     color:'#93C5FD' }}/>
            <SortTh col={{ key:'foreign',  label:'% חו"ל',     tip:'חשיפה לחו"ל',      color:'#C4B5FD' }}/>
            <SortTh col={{ key:'forex',    label:'% מט"ח',     tip:'חשיפה למט"ח',      color:'#6EE7B7' }}/>
            <SortTh col={{ key:'illiquid', label:'% לא סחיר',  tip:'חשיפה ללא סחיר',   color:'#D1D5DB' }}/>
            <SortTh col={{ key:'sharpe',   label:'מדד שארפ',   tip:'מדד שארפ',          color:'#FCA5A5' }}/>
            <th style={{ ...TH,textAlign:'center',color:'rgba(255,255,255,0.5)' }}>מדד פרוגמלנט</th>
          </tr></thead>
          <tbody>
            {top12.map((f,i)=><Row key={f.name} fund={f} rank={i+1}/>)}
            <Row fund={avg} rank={null}/>
            {showAll&&rest.map((f,i)=><Row key={f.name} fund={f} rank={13+i}/>)}
          </tbody>
        </table>
      </div>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        {rest.length>0&&<button onClick={()=>setShowAll(!showAll)} style={{ background:'transparent',border:'none',color:C.crimson,fontSize:11,cursor:'pointer',fontFamily:'inherit',fontWeight:600,display:'flex',alignItems:'center',gap:4,padding:'4px 2px' }}>{showAll?'▲ הסתר':`▼ הצג עוד ${rest.length} מוצרים`}</button>}
        <button onClick={()=>window.scrollTo({top:0,behavior:'smooth'})} style={{ background:'transparent',border:'none',color:C.muted,fontSize:10.5,cursor:'pointer',fontFamily:'inherit',fontWeight:600,padding:'4px 2px',marginRight:'auto' }}>↑ חזור לראש העמוד</button>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [product, setProduct] = useState('השתלמות');
  const [selFund, setSelFund] = useState(null);
  const [selCatId, setSelCatId] = useState(null);
  const [dataReady, setDataReady] = useState(false);
  const [compSelected, setCompSelected] = useState([]); // קרנות להשוואה — state משותף
  const [addedFund, setAddedFund] = useState(null); // שם קרן שהוספה — לפידבק
  const [sentToChart, setSentToChart] = useState([]); // fund_ids שנשלחו לגרף
  const [sentToMix, setSentToMix]     = useState([]); // fund_ids שנשלחו לגרף תמהיל
  const [activePanelTab, setActivePanelTab] = useState('returns');
  const profitIndex = useProfitIndex();

  // טוען history.json אחד שמכיל הכל
  const [histData, setHistData] = useState(null);
  useEffect(()=>{
    loadData().then(({historyData})=>{
      setHistData(historyData);
      setDataReady(true);
    }).catch(console.error);
  },[]);

  const rawFundsProduct = product||'השתלמות';
  const rawFunds = useMemo(()=>getAllFunds(rawFundsProduct),[rawFundsProduct,dataReady]);
  const funds = useMemo(()=>rawFunds.map(f=>({...f,profit_index:profitIndex[f.name]??f.profit_index??null})),[rawFunds,profitIndex]);
  const allFunds = useMemo(()=>Object.keys(PRODUCT_LABELS).flatMap(p=>getAllFunds(p)),[dataReady]);

  const order = (product||'השתלמות')==='גמל'?GEMEL_ORDER:BASE_ORDER;
  const catIds = useMemo(()=>order.filter(id=>getFundsForCategory(funds,id).length>0),[funds,order]);

  const catFunds = useMemo(()=>{
    if(!selCatId) return [];
    const byCat = getFundsForCategory(funds,selCatId);
    if(byCat.length>0) return byCat;
    // sheet name (לפי קטגוריה) או company name (לפי חברה)
    const bySheet = getSheets(product).includes(selCatId)?getFundsBySheet(product,selCatId):[];
    if(bySheet.length>0) return bySheet;
    return funds.filter(f=>f.company===selCatId||f.managingCompany===selCatId);
  },[selCatId,funds,product]);
  const catAvg = useMemo(()=>catFunds.length>0?calcAverages(catFunds):null,[catFunds]);
  const catFundIds = useMemo(()=>catFunds.map(f=>f.fund_id).filter(Boolean),[catFunds]);
  const catLabel = useMemo(()=>{
    if(!selCatId) return '';
    return CATEGORIES[selCatId]?.label || selCatId;
  },[selCatId]);

  const panelOpen = selFund!==null;
  const PANEL_W = '30%';

  return (
    <div style={{ minHeight:'100vh',background:C.bg,fontFamily:"'Assistant','Heebo',Arial,sans-serif",direction:'rtl' }}>

      <nav data-sticky style={{ background:C.dark,padding:'0 20px',display:'flex',alignItems:'center',justifyContent:'space-between',height:56,position:'sticky',top:0,zIndex:99,boxShadow:'0 2px 10px rgba(0,0,0,0.3)',direction:'ltr' }}>
        <div style={{ color:C.white,fontSize:20,fontWeight:800,letterSpacing:'0.01em' }}>
          ProGemel<span style={{ color:C.crimsonLt }}>Net</span>
        </div>
        <div style={{ color:'rgba(255,255,255,0.45)',fontSize:10.5,direction:'rtl',textAlign:'left' }}>
          מבוסס על נתונים רשמיים של משרד האוצר | גמלנט ביטוחנט • פנסיהנט<br/>
          <UpdatedLabel/>
        </div>
      </nav>

      <div style={{ display:'flex',minHeight:'calc(100vh - 56px)' }}>
        <div style={{ flex:1,minWidth:0,display:'flex',flexDirection:'column' }}>
          <div style={{ padding:'10px 16px 9px',background:C.white,borderBottom:`1px solid ${C.border}` }}>
            <ProductSelector selected={product} onChange={k=>{setProduct(k);setSelFund(null);setSelCatId(null);}}/>
          </div>
          <ComparisonSearch allFunds={allFunds} product={product||'השתלמות'} selected={compSelected} setSelected={setCompSelected} onSelectFund={(f)=>{setSelFund(f);setSelCatId(null);}} setSentToChart={setSentToChart}/>
          {product===null ? (
            <HomePage
              onSelectProduct={(k)=>{setProduct(k);setSelFund(null);setSelCatId(null);}}
              onSelectFund={(productKey,f)=>{setProduct(productKey);setSelFund(f);setSelCatId(null);}}
              compSelected={compSelected}
              setCompSelected={setCompSelected}
              setAddedFund={setAddedFund}/>
          ) : (
            <TrackBrowser product={product} onSelectFund={(f,cid)=>{setSelFund(f);setSelCatId(cid);}} selFund={selFund} order={order} funds={funds}
              onAddToComparison={f=>{ setCompSelected(prev=>prev.find(s=>s.name===f.name)||prev.length>=10?prev:[...prev,f]); setAddedFund(f.name); setTimeout(()=>setAddedFund(null),2500); }}
              onAddToChart={f=>{ if(!f.fund_id) return; if(activePanelTab==='mix') setSentToMix(prev=>[...new Set([...prev,f.fund_id])]); else setSentToChart(prev=>[...new Set([...prev,f.fund_id])]); }}/>
          )}
          <div style={{ padding:'0 0 48px' }}/>
          <footer style={{ background:C.dark,color:'rgba(255,255,255,0.3)',textAlign:'center',padding:'13px',fontSize:11 }}>
            © {new Date().getFullYear()} Profit Financial Group · הנתונים לצורך מידע בלבד ואינם מהווים ייעוץ השקעות
          </footer>
        </div>

        {/* Toast — פידבק הוספה להשוואה */}
        {addedFund&&(
          <div style={{ position:'fixed',bottom:24,right:'50%',transform:'translateX(50%)',background:C.dark,color:C.white,borderRadius:10,padding:'10px 18px',fontSize:12.5,fontWeight:600,zIndex:9999,boxShadow:'0 4px 16px rgba(0,0,0,0.25)',direction:'rtl',display:'flex',alignItems:'center',gap:8,animation:'fadeIn 0.2s ease' }}>
            <span style={{ color:'#86EFAC',fontSize:16 }}>✓</span>
            <span><b style={{ color:'#FFD6DE' }}>{addedFund.slice(0,30)}{addedFund.length>30?'…':''}</b> התווסף לטבלת השוואת מוצרים</span>
          </div>
        )}
        {panelOpen&&(
          <div style={{ position:'fixed',top:56,left:0,width:PANEL_W,height:'calc(100vh - 56px)',overflow:'hidden',zIndex:50,boxShadow:'4px 0 20px rgba(0,0,0,0.15)' }}>
            <FundDetail fund={selFund} onClose={()=>{setSelFund(null);setSelCatId(null);}} catAvg={catAvg} catFundIds={catFundIds} catLabel={catLabel} histData={histData??{}} allFunds={allFunds} externalCompare={activePanelTab==='mix'?sentToMix:sentToChart} onTabChange={setActivePanelTab}/>
          </div>
        )}
      </div>
    </div>
  );
}
