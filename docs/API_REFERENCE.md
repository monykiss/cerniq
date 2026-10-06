# CERNIQ API Reference

> **Version:** 2.0.0
> **Base URL:** `http://localhost:3000/api`
> **Auth:** Bearer token via `Authorization` header (obtain from `POST /api/auth/login`)
> **Admin:** `x-admin-key` header for admin endpoints

---

## 🏦 ALM API (Core Product)

### Create Institution
```http
POST /api/alm/institutions
Authorization: Bearer <token>
```

**Body:**
```json
{
  "name": "CoopAhorro San Juan",
  "type": "cooperativa",
  "totalAssets": 250000000,
  "currency": "USD",
  "regulatoryBody": "COSSEC"
}
```

### List Institutions
```http
GET /api/alm/institutions
Authorization: Bearer <token>
```

### Upload Balance Sheet CSV
```http
POST /api/alm/institutions/:institutionId/upload-csv
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| Field | Type | Description |
|-------|------|-------------|
| file | File | CSV file with balance sheet data (bilingual headers supported) |
| framework | string | `cossec` or `ncua` |
| analysisPeriod | string | e.g. `Q1-2026` |

### Run Full ALM Analysis
```http
POST /api/alm/analysis/run
Authorization: Bearer <token>
```

**Body:**
```json
{
  "institutionId": "<uuid>"
}
```

**Response:** Full analysis results including duration gap, NII sensitivity, EVE, LCR/NSFR, stress testing, and COSSEC compliance scores.

### Get ALM Summary
```http
GET /api/alm/institutions/:institutionId/summary
Authorization: Bearer <token>
```

### Duration Gap (Stateless)
```http
POST /api/alm/duration-gap
Authorization: Bearer <token>
```

**Body:** (wrapped in `balanceSheet` with required `equity`)
```json
{
  "balanceSheet": {
    "assets": [
      { "balance": 100000000, "rate": 0.065, "maturityYears": 5, "isFixed": true }
    ],
    "liabilities": [
      { "balance": 80000000, "rate": 0.025, "maturityYears": 1, "isFixed": false }
    ],
    "equity": 20000000
  }
}
```

### NII Sensitivity
```http
POST /api/alm/nii-sensitivity
Authorization: Bearer <token>
```

### Liquidity Coverage Ratio
```http
GET /api/alm/institutions/:institutionId/liquidity
Authorization: Bearer <token>
```

### Stress Testing (Monte Carlo)
```http
POST /api/alm/institutions/:institutionId/stress-test
Authorization: Bearer <token>
```

### Generate PDF Report
```http
POST /api/alm/institutions/:institutionId/report?lang=en
Authorization: Bearer <token>
```

Returns bilingual (EN/ES) PDF report. Pass `lang=es` for Spanish-first.

---

## 🔐 Auth API

### Register
```http
POST /api/auth/register
```

**Body:**
```json
{ "email": "user@example.com", "password": "SecurePass123!", "name": "User Name" }
```

### Login
```http
POST /api/auth/login
```

**Body:**
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```

**Response:** Sets `access_token` and `refresh_token` as HttpOnly cookies.

### Refresh Token
```http
POST /api/auth/refresh
```

### Logout
```http
POST /api/auth/logout
```

### OAuth
```http
GET /api/auth/google          # Initiates Google OAuth
GET /api/auth/github          # Initiates GitHub OAuth
```

---

## 💳 Billing API

### Create Checkout Session
```http
POST /api/billing/checkout
Authorization: Bearer <token>
```

**Body:**
```json
{
  "tier": "monthly",
  "customerEmail": "cfo@cooperativa-pr.example",
  "customerName": "Ana Rivera",
  "institutionName": "CoopAhorro San Juan",
  "successUrl": "/portal",
  "cancelUrl": "/pricing"
}
```

**Tiers:** `one_time`, `monthly`, `annual`, `partner` (prices are configured as Stripe price IDs via environment variables)

### Get Subscription
```http
GET /api/billing/subscription
Authorization: Bearer <token>
```

### Webhook (Stripe)
```http
POST /api/billing/webhook
stripe-signature: <sig>
```

Handles: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`, `charge.dispute.created`. Idempotent (duplicate events are skipped).

---

## 📊 Market Data API

### Get Quote
```http
GET /api/market-data/quote/:ticker
```

**Response:**
```json
{
  "symbol": "AAPL",
  "price": 175.50,
  "change": 2.35,
  "changePercent": 1.36,
  "volume": 45678900,
  "marketCap": 2850000000000
}
```

### Get Historical Prices
```http
GET /api/market-data/historical/:ticker?startDate=2023-01-01&endDate=2023-12-31
```

---

## 📈 Charts API

### Get Technical Data
```http
GET /api/charts/technical/:ticker
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| timeframe | string | 1M | 1D, 1W, 1M, 3M, 1Y, ALL |
| indicators | string | sma20,sma50,rsi,macd | Comma-separated list |

**Available Indicators:**
- `sma20`, `sma50`, `sma200` - Simple Moving Averages
- `ema12`, `ema26` - Exponential Moving Averages
- `rsi` - Relative Strength Index (14-period)
- `macd` - MACD (12/26/9)
- `bollinger` - Bollinger Bands (20-period, 2σ)

**Response:**
```json
{
  "ticker": "AAPL",
  "timeframe": "1M",
  "ohlcv": [
    { "date": "2023-01-01", "open": 170, "high": 172, "low": 169, "close": 171, "volume": 45000000 }
  ],
  "indicators": {
    "sma20": [null, null, ..., 170.5],
    "rsi": [null, ..., 58.3],
    "macd": { "macd": [], "signal": [], "histogram": [] }
  }
}
```

### Get OHLCV Data
```http
GET /api/charts/ohlcv/:ticker?timeframe=1M
```

---

## ⚠️ Risk API

### Calculate Component VaR
```http
POST /api/risk/component-var
```

**Request:**
```json
{
  "positions": [
    { "ticker": "AAPL", "quantity": 100, "price": 175 },
    { "ticker": "GOOGL", "quantity": 50, "price": 140 }
  ],
  "confidenceLevel": 0.95,
  "horizon": 1
}
```

**Response:**
```json
{
  "portfolioVaR": 2450.50,
  "portfolioValue": 24500,
  "confidenceLevel": 0.95,
  "horizon": 1,
  "components": [
    {
      "ticker": "AAPL",
      "value": 17500,
      "weight": 0.714,
      "marginalVaR": 120.50,
      "componentVaR": 1750.30,
      "contributionPercent": 71.5
    }
  ]
}
```

### Forecast Volatility (GARCH)
```http
GET /api/risk/forecast-volatility/:ticker?horizon=30
```

**Response:**
```json
{
  "ticker": "AAPL",
  "horizon": 30,
  "model": { "omega": 0.00001, "alpha": 0.09, "beta": 0.88 },
  "forecast": [
    { "day": 1, "volatility": 0.0185, "confidenceLower": 0.0150, "confidenceUpper": 0.0220 }
  ]
}
```

### Calculate Parametric VaR
```http
POST /api/risk/parametric-var
```

### Calculate Correlation Matrix
```http
POST /api/risk/correlation
```

**Request:**
```json
{ "tickers": ["AAPL", "GOOGL", "MSFT"] }
```

**Response:**
```json
{
  "tickers": ["AAPL", "GOOGL", "MSFT"],
  "matrix": [
    [1.0, 0.65, 0.72],
    [0.65, 1.0, 0.68],
    [0.72, 0.68, 1.0]
  ]
}
```

### Monte Carlo VaR
```http
POST /api/risk/monte-carlo
```

---

## 🎯 Options API

### Calculate Greeks
```http
POST /api/options/greeks
```

**Request:**
```json
{
  "underlying": 175,
  "strike": 180,
  "timeToExpiry": 0.25,
  "riskFreeRate": 0.05,
  "volatility": 0.25,
  "optionType": "CALL"
}
```

**Response:**
```json
{
  "price": 5.42,
  "delta": 0.42,
  "gamma": 0.025,
  "theta": -0.045,
  "vega": 0.28,
  "rho": 0.18
}
```

### Get Volatility Surface
```http
GET /api/options/volatility-surface/:ticker
```

### Calculate Implied Volatility
```http
POST /api/options/implied-volatility
```

---

## 📊 Execution API

### Analyze Slippage
```http
POST /api/execution/slippage
```

**Request:**
```json
{
  "ticker": "AAPL",
  "executionPrice": 175.10,
  "executionTime": "2023-06-15T10:30:00Z",
  "side": "BUY",
  "quantity": 100
}
```

**Response:**
```json
{
  "ticker": "AAPL",
  "executionPrice": 175.10,
  "midPrice": 175.00,
  "slippageBps": 5.71,
  "slippageCost": 10.00,
  "quality": "GOOD",
  "spreadBps": 2.86
}
```

Quality ratings: `EXCELLENT`, `GOOD`, `FAIR`, `POOR`

### Analyze vs VWAP
```http
POST /api/execution/vwap?period=60
```

### Generate Best Execution Report
```http
POST /api/execution/best-execution-report
```

**Request:**
```json
{
  "executions": [...],
  "startDate": "2023-01-01",
  "endDate": "2023-12-31"
}
```

### Calculate Implementation Shortfall
```http
POST /api/execution/implementation-shortfall
```

### Run Backtest
```http
POST /api/execution/backtest
```

**Request:**
```json
{
  "strategy": {
    "name": "SMA Crossover",
    "type": "SMA_CROSSOVER",
    "lookbackPeriod": 30,
    "params": { "shortPeriod": 10, "longPeriod": 20 }
  },
  "tickers": ["AAPL", "GOOGL"],
  "startDate": "2023-01-01",
  "endDate": "2023-12-31",
  "initialCapital": 100000,
  "commission": 5
}
```

**Response:**
```json
{
  "strategyName": "SMA Crossover",
  "initialCapital": 100000,
  "finalValue": 112500,
  "metrics": {
    "totalReturn": 12.5,
    "sharpeRatio": 1.45,
    "maxDrawdown": 8.5,
    "winRate": 58.3,
    "profitFactor": 1.85,
    "totalTrades": 24
  },
  "trades": [...],
  "equityCurve": [...]
}
```

### Get Available Strategies
```http
GET /api/execution/strategies
```

---

## 🔴 WebSocket API

**Namespace:** `/market-data`

### Subscribe to Live Prices
```javascript
socket.emit('subscribe-ticker', { ticker: 'AAPL' });
socket.on('price-update', (data) => console.log(data));
// { ticker: 'AAPL', price: 175.50, change: 1.5, volume: 1234567 }
```

### Subscribe to Live Greeks
```javascript
socket.emit('subscribe-greeks', { 
  underlying: 175, strike: 180, expiry: '2024-03-15', type: 'CALL' 
});
socket.on('greeks-update', (data) => console.log(data));
```

### Subscribe to Portfolio P&L
```javascript
socket.emit('subscribe-portfolio-pnl', { 
  positions: [{ ticker: 'AAPL', quantity: 100, avgCost: 170 }] 
});
socket.on('portfolio-pnl-update', (data) => console.log(data));
```

---

## 🚨 Error Responses

```json
{
  "statusCode": 400,
  "message": "Invalid ticker format",
  "error": "Bad Request"
}
```

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid parameters |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## 🔧 Rate Limits

| Endpoint Type | Limit |
|---------------|-------|
| Market Data | 100 req/min |
| Risk Calculations | 30 req/min |
| Backtests | 10 req/min |
| WebSocket | 5 subscriptions/connection |
