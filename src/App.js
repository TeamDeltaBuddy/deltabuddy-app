import React, { useState, useEffect } from 'react';
import './App.css';

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


// CORS PROXY FOR REAL DATA
const CORS_PROXY = "https://api.allorigins.win/raw?url=";

function App() {
  const [activeTab, setActiveTab] = useState('home');
  
  const [spot, setSpot] = useState(23500);
  const [strike, setStrike] = useState(23500);
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
  const [marketData, setMarketData] = useState({
    nifty: { value: 23450, change: 0.8 },
    bankNifty: { value: 49200, change: 1.2 },
    vix: { value: 14.2, change: -2.1 }
  });
  const [livePrices, setLivePrices] = useState({
    // NSE Indices
    'Nifty 50': 23450,
    'Bank Nifty': 49200,
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
  const [selectedExpiry, setSelectedExpiry] = useState('current');
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
  // NEWS INTELLIGENCE FUNCTIONS
  const analyzeSentiment = (text) => {
    const lowerText = text.toLowerCase();
    const bullishKeywords = ['rally', 'surge', 'gains', 'up', 'rise', 'high', 'bullish', 'positive', 'growth', 'strong', 'boost', 'jump', 'soar', 'record', 'buy', 'upgrade'];
    const bearishKeywords = ['fall', 'drop', 'down', 'crash', 'decline', 'loss', 'bearish', 'negative', 'weak', 'concern', 'risk', 'fear', 'sell', 'downgrade', 'plunge', 'slide'];
    let bullishScore = 0;
    let bearishScore = 0;
    bullishKeywords.forEach(word => { if (lowerText.includes(word)) bullishScore++; });
    bearishKeywords.forEach(word => { if (lowerText.includes(word)) bearishScore++; });
    if (bullishScore > bearishScore) return 'bullish';
    if (bearishScore > bullishScore) return 'bearish';
    return 'neutral';
  };

  const calculateImpact = (article) => {
    const text = (article.title + ' ' + (article.description || '')).toLowerCase();
    const highImpactKeywords = ['rbi', 'reserve bank', 'rate decision', 'repo rate', 'budget', 'fii', 'dii', 'interest rate', 'inflation', 'gdp', 'crude oil', 'election', 'policy', 'government', 'sensex', 'nifty'];
    const mediumImpactKeywords = ['earnings', 'profit', 'revenue', 'results', 'quarter', 'sector', 'industry', 'stocks', 'market'];
    let impactScore = 0;
    highImpactKeywords.forEach(word => { if (text.includes(word)) impactScore += 3; });
    mediumImpactKeywords.forEach(word => { if (text.includes(word)) impactScore += 1; });
    if (impactScore >= 5) return 'high';
    if (impactScore >= 2) return 'medium';
    return 'low';
  };

  const predictAffectedIndex = (article) => {
    const text = (article.title + ' ' + (article.description || '')).toLowerCase();
    if (text.includes('bank') || text.includes('hdfc') || text.includes('icici') || text.includes('sbi') || text.includes('axis')) return 'Bank Nifty';
    if (text.includes('it') || text.includes('tech') || text.includes('tcs') || text.includes('infosys') || text.includes('wipro')) return 'Nifty IT';
    if (text.includes('pharma') || text.includes('drug') || text.includes('healthcare')) return 'Nifty Pharma';
    if (text.includes('auto') || text.includes('tata motors') || text.includes('maruti')) return 'Nifty Auto';
    return 'Nifty 50';
  };

  // Fetch live prices from Yahoo Finance (free, no API key needed)
  const fetchLivePrices = async () => {
    setIsPriceLoading(true);
    try {
      const symbols = {
        // NSE Indices
        'Nifty 50': '^NSEI',
        'Bank Nifty': '^NSEBANK',
        'Nifty IT': 'NIFTYIT.NS',
        'Nifty Pharma': 'NIFTYPHARMA.NS',
        'Nifty Auto': 'NIFTYAUTO.NS',
        'Nifty Financial Services': 'CNXFINANCE.NS',
        'Nifty FMCG': 'NIFTYFMCG.NS',
        'Nifty Metal': 'NIFTYMETAL.NS',
        'Nifty Realty': 'NIFTYREALTY.NS',
        'Nifty Energy': 'NIFTYENERGY.NS',
        'Nifty Infrastructure': 'NIFTYINFRA.NS',
        'Nifty Media': 'NIFTYMEDIA.NS',
        'Nifty PSU Bank': 'NIFTYPSUBANK.NS',
        'Nifty Private Bank': 'NIFTY_PVT_BANK.NS',
        'Nifty Midcap 50': 'NIFTYMIDCAP50.NS',
        'Nifty Smallcap 50': 'NIFTYSMLCAP50.NS',
        'Nifty Midcap 100': 'NIFTYMIDCAP100.NS',
        'Nifty Next 50': 'NIFTYJR.NS',
        'Nifty 100': 'NIFTY100.NS',
        'Nifty 200': 'NIFTY200.NS',
        'Nifty 500': 'NIFTY500.NS',
        
        // BSE Indices
        'Sensex': '^BSESN',
        'BSE 100': 'BSE100.BO',
        'BSE 200': 'BSE200.BO',
        'BSE 500': 'BSE500.BO',
        'BSE Midcap': 'BSEMID.BO',
        'BSE Smallcap': 'BSESMALL.BO',
        
        // Top FNO Stocks
        'Reliance': 'RELIANCE.NS',
        'TCS': 'TCS.NS',
        'HDFC Bank': 'HDFCBANK.NS',
        'Infosys': 'INFY.NS',
        'ICICI Bank': 'ICICIBANK.NS',
        'Bharti Airtel': 'BHARTIARTL.NS',
        'ITC': 'ITC.NS',
        'SBI': 'SBIN.NS',
        'LT': 'LT.NS',
        'Kotak Bank': 'KOTAKBANK.NS',
        'HCL Tech': 'HCLTECH.NS',
        'Axis Bank': 'AXISBANK.NS',
        'Asian Paints': 'ASIANPAINT.NS',
        'Maruti Suzuki': 'MARUTI.NS',
        'Titan': 'TITAN.NS',
        'Bajaj Finance': 'BAJFINANCE.NS',
        'Wipro': 'WIPRO.NS',
        'Ultra Cement': 'ULTRACEMCO.NS',
        'Sun Pharma': 'SUNPHARMA.NS',
        'Nestle': 'NESTLEIND.NS',
        'M&M': 'M&M.NS',
        'Tech Mahindra': 'TECHM.NS',
        'Tata Motors': 'TATAMOTORS.NS',
        'Power Grid': 'POWERGRID.NS',
        'Adani Ports': 'ADANIPORTS.NS',
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
            const res = await fetch(CORS_PROXY + `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
            );
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
      if (results['Nifty 50']) {
        setMarketData({
          nifty: results['Nifty 50'],
          bankNifty: results['Bank Nifty'] || marketData.bankNifty,
          vix: marketData.vix
        });
      }

      // Update live prices
      const priceMap = {};
      Object.entries(results).forEach(([name, data]) => {
        priceMap[name] = data.value;
      });
      if (Object.keys(priceMap).length > 0) {
        setLivePrices(prev => ({ ...prev, ...priceMap }));
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
            const res = await fetch(CORS_PROXY + `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`
            );
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

  // Generate Live Option Chain (Realistic data based on current price)
  const generateLiveOptionChain = (underlying = 'NIFTY') => {
    setIsLoadingChain(true);
    
    // Get current price
    const currentPrice = underlying === 'NIFTY' ? marketData.nifty.value : 
                        underlying === 'BANKNIFTY' ? marketData.bankNifty.value : 23450;
    
    // Generate strikes around ATM
    const atmStrike = Math.round(currentPrice / 50) * 50;
    const strikes = [];
    for (let i = -10; i <= 10; i++) {
      strikes.push(atmStrike + (i * (underlying === 'BANKNIFTY' ? 100 : 50)));
    }
    
    // Generate realistic option chain data
    const chain = strikes.map(strike => {
      const distanceFromATM = Math.abs(strike - currentPrice);
      const isITM_CE = strike < currentPrice;
      const isITM_PE = strike > currentPrice;
      
      // Calculate realistic premiums
      const ceIV = 15 + (distanceFromATM / currentPrice) * 100 + (Math.random() * 5 - 2.5);
      const peIV = 15 + (distanceFromATM / currentPrice) * 100 + (Math.random() * 5 - 2.5);
      
      const cePremium = isITM_CE 
        ? (currentPrice - strike) + (strike * ceIV / 100 * Math.sqrt(7/365))
        : (strike * ceIV / 100 * Math.sqrt(7/365));
      
      const pePremium = isITM_PE
        ? (strike - currentPrice) + (strike * peIV / 100 * Math.sqrt(7/365))
        : (strike * peIV / 100 * Math.sqrt(7/365));
      
      // Generate realistic OI (higher near ATM)
      const oiMultiplier = Math.max(0.2, 1 - (distanceFromATM / (currentPrice * 0.1)));
      const ceOI = Math.floor((50000 + Math.random() * 100000) * oiMultiplier);
      const peOI = Math.floor((50000 + Math.random() * 100000) * oiMultiplier);
      
      // Volume (related to OI)
      const ceVolume = Math.floor(ceOI * (0.05 + Math.random() * 0.15));
      const peVolume = Math.floor(peOI * (0.05 + Math.random() * 0.15));
      
      return {
        strike,
        ce: {
          premium: Math.max(0.5, cePremium).toFixed(2),
          iv: ceIV.toFixed(1),
          oi: ceOI,
          volume: ceVolume,
          bid: (cePremium * 0.98).toFixed(2),
          ask: (cePremium * 1.02).toFixed(2),
          ltp: cePremium.toFixed(2),
          change: (Math.random() * 20 - 10).toFixed(2),
          delta: isITM_CE ? 0.7 + Math.random() * 0.2 : 0.1 + Math.random() * 0.3,
          gamma: 0.001 + Math.random() * 0.01,
          theta: -(0.5 + Math.random() * 2),
          vega: 5 + Math.random() * 10
        },
        pe: {
          premium: Math.max(0.5, pePremium).toFixed(2),
          iv: peIV.toFixed(1),
          oi: peOI,
          volume: peVolume,
          bid: (pePremium * 0.98).toFixed(2),
          ask: (pePremium * 1.02).toFixed(2),
          ltp: pePremium.toFixed(2),
          change: (Math.random() * 20 - 10).toFixed(2),
          delta: isITM_PE ? -(0.7 + Math.random() * 0.2) : -(0.1 + Math.random() * 0.3),
          gamma: 0.001 + Math.random() * 0.01,
          theta: -(0.5 + Math.random() * 2),
          vega: 5 + Math.random() * 10
        },
        atmDistance: distanceFromATM
      };
    });
    
    setLiveOptionChain(chain);
    
    // Generate chart data from option chain
    setChartData({
      oi: chain.map(row => ({ strike: row.strike, ce: row.ce.oi / 1000, pe: row.pe.oi / 1000 })),
      iv: chain.map(row => ({ strike: row.strike, ce: parseFloat(row.ce.iv), pe: parseFloat(row.pe.iv) })),
      volume: chain.map(row => ({ strike: row.strike, ce: row.ce.volume / 1000, pe: row.pe.volume / 1000 })),
      priceHistory: [] // Would come from historical data API
    });
    
    setIsLoadingChain(false);
  };

  // Fetch General Business News
  const fetchBusinessNews = async () => {
    setIsLoadingBusinessNews(true);
    try {
      const query = 'business OR economy OR markets OR companies OR earnings OR IPO';
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${NEWS_API_KEY}`
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

  // Generate Candlestick Data (realistic OHLCV data)
  const generateCandlestickData = (symbol, timeframe) => {
    const basePrice = symbol === 'NIFTY' ? 23450 : 
                     symbol === 'BANKNIFTY' ? 49200 : 2850;
    
    const periods = timeframe === '1D' ? 78 : // 1 day = 78 candles (5min)
                   timeframe === '5D' ? 390 : // 5 days
                   timeframe === '1M' ? 420 : // 1 month (daily)
                   timeframe === '3M' ? 63 : 
                   timeframe === '6M' ? 126 : 252;
    
    const candles = [];
    let price = basePrice;
    const volatility = basePrice * 0.002; // 0.2% volatility per period
    
    for (let i = 0; i < periods; i++) {
      const change = (Math.random() - 0.48) * volatility; // Slight upward bias
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = Math.floor(1000000 + Math.random() * 5000000);
      
      candles.push({
        time: Date.now() - ((periods - i) * (timeframe === '1D' ? 300000 : 86400000)), // 5min or daily
        open: open.toFixed(2),
        high: high.toFixed(2),
        low: low.toFixed(2),
        close: close.toFixed(2),
        volume
      });
      
      price = close;
    }
    
    setCandlestickData(candles);
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

  // Dynamic key levels based on live price
  const calculateKeyLevels = (indexName) => {
    const currentPrice = livePrices[indexName] || livePrices['Nifty 50'] || 23450;

    // Calculate dynamic support/resistance as % away from current price
    const support1 = Math.round(currentPrice * 0.985); // 1.5% below
    const support2 = Math.round(currentPrice * 0.970); // 3% below
    const support3 = Math.round(currentPrice * 0.955); // 4.5% below
    const resistance1 = Math.round(currentPrice * 1.015); // 1.5% above
    const resistance2 = Math.round(currentPrice * 1.030); // 3% above
    const resistance3 = Math.round(currentPrice * 1.045); // 4.5% above

    // Round to nearest 50 for cleaner levels
    const roundTo50 = (n) => Math.round(n / 50) * 50;

    return {
      current: currentPrice,
      support: [roundTo50(support1), roundTo50(support2), roundTo50(support3)],
      resistance: [roundTo50(resistance1), roundTo50(resistance2), roundTo50(resistance3)]
    };
  };

  const generateTradingStrategy = (sentiment, impact, indexName) => {
    const levels = calculateKeyLevels(indexName);
    if (sentiment === 'bearish' && (impact === 'high' || impact === 'medium')) {
      return {
        strategy: 'Bear Put Spread',
        index: indexName,
        strikes: { buy: Math.round(levels.current), sell: Math.round(levels.support[0]) },
        reasoning: `${impact.toUpperCase()} impact bearish news suggests downward pressure. Target support at ${levels.support[0]}.`,
        risk: 'Low to Medium',
        timeframe: '1-3 days',
        probability: impact === 'high' ? '72%' : '58%'
      };
    }
    if (sentiment === 'bullish' && (impact === 'high' || impact === 'medium')) {
      return {
        strategy: 'Bull Call Spread',
        index: indexName,
        strikes: { buy: Math.round(levels.current), sell: Math.round(levels.resistance[0]) },
        reasoning: `${impact.toUpperCase()} impact bullish news suggests upward momentum. Target resistance at ${levels.resistance[0]}.`,
        risk: 'Low to Medium',
        timeframe: '1-3 days',
        probability: impact === 'high' ? '68%' : '55%'
      };
    }
    return { strategy: 'Wait and Watch', reasoning: 'Market direction unclear. Wait for confirmation.', risk: 'None', timeframe: 'N/A', probability: 'N/A' };
  };

  const fetchIntelligentNews = async () => {
    setIsLoadingNews(true);
    try {
      const query = 'nifty OR sensex OR "bank nifty" OR "india market" OR RBI';
      const response = await fetch(`https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_API_KEY}`);
      const data = await response.json();
      if (data.articles) {
        const analyzed = data.articles.map(article => {
          const sentiment = analyzeSentiment(article.title + ' ' + (article.description || ''));
          const impact = calculateImpact(article);
          const affectedIndex = predictAffectedIndex(article);
          const keyLevels = calculateKeyLevels(affectedIndex);
          const tradingIdea = generateTradingStrategy(sentiment, impact, affectedIndex);
          return {
            id: article.url,
            title: article.title,
            description: article.description,
            source: article.source.name,
            publishedAt: new Date(article.publishedAt),
            url: article.url,
            analysis: { sentiment, impact, affectedIndex, keyLevels, tradingIdea }
          };
        });
        setIntelligentNews(analyzed);
      }
    } catch (error) {
      console.error('Error fetching news:', error);
    } finally {
      setIsLoadingNews(false);
    }
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
      // Update global indices every 15 seconds (real-time feel)
      const globalInterval = setInterval(() => {
        fetchGlobalIndices();
      }, 15000);
      
      // Update Indian indices every 30 seconds
      const indiaInterval = setInterval(() => {
        fetchLivePrices();
        fetchIntelligentNews();
      }, 30000);
      
      // Update option chain every 10 seconds
      const chainInterval = setInterval(() => {
        generateLiveOptionChain(selectedUnderlying);
      }, 10000);
      
      // Update business news every 5 minutes
      const newsInterval = setInterval(() => {
        fetchBusinessNews();
      }, 300000);
      
      // Update chart data every 5 minutes
      const chartInterval = setInterval(() => {
        generateCandlestickData(selectedChartSymbol, chartTimeframe);
      }, 300000);
      
      return () => {
        clearInterval(globalInterval);
        clearInterval(indiaInterval);
        clearInterval(chainInterval);
        clearInterval(newsInterval);
        clearInterval(chartInterval);
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
          <div className="nav-links">
	<span 
              className={activeTab === 'home' ? 'active' : ''}
              onClick={() => setActiveTab('home')}
            >
              Home
            </span>

            <span 
              className={activeTab === 'single' ? 'active' : ''}
              onClick={() => setActiveTab('single')}
            >
              Calculator
            </span>
            <span 
              className={activeTab === 'strategy' ? 'active' : ''}
              onClick={() => setActiveTab('strategy')}
            >
              Strategies
            </span>
           <span 
              className={activeTab === 'scanner' ? 'active' : ''}
              onClick={() => setActiveTab('scanner')}
            >
              Scanner
            </span>

            <span className="premium-badge">Premium</span>
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
              <div className="ticker-scroll">
                <div className="ticker-items">
                  {Object.entries(globalIndices).map(([name, data]) => (
                    <div key={name} className="ticker-item">
                      <span className="ticker-name">{name}</span>
                      <span className="ticker-value">{data.value.toLocaleString()}</span>
                      <span className={`ticker-change ${data.change >= 0 ? 'positive' : 'negative'}`}>
                        {data.change >= 0 ? '▲' : '▼'} {Math.abs(data.change)}%
                      </span>
                    </div>
                  ))}
                  {/* Duplicate for seamless scroll */}
                  {Object.entries(globalIndices).map(([name, data]) => (
                    <div key={`${name}-dup`} className="ticker-item">
                      <span className="ticker-name">{name}</span>
                      <span className="ticker-value">{data.value.toLocaleString()}</span>
                      <span className={`ticker-change ${data.change >= 0 ? 'positive' : 'negative'}`}>
                        {data.change >= 0 ? '▲' : '▼'} {Math.abs(data.change)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="page-header">
              <h1>📊 Market Intelligence</h1>
              <p className="subtitle">AI-powered analysis with real-time trading insights</p>
              <button className="btn-action" onClick={() => { fetchLivePrices(); fetchIntelligentNews(); }} disabled={isLoadingNews}>
                {isLoadingNews ? '⏳ Loading...' : '🔄 Refresh All'}
              </button>
            </div>

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

            {/* HOME SUB-TABS */}
            <div className="home-tabs">
              {['news', 'option-chain', 'candlestick', 'charts', 'institutional', 'events', 'business-news', 'oi-chart', 'fii-dii', 'pcr', 'max-pain'].map(tab => (
                <button
                  key={tab}
                  className={`home-tab-btn ${activeHomeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveHomeTab(tab)}
                >
                  {tab === 'news' && '📰 News Intelligence'}
                  {tab === 'option-chain' && '⚡ Live Option Chain'}
                  {tab === 'candlestick' && '📊 Candlestick Chart'}
                  {tab === 'charts' && '📈 OI/IV Charts'}
                  {tab === 'institutional' && '🏦 Institutional Activity'}
                  {tab === 'events' && '📅 Events Calendar'}
                  {tab === 'business-news' && '📰 Business News'}
                  {tab === 'oi-chart' && '📊 OI Analysis'}
                  {tab === 'fii-dii' && '🏦 FII / DII'}
                  {tab === 'pcr' && '⚡ PCR Meter'}
                  {tab === 'max-pain' && '🎯 Max Pain'}
                </button>
              ))}
            </div>

            {/* OPTION CHAIN TAB */}
            {activeHomeTab === 'option-chain' && (
              <div className="panel">
                <div className="option-chain-header">
                  <div>
                    <h2>⚡ Live Option Chain</h2>
                    <p style={{color: 'var(--text-dim)', marginTop: '0.5rem'}}>
                      Real-time option data with Greeks • Updates every 10 seconds
                    </p>
                  </div>
                  <div className="chain-controls">
                    <select 
                      value={selectedUnderlying} 
                      onChange={(e) => { setSelectedUnderlying(e.target.value); generateLiveOptionChain(e.target.value); }}
                      className="chain-select"
                    >
                      <option value="NIFTY">NIFTY</option>
                      <option value="BANKNIFTY">BANK NIFTY</option>
                      <option value="FINNIFTY">FIN NIFTY</option>
                    </select>
                    <select value={selectedExpiry} onChange={(e) => setSelectedExpiry(e.target.value)} className="chain-select">
                      <option value="current">Current Week</option>
                      <option value="next">Next Week</option>
                      <option value="monthly">Monthly</option>
                    </select>
                    <button className="btn-action" onClick={() => generateLiveOptionChain(selectedUnderlying)} disabled={isLoadingChain}>
                      {isLoadingChain ? '⏳' : '🔄'} Refresh
                    </button>
                  </div>
                </div>

                {isLoadingChain && liveOptionChain.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-dim)'}}>
                    <p>Loading option chain...</p>
                  </div>
                ) : (
                  <div className="option-chain-table-wrapper">
                    <table className="live-option-chain">
                      <thead>
                        <tr>
                          <th colSpan="6" className="ce-header">CALLS (CE)</th>
                          <th className="strike-header">STRIKE</th>
                          <th colSpan="6" className="pe-header">PUTS (PE)</th>
                        </tr>
                        <tr>
                          <th>OI</th>
                          <th>Volume</th>
                          <th>IV</th>
                          <th>LTP</th>
                          <th>Change</th>
                          <th>Bid/Ask</th>
                          <th className="strike-header">PRICE</th>
                          <th>Bid/Ask</th>
                          <th>Change</th>
                          <th>LTP</th>
                          <th>IV</th>
                          <th>Volume</th>
                          <th>OI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveOptionChain.map((row, idx) => {
                          const isATM = row.atmDistance < 50;
                          const isITM_CE = row.strike < (selectedUnderlying === 'NIFTY' ? marketData.nifty.value : marketData.bankNifty.value);
                          const isITM_PE = row.strike > (selectedUnderlying === 'NIFTY' ? marketData.nifty.value : marketData.bankNifty.value);
                          
                          return (
                            <tr key={idx} className={isATM ? 'atm-row' : ''}>
                              <td className={isITM_CE ? 'itm-cell' : ''}>{(row.ce.oi / 1000).toFixed(0)}K</td>
                              <td>{(row.ce.volume / 1000).toFixed(1)}K</td>
                              <td>{row.ce.iv}%</td>
                              <td className="ltp-cell ce-color">₹{row.ce.ltp}</td>
                              <td className={parseFloat(row.ce.change) >= 0 ? 'positive' : 'negative'}>
                                {parseFloat(row.ce.change) >= 0 ? '+' : ''}{row.ce.change}%
                              </td>
                              <td className="bid-ask-cell">{row.ce.bid}/{row.ce.ask}</td>
                              <td className={`strike-cell ${isATM ? 'atm-strike' : ''}`}>{row.strike.toLocaleString()}</td>
                              <td className="bid-ask-cell">{row.pe.bid}/{row.pe.ask}</td>
                              <td className={parseFloat(row.pe.change) >= 0 ? 'positive' : 'negative'}>
                                {parseFloat(row.pe.change) >= 0 ? '+' : ''}{row.pe.change}%
                              </td>
                              <td className="ltp-cell pe-color">₹{row.pe.ltp}</td>
                              <td>{row.pe.iv}%</td>
                              <td>{(row.pe.volume / 1000).toFixed(1)}K</td>
                              <td className={isITM_PE ? 'itm-cell' : ''}>{(row.pe.oi / 1000).toFixed(0)}K</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="chain-summary">
                  <div className="chain-stat">
                    <span>Total CE OI</span>
                    <span className="ce-color">{(liveOptionChain.reduce((sum, r) => sum + r.ce.oi, 0) / 1000000).toFixed(2)}M</span>
                  </div>
                  <div className="chain-stat">
                    <span>Total PE OI</span>
                    <span className="pe-color">{(liveOptionChain.reduce((sum, r) => sum + r.pe.oi, 0) / 1000000).toFixed(2)}M</span>
                  </div>
                  <div className="chain-stat">
                    <span>Put/Call Ratio</span>
                    <span className="pcr-value">
                      {(liveOptionChain.reduce((sum, r) => sum + r.pe.oi, 0) / liveOptionChain.reduce((sum, r) => sum + r.ce.oi, 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="chain-stat">
                    <span>Max CE OI</span>
                    <span>{Math.max(...liveOptionChain.map(r => r.strike)).toLocaleString()}</span>
                  </div>
                  <div className="chain-stat">
                    <span>Max PE OI</span>
                    <span>{Math.min(...liveOptionChain.map(r => r.strike)).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CHARTS TAB */}
            {activeHomeTab === 'charts' && (
              <div className="panel">
                <div className="charts-header">
                  <h2>📈 Interactive Charts</h2>
                  <div className="chart-type-selector">
                    {['oi', 'iv', 'volume'].map(type => (
                      <button
                        key={type}
                        className={`chart-type-btn ${chartType === type ? 'active' : ''}`}
                        onClick={() => setChartType(type)}
                      >
                        {type === 'oi' && '📊 OI Chart'}
                        {type === 'iv' && '📉 IV Chart'}
                        {type === 'volume' && '📈 Volume Chart'}
                      </button>
                    ))}
                  </div>
                </div>

                {chartType === 'oi' && (
                  <div className="chart-container">
                    <h3>Open Interest by Strike</h3>
                    <div className="bar-chart">
                      {chartData.oi.map((row, idx) => {
                        const maxOI = Math.max(...chartData.oi.map(r => Math.max(r.ce, r.pe)));
                        return (
                          <div key={idx} className="chart-row">
                            <div className="chart-strike">{row.strike}</div>
                            <div className="chart-bars">
                              <div className="chart-bar ce" style={{width: `${(row.ce / maxOI) * 100}%`}}>
                                <span className="bar-label">{row.ce.toFixed(0)}K</span>
                              </div>
                              <div className="chart-bar pe" style={{width: `${(row.pe / maxOI) * 100}%`}}>
                                <span className="bar-label">{row.pe.toFixed(0)}K</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-ce">■</span> Call OI</span>
                      <span className="legend-item"><span className="legend-pe">■</span> Put OI</span>
                    </div>
                  </div>
                )}

                {chartType === 'iv' && (
                  <div className="chart-container">
                    <h3>Implied Volatility Smile</h3>
                    <div className="line-chart">
                      <svg viewBox="0 0 800 400" className="iv-chart-svg">
                        <defs>
                          <linearGradient id="ceGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style={{stopColor: '#EF4444', stopOpacity: 0.3}} />
                            <stop offset="100%" style={{stopColor: '#EF4444', stopOpacity: 0}} />
                          </linearGradient>
                          <linearGradient id="peGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style={{stopColor: '#10B981', stopOpacity: 0.3}} />
                            <stop offset="100%" style={{stopColor: '#10B981', stopOpacity: 0}} />
                          </linearGradient>
                        </defs>
                        
                        {/* Grid lines */}
                        {[0, 100, 200, 300, 400].map(y => (
                          <line key={y} x1="50" y1={y} x2="750" y2={y} stroke="rgba(100,116,139,0.2)" strokeWidth="1" />
                        ))}
                        
                        {/* CE Line */}
                        <polyline
                          points={chartData.iv.map((d, i) => {
                            const x = 50 + (i / chartData.iv.length) * 700;
                            const y = 350 - (d.ce * 10);
                            return `${x},${y}`;
                          }).join(' ')}
                          fill="url(#ceGrad)"
                          stroke="#EF4444"
                          strokeWidth="3"
                        />
                        
                        {/* PE Line */}
                        <polyline
                          points={chartData.iv.map((d, i) => {
                            const x = 50 + (i / chartData.iv.length) * 700;
                            const y = 350 - (d.pe * 10);
                            return `${x},${y}`;
                          }).join(' ')}
                          fill="url(#peGrad)"
                          stroke="#10B981"
                          strokeWidth="3"
                        />
                        
                        {/* Axes */}
                        <line x1="50" y1="350" x2="750" y2="350" stroke="#64748b" strokeWidth="2" />
                        <line x1="50" y1="50" x2="50" y2="350" stroke="#64748b" strokeWidth="2" />
                        
                        <text x="400" y="380" textAnchor="middle" fill="#94a3b8" fontSize="14">Strike Price</text>
                        <text x="20" y="200" textAnchor="middle" fill="#94a3b8" fontSize="14" transform="rotate(-90 20 200)">IV %</text>
                      </svg>
                    </div>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-ce">■</span> Call IV</span>
                      <span className="legend-item"><span className="legend-pe">■</span> Put IV</span>
                    </div>
                  </div>
                )}

                {chartType === 'volume' && (
                  <div className="chart-container">
                    <h3>Trading Volume by Strike</h3>
                    <div className="bar-chart">
                      {chartData.volume.map((row, idx) => {
                        const maxVol = Math.max(...chartData.volume.map(r => Math.max(r.ce, r.pe)));
                        return (
                          <div key={idx} className="chart-row">
                            <div className="chart-strike">{row.strike}</div>
                            <div className="chart-bars">
                              <div className="chart-bar ce" style={{width: `${(row.ce / maxVol) * 100}%`}}>
                                <span className="bar-label">{row.ce.toFixed(1)}K</span>
                              </div>
                              <div className="chart-bar pe" style={{width: `${(row.pe / maxVol) * 100}%`}}>
                                <span className="bar-label">{row.pe.toFixed(1)}K</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="chart-legend">
                      <span className="legend-item"><span className="legend-ce">■</span> Call Volume</span>
                      <span className="legend-item"><span className="legend-pe">■</span> Put Volume</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* NEWS TAB */}

            {/* CANDLESTICK CHART TAB */}
            {activeHomeTab === 'candlestick' && (
              <div className="panel">
                <div className="candlestick-header">
                  <div>
                    <h2>📊 Candlestick Chart with Indicators</h2>
                    <p style={{color: 'var(--text-dim)', marginTop: '0.5rem'}}>
                      Professional trading chart • Updates every 5 minutes
                    </p>
                  </div>
                  <div className="chart-controls-grid">
                    <div className="chart-control-group">
                      <label>Symbol</label>
                      <select 
                        value={selectedChartSymbol} 
                        onChange={(e) => { setSelectedChartSymbol(e.target.value); generateCandlestickData(e.target.value, chartTimeframe); }}
                        className="chart-control-select"
                      >
                        <option value="NIFTY">NIFTY 50</option>
                        <option value="BANKNIFTY">BANK NIFTY</option>
                        <option value="RELIANCE">RELIANCE</option>
                        <option value="TCS">TCS</option>
                        <option value="HDFCBANK">HDFC BANK</option>
                        <option value="INFY">INFOSYS</option>
                      </select>
                    </div>
                    
                    <div className="chart-control-group">
                      <label>Chart Type</label>
                      <select
                        value={candlestickType}
                        onChange={(e) => setCandlestickType(e.target.value)}
                        className="chart-control-select"
                      >
                        <option value="candlestick">Candlestick</option>
                        <option value="heikin-ashi">Heiken Ashi</option>
                        <option value="renko">Renko</option>
                        <option value="kagi">Kagi</option>
                        <option value="line">Line Chart</option>
                        <option value="area">Area Chart</option>
                      </select>
                    </div>
                    
                    <div className="chart-control-group">
                      <label>Timeframe</label>
                      <select 
                        value={chartTimeframe} 
                        onChange={(e) => { setChartTimeframe(e.target.value); generateCandlestickData(selectedChartSymbol, e.target.value); }}
                        className="chart-control-select"
                      >
                        <option value="1m">1 Minute</option>
                        <option value="3m">3 Minutes</option>
                        <option value="5m">5 Minutes</option>
                        <option value="15m">15 Minutes</option>
                        <option value="30m">30 Minutes</option>
                        <option value="1H">1 Hour</option>
                        <option value="4H">4 Hours</option>
                        <option value="1D">1 Day</option>
                        <option value="1W">1 Week</option>
                        <option value="1M">1 Month</option>
                        <option value="3M">3 Months</option>
                        <option value="6M">6 Months</option>
                        <option value="1Y">1 Year</option>
                      </select>
                    </div>
                    
                    <div className="chart-control-group">
                      <label>Indicators</label>
                      <select
                        multiple
                        value={chartIndicators}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, option => option.value);
                          setChartIndicators(selected);
                        }}
                        className="chart-control-select"
                        style={{height: '80px'}}
                      >
                        <option value="SMA">SMA (Simple Moving Avg)</option>
                        <option value="EMA">EMA (Exponential MA)</option>
                        <option value="RSI">RSI (Relative Strength)</option>
                        <option value="MACD">MACD (Moving Avg Convergence)</option>
                        <option value="BB">BB (Bollinger Bands)</option>
                      </select>
                      <p style={{fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem'}}>
                        Hold Ctrl/Cmd to select multiple
                      </p>
                    </div>
                    
                    <div className="live-status-bar">
                      <span className="live-indicator-pulse">● LIVE</span>
                      <span className="live-timestamp">Updated: {lastChartUpdate.toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>

                <div className="candlestick-chart-container">
                  <svg viewBox="0 0 1000 500" className="candlestick-svg">
                    <defs>
                      <linearGradient id="volumeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style={{stopColor: 'var(--accent)', stopOpacity: 0.3}} />
                        <stop offset="100%" style={{stopColor: 'var(--accent)', stopOpacity: 0}} />
                      </linearGradient>
                    </defs>
                    
                    {/* Grid lines */}
                    {[0, 100, 200, 300, 400].map(y => (
                      <line key={y} x1="50" y1={y} x2="950" y2={y} stroke="rgba(100,116,139,0.2)" strokeWidth="1" />
                    ))}
                    
                    {/* Candlesticks */}
                    {candlestickData.map((candle, idx) => {
                      const x = 60 + (idx / candlestickData.length) * 880;
                      const open = parseFloat(candle.open);
                      const close = parseFloat(candle.close);
                      const high = parseFloat(candle.high);
                      const low = parseFloat(candle.low);
                      const isGreen = close > open;
                      
                      const priceRange = Math.max(...candlestickData.map(c => parseFloat(c.high))) - Math.min(...candlestickData.map(c => parseFloat(c.low)));
                      const minPrice = Math.min(...candlestickData.map(c => parseFloat(c.low)));
                      
                      const yOpen = 350 - ((open - minPrice) / priceRange) * 300;
                      const yClose = 350 - ((close - minPrice) / priceRange) * 300;
                      const yHigh = 350 - ((high - minPrice) / priceRange) * 300;
                      const yLow = 350 - ((low - minPrice) / priceRange) * 300;
                      
                      return (
                        <g key={idx}>
                          <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={isGreen ? 'var(--accent)' : '#EF4444'} strokeWidth="1" />
                          <rect 
                            x={x - 2} 
                            y={Math.min(yOpen, yClose)} 
                            width="4" 
                            height={Math.abs(yClose - yOpen) || 1}
                            fill={isGreen ? 'var(--accent)' : '#EF4444'}
                          />
                        </g>
                      );
                    })}
                    
                    {/* SMA if enabled */}
                    {chartIndicators.includes('SMA') && (
                      <polyline
                        points={calculateSMA(candlestickData).map((d, i) => {
                          if (!d.value) return '';
                          const x = 60 + (i / candlestickData.length) * 880;
                          const priceRange = Math.max(...candlestickData.map(c => parseFloat(c.high))) - Math.min(...candlestickData.map(c => parseFloat(c.low)));
                          const minPrice = Math.min(...candlestickData.map(c => parseFloat(c.low)));
                          const y = 350 - ((d.value - minPrice) / priceRange) * 300;
                          return `${x},${y}`;
                        }).filter(p => p).join(' ')}
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth="2"
                      />
                    )}
                    
                    {/* Axes */}
                    <line x1="50" y1="350" x2="950" y2="350" stroke="#64748b" strokeWidth="2" />
                    <line x1="50" y1="50" x2="50" y2="350" stroke="#64748b" strokeWidth="2" />
                    
                    <text x="500" y="390" textAnchor="middle" fill="#94a3b8" fontSize="14">
                      {selectedChartSymbol} • {chartTimeframe}
                    </text>
                    <text x="20" y="200" textAnchor="middle" fill="#94a3b8" fontSize="14" transform="rotate(-90 20 200)">Price</text>
                  </svg>
                  
                  {/* RSI Sub-chart */}
                  {chartIndicators.includes('RSI') && (
                    <svg viewBox="0 0 1000 150" className="rsi-chart-svg">
                      <line x1="50" y1="75" x2="950" y2="75" stroke="rgba(100,116,139,0.3)" strokeWidth="1" strokeDasharray="5,5" />
                      <line x1="50" y1="25" x2="950" y2="25" stroke="rgba(239,68,68,0.3)" strokeWidth="1" strokeDasharray="5,5" />
                      <line x1="50" y1="125" x2="950" y2="125" stroke="rgba(16,185,129,0.3)" strokeWidth="1" strokeDasharray="5,5" />
                      
                      <polyline
                        points={calculateRSI(candlestickData).map((d, i) => {
                          if (!d.value) return '';
                          const x = 60 + (i / candlestickData.length) * 880;
                          const y = 125 - (d.value * 1);
                          return `${x},${y}`;
                        }).filter(p => p).join(' ')}
                        fill="none"
                        stroke="#8B5CF6"
                        strokeWidth="2"
                      />
                      
                      <text x="20" y="75" fill="#94a3b8" fontSize="12">RSI</text>
                      <text x="960" y="30" fill="#EF4444" fontSize="10">70</text>
                      <text x="960" y="130" fill="var(--accent)" fontSize="10">30</text>
                    </svg>
                  )}
                </div>
                
                
                <div className="tradingview-timeframe-bar">
                  <div className="timeframe-buttons">
                    {['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W', '1M', '3M', '6M', '1Y'].map(tf => (
                      <button
                        key={tf}
                        className={`timeframe-btn ${chartTimeframe === tf ? 'active' : ''}`}
                        onClick={() => { setChartTimeframe(tf); generateCandlestickData(selectedChartSymbol, tf); }}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                  <div className="chart-type-switcher">
                    <button
                      className={`type-btn ${candlestickType === 'candlestick' ? 'active' : ''}`}
                      onClick={() => setCandlestickType('candlestick')}
                      title="Candlestick"
                    >
                      📊
                    </button>
                    <button
                      className={`type-btn ${candlestickType === 'heikin-ashi' ? 'active' : ''}`}
                      onClick={() => setCandlestickType('heikin-ashi')}
                      title="Heiken Ashi"
                    >
                      🔸
                    </button>
                    <button
                      className={`type-btn ${candlestickType === 'line' ? 'active' : ''}`}
                      onClick={() => setCandlestickType('line')}
                      title="Line Chart"
                    >
                      📈
                    </button>
                  </div>
                </div>

                <div className="chart-stats">
                  <div className="stat-item">
                    <span>Open</span>
                    <span className="stat-value">{candlestickData[candlestickData.length - 1]?.open}</span>
                  </div>
                  <div className="stat-item">
                    <span>High</span>
                    <span className="stat-value positive">{candlestickData[candlestickData.length - 1]?.high}</span>
                  </div>
                  <div className="stat-item">
                    <span>Low</span>
                    <span className="stat-value negative">{candlestickData[candlestickData.length - 1]?.low}</span>
                  </div>
                  <div className="stat-item">
                    <span>Close</span>
                    <span className="stat-value">{candlestickData[candlestickData.length - 1]?.close}</span>
                  </div>
                  <div className="stat-item">
                    <span>Volume</span>
                    <span className="stat-value">{(candlestickData[candlestickData.length - 1]?.volume / 1000000).toFixed(2)}M</span>
                  </div>
                </div>
              </div>
            )}


            {/* INSTITUTIONAL ACTIVITY TAB */}
            {activeHomeTab === 'institutional' && (
              <div className="panel">
                <div className="institutional-header">
                  <div>
                    <h2>🏦 Institutional Activity</h2>
                    <p style={{color: 'var(--text-dim)', marginTop: '0.5rem'}}>
                      FII/DII Activity, Bulk Deals, Block Deals, and Option Strike Analysis
                    </p>
                  </div>
                  <div className="inst-summary">
                    <div className="inst-summary-card fii">
                      <span className="inst-label">FII Net</span>
                      <span className={`inst-value ${institutionalActivity.fii.net >= 0 ? 'positive' : 'negative'}`}>
                        {institutionalActivity.fii.net >= 0 ? '+' : ''}{institutionalActivity.fii.net} Cr
                      </span>
                    </div>
                    <div className="inst-summary-card dii">
                      <span className="inst-label">DII Net</span>
                      <span className={`inst-value ${institutionalActivity.dii.net >= 0 ? 'positive' : 'negative'}`}>
                        {institutionalActivity.dii.net >= 0 ? '+' : ''}{institutionalActivity.dii.net} Cr
                      </span>
                    </div>
                    <div className="inst-summary-card total">
                      <span className="inst-label">Combined Net</span>
                      <span className={`inst-value ${(institutionalActivity.fii.net + institutionalActivity.dii.net) >= 0 ? 'positive' : 'negative'}`}>
                        {(institutionalActivity.fii.net + institutionalActivity.dii.net) >= 0 ? '+' : ''}{institutionalActivity.fii.net + institutionalActivity.dii.net} Cr
                      </span>
                    </div>
                  </div>
                </div>

                {/* FII/DII DETAILED BREAKDOWN */}
                <div className="institutional-section">
                  <h3>📊 FII & DII Activity (Today)</h3>
                  <div className="fii-dii-breakdown">
                    <div className="breakdown-card">
                      <h4>🌍 Foreign Institutional Investors (FII)</h4>
                      <div className="breakdown-grid">
                        <div className="breakdown-item">
                          <span className="label">Buy</span>
                          <span className="value positive">₹{institutionalActivity.fii.buy} Cr</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="label">Sell</span>
                          <span className="value negative">₹{institutionalActivity.fii.sell} Cr</span>
                        </div>
                        <div className="breakdown-item highlight">
                          <span className="label">Net</span>
                          <span className={`value ${institutionalActivity.fii.net >= 0 ? 'positive' : 'negative'}`}>
                            {institutionalActivity.fii.net >= 0 ? '+' : ''}₹{institutionalActivity.fii.net} Cr
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="breakdown-card">
                      <h4>🏛️ Domestic Institutional Investors (DII)</h4>
                      <div className="breakdown-grid">
                        <div className="breakdown-item">
                          <span className="label">Buy</span>
                          <span className="value positive">₹{institutionalActivity.dii.buy} Cr</span>
                        </div>
                        <div className="breakdown-item">
                          <span className="label">Sell</span>
                          <span className="value negative">₹{institutionalActivity.dii.sell} Cr</span>
                        </div>
                        <div className="breakdown-item highlight">
                          <span className="label">Net</span>
                          <span className={`value ${institutionalActivity.dii.net >= 0 ? 'positive' : 'negative'}`}>
                            {institutionalActivity.dii.net >= 0 ? '+' : ''}₹{institutionalActivity.dii.net} Cr
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BULK DEALS */}
                <div className="institutional-section">
                  <h3>📦 Bulk Deals (Today)</h3>
                  <p className="section-subtitle">Trades above 0.5% of total equity</p>
                  <div className="deals-table-wrapper">
                    <table className="deals-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Stock</th>
                          <th>Client Name</th>
                          <th>Type</th>
                          <th>Quantity</th>
                          <th>Price (₹)</th>
                          <th>Value (Cr)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkDeals.map((deal, idx) => (
                          <tr key={idx} className={deal.type === 'BUY' ? 'buy-row' : 'sell-row'}>
                            <td>{deal.date}</td>
                            <td className="stock-name">{deal.stock}</td>
                            <td className="client-name">{deal.client}</td>
                            <td>
                              <span className={`deal-type ${deal.type.toLowerCase()}`}>
                                {deal.type === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
                              </span>
                            </td>
                            <td>{deal.quantity.toLocaleString()}</td>
                            <td>₹{deal.price.toFixed(2)}</td>
                            <td className="value-cell">₹{deal.value} Cr</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* BLOCK DEALS */}
                <div className="institutional-section">
                  <h3>🏢 Block Deals (Today)</h3>
                  <p className="section-subtitle">Large institutional trades via separate window</p>
                  <div className="deals-table-wrapper">
                    <table className="deals-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Stock</th>
                          <th>Client Name</th>
                          <th>Type</th>
                          <th>Quantity</th>
                          <th>Price (₹)</th>
                          <th>Value (Cr)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {blockDeals.map((deal, idx) => (
                          <tr key={idx} className={deal.type === 'BUY' ? 'buy-row' : 'sell-row'}>
                            <td>{deal.date}</td>
                            <td className="stock-name">{deal.stock}</td>
                            <td className="client-name">{deal.client}</td>
                            <td>
                              <span className={`deal-type ${deal.type.toLowerCase()}`}>
                                {deal.type === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
                              </span>
                            </td>
                            <td>{deal.quantity.toLocaleString()}</td>
                            <td>₹{deal.price.toFixed(2)}</td>
                            <td className="value-cell">₹{deal.value} Cr</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* OPTION STRIKE INSTITUTIONAL ACTIVITY */}
                <div className="institutional-section">
                  <h3>⚡ Option Strike Institutional Activity</h3>
                  <p className="section-subtitle">FII/DII activity in option strikes</p>
                  <div className="option-inst-table-wrapper">
                    <table className="option-inst-table">
                      <thead>
                        <tr>
                          <th>Strike</th>
                          <th>Type</th>
                          <th>FII OI</th>
                          <th>FII Change</th>
                          <th>DII OI</th>
                          <th>DII Change</th>
                          <th>Signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionInstitutionalActivity.map((row, idx) => (
                          <tr key={idx}>
                            <td className="strike-cell">{row.strike}</td>
                            <td>
                              <span className={`option-type ${row.type.toLowerCase()}`}>
                                {row.type}
                              </span>
                            </td>
                            <td>{(row.fiiOI / 1000).toFixed(0)}K</td>
                            <td className={row.fiiChange.startsWith('+') ? 'positive' : 'negative'}>
                              {row.fiiChange}
                            </td>
                            <td>{(row.diiOI / 1000).toFixed(0)}K</td>
                            <td className={row.diiChange.startsWith('+') ? 'positive' : 'negative'}>
                              {row.diiChange}
                            </td>
                            <td>
                              {row.fiiChange.startsWith('+') && row.diiChange.startsWith('+') ? (
                                <span className="signal bullish">🟢 Bullish</span>
                              ) : row.fiiChange.startsWith('-') && row.diiChange.startsWith('-') ? (
                                <span className="signal bearish">🔴 Bearish</span>
                              ) : (
                                <span className="signal neutral">⚪ Mixed</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="inst-footer">
                  <p style={{color: 'var(--text-dim)', fontSize: '0.85rem'}}>
                    📍 Data Source: NSE India • Updated: {institutionalActivity.lastUpdated.toLocaleTimeString()} • 
                    Auto-refresh: Every 5 minutes
                  </p>
                  <p style={{color: '#F59E0B', fontSize: '0.85rem', marginTop: '0.5rem'}}>
                    ⚠️ Note: This is sample data. Connect to NSE API for real-time institutional activity.
                  </p>
                </div>
              </div>
            )}


            {/* EVENTS CALENDAR TAB */}
            {activeHomeTab === 'events' && (
              <div className="panel">
                <h2>📅 Events Calendar</h2>
                <p style={{color: 'var(--text-dim)', marginBottom: '1.5rem'}}>
                  Upcoming market events, earnings, economic data, and expiry dates
                </p>
                
                <div className="events-timeline">
                  {events.sort((a, b) => new Date(a.date) - new Date(b.date)).map((event, idx) => {
                    const eventDate = new Date(event.date);
                    const isToday = eventDate.toDateString() === new Date().toDateString();
                    const isPast = eventDate < new Date();
                    
                    return (
                      <div key={idx} className={`event-card ${event.impact} ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}`}>
                        <div className="event-date">
                          <div className="event-day">{eventDate.getDate()}</div>
                          <div className="event-month">{eventDate.toLocaleDateString('en-US', { month: 'short' })}</div>
                        </div>
                        <div className="event-details">
                          <div className="event-header">
                            <span className={`event-type ${event.type}`}>
                              {event.type === 'earnings' && '📊'}
                              {event.type === 'economy' && '🏛️'}
                              {event.type === 'expiry' && '⏰'}
                              {' '}{event.type.toUpperCase()}
                            </span>
                            <span className={`event-impact ${event.impact}`}>
                              {event.impact === 'high' && '🔥 HIGH IMPACT'}
                              {event.impact === 'medium' && '⚡ MEDIUM IMPACT'}
                              {event.impact === 'low' && '📍 LOW IMPACT'}
                            </span>
                          </div>
                          <h3 className="event-title">{event.title}</h3>
                          {event.company && <p className="event-company">{event.company}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* BUSINESS NEWS TAB */}
            {activeHomeTab === 'business-news' && (
              <div className="panel">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                  <div>
                    <h2>📰 Business News</h2>
                    <p style={{color: 'var(--text-dim)', marginTop: '0.5rem'}}>
                      Latest business, economy, and market news
                    </p>
                  </div>
                  <button className="btn-action" onClick={fetchBusinessNews} disabled={isLoadingBusinessNews}>
                    {isLoadingBusinessNews ? '⏳' : '🔄'} Refresh
                  </button>
                </div>

                {isLoadingBusinessNews && businessNews.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-dim)'}}>
                    <p>Loading business news...</p>
                  </div>
                ) : (
                  <div className="business-news-grid">
                    {businessNews.map(news => (
                      <div key={news.id} className="business-news-card">
                        {news.image && (
                          <img src={news.image} alt={news.title} className="news-image" onError={(e) => e.target.style.display = 'none'} />
                        )}
                        <div className="news-card-content">
                          <div className="news-card-header">
                            <span className="news-card-source">{news.source}</span>
                            <span className="news-card-time">{formatNewsTime(news.publishedAt)}</span>
                          </div>
                          <h3 className="news-card-title">{news.title}</h3>
                          {news.description && (
                            <p className="news-card-description">{news.description.slice(0, 150)}...</p>
                          )}
                          <a href={news.url} target="_blank" rel="noopener noreferrer" className="news-card-link">
                            Read more →
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeHomeTab === 'news' && (
              <div className="panel">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                  <h2>🎯 Intelligent News Feed</h2>
                  <span className="live-indicator">🟢 Live - Updates every 30s</span>
                </div>
                {isLoadingNews && intelligentNews.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-dim)'}}>
                    <p>Loading intelligent news analysis...</p>
                  </div>
                ) : (
                  <div className="intelligent-news-feed">
                    {intelligentNews.map(news => (
                      <div key={news.id} className="intelligent-news-card">
                        <div className="news-main-header">
                          <h3 className="intelligent-news-title">{news.title}</h3>
                          <div className="news-meta">
                            <span className="news-source">{news.source}</span>
                            <span className="news-time">{formatNewsTime(news.publishedAt)}</span>
                          </div>
                        </div>
                        <div className="news-tags">
                          <span className={`sentiment-tag ${news.analysis.sentiment}`}>
                            {news.analysis.sentiment === 'bullish' ? '🟢 BULLISH' :
                             news.analysis.sentiment === 'bearish' ? '🔴 BEARISH' : '⚪ NEUTRAL'}
                          </span>
                          <span className={`impact-tag ${news.analysis.impact}`}>
                            {news.analysis.impact === 'high' ? '🔥🔥🔥 HIGH IMPACT' :
                             news.analysis.impact === 'medium' ? '🔥🔥 MEDIUM IMPACT' : '🔥 LOW IMPACT'}
                          </span>
                          <span className="index-tag">📊 {news.analysis.affectedIndex}</span>
                        </div>
                        <div className="news-analysis-section">
                          <div className="analysis-block">
                            <h4>📊 Key Levels</h4>
                            <div className="levels-grid">
                              <div className="level-item">
                                <span className="level-label">Support:</span>
                                <span className="level-values">{news.analysis.keyLevels.support.join(', ')}</span>
                              </div>
                              <div className="level-item">
                                <span className="level-label">Resistance:</span>
                                <span className="level-values">{news.analysis.keyLevels.resistance.join(', ')}</span>
                              </div>
                            </div>
                          </div>
                          <div className="trading-idea-section">
                            <h4>💡 Trading Strategy</h4>
                            <div className="strategy-details">
                              <div className="strategy-name">{news.analysis.tradingIdea.strategy}</div>
                              <p className="strategy-reasoning">{news.analysis.tradingIdea.reasoning}</p>
                              {news.analysis.tradingIdea.strikes && (
                                <div className="strategy-strikes">
                                  {news.analysis.tradingIdea.strikes.buy && <span>Buy: {news.analysis.tradingIdea.strikes.buy}</span>}
                                  {news.analysis.tradingIdea.strikes.sell && <span>Sell: {news.analysis.tradingIdea.strikes.sell}</span>}
                                </div>
                              )}
                              <div className="strategy-metrics">
                                <span>Risk: {news.analysis.tradingIdea.risk}</span>
                                <span>Timeframe: {news.analysis.tradingIdea.timeframe}</span>
                                <span>Probability: {news.analysis.tradingIdea.probability}</span>
                              </div>
                              {news.analysis.tradingIdea.strategy !== 'Wait and Watch' && (
                                <button className="load-strategy-btn" onClick={() => loadStrategyFromNews(news.analysis.tradingIdea)}>
                                  Load Strategy in Calculator →
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {news.description && <p className="news-description">{news.description}</p>}
                        <a href={news.url} target="_blank" rel="noopener noreferrer" className="read-more-link">Read full article →</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* OI CHART TAB */}
            {activeHomeTab === 'oi-chart' && (
              <div className="panel">
                <h2>📊 Open Interest Chart</h2>
                <p style={{color: 'var(--text-dim)', marginBottom: '1.5rem'}}>CE vs PE open interest by strike. Update option chain in Scanner tab for live data.</p>
                <div className="oi-chart-container">
                  <div className="oi-chart-legend">
                    <span className="oi-legend-ce">■ Call OI (CE)</span>
                    <span className="oi-legend-pe">■ Put OI (PE)</span>
                  </div>
                  {oiChartData.map((row, idx) => (
                    <div key={idx} className="oi-chart-row">
                      <div className="oi-strike-label">{row.strike.toLocaleString()}</div>
                      <div className="oi-bars">
                        <div className="oi-bar-group">
                          <div className="oi-bar-label">{row.ceOI}K</div>
                          <div className="oi-bar ce" style={{width: `${Math.min(100, (row.ceOI / Math.max(...oiChartData.map(d => d.ceOI))) * 100)}%`}}></div>
                        </div>
                        <div className="oi-bar-group">
                          <div className="oi-bar-label">{row.peOI}K</div>
                          <div className="oi-bar pe" style={{width: `${Math.min(100, (row.peOI / Math.max(...oiChartData.map(d => d.peOI))) * 100)}%`}}></div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="oi-summary">
                    <div className="oi-summary-item">
                      <span>Total CE OI</span>
                      <span className="ce-color">{(pcrData.totalCE / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="oi-summary-item">
                      <span>Total PE OI</span>
                      <span className="pe-color">{(pcrData.totalPE / 1000).toFixed(0)}K</span>
                    </div>
                    <div className="oi-summary-item">
                      <span>PCR</span>
                      <span style={{color: pcrData.pcr > 1 ? 'var(--accent)' : '#EF4444'}}>{pcrData.pcr}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FII / DII TAB */}
            {activeHomeTab === 'fii-dii' && (
              <div className="panel">
                <h2>🏦 FII / DII Activity</h2>
                <p style={{color: 'var(--text-dim)', marginBottom: '1.5rem'}}>Institutional flow data (₹ Crores). Positive = Buying, Negative = Selling.</p>
                <div className="fii-dii-container">
                  <div className="fii-dii-summary">
                    <div className={`fii-summary-card ${fiiDiiData[0]?.fii >= 0 ? 'positive' : 'negative'}`}>
                      <span className="fii-label">FII Today</span>
                      <span className="fii-value">₹{fiiDiiData[0]?.fii?.toLocaleString()} Cr</span>
                      <span className="fii-signal">{fiiDiiData[0]?.fii >= 0 ? '📈 Buying' : '📉 Selling'}</span>
                    </div>
                    <div className={`fii-summary-card ${fiiDiiData[0]?.dii >= 0 ? 'positive' : 'negative'}`}>
                      <span className="fii-label">DII Today</span>
                      <span className="fii-value">₹{fiiDiiData[0]?.dii?.toLocaleString()} Cr</span>
                      <span className="fii-signal">{fiiDiiData[0]?.dii >= 0 ? '📈 Buying' : '📉 Selling'}</span>
                    </div>
                    <div className="fii-summary-card neutral">
                      <span className="fii-label">Net Flow</span>
                      <span className="fii-value">₹{((fiiDiiData[0]?.fii || 0) + (fiiDiiData[0]?.dii || 0)).toLocaleString()} Cr</span>
                      <span className="fii-signal">{((fiiDiiData[0]?.fii || 0) + (fiiDiiData[0]?.dii || 0)) >= 0 ? '🟢 Net Positive' : '🔴 Net Negative'}</span>
                    </div>
                  </div>
                  <table className="fii-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>FII (₹ Cr)</th>
                        <th>DII (₹ Cr)</th>
                        <th>Net</th>
                        <th>Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fiiDiiData.map((row, idx) => {
                        const net = row.fii + row.dii;
                        return (
                          <tr key={idx}>
                            <td>{row.date}</td>
                            <td className={row.fii >= 0 ? 'positive' : 'negative'}>{row.fii >= 0 ? '+' : ''}{row.fii.toLocaleString()}</td>
                            <td className={row.dii >= 0 ? 'positive' : 'negative'}>{row.dii >= 0 ? '+' : ''}{row.dii.toLocaleString()}</td>
                            <td className={net >= 0 ? 'positive' : 'negative'}>{net >= 0 ? '+' : ''}{net.toLocaleString()}</td>
                            <td>{net >= 0 ? '🟢' : '🔴'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="data-note">⚠️ Data updated manually. Live NSE feed coming soon.</p>
                </div>
              </div>
            )}

            {/* PCR METER TAB */}
            {activeHomeTab === 'pcr' && (
              <div className="panel">
                <h2>⚡ PCR Meter</h2>
                <p style={{color: 'var(--text-dim)', marginBottom: '1.5rem'}}>Put-Call Ratio measures market sentiment. Based on your Scanner option chain data.</p>
                <div className="pcr-container">
                  <div className="pcr-gauge-wrapper">
                    <div className="pcr-big-number" style={{color: pcrData.pcr > 1.2 ? 'var(--accent)' : pcrData.pcr < 0.8 ? '#EF4444' : '#F59E0B'}}>
                      {pcrData.pcr}
                    </div>
                    <div className="pcr-signal-badge" style={{background: pcrData.pcr > 1.2 ? 'rgba(16,185,129,0.2)' : pcrData.pcr < 0.8 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}}>
                      {pcrData.signal}
                    </div>
                    <div className="pcr-meter">
                      <div className="pcr-meter-bar">
                        <div className="pcr-meter-fill" style={{width: `${Math.min(100, (pcrData.pcr / 2) * 100)}%`, background: pcrData.pcr > 1.2 ? 'var(--accent)' : pcrData.pcr < 0.8 ? '#EF4444' : '#F59E0B'}}></div>
                      </div>
                      <div className="pcr-meter-labels">
                        <span>0 Bearish</span>
                        <span>1.0 Neutral</span>
                        <span>2.0 Bullish</span>
                      </div>
                    </div>
                  </div>
                  <div className="pcr-breakdown">
                    <div className="pcr-stat">
                      <span>Total CE OI</span>
                      <span className="ce-color">{pcrData.totalCE.toLocaleString()}</span>
                    </div>
                    <div className="pcr-stat">
                      <span>Total PE OI</span>
                      <span className="pe-color">{pcrData.totalPE.toLocaleString()}</span>
                    </div>
                    <div className="pcr-stat">
                      <span>PCR Ratio</span>
                      <span>{pcrData.pcr}</span>
                    </div>
                  </div>
                  <div className="pcr-legend">
                    <div className="pcr-legend-item bullish">PCR &gt; 1.3 = Bullish (Put writers confident)</div>
                    <div className="pcr-legend-item neutral">PCR 0.9 - 1.3 = Neutral</div>
                    <div className="pcr-legend-item bearish">PCR &lt; 0.9 = Bearish (Call writers confident)</div>
                  </div>
                </div>
              </div>
            )}

            {/* MAX PAIN TAB */}
            {activeHomeTab === 'max-pain' && (
              <div className="panel">
                <h2>🎯 Max Pain Calculator</h2>
                <p style={{color: 'var(--text-dim)', marginBottom: '1.5rem'}}>The strike where option writers lose the least money at expiry. Market tends to gravitate here.</p>
                <div className="maxpain-container">
                  <div className="maxpain-display">
                    <div className="maxpain-big">
                      <span className="maxpain-label">Max Pain Strike</span>
                      <span className="maxpain-value">{maxPainData.maxPain.toLocaleString()}</span>
                    </div>
                    <div className="maxpain-vs">
                      <div className="maxpain-stat">
                        <span>Current Spot</span>
                        <span>{maxPainData.currentSpot.toLocaleString()}</span>
                      </div>
                      <div className="maxpain-stat">
                        <span>Distance</span>
                        <span style={{color: '#F59E0B'}}>{Math.abs(maxPainData.currentSpot - maxPainData.maxPain)} pts</span>
                      </div>
                      <div className="maxpain-stat">
                        <span>Direction</span>
                        <span style={{color: maxPainData.currentSpot > maxPainData.maxPain ? '#EF4444' : 'var(--accent)'}}>
                          {maxPainData.currentSpot > maxPainData.maxPain ? '↓ Expect fall to Max Pain' : '↑ Expect rise to Max Pain'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="maxpain-chart">
                    {optionChainData.map((row, idx) => {
                      const isMaxPain = row.strike === maxPainData.maxPain;
                      const isSpot = Math.abs(row.strike - spot) < 100;
                      return (
                        <div key={idx} className={`maxpain-row ${isMaxPain ? 'highlight' : ''}`}>
                          <span className="maxpain-strike">
                            {row.strike.toLocaleString()}
                            {isMaxPain && <span className="maxpain-tag">🎯 MAX PAIN</span>}
                            {isSpot && <span className="spot-tag">📍 SPOT</span>}
                          </span>
                          <span className="ce-color">CE OI: {row.ceOI.toLocaleString()}</span>
                          <span className="pe-color">PE OI: {row.peOI.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="data-note">💡 Update option chain in Scanner tab for accurate Max Pain calculation.</p>
                </div>
              </div>
            )}

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
        ) : null}

        <div className="disclaimer">
          <strong>⚠️ Disclaimer:</strong> This calculator is for educational purposes only. 
          Options trading involves substantial risk. Results are theoretical estimates. 
          Always consult a SEBI-registered advisor before trading.
        </div>
      </div>
    </div>
  );
}

export default App;