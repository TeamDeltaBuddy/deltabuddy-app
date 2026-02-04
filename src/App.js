import React, { useState } from 'react';
import './App.css';

// Black-Scholes calculations
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

function App() {
  const [spot, setSpot] = useState(23500);
  const [strike, setStrike] = useState(23500);
  const [premium, setPremium] = useState(150);
  const [lotSize, setLotSize] = useState(25);
  const [daysToExpiry, setDaysToExpiry] = useState(7);
  const [volatility, setVolatility] = useState(15);
  const [optionType, setOptionType] = useState('call');
  const [positionType, setPositionType] = useState('buy');
  const [showGreeks, setShowGreeks] = useState(false);

  // Calculate Greeks
  const timeToExpiry = daysToExpiry / 365;
  const riskFreeRate = 0.065; // 6.5% RBI rate
  const greeks = calculateBlackScholes(spot, strike, timeToExpiry, volatility / 100, riskFreeRate, optionType);

  // Calculate P&L at different spot prices
  const calculatePL = (currentSpot) => {
    let intrinsicValue = 0;
    if (optionType === 'call') {
      intrinsicValue = Math.max(0, currentSpot - strike);
    } else {
      intrinsicValue = Math.max(0, strike - currentSpot);
    }
    
    const currentValue = intrinsicValue;
    const costBasis = premium;
    
    if (positionType === 'buy') {
      return (currentValue - costBasis) * lotSize;
    } else {
      return (costBasis - currentValue) * lotSize;
    }
  };

  // Generate P&L data for chart
  const generatePLData = () => {
    const data = [];
    const range = strike * 0.15; // 15% range
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
  const maxProfit = positionType === 'buy' 
    ? (optionType === 'call' ? 'Unlimited' : `₹${((strike - (strike * 0.5) - premium) * lotSize).toLocaleString()}`)
    : `₹${(premium * lotSize).toLocaleString()}`;
  const maxLoss = positionType === 'buy' 
    ? `₹${(premium * lotSize).toLocaleString()}`
    : 'Unlimited';

  // Find gamma blast zone (highest gamma area)
  const gammaBlastZone = {
    center: strike,
    range: strike * (volatility / 100) * Math.sqrt(timeToExpiry)
  };

  return (
    <div className="App">
      {/* Navigation */}
      <nav className="navbar">
        <div className="container">
          <div className="logo">
            <span className="delta">Δ</span>
            <span>DeltaBuddy</span>
          </div>
          <div className="nav-links">
            <span className="active">Calculator</span>
            <span>Strategies</span>
            <span>Market Intel</span>
            <span className="premium-badge">Premium</span>
          </div>
        </div>
      </nav>

      <div className="container main-content">
        <div className="page-header">
          <h1>Options Calculator</h1>
          <p className="subtitle">Analyze your options positions with Greeks and P&L visualization</p>
        </div>

        <div className="calculator-grid">
          {/* Left Panel - Inputs */}
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

          {/* Right Panel - Results */}
          <div className="results-panel">
            {/* P&L Summary */}
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
            </div>

            {/* Gamma Blast Zone */}
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

            {/* P&L Chart */}
            <div className="panel">
              <h2>P&L at Expiry</h2>
              <div className="chart-container">
                <svg viewBox="0 0 600 300" className="pl-chart">
                  {/* Grid lines */}
                  <line x1="50" y1="150" x2="550" y2="150" stroke="#334155" strokeWidth="2" />
                  <line x1="300" y1="20" x2="300" y2="280" stroke="#334155" strokeWidth="1" strokeDasharray="5,5" />
                  
                  {/* P&L Line */}
                  <polyline
                    points={plData.map((d, i) => {
                      const x = 50 + (i / plData.length) * 500;
                      const y = 150 - (d.pl / (Math.abs(premium) * lotSize * 3)) * 130;
                      return `${x},${Math.max(20, Math.min(280, y))}`;
                    }).join(' ')}
                    fill="none"
                    stroke={positionType === 'buy' ? '#10B981' : '#EF4444'}
                    strokeWidth="3"
                  />
                  
                  {/* Profit zone */}
                  <rect x="50" y="20" width="500" height="130" fill="rgba(16, 185, 129, 0.1)" />
                  <rect x="50" y="150" width="500" height="130" fill="rgba(239, 68, 68, 0.1)" />
                  
                  {/* Labels */}
                  <text x="300" y="15" textAnchor="middle" fill="#10B981" fontSize="12" fontWeight="bold">
                    Profit Zone
                  </text>
                  <text x="300" y="295" textAnchor="middle" fill="#EF4444" fontSize="12" fontWeight="bold">
                    Loss Zone
                  </text>
                  
                  {/* Strike line */}
                  <line x1="300" y1="20" x2="300" y2="280" stroke="#F59E0B" strokeWidth="2" />
                  <text x="305" y="150" fill="#F59E0B" fontSize="12" fontWeight="bold">Strike</text>
                </svg>
              </div>
            </div>

            {/* Greeks Panel */}
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

        {/* Disclaimer */}
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
