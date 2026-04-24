# BlockTrade Enhanced API Reference

## 📡 API Overview

All API endpoints are prefixed with `/api/` and require authentication via JWT token in headers.

### Authentication Header
```
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

---

## 🛒 Trading Endpoints

### Execute Trade (POST)
Execute a new buy/sell trade with optional trade type specification.

**Endpoint:** `POST /api/trades`

**Request Body:**
```json
{
  "type": "buy|sell",           // REQUIRED: Trade side
  "symbol": "RELIANCE",          // REQUIRED: Stock symbol
  "quantity": 10,                // REQUIRED: Number of shares
  "price": 1250.50,              // REQUIRED: Execution price
  "orderType": "market|limit",   // REQUIRED: Order type (market or limit)
  "tradeType": "intraday|delivery" // NEW: Trade duration mode
}
```

**Response:**
```json
{
  "trade": {
    "id": "uuid",
    "type": "buy",
    "symbol": "RELIANCE",
    "quantity": 10,
    "price": 1250.50,
    "tradeType": "intraday",
    "timestamp": "2026-04-24T10:30:00Z",
    "blockHash": "0x...",
    "blockIndex": 42
  },
  "block": {
    "index": 42,
    "hash": "0x...",
    "timestamp": "2026-04-24T10:30:00Z"
  }
}
```

**Error Responses:**
```json
// Insufficient balance
{
  "error": "Insufficient balance for this trade"
}

// Invalid quantity
{
  "error": "Invalid quantity"
}

// Position limit exceeded
{
  "error": "SEBI position limit: Max 90% of portfolio in single stock"
}

// Intraday outside market hours
{
  "error": "Intraday trades can only be placed during market hours (9:15 AM - 3:30 PM)"
}

// Insufficient holdings for sell
{
  "error": "Cannot sell 15 shares. You hold only 10 shares."
}
```

---

### Fetch All Trades (GET)
Retrieve all executed trades for the authenticated user.

**Endpoint:** `GET /api/trades`

**Query Parameters:**
| Parameter | Type | Optional | Description |
|-----------|------|----------|-------------|
| symbol | string | Yes | Filter by specific symbol |
| type | string | Yes | Filter by "buy" or "sell" |
| tradeType | string | Yes | Filter by "intraday" or "delivery" |

**Example Requests:**
```
GET /api/trades                           // All trades
GET /api/trades?symbol=RELIANCE           // RELIANCE trades only
GET /api/trades?type=buy                  // Buy trades only
GET /api/trades?tradeType=intraday        // Intraday trades only
GET /api/trades?symbol=TCS&type=sell      // Sell TCS trades only
```

**Response:**
```json
{
  "trades": [
    {
      "id": "uuid-1",
      "type": "buy",
      "symbol": "RELIANCE",
      "quantity": 10,
      "price": 1250.50,
      "tradeType": "intraday",
      "timestamp": "2026-04-24T10:30:00Z",
      "blockHash": "0x123..."
    },
    {
      "id": "uuid-2",
      "type": "sell",
      "symbol": "RELIANCE",
      "quantity": 5,
      "price": 1260.00,
      "tradeType": "intraday",
      "timestamp": "2026-04-24T14:00:00Z",
      "blockHash": "0x456..."
    }
  ],
  "count": 2,
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

## 📊 Market Data Endpoints

### Get Quotes (GET)
Fetch real-time quotes for multiple symbols.

**Endpoint:** `GET /api/market/quotes`

**Query Parameters:**
```
symbols=RELIANCE,TCS,HDFCBANK  // Comma-separated symbols
```

**Response:**
```json
{
  "data": [
    {
      "symbol": "RELIANCE",
      "yahooSymbol": "RELIANCE.NS",
      "shortName": "Reliance Industries",
      "price": 1250.50,
      "change": 5.50,           // ₹ change from previous close
      "changePercent": 0.44,    // % change from previous close
      "volume": 15000000,
      "previousClose": 1245.00
    },
    {
      "symbol": "TCS",
      "yahooSymbol": "TCS.NS",
      "shortName": "Tata Consultancy Services",
      "price": 3500.25,
      "change": -10.75,
      "changePercent": -0.31,
      "volume": 5000000,
      "previousClose": 3511.00
    }
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

### Get Candle Data (GET)
Fetch OHLCV (Open-High-Low-Close-Volume) data for charting.

**Endpoint:** `GET /api/market/candles`

**Query Parameters:**
| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| symbol | string | - | Stock symbol (REQUIRED) |
| range | string | 1d, 5d, 1mo, 3mo, 6mo, 1y, 5y, max | Time range (REQUIRED) |
| interval | string | 1m, 5m, 15m, 1h, 1d, 1wk | Candle interval (OPTIONAL) |

**Example Requests:**
```
GET /api/market/candles?symbol=RELIANCE&range=1d&interval=1m      // 1-min candles for 1 day
GET /api/market/candles?symbol=TCS&range=1mo&interval=1h          // 1-hour candles for 1 month
GET /api/market/candles?symbol=INFY&range=1y&interval=1d          // Daily candles for 1 year
```

**Response:**
```json
{
  "data": [
    {
      "time": 1713960600,      // Unix timestamp
      "open": 1245.00,
      "high": 1258.50,
      "low": 1240.00,
      "close": 1250.50,
      "volume": 2500000
    },
    {
      "time": 1713961500,
      "open": 1250.50,
      "high": 1265.00,
      "low": 1248.00,
      "close": 1260.00,
      "volume": 3000000
    }
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

**Supported Ranges & Default Intervals:**
```
1d    → 1m   (1-minute candles)
5d    → 15m  (15-minute candles)
1mo   → 1h   (1-hour candles)
3mo   → 1d   (daily candles)
6mo   → 1d   (daily candles)
1y    → 1wk  (weekly candles)
5y    → 1mo  (monthly candles)
max   → 1mo  (monthly candles)
```

---

### Get Market Movers (GET)
Fetch top gaining and losing stocks.

**Endpoint:** `GET /api/market/movers`

**Response:**
```json
{
  "gainers": [
    {
      "symbol": "RELIANCE",
      "price": 1250.50,
      "change": 5.50,
      "changePercent": 0.44
    }
  ],
  "losers": [
    {
      "symbol": "TCS",
      "price": 3500.25,
      "change": -10.75,
      "changePercent": -0.31
    }
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

### Search Stocks (GET)
Search for stocks by symbol or company name.

**Endpoint:** `GET /api/market/search`

**Query Parameters:**
```
q=RELIANCE  // Search query (REQUIRED)
```

**Response:**
```json
{
  "results": [
    {
      "symbol": "RELIANCE",
      "name": "Reliance Industries",
      "exchange": "NSE",
      "price": 1250.50,
      "changePercent": 0.44
    },
    {
      "symbol": "RELIANCERETAIL",
      "name": "Reliance Retail",
      "exchange": "NSE",
      "price": 650.25,
      "changePercent": -0.15
    }
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

## 📈 Option Chain Endpoints

### Get Option Chain (GET)
Fetch option chain data for a specific underlying and expiry with real Greeks.

**Endpoint:** `GET /api/options/chain`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| symbol | string | Index/stock symbol: ^NSEI, ^NSEBANK, etc. (REQUIRED) |
| expiry | string | Expiry date in YYYY-MM-DD format (OPTIONAL) |

**Example Requests:**
```
GET /api/options/chain?symbol=^NSEI                          // Latest NIFTY expiry
GET /api/options/chain?symbol=^NSEI&expiry=2026-04-24       // Specific expiry
GET /api/options/chain?symbol=^NSEBANK&expiry=2026-05-02    // Bank Nifty specific
```

**Response:**
```json
{
  "symbol": "^NSEI",
  "spotPrice": 22847,                 // ATM spot price
  "prevClose": 22800,
  "syntheticFutures": 22847,          // Futures equivalent price
  "lotSize": 50,                      // Contracts per lot
  "pcr": 0.82,                        // Put-Call Ratio
  "maxPain": 22800,                   // Max pain level
  "totalVolume": 5000000,
  "exchange": "NSE",
  "expiry": "2026-04-24",
  "expiries": [                       // Available expiry dates
    "2026-04-24",
    "2026-05-02",
    "2026-05-09"
  ],
  "source": "dhan-api",               // ✅ Data source
  "chain": [
    {
      "strike": 22600,
      "atm": false,                   // Is this ATM strike?
      "itm": {
        "call": false,                // Call ITM status
        "put": true                   // Put ITM status
      },
      "call": {
        "ltp": 485.00,                // Last traded price
        "bid": 483.50,
        "ask": 486.50,
        "oi": 1250000,                // Open Interest
        "oiChange": 50000,            // OI change from prev day
        "volume": 250000,
        "change": 10.00,              // Absolute change
        "changePct": 2.10,            // ✅ % change
        "iv": 18.5,                   // Implied Volatility
        "delta": 0.85,                // ✅ Greeks
        "gamma": 0.0012,
        "theta": -0.45,
        "vega": 0.25
      },
      "put": {
        "ltp": 147.00,
        "bid": 145.50,
        "ask": 148.50,
        "oi": 850000,
        "oiChange": -25000,
        "volume": 180000,
        "change": 4.50,
        "changePct": 3.15,            // ✅ % change
        "iv": 18.2,
        "delta": -0.15,               // ✅ Greeks
        "gamma": 0.0012,
        "theta": -0.25,
        "vega": 0.24
      }
    },
    // ... more strikes
    {
      "strike": 22800,                // ATM strike
      "atm": true,                    // ⭐ Highlighted
      "itm": {
        "call": false,
        "put": false
      },
      "call": {
        "ltp": 256.00,
        "bid": 254.50,
        "ask": 257.50,
        "oi": 3500000,
        "oiChange": 200000,
        "volume": 850000,
        "change": 6.20,
        "changePct": 2.47,            // ✅ Highest volume ATM
        "iv": 19.2,
        "delta": 0.50,
        "gamma": 0.0018,
        "theta": -0.65,
        "vega": 0.35
      },
      "put": {
        "ltp": 147.00,
        "bid": 145.50,
        "ask": 148.50,
        "oi": 2900000,
        "oiChange": 150000,
        "volume": 750000,
        "change": 7.10,
        "changePct": 5.07,            // ✅ Highest volume ATM
        "iv": 19.0,
        "delta": -0.50,
        "gamma": 0.0018,
        "theta": -0.60,
        "vega": 0.34
      }
    }
    // ... more strikes (usually 15-20 total)
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

**Greeks Explanation:**
```
Δ (Delta):    0 to 1 for calls, -1 to 0 for puts
              Rate of premium change per ₹1 move in underlying
              0.5 = 50% probability of finishing ITM

Γ (Gamma):    0 to 1 (usually small decimals)
              Rate of delta change
              Highest at ATM, lower at extremes

Θ (Theta):    Usually negative (time decay)
              How much premium loses per day
              More negative near expiry

ν (Vega):     Usually positive for long positions
              How much premium gains per 1% IV increase

σ (IV):       0-100+ percentage
              Market's expectation of volatility
```

---

### Get Option Expiries (GET)
Fetch available expiry dates for option contracts.

**Endpoint:** `GET /api/options/expiries`

**Response:**
```json
{
  "expiries": [
    "2026-04-24",
    "2026-05-02",
    "2026-05-09",
    "2026-06-06"
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

## ✅ SEBI Compliance Endpoints

### Get SEBI Rules (GET)
Fetch current SEBI compliance rules and limits.

**Endpoint:** `GET /api/sebi/rules`

**Response:**
```json
{
  "positionLimit": {
    "maxConcentration": 0.90,    // 90% max per stock
    "description": "Maximum 90% of portfolio in single stock"
  },
  "marketHours": {
    "preOpen": "09:00-09:15",
    "open": "09:15-15:30",
    "postMarket": "15:30-16:00",
    "closed": "16:00-09:00"
  },
  "circuitBreaker": [
    { "level": "5%",  "halt": "15 minutes" },
    { "level": "10%", "halt": "45 minutes" },
    { "level": "20%", "halt": "Rest of day" }
  ],
  "tradingMode": {
    "intraday": "Must close before 15:30 (3:30 PM)",
    "delivery": "Can hold multiple days"
  },
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

## 🔐 Authentication Endpoints

### Login (POST)
Authenticate user and get JWT token.

**Endpoint:** `POST /api/auth/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Trader",
    "balance": 100000,
    "initialBalance": 100000
  },
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

## 📋 Common Response Formats

### Success Response
```json
{
  "data": {...},
  "timestamp": "2026-04-24T14:05:00Z"
}
```

### Error Response
```json
{
  "error": "Error message describing what went wrong",
  "code": "ERROR_CODE",
  "timestamp": "2026-04-24T14:05:00Z"
}
```

### Validation Error Response
```json
{
  "errors": [
    {
      "field": "quantity",
      "message": "Quantity must be greater than 0"
    },
    {
      "field": "tradeType",
      "message": "Trade type must be 'intraday' or 'delivery'"
    }
  ],
  "timestamp": "2026-04-24T14:05:00Z"
}
```

---

## 🚀 Integration Examples

### Example 1: Place Intraday Trade
```javascript
const trade = await fetch('/api/trades', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    type: 'buy',
    symbol: 'RELIANCE',
    quantity: 10,
    price: 1250.50,
    orderType: 'market',
    tradeType: 'intraday'  // ✅ New parameter
  })
});
```

### Example 2: Fetch Option Chain with Greeks
```javascript
const optionChain = await fetch(
  '/api/options/chain?symbol=^NSEI&expiry=2026-04-24',
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
).then(r => r.json());

// Display Greeks
optionChain.chain.forEach(strike => {
  console.log(`Strike ${strike.strike}:`);
  console.log(`  Call: ${strike.call.ltp} (Δ${strike.call.delta}, Γ${strike.call.gamma})`);
  console.log(`  Put:  ${strike.put.ltp} (Δ${strike.put.delta}, Γ${strike.put.gamma})`);
});
```

### Example 3: Get Chart Data for Entry Analysis
```javascript
const candles = await fetch(
  '/api/market/candles?symbol=RELIANCE&range=1d&interval=1m',
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
).then(r => r.json());

// Display on chart
const lastCandle = candles[candles.length - 1];
console.log(`Current: ${lastCandle.close}, Entry: 1250.50, PnL: ${lastCandle.close - 1250.50}`);
```

---

## 📞 API Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| /market/quotes | 60 | 1 minute |
| /market/candles | 30 | 1 minute |
| /options/chain | 20 | 1 minute |
| /trades | 100 | 1 minute |

---

## 🔄 Data Freshness

| Source | Update Frequency |
|--------|------------------|
| Market Quotes | Real-time (5-10 sec) |
| Candle Data | Every minute |
| Option Chain | Every 2-5 seconds |
| Greeks | Every 5-10 seconds |
| Trade Execution | Instant |

---

**API Version:** 2.0
**Last Updated:** April 24, 2026
**Status:** ✅ Production Ready
