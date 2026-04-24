# BlockTrade Enhanced Platform - Quick Start Guide

## 🚀 Getting Started

### Prerequisites
```bash
Node.js 14+ installed
npm or yarn package manager
Modern web browser (Chrome recommended)
```

### Installation & Setup

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install

# 2. Start the server
cd server
npm start
# Server runs on http://localhost:5000

# 3. Start the client (new terminal)
cd client
npm run dev
# Client runs on http://localhost:5173
```

---

## 📊 Feature Testing Guide

### 1️⃣ Test Enhanced Trade Page

#### Step 1: Navigate to Trading Page
1. Open the app: `http://localhost:5173`
2. Click on "Trading" or "Trade" in the sidebar
3. You should see the new interface

#### Step 2: View Chart Integration
```
✅ Check for:
- Candlestick chart on the right side
- Chart shows last 50 candles
- Chart updates in real-time
- Entry price and P&L display box (if you have a position)
```

#### Step 3: Test Trade Type Selection
1. Look for **"Trade Type"** section
2. You should see two buttons:
   - **Intraday** (with clock icon ⏰)
   - **Delivery** (with calendar icon 📅)
3. Click each to toggle between them
4. Note the helper text changes

#### Step 4: Place a Test Trade
1. Select a symbol (e.g., RELIANCE)
2. Choose Buy/Sell
3. Select **Intraday** mode
4. Set quantity and order type
5. Click **BUY/SELL** button
6. Expected result: ✅ Trade executes successfully

#### Step 5: View Entry Analysis
1. After placing a buy trade
2. Look at the chart section
3. Should show:
   - Entry Price: ₹[amount]
   - Current P&L: [±%] ([±₹amount])
4. Chart candles should display

---

### 2️⃣ Test Option Chain with % Changes

#### Step 1: Navigate to Option Chain
1. Click "Option Chain" in the sidebar
2. Default shows NIFTY option chain

#### Step 2: Verify % Change Display
```
✅ Check for:
- Call column shows LTP with % change
  Example: "485" with "+2.1%" below (green with up arrow ↑)
- Put column shows LTP with % change
  Example: "147" with "+3.2%" below (green with up arrow ↑)
- Red downward arrows ↓ for negative changes
```

#### Step 3: Switch View Modes
1. At the bottom, you'll see three tabs:
   - **LTP & OI** (default) - Shows price and % change ✅
   - **Greeks** - Shows Delta, Gamma, Theta, Vega, IV
   - **Per Lot** - Shows value per contract

2. Click each tab to verify:
   ```
   Greeks View Expected:
   ├─ IV (Implied Volatility) %
   ├─ Δ Delta (0 to 1)
   ├─ Γ Gamma (small decimal)
   ├─ Θ Theta (theta decay, usually negative)
   └─ ν Vega (volatility sensitivity)
   ```

#### Step 4: Check ATM Strike Highlighting
1. Look for the **Strike Price** column in the middle
2. One strike should be highlighted in **yellow/golden** color
3. This is the ATM (At The Money) strike

#### Step 5: Try Different Expiries
1. At the top, you'll see an **"Expiry"** dropdown
2. Select a different expiry date
3. Chart data should refresh
4. Verify % changes are different for each expiry

---

### 3️⃣ Test SEBI Validation Rules

#### Test Case 1: Insufficient Balance
1. Try to buy a very expensive stock (e.g., 10,000 shares)
2. Total value exceeds your available balance
3. **Expected Error:** "Insufficient balance for this trade"

#### Test Case 2: Insufficient Holdings for Sell
1. Click "SELL"
2. Enter quantity > than your holding
3. **Expected Error:** "Cannot sell [X] shares. You hold only [Y] shares."

#### Test Case 3: Intraday Outside Market Hours
1. Set Trade Type to **Intraday**
2. Try to place order during non-market hours (after 3:30 PM)
3. **Expected Error:** "Intraday trades can only be placed during market hours"

#### Test Case 4: Invalid Quantity
1. Enter quantity as 0 or negative
2. **Expected Error:** "Invalid quantity"

---

### 4️⃣ Test Dhan API Integration

#### Check API Response
1. Open browser **DevTools** (F12)
2. Go to **Network** tab
3. Look for requests to `/api/options/chain`
4. Check the response:
   ```json
   {
     "source": "dhan-api",  // ✅ Should show Dhan API
     "spotPrice": 22847,
     "chain": [...],
     "timestamp": "2026-04-24T..."
   }
   ```

#### Test Fallback Mechanism
1. If Dhan API fails, you'll see:
   ```json
   {
     "source": "fallback-groww",  // ✅ Groww fallback used
     "spotPrice": 22847,
     "chain": [...],
     "timestamp": "..."
   }
   ```

---

## 🎯 Verification Checklist

### Trade Page
- [ ] Chart displays candlesticks
- [ ] Entry price shows correctly
- [ ] P&L percentage updates in real-time
- [ ] Trade type toggle works (Intraday/Delivery)
- [ ] Chart updates when price changes
- [ ] Historical trades load correctly

### Option Chain
- [ ] Call % changes display with colors (green ↑ / red ↓)
- [ ] Put % changes display with colors
- [ ] Spot price shows % change
- [ ] Greeks tab shows all 5 Greeks + IV
- [ ] Per Lot tab multiplies by lot size
- [ ] Expiry selector works
- [ ] ATM strike is highlighted
- [ ] Percentage changes update on refresh

### SEBI Validation
- [ ] Balance check works for buy orders
- [ ] Holdings check works for sell orders
- [ ] Intraday market hours validation works
- [ ] Position limit check works (90% rule)
- [ ] Error messages are clear and helpful

### Performance
- [ ] Chart loads within 2 seconds
- [ ] Option chain loads within 3 seconds
- [ ] No console errors
- [ ] Page remains responsive during updates

---

## 🐛 Troubleshooting

### Issue: Chart Not Displaying

**Solution:**
```bash
# 1. Check if data is loading
DevTools → Network → market/candles
# Should return array of candle data

# 2. Check for errors in console
DevTools → Console
# Look for JavaScript errors

# 3. Restart the app
# Kill both server and client
# Run: npm start (server), npm run dev (client)
```

### Issue: Option Chain Showing Wrong Data

**Solution:**
```bash
# 1. Check API source
DevTools → Network → options/chain
# Check "source" field in response

# 2. Try refreshing
# Click the Refresh button on the page

# 3. Clear browser cache
# DevTools → Application → Clear Storage
```

### Issue: SEBI Validation Not Working

**Solution:**
```bash
# 1. Check server logs
# Look for validation messages in server console

# 2. Verify SEBI module imported
# TradePage.jsx should have:
import { checkPositionLimit, getMarketStatus } from '../../utils/sebi';

# 3. Check market status
# Should show current market status in console
```

### Issue: % Change Not Displaying

**Solution:**
```bash
# 1. Verify fmtPercent function exists
# Check OptionChainPage.jsx imports

# 2. Check data structure
# DevTools → Console
console.log(chain.call.changePct);
# Should be a number, not undefined

# 3. Refresh data
# Click refresh button on page
```

---

## 📈 Usage Examples

### Example 1: Day Trading with Intraday Mode

```jsx
// Workflow:
1. Select RELIANCE stock
2. Click "Intraday" mode
3. View chart for recent price action
4. Entry price shows ₹1250
5. Current P&L shows +2.5% gain
6. Click BUY at ₹1260
7. Trade executes
8. Close before 3:30 PM for settlement
```

### Example 2: Option Strategy Analysis

```jsx
// Workflow:
1. Go to Option Chain
2. Select NIFTY BANKNIFTY option
3. Switch to "Greeks" view
4. Check Delta values for strike selection
5. Note Call % changes (e.g., +2.1%)
6. Click on strike to place option trade
```

### Example 3: Long-term Position

```jsx
// Workflow:
1. Select TCS stock
2. Click "Delivery" mode
3. Buy 10 shares at ₹3500
4. Entry price: ₹3500
5. Monitor P&L over days/weeks
6. Chart updates as prices move
```

---

## 📱 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+/` | Toggle sidebar |
| `F12` | Open DevTools |
| `Ctrl+R` | Refresh page |
| `Escape` | Close modals |

---

## 🔗 API Endpoints Reference

### Market Data
```
GET /api/market/quotes?symbols=RELIANCE,TCS
GET /api/market/candles?symbol=RELIANCE&range=1d&interval=1m
```

### Options
```
GET /api/options/chain?symbol=^NSEI&expiry=2026-04-24
GET /api/options/expiries
```

### Trading
```
POST /api/trades
  {
    "type": "buy",
    "symbol": "RELIANCE",
    "quantity": 10,
    "price": 1250,
    "orderType": "market",
    "tradeType": "intraday"  // ✅ New field
  }

GET /api/trades
```

---

## 📞 Support

### Common Questions

**Q: Why isn't the chart showing?**
A: Chart loads data via `/api/market/candles`. Check network tab in DevTools.

**Q: How often do % changes update?**
A: On every page refresh or real-time polling (if configured).

**Q: Can I change Greeks calculation?**
A: Greeks come from the broker API. For custom Greeks, edit the option chain computation in server.

**Q: What if Dhan API is down?**
A: System automatically falls back to Groww API. Check DevTools Network tab.

---

## 🎓 Learning Resources

- [SEBI Position Limits](client/src/utils/sebi.js)
- [Trade Type Implementation](client/src/components/Trading/TradePage.jsx)
- [Option Chain Display](client/src/components/OptionChain/OptionChainPage.jsx)
- [API Documentation](server/routes/)

---

**Ready to start?** 🚀

```bash
npm start        # Terminal 1 - Backend
npm run dev      # Terminal 2 - Frontend
# Open http://localhost:5173 in your browser
```

Happy trading! 📈📊

---
**Last Updated:** April 24, 2026
**Platform Version:** 2.0
**Status:** ✅ Ready for Production Testing
