import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// -- Firebase ------------------------------------------------------------------
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, deleteDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// 🔴 REPLACE with your Firebase project config from console.firebase.google.com
const firebaseConfig = {
  apiKey           : process.env.REACT_APP_FIREBASE_API_KEY        || "YOUR_API_KEY",
  authDomain       : process.env.REACT_APP_FIREBASE_AUTH_DOMAIN    || "YOUR_PROJECT.firebaseapp.com",
  projectId        : process.env.REACT_APP_FIREBASE_PROJECT_ID     || "YOUR_PROJECT_ID",
  storageBucket    : process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_ID   || "YOUR_MESSAGING_ID",
  appId            : process.env.REACT_APP_FIREBASE_APP_ID         || "YOUR_APP_ID",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// Railway backend URL  -  update after deploying
const BACKEND_URL   = process.env.REACT_APP_BACKEND_URL || 'https://deltabuddy-backend.onrender.com';
const ADMIN_EMAIL   = 'mirza.hassanuzzaman@gmail.com';


// -- TradingView lightweight-charts loader ------------------------------------─
let lwcPromise = null;
const loadLWC = () => {
  if (lwcPromise) return lwcPromise;
  lwcPromise = new Promise((resolve) => {
    if (window.LightweightCharts) { resolve(window.LightweightCharts); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
    s.onload = () => resolve(window.LightweightCharts);
    document.head.appendChild(s);
  });
  return lwcPromise;
};

function TradingViewChart({ data, indicators, candleType, symbol, timeframe, showLevels=true }) {
  const mainRef  = React.useRef(null);
  const rsiRef   = React.useRef(null);
  const macdRef  = React.useRef(null);
  const chartRef = React.useRef(null);
  const rsiChartRef  = React.useRef(null);
  const macdChartRef = React.useRef(null);

  const showRSI  = indicators.includes('RSI');
  const showMACD = indicators.includes('MACD');

  // -- Helpers ----------------------------------------------------------─
  const buildCandles = (raw) => raw
    .filter(d => d.open && d.close && d.high && d.low)
    .map(d => ({
      time : Math.floor((typeof d.time === 'string' ? new Date(d.time) : d.time instanceof Date ? d.time : new Date(d.time)).getTime() / 1000),
      open : parseFloat(d.open),
      high : parseFloat(d.high),
      low  : parseFloat(d.low),
      close: parseFloat(d.close),
      volume: parseFloat(d.volume || 0),
    }))
    .filter(d => !isNaN(d.time) && d.close > 0)
    .sort((a, b) => a.time - b.time)
    .filter((d, i, arr) => i === 0 || d.time !== arr[i-1].time);

  const calcSMA = (c, p=20) => c.map((x,i) => i < p-1 ? null : { time: x.time, value: c.slice(i-p+1,i+1).reduce((s,v)=>s+v.close,0)/p }).filter(Boolean);
  const calcEMA = (c, p=20) => { const k=2/(p+1); let e=c[0]?.close||0; return c.map((x,i)=>{ if(i===0){e=x.close;return{time:x.time,value:e};} e=x.close*k+e*(1-k); return{time:x.time,value:e}; }); };
  const calcWMA = (c, p=20) => c.map((x,i) => { if(i<p-1)return null; const sl=c.slice(i-p+1,i+1); const w=sl.reduce((s,v,j)=>s+(j+1)*v.close,0); const wd=p*(p+1)/2; return{time:x.time,value:w/wd}; }).filter(Boolean);
  const calcBB  = (c, p=20, m=2) => { const up=[],md=[],lo=[]; c.forEach((x,i)=>{ if(i<p-1)return; const sl=c.slice(i-p+1,i+1).map(v=>v.close); const avg=sl.reduce((s,v)=>s+v,0)/p; const std=Math.sqrt(sl.reduce((s,v)=>s+Math.pow(v-avg,2),0)/p); up.push({time:x.time,value:avg+m*std}); md.push({time:x.time,value:avg}); lo.push({time:x.time,value:avg-m*std}); }); return{up,md,lo}; };
  const calcVWAP = (c) => { let cv=0,cv2=0; return c.map(x=>{ const tp=(x.high+x.low+x.close)/3; cv+=tp*x.volume; cv2+=x.volume; return{time:x.time,value:cv2>0?cv/cv2:x.close}; }); };
  const calcRSI  = (c, p=14) => { const ch=c.map((x,i)=>i===0?0:x.close-c[i-1].close); return c.map((x,i)=>{ if(i<p)return null; const sl=ch.slice(i-p+1,i+1); const ag=sl.filter(v=>v>0).reduce((s,v)=>s+v,0)/p; const al=sl.filter(v=>v<0).map(v=>Math.abs(v)).reduce((s,v)=>s+v,0)/p; const rs=ag/(al||0.001); return{time:x.time,value:100-(100/(1+rs))}; }).filter(Boolean); };
  const calcMACD = (c) => { const e12=calcEMA(c,12),e26=calcEMA(c,26); const macdLine=e26.map((x,i)=>({time:x.time,value:(e12[i+12-26]?.value||x.value)-x.value})); const sig=calcEMA(macdLine.map(x=>({...x,close:x.value})),9); const hist=sig.map((x,i)=>({time:x.time,value:(macdLine[i]?.value||0)-x.value})); return{macdLine:macdLine.slice(26),signal:sig,hist}; };
  const calcATR  = (c, p=14) => { const tr=c.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-c[i-1].close),Math.abs(x.low-c[i-1].close))); return c.map((x,i)=>{ if(i<p)return null; return{time:x.time,value:tr.slice(i-p+1,i+1).reduce((s,v)=>s+v,0)/p}; }).filter(Boolean); };
  const calcSuperTrend = (c, p=10, m=3) => { const atr=calcATR(c,p); const res=[]; let trend=1,lastST=0; c.slice(p).forEach((x,i)=>{ const a=atr[i]?.value||0; const ub=(x.high+x.low)/2+m*a; const lb=(x.high+x.low)/2-m*a; if(trend===1&&x.close<lastST){trend=-1;lastST=ub;} else if(trend===-1&&x.close>lastST){trend=1;lastST=lb;} else{lastST=trend===1?lb:ub;} res.push({time:x.time,value:lastST,color:trend===1?'#4ade80':'#f87171'}); }); return res; };
  const calcIchimoku = (c) => { const high=(sl)=>Math.max(...sl.map(x=>x.high)); const low=(sl)=>Math.min(...sl.map(x=>x.low)); const conv=[],base=[],sA=[],sB=[]; c.forEach((x,i)=>{ if(i>=8){const h=high(c.slice(i-8,i+1)),l=low(c.slice(i-8,i+1));conv.push({time:x.time,value:(h+l)/2});} if(i>=25){const h=high(c.slice(i-25,i+1)),l=low(c.slice(i-25,i+1));base.push({time:x.time,value:(h+l)/2});} if(i>=25){sA.push({time:x.time,value:((conv[i-9]?.value||0)+(base[i-25]?.value||0))/2});} if(i>=51){const h=high(c.slice(i-51,i+1)),l=low(c.slice(i-51,i+1));sB.push({time:x.time,value:(h+l)/2});} }); return{conv,base,sA,sB}; };

  // ── S/R & Levels — Production Quality ────────────────────────────────────
  // 1. Pivot: uses prior FULL DAY's H/L/C (standard institutional formula)
  //    For intraday charts: groups candles into days, uses previous day
  //    For daily+ charts:   uses the candle before the last complete session
  const calcPivotLevels = (candles) => {
    if (candles.length < 2) return null;

    // Group candles by calendar day to find prior day H/L/C
    const days = {};
    candles.forEach(c => {
      const d = new Date(c.time * 1000).toISOString().slice(0, 10);
      if (!days[d]) days[d] = { high: c.high, low: c.low, close: c.close, open: c.open };
      else {
        days[d].high  = Math.max(days[d].high,  c.high);
        days[d].low   = Math.min(days[d].low,   c.low);
        days[d].close = c.close; // last candle of the day
      }
    });

    const dayKeys = Object.keys(days).sort();
    // Use second-to-last completed day as "prior day" (last day may be incomplete)
    const priorKey = dayKeys.length >= 2 ? dayKeys[dayKeys.length - 2] : dayKeys[0];
    const prior    = days[priorKey];

    const H = prior.high, L = prior.low, C = prior.close;
    const P  = (H + L + C) / 3;
    const R1 = (2 * P) - L;
    const S1 = (2 * P) - H;
    const R2 = P + (H - L);
    const S2 = P - (H - L);
    const R3 = H + 2 * (P - L);
    const S3 = L  - 2 * (H - P);

    // Weekly levels — use full available range for context
    const allH = Math.max(...candles.map(c => c.high));
    const allL = Math.min(...candles.map(c => c.low));
    const WR1  = allH;   // recent swing high = key weekly resistance
    const WS1  = allL;   // recent swing low  = key weekly support

    // ATR (14-period) for no-trade zone and zone width
    const atrPeriod = 14;
    const trs = candles.map((c, i) =>
      i === 0 ? c.high - c.low
              : Math.max(c.high - c.low,
                         Math.abs(c.high - candles[i-1].close),
                         Math.abs(c.low  - candles[i-1].close))
    );
    const atr = trs.slice(-atrPeriod).reduce((s, v) => s + v, 0) / atrPeriod;

    return { P, R1, R2, R3, S1, S2, S3, WR1, WS1, atr, priorH: H, priorL: L, priorC: C };
  };

  // 2. Average volume over last N candles
  const avgVolume = (candles, n = 20) => {
    const slice = candles.slice(-n);
    const total = slice.reduce((s, c) => s + (c.volume || 0), 0);
    return total / slice.length || 1;
  };

  // 3. Trap detection — 3-condition confirmation required:
  //    (a) Price action: wick through level + close back on wrong side
  //    (b) Volume: trap candle volume > 1.3× 20-period average (institutions active)
  //    (c) Confirmation: NEXT candle moves strongly in reversal direction
  const detectTraps = (candles, levels) => {
    const traps = [];
    if (!levels || candles.length < 10) return traps;
    const { R1, R2, S1, S2 } = levels;
    const keyLevels = [
      { price: R1, type: 'resistance', label: 'R1' },
      { price: R2, type: 'resistance', label: 'R2' },
      { price: S1, type: 'support',    label: 'S1' },
      { price: S2, type: 'support',    label: 'S2' },
    ];
    const volAvg = avgVolume(candles, 20);

    for (let i = 5; i < candles.length - 1; i++) {
      const trap  = candles[i];       // potential trap candle
      const conf  = candles[i + 1];  // confirmation candle (next)
      const body  = Math.abs(trap.close - trap.open);
      const vol   = trap.volume || 0;

      keyLevels.forEach(({ price: lvl, type, label }) => {

        // ── BULL TRAP at resistance ─────────────────────────────────────
        // Price wicks ABOVE resistance, closes BELOW → trapped bulls
        if (type === 'resistance') {
          const wickAbove    = trap.high - lvl;           // how far above level
          const closeBelow   = lvl - trap.close;          // close below level
          const prevBelow    = candles[i-1].close < lvl;  // prev candle was below
          const confirmBear  = conf.close < conf.open && conf.close < trap.close; // next candle bearish
          const volSpike     = vol > volAvg * 1.3;        // volume confirmation
          const wickSignif   = wickAbove > 0.3 * body;    // wick meaningful vs body

          if (wickAbove > 0 && closeBelow > 0 && prevBelow && confirmBear && volSpike && wickSignif) {
            traps.push({
              time    : trap.time,
              type    : 'bull_trap',
              label   : `🪤 Bull Trap @ ${label}`,
              color   : '#f87171',
              position: 'aboveBar',
              shape   : 'arrowDown',
              vol     : vol, volAvg,
            });
          }
        }

        // ── BEAR TRAP at support ────────────────────────────────────────
        // Price wicks BELOW support, closes ABOVE → trapped bears / stop hunt
        if (type === 'support') {
          const wickBelow    = lvl - trap.low;
          const closeAbove   = trap.close - lvl;
          const prevAbove    = candles[i-1].close > lvl;
          const confirmBull  = conf.close > conf.open && conf.close > trap.close;
          const volSpike     = vol > volAvg * 1.3;
          const wickSignif   = wickBelow > 0.3 * body;

          if (wickBelow > 0 && closeAbove > 0 && prevAbove && confirmBull && volSpike && wickSignif) {
            traps.push({
              time    : trap.time,
              type    : 'bear_trap',
              label   : `🪤 Bear Trap @ ${label}`,
              color   : '#4ade80',
              position: 'belowBar',
              shape   : 'arrowUp',
              vol     : vol, volAvg,
            });
          }
        }
      });

      // ── LIQUIDITY SWEEP ─────────────────────────────────────────────
      // Requires: swing high/low taken out, HIGH volume, strong reversal candle
      // Look for 5-bar swing high/low (more reliable than 3-bar)
      if (i >= 5) {
        const lookback = candles.slice(i - 5, i);
        const swingH   = Math.max(...lookback.map(c => c.high));
        const swingL   = Math.min(...lookback.map(c => c.low));
        const volSpike = vol > volAvg * 1.5; // higher bar for sweeps

        // Sweep high: wick above prior swing high, bearish close, confirmation
        if (
          trap.high > swingH &&
          trap.close < swingH &&             // closed back below
          trap.close < trap.open &&          // bearish candle
          volSpike &&
          conf.close < conf.open &&          // confirmed by next bearish candle
          conf.close < trap.low              // breaks below trap candle low
        ) {
          traps.push({
            time: trap.time, type: 'sweep_high',
            label: '⚡ Stop Hunt High', color: '#fb923c',
            position: 'aboveBar', shape: 'arrowDown',
          });
        }

        // Sweep low: wick below prior swing low, bullish close, confirmation
        if (
          trap.low < swingL &&
          trap.close > swingL &&             // closed back above
          trap.close > trap.open &&          // bullish candle
          volSpike &&
          conf.close > conf.open &&          // confirmed by next bullish candle
          conf.close > trap.high             // breaks above trap candle high
        ) {
          traps.push({
            time: trap.time, type: 'sweep_low',
            label: '⚡ Stop Hunt Low', color: '#a78bfa',
            position: 'belowBar', shape: 'arrowUp',
          });
        }
      }
    }

    // Final dedup: remove signals within 5 candles of each other (same type)
    const deduped = [];
    traps.sort((a, b) => a.time - b.time).forEach(t => {
      const last = deduped.filter(d => d.type === t.type).slice(-1)[0];
      const candleSeconds = (candles[1]?.time - candles[0]?.time) || 300;
      if (!last || (t.time - last.time) > candleSeconds * 5) {
        deduped.push(t);
      }
    });
    return deduped;
  };

  const createSubChart = (container, LWC, h=120) => LWC.createChart(container, {
    width: container.clientWidth, height: h,
    layout: { background:{color:'#070d1a'}, textColor:'#94a3b8', fontSize:10 },
    grid: { vertLines:{color:'rgba(100,116,139,0.08)'}, horzLines:{color:'rgba(100,116,139,0.08)'} },
    rightPriceScale: { borderColor:'#1e293b', scaleMargins:{top:0.1,bottom:0.1} },
    timeScale: { borderColor:'#1e293b', timeVisible:true, secondsVisible:false },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    handleScroll: false, handleScale: false,
  });

  React.useEffect(() => {
    if (!data?.length || !mainRef.current) return;

    loadLWC().then((LWC) => {
      // Destroy previous charts
      [chartRef, rsiChartRef, macdChartRef].forEach(r => { if(r.current){r.current.remove();r.current=null;} });

      const candles = buildCandles(data);
      if (!candles.length) return;

      // -- MAIN CHART ----------------------------------------------------
      const mainHeight = showRSI || showMACD ? 340 : 440;
      const chart = LWC.createChart(mainRef.current, {
        width : mainRef.current.clientWidth,
        height: mainHeight,
        layout: { background:{color:'#070d1a'}, textColor:'#94a3b8', fontSize:11, fontFamily:"'Inter',sans-serif" },
        grid:  { vertLines:{color:'rgba(100,116,139,0.12)'}, horzLines:{color:'rgba(100,116,139,0.12)'} },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        rightPriceScale: { borderColor:'#1e293b', scaleMargins:{top:0.06,bottom:0.22} },
        timeScale: { borderColor:'#1e293b', timeVisible:true, secondsVisible:false },
      });
      chartRef.current = chart;

      // -- Main series (candle type) ------------------------------------─
      let mainSeries;
      switch(candleType) {
        case 'heikinashi': {
          const ha = candles.map((c,i) => {
            const po = i>0 ? (candles[i-1].open+candles[i-1].close)/2 : (c.open+c.close)/2;
            const hc = (c.open+c.high+c.low+c.close)/4;
            const ho = (po+hc)/2;
            return { time:c.time, open:ho, high:Math.max(c.high,ho,hc), low:Math.min(c.low,ho,hc), close:hc };
          });
          mainSeries = chart.addCandlestickSeries({ upColor:'#4ade80', downColor:'#f87171', borderUpColor:'#4ade80', borderDownColor:'#f87171', wickUpColor:'#4ade80', wickDownColor:'#f87171' });
          mainSeries.setData(ha);
          break;
        }
        case 'line':
          mainSeries = chart.addLineSeries({ color:'#4ade80', lineWidth:2 });
          mainSeries.setData(candles.map(c=>({time:c.time,value:c.close})));
          break;
        case 'area':
          mainSeries = chart.addAreaSeries({ lineColor:'#4ade80', topColor:'rgba(74,222,128,0.18)', bottomColor:'rgba(74,222,128,0)', lineWidth:2 });
          mainSeries.setData(candles.map(c=>({time:c.time,value:c.close})));
          break;
        case 'bar':
          mainSeries = chart.addBarSeries({ upColor:'#4ade80', downColor:'#f87171' });
          mainSeries.setData(candles);
          break;
        case 'baseline': {
          const avg = candles.reduce((s,c)=>s+c.close,0)/candles.length;
          mainSeries = chart.addBaselineSeries({ baseValue:{type:'price',price:avg}, topLineColor:'#4ade80', bottomLineColor:'#f87171', topFillColor1:'rgba(74,222,128,0.15)', topFillColor2:'rgba(74,222,128,0.02)', bottomFillColor1:'rgba(248,113,113,0.02)', bottomFillColor2:'rgba(248,113,113,0.15)' });
          mainSeries.setData(candles.map(c=>({time:c.time,value:c.close})));
          break;
        }
        default: // candlestick
          mainSeries = chart.addCandlestickSeries({ upColor:'#4ade80', downColor:'#f87171', borderUpColor:'#4ade80', borderDownColor:'#f87171', wickUpColor:'#4ade80', wickDownColor:'#f87171' });
          mainSeries.setData(candles);
      }

      // -- Volume --------------------------------------------------------
      const vol = chart.addHistogramSeries({ color:'#26a69a', priceFormat:{type:'volume'}, priceScaleId:'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins:{top:0.82,bottom:0} });
      vol.setData(candles.map(c=>({ time:c.time, value:c.volume, color:c.close>=c.open?'rgba(74,222,128,0.35)':'rgba(248,113,113,0.35)' })));

      // -- Overlay indicators --------------------------------------------
      if (indicators.includes('SMA20'))  { const s=chart.addLineSeries({color:'#f59e0b',lineWidth:1.5,title:'SMA 20'});  s.setData(calcSMA(candles,20)); }
      if (indicators.includes('SMA50'))  { const s=chart.addLineSeries({color:'#fb923c',lineWidth:1.5,title:'SMA 50'});  s.setData(calcSMA(candles,50)); }
      if (indicators.includes('SMA200')) { const s=chart.addLineSeries({color:'#f43f5e',lineWidth:2,title:'SMA 200'}); s.setData(calcSMA(candles,200)); }
      if (indicators.includes('EMA9'))   { const s=chart.addLineSeries({color:'#a3e635',lineWidth:1.5,title:'EMA 9'});   s.setData(calcEMA(candles,9)); }
      if (indicators.includes('EMA20'))  { const s=chart.addLineSeries({color:'#818cf8',lineWidth:1.5,title:'EMA 20'});  s.setData(calcEMA(candles,20)); }
      if (indicators.includes('EMA50'))  { const s=chart.addLineSeries({color:'#c084fc',lineWidth:1.5,title:'EMA 50'});  s.setData(calcEMA(candles,50)); }
      if (indicators.includes('WMA'))    { const s=chart.addLineSeries({color:'#34d399',lineWidth:1.5,title:'WMA 20'});  s.setData(calcWMA(candles,20)); }
      if (indicators.includes('VWAP'))   { const s=chart.addLineSeries({color:'#e879f9',lineWidth:1.5,lineStyle:1,title:'VWAP'}); s.setData(calcVWAP(candles)); }
      if (indicators.includes('BB')) {
        const bb=calcBB(candles);
        chart.addLineSeries({color:'rgba(96,165,250,0.7)',lineWidth:1,lineStyle:2,title:'BB Upper'}).setData(bb.up);
        chart.addLineSeries({color:'rgba(96,165,250,0.4)',lineWidth:1,title:'BB Mid'}).setData(bb.md);
        chart.addLineSeries({color:'rgba(96,165,250,0.7)',lineWidth:1,lineStyle:2,title:'BB Lower'}).setData(bb.lo);
      }
      if (indicators.includes('SuperTrend')) {
        const st=calcSuperTrend(candles);
        const stSeries=chart.addLineSeries({lineWidth:2,title:'SuperTrend'});
        stSeries.setData(st.map(x=>({time:x.time,value:x.value})));
        // Color segments
        st.forEach((x,i)=>{ if(i===0)return; stSeries.setMarkers?.([{time:x.time,position:'inBar',color:x.color,shape:'circle',size:0.01}]); });
      }
      if (indicators.includes('Ichimoku')) {
        const ic=calcIchimoku(candles);
        chart.addLineSeries({color:'rgba(96,165,250,0.8)',lineWidth:1,title:'Tenkan'}).setData(ic.conv);
        chart.addLineSeries({color:'rgba(248,113,113,0.8)',lineWidth:1,title:'Kijun'}).setData(ic.base);
        chart.addLineSeries({color:'rgba(74,222,128,0.4)',lineWidth:1,lineStyle:2,title:'Senkou A'}).setData(ic.sA);
        chart.addLineSeries({color:'rgba(248,113,113,0.4)',lineWidth:1,lineStyle:2,title:'Senkou B'}).setData(ic.sB);
      }

      chart.timeScale().fitContent();

      // ── S/R Levels, ATR No-Trade Zone & Volume-Confirmed Traps ─────────────
      if (showLevels && candles.length >= 10) {
        const levels = calcPivotLevels(candles);
        if (levels) {
          const { P, R1, R2, R3, S1, S2, S3, atr, priorH, priorL } = levels;

          const addLine = (price, color, title, style=0, width=1) => {
            try { mainSeries.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }); } catch(e) {}
          };

          // Prior Day High / Low — most important intraday reference
          addLine(priorH, 'rgba(251,191,36,0.9)',  'PDH ──', 2, 1);
          addLine(priorL, 'rgba(96,165,250,0.9)',  'PDL ──', 2, 1);

          // Resistance
          addLine(R3, 'rgba(248,113,113,0.35)', 'R3', 3, 1);
          addLine(R2, 'rgba(248,113,113,0.65)', 'R2', 2, 1);
          addLine(R1, '#f87171',                'R1', 0, 2);

          // Pivot Point
          addLine(P, 'rgba(226,232,240,0.7)', 'PP', 1, 1);

          // Support
          addLine(S1, '#4ade80',                'S1', 0, 2);
          addLine(S2, 'rgba(74,222,128,0.65)',  'S2', 2, 1);
          addLine(S3, 'rgba(74,222,128,0.35)',  'S3', 3, 1);

          // ATR No-Trade Zone = PP ± 0.5×ATR
          // Dynamic: widens in volatile sessions, tightens in calm ones
          const ntUpper = P + 0.5 * atr;
          const ntLower = P - 0.5 * atr;
          addLine(ntUpper, 'rgba(251,191,36,0.5)', 'NTZ▲', 1, 1);
          addLine(ntLower, 'rgba(251,191,36,0.5)', 'NTZ▼', 1, 1);

          // Shade no-trade zone
          try {
            const ntArea = chart.addAreaSeries({
              lineColor: 'rgba(0,0,0,0)', topColor: 'rgba(251,191,36,0.08)',
              bottomColor: 'rgba(251,191,36,0.08)', lineWidth: 0,
              lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
            });
            ntArea.setData(candles.map(c => ({ time: c.time, value: ntUpper })));
          } catch(e) {}
        }

        // Volume-confirmed trap markers
        const traps = detectTraps(candles, levels);
        if (traps.length > 0) {
          const markers = traps.map(t => ({
            time: t.time, position: t.position, color: t.color,
            shape: t.shape, text: t.label, size: 1.5,
          }));
          markers.sort((a, b) => a.time - b.time);
          try { mainSeries.setMarkers(markers); } catch(e) {}
        }
      }

            // -- RSI sub-chart ------------------------------------------------─
      if (showRSI && rsiRef.current) {
        const rsiChart = createSubChart(rsiRef.current, LWC, 110);
        rsiChartRef.current = rsiChart;
        const rsiData = calcRSI(candles);
        const rsiSeries = rsiChart.addLineSeries({ color:'#a78bfa', lineWidth:2, title:'RSI 14' });
        rsiSeries.setData(rsiData);
        rsiChart.addLineSeries({color:'rgba(248,113,113,0.5)',lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false}).setData(rsiData.map(x=>({time:x.time,value:70})));
        rsiChart.addLineSeries({color:'rgba(74,222,128,0.5)',lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false}).setData(rsiData.map(x=>({time:x.time,value:30})));
        // Sync time scales
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => { rsiChart.timeScale().setVisibleLogicalRange(range); });
        rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => { chart.timeScale().setVisibleLogicalRange(range); });
        rsiChart.timeScale().fitContent();
      }

      // -- MACD sub-chart ------------------------------------------------
      if (showMACD && macdRef.current) {
        const macdChart = createSubChart(macdRef.current, LWC, 110);
        macdChartRef.current = macdChart;
        const { macdLine, signal, hist } = calcMACD(candles);
        macdChart.addLineSeries({color:'#60a5fa',lineWidth:1.5,title:'MACD'}).setData(macdLine);
        macdChart.addLineSeries({color:'#f97316',lineWidth:1.5,title:'Signal'}).setData(signal);
        const histSeries = macdChart.addHistogramSeries({ priceScaleId:'right' });
        histSeries.setData(hist.map(x=>({time:x.time,value:x.value,color:x.value>=0?'rgba(74,222,128,0.6)':'rgba(248,113,113,0.6)'})));
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => { macdChart.timeScale().setVisibleLogicalRange(range); });
        macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => { chart.timeScale().setVisibleLogicalRange(range); });
        macdChart.timeScale().fitContent();
      }

      // -- Resize observer ----------------------------------------------─
      const ro = new ResizeObserver(() => {
        [{ ref: mainRef, chart: chartRef }, { ref: rsiRef, chart: rsiChartRef }, { ref: macdRef, chart: macdChartRef }]
          .forEach(({ ref, chart: cRef }) => { if(ref.current && cRef.current) cRef.current.applyOptions({ width: ref.current.clientWidth }); });
      });
      if (mainRef.current) ro.observe(mainRef.current);
      return () => ro.disconnect();
    });

    return () => { [chartRef, rsiChartRef, macdChartRef].forEach(r=>{ if(r.current){r.current.remove();r.current=null;} }); };
  }, [data, indicators, candleType]);

  return (
    <div style={{background:'#070d1a',borderRadius:'8px',overflow:'hidden'}}>
      <div ref={mainRef} style={{width:'100%'}}/>
      {showRSI  && <><div style={{height:'1px',background:'#1e293b'}}/><div style={{padding:'2px 8px',fontSize:'0.65rem',color:'#a78bfa',background:'#070d1a',fontWeight:700}}>RSI 14</div><div ref={rsiRef}  style={{width:'100%'}}/></>}
      {showMACD && <><div style={{height:'1px',background:'#1e293b'}}/><div style={{padding:'2px 8px',fontSize:'0.65rem',color:'#60a5fa',background:'#070d1a',fontWeight:700}}>MACD (12,26,9)</div><div ref={macdRef} style={{width:'100%'}}/></>}
      {showLevels && (
        <div style={{padding:'0.5rem 0.85rem',background:'#070d1a',borderTop:'1px solid rgba(255,255,255,0.06)',display:'flex',flexWrap:'wrap',gap:'0.65rem',alignItems:'center'}}>
          <span style={{fontSize:'0.6rem',color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginRight:'2px'}}>Levels:</span>
          {[
            {color:'rgba(251,191,36,0.9)', dash:true,  label:'PDH / PDL  Prior Day'},
            {color:'#f87171',             dash:false, label:'R1–R3  Resistance'},
            {color:'rgba(226,232,240,0.7)',dash:true,  label:'PP  Pivot'},
            {color:'#4ade80',             dash:false, label:'S1–S3  Support'},
            {color:'rgba(251,191,36,0.5)',dash:true,  label:'⬛ No-Trade Zone (PP±½ATR)'},
            {color:'#f87171',             dash:false, label:'▼ Bull Trap (vol confirmed)'},
            {color:'#4ade80',             dash:false, label:'▲ Bear Trap (vol confirmed)'},
            {color:'#fb923c',             dash:false, label:'▼ Stop Hunt High'},
            {color:'#a78bfa',             dash:false, label:'▲ Stop Hunt Low'},
          ].map((item,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:'0.3rem'}}>
              <div style={{width:'12px',height:'2px',background:item.color,borderRadius:'1px',borderTop:item.dash?'1px dashed '+item.color:'none'}}/>
              <span style={{fontSize:'0.6rem',color:'var(--text-muted)'}}>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RSIChart({ data }) {
  const containerRef = React.useRef(null);
  const chartRef     = React.useRef(null);

  const calcRSI = (candles, period=14) => {
    const result = [];
    for (let i = period; i < candles.length; i++) {
      const gains = [], losses = [];
      for (let j = i - period + 1; j <= i; j++) {
        const diff = candles[j].close - candles[j-1].close;
        if (diff > 0) gains.push(diff); else losses.push(Math.abs(diff));
      }
      const avgG = gains.reduce((s,v)=>s+v,0)  / period;
      const avgL = losses.reduce((s,v)=>s+v,0) / period;
      const rs   = avgL === 0 ? 100 : avgG / avgL;
      result.push({ time: candles[i].time, value: 100 - (100 / (1 + rs)) });
    }
    return result;
  };

  React.useEffect(() => {
    if (!data || data.length === 0 || !containerRef.current) return;

    loadLWC().then((LWC) => {
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

      const chart = LWC.createChart(containerRef.current, {
        width : containerRef.current.clientWidth,
        height: 120,
        layout: { background: { color: '#070d1a' }, textColor: '#94a3b8', fontSize: 10 },
        grid  : { vertLines: { color: 'rgba(100,116,139,0.1)' }, horzLines: { color: 'rgba(100,116,139,0.1)' } },
        rightPriceScale: { borderColor: '#1e293b', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
        crosshair: { mode: LWC.CrosshairMode.Normal },
      });
      chartRef.current = chart;

      const candles = data
        .filter(d => d.open && d.close)
        .map(d => ({ time: Math.floor(new Date(d.time||d.date||d.timestamp).getTime()/1000), close: parseFloat(d.close) }))
        .sort((a,b) => a.time - b.time)
        .filter((d,i,arr) => i===0 || d.time !== arr[i-1].time);

      const rsiData = calcRSI(candles);
      const rsiSeries = chart.addLineSeries({ color: '#a78bfa', lineWidth: 2, title: 'RSI 14' });
      rsiSeries.setData(rsiData);

      // Overbought/oversold lines
      const obSeries = chart.addLineSeries({ color: 'rgba(248,113,113,0.5)', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      const osSeries = chart.addLineSeries({ color: 'rgba(74,222,128,0.5)',  lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      if (rsiData.length > 0) {
        const t0 = rsiData[0].time, t1 = rsiData[rsiData.length-1].time;
        obSeries.setData([{time:t0,value:70},{time:t1,value:70}]);
        osSeries.setData([{time:t0,value:30},{time:t1,value:30}]);
      }
      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    });

    return () => { if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
  }, [data]);

  return (
    <div style={{borderTop:'1px solid #1e293b',background:'#070d1a',paddingBottom:'4px'}}>
      <div style={{padding:'4px 1rem',fontSize:'0.72rem',color:'#a78bfa',fontWeight:600}}>RSI 14</div>
      <div ref={containerRef} style={{width:'100%',height:'120px'}}/>
    </div>
  );
}




const normalCDF = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
};

const calculateBlackScholes = (spot, strike, timeToExpiry, volatility, riskFreeRate, optionType) => {
  const d1 = (Math.log(spot / strike) + (riskFreeRate + volatility * volatility / 2) * timeToExpiry) / (volatility * Math.sqrt(timeToExpiry));
  const d2 = d1 - volatility * Math.sqrt(timeToExpiry);
  
  if (optionType === 'call') {
    const price = spot * normalCDF(d1) - strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2);
    const delta = normalCDF(d1);
    const gamma = Math.exp(-d1 * d1 / 2) / (spot * volatility * Math.sqrt(2 * Math.PI * timeToExpiry));
    const theta = -(spot * Math.exp(-d1 * d1 / 2) * volatility) / (2 * Math.sqrt(2 * Math.PI * timeToExpiry)) - riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2);
    const vega = spot * Math.sqrt(timeToExpiry) * Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);
    
    return { price, delta, gamma, theta: theta / 365, vega: vega / 100 };
  } else {
    const price = strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2) - spot * normalCDF(-d1);
    const delta = normalCDF(d1) - 1;
    const gamma = Math.exp(-d1 * d1 / 2) / (spot * volatility * Math.sqrt(2 * Math.PI * timeToExpiry));
    const theta = -(spot * Math.exp(-d1 * d1 / 2) * volatility) / (2 * Math.sqrt(2 * Math.PI * timeToExpiry)) + riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2);
    const vega = spot * Math.sqrt(timeToExpiry) * Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);
    
    return { price, delta, gamma, theta: theta / 365, vega: vega / 100 };
  }
};

const STRATEGY_TEMPLATES = {
  // ── BULLISH ──────────────────────────────────────────────────────────────
  'long-call': {
    name:'Long Call', view:'bullish', risk:'Defined',
    description:'Buy ATM/OTM call. Unlimited upside, premium is max loss.',
    legs:[{ position:'buy', optionType:'call', strikeOffset:0, premiumPercent:1.0 }]
  },
  'bull-call-spread': {
    name:'Bull Call Spread', view:'bullish', risk:'Defined',
    description:'Buy lower call, sell higher call. Cheap directional bet.',
    legs:[
      { position:'buy',  optionType:'call', strikeOffset:0,   premiumPercent:1.0 },
      { position:'sell', optionType:'call', strikeOffset:100, premiumPercent:0.5 }
    ]
  },
  'bull-put-spread': {
    name:'Bull Put Spread', view:'bullish', risk:'Defined',
    description:'Sell higher put, buy lower put. Credit received upfront.',
    legs:[
      { position:'sell', optionType:'put', strikeOffset:0,    premiumPercent:1.0 },
      { position:'buy',  optionType:'put', strikeOffset:-100, premiumPercent:0.5 }
    ]
  },
  'synthetic-long': {
    name:'Synthetic Long', view:'bullish', risk:'Unlimited',
    description:'Buy call + sell put at same strike. Replicates futures position.',
    legs:[
      { position:'buy',  optionType:'call', strikeOffset:0, premiumPercent:1.0 },
      { position:'sell', optionType:'put',  strikeOffset:0, premiumPercent:1.0 }
    ]
  },
  'call-ratio-backspread': {
    name:'Call Ratio Backspread', view:'bullish', risk:'Defined',
    description:'Sell 1 lower call, buy 2 higher calls. Profits from big rally.',
    legs:[
      { position:'sell', optionType:'call', strikeOffset:0,   premiumPercent:1.0, quantity:1 },
      { position:'buy',  optionType:'call', strikeOffset:100, premiumPercent:0.5, quantity:2 }
    ]
  },
  // ── BEARISH ──────────────────────────────────────────────────────────────
  'long-put': {
    name:'Long Put', view:'bearish', risk:'Defined',
    description:'Buy ATM/OTM put. Profits from fall, premium is max loss.',
    legs:[{ position:'buy', optionType:'put', strikeOffset:0, premiumPercent:1.0 }]
  },
  'bear-put-spread': {
    name:'Bear Put Spread', view:'bearish', risk:'Defined',
    description:'Buy higher put, sell lower put. Limited cost bearish trade.',
    legs:[
      { position:'buy',  optionType:'put', strikeOffset:0,    premiumPercent:1.0 },
      { position:'sell', optionType:'put', strikeOffset:-100, premiumPercent:0.5 }
    ]
  },
  'bear-call-spread': {
    name:'Bear Call Spread', view:'bearish', risk:'Defined',
    description:'Sell lower call, buy higher call. Credit received, bearish view.',
    legs:[
      { position:'sell', optionType:'call', strikeOffset:0,   premiumPercent:1.0 },
      { position:'buy',  optionType:'call', strikeOffset:100, premiumPercent:0.5 }
    ]
  },
  'synthetic-short': {
    name:'Synthetic Short', view:'bearish', risk:'Unlimited',
    description:'Sell call + buy put at same strike. Replicates short futures.',
    legs:[
      { position:'sell', optionType:'call', strikeOffset:0, premiumPercent:1.0 },
      { position:'buy',  optionType:'put',  strikeOffset:0, premiumPercent:1.0 }
    ]
  },
  'put-ratio-backspread': {
    name:'Put Ratio Backspread', view:'bearish', risk:'Defined',
    description:'Sell 1 higher put, buy 2 lower puts. Profits from big crash.',
    legs:[
      { position:'sell', optionType:'put', strikeOffset:0,    premiumPercent:1.0, quantity:1 },
      { position:'buy',  optionType:'put', strikeOffset:-100, premiumPercent:0.5, quantity:2 }
    ]
  },
  // ── SIDEWAYS ─────────────────────────────────────────────────────────────
  'short-straddle': {
    name:'Short Straddle', view:'sideways', risk:'Unlimited',
    description:'Sell ATM call + put. Max profit if market stays flat.',
    legs:[
      { position:'sell', optionType:'call', strikeOffset:0, premiumPercent:1.0 },
      { position:'sell', optionType:'put',  strikeOffset:0, premiumPercent:1.0 }
    ]
  },
  'short-strangle': {
    name:'Short Strangle', view:'sideways', risk:'Unlimited',
    description:'Sell OTM call + OTM put. Wider range than straddle, lower credit.',
    legs:[
      { position:'sell', optionType:'call', strikeOffset:100, premiumPercent:0.7 },
      { position:'sell', optionType:'put',  strikeOffset:-100,premiumPercent:0.7 }
    ]
  },
  'iron-condor': {
    name:'Iron Condor', view:'sideways', risk:'Defined',
    description:'Sell OTM strangle + buy wings. Best strategy for range-bound markets.',
    legs:[
      { position:'buy',  optionType:'put',  strikeOffset:-200, premiumPercent:0.3 },
      { position:'sell', optionType:'put',  strikeOffset:-100, premiumPercent:0.6 },
      { position:'sell', optionType:'call', strikeOffset:100,  premiumPercent:0.6 },
      { position:'buy',  optionType:'call', strikeOffset:200,  premiumPercent:0.3 }
    ]
  },
  'iron-butterfly': {
    name:'Iron Butterfly', view:'sideways', risk:'Defined',
    description:'Sell ATM straddle + buy OTM wings. Higher credit than condor.',
    legs:[
      { position:'buy',  optionType:'put',  strikeOffset:-200, premiumPercent:0.4 },
      { position:'sell', optionType:'put',  strikeOffset:0,    premiumPercent:1.0 },
      { position:'sell', optionType:'call', strikeOffset:0,    premiumPercent:1.0 },
      { position:'buy',  optionType:'call', strikeOffset:200,  premiumPercent:0.4 }
    ]
  },
  'jade-lizard': {
    name:'Jade Lizard', view:'sideways', risk:'Defined',
    description:'Sell OTM put + sell OTM call spread. No upside risk.',
    legs:[
      { position:'sell', optionType:'put',  strikeOffset:-100, premiumPercent:0.7 },
      { position:'sell', optionType:'call', strikeOffset:100,  premiumPercent:0.6 },
      { position:'buy',  optionType:'call', strikeOffset:200,  premiumPercent:0.3 }
    ]
  },
  // ── VOLATILE ─────────────────────────────────────────────────────────────
  'long-straddle': {
    name:'Long Straddle', view:'volatile', risk:'Defined',
    description:'Buy ATM call + put. Profits from any big move. Best before events.',
    legs:[
      { position:'buy', optionType:'call', strikeOffset:0, premiumPercent:1.0 },
      { position:'buy', optionType:'put',  strikeOffset:0, premiumPercent:1.0 }
    ]
  },
  'long-strangle': {
    name:'Long Strangle', view:'volatile', risk:'Defined',
    description:'Buy OTM call + OTM put. Cheaper than straddle, needs bigger move.',
    legs:[
      { position:'buy', optionType:'call', strikeOffset:100,  premiumPercent:0.7 },
      { position:'buy', optionType:'put',  strikeOffset:-100, premiumPercent:0.7 }
    ]
  },
  'butterfly-spread': {
    name:'Butterfly Spread', view:'volatile', risk:'Defined',
    description:'Buy wings, sell 2 ATM calls. Profits if market stays near center.',
    legs:[
      { position:'buy',  optionType:'call', strikeOffset:-100, premiumPercent:1.2, quantity:1 },
      { position:'sell', optionType:'call', strikeOffset:0,    premiumPercent:0.8, quantity:2 },
      { position:'buy',  optionType:'call', strikeOffset:100,  premiumPercent:0.5, quantity:1 }
    ]
  },
  'reverse-iron-condor': {
    name:'Reverse Iron Condor', view:'volatile', risk:'Defined',
    description:'Buy OTM strangle + sell wings. Profits from big move either way.',
    legs:[
      { position:'sell', optionType:'put',  strikeOffset:-200, premiumPercent:0.3 },
      { position:'buy',  optionType:'put',  strikeOffset:-100, premiumPercent:0.6 },
      { position:'buy',  optionType:'call', strikeOffset:100,  premiumPercent:0.6 },
      { position:'sell', optionType:'call', strikeOffset:200,  premiumPercent:0.3 }
    ]
  },
};


const YAHOO = `${BACKEND_URL}/api/yahoo`;
const GROQ  = `${BACKEND_URL}/api`;

// ── PRO GATE COMPONENT ─────────────────────────────────────────────────────────
// Wraps any feature with a lock screen when user is not Pro
function ProGate({ isActive, onUpgrade, feature, description, children, inline = false }) {
  if (isActive) return children;

  if (inline) {
    // Compact lock — used inside tabs/buttons
    return (
      <div onClick={onUpgrade} style={{
        display:'inline-flex', alignItems:'center', gap:'0.4rem',
        background:'rgba(249,115,22,0.1)', border:'1px solid rgba(249,115,22,0.3)',
        borderRadius:'8px', padding:'0.35rem 0.85rem', cursor:'pointer',
        fontSize:'0.82rem', fontWeight:700, color:'#f97316',
      }}>
        🔒 Pro
      </div>
    );
  }

  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      minHeight:'60vh', padding:'2rem', textAlign:'center',
    }}>
      <div style={{
        background:'linear-gradient(135deg,rgba(249,115,22,0.08),rgba(251,191,36,0.08))',
        border:'1px solid rgba(249,115,22,0.25)', borderRadius:'20px',
        padding:'2.5rem 2rem', maxWidth:'420px', width:'100%',
      }}>
        <div style={{fontSize:'3rem', marginBottom:'1rem'}}>🔒</div>
        <div style={{
          fontWeight:800, fontSize:'1.2rem', color:'var(--text-main)',
          marginBottom:'0.5rem',
        }}>
          {feature}
        </div>
        <div style={{
          fontSize:'0.88rem', color:'var(--text-dim)', lineHeight:1.7,
          marginBottom:'1.75rem',
        }}>
          {description}
        </div>
        <button onClick={onUpgrade} style={{
          background:'linear-gradient(135deg,#f97316,#fbbf24)',
          color:'#000', border:'none', borderRadius:'12px',
          padding:'0.85rem 2.5rem', fontWeight:800, fontSize:'1rem',
          cursor:'pointer', width:'100%', marginBottom:'0.75rem',
        }}>
          Upgrade to Pro
        </button>
        <div style={{fontSize:'0.75rem', color:'var(--text-muted)'}}>
          Cancel anytime - No lock-in
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [analyseSubTab, setAnalyseSubTab] = useState('strategy');   // strategy | scanner | single
  const [tradesSubTab,  setTradesSubTab]  = useState('paper');       // paper | journal | backtest
  
  const [spot, setSpot] = useState(25500);
  const [strike, setStrike] = useState(25500);
  const [premium, setPremium] = useState(150);
  const [lotSize, setLotSize] = useState(65);
  const [daysToExpiry, setDaysToExpiry] = useState(7);
  const [volatility, setVolatility] = useState(15);
  const [optionType, setOptionType] = useState('call');
  const [positionType, setPositionType] = useState('buy');
  const [showGreeks, setShowGreeks] = useState(false);

  const [legs, setLegs] = useState([
    { id: 1, position: 'buy', optionType: 'call', strike: 23500, premium: 150, quantity: 1 }
  ]);
  const [selectedStrategy, setSelectedStrategy] = useState('');

  const [savedStrategies, setSavedStrategies] = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [strategyName, setStrategyName] = useState('');
  const [strategyNotes, setStrategyNotes] = useState('');
  
  const [accountSize, setAccountSize] = useState(500000);
  const [riskPercent, setRiskPercent] = useState(2);
  const [showPositionSizing, setShowPositionSizing] = useState(false);

  // NEWS INTELLIGENCE SYSTEM
  // News fetched via backend RSS proxy  -  no API key needed
  const [intelligentNews, setIntelligentNews] = useState([]);
  const [isLoadingNews, setIsLoadingNews] = useState(false);

  // Settings
  // TRADE JOURNAL & PSYCHOLOGY
  const [tradeLog,        setTradeLog]        = useState(() => { try { return JSON.parse(localStorage.getItem('db_tradelog')||'[]'); } catch(e){ return []; } });
  const [showTradeEntry,  setShowTradeEntry]  = useState(false);
  const [tradeForm,       setTradeForm]       = useState({symbol:'NIFTY',type:'CE',strike:'',expiry:'',action:'BUY',qty:1,entryPrice:'',exitPrice:'',notes:'',emotion:'Calm',reason:'Setup'});
  const [journalFilter,   setJournalFilter]   = useState('all');
  const [cooldownActive,  setCooldownActive]  = useState(false);
  const [cooldownEnd,     setCooldownEnd]     = useState(null);
  useEffect(() => { localStorage.setItem('db_tradelog', JSON.stringify(tradeLog)); }, [tradeLog]);

  // -- Auth state ----------------------------------------------------------─
  const [currentUser,     setCurrentUser]     = useState(null);
  const [authLoading,     setAuthLoading]     = useState(true);
  const [showAuthModal,   setShowAuthModal]   = useState(false);
  const [authMode,        setAuthMode]        = useState('login');   // 'login' | 'signup'
  const [authEmail,       setAuthEmail]       = useState('');
  const [authPassword,    setAuthPassword]    = useState('');
  const [authName,        setAuthName]        = useState('');
  const [authError,       setAuthError]       = useState('');
  const [authSubmitting,  setAuthSubmitting]  = useState(false);

  const [showMobileMenu,   setShowMobileMenu]   = useState(false);
  const [activeMarketsTab, setActiveMarketsTab] = useState('option-chain');
  const [deepDiveSymbol,   setDeepDiveSymbol]   = useState('');
  const [deepDiveData,     setDeepDiveData]     = useState(null);
  const [deepDiveLoading,  setDeepDiveLoading]  = useState(false);
  // Backtester state
  const [btSymbol,         setBtSymbol]         = useState('NIFTY');
  const [btStrategy,       setBtStrategy]       = useState('ma_crossover');
  const [btTimeframe,      setBtTimeframe]      = useState('1D');
  const [btPeriod,         setBtPeriod]         = useState('1y');
  const [btCapital,        setBtCapital]        = useState(100000);
  const [btRunning,        setBtRunning]        = useState(false);
  const [btResult,         setBtResult]         = useState(null);
  const [btParams,         setBtParams]         = useState({ fastMA:10, slowMA:30, rsiOB:70, rsiOS:30, breakoutBars:5, lotSize:75 });
  const [showSettings,     setShowSettings]     = useState(false);
  const [showTgSetup,      setShowTgSetup]      = useState(false);
  const [isAdmin,          setIsAdmin]          = useState(false);
  const [groqApiKey,       setGroqApiKey]       = useState(() => localStorage.getItem('db_groq_key')   || '');
  const [tgChatId,         setTgChatId]         = useState(() => localStorage.getItem('db_tg_chatid')  || '');
  const sentTgAlerts = React.useRef(new Set()); // track sent alerts to prevent duplicates
  const [tgStatus,         setTgStatus]         = useState('idle');
  const [groqStatus,       setGroqStatus]       = useState('idle');
  const [notifyHighImpact, setNotifyHighImpact] = useState(() => localStorage.getItem('db_notify_hi') !== 'false');
  const [notifyScanner,    setNotifyScanner]    = useState(() => localStorage.getItem('db_notify_sc') !== 'false');
  // Paper Trading state
  const [paperBalance,     setPaperBalance]     = useState(() => parseFloat(localStorage.getItem('db_paper_balance') || '500000'));
  const [paperPositions,   setPaperPositions]   = useState(() => { try { return JSON.parse(localStorage.getItem('db_paper_positions') || '[]'); } catch(e) { return []; } });
  const [paperHistory,     setPaperHistory]     = useState(() => { try { return JSON.parse(localStorage.getItem('db_paper_history') || '[]'); } catch(e) { return []; } });
  const [paperOrder,       setPaperOrder]       = useState({ symbol:'NIFTY', type:'BUY', qty:1, price:'', orderType:'MARKET' });
  const [paperMsg,         setPaperMsg]         = useState('');
  // Portfolio / Broker state
  useEffect(() => { localStorage.setItem('db_groq_key',  groqApiKey);       }, [groqApiKey]);
  useEffect(() => { localStorage.setItem('db_tg_chatid', tgChatId);         }, [tgChatId]);
  useEffect(() => { localStorage.setItem('db_notify_hi', notifyHighImpact); }, [notifyHighImpact]);
  useEffect(() => { localStorage.setItem('db_notify_sc', notifyScanner);    }, [notifyScanner]);
  useEffect(() => { localStorage.setItem('db_paper_balance',   paperBalance.toString()); }, [paperBalance]);
  useEffect(() => { localStorage.setItem('db_paper_positions', JSON.stringify(paperPositions)); }, [paperPositions]);
  useEffect(() => { localStorage.setItem('db_paper_history',   JSON.stringify(paperHistory)); }, [paperHistory]);


  // -- Stock Deep Dive ------------------------------------------------------
  const runDeepDive = async (symbol) => {
    if (!symbol) return;
    setDeepDiveLoading(true);
    setDeepDiveData(null);
    const SYM = symbol.toUpperCase().trim();

    // FnO company meta
    const FNO_META = {
      RELIANCE:  { name:'Reliance Industries', sector:'Energy / Refining', lot:250, desc:'India largest company by revenue. Oil-to-chemicals, retail (JioMart), Jio telecom.' },
      TCS:       { name:'Tata Consultancy Services', sector:'IT Services', lot:150, desc:'Largest IT exporter. Consistent dividend payer, low leverage, global clients.' },
      HDFCBANK:  { name:'HDFC Bank', sector:'Private Banking', lot:550, desc:'Largest private bank by assets. Known for low NPAs and consistent growth.' },
      ICICIBANK: { name:'ICICI Bank', sector:'Private Banking', lot:700, desc:'Second largest private bank. Strong retail lending and digital banking push.' },
      INFY:      { name:'Infosys', sector:'IT Services', lot:400, desc:'Second largest IT exporter. Volatile on US tech spending cycles.' },
      SBIN:      { name:'State Bank of India', sector:'PSU Banking', lot:1500, desc:'Largest PSU bank. Sensitive to government policy and NPA cycles.' },
      AXISBANK:  { name:'Axis Bank', sector:'Private Banking', lot:1200, desc:'Third largest private bank. Beneficiary of credit growth cycle.' },
      ITC:       { name:'ITC Limited', sector:'FMCG / Tobacco', lot:3200, desc:'Dominant cigarettes market share. Growing FMCG and hotels businesses.' },
      BAJFINANCE:{ name:'Bajaj Finance', sector:'NBFC', lot:125, desc:'Largest NBFC. Premium valuation. Sensitive to rate cycles.' },
      WIPRO:     { name:'Wipro', sector:'IT Services', lot:3000, desc:'IT services with global delivery. Slower growth vs TCS/Infy.' },
      NIFTY:     { name:'Nifty 50 Index', sector:'Index', lot:75, desc:'Benchmark index of 50 large-cap Indian stocks.' },
      BANKNIFTY: { name:'Bank Nifty Index', sector:'Banking Index', lot:15, desc:'Index of the 12 most liquid banking stocks on NSE.' },
    };

    const meta = FNO_META[SYM] || { name: SYM, sector: 'FnO Stock', lot: 1, desc: 'FnO stock on NSE.' };

    // Get option chain data from existing chain if same symbol
    let chainData = liveOptionChain;
    if (selectedUnderlying !== SYM) {
      // Quick fetch from backend
      try {
        const r = await fetch(`${BACKEND_URL}/api/option-chain?symbol=${SYM}`);
        if (r.ok) {
          const j = await r.json();
          const data = j?.records?.data || [];
          const spot = j?.records?.underlyingValue || 0;
          chainData = data.slice(0,20).map(row=>({
            strike: row.strikePrice,
            ce: { oi: row.CE?.openInterest||0, ltp: row.CE?.lastPrice||0, iv: row.CE?.impliedVolatility||0 },
            pe: { oi: row.PE?.openInterest||0, ltp: row.PE?.lastPrice||0, iv: row.PE?.impliedVolatility||0 },
          }));
        }
      } catch(e) { chainData = liveOptionChain; }
    }

    // Compute OI analysis
    const ceTop = [...chainData].sort((a,b)=>(b.ce?.oi||0)-(a.ce?.oi||0)).slice(0,3);
    const peTop = [...chainData].sort((a,b)=>(b.pe?.oi||0)-(a.pe?.oi||0)).slice(0,3);
    const totalCE = chainData.reduce((s,r)=>s+(r.ce?.oi||0),0);
    const totalPE = chainData.reduce((s,r)=>s+(r.pe?.oi||0),0);
    const pcr = totalCE>0 ? (totalPE/totalCE).toFixed(2) : '-';
    const pcrSentiment = parseFloat(pcr)>1.2?'Bullish':parseFloat(pcr)<0.8?'Bearish':'Neutral';

    // AI strategy suggestion
    let strategy = null;
    if (groqApiKey) {
      try {
        const prompt = `You are an expert options trader. Analyze this FnO stock: ${SYM} (${meta.name}), Sector: ${meta.sector}.
PCR: ${pcr} (${pcrSentiment}). Top CE OI strikes (resistance): ${ceTop.map(r=>r.strike).join(', ')}. Top PE OI strikes (support): ${peTop.map(r=>r.strike).join(', ')}.
Suggest ONE specific options strategy for a retail trader. Respond ONLY in this JSON:
{"strategy":"strategy name","action":"exact trade eg Buy 25500CE","reasoning":"2 sentences max","risk":"Low/Medium/High","timeframe":"intraday/weekly/monthly","sentiment":"Bullish/Bearish/Neutral"}`;
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqApiKey.trim()},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],max_tokens:200,temperature:0.3})});
        const j = await r.json();
        const text = j?.choices?.[0]?.message?.content||'';
        const clean = text.replace(/```json|```/g,'').trim();
        strategy = JSON.parse(clean);
      } catch(e) { strategy = null; }
    }

    setDeepDiveData({ meta, chainData, ceTop, peTop, pcr, pcrSentiment, strategy, symbol: SYM });
    setDeepDiveLoading(false);
  };


  // -- Backtest Engine ------------------------------------------------------
  const runBacktest = async () => {
    setBtRunning(true); setBtResult(null);

    // Fetch historical data
    const ticker = (CHART_YAHOO_MAP[btSymbol]||btSymbol+'.NS').trim();
    const tfMap  = { '1D':'1d','1W':'1wk','1M':'1mo' };
    const rangeMap = { '3m':'3mo','6m':'6mo','1y':'1y','2y':'2y','5y':'5y' };
    const interval = tfMap[btTimeframe]||'1d';
    // Weekly needs more history to generate enough signals
    const effectivePeriod = btTimeframe === '1W' && btPeriod === '1y' ? '3y' : btPeriod;
    const range    = rangeMap[effectivePeriod]||'1y';

    let candles = [];
    try {
      const res  = await fetch(`${BACKEND_URL}/api/yahoo/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const ts=result?.timestamp, q=result?.indicators?.quote?.[0];
      if (ts && q) {
        candles = ts.map((t,i)=>({
          date  : new Date(t*1000).toISOString().split('T')[0],
          time  : t*1000,
          open  : parseFloat((q.open[i]||0).toFixed(2)),
          high  : parseFloat((q.high[i]||0).toFixed(2)),
          low   : parseFloat((q.low[i]||0).toFixed(2)),
          close : parseFloat((q.close[i]||0).toFixed(2)),
          volume: q.volume[i]||0,
        })).filter(c=>c.close>0);
      }
    } catch(e) { console.warn('BT fetch error:', e); }

    if (candles.length < 30) {
      setBtResult({ error: 'Not enough data. Try a longer period or different symbol.' });
      setBtRunning(false); return;
    }

    // -- Helper: SMA --
    const sma = (arr, p) => arr.map((v,i) => i<p-1 ? null : arr.slice(i-p+1,i+1).reduce((s,x)=>s+x,0)/p);

    // -- Helper: RSI --
    const rsi = (closes, p=14) => closes.map((_,i)=>{
      if(i<p) return null;
      const slice = closes.slice(i-p,i);
      const gains = [], losses = [];
      for(let j=1;j<slice.length;j++){
        const d=slice[j]-slice[j-1];
        if(d>0) gains.push(d); else losses.push(Math.abs(d));
      }
      const ag=gains.reduce((s,v)=>s+v,0)/p||0;
      const al=losses.reduce((s,v)=>s+v,0)/p||0;
      return al===0?100:100-(100/(1+ag/al));
    });

    // -- Helper: Black-Scholes approx for options P&L --
    const bsPrice = (S, K, T, r=0.065, sigma=0.16, type='CE') => {
      if(T<=0) return Math.max(0, type==='CE'?S-K:K-S);
      const d1 = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
      const d2 = d1-sigma*Math.sqrt(T);
      const N  = x => { const a=1/(1+0.2316419*Math.abs(x)); const k=a*(0.319381530+a*(-0.356563782+a*(1.781477937+a*(-1.821255978+a*1.330274429)))); return x>=0?1-0.3989422802*Math.exp(-x*x/2)*k:0.3989422802*Math.exp(-x*x/2)*k; };
      return type==='CE' ? S*N(d1)-K*Math.exp(-r*T)*N(d2) : K*Math.exp(-r*T)*N(-d2)-S*N(-d1);
    };

    const closes = candles.map(c=>c.close);
    const { fastMA, slowMA, rsiOB, rsiOS, breakoutBars, lotSize } = btParams;
    const lot = parseInt(lotSize)||75;

    let trades = [];
    let equity = [{ date: candles[0].date, value: btCapital }];
    let cash   = btCapital;
    let position = null; // { type, entry, entryDate, strike, optionType, daysToExpiry }

    // -- Strategy engines --
    const fastSMA = sma(closes, fastMA);
    const slowSMA = sma(closes, slowMA);
    const rsiVals = rsi(closes);

    for (let i = Math.max(fastMA, slowMA, 30); i < candles.length; i++) {
      const c    = candles[i];
      const prev = candles[i-1];
      const S    = c.close;

      // -- ENTRY SIGNALS --
      let signal = null;
      if (btStrategy === 'ma_crossover') {
        const curF=fastSMA[i], curS=slowSMA[i], prvF=fastSMA[i-1], prvS=slowSMA[i-1];
        if(curF&&curS&&prvF&&prvS){
          if(prvF<=prvS && curF>curS) signal='LONG';
          if(prvF>=prvS && curF<curS) signal='SHORT';
        }
      } else if (btStrategy === 'rsi') {
        const r=rsiVals[i], rp=rsiVals[i-1];
        if(r&&rp){ if(rp<=rsiOS && r>rsiOS) signal='LONG'; if(rp>=rsiOB && r<rsiOB) signal='SHORT'; }
      } else if (btStrategy === 'breakout') {
        const hiN = Math.max(...candles.slice(i-breakoutBars,i).map(c=>c.high));
        const loN = Math.min(...candles.slice(i-breakoutBars,i).map(c=>c.low));
        if(c.close>hiN && prev.close<=hiN) signal='LONG';
        if(c.close<loN && prev.close>=loN) signal='SHORT';
      } else if (btStrategy === 'straddle_sell') {
        // Sell ATM straddle: enter on Mondays, exit on Thursday close (weekly expiry)
        const day = new Date(c.time).getDay();
        if(day===1 && !position) signal='SELL_STRADDLE';
        if(day===4 && position)  signal='EXIT_STRADDLE';
      } else if (btStrategy === 'straddle_buy') {
        // Buy same-strike straddle: enter on Monday, exit on big move (>1.5%) or Thursday
        const day = new Date(c.time).getDay();
        if(day===1 && !position) signal='BUY_STRADDLE';
        if(position && position.type==='BUY_STRADDLE') {
          const move = Math.abs(S - position.entrySpot) / position.entrySpot;
          if(move > 0.015 || day===4) signal='EXIT_BUY_STRADDLE';
        }
      } else if (btStrategy === 'synthetic_future') {
        // Synthetic future: Buy CE + Sell PE at same ATM strike
        // Enter on MA crossover signal, exit on reverse
        const curF=fastSMA[i], curS=slowSMA[i], prvF=fastSMA[i-1], prvS=slowSMA[i-1];
        if(curF&&curS&&prvF&&prvS){
          if(prvF<=prvS && curF>curS) signal='SYNTH_LONG';
          if(prvF>=prvS && curF<curS) signal='SYNTH_EXIT';
        }
      } else if (btStrategy === 'futures' || btStrategy === 'futures_ma') {
        // Pure futures: buy/sell at spot, P&L = (exit-entry)*lot. Margin ~10%.
        const curF=fastSMA[i], curS=slowSMA[i], prvF=fastSMA[i-1], prvS=slowSMA[i-1];
        if(curF&&curS&&prvF&&prvS){
          if(prvF<=prvS && curF>curS) signal='FUT_LONG';
          if(prvF>=prvS && curF<curS) signal='FUT_SHORT';
        }
      }

      // -- EXIT open position — options (ma_crossover / rsi / breakout) --
      if (position && signal && signal !== 'SELL_STRADDLE' && signal !== 'BUY_STRADDLE' && signal !== 'SYNTH_LONG' && signal !== 'SYNTH_EXIT' && signal !== 'EXIT_STRADDLE' && signal !== 'EXIT_BUY_STRADDLE' && signal !== 'FUT_LONG' && signal !== 'FUT_SHORT') {
        let pnl = 0;
        if (position.optionType === 'CE' || position.optionType === 'PE') {
          const daysLeft = Math.max(0, position.daysToExpiry - (i - position.entryBar));
          const exitPx   = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, position.optionType);
          pnl = (exitPx - position.entryPx) * lot;
        }
        cash += pnl;
        trades.push({ date:c.date, type:'EXIT', side:position.optionType, strike:position.strike, entryDate:position.entryDate, entryPx:position.entryPx, exitPx:bsPrice(S, position.strike, 0, 0.065, 0.16, position.optionType).toFixed(2), pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // -- EXIT futures --
      if (position && (signal === 'FUT_SHORT' || signal === 'FUT_LONG') && (position.type === 'FUT_LONG' || position.type === 'FUT_SHORT')) {
        const dir = position.type === 'FUT_LONG' ? 1 : -1;
        const pnl = dir * (S - position.entrySpot) * lot;
        cash += pnl + (position.margin || 0); // return margin
        trades.push({ date:c.date, type:'EXIT', side:position.type, strike:position.entrySpot, entryDate:position.entryDate, entryPx:position.entrySpot.toFixed(0), exitPx:S.toFixed(0), pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // -- EXIT straddle sell --
      if (position && signal === 'EXIT_STRADDLE') {
        const cePx = bsPrice(S, position.strike, 0, 0.065, position.ceIV||0.16, 'CE');
        const pePx = bsPrice(S, position.strike, 0, 0.065, position.peIV||0.16, 'PE');
        const pnl  = (position.cePx + position.pePx - cePx - pePx) * lot;
        cash += pnl;
        trades.push({ date:c.date, type:'EXIT', side:'STRADDLE_SELL', strike:position.strike, entryDate:position.entryDate, pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // -- EXIT straddle buy --
      if (position && signal === 'EXIT_BUY_STRADDLE') {
        const cePx = bsPrice(S, position.strike, 0, 0.065, 0.16, 'CE');
        const pePx = bsPrice(S, position.strike, 0, 0.065, 0.16, 'PE');
        const pnl  = (cePx + pePx - position.cePx - position.pePx) * lot;
        cash += pnl;
        trades.push({ date:c.date, type:'EXIT', side:'STRADDLE_BUY', strike:position.strike, entryDate:position.entryDate, pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // -- EXIT synthetic future --
      if (position && signal === 'SYNTH_EXIT') {
        const daysLeft = Math.max(0, position.daysToExpiry - (i - position.entryBar));
        const cePx = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, 'CE');
        const pePx = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, 'PE');
        // Long synthetic = Long CE + Short PE
        const pnl  = ((cePx - position.cePx) - (pePx - position.pePx)) * lot;
        cash += pnl;
        trades.push({ date:c.date, type:'EXIT', side:'SYNTH_FUTURE', strike:position.strike, entryDate:position.entryDate, pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // -- ENTER new position --
      if (!position && signal && signal !== 'EXIT_STRADDLE' && signal !== 'EXIT_BUY_STRADDLE' && signal !== 'SYNTH_EXIT') {
        if (signal === 'SELL_STRADDLE') {
          const strike = Math.round(S/50)*50;
          const cePx   = bsPrice(S, strike, 4/365, 0.065, 0.16, 'CE');
          const pePx   = bsPrice(S, strike, 4/365, 0.065, 0.16, 'PE');
          position = { type:'SELL_STRADDLE', entryDate:c.date, entryBar:i, strike, cePx, pePx, ceIV:0.16, peIV:0.16 };
          trades.push({ date:c.date, type:'ENTRY', side:'STRADDLE_SELL', strike, entryPx:(cePx+pePx).toFixed(2), capital:Math.round(cash) });
        } else if (signal === 'BUY_STRADDLE') {
          const strikeMul = btSymbol.includes('BANK') ? 100 : 50;
          const strike = Math.round(S/strikeMul)*strikeMul;
          const cePx   = bsPrice(S, strike, 4/365, 0.065, 0.16, 'CE');
          const pePx   = bsPrice(S, strike, 4/365, 0.065, 0.16, 'PE');
          const cost   = (cePx + pePx) * lot;
          if (cost > cash * 0.4) { equity.push({ date:c.date, value:Math.round(cash) }); continue; }
          cash -= cost;
          position = { type:'BUY_STRADDLE', entryDate:c.date, entryBar:i, strike, cePx, pePx, entrySpot:S };
          trades.push({ date:c.date, type:'ENTRY', side:'STRADDLE_BUY', strike, entryPx:(cePx+pePx).toFixed(2), capital:Math.round(cash) });
        } else if (signal === 'SYNTH_LONG') {
          const strikeMul = btSymbol.includes('BANK') ? 100 : 50;
          const strike = Math.round(S/strikeMul)*strikeMul;
          const cePx   = bsPrice(S, strike, 7/365, 0.065, 0.16, 'CE');
          const pePx   = bsPrice(S, strike, 7/365, 0.065, 0.16, 'PE');
          // Synthetic long: buy CE (pay), sell PE (receive) — net cost much lower than outright
          const netCost = Math.max(0, cePx - pePx) * lot;
          if (netCost > cash * 0.4) { equity.push({ date:c.date, value:Math.round(cash) }); continue; }
          cash -= netCost;
          position = { type:'SYNTH_LONG', entryDate:c.date, entryBar:i, strike, cePx, pePx, daysToExpiry:7 };
          trades.push({ date:c.date, type:'ENTRY', side:'SYNTH_FUTURE', strike, entryPx:(cePx-pePx).toFixed(2), capital:Math.round(cash) });
        } else if (signal === 'FUT_LONG' || signal === 'FUT_SHORT') {
          // Futures: block 10% of spot as margin, trade full lot
          const margin = S * lot * 0.10;
          if (margin > cash * 0.5) { equity.push({ date:c.date, value:Math.round(cash) }); continue; }
          cash -= margin;
          position = { type: signal, entryDate:c.date, entryBar:i, entrySpot:S, lot, margin };
          trades.push({ date:c.date, type:'ENTRY', side:signal, entryPx:S.toFixed(0), capital:Math.round(cash) });
        } else {
          const optType  = signal === 'LONG' ? 'CE' : 'PE';
          const strikeMul = btSymbol.includes('BANK') ? 100 : 50;
          const strike   = signal === 'LONG' ? Math.ceil(S/strikeMul)*strikeMul : Math.floor(S/strikeMul)*strikeMul;
          const daysToExp = 7;
          const entryPx  = bsPrice(S, strike, daysToExp/365, 0.065, 0.16, optType);
          const cost     = entryPx * lot;
          if (cost > cash * 0.4) { equity.push({ date:c.date, value:Math.round(cash) }); continue; } // risk check: max 40% per trade
          cash -= cost;
          position = { type:signal, optionType:optType, entryDate:c.date, entryBar:i, strike, entryPx, daysToExpiry:daysToExp };
          trades.push({ date:c.date, type:'ENTRY', side:optType, strike, entryPx:entryPx.toFixed(2), capital:Math.round(cash) });
        }
      }

      equity.push({ date:c.date, value:Math.round(cash) });
    }

    // -- Close any open position at end --
    if (position) {
      const S = candles[candles.length-1].close;
      let pnl = 0;
      if (position.type === 'SELL_STRADDLE') {
        const cePx = bsPrice(S, position.strike, 0, 0.065, 0.16, 'CE');
        const pePx = bsPrice(S, position.strike, 0, 0.065, 0.16, 'PE');
        pnl = (position.cePx + position.pePx - cePx - pePx) * lot;
      } else if (position.type === 'BUY_STRADDLE') {
        const cePx = bsPrice(S, position.strike, 0, 0.065, 0.16, 'CE');
        const pePx = bsPrice(S, position.strike, 0, 0.065, 0.16, 'PE');
        pnl = (cePx + pePx - position.cePx - position.pePx) * lot;
      } else if (position.type === 'SYNTH_LONG') {
        const daysLeft = Math.max(0, position.daysToExpiry - (candles.length - 1 - position.entryBar));
        const cePx = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, 'CE');
        const pePx = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, 'PE');
        pnl = ((cePx - position.cePx) - (pePx - position.pePx)) * lot;
      } else if (position.type === 'FUT_LONG') {
        pnl = (S - position.entrySpot) * position.lot;
        cash += position.margin;
      } else if (position.type === 'FUT_SHORT') {
        pnl = (position.entrySpot - S) * position.lot;
        cash += position.margin;
      } else if (position.optionType) {
        const exitPx = bsPrice(S, position.strike, 0, 0.065, 0.16, position.optionType);
        pnl = (exitPx - position.entryPx) * lot;
      }
      cash += pnl;
      trades.push({ date:candles[candles.length-1].date, type:'EXIT(End)', side:position.type||position.optionType||'STRADDLE', pnl:Math.round(pnl), capital:Math.round(cash) });
    }

    // -- Stats --
    const exitTrades  = trades.filter(t=>t.type.startsWith('EXIT'));
    const profits     = exitTrades.map(t=>t.pnl).filter(p=>p>0);
    const losses2     = exitTrades.map(t=>t.pnl).filter(p=>p<=0);
    const totalReturn = ((cash - btCapital)/btCapital*100).toFixed(2);
    const winRate     = exitTrades.length ? (profits.length/exitTrades.length*100).toFixed(1) : 0;
    const avgWin      = profits.length ? (profits.reduce((s,v)=>s+v,0)/profits.length).toFixed(0) : 0;
    const avgLoss     = losses2.length ? (losses2.reduce((s,v)=>s+v,0)/losses2.length).toFixed(0) : 0;
    const maxDD       = equity.reduce((dd,p,i,a)=>{ const peak=Math.max(...a.slice(0,i+1).map(x=>x.value)); return Math.max(dd,((peak-p.value)/peak)*100); },0).toFixed(2);
    const returns     = equity.slice(1).map((p,i)=>((p.value-equity[i].value)/equity[i].value));
    const avgR        = returns.reduce((s,v)=>s+v,0)/returns.length||0;
    const stdR        = Math.sqrt(returns.reduce((s,v)=>s+(v-avgR)**2,0)/returns.length||1);
    const sharpe      = (avgR/stdR*Math.sqrt(252)).toFixed(2);
    const bestTrade   = Math.max(0,...exitTrades.map(t=>t.pnl||0));
    const worstTrade  = Math.min(0,...exitTrades.map(t=>t.pnl||0));

    setBtResult({
      symbol:btSymbol, strategy:btStrategy, period:btPeriod, capital:btCapital,
      finalCapital:Math.round(cash), totalReturn, winRate, avgWin, avgLoss,
      totalTrades:exitTrades.length, maxDD, sharpe, bestTrade, worstTrade,
      trades, equity, candles,
    });
    setBtRunning(false);
  };

  // -- Wake backend on load (Render free tier sleeps) --------------------------
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`).catch(()=>{});
  }, []);

  // -- Auto-load admin users + pending payments when admin tab opened ------
  useEffect(() => {
    if (activeTab === 'admin' && isAdmin) {
      if (adminUsers.length === 0) fetchAllUsers();
      fetchPendingPayments();
    }
  }, [activeTab, isAdmin]); // eslint-disable-line

  // -- Firebase auth listener ------------------------------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setIsAdmin(user?.email === ADMIN_EMAIL);
      setAuthLoading(false);
      if (user) {
        // Load user preferences from Firestore
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          if (snap.exists()) {
            const data = snap.data();
            if (data.groqApiKey)  setGroqApiKey(data.groqApiKey);
            if (data.tgChatId)    setTgChatId(data.tgChatId);
            const created = data.createdAt?.toDate?.() || new Date();
            const trialEnd = new Date(created.getTime() + 90 * 24 * 60 * 60 * 1000);
            const daysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000*60*60*24)));
            setTrialDaysLeft(daysLeft);
            if (data.subStatus === 'pro') { setSubStatus('pro'); setTrialDaysLeft(999); }
            else if (daysLeft <= 0)       setSubStatus('expired');
            else                          setSubStatus('trial');
          } else {
            await setDoc(doc(db,'users',user.uid), { createdAt: serverTimestamp(), email: user.email }, { merge: true });
            setTrialDaysLeft(90); setSubStatus('trial');
          }
          // Load trade journal from Firestore
          const tradesSnap = await getDocs(query(collection(db,'users',user.uid,'trades'),orderBy('timestamp','desc')));
          const cloudTrades = tradesSnap.docs.map(d=>({...d.data(),firestoreId:d.id}));
          if (cloudTrades.length > 0) setTradeLog(cloudTrades);
        } catch(e) { console.warn('Firestore load error:', e.message); }
      }
    });
    return () => unsub();
  }, []);

  // -- Save settings to Firestore when changed ------------------------------─
  useEffect(() => {
    if (!currentUser) return;
    const save = async () => {
      try {
        await setDoc(doc(db,'users',currentUser.uid), { groqApiKey, tgChatId, email:currentUser.email, updatedAt:serverTimestamp() }, { merge:true });
      } catch(e) { console.warn('Settings save error:', e.message); }
    };
    const timer = setTimeout(save, 1500); // debounce
    return () => clearTimeout(timer);
  }, [groqApiKey, tgChatId, currentUser]);

  // -- Auth functions --------------------------------------------------------
  const signInWithGoogle = async () => {
    setAuthSubmitting(true); setAuthError('');
    try { await signInWithPopup(auth, googleProvider); setShowAuthModal(false); }
    catch(e) { setAuthError(e.message); }
    finally { setAuthSubmitting(false); }
  };

  const signInWithEmail = async () => {
    setAuthSubmitting(true); setAuthError('');
    try {
      if (authMode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        if (authName) await updateProfile(cred.user, { displayName: authName });
        await setDoc(doc(db,'users',cred.user.uid),{ email:authEmail, name:authName, createdAt:serverTimestamp() });
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
      setShowAuthModal(false);
    } catch(e) {
      const msgs = { 'auth/email-already-in-use':'Email already registered  -  try logging in', 'auth/wrong-password':'Wrong password', 'auth/user-not-found':'No account with this email', 'auth/weak-password':'Password must be 6+ characters', 'auth/invalid-email':'Invalid email address' };
      setAuthError(msgs[e.code] || e.message);
    }
    finally { setAuthSubmitting(false); }
  };

  const handleSignOut = async () => { await signOut(auth); setTradeLog([]); };

  // -- Save trade to Firestore (overrides localStorage-only addTrade) --------
  const addTradeWithSync = async (form) => {
    const entry = { ...form, id:Date.now(), timestamp:new Date().toISOString(), pnl: form.exitPrice ? ((parseFloat(form.exitPrice)-parseFloat(form.entryPrice))*(form.action==='BUY'?1:-1)*parseInt(form.qty)*50).toFixed(0) : null };
    const newLog = [entry, ...tradeLog];
    setTradeLog(newLog);
    if (currentUser) {
      try { await addDoc(collection(db,'users',currentUser.uid,'trades'), { ...entry, savedAt:serverTimestamp() }); }
      catch(e) { console.warn('Trade sync failed:', e.message); }
    }
    // Revenge trading detection
    const recent = newLog.slice(0,3);
    const recentLosses = recent.filter(t=>t.pnl&&parseFloat(t.pnl)<0).length;
    const timeDiffs = recent.slice(0,-1).map((t,i)=>(new Date(t.timestamp)-new Date(recent[i+1].timestamp))/60000);
    const tooFast = timeDiffs.some(d=>d<15);
    if (recentLosses>=2 && tooFast) {
      const end = new Date(Date.now()+30*60*1000);
      setCooldownActive(true); setCooldownEnd(end);
      // Cooldown alert sent below in addTrade function
    }
  };

  const [marketData, setMarketData] = useState({
    nifty: { value: 25500, change: 0.8 },
    bankNifty: { value: 54000, change: 1.2 },
    vix: { value: 14.2, change: -2.1 }
  });
  const [liveChanges,   setLiveChanges]   = useState({});
  const [livePrevClose, setLivePrevClose] = useState({});
  const [banList,       setBanList]       = useState([]);
  const [banLoading,    setBanLoading]    = useState(false);
  const [banFetched,    setBanFetched]    = useState(false);
  const [prevOI,        setPrevOI]        = useState({});
  const [watchNSE,     setWatchNSE]     = useState(['Nifty 50','Bank Nifty','Nifty IT']);
  const [watchBSE,     setWatchBSE]     = useState(['Sensex','BSE Midcap']);
  const [watchStocks,  setWatchStocks]  = useState(['Reliance','TCS','HDFC Bank']);
  const [watchTab,     setWatchTab]     = useState('nse');
  const [livePrices, setLivePrices] = useState({
    // NSE Indices
    'Nifty 50': 25500,
    'Bank Nifty': 54000,
    'Nifty IT': 35800,
    'Nifty Pharma': 21000,
    'Nifty Auto': 22000,
    'Nifty Financial Services': 21500,
    'Nifty FMCG': 52000,
    'Nifty Metal': 8500,
    'Nifty Realty': 920,
    'Nifty Energy': 38000,
    'Nifty Infrastructure': 9200,
    'Nifty Media': 1650,
    'Nifty PSU Bank': 6500,
    'Nifty Private Bank': 24000,
    'Nifty Midcap 50': 15800,
    'Nifty Smallcap 50': 8200,
    'Nifty Midcap 100': 55000,
    'Nifty Next 50': 68000,
    'Nifty 100': 24000,
    'Nifty 200': 13000,
    'Nifty 500': 22500,
    'Nifty Commodities': 8000,
    'Nifty Consumption': 11000,
    'Nifty MNC': 28000,
    'Nifty Services': 32000,
    'Nifty Healthcare': 12500,
    'Nifty Oil & Gas': 11000,
    'Nifty PSE': 7800,
    
    // Top FNO Stocks (Nifty 50 constituents)
    'Reliance': 2850,
    'TCS': 4100,
    'HDFC Bank': 1650,
    'Infosys': 1580,
    'ICICI Bank': 1180,
    'Bharti Airtel': 1550,
    'ITC': 460,
    'SBI': 780,
    'LT': 3650,
    'Kotak Bank': 1780,
    'HCL Tech': 1820,
    'Axis Bank': 1120,
    'Asian Paints': 2450,
    'Maruti Suzuki': 12500,
    'Titan': 3400,
    'Bajaj Finance': 7200,
    'Wipro': 560,
    'Ultra Cement': 11200,
    'Sun Pharma': 1780,
    'Nestle': 2400,
    'M&M': 2950,
    'Tech Mahindra': 1680,
    'Tata Motors': 780,
    'Power Grid': 320,
    'Adani Ports': 1280,
    'NTPC': 360,
    'Tata Steel': 145,
    'JSW Steel': 920,
    'Coal India': 450,
    'ONGC': 270,
    'IOC': 155,
    'Hindalco': 640,
    'Grasim': 2450,
    'UPL': 540,
    'Britannia': 4800,
    'Div Lab': 5900,
    'Dr Reddy': 1280,
    'Cipla': 1450,
    'Eicher Motors': 4800,
    'Hero MotoCorp': 4500,
    'Bajaj Auto': 9200,
    'Shree Cement': 26000,
    'Adani Enterprises': 2850,
    'Adani Green': 1780,
    'SBI Life': 1520,
    'HDFC Life': 640,
    'ICICI Pru': 580,
  });
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState(['Nifty 50', 'Bank Nifty', 'Nifty IT']);

  // GLOBAL INDICES (Real-time)
  const [globalIndices, setGlobalIndices] = useState({
    'S&P 500': { value: 5800, change: 0 },
    'Dow Jones': { value: 38500, change: 0 },
    'Nasdaq': { value: 18200, change: 0 },
    'FTSE 100': { value: 7650, change: 0 },
    'DAX': { value: 17800, change: 0 },
    'CAC 40': { value: 7500, change: 0 },
    'Nikkei 225': { value: 38000, change: 0 },
    'Hang Seng': { value: 17200, change: 0 },
    'Shanghai': { value: 3050, change: 0 },
    'KOSPI': { value: 2650, change: 0 },
    'Gold': { value: 2650, change: 0 },
    'Silver': { value: 31.5, change: 0 },
    'Crude Oil': { value: 77.5, change: 0 },
    'Bitcoin': { value: 95000, change: 0 },
  });
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState(new Date());

  // LIVE OPTION CHAIN STATE
  const [liveOptionChain, setLiveOptionChain] = useState([]);
  const [rawNseData,      setRawNseData]      = useState(null);   // raw NSE records keyed by expiry
  const [selectedExpiry,   setSelectedExpiry]   = useState('');
  const [nseExpiryDates,   setNseExpiryDates]   = useState([]);
  const [selectedUnderlying, setSelectedUnderlying] = useState('NIFTY');
  const [isLoadingChain, setIsLoadingChain] = useState(false);
  const [chartType, setChartType] = useState('oi'); // 'oi', 'iv', 'greeks', 'volume'
  
  // CHART DATA
  const [chartData, setChartData] = useState({
    oi: [],
    iv: [],
    volume: [],
    priceHistory: []
  });

  // EVENTS CALENDAR
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [businessNews, setBusinessNews] = useState([]);
  const [isLoadingBusinessNews, setIsLoadingBusinessNews] = useState(false);

  // CANDLESTICK CHART STATE
  const [selectedChartSymbol, setSelectedChartSymbol] = useState('NIFTY');
  const [chartTimeframe, setChartTimeframe] = useState('15m');
  const [candlestickType, setCandlestickType] = useState('candlestick');
  const [chartIndicators, setChartIndicators] = useState(['EMA20', 'RSI']);
  const [showChartLevels, setShowChartLevels] = useState(true);
  const [lastChartUpdate, setLastChartUpdate] = useState(new Date());
  const [candlestickData, setCandlestickData] = useState([]);

  // CUSTOM SCANNER FILTERS
  const [customFilters, setCustomFilters] = useState([]);
  const [activeScannerTab, setActiveScannerTab] = useState('preset');

  // INSTITUTIONAL ACTIVITY — fetched from NSE EOD
  const [institutionalActivity, setInstitutionalActivity] = useState(null);
  const [fiiDiiLoading, setFiiDiiLoading] = useState(false);
  const [globalCues, setGlobalCues]       = useState(null);
  const [globalCuesLoading, setGlobalCuesLoading] = useState(false);
  const [fiiDiiError, setFiiDiiError] = useState('');
  const [bulkDeals, setBulkDeals] = useState([]);
  const [blockDeals, setBlockDeals] = useState([]);
  const [optionInstitutionalActivity, setOptionInstitutionalActivity] = useState([]);

  const [newFilter, setNewFilter] = useState({
    name: '',
    conditions: [{ metric: 'ceOI', operator: '>', value: 50000 }]
  });

  // PCR + MAX PAIN + FII/DII + OI STATE
  const [pcrData, setPcrData] = useState({ pcr: 1.05, signal: 'Neutral', totalCE: 0, totalPE: 0 });
  const [maxPainData, setMaxPainData] = useState({ maxPain: 0, currentSpot: 0 });
  const [fiiDiiData, setFiiDiiData] = useState([]);
  const [oiChartData, setOiChartData] = useState([]);
  const [activeHomeTab, setActiveHomeTab] = useState('news');
  const [optionChainData, setOptionChainData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [scannerIV, setScannerIV] = useState(20);
  const [scannerExpiry, setScannerExpiry] = useState('');
  const [selectedFilters, setSelectedFilters] = useState(['iv_crush','gamma_squeeze','pcr_extreme']);
  const [stratView, setStratView] = useState('bullish');
  const [stratHoverIdx, setStratHoverIdx] = useState(null);
  const [scanResults, setScanResults] = useState([]);
  const [scanRunning, setScanRunning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [expiryData, setExpiryData]         = useState(null);
  const [portfolio, setPortfolio]           = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState('');
  const [selectedBroker, setSelectedBroker] = useState('dhan');
  const [manualPositions, setManualPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('db_manual_positions') || '[]'); } catch { return []; }
  });
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm]         = useState({ symbol:'', qty:'', avgPrice:'', type:'BUY', product:'INTRADAY' });
  const [zerodhaToken, setZerodhaToken]     = useState(localStorage.getItem('db_zerodha_token') || '');
  const [angelJwt, setAngelJwt]             = useState(localStorage.getItem('db_angel_jwt') || '');
  const [angelApiKey, setAngelApiKey]       = useState(localStorage.getItem('db_angel_apikey') || '');
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotResult, setScreenshotResult] = useState(null);
  const [screenshotError, setScreenshotError] = useState('');
  const [expiryLoading, setExpiryLoading] = useState(false);
  const [expirySymbol, setExpirySymbol]   = useState('NIFTY');
  const [showLegal, setShowLegal]         = useState(null);
  const [showPricing, setShowPricing]     = useState(false);
  const [payStep,     setPayStep]         = useState('qr');   // 'qr' | 'upload' | 'done'
  const [payFile,     setPayFile]         = useState(null);
  const [payUploading,setPayUploading]    = useState(false);
  const [payMsg,      setPayMsg]          = useState('');
  const [pendingPay,  setPendingPay]      = useState([]);     // admin: pending uploads
  const [adminUsers, setAdminUsers]       = useState([]);
  const [adminLoading, setAdminLoading]   = useState(false);
  const [adminMsg, setAdminMsg]           = useState('');
  const [adminSearch, setAdminSearch]     = useState('');
  const [subStatus, setSubStatus]         = useState('trial');
  const [trialDaysLeft, setTrialDaysLeft] = useState(90);
  // Helper — trial users get full Pro access for 90 days
  const isPro = subStatus === 'pro' || subStatus === 'trial';
  const openUpgrade = () => setShowPricing(true);
  const [gexData, setGexData]             = useState(null);
  const [gexLoading, setGexLoading]       = useState(false);
  const [gexError, setGexError]           = useState('');
  const [gexSymbol, setGexSymbol]         = useState('NIFTY');
  const [indicesPcr, setIndicesPcr]       = useState({});
  const [indicesPcrLoading, setIndicesPcrLoading] = useState(false);
  const [watchlist, setWatchlist]         = useState(() => { try { return JSON.parse(localStorage.getItem('db_watchlist')||'[]'); } catch(e) { return []; }});
  const [watchlistPrices, setWatchlistPrices] = useState({});
  const [showAddWatch, setShowAddWatch]   = useState(false);
  const [watchInput, setWatchInput]       = useState('');

  // Persist watchlist to localStorage
  useEffect(() => { localStorage.setItem('db_watchlist', JSON.stringify(watchlist)); }, [watchlist]);

  const fetchWatchlistPrices = async () => {
    if (!watchlist.length) return;
    const prices = {};
    await Promise.all(watchlist.map(async (sym) => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stock-price?symbol=${encodeURIComponent(sym)}`);
        const d = await r.json();
        if (d.price) prices[sym] = { price: d.price, change: d.change||0, pct: d.changePercent||0 };
      } catch(e) {}
    }));
    setWatchlistPrices(p => ({...p, ...prices}));
  };

  const addToWatchlist = (sym) => {
    const s = sym.trim().toUpperCase();
    if (!s || watchlist.includes(s)) return;
    setWatchlist(w => [...w, s]);
    setWatchInput('');
    setShowAddWatch(false);
  };

  const removeFromWatchlist = (sym) => setWatchlist(w => w.filter(s => s !== sym));

  const fetchPortfolio = async (broker) => {
    const b = broker || selectedBroker;
    if (b === 'manual') return; // manual positions handled separately
    setPortfolioLoading(true);
    setPortfolioError('');
    try {
      let url = `${BACKEND_URL}/api/dhan/portfolio`;
      let headers = {};
      if (b === 'zerodha') {
        if (!zerodhaToken) { setPortfolioError('Enter your Zerodha access token first'); setPortfolioLoading(false); return; }
        url = `${BACKEND_URL}/api/zerodha/portfolio?access_token=${zerodhaToken}`;
      } else if (b === 'angel') {
        if (!angelJwt) { setPortfolioError('Enter your Angel One JWT token first'); setPortfolioLoading(false); return; }
        url = `${BACKEND_URL}/api/angel/portfolio?jwt=${angelJwt}&apikey=${angelApiKey}`;
      }
      const r = await fetch(url, { headers });
      const data = await r.json();
      if (data.error) setPortfolioError(data.error);
      else setPortfolio(data);
    } catch(e) { setPortfolioError('Could not connect to backend'); }
    finally { setPortfolioLoading(false); }
  };

  // Manual position helpers
  const addManualPosition = () => {
    if (!manualForm.symbol || !manualForm.qty || !manualForm.avgPrice) return;
    const pos = { ...manualForm, id: Date.now(), qty: Number(manualForm.qty), avgPrice: Number(manualForm.avgPrice) };
    const updated = [...manualPositions, pos];
    setManualPositions(updated);
    localStorage.setItem('db_manual_positions', JSON.stringify(updated));
    setManualForm({ symbol:'', qty:'', avgPrice:'', type:'BUY', product:'INTRADAY' });
    setShowManualForm(false);
  };

  const removeManualPosition = (id) => {
    const updated = manualPositions.filter(p => p.id !== id);
    setManualPositions(updated);
    localStorage.setItem('db_manual_positions', JSON.stringify(updated));
  };

  const analyzeScreenshot = async (file) => {
    if (!file) return;
    setScreenshotAnalyzing(true);
    setScreenshotError('');
    setScreenshotResult(null);
    try {
      // Convert to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const mediaType = file.type || 'image/jpeg';

      // Call backend — API key lives there, never in browser
      const r = await fetch(`${BACKEND_URL}/api/analyze-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType }),
      });

      const data = await r.json();

      if (!r.ok || data.error) {
        throw new Error(data.error || 'Analysis failed');
      }

      const positions = data.positions || [];
      if (!Array.isArray(positions)) throw new Error('Unexpected response format');
      setScreenshotResult(positions);
    } catch(e) {
      setScreenshotError('Could not analyze: ' + e.message);
    } finally {
      setScreenshotAnalyzing(false);
    }
  };

  const handleScreenshotUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScreenshotFile(file);
    setScreenshotResult(null);
    setScreenshotError('');
    const url = URL.createObjectURL(file);
    setScreenshotPreview(url);
  };

  const importScreenshotPositions = (positions) => {
    const newPositions = positions.map(p => ({
      ...p,
      id: Date.now() + Math.random(),
      qty: Number(p.qty),
      avgPrice: Number(p.avgPrice),
    }));
    const updated = [...manualPositions, ...newPositions];
    setManualPositions(updated);
    localStorage.setItem('db_manual_positions', JSON.stringify(updated));
    setScreenshotResult(null);
    setScreenshotPreview(null);
    setScreenshotFile(null);
  };

  // ── ADMIN FUNCTIONS ────────────────────────────────────────────────────────
  const fetchAllUsers = async () => {
    if (!isAdmin) return;
    setAdminLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
      setAdminUsers(users);
    } catch(e) { setAdminMsg('Error: ' + e.message); }
    finally { setAdminLoading(false); }
  };

  // Upload payment screenshot to Firebase Storage → save ref in Firestore
  const submitPaymentProof = async () => {
    if (!payFile || !currentUser) return;
    setPayUploading(true);
    setPayMsg('');
    try {
      const path = `payment-proofs/${currentUser.uid}_${Date.now()}.${payFile.name.split('.').pop()}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, payFile);
      const url = await getDownloadURL(fileRef);
      await setDoc(doc(db, 'paymentProofs', currentUser.uid), {
        uid: currentUser.uid,
        email: currentUser.email,
        name: currentUser.displayName || '',
        screenshotUrl: url,
        submittedAt: serverTimestamp(),
        status: 'pending',
        amount: 299,
      });
      setPayStep('done');
      setPayMsg('✅ Screenshot submitted! We will activate your Pro within 2 hours.');
    } catch(e) {
      setPayMsg('Upload failed: ' + e.message);
    } finally {
      setPayUploading(false);
    }
  };

  // Admin: fetch pending payment proofs
  const fetchPendingPayments = async () => {
    try {
      const snap = await getDocs(collection(db, 'paymentProofs'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPendingPay(all.filter(p => p.status === 'pending'));
    } catch(e) { console.log('fetchPendingPayments error:', e.message); }
  };

  // Admin: approve payment → set Pro + mark proof approved
  const approvePayment = async (proof) => {
    try {
      await setDoc(doc(db, 'users', proof.uid), {
        subStatus: 'pro', paidAt: new Date().toISOString(),
        paymentNote: 'UPI screenshot approved', paidAmount: 299,
      }, { merge: true });
      await setDoc(doc(db, 'paymentProofs', proof.uid), { status: 'approved' }, { merge: true });
      setAdminMsg('✅ ' + (proof.email||proof.uid) + ' activated as Pro');
      fetchPendingPayments();
      fetchAllUsers();
    } catch(e) { setAdminMsg('Error: ' + e.message); }
  };

  const setUserPro = async (uid, makePro) => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'users', uid), { subStatus: makePro ? 'pro' : 'trial' }, { merge: true });
      setAdminMsg(makePro ? '✅ User upgraded to Pro' : '✅ User reverted to Trial');
      fetchAllUsers();
    } catch(e) { setAdminMsg('Error: ' + e.message); }
  };

  const setUserProWithNote = async (uid, note) => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'users', uid), {
        subStatus: 'pro',
        paidAt: new Date().toISOString(),
        paymentNote: note || 'Manual activation',
        paidAmount: 299,
      }, { merge: true });
      setAdminMsg('✅ User upgraded to Pro' + (note ? ` — ${note}` : ''));
      fetchAllUsers();
    } catch(e) { setAdminMsg('Error: ' + e.message); }
  };

  // ── FETCH FII/DII FROM NSE ──────────────────────────────────────────────────
  const fetchFiiDii = async () => {
    setFiiDiiLoading(true);
    setFiiDiiError('');
    try {
      const r = await fetch(`${BACKEND_URL}/api/nse/fii-dii`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      // Map to chart-friendly format { date, fii, dii }
      const chartData = (d.data || []).map(row => ({
        date : row.date,
        fii  : row.fiiNet,
        dii  : row.diiNet,
      }));
      setFiiDiiData(chartData);
      if (d.latest) {
        setInstitutionalActivity({
          fii: d.latest.fii,
          dii: d.latest.dii,
          lastUpdated: new Date(d.fetchedAt),
          stale: d.stale || false,
        });
      }
    } catch(e) {
      setFiiDiiError('Could not load FII/DII data: ' + e.message);
    } finally {
      setFiiDiiLoading(false);
    }
  };

  // ── FETCH EVENTS FROM NSE ───────────────────────────────────────────────────
  const fetchEvents = async () => {
    setEventsLoading(true);
    setEventsError('');
    try {
      const r = await fetch(`${BACKEND_URL}/api/nse/events`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setEvents(d.events || []);
    } catch(e) {
      setEventsError('Could not load events: ' + e.message);
    } finally {
      setEventsLoading(false);
    }
  };


  const fetchBulkDeals = async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/nse/bulk-deals`);
      const d = await r.json();
      if (d.error) return;
      if (d.bulkDeals) setBulkDeals(d.bulkDeals);
      if (d.blockDeals) setBlockDeals(d.blockDeals);
    } catch(e) { console.warn("Bulk deals fetch error:", e.message); }
  };
  // Compute expiry metrics from a raw chain array {ceOI,peOI,ceLTP,peLTP,ceIV,peIV,ceVol,peVol,strike}
  const computeExpiryMetrics = (chain, S, symbol) => {
    if (!chain.length) return;
    let maxPainStrike = chain[0].strike, minLoss = Infinity;
    for (const test of chain) {
      const T = test.strike; let loss = 0;
      for (const row of chain) {
        if (T > row.strike) loss += (T - row.strike) * (row.ceOI||0);
        if (T < row.strike) loss += (row.strike - T) * (row.peOI||0);
      }
      if (loss < minLoss) { minLoss = loss; maxPainStrike = T; }
    }
    const totalCeOI  = chain.reduce((s,r) => s+(r.ceOI||0), 0);
    const totalPeOI  = chain.reduce((s,r) => s+(r.peOI||0), 0);
    const totalCeVol = chain.reduce((s,r) => s+(r.ceVol||0), 0);
    const totalPeVol = chain.reduce((s,r) => s+(r.peVol||0), 0);
    const pcrOI  = totalCeOI  ? +(totalPeOI  / totalCeOI ).toFixed(2) : 0;
    const pcrVol = totalCeVol ? +(totalPeVol / totalCeVol).toFixed(2) : 0;
    const pcrBias = pcrOI > 1.2 ? 'Bullish' : pcrOI < 0.8 ? 'Bearish' : 'Neutral';
    const atmRow = chain.reduce((a,b) => Math.abs(b.strike-S)<Math.abs(a.strike-S)?b:a);
    const straddlePremium = (atmRow.ceLTP||0) + (atmRow.peLTP||0);
    const atmIV = ((atmRow.ceIV||0) + (atmRow.peIV||0)) / 2;
    const expectedMove = +(S * atmIV / 100 / Math.sqrt(365)).toFixed(0);
    const oiChart = chain.filter(r => Math.abs(r.strike-S)/S <= 0.05)
      .map(r => ({strike:r.strike, ceOI:r.ceOI||0, peOI:r.peOI||0, ceLTP:r.ceLTP||0, peLTP:r.peLTP||0}));
    const resistance = [...chain].sort((a,b)=>(b.ceOI||0)-(a.ceOI||0)).slice(0,3)
      .map(r => ({strike:r.strike, ceOI:r.ceOI||0, ceLTP:r.ceLTP||0}));
    const support = [...chain].sort((a,b)=>(b.peOI||0)-(a.peOI||0)).slice(0,3)
      .map(r => ({strike:r.strike, peOI:r.peOI||0, peLTP:r.peLTP||0}));
    setExpiryData({ symbol, spot:S, maxPain:maxPainStrike, pcrOI, pcrVol, pcrBias,
      straddlePremium:+straddlePremium.toFixed(2), atmIV:+atmIV.toFixed(1),
      expectedMove, oiChart, resistance, support });
  };

  const fetchExpiryData = async (sym) => {
    const symbol = (sym || expirySymbol || 'NIFTY').toUpperCase();
    const EXPIRY_NSE   = { NIFTY:'NIFTY', BANKNIFTY:'BANKNIFTY', FINNIFTY:'FINNIFTY', MIDCPNIFTY:'MIDCPNIFTY' };
    const EXPIRY_YAHOO = { NIFTY:'^NSEI', BANKNIFTY:'^NSEBANK', FINNIFTY:'NIFTY_FIN_SERVICE.NS', MIDCPNIFTY:'^NSEMDCP50' };
    const BASE = { NIFTY:24500, BANKNIFTY:52000, FINNIFTY:23500, MIDCPNIFTY:12800 };
    const STEP = { NIFTY:50, BANKNIFTY:100, FINNIFTY:50, MIDCPNIFTY:50 };
    setExpiryLoading(true);
    try {
      // ── Try NSE via backend (same endpoint that powers option chain tab) ──
      let chain = [], S = 0;
      try {
        const nseRes = await fetch(`${BACKEND_URL}/api/option-chain?symbol=${EXPIRY_NSE[symbol]||symbol}`, {headers:{'Accept':'application/json'}});
        if (nseRes.ok) {
          const nseJson = await nseRes.json();
          if (!nseJson?.error && nseJson?.records?.data?.length > 0) {
            S = nseJson.records.underlyingValue || BASE[symbol] || 25000;
            const map = {};
            nseJson.records.data.forEach(row => {
              const k = row.strikePrice;
              if (!map[k]) map[k] = {strike:k,ceOI:0,peOI:0,ceLTP:0,peLTP:0,ceIV:0,peIV:0,ceVol:0,peVol:0};
              if (row.CE) { map[k].ceOI+=row.CE.openInterest||0; map[k].ceLTP=row.CE.lastPrice||0; map[k].ceIV=row.CE.impliedVolatility||0; map[k].ceVol+=row.CE.totalTradedVolume||0; }
              if (row.PE) { map[k].peOI+=row.PE.openInterest||0; map[k].peLTP=row.PE.lastPrice||0; map[k].peIV=row.PE.impliedVolatility||0; map[k].peVol+=row.PE.totalTradedVolume||0; }
            });
            chain = Object.values(map).filter(r=>r.ceOI>0||r.peOI>0).sort((a,b)=>a.strike-b.strike);
          }
        }
      } catch(nseErr) { console.warn('Expiry NSE fetch failed:', nseErr.message); }

      // ── Try Yahoo Finance if NSE gave nothing ──
      if (chain.length === 0) {
        try {
          const yahooSym = EXPIRY_YAHOO[symbol] || '^NSEI';
          const yahooRes = await fetch(`${YAHOO}/options/${encodeURIComponent(yahooSym)}`);
          if (yahooRes.ok) {
            const yj = await yahooRes.json();
            const result = yj?.optionChain?.result?.[0];
            if (result) {
              S = result.quote?.regularMarketPrice || BASE[symbol] || 25000;
              const ymap = {};
              (result.options?.[0]?.calls||[]).forEach(c => { const k=c.strike; if(!ymap[k]) ymap[k]={strike:k,ceOI:0,peOI:0,ceLTP:0,peLTP:0,ceIV:0,peIV:0,ceVol:0,peVol:0}; ymap[k].ceOI=c.openInterest||0; ymap[k].ceLTP=c.lastPrice||0; ymap[k].ceIV=(c.impliedVolatility||0)*100; ymap[k].ceVol=c.volume||0; });
              (result.options?.[0]?.puts ||[]).forEach(p => { const k=p.strike; if(!ymap[k]) ymap[k]={strike:k,ceOI:0,peOI:0,ceLTP:0,peLTP:0,ceIV:0,peIV:0,ceVol:0,peVol:0}; ymap[k].peOI=p.openInterest||0; ymap[k].peLTP=p.lastPrice||0; ymap[k].peIV=(p.impliedVolatility||0)*100; ymap[k].peVol=p.volume||0; });
              chain = Object.values(ymap).sort((a,b)=>a.strike-b.strike);
            }
          }
        } catch(yErr) { console.warn('Expiry Yahoo fetch failed:', yErr.message); }
      }

      // ── Simulation fallback if both fail ──
      if (chain.length === 0) {
        S = BASE[symbol] || 25000;
        const step = STEP[symbol] || 50;
        const baseIV = { NIFTY:16, BANKNIFTY:20, FINNIFTY:18, MIDCPNIFTY:22 }[symbol] || 16;
        for (let i = -10; i <= 10; i++) {
          const strike = Math.round(S/step)*step + i*step;
          const moneyness = (strike - S) / S;
          const ceIV = baseIV * (1 + Math.max(0,-moneyness)*0.5 + Math.abs(moneyness)*0.1);
          const peIV = baseIV * (1 + Math.max(0, moneyness)*0.5 + Math.abs(moneyness)*0.1);
          const ceLTP = Math.max(0.5, (i<0 ? S-strike : 0) + S*ceIV/100*Math.sqrt(7/365)*0.4);
          const peLTP = Math.max(0.5, (i>0 ? strike-S : 0) + S*peIV/100*Math.sqrt(7/365)*0.4);
          const ceOI  = Math.round(500000 * Math.exp(-0.3*Math.abs(i)) * (i>=0?1.2:0.8));
          const peOI  = Math.round(500000 * Math.exp(-0.3*Math.abs(i)) * (i<=0?1.2:0.8));
          chain.push({ strike, ceOI, peOI, ceLTP:+ceLTP.toFixed(1), peLTP:+peLTP.toFixed(1), ceIV:+ceIV.toFixed(1), peIV:+peIV.toFixed(1), ceVol:Math.round(ceOI*0.3), peVol:Math.round(peOI*0.3) });
        }
      }

      computeExpiryMetrics(chain, S || BASE[symbol] || 25000, symbol);
    } catch(e) {
      console.error('fetchExpiryData failed:', e.message);
    } finally { setExpiryLoading(false); }
  };

  // Fetch option chain for any symbol — backend (NSE+Yahoo inside) then simulation fallback
  // Returns { chain, spot, nearExpiry } — never throws
  const fetchChainForSymbol = async (sym) => {
    const BASE = { NIFTY:25500, BANKNIFTY:54000, FINNIFTY:23500, MIDCPNIFTY:12800 };
    const GAP  = { NIFTY:50,   BANKNIFTY:100,   FINNIFTY:50,    MIDCPNIFTY:25 };

    // --- Tier 1: backend /api/option-chain (tries NSE then Yahoo internally) ---
    try {
      const r = await fetch(`${BACKEND_URL}/api/option-chain?symbol=${sym}`, { headers:{'Accept':'application/json'} });
      if (r.ok) {
        const j = await r.json();
        if (j?.records?.data?.length > 0) {
          const spot = j.records.underlyingValue || 0;
          const allRows = j.records.data;
          const expiries = j.records.expiryDates || [];
          const nearExpiry = expiries[0] || '';
          const rows = nearExpiry ? allRows.filter(r => r.expiryDate === nearExpiry) : allRows.slice(0, 120);
          const map = {};
          rows.forEach(row => {
            const K = row.strikePrice; if (!K) return;
            if (!map[K]) map[K] = { strike:K };
            if (row.CE) map[K].ce = { ltp: row.CE.lastPrice||0, iv: row.CE.impliedVolatility||0, oi: row.CE.openInterest||0 };
            if (row.PE) map[K].pe = { ltp: row.PE.lastPrice||0, iv: row.PE.impliedVolatility||0, oi: row.PE.openInterest||0 };
          });
          const chain = Object.values(map).filter(r => r.ce && r.pe).sort((a,b) => a.strike-b.strike);
          if (chain.length > 0 && spot > 0) return { chain, spot, nearExpiry };
        }
      }
    } catch(e) { /* fall through to simulation */ }

    // --- Tier 2: Simulation — use live spot from marketData, not stale BASE ──
    const liveSpot = sym==='NIFTY'?marketData.nifty.value:sym==='BANKNIFTY'?marketData.bankNifty.value:0;
    const spot = (liveSpot > 10000) ? liveSpot : (BASE[sym] || 24500);
    const gap  = GAP[sym]  || 50;
    const atm  = Math.round(spot/gap)*gap;
    const chain = Array.from({length:25},(_,i)=>atm+(i-12)*gap).map(K => {
      const d = Math.abs(K-spot);
      const iv = 14 + (d/spot)*120 + (Math.random()*2-1);
      const oiMul = Math.max(0.05, 1-(d/(spot*0.08)));
      return {
        strike: K,
        ce: { ltp: Math.max(0.5, K<spot ? spot-K : 0) + iv*0.1, iv, oi: Math.floor((60000+Math.random()*140000)*oiMul) },
        pe: { ltp: Math.max(0.5, K>spot ? K-spot : 0) + iv*0.1, iv, oi: Math.floor((60000+Math.random()*140000)*oiMul) },
      };
    });
    return { chain, spot, nearExpiry: 'simulated' };
  };

  const fetchGex = async (sym) => {
    const s = sym || gexSymbol;
    setGexLoading(true);
    setGexError('');
    setGexData(null);

    try {
      // Fetch chain with full NSE→Yahoo→Simulation fallback
      const { chain, spot, nearExpiry } = await fetchChainForSymbol(s);

      // Parse expiry date for T
      const monthMap2 = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
      let T = 7/365;
      if (nearExpiry && nearExpiry !== 'Yahoo' && nearExpiry !== 'simulated') {
        const parts = nearExpiry.split('-');
        if (parts.length === 3) {
          const expDate = new Date(parseInt(parts[2]), monthMap2[parts[1]] ?? parseInt(parts[1])-1, parseInt(parts[0]), 15, 30, 0);
          const msLeft = expDate - Date.now();
          if (msLeft > 0) T = msLeft / (1000*60*60*24*365);
        }
      }
      T = Math.max(T, 1/365);

      const lotMap = { NIFTY:75, BANKNIFTY:30, FINNIFTY:60, MIDCPNIFTY:120, SENSEX:10 };
      const lotSize = lotMap[s] || 75;

      function normPDF(x) { return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI); }
      function bsGamma(S, K, t, sigma) {
        if (t <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
        try {
          const d1 = (Math.log(S/K) + (0.065 + 0.5*sigma*sigma)*t) / (sigma*Math.sqrt(t));
          return normPDF(d1) / (S * sigma * Math.sqrt(t));
        } catch(e) { return 0; }
      }

      const strikes = chain.map(row => {
        const K    = row.strike;
        const ceIV = (parseFloat(row.ce?.iv) || 15) / 100;
        const peIV = (parseFloat(row.pe?.iv) || 15) / 100;
        const ceOI = row.ce?.oi || 0;
        const peOI = row.pe?.oi || 0;
        const ceGEX = bsGamma(spot, K, T, ceIV) * ceOI * lotSize * spot * spot * 0.01;
        const peGEX = bsGamma(spot, K, T, peIV) * peOI * lotSize * spot * spot * 0.01;
        return { strike:K, ceGEX, peGEX, netGEX: ceGEX-peGEX, ceOI, peOI,
          ceLTP: parseFloat(row.ce?.ltp)||0, peLTP: parseFloat(row.pe?.ltp)||0,
          ceIV: parseFloat(row.ce?.iv)||0, peIV: parseFloat(row.pe?.iv)||0 };
      });

      const totalGEX = strikes.reduce((sum, sk) => sum + sk.netGEX, 0);

      let gammaFlip = null;
      for (let i = 1; i < strikes.length; i++) {
        if (strikes[i-1].netGEX * strikes[i].netGEX < 0) { gammaFlip = strikes[i].strike; break; }
      }

      const byAbsGex = [...strikes].sort((a,b) => Math.abs(b.netGEX) - Math.abs(a.netGEX));
      // Resistance walls: positive GEX ABOVE spot (CE-heavy strikes above current price)
      const posWalls  = byAbsGex.filter(sk => sk.netGEX > 0 && sk.strike >= spot).slice(0,3).map(sk => sk.strike);
      // Support walls: negative GEX BELOW spot (PE-heavy strikes below current price)
      const negWalls  = byAbsGex.filter(sk => sk.netGEX < 0 && sk.strike <= spot).slice(0,3).map(sk => sk.strike);
      // Top CE OI above spot = resistance; Top PE OI below spot = support
      const topCallOI = [...strikes].filter(sk => sk.strike > spot).sort((a,b) => b.ceOI - a.ceOI).slice(0,3).map(sk => sk.strike);
      const topPutOI  = [...strikes].filter(sk => sk.strike < spot).sort((a,b) => b.peOI - a.peOI).slice(0,3).map(sk => sk.strike);

      const zoneLabel = totalGEX > 0
        ? ((gammaFlip && spot > gammaFlip) ? 'Positive Gamma — Pinning likely' : 'Positive Gamma — Range bound')
        : 'Negative Gamma — Trend amplification';

      const nearStrikes = strikes.filter(r => r.strike >= spot*0.96 && r.strike <= spot*1.04);
      const isSimulated = nearExpiry === 'simulated';

      setGexData({
        symbol: s, spot, lotSize, totalGEX: Math.round(totalGEX),
        gammaFlip, vannaFlip: null, charmCentre: Math.round(spot),
        posWalls, negWalls, topCallOI, topPutOI,
        zoneLabel, regime: totalGEX > 0 ? 'positive' : 'negative',
        nearExpiry, rowCount: chain.length, lotSizeSource: 'computed',
        strikes: nearStrikes, isSimulated,
      });
    } catch(e) {
      setGexError('GEX failed: ' + e.message);
    }
    setGexLoading(false);
  };

  const executePaperOrder = async () => {
    const { symbol, type, qty, price, orderType } = paperOrder;
    if (!symbol || !qty || qty <= 0) { setPaperMsg('❌ Enter valid symbol and quantity'); return; }

    // Fetch live price
    let ltp = parseFloat(price);
    if (orderType === 'MARKET' || !ltp) {
      try {
        const sym = symbol.toUpperCase().includes('NIFTY') ? '^NSEI' :
                    symbol.toUpperCase().includes('BANKNIFTY') ? '^NSEBANK' :
                    `${symbol.toUpperCase()}.NS`;
        const r = await fetch(`${BACKEND_URL}/api/stock-price?symbol=${encodeURIComponent(sym)}`);
        const d = await r.json();
        ltp = d.price || d.regularMarketPrice || 0;
      } catch(e) { ltp = parseFloat(price) || 0; }
    }
    if (!ltp) { setPaperMsg('❌ Could not fetch price. Enter manually.'); return; }

    const cost = ltp * qty;
    if (type === 'BUY' && cost > paperBalance) { setPaperMsg(`❌ Insufficient balance. Need ₹${cost.toLocaleString('en-IN')}`); return; }

    // Check if selling existing position
    if (type === 'SELL') {
      const pos = paperPositions.find(p => p.symbol === symbol.toUpperCase());
      if (!pos || pos.qty < qty) { setPaperMsg('❌ No open position to sell'); return; }
      const pnl = (ltp - pos.avgPrice) * qty;
      setPaperPositions(prev => {
        const updated = prev.map(p => p.symbol === symbol.toUpperCase()
          ? { ...p, qty: p.qty - qty }
          : p
        ).filter(p => p.qty > 0);
        return updated;
      });
      setPaperBalance(b => b + cost);
      const trade = { id: Date.now(), symbol: symbol.toUpperCase(), type: 'SELL', qty, price: ltp, pnl, time: new Date().toLocaleString('en-IN') };
      setPaperHistory(h => [trade, ...h].slice(0, 100));
      setPaperMsg(`✅ SELL executed @ ₹${ltp.toFixed(2)} | P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`);
    } else {
      // BUY
      setPaperBalance(b => b - cost);
      setPaperPositions(prev => {
        const existing = prev.find(p => p.symbol === symbol.toUpperCase());
        if (existing) {
          return prev.map(p => p.symbol === symbol.toUpperCase()
            ? { ...p, qty: p.qty + qty, avgPrice: (p.avgPrice * p.qty + ltp * qty) / (p.qty + qty) }
            : p
          );
        }
        return [...prev, { symbol: symbol.toUpperCase(), qty, avgPrice: ltp, buyTime: new Date().toLocaleString('en-IN') }];
      });
      const trade = { id: Date.now(), symbol: symbol.toUpperCase(), type: 'BUY', qty, price: ltp, pnl: null, time: new Date().toLocaleString('en-IN') };
      setPaperHistory(h => [trade, ...h].slice(0, 100));
      setPaperMsg(`✅ BUY executed @ ₹${ltp.toFixed(2)} | Cost: ₹${cost.toLocaleString('en-IN')}`);
    }
    setTimeout(() => setPaperMsg(''), 4000);
  };

  const resetPaperAccount = () => {
    if (!window.confirm('Reset paper trading account? All positions and history will be cleared.')) return;
    setPaperBalance(500000);
    setPaperPositions([]);
    setPaperHistory([]);
    setPaperMsg('✅ Account reset to ₹5,00,000');
    setTimeout(() => setPaperMsg(''), 3000);
  };

  // Telegram
  const sendTelegramMessage = async (text, dedupeKey) => {
    if (!tgChatId) return;
    // Deduplicate  -  don't send same alert twice within 1 hour
    const key = dedupeKey || text.substring(0, 60);
    if (sentTgAlerts.current.has(key)) return;
    sentTgAlerts.current.add(key);
    setTimeout(() => sentTgAlerts.current.delete(key), 60 * 60 * 1000); // clear after 1 hour
    try {
      await fetch(`${BACKEND_URL}/api/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChatId, text, parse_mode: 'HTML' })
      });
    } catch(e) { console.warn('TG failed', e); }
  };
  const testTelegram = async () => {
    setTgStatus('testing');
    try {
      const res = await fetch(`${BACKEND_URL}/api/telegram`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:tgChatId,parse_mode:'HTML',text:'\u2705 <b>DeltaBuddy Connected!</b>\n\n\ud83d\udcf0 High-impact news alerts: ON\n\ud83d\udd0d Scanner alerts: ON\n\nHappy Trading! \ud83d\ude80'})});
      const d = await res.json(); setTgStatus(d.ok?'ok':'error');
    } catch(e) { setTgStatus('error'); }
  };
  const testGroq = async () => {
    setGroqStatus('testing');
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + groqApiKey.trim()
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{role:'user', content:'Reply OK'}],
          max_tokens: 5
        })
      });
      const d = await res.json();
      setGroqStatus(d.choices && d.choices.length > 0 ? 'ok' : 'error');
    } catch(e) {
      setGroqStatus('error');
    }
  };
  // Trade Journal helpers
  const addTrade = (form) => {
    const entry = { ...form, id:Date.now(), timestamp:new Date().toISOString(), pnl: form.exitPrice ? ((parseFloat(form.exitPrice)-parseFloat(form.entryPrice))*(form.action==='BUY'?1:-1)*parseInt(form.qty)*50).toFixed(0) : null };
    const newLog = [entry, ...tradeLog];
    setTradeLog(newLog);
    // Detect revenge/impulse trading
    const recent = newLog.slice(0,3);
    const recentLosses = recent.filter(t=>t.pnl&&parseFloat(t.pnl)<0).length;
    const timeDiffs = recent.slice(0,-1).map((t,i)=>(new Date(t.timestamp)-new Date(recent[i+1].timestamp))/60000);
    const tooFast = timeDiffs.some(d=>d<15);
    if (recentLosses>=2 && tooFast) {
      const end = new Date(Date.now()+30*60*1000);
      setCooldownActive(true); setCooldownEnd(end);
      if (tgChatId) sendTelegramMessage('\u26a0\ufe0f <b>DeltaBuddy Risk Alert</b>\n\n2 losses in quick succession detected.\n\n\ud83e\uddd8 <b>30-minute cooldown activated.</b>\n\nStep away. Review your trades. Return with a clear mind.\n\nRemember: Revenge trading destroys accounts.\n\n\ud83d\udcca Check your Journal in DeltaBuddy.');
    }
  };
  const deleteTrade = (id) => setTradeLog(prev=>prev.filter(t=>t.id!==id));
  const journalStats = () => {
    const trades = tradeLog.filter(t=>t.pnl!==null);
    const wins = trades.filter(t=>parseFloat(t.pnl)>0);
    const losses = trades.filter(t=>parseFloat(t.pnl)<0);
    const totalPnl = trades.reduce((s,t)=>s+parseFloat(t.pnl),0);
    const impulse = tradeLog.filter(t=>['FOMO','Revenge','Boredom'].includes(t.reason)).length;
    return { total:trades.length, wins:wins.length, losses:losses.length, winRate:trades.length?((wins.length/trades.length)*100).toFixed(1):0, totalPnl:totalPnl.toFixed(0), impulse, avgWin:wins.length?(wins.reduce((s,t)=>s+parseFloat(t.pnl),0)/wins.length).toFixed(0):0, avgLoss:losses.length?(losses.reduce((s,t)=>s+parseFloat(t.pnl),0)/losses.length).toFixed(0):0 };
  };

  // Groq AI analysis
  const analyzeNewsWithGroq = async (article) => {
    const prompt = `You are an expert Indian stock market analyst for NSE options traders.

Title: ${article.title}
Description: ${article.description||'N/A'}

Respond ONLY with valid JSON:
{"sentiment":"bullish"|"bearish"|"neutral","impact":"high"|"medium"|"low","impactReason":"one line","affectedIndex":"Nifty 50"|"Bank Nifty"|"Nifty IT"|"Nifty Pharma"|"Nifty Auto"|"Nifty FMCG"|"Nifty Metal"|"Nifty Energy","affectedStocks":["SYM1","SYM2"],"keyInsight":"one professional sentence for Indian traders","tradingStrategy":{"name":"Bull Call Spread"|"Bear Put Spread"|"Long Straddle"|"Iron Condor"|"Sell Strangle"|"Wait and Watch","reasoning":"2 sentences with specific NSE market impact","timeframe":"Intraday"|"1-3 Days"|"Weekly","risk":"Low"|"Medium"|"High"}}`;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqApiKey.trim()},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],max_tokens:400,temperature:0.3})});
      const d = await res.json();
      return JSON.parse((d.choices?.[0]?.message?.content||'{}').replace(/```json|```/g,'').trim());
    } catch(e) { console.warn('Groq failed:',e.message); return null; }
  };
  // Keyword fallback
  const analyzeSentiment = (text) => { const t=text.toLowerCase(); const b=['rally','surge','gains','rise','bullish','positive','growth','strong','boost','soar','record','upgrade'],br=['fall','drop','crash','decline','loss','bearish','negative','weak','concern','fear','sell','downgrade','plunge']; let bs=0,brs=0; b.forEach(w=>{if(t.includes(w))bs++;}); br.forEach(w=>{if(t.includes(w))brs++;}); return bs>brs?'bullish':brs>bs?'bearish':'neutral'; };
  const calculateImpact = (article) => { const t=(article.title+' '+(article.description||'')).toLowerCase(); const h=['rbi','reserve bank','repo rate','budget','fii','interest rate','inflation','gdp','crude oil','election','policy'],m=['earnings','profit','revenue','results','quarter','stocks','market']; let s=0; h.forEach(w=>{if(t.includes(w))s+=3;}); m.forEach(w=>{if(t.includes(w))s+=1;}); return s>=5?'high':s>=2?'medium':'low'; };
  const predictAffectedIndex = (article) => { const t=(article.title+' '+(article.description||'')).toLowerCase(); if(t.includes('bank')||t.includes('hdfc')||t.includes('icici')||t.includes('sbi')) return 'Bank Nifty'; if(t.includes('tcs')||t.includes('infosys')||t.includes('wipro')||t.includes('hcl')) return 'Nifty IT'; if(t.includes('pharma')||t.includes('drug')) return 'Nifty Pharma'; if(t.includes('auto')||t.includes('maruti')) return 'Nifty Auto'; if(t.includes('metal')||t.includes('steel')||t.includes('alumin')) return 'Nifty Metal'; return 'Nifty 50'; };

  // NSE → display name mapping for indices
  const NSE_INDEX_MAP = {
    'Nifty 50'                 : 'NIFTY 50',
    'Bank Nifty'               : 'NIFTY BANK',
    'Fin Nifty'                : 'NIFTY FINANCIAL SERVICES',
    'Nifty IT'                 : 'NIFTY IT',
    'Nifty Pharma'             : 'NIFTY PHARMA',
    'Nifty Auto'               : 'NIFTY AUTO',
    'Nifty Metal'              : 'NIFTY METAL',
    'Nifty FMCG'               : 'NIFTY FMCG',
    'Nifty Realty'             : 'NIFTY REALTY',
    'Nifty Energy'             : 'NIFTY ENERGY',
    'Nifty Midcap Select'      : 'NIFTY MIDCAP SELECT',
    'Nifty Midcap 50'          : 'NIFTY MIDCAP 50',
    'Nifty Midcap 100'         : 'NIFTY MIDCAP 100',
    'Nifty Smallcap 50'        : 'NIFTY SMALLCAP 50',
    'Nifty Smallcap 100'       : 'NIFTY SMALLCAP 100',
    'Nifty Financial Services' : 'NIFTY FINANCIAL SERVICES',
    'Nifty PSU Bank'           : 'NIFTY PSU BANK',
    'Nifty Private Bank'       : 'NIFTY PRIVATE BANK',
    'Nifty Infrastructure'     : 'NIFTY INFRASTRUCTURE',
    'Nifty Next 50'            : 'NIFTY NEXT 50',
    'Nifty 100'                : 'NIFTY 100',
    'Nifty 200'                : 'NIFTY 200',
    'Nifty 500'                : 'NIFTY 500',
    'India VIX'                : 'INDIA VIX',
  };

  // NSE stock symbol map (display name → NSE symbol)
  const NSE_STOCK_MAP = {
    'Reliance':'RELIANCE','TCS':'TCS','HDFC Bank':'HDFCBANK',
    'Infosys':'INFY','ICICI Bank':'ICICIBANK','Bharti Airtel':'BHARTIARTL',
    'ITC':'ITC','SBI':'SBIN','LT':'LT','Kotak Bank':'KOTAKBANK',
    'HCL Tech':'HCLTECH','Axis Bank':'AXISBANK','Maruti Suzuki':'MARUTI',
    'Titan':'TITAN','Bajaj Finance':'BAJFINANCE','Wipro':'WIPRO',
    'Sun Pharma':'SUNPHARMA','Tata Motors':'TATAMOTORS','Asian Paints':'ASIANPAINT',
    'Adani Ports':'ADANIPORTS','ONGC':'ONGC','NTPC':'NTPC',
    'Power Grid':'POWERGRID','M&M':'M&M','Tech Mahindra':'TECHM',
    'Tata Steel':'TATASTEEL','JSW Steel':'JSWSTEEL','Coal India':'COALINDIA',
    'Dr Reddy':'DRREDDY','Cipla':'CIPLA','Bajaj Auto':'BAJAJ-AUTO',
    'Hero MotoCorp':'HEROMOTOCO','Eicher Motors':'EICHERMOT',
    'Hindalco':'HINDALCO','Britannia':'BRITANNIA','Nestle India':'NESTLEIND',
    'UltraTech Cement':'ULTRACEMCO','Adani Enterprises':'ADANIENT',
    'Bajaj Finserv':'BAJAJFINSV','Divi Labs':'DIVISLAB','Grasim':'GRASIM',
    'IndusInd Bank':'INDUSINDBK','SBI Life':'SBILIFE','HDFC Life':'HDFCLIFE',
    'UPL':'UPL',
  };

  // Fetch live prices from NSE directly — exact same data as NSE website & brokers
  const fetchLivePrices = async () => {
    setIsPriceLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/nse-quotes`);
      if (!r.ok) throw new Error(`NSE quotes ${r.status}`);
      const raw = await r.json();

      const priceMap = {}, changeMap = {}, prevCloseMap = {}, netChangeMap = {};

      // Map indices — NSE returns name like 'NIFTY 50', we map to our display name
      const reverseIndexMap = Object.fromEntries(Object.entries(NSE_INDEX_MAP).map(([k,v])=>[v,k]));
      Object.entries(raw).forEach(([nseName, d]) => {
        // Try direct match first, then reverse index map
        const displayName = reverseIndexMap[nseName] || nseName;
        if (!d?.price) return;
        priceMap[displayName]     = d.price;
        changeMap[displayName]    = d.change ?? 0;
        prevCloseMap[displayName] = d.prevClose || 0;
        netChangeMap[displayName] = d.netChange || 0;

        // Also store by NSE symbol for stocks (e.g. 'RELIANCE')
        priceMap[nseName]     = d.price;
        changeMap[nseName]    = d.change ?? 0;
        prevCloseMap[nseName] = d.prevClose || 0;
      });

      // Also map by our stock display names
      Object.entries(NSE_STOCK_MAP).forEach(([displayName, nseSymbol]) => {
        if (raw[nseSymbol]) {
          const d = raw[nseSymbol];
          priceMap[displayName]     = d.price;
          changeMap[displayName]    = d.change ?? 0;
          prevCloseMap[displayName] = d.prevClose || 0;
        }
      });

      // India VIX from NSE allIndices
      if (raw['INDIA VIX']) {
        const vd = raw['INDIA VIX'];
        setMarketData(prev => ({
          ...prev,
          vix: {
            value  : vd.price,
            change : vd.change ?? 0,
            level  : vd.price > 24 ? 'HIGH' : vd.price > 20 ? 'ELEVATED' : vd.price > 14 ? 'MODERATE' : 'LOW',
            color  : vd.price > 24 ? 'red'  : vd.price > 20 ? 'orange'   : vd.price > 14 ? 'yellow'   : 'green',
          }
        }));
      }

      if (Object.keys(priceMap).length > 0) {
        setLivePrices(prev    => ({ ...prev, ...priceMap    }));
        setLiveChanges(prev   => ({ ...prev, ...changeMap   }));
        setLivePrevClose(prev => ({ ...prev, ...prevCloseMap}));

        // Update top-level market data cards
        const niftyPrice = priceMap['Nifty 50'] || priceMap['NIFTY 50'];
        const bankPrice  = priceMap['Bank Nifty'] || priceMap['NIFTY BANK'];
        if (niftyPrice || bankPrice) {
          setMarketData(prev => ({
            ...prev,
            nifty    : niftyPrice ? { value: niftyPrice, change: changeMap['Nifty 50'] || changeMap['NIFTY 50'] || prev.nifty.change } : prev.nifty,
            bankNifty: bankPrice  ? { value: bankPrice,  change: changeMap['Bank Nifty']|| changeMap['NIFTY BANK'] || prev.bankNifty.change } : prev.bankNifty,
          }));
        }
      }
    } catch(err) {
      console.error('fetchLivePrices (NSE) error:', err.message);
    } finally {
      setIsPriceLoading(false);
    }
  };


  const fetchVix = async () => {
    // VIX is now fetched inside fetchLivePrices from NSE allIndices
    // This is kept as a fallback via Yahoo Finance
    try {
      const r = await fetch(`${BACKEND_URL}/api/vix`);
      if (!r.ok) return;
      const d = await r.json();
      if (d.vix) {
        setMarketData(prev => ({
          ...prev,
          vix: prev.vix?.value ? prev.vix : { value: d.vix, change: d.change || 0, level: d.level, color: d.color }
        }));
      }
    } catch(e) { /* silent */ }
  };

    // Fetch Global Indices (Real-time from Yahoo Finance)
  const fetchGlobalIndices = async () => {
    try {
      const symbols = {
        'S&P 500': '^GSPC',
        'Dow Jones': '^DJI',
        'Nasdaq': '^IXIC',
        'FTSE 100': '^FTSE',
        'DAX': '^GDAXI',
        'CAC 40': '^FCHI',
        'Nikkei 225': '^N225',
        'Hang Seng': '^HSI',
        'Shanghai': '000001.SS',
        'KOSPI': '^KS11',
        'Gold': 'GC=F',
        'Silver': 'SI=F',
        'Crude Oil': 'CL=F',
        'Bitcoin': 'BTC-USD',
      };

      const results = {};

      await Promise.all(
        Object.entries(symbols).map(async ([name, symbol]) => {
          try {
            const res = await fetch(`${YAHOO}/chart/${symbol}?interval=1m&range=1d`);
            const data = await res.json();
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            const prevClose = data?.chart?.result?.[0]?.meta?.previousClose || data?.chart?.result?.[0]?.meta?.chartPreviousClose;
            const change = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : 0;

            if (price) {
              results[name] = { 
                value: name.includes('Gold') || name.includes('Silver') || name.includes('Crude') ? price.toFixed(2) : Math.round(price), 
                change: parseFloat(change) 
              };
            }
          } catch (e) {
            console.log(`Could not fetch ${name}`);
          }
        })
      );

      if (Object.keys(results).length > 0) {
        setGlobalIndices(prev => ({ ...prev, ...results }));
        setLastUpdateTime(new Date());
      }
    } catch (error) {
      console.error('Error fetching global indices:', error);
    }
  };

  const UNDERLYING_YAHOO = { 'NIFTY':'^NSEI','BANKNIFTY':'^NSEBANK','FINNIFTY':'NIFTY_FIN_SERVICE.NS','MIDCPNIFTY':'^NSEMDCP50' };
  const UNDERLYING_NSE   = { 'NIFTY':'NIFTY','BANKNIFTY':'BANKNIFTY','FINNIFTY':'FINNIFTY','MIDCPNIFTY':'MIDCPNIFTY' };
  const BASE_PRICES = { 'NIFTY':25500,'BANKNIFTY':54000,'FINNIFTY':23500,'MIDCPNIFTY':12800 };
  const STRIKE_GAP  = { 'NIFTY':50,'BANKNIFTY':100,'FINNIFTY':50,'MIDCPNIFTY':25 };

  const buildSimulatedChain = (underlying, spot) => {
    const gap = STRIKE_GAP[underlying]||50;
    const atm = Math.round(spot/gap)*gap;
    const strikes = Array.from({length:21},(_,i)=>atm+(i-10)*gap);
    return strikes.map(strike => {
      const d = Math.abs(strike-spot);
      const itmCE = strike<spot, itmPE = strike>spot;
      const ceIV = 13+(d/spot)*120+(Math.random()*3-1.5);
      const peIV = 13+(d/spot)*120+(Math.random()*3-1.5);
      const cePrem = Math.max(0.5, itmCE?(spot-strike)+(strike*ceIV/100*Math.sqrt(7/365)):(strike*ceIV/100*Math.sqrt(7/365)));
      const pePrem = Math.max(0.5, itmPE?(strike-spot)+(strike*peIV/100*Math.sqrt(7/365)):(strike*peIV/100*Math.sqrt(7/365)));
      const oiMul = Math.max(0.15,1-(d/(spot*0.08)));
      const ceOI=Math.floor((80000+Math.random()*150000)*oiMul);
      const peOI=Math.floor((80000+Math.random()*150000)*oiMul);
      return {strike,atmDistance:d,
        ce:{premium:cePrem.toFixed(2),iv:ceIV.toFixed(1),oi:ceOI,volume:Math.floor(ceOI*0.08),bid:(cePrem*0.98).toFixed(2),ask:(cePrem*1.02).toFixed(2),ltp:cePrem.toFixed(2),change:(Math.random()*16-8).toFixed(2),delta:itmCE?0.65+Math.random()*0.25:0.1+Math.random()*0.35,gamma:0.001+Math.random()*0.009,theta:-(0.4+Math.random()*1.8),vega:4+Math.random()*9},
        pe:{premium:pePrem.toFixed(2),iv:peIV.toFixed(1),oi:peOI,volume:Math.floor(peOI*0.08),bid:(pePrem*0.98).toFixed(2),ask:(pePrem*1.02).toFixed(2),ltp:pePrem.toFixed(2),change:(Math.random()*16-8).toFixed(2),delta:itmPE?-(0.65+Math.random()*0.25):-(0.1+Math.random()*0.35),gamma:0.001+Math.random()*0.009,theta:-(0.4+Math.random()*1.8),vega:4+Math.random()*9}};
    });
  };

  // Parse stored raw NSE data for a specific expiry into liveOptionChain
  // Parse raw NSE rows for a specific expiry → setLiveOptionChain
  const parseChainForExpiry = (rawRows, expiry, spot) => {
    const rows = rawRows.filter(r => r.expiryDate === expiry);
    if (!rows.length) return;
    const map = {};
    rows.forEach(row => {
      const K = row.strikePrice;
      if (!K) return;
      if (!map[K]) map[K] = { strike: K };
      if (row.CE) map[K].ce = {
        ltp:   (row.CE.lastPrice        || 0).toFixed(2),
        iv:    (row.CE.impliedVolatility || 0).toFixed(1),
        oi:     row.CE.openInterest          || 0,
        oiChg:  row.CE.changeinOpenInterest  || 0,
        volume: row.CE.totalTradedVolume     || 0,
        bid:   (row.CE.bidprice         || 0).toFixed(2),
        ask:   (row.CE.askPrice         || 0).toFixed(2),
        change:(row.CE.change           || 0).toFixed(2),
        pChange:(row.CE.pChange         || 0).toFixed(2),
      };
      if (row.PE) map[K].pe = {
        ltp:   (row.PE.lastPrice        || 0).toFixed(2),
        iv:    (row.PE.impliedVolatility || 0).toFixed(1),
        oi:     row.PE.openInterest          || 0,
        oiChg:  row.PE.changeinOpenInterest  || 0,
        volume: row.PE.totalTradedVolume     || 0,
        bid:   (row.PE.bidprice         || 0).toFixed(2),
        ask:   (row.PE.askPrice         || 0).toFixed(2),
        change:(row.PE.change           || 0).toFixed(2),
        pChange:(row.PE.pChange         || 0).toFixed(2),
      };
    });
    // Fill missing side with zeros so row always appears
    Object.values(map).forEach(r => {
      const empty = { ltp:'0.00', iv:'0.0', oi:0, oiChg:0, volume:0, bid:'0.00', ask:'0.00', change:'0.00', pChange:'0.00' };
      if (!r.ce) r.ce = empty;
      if (!r.pe) r.pe = { ...empty };
    });
    const chain = Object.values(map).sort((a,b) => a.strike - b.strike);
    setLiveOptionChain(chain);
    setChartData({
      oi:     chain.map(r => ({ strike:r.strike, ce:r.ce.oi/1000,             pe:r.pe.oi/1000 })),
      iv:     chain.map(r => ({ strike:r.strike, ce:parseFloat(r.ce.iv),      pe:parseFloat(r.pe.iv) })),
      volume: chain.map(r => ({ strike:r.strike, ce:r.ce.volume/1000,         pe:r.pe.volume/1000 })),
      priceHistory: [],
    });
  };

  const generateLiveOptionChain = async (underlying = 'NIFTY', forceExpiry = null, _isRetry = false) => {
    setIsLoadingChain(true);
    setLiveOptionChain([]);

    const trySource = async (url) => {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal });
        if (!r.ok) return null;
        const j = await r.json();
        if (!j?.error && j?.records?.data?.length > 0) return j;
        return null;
      } catch(e) { return null; }
      finally { clearTimeout(timer); }
    };

    try {
      let data = null;

      // Tier 1: Dhan API (most reliable from cloud)
      console.log('[OC] Trying Dhan...');
      data = await trySource(`${BACKEND_URL}/api/dhan/option-chain?symbol=${underlying}`);

      // Tier 2: NSE direct (may work sometimes)
      if (!data) {
        console.log('[OC] Trying NSE...');
        data = await trySource(`${BACKEND_URL}/api/option-chain?symbol=${UNDERLYING_NSE[underlying]||underlying}`);
      }

      if (data?.records?.data?.length > 0) {
        const spot     = data.records.underlyingValue || BASE_PRICES[underlying];
        const allRows  = data.records.data;
        const expiries = data.records.expiryDates ||
          [...new Set(allRows.map(r => r.expiryDate))];

        setNseExpiryDates(expiries);
        setRawNseData(allRows);
        setMarketData(prev => ({
          ...prev,
          nifty:     underlying==='NIFTY'     ? {...prev.nifty,     value: Math.round(spot)} : prev.nifty,
          bankNifty: underlying==='BANKNIFTY'  ? {...prev.bankNifty, value: Math.round(spot)} : prev.bankNifty,
        }));

        const useExpiry = forceExpiry ||
          (selectedExpiry && expiries.includes(selectedExpiry) ? selectedExpiry : expiries[0]);
        setSelectedExpiry(useExpiry);
        parseChainForExpiry(allRows, useExpiry, spot);
        return;
      }
    } catch(e) {
      console.warn('[OC] error:', e.message);
    } finally {
      setIsLoadingChain(false);
    }

    setLiveOptionChain([]);
    setNseExpiryDates([]);
    if (!_isRetry) {
      setTimeout(() => generateLiveOptionChain(underlying, forceExpiry, true), 4000);
    }
  };

  // Fetch General Business News
  // Fetch F&O Ban List from NSE
  const fetchBanList = async () => {
    setBanLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/nse/fno-ban`);
      if (r.ok) { const d = await r.json(); setBanList(d.securities||[]); }
    } catch(e) { console.log('Ban list fetch failed'); }
    finally { setBanLoading(false); setBanFetched(true); }
  };

  const fetchBusinessNews = async () => {
    setIsLoadingBusinessNews(true);
    try {
      // Use free RSS feeds  -  no API key needed
      const RSS_PROXY = `${BACKEND_URL}/api/rss-news`;
      const response = await fetch(RSS_PROXY);
      const data = await response.json();
      if (data.articles) {
        setBusinessNews(data.articles.map(article => ({
          id: article.url,
          title: article.title,
          description: article.description,
          source: article.source,
          publishedAt: new Date(article.publishedAt),
          url: article.url,
          image: null,
        })));
      }
    } catch (error) {
      console.error('Error fetching business news:', error);
    } finally {
      setIsLoadingBusinessNews(false);
    }
  };

  const CHART_YAHOO_MAP = {'NIFTY':'^NSEI','BANKNIFTY':'^NSEBANK','FINNIFTY':'NIFTY_FIN_SERVICE.NS','MIDCPNIFTY':'^NSEMDCP50','SENSEX':'^BSESN','RELIANCE':'RELIANCE.NS','TCS':'TCS.NS','HDFCBANK':'HDFCBANK.NS','INFY':'INFY.NS','ICICIBANK':'ICICIBANK.NS','SBIN':'SBIN.NS','BHARTIARTL':'BHARTIARTL.NS','ITC':'ITC.NS','LT':'LT.NS','KOTAKBANK':'KOTAKBANK.NS','AXISBANK':'AXISBANK.NS','HCLTECH':'HCLTECH.NS','WIPRO':'WIPRO.NS','TATAMOTORS':'TATAMOTORS.NS','TATASTEEL':'TATASTEEL.NS','MARUTI':'MARUTI.NS','BAJFINANCE':'BAJFINANCE.NS','SUNPHARMA':'SUNPHARMA.NS','ADANIENT':'ADANIENT.NS','NESTLEIND':'NESTLEIND.NS','ULTRACEMCO':'ULTRACEMCO.NS','POWERGRID':'POWERGRID.NS','NTPC':'NTPC.NS','COALINDIA':'COALINDIA.NS','ONGC':'ONGC.NS','HINDALCO':'HINDALCO.NS','JSWSTEEL':'JSWSTEEL.NS','MM':'M&M.NS','TITAN':'TITAN.NS','BAJAJ-AUTO':'BAJAJ-AUTO.NS','HEROMOTOCO':'HEROMOTOCO.NS','EICHERMOT':'EICHERMOT.NS','DRREDDY':'DRREDDY.NS','CIPLA':'CIPLA.NS','BRITANNIA':'BRITANNIA.NS','GRASIM':'GRASIM.NS','ASIANPAINT':'ASIANPAINT.NS','TECHM':'TECHM.NS','INDUSINDBK':'INDUSINDBK.NS','SBILIFE':'SBILIFE.NS','HDFCLIFE':'HDFCLIFE.NS','ADANIPORTS':'ADANIPORTS.NS','BAJAJFINSV':'BAJAJFINSV.NS','DIVISLAB':'DIVISLAB.NS','UPL':'UPL.NS'};
  const TF_MAP = {'1m':{interval:'1m',range:'1d'},'3m':{interval:'5m',range:'1d'},'5m':{interval:'5m',range:'5d'},'15m':{interval:'15m',range:'5d'},'30m':{interval:'30m',range:'1mo'},'1H':{interval:'60m',range:'1mo'},'4H':{interval:'60m',range:'3mo'},'1D':{interval:'1d',range:'1y'},'1W':{interval:'1wk',range:'5y'},'1M':{interval:'1mo',range:'max'},'3M':{interval:'1d',range:'6mo'},'6M':{interval:'1d',range:'1y'},'1Y':{interval:'1d',range:'2y'}};
  const generateCandlestickData = async (symbol, timeframe) => {
    const ticker = (CHART_YAHOO_MAP[symbol]||symbol+'.NS').trim();
    const {interval,range} = TF_MAP[timeframe]||{interval:'5m',range:'5d'};
    try {
      const res = await fetch(`${YAHOO}/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0]; if (!result) throw new Error('No result');
      const ts=result.timestamp, q=result.indicators?.quote?.[0]; if (!ts||!q) throw new Error('No OHLCV');
      const candles = ts.map((t,i)=>({time:t*1000,open:(q.open[i]??0).toFixed(2),high:(q.high[i]??0).toFixed(2),low:(q.low[i]??0).toFixed(2),close:(q.close[i]??0).toFixed(2),volume:q.volume[i]??0})).filter(c=>parseFloat(c.close)>0);
      if (!candles.length) throw new Error('Empty');
      setCandlestickData(candles); setLastChartUpdate(new Date());
    } catch(e) {
      console.warn('Chart failed:',e.message);
      const base=marketData.nifty.value||23450; let p=base*0.97; const v=base*0.002;
      setCandlestickData(Array.from({length:60},(_,i)=>{const chg=(Math.random()-0.48)*v,o=p,c=p+chg;p=c;return{time:Date.now()-(60-i)*300000,open:o.toFixed(2),high:(Math.max(o,c)+Math.random()*v*0.4).toFixed(2),low:(Math.min(o,c)-Math.random()*v*0.4).toFixed(2),close:c.toFixed(2),volume:Math.floor(300000+Math.random()*1e6)};}));
    }
  };

  // Calculate Technical Indicators
  const calculateSMA = (data, period = 20) => {
    return data.map((candle, idx) => {
      if (idx < period - 1) return { time: candle.time, value: null };
      const sum = data.slice(idx - period + 1, idx + 1).reduce((acc, c) => acc + parseFloat(c.close), 0);
      return { time: candle.time, value: (sum / period).toFixed(2) };
    });
  };

  const calculateRSI = (data, period = 14) => {
    const changes = data.map((candle, idx) => {
      if (idx === 0) return 0;
      return parseFloat(candle.close) - parseFloat(data[idx - 1].close);
    });
    
    return data.map((candle, idx) => {
      if (idx < period) return { time: candle.time, value: null };
      
      const gains = changes.slice(idx - period + 1, idx + 1).filter(c => c > 0);
      const losses = changes.slice(idx - period + 1, idx + 1).filter(c => c < 0).map(c => Math.abs(c));
      
      const avgGain = gains.reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
      
      const rs = avgGain / (avgLoss || 1);
      const rsi = 100 - (100 / (1 + rs));
      
      return { time: candle.time, value: rsi.toFixed(2) };
    });
  };

  // Custom Scanner Filter Runner
  const runCustomFilter = (filter) => {
    const newAlerts = [];
    
    optionChainData.forEach(row => {
      let matches = true;
      
      filter.conditions.forEach(condition => {
        const value = condition.metric === 'ceOI' ? row.ceOI :
                     condition.metric === 'peOI' ? row.peOI :
                     condition.metric === 'cePremium' ? row.cePremium :
                     condition.metric === 'pePremium' ? row.pePremium :
                     condition.metric === 'ceVolume' ? row.ceVolume :
                     condition.metric === 'peVolume' ? row.peVolume : 0;
        
        if (condition.operator === '>' && !(value > condition.value)) matches = false;
        if (condition.operator === '<' && !(value < condition.value)) matches = false;
        if (condition.operator === '=' && value !== condition.value) matches = false;
      });
      
      if (matches) {
        newAlerts.push({
          type: 'custom',
          title: `🎯 ${filter.name}`,
          description: `Strike ${row.strike} matches your custom filter`,
          recommendation: 'Review manually',
          severity: 'medium'
        });
      }
    });
    
    setAlerts(prev => [...prev, ...newAlerts]);
  };

  const calculateKeyLevels = (indexName) => {
    const p = livePrices[indexName]||livePrices['Nifty 50']||23450;
    const r = (n)=>Math.round(n/50)*50;
    return {current:p,support:[r(p*0.985),r(p*0.970),r(p*0.955)],resistance:[r(p*1.015),r(p*1.030),r(p*1.045)]};
  };

  const fetchIntelligentNews = async () => {
    setIsLoadingNews(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/rss-news`);
      const data = await response.json();
      if (!data.articles) throw new Error('No articles');
      const analyzed = await Promise.all(data.articles.map(async (article) => {
        let analysis;
        if (groqApiKey) {
          const ai = await analyzeNewsWithGroq(article);
          if (ai) {
            const kl = calculateKeyLevels(ai.affectedIndex);
            analysis = {sentiment:ai.sentiment,impact:ai.impact,impactReason:ai.impactReason,affectedIndex:ai.affectedIndex,affectedStocks:ai.affectedStocks||[],keyInsight:ai.keyInsight,keyLevels:kl,tradingIdea:{strategy:ai.tradingStrategy?.name,name:ai.tradingStrategy?.name,reasoning:ai.tradingStrategy?.reasoning,timeframe:ai.tradingStrategy?.timeframe,risk:ai.tradingStrategy?.risk,strikes:null,probability:null,aiPowered:true}};
            if (notifyHighImpact && ai.impact==='high' && tgChatId) {
              const em = ai.sentiment==='bullish'?'🟢':ai.sentiment==='bearish'?'🔴':'⚪';
              sendTelegramMessage(`${em} <b>HIGH IMPACT  -  ${ai.affectedIndex}</b>

<b>${article.title}</b>

📊 <b>${ai.sentiment.toUpperCase()}</b>
💡 ${ai.keyInsight}
📈 Strategy: <b>${ai.tradingStrategy?.name}</b>
⏱ ${ai.tradingStrategy?.timeframe}

🔗 <a href="${article.url}">Read more</a>`, article.url);
            }
            return {id:article.url,title:article.title,description:article.description,source:article.source.name,publishedAt:new Date(article.publishedAt),url:article.url,analysis};
          }
        }
        const sentiment=analyzeSentiment(article.title+' '+(article.description||''));
        const impact=calculateImpact(article);
        const affectedIndex=predictAffectedIndex(article);
        const keyLevels=calculateKeyLevels(affectedIndex);
        const lv=keyLevels;
        const tradingIdea=sentiment==='bearish'&&impact!=='low'?{strategy:'Bear Put Spread',name:'Bear Put Spread',reasoning:`${impact} impact bearish news suggests downward pressure.`,timeframe:'1-3 Days',risk:'Medium',strikes:{buy:Math.round(lv.current),sell:Math.round(lv.support[0])},probability:' - ',aiPowered:false}:sentiment==='bullish'&&impact!=='low'?{strategy:'Bull Call Spread',name:'Bull Call Spread',reasoning:`${impact} impact bullish news suggests upward momentum.`,timeframe:'1-3 Days',risk:'Medium',strikes:{buy:Math.round(lv.current),sell:Math.round(lv.resistance[0])},probability:' - ',aiPowered:false}:{strategy:'Wait and Watch',name:'Wait and Watch',reasoning:'Direction unclear.',timeframe:'N/A',risk:'None',strikes:null,probability:' - ',aiPowered:false};
        analysis={sentiment,impact,impactReason:'',affectedIndex,affectedStocks:[],keyInsight:'',keyLevels,tradingIdea};
        return {id:article.url,title:article.title,description:article.description,source:article.source.name,publishedAt:new Date(article.publishedAt),url:article.url,analysis};
      }));
      setIntelligentNews(analyzed);
    } catch(error) { console.error('News error:',error); } finally { setIsLoadingNews(false); }
  };

  const formatNewsTime = (timestamp) => {
    const diff = Date.now() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return timestamp.toLocaleDateString();
  };

  const loadStrategyFromNews = (tradingIdea) => {
    if (tradingIdea.strategy === 'Bear Put Spread' && tradingIdea.strikes) {
      setActiveTab('analyse');setAnalyseSubTab('strategy');
      const newLegs = [
        { id: 1, position: 'buy', optionType: 'put', strike: tradingIdea.strikes.buy, premium: 150, quantity: 1 },
        { id: 2, position: 'sell', optionType: 'put', strike: tradingIdea.strikes.sell, premium: 80, quantity: 1 }
      ];
      setLegs(newLegs);
    } else if (tradingIdea.strategy === 'Bull Call Spread' && tradingIdea.strikes) {
      setActiveTab('analyse');setAnalyseSubTab('strategy');
      const newLegs = [
        { id: 1, position: 'buy', optionType: 'call', strike: tradingIdea.strikes.buy, premium: 150, quantity: 1 },
        { id: 2, position: 'sell', optionType: 'call', strike: tradingIdea.strikes.sell, premium: 80, quantity: 1 }
      ];
      setLegs(newLegs);
    }
  };

  // SCANNER FUNCTIONS
  const runScan = () => {
    const chain = liveOptionChain;
    if (!chain.length) {
      setScanResults([{ type:'error', title:'No Data', description:'Load the option chain first from the Markets tab.', severity:'low', action:'' }]);
      return;
    }
    setScanRunning(true);
    const results = [];
    const S = spot;

    // ATM strike
    const atmRow = chain.reduce((a,b) => Math.abs(b.strike-S) < Math.abs(a.strike-S) ? b : a);
    const atm = atmRow.strike;

    // Total OI
    const totalCE = chain.reduce((s,r) => s + (r.ce?.oi||0), 0);
    const totalPE = chain.reduce((s,r) => s + (r.pe?.oi||0), 0);
    const pcr = totalCE > 0 ? totalPE / totalCE : 1;

    // ── 1. MARKET CRASH WARNING — CE O=H + PE under VWAP ─────────────────
    // CE O=H: option opened at high and rejected downward (sellers in control)
    // PE under VWAP at same strike: PE not yet priced in the fall → cheap entry
    if (selectedFilters.includes('crash_warning')) {
      // Scan all strikes near ATM (±300)
      const nearATM = chain.filter(r => Math.abs(r.strike - atm) <= 300);
      nearATM.forEach(row => {
        const ceLtp  = parseFloat(row.ce?.ltp  || 0);
        const ceBid  = parseFloat(row.ce?.bid  || 0);
        const ceAsk  = parseFloat(row.ce?.ask  || 0);
        const ceChg  = parseFloat(row.ce?.pChange || 0);
        const peLtp  = parseFloat(row.pe?.ltp  || 0);
        const peBid  = parseFloat(row.pe?.bid  || 0);
        const peAsk  = parseFloat(row.pe?.ask  || 0);

        if (ceLtp < 5 || peLtp < 5 || ceBid <= 0 || peAsk <= 0) return;

        // O=H for CE: LTP at/near bid (sellers hitting) + fallen from prev close
        const ceAtBid   = ceLtp <= ceBid * 1.03;
        const ceNegChg  = ceChg < -3;
        // PE under VWAP: LTP below mid-price (not priced in yet — cheap)
        const peMid      = (peBid + peAsk) / 2;
        const peUnderVWAP = peLtp < peMid * 0.98;

        if (ceAtBid && ceNegChg && peUnderVWAP) {
          results.push({
            type:'crash_warning', icon:'🔴', severity:'high',
            title:`Market Crash Setup — Strike ${row.strike}`,
            description:`CE O=H: LTP ₹${ceLtp} at bid (${ceChg.toFixed(1)}% change) — sellers in control. PE ₹${peLtp} trading below VWAP mid ₹${peMid.toFixed(0)} — not priced in yet. Strong crash setup.`,
            metric:`CE bid: ₹${ceBid} | PE mid: ₹${peMid.toFixed(0)} | PE LTP: ₹${peLtp}`,
            action:`Buy ${row.strike} PE — crash not priced in`,
            strategy:'long-put',
          });
        }
      });
    }

    // ── 2. MARKET BLAST — PE O=L + CE under VWAP (exact opposite) ─────────
    // PE O=L: PE opened at its low and bounced (put writers defending)
    // CE under VWAP at same strike: CE not yet priced in the rally → cheap entry
    if (selectedFilters.includes('blast_warning')) {
      const nearATM = chain.filter(r => Math.abs(r.strike - atm) <= 300);
      nearATM.forEach(row => {
        const ceLtp  = parseFloat(row.ce?.ltp  || 0);
        const ceBid  = parseFloat(row.ce?.bid  || 0);
        const ceAsk  = parseFloat(row.ce?.ask  || 0);
        const peChg  = parseFloat(row.pe?.pChange || 0);
        const peLtp  = parseFloat(row.pe?.ltp  || 0);
        const peBid  = parseFloat(row.pe?.bid  || 0);

        if (ceLtp < 5 || peLtp < 5 || peBid <= 0 || ceAsk <= 0) return;

        // O=L for PE: PE LTP at/near bid (sellers hitting puts) + fallen from prev close
        const peAtBid    = peLtp <= peBid * 1.03;
        const peNegChg   = peChg < -3;
        // CE under VWAP: CE LTP below mid-price — CE not priced in the rally yet
        const ceMid      = (ceBid + ceAsk) / 2;
        const ceUnderVWAP = ceLtp < ceMid * 0.98;

        if (peAtBid && peNegChg && ceUnderVWAP) {
          results.push({
            type:'blast_warning', icon:'🟢', severity:'high',
            title:`Market Blast Setup — Strike ${row.strike}`,
            description:`PE O=L: LTP ₹${peLtp} at bid (${peChg.toFixed(1)}% change) — put writers defending. CE ₹${ceLtp} trading below VWAP mid ₹${ceMid.toFixed(0)} — rally not priced in. Strong blast setup.`,
            metric:`PE bid: ₹${peBid} | CE mid: ₹${ceMid.toFixed(0)} | CE LTP: ₹${ceLtp}`,
            action:`Buy ${row.strike} CE — rally not priced in`,
            strategy:'long-call',
          });
        }
      });
    }

    // ── 3. SYNTHETIC FUTURE — Put-Call Parity Detector ────────────────────
    // Synthetic Long = Buy CE + Sell PE at same strike → tracks underlying tick-for-tick (delta ≈ 1)
    // Put-call parity: CE - PE ≈ Spot - Strike (at fair value)
    // If actual (CE - PE) deviates from (Spot - Strike), there is a mispricing → arb/entry opportunity
    if (selectedFilters.includes('synthetic')) {
      chain.forEach(row => {
        const ce  = parseFloat(row.ce?.ltp || 0);
        const pe  = parseFloat(row.pe?.ltp || 0);
        if (ce < 5 || pe < 5) return;

        const actualDiff    = ce - pe;               // What market says: CE - PE
        const theoreticalDiff = S - row.strike;       // Put-call parity: Spot - Strike
        const deviation     = actualDiff - theoreticalDiff;  // Mispricing
        const netCost       = Math.abs(actualDiff);   // Net premium to enter

        // At ATM: theoretical diff ≈ 0, so CE ≈ PE → synthetic costs near zero
        // Best entry: |deviation| < 20 AND net cost is low relative to ATM CE
        const atmCE = parseFloat(atmRow.ce?.ltp || 100);
        if (Math.abs(deviation) < 25 && netCost < atmCE * 0.15) {
          const direction = actualDiff >= 0 ? 'Long (Buy CE, Sell PE)' : 'Short (Sell CE, Buy PE)';
          results.push({
            type:'synthetic', icon:'⚖️', severity:'medium',
            title:`Synthetic Future — Strike ${row.strike}`,
            description:`CE ₹${ce.toFixed(0)} − PE ₹${pe.toFixed(0)} = ₹${actualDiff.toFixed(0)} vs theoretical ₹${theoreticalDiff.toFixed(0)}. Deviation: ₹${deviation.toFixed(0)}. This synthetic tracks NIFTY futures tick-for-tick. Net cost: ₹${(netCost * (row.strike < 25000 ? 75 : 75)).toFixed(0)}.`,
            metric:`Net debit: ₹${netCost.toFixed(0)} | Deviation: ₹${deviation.toFixed(0)} | Delta ≈ 1.0`,
            action:`Synthetic ${direction}`,
            strategy: actualDiff >= 0 ? 'synthetic-long' : 'synthetic-short',
          });
        }
      });
    }

    // ── 4. IV CRUSH SETUP ─────────────────────────────────────────────────
    // High IV (>25%) near expiry (<5 DTE) = sell premium
    if (selectedFilters.includes('iv_crush')) {
      const dte = daysToExpiry;
      chain.filter(r => Math.abs(r.strike-atm) <= 200).forEach(row => {
        const ceIV = parseFloat(row.ce?.iv || 0);
        const peIV = parseFloat(row.pe?.iv || 0);
        const avgIV = (ceIV + peIV) / 2;
        if (avgIV > 22 && dte <= 7) {
          results.push({
            type:'iv_crush', icon:'⚡', severity:'high',
            title:`IV Crush Setup — ${row.strike} Strike`,
            description:`IV at ${avgIV.toFixed(1)}% with ${dte} DTE. Post-event IV collapse likely. Sell premium now.`,
            metric:`CE IV: ${ceIV}% | PE IV: ${peIV}% | DTE: ${dte}`,
            action:'Sell Short Straddle / Iron Condor',
            strategy:'iron-condor',
          });
        }
      });
    }

    // ── 5. GAMMA SQUEEZE ZONE ────────────────────────────────────────────
    // Maximum combined OI concentration near ATM = explosive move likely
    if (selectedFilters.includes('gamma_squeeze')) {
      const atmRange = chain.filter(r => Math.abs(r.strike-atm) <= 200);
      const maxOIRow = atmRange.reduce((a,b) => ((b.ce?.oi||0)+(b.pe?.oi||0)) > ((a.ce?.oi||0)+(a.pe?.oi||0)) ? b : a, atmRange[0]);
      if (maxOIRow) {
        const totalOI = (maxOIRow.ce?.oi||0) + (maxOIRow.pe?.oi||0);
        const chainMax = Math.max(...chain.map(r=>(r.ce?.oi||0)+(r.pe?.oi||0)));
        const concentration = totalOI / (chain.reduce((s,r)=>s+(r.ce?.oi||0)+(r.pe?.oi||0),0)||1) * 100;
        if (concentration > 15) {
          results.push({
            type:'gamma_squeeze', icon:'🔥', severity:'high',
            title:`Gamma Squeeze — ${maxOIRow.strike} is Max Pain`,
            description:`${concentration.toFixed(0)}% of total OI concentrated at ${maxOIRow.strike}. Market gravitates here into expiry. Big move if breached.`,
            metric:`CE OI: ${((maxOIRow.ce?.oi||0)/1000).toFixed(0)}K | PE OI: ${((maxOIRow.pe?.oi||0)/1000).toFixed(0)}K`,
            action:`Watch ${maxOIRow.strike} ± 100 for breakout entry`,
            strategy:'long-straddle',
          });
        }
      }
    }

    // ── 6. PCR EXTREME ───────────────────────────────────────────────────
    if (selectedFilters.includes('pcr_extreme')) {
      if (pcr > 1.5) {
        results.push({
          type:'pcr_extreme', icon:'📊', severity:'high',
          title:'Extreme Bullish PCR — Reversal Risk',
          description:`PCR = ${pcr.toFixed(2)}. Extreme put buying = over-hedged market. Contrarian: market likely to squeeze upward.`,
          metric:`Total CE OI: ${(totalCE/100000).toFixed(1)}L | PE OI: ${(totalPE/100000).toFixed(1)}L`,
          action:'Bull Call Spread or Long Call',
          strategy:'bull-call-spread',
        });
      } else if (pcr < 0.6) {
        results.push({
          type:'pcr_extreme', icon:'📊', severity:'high',
          title:'Extreme Bearish PCR — Reversal Risk',
          description:`PCR = ${pcr.toFixed(2)}. Extreme call buying = euphoric market. Contrarian: correction likely.`,
          metric:`Total CE OI: ${(totalCE/100000).toFixed(1)}L | PE OI: ${(totalPE/100000).toFixed(1)}L`,
          action:'Bear Put Spread or Short Straddle',
          strategy:'short-straddle',
        });
      }
    }

    // ── 7. OI BUILDUP ────────────────────────────────────────────────────
    if (selectedFilters.includes('oi_buildup')) {
      // Fresh CE OI adding = resistance building
      const topCEBuildup = [...chain].sort((a,b)=>(b.ce?.oiChg||0)-(a.ce?.oiChg||0)).slice(0,1)[0];
      const topPEBuildup = [...chain].sort((a,b)=>(b.pe?.oiChg||0)-(a.pe?.oiChg||0)).slice(0,1)[0];
      if (topCEBuildup && (topCEBuildup.ce?.oiChg||0) > 50000) {
        results.push({
          type:'oi_buildup', icon:'📈', severity:'medium',
          title:`Fresh CE OI Build — Resistance at ${topCEBuildup.strike}`,
          description:`+${((topCEBuildup.ce?.oiChg||0)/1000).toFixed(0)}K CE OI added at ${topCEBuildup.strike}. Writers building resistance. Watch for rejection.`,
          metric:`New CE OI: +${((topCEBuildup.ce?.oiChg||0)/1000).toFixed(0)}K`,
          action:'Short CE or Bear Call Spread at this strike',
          strategy:'bear-call-spread',
        });
      }
      if (topPEBuildup && (topPEBuildup.pe?.oiChg||0) > 50000) {
        results.push({
          type:'oi_buildup', icon:'📉', severity:'medium',
          title:`Fresh PE OI Build — Support at ${topPEBuildup.strike}`,
          description:`+${((topPEBuildup.pe?.oiChg||0)/1000).toFixed(0)}K PE OI added at ${topPEBuildup.strike}. Writers building support. Watch for bounce.`,
          metric:`New PE OI: +${((topPEBuildup.pe?.oiChg||0)/1000).toFixed(0)}K`,
          action:'Short PE or Bull Put Spread at this strike',
          strategy:'bull-put-spread',
        });
      }
    }

    if (results.length === 0) {
      results.push({
        type:'clear', icon:'✅', severity:'low',
        title:'No Signals Detected',
        description:'Market is calm. No extreme conditions found in selected filters. Check back when VIX spikes or near expiry.',
        metric:`PCR: ${pcr.toFixed(2)} | ATM: ${atm} | Chain: ${chain.length} strikes`,
        action:'',
      });
    }

    setScanResults(results);
    setAlerts(results);
    setLastScanTime(new Date());
    setScanRunning(false);
  };

  // Auto-refresh news and prices - LIVE MODE
  useEffect(() => {
    // Register PWA service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
    // Re-subscribe to backend alert engine on every load
    const chatId = localStorage.getItem('db_tg_chatid');
    if (chatId) {
      fetch(`${BACKEND_URL}/api/alert-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }),
      }).catch(() => {});
    }
    fetchLivePrices();
    fetchVix();
    fetchBanList();
    fetchIntelligentNews();
    fetchGlobalIndices();
    generateLiveOptionChain(selectedUnderlying);
    fetchBusinessNews();
    generateCandlestickData(selectedChartSymbol, chartTimeframe);
    fetchWatchlistPrices();
    
    if (isLiveMode) {
      // Ticker: Yahoo Finance every 15 seconds
      const globalInterval = setInterval(fetchGlobalIndices, 15000);

      // Live prices: Yahoo Finance every 15 seconds
      const indiaInterval = setInterval(fetchLivePrices, 15000);

      // Option chain: NSE every 10 seconds
      const chainInterval = setInterval(() => generateLiveOptionChain(selectedUnderlying), 10000);

      // News: NewsAPI + AI every 5 minutes (top 10 only)
      const newsInterval = setInterval(() => { fetchIntelligentNews(); fetchBusinessNews(); }, 300000);

      // Watchlist: every 30 seconds
      const watchInterval = setInterval(fetchWatchlistPrices, 30000);

      // Portfolio: every 30 seconds
      const portfolioInterval = setInterval(fetchPortfolio, 30000);

      // Expiry tools: recompute every 60s from live chain (no separate fetch needed)
      const expiryInterval = setInterval(() => { fetchExpiryData(expirySymbol); }, 60000);

      // VIX: every 60 seconds
      const vixInterval = setInterval(fetchVix, 60000);

      return () => {
        clearInterval(globalInterval);
        clearInterval(indiaInterval);
        clearInterval(chainInterval);
        clearInterval(newsInterval);
        clearInterval(watchInterval);
        clearInterval(portfolioInterval);
        clearInterval(expiryInterval);
        clearInterval(vixInterval);
      };
    }
  }, [isLiveMode, selectedUnderlying, selectedChartSymbol, chartTimeframe]);

  // Auto-load option chain on mount so PCR calculates immediately
  useEffect(() => {
    if (currentUser) generateLiveOptionChain(selectedUnderlying);
  }, [currentUser]);

  // Calculate PCR from option chain data
  useEffect(() => {
    if (optionChainData.length === 0) return;
    const totalCE = optionChainData.reduce((sum, d) => sum + d.ceOI, 0);
    const totalPE = optionChainData.reduce((sum, d) => sum + d.peOI, 0);
    const pcr = totalCE > 0 ? (totalPE / totalCE) : 1;
    let signal = 'Neutral';
    if (pcr > 1.3) signal = 'Bullish';
    else if (pcr > 1.1) signal = 'Mildly Bullish';
    else if (pcr < 0.7) signal = 'Bearish';
    else if (pcr < 0.9) signal = 'Mildly Bearish';
    setPcrData({ pcr: parseFloat(pcr.toFixed(2)), signal, totalCE, totalPE });
  }, [optionChainData]);

  // Calculate Max Pain from option chain data
  useEffect(() => {
    if (optionChainData.length === 0) return;
    let minPain = Infinity;
    let maxPainStrike = optionChainData[0].strike;
    optionChainData.forEach(testRow => {
      const testStrike = testRow.strike;
      let totalPain = 0;
      optionChainData.forEach(row => {
        // Pain for call writers
        if (testStrike > row.strike) totalPain += (testStrike - row.strike) * row.ceOI;
        // Pain for put writers
        if (testStrike < row.strike) totalPain += (row.strike - testStrike) * row.peOI;
      });
      if (totalPain < minPain) {
        minPain = totalPain;
        maxPainStrike = testStrike;
      }
    });
    setMaxPainData({ maxPain: maxPainStrike, currentSpot: spot });
  }, [optionChainData, spot]);

  // Build OI Chart data from liveOptionChain (real NSE data)
  useEffect(() => {
    if (liveOptionChain.length === 0) return;
    const chartData = liveOptionChain
      .filter(d => d.strike)
      .map(d => ({
        strike: d.strike,
        ce:    Math.round((d.ce?.oi    || 0) / 1000),
        pe:    Math.round((d.pe?.oi    || 0) / 1000),
        ceVol: Math.round((d.ce?.volume|| 0) / 1000),
        peVol: Math.round((d.pe?.volume|| 0) / 1000),
      }))
      .sort((a,b) => (b.ce+b.pe) - (a.ce+a.pe));
    setOiChartData(chartData);
  }, [liveOptionChain]);

  // -- Auto-fetch Markets tab data when sub-tab is opened -------------------
  useEffect(() => {
    if (activeTab !== 'markets') return;
    if (activeMarketsTab === 'option-chain') {
      if (liveOptionChain.length === 0) generateLiveOptionChain(selectedUnderlying);
    }
    if (activeMarketsTab === 'global-cues' && !globalCues) {
      setGlobalCuesLoading(true);
      fetch(`${BACKEND_URL}/api/global-cues`)
        .then(r=>r.json()).then(j=>{ if(j.ok) setGlobalCues(j); })
        .catch(()=>{}).finally(()=>setGlobalCuesLoading(false));
    }
    if (activeMarketsTab === 'fii-dii') {
      fetchFiiDii();
      fetchBulkDeals();
    }
    if (activeMarketsTab === 'events') {
      fetchEvents();
    }
  }, [activeMarketsTab, activeTab]); // eslint-disable-line

  // Track prevOI snapshot for Unusual OI card
  useEffect(() => {
    if (liveOptionChain.length === 0) return;
    const snapshot = {};
    liveOptionChain.forEach(r => { snapshot[r.strike] = { ce: r.ce?.oi||0, pe: r.pe?.oi||0 }; });
    setPrevOI(prev => Object.keys(prev).length === 0 ? snapshot : prev);
  }, [liveOptionChain]);

  // Auto-refresh expiry tools when on expiry tab (uses backend per-symbol fetch)
  useEffect(() => {
    if (activeTab === 'expiry' && !expiryData && !expiryLoading) fetchExpiryData(expirySymbol);
  }, [activeTab, expirySymbol]);


  const saveStrategy = () => {
    if (!strategyName.trim()) {
      alert('Please enter a strategy name');
      return;
    }

    const newStrategy = {
      id: Date.now(),
      name: strategyName,
      notes: strategyNotes,
      timestamp: new Date().toISOString(),
      data: {
        spot, strike, premium, lotSize, daysToExpiry, volatility,
        optionType, positionType, legs, selectedStrategy
      }
    };

    const updated = [...savedStrategies, newStrategy];
    setSavedStrategies(updated);
    localStorage.setItem('deltabuddy-strategies', JSON.stringify(updated));
    
    setShowSaveModal(false);
    setStrategyName('');
    setStrategyNotes('');
    alert('Strategy saved successfully!');
  };

  const loadStrategy = (strategy) => {
    const data = strategy.data;
    setSpot(data.spot);
    setStrike(data.strike);
    setPremium(data.premium);
    setLotSize(data.lotSize);
    setDaysToExpiry(data.daysToExpiry);
    setVolatility(data.volatility);
    setOptionType(data.optionType);
    setPositionType(data.positionType);
    setLegs(data.legs);
    setSelectedStrategy(data.selectedStrategy);
    setStrategyNotes(strategy.notes || '');
  };

  const deleteStrategy = (id) => {
    if (window.confirm('Delete this strategy?')) {
      const updated = savedStrategies.filter(s => s.id !== id);
      setSavedStrategies(updated);
      localStorage.setItem('deltabuddy-strategies', JSON.stringify(updated));
    }
  };

  const timeToExpiry = daysToExpiry / 365;
  const riskFreeRate = 0.065;
  const greeks = calculateBlackScholes(spot, strike, timeToExpiry, volatility / 100, riskFreeRate, optionType);

  const calculatePL = (currentSpot) => {
    let intrinsicValue = 0;
    if (optionType === 'call') {
      intrinsicValue = Math.max(0, currentSpot - strike);
    } else {
      intrinsicValue = Math.max(0, strike - currentSpot);
    }
    
    const valueAtExpiry = intrinsicValue;
    
    if (positionType === 'buy') {
      return (valueAtExpiry - premium) * lotSize;
    } else {
      return (premium - valueAtExpiry) * lotSize;
    }
  };

  const generatePLData = () => {
    const data = [];
    const range = strike * 0.15;
    const step = range / 50;
    
    for (let price = strike - range; price <= strike + range; price += step) {
      data.push({
        spot: Math.round(price),
        pl: calculatePL(price)
      });
    }
    return data;
  };

  const plData = generatePLData();
  const currentPL = calculatePL(spot);
  
  let maxProfit, maxLoss;
  
  if (positionType === 'buy') {
    if (optionType === 'call') {
      maxProfit = 'Unlimited';
      maxLoss = `₹${(premium * lotSize).toLocaleString()}`;
    } else {
      maxProfit = `₹${((strike - premium) * lotSize).toLocaleString()}`;
      maxLoss = `₹${(premium * lotSize).toLocaleString()}`;
    }
  } else {
    if (optionType === 'call') {
      maxProfit = `₹${(premium * lotSize).toLocaleString()}`;
      maxLoss = 'Unlimited';
    } else {
      maxProfit = `₹${(premium * lotSize).toLocaleString()}`;
      maxLoss = `₹${((strike - premium) * lotSize).toLocaleString()}`;
    }
  }

  const calculateProbability = () => {
    const breakEven = positionType === 'buy' 
      ? (optionType === 'call' ? strike + premium : strike - premium)
      : (optionType === 'call' ? strike + premium : strike - premium);
    
    const distance = Math.abs(spot - breakEven);
    const stdDev = spot * (volatility / 100) * Math.sqrt(timeToExpiry);
    const zScore = distance / stdDev;
    
    let probProfit;
    if (positionType === 'buy') {
      if (optionType === 'call') {
        probProfit = 1 - normalCDF(zScore);
      } else {
        probProfit = normalCDF(-zScore);
      }
    } else {
      if (optionType === 'call') {
        probProfit = normalCDF(zScore);
      } else {
        probProfit = 1 - normalCDF(-zScore);
      }
    }
    
    return (probProfit * 100).toFixed(1);
  };

  const gammaBlastZone = {
    center: strike,
    range: strike * (volatility / 100) * Math.sqrt(timeToExpiry)
  };

  const addLeg = () => {
    setLegs([...legs, {
      id: legs.length + 1,
      position: 'buy',
      optionType: 'call',
      strike: spot,
      premium: 100,
      quantity: 1
    }]);
  };

  const removeLeg = (id) => {
    setLegs(legs.filter(leg => leg.id !== id));
  };

  const updateLeg = (id, field, value) => {
    setLegs(legs.map(leg => 
      leg.id === id ? { ...leg, [field]: value } : leg
    ));
  };

  const loadStrategyTemplate = (strategyKey) => {
    const template = STRATEGY_TEMPLATES[strategyKey];
    const baseStrike = spot;
    const basePremium = 150;
    
    const newLegs = template.legs.map((leg, index) => ({
      id: index + 1,
      position: leg.position,
      optionType: leg.optionType,
      strike: Math.round(baseStrike + leg.strikeOffset),
      premium: Math.round(basePremium * leg.premiumPercent),
      quantity: leg.quantity || 1
    }));
    
    setLegs(newLegs);
    setSelectedStrategy(strategyKey);
  };

  const calculateMultiLegPL = (currentSpot) => {
    let totalPL = 0;
    
    legs.forEach(leg => {
      let legPL = 0;
      if (leg.optionType === 'future') {
        // Futures: P&L = (exit - entry) * lot * qty, no premium decay
        const entryFut = leg.premium; // we store futures entry price as premium
        legPL = leg.position === 'buy'
          ? (currentSpot - entryFut) * lotSize * (leg.quantity||1)
          : (entryFut - currentSpot) * lotSize * (leg.quantity||1);
      } else {
        let intrinsicValue = 0;
        if (leg.optionType === 'call') {
          intrinsicValue = Math.max(0, currentSpot - leg.strike);
        } else {
          intrinsicValue = Math.max(0, leg.strike - currentSpot);
        }
        legPL = leg.position === 'buy'
          ? (intrinsicValue - leg.premium) * lotSize * (leg.quantity||1)
          : (leg.premium - intrinsicValue) * lotSize * (leg.quantity||1);
      }
      totalPL += legPL;
    });
    
    return totalPL;
  };

  const generateMultiLegPLData = () => {
    const data = [];
    const optionLegs = legs.filter(l => l.optionType !== 'future');
    const futLegs    = legs.filter(l => l.optionType === 'future');
    const allStrikes = optionLegs.length ? optionLegs.map(l => l.strike) : [spot];
    const futPrices  = futLegs.map(l => l.premium);
    const allPivots  = [...allStrikes, ...futPrices];
    const minStrike = Math.min(...allPivots);
    const maxStrike = Math.max(...allPivots);
    const range = Math.max((maxStrike - minStrike) * 0.6, spot * 0.12);
    const center = (minStrike + maxStrike) / 2;
    const step = range / 80;
    for (let price = center - range; price <= center + range; price += step) {
      data.push({ spot: Math.round(price), pl: calculateMultiLegPL(price) });
    }
    return data;
  };

  const multiLegPLData = legs.length > 0 ? generateMultiLegPLData() : [];
  const currentMultiLegPL = legs.length > 0 ? calculateMultiLegPL(spot) : 0;

  const calculateMultiLegGreeks = () => {
    let totalDelta = 0, totalGamma = 0, totalTheta = 0, totalVega = 0;
    legs.forEach(leg => {
      const multiplier = leg.position === 'buy' ? 1 : -1;
      if (leg.optionType === 'future') {
        totalDelta += multiplier * (leg.quantity||1); // futures delta = 1 per lot
      } else {
        const legGreeks = calculateBlackScholes(spot, leg.strike, timeToExpiry, volatility/100, riskFreeRate, leg.optionType);
        totalDelta += legGreeks.delta * multiplier * (leg.quantity||1);
        totalGamma += legGreeks.gamma * multiplier * (leg.quantity||1);
        totalTheta += legGreeks.theta * multiplier * (leg.quantity||1);
        totalVega  += legGreeks.vega  * multiplier * (leg.quantity||1);
      }
    });
    return { delta: totalDelta, gamma: totalGamma, theta: totalTheta, vega: totalVega };
  };

  const multiLegGreeks = legs.length > 0 ? calculateMultiLegGreeks() : { delta: 0, gamma: 0, theta: 0, vega: 0 };

  const calculateMaxProfitLoss = () => {
    const testPrices = multiLegPLData.map(d => d.pl);
    const maxProfit = Math.max(...testPrices);
    const maxLoss = Math.min(...testPrices);
    
    return {
      maxProfit: maxProfit === Infinity ? 'Unlimited' : `₹${Math.round(maxProfit).toLocaleString()}`,
      maxLoss: maxLoss === -Infinity ? 'Unlimited' : `₹${Math.round(Math.abs(maxLoss)).toLocaleString()}`
    };
  };

  const { maxProfit: multiMaxProfit, maxLoss: multiMaxLoss } = legs.length > 0 ? calculateMaxProfitLoss() : { maxProfit: '₹0', maxLoss: '₹0' };

  const findBreakEvenPoints = () => {
    const breakEvens = [];
    for (let i = 1; i < multiLegPLData.length; i++) {
      const prev = multiLegPLData[i - 1];
      const curr = multiLegPLData[i];
      
      if ((prev.pl < 0 && curr.pl >= 0) || (prev.pl >= 0 && curr.pl < 0)) {
        breakEvens.push(curr.spot);
      }
    }
    return breakEvens;
  };

  const breakEvenPoints = activeTab === 'strategy' ? findBreakEvenPoints() : [];

  const calculatePositionSize = () => {
    const riskAmount = accountSize * (riskPercent / 100);
    const maxLossValue = activeTab === 'single' 
      ? (maxLoss === 'Unlimited' ? 0 : parseFloat(maxLoss.replace(/[₹,]/g, '')))
      : (multiMaxLoss === 'Unlimited' ? 0 : parseFloat(multiMaxLoss.replace(/[₹,]/g, '')));
    
    if (maxLossValue === 0) return { lots: 0, capitalRequired: 0, riskAmount };
    
    const maxLossPerLot = maxLossValue / lotSize;
    const recommendedLots = Math.floor(riskAmount / maxLossPerLot) * lotSize;
    
    return {
      lots: recommendedLots,
      capitalRequired: maxLossValue * (recommendedLots / lotSize),
      riskAmount: riskAmount
    };
  };

  const positionSize = calculatePositionSize();

  return (
    <div className="App">
      <nav className="navbar">
        <div className="container">
          {/* Logo */}
          <div className="logo" onClick={()=>{setActiveTab('home');setShowMobileMenu(false);}}
            style={{cursor:'pointer',userSelect:'none',borderBottom:activeTab==='home'?'2px solid var(--accent)':'2px solid transparent',paddingBottom:'2px',transition:'border-color 0.2s'}}>
            <span className="delta">Δ</span>
            <span>DeltaBuddy</span>
          </div>

          {/* Nav links  -  desktop only, scrollable */}
          <div className="nav-links">
            {[
              ['markets',      '📊 Markets'],
              ['intelligence', '🧠 Intel'],
              ['strategy',     '🎯 Strategy'],
              ['scanner',      '🔍 Scanner'],
              ['backtest',     '📈 Backtest'],
              ['single',       '🧮 Calc'],
              ['journal',      '📓 Journal'],
              ['paper',        '📝 Paper'],
              ['portfolio',    '💼 Portfolio'],
              ['expiry',       '⏰ Expiry'],
              ['gex',          '🎯 GEX'],
              ...(isAdmin ? [['admin', '🛡️ Admin']] : []),
            ].map(([tab,label])=>(
              <span key={tab} className={activeTab===tab?'active':''} onClick={()=>{setActiveTab(tab);setShowMobileMenu(false);}}>
                {label}
              </span>
            ))}
          </div>

          {/* Right controls */}
          <div className="navbar-right">
            {!authLoading && (currentUser ? (
              <>
                {subStatus === 'pro' ? (
                  <span style={{fontSize:'0.7rem',fontWeight:700,padding:'2px 8px',borderRadius:'20px',background:'linear-gradient(135deg,#f97316,#fbbf24)',color:'#000',whiteSpace:'nowrap'}}>
                    PRO
                  </span>
                ) : subStatus === 'expired' ? (
                  <button onClick={()=>setShowPricing(true)}
                    style={{fontSize:'0.72rem',fontWeight:700,padding:'3px 8px',borderRadius:'20px',background:'rgba(248,113,113,0.15)',border:'1px solid rgba(248,113,113,0.5)',color:'#f87171',cursor:'pointer',whiteSpace:'nowrap'}}>
                    Expired
                  </button>
                ) : (
                  null
                )}
                <button onClick={()=>setShowTgSetup(true)}
                  title={tgChatId?'Telegram connected  -  click to update':'Connect Telegram for alerts'}
                  style={{background:'none',border:'none',cursor:'pointer',padding:'4px',fontSize:'1.2rem',lineHeight:1,opacity:tgChatId?1:0.6}}>
                  {tgChatId ? '🔔' : '🔕'}
                </button>
                <div style={{cursor:'pointer'}} onClick={handleSignOut} title="Click to sign out">
                  {currentUser?.photoURL
                    ? <img src={currentUser?.photoURL} alt="" style={{width:'30px',height:'30px',borderRadius:'50%',border:'2px solid var(--accent)',display:'block',objectFit:'cover'}}/>
                    : <div style={{width:'30px',height:'30px',borderRadius:'50%',background:'var(--accent)',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:'0.85rem'}}>{(currentUser?.displayName||currentUser?.email||'U')[0].toUpperCase()}</div>
                  }
                </div>
              </>
            ) : (
              <button onClick={()=>setShowAuthModal(true)}
                style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.35rem 0.85rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem',whiteSpace:'nowrap'}}>
                Sign In
              </button>
            ))}
            <button className="hamburger" onClick={()=>setShowMobileMenu(m=>!m)}
              style={{background:'none',border:'none',cursor:'pointer',padding:'6px',lineHeight:1,color:'var(--text-main)'}}>
              {showMobileMenu ? '✕' : '☰'}
            </button>
          </div>
        </div>
      </nav>

      {/* -- MOBILE MENU  -  rendered outside navbar to avoid clipping -- */}
      {showMobileMenu && (
        <div style={{
          position:'fixed', top:'56px', left:0, right:0, bottom:0,
          background:'#070d1a', zIndex:9998,
          display:'flex', flexDirection:'column',
          borderTop:'2px solid #f97316',
          overflowY:'auto',
        }}>
          {[
            ['markets',      '📊 Markets'],
            ['intelligence', '🧠 Intelligence'],
            ['strategy',     '🎯 Strategy'],
            ['backtest',     '📈 Backtest'],
            ['single',       '🧮 Calculator'],
            ['scanner',      '🔍 Scanner'],
            ['journal',      '📓 Journal'],
            ['paper',        '📝 Paper Trade'],
            ['portfolio',    '💼 Portfolio'],
            ['expiry',       '⏰ Expiry Day'],
            ['gex',          '🎯 GEX / Greeks'],
            ...(isAdmin ? [['admin', '🛡️ Admin']] : []),
          ].map(([tab,label])=>(
            <div key={tab}
              onClick={()=>{setActiveTab(tab);setShowMobileMenu(false);}}
              style={{
                padding:'1.1rem 1.5rem',
                borderBottom:'1px solid rgba(255,255,255,0.07)',
                fontSize:'1.05rem',
                fontWeight: activeTab===tab ? 700 : 500,
                color: activeTab===tab ? '#f97316' : '#e2e8f0',
                background: activeTab===tab ? 'rgba(249,115,22,0.08)' : 'transparent',
                cursor:'pointer',
                display:'flex', alignItems:'center', gap:'0.5rem',
              }}>
              {label}
              {activeTab===tab && <span style={{marginLeft:'auto',color:'#f97316'}}>●</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{minHeight:'80vh'}}>
        {showSaveModal && (
          <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Save Strategy</h2>
              <div className="input-group">
                <label>Strategy Name *</label>
                <input 
                  type="text"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="e.g., Nifty Iron Condor Feb"
                  className="input-field"
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label>Notes (Optional)</label>
                <textarea 
                  value={strategyNotes}
                  onChange={(e) => setStrategyNotes(e.target.value)}
                  placeholder="Trade plan, exit strategy, etc..."
                  className="input-field"
                  rows="3"
                />
              </div>
              <div className="modal-buttons">
                <button className="btn-secondary" onClick={() => setShowSaveModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={saveStrategy}>
                  Save Strategy
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AUTH MODAL */}
        {/* -- TELEGRAM SETUP MODAL  -  for regular users -- */}
        {/* -- PAYWALL MODAL -- */}
        {showTgSetup && (
          <div className="modal-overlay" onClick={()=>setShowTgSetup(false)}>
            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'480px',width:'95%'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
                <h2 style={{margin:0,fontSize:'1.15rem'}}>📱 Connect Telegram Alerts</h2>
                <button onClick={()=>setShowTgSetup(false)} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.5rem',cursor:'pointer'}}>✕</button>
              </div>

              <p style={{color:'var(--text-dim)',fontSize:'0.82rem',marginBottom:'1.1rem',lineHeight:1.5}}>
                Get instant alerts for scanner signals and high-impact news directly on Telegram. Free. Takes 60 seconds.
              </p>

              {/* Steps */}
              <div style={{marginBottom:'1rem'}}>
                {[
                  { num:'1', title:'Open Telegram and find the bot', body: <span>Search for <a href="https://t.me/DeltaBuddyAlertBot" target="_blank" rel="noreferrer" style={{color:'var(--accent)',fontWeight:700}}>@DeltaBuddyAlertBot</a> and press <strong>Start</strong> or send <code style={{background:'rgba(0,255,136,0.1)',padding:'1px 5px',borderRadius:'3px',fontSize:'0.78rem'}}>/start</code></span> },
                  { num:'2', title:'The bot sends your Chat ID', body: <span>The bot will immediately reply with your <strong>numeric Chat ID</strong> (e.g. <code style={{background:'rgba(0,255,136,0.1)',padding:'1px 5px',borderRadius:'3px',fontSize:'0.78rem'}}>6458200459</code>). Copy that number.</span> },
                  { num:'3', title:"Can't find the bot or no reply?", body: (
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>
                      <div style={{marginBottom:'0.35rem'}}>Alternative: open <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" style={{color:'#60a5fa'}}>@userinfobot</a> → press Start → it shows your Chat ID instantly.</div>
                      <div style={{marginBottom:'0.35rem'}}>⚠️ <strong style={{color:'var(--text-main)'}}>Phone number does NOT work</strong> — Telegram uses a numeric ID, not your phone.</div>
                      <div>Your Chat ID looks like a plain number: <code style={{background:'rgba(0,255,136,0.1)',padding:'1px 5px',borderRadius:'3px'}}>6458200459</code> (positive) or <code style={{background:'rgba(0,255,136,0.1)',padding:'1px 5px',borderRadius:'3px'}}>-100123456789</code> (group).</div>
                    </div>
                  )},
                ].map(({num,title,body})=>(
                  <div key={num} style={{display:'flex',gap:'0.75rem',marginBottom:'0.9rem',alignItems:'flex-start'}}>
                    <div style={{width:'26px',height:'26px',borderRadius:'50%',background:'var(--accent)',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'0.82rem',flexShrink:0}}>{num}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:'0.85rem',marginBottom:'3px',color:'var(--text-main)'}}>{title}</div>
                      <div style={{fontSize:'0.79rem',color:'var(--text-dim)',lineHeight:1.5}}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick-access buttons */}
              <div style={{display:'flex',gap:'0.5rem',marginBottom:'1rem',flexWrap:'wrap'}}>
                <a href="https://t.me/DeltaBuddyAlertBot" target="_blank" rel="noreferrer"
                  style={{flex:1,background:'#229ED9',color:'white',border:'none',borderRadius:'7px',padding:'0.45rem 0.75rem',fontWeight:700,fontSize:'0.78rem',textDecoration:'none',textAlign:'center',display:'block'}}>
                  🤖 Open @DeltaBuddyAlertBot
                </a>
                <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer"
                  style={{flex:1,background:'rgba(99,102,241,0.15)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',borderRadius:'7px',padding:'0.45rem 0.75rem',fontWeight:700,fontSize:'0.78rem',textDecoration:'none',textAlign:'center',display:'block'}}>
                  🪪 Get Chat ID via @userinfobot
                </a>
              </div>

              {/* Chat ID input */}
              <div style={{background:'var(--bg-dark)',borderRadius:'8px',padding:'0.75rem',marginBottom:'1rem'}}>
                <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'block',marginBottom:'0.4rem'}}>
                  Paste your Chat ID here <span style={{color:'var(--text-muted)'}}>(numbers only — not your phone number)</span>:
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 6458200459"
                  value={tgChatId}
                  onChange={e=>setTgChatId(e.target.value.trim())}
                  style={{width:'100%',boxSizing:'border-box',fontSize:'1rem',letterSpacing:'0.05em'}}
                />
                {tgChatId && !/^-?\d+$/.test(tgChatId) && (
                  <div style={{color:'#f87171',fontSize:'0.72rem',marginTop:'0.3rem'}}>⚠️ Chat ID should be numbers only. Phone numbers won't work.</div>
                )}
              </div>

              <div style={{display:'flex',gap:'0.75rem'}}>
                <button
                  onClick={async()=>{
                    await testTelegram();
                    if(currentUser) {
                      try { await setDoc(doc(db,'users',currentUser.uid),{tgChatId,updatedAt:serverTimestamp()},{merge:true}); } catch(e){}
                    }
                    if (tgChatId) {
                      try {
                        await fetch(`${BACKEND_URL}/api/alert-subscribe`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ chat_id: tgChatId }),
                        });
                      } catch(e) {}
                    }
                  }}
                  disabled={!tgChatId||tgStatus==='testing'}
                  style={{flex:1,background:'#229ED9',color:'white',border:'none',borderRadius:'8px',padding:'0.6rem',fontWeight:700,cursor:'pointer',fontSize:'0.88rem'}}>
                  {tgStatus==='testing'?'⏳ Sending test...':'📤 Send Test Message'}
                </button>
                {tgStatus==='ok' && (
                  <button onClick={()=>setShowTgSetup(false)}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.88rem'}}>
                    Done ✓
                  </button>
                )}
              </div>
              {tgStatus==='ok' && <p style={{color:'#22c55e',fontSize:'0.82rem',marginTop:'0.5rem',textAlign:'center'}}>✅ Connected! You'll now receive DeltaBuddy alerts on Telegram.</p>}
              {tgStatus==='error' && <p style={{color:'#ef4444',fontSize:'0.82rem',marginTop:'0.5rem',textAlign:'center'}}>❌ Couldn't send. Make sure you pressed Start on the bot first, and the Chat ID is numeric.</p>}
            </div>
          </div>
        )}

        {showAuthModal && (
          <div className="modal-overlay" onClick={()=>{setShowAuthModal(false);setAuthError('');}}>
            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'400px',width:'95%'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
                <h2 style={{margin:0}}>{authMode==='login'?'Welcome Back':'Create Account'}</h2>
                <button onClick={()=>{setShowAuthModal(false);setAuthError('');}} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.4rem',cursor:'pointer'}}>x</button>
              </div>
              <button onClick={signInWithGoogle} disabled={authSubmitting}
                style={{width:'100%',padding:'0.75rem',background:'#fff',color:'#333',border:'none',borderRadius:'8px',fontWeight:600,fontSize:'0.95rem',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'0.6rem',marginBottom:'1rem'}}>
                Continue with Google
              </button>
              <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
                {authMode==='signup' && <input type="text" className="input-field" placeholder="Your name" value={authName} onChange={e=>setAuthName(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}/>}
                <input type="email" className="input-field" placeholder="Email address" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}/>
                <input type="password" className="input-field" placeholder="Password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')signInWithEmail();}} style={{width:'100%',boxSizing:'border-box'}}/>
              </div>
              {authError && <div style={{background:'#450a0a',border:'1px solid #ef4444',borderRadius:'6px',padding:'0.5rem 0.75rem',marginTop:'0.75rem',color:'#fca5a5',fontSize:'0.82rem'}}>{authError}</div>}
              <button onClick={signInWithEmail} disabled={authSubmitting||!authEmail||!authPassword}
                style={{width:'100%',marginTop:'1rem',padding:'0.75rem',background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',fontWeight:700,fontSize:'0.95rem',cursor:'pointer'}}>
                {authSubmitting?'Please wait...':authMode==='login'?'Sign In':'Create Account'}
              </button>
              <p style={{textAlign:'center',marginTop:'1rem',fontSize:'0.84rem',color:'var(--text-dim)'}}>
                {authMode==='login'?"No account? ":"Have account? "}
                <span style={{color:'var(--accent)',cursor:'pointer',fontWeight:600}} onClick={()=>{setAuthMode(m=>m==='login'?'signup':'login');setAuthError('');}}>
                  {authMode==='login'?'Sign up free':'Sign in'}
                </span>
              </p>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="modal-overlay" onClick={()=>setShowSettings(false)}>
            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'500px',width:'95%',maxHeight:'90vh',overflowY:'auto'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
                <h2 style={{margin:0}}>⚙️ Settings</h2>
                <button onClick={()=>setShowSettings(false)} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.5rem',cursor:'pointer',lineHeight:1}}>✕</button>
              </div>

              <div style={{marginBottom:'1.25rem',padding:'1rem',background:'var(--bg-dark)',borderRadius:'8px',border:'1px solid var(--border)'}}>
                <h3 style={{margin:'0 0 0.5rem',color:'var(--accent)',fontSize:'0.95rem'}}>🤖 Groq AI  -  News Intelligence (Free)</h3>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',margin:'0 0 0.6rem'}}>Free at <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>console.groq.com</a>  -  14,400 requests/day. Model: Llama 3.3 70B.</p>
                <input type="password" className="input-field" placeholder="Groq API key (gsk_...)" value={groqApiKey} onChange={e=>setGroqApiKey(e.target.value)} style={{width:'100%',boxSizing:'border-box',marginBottom:'0.5rem'}}/>
                <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                  <button className="btn-action" onClick={testGroq} disabled={!groqApiKey||groqStatus==='testing'}>{groqStatus==='testing'?'⏳ Testing...':'🔌 Test'}</button>
                  {groqStatus==='ok' && <button className="btn-action" style={{background:'#22c55e',color:'#000'}} onClick={()=>{setShowSettings(false);fetchIntelligentNews();}}>✅ Save & Load News</button>}
                  {groqStatus==='error' && <span style={{color:'#ef4444',fontSize:'0.82rem'}}>❌ Failed  -  check key</span>}
                  {groqStatus==='timeout' && <span style={{color:'#f59e0b',fontSize:'0.82rem'}}>⏳ Server waking up  -  wait 30s and try again</span>}
                  {!groqApiKey && <span style={{color:'var(--text-dim)',fontSize:'0.78rem'}}>No key  -  keyword mode</span>}
                </div>
              </div>

              <div style={{marginBottom:'1.25rem',padding:'1rem',background:'var(--bg-dark)',borderRadius:'8px',border:'1px solid #1e3a5f'}}>
                <h3 style={{margin:'0 0 0.5rem',color:'#229ED9',fontSize:'0.95rem'}}>📱 Telegram Alerts {!isPro && <span style={{fontSize:'0.7rem',background:'rgba(249,115,22,0.2)',color:'#f97316',border:'1px solid rgba(249,115,22,0.4)',borderRadius:'4px',padding:'1px 6px',marginLeft:'6px',fontWeight:700}}>PRO</span>}</h3>
                {isPro ? (<>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',margin:'0 0 0.6rem'}}>
                  Enter your Telegram Chat ID to receive live alerts:
                </p>
                <input type="text" className="input-field" placeholder="Your Chat ID (e.g. 6458200459)" value={tgChatId} onChange={e=>setTgChatId(e.target.value)} style={{width:'100%',boxSizing:'border-box',marginBottom:'0.5rem'}}/>
                <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                  <button className="btn-action" onClick={testTelegram} disabled={!tgChatId||tgStatus==='testing'}>{tgStatus==='testing'?'⏳ Sending...':'📤 Test Alert'}</button>
                  {tgStatus==='ok' && <span style={{color:'#22c55e',fontSize:'0.82rem'}}>✅ Sent! Check Telegram.</span>}
                  {tgStatus==='error' && <span style={{color:'#ef4444',fontSize:'0.82rem'}}>❌ Failed. Check backend TG_BOT_TOKEN on Render.</span>}
                </div>
                </>) : (
                  <div>
                    <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:'0 0 0.75rem',lineHeight:1.6}}>
                      Get instant Telegram alerts for high-impact news, scanner setups and PCR extremes — directly to your phone.
                    </p>
                    <button onClick={openUpgrade} style={{background:'linear-gradient(135deg,#f97316,#fbbf24)',color:'#000',border:'none',borderRadius:'8px',padding:'0.5rem 1.5rem',fontWeight:800,cursor:'pointer',fontSize:'0.85rem'}}>
                      Upgrade to Pro to Enable
                    </button>
                  </div>
                )}
              </div>

              <div style={{padding:'1rem',background:'var(--bg-dark)',borderRadius:'8px',border:'1px solid var(--border)'}}>
                <h3 style={{margin:'0 0 0.75rem',fontSize:'0.95rem'}}>🔔 Notify Me When {!isPro && <span style={{fontSize:'0.7rem',background:'rgba(249,115,22,0.2)',color:'#f97316',border:'1px solid rgba(249,115,22,0.4)',borderRadius:'4px',padding:'1px 6px',marginLeft:'6px',fontWeight:700}}>PRO</span>}</h3>
                <label style={{display:'flex',alignItems:'center',gap:'0.6rem',marginBottom:'0.6rem',cursor:isPro?'pointer':'not-allowed',opacity:isPro?1:0.5}}>
                  <input type="checkbox" checked={notifyHighImpact} onChange={e=>isPro&&setNotifyHighImpact(e.target.checked)} disabled={!isPro}/>
                  📰 High-impact news detected by AI
                </label>
                <label style={{display:'flex',alignItems:'center',gap:'0.6rem',cursor:isPro?'pointer':'not-allowed',opacity:isPro?1:0.5}}>
                  <input type="checkbox" checked={notifyScanner} onChange={e=>isPro&&setNotifyScanner(e.target.checked)} disabled={!isPro}/>
                  🔍 Scanner alerts (IV Crush, PCR Extreme, Gamma Squeeze)
                </label>
              </div>
            </div>
          </div>
        )}

        {savedStrategies.length > 0 && (
          <div className="saved-strategies-bar">
            <h3>📁 Saved Strategies ({savedStrategies.length})</h3>
            <div className="saved-list">
              {savedStrategies.map(strategy => (
                <div key={strategy.id} className="saved-item">
                  <div className="saved-info" onClick={() => loadStrategy(strategy)}>
                    <div className="saved-name">{strategy.name}</div>
                    <div className="saved-date">
                      {new Date(strategy.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                  <button 
                    className="delete-btn"
                    onClick={() => deleteStrategy(strategy.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
{activeTab === 'home' ? (
          <>
            {/* -- TELEGRAM ONBOARDING BANNER  -  shown if not connected -- */}
            {!tgChatId && currentUser && (
              <div style={{
                background:'linear-gradient(135deg,rgba(34,158,217,0.15),rgba(0,255,136,0.08))',
                border:'1px solid rgba(34,158,217,0.4)',
                borderRadius:'12px',
                padding:'1rem 1.25rem',
                margin:'1rem 1.5rem 0',
                display:'flex',
                alignItems:'center',
                justifyContent:'space-between',
                gap:'1rem',
                flexWrap:'wrap',
              }}>
                <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
                  <span style={{fontSize:'1.8rem'}}>🔔</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.95rem',color:'#f0f9ff'}}>Get instant market alerts on Telegram</div>
                    <div style={{fontSize:'0.82rem',color:'#94a3b8',marginTop:'2px'}}>Breaking news  |  Scanner signals  |  Risk alerts  -  delivered 24/7, even when you're away</div>
                  </div>
                </div>
                <button
                  onClick={()=>setShowTgSetup(true)}
                  style={{background:'#229ED9',color:'white',border:'none',borderRadius:'8px',padding:'0.6rem 1.25rem',fontWeight:700,fontSize:'0.88rem',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
                  ⚡ Connect in 60s
                </button>
              </div>
            )}
            {!currentUser && (
              <div style={{
                background:'linear-gradient(135deg,rgba(249,115,22,0.12),rgba(0,255,136,0.06))',
                border:'1px solid rgba(249,115,22,0.3)',
                borderRadius:'12px',
                padding:'1rem 1.25rem',
                margin:'1rem 1.5rem 0',
                display:'flex',
                alignItems:'center',
                justifyContent:'space-between',
                gap:'1rem',
                flexWrap:'wrap',
              }}>
                <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
                  <span style={{fontSize:'1.8rem'}}>👋</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.95rem',color:'#f0f9ff'}}>Welcome to DeltaBuddy</div>
                    <div style={{fontSize:'0.82rem',color:'#94a3b8',marginTop:'2px'}}>Sign in to save strategies, get Telegram alerts, and access all features</div>
                  </div>
                </div>
                <button
                  onClick={()=>setShowAuthModal(true)}
                  style={{background:'#f97316',color:'white',border:'none',borderRadius:'8px',padding:'0.6rem 1.25rem',fontWeight:700,fontSize:'0.88rem',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
                  Sign In Free →
                </button>
              </div>
            )}
            {/* -- WATCHLIST -- */}
            {(watchlist.length > 0 || true) && (
              <div style={{margin:'1rem 1.5rem 0'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.6rem'}}>
                  <span style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)'}}>⭐ Watchlist</span>
                  <button onClick={()=>setShowAddWatch(true)}
                    style={{background:'none',border:'1px solid var(--border)',color:'var(--accent)',borderRadius:'6px',padding:'0.2rem 0.6rem',fontSize:'0.78rem',cursor:'pointer',fontWeight:600}}>
                    + Add
                  </button>
                </div>
                {watchlist.length === 0 ? (
                  <div style={{color:'var(--text-muted)',fontSize:'0.82rem',padding:'0.5rem 0'}}>
                    No symbols yet  -  click + Add to track stocks & indices
                  </div>
                ) : (
                  <div style={{display:'flex',flexWrap:'wrap',gap:'0.5rem'}}>
                    {watchlist.map(sym => {
                      const p = watchlistPrices[sym];
                      const isUp = p?.pct >= 0;
                      return (
                        <div key={sym} style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'10px',padding:'0.5rem 0.75rem',display:'flex',alignItems:'center',gap:'0.75rem',minWidth:'130px'}}>
                          <div>
                            <div style={{fontSize:'0.8rem',fontWeight:700,color:'var(--text-main)'}}>{sym}</div>
                            {p ? (
                              <div style={{fontSize:'0.85rem',fontWeight:700,color:isUp?'#4ade80':'#f87171'}}>
                                {p.price.toLocaleString('en-IN')}
                                <span style={{fontSize:'0.72rem',marginLeft:'0.3rem'}}>{isUp?'▲':'▼'}{Math.abs(p.pct).toFixed(2)}%</span>
                              </div>
                            ) : (
                              <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>Loading...</div>
                            )}
                          </div>
                          <span onClick={()=>removeFromWatchlist(sym)}
                            style={{marginLeft:'auto',cursor:'pointer',color:'var(--text-muted)',fontSize:'0.9rem',lineHeight:1}}>✕</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Add to watchlist modal */}
            {showAddWatch && (
              <div className="modal-overlay" onClick={()=>setShowAddWatch(false)}>
                <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'360px',width:'95%'}}>
                  <h3 style={{marginTop:0}}>⭐ Add to Watchlist</h3>
                  <p style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>Enter NSE symbol e.g. NIFTY, BANKNIFTY, RELIANCE, HDFCBANK</p>
                  <input value={watchInput} onChange={e=>setWatchInput(e.target.value.toUpperCase())}
                    onKeyDown={e=>e.key==='Enter'&&addToWatchlist(watchInput)}
                    placeholder="e.g. NIFTY" autoFocus
                    style={{width:'100%',padding:'0.6rem',borderRadius:'8px',border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text-main)',fontSize:'1rem',boxSizing:'border-box',marginBottom:'0.75rem'}}/>
                  <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginBottom:'0.75rem'}}>
                    {['NIFTY','BANKNIFTY','FINNIFTY','RELIANCE','HDFCBANK','INFY','TCS','SBIN'].map(s=>(
                      <span key={s} onClick={()=>addToWatchlist(s)}
                        style={{fontSize:'0.75rem',padding:'0.2rem 0.6rem',borderRadius:'20px',border:'1px solid var(--border)',cursor:'pointer',color:'var(--accent)',background:'rgba(0,255,136,0.06)'}}>
                        {s}
                      </span>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:'0.5rem'}}>
                    <button onClick={()=>addToWatchlist(watchInput)}
                      style={{flex:1,background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem',fontWeight:700,cursor:'pointer'}}>
                      Add
                    </button>
                    <button onClick={()=>setShowAddWatch(false)}
                      style={{flex:1,background:'var(--bg-surface)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.6rem',cursor:'pointer'}}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* PERSONALISED GREETING */}
            {currentUser && (
              <div style={{padding:'1rem 1.5rem 0'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div>
                    <span style={{fontSize:'1.1rem',fontWeight:700,color:'var(--text-main)'}}>
                      Good {new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, {currentUser?.displayName?.split(' ')[0] || 'Trader'} 👋
                    </span>
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginTop:'2px'}}>
                      {new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
                    {subStatus==='trial' && (
                      <span onClick={()=>setShowPricing(true)} style={{fontSize:'0.75rem',padding:'0.25rem 0.75rem',borderRadius:'20px',background:'rgba(0,255,136,0.1)',border:'1px solid rgba(0,255,136,0.25)',color:'var(--accent)',cursor:'pointer',fontWeight:600}}>
                        {trialDaysLeft} days of Pro remaining
                      </span>
                    )}
                    {subStatus==='expired' && (
                      <span onClick={()=>setShowPricing(true)} style={{fontSize:'0.75rem',padding:'0.25rem 0.75rem',borderRadius:'20px',background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',color:'#f87171',cursor:'pointer',fontWeight:600}}>
                        Trial expired - Upgrade to Pro
                      </span>
                    )}
                    {subStatus==='pro' && (
                      <span style={{fontSize:'0.75rem',padding:'0.25rem 0.75rem',borderRadius:'20px',background:'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(251,191,36,0.1))',border:'1px solid rgba(249,115,22,0.3)',color:'#f97316',fontWeight:700}}>
                        PRO Member
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* GLOBAL INDICES TICKER */}
            <div className="global-ticker-bar">
              <div className="ticker-header">
                <span className="ticker-title">🌍 GLOBAL MARKETS</span>
                <span className="ticker-live-dot">● LIVE</span>
                <span className="ticker-update-time">
                  Updated: {lastUpdateTime.toLocaleTimeString()}
                </span>
                <button 
                  className={`ticker-toggle ${isLiveMode ? 'active' : ''}`}
                  onClick={() => setIsLiveMode(!isLiveMode)}
                  title={isLiveMode ? 'Pause live updates' : 'Resume live updates'}
                >
                  {isLiveMode ? '⏸ Pause' : '▶ Resume'}
                </button>
              </div>
              <div style={{overflow:'hidden',flex:1}}>
                <style>{`
                  @keyframes fastTicker {
                    0%   { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                  }
                  .ticker-fast { animation: fastTicker 25s linear infinite; display:flex; width:max-content; }
                  .ticker-fast:hover { animation-play-state: paused; }
                `}</style>
                <div className="ticker-fast">
                  {[...Object.entries(globalIndices), ...Object.entries(globalIndices)].map(([name, data], i) => (
                    <div key={i} style={{display:'flex',alignItems:'center',gap:'0.5rem',padding:'0.35rem 1.5rem',borderRight:'1px solid rgba(255,255,255,0.07)',whiteSpace:'nowrap'}}>
                      <span style={{fontSize:'0.95rem',fontWeight:600,color:'#94a3b8'}}>{name}</span>
                      <span style={{fontSize:'1rem',fontWeight:700,color:'#f0f9ff'}}>{data.value.toLocaleString()}</span>
                      <span style={{fontSize:'0.9rem',fontWeight:700,color:data.change>=0?'#4ade80':'#f87171'}}>
                        {data.change>=0?'▲':'▼'} {Math.abs(data.change).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* HOME CONTENT */}
            <div className="home-content" style={{maxWidth:'1280px',margin:'0 auto'}}>

            {/* -- AI INSIGHT + MARKET PULSE -- */}
            <div style={{background:'var(--bg-card)',border:'1px solid var(--border-light)',borderRadius:'var(--radius-lg)',padding:'1.5rem',marginBottom:'1.5rem',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,right:0,width:'300px',height:'100%',background:'radial-gradient(ellipse at top right,var(--accent-glow),transparent 70%)',pointerEvents:'none'}}/>
              <div className="ai-pulse-row" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'1.5rem'}}>

                {/* LEFT: AI Insight */}
                <div style={{flex:1,minWidth:'260px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.75rem'}}>
                    <span style={{background:'var(--green-dim)',color:'var(--green)',padding:'3px 10px',borderRadius:'99px',fontSize:'0.75rem',fontWeight:700,letterSpacing:'0.04em'}}>
                      🤖 AI INSIGHT OF THE DAY
                    </span>
                  </div>
                  {intelligentNews.length>0 ? (() => {
                    const top = intelligentNews.find(n=>n.analysis?.impact==='high')||intelligentNews[0];
                    const em  = top.analysis?.sentiment==='bullish'?'🟢':top.analysis?.sentiment==='bearish'?'🔴':'⚪';
                    return (
                      <div>
                        <h3 style={{margin:'0 0 0.5rem',lineHeight:1.4,color:'var(--text-main)'}}>{top.title}</h3>
                        {top.analysis?.keyInsight && <p style={{color:'var(--blue)',fontSize:'0.875rem',margin:'0 0 0.75rem',lineHeight:1.6}}>💡 {top.analysis.keyInsight}</p>}
                        <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',alignItems:'center'}}>
                          <span style={{background:top.analysis?.sentiment==='bullish'?'var(--green-dim)':top.analysis?.sentiment==='bearish'?'var(--red-dim)':'var(--bg-surface)',color:top.analysis?.sentiment==='bullish'?'var(--green)':top.analysis?.sentiment==='bearish'?'var(--red)':'var(--text-dim)',padding:'3px 10px',borderRadius:'99px',fontSize:'0.75rem',fontWeight:600}}>{em} {(top.analysis?.sentiment||'').toUpperCase()}</span>
                          {top.analysis?.impact==='high' && <span style={{background:'var(--red-dim)',color:'var(--red)',padding:'3px 10px',borderRadius:'99px',fontSize:'0.75rem',fontWeight:600}}>⚠️ HIGH IMPACT</span>}
                          <button onClick={()=>setActiveTab('intelligence')} style={{background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',color:'var(--accent)',borderRadius:'6px',padding:'3px 10px',fontSize:'0.75rem',cursor:'pointer',fontWeight:600}}>
                            Full analysis →
                          </button>
                        </div>
                      </div>
                    );
                  })() : (
                    <div>
                      <h3 style={{margin:'0 0 0.4rem',color:'var(--text-main)'}}>AI-Powered Market Intelligence</h3>
                      <p style={{fontSize:'0.875rem',margin:'0 0 0.75rem'}}>News analysis, OI signals, strategy ideas  -  all AI-powered.</p>
                      <button onClick={()=>setActiveTab('intelligence')} className="btn-primary">
                        Open Market Intelligence →
                      </button>
                    </div>
                  )}
                </div>

                {/* RIGHT: Market Pulse */}
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem',minWidth:'200px'}}>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:'0.25rem'}}>Market Pulse</div>
                  {[
                    {label:'NIFTY',     val:marketData.nifty.value,         chg:marketData.nifty.change},
                    {label:'BANKNIFTY', val:marketData.bankNifty.value,      chg:marketData.bankNifty.change},
                    {label:'VIX',       val:marketData.vix?.value,           chg:marketData.vix?.change ?? null, vix:true},
                    {label:'PCR',       val:(()=>{const ce=liveOptionChain.reduce((a,r)=>a+(r.ce?.oi||0),0);const pe=liveOptionChain.reduce((a,r)=>a+(r.pe?.oi||0),0);return ce>0?(pe/ce).toFixed(2):pcrData?.totalCE>0?pcrData?.pcr?.toFixed(2):null;})(), chg:null, pcr:true},
                  ].map((r,i)=>{
                    const pos = (r.chg||0) >= 0;
                    const vixVal = r.val || 0;
                    const vixCol = r.vix ? (vixVal>24?'var(--red)':vixVal>20?'#f97316':vixVal>14?'var(--yellow)':'var(--green)') : null;
                    const pcrVal = parseFloat(r.val);
                    const pcrCol = r.pcr && r.val ? (pcrVal>1.2?'var(--green)':pcrVal<0.8?'var(--red)':'var(--yellow)') : null;
                    const chgCol = pos ? 'var(--green)' : 'var(--red)';
                    const valCol = vixCol || pcrCol || chgCol;
                    const vixLevel = marketData.vix?.level || (vixVal>24?'HIGH':vixVal>20?'ELEV':vixVal>14?'MOD':'LOW');
                    const pcrSignal = pcrData?.totalCE>0 ? (pcrVal>1.3?'BULL':pcrVal>1.1?'M-BULL':pcrVal<0.7?'BEAR':pcrVal<0.9?'M-BEAR':'NEUT') : '...';
                    return (
                      <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--bg-surface)',borderRadius:'var(--radius-sm)',padding:'0.4rem 0.75rem',gap:'0.75rem'}}>
                        <span style={{fontSize:'0.875rem',color:'var(--text-dim)',fontWeight:600}}>{r.label}</span>
                        <div style={{textAlign:'right'}}>
                          <span style={{fontSize:'0.95rem',fontWeight:800,color:r.vix?vixCol:r.pcr?pcrCol||'var(--text-main)':r.chg!=null?chgCol:'var(--text-main)'}}>
                            {r.val != null ? (r.vix ? vixVal.toFixed(2) : r.val.toLocaleString?.() ?? r.val) : ' - '}
                          </span>
                          {r.chg!=null && <span style={{fontSize:'0.75rem',color:chgCol,marginLeft:'5px'}}>{pos?'▲':'▼'}{Math.abs(r.chg||0).toFixed(2)}%</span>}
                          {r.pcr && <span style={{fontSize:'0.75rem',color:pcrCol||'var(--text-muted)',marginLeft:'5px',fontWeight:700}}>{pcrSignal}</span>}
                          {r.vix && r.val && <span style={{fontSize:'0.75rem',color:vixCol,marginLeft:'5px',fontWeight:700}}>{vixLevel}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={()=>fetchLivePrices()} disabled={isPriceLoading} className="btn-secondary" style={{marginTop:'0.25rem',fontSize:'0.875rem',padding:'0.3rem'}}>
                    {isPriceLoading ? '⟳ Loading…' : '⟳ Refresh'}
                  </button>
                </div>

              </div>
            </div>


            
            {/* == SHOULD I TRADE TODAY? == */}
            {(() => {
              const vix    = parseFloat(marketData.vix?.value || 0);
              const niftyChg = parseFloat(marketData.nifty?.change || 0);
              const ceOI   = liveOptionChain.reduce((a,r)=>a+(r.ce?.oi||0),0);
              const peOI   = liveOptionChain.reduce((a,r)=>a+(r.pe?.oi||0),0);
              const pcr    = ceOI>0 ? peOI/ceOI : null;

              // Score each factor: +1 favours trading, -1 against, 0 neutral
              const factors = [];

              // VIX factor
              if (vix > 0) {
                if (vix < 14)      factors.push({ name:'India VIX', score: 1,  icon:'😌', msg:`VIX ${vix.toFixed(1)} — Low volatility, calm market` });
                else if (vix < 20) factors.push({ name:'India VIX', score: 1,  icon:'✅', msg:`VIX ${vix.toFixed(1)} — Healthy volatility for options` });
                else if (vix < 25) factors.push({ name:'India VIX', score: 0,  icon:'⚠️', msg:`VIX ${vix.toFixed(1)} — Elevated, use smaller size` });
                else               factors.push({ name:'India VIX', score:-1,  icon:'🚨', msg:`VIX ${vix.toFixed(1)} — Danger zone, premium inflated` });
              } else {
                factors.push({ name:'India VIX', score:0, icon:'⏳', msg:'VIX data loading...' });
              }

              // Nifty trend factor
              if (marketData.nifty?.value > 0) {
                const abs = Math.abs(niftyChg);
                if (abs < 0.3)      factors.push({ name:'Nifty Trend', score: 0, icon:'➡️', msg:`Nifty ${niftyChg>=0?'+':''}${niftyChg.toFixed(2)}% — Flat day, scalpers may struggle` });
                else if (abs < 1.0) factors.push({ name:'Nifty Trend', score: 1, icon:'✅', msg:`Nifty ${niftyChg>=0?'+':''}${niftyChg.toFixed(2)}% — Ideal directional range` });
                else                factors.push({ name:'Nifty Trend', score:-1, icon:'⚠️', msg:`Nifty ${niftyChg>=0?'+':''}${niftyChg.toFixed(2)}% — High move, gap-risk on options` });
              } else {
                factors.push({ name:'Nifty Trend', score:0, icon:'⏳', msg:'Market data loading...' });
              }

              // PCR factor
              if (pcr !== null) {
                if (pcr >= 0.8 && pcr <= 1.4) factors.push({ name:'PCR Zone',    score: 1,  icon:'✅', msg:`PCR ${pcr.toFixed(2)} — Balanced market, good for both sides` });
                else if (pcr > 1.6)            factors.push({ name:'PCR Zone',    score: 0,  icon:'⚠️', msg:`PCR ${pcr.toFixed(2)} — Overbought, avoid fresh CE buys` });
                else if (pcr < 0.6)            factors.push({ name:'PCR Zone',    score:-1,  icon:'🚨', msg:`PCR ${pcr.toFixed(2)} — Extreme fear, market unstable` });
                else                           factors.push({ name:'PCR Zone',    score: 0,  icon:'➡️', msg:`PCR ${pcr.toFixed(2)} — Slightly skewed, trade cautiously` });
              } else {
                factors.push({ name:'PCR Zone', score:0, icon:'⏳', msg:'Load option chain for PCR' });
              }

              // FII factor (use institutionalActivity if loaded)
              if (institutionalActivity?.fii?.net != null) {
                const fiiNet = institutionalActivity.fii.net;
                if (fiiNet >  500)  factors.push({ name:'FII Flow',  score: 1,  icon:'🟢', msg:`FII bought ₹${fiiNet.toFixed(0)}Cr — Institutional support` });
                else if (fiiNet > 0) factors.push({ name:'FII Flow', score: 1,  icon:'✅', msg:`FII net buyers ₹${fiiNet.toFixed(0)}Cr — Mildly bullish` });
                else if (fiiNet > -500) factors.push({ name:'FII Flow', score:0, icon:'⚠️', msg:`FII sold ₹${Math.abs(fiiNet).toFixed(0)}Cr — Mild caution` });
                else                factors.push({ name:'FII Flow',  score:-1,  icon:'🚨', msg:`FII sold ₹${Math.abs(fiiNet).toFixed(0)}Cr — Heavy selling` });
              } else {
                factors.push({ name:'FII Flow', score:0, icon:'⏳', msg:'Load FII/DII tab for data' });
              }

              // Global cues factor
              if (globalCues?.prediction) {
                const pred = globalCues.predictionColor;
                if (pred === 'bullish')       factors.push({ name:'Global Cues', score: 1,  icon:'🌍', msg:`Global: ${globalCues.prediction} — Positive overnight cues` });
                else if (pred === 'bearish')  factors.push({ name:'Global Cues', score:-1,  icon:'🌍', msg:`Global: ${globalCues.prediction} — Negative cues, trade light` });
                else                          factors.push({ name:'Global Cues', score: 0,  icon:'🌍', msg:`Global: ${globalCues.prediction} — Mixed signals` });
              } else {
                factors.push({ name:'Global Cues', score:0, icon:'⏳', msg:'Load Global Cues tab for data' });
              }

              // Calculate overall score
              const totalScore  = factors.reduce((a,f)=>a+f.score, 0);
              const maxScore    = factors.length;
              const pct         = (totalScore + maxScore) / (2 * maxScore); // 0 to 1

              let verdict, verdictColor, verdictBg, verdictIcon, verdictDesc;
              if (totalScore >= 3) {
                verdict='YES — GOOD DAY TO TRADE'; verdictIcon='🟢'; verdictColor='#4ade80'; verdictBg='rgba(74,222,128,0.08)';
                verdictDesc='Most factors are aligned. Market conditions favour retail traders today.';
              } else if (totalScore >= 1) {
                verdict='PROCEED WITH CAUTION'; verdictIcon='🟡'; verdictColor='#fbbf24'; verdictBg='rgba(251,191,36,0.08)';
                verdictDesc='Mixed signals. Trade smaller size, stick to defined strategies.';
              } else if (totalScore >= -1) {
                verdict='NEUTRAL — STAY SELECTIVE'; verdictIcon='🟠'; verdictColor='#fb923c'; verdictBg='rgba(249,115,22,0.08)';
                verdictDesc='Conditions are uncertain. Only high-conviction setups worth taking.';
              } else {
                verdict='NO — AVOID TRADING TODAY'; verdictIcon='🔴'; verdictColor='#f87171'; verdictBg='rgba(248,113,113,0.08)';
                verdictDesc='Multiple risk factors active. Protect your capital — sit on hands.';
              }

              return (
                <div style={{background:'var(--bg-card)',border:`2px solid ${verdictColor}44`,borderRadius:'16px',padding:'1.25rem',marginBottom:'1.5rem'}}>
                  {/* Header */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.5rem'}}>
                    <div style={{fontWeight:800,fontSize:'1rem',color:'var(--text-main)'}}>🎯 Should I Trade Today?</div>
                    <div style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>Live · Updates with market data</div>
                  </div>

                  {/* Verdict */}
                  <div style={{background:verdictBg,border:`1px solid ${verdictColor}44`,borderRadius:'12px',padding:'1rem 1.25rem',marginBottom:'1rem',display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
                    <div style={{fontSize:'2rem'}}>{verdictIcon}</div>
                    <div>
                      <div style={{fontWeight:900,fontSize:'1.05rem',color:verdictColor,marginBottom:'0.2rem'}}>{verdict}</div>
                      <div style={{fontSize:'0.8rem',color:'var(--text-dim)',lineHeight:1.5}}>{verdictDesc}</div>
                    </div>
                    <div style={{marginLeft:'auto',textAlign:'center',minWidth:'50px'}}>
                      <div style={{fontSize:'1.8rem',fontWeight:900,color:verdictColor}}>{totalScore > 0 ? '+' : ''}{totalScore}</div>
                      <div style={{fontSize:'0.65rem',color:'var(--text-muted)'}}>/{maxScore}</div>
                    </div>
                  </div>

                  {/* Factor breakdown */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'0.5rem'}}>
                    {factors.map((f,i) => (
                      <div key={i} style={{background:'var(--bg-dark)',borderRadius:'9px',padding:'0.6rem 0.8rem',border:`1px solid ${f.score===1?'rgba(74,222,128,0.2)':f.score===-1?'rgba(248,113,113,0.2)':'rgba(255,255,255,0.06)'}`,display:'flex',gap:'0.6rem',alignItems:'flex-start'}}>
                        <span style={{fontSize:'1rem',flexShrink:0,marginTop:'1px'}}>{f.icon}</span>
                        <div>
                          <div style={{fontSize:'0.68rem',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'0.15rem'}}>{f.name}</div>
                          <div style={{fontSize:'0.75rem',color:f.score===1?'#4ade80':f.score===-1?'#f87171':'var(--text-dim)',lineHeight:1.4}}>{f.msg}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

                        {/* == TRACK YOUR INDICES & STOCKS == */}
            <div className="panel" style={{marginBottom:'1.5rem'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem',flexWrap:'wrap',gap:'0.75rem'}}>
                <h3 style={{margin:0}}>📊 Track Your Indices &amp; Stocks</h3>
                <button onClick={fetchLivePrices} disabled={isPriceLoading} style={{background:'transparent',border:'1px solid var(--border-light)',color:'var(--accent)',borderRadius:'6px',padding:'0.3rem 0.85rem',fontSize:'0.875rem',cursor:'pointer',fontFamily:'inherit'}}>
                  {isPriceLoading ? '⟳ Loading…' : '🔄 Refresh'}
                </button>
              </div>

              {/* Tab switcher */}
              <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:'1.25rem'}}>
                {[['nse','📊 NSE'],['bse','🏦 BSE'],['stocks','🏢 Stocks']].map(([key,label])=>(
                  <button key={key} onClick={()=>setWatchTab(key)} style={{background:'none',border:'none',borderBottom:watchTab===key?'2px solid var(--accent)':'2px solid transparent',color:watchTab===key?'var(--accent)':'var(--text-dim)',padding:'0.5rem 1.25rem',fontWeight:watchTab===key?700:500,fontSize:'0.95rem',cursor:'pointer',fontFamily:'inherit',marginBottom:'-1px'}}>
                    {label}
                  </button>
                ))}
              </div>

              {/* NSE TAB */}
              {watchTab==='nse' && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'1rem',flexWrap:'wrap'}}>
                    <select value="" onChange={e=>{if(e.target.value&&!watchNSE.includes(e.target.value))setWatchNSE(p=>[...p,e.target.value]);}} style={{background:'var(--bg-surface)',border:'1px solid var(--border-light)',color:'var(--text-main)',borderRadius:'8px',padding:'0.45rem 0.85rem',fontSize:'0.875rem',cursor:'pointer',minWidth:'210px',fontFamily:'inherit'}}>
                      <option value="">+ Add NSE Index</option>
                      {['Nifty 50','Bank Nifty','Nifty IT','Nifty Pharma','Nifty Auto','Nifty Financial Services','Nifty FMCG','Nifty Metal','Nifty Realty','Nifty Energy','Nifty Midcap 50','Nifty Smallcap 50','Nifty Next 50','Nifty 100','Nifty 200'].filter(n=>!watchNSE.includes(n)).map(n=>(
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span style={{fontSize:'0.875rem',color:'var(--text-muted)'}}>Click × on a card to remove</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(175px,1fr))',gap:'0.75rem'}}>
                    {watchNSE.length===0 && <div style={{color:'var(--text-muted)',fontSize:'0.875rem',gridColumn:'1/-1'}}>Add indices from dropdown above.</div>}
                    {watchNSE.map(name=>{
                      const val=livePrices[name];
                      const chg=liveChanges[name]; // may be 0, which is valid
                      const prev=livePrevClose[name];
                      const pos=(chg||0)>=0;
                      const pts=val&&chg!=null?Math.abs(((chg/100)*val)/(1+chg/100)).toFixed(0):(val&&prev?Math.abs(val-prev).toFixed(0):null);
                      const border=val!=null?(pos?'rgba(74,222,128,0.25)':'rgba(248,113,113,0.25)'):'var(--border)';
                      return (
                        <div key={name} style={{background:'var(--bg-surface)',border:'1px solid '+border,borderRadius:'12px',padding:'0.9rem 1rem',position:'relative'}}>
                          <button onClick={()=>setWatchNSE(p=>p.filter(x=>x!==name))} style={{position:'absolute',top:'0.35rem',right:'0.5rem',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'0.9rem',lineHeight:1,padding:0,fontFamily:'inherit'}}>×</button>
                          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:700,marginBottom:'0.3rem',paddingRight:'1rem',textTransform:'uppercase',letterSpacing:'0.04em'}}>{name}</div>
                          <div style={{fontSize:'1.25rem',fontWeight:800,color:'var(--text-main)',letterSpacing:'-0.01em'}}>{val!=null ? val.toLocaleString() : <span style={{fontSize:'0.875rem',color:'var(--text-muted)'}}>Loading…</span>}</div>
                          {val!=null && (
                            <div style={{marginTop:'0.3rem'}}>
                              {chg!=null ? (
                                <div style={{display:'flex',gap:'0.4rem',alignItems:'baseline'}}>
                                  <span style={{fontSize:'0.875rem',fontWeight:700,color:pos?'var(--green)':'var(--red)'}}>{pos?'▲':'▼'} {Math.abs(chg).toFixed(2)}%</span>
                                  {pts && <span style={{fontSize:'0.875rem',color:pos?'var(--green)':'var(--red)',fontWeight:600}}>{pos?'+':'−'}{pts} pts</span>}
                                </div>
                              ) : <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}> - </div>}
                              {prev && <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'0.1rem'}}>Prev: {prev.toLocaleString()}</div>}
                            </div>
                          )}
                          {val==null && <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'0.3rem'}}>Click Refresh ↑</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* BSE TAB - Coming Soon */}
              {watchTab==='bse' && (
                <div style={{textAlign:'center',padding:'4rem 2rem',color:'var(--text-dim)'}}>
                  <div style={{fontSize:'3rem',marginBottom:'1rem'}}>🏦</div>
                  <div style={{fontWeight:800,fontSize:'1.15rem',color:'var(--text-main)',marginBottom:'0.5rem'}}>
                    BSE Data Coming Soon
                  </div>
                  <div style={{fontSize:'0.88rem',maxWidth:'360px',margin:'0 auto',lineHeight:1.7}}>
                    Sensex, BANKEX and BSE sector indices are on the roadmap.
                    We are building a reliable BSE data feed for zero-hero traders who love the volatility.
                  </div>
                  <div style={{marginTop:'1.5rem',display:'flex',gap:'0.5rem',justifyContent:'center',flexWrap:'wrap'}}>
                    {['Sensex','BANKEX','BSE Midcap','BSE Smallcap','BSE 500'].map(idx=>(
                      <span key={idx} style={{padding:'4px 12px',borderRadius:'20px',fontSize:'0.78rem',fontWeight:600,
                        background:'rgba(255,255,255,0.05)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
                        {idx}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* STOCKS TAB */}
              {watchTab==='stocks' && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'1rem',flexWrap:'wrap'}}>
                    <select value="" onChange={e=>{if(e.target.value&&!watchStocks.includes(e.target.value))setWatchStocks(p=>[...p,e.target.value]);}} style={{background:'var(--bg-surface)',border:'1px solid var(--border-light)',color:'var(--text-main)',borderRadius:'8px',padding:'0.45rem 0.85rem',fontSize:'0.875rem',cursor:'pointer',minWidth:'210px',fontFamily:'inherit'}}>
                      <option value="">+ Add FNO Stock</option>
                      {['Reliance','TCS','HDFC Bank','Infosys','ICICI Bank','Bharti Airtel','ITC','SBI','LT','Kotak Bank','HCL Tech','Axis Bank','Maruti Suzuki','Titan','Bajaj Finance','Wipro','Sun Pharma','Tata Motors','Asian Paints','Adani Ports','ONGC','NTPC','Power Grid','M&M','Tech Mahindra','Bajaj Auto','Hero MotoCorp','Eicher Motors','Dr Reddy','Cipla','Tata Steel','JSW Steel','Coal India','Hindalco','Britannia'].filter(n=>!watchStocks.includes(n)).map(n=>(
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span style={{fontSize:'0.875rem',color:'var(--text-muted)'}}>Click × on a card to remove</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:'0.85rem'}}>
                    {watchStocks.length===0 && <div style={{color:'var(--text-muted)',fontSize:'0.875rem',gridColumn:'1/-1'}}>Add stocks from dropdown above.</div>}
                    {watchStocks.map(name=>{
                      const val=livePrices[name];
                      const chg=liveChanges[name];
                      const prev=livePrevClose[name];
                      const pos=(chg||0)>=0;
                      const pts=val&&chg!=null?Math.abs(((chg/100)*val)/(1+chg/100)).toFixed(0):(val&&prev?Math.abs(val-prev).toFixed(0):null);
                      // Find AI insight for this stock from news
                      const newsHit=intelligentNews.find(n=>n.analysis?.affectedStocks?.some(s=>s.toLowerCase().includes(name.toLowerCase()))||n.title.toLowerCase().includes(name.toLowerCase().split(' ')[0]));
                      const sentiment=newsHit?.analysis?.sentiment;
                      const sentColor=sentiment==='bullish'?'var(--green)':sentiment==='bearish'?'var(--red)':'var(--text-muted)';
                      const sentEmoji=sentiment==='bullish'?'🟢':sentiment==='bearish'?'🔴':'⚪';
                      return (
                        <div key={name} style={{background:'var(--bg-surface)',border:'1px solid '+(val!=null?(pos?'rgba(74,222,128,0.22)':'rgba(248,113,113,0.22)'):'var(--border)'),borderRadius:'12px',padding:'1rem',position:'relative'}}>
                          <button onClick={()=>setWatchStocks(p=>p.filter(x=>x!==name))} style={{position:'absolute',top:'0.4rem',right:'0.6rem',background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'0.9rem',lineHeight:1,padding:0,fontFamily:'inherit'}}>×</button>
                          {/* Stock name + price */}
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.5rem',paddingRight:'1rem'}}>
                            <div style={{fontSize:'0.875rem',color:'var(--text-dim)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em'}}>{name}</div>
                            {val!=null&&chg!=null && <div style={{fontSize:'0.75rem',background:pos?'rgba(74,222,128,0.12)':'rgba(248,113,113,0.12)',color:pos?'var(--green)':'var(--red)',padding:'1px 6px',borderRadius:'4px',fontWeight:700}}>{pos?'▲':'▼'}{Math.abs(chg).toFixed(2)}%</div>}
                          </div>
                          <div style={{fontSize:'1.4rem',fontWeight:800,color:'var(--text-main)',letterSpacing:'-0.01em',marginBottom:'0.2rem'}}>
                            {val!=null ? '₹'+val.toLocaleString() : <span style={{fontSize:'0.875rem',color:'var(--text-muted)'}}>Loading…</span>}
                          </div>
                          <div style={{marginBottom:'0.6rem'}}>
                            {val!=null&&chg!=null ? (
                              <span style={{fontSize:'0.875rem',color:pos?'var(--green)':'var(--red)',fontWeight:600}}>{pos?'+':'−'}₹{pts} pts vs prev close {prev?'('+prev.toLocaleString()+')':''}</span>
                            ) : val!=null ? (
                              <span style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>Click Refresh for change data</span>
                            ) : null}
                          </div>
                          {/* AI Report Card */}
                          <div style={{borderTop:'1px solid var(--border)',paddingTop:'0.5rem',marginTop:'0.25rem'}}>
                            <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:700,letterSpacing:'0.05em',marginBottom:'0.3rem'}}>🤖 AI SIGNAL</div>
                            {newsHit ? (
                              <div>
                                <div style={{display:'flex',alignItems:'center',gap:'0.35rem',marginBottom:'0.25rem'}}>
                                  <span style={{fontSize:'0.875rem',fontWeight:700,color:sentColor}}>{sentEmoji} {(sentiment||'neutral').toUpperCase()}</span>
                                  {newsHit.analysis?.impact==='high' && <span style={{fontSize:'0.75rem',background:'rgba(239,68,68,0.12)',color:'var(--red)',padding:'1px 5px',borderRadius:'4px',fontWeight:600}}>HIGH IMPACT</span>}
                                </div>
                                <div style={{fontSize:'0.75rem',color:'var(--text-dim)',lineHeight:1.4}}>
                                  {newsHit.analysis?.keyInsight ? newsHit.analysis.keyInsight.slice(0,80)+'…' : newsHit.title.slice(0,70)+'…'}
                                </div>
                                {newsHit.analysis?.tradingIdea?.strategy && (
                                  <div style={{fontSize:'0.75rem',color:'var(--accent)',marginTop:'0.3rem',fontWeight:600}}>Strategy: {newsHit.analysis.tradingIdea.strategy}</div>
                                )}
                              </div>
                            ) : (
                              <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>No news signal today</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* == TOP GAINERS & TOP LOSERS == */}
            {(()=>{
              const STOCKS=['Reliance','TCS','HDFC Bank','Infosys','ICICI Bank','Bharti Airtel','ITC','SBI','LT','Kotak Bank','HCL Tech','Axis Bank','Maruti Suzuki','Titan','Bajaj Finance','Wipro','Sun Pharma','Tata Motors','Adani Ports','NTPC'];
              const withData=STOCKS.filter(s=>livePrices[s]!=null).map(s=>({name:s,value:livePrices[s],change:liveChanges[s]??null})).filter(s=>s.change!==null);
              const gainers=[...withData].sort((a,b)=>b.change-a.change).slice(0,5);
              const losers=[...withData].sort((a,b)=>a.change-b.change).slice(0,5);
              const renderRow=(s,isGainer)=>{
                const pts=Math.abs(((s.change/100)*s.value)/(1+s.change/100)).toFixed(0);
                const col=isGainer?'var(--green)':'var(--red)';
                return (
                  <div key={s.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.55rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                    <div>
                      <div style={{fontSize:'0.875rem',fontWeight:600,color:'var(--text-main)'}}>{s.name}</div>
                      <div style={{fontSize:'0.75rem',color:'var(--text-main)',fontWeight:600}}>{'₹'+s.value.toLocaleString()}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'0.9rem',fontWeight:700,color:col}}>{isGainer?'▲':'▼'} {Math.abs(s.change).toFixed(2)}%</div>
                      <div style={{fontSize:'0.75rem',color:col,opacity:0.8}}>{isGainer?'+':'−'}{'₹'+pts+' pts'}</div>
                    </div>
                  </div>
                );
              };
              return (
                <div className="gainers-losers-grid" style={{display:'grid',gap:'1rem',marginBottom:'1.5rem'}}>
                  <div style={{background:'var(--bg-card)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:'16px',padding:'1.25rem'}}>
                    <div style={{fontSize:'0.875rem',fontWeight:700,color:'var(--green)',letterSpacing:'0.06em',marginBottom:'0.85rem',textTransform:'uppercase'}}>🚀 Top Gainers</div>
                    {withData.length===0 ? (
                      <div style={{color:'var(--text-muted)',fontSize:'0.875rem',padding:'0.5rem 0'}}>Click Refresh above to load data</div>
                    ) : gainers.map(s=>renderRow(s,true))}
                  </div>
                  <div style={{background:'var(--bg-card)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:'16px',padding:'1.25rem'}}>
                    <div style={{fontSize:'0.875rem',fontWeight:700,color:'var(--red)',letterSpacing:'0.06em',marginBottom:'0.85rem',textTransform:'uppercase'}}>📉 Top Losers</div>
                    {withData.length===0 ? (
                      <div style={{color:'var(--text-muted)',fontSize:'0.875rem',padding:'0.5rem 0'}}>Click Refresh above to load data</div>
                    ) : losers.map(s=>renderRow(s,false))}
                  </div>
                </div>
              );
            })()}

                        {/* Market data → go to Markets tab */}

            {/* == 6 INSIGHT CARDS == */}
            <div className="insight-cards-grid" style={{display:'grid',gap:'1rem',marginBottom:'2rem'}}>

              {/* CARD 1  -  EXPIRY COUNTDOWN */}
              {(()=>{
                const now = new Date();
                const msInDay = 86400000;
                const getNext = (dow) => {
                  const d = new Date(now);
                  const diff = (dow - d.getDay() + 7) % 7 || 7;
                  d.setDate(d.getDate() + diff);
                  d.setHours(15,30,0,0);
                  return d;
                };
                // Last occurrence of weekday `dow` in a given month
                const lastWeekdayOfMonth = (year, month, dow) => {
                  const d = new Date(year, month + 1, 0); // last day of month
                  d.setDate(d.getDate() - (d.getDay() - dow + 7) % 7);
                  d.setHours(15,30,0,0);
                  return d;
                };
                const monthlyOf = (dow) => {
                  const t = lastWeekdayOfMonth(now.getFullYear(), now.getMonth(), dow);
                  return t > now ? t : lastWeekdayOfMonth(now.getFullYear(), now.getMonth() + 1, dow);
                };
                const rows = [
                  {sym:'NIFTY',      label:'NIFTY Weekly',          d:getNext(2),      col:'#4ade80'},  // Tuesday
                  {sym:'SENSEX',     label:'SENSEX Weekly (BSE)',    d:getNext(4),      col:'#60a5fa'},  // Thursday
                  {sym:'BANKNIFTY',  label:'BANKNIFTY Monthly',      d:monthlyOf(3),    col:'#f59e0b'},  // last Wednesday
                  {sym:'FINNIFTY',   label:'FINNIFTY Monthly',       d:monthlyOf(2),    col:'#c084fc'},  // last Tuesday
                  {sym:'MIDCPNIFTY', label:'MIDCAP NIFTY Monthly',   d:monthlyOf(1),    col:'#fb7185'},  // last Monday
                ];
                return (
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'1rem'}}>
                      <span>⏳</span>
                      <span style={{fontWeight:700,fontSize:'0.95rem'}}>Expiry Countdown</span>
                    </div>
                    {rows.map((r,i)=>{
                      const ms   = r.d - now;
                      const days = Math.floor(ms / msInDay);
                      const hrs  = Math.floor((ms % msInDay) / 3600000);
                      const mins = Math.floor((ms % 3600000) / 60000);
                      const urgent = days < 1;
                      return (
                        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.5rem 0.75rem',background:'var(--bg-surface)',borderRadius:'var(--radius-sm)',border:`1px solid ${urgent?'rgba(248,113,113,0.35)':'var(--border)'}`,marginBottom:'0.4rem'}}>
                          <div>
                            <div style={{fontSize:'0.875rem',fontWeight:700,color:r.col}}>{r.sym}</div>
                            <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{r.label}</div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:'1.1rem',fontWeight:800,color:urgent?'#f87171':r.col}}>
                              {days > 0 ? `${days}d ${hrs}h` : `${hrs}h ${mins}m`}
                            </div>
                            {urgent && <div style={{fontSize:'0.7rem',color:'#f87171',fontWeight:700}}>EXPIRY TODAY</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* CARD 2  -  F&amp;O BAN LIST */}
              <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                    <span>🚫</span>
                    <span style={{fontWeight:700,fontSize:'0.95rem'}}>F&amp;O Ban List</span>
                  </div>
                  <button onClick={fetchBanList} style={{background:'none',border:'1px solid var(--border)',color:'var(--accent)',borderRadius:'5px',padding:'2px 8px',fontSize:'0.75rem',cursor:'pointer'}}>
                    {banLoading ? '…' : '↻ Refresh'}
                  </button>
                </div>
                {banLoading ? (
                  <div style={{color:'var(--text-muted)',fontSize:'0.875rem'}}>Fetching from NSE…</div>
                ) : banList.length > 0 ? (
                  <div>
                    <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.5rem'}}>Stocks in ban  -  no fresh F&amp;O positions allowed</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:'0.4rem'}}>
                      {banList.map((s,i) => (
                        <span key={i} style={{background:'var(--red-dim)',border:'1px solid rgba(248,113,113,0.3)',color:'var(--red)',borderRadius:'6px',padding:'3px 8px',fontSize:'0.875rem',fontWeight:700}}>{s}</span>
                      ))}
                    </div>
                  </div>
                ) : banFetched ? (
                  <div style={{textAlign:'center',padding:'0.75rem'}}>
                    <div style={{fontSize:'1.4rem'}}>✅</div>
                    <div style={{fontSize:'0.875rem',color:'var(--green)',fontWeight:600}}>No stocks in ban today</div>
                    <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>All F&amp;O stocks tradeable</div>
                  </div>
                ) : (
                  <div style={{color:'var(--text-muted)',fontSize:'0.875rem'}}>Click Refresh to load…</div>
                )}
              </div>

              {/* CARD 3  -  MARKET MOOD-O-METER */}
              {(()=>{
                const vix     = marketData.vix?.value || marketData.nifty?.vix || 14.5;
                const pcr     = pcrData?.pcr || 1.0;
                const niftyChg = parseFloat(marketData.nifty?.change  || 0);
                const bnkChg   = parseFloat(marketData.bankNifty?.change || 0);
                let score = 50;
                // VIX: India VIX <12 euphoria, 12-15 calm, 15-20 alert, >20 fear, >25 panic
                if      (vix > 25) score -= 25;
                else if (vix > 20) score -= 15;
                else if (vix > 17) score -= 7;
                else if (vix < 12) score += 18;
                else if (vix < 15) score += 10;
                // PCR signal
                if      (pcr > 1.5) score += 20;
                else if (pcr > 1.3) score += 12;
                else if (pcr > 1.1) score += 5;
                else if (pcr < 0.6) score -= 20;
                else if (pcr < 0.8) score -= 12;
                else if (pcr < 0.9) score -= 5;
                // Nifty day move
                if      (niftyChg >  1.5) score += 12;
                else if (niftyChg >  0.5) score += 6;
                else if (niftyChg < -1.5) score -= 12;
                else if (niftyChg < -0.5) score -= 6;
                // BankNifty confirmation
                if (bnkChg >  1 && niftyChg > 0) score += 5;
                if (bnkChg < -1 && niftyChg < 0) score -= 5;
                score = Math.max(0, Math.min(100, Math.round(score)));
                const label = score < 20 ? 'Extreme Fear' : score < 40 ? 'Fear' : score < 60 ? 'Neutral' : score < 80 ? 'Greed' : 'Extreme Greed';
                const col   = score < 20 ? '#ef4444' : score < 40 ? '#f87171' : score < 60 ? '#fbbf24' : score < 80 ? '#4ade80' : '#22c55e';
                const zones = [
                  {label:'Extreme Fear', col:'#ef4444'},
                  {label:'Fear',         col:'#f87171'},
                  {label:'Neutral',      col:'#fbbf24'},
                  {label:'Greed',        col:'#4ade80'},
                  {label:'Extreme Greed',col:'#22c55e'},
                ];
                const activeZone = Math.min(4, Math.floor(score / 20));
                const signals = [
                  {k:'VIX',   v: vix ? vix.toFixed(1) : '—',                        c: vix>20?'#f87171':vix<14?'#4ade80':'#fbbf24'},
                  {k:'PCR',   v: pcr.toFixed(2),                                      c: pcr>1.2?'#4ade80':pcr<0.8?'#f87171':'#fbbf24'},
                  {k:'NIFTY', v: `${niftyChg>=0?'+':''}${niftyChg.toFixed(2)}%`,     c: niftyChg>=0?'#4ade80':'#f87171'},
                  {k:'Score', v: `${score}/100`,                                       c: col},
                ];
                return (
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'1rem'}}>
                      <span>🎯</span>
                      <span style={{fontWeight:700,fontSize:'0.95rem'}}>Market Mood-O-Meter</span>
                    </div>
                    <div style={{textAlign:'center',marginBottom:'1rem'}}>
                      <div style={{fontSize:'2rem',fontWeight:900,color:col}}>{label}</div>
                      <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'0.2rem'}}>Live · VIX + PCR + Nifty move + BankNifty</div>
                    </div>
                    <div style={{position:'relative',marginBottom:'0.5rem'}}>
                      <div style={{display:'flex',borderRadius:'var(--radius-sm)',overflow:'hidden',height:'12px'}}>
                        {zones.map((z,i) => (
                          <div key={i} style={{flex:1,background:z.col,opacity:i===activeZone?1:0.22}}/>
                        ))}
                      </div>
                      <div style={{position:'absolute',top:'-3px',left:`calc(${score}% - 4px)`,width:'8px',height:'18px',background:'#fff',borderRadius:'2px',boxShadow:'0 0 4px rgba(0,0,0,0.6)',transition:'left 0.5s'}}/>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.75rem'}}>
                      {zones.map((z,i) => (
                        <div key={i} style={{fontSize:'0.58rem',color:i===activeZone?z.col:'var(--text-muted)',fontWeight:i===activeZone?700:400,textAlign:'center',flex:1,lineHeight:1.2}}>{z.label}</div>
                      ))}
                    </div>
                    <div style={{display:'flex',gap:'0.4rem',justifyContent:'center',flexWrap:'wrap'}}>
                      {signals.map(({k,v,c},i)=>(
                        <div key={i} style={{background:'var(--bg-surface)',borderRadius:'6px',padding:'0.3rem 0.6rem',textAlign:'center',minWidth:'55px'}}>
                          <div style={{fontSize:'0.68rem',color:'var(--text-muted)'}}>{k}</div>
                          <div style={{fontSize:'0.85rem',fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* CARD 4  -  OPEN POSITIONS */}
              {(()=>{
                const openTrades = tradeLog.filter(t => !t.exitPrice || t.exitPrice === '');
                let totalPnl = 0;
                openTrades.forEach(t => {
                  const ltp = livePrices[t.symbol] || 0;
                  const entry = parseFloat(t.entryPrice) || 0;
                  if (ltp && entry) {
                    totalPnl += (ltp - entry) * (t.action === 'BUY' ? 1 : -1) * (parseInt(t.qty) || 1) * 50;
                  }
                });
                const pnlPos = totalPnl >= 0;
                return (
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                        <span>💼</span>
                        <span style={{fontWeight:700,fontSize:'0.95rem'}}>Open Positions</span>
                      </div>
                      <button onClick={()=>{setActiveTab('trades');setTradesSubTab('journal');}} style={{background:'none',border:'1px solid var(--border)',color:'var(--accent)',borderRadius:'5px',padding:'2px 10px',fontSize:'0.75rem',cursor:'pointer'}}>Journal →</button>
                    </div>
                    {openTrades.length === 0 ? (
                      <div style={{textAlign:'center',padding:'0.75rem',color:'var(--text-muted)'}}>
                        <div style={{fontSize:'1.4rem',marginBottom:'0.3rem'}}>📭</div>
                        <div style={{fontSize:'0.875rem'}}>No open positions</div>
                        <div style={{fontSize:'0.75rem',marginTop:'0.2rem'}}>Add trades in Journal tab</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{background:pnlPos?'rgba(74,222,128,0.08)':'rgba(248,113,113,0.08)',border:'1px solid '+(pnlPos?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.2)'),borderRadius:'10px',padding:'0.75rem',marginBottom:'0.75rem',textAlign:'center'}}>
                          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.2rem'}}>UNREALISED P&amp;L</div>
                          <div style={{fontSize:'1.4rem',fontWeight:800,color:pnlPos?'var(--green)':'var(--red)'}}>{pnlPos?'+':'-'}&#8377;{Math.abs(Math.round(totalPnl)).toLocaleString()}</div>
                          <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{openTrades.length} open {openTrades.length === 1 ? 'position' : 'positions'}</div>
                        </div>
                        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',maxHeight:'150px',overflowY:'auto'}}>
                          {openTrades.slice(0,5).map((t,i) => {
                            const ltp   = livePrices[t.symbol] || 0;
                            const entry = parseFloat(t.entryPrice) || 0;
                            const lots  = parseInt(t.qty) || 1;
                            const pnl   = ltp && entry ? (ltp - entry) * (t.action === 'BUY' ? 1 : -1) * lots * 50 : null;
                            return (
                              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.35rem 0.5rem',background:'var(--bg-surface)',borderRadius:'6px'}}>
                                <div>
                                  <span style={{fontSize:'0.875rem',fontWeight:700}}>{t.symbol} {t.type}</span>
                                  <span style={{fontSize:'0.75rem',color:t.action==='BUY'?'var(--green)':'var(--red)',marginLeft:'6px'}}>{t.action}</span>
                                </div>
                                <span style={{fontSize:'0.875rem',fontWeight:700,color:pnl==null?'var(--text-muted)':pnl>=0?'var(--green)':'var(--red)'}}>
                                  {pnl == null ? 'No LTP' : ((pnl >= 0 ? '+' : '-') + '&#8377;' + Math.abs(Math.round(pnl)).toLocaleString())}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* CARD 5  -  ECONOMIC CALENDAR */}
              {(()=>{
                const now  = new Date();
                const yr   = now.getFullYear();
                const mo   = now.getMonth();
                const evts = [
                  {date:new Date(yr,mo,6),  label:'RBI MPC Decision',    impact:'HIGH',   icon:'🏦'},
                  {date:new Date(yr,mo,10), label:'US CPI Release',       impact:'HIGH',   icon:'🇺🇸'},
                  {date:new Date(yr,mo,15), label:'India WPI Data',       impact:'MED',    icon:'📊'},
                  {date:new Date(yr,mo,20), label:'US Fed Meeting',       impact:'HIGH',   icon:'💵'},
                  {date:new Date(yr,mo,25), label:'F&amp;O Monthly Expiry',impact:'HIGH',  icon:'⏰'},
                  {date:new Date(yr,mo+1,1),label:'GDP Data Release',     impact:'HIGH',   icon:'📈'},
                  {date:new Date(yr,mo+1,5),label:'RBI Policy Review',    impact:'MED',    icon:'🏦'},
                ].map(e => ({...e, days: Math.ceil((e.date - now) / 86400000)}))
                 .filter(e => e.days >= -1)
                 .sort((a,b) => a.days - b.days)
                 .slice(0, 6);
                return (
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'1rem'}}>
                      <span>📅</span>
                      <span style={{fontWeight:700,fontSize:'0.95rem'}}>Economic Calendar</span>
                    </div>
                    {evts.map((e,i) => (
                      <div key={i} style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.45rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                        <span style={{fontSize:'1.1rem',flexShrink:0}}>{e.icon}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:'0.875rem',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.label}</div>
                          <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{e.date.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</div>
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:'0.75rem',fontWeight:700,color:e.impact==='HIGH'?'#f87171':'#fbbf24'}}>{e.impact}</div>
                          <div style={{fontSize:'0.75rem',color:e.days<=0?'#f87171':e.days<=3?'#fbbf24':'var(--text-muted)',fontWeight:e.days<=1?700:400}}>
                            {e.days <= 0 ? 'TODAY' : e.days === 1 ? 'Tomorrow' : (e.days + 'd away')}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* CARD 6  -  UNUSUAL OI ACTIVITY */}
              {(()=>{
                const spot = marketData.nifty?.value || 23500;
                const unusual = liveOptionChain
                  .filter(r => r.strike && (r.ce?.oi > 0 || r.pe?.oi > 0))
                  .map(r => {
                    const pr    = prevOI[r.strike];
                    const ceOI  = r.ce?.oi || 0;
                    const peOI  = r.pe?.oi || 0;
                    const cePrv = pr?.ce || ceOI;
                    const pePrv = pr?.pe || peOI;
                    const ceChg = cePrv > 0 ? Math.round(((ceOI - cePrv) / cePrv) * 100) : 0;
                    const peChg = pePrv > 0 ? Math.round(((peOI - pePrv) / pePrv) * 100) : 0;
                    const side  = Math.abs(ceChg) >= Math.abs(peChg) ? 'CE' : 'PE';
                    const chg   = side === 'CE' ? ceChg : peChg;
                    const oi    = side === 'CE' ? ceOI  : peOI;
                    return {strike: r.strike, side, chg, oi};
                  })
                  .filter(r => Math.abs(r.chg) >= 15)
                  .sort((a,b) => Math.abs(b.chg) - Math.abs(a.chg))
                  .slice(0, 6);
                return (
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:'1.25rem'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                        <span>🔥</span>
                        <span style={{fontWeight:700,fontSize:'0.95rem'}}>Unusual OI Activity</span>
                      </div>
                      <span style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>&#8805;15% OI change</span>
                    </div>
                    {liveOptionChain.length === 0 ? (
                      <div style={{textAlign:'center',padding:'1rem',color:'var(--text-muted)'}}>
                        <div style={{fontSize:'0.875rem',marginBottom:'0.5rem'}}>Load option chain in Markets tab first</div>
                        <button onClick={() => setActiveTab('markets')} style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'5px',padding:'4px 12px',fontSize:'0.875rem',cursor:'pointer'}}>Go to Markets</button>
                      </div>
                    ) : unusual.length === 0 ? (
                      <div style={{textAlign:'center',padding:'1rem',color:'var(--text-muted)',fontSize:'0.875rem'}}>
                        <div style={{fontSize:'1.25rem',marginBottom:'0.3rem'}}>😴</div>
                        <div>No unusual activity yet</div>
                        <div style={{fontSize:'0.75rem',marginTop:'0.2rem'}}>Updates every 10s with option chain</div>
                      </div>
                    ) : (
                      <div style={{display:'flex',flexDirection:'column',gap:'0.45rem'}}>
                        {unusual.map((u,i) => {
                          const isUp  = u.chg > 0;
                          const col   = u.side === 'CE' ? '#f87171' : '#4ade80';
                          const sig   = isUp ? (u.side === 'CE' ? '🚧 Resistance building' : '🛡️ Support building') : (u.side === 'CE' ? '📉 CE unwinding' : '📈 PE unwinding');
                          return (
                            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.45rem 0.6rem',background:'var(--bg-surface)',borderRadius:'var(--radius-sm)',borderLeft:'3px solid '+col}}>
                              <div>
                                <div style={{fontSize:'0.875rem',fontWeight:700}}>{u.strike.toLocaleString()} {u.side}</div>
                                <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{sig}</div>
                              </div>
                              <div style={{textAlign:'right'}}>
                                <div style={{fontSize:'0.875rem',fontWeight:700,color:isUp?'var(--green)':'var(--red)'}}>{isUp?'+':''}{u.chg}%</div>
                                <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{u.oi >= 100000 ? ((u.oi/100000).toFixed(1)+'L') : ((u.oi/1000).toFixed(0)+'K')} OI</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>{/* end 6 insight cards grid */}

            </div>{/* end home content wrapper */}
          </>
        ) : !currentUser ? (
          /* Not logged in  -  prompt sign in */
          <>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'60vh',textAlign:'center',padding:'2rem'}}>
            <div style={{fontSize:'3.5rem',marginBottom:'1rem'}}>🔐</div>
            <h2 style={{marginBottom:'0.5rem'}}>Sign in to continue</h2>
            <p style={{color:'var(--text-dim)',marginBottom:'1.5rem',maxWidth:'360px'}}>Create a free account to access all DeltaBuddy features. No card needed.</p>
            <button onClick={()=>setShowAuthModal(true)}
              style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'10px',padding:'0.85rem 2rem',fontWeight:800,fontSize:'1rem',cursor:'pointer'}}>
              Sign In Free →
            </button>
          </div>

          {/* SECURITY AND TRUST SECTION */}
          <div style={{margin:'2rem 0',padding:'1.5rem',background:'linear-gradient(135deg,rgba(0,255,136,0.04),rgba(56,189,248,0.04))',border:'1px solid rgba(0,255,136,0.15)',borderRadius:'16px'}}>
            <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
              <div style={{fontSize:'1.8rem',marginBottom:'0.5rem'}}>🔒</div>
              <h3 style={{margin:0,fontSize:'1.05rem',color:'var(--text-main)'}}>Your Data is Safe with DeltaBuddy</h3>
              <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:'0.4rem 0 0'}}>We take security seriously. Here is exactly how we protect you.</p>
            </div>

            {/* Trust cards */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'1rem',marginBottom:'1.5rem'}}>
              {[
                {icon:'🏦', title:'Bank-Grade Encryption', desc:'All data encrypted in transit (TLS 1.3) and at rest. Same standard used by banks.'},
                {icon:'🔐', title:'Firebase by Google', desc:'Your data lives in Google Firebase  -  Mumbai region. ISO 27001 certified infrastructure.'},
                {icon:'👤', title:'You Own Your Data', desc:'Your journal, trades, and settings are private to you. We cannot read them.'},
                {icon:'🚫', title:'We Never Sell Data', desc:'No ads. No data brokers. No third-party sharing. Your trading data stays yours.'},
                {icon:'🔑', title:'No Broker Passwords Stored', desc:'We store only your API token  -  never your broker login, password, or MPIN.'},
                {icon:'⚡', title:'Google Sign-In', desc:'Login via Google means no password to steal. Your account is secured by Google 2FA.'},
              ].map(({icon,title,desc})=>(
                <div key={title} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem',display:'flex',gap:'0.75rem',alignItems:'flex-start'}}>
                  <span style={{fontSize:'1.4rem',flexShrink:0}}>{icon}</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.82rem',color:'var(--text-main)',marginBottom:'0.25rem'}}>{title}</div>
                    <div style={{fontSize:'0.75rem',color:'var(--text-dim)',lineHeight:1.5}}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* What we store vs do not */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1.25rem'}}>
              <div style={{background:'rgba(74,222,128,0.06)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:'10px',padding:'1rem'}}>
                <div style={{fontWeight:700,fontSize:'0.8rem',color:'#4ade80',marginBottom:'0.6rem'}}>✅ What we store</div>
                {['Your email (for login)','Journal entries you write','Paper trade history','Telegram Chat ID (alerts)','Display name & profile photo'].map(item=>(
                  <div key={item} style={{fontSize:'0.75rem',color:'var(--text-dim)',padding:'0.2rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>{item}</div>
                ))}
              </div>
              <div style={{background:'rgba(248,113,113,0.06)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:'10px',padding:'1rem'}}>
                <div style={{fontWeight:700,fontSize:'0.8rem',color:'#f87171',marginBottom:'0.6rem'}}>❌ What we NEVER store</div>
                {['Broker passwords or MPIN','Bank account details','Credit/debit card numbers','Your actual trades from broker','Aadhaar or PAN number'].map(item=>(
                  <div key={item} style={{fontSize:'0.75rem',color:'var(--text-dim)',padding:'0.2rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>{item}</div>
                ))}
              </div>
            </div>

            {/* Badges */}
            <div style={{display:'flex',justifyContent:'center',gap:'1.5rem',flexWrap:'wrap',paddingTop:'0.75rem',borderTop:'1px solid var(--border)'}}>
              {[
                {badge:'🔒', label:'SSL / TLS 1.3'},
                {badge:'🌐', label:'Google Firebase'},
                {badge:'🇮🇳', label:'Mumbai Region'},
                {badge:'🛡️', label:'ISO 27001 Infra'},
                {badge:'📵', label:'No Ads Ever'},
              ].map(({badge,label})=>(
                <div key={label} style={{display:'flex',alignItems:'center',gap:'0.4rem',fontSize:'0.75rem',color:'var(--text-dim)',fontWeight:600}}>
                  <span>{badge}</span><span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          </>
        ) : activeTab === 'single' ? (
          <>
            <div className="page-header">
              <h1>Options Calculator</h1>
              <p className="subtitle">Analyze your options positions with Greeks and P&L visualization</p>
              <div className="header-actions">
                <button className="btn-action" onClick={() => setShowSaveModal(true)}>
                  💾 Save
                </button>
                <button className="btn-action" onClick={() => setShowPositionSizing(!showPositionSizing)}>
                  📏 Position Size
                </button>
              </div>
            </div>

            {showPositionSizing && (
              <div className="panel position-sizing-panel">
                <h2>Position Sizing Calculator</h2>
                <div className="position-sizing-inputs">
                  <div className="input-group">
                    <label>Account Size (₹)</label>
                    <input 
                      type="number"
                      value={accountSize}
                      onChange={(e) => setAccountSize(Number(e.target.value))}
                      className="input-field"
                    />
                  </div>
                  <div className="input-group">
                    <label>Risk Per Trade (%)</label>
                    <input 
                      type="number"
                      value={riskPercent}
                      onChange={(e) => setRiskPercent(Number(e.target.value))}
                      className="input-field"
                      step="0.1"
                      min="0.1"
                      max="10"
                    />
                  </div>
                </div>
                <div className="position-sizing-results">
                  <div className="sizing-item">
                    <span className="label">Risk Amount</span>
                    <span className="value">₹{positionSize.riskAmount.toLocaleString()}</span>
                  </div>
                  <div className="sizing-item">
                    <span className="label">Recommended Lots</span>
                    <span className="value accent">{positionSize.lots}</span>
                  </div>
                  <div className="sizing-item">
                    <span className="label">Capital Required</span>
                    <span className="value">₹{positionSize.capitalRequired.toLocaleString()}</span>
                  </div>
                  <div className="sizing-item">
                    <span className="label">Risk %</span>
                    <span className="value">{((positionSize.capitalRequired / accountSize) * 100).toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            )}

            <div className="calculator-grid">
              <div className="panel input-panel">
                <h2>Position Details</h2>
                
                <div className="input-group">
                  <label>Option Type</label>
                  <div className="button-group">
                    <button 
                      className={optionType === 'call' ? 'active' : ''}
                      onClick={() => setOptionType('call')}
                    >
                      Call
                    </button>
                    <button 
                      className={optionType === 'put' ? 'active' : ''}
                      onClick={() => setOptionType('put')}
                    >
                      Put
                    </button>
                  </div>
                </div>

                <div className="input-group">
                  <label>Position</label>
                  <div className="button-group">
                    <button 
                      className={positionType === 'buy' ? 'active buy' : ''}
                      onClick={() => setPositionType('buy')}
                    >
                      Buy
                    </button>
                    <button 
                      className={positionType === 'sell' ? 'active sell' : ''}
                      onClick={() => setPositionType('sell')}
                    >
                      Sell
                    </button>
                  </div>
                </div>

                <div className="input-group">
                  <label>Current Spot Price</label>
                  <input 
                    type="number" 
                    value={spot} 
                    onChange={(e) => setSpot(Number(e.target.value))}
                    className="input-field"
                  />
                </div>

                <div className="input-group">
                  <label>Strike Price</label>
                  <input 
                    type="number" 
                    value={strike} 
                    onChange={(e) => setStrike(Number(e.target.value))}
                    className="input-field"
                  />
                </div>

                <div className="input-group">
                  <label>Premium (₹)</label>
                  <input 
                    type="number" 
                    value={premium} 
                    onChange={(e) => setPremium(Number(e.target.value))}
                    className="input-field"
                  />
                </div>

                <div className="input-group">
                  <label>Lot Size</label>
                  <input 
                    type="number" 
                    value={lotSize} 
                    onChange={(e) => setLotSize(Number(e.target.value))}
                    className="input-field"
                  />
                </div>

                <div className="input-group">
                  <label>Days to Expiry</label>
                  <input 
                    type="number" 
                    value={daysToExpiry} 
                    onChange={(e) => setDaysToExpiry(Number(e.target.value))}
                    className="input-field"
                  />
                </div>

                <div className="input-group">
                  <label>Implied Volatility (%)</label>
                  <input 
                    type="number" 
                    value={volatility} 
                    onChange={(e) => setVolatility(Number(e.target.value))}
                    className="input-field"
                    step="0.1"
                  />
                </div>

                <button 
                  className="toggle-greeks"
                  onClick={() => setShowGreeks(!showGreeks)}
                >
                  {showGreeks ? 'Hide' : 'Show'} Greeks Analysis
                </button>
              </div>

              <div className="results-panel">
                <div className="panel">
                  <h2>Position Summary</h2>
                  <div className="summary-grid">
                    <div className="summary-item">
                      <span className="label">Current P&L</span>
                      <span className={`value ${currentPL >= 0 ? 'positive' : 'negative'}`}>
                        ₹{currentPL.toLocaleString()}
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Max Profit</span>
                      <span className="value positive">{maxProfit}</span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Max Loss</span>
                      <span className="value negative">{maxLoss}</span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Break Even</span>
                      <span className="value">
                        {positionType === 'buy' 
                          ? (optionType === 'call' ? strike + premium : strike - premium).toLocaleString()
                          : (optionType === 'call' ? strike + premium : strike - premium).toLocaleString()
                        }
                      </span>
                    </div>
                  </div>
                  <div className="probability-badge">
                    Probability of Profit: <strong>{calculateProbability()}%</strong>
                  </div>
                </div>

                <div className="panel gamma-zone">
                  <h2>🔥 Gamma Blast Zone</h2>
                  <p className="zone-description">
                    High gamma area where small price moves create big delta changes
                  </p>
                  <div className="zone-indicator">
                    <div className="zone-range">
                      <span className="zone-bound">
                        {Math.round(gammaBlastZone.center - gammaBlastZone.range).toLocaleString()}
                      </span>
                      <div className="zone-bar">
                        <div className="zone-center" style={{left: '50%'}}>
                          <span className="strike-label">Strike: {strike}</span>
                        </div>
                        <div 
                          className="current-spot" 
                          style={{left: `${50 + ((spot - strike) / (gammaBlastZone.range * 2)) * 100}%`}}
                        >
                          <span className="spot-label">Spot</span>
                        </div>
                      </div>
                      <span className="zone-bound">
                        {Math.round(gammaBlastZone.center + gammaBlastZone.range).toLocaleString()}
                      </span>
                    </div>
                    <p className="zone-status">
                      {Math.abs(spot - strike) < gammaBlastZone.range 
                        ? '✅ Currently in Gamma Blast Zone!' 
                        : '⚠️ Outside gamma zone'}
                    </p>
                  </div>
                </div>

                <div className="panel">
                  <h2>P&L at Expiry</h2>
                  <div className="chart-container">
                    <svg viewBox="0 0 600 300" className="pl-chart">
                      <line x1="50" y1="150" x2="550" y2="150" stroke="#334155" strokeWidth="2" />
                      <line x1="300" y1="20" x2="300" y2="280" stroke="#334155" strokeWidth="1" strokeDasharray="5,5" />
                      
                      <polyline
                        points={plData.map((d, i) => {
                          const x = 50 + (i / plData.length) * 500;
                          const maxPL = Math.max(...plData.map(p => Math.abs(p.pl)));
                          const y = 150 - (d.pl / maxPL) * 120;
                          return `${x},${Math.max(20, Math.min(280, y))}`;
                        }).join(' ')}
                        fill="none"
                        stroke={currentPL >= 0 ? '#10B981' : '#EF4444'}
                        strokeWidth="3"
                      />
                      
                      <rect x="50" y="20" width="500" height="130" fill="rgba(16, 185, 129, 0.1)" />
                      <rect x="50" y="150" width="500" height="130" fill="rgba(239, 68, 68, 0.1)" />
                      
                      <text x="300" y="15" textAnchor="middle" fill="#10B981" fontSize="12" fontWeight="bold">
                        Profit Zone
                      </text>
                      <text x="300" y="295" textAnchor="middle" fill="#EF4444" fontSize="12" fontWeight="bold">
                        Loss Zone
                      </text>
                      
                      <line x1="300" y1="20" x2="300" y2="280" stroke="#F59E0B" strokeWidth="2" />
                      <text x="305" y="150" fill="#F59E0B" fontSize="12" fontWeight="bold">Strike</text>
                    </svg>
                  </div>
                </div>

                {showGreeks && (
                  <div className="panel greeks-panel">
                    <h2>Greeks Analysis</h2>
                    <div className="greeks-grid">
                      <div className="greek-item">
                        <span className="greek-label">Delta (Δ)</span>
                        <span className="greek-value">{greeks.delta.toFixed(4)}</span>
                        <span className="greek-desc">Price sensitivity</span>
                      </div>
                      <div className="greek-item">
                        <span className="greek-label">Gamma (Γ)</span>
                        <span className="greek-value">{greeks.gamma.toFixed(4)}</span>
                        <span className="greek-desc">Delta change rate</span>
                      </div>
                      <div className="greek-item">
                        <span className="greek-label">Theta (Θ)</span>
                        <span className="greek-value negative">{greeks.theta.toFixed(2)}</span>
                        <span className="greek-desc">Time decay per day</span>
                      </div>
                      <div className="greek-item">
                        <span className="greek-label">Vega (ν)</span>
                        <span className="greek-value">{greeks.vega.toFixed(2)}</span>
                        <span className="greek-desc">IV sensitivity</span>
                      </div>
                    </div>
                    
                    <div className="greek-explanation">
                      <p>
                        <strong>Current Position:</strong> {positionType === 'buy' ? 'Long' : 'Short'} {optionType === 'call' ? 'Call' : 'Put'}
                      </p>
                      <p>
                        <strong>Delta Meaning:</strong> A 1-point move in spot will change your position by ₹{Math.abs(greeks.delta * lotSize).toFixed(2)}
                      </p>
                      <p>
                        <strong>Theta Impact:</strong> You're {greeks.theta < 0 ? 'losing' : 'gaining'} ₹{Math.abs(greeks.theta * lotSize).toFixed(2)} per day due to time decay
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : activeTab === 'strategy' ? (
          (() => {
            // ── Strategy helper: find closest actual strike from chain ──────
            const atmStrike = liveOptionChain.length > 0
              ? liveOptionChain.reduce((a,b) => Math.abs(b.strike-spot)<Math.abs(a.strike-spot)?b:a).strike
              : Math.round(spot/50)*50;
            const strikeMul = selectedUnderlying.includes('BANK') ? 100 : 50;

            const resolveStrike = (offset) => {
              if (liveOptionChain.length === 0) return atmStrike + offset;
              const target = atmStrike + offset;
              return liveOptionChain.reduce((a,b) => Math.abs(b.strike-target)<Math.abs(a.strike-target)?b:a).strike;
            };

            const getLivePremium = (strike, type) => {
              const row = liveOptionChain.find(r => r.strike === strike);
              if (!row) return null;
              return type === 'call' ? parseFloat(row.ce?.ltp||0) : parseFloat(row.pe?.ltp||0);
            };

            // Mini SVG payoff for strategy cards
            const MiniPayoff = ({ legs: tLegs }) => {
              const pts = [];
              const s0 = atmStrike;
              for (let i = 0; i <= 20; i++) {
                const s = s0 - 300 + i * 30;
                let pl = 0;
                tLegs.forEach(l => {
                  const k = s0 + (l.strikeOffset||0);
                  const prem = l.premiumPercent * 80;
                  const intrinsic = l.optionType==='call' ? Math.max(0,s-k) : Math.max(0,k-s);
                  pl += l.position==='buy' ? (intrinsic-prem)*(l.quantity||1) : (prem-intrinsic)*(l.quantity||1);
                });
                pts.push(pl);
              }
              const mn = Math.min(...pts), mx = Math.max(...pts);
              const range = mx - mn || 1;
              const path = pts.map((p,i) => {
                const x = 4 + i * 3.6;
                const y = 28 - ((p-mn)/range) * 24;
                return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
              return (
                <svg viewBox="0 0 76 32" style={{width:76,height:32,display:'block'}}>
                  <line x1="4" y1={28-((0-mn)/range)*24} x2="72" y2={28-((0-mn)/range)*24} stroke="rgba(100,116,139,0.4)" strokeWidth="0.5"/>
                  <path d={path} fill="none" stroke={mx>0?'#4ade80':'#f87171'} strokeWidth="1.5"/>
                </svg>
              );
            };

            const views = [
              { id:'bullish',  label:'📈 Bullish' },
              { id:'bearish',  label:'📉 Bearish' },
              { id:'sideways', label:'↔ Sideways' },
              { id:'volatile', label:'⚡ Volatile' },
              { id:'all',      label:'All' },
            ];

            const visibleStrategies = Object.entries(STRATEGY_TEMPLATES)
              .filter(([,s]) => stratView==='all' || s.view===stratView);

            // Strike options for dropdowns
            const strikeOffsets = [-300,-200,-150,-100,-50,0,50,100,150,200,300];
            const strikeOptions = strikeOffsets.map(off => ({
              offset: off,
              strike: resolveStrike(off),
              label: off===0 ? 'ATM' : off>0 ? `ATM+${off}` : `ATM${off}`,
            }));

            const netPremium = legs.reduce((s,l) => {
              const sign = l.position==='buy' ? -1 : 1;
              return s + sign * l.premium * lotSize * (l.quantity||1);
            }, 0);

            return (
              <>
            <div className="home-tabs" style={{marginBottom:'1.5rem'}}>
              {[['strategy','🎯 Strategy Builder'],['scanner','🔍 Scanner'],['single','🧮 Calculator']].map(([t,l])=>(
                <button key={t} className={`home-tab-btn ${activeTab===t?'active':''}`} onClick={()=>setActiveTab(t)}>{l}</button>
              ))}
            </div>

                {/* ── Top Bar ───────────────────────────────────────── */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'0.75rem',marginBottom:'1.25rem'}}>
                  <div>
                    <h1 style={{margin:0,fontSize:'1.25rem',fontWeight:800}}>⚙️ Strategy Builder</h1>
                    <p style={{margin:0,fontSize:'0.8rem',color:'var(--text-dim)'}}>Build, analyse and simulate options strategies</p>
                  </div>
                  <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.3rem 0.6rem',fontSize:'0.8rem',color:'var(--text-dim)'}}>
                      <span style={{color:'var(--text-muted)'}}>Spot: </span>
                      <span style={{fontWeight:700,color:'var(--text-main)'}}>{spot.toLocaleString()}</span>
                    </div>
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.3rem 0.6rem',fontSize:'0.8rem',color:'var(--text-dim)'}}>
                      <span style={{color:'var(--text-muted)'}}>ATM: </span>
                      <span style={{fontWeight:700,color:'#f97316'}}>{atmStrike.toLocaleString()}</span>
                    </div>
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.3rem 0.6rem',fontSize:'0.8rem',color:'var(--text-dim)'}}>
                      <label style={{marginRight:'0.3rem',color:'var(--text-muted)'}}>DTE:</label>
                      <input type="number" value={daysToExpiry} onChange={e=>setDaysToExpiry(parseInt(e.target.value)||7)}
                        style={{width:36,background:'transparent',border:'none',color:'var(--accent)',fontWeight:700,fontSize:'0.8rem',outline:'none'}}/>
                    </div>
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.3rem 0.6rem',fontSize:'0.8rem'}}>
                      <label style={{marginRight:'0.3rem',color:'var(--text-muted)'}}>IV:</label>
                      <input type="number" value={volatility} onChange={e=>setVolatility(parseFloat(e.target.value)||15)}
                        style={{width:36,background:'transparent',border:'none',color:'#818cf8',fontWeight:700,fontSize:'0.8rem',outline:'none'}}/>
                      <span style={{color:'var(--text-muted)'}}>%</span>
                    </div>
                  </div>
                </div>

                {/* ── Market View Tabs ──────────────────────────────── */}
                <div style={{display:'flex',gap:'0.4rem',marginBottom:'1.25rem',flexWrap:'wrap'}}>
                  {views.map(v => (
                    <button key={v.id} onClick={()=>setStratView(v.id)}
                      style={{padding:'0.4rem 1rem',borderRadius:'99px',border:'1px solid',fontSize:'0.8rem',fontWeight:600,cursor:'pointer',transition:'all 0.15s',
                        borderColor: stratView===v.id ? 'var(--accent)' : 'var(--border)',
                        background: stratView===v.id ? 'rgba(0,255,136,0.12)' : 'var(--bg-card)',
                        color: stratView===v.id ? 'var(--accent)' : 'var(--text-dim)'}}>
                      {v.label}
                    </button>
                  ))}
                  <button onClick={()=>{ setLegs([{id:1,position:'buy',optionType:'call',strike:atmStrike,premium:getLivePremium(atmStrike,'call')||80,quantity:1}]); setSelectedStrategy('custom'); setStratView('custom'); }}
                    style={{padding:'0.4rem 1rem',borderRadius:'99px',border:'1px solid',fontSize:'0.8rem',fontWeight:600,cursor:'pointer',
                      borderColor: stratView==='custom' ? 'rgba(139,92,246,0.8)' : 'rgba(139,92,246,0.4)',
                      background: stratView==='custom' ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)',
                      color:'#a78bfa'}}>
                    ✏️ Custom
                  </button>
                </div>

                {/* ── Strategy Cards — hidden in custom mode ────────── */}
                {stratView !== 'custom' && (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'0.75rem',marginBottom:'1.5rem'}}>
                  {visibleStrategies.map(([key, s]) => (
                    <div key={key} onClick={()=>{ loadStrategyTemplate(key); setStratView(stratView); }}
                      style={{cursor:'pointer',borderRadius:'12px',padding:'0.9rem',
                        border:`1.5px solid ${selectedStrategy===key?'var(--accent)':'var(--border)'}`,
                        background:selectedStrategy===key?'rgba(0,255,136,0.06)':'var(--bg-card)',
                        transition:'all 0.15s',position:'relative'}}>
                      <div style={{position:'absolute',top:'0.6rem',right:'0.6rem',fontSize:'0.62rem',fontWeight:700,padding:'2px 6px',borderRadius:'99px',
                        background:s.risk==='Defined'?'rgba(74,222,128,0.12)':'rgba(248,113,113,0.12)',
                        color:s.risk==='Defined'?'#4ade80':'#f87171'}}>
                        {s.risk}
                      </div>
                      <div style={{marginBottom:'0.5rem'}}><MiniPayoff legs={s.legs}/></div>
                      <div style={{fontWeight:700,fontSize:'0.85rem',color:selectedStrategy===key?'var(--accent)':'var(--text-main)',marginBottom:'0.2rem'}}>{s.name}</div>
                      <div style={{fontSize:'0.72rem',color:'var(--text-dim)',lineHeight:1.3}}>{s.description}</div>
                    </div>
                  ))}
                </div>
                )}

                {/* ── Custom mode: live chain picker ────────────────── */}
                {stratView === 'custom' && (
                <div style={{background:'var(--bg-card)',border:'1px solid rgba(139,92,246,0.3)',borderRadius:'12px',padding:'1rem',marginBottom:'1.25rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
                    <div>
                      <span style={{fontWeight:700,fontSize:'0.88rem',color:'#a78bfa'}}>✏️ Custom Builder — Live Chain</span>
                      <span style={{fontSize:'0.72rem',color:'var(--text-dim)',marginLeft:'0.6rem'}}>Click any row to add as leg · Spot {spot.toLocaleString()} · ATM {atmStrike.toLocaleString()}</span>
                    </div>
                    <div style={{display:'flex',gap:'0.4rem'}}>
                      <button onClick={()=>{
                        const fp = spot + 50;
                        setLegs(prev=>[...prev,{id:Date.now(),position:'buy',optionType:'future',strike:atmStrike,premium:fp,quantity:1,futMonth:'CUR'}]);
                      }} style={{background:'rgba(251,191,36,0.12)',color:'#fbbf24',border:'1px solid rgba(251,191,36,0.3)',borderRadius:'6px',padding:'0.3rem 0.75rem',fontWeight:700,fontSize:'0.75rem',cursor:'pointer'}}>
                        + Buy Futures
                      </button>
                      <button onClick={()=>{
                        const fp = spot + 50;
                        setLegs(prev=>[...prev,{id:Date.now(),position:'sell',optionType:'future',strike:atmStrike,premium:fp,quantity:1,futMonth:'CUR'}]);
                      }} style={{background:'rgba(248,113,113,0.1)',color:'#f87171',border:'1px solid rgba(248,113,113,0.25)',borderRadius:'6px',padding:'0.3rem 0.75rem',fontWeight:700,fontSize:'0.75rem',cursor:'pointer'}}>
                        + Sell Futures
                      </button>
                    </div>
                  </div>

                  {/* Chain table */}
                  {liveOptionChain.length === 0 ? (
                    <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-dim)',fontSize:'0.82rem'}}>
                      Loading option chain… switch to Option Chain tab first if not loaded.
                    </div>
                  ) : (
                    <div style={{overflowX:'auto',maxHeight:'380px',overflowY:'auto',borderRadius:'6px',border:'1px solid var(--border)'}}>
                      {/* Table header */}
                      <div style={{display:'grid',gridTemplateColumns:'60px 60px 80px 80px 70px 80px 80px 60px 60px',gap:'0.2rem',padding:'0.4rem 0.5rem',borderBottom:'2px solid var(--border)',fontSize:'0.62rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:700,background:'var(--bg-dark)'}}>
                        <span style={{textAlign:'right'}}>CE OI</span>
                        <span style={{textAlign:'right'}}>IV%</span>
                        <span style={{textAlign:'right',color:'#60a5fa'}}>CE LTP</span>
                        <span style={{textAlign:'right',color:'#60a5fa'}}>+CE BUY</span>
                        <span style={{textAlign:'center',color:'var(--accent)'}}>STRIKE</span>
                        <span style={{color:'#4ade80'}}>+PE BUY</span>
                        <span style={{color:'#f87171'}}>PE LTP</span>
                        <span>IV%</span>
                        <span>PE OI</span>
                      </div>
                      {liveOptionChain
                        .filter(r => Math.abs(r.strike - spot) / (spot || 25500) <= 0.06)
                        .sort((a,b) => b.strike - a.strike)
                        .map(row => {
                          const isATM = row.strike === atmStrike;
                          const ceLTP = parseFloat(row.ce?.ltp || 0);
                          const peLTP = parseFloat(row.pe?.ltp || 0);
                          return (
                            <div key={row.strike} style={{display:'grid',gridTemplateColumns:'60px 60px 80px 80px 70px 80px 80px 60px 60px',gap:'0.2rem',padding:'0.3rem 0.5rem',
                              background:isATM?'rgba(0,255,136,0.07)':'transparent',
                              borderBottom:`1px solid ${isATM?'rgba(0,255,136,0.2)':'rgba(255,255,255,0.03)'}`,
                              alignItems:'center'}}>
                              <span style={{textAlign:'right',fontSize:'0.65rem',color:'#94a3b8'}}>{((row.ce?.oi||0)/100000).toFixed(1)}L</span>
                              <span style={{textAlign:'right',fontSize:'0.67rem',color:'#818cf8'}}>{row.ce?.iv||0}%</span>
                              <span style={{textAlign:'right',fontSize:'0.75rem',color:'#93c5fd',fontWeight:600}}>₹{ceLTP.toFixed(0)}</span>
                              <button onClick={()=>setLegs(prev=>[...prev,{id:Date.now(),position:'buy',optionType:'call',strike:row.strike,premium:ceLTP,quantity:1}])}
                                style={{background:'rgba(96,165,250,0.15)',color:'#60a5fa',border:'1px solid rgba(96,165,250,0.3)',borderRadius:'4px',padding:'0.2rem 0.25rem',fontSize:'0.68rem',fontWeight:700,cursor:'pointer',textAlign:'center'}}>
                                B ₹{ceLTP.toFixed(0)}
                              </button>
                              <div style={{textAlign:'center',fontWeight:800,fontSize:isATM?'0.88rem':'0.78rem',color:isATM?'var(--accent)':'var(--text-main)',padding:'0 0.15rem'}}>
                                {row.strike}{isATM?<span style={{fontSize:'0.6rem',color:'var(--accent)',marginLeft:'2px'}}>ATM</span>:''}
                              </div>
                              <button onClick={()=>setLegs(prev=>[...prev,{id:Date.now(),position:'buy',optionType:'put',strike:row.strike,premium:peLTP,quantity:1}])}
                                style={{background:'rgba(74,222,128,0.12)',color:'#4ade80',border:'1px solid rgba(74,222,128,0.25)',borderRadius:'4px',padding:'0.2rem 0.25rem',fontSize:'0.68rem',fontWeight:700,cursor:'pointer'}}>
                                B ₹{peLTP.toFixed(0)}
                              </button>
                              <span style={{fontSize:'0.75rem',color:'#86efac',fontWeight:600}}>₹{peLTP.toFixed(0)}</span>
                              <span style={{fontSize:'0.67rem',color:'#818cf8'}}>{row.pe?.iv||0}%</span>
                              <span style={{fontSize:'0.65rem',color:'#94a3b8'}}>{((row.pe?.oi||0)/100000).toFixed(1)}L</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
                )}

                {/* ── Legs Editor ───────────────────────────────────── */}
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem',marginBottom:'1.25rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.9rem'}}>
                    <span style={{fontWeight:700,color:'var(--accent)',fontSize:'0.9rem'}}>Strategy Legs</span>
                    <button onClick={addLeg}
                      style={{background:'rgba(0,255,136,0.12)',color:'var(--accent)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'6px',padding:'0.3rem 0.8rem',fontWeight:700,fontSize:'0.8rem',cursor:'pointer'}}>
                      + Add Leg
                    </button>
                  </div>

                  {/* Header row */}
                  <div style={{display:'grid',gridTemplateColumns:'90px 100px 60px 160px 90px 60px 32px',gap:'0.4rem',padding:'0.3rem 0.4rem',borderBottom:'1px solid var(--border)',fontSize:'0.68rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'0.35rem'}}>
                    <span>Action</span><span>Type</span><span>Lots</span><span>Strike / Month</span><span>Price</span><span>IV%</span><span></span>
                  </div>

                  {legs.map((leg, idx) => {
                    const isFut = leg.optionType === 'future';
                    const livePrem = isFut ? null : getLivePremium(leg.strike, leg.optionType);
                    const closestOffset = isFut ? strikeOptions[Math.floor(strikeOptions.length/2)] : strikeOptions.reduce((a,b) => Math.abs(b.strike-leg.strike)<Math.abs(a.strike-leg.strike)?b:a);
                    // Futures carry: CUR≈spot+50, NEXT≈spot+100, FAR≈spot+150
                    const FUT_MONTHS = ['CUR','NEXT1','NEXT2'];
                    const futCarry = { 'CUR': 50, 'NEXT1': 100, 'NEXT2': 150 };
                    const futMonth = leg.futMonth || 'CUR';
                    const futPrice = spot + (futCarry[futMonth] || 50);
                    return (
                      <div key={leg.id} style={{display:'grid',gridTemplateColumns:'90px 100px 60px 160px 90px 60px 32px',gap:'0.4rem',alignItems:'center',padding:'0.35rem 0.4rem',borderRadius:'6px',marginBottom:'0.25rem',background:idx%2===0?'rgba(255,255,255,0.02)':'transparent'}}>

                        {/* Buy / Sell */}
                        <div style={{display:'flex',gap:'3px'}}>
                          {['buy','sell'].map(p => (
                            <button key={p} onClick={()=>updateLeg(leg.id,'position',p)}
                              style={{flex:1,padding:'0.3rem 0',borderRadius:'4px',border:'1px solid',fontSize:'0.72rem',fontWeight:700,cursor:'pointer',
                                borderColor:leg.position===p?(p==='buy'?'#4ade80':'#f87171'):'var(--border)',
                                background:leg.position===p?(p==='buy'?'rgba(74,222,128,0.15)':'rgba(248,113,113,0.15)'):'transparent',
                                color:leg.position===p?(p==='buy'?'#4ade80':'#f87171'):'var(--text-muted)'}}>
                              {p.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        {/* CE / PE / FUT */}
                        <div style={{display:'flex',gap:'3px'}}>
                          {['call','put','future'].map(t => (
                            <button key={t} onClick={()=>{
                              if (t === 'future') {
                                updateLeg(leg.id,'optionType','future');
                                updateLeg(leg.id,'premium', futPrice);
                                updateLeg(leg.id,'futMonth','CUR');
                              } else {
                                const lp = getLivePremium(leg.strike, t);
                                updateLeg(leg.id,'optionType',t);
                                if (lp) updateLeg(leg.id,'premium',lp);
                              }
                            }}
                              style={{flex:1,padding:'0.25rem 0',borderRadius:'4px',border:'1px solid',fontSize:'0.68rem',fontWeight:700,cursor:'pointer',
                                borderColor: leg.optionType===t ? (t==='future'?'rgba(251,191,36,0.7)':'var(--accent)') : 'var(--border)',
                                background:  leg.optionType===t ? (t==='future'?'rgba(251,191,36,0.15)':'rgba(0,255,136,0.1)') : 'transparent',
                                color:       leg.optionType===t ? (t==='future'?'#fbbf24':'var(--accent)') : 'var(--text-muted)'}}>
                              {t==='call'?'CE':t==='put'?'PE':'FUT'}
                            </button>
                          ))}
                        </div>

                        {/* Lots */}
                        <input type="number" min="1" value={leg.quantity||1} onChange={e=>updateLeg(leg.id,'quantity',parseInt(e.target.value)||1)}
                          style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.3rem 0.4rem',fontSize:'0.78rem',width:'100%',boxSizing:'border-box',textAlign:'center'}}/>

                        {/* Strike dropdown or Futures month */}
                        {isFut ? (
                          <select value={futMonth} onChange={e=>{
                            const m=e.target.value;
                            const fp = spot + (futCarry[m]||50);
                            updateLeg(leg.id,'futMonth',m);
                            updateLeg(leg.id,'premium',fp);
                          }}
                            style={{background:'var(--bg-dark)',color:'#fbbf24',border:'1px solid rgba(251,191,36,0.4)',borderRadius:'6px',padding:'0.3rem 0.4rem',fontSize:'0.78rem',fontWeight:700,width:'100%'}}>
                            <option value="CUR">Current Month (~+50)</option>
                            <option value="NEXT1">Next Month (~+100)</option>
                            <option value="NEXT2">Far Month (~+150)</option>
                          </select>
                        ) : (
                          <select value={closestOffset.offset}
                            onChange={e=>{
                              const opt = strikeOptions.find(o=>o.offset===parseInt(e.target.value));
                              if (!opt) return;
                              updateLeg(leg.id,'strike',opt.strike);
                              const lp = getLivePremium(opt.strike, leg.optionType);
                              if (lp) updateLeg(leg.id,'premium',lp);
                            }}
                            style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.3rem 0.3rem',fontSize:'0.75rem',width:'100%'}}>
                            {strikeOptions.map(o=>(
                              <option key={o.offset} value={o.offset}>{o.label} ({o.strike.toLocaleString()})</option>
                            ))}
                          </select>
                        )}

                        {/* Price */}
                        <div style={{position:'relative'}}>
                          <input type="number" value={leg.premium} step="0.5"
                            onChange={e=>updateLeg(leg.id,'premium',parseFloat(e.target.value)||0)}
                            style={{background:'var(--bg-dark)',color:'var(--text-main)',border:`1px solid ${isFut?'rgba(251,191,36,0.4)':livePrem&&Math.abs(livePrem-leg.premium)<5?'rgba(0,255,136,0.4)':'var(--border)'}`,borderRadius:'6px',padding:'0.3rem 0.4rem',fontSize:'0.78rem',width:'100%',boxSizing:'border-box'}}/>
                          {!isFut && livePrem && Math.abs(livePrem-leg.premium)<2 && (
                            <span style={{position:'absolute',top:-8,right:2,fontSize:'0.55rem',color:'#4ade80',fontWeight:700}}>LIVE</span>
                          )}
                          {isFut && <span style={{position:'absolute',top:-8,right:2,fontSize:'0.55rem',color:'#fbbf24',fontWeight:700}}>EST</span>}
                        </div>

                        {/* IV or FUT label */}
                        <div style={{fontSize:'0.75rem',textAlign:'center',fontWeight:600}}>
                          {isFut
                            ? <span style={{color:'#fbbf24',fontSize:'0.65rem'}}>Δ={leg.position==='buy'?'+1':'-1'}</span>
                            : <span style={{color:'#818cf8'}}>{liveOptionChain.find(r=>r.strike===leg.strike)?.[leg.optionType==='call'?'ce':'pe']?.iv || volatility}</span>
                          }
                        </div>

                        {/* Remove */}
                        {legs.length > 1 ? (
                          <button onClick={()=>removeLeg(leg.id)}
                            style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:'1rem',padding:0,lineHeight:1}}>×</button>
                        ) : <span/>}
                      </div>
                    );
                  })}
                </div>

                {/* ── Summary Bar ──────────────────────────────────── */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'0.6rem',marginBottom:'1.25rem'}}>
                  {[
                    { label:'Max Profit',  val: multiMaxProfit,  color:'#4ade80' },
                    { label:'Max Loss',    val: multiMaxLoss,    color:'#f87171' },
                    { label:'Net Premium', val: netPremium>=0?`+₹${Math.round(netPremium).toLocaleString()}`:`-₹${Math.round(Math.abs(netPremium)).toLocaleString()}`, color:netPremium>=0?'#4ade80':'#f87171' },
                    { label:'Theta/Day',   val: `₹${Math.abs(Math.round(multiLegGreeks.theta*lotSize))}`, color:multiLegGreeks.theta>0?'#4ade80':'#f87171' },
                    { label:'Net Delta',   val: multiLegGreeks.delta.toFixed(2), color: Math.abs(multiLegGreeks.delta)<0.1?'#fbbf24':multiLegGreeks.delta>0?'#4ade80':'#f87171' },
                  ].map((item,i) => (
                    <div key={i} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'0.75rem',textAlign:'center'}}>
                      <div style={{fontSize:'0.68rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'0.3rem'}}>{item.label}</div>
                      <div style={{fontSize:'1rem',fontWeight:800,color:item.color}}>{item.val}</div>
                    </div>
                  ))}
                  {breakEvenPoints.length > 0 && (
                    <div style={{background:'var(--bg-card)',border:'1px solid rgba(251,191,36,0.3)',borderRadius:'10px',padding:'0.75rem',textAlign:'center',gridColumn:'span 2'}}>
                      <div style={{fontSize:'0.68rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'0.3rem'}}>Breakeven{breakEvenPoints.length>1?'s':''}</div>
                      <div style={{fontSize:'0.88rem',fontWeight:700,color:'#fbbf24'}}>{breakEvenPoints.map(b=>b.toLocaleString()).join('  |  ')}</div>
                    </div>
                  )}
                </div>

                {/* ── Payoff Chart ──────────────────────────────────── */}
                {multiLegPLData.length > 0 && (() => {
                  const W=600, H=260, PL=50, PR=20, PT=20, PB=30;
                  const cW=W-PL-PR, cH=H-PT-PB;
                  const spots = multiLegPLData.map(d=>d.spot);
                  const pls   = multiLegPLData.map(d=>d.pl);
                  const minS=Math.min(...spots), maxS=Math.max(...spots);
                  const minPL=Math.min(...pls), maxPL=Math.max(...pls);
                  const plRange = maxPL-minPL||1;
                  const toX = s => PL + ((s-minS)/(maxS-minS||1))*cW;
                  const toY = p => PT + ((maxPL-p)/plRange)*cH;
                  const zeroY = toY(0);

                  // Build profit and loss paths separately for fill
                  const profitPath = multiLegPLData.map((d,i)=>{
                    const x=toX(d.spot), y=Math.min(toY(d.pl),zeroY);
                    return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ') + ` L${toX(maxS).toFixed(1)},${zeroY.toFixed(1)} L${toX(minS).toFixed(1)},${zeroY.toFixed(1)} Z`;

                  const lossPath = multiLegPLData.map((d,i)=>{
                    const x=toX(d.spot), y=Math.max(toY(d.pl),zeroY);
                    return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ') + ` L${toX(maxS).toFixed(1)},${zeroY.toFixed(1)} L${toX(minS).toFixed(1)},${zeroY.toFixed(1)} Z`;

                  const linePath = multiLegPLData.map((d,i) =>
                    `${i===0?'M':'L'}${toX(d.spot).toFixed(1)},${toY(d.pl).toFixed(1)}`
                  ).join(' ');

                  // X-axis labels — 5 evenly spaced
                  const xLabels = [0,1,2,3,4].map(i => Math.round(minS + i*(maxS-minS)/4));
                  // Y-axis labels — 3
                  const yLabels = [maxPL, 0, minPL].filter((v,i,a)=>a.indexOf(v)===i);

                  // Hover logic
                  const hoverData = stratHoverIdx !== null ? multiLegPLData[stratHoverIdx] : null;
                  const hoverX = hoverData ? toX(hoverData.spot) : null;
                  const hoverY = hoverData ? toY(hoverData.pl)   : null;

                  return (
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem',marginBottom:'1.25rem'}}>
                      <div style={{fontWeight:700,color:'var(--accent)',fontSize:'0.88rem',marginBottom:'0.75rem'}}>📊 Payoff at Expiry</div>
                      <div style={{overflowX:'auto'}}>
                        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:W,display:'block',cursor:'crosshair'}}
                          onMouseMove={e=>{
                            const rect=e.currentTarget.getBoundingClientRect();
                            const mx=(e.clientX-rect.left)/(rect.width/W);
                            const spotAtX=minS+(mx-PL)/cW*(maxS-minS);
                            const idx=multiLegPLData.reduce((bi,d,i)=>Math.abs(d.spot-spotAtX)<Math.abs(multiLegPLData[bi].spot-spotAtX)?i:bi,0);
                            setStratHoverIdx(idx);
                          }}
                          onMouseLeave={()=>setStratHoverIdx(null)}>

                          {/* Filled profit zone */}
                          <path d={profitPath} fill="rgba(74,222,128,0.12)"/>
                          {/* Filled loss zone */}
                          <path d={lossPath} fill="rgba(248,113,113,0.10)"/>
                          {/* Zero line */}
                          <line x1={PL} y1={zeroY} x2={W-PR} y2={zeroY} stroke="rgba(100,116,139,0.5)" strokeWidth="1" strokeDasharray="4,3"/>
                          {/* P&L line */}
                          <path d={linePath} fill="none" stroke="#00ff88" strokeWidth="2.5"/>

                          {/* Current spot line */}
                          {(() => {
                            const sx = toX(spot);
                            return (<>
                              <line x1={sx} y1={PT} x2={sx} y2={H-PB} stroke="#f97316" strokeWidth="1.5" strokeDasharray="3,3"/>
                              <text x={sx+4} y={PT+12} fill="#f97316" fontSize="9" fontWeight="bold">SPOT</text>
                            </>);
                          })()}

                          {/* Breakeven lines */}
                          {breakEvenPoints.map((be,i)=>{
                            const bx=toX(be);
                            return (<g key={i}>
                              <line x1={bx} y1={PT} x2={bx} y2={H-PB} stroke="#fbbf24" strokeWidth="1" strokeDasharray="4,3"/>
                              <text x={bx+3} y={H-PB-4} fill="#fbbf24" fontSize="8" fontWeight="bold">BE:{be.toLocaleString()}</text>
                            </g>);
                          })}

                          {/* Hover crosshair */}
                          {hoverData && (<>
                            <line x1={hoverX} y1={PT} x2={hoverX} y2={H-PB} stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
                            <circle cx={hoverX} cy={hoverY} r="4" fill={hoverData.pl>=0?'#4ade80':'#f87171'} stroke="#fff" strokeWidth="1.5"/>
                            <rect x={hoverX>W/2?hoverX-115:hoverX+8} y={Math.min(hoverY-10,H-PB-40)} width="108" height="36" rx="6" fill="rgba(15,23,42,0.92)" stroke="rgba(100,116,139,0.4)"/>
                            <text x={hoverX>W/2?hoverX-108:hoverX+14} y={Math.min(hoverY-10,H-PB-40)+14} fill="#cbd5e1" fontSize="9">Spot: {hoverData.spot.toLocaleString()}</text>
                            <text x={hoverX>W/2?hoverX-108:hoverX+14} y={Math.min(hoverY-10,H-PB-40)+26} fill={hoverData.pl>=0?'#4ade80':'#f87171'} fontSize="9" fontWeight="bold">
                              P&L: {hoverData.pl>=0?'+':''}{Math.round(hoverData.pl).toLocaleString()}
                            </text>
                          </>)}

                          {/* X-axis labels */}
                          {xLabels.map((v,i)=>(
                            <text key={i} x={toX(v)} y={H-4} textAnchor="middle" fill="#64748b" fontSize="8">{v.toLocaleString()}</text>
                          ))}

                          {/* Y-axis labels */}
                          {yLabels.map((v,i)=>(
                            <text key={i} x={PL-4} y={toY(v)+3} textAnchor="end" fill={v>0?'#4ade80':v<0?'#f87171':'#64748b'} fontSize="8">
                              {v>=0?'+':''}{Math.round(v/1000)}K
                            </text>
                          ))}
                        </svg>
                      </div>
                      {hoverData && (
                        <div style={{textAlign:'center',fontSize:'0.78rem',color:'var(--text-dim)',marginTop:'0.4rem'}}>
                          Spot <strong style={{color:'var(--text-main)'}}>{hoverData.spot.toLocaleString()}</strong> →
                          P&L <strong style={{color:hoverData.pl>=0?'#4ade80':'#f87171'}}>{hoverData.pl>=0?'+':''}{Math.round(hoverData.pl).toLocaleString()}</strong>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Greeks Panel ─────────────────────────────────── */}
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem'}}>
                  <div style={{fontWeight:700,color:'var(--accent)',fontSize:'0.88rem',marginBottom:'0.75rem'}}>Greeks Summary</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.6rem'}}>
                    {[
                      { label:'Δ Delta',   val:multiLegGreeks.delta.toFixed(3),  desc:'₹'+(Math.abs(multiLegGreeks.delta*lotSize)).toFixed(0)+'/pt' },
                      { label:'Γ Gamma',   val:multiLegGreeks.gamma.toFixed(4),  desc:'Delta accel' },
                      { label:'Θ Theta',   val:multiLegGreeks.theta.toFixed(2),  desc:'₹'+(Math.abs(multiLegGreeks.theta*lotSize)).toFixed(0)+'/day', col:multiLegGreeks.theta>0?'#4ade80':'#f87171' },
                      { label:'ν Vega',    val:multiLegGreeks.vega.toFixed(2),   desc:'IV sensitivity' },
                    ].map((g,i)=>(
                      <div key={i} style={{background:'var(--bg-dark)',borderRadius:'8px',padding:'0.65rem',textAlign:'center'}}>
                        <div style={{fontSize:'0.68rem',color:'var(--text-muted)',marginBottom:'0.2rem',textTransform:'uppercase',letterSpacing:'0.05em'}}>{g.label}</div>
                        <div style={{fontSize:'1rem',fontWeight:800,color:g.col||'var(--text-main)'}}>{g.val}</div>
                        <div style={{fontSize:'0.65rem',color:'var(--text-dim)',marginTop:'0.15rem'}}>{g.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </>
            );
          })()
        ) : activeTab === 'markets' ? (
          <div>
            {/* -- STOCK DEEP DIVE -- */}
            <div style={{background:'linear-gradient(135deg,#0f172a,#1a2744)',border:'1px solid #1e3a5f',borderRadius:'12px',padding:'1.25rem',marginBottom:'1.5rem'}}>
              <div style={{fontWeight:700,fontSize:'1rem',marginBottom:'0.75rem',color:'#f0f9ff'}}>🔬 Stock Deep Dive</div>
              <p style={{color:'#64748b',fontSize:'0.82rem',marginBottom:'0.75rem'}}>Search any FnO stock to get OI analysis, key levels, PCR and AI strategy in one shot.</p>
              <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
                <input
                  type="text"
                  value={deepDiveSymbol}
                  onChange={e=>setDeepDiveSymbol(e.target.value.toUpperCase())}
                  onKeyDown={e=>{if(e.key==='Enter')runDeepDive(deepDiveSymbol);}}
                  placeholder="e.g. RELIANCE, HDFCBANK, TCS"
                  className="input-field"
                  style={{flex:1,minWidth:'200px',fontSize:'0.9rem',padding:'0.5rem 0.75rem'}}
                />
                <button onClick={()=>runDeepDive(deepDiveSymbol)} disabled={deepDiveLoading||!deepDiveSymbol}
                  style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.5rem 1.25rem',fontWeight:700,cursor:'pointer',fontSize:'0.88rem',whiteSpace:'nowrap'}}>
                  {deepDiveLoading?'Analyzing...':'Analyse'}
                </button>
              </div>
              {/* Quick picks */}
              <div style={{display:'flex',gap:'0.4rem',flexWrap:'wrap',marginTop:'0.75rem'}}>
                {['NIFTY','BANKNIFTY','RELIANCE','TCS','HDFCBANK','ICICIBANK','SBIN','INFY'].map(s=>(
                  <button key={s} onClick={()=>{setDeepDiveSymbol(s);runDeepDive(s);}}
                    style={{background:'rgba(255,255,255,0.06)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:'99px',padding:'2px 10px',fontSize:'0.75rem',cursor:'pointer'}}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Deep Dive Result */}
            {deepDiveLoading && (
              <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>🔬</div>
                <p>Analysing {deepDiveSymbol}...</p>
              </div>
            )}

            {deepDiveData && !deepDiveLoading && (
              <div style={{marginBottom:'1.5rem'}}>
                {/* Company card */}
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1.25rem',marginBottom:'1rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'0.75rem'}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.4rem'}}>
                        <h2 style={{margin:0,fontSize:'1.25rem'}}>{deepDiveData.symbol}</h2>
                        <span style={{background:'#1e293b',color:'#94a3b8',padding:'2px 10px',borderRadius:'99px',fontSize:'0.75rem'}}>{deepDiveData.meta.sector}</span>
                      </div>
                      <div style={{fontSize:'0.88rem',color:'#94a3b8',marginBottom:'0.5rem'}}>{deepDiveData.meta.name}</div>
                      <p style={{color:'var(--text-dim)',fontSize:'0.82rem',maxWidth:'500px',lineHeight:1.5}}>{deepDiveData.meta.desc}</p>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',minWidth:'140px'}}>
                      <div style={{background:'#0f172a',borderRadius:'8px',padding:'0.5rem 0.75rem',textAlign:'center'}}>
                        <div style={{fontSize:'0.7rem',color:'#64748b'}}>LOT SIZE</div>
                        <div style={{fontSize:'1.1rem',fontWeight:700,color:'var(--accent)'}}>{deepDiveData.meta.lot}</div>
                      </div>
                      <div style={{background:'#0f172a',borderRadius:'8px',padding:'0.5rem 0.75rem',textAlign:'center'}}>
                        <div style={{fontSize:'0.7rem',color:'#64748b'}}>PCR</div>
                        <div style={{fontSize:'1.1rem',fontWeight:700,color:deepDiveData.pcrSentiment==='Bullish'?'#4ade80':deepDiveData.pcrSentiment==='Bearish'?'#f87171':'#fbbf24'}}>{deepDiveData.pcr}</div>
                        <div style={{fontSize:'0.7rem',color:'#64748b'}}>{deepDiveData.pcrSentiment}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* OI Grid */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
                  {/* Resistance */}
                  <div style={{background:'var(--bg-card)',border:'1px solid #991b1b',borderRadius:'10px',padding:'1rem'}}>
                    <div style={{fontWeight:700,color:'#f87171',marginBottom:'0.6rem',fontSize:'0.88rem'}}>🔴 Resistance (Top CE OI)</div>
                    {deepDiveData.ceTop.map((row,i)=>(
                      <div key={row.strike} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.35rem 0',borderBottom:'1px solid #1e293b',fontSize:'0.85rem'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
                          {i===0&&<span style={{background:'#991b1b',color:'white',borderRadius:'99px',padding:'0px 6px',fontSize:'0.68rem',fontWeight:700}}>MAX</span>}
                          <span style={{fontWeight:700}}>{row.strike?.toLocaleString()}</span>
                        </div>
                        <span style={{color:'#f87171'}}>{((row.ce?.oi||0)/100000).toFixed(2)} L OI</span>
                        <span style={{color:'#64748b',fontSize:'0.75rem'}}>₹{row.ce?.ltp}</span>
                      </div>
                    ))}
                  </div>
                  {/* Support */}
                  <div style={{background:'var(--bg-card)',border:'1px solid #166534',borderRadius:'10px',padding:'1rem'}}>
                    <div style={{fontWeight:700,color:'#4ade80',marginBottom:'0.6rem',fontSize:'0.88rem'}}>🟢 Support (Top PE OI)</div>
                    {deepDiveData.peTop.map((row,i)=>(
                      <div key={row.strike} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.35rem 0',borderBottom:'1px solid #1e293b',fontSize:'0.85rem'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
                          {i===0&&<span style={{background:'#166534',color:'white',borderRadius:'99px',padding:'0px 6px',fontSize:'0.68rem',fontWeight:700}}>MAX</span>}
                          <span style={{fontWeight:700}}>{row.strike?.toLocaleString()}</span>
                        </div>
                        <span style={{color:'#4ade80'}}>{((row.pe?.oi||0)/100000).toFixed(2)} L OI</span>
                        <span style={{color:'#64748b',fontSize:'0.75rem'}}>₹{row.pe?.ltp}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Strategy */}
                {deepDiveData.strategy ? (
                  <div style={{background:'linear-gradient(135deg,#0a1f0a,#0f2744)',border:'1px solid #1e5f3a',borderRadius:'10px',padding:'1.25rem',marginBottom:'1rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
                      <div style={{fontWeight:700,color:'#4ade80',fontSize:'0.9rem'}}>🤖 AI Strategy Suggestion</div>
                      <div style={{display:'flex',gap:'0.4rem'}}>
                        <span style={{background:'#1e293b',color:deepDiveData.strategy.sentiment==='Bullish'?'#4ade80':deepDiveData.strategy.sentiment==='Bearish'?'#f87171':'#fbbf24',padding:'2px 8px',borderRadius:'99px',fontSize:'0.72rem',fontWeight:600}}>{deepDiveData.strategy.sentiment}</span>
                        <span style={{background:'#1e293b',color:'#94a3b8',padding:'2px 8px',borderRadius:'99px',fontSize:'0.72rem'}}>Risk: {deepDiveData.strategy.risk}</span>
                        <span style={{background:'#1e293b',color:'#94a3b8',padding:'2px 8px',borderRadius:'99px',fontSize:'0.72rem'}}>{deepDiveData.strategy.timeframe}</span>
                      </div>
                    </div>
                    <div style={{fontSize:'1rem',fontWeight:700,color:'#f0f9ff',marginBottom:'0.4rem'}}>{deepDiveData.strategy.strategy}</div>
                    <div style={{fontSize:'0.9rem',color:'var(--accent)',fontWeight:600,marginBottom:'0.4rem'}}>Trade: {deepDiveData.strategy.action}</div>
                    <p style={{color:'#94a3b8',fontSize:'0.84rem',margin:0,lineHeight:1.5}}>{deepDiveData.strategy.reasoning}</p>
                  </div>
                ) : !groqApiKey ? (
                  <div style={{background:'#1a1a00',border:'1px solid #f59e0b',borderRadius:'10px',padding:'1rem',marginBottom:'1rem',fontSize:'0.85rem',color:'#fbbf24'}}>
                    ⚡ Add your Groq API key in ⚙️ Settings to get AI strategy suggestions for this stock.
                  </div>
                ) : null}

                {/* Block & Bulk Deals */}
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                  <div style={{fontWeight:700,marginBottom:'0.5rem',fontSize:'0.88rem'}}>💼 Block & Bulk Deals</div>
                  <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>Institutional trades for {deepDiveData.meta.name}. NSE updates throughout the trading day.</p>
                  <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap'}}>
                    <a href={`https://www.nseindia.com/market-data/block-deal`} target="_blank" rel="noreferrer"
                      style={{background:'var(--accent)',color:'#000',textDecoration:'none',borderRadius:'6px',padding:'0.4rem 0.9rem',fontWeight:700,fontSize:'0.82rem'}}>
                      NSE Block Deals →
                    </a>
                    <a href={`https://www.nseindia.com/market-data/bulk-deal`} target="_blank" rel="noreferrer"
                      style={{background:'#1e293b',color:'#94a3b8',textDecoration:'none',borderRadius:'6px',padding:'0.4rem 0.9rem',fontWeight:600,fontSize:'0.82rem',border:'1px solid var(--border)'}}>
                      NSE Bulk Deals →
                    </a>
                    <a href={`https://www.bseindia.com/markets/equity/EQReports/BulkDeal.aspx`} target="_blank" rel="noreferrer"
                      style={{background:'#1e293b',color:'#94a3b8',textDecoration:'none',borderRadius:'6px',padding:'0.4rem 0.9rem',fontWeight:600,fontSize:'0.82rem',border:'1px solid var(--border)'}}>
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* -- INDICES LIVE OVERVIEW -- */}
            {(()=>{
              // Exact index names from NSE allIndices API (idx.index field)
              const rows = [
                {label:'Nifty 50',        keys:['NIFTY 50'],                        col:'#4ade80'},
                {label:'Bank Nifty',      keys:['NIFTY BANK'],                       col:'#60a5fa'},
                {label:'Fin Nifty',       keys:['NIFTY FINANCIAL SERVICES','NIFTY FIN SERVICE'], col:'#a78bfa'},
                {label:'Midcap Select',   keys:['NIFTY MIDCAP SELECT','NIFTY MID SELECT'],       col:'#fb923c'},
                {label:'Nifty IT',        keys:['NIFTY IT'],                         col:'#34d399'},
                {label:'Nifty Auto',      keys:['NIFTY AUTO'],                       col:'#f472b6'},
                {label:'Nifty Pharma',    keys:['NIFTY PHARMA'],                     col:'#fbbf24'},
                {label:'Nifty Metal',     keys:['NIFTY METAL'],                      col:'#94a3b8'},
                {label:'PSU Bank',        keys:['NIFTY PSU BANK'],                   col:'#38bdf8'},
                {label:'Nifty FMCG',      keys:['NIFTY FMCG'],                       col:'#86efac'},
                {label:'India VIX',       keys:['INDIA VIX'],                        col:'#f87171', isVix:true},
              ];
              return (
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem',marginBottom:'1rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
                    <div style={{fontWeight:700,fontSize:'0.92rem'}}>📊 Live Indices</div>
                    <button onClick={fetchLivePrices} disabled={isPriceLoading}
                      style={{background:'var(--bg-surface)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.25rem 0.75rem',fontSize:'0.75rem',cursor:'pointer',fontWeight:600}}>
                      {isPriceLoading ? '⟳ ...' : '⟳ Refresh'}
                    </button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.5rem'}}>
                    {rows.map(r=>{
                      const price = r.keys.reduce((v,k) => v != null ? v : livePrices[k], null);
                      const chg   = r.keys.reduce((v,k) => v != null ? v : liveChanges[k], null);
                      const pos   = (chg||0) >= 0;
                      const chgCol = pos ? '#4ade80' : '#f87171';
                      const vixCol = price>24?'#f87171':price>20?'#f97316':price>14?'#fbbf24':'#4ade80';
                      const displayCol = r.isVix ? vixCol : chgCol;
                      return (
                        <div key={r.key} style={{background:'var(--bg-surface)',borderRadius:'8px',padding:'0.6rem 0.75rem',border:'1px solid var(--border)'}}>
                          <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginBottom:'0.2rem',fontWeight:600}}>{r.label}</div>
                          <div style={{fontSize:'1rem',fontWeight:800,color:r.isVix?vixCol:chgCol}}>
                            {price ? (r.isVix ? price.toFixed(2) : price.toLocaleString('en-IN')) : '—'}
                          </div>
                          {!r.isVix && chg != null && (
                            <div style={{fontSize:'0.72rem',color:chgCol,fontWeight:600}}>
                              {pos?'▲':'▼'} {Math.abs(chg).toFixed(2)}%
                            </div>
                          )}
                          {r.isVix && price && (
                            <div style={{fontSize:'0.72rem',color:vixCol,fontWeight:600}}>
                              {price>24?'HIGH':price>20?'ELEVATED':price>14?'MODERATE':'LOW'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* -- MARKETS SUB-TABS -- */}
            <div className="home-tabs" style={{marginBottom:'1rem'}}>
              {[
                ['option-chain','⚡ Option Chain'],
                ['candlestick','📊 Chart'],
                ['oi-chart','📈 OI Analysis'],
                ['pcr','⚡ PCR'],
                ['max-pain','🎯 Max Pain'],
                ['fii-dii','🏦 FII/DII'],
                ['global-cues','🌍 Global Cues'],
                ['events','📅 Events'],
              ].map(([tab,label])=>(
                <button key={tab} className={`home-tab-btn ${activeMarketsTab===tab?'active':''}`} onClick={()=>setActiveMarketsTab(tab)}>{label}</button>
              ))}
            </div>

            {/* -- REUSE HOME TAB PANELS with activeMarketsTab -- */}
            {activeMarketsTab === 'option-chain' && (() => {
              // Re-render the Kite-style option chain
              return (
              <div style={{background:'var(--bg-card)',borderRadius:'12px',padding:'1rem',border:'1px solid var(--border)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:'0.75rem'}}>
                    <select value={selectedUnderlying} onChange={e=>{setSelectedUnderlying(e.target.value);setNseExpiryDates([]);setSelectedExpiry('');generateLiveOptionChain(e.target.value);}}
                      style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.3rem 0.5rem',fontWeight:700,fontSize:'0.95rem'}}>
                      <option value="NIFTY">NIFTY 50</option>
                      <option value="BANKNIFTY">BANK NIFTY</option>
                      <option value="FINNIFTY">FIN NIFTY</option>
                      <option value="MIDCPNIFTY">MIDCAP NIFTY</option>
                    </select>
                    <span style={{fontSize:'1.4rem',fontWeight:700,color:'#4ade80'}}>
                      {(selectedUnderlying==='NIFTY'?marketData.nifty.value:selectedUnderlying==='BANKNIFTY'?marketData.bankNifty.value:livePrices[selectedUnderlying==='FINNIFTY'?'NIFTY FINANCIAL SERVICES':'NIFTY MIDCAP SELECT']||marketData.nifty.value)?.toLocaleString()}
                    </span>
                    <span style={{fontSize:'0.85rem',color:((selectedUnderlying==='NIFTY'?marketData.nifty.change:marketData.bankNifty.change)||0)>=0?'#4ade80':'#f87171'}}>
                      {((selectedUnderlying==='NIFTY'?marketData.nifty.change:marketData.bankNifty.change)||0)>=0?'+':''}{selectedUnderlying==='NIFTY'?marketData.nifty.change:marketData.bankNifty.change}%
                    </span>

                  </div>
                  <button onClick={()=>generateLiveOptionChain(selectedUnderlying)} disabled={isLoadingChain}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.35rem 0.9rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                    {isLoadingChain?'Loading...':'Refresh'}
                  </button>
                </div>
                {nseExpiryDates.length>0 && (
                  <div style={{display:'flex',gap:'0',marginBottom:'1rem',borderBottom:'2px solid var(--border)',overflowX:'auto'}}>
                    {nseExpiryDates.slice(0,5).map((exp,i)=>{
                      const daysLeft = Math.round((new Date(exp.replace(/-/g,'/'))-new Date())/(1000*60*60*24));
                      const isSelected = selectedExpiry===exp||(i===0&&!selectedExpiry);
                      return (
                        <button key={exp} onClick={()=>{setSelectedExpiry(exp);if(rawNseData){parseChainForExpiry(rawNseData,exp,selectedUnderlying==='NIFTY'?marketData.nifty.value:marketData.bankNifty.value);}else{generateLiveOptionChain(selectedUnderlying,exp);}}}
                          style={{background:'none',border:'none',borderBottom:isSelected?'2px solid var(--accent)':'2px solid transparent',marginBottom:'-2px',padding:'0.5rem 1rem',cursor:'pointer',whiteSpace:'nowrap',color:isSelected?'var(--accent)':'var(--text-dim)',fontWeight:isSelected?700:400,fontSize:'0.85rem'}}>
                          {exp}
                          <div style={{fontSize:'0.68rem',color:isSelected?'var(--accent)':'#64748b',marginTop:'2px'}}>{daysLeft<=0?'Today':`${daysLeft}D`}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {liveOptionChain.length===0 && isLoadingChain ? (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>⏳ Loading option chain...</div>
                ) : liveOptionChain.length===0 ? (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'2rem',marginBottom:'0.75rem'}}>📡</div>
                    <div style={{fontWeight:700,marginBottom:'0.5rem'}}>Connecting to NSE...</div>
                    <div style={{fontSize:'0.82rem',color:'#64748b',marginBottom:'1.25rem'}}>
                      Fetching live option chain. NSE sometimes needs a moment.<br/>
                      Market hours: 9:15 AM – 3:30 PM IST
                    </div>
                    <button onClick={()=>generateLiveOptionChain(selectedUnderlying)}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.5rem 1.4rem',fontWeight:700,cursor:'pointer',fontSize:'0.88rem'}}>
                      🔄 Try Again
                    </button>
                  </div>
                ) : (
                  <div style={{overflowX:'auto'}}>
                    {/* Column headers */}
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.72rem',minWidth:'900px'}}>
                      <thead>
                        <tr style={{background:'rgba(74,222,128,0.06)'}}>
                          {/* CE side - 7 cols */}
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>OI</th>
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>Chg OI</th>
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>Vol</th>
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>IV%</th>
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>LTP</th>
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>Chg</th>
                          <th style={{padding:'6px 6px',color:'#4ade80',textAlign:'right',fontWeight:700,borderBottom:'2px solid rgba(74,222,128,0.3)'}}>Bid</th>
                          {/* Strike */}
                          <th style={{padding:'6px 8px',color:'#f97316',textAlign:'center',fontWeight:700,borderBottom:'2px solid rgba(249,115,22,0.5)',background:'rgba(249,115,22,0.06)',whiteSpace:'nowrap'}}>STRIKE</th>
                          {/* PE side - 7 cols */}
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>Ask</th>
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>LTP</th>
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>Chg</th>
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>IV%</th>
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>Vol</th>
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>Chg OI</th>
                          <th style={{padding:'6px 6px',color:'#f87171',textAlign:'left',fontWeight:700,borderBottom:'2px solid rgba(248,113,113,0.3)'}}>OI</th>
                        </tr>
                        <tr style={{background:'rgba(255,255,255,0.02)'}}>
                          <td colSpan={7} style={{padding:'2px 6px',fontSize:'0.68rem',color:'#4ade80',textAlign:'center'}}>← CALLS</td>
                          <td style={{padding:'2px 8px',background:'rgba(249,115,22,0.06)'}}/>
                          <td colSpan={7} style={{padding:'2px 6px',fontSize:'0.68rem',color:'#f87171',textAlign:'center'}}>PUTS →</td>
                        </tr>
                      </thead>
                      <tbody>
                        {(()=>{
                          const spot = selectedUnderlying==='NIFTY'?marketData.nifty.value:selectedUnderlying==='BANKNIFTY'?marketData.bankNifty.value:selectedUnderlying==='FINNIFTY'?(livePrices['NIFTY FINANCIAL SERVICES']||marketData.nifty.value):(livePrices['NIFTY MIDCAP SELECT']||marketData.nifty.value)||25500;
                          const gap = selectedUnderlying==='BANKNIFTY'?51:selectedUnderlying==='MIDCPNIFTY'?13:26;
                          const maxOI = Math.max(1,...liveOptionChain.map(r=>Math.max(r.ce?.oi||0,r.pe?.oi||0)));
                          return liveOptionChain.map((row,idx)=>{
                            const isATM = Math.abs(row.strike-spot)<gap;
                            const itmCE = row.strike < spot;
                            const itmPE = row.strike > spot;
                            const ceOI  = row.ce?.oi||0;
                            const peOI  = row.pe?.oi||0;
                            const ceChg = parseFloat(row.ce?.change||0);
                            const peChg = parseFloat(row.pe?.change||0);
                            const ceOIChg = row.ce?.oiChg||0;
                            const peOIChg = row.pe?.oiChg||0;
                            const fmt = (n) => n>=100000?(n/100000).toFixed(1)+'L':n>=1000?(n/1000).toFixed(0)+'K':String(n);
                            const ceBg = itmCE?'rgba(74,222,128,0.05)':'transparent';
                            const peBg = itmPE?'rgba(248,113,113,0.05)':'transparent';
                            const rowBg = isATM?'rgba(249,115,22,0.08)':'transparent';
                            const ceBarW = ((ceOI/maxOI)*100).toFixed(0);
                            const peBarW = ((peOI/maxOI)*100).toFixed(0);
                            return (
                              <tr key={idx} style={{borderBottom:'1px solid rgba(255,255,255,0.03)',background:rowBg}}>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,position:'relative'}}>
                                  <div style={{position:'absolute',right:0,top:0,bottom:0,width:`${ceBarW}%`,background:'rgba(74,222,128,0.08)',pointerEvents:'none'}}/>
                                  <span style={{position:'relative',fontWeight:ceOI>500000?700:400,color:ceOI>500000?'#4ade80':'#94a3b8'}}>{fmt(ceOI)}</span>
                                </td>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,color:ceOIChg>0?'#4ade80':ceOIChg<0?'#f87171':'#64748b',fontSize:'0.7rem'}}>{ceOIChg>0?'+':''}{fmt(ceOIChg)}</td>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,color:'#64748b',fontSize:'0.7rem'}}>{fmt(row.ce?.volume||0)}</td>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,color:'#fbbf24'}}>{row.ce?.iv}</td>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,fontWeight:700,color:'#4ade80',fontSize:'0.82rem'}}>&#8377;{row.ce?.ltp}</td>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,color:ceChg>=0?'#4ade80':'#f87171',fontSize:'0.72rem'}}>{ceChg>=0?'+':''}{row.ce?.pChange}%</td>
                                <td style={{padding:'5px 6px',textAlign:'right',background:ceBg,color:'#64748b',fontSize:'0.72rem'}}>{row.ce?.bid}</td>
                                <td style={{padding:'5px 8px',textAlign:'center',background:'rgba(249,115,22,0.06)',borderLeft:'1px solid rgba(249,115,22,0.2)',borderRight:'1px solid rgba(249,115,22,0.2)'}}>
                                  {isATM
                                    ?<span style={{background:'#f97316',color:'white',borderRadius:'99px',padding:'2px 7px',fontWeight:800,fontSize:'0.78rem',whiteSpace:'nowrap'}}>{row.strike?.toLocaleString()} ATM</span>
                                    :<span style={{fontWeight:600,color:itmCE?'rgba(74,222,128,0.8)':itmPE?'rgba(248,113,113,0.8)':'var(--text-dim)',fontSize:'0.8rem'}}>{row.strike?.toLocaleString()}</span>
                                  }
                                </td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,color:'#64748b',fontSize:'0.72rem'}}>{row.pe?.ask}</td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,fontWeight:700,color:'#f87171',fontSize:'0.82rem'}}>&#8377;{row.pe?.ltp}</td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,color:peChg>=0?'#4ade80':'#f87171',fontSize:'0.72rem'}}>{peChg>=0?'+':''}{row.pe?.pChange}%</td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,color:'#fbbf24'}}>{row.pe?.iv}</td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,color:'#64748b',fontSize:'0.7rem'}}>{fmt(row.pe?.volume||0)}</td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,color:peOIChg>0?'#4ade80':peOIChg<0?'#f87171':'#64748b',fontSize:'0.7rem'}}>{peOIChg>0?'+':''}{fmt(peOIChg)}</td>
                                <td style={{padding:'5px 6px',textAlign:'left',background:peBg,position:'relative'}}>
                                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${peBarW}%`,background:'rgba(248,113,113,0.08)',pointerEvents:'none'}}/>
                                  <span style={{position:'relative',fontWeight:peOI>500000?700:400,color:peOI>500000?'#f87171':'#94a3b8'}}>{fmt(peOI)}</span>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                    {/* Legend */}
                    <div style={{display:'flex',gap:'1.5rem',padding:'0.6rem 0.5rem',fontSize:'0.7rem',color:'var(--text-muted)',flexWrap:'wrap',borderTop:'1px solid var(--border)',marginTop:'4px'}}>
                      <span>🟩 ITM Call &nbsp; 🟥 ITM Put &nbsp; 🟠 ATM ★</span>
                      <span>OI bars show relative size &nbsp; | &nbsp; Bold OI = high open interest</span>
                      <span>Chg OI = change in OI from prev close</span>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}

            {activeMarketsTab === 'pcr' && activeHomeTab !== 'pcr' && (() => {
              // NIFTY 50 from liveOptionChain (already loaded)
              const niftyCeOI = liveOptionChain.reduce((s,r)=>s+(r.ce?.oi||0),0);
              const niftyPeOI = liveOptionChain.reduce((s,r)=>s+(r.pe?.oi||0),0);
              const niftyPcr  = niftyCeOI>0?(niftyPeOI/niftyCeOI).toFixed(2):'-';

              const indices = [
                {sym:'NIFTY',      label:'Nifty 50',          ceOI:niftyCeOI, peOI:niftyPeOI, pcr:niftyPcr, spot:marketData.nifty?.value},
                {sym:'BANKNIFTY',  label:'Bank Nifty',        ceOI:0, peOI:0, pcr:'-', spot:marketData.bankNifty?.value},
                {sym:'FINNIFTY',   label:'Fin Nifty',         ceOI:0, peOI:0, pcr:'-', spot:livePrices['Nifty Financial Services']},
                {sym:'MIDCPNIFTY', label:'Midcap Nifty',      ceOI:0, peOI:0, pcr:'-', spot:livePrices['Nifty Midcap 50']},
              ];

              // State for multi-index PCR (declared at component level)
              const fetchAllPcr = async () => {
                setIndicesPcrLoading(true);
                const results = {};
                for (const idx of indices.slice(1)) { // NIFTY already loaded
                  try {
                    const r = await fetch(`${BACKEND_URL}/api/option-chain?symbol=${idx.sym}`);
                    const j = await r.json();
                    if (j?.records?.data?.length) {
                      let ce=0, pe=0;
                      j.records.data.forEach(row => { ce+=row.CE?.openInterest||0; pe+=row.PE?.openInterest||0; });
                      results[idx.sym] = { pcr: ce>0?(pe/ce).toFixed(2):'-', ceOI:ce, peOI:pe, spot:j.records.underlyingValue };
                    }
                  } catch(e) {}
                }
                setIndicesPcr(results);
                setIndicesPcrLoading(false);
              };

              return (
                <div className="panel">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
                    <h2 style={{margin:0}}>⚡ Put/Call Ratio — All Indices</h2>
                    <button onClick={fetchAllPcr} disabled={indicesPcrLoading}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                      {indicesPcrLoading ? '⏳ Loading...' : '🔄 Load All'}
                    </button>
                  </div>
                  <p style={{color:'var(--text-dim)',fontSize:'0.82rem',marginBottom:'1rem'}}>PCR &gt; 1.2 = more puts = bullish sentiment. PCR &lt; 0.8 = more calls = bearish sentiment.</p>

                  {/* PCR Zone Prediction */}
                  {(() => {
                    const pcrVal = parseFloat(niftyPcr);
                    if (isNaN(pcrVal)) return null;
                    let zone, zoneColor, zoneBg, zoneIcon, zoneDesc;
                    if (pcrVal <= 0.70) {
                      zone = 'OVERSOLD ZONE'; zoneIcon = '🔴';
                      zoneColor = '#f87171'; zoneBg = 'rgba(248,113,113,0.08)';
                      zoneDesc = 'Extreme call buying — market is oversold. Contrarian signal: possible bounce. Watch for reversal.';
                    } else if (pcrVal <= 1.20) {
                      zone = 'NEUTRAL ZONE'; zoneIcon = '🟡';
                      zoneColor = '#fbbf24'; zoneBg = 'rgba(251,191,36,0.08)';
                      zoneDesc = 'Balanced put/call activity. No strong directional bias. Range-bound movement likely.';
                    } else {
                      zone = 'OVERBOUGHT ZONE'; zoneIcon = '🟢';
                      zoneColor = '#4ade80'; zoneBg = 'rgba(74,222,128,0.08)';
                      zoneDesc = 'Extreme put buying — market is overbought. Bulls in control. Watch for exhaustion near resistance.';
                    }
                    return (
                      <div style={{background:zoneBg,border:`1px solid ${zoneColor}44`,borderRadius:'12px',padding:'1rem 1.25rem',marginBottom:'1.25rem',display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
                        <div style={{textAlign:'center',minWidth:'80px'}}>
                          <div style={{fontSize:'2rem'}}>{zoneIcon}</div>
                          <div style={{fontSize:'0.68rem',fontWeight:800,color:zoneColor,textTransform:'uppercase',letterSpacing:'0.06em',marginTop:'0.2rem'}}>{zone}</div>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{display:'flex',gap:'1.5rem',marginBottom:'0.4rem',flexWrap:'wrap'}}>
                            <div><span style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>NIFTY PCR</span><br/><span style={{fontSize:'1.8rem',fontWeight:900,color:zoneColor}}>{niftyPcr}</span></div>
                            <div style={{fontSize:'0.75rem',color:'var(--text-dim)',lineHeight:1.6,alignSelf:'center'}}>
                              <div>🔴 <b>0.30–0.70</b> → Oversold Zone (Bearish PCR)</div>
                              <div>🟡 <b>0.80–1.20</b> → Neutral Zone</div>
                              <div>🟢 <b>1.30–1.95</b> → Overbought Zone (Bullish PCR)</div>
                            </div>
                          </div>
                          <div style={{fontSize:'0.8rem',color:'var(--text-dim)',lineHeight:1.5}}>{zoneDesc}</div>
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:'0.75rem'}}>
                    {indices.map(idx => {
                      const data = idx.sym === 'NIFTY' ? idx : (indicesPcr[idx.sym] || idx);
                      const pcr = data.pcr;
                      const bull = parseFloat(pcr) > 1.2;
                      const bear = parseFloat(pcr) < 0.8;
                      const clr  = pcr==='-'?'var(--text-muted)':bull?'#4ade80':bear?'#f87171':'#fbbf24';
                      const lbl  = pcr==='-'?'Click Load All':bull?'BULLISH':bear?'BEARISH':'NEUTRAL';
                      return (
                        <div key={idx.sym} style={{background:'var(--bg-dark)',borderRadius:'10px',padding:'1rem',border:`1px solid ${clr==='var(--text-muted)'?'var(--border)':clr+'33'}`}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.5rem'}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)'}}>{idx.label}</div>
                              <div style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>{data.spot ? data.spot.toLocaleString('en-IN') : '—'}</div>
                            </div>
                            <span style={{fontSize:'0.72rem',fontWeight:700,padding:'2px 8px',borderRadius:'99px',background:clr==='var(--text-muted)'?'rgba(255,255,255,0.05)':clr+'22',color:clr}}>{lbl}</span>
                          </div>
                          <div style={{fontSize:'2.5rem',fontWeight:900,color:clr,lineHeight:1}}>{pcr}</div>
                          {data.ceOI>0 && <div style={{fontSize:'0.7rem',color:'var(--text-muted)',marginTop:'0.4rem'}}>
                            CE OI: {(data.ceOI/100000).toFixed(1)}L &nbsp;|&nbsp; PE OI: {(data.peOI/100000).toFixed(1)}L
                          </div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {activeMarketsTab === 'max-pain' && (
              <div className="panel">
                <h2>🎯 Max Pain</h2>
                <p style={{color:'var(--text-dim)',marginBottom:'1.5rem'}}>The strike where option writers lose the least money. Market tends to gravitate here near expiry.</p>
                <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
                  <div style={{fontSize:'0.85rem',color:'var(--text-dim)'}}>Max Pain Strike</div>
                  <div style={{fontSize:'3rem',fontWeight:900,color:'#f59e0b'}}>{maxPainData.maxPain?.toLocaleString()}</div>
                  <div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>Current Spot: {maxPainData.currentSpot?.toLocaleString()}  |  Distance: {Math.abs((maxPainData.currentSpot||0)-(maxPainData.maxPain||0))} pts</div>
                </div>
              </div>
            )}

            {activeMarketsTab === 'fii-dii' && (
              <div className="panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div>
                    <h2 style={{margin:0}}>🏦 FII / DII Activity</h2>
                    <p style={{color:'var(--text-dim)',margin:'0.25rem 0 0',fontSize:'0.82rem'}}>
                      NSE end-of-day data · Net flows in ₹ Crores
                      {institutionalActivity?.stale && <span style={{color:'#f59e0b',marginLeft:'0.5rem'}}>· Cached</span>}
                    </p>
                  </div>
                  <button onClick={fetchFiiDii} disabled={fiiDiiLoading}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                    {fiiDiiLoading ? '⏳ Loading...' : '🔄 Refresh'}
                  </button>
                </div>

                {/* Latest day summary */}
                {institutionalActivity && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0.75rem',marginBottom:'1.25rem'}}>
                    {[
                      {label:'FII Net', val:institutionalActivity.fii?.net, color:institutionalActivity.fii?.net>=0?'#4ade80':'#f87171'},
                      {label:'DII Net', val:institutionalActivity.dii?.net, color:institutionalActivity.dii?.net>=0?'#60a5fa':'#f87171'},
                      {label:'Total Net', val:(institutionalActivity.fii?.net||0)+(institutionalActivity.dii?.net||0),
                        color:((institutionalActivity.fii?.net||0)+(institutionalActivity.dii?.net||0))>=0?'#4ade80':'#f87171'},
                    ].map((item,i)=>(
                      <div key={i} style={{background:'var(--bg-dark)',borderRadius:'8px',padding:'0.75rem',textAlign:'center',border:'1px solid var(--border)'}}>
                        <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'0.25rem',textTransform:'uppercase',letterSpacing:'0.06em'}}>{item.label}</div>
                        <div style={{fontSize:'1.1rem',fontWeight:800,color:item.color}}>
                          {item.val >= 0 ? '+' : ''}{(item.val||0).toFixed(0)} Cr
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {fiiDiiError && !institutionalActivity && <div style={{color:'#f87171',fontSize:'0.82rem',marginBottom:'1rem'}}>{fiiDiiError}</div>}

                {fiiDiiData.length > 0 ? (
                  <div>
                    <div style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr 1fr',gap:'0.5rem',padding:'0.4rem 0',borderBottom:'1px solid var(--border)',fontSize:'0.72rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                      <span>Date</span><span>FII Net</span><span>DII Net</span><span>Combined</span>
                    </div>
                    {fiiDiiData.slice(0,10).map((row,i)=>(
                      <div key={i} style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr 1fr',gap:'0.5rem',padding:'0.5rem 0',borderBottom:'1px solid var(--border)',fontSize:'0.85rem',alignItems:'center'}}>
                        <span style={{color:'var(--text-dim)',fontSize:'0.78rem'}}>{row.date}</span>
                        <span style={{color:row.fii>=0?'#4ade80':'#f87171',fontWeight:600}}>{row.fii>=0?'+':''}{(row.fii||0).toFixed(0)} Cr</span>
                        <span style={{color:row.dii>=0?'#60a5fa':'#f87171',fontWeight:600}}>{row.dii>=0?'+':''}{(row.dii||0).toFixed(0)} Cr</span>
                        <span style={{color:((row.fii||0)+(row.dii||0))>=0?'#4ade80':'#f87171',fontWeight:700}}>
                          {((row.fii||0)+(row.dii||0))>=0?'+':''}{((row.fii||0)+(row.dii||0)).toFixed(0)} Cr
                        </span>
                      </div>
                    ))}
                  </div>
                ) : !fiiDiiLoading && (
                  <div style={{textAlign:'center',padding:'2.5rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'2rem',marginBottom:'0.75rem'}}>🏦</div>
                    <div style={{marginBottom:'1rem',fontSize:'0.88rem'}}>Click Refresh to load NSE FII/DII data</div>
                    <button onClick={fetchFiiDii}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.5rem',fontWeight:700,cursor:'pointer'}}>
                      Load FII/DII Data
                    </button>
                  </div>
                )}
                {fiiDiiLoading && (
                  <div style={{textAlign:'center',padding:'2rem',color:'var(--text-dim)'}}>⏳ Fetching from NSE...</div>
                )}

                {/* FII Analysis & Prediction Engine */}
                {(() => {
                  const fii = institutionalActivity?.fii;
                  if (!fii) return null;

                  // Determine FII equity direction
                  const equityBull = (fii.net || 0) >= 0;

                  // For futures & options we use net values if available
                  // fii.futures and fii.options are set from NSE data where available
                  // fallback: derive from equity direction + context
                  const futNet = fii.futures ?? fii.net ?? 0;
                  const optNet = fii.options ?? 0;

                  const futBull = futNet >= 0;
                  const optBull = optNet >= 0;

                  // FII prediction matrix
                  let prediction = '', predIcon = '', predColor = '', predBg = '', predDesc = '';
                  if (equityBull && futBull && optBull) {
                    prediction='SUPER BULLISH'; predIcon='🚀'; predColor='#4ade80'; predBg='rgba(74,222,128,0.08)';
                    predDesc='FII buying across Equity, Futures & Options. Strongest bullish signal possible.';
                  } else if (equityBull && futBull && !optBull) {
                    prediction='BULLISH'; predIcon='📈'; predColor='#86efac'; predBg='rgba(74,222,128,0.06)';
                    predDesc='FII buying equity & futures but selling options (hedging upside). Broadly bullish.';
                  } else if (equityBull && !futBull && !optBull) {
                    prediction='SIDEWAYS'; predIcon='➡️'; predColor='#fbbf24'; predBg='rgba(251,191,36,0.06)';
                    predDesc='FII buying equity but selling derivatives. Cautious accumulation, no directional conviction.';
                  } else if (!equityBull && !futBull && optBull) {
                    prediction='BEARISH'; predIcon='📉'; predColor='#fca5a5'; predBg='rgba(248,113,113,0.06)';
                    predDesc='FII selling equity & futures but buying options (put protection). Bearish with hedging.';
                  } else if (!equityBull && !futBull && !optBull) {
                    prediction='SUPER BEARISH'; predIcon='🔻'; predColor='#f87171'; predBg='rgba(248,113,113,0.10)';
                    predDesc='FII selling across all segments. Strongest bearish signal — avoid longs.';
                  } else if (!equityBull && futBull && optBull) {
                    prediction='PROFIT BOOKING'; predIcon='💰'; predColor='#fb923c'; predBg='rgba(249,115,22,0.07)';
                    predDesc='FII selling equity but buying derivatives. Likely profit booking while maintaining derivative exposure.';
                  } else if (!equityBull && futBull && !optBull) {
                    prediction='BOTTOM OUT'; predIcon='🔄'; predColor='#a78bfa'; predBg='rgba(167,139,250,0.08)';
                    predDesc='FII selling equity but buying futures — possible bottoming out. Watch for reversal signal.';
                  } else {
                    prediction='MIXED'; predIcon='⚖️'; predColor='#94a3b8'; predBg='rgba(148,163,184,0.06)';
                    predDesc='Mixed FII signals across segments. Wait for clarity before taking directional trades.';
                  }

                  // Long/Short analysis
                  const fiiLong  = (fii.net || 0) > 0;
                  const callLong = optNet > 0;
                  const putLong  = optNet < 0;

                  return (
                    <div style={{marginTop:'1.5rem'}}>
                      {/* Prediction Banner */}
                      <div style={{background:predBg,border:`2px solid ${predColor}44`,borderRadius:'14px',padding:'1.25rem',marginBottom:'1.25rem'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
                          <div style={{textAlign:'center',minWidth:'70px'}}>
                            <div style={{fontSize:'2.2rem'}}>{predIcon}</div>
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:'0.72rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'0.2rem'}}>FII Prediction</div>
                            <div style={{fontSize:'1.5rem',fontWeight:900,color:predColor,marginBottom:'0.3rem'}}>{prediction}</div>
                            <div style={{fontSize:'0.82rem',color:'var(--text-dim)',lineHeight:1.5}}>{predDesc}</div>
                          </div>
                        </div>
                      </div>



                      {/* FII Long/Short Interpretation */}
                      <div style={{background:'var(--bg-dark)',borderRadius:'10px',padding:'1rem',marginBottom:'1rem',border:'1px solid var(--border)'}}>
                        <div style={{fontWeight:700,fontSize:'0.85rem',marginBottom:'0.75rem',color:'var(--text-main)'}}>📊 FII Position Interpretation</div>
                        <div style={{display:'grid',gap:'0.5rem'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'0.5rem',fontSize:'0.82rem'}}>
                            <span style={{color:fiiLong?'#4ade80':'#f87171',fontWeight:700,minWidth:'70px'}}>{fiiLong?'LONG':'SHORT'}</span>
                            <span style={{color:'var(--text-dim)'}}>FII are {fiiLong?'Bullish':'Bearish'} in Current Equity Segment</span>
                          </div>
                          <div style={{display:'flex',alignItems:'center',gap:'0.5rem',fontSize:'0.82rem'}}>
                            <span style={{color:callLong?'#4ade80':'#94a3b8',fontWeight:700,minWidth:'70px'}}>{callLong?'CALL LONG':'—'}</span>
                            {callLong && <span style={{color:'var(--text-dim)'}}>Call Buying & Put Selling → Bullish Options Positioning</span>}
                            {!callLong && putLong && <span style={{color:'#f87171',fontWeight:700,minWidth:'70px'}}>PUT LONG</span>}
                            {putLong && <span style={{color:'var(--text-dim)'}}>Put Buying & Call Selling → Bearish Options Positioning</span>}
                            {!callLong && !putLong && <span style={{color:'var(--text-dim)'}}>No significant options positioning</span>}
                          </div>
                        </div>
                      </div>


                    </div>
                  );
                })()}

              </div>
            )}

            {activeMarketsTab === 'global-cues' && (
              <div className="panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div>
                    <h2 style={{margin:0}}>🌍 Global Cues</h2>
                    <p style={{color:'var(--text-dim)',margin:'0.25rem 0 0',fontSize:'0.82rem'}}>Overnight global markets → Indian open prediction</p>
                  </div>
                  <button onClick={()=>{ setGlobalCues(null); setGlobalCuesLoading(true); fetch(`${BACKEND_URL}/api/global-cues`).then(r=>r.json()).then(j=>{if(j.ok)setGlobalCues(j);}).catch(()=>{}).finally(()=>setGlobalCuesLoading(false)); }}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                    {globalCuesLoading ? '⏳ Loading...' : '🔄 Refresh'}
                  </button>
                </div>

                {globalCuesLoading && <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>⏳ Fetching global markets...</div>}

                {globalCues && (() => {
                  const { data, prediction, predictionColor, gapEst, alerts } = globalCues;
                  const predClr = predictionColor === 'bullish' ? '#4ade80' : predictionColor === 'bearish' ? '#f87171' : '#fbbf24';
                  const predIcon = predictionColor === 'bullish' ? '📈' : predictionColor === 'bearish' ? '📉' : '➡️';

                  const categories = [
                    { id:'us',          label:'🇺🇸 US Markets' },
                    { id:'asia',        label:'🌏 Asia Pacific' },
                    { id:'europe',      label:'🇪🇺 Europe' },
                    { id:'commodities', label:'🛢️ Commodities' },
                    { id:'fx',          label:'💱 FX / Currency' },
                    { id:'bonds',       label:'🏦 Bonds' },
                  ];

                  return (
                    <>
                      {/* Prediction Banner */}
                      <div style={{background:`${predClr}11`,border:`2px solid ${predClr}44`,borderRadius:'14px',padding:'1.25rem 1.5rem',marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:'1.25rem',flexWrap:'wrap'}}>
                        <div style={{fontSize:'2.5rem'}}>{predIcon}</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:'0.72rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'0.2rem'}}>Indian Market Open Prediction</div>
                          <div style={{fontSize:'1.6rem',fontWeight:900,color:predClr,lineHeight:1}}>{prediction}</div>
                          <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginTop:'0.3rem'}}>Estimated gap: <strong style={{color:predClr}}>{gapEst}</strong></div>
                        </div>
                        <div style={{fontSize:'0.75rem',color:'var(--text-muted)',textAlign:'right'}}>
                          Updated<br/>{new Date(globalCues.fetchedAt).toLocaleTimeString('en-IN')}
                        </div>
                      </div>

                      {/* Alerts */}
                      {alerts && alerts.length > 0 && (
                        <div style={{marginBottom:'1.25rem',display:'flex',flexDirection:'column',gap:'0.5rem'}}>
                          {alerts.map((a,i) => (
                            <div key={i} style={{
                              padding:'0.65rem 1rem',borderRadius:'9px',fontSize:'0.82rem',lineHeight:1.5,
                              background: a.type==='danger'?'rgba(248,113,113,0.08)':a.type==='warning'?'rgba(251,191,36,0.08)':'rgba(96,165,250,0.08)',
                              border: `1px solid ${a.type==='danger'?'rgba(248,113,113,0.25)':a.type==='warning'?'rgba(251,191,36,0.25)':'rgba(96,165,250,0.25)'}`,
                              color: a.type==='danger'?'#f87171':a.type==='warning'?'#fbbf24':'#60a5fa',
                            }}>
                              {a.type==='danger'?'🚨':a.type==='warning'?'⚠️':'ℹ️'} {a.msg}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Market Cards by Category */}
                      {categories.map(cat => {
                        const items = Object.values(data).filter(d => d.category === cat.id && !d.error);
                        if (!items.length) return null;
                        return (
                          <div key={cat.id} style={{marginBottom:'1.25rem'}}>
                            <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'0.6rem'}}>{cat.label}</div>
                            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.6rem'}}>
                              {items.map((item,i) => {
                                const up = item.changePct >= 0;
                                const clr = item.changePct > 0 ? '#4ade80' : item.changePct < 0 ? '#f87171' : '#fbbf24';
                                return (
                                  <div key={i} style={{background:'var(--bg-dark)',borderRadius:'10px',padding:'0.75rem',border:`1px solid ${clr}22`}}>
                                    <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'0.3rem'}}>{item.label}</div>
                                    <div style={{fontSize:'1.1rem',fontWeight:800,color:'var(--text-main)'}}>{item.price?.toLocaleString('en-IN')}</div>
                                    <div style={{fontSize:'0.75rem',fontWeight:700,color:clr,marginTop:'0.2rem'}}>
                                      {up?'▲':'▼'} {Math.abs(item.change).toFixed(2)} ({Math.abs(item.changePct).toFixed(2)}%)
                                    </div>
                                    {item.marketState && item.marketState !== 'REGULAR' && (
                                      <div style={{fontSize:'0.62rem',color:'var(--text-muted)',marginTop:'0.2rem',textTransform:'uppercase'}}>{item.marketState}</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Disclaimer */}
                      <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'0.5rem',borderTop:'1px solid var(--border)',paddingTop:'0.75rem'}}>
                        ⚡ Data from Yahoo Finance · Prediction is algorithmic, not financial advice · Refresh before 9:15 AM for best accuracy
                      </div>
                    </>
                  );
                })()}

                {!globalCues && !globalCuesLoading && (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>🌍</div>
                    <div style={{marginBottom:'1rem',fontSize:'0.88rem'}}>Click Refresh to load global market data</div>
                    <button onClick={()=>{ setGlobalCuesLoading(true); fetch(`${BACKEND_URL}/api/global-cues`).then(r=>r.json()).then(j=>{if(j.ok)setGlobalCues(j);}).catch(()=>{}).finally(()=>setGlobalCuesLoading(false)); }}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.5rem',fontWeight:700,cursor:'pointer'}}>
                      Load Global Cues
                    </button>
                  </div>
                )}
              </div>
            )}

                        {activeMarketsTab === 'events' && (
              <div className="panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div>
                    <h2 style={{margin:0}}>📅 Market Events</h2>
                    <p style={{color:'var(--text-dim)',margin:'0.25rem 0 0',fontSize:'0.82rem'}}>F&O expiries · Nifty 50 results · RBI &amp; global macro — next 45 days</p>
                  </div>
                  <button onClick={fetchEvents} disabled={eventsLoading}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                    {eventsLoading ? '⏳ Loading...' : '🔄 Refresh'}
                  </button>
                </div>

                {eventsError && events.length === 0 && <div style={{color:'#f87171',fontSize:'0.82rem',marginBottom:'1rem'}}>{eventsError}</div>}

                {eventsLoading && (
                  <div style={{textAlign:'center',padding:'2rem',color:'var(--text-dim)'}}>⏳ Fetching events...</div>
                )}

                {!eventsLoading && events.length > 0 && (
                  <div>
                    {events.map((ev,i)=>{
                      const isMacro = ev.category === 'macro' || ev.type === 'expiry' || ev.type === 'rbi';
                      const typeIcon = ev.type === 'expiry' ? '⏰'
                        : ev.type === 'rbi' ? '🏦'
                        : ev.type === 'fed' ? '🇺🇸'
                        : ev.type === 'gdp' ? '📈'
                        : ev.type === 'inflation' ? '💹'
                        : ev.type === 'jobs' ? '👷'
                        : ev.type === 'pmi' ? '🏭'
                        : ev.type === 'earnings' ? '📊'
                        : ev.type === 'dividend' ? '💰'
                        : '📌';
                      return (
                        <div key={i} style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.65rem 0.9rem',marginBottom:'0.4rem',background:'var(--bg-dark)',borderRadius:'8px',border:`1px solid ${isMacro ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`}}>
                          <div style={{fontSize:'1.1rem',flexShrink:0}}>{typeIcon}</div>
                          <div style={{minWidth:'90px',fontSize:'0.75rem',color:'var(--text-dim)',fontFamily:'monospace',flexShrink:0}}>{ev.date}</div>
                          {ev.company
                            ? <div style={{minWidth:'90px',fontSize:'0.8rem',fontWeight:700,color:'var(--accent)',flexShrink:0}}>{ev.company}</div>
                            : <div style={{minWidth:'70px',fontSize:'0.68rem',fontWeight:700,color:'#818cf8',background:'rgba(99,102,241,0.12)',borderRadius:'4px',padding:'0.15rem 0.4rem',textAlign:'center',flexShrink:0}}>{(ev.currency||'MACRO')}</div>
                          }
                          <div style={{flex:1,fontWeight:600,fontSize:'0.85rem',minWidth:0}}>
                            {ev.title}
                            {(ev.forecast||ev.previous) && (
                              <span style={{fontSize:'0.72rem',color:'var(--text-dim)',marginLeft:'0.5rem'}}>
                                {ev.forecast && `F: ${ev.forecast}`}{ev.forecast && ev.previous && '  '}{ev.previous && `P: ${ev.previous}`}
                              </span>
                            )}
                          </div>
                          <span style={{padding:'0.15rem 0.5rem',borderRadius:'4px',fontSize:'0.7rem',fontWeight:700,flexShrink:0,
                            background:ev.impact==='high'?'rgba(239,68,68,0.15)':'rgba(251,191,36,0.12)',
                            color:ev.impact==='high'?'#f87171':'#fbbf24'}}>
                            {(ev.impact||'').toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!eventsLoading && events.length === 0 && (
                  <div style={{textAlign:'center',padding:'2.5rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'2rem',marginBottom:'0.75rem'}}>📅</div>
                    <div style={{marginBottom:'1rem',fontSize:'0.88rem'}}>Click Refresh to load upcoming events</div>
                    <button onClick={fetchEvents}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.5rem',fontWeight:700,cursor:'pointer'}}>
                      Load Events
                    </button>
                  </div>
                )}
              </div>
            )}


            {activeMarketsTab === 'candlestick' && (() => {
              const TF_GROUPS = [
                { label:'Intraday', tfs:['1m','3m','5m','15m','30m'] },
                { label:'Swing',    tfs:['1H','4H','1D'] },
                { label:'Long',     tfs:['1W','1M'] },
              ];
              const TF_LABELS = {'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1H':'1H','4H':'4H','1D':'1D','1W':'1W','1M':'1M'};
              const CANDLE_TYPES = [
                {v:'candlestick', l:'🕯 Candle'},
                {v:'heikinashi',  l:'🕯 Heikin-Ashi'},
                {v:'bar',         l:'▣ Bar'},
                {v:'line',        l:'📈 Line'},
                {v:'area',        l:'🏔 Area'},
                {v:'baseline',    l:'⚖ Baseline'},
              ];
              const INDICATOR_GROUPS = [
                { label:'Moving Averages', items:[
                  {v:'EMA9',   l:'EMA 9',   col:'#a3e635'},
                  {v:'EMA20',  l:'EMA 20',  col:'#818cf8'},
                  {v:'EMA50',  l:'EMA 50',  col:'#c084fc'},
                  {v:'SMA20',  l:'SMA 20',  col:'#f59e0b'},
                  {v:'SMA50',  l:'SMA 50',  col:'#fb923c'},
                  {v:'SMA200', l:'SMA 200', col:'#f43f5e'},
                  {v:'WMA',    l:'WMA 20',  col:'#34d399'},
                ]},
                { label:'Bands & Channels', items:[
                  {v:'BB',         l:'Bollinger Bands', col:'#60a5fa'},
                  {v:'VWAP',       l:'VWAP',            col:'#e879f9'},
                  {v:'Ichimoku',   l:'Ichimoku Cloud',  col:'#94a3b8'},
                  {v:'SuperTrend', l:'SuperTrend',      col:'#4ade80'},
                ]},
                { label:'Oscillators', items:[
                  {v:'RSI',  l:'RSI 14',       col:'#a78bfa'},
                  {v:'MACD', l:'MACD 12,26,9', col:'#60a5fa'},
                ]},
              ];
              const toggleIndicator = (v) => setChartIndicators(prev =>
                prev.includes(v) ? prev.filter(x=>x!==v) : [...prev, v]
              );
              const ctrlBtn = (active) => ({
                padding:'0.28rem 0.65rem', borderRadius:'6px', border:'none', cursor:'pointer',
                fontSize:'0.75rem', fontWeight: active?700:400,
                background: active?'var(--accent)':'var(--bg-surface)',
                color: active?'#000':'var(--text-dim)',
              });
              const indBtn = (v, col) => {
                const active = chartIndicators.includes(v);
                return {
                  padding:'0.25rem 0.6rem', borderRadius:'99px', border:`1px solid ${active?col:'var(--border)'}`,
                  cursor:'pointer', fontSize:'0.72rem', fontWeight: active?700:400,
                  background: active?`${col}22`:'transparent',
                  color: active?col:'var(--text-dim)',
                };
              };
              return (
              <div style={{background:'var(--bg-card)',borderRadius:'12px',border:'1px solid var(--border)',overflow:'hidden'}}>

                {/* -- Row 1: Symbol + Candle type + Refresh -- */}
                <div style={{display:'flex',gap:'0.5rem',alignItems:'center',padding:'0.75rem 1rem',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
                  <select value={selectedChartSymbol}
                    onChange={e=>{setSelectedChartSymbol(e.target.value);generateCandlestickData(e.target.value,chartTimeframe);}}
                    style={{background:'var(--bg-surface)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.3rem 0.6rem',fontWeight:700,fontSize:'0.85rem'}}>
                    {['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY',
                      'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','BAJFINANCE',
                      'ITC','WIPRO','AXISBANK','TATAMOTORS','HCLTECH','LT','KOTAKBANK',
                      'MARUTI','SUNPHARMA','ADANIENT','TITAN','NESTLEIND','POWERGRID',
                      'NTPC','ONGC','TATASTEEL','JSWSTEEL','HINDALCO','DRREDDY'].map(s=>
                      <option key={s}>{s}</option>
                    )}
                  </select>
                  <div style={{display:'flex',gap:'0.25rem',flexWrap:'wrap'}}>
                    {CANDLE_TYPES.map(({v,l})=>(
                      <button key={v} onClick={()=>setCandlestickType(v)} style={ctrlBtn(candlestickType===v)}>{l}</button>
                    ))}
                  </div>
                  <button onClick={()=>generateCandlestickData(selectedChartSymbol,chartTimeframe)}
                    style={{marginLeft:'auto',background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-dim)',borderRadius:'6px',padding:'0.28rem 0.75rem',cursor:'pointer',fontSize:'0.78rem'}}>
                    🔄 Refresh
                  </button>
                </div>

                {/* -- Row 2: Timeframes grouped -- */}
                <div style={{display:'flex',gap:'0.75rem',alignItems:'center',padding:'0.5rem 1rem',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
                  {TF_GROUPS.map(({label,tfs})=>(
                    <div key={label} style={{display:'flex',alignItems:'center',gap:'0.25rem'}}>
                      <span style={{fontSize:'0.65rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',marginRight:'2px'}}>{label}</span>
                      {tfs.map(tf=>(
                        <button key={tf} onClick={()=>{setChartTimeframe(tf);generateCandlestickData(selectedChartSymbol,tf);}}
                          style={ctrlBtn(chartTimeframe===tf)}>
                          {TF_LABELS[tf]}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

                {/* -- Row 3: Indicators -- */}
                <div style={{padding:'0.5rem 1rem',borderBottom:'1px solid var(--border)',background:'var(--bg-surface)'}}>
                  <div style={{display:'flex',gap:'1rem',flexWrap:'wrap',alignItems:'flex-start'}}>
                    {INDICATOR_GROUPS.map(({label,items})=>(
                      <div key={label} style={{display:'flex',alignItems:'center',gap:'0.3rem',flexWrap:'wrap'}}>
                        <span style={{fontSize:'0.62rem',color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',whiteSpace:'nowrap'}}>{label}:</span>
                        {items.map(({v,l,col})=>(
                          <button key={v} onClick={()=>toggleIndicator(v)} style={indBtn(v,col)}>{l}</button>
                        ))}
                      </div>
                    ))}
                    {chartIndicators.length > 0 && (
                      <button onClick={()=>setChartIndicators([])}
                        style={{marginLeft:'auto',fontSize:'0.7rem',color:'var(--text-muted)',background:'none',border:'none',cursor:'pointer',padding:'0.2rem 0.4rem'}}>
                        ✕ Clear all
                      </button>
                    )}
                    <button onClick={()=>setShowChartLevels(p=>!p)}
                      style={{marginLeft: chartIndicators.length > 0 ? '0.5rem' : 'auto', padding:'0.25rem 0.7rem',borderRadius:'99px',border:`1px solid ${showChartLevels?'#f59e0b':'var(--border)'}`,cursor:'pointer',fontSize:'0.72rem',fontWeight:showChartLevels?700:400,background:showChartLevels?'rgba(245,158,11,0.12)':'transparent',color:showChartLevels?'#f59e0b':'var(--text-dim)'}}>
                      📐 S/R Levels
                    </button>
                  </div>
                </div>

                {/* -- Chart -- */}
                {candlestickData && candlestickData.length > 0 ? (
                  <TradingViewChart
                    data={candlestickData}
                    indicators={chartIndicators}
                    candleType={candlestickType}
                    symbol={selectedChartSymbol}
                    timeframe={chartTimeframe}
                    showLevels={showChartLevels}
                  />
                ) : (
                  <div style={{textAlign:'center',padding:'4rem 2rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'3rem',marginBottom:'0.75rem'}}>📊</div>
                    <div style={{fontSize:'0.9rem',marginBottom:'1.25rem'}}>Select a symbol and timeframe, then load the chart</div>
                    <button onClick={()=>generateCandlestickData(selectedChartSymbol,chartTimeframe)}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 2rem',fontWeight:700,cursor:'pointer',fontSize:'0.9rem'}}>
                      📈 Load Chart
                    </button>
                  </div>
                )}
              </div>
              );
            })()}

            {activeMarketsTab === 'oi-chart' && (() => {
              // Build OI data directly from liveOptionChain  -  always fresh, no stale state
              const spot = selectedUnderlying==='NIFTY' ? marketData.nifty.value : marketData.bankNifty.value;
              const chain = liveOptionChain.length > 0 ? liveOptionChain : [];
              const oiRows = chain
                .filter(d => d.strike && (d.ce?.oi > 0 || d.pe?.oi > 0))
                .map(d => ({
                  strike : d.strike,
                  ce     : Math.round((d.ce?.oi     || 0) / 1000),
                  pe     : Math.round((d.pe?.oi     || 0) / 1000),
                  ceVol  : Math.round((d.ce?.volume || 0) / 1000),
                  peVol  : Math.round((d.pe?.volume || 0) / 1000),
                  isATM  : Math.abs(d.strike - spot) < (selectedUnderlying==='NIFTY' ? 26 : 51),
                }))
                .sort((a,b) => (b.ce + b.pe) - (a.ce + a.pe));
              const maxOI = oiRows.length > 0 ? Math.max(...oiRows.map(r => Math.max(r.ce, r.pe))) : 1;
              // Top CE strikes = resistance, top PE strikes = support
              const topResistance = [...oiRows].sort((a,b)=>b.ce-a.ce)[0]?.strike;
              const topSupport    = [...oiRows].sort((a,b)=>b.pe-a.pe)[0]?.strike;
              return (
              <div className="panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <h2 style={{margin:0}}>📈 Open Interest Analysis</h2>
                  <button onClick={()=>generateLiveOptionChain(selectedUnderlying)} disabled={isLoadingChain}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.35rem 0.9rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                    {isLoadingChain?'Loading...':'🔄 Refresh'}
                  </button>
                </div>
                {oiRows.length === 0 ? (
                  <div style={{textAlign:'center',padding:'2rem',color:'var(--text-dim)'}}>
                    <p>Loading option chain data…</p>
                    <button onClick={()=>generateLiveOptionChain(selectedUnderlying)}
                      style={{marginTop:'0.5rem',background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer'}}>
                      Load Now
                    </button>
                  </div>
                ) : (
                  <div>
                    {/* Summary cards */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:'0.75rem',marginBottom:'1.25rem'}}>
                      {[
                        {label:'🛡️ Key Support (Max PE OI)',  val:topSupport?.toLocaleString(),  col:'var(--green)'},
                        {label:'🚧 Key Resistance (Max CE OI)',val:topResistance?.toLocaleString(),col:'var(--red)'},
                        {label:'🎯 Spot',                      val:spot?.toLocaleString(),         col:'var(--accent)'},
                        {label:'📊 Strikes Loaded',            val:oiRows.length,                  col:'var(--text-dim)'},
                      ].map(c=>(
                        <div key={c.label} style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'10px',padding:'0.75rem 1rem'}}>
                          <div style={{fontSize:'0.68rem',color:'var(--text-muted)',marginBottom:'0.2rem'}}>{c.label}</div>
                          <div style={{fontSize:'1.2rem',fontWeight:800,color:c.col}}>{c.val||' - '}</div>
                        </div>
                      ))}
                    </div>
                    {/* OI bar chart visual */}
                    <p style={{color:'var(--text-dim)',fontSize:'0.8rem',marginBottom:'0.75rem'}}>Top 15 strikes by total OI. Bar width = relative OI size. CE = resistance zones, PE = support zones.</p>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.84rem'}}>
                        <thead>
                          <tr style={{borderBottom:'2px solid var(--border)'}}>
                            <th style={{padding:'0.5rem 0.75rem',textAlign:'left',color:'var(--text-dim)',fontWeight:600}}>Strike</th>
                            <th style={{padding:'0.5rem 0.75rem',color:'#f87171',fontWeight:600}}>CE OI (K)  -  Resistance</th>
                            <th style={{padding:'0.5rem 0.75rem',color:'#4ade80',fontWeight:600}}>PE OI (K)  -  Support</th>
                            <th style={{padding:'0.5rem 0.75rem',textAlign:'right',color:'var(--text-dim)',fontWeight:600}}>CE Vol</th>
                            <th style={{padding:'0.5rem 0.75rem',textAlign:'right',color:'var(--text-dim)',fontWeight:600}}>PE Vol</th>
                          </tr>
                        </thead>
                        <tbody>
                          {oiRows.slice(0,15).map((row,i)=>(
                            <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:row.isATM?'rgba(249,115,22,0.08)':i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                              <td style={{padding:'0.45rem 0.75rem',fontWeight:700,color:row.isATM?'#f97316':'var(--text-main)'}}>
                                {row.strike.toLocaleString()}{row.isATM&&<span style={{fontSize:'0.65rem',marginLeft:'4px',background:'#f97316',color:'#fff',borderRadius:'3px',padding:'1px 4px'}}>ATM</span>}
                              </td>
                              <td style={{padding:'0.45rem 0.75rem'}}>
                                <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                                  <div style={{height:'8px',background:'rgba(248,113,113,0.7)',borderRadius:'2px',width:maxOI>0?Math.max(4,row.ce/maxOI*120)+'px':'4px',flexShrink:0}}/>
                                  <span style={{color:'#f87171',fontWeight:600}}>{row.ce.toLocaleString()}</span>
                                </div>
                              </td>
                              <td style={{padding:'0.45rem 0.75rem'}}>
                                <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
                                  <div style={{height:'8px',background:'rgba(74,222,128,0.7)',borderRadius:'2px',width:maxOI>0?Math.max(4,row.pe/maxOI*120)+'px':'4px',flexShrink:0}}/>
                                  <span style={{color:'#4ade80',fontWeight:600}}>{row.pe.toLocaleString()}</span>
                                </div>
                              </td>
                              <td style={{padding:'0.45rem 0.75rem',textAlign:'right',color:'var(--text-dim)'}}>{row.ceVol.toLocaleString()}</td>
                              <td style={{padding:'0.45rem 0.75rem',textAlign:'right',color:'var(--text-dim)'}}>{row.peVol.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}
          </div>

        ) : activeTab === 'backtest' ? (
          <ProGate isActive={isPro} onUpgrade={openUpgrade}
            feature="Strategy Backtester"
            description="Test any options strategy on historical data before risking real money. Uses NSE OHLCV + Black-Scholes pricing. See win rate, max drawdown, P&L curve across months.">
          <div>
            {/* -- HEADER -- */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1.5rem',flexWrap:'wrap',gap:'1rem'}}>
              <div>
                <h2 style={{margin:0,fontSize:'1.35rem'}}>📈 Strategy Backtester</h2>
                <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:'0.3rem 0 0'}}>
                  Test options strategies on historical data. Uses Yahoo Finance OHLCV + Black-Scholes pricing.
                </p>
              </div>
              <button onClick={runBacktest} disabled={btRunning}
                style={{background:btRunning?'#1e293b':'var(--accent)',color:btRunning?'var(--text-dim)':'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.5rem',fontWeight:700,cursor:btRunning?'not-allowed':'pointer',fontSize:'0.9rem',minWidth:'140px'}}>
                {btRunning ? '⏳ Running...' : '▶ Run Backtest'}
              </button>
            </div>

            {/* -- CONFIG PANEL -- */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:'1rem',marginBottom:'1.5rem'}}>

              {/* Symbol + Period */}
              <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:'0.88rem',color:'var(--accent)'}}>Market & Period</div>
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
                  <div>
                    <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'block',marginBottom:'3px'}}>Symbol</label>
                    <select value={btSymbol} onChange={e=>setBtSymbol(e.target.value)}
                      style={{width:'100%',background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem'}}>
                      {['NIFTY','BANKNIFTY','FINNIFTY','RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','TATAMOTORS','BAJFINANCE','ITC','WIPRO','AXISBANK'].map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'block',marginBottom:'3px'}}>Timeframe</label>
                    <select value={btTimeframe} onChange={e=>setBtTimeframe(e.target.value)}
                      style={{width:'100%',background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem'}}>
                      <option value="1D">Daily (1D)</option>
                      <option value="1W">Weekly (1W)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'block',marginBottom:'3px'}}>Backtest Period</label>
                    <select value={btPeriod} onChange={e=>setBtPeriod(e.target.value)}
                      style={{width:'100%',background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem'}}>
                      <option value="3m">3 Months</option>
                      <option value="6m">6 Months</option>
                      <option value="1y">1 Year</option>
                      <option value="2y">2 Years</option>
                      <option value="5y">5 Years</option>
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'block',marginBottom:'3px'}}>Starting Capital (₹)</label>
                    <input type="number" value={btCapital} onChange={e=>setBtCapital(parseInt(e.target.value)||100000)}
                      style={{width:'100%',background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem',boxSizing:'border-box'}}/>
                  </div>
                </div>
              </div>

              {/* Strategy */}
              <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:'0.88rem',color:'var(--accent)'}}>Strategy</div>
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
                  {[
                    ['ma_crossover',    '📊 MA Crossover (Options)',    'Buy CE on fast MA cross above. Buy PE on cross below. 7-day expiry options.'],
                    ['rsi',             '⚡ RSI Reversal (Options)',    'Buy CE when RSI recrosses above oversold. Buy PE on overbought cross.'],
                    ['breakout',        '🚀 Breakout (Options)',        'Buy CE on N-bar high breakout. Buy PE on N-bar low breakdown.'],
                    ['straddle_sell',   '💰 Sell Weekly Straddle',      'Sell ATM CE+PE every Monday, buy back Thursday close.'],
                    ['straddle_buy',    '🎯 Same-Strike Straddle Buy',  'Buy ATM CE + PE (same strike) on Monday. Exit on 1.5% move or Thursday.'],
                    ['synthetic_future','⚖️ Synthetic Future (Options)','Buy CE + Sell PE at same ATM strike — tracks futures, less capital.'],
                    ['futures',         '📈 Futures (Spot-based)',      'Buy/Sell futures directly. Uses spot price moves, no options pricing. Most accurate directional test.'],
                    ['futures_ma',      '📊 Futures MA Crossover',      'Futures version of MA crossover — pure directional P&L, no theta/IV noise.'],
                  ].map(([v, label, desc])=>(
                    <div key={v} onClick={()=>setBtStrategy(v)}
                      style={{cursor:'pointer',padding:'0.6rem 0.75rem',borderRadius:'8px',border:`1px solid ${btStrategy===v?'var(--accent)':'var(--border)'}`,background:btStrategy===v?'rgba(0,255,136,0.07)':'transparent',transition:'all 0.15s'}}>
                      <div style={{fontWeight:600,fontSize:'0.85rem',color:btStrategy===v?'var(--accent)':'var(--text-main)'}}>{label}</div>
                      <div style={{fontSize:'0.74rem',color:'var(--text-dim)',marginTop:'2px'}}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Parameters */}
              <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:'0.88rem',color:'var(--accent)'}}>Parameters</div>
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
                  {btStrategy==='ma_crossover' && (<>
                    {[['Fast MA Period','fastMA',3,50],['Slow MA Period','slowMA',10,200]].map(([label,key,mn,mx])=>(
                      <div key={key}>
                        <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',justifyContent:'space-between'}}><span>{label}</span><span style={{color:'var(--accent)'}}>{btParams[key]}</span></label>
                        <input type="range" min={mn} max={mx} value={btParams[key]} onChange={e=>setBtParams(p=>({...p,[key]:parseInt(e.target.value)}))}
                          style={{width:'100%',accentColor:'var(--accent)'}}/>
                      </div>
                    ))}
                  </>)}
                  {btStrategy==='rsi' && (<>
                    {[['RSI Overbought','rsiOB',60,90],['RSI Oversold','rsiOS',10,40]].map(([label,key,mn,mx])=>(
                      <div key={key}>
                        <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',justifyContent:'space-between'}}><span>{label}</span><span style={{color:'var(--accent)'}}>{btParams[key]}</span></label>
                        <input type="range" min={mn} max={mx} value={btParams[key]} onChange={e=>setBtParams(p=>({...p,[key]:parseInt(e.target.value)}))}
                          style={{width:'100%',accentColor:'var(--accent)'}}/>
                      </div>
                    ))}
                  </>)}
                  {btStrategy==='breakout' && (
                    <div>
                      <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',justifyContent:'space-between'}}><span>Lookback Bars</span><span style={{color:'var(--accent)'}}>{btParams.breakoutBars}</span></label>
                      <input type="range" min={3} max={30} value={btParams.breakoutBars} onChange={e=>setBtParams(p=>({...p,breakoutBars:parseInt(e.target.value)}))}
                        style={{width:'100%',accentColor:'var(--accent)'}}/>
                    </div>
                  )}
                  <div>
                    <label style={{fontSize:'0.75rem',color:'var(--text-dim)',display:'flex',justifyContent:'space-between'}}><span>Lot Size</span><span style={{color:'var(--accent)'}}>{btParams.lotSize}</span></label>
                    <input type="range" min={15} max={1800} step={15} value={btParams.lotSize} onChange={e=>setBtParams(p=>({...p,lotSize:parseInt(e.target.value)}))}
                      style={{width:'100%',accentColor:'var(--accent)'}}/>
                    <div style={{fontSize:'0.7rem',color:'var(--text-dim)',marginTop:'2px'}}>NIFTY=75 | BANKNIFTY=15 | Stocks=varies</div>
                  </div>
                  <div style={{marginTop:'0.5rem',background:'#0a1628',borderRadius:'6px',padding:'0.5rem',fontSize:'0.75rem',color:'#64748b'}}>
                    <div style={{color:'#fbbf24',fontWeight:600,marginBottom:'3px'}}>⚠️ Disclaimer</div>
                    Options P&L calculated using Black-Scholes with IV=16%. Actual premium history is not available in free APIs. Past results do not guarantee future performance.
                  </div>
                </div>
              </div>
            </div>

            {/* -- RESULTS -- */}
            {btRunning && (
              <div style={{textAlign:'center',padding:'4rem',color:'var(--text-dim)'}}>
                <div style={{fontSize:'2.5rem',marginBottom:'1rem'}}>⚙️</div>
                <div style={{fontSize:'1rem',fontWeight:600}}>Running backtest on {btSymbol}...</div>
                <div style={{fontSize:'0.82rem',marginTop:'0.5rem'}}>Fetching {btPeriod} of data and simulating trades</div>
              </div>
            )}

            {btResult?.error && (
              <div style={{background:'#1a0a00',border:'1px solid #991b1b',borderRadius:'10px',padding:'1.5rem',textAlign:'center',color:'#f87171'}}>
                ⚠️ {btResult.error}
              </div>
            )}

            {btResult && !btResult.error && !btRunning && (
              <div>
                {/* -- STATS CARDS -- */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'0.75rem',marginBottom:'1.5rem'}}>
                  {[
                    ['Total Return', btResult.totalReturn+'%', parseFloat(btResult.totalReturn)>=0?'#4ade80':'#f87171'],
                    ['Final Capital', '₹'+btResult.finalCapital?.toLocaleString(), parseFloat(btResult.totalReturn)>=0?'#4ade80':'#f87171'],
                    ['Win Rate', btResult.winRate+'%', parseFloat(btResult.winRate)>=50?'#4ade80':'#f59e0b'],
                    ['Total Trades', btResult.totalTrades, '#94a3b8'],
                    ['Max Drawdown', btResult.maxDD+'%', '#f87171'],
                    ['Sharpe Ratio', btResult.sharpe, parseFloat(btResult.sharpe)>=1?'#4ade80':parseFloat(btResult.sharpe)>=0?'#f59e0b':'#f87171'],
                    ['Best Trade', '₹'+btResult.bestTrade?.toLocaleString(), '#4ade80'],
                    ['Worst Trade', '₹'+btResult.worstTrade?.toLocaleString(), '#f87171'],
                  ].map(([label,val,color])=>(
                    <div key={label} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'0.75rem',textAlign:'center'}}>
                      <div style={{fontSize:'0.72rem',color:'var(--text-dim)',marginBottom:'0.3rem'}}>{label}</div>
                      <div style={{fontSize:'1.1rem',fontWeight:700,color}}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* -- EQUITY CURVE -- */}
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem',marginBottom:'1.5rem'}}>
                  <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:'0.9rem'}}>📈 Equity Curve</div>
                  {(() => {
                    const eq  = btResult.equity;
                    if(!eq||eq.length<2) return <div style={{color:'var(--text-dim)',textAlign:'center',padding:'2rem'}}>No data</div>;
                    const min  = Math.min(...eq.map(e=>e.value));
                    const max  = Math.max(...eq.map(e=>e.value));
                    const rng  = max-min||1;
                    const W=800, H=200, PAD=40;
                    const px = (i)=>(PAD+(i/(eq.length-1))*(W-PAD*2)).toFixed(1);
                    const py = (v)=>(H-PAD-((v-min)/rng*(H-PAD*2))).toFixed(1);
                    const pts = eq.map((e,i)=>`${px(i)},${py(e.value)}`).join(' ');
                    const fillPts = `${px(0)},${H-PAD} ${pts} ${px(eq.length-1)},${H-PAD}`;
                    const isProfit = eq[eq.length-1].value >= btCapital;
                    const clr = isProfit?'#4ade80':'#f87171';
                    const priceLines = [min,min+rng/4,min+rng/2,min+rng*3/4,max];
                    return (
                      <div style={{overflowX:'auto'}}>
                        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',minWidth:'300px',height:'auto'}}>
                          <defs>
                            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={clr} stopOpacity="0.3"/>
                              <stop offset="100%" stopColor={clr} stopOpacity="0.02"/>
                            </linearGradient>
                          </defs>
                          {/* Grid */}
                          {priceLines.map((p,i)=>(
                            <g key={i}>
                              <line x1={PAD} y1={py(p)} x2={W-PAD} y2={py(p)} stroke="rgba(100,116,139,0.15)" strokeWidth="1"/>
                              <text x={PAD-5} y={parseFloat(py(p))+4} textAnchor="end" fill="#64748b" fontSize="9">
                                {p>=1000?(p/1000).toFixed(0)+'K':p.toFixed(0)}
                              </text>
                            </g>
                          ))}
                          {/* Baseline */}
                          <line x1={PAD} y1={py(btCapital)} x2={W-PAD} y2={py(btCapital)} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,4"/>
                          {/* Fill area */}
                          <polygon points={fillPts} fill="url(#eqGrad)"/>
                          {/* Line */}
                          <polyline points={pts} fill="none" stroke={clr} strokeWidth="2"/>
                          {/* Entry/exit dots from trades */}
                          {btResult.trades.filter(t=>t.type==='ENTRY').map((t,i)=>{
                            const idx = eq.findIndex(e=>e.date>=t.date);
                            if(idx<0) return null;
                            return <circle key={i} cx={px(idx)} cy={py(eq[idx]?.value||min)} r="3" fill="#fbbf24" opacity="0.8"/>;
                          })}
                          <text x={W/2} y={H-5} textAnchor="middle" fill="#64748b" fontSize="9">{btResult.symbol}  |  {btResult.period}  |  {btResult.strategy}</text>
                        </svg>
                      </div>
                    );
                  })()}
                </div>

                {/* -- TRADE LOG -- */}
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                  <div style={{fontWeight:600,marginBottom:'0.75rem',fontSize:'0.9rem'}}>📋 Trade Log ({btResult.totalTrades} trades)</div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8rem'}}>
                      <thead>
                        <tr style={{borderBottom:'1px solid var(--border)',color:'#64748b'}}>
                          {['Date','Type','Side','Strike','Entry ₹','P&L','Capital'].map(h=>(
                            <th key={h} style={{padding:'0.4rem 0.5rem',textAlign:'left',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {btResult.trades.slice(-50).reverse().map((t,i)=>(
                          <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:i%2===0?'transparent':'rgba(255,255,255,0.02)'}}>
                            <td style={{padding:'0.35rem 0.5rem',color:'#94a3b8'}}>{t.date}</td>
                            <td style={{padding:'0.35rem 0.5rem'}}>
                              <span style={{background:t.type==='ENTRY'?'rgba(96,165,250,0.15)':'rgba(74,222,128,0.1)',color:t.type==='ENTRY'?'#60a5fa':'#4ade80',padding:'1px 6px',borderRadius:'4px',fontSize:'0.72rem',fontWeight:600}}>{t.type}</span>
                            </td>
                            <td style={{padding:'0.35rem 0.5rem',color:t.side==='CE'||t.side?.includes('STRADDLE_SELL')?'#4ade80':'#f87171',fontWeight:600}}>{t.side}</td>
                            <td style={{padding:'0.35rem 0.5rem',color:'var(--text-main)'}}>{t.strike?.toLocaleString()||'-'}</td>
                            <td style={{padding:'0.35rem 0.5rem',color:'#94a3b8'}}>₹{t.entryPx||'-'}</td>
                            <td style={{padding:'0.35rem 0.5rem',fontWeight:600,color:t.pnl>=0?'#4ade80':'#f87171'}}>{t.pnl!=null?(t.pnl>=0?'+':'')+t.pnl.toLocaleString():'-'}</td>
                            <td style={{padding:'0.35rem 0.5rem',color:'#94a3b8'}}>₹{t.capital?.toLocaleString()||'-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {btResult.trades.length>50 && <div style={{textAlign:'center',padding:'0.5rem',color:'var(--text-dim)',fontSize:'0.75rem'}}>Showing last 50 of {btResult.trades.length} trades</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
          </ProGate>
        ) : activeTab === 'intelligence' ? (
          <ProGate isActive={isPro} onUpgrade={openUpgrade}
            feature="AI Market Intelligence"
            description="AI-powered analysis of high-impact news, economic events and market sentiment using Claude. Get trading ideas, affected indices, and risk levels for every major event — before the market reacts.">
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem',flexWrap:'wrap',gap:'0.75rem'}}>
              <div>
                <h2 style={{margin:0,fontSize:'1.35rem'}}>🧠 Market Intelligence</h2>
                <p style={{color:groqApiKey?'#4ade80':'#f59e0b',fontSize:'0.8rem',margin:'0.2rem 0 0'}}>
                  {groqApiKey?'AI-powered by Groq Llama 3.3':'Add Groq key in Settings for AI analysis'}
                </p>
              </div>
              <button onClick={()=>{fetchIntelligentNews();fetchLivePrices();}} disabled={isLoadingNews}
                style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.5rem 1.2rem',fontWeight:700,cursor:'pointer',fontSize:'0.88rem'}}>
                {isLoadingNews?'Analyzing...':'Refresh Intelligence'}
              </button>
            </div>

            {/* AI NEWS */}
            <div className="panel" style={{marginBottom:'1.5rem'}}>
              <h3 style={{marginTop:0,color:'var(--accent)'}}>AI News Analysis</h3>
              {isLoadingNews && intelligentNews.length===0 ? (
                <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                  <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>🤖</div>
                  <p>AI is analyzing market news...</p>
                </div>
              ) : intelligentNews.length===0 ? (
                <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                  <p>Click Refresh Intelligence to load AI-powered news analysis</p>
                </div>
              ) : (
                <div className="intelligent-news-feed">
                  {intelligentNews.map(news=>(
                    <div key={news.id} className="intelligent-news-card">
                      <div className="news-main-header">
                        <h3 className="intelligent-news-title">{news.title}</h3>
                        <div className="news-meta">
                          <span className="news-source">{news.source}</span>
                          <span className="news-time">{formatNewsTime(news.publishedAt)}</span>
                        </div>
                      </div>
                      <div className="news-tags">
                        <span className={`sentiment-tag ${news.analysis.sentiment}`}>{news.analysis.sentiment==='bullish'?'🟢 BULLISH':news.analysis.sentiment==='bearish'?'🔴 BEARISH':'⚪ NEUTRAL'}</span>
                        <span className={`impact-tag ${news.analysis.impact}`}>{news.analysis.impact==='high'?'HIGH IMPACT':news.analysis.impact==='medium'?'MEDIUM':'LOW'}</span>
                        {news.analysis.tradingIdea?.aiPowered && <span style={{background:'#1a3a1a',color:'#4ade80',padding:'2px 8px',borderRadius:'99px',fontSize:'0.7rem',fontWeight:600}}>AI</span>}
                      </div>
                      {news.analysis.keyInsight && <div style={{background:'#0d1f35',border:'1px solid #1e3a5f',borderRadius:'6px',padding:'0.5rem 0.75rem',margin:'0.4rem 0',fontSize:'0.84rem',color:'#93c5fd'}}>💡 {news.analysis.keyInsight}</div>}
                      {news.analysis.affectedStocks?.length>0 && (
                        <div style={{display:'flex',gap:'0.4rem',flexWrap:'wrap',margin:'0.3rem 0',alignItems:'center'}}>
                          <span style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Watch:</span>
                          {news.analysis.affectedStocks.map(s=><span key={s} style={{background:'#1e293b',color:'var(--accent)',padding:'1px 7px',borderRadius:'99px',fontSize:'0.76rem'}}>{s}</span>)}
                        </div>
                      )}
                      <div className="trading-idea-section">
                        <div className="strategy-details">
                          <div className="strategy-name">{news.analysis.tradingIdea?.name||news.analysis.tradingIdea?.strategy}</div>
                          <p className="strategy-reasoning">{news.analysis.tradingIdea?.reasoning}</p>
                          <div className="strategy-metrics">
                            <span>Risk: {news.analysis.tradingIdea?.risk}</span>
                            <span>Timeframe: {news.analysis.tradingIdea?.timeframe}</span>
                          </div>
                          {(news.analysis.tradingIdea?.name||news.analysis.tradingIdea?.strategy)!=='Wait and Watch' && (
                            <button className="load-strategy-btn" onClick={()=>loadStrategyFromNews(news.analysis.tradingIdea)}>Load Strategy in Calculator</button>
                          )}
                        </div>
                      </div>
                      <a href={news.url} target="_blank" rel="noopener noreferrer" className="read-more-link">Read full article</a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* INSTITUTIONAL ACTIVITY */}
            <div className="panel" style={{marginBottom:'1.5rem'}}>
              <h3 style={{marginTop:0,color:'var(--accent)'}}>Institutional Activity</h3>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'1rem',marginBottom:'1rem'}}>

                {/* PCR Card */}
                <div style={{background:'#0f172a',borderRadius:'10px',padding:'1rem',border:'1px solid var(--border)'}}>
                  <div style={{fontWeight:600,marginBottom:'0.5rem'}}>Put/Call Ratio by Index</div>
                  <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>PCR above 1.2 = bullish. Below 0.8 = bearish. Calculated from live chain.</p>
                  {[['NIFTY 50',liveOptionChain]].map(([name,chain])=>{
                    const ceOI = chain.reduce((s,r)=>s+(r.ce?.oi||0),0);
                    const peOI = chain.reduce((s,r)=>s+(r.pe?.oi||0),0);
                    const pcr  = ceOI>0?(peOI/ceOI).toFixed(2):'-';
                    const bull = parseFloat(pcr)>1.2;
                    const bear = parseFloat(pcr)<0.8;
                    const clr  = bull?'#4ade80':bear?'#f87171':'#fbbf24';
                    const lbl  = bull?'BULLISH':bear?'BEARISH':'NEUTRAL';
                    return (
                      <div key={name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.6rem 0',borderBottom:'1px solid #1e293b'}}>
                        <span style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>{name}</span>
                        <span style={{fontWeight:700,fontSize:'1.2rem',color:clr}}>{pcr}</span>
                        <span style={{color:clr,fontSize:'0.8rem',fontWeight:600,background:'rgba(255,255,255,0.05)',padding:'2px 8px',borderRadius:'99px'}}>{lbl}</span>
                      </div>
                    );
                  })}
                  <p style={{color:'var(--text-dim)',fontSize:'0.72rem',marginTop:'0.5rem'}}>Refresh option chain for latest data</p>
                </div>

                {/* FII/DII Card */}
                <div style={{background:'#0f172a',borderRadius:'10px',padding:'1rem',border:'1px solid var(--border)'}}>
                  <div style={{fontWeight:600,marginBottom:'0.5rem'}}>FII / DII Activity</div>
                  <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>NSE publishes this end-of-day. Figures in crores (INR).</p>
                  {fiiDiiData.length>0 ? fiiDiiData.slice(0,5).map((row,i)=>(
                    <div key={i} style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr 1fr',gap:'0.25rem',padding:'0.35rem 0',borderBottom:'1px solid #1e293b',fontSize:'0.78rem'}}>
                      <span style={{color:'#64748b'}}>{row.date}</span>
                      <span style={{color:row.fii>=0?'#4ade80':'#f87171'}}>FII {row.fii>=0?'+':''}{(row.fii||0).toLocaleString()}</span>
                      <span style={{color:row.dii>=0?'#60a5fa':'#f87171'}}>DII {row.dii>=0?'+':''}{(row.dii||0).toLocaleString()}</span>
                      <span style={{color:(row.fii+row.dii)>=0?'#4ade80':'#f87171',fontWeight:600}}>Net {((row.fii||0)+(row.dii||0))>=0?'+':''}{((row.fii||0)+(row.dii||0)).toLocaleString()}</span>
                    </div>
                  )) : (
                    <div style={{textAlign:'center',padding:'1rem',color:'var(--text-dim)',fontSize:'0.82rem'}}>
                      FII/DII data loads from NSE.
                      <a href="https://www.nseindia.com/market-data/fii-dii-activity" target="_blank" rel="noreferrer" style={{color:'var(--accent)',marginLeft:'0.3rem'}}>View on NSE</a>
                    </div>
                  )}
                </div>
              </div>

              {/* OI Buildup */}
              <div style={{background:'#0f172a',borderRadius:'10px',padding:'1rem',border:'1px solid var(--border)',marginBottom:'1rem'}}>
                <div style={{fontWeight:600,marginBottom:'0.5rem'}}>Largest OI Buildup  -  NIFTY Strikes</div>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>Highest OI = where institutions are positioned. CE = resistance, PE = support.</p>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                  <div>
                    <div style={{color:'#f87171',fontWeight:600,fontSize:'0.82rem',marginBottom:'0.5rem'}}>TOP CE OI  -  Resistance Levels</div>
                    {[...liveOptionChain].sort((a,b)=>(b.ce?.oi||0)-(a.ce?.oi||0)).slice(0,6).map(row=>(
                      <div key={row.strike} style={{display:'flex',justifyContent:'space-between',padding:'0.3rem 0',borderBottom:'1px solid #1e293b',fontSize:'0.82rem'}}>
                        <span style={{fontWeight:700,color:'#f0f9ff'}}>{row.strike}</span>
                        <span style={{color:'#f87171'}}>{((row.ce?.oi||0)/1000).toFixed(0)}K OI</span>
                        <span style={{color:'#64748b',fontSize:'0.75rem'}}>{row.ce?.iv||'-'}% IV</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{color:'#4ade80',fontWeight:600,fontSize:'0.82rem',marginBottom:'0.5rem'}}>TOP PE OI  -  Support Levels</div>
                    {[...liveOptionChain].sort((a,b)=>(b.pe?.oi||0)-(a.pe?.oi||0)).slice(0,6).map(row=>(
                      <div key={row.strike} style={{display:'flex',justifyContent:'space-between',padding:'0.3rem 0',borderBottom:'1px solid #1e293b',fontSize:'0.82rem'}}>
                        <span style={{fontWeight:700,color:'#f0f9ff'}}>{row.strike}</span>
                        <span style={{color:'#4ade80'}}>{((row.pe?.oi||0)/1000).toFixed(0)}K OI</span>
                        <span style={{color:'#64748b',fontSize:'0.75rem'}}>{row.pe?.iv||'-'}% IV</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Block & Bulk Deals */}
              <div style={{background:'#0f172a',borderRadius:'10px',padding:'1rem',border:'1px solid var(--border)'}}>
                <div style={{fontWeight:600,marginBottom:'0.5rem'}}>Block & Bulk Deals</div>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginBottom:'0.5rem'}}>
                  Large institutional trades executed on exchange.
                  <a href="https://www.nseindia.com/market-data/block-deal" target="_blank" rel="noreferrer" style={{color:'var(--accent)',marginLeft:'0.4rem'}}>View live on NSE</a>
                  <span style={{marginLeft:'0.4rem'}}>|</span>
                  <a href="https://www.bseindia.com/markets/equity/EQReports/BulkDeal.aspx" target="_blank" rel="noreferrer" style={{color:'var(--accent)',marginLeft:'0.4rem'}}>View on BSE</a>
                </p>
                <div style={{background:'#0a1628',borderRadius:'8px',padding:'1rem',textAlign:'center',fontSize:'0.82rem',color:'#64748b'}}>
                  Block/Bulk deal real-time integration is planned with the mstock API. Until then, use the NSE/BSE links above for live data  -  they update throughout the day.
                </div>
              </div>
            </div>
          </div>
          </ProGate>
        ) : activeTab === 'scanner' ? (
                    <ProGate isActive={isPro} onUpgrade={openUpgrade}
            feature="Live F&O Scanner"
            description="Real-time scanner for IV Crush, PCR Extremes, Gamma Squeeze, unusual OI buildup and more. Catches setups as they form — before retail traders notice.">
          <>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1rem',flexWrap:'wrap',gap:'0.75rem'}}>
              <div>
                <h1 style={{margin:0,fontSize:'1.25rem',fontWeight:800}}>🔍 DeltaBuddy Scanner</h1>
                <p style={{margin:'0.2rem 0 0',fontSize:'0.8rem',color:'var(--text-dim)'}}>{selectedUnderlying} · Spot {spot.toLocaleString()} · {liveOptionChain.length} strikes loaded</p>
              </div>
              <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                <span style={{fontSize:'0.75rem',fontWeight:700,color:liveOptionChain.length>0?'#4ade80':'#f87171'}}>
                  {liveOptionChain.length>0?'● Live':'○ No Data'}
                </span>
                {lastScanTime && <span style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>Scanned {lastScanTime.toLocaleTimeString()}</span>}
              </div>
            </div>

            {/* Sub-tabs */}
            <div style={{display:'flex',gap:'0.35rem',marginBottom:'1.25rem',borderBottom:'1px solid var(--border)',paddingBottom:'0'}}>
              {[['preset','🎯 Preset Signals'],['custom','✏️ Custom Filter']].map(([id,label])=>(
                <button key={id} onClick={()=>setActiveScannerTab(id)}
                  style={{padding:'0.5rem 1.1rem',borderRadius:'8px 8px 0 0',border:'1px solid',borderBottom:'none',fontWeight:700,fontSize:'0.82rem',cursor:'pointer',
                    borderColor: activeScannerTab===id ? 'var(--accent)' : 'var(--border)',
                    background: activeScannerTab===id ? 'rgba(0,255,136,0.09)' : 'transparent',
                    color: activeScannerTab===id ? 'var(--accent)' : 'var(--text-dim)',
                    marginBottom:'-1px'}}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── PRESET SIGNALS TAB ───────────────────────────────────────── */}
            {activeScannerTab === 'preset' && (<>
              <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem',marginBottom:'1.25rem'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.9rem'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:'0.88rem'}}>Signal Filters</div>
                    <div style={{fontSize:'0.73rem',color:'var(--text-dim)',marginTop:'2px'}}>Toggle ON/OFF — then click Run Scan</div>
                  </div>
                  <button onClick={runScan} disabled={scanRunning}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.45rem 1.2rem',fontWeight:800,fontSize:'0.82rem',cursor:'pointer',opacity:scanRunning?0.6:1}}>
                    {scanRunning ? '⏳ Scanning...' : '▶ Run Scan'}
                  </button>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'0.6rem'}}>
                  {[
                    { id:'crash_warning', icon:'🔴', title:'Market Crash — CE O=H',  desc:'CE at bid (O=H) + same-strike PE under VWAP → buy PE' },
                    { id:'blast_warning', icon:'🟢', title:'Market Blast — PE O=L',  desc:'PE at bid (O=L) + same-strike CE under VWAP → buy CE' },
                    { id:'synthetic',     icon:'⚖️', title:'Synthetic Future',        desc:'CE−PE ≈ Spot−Strike (parity) → delta≈1, tracks futures free' },
                    { id:'iv_crush',      icon:'⚡', title:'IV Crush Setup',          desc:'IV>22% with DTE≤7 → sell premium before crush' },
                    { id:'gamma_squeeze', icon:'🔥', title:'Gamma Squeeze',           desc:'15%+ OI at one strike → explosive move if breached' },
                    { id:'pcr_extreme',   icon:'📊', title:'PCR Extreme',             desc:'PCR>1.5 or <0.6 → contrarian reversal' },
                    { id:'oi_buildup',    icon:'📈', title:'OI Buildup',              desc:'Fresh OI>50K → institutions positioning' },
                  ].map(f => {
                    const active = selectedFilters.includes(f.id);
                    return (
                      <div key={f.id} onClick={()=>setSelectedFilters(p=>active?p.filter(x=>x!==f.id):[...p,f.id])}
                        style={{cursor:'pointer',padding:'0.7rem 0.85rem',borderRadius:'9px',transition:'all 0.15s',
                          border:`1.5px solid ${active?'var(--accent)':'var(--border)'}`,
                          background:active?'rgba(0,255,136,0.07)':'var(--bg-dark)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.25rem'}}>
                          <span style={{fontWeight:700,fontSize:'0.82rem',color:active?'var(--accent)':'var(--text-main)'}}>{f.icon} {f.title}</span>
                          <span style={{fontSize:'0.62rem',fontWeight:700,padding:'2px 6px',borderRadius:'99px',
                            background:active?'rgba(0,255,136,0.18)':'rgba(100,116,139,0.12)',
                            color:active?'var(--accent)':'var(--text-muted)'}}>
                            {active?'ON':'OFF'}
                          </span>
                        </div>
                        <p style={{margin:0,fontSize:'0.71rem',color:'var(--text-dim)',lineHeight:1.35}}>{f.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Results */}
              {scanResults.length > 0 ? (
                <div>
                  <div style={{fontWeight:700,fontSize:'0.88rem',color:'var(--accent)',marginBottom:'0.75rem'}}>
                    📋 {scanResults.length} signal{scanResults.length>1?'s':''} found
                  </div>
                  {scanResults.map((r,i) => (
                    <div key={i} style={{background:'var(--bg-card)',borderRadius:'12px',padding:'1rem 1.25rem',marginBottom:'0.65rem',
                      border:`1.5px solid ${r.severity==='high'?'rgba(248,113,113,0.35)':r.severity==='medium'?'rgba(251,191,36,0.25)':'rgba(74,222,128,0.2)'}`,
                      borderLeft:`4px solid ${r.severity==='high'?'#f87171':r.severity==='medium'?'#fbbf24':'#4ade80'}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'0.5rem',flexWrap:'wrap'}}>
                        <div style={{display:'flex',gap:'0.6rem',alignItems:'flex-start'}}>
                          <span style={{fontSize:'1.2rem',flexShrink:0}}>{r.icon}</span>
                          <div>
                            <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)'}}>{r.title}</div>
                            <div style={{fontSize:'0.76rem',color:'var(--text-dim)',marginTop:'0.2rem',lineHeight:1.4}}>{r.description}</div>
                          </div>
                        </div>
                        <span style={{fontSize:'0.65rem',fontWeight:700,padding:'2px 8px',borderRadius:'99px',flexShrink:0,
                          background:r.severity==='high'?'rgba(248,113,113,0.12)':r.severity==='medium'?'rgba(251,191,36,0.1)':'rgba(74,222,128,0.08)',
                          color:r.severity==='high'?'#f87171':r.severity==='medium'?'#fbbf24':'#4ade80'}}>
                          {(r.severity||'').toUpperCase()}
                        </span>
                      </div>
                      {r.metric && (
                        <div style={{marginTop:'0.5rem',fontSize:'0.73rem',color:'#818cf8',background:'rgba(99,102,241,0.08)',borderRadius:'5px',padding:'0.25rem 0.5rem',display:'inline-block',fontFamily:'monospace'}}>
                          {r.metric}
                        </div>
                      )}
                      {r.action && (
                        <div style={{marginTop:'0.5rem',display:'flex',alignItems:'center',gap:'0.5rem',flexWrap:'wrap'}}>
                          <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>→</span>
                          <span style={{fontSize:'0.78rem',fontWeight:700,color:'var(--accent)'}}>{r.action}</span>
                          {r.strategy && (
                            <button onClick={()=>{ loadStrategyTemplate(r.strategy); setActiveTab('analyse');setAnalyseSubTab('strategy'); }}
                              style={{background:'rgba(0,255,136,0.1)',color:'var(--accent)',border:'1px solid rgba(0,255,136,0.25)',borderRadius:'5px',padding:'2px 8px',fontSize:'0.7rem',fontWeight:700,cursor:'pointer'}}>
                              Open in Builder →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'2.5rem',textAlign:'center',color:'var(--text-dim)'}}>
                  <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>🔍</div>
                  <div style={{fontSize:'0.88rem',marginBottom:'0.3rem'}}>Toggle filters above and click <strong style={{color:'var(--accent)'}}>Run Scan</strong></div>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>Requires live chain. Best during market hours 9:15–3:30 IST.</div>
                </div>
              )}
            </>)}

            {/* ── CUSTOM FILTER TAB ─────────────────────────────────────────── */}
            {activeScannerTab === 'custom' && (() => {
              const METRICS = [
                { id:'ce_ltp',    label:'CE Premium (LTP)',   fn: r => parseFloat(r.ce?.ltp||0) },
                { id:'pe_ltp',    label:'PE Premium (LTP)',   fn: r => parseFloat(r.pe?.ltp||0) },
                { id:'ce_iv',     label:'CE IV %',            fn: r => parseFloat(r.ce?.iv||0)  },
                { id:'pe_iv',     label:'PE IV %',            fn: r => parseFloat(r.pe?.iv||0)  },
                { id:'ce_oi',     label:'CE OI (lots)',       fn: r => (r.ce?.oi||0)/75         },
                { id:'pe_oi',     label:'PE OI (lots)',       fn: r => (r.pe?.oi||0)/75         },
                { id:'ce_oichg',  label:'CE OI Change',       fn: r => (r.ce?.oiChg||0)/75      },
                { id:'pe_oichg',  label:'PE OI Change',       fn: r => (r.pe?.oiChg||0)/75      },
                { id:'ce_vol',    label:'CE Volume',          fn: r => r.ce?.volume||0          },
                { id:'pe_vol',    label:'PE Volume',          fn: r => r.pe?.volume||0          },
                { id:'ce_pchg',   label:'CE % Change',        fn: r => parseFloat(r.ce?.pChange||0) },
                { id:'pe_pchg',   label:'PE % Change',        fn: r => parseFloat(r.pe?.pChange||0) },
                { id:'pcr',       label:'Strike PCR (OI)',    fn: r => (r.ce?.oi||0)>0 ? ((r.pe?.oi||0)/(r.ce?.oi||1)) : 0 },
                { id:'iv_skew',   label:'IV Skew (PE−CE)',    fn: r => parseFloat(r.pe?.iv||0)-parseFloat(r.ce?.iv||0) },
                { id:'prem_ratio',label:'CE/PE Premium Ratio',fn: r => parseFloat(r.pe?.ltp||1)>0 ? parseFloat(r.ce?.ltp||0)/parseFloat(r.pe?.ltp||1) : 0 },
              ];

              const emptyCondition = () => ({ metric:'ce_ltp', op:'>', value:'' });
              const conds = newFilter.conditions || [emptyCondition()];

              const runCustomScan = (filter) => {
                const chain = liveOptionChain;
                if (!chain.length) { alert('Load option chain first'); return; }
                const results = [];
                chain.forEach(row => {
                  const pass = filter.conditions.every(cond => {
                    const m = METRICS.find(x=>x.id===cond.metric);
                    if (!m) return false;
                    const val = m.fn(row);
                    const tgt = parseFloat(cond.value);
                    if (isNaN(tgt)) return false;
                    if (cond.op==='>') return val > tgt;
                    if (cond.op==='<') return val < tgt;
                    if (cond.op==='>=') return val >= tgt;
                    if (cond.op==='<=') return val <= tgt;
                    if (cond.op==='=') return Math.abs(val-tgt)<0.01;
                    return false;
                  });
                  if (pass) {
                    results.push({
                      type:'custom', icon:'🎯', severity:'medium',
                      title:`${filter.name} — Strike ${row.strike}`,
                      description: filter.conditions.map(c=>{
                        const m=METRICS.find(x=>x.id===c.metric);
                        const val=m?m.fn(row).toFixed(2):'?';
                        return `${m?.label||c.metric} ${c.op} ${c.value} (actual: ${val})`;
                      }).join(' AND '),
                      metric: `CE ₹${parseFloat(row.ce?.ltp||0).toFixed(0)} | PE ₹${parseFloat(row.pe?.ltp||0).toFixed(0)} | IV CE:${row.ce?.iv||0}% PE:${row.pe?.iv||0}%`,
                      action:'',
                    });
                  }
                });
                setScanResults(results.length ? results : [{ type:'clear', icon:'✅', severity:'low', title:'No Matches', description:`No strikes matched "${filter.name}" conditions.`, metric:`Scanned ${chain.length} strikes`, action:'' }]);
                setLastScanTime(new Date());
                setActiveScannerTab('preset'); // show results in preset tab
              };

              const saveFilter = () => {
                if (!newFilter.name?.trim()) { alert('Give your filter a name'); return; }
                const bad = newFilter.conditions.some(c=>c.value==='');
                if (bad) { alert('Fill in all condition values'); return; }
                setCustomFilters(prev=>[...prev, {...newFilter}]);
                setNewFilter({ name:'', conditions:[emptyCondition()] });
              };

              return (
                <div>
                  {/* Builder */}
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1.1rem',marginBottom:'1.25rem'}}>
                    <div style={{fontWeight:700,fontSize:'0.9rem',marginBottom:'0.9rem',color:'var(--accent)'}}>✏️ Build a Custom Scanner</div>

                    {/* Filter name */}
                    <div style={{marginBottom:'0.85rem'}}>
                      <label style={{fontSize:'0.75rem',color:'var(--text-muted)',display:'block',marginBottom:'0.3rem'}}>Filter Name</label>
                      <input value={newFilter.name||''} onChange={e=>setNewFilter(p=>({...p,name:e.target.value}))}
                        placeholder="e.g. High IV Breakout, OI Spike Shorts"
                        style={{width:'100%',boxSizing:'border-box',background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'7px',padding:'0.5rem 0.75rem',fontSize:'0.85rem'}}/>
                    </div>

                    {/* Conditions */}
                    <div style={{marginBottom:'0.85rem'}}>
                      <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.5rem'}}>Conditions <span style={{color:'var(--text-dim)'}}>(ALL must match)</span></div>
                      {conds.map((cond,idx) => (
                        <div key={idx} style={{display:'grid',gridTemplateColumns:'1fr 70px 100px 32px',gap:'0.4rem',marginBottom:'0.4rem',alignItems:'center'}}>
                          <select value={cond.metric} onChange={e=>setNewFilter(p=>{ const c=[...p.conditions]; c[idx]={...c[idx],metric:e.target.value}; return {...p,conditions:c}; })}
                            style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem 0.5rem',fontSize:'0.78rem'}}>
                            {METRICS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                          <select value={cond.op} onChange={e=>setNewFilter(p=>{ const c=[...p.conditions]; c[idx]={...c[idx],op:e.target.value}; return {...p,conditions:c}; })}
                            style={{background:'var(--bg-dark)',color:'var(--accent)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem 0.3rem',fontSize:'0.82rem',fontWeight:700,textAlign:'center'}}>
                            {['>','<','>=','<=','='].map(o=><option key={o} value={o}>{o}</option>)}
                          </select>
                          <input type="number" value={cond.value} onChange={e=>setNewFilter(p=>{ const c=[...p.conditions]; c[idx]={...c[idx],value:e.target.value}; return {...p,conditions:c}; })}
                            placeholder="Value"
                            style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem 0.5rem',fontSize:'0.82rem',width:'100%',boxSizing:'border-box'}}/>
                          {conds.length > 1 ? (
                            <button onClick={()=>setNewFilter(p=>({...p,conditions:p.conditions.filter((_,i)=>i!==idx)}))}
                              style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:'1.1rem',padding:0}}>×</button>
                          ) : <span/>}
                        </div>
                      ))}
                      <button onClick={()=>setNewFilter(p=>({...p,conditions:[...(p.conditions||[]),emptyCondition()]}))}
                        style={{background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.25)',borderRadius:'6px',padding:'0.35rem 0.85rem',fontSize:'0.78rem',fontWeight:700,cursor:'pointer',marginTop:'0.25rem'}}>
                        + Add Condition
                      </button>
                    </div>

                    <div style={{display:'flex',gap:'0.6rem',flexWrap:'wrap'}}>
                      <button onClick={()=>runCustomScan(newFilter)}
                        style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'7px',padding:'0.45rem 1.2rem',fontWeight:800,fontSize:'0.82rem',cursor:'pointer'}}>
                        ▶ Run Now
                      </button>
                      <button onClick={saveFilter}
                        style={{background:'rgba(0,255,136,0.1)',color:'var(--accent)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'7px',padding:'0.45rem 1.2rem',fontWeight:700,fontSize:'0.82rem',cursor:'pointer'}}>
                        💾 Save Filter
                      </button>
                    </div>
                  </div>

                  {/* Saved filters */}
                  {customFilters.length > 0 && (
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1.1rem'}}>
                      <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:'0.85rem'}}>💾 Saved Filters ({customFilters.length})</div>
                      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
                        {customFilters.map((f,i) => (
                          <div key={i} style={{background:'var(--bg-dark)',borderRadius:'9px',padding:'0.75rem 1rem',border:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'0.5rem'}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:'0.25rem'}}>{f.name}</div>
                              <div style={{fontSize:'0.72rem',color:'var(--text-dim)'}}>
                                {f.conditions.map((c,ci)=>{
                                  const m=METRICS.find(x=>x.id===c.metric);
                                  return `${m?.label||c.metric} ${c.op} ${c.value}`;
                                }).join(' AND ')}
                              </div>
                            </div>
                            <div style={{display:'flex',gap:'0.4rem'}}>
                              <button onClick={()=>runCustomScan(f)}
                                style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.35rem 0.85rem',fontWeight:700,fontSize:'0.78rem',cursor:'pointer'}}>
                                ▶ Run
                              </button>
                              <button onClick={()=>setNewFilter({...f})}
                                style={{background:'rgba(129,140,248,0.1)',color:'#818cf8',border:'1px solid rgba(129,140,248,0.25)',borderRadius:'6px',padding:'0.35rem 0.7rem',fontSize:'0.78rem',cursor:'pointer'}}>
                                Edit
                              </button>
                              <button onClick={()=>setCustomFilters(p=>p.filter((_,j)=>j!==i))}
                                style={{background:'rgba(248,113,113,0.08)',color:'#f87171',border:'1px solid rgba(248,113,113,0.2)',borderRadius:'6px',padding:'0.35rem 0.7rem',fontSize:'0.78rem',cursor:'pointer'}}>
                                🗑
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {customFilters.length === 0 && (
                    <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-dim)',fontSize:'0.82rem',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px'}}>
                      No saved filters yet. Build one above and click <strong>Save Filter</strong>.
                    </div>
                  )}
                </div>
              );
            })()}
          </>
          </ProGate>
        ) : activeTab === 'journal' ? (
          <div>
            {/* Sign-in prompt for journal sync */}
            {!currentUser && (
              <div style={{background:'#0f2027',border:'1px solid #1e3a5f',borderRadius:'10px',padding:'1rem 1.25rem',marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,color:'#93c5fd'}}>☁️ Sign in to sync your journal across devices</div>
                  <div style={{fontSize:'0.8rem',color:'var(--text-dim)',marginTop:'0.2rem'}}>Currently saving to this browser only. Sign in to never lose your trade history.</div>
                </div>
                <button onClick={()=>setShowAuthModal(true)} style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.85rem',whiteSpace:'nowrap'}}>Sign In Free</button>
              </div>
            )}

            {/* Cooldown Banner */}
            {cooldownActive && cooldownEnd && new Date()<cooldownEnd && (
              <div style={{background:'linear-gradient(135deg,#7f1d1d,#991b1b)',border:'2px solid #ef4444',borderRadius:'12px',padding:'1.25rem 1.5rem',marginBottom:'1.5rem',display:'flex',alignItems:'center',gap:'1rem',flexWrap:'wrap'}}>
                <div style={{fontSize:'2rem'}}>🛑</div>
                <div style={{flex:1}}>
                  <div style={{color:'#fca5a5',fontWeight:700,fontSize:'1.1rem'}}>COOLDOWN ACTIVE  -  Stop Trading</div>
                  <div style={{color:'#fecaca',fontSize:'0.85rem',marginTop:'0.25rem'}}>2+ consecutive losses detected. Cooldown until {cooldownEnd.toLocaleTimeString()}. Step away, review your journal, return with clarity.</div>
                </div>
                <button onClick={()=>setCooldownActive(false)} style={{background:'#7f1d1d',border:'1px solid #ef4444',color:'#fca5a5',borderRadius:'6px',padding:'0.4rem 0.8rem',cursor:'pointer',fontSize:'0.8rem'}}>Override (not recommended)</button>
              </div>
            )}

            {/* Stats Row */}
            {(() => { const s=journalStats(); return (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'0.75rem',marginBottom:'1.5rem'}}>
                {[['Total Trades',s.total,'📊'],['Win Rate',s.winRate+'%','🎯'],[`Total P&L`,'₹'+parseInt(s.totalPnl).toLocaleString(),parseFloat(s.totalPnl)>=0?'🟢':'🔴'],['Avg Win','₹'+s.avgWin,'💚'],['Avg Loss','₹'+s.avgLoss,'❤'],['Impulse Trades',s.impulse,'⚠️']].map(([label,val,icon])=>(
                  <div key={label} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem',textAlign:'center'}}>
                    <div style={{fontSize:'1.4rem'}}>{icon}</div>
                    <div style={{fontSize:'1.2rem',fontWeight:700,color:'var(--accent)',marginTop:'0.25rem'}}>{val}</div>
                    <div style={{fontSize:'0.72rem',color:'var(--text-dim)',marginTop:'0.15rem'}}>{label}</div>
                  </div>
                ))}
              </div>
            ); })()}


            {/* -- Equity Curve + Emotion Breakdown -- */}
            {tradeLog.filter(t=>t.pnl!==null).length > 1 && (() => {
              const closed = [...tradeLog].filter(t=>t.pnl!==null).reverse();
              // Cumulative P&L points
              let cum = 0;
              const points = closed.map(t => { cum += parseFloat(t.pnl); return cum; });
              const minPnl = Math.min(0, ...points);
              const maxPnl = Math.max(...points);
              const range  = maxPnl - minPnl || 1;
              const W = 700, H = 160, PAD = 30;
              const px = (i) => PAD + (i/(points.length-1||1))*(W-PAD*2);
              const py = (v) => H - PAD - ((v-minPnl)/range)*(H-PAD*2);
              const polyline = points.map((v,i)=>`${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
              const lastVal  = points[points.length-1];
              const lineColor = lastVal >= 0 ? '#4ade80' : '#f87171';
              // Emotion counts
              const emotions = {};
              tradeLog.forEach(t => { emotions[t.emotion] = (emotions[t.emotion]||0)+1; });
              const emotionColors = {Calm:'#4ade80',Confident:'#60a5fa',Anxious:'#fbbf24',Excited:'#a78bfa',Fearful:'#f87171',Greedy:'#fb923c'};
              return (
                <div className="gainers-losers-grid" style={{display:'grid',gap:'1rem',marginBottom:'1.5rem'}}>
                  {/* Equity Curve */}
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
                      <span style={{fontWeight:600,fontSize:'0.9rem'}}>📈 Equity Curve</span>
                      <span style={{color:lastVal>=0?'#4ade80':'#f87171',fontWeight:700,fontSize:'0.95rem'}}>
                        {lastVal>=0?'+':''}₹{parseInt(lastVal).toLocaleString()}
                      </span>
                    </div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'130px'}}>
                      {/* Zero line */}
                      <line x1={PAD} y1={py(0).toFixed(1)} x2={W-PAD} y2={py(0).toFixed(1)} stroke="#334155" strokeWidth="1" strokeDasharray="4"/>
                      {/* Area fill */}
                      <polygon
                        points={`${px(0)},${py(0)} ${polyline} ${px(points.length-1)},${py(0)}`}
                        fill={lineColor} fillOpacity="0.12"
                      />
                      {/* Line */}
                      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round"/>
                      {/* Last point dot */}
                      <circle cx={px(points.length-1).toFixed(1)} cy={py(lastVal).toFixed(1)} r="4" fill={lineColor}/>
                      {/* Labels */}
                      <text x={PAD} y={H-8} fill="#64748b" fontSize="11">{closed[0] ? new Date(closed[0].timestamp).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : ''}</text>
                      <text x={W-PAD} y={H-8} fill="#64748b" fontSize="11" textAnchor="end">{closed[closed.length-1] ? new Date(closed[closed.length-1].timestamp).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : ''}</text>
                      <text x={PAD} y={py(maxPnl)-5} fill="#64748b" fontSize="10">₹{parseInt(maxPnl).toLocaleString()}</text>
                      <text x={PAD} y={py(minPnl)+12} fill="#64748b" fontSize="10">₹{parseInt(minPnl).toLocaleString()}</text>
                    </svg>
                  </div>

                  {/* Emotion Breakdown */}
                  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px',padding:'1rem'}}>
                    <div style={{fontWeight:600,fontSize:'0.9rem',marginBottom:'0.75rem'}}>🧠 Emotion Breakdown</div>
                    {Object.entries(emotions).sort((a,b)=>b[1]-a[1]).map(([em,count])=>{
                      const pct = ((count/tradeLog.length)*100).toFixed(0);
                      return (
                        <div key={em} style={{marginBottom:'0.5rem'}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:'0.8rem',marginBottom:'2px'}}>
                            <span style={{color:emotionColors[em]||'var(--text-main)'}}>{em}</span>
                            <span style={{color:'var(--text-dim)'}}>{count} trade{count>1?'s':''}  |  {pct}%</span>
                          </div>
                          <div style={{background:'#1e293b',borderRadius:'99px',height:'6px',overflow:'hidden'}}>
                            <div style={{width:`${pct}%`,height:'100%',background:emotionColors[em]||'var(--accent)',borderRadius:'99px',transition:'width 0.4s'}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.5rem'}}>
              <h2 style={{margin:0}}>🧠 Trade Journal & Psychology Tracker</h2>
              <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
                <select value={journalFilter} onChange={e=>setJournalFilter(e.target.value)} style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem 0.7rem',fontSize:'0.85rem'}}>
                  <option value="all">All Trades</option>
                  <option value="wins">Wins Only</option>
                  <option value="losses">Losses Only</option>
                  <option value="impulse">Impulse Trades</option>
                  <option value="open">Open Trades</option>
                </select>
                <button onClick={()=>setShowTradeEntry(true)} style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.85rem'}}>+ Log Trade</button>
              </div>
            </div>

            {/* Trade Entry Modal */}
            {showTradeEntry && (
              <div className="modal-overlay" onClick={()=>setShowTradeEntry(false)}>
                <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'480px',width:'95%',maxHeight:'90vh',overflowY:'auto'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
                    <h3 style={{margin:0}}>📝 Log Trade</h3>
                    <button onClick={()=>setShowTradeEntry(false)} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.4rem',cursor:'pointer'}}>✕</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
                    {[['symbol','Symbol',['NIFTY','BANKNIFTY','FINNIFTY','RELIANCE','TCS','HDFCBANK','ICICIBANK','SBIN','INFY','ITC','AXISBANK'],'select'],['type','Option Type',['CE','PE'],'select'],['action','Action',['BUY','SELL'],'select'],['strike','Strike Price','','text'],['expiry','Expiry Date','','text'],['qty','Qty (Lots)','','number'],['entryPrice','Entry Price','','number'],['exitPrice','Exit Price (if closed)','','number'],['emotion','Emotion Before Trade',['Calm','Confident','Anxious','Excited','Fearful','Greedy'],'select'],['reason','Trade Reason',['Setup','Trend Follow','Reversal','Scalp','Hedge','FOMO','Revenge','Boredom','Tip/News'],'select']].map(([field,label,opts,type])=>(
                      <div key={field} style={{display:'flex',flexDirection:'column',gap:'0.25rem'}}>
                        <label style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>{label}</label>
                        {type==='select'?(<select className="input-field" value={tradeForm[field]} onChange={e=>setTradeForm(p=>({...p,[field]:e.target.value}))} style={{fontSize:'0.85rem',padding:'0.4rem'}}>{opts.map(o=><option key={o} value={o}>{o}</option>)}</select>):(<input type={type} className="input-field" value={tradeForm[field]} onChange={e=>setTradeForm(p=>({...p,[field]:e.target.value}))} placeholder={label} style={{fontSize:'0.85rem',padding:'0.4rem'}}/>)}
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:'0.75rem'}}>
                    <label style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>Notes / Learnings</label>
                    <textarea className="input-field" rows="2" value={tradeForm.notes} onChange={e=>setTradeForm(p=>({...p,notes:e.target.value}))} placeholder="What did you learn? What would you do differently?" style={{width:'100%',boxSizing:'border-box',marginTop:'0.25rem',fontSize:'0.85rem'}}/>
                  </div>
                  {['FOMO','Revenge','Boredom'].includes(tradeForm.reason) && (
                    <div style={{background:'#451a03',border:'1px solid #f97316',borderRadius:'6px',padding:'0.6rem 0.75rem',marginTop:'0.5rem',fontSize:'0.82rem',color:'#fed7aa'}}>
                      ⚠️ <b>Warning:</b> You selected <b>{tradeForm.reason}</b> as your reason. These are high-risk emotional trades. Consider waiting 15 minutes before entering.
                    </div>
                  )}
                  <div className="modal-buttons" style={{marginTop:'1rem'}}>
                    <button className="btn-secondary" onClick={()=>setShowTradeEntry(false)}>Cancel</button>
                    <button className="btn-primary" onClick={()=>{ addTradeWithSync(tradeForm); setShowTradeEntry(false); setTradeForm({symbol:'NIFTY',type:'CE',strike:'',expiry:'',action:'BUY',qty:1,entryPrice:'',exitPrice:'',notes:'',emotion:'Calm',reason:'Setup'}); }}>Save Trade</button>
                  </div>
                </div>
              </div>
            )}

            {/* Trade List */}
            {tradeLog.filter(t => journalFilter==='all'?true:journalFilter==='wins'?t.pnl&&parseFloat(t.pnl)>0:journalFilter==='losses'?t.pnl&&parseFloat(t.pnl)<0:journalFilter==='impulse'?['FOMO','Revenge','Boredom'].includes(t.reason):t.pnl===null).length === 0 ? (
              <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                <div style={{fontSize:'3rem',marginBottom:'1rem'}}>📝</div>
                <p>No trades logged yet. Click <b>+ Log Trade</b> to start tracking.</p>
                <p style={{fontSize:'0.85rem',marginTop:'0.5rem'}}>Tracking your trades is the fastest way to improve as a trader.</p>
              </div>
            ) : tradeLog.filter(t => journalFilter==='all'?true:journalFilter==='wins'?t.pnl&&parseFloat(t.pnl)>0:journalFilter==='losses'?t.pnl&&parseFloat(t.pnl)<0:journalFilter==='impulse'?['FOMO','Revenge','Boredom'].includes(t.reason):t.pnl===null).map(trade=>(
              <div key={trade.id} style={{background:'var(--bg-card)',border:`1px solid ${trade.pnl===null?'var(--border)':parseFloat(trade.pnl)>=0?'#166534':'#991b1b'}`,borderRadius:'10px',padding:'1rem',marginBottom:'0.75rem',position:'relative'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'0.5rem'}}>
                  <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontWeight:700,fontSize:'1rem'}}>{trade.symbol} {trade.strike} {trade.type}</span>
                    <span style={{background:trade.action==='BUY'?'#166534':'#991b1b',color:'white',padding:'1px 8px',borderRadius:'99px',fontSize:'0.75rem'}}>{trade.action}</span>
                    {['FOMO','Revenge','Boredom'].includes(trade.reason) && <span style={{background:'#451a03',color:'#f97316',padding:'1px 8px',borderRadius:'99px',fontSize:'0.72rem'}}>⚠️ {trade.reason}</span>}
                    <span style={{background:'#1e293b',color:'var(--text-dim)',padding:'1px 8px',borderRadius:'99px',fontSize:'0.72rem'}}>{trade.emotion}</span>
                  </div>
                  <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                    {trade.pnl!==null && <span style={{fontWeight:700,fontSize:'1.1rem',color:parseFloat(trade.pnl)>=0?'#4ade80':'#f87171'}}>{parseFloat(trade.pnl)>=0?'+':''}₹{parseInt(trade.pnl).toLocaleString()}</span>}
                    {trade.pnl===null && <span style={{color:'#fbbf24',fontSize:'0.82rem'}}>● Open</span>}
                    <button onClick={()=>deleteTrade(trade.id)} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'1rem',padding:'0 0.2rem'}}>🗑️</button>
                  </div>
                </div>
                <div style={{display:'flex',gap:'1rem',marginTop:'0.5rem',fontSize:'0.8rem',color:'var(--text-dim)',flexWrap:'wrap'}}>
                  <span>Entry: <b style={{color:'var(--text-main)'}}>₹{trade.entryPrice}</b></span>
                  {trade.exitPrice && <span>Exit: <b style={{color:'var(--text-main)'}}>₹{trade.exitPrice}</b></span>}
                  <span>Qty: <b style={{color:'var(--text-main)'}}>{trade.qty} lot{trade.qty>1?'s':''}</b></span>
                  <span>Reason: <b style={{color:'var(--text-main)'}}>{trade.reason}</b></span>
                  <span>{new Date(trade.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                </div>
                {trade.notes && <div style={{marginTop:'0.4rem',fontSize:'0.8rem',color:'#93c5fd',fontStyle:'italic'}}>💬 {trade.notes}</div>}
              </div>
            ))}
          </div>
        ) : activeTab === 'paper' ? (
          <div className="main-content">
            <div className="page-header">
              <h1>📝 Paper Trading</h1>
              <p className="subtitle">Practice with virtual money  -  zero real capital at risk</p>
            </div>

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'1rem',marginBottom:'1.5rem'}}>
              {[
                { label:'Virtual Balance', value:`₹${paperBalance.toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'var(--accent)' },
                { label:'Open Positions', value:paperPositions.length, color:'var(--blue)' },
                { label:'Total Trades', value:paperHistory.length, color:'var(--yellow)' },
                { label:'Realised P&L', value:`${paperHistory.filter(t=>t.pnl!=null).reduce((s,t)=>s+t.pnl,0)>=0?'+':''}₹${paperHistory.filter(t=>t.pnl!=null).reduce((s,t)=>s+t.pnl,0).toLocaleString('en-IN',{maximumFractionDigits:0})}`, color: paperHistory.filter(t=>t.pnl!=null).reduce((s,t)=>s+t.pnl,0)>=0?'var(--green)':'var(--red)' },
              ].map(({label,value,color})=>(
                <div key={label} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1rem',textAlign:'center'}}>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'0.4rem'}}>{label}</div>
                  <div style={{fontSize:'1.4rem',fontWeight:800,color}}>{value}</div>
                </div>
              ))}
            </div>

            {/* Order Form */}
            <div className="panel" style={{marginBottom:'1.5rem'}}>
              <h3 style={{marginBottom:'1rem'}}>📤 Place Order</h3>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'0.75rem',marginBottom:'1rem'}}>
                <div>
                  <label style={{fontSize:'0.78rem',color:'var(--text-dim)',display:'block',marginBottom:'0.3rem'}}>Symbol</label>
                  <input className="input-field" value={paperOrder.symbol}
                    onChange={e=>setPaperOrder(o=>({...o,symbol:e.target.value.toUpperCase()}))}
                    placeholder="NIFTY / RELIANCE" />
                </div>
                <div>
                  <label style={{fontSize:'0.78rem',color:'var(--text-dim)',display:'block',marginBottom:'0.3rem'}}>Action</label>
                  <select className="input-field" value={paperOrder.type} onChange={e=>setPaperOrder(o=>({...o,type:e.target.value}))}>
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:'0.78rem',color:'var(--text-dim)',display:'block',marginBottom:'0.3rem'}}>Quantity</label>
                  <input className="input-field" type="number" min="1" value={paperOrder.qty}
                    onChange={e=>setPaperOrder(o=>({...o,qty:parseInt(e.target.value)||1}))} />
                </div>
                <div>
                  <label style={{fontSize:'0.78rem',color:'var(--text-dim)',display:'block',marginBottom:'0.3rem'}}>Order Type</label>
                  <select className="input-field" value={paperOrder.orderType} onChange={e=>setPaperOrder(o=>({...o,orderType:e.target.value}))}>
                    <option value="MARKET">MARKET (live price)</option>
                    <option value="LIMIT">LIMIT (enter price)</option>
                  </select>
                </div>
                {paperOrder.orderType === 'LIMIT' && (
                  <div>
                    <label style={{fontSize:'0.78rem',color:'var(--text-dim)',display:'block',marginBottom:'0.3rem'}}>Price ₹</label>
                    <input className="input-field" type="number" value={paperOrder.price}
                      onChange={e=>setPaperOrder(o=>({...o,price:e.target.value}))} placeholder="0.00" />
                  </div>
                )}
              </div>
              <div style={{display:'flex',gap:'0.75rem',alignItems:'center',flexWrap:'wrap'}}>
                <button onClick={executePaperOrder}
                  style={{background:paperOrder.type==='BUY'?'#22c55e':'#ef4444',color:'white',border:'none',borderRadius:'8px',padding:'0.65rem 1.5rem',fontWeight:700,fontSize:'0.95rem',cursor:'pointer'}}>
                  {paperOrder.type==='BUY'?'🟢 BUY':'🔴 SELL'} {paperOrder.symbol}
                </button>
                <button onClick={resetPaperAccount}
                  style={{background:'var(--bg-surface)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.65rem 1rem',fontSize:'0.85rem',cursor:'pointer'}}>
                  🔄 Reset Account
                </button>
                {paperMsg && (
                  <span style={{fontSize:'0.9rem',fontWeight:600,color:paperMsg.startsWith('✅')?'var(--green)':'var(--red)',flex:1}}>
                    {paperMsg}
                  </span>
                )}
              </div>
            </div>

            {/* Open Positions */}
            {paperPositions.length > 0 && (
              <div className="panel" style={{marginBottom:'1.5rem'}}>
                <h3 style={{marginBottom:'1rem'}}>📊 Open Positions</h3>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr>
                        {['Symbol','Qty','Avg Price','Entered','Action'].map(h=>(
                          <th key={h} style={{padding:'0.6rem 0.85rem',textAlign:'left',color:'var(--text-dim)',fontSize:'0.78rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:'1px solid var(--border)',background:'var(--bg-surface)'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paperPositions.map(pos=>(
                        <tr key={pos.symbol} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                          <td style={{padding:'0.65rem 0.85rem',fontWeight:700,color:'var(--accent)'}}>{pos.symbol}</td>
                          <td style={{padding:'0.65rem 0.85rem'}}>{pos.qty}</td>
                          <td style={{padding:'0.65rem 0.85rem'}}>₹{pos.avgPrice.toFixed(2)}</td>
                          <td style={{padding:'0.65rem 0.85rem',fontSize:'0.82rem',color:'var(--text-dim)'}}>{pos.buyTime}</td>
                          <td style={{padding:'0.65rem 0.85rem'}}>
                            <button onClick={()=>setPaperOrder({symbol:pos.symbol,type:'SELL',qty:pos.qty,price:'',orderType:'MARKET'})}
                              style={{background:'var(--red-dim)',color:'var(--red)',border:'none',borderRadius:'6px',padding:'0.3rem 0.8rem',fontSize:'0.82rem',cursor:'pointer',fontWeight:700}}>
                              Close Position
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Trade History */}
            {paperHistory.length > 0 ? (
              <div className="panel">
                <h3 style={{marginBottom:'1rem'}}>📋 Trade History</h3>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr>
                        {['Time','Symbol','Type','Qty','Price','P&L'].map(h=>(
                          <th key={h} style={{padding:'0.6rem 0.85rem',textAlign:'left',color:'var(--text-dim)',fontSize:'0.78rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',borderBottom:'1px solid var(--border)',background:'var(--bg-surface)'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paperHistory.slice(0,50).map(t=>(
                        <tr key={t.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                          <td style={{padding:'0.6rem 0.85rem',fontSize:'0.8rem',color:'var(--text-dim)'}}>{t.time}</td>
                          <td style={{padding:'0.6rem 0.85rem',fontWeight:700}}>{t.symbol}</td>
                          <td style={{padding:'0.6rem 0.85rem'}}>
                            <span style={{color:t.type==='BUY'?'var(--green)':'var(--red)',fontWeight:700,fontSize:'0.85rem'}}>{t.type}</span>
                          </td>
                          <td style={{padding:'0.6rem 0.85rem'}}>{t.qty}</td>
                          <td style={{padding:'0.6rem 0.85rem'}}>₹{t.price.toFixed(2)}</td>
                          <td style={{padding:'0.6rem 0.85rem',fontWeight:700,color:t.pnl==null?'var(--text-muted)':t.pnl>=0?'var(--green)':'var(--red)'}}>
                            {t.pnl==null?'OPEN':`${t.pnl>=0?'+':''}₹${t.pnl.toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : paperPositions.length === 0 && (
              <div style={{textAlign:'center',padding:'3rem 1rem',color:'var(--text-muted)'}}>
                <div style={{fontSize:'3rem',marginBottom:'1rem'}}>📝</div>
                <div style={{fontSize:'1.15rem',fontWeight:700,marginBottom:'0.5rem',color:'var(--text-main)'}}>No trades yet</div>
                <div style={{fontSize:'0.9rem'}}>Place your first order above. You start with ₹5,00,000 virtual balance.</div>
              </div>
            )}
          </div>
        ) : activeTab === 'portfolio' ? (
          <div>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.75rem'}}>
              <div>
                <h2 style={{margin:0}}>Portfolio</h2>
                <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:'0.2rem 0 0'}}>Live positions, holdings and funds</p>
              </div>
              {selectedBroker !== 'manual' && (
                <button onClick={()=>fetchPortfolio()} disabled={portfolioLoading}
                  style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.5rem 1.2rem',fontWeight:700,cursor:'pointer'}}>
                  {portfolioLoading ? 'Loading...' : 'Refresh'}
                </button>
              )}
            </div>

            {/* Broker Selector */}
            <div style={{display:'flex',gap:'0.5rem',marginBottom:'1.25rem',flexWrap:'wrap'}}>
              {[
                {id:'dhan',   label:'Dhan',        ready:true},
                {id:'zerodha',label:'Zerodha',      ready:true},
                {id:'angel',  label:'Angel One',    ready:true},
                {id:'manual', label:'Manual / Screenshot', ready:true},
                {id:'upstox', label:'Upstox',       ready:false},
              ].map(({id,label,ready})=>(
                <button key={id} onClick={()=>{if(ready){setSelectedBroker(id);setPortfolio(null);setPortfolioError('');}}}
                  style={{padding:'0.4rem 0.85rem',borderRadius:'20px',fontSize:'0.8rem',fontWeight:700,
                    cursor:ready?'pointer':'default',opacity:ready?1:0.5,
                    background:selectedBroker===id?'var(--accent)':'var(--bg-surface)',
                    color:selectedBroker===id?'#000':'var(--text-dim)',
                    border:selectedBroker===id?'2px solid var(--accent)':'1px solid var(--border)'}}>
                  {label}{!ready?' (soon)':''}
                </button>
              ))}
            </div>

            {portfolioError && (
              <div style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:'10px',padding:'1rem',marginBottom:'1rem',color:'#f87171',fontSize:'0.88rem'}}>
                {portfolioError}
              </div>
            )}

            {/* DHAN */}
            {selectedBroker === 'dhan' && (
              isPro ? (
              <div>
                {!portfolio && !portfolioLoading && (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'3rem',marginBottom:'1rem'}}>💼</div>
                    <p style={{marginBottom:'1rem'}}>Click Refresh to load your Dhan portfolio</p>
                    <button onClick={()=>fetchPortfolio('dhan')}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.75rem 2rem',fontWeight:700,cursor:'pointer'}}>
                      Load Portfolio
                    </button>
                  </div>
                )}
                {portfolio && portfolio.funds && (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'0.75rem',marginBottom:'1.25rem'}}>
                    {[
                      {label:'Available',    value:portfolio.funds.availabelBalance||portfolio.funds.availableBalance||0, color:'#4ade80'},
                      {label:'Used Margin',  value:portfolio.funds.utilizedAmount||0,  color:'#f87171'},
                      {label:'Total',        value:portfolio.funds.sodLimit||0,         color:'var(--text-main)'},
                      {label:'Withdrawable', value:portfolio.funds.withdrawableBalance||0, color:'#38bdf8'},
                    ].map(({label,value,color})=>(
                      <div key={label} className="panel" style={{textAlign:'center',padding:'0.85rem'}}>
                        <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'0.3rem'}}>{label}</div>
                        <div style={{fontSize:'1.1rem',fontWeight:700,color}}>Rs {Number(value).toLocaleString('en-IN',{maximumFractionDigits:0})}</div>
                      </div>
                    ))}
                  </div>
                )}
                {portfolio && portfolio.positions && portfolio.positions.length > 0 && (
                  <div className="panel" style={{marginBottom:'1.25rem',overflowX:'auto'}}>
                    <h3 style={{marginTop:0,marginBottom:'1rem'}}>Open Positions</h3>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.83rem'}}>
                      <thead><tr style={{background:'var(--bg-surface)'}}>
                        {['Symbol','Qty','Avg','LTP','P&L','Product'].map(h=>(
                          <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',color:'var(--text-muted)',fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',borderBottom:'1px solid var(--border)'}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {portfolio.positions.map((pos,i)=>{
                          const qty=Number(pos.netQty||pos.quantity||0);
                          const avg=Number(pos.costPrice||pos.buyAvg||0);
                          const ltp=Number(pos.ltp||0);
                          const pnl=(ltp-avg)*qty;
                          return (
                            <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700}}>{pos.tradingSymbol||pos.symbol}</td>
                              <td style={{padding:'0.6rem 0.75rem',color:qty>=0?'#4ade80':'#f87171',fontWeight:700}}>{qty>0?'+':''}{qty}</td>
                              <td style={{padding:'0.6rem 0.75rem'}}>Rs {avg.toFixed(2)}</td>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700}}>Rs {ltp.toFixed(2)}</td>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700,color:pnl>=0?'#4ade80':'#f87171'}}>{pnl>=0?'+':''}Rs {pnl.toFixed(0)}</td>
                              <td style={{padding:'0.6rem 0.75rem',color:'var(--text-muted)',fontSize:'0.78rem'}}>{pos.productType||'-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {portfolio && portfolio.holdings && portfolio.holdings.length > 0 && (
                  <div className="panel" style={{overflowX:'auto'}}>
                    <h3 style={{marginTop:0,marginBottom:'1rem'}}>Holdings</h3>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.83rem'}}>
                      <thead><tr style={{background:'var(--bg-surface)'}}>
                        {['Symbol','Qty','Avg Cost','LTP','Value','P&L','Return'].map(h=>(
                          <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',color:'var(--text-muted)',fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',borderBottom:'1px solid var(--border)'}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {portfolio.holdings.map((h,i)=>{
                          const qty=Number(h.totalQty||h.quantity||0);
                          const avg=Number(h.avgCostPrice||0);
                          const ltp=Number(h.ltp||0);
                          const pnl=(ltp-avg)*qty;
                          const ret=avg?((ltp-avg)/avg*100):0;
                          return (
                            <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700}}>{h.tradingSymbol||h.symbol}</td>
                              <td style={{padding:'0.6rem 0.75rem'}}>{qty}</td>
                              <td style={{padding:'0.6rem 0.75rem'}}>Rs {avg.toFixed(2)}</td>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700}}>Rs {ltp.toFixed(2)}</td>
                              <td style={{padding:'0.6rem 0.75rem'}}>Rs {(ltp*qty).toLocaleString('en-IN',{maximumFractionDigits:0})}</td>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700,color:pnl>=0?'#4ade80':'#f87171'}}>{pnl>=0?'+':''}Rs {pnl.toFixed(0)}</td>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:700,color:ret>=0?'#4ade80':'#f87171'}}>{ret>=0?'+':''}{ret.toFixed(2)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {portfolio && (!portfolio.positions || portfolio.positions.length===0) && (!portfolio.holdings || portfolio.holdings.length===0) && (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
                    <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>💼</div>
                    <div>No open positions or holdings found</div>
                  </div>
                )}
              </div>
              ) : (
                <ProGate isActive={false} onUpgrade={openUpgrade}
                  feature="Live Dhan Portfolio Sync"
                  description="See your real positions, holdings, funds and live P&L from Dhan — updated every 30 seconds. Upgrade to Pro to connect your broker."/>
)
            )}

            {/* ZERODHA */}
            {selectedBroker === 'zerodha' && (
              isPro ? (
              <div className="panel">
                <h3 style={{marginTop:0,color:'#4ade80'}}>Zerodha Kite Connect</h3>
                <p style={{fontSize:'0.82rem',color:'var(--text-dim)',lineHeight:1.7}}>
                  Zerodha requires a daily access token.<br/>
                  1. Get your API key configured with us (one-time setup)<br/>
                  2. Login to Kite and copy access token from browser URL<br/>
                  3. Paste below
                </p>
                <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginTop:'1rem'}}>
                  <input value={zerodhaToken}
                    onChange={e=>{setZerodhaToken(e.target.value);localStorage.setItem('db_zerodha_token',e.target.value);}}
                    placeholder="Paste Zerodha access token..." type="password"
                    style={{flex:1,minWidth:'200px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.6rem 1rem',color:'var(--text-main)',fontSize:'0.85rem'}}/>
                  <button onClick={()=>fetchPortfolio('zerodha')} disabled={!zerodhaToken||portfolioLoading}
                    style={{background:'#4ade80',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.2rem',fontWeight:700,cursor:'pointer'}}>
                    {portfolioLoading ? 'Loading...' : 'Load'}
                  </button>
                </div>
              </div>
              ) : (
                <ProGate isActive={false} onUpgrade={openUpgrade}
                  feature="Live Zerodha Portfolio Sync"
                  description="Connect your Zerodha account to see live positions and holdings. Pro feature."/>
)
            )}

            {/* ANGEL ONE */}
            {selectedBroker === 'angel' && (
              isPro ? (
              <div className="panel">
                <h3 style={{marginTop:0,color:'#f97316'}}>Angel One SmartAPI</h3>
                <p style={{fontSize:'0.82rem',color:'var(--text-dim)',lineHeight:1.7}}>
                  1. Login to Angel One SmartAPI dashboard<br/>
                  2. Generate a session and copy your JWT token<br/>
                  3. Paste your API key and JWT below
                </p>
                <div style={{display:'flex',flexDirection:'column',gap:'0.5rem',maxWidth:'460px',marginTop:'1rem'}}>
                  <input value={angelApiKey}
                    onChange={e=>{setAngelApiKey(e.target.value);localStorage.setItem('db_angel_apikey',e.target.value);}}
                    placeholder="Angel One API Key"
                    style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.6rem 1rem',color:'var(--text-main)',fontSize:'0.85rem'}}/>
                  <input value={angelJwt}
                    onChange={e=>{setAngelJwt(e.target.value);localStorage.setItem('db_angel_jwt',e.target.value);}}
                    placeholder="Angel One JWT Token" type="password"
                    style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.6rem 1rem',color:'var(--text-main)',fontSize:'0.85rem'}}/>
                  <button onClick={()=>fetchPortfolio('angel')} disabled={!angelJwt||portfolioLoading}
                    style={{background:'#f97316',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.2rem',fontWeight:700,cursor:'pointer',width:'fit-content'}}>
                    {portfolioLoading ? 'Loading...' : 'Load Portfolio'}
                  </button>
                </div>
              </div>
              ) : (
                <ProGate isActive={false} onUpgrade={openUpgrade}
                  feature="Live Angel One Portfolio Sync"
                  description="Connect your Angel One SmartAPI to see live positions and P&L. Pro feature."/>
)
            )}

            {/* MANUAL + SCREENSHOT */}
            {selectedBroker === 'manual' && (
              <div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.5rem'}}>
                  <p style={{margin:0,fontSize:'0.85rem',color:'var(--text-dim)'}}>
                    {isPro ? 'Upload a screenshot from any broker or add positions manually.' : 'Add positions manually. Upgrade to Pro to import via AI screenshot.'}
                  </p>
                  <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
                    {isPro ? (
                      <label style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff',borderRadius:'8px',padding:'0.5rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.85rem',display:'inline-block'}}>
                        📸 Upload Screenshot
                        <input type="file" accept="image/*" style={{display:'none'}} onChange={handleScreenshotUpload}/>
                      </label>
                    ) : (
                      <button onClick={openUpgrade}
                        style={{background:'rgba(99,102,241,0.15)',border:'1px solid rgba(99,102,241,0.4)',color:'#818cf8',borderRadius:'8px',padding:'0.5rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.85rem'}}>
                        🔒 Screenshot Import (Pro)
                      </button>
                    )}
                    <button onClick={()=>setShowManualForm(f=>!f)}
                      style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.5rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.85rem'}}>
                      + Add Position
                    </button>
                  </div>
                </div>

                {(screenshotPreview || screenshotAnalyzing || screenshotResult || screenshotError) && (
                  <div className="panel" style={{marginBottom:'1.25rem',border:'1px solid rgba(99,102,241,0.4)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
                      <h3 style={{margin:0,color:'#818cf8'}}>Screenshot Analysis</h3>
                      <button onClick={()=>{setScreenshotPreview(null);setScreenshotFile(null);setScreenshotResult(null);setScreenshotError('');}}
                        style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'1.2rem'}}>X</button>
                    </div>
                    {screenshotPreview && !screenshotResult && !screenshotAnalyzing && (
                      <div style={{display:'flex',gap:'1rem',alignItems:'flex-start',flexWrap:'wrap'}}>
                        <img src={screenshotPreview} alt="preview"
                          style={{maxWidth:'220px',maxHeight:'160px',borderRadius:'8px',border:'1px solid var(--border)',objectFit:'contain'}}/>
                        <div>
                          <p style={{fontSize:'0.85rem',color:'var(--text-dim)',marginTop:0}}>
                            Works with Zerodha, Angel One, ICICI, HDFC, Upstox and more.
                          </p>
                          <button onClick={()=>analyzeScreenshot(screenshotFile)}
                            style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff',border:'none',borderRadius:'8px',padding:'0.65rem 1.5rem',fontWeight:700,cursor:'pointer'}}>
                            Analyze with AI
                          </button>
                        </div>
                      </div>
                    )}
                    {screenshotAnalyzing && (
                      <div style={{textAlign:'center',padding:'2rem',color:'#818cf8'}}>
                        <div style={{fontWeight:700}}>AI is reading your screenshot...</div>
                        <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginTop:'0.3rem'}}>Extracting positions, quantities, prices</div>
                      </div>
                    )}
                    {screenshotError && (
                      <div style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:'8px',padding:'0.85rem',color:'#f87171',fontSize:'0.85rem'}}>
                        {screenshotError}
                      </div>
                    )}
                    {screenshotResult && screenshotResult.length === 0 && (
                      <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-dim)'}}>
                        <div style={{fontWeight:600}}>No positions found in screenshot</div>
                        <div style={{fontSize:'0.82rem',marginTop:'0.25rem'}}>Try a clearer screenshot of the positions screen</div>
                      </div>
                    )}
                    {screenshotResult && screenshotResult.length > 0 && (
                      <div>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
                          <div style={{color:'#4ade80',fontWeight:700,fontSize:'0.88rem'}}>Found {screenshotResult.length} position(s)</div>
                          <button onClick={()=>importScreenshotPositions(screenshotResult)}
                            style={{background:'#4ade80',color:'#000',border:'none',borderRadius:'8px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                            Import All
                          </button>
                        </div>
                        <div style={{overflowX:'auto'}}>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
                            <thead><tr style={{background:'var(--bg-surface)'}}>
                              {['Symbol','Type','Qty','Avg','LTP','P&L','Product'].map(h=>(
                                <th key={h} style={{padding:'0.4rem 0.6rem',textAlign:'left',color:'var(--text-muted)',fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',borderBottom:'1px solid var(--border)'}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {screenshotResult.map((pos,i)=>(
                                <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                                  <td style={{padding:'0.5rem 0.6rem',fontWeight:700}}>{pos.symbol}</td>
                                  <td style={{padding:'0.5rem 0.6rem'}}>
                                    <span style={{padding:'2px 7px',borderRadius:'4px',fontSize:'0.7rem',fontWeight:700,
                                      background:pos.type==='BUY'?'rgba(74,222,128,0.15)':'rgba(248,113,113,0.15)',
                                      color:pos.type==='BUY'?'#4ade80':'#f87171'}}>
                                      {pos.type}
                                    </span>
                                  </td>
                                  <td style={{padding:'0.5rem 0.6rem'}}>{pos.qty}</td>
                                  <td style={{padding:'0.5rem 0.6rem'}}>Rs {Number(pos.avgPrice).toFixed(2)}</td>
                                  <td style={{padding:'0.5rem 0.6rem'}}>{pos.ltp ? 'Rs '+Number(pos.ltp).toFixed(2) : '-'}</td>
                                  <td style={{padding:'0.5rem 0.6rem',fontWeight:700,color:Number(pos.pnl)>=0?'#4ade80':'#f87171'}}>
                                    {pos.pnl ? (Number(pos.pnl)>=0?'+':'')+'Rs '+Number(pos.pnl).toFixed(0) : '-'}
                                  </td>
                                  <td style={{padding:'0.5rem 0.6rem',color:'var(--text-muted)',fontSize:'0.75rem'}}>{pos.product}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {showManualForm && (
                  <div className="panel" style={{marginBottom:'1.25rem'}}>
                    <h3 style={{marginTop:0,marginBottom:'1rem'}}>Add Position</h3>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'0.75rem',marginBottom:'1rem'}}>
                      {[
                        {key:'symbol',   label:'Symbol',    placeholder:'NIFTY25MAR24500CE', type:'text'},
                        {key:'qty',      label:'Quantity',  placeholder:'75',                type:'number'},
                        {key:'avgPrice', label:'Avg Price', placeholder:'150.50',            type:'number'},
                      ].map(({key,label,placeholder,type})=>(
                        <div key={key}>
                          <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'0.3rem',fontWeight:700,textTransform:'uppercase'}}>{label}</div>
                          <input value={manualForm[key]}
                            onChange={e=>setManualForm(f=>({...f,[key]:e.target.value}))}
                            placeholder={placeholder} type={type}
                            style={{width:'100%',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.5rem 0.75rem',color:'var(--text-main)',fontSize:'0.85rem',boxSizing:'border-box'}}/>
                        </div>
                      ))}
                      <div>
                        <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'0.3rem',fontWeight:700,textTransform:'uppercase'}}>Type</div>
                        <select value={manualForm.type} onChange={e=>setManualForm(f=>({...f,type:e.target.value}))}
                          style={{width:'100%',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.5rem 0.75rem',color:'var(--text-main)',fontSize:'0.85rem'}}>
                          <option value="BUY">BUY (Long)</option>
                          <option value="SELL">SELL (Short)</option>
                        </select>
                      </div>
                      <div>
                        <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'0.3rem',fontWeight:700,textTransform:'uppercase'}}>Product</div>
                        <select value={manualForm.product} onChange={e=>setManualForm(f=>({...f,product:e.target.value}))}
                          style={{width:'100%',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.5rem 0.75rem',color:'var(--text-main)',fontSize:'0.85rem'}}>
                          <option value="INTRADAY">Intraday (MIS)</option>
                          <option value="DELIVERY">Delivery (CNC)</option>
                          <option value="FUTURES">Futures (NRML)</option>
                          <option value="OPTIONS">Options (NRML)</option>
                        </select>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:'0.5rem'}}>
                      <button onClick={addManualPosition}
                        style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.6rem 1.5rem',fontWeight:700,cursor:'pointer'}}>
                        Add
                      </button>
                      <button onClick={()=>setShowManualForm(false)}
                        style={{background:'var(--bg-surface)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:'8px',padding:'0.6rem 1rem',cursor:'pointer'}}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {manualPositions.length === 0 ? (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
                    <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>✏️</div>
                    <div style={{fontWeight:700,color:'var(--text-main)',marginBottom:'0.5rem'}}>No positions yet</div>
                    <div style={{fontSize:'0.85rem'}}>Upload a screenshot or add positions manually</div>
                  </div>
                ) : (
                  <div className="panel" style={{overflowX:'auto'}}>
                    <h3 style={{marginTop:0,marginBottom:'1rem'}}>Manual Positions ({manualPositions.length})</h3>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.83rem'}}>
                      <thead><tr style={{background:'var(--bg-surface)'}}>
                        {['Symbol','Type','Qty','Avg Price','Product','Remove'].map(h=>(
                          <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',color:'var(--text-muted)',fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',borderBottom:'1px solid var(--border)'}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {manualPositions.map(pos=>(
                          <tr key={pos.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                            <td style={{padding:'0.6rem 0.75rem',fontWeight:700,fontSize:'0.82rem'}}>{pos.symbol}</td>
                            <td style={{padding:'0.6rem 0.75rem'}}>
                              <span style={{padding:'2px 8px',borderRadius:'4px',fontSize:'0.72rem',fontWeight:700,
                                background:pos.type==='BUY'?'rgba(74,222,128,0.15)':'rgba(248,113,113,0.15)',
                                color:pos.type==='BUY'?'#4ade80':'#f87171'}}>
                                {pos.type}
                              </span>
                            </td>
                            <td style={{padding:'0.6rem 0.75rem'}}>{pos.qty}</td>
                            <td style={{padding:'0.6rem 0.75rem'}}>Rs {Number(pos.avgPrice).toFixed(2)}</td>
                            <td style={{padding:'0.6rem 0.75rem',color:'var(--text-muted)',fontSize:'0.78rem'}}>{pos.product}</td>
                            <td style={{padding:'0.6rem 0.75rem'}}>
                              <button onClick={()=>removeManualPosition(pos.id)}
                                style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',color:'#f87171',borderRadius:'5px',padding:'2px 8px',cursor:'pointer',fontSize:'0.75rem'}}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'expiry' ? (
          <div>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem',flexWrap:'wrap',gap:'0.75rem'}}>
              <div>
                <h2 style={{margin:0,fontSize:'1.35rem'}}>⏰ Expiry Day Tools</h2>
                <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:'0.2rem 0 0'}}>Max Pain  |  PCR  |  OI Analysis  |  Key Levels</p>
              </div>
              <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                {['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'].map(sym => (
                  <button key={sym} onClick={() => { setExpirySymbol(sym); setExpiryData(null); fetchExpiryData(sym); }}
                    style={{padding:'0.35rem 0.75rem',borderRadius:'20px',border:'1px solid var(--border)',cursor:'pointer',fontSize:'0.8rem',fontWeight:expirySymbol===sym?700:400,background:expirySymbol===sym?'var(--accent)':'var(--bg-surface)',color:expirySymbol===sym?'#000':'var(--text-dim)'}}>
                    {sym}
                  </button>
                ))}
                <button onClick={() => fetchExpiryData(expirySymbol)} disabled={expiryLoading}
                  style={{padding:'0.35rem 1rem',borderRadius:'8px',border:'none',cursor:'pointer',fontSize:'0.82rem',fontWeight:700,background:'var(--accent)',color:'#000'}}>
                  {expiryLoading ? '⏳' : '🔄 Refresh'}
                </button>
              </div>
            </div>

            {!expiryData && !expiryLoading && (
              <div style={{textAlign:'center',padding:'3rem 2rem',color:'var(--text-dim)'}}>
                <div style={{fontSize:'3rem',marginBottom:'1rem'}}>⏰</div>
                <p style={{marginBottom:'1rem'}}>Click Refresh to load live expiry data from NSE</p>
                <button onClick={() => fetchExpiryData(expirySymbol)}
                  style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.75rem 2rem',fontWeight:700,cursor:'pointer'}}>
                  Load Expiry Data
                </button>
              </div>
            )}

            {expiryLoading && (
              <div style={{textAlign:'center',padding:'4rem',color:'var(--text-dim)'}}>
                <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>⏳</div>
                <p>Fetching {expirySymbol} data from NSE…</p>
              </div>
            )}

            {expiryData && !expiryLoading && (
              <>
                {/* Thursday banner */}
                {new Date().getDay() === 4 && (
                  <div style={{background:'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(0,255,136,0.08))',border:'1px solid rgba(249,115,22,0.4)',borderRadius:'12px',padding:'0.85rem 1.25rem',marginBottom:'1.25rem',display:'flex',alignItems:'center',gap:'0.75rem'}}>
                    <span style={{fontSize:'1.5rem'}}>🔥</span>
                    <div>
                      <div style={{fontWeight:700,color:'#f97316'}}>Today is Expiry Day!</div>
                      <div style={{fontSize:'0.82rem',color:'var(--text-dim)'}}>Weekly options expire today  -  monitor max pain and PCR closely</div>
                    </div>
                  </div>
                )}

                {/* Key metrics grid */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'0.75rem',marginBottom:'1.25rem'}}>
                  {[
                    {label:'Spot Price',   value: expiryData.spot?.toLocaleString('en-IN'), color:'var(--text-main)'},
                    {label:'Max Pain',     value: expiryData.maxPain?.toLocaleString('en-IN'), sub: `${Math.abs(((expiryData.maxPain-expiryData.spot)/expiryData.spot)*100).toFixed(1)}% away`, color:'#f59e0b'},
                    {label:'PCR (OI)',     value: expiryData.pcrOI, sub: expiryData.pcrBias, color: expiryData.pcrBias==='Bullish'?'#4ade80':expiryData.pcrBias==='Bearish'?'#f87171':'var(--text-dim)'},
                    {label:'PCR (Volume)', value: expiryData.pcrVol, color:'var(--text-main)'},
                    {label:'ATM Straddle', value: `₹${expiryData.straddlePremium?.toFixed(0)}`, color:'#a78bfa'},
                    {label:'Expected Move',value: `±${expiryData.expectedMove}`, color:'#38bdf8'},
                    {label:'ATM IV',       value: `${expiryData.atmIV}%`, color:'#fb923c'},
                    {label:'Expiry',       value: expiryData.expiry, color:'var(--text-dim)'},
                  ].map(({label,value,sub,color}) => (
                    <div key={label} className="panel" style={{padding:'0.85rem',textAlign:'center'}}>
                      <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.3rem'}}>{label}</div>
                      <div style={{fontSize:'1.2rem',fontWeight:700,color}}>{value}</div>
                      {sub && <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'0.2rem'}}>{sub}</div>}
                    </div>
                  ))}
                </div>

                {/* OI Chart + Key Levels — Pro only */}
                {isPro ? (<>
                {/* OI Chart */}
                <div className="panel" style={{marginBottom:'1.25rem'}}>
                  <h3 style={{marginTop:0,marginBottom:'1rem',fontSize:'1rem'}}>📊 Open Interest  -  CE vs PE</h3>
                  <div style={{overflowX:'auto'}}>
                    <div style={{minWidth:'500px'}}>
                      {(expiryData.oiChart || []).map(row => {
                        const maxOI = Math.max(...(expiryData.oiChart||[]).map(r => Math.max(r.ceOI, r.peOI)), 1);
                        const ceW = (row.ceOI / maxOI * 100).toFixed(1);
                        const peW = (row.peOI / maxOI * 100).toFixed(1);
                        const isATM = Math.abs(row.strike - expiryData.spot) < 50;
                        return (
                          <div key={row.strike} style={{display:'grid',gridTemplateColumns:'80px 1fr 80px 1fr 80px',alignItems:'center',gap:'0.5rem',marginBottom:'0.4rem',padding:'0.25rem 0.5rem',background:isATM?'rgba(0,255,136,0.05)':'transparent',borderRadius:'6px',border:isATM?'1px solid rgba(0,255,136,0.2)':'1px solid transparent'}}>
                            <div style={{fontSize:'0.75rem',color:'#60a5fa',textAlign:'right'}}>{(row.ceOI/100000).toFixed(1)}L</div>
                            <div style={{background:'rgba(96,165,250,0.15)',borderRadius:'4px',height:'18px',position:'relative'}}>
                              <div style={{position:'absolute',right:0,top:0,bottom:0,width:`${ceW}%`,background:'#3b82f6',borderRadius:'4px'}}/>
                            </div>
                            <div style={{textAlign:'center',fontSize:'0.78rem',fontWeight:isATM?700:500,color:isATM?'var(--accent)':'var(--text-main)'}}>{row.strike}{isATM?' ◄':''}</div>
                            <div style={{background:'rgba(244,114,182,0.15)',borderRadius:'4px',height:'18px',position:'relative'}}>
                              <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${peW}%`,background:'#ec4899',borderRadius:'4px'}}/>
                            </div>
                            <div style={{fontSize:'0.75rem',color:'#f472b6'}}>{(row.peOI/100000).toFixed(1)}L</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'1.5rem',marginTop:'0.75rem',justifyContent:'center'}}>
                    <span style={{fontSize:'0.78rem',color:'#60a5fa'}}>🔵 CE OI (Resistance)</span>
                    <span style={{fontSize:'0.78rem',color:'#f472b6'}}>🩷 PE OI (Support)</span>
                  </div>
                </div>

                {/* Resistance & Support */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1.25rem'}}>
                  <div className="panel">
                    <h3 style={{marginTop:0,fontSize:'0.95rem',color:'#f87171'}}>🔴 Key Resistance (CE OI)</h3>
                    {(expiryData.resistance||[]).map((r,i) => (
                      <div key={r.strike} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.5rem 0',borderBottom:i<2?'1px solid var(--border)':'none'}}>
                        <span style={{fontWeight:700}}>{r.strike}</span>
                        <span style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>{(r.ceOI/100000).toFixed(1)}L OI</span>
                        <span style={{fontSize:'0.78rem',color:'#f87171'}}>₹{r.ceLTP}</span>
                      </div>
                    ))}
                  </div>
                  <div className="panel">
                    <h3 style={{marginTop:0,fontSize:'0.95rem',color:'#4ade80'}}>🟢 Key Support (PE OI)</h3>
                    {(expiryData.support||[]).map((r,i) => (
                      <div key={r.strike} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.5rem 0',borderBottom:i<2?'1px solid var(--border)':'none'}}>
                        <span style={{fontWeight:700}}>{r.strike}</span>
                        <span style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>{(r.peOI/100000).toFixed(1)}L OI</span>
                        <span style={{fontSize:'0.78rem',color:'#4ade80'}}>₹{r.peLTP}</span>
                      </div>
                    ))}
                  </div>
                </div>
                </>) : (
                  <div onClick={openUpgrade} style={{
                    background:'linear-gradient(135deg,rgba(249,115,22,0.08),rgba(251,191,36,0.06))',
                    border:'1px dashed rgba(249,115,22,0.35)', borderRadius:'14px',
                    padding:'2rem', textAlign:'center', cursor:'pointer', marginBottom:'1rem',
                  }}>
                    <div style={{fontSize:'1.6rem',marginBottom:'0.5rem'}}>🔒</div>
                    <div style={{fontWeight:700,color:'var(--text-main)',marginBottom:'0.3rem'}}>OI Chart + Key Levels</div>
                    <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginBottom:'1rem'}}>Full CE vs PE OI analysis, resistance and support levels — Pro feature.</div>
                    <div style={{background:'linear-gradient(135deg,#f97316,#fbbf24)',color:'#000',borderRadius:'8px',padding:'0.5rem 1.5rem',fontWeight:800,display:'inline-block',fontSize:'0.88rem'}}>Upgrade to Pro</div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : activeTab === 'gex' ? (
          <ProGate isActive={isPro} onUpgrade={openUpgrade}
            feature="GEX + Greeks Analysis"
            description="Gamma Exposure, Delta Walls, Vanna and Charm reveal where market makers are positioned — the hidden support and resistance levels that chart traders miss. This is your edge.">
          <div>
            <div style={{marginBottom:'1.25rem'}}>
              <h2 style={{margin:'0 0 0.25rem'}}>GEX + Greeks Analysis</h2>
              <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:0}}>
                Gamma Exposure (GEX), Delta Walls, Vanna, Charm - calculated live from NSE option chain
              </p>
            </div>
            <div style={{display:'flex',gap:'0.5rem',marginBottom:'1.25rem',flexWrap:'wrap',alignItems:'center'}}>
              {['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'].map(sym=>(
                <button key={sym} onClick={()=>{setGexSymbol(sym);fetchGex(sym);}}
                  style={{padding:'0.4rem 0.85rem',borderRadius:'20px',fontSize:'0.82rem',fontWeight:700,cursor:'pointer',
                    background:gexSymbol===sym?'var(--accent)':'var(--bg-surface)',
                    color:gexSymbol===sym?'#000':'var(--text-dim)',
                    border:gexSymbol===sym?'2px solid var(--accent)':'1px solid var(--border)'}}>
                  {sym}
                </button>
              ))}
              <button onClick={()=>fetchGex(gexSymbol)} disabled={gexLoading}
                style={{background:'#6366f1',color:'#fff',border:'none',borderRadius:'8px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem',marginLeft:'auto'}}>
                {gexLoading ? 'Calculating...' : 'Load GEX'}
              </button>
            </div>
            {gexError && (
              <div style={{background:'rgba(248,113,113,0.08)',border:'1px solid rgba(248,113,113,0.25)',borderRadius:'10px',padding:'1.5rem',marginBottom:'1rem',textAlign:'center'}}>
                <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>⚠️</div>
                <div style={{fontWeight:700,color:'#f87171',marginBottom:'0.4rem'}}>GEX Load Failed</div>
                <div style={{fontSize:'0.82rem',color:'var(--text-dim)',lineHeight:1.6,marginBottom:'1rem'}}>{gexError}</div>
                <button onClick={()=>fetchGex(gexSymbol)}
                  style={{background:'#6366f1',color:'#fff',border:'none',borderRadius:'8px',padding:'0.45rem 1.25rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                  🔄 Retry
                </button>
              </div>
            )}
            {!gexData && !gexLoading && !gexError && (
              <div style={{textAlign:'center',padding:'4rem 2rem',color:'var(--text-dim)'}}>
                <div style={{fontSize:'3rem',marginBottom:'1rem'}}>🎯</div>
                <div style={{fontWeight:700,fontSize:'1.1rem',color:'var(--text-main)',marginBottom:'0.5rem'}}>Gamma Exposure Analysis</div>
                <div style={{fontSize:'0.88rem',maxWidth:'480px',margin:'0 auto 1.5rem',lineHeight:1.7}}>
                  Understand where market makers are positioned. GEX reveals hidden support and resistance levels that traditional charts miss.
                </div>
                <button onClick={()=>fetchGex(gexSymbol)}
                  style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'#fff',border:'none',borderRadius:'10px',padding:'0.85rem 2.5rem',fontWeight:800,fontSize:'1rem',cursor:'pointer'}}>
                  Analyze {gexSymbol} GEX
                </button>
              </div>
            )}
            {gexData && (
              <>
                <div style={{
                  borderRadius:'12px',padding:'1rem 1.5rem',marginBottom:'1.25rem',
                  background:gexData.regime==='positive'?'rgba(74,222,128,0.08)':'rgba(248,113,113,0.08)',
                  border:`1px solid ${gexData.regime==='positive'?'rgba(74,222,128,0.3)':'rgba(248,113,113,0.3)'}`,
                  display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'0.5rem'
                }}>
                  <div>
                    <div style={{fontWeight:800,fontSize:'1rem',color:gexData.regime==='positive'?'#4ade80':'#f87171'}}>
                      {gexData.regime==='positive'?'POSITIVE GAMMA REGIME':'NEGATIVE GAMMA REGIME'}
                    </div>
                    <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginTop:'0.2rem'}}>{gexData.zoneLabel}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>SPOT</div>
                    <div style={{fontSize:'1.2rem',fontWeight:800,color:'var(--text-main)'}}>{(gexData.spot||0).toLocaleString('en-IN')}</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'0.75rem',marginBottom:'1.25rem'}}>
                  {[
                    {label:'Gamma Flip',  value:gexData.gammaFlip?gexData.gammaFlip.toLocaleString('en-IN'):'None', sublabel:'Regime change level', color:'#f97316'},
                    {label:'Vanna Flip',  value:gexData.vannaFlip?gexData.vannaFlip.toLocaleString('en-IN'):'None', sublabel:'Vol-driven reversal',  color:'#a78bfa'},
                    {label:'Charm Centre',value:(gexData.charmCentre||0).toLocaleString('en-IN'),                  sublabel:'Expiry pin level',      color:'#38bdf8'},
                    {label:'Total GEX',   value:(gexData.totalGEX>=0?'+':'')+gexData.totalGEX.toLocaleString('en-IN'), sublabel:'Net dealer exposure', color:gexData.totalGEX>=0?'#4ade80':'#f87171'},
                  ].map(({label,value,sublabel,color})=>(
                    <div key={label} className="panel" style={{padding:'1rem'}}>
                      <div style={{fontSize:'0.72rem',color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'0.3rem'}}>{label}</div>
                      <div style={{fontSize:'1.15rem',fontWeight:800,color,margin:'0.2rem 0'}}>{value}</div>
                      <div style={{fontSize:'0.72rem',color:'var(--text-dim)'}}>{sublabel}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem',marginBottom:'1.25rem'}}>
                  <div className="panel">
                    <div style={{fontWeight:700,marginBottom:'0.5rem',color:'#f87171'}}>Call Walls (Resistance)</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:'0.75rem',lineHeight:1.5}}>Dealers sold calls here. They sell the underlying if price rises.</div>
                    {(gexData.topCallOI||[]).map((s,i)=>(
                      <div key={s} style={{display:'flex',justifyContent:'space-between',padding:'0.4rem 0',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                        <span style={{fontWeight:700,color:i===0?'#f87171':'var(--text-main)'}}>{s.toLocaleString('en-IN')}</span>
                        <span style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>Wall #{i+1}{i===0?' (strongest)':''}</span>
                      </div>
                    ))}
                  </div>
                  <div className="panel">
                    <div style={{fontWeight:700,marginBottom:'0.5rem',color:'#4ade80'}}>Put Walls (Support)</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text-dim)',marginBottom:'0.75rem',lineHeight:1.5}}>Dealers sold puts here. They buy the underlying if price falls.</div>
                    {(gexData.topPutOI||[]).map((s,i)=>(
                      <div key={s} style={{display:'flex',justifyContent:'space-between',padding:'0.4rem 0',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                        <span style={{fontWeight:700,color:i===0?'#4ade80':'var(--text-main)'}}>{s.toLocaleString('en-IN')}</span>
                        <span style={{fontSize:'0.72rem',color:'var(--text-muted)'}}>Wall #{i+1}{i===0?' (strongest)':''}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {gexData.strikes && gexData.strikes.length > 0 && (
                  <div className="panel" style={{overflowX:'auto',marginBottom:'1.25rem'}}>
                    <div style={{fontWeight:700,marginBottom:'1rem'}}>Strike-level GEX (Near ATM)</div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.8rem'}}>
                      <thead>
                        <tr style={{background:'var(--bg-surface)'}}>
                          {['Strike','Net GEX','CE IV%','PE IV%','CE OI','PE OI','CE LTP','PE LTP'].map(h=>(
                            <th key={h} style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'var(--text-muted)',fontSize:'0.7rem',fontWeight:700,textTransform:'uppercase',borderBottom:'1px solid var(--border)'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gexData.strikes.map(s=>{
                          const atm=Math.abs(s.strike-gexData.spot)<100;
                          return (
                            <tr key={s.strike} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:atm?'rgba(249,115,22,0.08)':'transparent'}}>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',fontWeight:atm?800:600,color:atm?'#f97316':'var(--text-main)'}}>{(s.strike||0).toLocaleString('en-IN')}{atm?' *':''}</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',fontWeight:700,color:(s.netGEX||0)>=0?'#4ade80':'#f87171'}}>{(s.netGEX||0)>=0?'+':''}{Math.round(s.netGEX||0).toLocaleString('en-IN')}</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'#f87171'}}>{(s.ceIV||0).toFixed(1)}%</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'#4ade80'}}>{(s.peIV||0).toFixed(1)}%</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'var(--text-dim)'}}>{((s.ceOI||0)/1000).toFixed(0)}K</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'var(--text-dim)'}}>{((s.peOI||0)/1000).toFixed(0)}K</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'#60a5fa'}}>{(s.ceLTP||0).toFixed(1)}</td>
                              <td style={{padding:'0.5rem 0.6rem',textAlign:'right',color:'#c084fc'}}>{(s.peLTP||0).toFixed(1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'0.5rem'}}>* ATM strike</div>
                  </div>
                )}
                <div className="panel" style={{background:'rgba(99,102,241,0.05)',border:'1px solid rgba(99,102,241,0.2)'}}>
                  <div style={{fontWeight:700,marginBottom:'0.75rem',color:'#818cf8'}}>How to read this</div>
                  <div style={{fontSize:'0.82rem',color:'var(--text-dim)',lineHeight:1.8}}>
                    <b style={{color:'#f97316'}}>Gamma Flip:</b> Strike where dealers switch from range-bound to trend-amplifying. Spot above flip = stable. Spot below = volatile.<br/>
                    <b style={{color:'#a78bfa'}}>Vanna Flip:</b> When VIX spikes or crashes, dealers rehedge here. Key on RBI policy days, earnings, expiry.<br/>
                    <b style={{color:'#38bdf8'}}>Charm Centre:</b> As expiry approaches, time decay forces hedge unwind. Price gravitates here on expiry day (pin risk).<br/>
                    <b style={{color:'#4ade80'}}>Put Walls:</b> Strong support - dealers buy underlying if price falls to defend short puts.<br/>
                    <b style={{color:'#f87171'}}>Call Walls:</b> Strong resistance - dealers sell underlying if price rises to defend short calls.
                  </div>
                </div>
              </>
            )}
          </div>
          </ProGate>

        ) : activeTab === 'admin' && isAdmin ? (
          <div>
            <div style={{marginBottom:'1.5rem'}}>
              <h2 style={{margin:'0 0 0.3rem'}}>Admin Panel</h2>
              <p style={{color:'var(--text-dim)',fontSize:'0.82rem',margin:0}}>Manage users and subscriptions</p>
            </div>
            {adminMsg && (
              <div style={{background:'rgba(0,255,136,0.1)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'8px',padding:'0.75rem 1rem',marginBottom:'1rem',fontSize:'0.85rem',color:'var(--accent)',display:'flex',justifyContent:'space-between'}}>
                <span>{adminMsg}</span>
                <button onClick={()=>setAdminMsg('')} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer'}}>X</button>
              </div>
            )}
            {/* === PENDING PAYMENT PROOFS === */}
            {pendingPay.length > 0 && (
              <div style={{background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.35)',borderRadius:'12px',padding:'1rem',marginBottom:'1.5rem'}}>
                <div style={{fontWeight:700,fontSize:'0.95rem',marginBottom:'0.75rem',color:'#f97316'}}>
                  🔔 Pending Payments ({pendingPay.length})
                </div>
                {pendingPay.map(p => (
                  <div key={p.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'0.5rem',padding:'0.65rem 0',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:'0.88rem',color:'var(--text-main)'}}>{p.email || p.uid}</div>
                      <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{p.name} • ₹{p.amount} • {p.submittedAt?.seconds ? new Date(p.submittedAt.seconds*1000).toLocaleString('en-IN') : 'Just now'}</div>
                    </div>
                    <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
                      <a href={p.screenshotUrl} target="_blank" rel="noreferrer"
                        style={{fontSize:'0.78rem',color:'#60a5fa',textDecoration:'none',border:'1px solid #60a5fa',borderRadius:'6px',padding:'3px 10px',fontWeight:600}}>
                        👁 View Screenshot
                      </a>
                      <button onClick={()=>approvePayment(p)}
                        style={{background:'#00ff88',color:'#000',border:'none',borderRadius:'6px',padding:'4px 12px',fontWeight:800,cursor:'pointer',fontSize:'0.82rem'}}>
                        ✅ Activate Pro
                      </button>
                    </div>
                  </div>
                ))}
                <button onClick={fetchPendingPayments} style={{marginTop:'0.6rem',background:'none',border:'1px solid var(--border)',color:'var(--text-dim)',borderRadius:'6px',padding:'4px 12px',fontSize:'0.75rem',cursor:'pointer'}}>
                  🔄 Refresh
                </button>
              </div>
            )}

            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'0.75rem',marginBottom:'1.5rem'}}>
              {[
                {label:'Total Users',val:adminUsers.length,                                                   color:'var(--text-main)'},
                {label:'Pro Users',  val:adminUsers.filter(u=>u.subStatus==='pro').length,                    color:'#f97316'},
                {label:'On Trial',   val:adminUsers.filter(u=>u.subStatus!=='pro'&&u.subStatus!=='expired').length, color:'var(--accent)'},
                {label:'Expired',    val:adminUsers.filter(u=>u.subStatus==='expired').length,                color:'#f87171'},
              ].map(({label,val,color})=>(
                <div key={label} className="panel" style={{textAlign:'center',padding:'0.85rem'}}>
                  <div style={{fontSize:'1.6rem',fontWeight:900,color}}>{val}</div>
                  <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'2px'}}>{label}</div>
                </div>
              ))}
            </div>
            <div className="panel">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap',gap:'0.75rem'}}>
                <h3 style={{margin:0}}>All Users</h3>
                <div style={{display:'flex',gap:'0.5rem'}}>
                  <input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)}
                    placeholder="Search email..."
                    style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.4rem 0.75rem',color:'var(--text-main)',fontSize:'0.82rem',width:'180px'}}/>
                  <button onClick={fetchAllUsers} disabled={adminLoading}
                    style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>
                    {adminLoading?'Loading...':'Load Users'}
                  </button>
                </div>
              </div>
              {adminUsers.length === 0 ? (
                <div style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
                  <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>👥</div>
                  <div>Click Load Users to see all registered users</div>
                </div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.82rem'}}>
                    <thead>
                      <tr style={{background:'var(--bg-surface)'}}>
                        {['Email','Name','Joined','Status','Action'].map(h=>(
                          <th key={h} style={{padding:'0.5rem 0.75rem',textAlign:'left',color:'var(--text-muted)',fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',borderBottom:'1px solid var(--border)'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers
                        .filter(u=>!adminSearch||(u.email||'').toLowerCase().includes(adminSearch.toLowerCase())||(u.name||'').toLowerCase().includes(adminSearch.toLowerCase()))
                        .map(u=>{
                          const isPro=u.subStatus==='pro';
                          const joined=u.createdAt?.toDate?.()?.toLocaleDateString('en-IN')||'Unknown';
                          return (
                            <tr key={u.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <td style={{padding:'0.6rem 0.75rem',color:'var(--text-dim)'}}>{u.email||u.id}</td>
                              <td style={{padding:'0.6rem 0.75rem',fontWeight:600}}>{u.name||'-'}</td>
                              <td style={{padding:'0.6rem 0.75rem',color:'var(--text-muted)',fontSize:'0.75rem'}}>{joined}</td>
                              <td style={{padding:'0.6rem 0.75rem'}}>
                                <span style={{padding:'2px 10px',borderRadius:'20px',fontSize:'0.72rem',fontWeight:700,
                                  background:isPro?'rgba(249,115,22,0.15)':'rgba(0,255,136,0.1)',
                                  color:isPro?'#f97316':'var(--accent)',
                                  border:`1px solid ${isPro?'rgba(249,115,22,0.3)':'rgba(0,255,136,0.3)'}`}}>
                                  {isPro?'PRO':'Trial'}
                                </span>
                              </td>
                              <td style={{padding:'0.6rem 0.75rem'}}>
                                {isPro ? (
                                  <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                                    {u.paidAt && <div style={{fontSize:'0.68rem',color:'#6ee7b7'}}>Paid: {new Date(u.paidAt).toLocaleDateString('en-IN')}</div>}
                                    {u.paymentNote && <div style={{fontSize:'0.68rem',color:'var(--text-dim)',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.paymentNote}</div>}
                                    <button onClick={()=>setUserPro(u.id,false)}
                                      style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',color:'#f87171',borderRadius:'6px',padding:'3px 10px',cursor:'pointer',fontSize:'0.75rem',fontWeight:700}}>
                                      Remove Pro
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                                    <input
                                      placeholder="Payment note (UPI/RZP ref)"
                                      onKeyDown={e=>{ if(e.key==='Enter'){ setUserProWithNote(u.id, e.target.value); e.target.value=''; }}}
                                      style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'4px',padding:'2px 6px',color:'var(--text-main)',fontSize:'0.7rem',width:'140px'}}
                                    />
                                    <button onClick={e=>{ const inp=e.target.parentNode.querySelector('input'); setUserProWithNote(u.id, inp?.value||''); if(inp) inp.value=''; }}
                                      style={{background:'rgba(249,115,22,0.15)',border:'1px solid rgba(249,115,22,0.4)',color:'#f97316',borderRadius:'6px',padding:'3px 10px',cursor:'pointer',fontSize:'0.75rem',fontWeight:700}}>
                                      ✅ Make Pro
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        ) : null}

        {/* -- FOOTER -- */}
        <div style={{borderTop:'1px solid var(--border)',marginTop:'2rem',padding:'1.5rem',textAlign:'center'}}>
          <div style={{fontSize:'0.78rem',color:'var(--text-muted)',marginBottom:'0.75rem'}}>
            <strong>⚠️ Disclaimer:</strong> DeltaBuddy is for educational purposes only. Options trading involves substantial risk. Always consult a SEBI-registered advisor before trading.
          </div>
          <div style={{display:'flex',justifyContent:'center',gap:'1.5rem',flexWrap:'wrap',fontSize:'0.78rem'}}>
            {[['terms','Terms & Conditions'],['privacy','Privacy Policy'],['refund','Refund Policy'],['disclaimer','Legal Disclaimer']].map(([key,label])=>(
              <span key={key} onClick={()=>setShowLegal(key)}
                style={{color:'var(--accent)',cursor:'pointer',textDecoration:'underline',textUnderlineOffset:'3px'}}>
                {label}
              </span>
            ))}
          </div>
          <div style={{marginTop:'0.75rem',fontSize:'0.72rem',color:'var(--text-muted)'}}>
            © 2025 DeltaBuddy  |  <a href="mailto:legal@deltabuddy.com" style={{color:'var(--text-muted)'}}>legal@deltabuddy.com</a>
          </div>
        </div>

        {/* -- LEGAL MODAL -- */}
        {/* PRICING MODAL */}
        {showPricing && (
          <div className="modal-overlay" onClick={()=>setShowPricing(false)} style={{alignItems:'flex-start',paddingTop:'2rem',overflowY:'auto'}}>
            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'760px',width:'95%',padding:'2rem',maxHeight:'90vh',overflowY:'auto'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
                <h2 style={{margin:0,fontSize:'1.3rem'}}>DeltaBuddy Plans</h2>
                <button onClick={()=>setShowPricing(false)} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.5rem',cursor:'pointer'}}>X</button>
              </div>
              <p style={{color:'var(--text-dim)',fontSize:'0.85rem',marginBottom:'1.5rem',marginTop:0}}>
                Professional options analytics for Indian traders. No credit card needed to start.
              </p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1.5rem'}}>
                <div style={{border:'1px solid var(--border)',borderRadius:'14px',padding:'1.5rem',background:'var(--bg-surface)'}}>
                  <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'0.5rem'}}>Free Trial</div>
                  <div style={{fontSize:'2.2rem',fontWeight:900,color:'var(--text-main)',marginBottom:'0.2rem'}}>FREE</div>
                  <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginBottom:'1.25rem'}}>Pro: ₹299/quarter</div>
                  {subStatus === 'trial' && (
                    <div style={{background:'rgba(0,255,136,0.1)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'8px',padding:'0.5rem',textAlign:'center',fontSize:'0.82rem',color:'var(--accent)',fontWeight:700,marginBottom:'1rem'}}>
                      Active - {trialDaysLeft} days remaining
                    </div>
                  )}
                  <div style={{fontSize:'0.8rem',color:'var(--text-dim)'}}>
                    {['Option Chain — NIFTY & BANKNIFTY','Strategy Builder (2 legs)','Paper Trading','Trade Journal','Market Watchlist','Max Pain (Expiry tools)','Manual portfolio entry'].map((f,i) => (
                      <div key={i} style={{padding:'0.3rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>{i < 7 ? '+ ' : '- '}{f}</div>
                    ))}
                  </div>
                </div>
                <div style={{border:'2px solid var(--accent)',borderRadius:'14px',padding:'1.5rem',background:'linear-gradient(135deg,rgba(0,255,136,0.05),rgba(56,189,248,0.03))',position:'relative'}}>
                  <div style={{position:'absolute',top:'12px',right:'12px',background:'linear-gradient(135deg,#f97316,#fbbf24)',color:'#000',fontSize:'0.7rem',fontWeight:800,padding:'2px 10px',borderRadius:'20px'}}>BEST VALUE</div>
                  <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--accent)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'0.5rem'}}>Pro</div>
                  <div style={{display:'flex',alignItems:'baseline',gap:'0.4rem',marginBottom:'0.2rem'}}>
                    <span style={{fontSize:'2.2rem',fontWeight:900,color:'var(--accent)'}}>299</span>
                    <span style={{fontSize:'0.85rem',color:'var(--text-dim)'}}>/ quarter</span>
                  </div>
                  <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginBottom:'1.25rem'}}>~100/month - billed every 3 months</div>
                  {subStatus === 'pro' ? (
                    <div style={{background:'rgba(0,255,136,0.1)',border:'1px solid var(--accent)',borderRadius:'8px',padding:'0.6rem',textAlign:'center',fontSize:'0.85rem',color:'var(--accent)',fontWeight:700,marginBottom:'1rem'}}>
                      ✅ You are on Pro
                    </div>
                  ) : payStep === 'done' ? (
                    <div style={{background:'rgba(0,255,136,0.08)',border:'1px solid rgba(0,255,136,0.3)',borderRadius:'10px',padding:'1rem',textAlign:'center',marginBottom:'1rem'}}>
                      <div style={{fontSize:'1.5rem',marginBottom:'0.5rem'}}>🎉</div>
                      <div style={{fontWeight:700,color:'var(--accent)',marginBottom:'0.3rem'}}>Screenshot Submitted!</div>
                      <div style={{fontSize:'0.78rem',color:'var(--text-dim)'}}>We'll activate your Pro within 2 hours. You'll see it reflected here.</div>
                    </div>
                  ) : payStep === 'upload' ? (
                    <div style={{marginBottom:'1rem'}}>
                      <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:'0.6rem',color:'var(--text-main)'}}>📸 Upload Payment Screenshot</div>
                      <label style={{display:'block',border:'2px dashed var(--border)',borderRadius:'10px',padding:'1rem',textAlign:'center',cursor:'pointer',marginBottom:'0.75rem',background:'var(--bg-surface)'}}>
                        <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{setPayFile(e.target.files[0]);}}/>
                        {payFile ? <span style={{color:'var(--accent)',fontWeight:600}}>✓ {payFile.name}</span> : <span style={{color:'var(--text-dim)',fontSize:'0.82rem'}}>Tap to select screenshot</span>}
                      </label>
                      {payMsg && <div style={{fontSize:'0.78rem',color:'var(--accent)',marginBottom:'0.5rem'}}>{payMsg}</div>}
                      <button onClick={submitPaymentProof} disabled={!payFile||payUploading}
                        style={{width:'100%',background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.65rem',fontWeight:800,cursor:'pointer',fontSize:'0.9rem',opacity:(!payFile||payUploading)?0.6:1}}>
                        {payUploading ? '⏳ Uploading...' : '🚀 Submit for Activation'}
                      </button>
                      <button onClick={()=>setPayStep('qr')} style={{width:'100%',background:'none',border:'none',color:'var(--text-dim)',fontSize:'0.78rem',marginTop:'0.5rem',cursor:'pointer'}}>← Back to QR</button>
                    </div>
                  ) : (
                    <div style={{marginBottom:'1rem'}}>
                      <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:'0.75rem',color:'var(--text-main)',textAlign:'center'}}>Scan & Pay ₹299</div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.75rem'}}>
                        <div style={{background:'white',padding:'10px',borderRadius:'12px',display:'inline-block'}}>
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent('upi://pay?pa=mhassanuzzaman@fifederal&pn=DeltaBuddy&am=299&cu=INR&tn=DeltaBuddy+Pro+Subscription')}`}
                            alt="UPI QR" style={{width:180,height:180,display:'block'}}
                          />
                        </div>
                        <div style={{textAlign:'center'}}>
                          <div style={{fontSize:'0.8rem',color:'var(--text-dim)',marginBottom:'0.2rem'}}>UPI ID</div>
                          <div style={{fontWeight:700,color:'var(--text-main)',fontSize:'0.9rem',letterSpacing:'0.02em'}}>mhassanuzzaman@fifederal</div>
                          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'0.2rem'}}>Amount: ₹299 • DeltaBuddy Pro</div>
                        </div>
                        <div style={{fontSize:'0.75rem',color:'var(--text-dim)',textAlign:'center',lineHeight:1.6,background:'rgba(255,255,255,0.04)',borderRadius:'8px',padding:'0.6rem 1rem'}}>
                          1. Scan QR or use UPI ID above<br/>
                          2. Pay exactly ₹299<br/>
                          3. Take a screenshot of the success screen<br/>
                          4. Click below to upload it
                        </div>
                        <button onClick={()=>setPayStep('upload')}
                          style={{width:'100%',background:'linear-gradient(135deg,#00ff88,#00cc6a)',color:'#000',border:'none',borderRadius:'8px',padding:'0.65rem',fontWeight:800,cursor:'pointer',fontSize:'0.9rem'}}>
                          📸 I've Paid — Upload Screenshot
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{fontSize:'0.8rem',color:'var(--text-dim)'}}>
                    {['All Free features','GEX + Greeks Analysis','AI Market Intelligence','Live F&O Scanner','Strategy Backtester','Full Expiry Suite (OI + Key Levels)','Live Dhan / Zerodha / Angel sync','AI Screenshot import','Telegram alerts','Unlimited strategy legs','All F&O stocks option chain','Priority support'].map((f,i) => (
                      <div key={i} style={{padding:'0.3rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>+ {f}</div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{background:'var(--bg-surface)',borderRadius:'12px',padding:'1.25rem',marginBottom:'1rem'}}>
                <div style={{fontWeight:700,fontSize:'0.9rem',marginBottom:'1rem',color:'var(--text-main)'}}>Frequently Asked Questions</div>
                {[
                  ['Do I need a credit card for the trial?','No card needed. Pro is ₹299/quarter. We will notify you on Telegram when payment is live.'],
                  ['What happens after my trial ends?','The app continues to work. Your data is safe. Upgrade anytime to restore full access.'],
                  ['Can I cancel anytime?','Yes. Cancel from Account Settings anytime. You keep access until end of the quarter.'],
                  ['Is my payment secure?','Payments processed by Razorpay - same gateway used by Zerodha, Groww. We never store your card details.'],
                  ['What is the refund policy?','Full refund within 7 days of any charge. See our Refund Policy for details.'],
                ].map(([q,a])=>(
                  <div key={q} style={{marginBottom:'0.85rem',paddingBottom:'0.85rem',borderBottom:'1px solid var(--border)'}}>
                    <div style={{fontWeight:700,fontSize:'0.82rem',color:'var(--text-main)',marginBottom:'0.25rem'}}>Q: {q}</div>
                    <div style={{fontSize:'0.8rem',color:'var(--text-dim)',lineHeight:1.6}}>{a}</div>
                  </div>
                ))}
              </div>
              <div style={{textAlign:'center',fontSize:'0.75rem',color:'var(--text-muted)'}}>
                Questions? support@deltabuddy.com - WhatsApp: +91 75062 18502
              </div>
            </div>
          </div>
        )}

        {showLegal && (
          <div className="modal-overlay" onClick={()=>setShowLegal(null)} style={{alignItems:'flex-start',paddingTop:'2rem',overflowY:'auto'}}>
            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'680px',width:'95%',maxHeight:'85vh',overflowY:'auto',padding:'2rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem',position:'sticky',top:0,background:'var(--bg-card)',paddingBottom:'1rem',borderBottom:'1px solid var(--border)'}}>
                <h2 style={{margin:0,fontSize:'1.1rem'}}>
                  {showLegal==='terms'&&'📋 Terms & Conditions'}
                  {showLegal==='privacy'&&'🔐 Privacy Policy'}
                  {showLegal==='refund'&&'💳 Refund & Cancellation'}
                  {showLegal==='disclaimer'&&'⚠️ Legal Disclaimer'}
                </h2>
                <button onClick={()=>setShowLegal(null)} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.5rem',cursor:'pointer',lineHeight:1}}>✕</button>
              </div>
              {/* Page switcher */}
              <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginBottom:'1.5rem'}}>
                {[['terms','T&C'],['privacy','Privacy'],['refund','Refund'],['disclaimer','Disclaimer']].map(([k,l])=>(
                  <span key={k} onClick={()=>setShowLegal(k)}
                    style={{fontSize:'0.75rem',padding:'0.2rem 0.65rem',borderRadius:'20px',cursor:'pointer',
                      background:showLegal===k?'var(--accent)':'var(--bg-surface)',
                      color:showLegal===k?'#000':'var(--text-dim)',
                      border:'1px solid '+(showLegal===k?'var(--accent)':'var(--border)'),
                      fontWeight:showLegal===k?700:400}}>
                    {l}
                  </span>
                ))}
              </div>
              <div style={{fontSize:'0.8rem',color:'var(--text-muted)',marginBottom:'1.5rem'}}>Effective: 1 June 2025</div>

              {showLegal==='terms' && [
                ['1. Acceptance','By using DeltaBuddy you agree to these Terms. If you do not agree, do not use the platform.'],
                ['2. Service Description','DeltaBuddy is an AI-powered financial information platform for Indian equity and derivatives markets (NSE/BSE). It provides options analysis, market data, strategy simulation, paper trading, Telegram alerts, backtesting, and trade journaling.'],
                ['3. Not Financial Advice','DeltaBuddy is an educational tool ONLY. Nothing constitutes financial advice, investment advice, or trading recommendations. All AI outputs, scanner alerts, and strategy suggestions are for educational purposes only. You are solely responsible for your trading decisions. Always consult a SEBI-registered Investment Advisor before investing.'],
                ['4. Eligibility','You must be at least 18 years old and legally permitted to trade in Indian financial markets.'],
                ['5. Paper Trading','The Paper Trading feature uses virtual money (₹5,00,000 default) for simulation only. Results do not reflect real execution costs, slippage, or taxes. Paper trading performance is not indicative of real results.'],
                ['6. Telegram Alerts','Alerts are provided on a best-effort basis and may be delayed or inaccurate. They are not buy/sell recommendations.'],
                ['7. Prohibited Uses','You may not use DeltaBuddy for market manipulation, reverse-engineering, excessive scraping, or any activity prohibited by Indian law.'],
                ['8. Intellectual Property','All content, software, AI configurations, and designs are the property of DeltaBuddy or its licensors.'],
                ['9. Limitation of Liability','DeltaBuddy shall not be liable for trading losses, loss of profits, or data loss. Our maximum liability is limited to amounts paid in the 3 months preceding any claim.'],
                ['10. Governing Law','These Terms are governed by the laws of India. Disputes shall be subject to courts in Mumbai, Maharashtra.'],
                ['11. Contact','legal@deltabuddy.com'],
              ].map(([h,p])=>(
                <div key={h} style={{marginBottom:'1.25rem'}}>
                  <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)',marginBottom:'0.35rem'}}>{h}</div>
                  <div style={{fontSize:'0.85rem',color:'var(--text-dim)',lineHeight:1.7}}>{p}</div>
                </div>
              ))}

              {showLegal==='privacy' && [
                ['1. Data We Collect','Account: Email, display name, profile photo (via Google Sign-In). Trading Data: Strategies, journal entries, paper trades stored in Firebase. Technical: IP address, browser type, session duration. Preferences: Groq API key, Telegram Chat ID, notification settings. Payment: We do NOT store card or bank details  -  only Razorpay transaction IDs.'],
                ['2. How We Use Your Data','To provide and improve the platform. To send Telegram alerts you subscribed to. To process payments. We do NOT sell your data or use your trading journal for advertising.'],
                ['3. Third-Party Services','Firebase (Google): Authentication and database. Razorpay: Payment processing. Groq AI / Google Gemini: AI processing of news text only. Yahoo Finance / NSE: Public market data.'],
                ['4. Data Security','Data stored in Google Firebase (Mumbai region). HTTPS/TLS encryption in transit. Firebase Security Rules restrict access to authenticated users only.'],
                ['5. Your Rights','You may access, correct, or delete your personal data at any time by emailing legal@deltabuddy.com.'],
                ['6. Cookies','We use only essential session cookies for authentication. No advertising or tracking cookies.'],
                ['7. Contact','legal@deltabuddy.com'],
              ].map(([h,p])=>(
                <div key={h} style={{marginBottom:'1.25rem'}}>
                  <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)',marginBottom:'0.35rem'}}>{h}</div>
                  <div style={{fontSize:'0.85rem',color:'var(--text-dim)',lineHeight:1.7}}>{p}</div>
                </div>
              ))}

              {showLegal==='refund' && [
                ['1. Free Trial','Free tier gives you option chain, scanner and basic tools. Pro is ₹299/quarter for AI, GEX, alerts and advanced features.'],
                ['2. Paid Subscription','After the trial, continued access requires ₹299/quarter, billed via Razorpay. You will receive email reminders 7 days before the first charge.'],
                ['3. Cancellation','Cancel anytime via Account Settings or by emailing legal@deltabuddy.com. You retain access until the end of the current billing period.'],
                ['4. Refund Policy','Within 7 days of any charge: Full refund, no questions asked. After 7 days: No pro-rated refunds  -  you retain access until quarter end. Service outage >72 hours: Pro-rated credit for next cycle.'],
                ['5. Refund Process','Approved refunds processed within 5-7 business days to the original payment method.'],
                ['6. Price Changes','We will notify you at least 30 days before any price increase.'],
                ['7. Contact','Email legal@deltabuddy.com with your registered email and transaction ID. Response within 2 business days.'],
              ].map(([h,p])=>(
                <div key={h} style={{marginBottom:'1.25rem'}}>
                  <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)',marginBottom:'0.35rem'}}>{h}</div>
                  <div style={{fontSize:'0.85rem',color:'var(--text-dim)',lineHeight:1.7}}>{p}</div>
                </div>
              ))}

              {showLegal==='disclaimer' && [
                ['Investment Risk Warning','OPTIONS TRADING INVOLVES HIGH RISK and is not suitable for all investors. You can lose the entire amount invested. Never trade with money you cannot afford to lose.'],
                ['No SEBI Registration','DeltaBuddy is NOT a SEBI-registered Investment Adviser, Research Analyst, or Stockbroker. Our tools are for educational and research purposes only.'],
                ['Data Accuracy','Market data may be delayed, inaccurate, or incomplete. Always verify from your broker or NSE/BSE directly before executing trades.'],
                ['AI Output Disclaimer','AI-generated insights may contain errors or hallucinations. They are not trading recommendations. Never act solely on AI outputs without independent verification.'],
                ['Backtesting Disclaimer','Backtesting is hypothetical and does not account for real execution costs, slippage, or market impact. PAST PERFORMANCE IS NOT INDICATIVE OF FUTURE RESULTS.'],
                ['Regulatory Compliance','Users are solely responsible for complying with SEBI regulations, Income Tax obligations, and all applicable Indian laws.'],
              ].map(([h,p])=>(
                <div key={h} style={{marginBottom:'1.25rem'}}>
                  <div style={{fontWeight:700,fontSize:'0.9rem',color:'var(--text-main)',marginBottom:'0.35rem'}}>{h}</div>
                  <div style={{fontSize:'0.85rem',color:'var(--text-dim)',lineHeight:1.7}}>{p}</div>
                </div>
              ))}

              <div style={{marginTop:'1.5rem',paddingTop:'1rem',borderTop:'1px solid var(--border)',fontSize:'0.75rem',color:'var(--text-muted)',textAlign:'center'}}>
                Questions? <a href="mailto:legal@deltabuddy.com" style={{color:'var(--accent)'}}>legal@deltabuddy.com</a>  |  © 2025 DeltaBuddy
              </div>
            </div>
          </div>
        )}

        {/* -- FLOATING WHATSAPP SUPPORT BUTTON -- */}
        {/* -- SCREENSHOT FLOATING BUTTON — Pro only -- */}
        {isPro ? (
          <label
            title="Import positions from any broker screenshot"
            style={{
              position:'fixed', bottom:'92px', right:'24px', zIndex:9999,
              width:'56px', height:'56px', borderRadius:'50%',
              background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'white',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 20px rgba(99,102,241,0.5)',
              fontSize:'1.4rem', cursor:'pointer',
              transition:'transform 0.2s',
            }}
            onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'}
            onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
          >
            📸
            <input type="file" accept="image/*" style={{display:'none'}}
              onChange={e=>{
                handleScreenshotUpload(e);
                setActiveTab('portfolio');
                setSelectedBroker('manual');
              }}/>
          </label>
        ) : (
          <button
            onClick={openUpgrade}
            title="Pro feature — Import positions from any broker screenshot"
            style={{
              position:'fixed', bottom:'92px', right:'24px', zIndex:9999,
              width:'56px', height:'56px', borderRadius:'50%',
              background:'rgba(99,102,241,0.25)', color:'#818cf8',
              border:'2px solid rgba(99,102,241,0.5)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'1.4rem', cursor:'pointer',
            }}
          >
            🔒
          </button>
        )}

        {/* Tooltip label hidden — shows on hover via title attribute only */}

        <a
          href="https://wa.me/917506218502?text=Hi%20DeltaBuddy%20Team%2C%20I%20need%20help%20with..."
          target="_blank"
          rel="noreferrer"
          title="Chat with us on WhatsApp"
          style={{
            position:'fixed', bottom:'24px', right:'24px', zIndex:9999,
            width:'56px', height:'56px', borderRadius:'50%',
            background:'#25D366', color:'white',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 4px 20px rgba(37,211,102,0.5)',
            fontSize:'1.6rem', textDecoration:'none',
            animation:'waPulse 2s infinite',
          }}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.522 5.84L.057 23.882a.5.5 0 00.611.611l6.042-1.465A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.698-.5-5.254-1.375l-.375-.214-3.893.944.963-3.786-.234-.393A9.956 9.956 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
          </svg>
        </a>

        {/* -- STYLES -- */}
        <style>{`
          @keyframes waPulse {
            0%   { box-shadow: 0 0 0 0 rgba(37,211,102,0.5); }
            70%  { box-shadow: 0 0 0 12px rgba(37,211,102,0); }
            100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); }
          }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

          /* NAV - desktop: show links, hide hamburger */
          .nav-links { display: flex; }
          .hamburger { display: none; font-size: 1.4rem; }

          /* MOBILE: hide nav links, show hamburger */
          @media (max-width: 768px) {
            .nav-links { display: none !important; }
            .hamburger { display: block !important; }

            /* Navbar right: hide trial badge and telegram on small screens */
            .trial-badge { display: none !important; }
            .tg-btn { display: none !important; }

            /* Main content padding */
            .main-content { padding: 0.75rem !important; }
            .panel { padding: 0.75rem !important; border-radius: 8px !important; }

            /* Tables scroll horizontally */
            table { display: block !important; overflow-x: auto !important; -webkit-overflow-scrolling: touch; }

            /* Modals full width */
            .modal-content {
              width: 96% !important;
              max-width: 96% !important;
              margin: 0.5rem auto !important;
              max-height: 90vh !important;
              padding: 1rem !important;
            }

            /* Grids collapse to 1 column */
            .quick-actions-grid { grid-template-columns: 1fr !important; }
            .page-header h1 { font-size: 1.2rem !important; }

            /* Option chain: smaller font */
            .option-chain-table th,
            .option-chain-table td { font-size: 0.68rem !important; padding: 0.3rem 0.4rem !important; }

            /* Broker selector wraps */
            .broker-selector { flex-wrap: wrap !important; }

            /* Home greeting */
            .home-greeting { flex-direction: column !important; align-items: flex-start !important; }
          }

          @media (max-width: 480px) {
            .navbar-right .trial-badge { display: none; }
            .ticker-items { gap: 0.5rem !important; }
            h2 { font-size: 1.1rem !important; }
          }
        `}</style>

      </div>
    </div>
  );
}

export default App;
