/**
 * DeltaBuddy — Dev Proxy
 * Place at: src/setupProxy.js  then RESTART npm start
 *
 * Routes:
 *   /yahoo  →  Yahoo Finance   (chart, ticker prices)
 *   /groq   →  Groq AI         (news intelligence)
 *   /nse    →  NSE India       (option chain — real NSE data with cookie handling)
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

// NSE requires a 2-step cookie fetch — we cache it here
let nseCookies = '';
let nseLastFetch = 0;

const getNSECookies = async () => {
  const now = Date.now();
  if (nseCookies && (now - nseLastFetch) < 5 * 60 * 1000) return nseCookies; // 5min cache
  try {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const res = await fetch('https://www.nseindia.com', {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      nseCookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
      nseLastFetch = now;
    }
  } catch(e) {
    console.warn('[NSE Cookie Fetch Failed]', e.message);
  }
  return nseCookies;
};

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/option-chain',
  'X-Requested-With': 'XMLHttpRequest',
};

module.exports = function (app) {

  // NSE Option Chain — custom handler with cookie support
  app.get('/nse/option-chain', async (req, res) => {
    const symbol = req.query.symbol || 'NIFTY';
    const isIndex = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYIT'].includes(symbol);
    const apiPath = isIndex
      ? `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`
      : `https://www.nseindia.com/api/option-chain-equities?symbol=${symbol}`;
    try {
      const cookies = await getNSECookies();
      const response = await fetch(apiPath, {
        headers: { ...NSE_HEADERS, Cookie: cookies },
      });
      if (!response.ok) throw new Error(`NSE returned ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch(err) {
      console.error('[NSE Option Chain Error]', err.message);
      res.status(502).json({ error: 'NSE fetch failed', detail: err.message });
    }
  });

  // Yahoo Finance — chart + global prices
  app.use('/yahoo', createProxyMiddleware({
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    pathRewrite: { '^/yahoo': '' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
    on: { error: (err,req,res) => { res.writeHead(502).end(JSON.stringify({error:err.message})); } },
  }));

  // Groq AI
  app.use('/groq', createProxyMiddleware({
    target: 'https://api.groq.com',
    changeOrigin: true,
    pathRewrite: { '^/groq': '' },
    on: { error: (err,req,res) => { res.writeHead(502).end(JSON.stringify({error:err.message})); } },
  }));

};
