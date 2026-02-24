import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// ── Firebase ──────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, deleteDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';

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
const googleProvider = new GoogleAuthProvider();

// Railway backend URL — update after deploying
const BACKEND_URL   = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';
const ADMIN_EMAIL   = 'mirza.hassanuzzaman@gmail.com';

// ── TradingView lightweight-charts loader ─────────────────────────────────────
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

function TradingViewChart({ data, indicators, type, symbol, timeframe }) {
  const containerRef = React.useRef(null);
  const chartRef     = React.useRef(null);
  const seriesRef    = React.useRef(null);
  const lineRefs     = React.useRef({});

  // Build candle series data
  const buildSeries = (raw) => raw
    .filter(d => d.open && d.close && d.high && d.low)
    .map(d => ({
      time : Math.floor(new Date(d.time || d.date || d.timestamp).getTime() / 1000),
      open : parseFloat(d.open),
      high : parseFloat(d.high),
      low  : parseFloat(d.low),
      close: parseFloat(d.close),
    }))
    .filter(d => !isNaN(d.time))
    .sort((a, b) => a.time - b.time)
    .filter((d, i, arr) => i === 0 || d.time !== arr[i - 1].time); // dedupe

  // SMA helper
  const calcSMA = (candles, period=20) => {
    return candles.map((c, i) => {
      if (i < period - 1) return null;
      const avg = candles.slice(i - period + 1, i + 1).reduce((s, x) => s + x.close, 0) / period;
      return { time: c.time, value: avg };
    }).filter(Boolean);
  };

  // EMA helper
  const calcEMA = (candles, period=20) => {
    const k = 2 / (period + 1);
    let ema = candles[0]?.close || 0;
    return candles.map((c, i) => {
      if (i === 0) { ema = c.close; return { time: c.time, value: ema }; }
      ema = c.close * k + ema * (1 - k);
      return { time: c.time, value: ema };
    });
  };

  // Bollinger Bands helper
  const calcBB = (candles, period=20, mult=2) => {
    const upper = [], middle = [], lower = [];
    candles.forEach((c, i) => {
      if (i < period - 1) return;
      const slice = candles.slice(i - period + 1, i + 1).map(x => x.close);
      const avg = slice.reduce((s, v) => s + v, 0) / period;
      const std = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / period);
      upper.push({ time: c.time, value: avg + mult * std });
      middle.push({ time: c.time, value: avg });
      lower.push({ time: c.time, value: avg - mult * std });
    });
    return { upper, middle, lower };
  };

  React.useEffect(() => {
    if (!data || data.length === 0 || !containerRef.current) return;
    let chart;

    loadLWC().then((LWC) => {
      // Destroy old chart
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

      chart = LWC.createChart(containerRef.current, {
        width : containerRef.current.clientWidth,
        height: 420,
        layout: {
          background: { color: '#070d1a' },
          textColor : '#94a3b8',
          fontSize  : 11,
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines  : { color: 'rgba(100,116,139,0.12)' },
          horzLines  : { color: 'rgba(100,116,139,0.12)' },
        },
        crosshair: { mode: LWC.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1e293b', scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
      });
      chartRef.current = chart;

      const candles = buildSeries(data);
      if (candles.length === 0) return;

      // Main series
      let mainSeries;
      if (type === 'line' || type === 'area') {
        mainSeries = chart.addAreaSeries({
          lineColor    : '#4ade80',
          topColor     : 'rgba(74,222,128,0.18)',
          bottomColor  : 'rgba(74,222,128,0)',
          lineWidth    : 2,
        });
        mainSeries.setData(candles.map(c => ({ time: c.time, value: c.close })));
      } else {
        mainSeries = chart.addCandlestickSeries({
          upColor  : '#4ade80', downColor: '#f87171',
          borderUpColor: '#4ade80', borderDownColor: '#f87171',
          wickUpColor  : '#4ade80', wickDownColor  : '#f87171',
        });
        mainSeries.setData(candles);
      }
      seriesRef.current = mainSeries;

      // Volume histogram
      const volSeries = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volSeries.setData(candles.map((c, i) => ({
        time : c.time,
        value: parseFloat(data[i]?.volume || 0),
        color: c.close >= c.open ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)',
      })));

      // Indicators
      const newRefs = {};
      if (indicators.includes('SMA')) {
        const s = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1.5, title: 'SMA 20' });
        s.setData(calcSMA(candles));
        newRefs.SMA = s;
      }
      if (indicators.includes('EMA')) {
        const s = chart.addLineSeries({ color: '#818cf8', lineWidth: 1.5, title: 'EMA 20' });
        s.setData(calcEMA(candles));
        newRefs.EMA = s;
      }
      if (indicators.includes('VWAP')) {
        // Simple VWAP approximation using close
        const vwap = candles.map((c, i) => ({
          time : c.time,
          value: candles.slice(0, i + 1).reduce((s, x) => s + x.close, 0) / (i + 1),
        }));
        const s = chart.addLineSeries({ color: '#e879f9', lineWidth: 1.5, lineStyle: 1, title: 'VWAP' });
        s.setData(vwap);
        newRefs.VWAP = s;
      }
      if (indicators.includes('BB')) {
        const bb = calcBB(candles);
        ['upper','lower'].forEach((key, i) => {
          const s = chart.addLineSeries({ color: 'rgba(96,165,250,0.7)', lineWidth: 1, lineStyle: 2 });
          s.setData(bb[key]);
          newRefs[`BB_${key}`] = s;
        });
        const sm = chart.addLineSeries({ color: 'rgba(96,165,250,0.4)', lineWidth: 1 });
        sm.setData(bb.middle);
        newRefs.BB_mid = sm;
      }
      lineRefs.current = newRefs;

      // Fit & resize
      chart.timeScale().fitContent();
      const ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    });

    return () => { if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
  }, [data, indicators, type]);

  return (
    <div style={{position:'relative',background:'#070d1a'}}>
      <div ref={containerRef} style={{width:'100%',height:'420px'}}/>
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
  'bull-call-spread': {
    name: 'Bull Call Spread',
    description: 'Buy lower strike call, sell higher strike call. Limited risk, limited profit.',
    legs: [
      { position: 'buy', optionType: 'call', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'sell', optionType: 'call', strikeOffset: 200, premiumPercent: 0.5 }
    ]
  },
  'bear-put-spread': {
    name: 'Bear Put Spread',
    description: 'Buy higher strike put, sell lower strike put. Limited risk, limited profit.',
    legs: [
      { position: 'buy', optionType: 'put', strikeOffset: 200, premiumPercent: 1.0 },
      { position: 'sell', optionType: 'put', strikeOffset: 0, premiumPercent: 0.5 }
    ]
  },
  'iron-condor': {
    name: 'Iron Condor',
    description: 'Sell OTM put spread + sell OTM call spread. Profit from low volatility.',
    legs: [
      { position: 'buy', optionType: 'put', strikeOffset: -400, premiumPercent: 0.3 },
      { position: 'sell', optionType: 'put', strikeOffset: -200, premiumPercent: 0.6 },
      { position: 'sell', optionType: 'call', strikeOffset: 200, premiumPercent: 0.6 },
      { position: 'buy', optionType: 'call', strikeOffset: 400, premiumPercent: 0.3 }
    ]
  },
  'long-straddle': {
    name: 'Long Straddle',
    description: 'Buy ATM call + ATM put. Profit from big moves in either direction.',
    legs: [
      { position: 'buy', optionType: 'call', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'buy', optionType: 'put', strikeOffset: 0, premiumPercent: 1.0 }
    ]
  },
  'short-straddle': {
    name: 'Short Straddle',
    description: 'Sell ATM call + ATM put. Profit from low volatility, unlimited risk.',
    legs: [
      { position: 'sell', optionType: 'call', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'sell', optionType: 'put', strikeOffset: 0, premiumPercent: 1.0 }
    ]
  },
  'long-strangle': {
    name: 'Long Strangle',
    description: 'Buy OTM call + OTM put. Cheaper than straddle, needs bigger move.',
    legs: [
      { position: 'buy', optionType: 'call', strikeOffset: 200, premiumPercent: 0.7 },
      { position: 'buy', optionType: 'put', strikeOffset: -200, premiumPercent: 0.7 }
    ]
  },
  'butterfly-spread': {
    name: 'Butterfly Spread',
    description: 'Buy 1 lower, sell 2 middle, buy 1 higher. Low risk, profit if stays at middle.',
    legs: [
      { position: 'buy', optionType: 'call', strikeOffset: -200, premiumPercent: 1.2 },
      { position: 'sell', optionType: 'call', strikeOffset: 0, premiumPercent: 0.8, quantity: 2 },
      { position: 'buy', optionType: 'call', strikeOffset: 200, premiumPercent: 0.5 }
    ]
  },
  'iron-butterfly': {
    name: 'Iron Butterfly',
    description: 'Sell ATM straddle + buy OTM strangle. Tighter profit zone than Iron Condor.',
    legs: [
      { position: 'buy', optionType: 'put', strikeOffset: -300, premiumPercent: 0.4 },
      { position: 'sell', optionType: 'put', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'sell', optionType: 'call', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'buy', optionType: 'call', strikeOffset: 300, premiumPercent: 0.4 }
    ]
  },
  'synthetic-long': {
    name: 'Synthetic Long',
    description: 'Buy call + sell put at same strike. Replicates long stock position.',
    legs: [
      { position: 'buy', optionType: 'call', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'sell', optionType: 'put', strikeOffset: 0, premiumPercent: 1.0 }
    ]
  },
  'synthetic-short': {
    name: 'Synthetic Short',
    description: 'Sell call + buy put at same strike. Replicates short stock position.',
    legs: [
      { position: 'sell', optionType: 'call', strikeOffset: 0, premiumPercent: 1.0 },
      { position: 'buy', optionType: 'put', strikeOffset: 0, premiumPercent: 1.0 }
    ]
  }
};


const YAHOO = `${BACKEND_URL}/api/yahoo`;
const GROQ  = `${BACKEND_URL}/api`;

function App() {
  const [activeTab, setActiveTab] = useState('home');
  
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
  const NEWS_API_KEY = 'c14ca467b8574c3b8091d20368031139';
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

  // ── Auth state ───────────────────────────────────────────────────────────
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
  useEffect(() => { localStorage.setItem('db_groq_key',  groqApiKey);       }, [groqApiKey]);
  useEffect(() => { localStorage.setItem('db_tg_chatid', tgChatId);         }, [tgChatId]);
  useEffect(() => { localStorage.setItem('db_notify_hi', notifyHighImpact); }, [notifyHighImpact]);
  useEffect(() => { localStorage.setItem('db_notify_sc', notifyScanner);    }, [notifyScanner]);


  // ── Stock Deep Dive ──────────────────────────────────────────────────────
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


  // ── Backtest Engine ──────────────────────────────────────────────────────
  const runBacktest = async () => {
    setBtRunning(true); setBtResult(null);

    // Fetch historical data
    const ticker = (CHART_YAHOO_MAP[btSymbol]||btSymbol+'.NS').trim();
    const tfMap  = { '1D':'1d','1W':'1wk','1M':'1mo' };
    const rangeMap = { '3m':'3mo','6m':'6mo','1y':'1y','2y':'2y','5y':'5y' };
    const interval = tfMap[btTimeframe]||'1d';
    const range    = rangeMap[btPeriod]||'1y';

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

    // ── Helper: SMA ──
    const sma = (arr, p) => arr.map((v,i) => i<p-1 ? null : arr.slice(i-p+1,i+1).reduce((s,x)=>s+x,0)/p);

    // ── Helper: RSI ──
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

    // ── Helper: Black-Scholes approx for options P&L ──
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

    // ── Strategy engines ──
    const fastSMA = sma(closes, fastMA);
    const slowSMA = sma(closes, slowMA);
    const rsiVals = rsi(closes);

    for (let i = Math.max(fastMA, slowMA, 30); i < candles.length; i++) {
      const c    = candles[i];
      const prev = candles[i-1];
      const S    = c.close;

      // ── ENTRY SIGNALS ──
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
      }

      // ── EXIT open position ──
      if (position && signal && signal !== 'SELL_STRADDLE') {
        let pnl = 0;
        if (btStrategy === 'ma_crossover' || btStrategy === 'rsi' || btStrategy === 'breakout') {
          if (position.optionType === 'CE') {
            const daysLeft = Math.max(0, position.daysToExpiry - (i - position.entryBar));
            const exitPx   = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, 'CE');
            pnl = (exitPx - position.entryPx) * lot;
          } else {
            const daysLeft = Math.max(0, position.daysToExpiry - (i - position.entryBar));
            const exitPx   = bsPrice(S, position.strike, daysLeft/365, 0.065, 0.16, 'PE');
            pnl = (exitPx - position.entryPx) * lot;
          }
        }
        cash += pnl;
        trades.push({ date:c.date, type:'EXIT', side:position.optionType, strike:position.strike, entryDate:position.entryDate, entryPx:position.entryPx, exitPx: (cash/lot).toFixed(2), pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // ── EXIT straddle ──
      if (position && signal === 'EXIT_STRADDLE') {
        const daysLeft = 0;
        const cePx = bsPrice(S, position.strike, daysLeft/365, 0.065, position.ceIV||0.16, 'CE');
        const pePx = bsPrice(S, position.strike, daysLeft/365, 0.065, position.peIV||0.16, 'PE');
        const pnl  = (position.cePx + position.pePx - cePx - pePx) * lot;
        cash += pnl;
        trades.push({ date:c.date, type:'EXIT', side:'STRADDLE', strike:position.strike, entryDate:position.entryDate, pnl:Math.round(pnl), capital:Math.round(cash) });
        position = null;
      }

      // ── ENTER new position ──
      if (!position && signal && signal !== 'EXIT_STRADDLE') {
        if (signal === 'SELL_STRADDLE') {
          const strike = Math.round(S/50)*50;
          const cePx   = bsPrice(S, strike, 4/365, 0.065, 0.16, 'CE');
          const pePx   = bsPrice(S, strike, 4/365, 0.065, 0.16, 'PE');
          position = { type:'SELL_STRADDLE', entryDate:c.date, entryBar:i, strike, cePx, pePx, ceIV:0.16, peIV:0.16 };
          trades.push({ date:c.date, type:'ENTRY', side:'STRADDLE_SELL', strike, entryPx:(cePx+pePx).toFixed(2), capital:Math.round(cash) });
        } else {
          const optType  = signal === 'LONG' ? 'CE' : 'PE';
          const strikeMul = btSymbol.includes('BANK') ? 100 : 50;
          const strike   = signal === 'LONG' ? Math.ceil(S/strikeMul)*strikeMul : Math.floor(S/strikeMul)*strikeMul;
          const daysToExp = 7;
          const entryPx  = bsPrice(S, strike, daysToExp/365, 0.065, 0.16, optType);
          const cost     = entryPx * lot;
          if (cost > cash * 0.15) { equity.push({ date:c.date, value:Math.round(cash) }); continue; } // risk check
          cash -= cost;
          position = { type:signal, optionType:optType, entryDate:c.date, entryBar:i, strike, entryPx, daysToExpiry:daysToExp };
          trades.push({ date:c.date, type:'ENTRY', side:optType, strike, entryPx:entryPx.toFixed(2), capital:Math.round(cash) });
        }
      }

      equity.push({ date:c.date, value:Math.round(cash) });
    }

    // ── Close any open position at end ──
    if (position) {
      const S = candles[candles.length-1].close;
      const exitPx = bsPrice(S, position.strike, 0, 0.065, 0.16, position.optionType||'CE');
      const pnl    = position.optionType ? (exitPx - position.entryPx) * lot : 0;
      cash += pnl;
      trades.push({ date:candles[candles.length-1].date, type:'EXIT(End)', side:position.optionType||'STRADDLE', pnl:Math.round(pnl), capital:Math.round(cash) });
    }

    // ── Stats ──
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

  // ── Wake backend on load (Render free tier sleeps) ──────────────────────────
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/health`).catch(()=>{});
  }, []);

  // ── Firebase auth listener ────────────────────────────────────────────────
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

  // ── Save settings to Firestore when changed ───────────────────────────────
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

  // ── Auth functions ────────────────────────────────────────────────────────
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
      const msgs = { 'auth/email-already-in-use':'Email already registered — try logging in', 'auth/wrong-password':'Wrong password', 'auth/user-not-found':'No account with this email', 'auth/weak-password':'Password must be 6+ characters', 'auth/invalid-email':'Invalid email address' };
      setAuthError(msgs[e.code] || e.message);
    }
    finally { setAuthSubmitting(false); }
  };

  const handleSignOut = async () => { await signOut(auth); setTradeLog([]); };

  // ── Save trade to Firestore (overrides localStorage-only addTrade) ────────
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
  const [liveChanges, setLiveChanges] = useState({}); // name → % change
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
    
    // BSE Indices
    'Sensex': 77000,
    'BSE 100': 24000,
    'BSE 200': 13500,
    'BSE 500': 32000,
    'BSE Midcap': 43000,
    'BSE Smallcap': 48000,
    'BSE Auto': 48000,
    'BSE Bankex': 55000,
    'BSE IT': 42000,
    'BSE Healthcare': 40000,
    'BSE Power': 5200,
    'BSE Realty': 4800,
    'BSE Metal': 29000,
    'BSE Oil & Gas': 23000,
    
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
  const [events, setEvents] = useState([
    { date: '2026-02-19', type: 'earnings', company: 'Reliance', title: 'Q3 Results', impact: 'high' },
    { date: '2026-02-20', type: 'economy', title: 'RBI Policy Decision', impact: 'high' },
    { date: '2026-02-21', type: 'expiry', title: 'Weekly Options Expiry', impact: 'medium' },
    { date: '2026-02-25', type: 'earnings', company: 'TCS', title: 'Q3 Results', impact: 'high' },
    { date: '2026-02-26', type: 'economy', title: 'GDP Data Release', impact: 'high' },
    { date: '2026-02-27', type: 'expiry', title: 'Monthly Options Expiry', impact: 'high' },
    { date: '2026-03-01', type: 'economy', title: 'Auto Sales Data', impact: 'medium' },
  ]);
  const [businessNews, setBusinessNews] = useState([]);
  const [isLoadingBusinessNews, setIsLoadingBusinessNews] = useState(false);

  // CANDLESTICK CHART STATE
  const [selectedChartSymbol, setSelectedChartSymbol] = useState('NIFTY');
  const [chartTimeframe, setChartTimeframe] = useState('5m'); // 1D, 5D, 1M, 3M, 6M, 1Y
  const [candlestickType, setCandlestickType] = useState('candlestick');
  const [chartIndicators, setChartIndicators] = useState(['SMA', 'RSI']);
  const [lastChartUpdate, setLastChartUpdate] = useState(new Date()); // SMA, EMA, RSI, MACD, BB
  const [candlestickData, setCandlestickData] = useState([]);

  // CUSTOM SCANNER FILTERS
  const [customFilters, setCustomFilters] = useState([]);

  // INSTITUTIONAL ACTIVITY & BULK DEALS
  const [institutionalActivity, setInstitutionalActivity] = useState({
    fii: { buy: 2450, sell: 1890, net: 560 },
    dii: { buy: 1850, sell: 2100, net: -250 },
    lastUpdated: new Date()
  });
  
  const [bulkDeals, setBulkDeals] = useState([
    { date: '18-Feb-26', stock: 'RELIANCE', client: 'HDFC Mutual Fund', type: 'BUY', quantity: 125000, price: 2850.50, value: 35.63 },
    { date: '18-Feb-26', stock: 'TCS', client: 'ICICI Prudential', type: 'SELL', quantity: 89000, price: 3920.20, value: 34.89 },
    { date: '18-Feb-26', stock: 'HDFCBANK', client: 'SBI Mutual Fund', type: 'BUY', quantity: 200000, price: 1645.80, value: 32.92 },
    { date: '17-Feb-26', stock: 'INFY', client: 'LIC of India', type: 'BUY', quantity: 150000, price: 1580.40, value: 23.71 },
  ]);
  
  const [blockDeals, setBlockDeals] = useState([
    { date: '18-Feb-26', stock: 'TATASTEEL', client: 'Morgan Stanley', type: 'SELL', quantity: 2500000, price: 142.60, value: 356.50 },
    { date: '18-Feb-26', stock: 'WIPRO', client: 'Goldman Sachs', type: 'BUY', quantity: 1800000, price: 465.30, value: 83.75 },
  ]);
  
  const [optionInstitutionalActivity, setOptionInstitutionalActivity] = useState([
    { strike: 23400, type: 'CE', fiiOI: 45000, diiOI: 32000, fiiChange: '+12%', diiChange: '-5%' },
    { strike: 23450, type: 'CE', fiiOI: 89000, diiOI: 56000, fiiChange: '+28%', diiChange: '+15%' },
    { strike: 23500, type: 'PE', fiiOI: 125000, diiOI: 98000, fiiChange: '+45%', diiChange: '+38%' },
  ]);
  const [newFilter, setNewFilter] = useState({
    name: '',
    conditions: [{ metric: 'ceOI', operator: '>', value: 50000 }]
  });

  // PCR + MAX PAIN + FII/DII + OI STATE
  const [pcrData, setPcrData] = useState({ pcr: 1.05, signal: 'Neutral', totalCE: 0, totalPE: 0 });
  const [maxPainData, setMaxPainData] = useState({ maxPain: 23500, currentSpot: 23450 });
  const [fiiDiiData, setFiiDiiData] = useState([
    { date: '17-Feb', fii: -1250, dii: 980 },
    { date: '14-Feb', fii: 2100, dii: -450 },
    { date: '13-Feb', fii: -890, dii: 1200 },
    { date: '12-Feb', fii: 3400, dii: -200 },
    { date: '11-Feb', fii: -500, dii: 750 },
    { date: '10-Feb', fii: 1800, dii: 320 },
    { date: '07-Feb', fii: -2200, dii: 1800 },
  ]);
  const [oiChartData, setOiChartData] = useState([]);
  const [activeHomeTab, setActiveHomeTab] = useState('news');

  // SCANNER STATE
  const [optionChainData, setOptionChainData] = useState([
    { strike: 23300, cePremium: 250, pePremium: 50, ceOI: 50000, peOI: 30000, ceOpen: 250, ceHigh: 270 },
    { strike: 23500, cePremium: 150, pePremium: 150, ceOI: 80000, peOI: 75000, ceOpen: 150, ceHigh: 150 },
    { strike: 23700, cePremium: 80, pePremium: 280, ceOI: 40000, peOI: 60000, ceOpen: 80, ceHigh: 90 },
  ]);
  const [alerts, setAlerts] = useState([]);
  const [scannerIV, setScannerIV] = useState(18);
  const [scannerExpiry, setScannerExpiry] = useState(5);

  useEffect(() => {
    const saved = localStorage.getItem('deltabuddy-strategies');
    if (saved) {
      setSavedStrategies(JSON.parse(saved));
    }
  }, []);
  // Telegram
  const sendTelegramMessage = async (text, dedupeKey) => {
    if (!tgChatId) return;
    // Deduplicate — don't send same alert twice within 1 hour
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

  // Fetch live prices from Yahoo Finance (free, no API key needed)
  const fetchLivePrices = async () => {
    setIsPriceLoading(true);
    try {
      // Core: NSE indices + Sensex + top FNO stocks for gainers/losers
      const symbols = {
        // Core indices (always fetch)
        'Nifty 50':        '^NSEI',
        'Bank Nifty':      '^NSEBANK',
        'Nifty IT':        'NIFTYIT.NS',
        'Nifty Pharma':    'NIFTYPHARMA.NS',
        'Nifty Auto':      'NIFTYAUTO.NS',
        'Nifty Metal':     'NIFTYMETAL.NS',
        'Nifty FMCG':      'NIFTYFMCG.NS',
        'Nifty Realty':    'NIFTYREALTY.NS',
        'Nifty Midcap 50': 'NIFTYMIDCAP50.NS',
        'Sensex':          '^BSESN',
        'BSE Midcap':      'BSEMID.BO',
        'BSE Smallcap':    'BSESMALL.BO',
        // Top FNO stocks for gainers/losers
        'Reliance':      'RELIANCE.NS',
        'TCS':           'TCS.NS',
        'HDFC Bank':     'HDFCBANK.NS',
        'Infosys':       'INFY.NS',
        'ICICI Bank':    'ICICIBANK.NS',
        'SBI':           'SBIN.NS',
        'Axis Bank':     'AXISBANK.NS',
        'Bajaj Finance': 'BAJFINANCE.NS',
        'Maruti Suzuki': 'MARUTI.NS',
        'Tata Motors':   'TATAMOTORS.NS',
        'Sun Pharma':    'SUNPHARMA.NS',
        'HCL Tech':      'HCLTECH.NS',
        'Wipro':         'WIPRO.NS',
        'ITC':           'ITC.NS',
        'LT':            'LT.NS',
        'Titan':         'TITAN.NS',
        'Kotak Bank':    'KOTAKBANK.NS',
        'Adani Ports':   'ADANIPORTS.NS',
        'NTPC': 'NTPC.NS',
        'Tata Steel': 'TATASTEEL.NS',
        'JSW Steel': 'JSWSTEEL.NS',
        'Coal India': 'COALINDIA.NS',
        'ONGC': 'ONGC.NS',
        'IOC': 'IOC.NS',
        'Hindalco': 'HINDALCO.NS',
        'Grasim': 'GRASIM.NS',
        'UPL': 'UPL.NS',
        'Britannia': 'BRITANNIA.NS',
        'Div Lab': 'DIVISLAB.NS',
        'Dr Reddy': 'DRREDDY.NS',
        'Cipla': 'CIPLA.NS',
        'Eicher Motors': 'EICHERMOT.NS',
        'Hero MotoCorp': 'HEROMOTOCO.NS',
        'Bajaj Auto': 'BAJAJ-AUTO.NS',
      };

      const results = {};
      
      // Fetch only selected indices to avoid rate limits
      const toFetch = selectedIndices.length > 0 ? selectedIndices : ['Nifty 50', 'Bank Nifty', 'Nifty IT'];
      
      await Promise.all(
        toFetch.map(async (name) => {
          const symbol = symbols[name];
          if (!symbol) return;
          
          try {
            const res = await fetch(`${YAHOO}/chart/${symbol}?interval=1d&range=1d`);
            const data = await res.json();
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            const prevClose = data?.chart?.result?.[0]?.meta?.previousClose;
            const change = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : 0;

            if (price) {
              results[name] = { value: Math.round(price), change: parseFloat(change) };
            }
          } catch (e) {
            console.log(`Could not fetch ${name}`);
          }
        })
      );

      // Update market data display
      if (results['Nifty 50'] || results['Bank Nifty']) {
        setMarketData(prev => ({
          nifty    : results['Nifty 50']   || prev.nifty,
          bankNifty: results['Bank Nifty'] || prev.bankNifty,
          vix      : prev.vix
        }));
      }

      // Update live prices + changes
      const priceMap = {}, changeMap = {};
      Object.entries(results).forEach(([name, data]) => {
        priceMap[name] = data.value;
        if (data.change !== undefined) changeMap[name] = data.change;
      });
      if (Object.keys(priceMap).length > 0) {
        setLivePrices(prev => ({ ...prev, ...priceMap }));
        setLiveChanges(prev => ({ ...prev, ...changeMap }));
      }

    } catch (error) {
      console.error('Error fetching live prices:', error);
    } finally {
      setIsPriceLoading(false);
    }
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

  const generateLiveOptionChain = async (underlying = 'NIFTY') => {
    setIsLoadingChain(true);
    let usedLive = false;
    try {
      // Try NSE India first (most accurate), fallback to Yahoo
      let json, spot, usedNSE = false;
      try {
        const nseRes = await fetch(`${BACKEND_URL}/api/option-chain?symbol=${UNDERLYING_NSE[underlying]||'NIFTY'}`, {headers:{'Accept':'application/json'}});
        if (nseRes.ok) {
          const nseJson = await nseRes.json();
          if (nseJson?.records?.data?.length > 0) {
            // Parse NSE format
            spot = nseJson.records.underlyingValue;
            const expiries = [...new Set(nseJson.records.data.map(d=>d.expiryDate))].slice(0,6);
            if (expiries.length>0) setNseExpiryDates(expiries);
            const map = {};
            nseJson.records.data.forEach(row => {
              const s = row.strikePrice;
              if (!map[s]) map[s] = {strike:s, atmDistance:Math.abs(s-spot)};
              if (row.CE) map[s].ce = {premium:(row.CE.lastPrice||0).toFixed(2),iv:(row.CE.impliedVolatility||0).toFixed(1),oi:row.CE.openInterest||0,volume:row.CE.totalTradedVolume||0,bid:(row.CE.bidprice||0).toFixed(2),ask:(row.CE.askPrice||0).toFixed(2),ltp:(row.CE.lastPrice||0).toFixed(2),change:(row.CE.pChange||0).toFixed(2),delta:0,gamma:0,theta:0,vega:0};
              if (row.PE) map[s].pe = {premium:(row.PE.lastPrice||0).toFixed(2),iv:(row.PE.impliedVolatility||0).toFixed(1),oi:row.PE.openInterest||0,volume:row.PE.totalTradedVolume||0,bid:(row.PE.bidprice||0).toFixed(2),ask:(row.PE.askPrice||0).toFixed(2),ltp:(row.PE.lastPrice||0).toFixed(2),change:(row.PE.pChange||0).toFixed(2),delta:0,gamma:0,theta:0,vega:0};
            });
            const chain = Object.values(map).filter(r=>r.ce&&r.pe).sort((a,b)=>a.strike-b.strike);
            if (chain.length > 0) {
              setLiveOptionChain(chain);
              setChartData({oi:chain.map(r=>({strike:r.strike,ce:r.ce.oi/1000,pe:r.pe.oi/1000})),iv:chain.map(r=>({strike:r.strike,ce:parseFloat(r.ce.iv),pe:parseFloat(r.pe.iv)})),volume:chain.map(r=>({strike:r.strike,ce:r.ce.volume/1000,pe:r.pe.volume/1000})),priceHistory:[]});
              setMarketData(prev=>({...prev,nifty:underlying==='NIFTY'?{...prev.nifty,value:Math.round(spot)}:prev.nifty,bankNifty:underlying==='BANKNIFTY'?{...prev.bankNifty,value:Math.round(spot)}:prev.bankNifty}));
              setIsLoadingChain(false); return; // SUCCESS — NSE data loaded
            }
          }
        }
      } catch(nseErr) { console.warn('NSE direct failed, trying Yahoo:', nseErr.message); }

      // Yahoo Finance fallback
      const sym = UNDERLYING_YAHOO[underlying] || '^NSEI';
      const yahooRes = await fetch(`${YAHOO}/options/${encodeURIComponent(sym)}`);
      if (!yahooRes.ok) throw new Error(`HTTP ${yahooRes.status}`);
      const yahooJson = await yahooRes.json();
      const result = yahooJson?.optionChain?.result?.[0];
      if (!result) throw new Error('No result');
      const yahooSpot = result.quote?.regularMarketPrice || BASE_PRICES[underlying];
      const expiries = (result.expirationDates||[]).map(ts => new Date(ts*1000).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}));
      if (expiries.length>0) setNseExpiryDates(expiries);
      const opts = result.options?.[0]; if (!opts) throw new Error('No options');
      const ymap = {};
      (opts.calls||[]).forEach(c => { const s=c.strike; if(!ymap[s]) ymap[s]={strike:s,atmDistance:Math.abs(s-yahooSpot)}; ymap[s].ce={premium:(c.lastPrice||0).toFixed(2),iv:((c.impliedVolatility||0)*100).toFixed(1),oi:c.openInterest||0,volume:c.volume||0,bid:(c.bid||0).toFixed(2),ask:(c.ask||0).toFixed(2),ltp:(c.lastPrice||0).toFixed(2),change:(c.percentChange||0).toFixed(2),delta:0,gamma:0,theta:0,vega:0}; });
      (opts.puts||[]).forEach(p  => { const s=p.strike; if(!ymap[s]) ymap[s]={strike:s,atmDistance:Math.abs(s-yahooSpot)}; ymap[s].pe={premium:(p.lastPrice||0).toFixed(2),iv:((p.impliedVolatility||0)*100).toFixed(1),oi:p.openInterest||0,volume:p.volume||0,bid:(p.bid||0).toFixed(2),ask:(p.ask||0).toFixed(2),ltp:(p.lastPrice||0).toFixed(2),change:(p.percentChange||0).toFixed(2),delta:0,gamma:0,theta:0,vega:0}; });
      const chain = Object.values(ymap).filter(r=>r.ce&&r.pe).sort((a,b)=>a.strike-b.strike);
      if (!chain.length) throw new Error('Empty chain from Yahoo');
      usedLive = true;
      setLiveOptionChain(chain);
      setChartData({ oi:chain.map(r=>({strike:r.strike,ce:r.ce.oi/1000,pe:r.pe.oi/1000})), iv:chain.map(r=>({strike:r.strike,ce:parseFloat(r.ce.iv),pe:parseFloat(r.pe.iv)})), volume:chain.map(r=>({strike:r.strike,ce:r.ce.volume/1000,pe:r.pe.volume/1000})), priceHistory:[] });
      setMarketData(prev => ({ ...prev, nifty:underlying==='NIFTY'?{...prev.nifty,value:Math.round(yahooSpot)}:prev.nifty, bankNifty:underlying==='BANKNIFTY'?{...prev.bankNifty,value:Math.round(yahooSpot)}:prev.bankNifty }));
    } catch(e) {
      console.warn('Yahoo option chain failed, using simulation:', e.message);
      const spot = marketData.nifty.value > 24000 ? marketData.nifty.value : BASE_PRICES[underlying];
      const chain = buildSimulatedChain(underlying, spot);
      setLiveOptionChain(chain);
      setChartData({ oi:chain.map(r=>({strike:r.strike,ce:r.ce.oi/1000,pe:r.pe.oi/1000})), iv:chain.map(r=>({strike:r.strike,ce:parseFloat(r.ce.iv),pe:parseFloat(r.pe.iv)})), volume:chain.map(r=>({strike:r.strike,ce:r.ce.volume/1000,pe:r.pe.volume/1000})), priceHistory:[] });
    } finally { setIsLoadingChain(false); }
  };

  // Fetch General Business News
  const fetchBusinessNews = async () => {
    setIsLoadingBusinessNews(true);
    try {
      const query = 'business OR economy OR markets OR companies OR earnings OR IPO';
      const response = await fetch(
`${BACKEND_URL}/api/news?q=${encodeURIComponent(query)}&pageSize=20&apiKey=c14ca467b8574c3b8091d20368031139`
      );
      const data = await response.json();
      if (data.articles) {
        setBusinessNews(data.articles.map(article => ({
          id: article.url,
          title: article.title,
          description: article.description,
          source: article.source.name,
          publishedAt: new Date(article.publishedAt),
          url: article.url,
          image: article.urlToImage
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
      const query = 'nifty OR sensex OR "bank nifty" OR "india market" OR RBI OR "crude oil" OR "india pakistan" OR geopolitical OR "fed rate"';
      const response = await fetch(`${BACKEND_URL}/api/news?q=${encodeURIComponent(query)}&pageSize=10&sortBy=publishedAt&apiKey=c14ca467b8574c3b8091d20368031139`);
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
              sendTelegramMessage(`${em} <b>HIGH IMPACT — ${ai.affectedIndex}</b>

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
        const tradingIdea=sentiment==='bearish'&&impact!=='low'?{strategy:'Bear Put Spread',name:'Bear Put Spread',reasoning:`${impact} impact bearish news suggests downward pressure.`,timeframe:'1-3 Days',risk:'Medium',strikes:{buy:Math.round(lv.current),sell:Math.round(lv.support[0])},probability:'—',aiPowered:false}:sentiment==='bullish'&&impact!=='low'?{strategy:'Bull Call Spread',name:'Bull Call Spread',reasoning:`${impact} impact bullish news suggests upward momentum.`,timeframe:'1-3 Days',risk:'Medium',strikes:{buy:Math.round(lv.current),sell:Math.round(lv.resistance[0])},probability:'—',aiPowered:false}:{strategy:'Wait and Watch',name:'Wait and Watch',reasoning:'Direction unclear.',timeframe:'N/A',risk:'None',strikes:null,probability:'—',aiPowered:false};
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
      setActiveTab('strategy');
      const newLegs = [
        { id: 1, position: 'buy', optionType: 'put', strike: tradingIdea.strikes.buy, premium: 150, quantity: 1 },
        { id: 2, position: 'sell', optionType: 'put', strike: tradingIdea.strikes.sell, premium: 80, quantity: 1 }
      ];
      setLegs(newLegs);
    } else if (tradingIdea.strategy === 'Bull Call Spread' && tradingIdea.strikes) {
      setActiveTab('strategy');
      const newLegs = [
        { id: 1, position: 'buy', optionType: 'call', strike: tradingIdea.strikes.buy, premium: 150, quantity: 1 },
        { id: 2, position: 'sell', optionType: 'call', strike: tradingIdea.strikes.sell, premium: 80, quantity: 1 }
      ];
      setLegs(newLegs);
    }
  };

  // SCANNER FUNCTIONS
  const runScan = () => {
    const newAlerts = [];
    const atmStrike = optionChainData.find(d => Math.abs(d.strike - spot) < 200);
    if (atmStrike && atmStrike.ceOpen === atmStrike.ceHigh && atmStrike.pePremium > 150) {
      newAlerts.push({ type: 'crash', title: '⚠️ Market Crash Warning', description: `${atmStrike.strike} CE rejected at highs + PE premium spiking`, recommendation: 'Bear Put Spread', severity: 'high' });
    }
    optionChainData.forEach(data => {
      if (Math.abs(data.cePremium - data.pePremium) < 10) {
        newAlerts.push({ type: 'synthetic', title: '💰 Synthetic Opportunity', description: `Strike ${data.strike}: CE ≈ PE (Cost advantage: ₹${Math.abs(data.cePremium - data.pePremium)})`, recommendation: 'Synthetic Long/Short', severity: 'medium' });
      }
    });
    if (scannerIV > 25 && scannerExpiry < 5) {
      newAlerts.push({ type: 'iv-crush', title: '⚡ IV Crush Imminent', description: `High IV (${scannerIV}%) + Expiry in ${scannerExpiry} days`, recommendation: 'Sell Iron Condor / Straddle', severity: 'high' });
    }
    const maxOIStrike = optionChainData.reduce((max, d) => (d.ceOI + d.peOI) > (max.ceOI + max.peOI) ? d : max);
    if (maxOIStrike && (maxOIStrike.ceOI + maxOIStrike.peOI) > 100000) {
      newAlerts.push({ type: 'gamma', title: '🔥 Gamma Squeeze Zone', description: `Max OI at ${maxOIStrike.strike} (${((maxOIStrike.ceOI + maxOIStrike.peOI)/1000).toFixed(0)}K contracts)`, recommendation: 'Straddle / Strangle', severity: 'medium' });
    }
    const totalCE = optionChainData.reduce((sum, d) => sum + d.ceOI, 0);
    const totalPE = optionChainData.reduce((sum, d) => sum + d.peOI, 0);
    const pcr = totalPE / totalCE;
    if (pcr > 1.5) {
      newAlerts.push({ type: 'pcr', title: '📈 Bullish PCR Signal', description: `PCR = ${pcr.toFixed(2)} (Very High - Market Bullish)`, recommendation: 'Bull Call Spread', severity: 'medium' });
    } else if (pcr < 0.7) {
      newAlerts.push({ type: 'pcr', title: '📉 Bearish PCR Signal', description: `PCR = ${pcr.toFixed(2)} (Very Low - Market Bearish)`, recommendation: 'Bear Put Spread', severity: 'medium' });
    }
    setAlerts(newAlerts);
  };

  // Auto-refresh news and prices - LIVE MODE
  useEffect(() => {
    fetchLivePrices();
    fetchIntelligentNews();
    fetchGlobalIndices();
    generateLiveOptionChain(selectedUnderlying);
    fetchBusinessNews();
    generateCandlestickData(selectedChartSymbol, chartTimeframe);
    
    if (isLiveMode) {
      // Ticker: Yahoo Finance every 15 seconds
      const globalInterval = setInterval(fetchGlobalIndices, 15000);

      // Live prices: Yahoo Finance every 15 seconds
      const indiaInterval = setInterval(fetchLivePrices, 15000);

      // Option chain: NSE every 10 seconds
      const chainInterval = setInterval(() => generateLiveOptionChain(selectedUnderlying), 10000);

      // News: NewsAPI + AI every 5 minutes (top 10 only)
      const newsInterval = setInterval(() => { fetchIntelligentNews(); fetchBusinessNews(); }, 300000);

      return () => {
        clearInterval(globalInterval);
        clearInterval(indiaInterval);
        clearInterval(chainInterval);
        clearInterval(newsInterval);
      };
    }
  }, [isLiveMode, selectedUnderlying, selectedChartSymbol, chartTimeframe]);

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

  // Build OI Chart data from option chain
  useEffect(() => {
    const chartData = optionChainData.map(d => ({
      strike: d.strike,
      ceOI: Math.round(d.ceOI / 1000),
      peOI: Math.round(d.peOI / 1000),
    }));
    setOiChartData(chartData);
  }, [optionChainData]);


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
      let intrinsicValue = 0;
      if (leg.optionType === 'call') {
        intrinsicValue = Math.max(0, currentSpot - leg.strike);
      } else {
        intrinsicValue = Math.max(0, leg.strike - currentSpot);
      }
      
      const valueAtExpiry = intrinsicValue;
      const legPL = leg.position === 'buy'
        ? (valueAtExpiry - leg.premium) * lotSize * leg.quantity
        : (leg.premium - valueAtExpiry) * lotSize * leg.quantity;
      
      totalPL += legPL;
    });
    
    return totalPL;
  };

  const generateMultiLegPLData = () => {
    const data = [];
    const allStrikes = legs.map(l => l.strike);
    const minStrike = Math.min(...allStrikes);
    const maxStrike = Math.max(...allStrikes);
    const range = (maxStrike - minStrike) * 0.5 || spot * 0.15;
    const center = (minStrike + maxStrike) / 2;
    const step = range / 100;
    
    for (let price = center - range; price <= center + range; price += step) {
      data.push({
        spot: Math.round(price),
        pl: calculateMultiLegPL(price)
      });
    }
    return data;
  };

  const multiLegPLData = legs.length > 0 ? generateMultiLegPLData() : [];
  const currentMultiLegPL = legs.length > 0 ? calculateMultiLegPL(spot) : 0;

  const calculateMultiLegGreeks = () => {
    let totalDelta = 0;
    let totalGamma = 0;
    let totalTheta = 0;
    let totalVega = 0;
    
    legs.forEach(leg => {
      const legGreeks = calculateBlackScholes(
        spot, leg.strike, timeToExpiry, volatility / 100, riskFreeRate, leg.optionType
      );
      
      const multiplier = leg.position === 'buy' ? 1 : -1;
      totalDelta += legGreeks.delta * multiplier * leg.quantity;
      totalGamma += legGreeks.gamma * multiplier * leg.quantity;
      totalTheta += legGreeks.theta * multiplier * leg.quantity;
      totalVega += legGreeks.vega * multiplier * leg.quantity;
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
          <div className="logo">
            <span className="delta">Δ</span>
            <span>DeltaBuddy</span>
          </div>
          <button onClick={()=>setShowMobileMenu(m=>!m)}
            className="hamburger-btn" style={{background:'none',border:'none',color:'var(--text-main)',fontSize:'1.5rem',cursor:'pointer',padding:'0.25rem 0.5rem'}}
            className="hamburger-btn" aria-label="Menu">{showMobileMenu?'✕':'☰'}</button>

          <div className={`nav-links${showMobileMenu?' mobile-open':''}`} style={{display:'flex',alignItems:'center',gap:'0.1rem',flexWrap:'nowrap'}}>
            {[
              ['home',         'Home'],
              ['markets',      'Markets'],
              ['intelligence', '🧠 Intelligence'],
              ['backtest',     '📈 Backtest'],
              ['single',       'Calculator'],
              ['scanner',      'Scanner'],
              ['journal',      'Journal'],
            ].map(([tab,label])=>(
              <span key={tab} className={activeTab===tab?'active':''} onClick={()=>{setActiveTab(tab);setShowMobileMenu(false);}} style={{padding:'0.55rem 1rem',fontSize:'1rem',whiteSpace:'nowrap',cursor:'pointer',fontWeight:activeTab===tab?700:500,color:activeTab===tab?'var(--accent)':'var(--text-dim)',borderBottom:activeTab===tab?'2px solid var(--accent)':'2px solid transparent'}}>
                {label}
              </span>
            ))}
            <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginLeft:'0.5rem'}}>
              {!authLoading && (currentUser ? (
                <div style={{position:'relative',display:'flex',alignItems:'center',gap:'0.5rem'}}>
                  {/* Telegram bell */}
                  <button onClick={()=>setShowTgSetup(true)} title="Connect Telegram alerts"
                    style={{background:'none',border:'none',cursor:'pointer',padding:'2px',fontSize:'1.1rem',opacity:tgChatId?1:0.5}}
                    title={tgChatId?'Telegram connected — click to update':'Connect Telegram for alerts'}>
                    {tgChatId ? '🔔' : '🔕'}
                  </button>
                  {/* Avatar → sign out */}
                  <div style={{cursor:'pointer'}} onClick={handleSignOut} title="Click to sign out">
                    {currentUser.photoURL
                      ? <img src={currentUser.photoURL} alt="" style={{width:'30px',height:'30px',borderRadius:'50%',border:'2px solid var(--accent)',display:'block'}}/>
                      : <div style={{width:'30px',height:'30px',borderRadius:'50%',background:'var(--accent)',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:'0.85rem'}}>{(currentUser.displayName||currentUser.email||'U')[0].toUpperCase()}</div>}
                  </div>
                </div>
              ) : (
                <button onClick={()=>setShowAuthModal(true)} style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.3rem 0.85rem',fontWeight:700,cursor:'pointer',fontSize:'0.82rem'}}>Sign In</button>
              ))}
              <a href="https://wa.me/917506218502?text=Hi%20DeltaBuddy%20Team%2C%20I%20need%20help%20with..."
                target="_blank" rel="noreferrer"
                title="Get help on WhatsApp"
                style={{color:'#25D366',fontSize:'0.78rem',fontWeight:600,textDecoration:'none',padding:'0.25rem 0.4rem',borderRadius:'6px',border:'1px solid rgba(37,211,102,0.3)',whiteSpace:'nowrap'}}>
                💬 Help
              </a>
              {isAdmin && (
                <span title="Admin Settings" onClick={()=>{setShowSettings(s=>!s);setShowMobileMenu(false);}}
                  style={{cursor:'pointer',fontSize:'1.1rem',padding:'0.25rem 0.5rem',borderRadius:'6px',background:showSettings?'var(--accent)':'transparent',lineHeight:1}}>
                  ⚙️
                </span>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="container main-content">
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
        {/* ── TELEGRAM SETUP MODAL — for regular users ── */}
        {showTgSetup && (
          <div className="modal-overlay" onClick={()=>setShowTgSetup(false)}>
            <div className="modal-content" onClick={e=>e.stopPropagation()} style={{maxWidth:'440px',width:'95%'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
                <h2 style={{margin:0,fontSize:'1.15rem'}}>📱 Connect Telegram</h2>
                <button onClick={()=>setShowTgSetup(false)} style={{background:'none',border:'none',color:'var(--text-dim)',fontSize:'1.5rem',cursor:'pointer'}}>✕</button>
              </div>

              <p style={{color:'var(--text-dim)',fontSize:'0.85rem',marginBottom:'1.25rem',lineHeight:1.6}}>
                Get instant alerts for high-impact news and scanner signals — directly on Telegram. Free, takes 60 seconds.
              </p>

              {/* Steps */}
              {[
                ['1', 'Open Telegram', 'Search for our bot: ', '@DeltaBuddyAlertBot', 'https://t.me/DeltaBuddyAlertBot'],
                ['2', 'Start the bot', 'Press the Start button or send /start to the bot', null, null],
                ['3', 'Get your Chat ID', 'The bot will reply with your unique Chat ID number. Copy it.', null, null],
              ].map(([num, title, desc, link, href])=>(
                <div key={num} style={{display:'flex',gap:'0.75rem',marginBottom:'1rem',alignItems:'flex-start'}}>
                  <div style={{width:'28px',height:'28px',borderRadius:'50%',background:'var(--accent)',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:'0.85rem',flexShrink:0}}>{num}</div>
                  <div>
                    <div style={{fontWeight:600,fontSize:'0.88rem',marginBottom:'2px'}}>{title}</div>
                    <div style={{fontSize:'0.8rem',color:'var(--text-dim)'}}>
                      {desc}
                      {link && <a href={href} target="_blank" rel="noreferrer" style={{color:'var(--accent)',fontWeight:600}}>{link}</a>}
                    </div>
                  </div>
                </div>
              ))}

              {/* Chat ID input */}
              <div style={{background:'var(--bg-dark)',borderRadius:'8px',padding:'0.75rem',marginBottom:'1rem'}}>
                <label style={{fontSize:'0.78rem',color:'var(--text-dim)',display:'block',marginBottom:'0.4rem'}}>Paste your Chat ID here:</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 6458200459"
                  value={tgChatId}
                  onChange={e=>setTgChatId(e.target.value.trim())}
                  style={{width:'100%',boxSizing:'border-box',fontSize:'1rem',letterSpacing:'0.05em'}}
                />
              </div>

              <div style={{display:'flex',gap:'0.75rem'}}>
                <button
                  onClick={async()=>{
                    await testTelegram();
                    if(currentUser) {
                      try { await setDoc(doc(db,'users',currentUser.uid),{tgChatId,updatedAt:serverTimestamp()},{merge:true}); } catch(e){}
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
              {tgStatus==='error' && <p style={{color:'#ef4444',fontSize:'0.82rem',marginTop:'0.5rem',textAlign:'center'}}>❌ Couldn't send. Make sure you've pressed Start on the bot first.</p>}
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
                <h3 style={{margin:'0 0 0.5rem',color:'var(--accent)',fontSize:'0.95rem'}}>🤖 Groq AI — News Intelligence (Free)</h3>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',margin:'0 0 0.6rem'}}>Free at <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>console.groq.com</a> — 14,400 requests/day. Model: Llama 3.3 70B.</p>
                <input type="password" className="input-field" placeholder="Groq API key (gsk_...)" value={groqApiKey} onChange={e=>setGroqApiKey(e.target.value)} style={{width:'100%',boxSizing:'border-box',marginBottom:'0.5rem'}}/>
                <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                  <button className="btn-action" onClick={testGroq} disabled={!groqApiKey||groqStatus==='testing'}>{groqStatus==='testing'?'⏳ Testing...':'🔌 Test'}</button>
                  {groqStatus==='ok' && <button className="btn-action" style={{background:'#22c55e',color:'#000'}} onClick={()=>{setShowSettings(false);fetchIntelligentNews();}}>✅ Save & Load News</button>}
                  {groqStatus==='error' && <span style={{color:'#ef4444',fontSize:'0.82rem'}}>❌ Failed — check key</span>}
                  {groqStatus==='timeout' && <span style={{color:'#f59e0b',fontSize:'0.82rem'}}>⏳ Server waking up — wait 30s and try again</span>}
                  {!groqApiKey && <span style={{color:'var(--text-dim)',fontSize:'0.78rem'}}>No key — keyword mode</span>}
                </div>
              </div>

              <div style={{marginBottom:'1.25rem',padding:'1rem',background:'var(--bg-dark)',borderRadius:'8px',border:'1px solid #1e3a5f'}}>
                <h3 style={{margin:'0 0 0.5rem',color:'#229ED9',fontSize:'0.95rem'}}>📱 Telegram Bot — Admin Config</h3>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',margin:'0 0 0.75rem'}}>
                  Bot token is set on Render as <code style={{background:'#1e293b',padding:'1px 5px',borderRadius:'3px'}}>TG_BOT_TOKEN</code> env variable. Users connect via Chat ID only — they never see the token.
                </p>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',margin:'0 0 0.6rem'}}>
                  Your admin Chat ID (for your own alerts):
                </p>
                <input type="text" className="input-field" placeholder="Your Chat ID (e.g. 6458200459)" value={tgChatId} onChange={e=>setTgChatId(e.target.value)} style={{width:'100%',boxSizing:'border-box',marginBottom:'0.5rem'}}/>
                <div style={{display:'flex',gap:'0.5rem',alignItems:'center',flexWrap:'wrap'}}>
                  <button className="btn-action" onClick={testTelegram} disabled={!tgChatId||tgStatus==='testing'}>{tgStatus==='testing'?'⏳ Sending...':'📤 Test Alert'}</button>
                  {tgStatus==='ok' && <span style={{color:'#22c55e',fontSize:'0.82rem'}}>✅ Sent! Check Telegram.</span>}
                  {tgStatus==='error' && <span style={{color:'#ef4444',fontSize:'0.82rem'}}>❌ Add TG_BOT_TOKEN to <b>backend</b> service on Render (not frontend)</span>}
                </div>
              </div>

              <div style={{padding:'1rem',background:'var(--bg-dark)',borderRadius:'8px',border:'1px solid var(--border)'}}>
                <h3 style={{margin:'0 0 0.75rem',fontSize:'0.95rem'}}>🔔 Notify Me When</h3>
                <label style={{display:'flex',alignItems:'center',gap:'0.6rem',marginBottom:'0.6rem',cursor:'pointer'}}>
                  <input type="checkbox" checked={notifyHighImpact} onChange={e=>setNotifyHighImpact(e.target.checked)}/>
                  📰 High-impact news detected by AI
                </label>
                <label style={{display:'flex',alignItems:'center',gap:'0.6rem',cursor:'pointer'}}>
                  <input type="checkbox" checked={notifyScanner} onChange={e=>setNotifyScanner(e.target.checked)}/>
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

            {/* ── MARKET PULSE CARDS ── */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'1rem',marginBottom:'1.5rem'}}>
              {[
                {name:'NIFTY 50',val:marketData.nifty.value,chg:marketData.nifty.change,icon:'📈'},
                {name:'BANK NIFTY',val:marketData.bankNifty.value,chg:marketData.bankNifty.change,icon:'🏦'},
              ].map(({name,val,chg,icon})=>{
                const pts = val && chg ? ((chg/100)*val/(1+chg/100)).toFixed(0) : 0;
                const isPos = chg >= 0;
                return (
                <div key={name} style={{background:'linear-gradient(135deg,#0f1f35,#0a1628)',border:`1px solid ${isPos?'rgba(74,222,128,0.3)':'rgba(248,113,113,0.3)'}`,borderRadius:'16px',padding:'1.25rem 1.5rem',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:'0.85rem',color:'#64748b',fontWeight:600,letterSpacing:'0.06em',marginBottom:'0.4rem'}}>{icon} {name}</div>
                    <div style={{fontSize:'2rem',fontWeight:800,color:'#f0f9ff',letterSpacing:'-0.02em',lineHeight:1}}>{(val||0).toLocaleString()}</div>
                    <div style={{fontSize:'0.8rem',color:'#475569',marginTop:'0.3rem'}}>prev close</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:'1.2rem',fontWeight:800,color:isPos?'#4ade80':'#f87171'}}>{isPos?'▲':'▼'} {Math.abs(chg||0).toFixed(2)}%</div>
                    <div style={{fontSize:'0.95rem',fontWeight:600,color:isPos?'#4ade80':'#f87171',marginTop:'0.1rem'}}>{isPos?'+':''}{pts} pts</div>
                    <button onClick={fetchLivePrices} style={{marginTop:'0.5rem',background:'transparent',border:'1px solid #1e3a5f',color:'#4ade80',borderRadius:'6px',padding:'0.25rem 0.75rem',fontSize:'0.75rem',cursor:'pointer'}}>🔄 Refresh</button>
                  </div>
                </div>
                );
              })}
              {/* Quick action cards */}
              <div onClick={()=>setActiveTab('markets')} style={{background:'linear-gradient(135deg,#0f1f35,#0a1628)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:'16px',padding:'1.25rem 1.5rem',cursor:'pointer',display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
                <div style={{fontSize:'1.5rem',marginBottom:'0.5rem'}}>⚡</div>
                <div style={{fontSize:'1rem',fontWeight:700,color:'#f0f9ff'}}>Option Chain</div>
                <div style={{fontSize:'0.8rem',color:'#64748b',marginTop:'0.25rem'}}>Live OI, PCR, Max Pain →</div>
              </div>
              <div onClick={()=>setActiveTab('intelligence')} style={{background:'linear-gradient(135deg,#0f1f35,#0a1628)',border:'1px solid rgba(0,255,136,0.2)',borderRadius:'16px',padding:'1.25rem 1.5rem',cursor:'pointer',display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
                <div style={{fontSize:'1.5rem',marginBottom:'0.5rem'}}>🧠</div>
                <div style={{fontSize:'1rem',fontWeight:700,color:'#f0f9ff'}}>AI Intelligence</div>
                <div style={{fontSize:'0.8rem',color:'#64748b',marginTop:'0.25rem'}}>News + strategy signals →</div>
              </div>
            </div>

            {/* ── AI INSIGHT HERO ── */}
            <div style={{background:'linear-gradient(135deg,#0a1628 0%,#0f2744 50%,#0a1628 100%)',border:'1px solid #1e3a5f',borderRadius:'16px',padding:'1.75rem',marginBottom:'1.5rem',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,right:0,width:'40%',height:'100%',background:'radial-gradient(ellipse at top right,rgba(0,255,136,0.07),transparent 70%)',pointerEvents:'none'}}/>
              <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.85rem'}}>
                <span style={{background:'#1a3a1a',color:'#4ade80',padding:'3px 12px',borderRadius:'99px',fontSize:'0.75rem',fontWeight:700,letterSpacing:'0.05em'}}>🤖 AI INSIGHT OF THE DAY</span>
              </div>
              {intelligentNews.length>0 ? (() => {
                const top = intelligentNews.find(n=>n.analysis.impact==='high')||intelligentNews[0];
                const em  = top.analysis.sentiment==='bullish'?'🟢':top.analysis.sentiment==='bearish'?'🔴':'⚪';
                return (
                  <div>
                    <h2 style={{fontSize:'1.25rem',fontWeight:800,color:'#f0f9ff',margin:'0 0 0.6rem',lineHeight:1.4}}>{top.title}</h2>
                    {top.analysis.keyInsight && <p style={{color:'#93c5fd',fontSize:'0.95rem',margin:'0 0 1rem',lineHeight:1.6}}>💡 {top.analysis.keyInsight}</p>}
                    <div style={{display:'flex',gap:'0.6rem',flexWrap:'wrap',alignItems:'center'}}>
                      <span style={{background:top.analysis.sentiment==='bullish'?'#166534':top.analysis.sentiment==='bearish'?'#991b1b':'#374151',color:'white',padding:'4px 14px',borderRadius:'99px',fontSize:'0.82rem',fontWeight:700}}>{em} {(top.analysis.sentiment||'').toUpperCase()}</span>
                      <span style={{color:'#64748b',fontSize:'0.85rem'}}>📊 {top.analysis.affectedIndex}</span>
                      {top.analysis.impact==='high' && <span style={{background:'rgba(239,68,68,0.15)',color:'#f87171',padding:'4px 12px',borderRadius:'99px',fontSize:'0.78rem',fontWeight:600}}>⚠️ HIGH IMPACT</span>}
                      <button onClick={()=>setActiveTab('intelligence')} style={{background:'rgba(0,255,136,0.12)',border:'1px solid rgba(0,255,136,0.3)',color:'#4ade80',borderRadius:'8px',padding:'4px 14px',fontSize:'0.82rem',cursor:'pointer',fontWeight:600}}>
                        Full analysis →
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <div>
                  <h2 style={{fontSize:'1.25rem',color:'#f0f9ff',margin:'0 0 0.5rem',fontWeight:800}}>AI-Powered Market Intelligence</h2>
                  <p style={{color:'#64748b',fontSize:'0.95rem',margin:'0 0 1rem',lineHeight:1.6}}>Real-time news analysis, institutional activity, OI buildup signals — all powered by Groq AI.</p>
                  <button onClick={()=>setActiveTab('intelligence')} style={{background:'var(--accent)',color:'#000',border:'none',borderRadius:'8px',padding:'0.5rem 1.25rem',fontWeight:700,cursor:'pointer',fontSize:'0.9rem'}}>
                    Open Market Intelligence →
                  </button>
                </div>
              )}
            </div>

            {/* ── NSE INDEX COMPARISON ── */}
            <div style={{marginBottom:'1.5rem'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
                <h3 style={{margin:0,fontSize:'1.1rem',fontWeight:700,color:'#f0f9ff'}}>📊 NSE Indices — Today vs Prev Close</h3>
                <button onClick={fetchLivePrices} style={{background:'transparent',border:'1px solid #1e3a5f',color:'#4ade80',borderRadius:'6px',padding:'0.25rem 0.75rem',fontSize:'0.8rem',cursor:'pointer'}}>🔄 Refresh</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'0.75rem'}}>
                {[
                  {name:'Nifty 50',       icon:'📈'},
                  {name:'Bank Nifty',     icon:'🏦'},
                  {name:'Nifty IT',       icon:'💻'},
                  {name:'Nifty Pharma',   icon:'💊'},
                  {name:'Nifty Auto',     icon:'🚗'},
                  {name:'Nifty Metal',    icon:'⚙️'},
                  {name:'Nifty FMCG',     icon:'🛒'},
                  {name:'Nifty Realty',   icon:'🏠'},
                  {name:'Sensex',         icon:'📉'},
                  {name:'Nifty Midcap 50',icon:'🔹'},
                ].map(({name,icon})=>{
                  const val = livePrices[name];
                  const chg = liveChanges[name];
                  const hasData = val && chg !== undefined;
                  const isPos = (chg||0) >= 0;
                  const pts = val && chg ? Math.abs(((chg/100)*val)/(1+chg/100)).toFixed(0) : null;
                  return (
                    <div key={name} style={{background:'#0d1b2e',border:`1px solid ${!hasData?'#1e293b':isPos?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.2)'}`,borderRadius:'12px',padding:'0.85rem 1rem',transition:'border-color 0.3s'}}>
                      <div style={{fontSize:'0.78rem',color:'#64748b',fontWeight:600,marginBottom:'0.3rem'}}>{icon} {name}</div>
                      <div style={{fontSize:'1.2rem',fontWeight:800,color:'#f0f9ff'}}>{val?val.toLocaleString():<span style={{color:'#334155'}}>—</span>}</div>
                      {hasData ? (
                        <div style={{marginTop:'0.25rem',display:'flex',alignItems:'center',gap:'0.4rem'}}>
                          <span style={{fontSize:'0.85rem',fontWeight:700,color:isPos?'#4ade80':'#f87171'}}>{isPos?'▲':'▼'} {Math.abs(chg).toFixed(2)}%</span>
                          <span style={{fontSize:'0.75rem',color:isPos?'#4ade80':'#f87171',opacity:0.8}}>{isPos?'+':'-'}{pts}</span>
                        </div>
                      ) : (
                        <div style={{fontSize:'0.75rem',color:'#334155',marginTop:'0.25rem'}}>Click Refresh</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── TOP GAINERS & LOSERS ── */}
            {Object.keys(liveChanges).length > 5 && (() => {
              const fnoStocks = ['Reliance','TCS','HDFC Bank','Infosys','ICICI Bank','Bharti Airtel','ITC','SBI','LT','Kotak Bank','HCL Tech','Axis Bank','Maruti Suzuki','Titan','Bajaj Finance','Wipro','Sun Pharma','Tata Motors'];
              const withData = fnoStocks
                .filter(s => livePrices[s] && liveChanges[s] !== undefined)
                .map(s => ({name:s, value:livePrices[s], change:liveChanges[s]}));
              if (withData.length < 4) return null;
              const gainers = [...withData].sort((a,b)=>b.change-a.change).slice(0,5);
              const losers  = [...withData].sort((a,b)=>a.change-b.change).slice(0,5);
              return (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1.5rem'}}>
                  {/* TOP GAINERS */}
                  <div style={{background:'#0d1b2e',border:'1px solid rgba(74,222,128,0.2)',borderRadius:'16px',padding:'1.25rem',overflow:'hidden'}}>
                    <div style={{fontSize:'0.85rem',fontWeight:700,color:'#4ade80',letterSpacing:'0.05em',marginBottom:'1rem'}}>🚀 TOP GAINERS</div>
                    {gainers.map((s,i)=>(
                      <div key={s.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.5rem 0',borderBottom:i<4?'1px solid rgba(255,255,255,0.04)':'none'}}>
                        <div>
                          <div style={{fontSize:'0.9rem',fontWeight:600,color:'#f0f9ff'}}>{s.name}</div>
                          <div style={{fontSize:'0.78rem',color:'#64748b'}}>₹{s.value.toLocaleString()}</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:'0.95rem',fontWeight:700,color:'#4ade80'}}>▲ {s.change.toFixed(2)}%</div>
                          <div style={{fontSize:'0.72rem',color:'#4ade80',opacity:0.7}}>+{Math.abs(((s.change/100)*s.value)/(1+s.change/100)).toFixed(0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* TOP LOSERS */}
                  <div style={{background:'#0d1b2e',border:'1px solid rgba(248,113,113,0.2)',borderRadius:'16px',padding:'1.25rem',overflow:'hidden'}}>
                    <div style={{fontSize:'0.85rem',fontWeight:700,color:'#f87171',letterSpacing:'0.05em',marginBottom:'1rem'}}>📉 TOP LOSERS</div>
                    {losers.map((s,i)=>(
                      <div key={s.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.5rem 0',borderBottom:i<4?'1px solid rgba(255,255,255,0.04)':'none'}}>
                        <div>
                          <div style={{fontSize:'0.9rem',fontWeight:600,color:'#f0f9ff'}}>{s.name}</div>
                          <div style={{fontSize:'0.78rem',color:'#64748b'}}>₹{s.value.toLocaleString()}</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:'0.95rem',fontWeight:700,color:'#f87171'}}>▼ {Math.abs(s.change).toFixed(2)}%</div>
                          <div style={{fontSize:'0.72rem',color:'#f87171',opacity:0.7}}>-{Math.abs(((s.change/100)*s.value)/(1+s.change/100)).toFixed(0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* INDEX SELECTOR */}
            <div className="panel index-selector-panel">
              <h3>📈 Track Your Indices & Stocks</h3>
              <p style={{color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '1rem'}}>
                Select from 3 categories: NSE Indices, BSE Indices, and FNO Stocks
              </p>
              
              <div className="three-category-grid">
                <div className="category-dropdown-box">
                  <h4>📊 NSE Indices</h4>
                  <select 
                    value={selectedIndices[0] || ''}
                    onChange={(e) => {
                      const newSelected = [...selectedIndices];
                      newSelected[0] = e.target.value;
                      setSelectedIndices(newSelected.filter(Boolean));
                    }}
                    className="category-dropdown"
                  >
                    <option value="">-- Select NSE Index --</option>
                    <option value="Nifty 50">Nifty 50</option>
                    <option value="Bank Nifty">Bank Nifty</option>
                    <option value="Nifty IT">Nifty IT</option>
                    <option value="Nifty Pharma">Nifty Pharma</option>
                    <option value="Nifty Auto">Nifty Auto</option>
                    <option value="Nifty Financial Services">Nifty Financial Services</option>
                    <option value="Nifty FMCG">Nifty FMCG</option>
                    <option value="Nifty Metal">Nifty Metal</option>
                    <option value="Nifty Realty">Nifty Realty</option>
                    <option value="Nifty Energy">Nifty Energy</option>
                  </select>
                </div>
                
                <div className="category-dropdown-box">
                  <h4>🏦 BSE Indices</h4>
                  <select 
                    value={selectedIndices[1] || ''}
                    onChange={(e) => {
                      const newSelected = [...selectedIndices];
                      newSelected[1] = e.target.value;
                      setSelectedIndices(newSelected.filter(Boolean));
                    }}
                    className="category-dropdown"
                  >
                    <option value="">-- Select BSE Index --</option>
                    <option value="Sensex">Sensex</option>
                    <option value="BSE 100">BSE 100</option>
                    <option value="BSE 200">BSE 200</option>
                    <option value="BSE 500">BSE 500</option>
                    <option value="BSE Midcap">BSE Midcap</option>
                    <option value="BSE Smallcap">BSE Smallcap</option>
                  </select>
                </div>
                
                <div className="category-dropdown-box">
                  <h4>🏢 FNO Stocks</h4>
                  <select 
                    value={selectedIndices[2] || ''}
                    onChange={(e) => {
                      const newSelected = [...selectedIndices];
                      newSelected[2] = e.target.value;
                      setSelectedIndices(newSelected.filter(Boolean));
                    }}
                    className="category-dropdown"
                  >
                    <option value="">-- Select Stock --</option>
                    <option value="RELIANCE">RELIANCE</option>
                    <option value="TCS">TCS</option>
                    <option value="HDFCBANK">HDFC BANK</option>
                    <option value="INFY">INFOSYS</option>
                    <option value="ICICIBANK">ICICI BANK</option>
                    <option value="ITC">ITC</option>
                    <option value="SBIN">SBI</option>
                    <option value="BHARTIARTL">BHARTI AIRTEL</option>
                    <option value="LT">L&T</option>
                    <option value="HCLTECH">HCL TECH</option>
                    <option value="AXISBANK">AXIS BANK</option>
                    <option value="MARUTI">MARUTI</option>
                    <option value="WIPRO">WIPRO</option>
                    <option value="SUNPHARMA">SUN PHARMA</option>
                    <option value="TATAMOTORS">TATA MOTORS</option>
                    <option value="TATASTEEL">TATA STEEL</option>
                    <option value="ONGC">ONGC</option>
                    <option value="NTPC">NTPC</option>
                    <option value="ADANIPORTS">ADANI PORTS</option>
                    <option value="JSWSTEEL">JSW STEEL</option>
                  </select>
                </div>
              </div>
              
              <button 
                className="btn-primary" 
                onClick={fetchLivePrices}
                style={{marginTop: '1rem'}}
              >
                🔄 Update Live Prices
              </button>
            </div>

            {/* MARKET TICKER */}
            <div className="market-summary">
              {selectedIndices.slice(0, 6).map(indexName => {
                const value = livePrices[indexName];
                const change = indexName === 'Nifty 50' ? marketData.nifty.change : 
                               indexName === 'Bank Nifty' ? marketData.bankNifty.change : 0;
                return (
                  <div key={indexName} className="market-item">
                    <span className="market-label">
                      {indexName} {isPriceLoading && <span className="price-loading">⟳</span>}
                    </span>
                    <span className="market-value">{value?.toLocaleString() || 'N/A'}</span>
                    {change !== 0 && (
                      <span className={change >= 0 ? 'market-change positive' : 'market-change negative'}>
                        {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
                      </span>
                    )}
                    {change === 0 && <span className="market-change" style={{color: 'var(--text-dim)'}}>Live</span>}
                  </div>
                );
              })}
              
              {/* Always show PCR and Max Pain */}
              <div className="market-item">
                <span className="market-label">PCR</span>
                <span className="market-value">{pcrData.pcr}</span>
                <span className={pcrData.pcr > 1 ? 'market-change positive' : 'market-change negative'}>
                  {pcrData.signal}
                </span>
              </div>
              <div className="market-item">
                <span className="market-label">Max Pain</span>
                <span className="market-value">{maxPainData.maxPain.toLocaleString()}</span>
                <span className="market-change" style={{color: '#F59E0B'}}>
                  {maxPainData.currentSpot > maxPainData.maxPain ? `↓ ${maxPainData.currentSpot - maxPainData.maxPain} away` : `↑ ${maxPainData.maxPain - maxPainData.currentSpot} away`}
                </span>
              </div>
            </div>


            {/* Market data → go to Markets tab */}

                        {/* QUICK ACTIONS */}
            <div className="panel">
              <h2>🚀 Quick Actions</h2>
              <div className="quick-actions-grid">
                <div className="quick-action-card" onClick={() => setActiveTab('single')}>
                  <div className="action-icon">📊</div>
                  <h3>Options Calculator</h3>
                  <p>Calculate P&L and Greeks</p>
                </div>
                <div className="quick-action-card" onClick={() => setActiveTab('strategy')}>
                  <div className="action-icon">🎯</div>
                  <h3>Strategy Builder</h3>
                  <p>10 multi-leg strategies</p>
                </div>
                <div className="quick-action-card" onClick={() => setActiveTab('scanner')}>
                  <div className="action-icon">🔍</div>
                  <h3>Market Scanner</h3>
                  <p>5 live alert filters</p>
                </div>
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
          <>
            <div className="page-header">
              <h1>Multi-Leg Strategies</h1>
              <p className="subtitle">Build complex options strategies with multiple legs</p>
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

            <div className="panel strategy-templates">
              <h2>Quick Select Strategy</h2>
              <div className="strategy-grid">
                {Object.entries(STRATEGY_TEMPLATES).map(([key, strategy]) => (
                  <button
                    key={key}
                    className={`strategy-card ${selectedStrategy === key ? 'active' : ''}`}
                    onClick={() => loadStrategyTemplate(key)}
                  >
                    <div className="strategy-name">{strategy.name}</div>
                    <div className="strategy-desc">{strategy.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <h2>Market Parameters</h2>
              <div className="global-settings">
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
                  <label>IV (%)</label>
                  <input 
                    type="number" 
                    value={volatility} 
                    onChange={(e) => setVolatility(Number(e.target.value))}
                    className="input-field"
                    step="0.1"
                  />
                </div>
              </div>
            </div>

            <div className="panel">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                <h2>Strategy Legs</h2>
                <button className="add-leg-btn" onClick={addLeg}>+ Add Leg</button>
              </div>
              
              {legs.map(leg => (
                <div key={leg.id} className="leg-row">
                  <div className="leg-number">Leg {leg.id}</div>
                  
                  <div className="leg-controls">
                    <div className="button-group">
                      <button 
                        className={leg.position === 'buy' ? 'active buy' : ''}
                        onClick={() => updateLeg(leg.id, 'position', 'buy')}
                      >
                        Buy
                      </button>
                      <button 
                        className={leg.position === 'sell' ? 'active sell' : ''}
                        onClick={() => updateLeg(leg.id, 'position', 'sell')}
                      >
                        Sell
                      </button>
                    </div>

                    <div className="button-group">
                      <button 
                        className={leg.optionType === 'call' ? 'active' : ''}
                        onClick={() => updateLeg(leg.id, 'optionType', 'call')}
                      >
                        Call
                      </button>
                      <button 
                        className={leg.optionType === 'put' ? 'active' : ''}
                        onClick={() => updateLeg(leg.id, 'optionType', 'put')}
                      >
                        Put
                      </button>
                    </div>

                    <div className="leg-input-group">
                      <label>Strike</label>
                      <input 
                        type="number" 
                        value={leg.strike}
                        onChange={(e) => updateLeg(leg.id, 'strike', Number(e.target.value))}
                        className="input-field-small"
                      />
                    </div>

                    <div className="leg-input-group">
                      <label>Premium</label>
                      <input 
                        type="number" 
                        value={leg.premium}
                        onChange={(e) => updateLeg(leg.id, 'premium', Number(e.target.value))}
                        className="input-field-small"
                      />
                    </div>

                    <div className="leg-input-group">
                      <label>Qty</label>
                      <input 
                        type="number" 
                        value={leg.quantity}
                        onChange={(e) => updateLeg(leg.id, 'quantity', Number(e.target.value))}
                        className="input-field-small"
                        min="1"
                      />
                    </div>

                    {legs.length > 1 && (
                      <button 
                        className="remove-leg-btn"
                        onClick={() => removeLeg(leg.id)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="panel">
              <h2>Strategy Summary</h2>
              <div className="summary-grid">
                <div className="summary-item">
                  <span className="label">Current P&L</span>
                  <span className={`value ${currentMultiLegPL >= 0 ? 'positive' : 'negative'}`}>
                    ₹{currentMultiLegPL.toLocaleString()}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="label">Max Profit</span>
                  <span className="value positive">{multiMaxProfit}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Max Loss</span>
                  <span className="value negative">{multiMaxLoss}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Net Delta</span>
                  <span className="value">{multiLegGreeks.delta.toFixed(3)}</span>
                </div>
              </div>
              {breakEvenPoints.length > 0 && (
                <div className="breakeven-display">
                  <strong>Break-Even Points:</strong> {breakEvenPoints.map(be => be.toLocaleString()).join(', ')}
                </div>
              )}
            </div>

            <div className="panel">
              <h2>Combined P&L at Expiry</h2>
              <div className="chart-container">
                <svg viewBox="0 0 600 300" className="pl-chart">
                  <line x1="50" y1="150" x2="550" y2="150" stroke="#334155" strokeWidth="2" />
                  
                  {multiLegPLData.length > 0 && (
                    <>
                      <polyline
                        points={multiLegPLData.map((d, i) => {
                          const x = 50 + (i / multiLegPLData.length) * 500;
                          const maxPL = Math.max(...multiLegPLData.map(p => Math.abs(p.pl)));
                          const y = 150 - (d.pl / (maxPL || 1)) * 120;
                          return `${x},${Math.max(20, Math.min(280, y))}`;
                        }).join(' ')}
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="3"
                      />
                      
                      {breakEvenPoints.map((bePoint, idx) => {
                        const allStrikes = legs.map(l => l.strike);
                        const minStrike = Math.min(...allStrikes);
                        const maxStrike = Math.max(...allStrikes);
                        const range = (maxStrike - minStrike) * 0.5 || spot * 0.15;
                        const center = (minStrike + maxStrike) / 2;
                        const x = 50 + ((bePoint - (center - range)) / (range * 2)) * 500;
                        
                        return (
                          <g key={idx}>
                            <line 
                              x1={x} y1="20" 
                              x2={x} y2="280" 
                              stroke="#F59E0B" 
                              strokeWidth="2" 
                              strokeDasharray="5,5"
                            />
                            <text 
                              x={x + 5} y="40" 
                              fill="#F59E0B" 
                              fontSize="10" 
                              fontWeight="bold"
                            >
                              BE: {bePoint.toLocaleString()}
                            </text>
                          </g>
                        );
                      })}
                    </>
                  )}
                  
                  <rect x="50" y="20" width="500" height="130" fill="rgba(16, 185, 129, 0.1)" />
                  <rect x="50" y="150" width="500" height="130" fill="rgba(239, 68, 68, 0.1)" />
                  
                  <text x="300" y="15" textAnchor="middle" fill="#10B981" fontSize="12" fontWeight="bold">
                    Profit Zone
                  </text>
                  <text x="300" y="295" textAnchor="middle" fill="#EF4444" fontSize="12" fontWeight="bold">
                    Loss Zone
                  </text>
                </svg>
              </div>
            </div>

            <div className="panel greeks-panel">
              <h2>Combined Greeks</h2>
              <div className="greeks-grid">
                <div className="greek-item">
                  <span className="greek-label">Net Delta (Δ)</span>
                  <span className="greek-value">{multiLegGreeks.delta.toFixed(4)}</span>
                  <span className="greek-desc">Directional exposure</span>
                </div>
                <div className="greek-item">
                  <span className="greek-label">Net Gamma (Γ)</span>
                  <span className="greek-value">{multiLegGreeks.gamma.toFixed(4)}</span>
                  <span className="greek-desc">Delta acceleration</span>
                </div>
                <div className="greek-item">
                  <span className="greek-label">Net Theta (Θ)</span>
                  <span className={`greek-value ${multiLegGreeks.theta < 0 ? 'negative' : 'positive'}`}>
                    {multiLegGreeks.theta.toFixed(2)}
                  </span>
                  <span className="greek-desc">Daily time decay</span>
                </div>
                <div className="greek-item">
                  <span className="greek-label">Net Vega (ν)</span>
                  <span className="greek-value">{multiLegGreeks.vega.toFixed(2)}</span>
                  <span className="greek-desc">IV sensitivity</span>
                </div>
              </div>
              
              <div className="greek-explanation">
                <p>
                  <strong>Net Delta:</strong> {Math.abs(multiLegGreeks.delta * lotSize).toFixed(2)} rupees per point move
                </p>
                <p>
                  <strong>Net Theta:</strong> {multiLegGreeks.theta < 0 ? 'Losing' : 'Gaining'} ₹{Math.abs(multiLegGreeks.theta * lotSize).toFixed(2)} per day
                </p>
                <p>
                  <strong>Strategy Type:</strong> {Math.abs(multiLegGreeks.delta) < 0.2 ? 'Delta Neutral' : multiLegGreeks.delta > 0 ? 'Bullish' : 'Bearish'}
                  {' | '}
                  {multiLegGreeks.theta > 0 ? 'Positive Theta' : 'Negative Theta'}
                </p>
              </div>
            </div>
          </>
        ) : activeTab === 'markets' ? (
          <div>
            {/* ── STOCK DEEP DIVE ── */}
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
                      BSE Bulk Deals →
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* ── MARKETS SUB-TABS ── */}
            <div className="home-tabs" style={{marginBottom:'1rem'}}>
              {[
                ['option-chain','⚡ Option Chain'],
                ['candlestick','📊 Chart'],
                ['oi-chart','📈 OI Analysis'],
                ['pcr','⚡ PCR'],
                ['max-pain','🎯 Max Pain'],
                ['fii-dii','🏦 FII/DII'],
                ['events','📅 Events'],
              ].map(([tab,label])=>(
                <button key={tab} className={`home-tab-btn ${activeMarketsTab===tab?'active':''}`} onClick={()=>setActiveMarketsTab(tab)}>{label}</button>
              ))}
            </div>

            {/* ── REUSE HOME TAB PANELS with activeMarketsTab ── */}
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
                      {(selectedUnderlying==='NIFTY'?marketData.nifty.value:marketData.bankNifty.value)?.toLocaleString()}
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
                        <button key={exp} onClick={()=>{setSelectedExpiry(exp);generateLiveOptionChain(selectedUnderlying);}}
                          style={{background:'none',border:'none',borderBottom:isSelected?'2px solid var(--accent)':'2px solid transparent',marginBottom:'-2px',padding:'0.5rem 1rem',cursor:'pointer',whiteSpace:'nowrap',color:isSelected?'var(--accent)':'var(--text-dim)',fontWeight:isSelected?700:400,fontSize:'0.85rem'}}>
                          {exp}
                          <div style={{fontSize:'0.68rem',color:isSelected?'var(--accent)':'#64748b',marginTop:'2px'}}>{daysLeft<=0?'Today':`${daysLeft}D`}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {isLoadingChain && liveOptionChain.length===0 ? (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>Loading option chain...</div>
                ) : (
                  <div style={{overflowX:'auto'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 80px 1fr',gap:0,marginBottom:'4px'}}>
                      <div style={{background:'rgba(74,222,128,0.08)',borderRadius:'6px 0 0 0',padding:'4px 8px',fontSize:'0.75rem',fontWeight:700,color:'#4ade80'}}>CALLS</div>
                      <div/>
                      <div style={{background:'rgba(248,113,113,0.08)',borderRadius:'0 6px 0 0',padding:'4px 8px',fontSize:'0.75rem',fontWeight:700,color:'#f87171',textAlign:'right'}}>PUTS</div>
                    </div>
                    {liveOptionChain.map((row,idx)=>{
                      const spot = selectedUnderlying==='NIFTY'?marketData.nifty.value:marketData.bankNifty.value;
                      const isATM = Math.abs(row.strike-spot)<(selectedUnderlying==='NIFTY'?26:51);
                      const itmCE = row.strike<spot;
                      const itmPE = row.strike>spot;
                      const ceOI  = row.ce?.oi||0;
                      const peOI  = row.pe?.oi||0;
                      const maxOI = Math.max(...liveOptionChain.map(r=>Math.max(r.ce?.oi||0,r.pe?.oi||0)));
                      const ceChg = parseFloat(row.ce?.change||0);
                      const peChg = parseFloat(row.pe?.change||0);
                      return (
                        <div key={idx} style={{display:'grid',gridTemplateColumns:'1fr 80px 1fr',borderBottom:'1px solid rgba(255,255,255,0.04)',minHeight:'44px'}}>
                          <div style={{background:itmCE?'rgba(74,222,128,0.07)':'transparent',display:'flex',alignItems:'stretch',position:'relative',overflow:'hidden'}}>
                            <div style={{position:'absolute',right:0,top:0,bottom:0,width:`${maxOI>0?(ceOI/maxOI)*60:0}%`,background:'rgba(74,222,128,0.08)',pointerEvents:'none'}}/>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.3rem 0.6rem',width:'100%',zIndex:1}}>
                              <div>
                                <div style={{fontSize:'0.8rem',fontWeight:600,color:'#94a3b8'}}>{ceOI>=100000?(ceOI/100000).toFixed(2)+' L':(ceOI/1000).toFixed(0)+'K'}</div>
                                <div style={{fontSize:'0.7rem',color:ceChg>=0?'#4ade80':'#f87171'}}>{ceChg>=0?'+':''}{ceChg}%</div>
                              </div>
                              <div style={{textAlign:'right'}}>
                                <div style={{fontSize:'0.88rem',fontWeight:700,color:'#4ade80'}}>₹{row.ce?.ltp}</div>
                                <div style={{fontSize:'0.7rem',color:'#64748b'}}>{row.ce?.iv}% IV</div>
                              </div>
                            </div>
                          </div>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg-dark)',borderLeft:'1px solid var(--border)',borderRight:'1px solid var(--border)'}}>
                            {isATM?<span style={{background:'#f97316',color:'white',borderRadius:'99px',padding:'2px 8px',fontWeight:700,fontSize:'0.82rem'}}>{row.strike?.toLocaleString()}</span>:<span style={{fontSize:'0.82rem',fontWeight:600,color:'var(--text-dim)'}}>{row.strike?.toLocaleString()}</span>}
                          </div>
                          <div style={{background:itmPE?'rgba(248,113,113,0.07)':'transparent',display:'flex',alignItems:'stretch',position:'relative',overflow:'hidden'}}>
                            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${maxOI>0?(peOI/maxOI)*60:0}%`,background:'rgba(248,113,113,0.08)',pointerEvents:'none'}}/>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.3rem 0.6rem',width:'100%',zIndex:1}}>
                              <div>
                                <div style={{fontSize:'0.88rem',fontWeight:700,color:'#f87171'}}>₹{row.pe?.ltp}</div>
                                <div style={{fontSize:'0.7rem',color:'#64748b'}}>{row.pe?.iv}% IV</div>
                              </div>
                              <div style={{textAlign:'right'}}>
                                <div style={{fontSize:'0.8rem',fontWeight:600,color:'#94a3b8'}}>{peOI>=100000?(peOI/100000).toFixed(2)+' L':(peOI/1000).toFixed(0)+'K'}</div>
                                <div style={{fontSize:'0.7rem',color:peChg>=0?'#4ade80':'#f87171'}}>{peChg>=0?'+':''}{peChg}%</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })()}

            {activeMarketsTab === 'pcr' && activeHomeTab !== 'pcr' && (() => {
              const ceOI = liveOptionChain.reduce((s,r)=>s+(r.ce?.oi||0),0);
              const peOI = liveOptionChain.reduce((s,r)=>s+(r.pe?.oi||0),0);
              const pcr  = ceOI>0?(peOI/ceOI).toFixed(2):'-';
              const bull = parseFloat(pcr)>1.2;
              const bear = parseFloat(pcr)<0.8;
              const clr  = bull?'#4ade80':bear?'#f87171':'#fbbf24';
              return (
                <div className="panel" style={{textAlign:'center'}}>
                  <h2>⚡ Put/Call Ratio</h2>
                  <div style={{fontSize:'4rem',fontWeight:900,color:clr,margin:'1rem 0'}}>{pcr}</div>
                  <div style={{fontSize:'1.2rem',fontWeight:700,color:clr}}>{bull?'BULLISH SENTIMENT':bear?'BEARISH SENTIMENT':'NEUTRAL'}</div>
                  <p style={{color:'var(--text-dim)',marginTop:'1rem',fontSize:'0.85rem'}}>PCR above 1.2 = more puts = traders hedging downside = market likely to go up.<br/>PCR below 0.8 = more calls = overconfident bulls = possible correction.</p>
                  <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginTop:'0.5rem'}}>Refresh option chain for updated PCR.</p>
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
                  <div style={{color:'var(--text-dim)',fontSize:'0.85rem'}}>Current Spot: {maxPainData.currentSpot?.toLocaleString()} · Distance: {Math.abs((maxPainData.currentSpot||0)-(maxPainData.maxPain||0))} pts</div>
                </div>
              </div>
            )}

            {activeMarketsTab === 'fii-dii' && (
              <div className="panel">
                <h2>🏦 FII / DII Activity</h2>
                <p style={{color:'var(--text-dim)',marginBottom:'1rem',fontSize:'0.85rem'}}>Published by NSE after market close. Data in crores (INR).</p>
                {fiiDiiData.length>0 ? (
                  <div>{fiiDiiData.slice(0,10).map((row,i)=>(
                    <div key={i} style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr 1fr',gap:'0.5rem',padding:'0.5rem 0',borderBottom:'1px solid var(--border)',fontSize:'0.85rem',alignItems:'center'}}>
                      <span style={{color:'var(--text-dim)'}}>{row.date}</span>
                      <span style={{color:row.fii>=0?'#4ade80':'#f87171',fontWeight:600}}>FII: {row.fii>=0?'+':''}{(row.fii||0).toLocaleString()}</span>
                      <span style={{color:row.dii>=0?'#60a5fa':'#f87171',fontWeight:600}}>DII: {row.dii>=0?'+':''}{(row.dii||0).toLocaleString()}</span>
                      <span style={{color:((row.fii||0)+(row.dii||0))>=0?'#4ade80':'#f87171',fontWeight:700}}>Net: {((row.fii||0)+(row.dii||0))>=0?'+':''}{((row.fii||0)+(row.dii||0)).toLocaleString()}</span>
                    </div>
                  ))}</div>
                ) : (
                  <div style={{textAlign:'center',padding:'2rem',color:'var(--text-dim)'}}>
                    <a href="https://www.nseindia.com/market-data/fii-dii-activity" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>View FII/DII data on NSE →</a>
                  </div>
                )}
              </div>
            )}

            {activeMarketsTab === 'events' && (
              <div className="panel">
                <h2>📅 Key Market Events</h2>
                <p style={{color:'var(--text-dim)',fontSize:'0.85rem',marginBottom:'1rem'}}>Upcoming events that could impact options premiums and volatility.</p>
                {[
                  {date:'28 Feb 2026',event:'NSE F&O Expiry',impact:'HIGH',type:'expiry'},
                  {date:'06 Mar 2026',event:'RBI MPC Meeting',impact:'HIGH',type:'macro'},
                  {date:'07 Mar 2026',event:'GDP Data Release',impact:'MEDIUM',type:'data'},
                  {date:'13 Mar 2026',event:'NSE F&O Expiry',impact:'HIGH',type:'expiry'},
                  {date:'18 Mar 2026',event:'US FOMC Meeting',impact:'HIGH',type:'global'},
                  {date:'27 Mar 2026',event:'NSE Monthly Expiry',impact:'HIGH',type:'expiry'},
                ].map((ev,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:'1rem',padding:'0.75rem',marginBottom:'0.5rem',background:'var(--bg-dark)',borderRadius:'8px',border:'1px solid var(--border)'}}>
                    <div style={{minWidth:'80px',fontSize:'0.78rem',color:'var(--text-dim)'}}>{ev.date}</div>
                    <div style={{flex:1,fontWeight:600,fontSize:'0.88rem'}}>{ev.event}</div>
                    <span style={{padding:'0.2rem 0.6rem',borderRadius:'4px',fontSize:'0.72rem',fontWeight:700,
                      background:ev.impact==='HIGH'?'rgba(239,68,68,0.15)':'rgba(251,191,36,0.15)',
                      color:ev.impact==='HIGH'?'#f87171':'#fbbf24'}}>
                      {ev.impact}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {activeMarketsTab === 'candlestick' && (
              <div style={{background:'var(--bg-card)',borderRadius:'12px',padding:'1rem',border:'1px solid var(--border)'}}>
                <div style={{display:'flex',gap:'0.5rem',alignItems:'center',marginBottom:'1rem',flexWrap:'wrap'}}>
                  <select value={selectedChartSymbol} onChange={e=>{setSelectedChartSymbol(e.target.value);generateCandlestickData(e.target.value,chartTimeframe);}}
                    style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.3rem 0.5rem',fontWeight:700}}>
                    {['NIFTY','BANKNIFTY','FINNIFTY','RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','SBIN','BAJFINANCE','ITC','WIPRO','AXISBANK','TATAMOTORS'].map(s=><option key={s}>{s}</option>)}
                  </select>
                  {['5m','15m','1H','1D','1W'].map(tf=>(
                    <button key={tf} onClick={()=>{setChartTimeframe(tf);generateCandlestickData(selectedChartSymbol,tf);}}
                      style={{padding:'0.25rem 0.6rem',borderRadius:'6px',border:'none',cursor:'pointer',fontSize:'0.78rem',
                        background:chartTimeframe===tf?'var(--accent)':'var(--bg-dark)',color:chartTimeframe===tf?'#000':'var(--text-dim)',fontWeight:chartTimeframe===tf?700:400}}>
                      {tf}
                    </button>
                  ))}
                  <select value={chartIndicators[0]||'SMA'} onChange={e=>setChartIndicators([e.target.value])}
                    style={{background:'var(--bg-dark)',color:'var(--text-main)',border:'1px solid var(--border)',borderRadius:'6px',padding:'0.25rem 0.5rem',fontSize:'0.78rem'}}>
                    <option value="SMA">SMA</option>
                    <option value="EMA">EMA</option>
                    <option value="BB">Bollinger Bands</option>
                    <option value="VWAP">VWAP</option>
                    <option value="RSI">RSI</option>
                  </select>
                  <button onClick={()=>generateCandlestickData(selectedChartSymbol,chartTimeframe)} style={{marginLeft:'auto',background:'var(--bg-dark)',border:'1px solid var(--border)',color:'var(--text-dim)',borderRadius:'6px',padding:'0.25rem 0.6rem',cursor:'pointer',fontSize:'0.78rem'}}>🔄 Refresh</button>
                </div>
                {candlestickData && candlestickData.length > 0 ? (
                  <TradingViewChart data={candlestickData} indicators={chartIndicators} symbol={selectedChartSymbol} timeframe={chartTimeframe}/>
                ) : (
                  <div style={{textAlign:'center',padding:'3rem',color:'var(--text-dim)'}}>
                    <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>📊</div>
                    <div>Click Load Chart to view candlestick data</div>
                    <button onClick={()=>generateCandlestickData(selectedChartSymbol,chartTimeframe)}
                      style={{marginTop:'1rem',background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.5rem 1.5rem',fontWeight:700,cursor:'pointer'}}>
                      📈 Load Chart
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeMarketsTab === 'oi-chart' && (
              <div className="panel">
                <h2>📈 Open Interest Analysis</h2>
                {oiChartData.length > 0 ? (
                  <div>
                    <p style={{color:'var(--text-dim)',fontSize:'0.82rem',marginBottom:'1rem'}}>Top strikes by OI buildup. CE = resistance, PE = support.</p>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.85rem'}}>
                        <thead>
                          <tr style={{borderBottom:'2px solid var(--border)'}}>
                            <th style={{padding:'0.5rem',textAlign:'left',color:'var(--text-dim)'}}>Strike</th>
                            <th style={{padding:'0.5rem',textAlign:'right',color:'#f87171'}}>CE OI (K)</th>
                            <th style={{padding:'0.5rem',textAlign:'right',color:'#4ade80'}}>PE OI (K)</th>
                            <th style={{padding:'0.5rem',textAlign:'right',color:'var(--text-dim)'}}>CE Vol (K)</th>
                            <th style={{padding:'0.5rem',textAlign:'right',color:'var(--text-dim)'}}>PE Vol (K)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {oiChartData.slice(0,15).map((row,i)=>(
                            <tr key={i} style={{borderBottom:'1px solid var(--border)',background:i%2===0?'transparent':'rgba(255,255,255,0.02)'}}>
                              <td style={{padding:'0.4rem 0.5rem',fontWeight:700,color:'var(--text-main)'}}>{row.strike}</td>
                              <td style={{padding:'0.4rem 0.5rem',textAlign:'right',color:'#f87171'}}>{(row.ce||0).toFixed(1)}</td>
                              <td style={{padding:'0.4rem 0.5rem',textAlign:'right',color:'#4ade80'}}>{(row.pe||0).toFixed(1)}</td>
                              <td style={{padding:'0.4rem 0.5rem',textAlign:'right',color:'var(--text-dim)'}}>{(row.ceVol||0).toFixed(1)}</td>
                              <td style={{padding:'0.4rem 0.5rem',textAlign:'right',color:'var(--text-dim)'}}>{(row.peVol||0).toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div style={{textAlign:'center',padding:'2rem',color:'var(--text-dim)'}}>
                    <p>Load option chain first to see OI analysis.</p>
                    <button onClick={()=>setActiveMarketsTab('option-chain')}
                      style={{marginTop:'0.5rem',background:'var(--accent)',color:'#000',border:'none',borderRadius:'6px',padding:'0.4rem 1rem',fontWeight:700,cursor:'pointer'}}>
                      Go to Option Chain →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'backtest' ? (
          <div>
            {/* ── HEADER ── */}
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

            {/* ── CONFIG PANEL ── */}
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
                    ['ma_crossover',  '📊 MA Crossover',       'Buy CE on fast MA crossing above slow MA. Buy PE on cross below.'],
                    ['rsi',           '⚡ RSI Reversal',        'Buy CE when RSI crosses above oversold. Buy PE when crosses below overbought.'],
                    ['breakout',      '🚀 Breakout Momentum',  'Buy CE on N-bar high breakout. Buy PE on N-bar low breakdown.'],
                    ['straddle_sell', '💰 Sell Weekly Straddle','Sell ATM straddle every Monday, buy back on Thursday close.'],
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

            {/* ── RESULTS ── */}
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
                {/* ── STATS CARDS ── */}
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

                {/* ── EQUITY CURVE ── */}
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
                          <text x={W/2} y={H-5} textAnchor="middle" fill="#64748b" fontSize="9">{btResult.symbol} · {btResult.period} · {btResult.strategy}</text>
                        </svg>
                      </div>
                    );
                  })()}
                </div>

                {/* ── TRADE LOG ── */}
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
        ) : activeTab === 'intelligence' ? (
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
                <div style={{fontWeight:600,marginBottom:'0.5rem'}}>Largest OI Buildup — NIFTY Strikes</div>
                <p style={{color:'var(--text-dim)',fontSize:'0.78rem',marginBottom:'0.75rem'}}>Highest OI = where institutions are positioned. CE = resistance, PE = support.</p>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                  <div>
                    <div style={{color:'#f87171',fontWeight:600,fontSize:'0.82rem',marginBottom:'0.5rem'}}>TOP CE OI — Resistance Levels</div>
                    {[...liveOptionChain].sort((a,b)=>(b.ce?.oi||0)-(a.ce?.oi||0)).slice(0,6).map(row=>(
                      <div key={row.strike} style={{display:'flex',justifyContent:'space-between',padding:'0.3rem 0',borderBottom:'1px solid #1e293b',fontSize:'0.82rem'}}>
                        <span style={{fontWeight:700,color:'#f0f9ff'}}>{row.strike}</span>
                        <span style={{color:'#f87171'}}>{((row.ce?.oi||0)/1000).toFixed(0)}K OI</span>
                        <span style={{color:'#64748b',fontSize:'0.75rem'}}>{row.ce?.iv||'-'}% IV</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{color:'#4ade80',fontWeight:600,fontSize:'0.82rem',marginBottom:'0.5rem'}}>TOP PE OI — Support Levels</div>
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
                  Block/Bulk deal real-time integration is planned with the mstock API. Until then, use the NSE/BSE links above for live data — they update throughout the day.
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'scanner' ? (
          <>
            <div className="page-header">
              <h1>📊 Options Scanner</h1>
              <p className="subtitle">Detect market setups and opportunities</p>
              <button className="btn-action" onClick={runScan}>
                🔍 Run Scan
              </button>
            </div>

            <div className="panel live-sync-notice">
              <div className="sync-header">
                <h3>✅ Connected to Live Option Chain</h3>
                <span className="sync-badge">AUTO-SYNC</span>
              </div>
              <p style={{color: 'var(--text-dim)', marginBottom: '1rem'}}>
                Scanner uses real-time data from Live Option Chain tab. Updates automatically every 10 seconds.
              </p>
              <div className="sync-stats-grid">
                <div className="sync-stat-card">
                  <span className="stat-label">Underlying</span>
                  <span className="stat-value">{selectedUnderlying}</span>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Strikes</span>
                  <span className="stat-value">{liveOptionChain.length}</span>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Updates</span>
                  <span className="stat-value">Every 10s</span>
                </div>
                <div className="sync-stat-card">
                  <span className="stat-label">Last Update</span>
                  <span className="stat-value">{lastUpdateTime.toLocaleTimeString()}</span>
                </div>
              </div>
            </div>

            <div className="panel">ssName="panel">
              <h2>📋 Available Filters</h2>
              <div className="filters-grid">
                <div className="filter-card">
                  <h3>⚠️ Market Crash Warning</h3>
                  <p>Detects: CE Open = High + PE spiking</p>
                  <span className="filter-status">Active</span>
                </div>
                <div className="filter-card">
                  <h3>💰 Synthetic Finder</h3>
                  <p>Detects: CE Premium ≈ PE Premium</p>
                  <span className="filter-status">Active</span>
                </div>
                <div className="filter-card">
                  <h3>⚡ IV Crush Setup</h3>
                  <p>Detects: High IV + Expiry {'<'} 5 days</p>
                  <span className="filter-status">Active</span>
                </div>
                <div className="filter-card">
                  <h3>🔥 Gamma Squeeze</h3>
                  <p>Detects: Max OI concentration</p>
                  <span className="filter-status">Active</span>
                </div>
                <div className="filter-card">
                  <h3>📊 PCR Extreme</h3>
                  <p>Detects: PCR {'>'} 1.5 or {'<'} 0.7</p>
                  <span className="filter-status">Active</span>
                </div>
                <div className="filter-card disabled">
                  <h3>🔧 Custom Filter</h3>
                  <p>Build your own (Coming soon)</p>
                  <span className="filter-status disabled">Soon</span>
                </div>
              </div>
            </div>

            {/* CUSTOM FILTER BUILDER */}
            <div className="panel">
              <h2>🔧 Custom Filter Builder</h2>
              <p style={{color: 'var(--text-dim)', marginBottom: '1.5rem'}}>
                Create your own custom filters with multiple conditions
              </p>
              
              <div className="filter-builder">
                <div className="filter-name-input">
                  <label>Filter Name</label>
                  <input
                    type="text"
                    value={newFilter.name}
                    onChange={(e) => setNewFilter({...newFilter, name: e.target.value})}
                    placeholder="e.g., High OI Breakout"
                    className="input-field"
                  />
                </div>
                
                <div className="filter-conditions">
                  <h3>Conditions</h3>
                  {newFilter.conditions.map((condition, idx) => (
                    <div key={idx} className="condition-row">
                      <select 
                        value={condition.metric}
                        onChange={(e) => {
                          const updated = [...newFilter.conditions];
                          updated[idx].metric = e.target.value;
                          setNewFilter({...newFilter, conditions: updated});
                        }}
                        className="condition-select"
                      >
                        <option value="ceOI">CE OI</option>
                        <option value="peOI">PE OI</option>
                        <option value="cePremium">CE Premium</option>
                        <option value="pePremium">PE Premium</option>
                        <option value="ceVolume">CE Volume</option>
                        <option value="peVolume">PE Volume</option>
                      </select>
                      
                      <select
                        value={condition.operator}
                        onChange={(e) => {
                          const updated = [...newFilter.conditions];
                          updated[idx].operator = e.target.value;
                          setNewFilter({...newFilter, conditions: updated});
                        }}
                        className="condition-select"
                      >
                        <option value=">">Greater than</option>
                        <option value="<">Less than</option>
                        <option value="=">Equals</option>
                      </select>
                      
                      <input
                        type="number"
                        value={condition.value}
                        onChange={(e) => {
                          const updated = [...newFilter.conditions];
                          updated[idx].value = Number(e.target.value);
                          setNewFilter({...newFilter, conditions: updated});
                        }}
                        className="condition-input"
                        placeholder="Value"
                      />
                      
                      {newFilter.conditions.length > 1 && (
                        <button
                          className="remove-condition-btn"
                          onClick={() => {
                            const updated = newFilter.conditions.filter((_, i) => i !== idx);
                            setNewFilter({...newFilter, conditions: updated});
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  
                  <button
                    className="add-condition-btn"
                    onClick={() => {
                      setNewFilter({
                        ...newFilter,
                        conditions: [...newFilter.conditions, { metric: 'ceOI', operator: '>', value: 0 }]
                      });
                    }}
                  >
                    + Add Condition
                  </button>
                </div>
                
                <button
                  className="btn-primary"
                  onClick={() => {
                    if (newFilter.name.trim()) {
                      setCustomFilters([...customFilters, {...newFilter}]);
                      setNewFilter({ name: '', conditions: [{ metric: 'ceOI', operator: '>', value: 50000 }] });
                      alert('Custom filter saved!');
                    }
                  }}
                  style={{marginTop: '1rem'}}
                >
                  Save Custom Filter
                </button>
              </div>
              
              {/* SAVED CUSTOM FILTERS */}
              {customFilters.length > 0 && (
                <div className="saved-filters">
                  <h3>Your Custom Filters ({customFilters.length})</h3>
                  <div className="custom-filters-grid">
                    {customFilters.map((filter, idx) => (
                      <div key={idx} className="custom-filter-card">
                        <div className="custom-filter-header">
                          <h4>{filter.name}</h4>
                          <button
                            className="delete-filter-btn"
                            onClick={() => setCustomFilters(customFilters.filter((_, i) => i !== idx))}
                          >
                            🗑️
                          </button>
                        </div>
                        <div className="custom-filter-conditions">
                          {filter.conditions.map((c, i) => (
                            <div key={i} className="condition-badge">
                              {c.metric} {c.operator} {c.value}
                            </div>
                          ))}
                        </div>
                        <button
                          className="run-filter-btn"
                          onClick={() => runCustomFilter(filter)}
                        >
                          ▶ Run Filter
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
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
                  <div style={{color:'#fca5a5',fontWeight:700,fontSize:'1.1rem'}}>COOLDOWN ACTIVE — Stop Trading</div>
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


            {/* ── Equity Curve + Emotion Breakdown ── */}
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
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1.5rem'}}>
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
                            <span style={{color:'var(--text-dim)'}}>{count} trade{count>1?'s':''} · {pct}%</span>
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
                    {[['symbol','Symbol',['NIFTY','BANKNIFTY','FINNIFTY','SENSEX','RELIANCE','TCS','HDFCBANK','ICICIBANK','SBIN','INFY','ITC','AXISBANK'],'select'],['type','Option Type',['CE','PE'],'select'],['action','Action',['BUY','SELL'],'select'],['strike','Strike Price','','text'],['expiry','Expiry Date','','text'],['qty','Qty (Lots)','','number'],['entryPrice','Entry Price','','number'],['exitPrice','Exit Price (if closed)','','number'],['emotion','Emotion Before Trade',['Calm','Confident','Anxious','Excited','Fearful','Greedy'],'select'],['reason','Trade Reason',['Setup','Trend Follow','Reversal','Scalp','Hedge','FOMO','Revenge','Boredom','Tip/News'],'select']].map(([field,label,opts,type])=>(
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
        ) : null}

        <div className="disclaimer">
          <strong>⚠️ Disclaimer:</strong> This calculator is for educational purposes only. 
          Options trading involves substantial risk. Results are theoretical estimates. 
          Always consult a SEBI-registered advisor before trading.
        </div>

        {/* ── FLOATING WHATSAPP SUPPORT BUTTON ── */}
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

        {/* ── PULSE ANIMATION ── */}
        <style>{`
          @keyframes waPulse {
            0%   { box-shadow: 0 0 0 0 rgba(37,211,102,0.5); }
            70%  { box-shadow: 0 0 0 12px rgba(37,211,102,0); }
            100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); }
          }

          /* Ensure correct display for desktop */
          @media (min-width: 769px) {
            .nav-links { display: flex !important; }
            .hamburger-btn { display: none !important; }
          }

            /* Main content padding */
            .main-content, [class*="main-content"] { 
              padding: 0.75rem !important; 
            }

            /* Cards and panels */
            .panel, [class*="panel"] { 
              padding: 0.75rem !important; 
              border-radius: 8px !important;
            }

            /* Grids → single column */
            .quick-actions-grid { 
              grid-template-columns: 1fr !important; 
            }

            /* Option chain table */
            .option-chain-table { font-size: 0.72rem !important; }

            /* Charts */
            .candlestick-chart-container svg { min-width: 100% !important; }

            /* Stats cards */
            [style*="grid-template-columns: repeat(auto-fit"] {
              grid-template-columns: repeat(2, 1fr) !important;
            }

            /* Hero section */
            [style*="linear-gradient(135deg"] { 
              padding: 1rem !important; 
            }

            /* Ticker */
            .ticker-header { flex-wrap: wrap !important; gap: 0.3rem !important; }

            /* Modals */
            .modal-content { 
              width: 95% !important; 
              max-width: 95% !important;
              margin: 0.5rem !important;
              max-height: 85vh !important;
            }

            /* Tables — horizontal scroll */
            table { display: block !important; overflow-x: auto !important; }

            /* Header */
            .page-header h1 { font-size: 1.3rem !important; }

            /* Backtest config grid */
            [style*="minmax(260px"] {
              grid-template-columns: 1fr !important;
            }

            /* Deep dive OI grid */
            [style*="grid-template-columns: '1fr 1fr'"] {
              grid-template-columns: 1fr !important;
            }

            /* WhatsApp button position */
            a[href*="wa.me"] {
              bottom: 16px !important;
              right: 16px !important;
              width: 48px !important;
              height: 48px !important;
            }

            /* Market pulse widget */
            [style*="Market Pulse"] { 
              display: none !important; 
            }

            /* Equity curve chart */
            svg[viewBox*="800"] { min-width: 320px !important; }
          }

          @media (max-width: 480px) {
            /* Very small phones */
            [style*="grid-template-columns: repeat(auto-fit"] {
              grid-template-columns: 1fr 1fr !important;
            }
            .ticker-items { gap: 0.75rem !important; }
          }

        `}</style>

      </div>
    </div>
  );
}

export default App;