# AI training — segment recommendation ("where should I invest")

Hybrid model: **skill (your trades + journal)** + **market (sector momentum + breadth)** + **temperament (persona fit)**.
Node serves it live; Python trains the weights from your real paper-trade history.

## Data available in this repo (what the model learns from)

| Source | File / table | Used for |
|---|---|---|
| Paper trades (BUY/SELL, price, qty, P&L) | Prisma `Trade` + `server/data/users.json` | per-segment win-rate, return % |
| Journal (setup, thesis, emotions, R:R, rating) | Prisma `TradeJournal` | persona (FOMO/revenge/disciplined), execution rating |
| Holdings + realized P&L | Prisma `Holding` | online weight refresh |
| Live candles / quotes | `GET /api/market/candles`, `/quotes` | sector momentum, breadth |
| Sector map | `server/services/marketDataService.js` SECTORS | momentum per segment |
| Indicators | `server/services/indicators.js` (RSI/MACD/Supertrend) | market score features |

## Run (Windows PowerShell)

```powershell
# 1. export labelled dataset from SQLite
node server/ai/export_dataset.js --out=server/ai/dataset.json

# 2. install trainer deps (once)
pip install scikit-learn pandas numpy

# 3. train -> writes server/ai/weights.json (+ segment_model.pkl)
python server/ai/train_recommendation.py --data server/ai/dataset.json --out server/ai/weights.json

# 4. restart server — recommendationEngine.js picks up new weights automatically
cd server; npm run dev
```

No sklearn in production: `weights.json` is the only artifact the server reads
(`wSkill/wMarket/wTemperament` + per-segment bias). Retrain weekly or after ~20 new trades.

## Live API

`POST /api/ai/invest-recommendation` (auth) → `{ recommendation, aiSummary }`

`recommendation` = `{ persona, topPick, ranking[], confidence, riskNotes[], plan[], dataStats }`.
`aiSummary` = optional Gemini explanation (null when `GEMINI_API_KEY` is unset — ranking still works).
