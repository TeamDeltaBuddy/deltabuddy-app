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

function App() {
  const [activeTab, setActiveTab] = useState('single');
  
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

  useEffect(() => {
    const saved = localStorage.getItem('deltabuddy-strategies');
    if (saved) {
      setSavedStrategies(JSON.parse(saved));
    }
  }, []);

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
            <span>Market Intel</span>
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

        {activeTab === 'single' ? (
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
        ) : (
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
        )}

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