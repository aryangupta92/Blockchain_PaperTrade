# BlockTrade 📈⛓️

A high-fidelity, professional-grade, SEBI-compliant paper trading platform for the Indian stock market. It perfectly emulates real broker UI schemas while executing a **Dual-Chain execution model** — logging every trade to a local custom SHA-256 blockchain, as well as to the Ethereum network via MetaMask.

![Platform Preview](./client/public/vite.svg) (*Disclaimer: For educational purposes only*)

## 🎯 Features

- **Professional Charting**: Integrated TradingView's `lightweight-charts` with real-time zooming, custom horizontal price scale and vertical time scale scrolling, tooltips, crosshairs, and live candelstick rendering.
- **Historic Data Ranges**: Dynamic chart range selection matching professional applications (1D, 5D, 1M, 3M, 6M, 1Y, 3Y, 5Y, ALL), fetching directly from Yahoo Finance API.
- **Option Chain Engine**: A fully custom-built Black-Scholes option pricing model built in Node.js calculating Implied Volatility (IV), Delta, Gamma, Theta, Vega, and Put-Call Ratios for NSE options.
- **Market Dynamics**: Real-time Market Status (Open/Closed), Top Gainers & Losers, FII/DII updates, and Advances/Declines visuals directly mapped to Live Data.
- **SEBI Compliance**: Enforces maximum position limits, block limits, margins, and warns on low balance to mimic real Indian broker regulations.
- **Web3 Integration (Dual Chain)**: Every trade and account subscription triggers a local SHA-256 block mining event *AND* an Ethereum Smart Contract transaction via MetaMask on the Sepolia testnet.

## 🛠 Tech Stack

Frontend reconstructed entirely from scratch avoiding Tailwind to offer extreme control over premium UI interactions.

### Frontend
* **React 18** + **Vite**
* **Vanilla CSS**: Extensively customized global variables and CSS Modules.
* **Ethers.js (v6)**: For interacting with MetaMask and deploying Ethereum transactions.
* **Lightweight-Charts**: High-performance canvas-based financial charts.
* **Recharts**: For dynamic sparklines on the home dashboard.
* **Lucide React**: For scalable, sharp iconography.

### Backend
* **Node.js** + **Express.js** API
* **Yahoo Finance API (v8)**: Reverse engineered to pull live Nifty 50, Sensex, and individual stock ticks without rate limits.
* **Crypto (Built-in Node Module)**: Used to write our own Proof-of-Work blockchain (`blockchain.js`) directly in Express for local trade auditing.

### Blockchain & Smart Contracts
* **Solidity (^0.8.19)**: The core `BlockTrade.sol` handles users, virtual balances, subscriptions, and immutable trade records.
* **MetaMask**: Provides the Web3 provider for browser injections.
* **Remix IDE**: Used for compilation and testnet deployment.

## 🚀 How to Run the Project Locally

Because the project is split into a **client** (Frontend) and **server** (Backend), you must run both simultaneously.

### 1. Start the Backend API
Open a terminal and navigate to the `server` folder of the project.
```bash
cd server
npm install
npm run dev
```
*(The server will start on `http://localhost:5000`)*

### 2. Start the Frontend Application
Open a **new** terminal window and navigate to the `client` folder.
```bash
cd client
npm install
npm run dev
```
*(The app will launch on `http://localhost:5173`)*

### 3. Open the App
Go to `http://localhost:5173` in your browser. 
- You can create a new account, or use the demo login: 
  - **Email:** `demo@blocktrade.in`
  - **Password:** `demo1234`

### 4. Optional: Connect MetaMask
If you want to test the Web3 Ethereum features:
1. Ensure the `CONTRACT_ADDRESS` inside `client/src/services/web3.js` matches your deployed contract from Remix.
2. Click **Connect Wallet** inside the app.
3. Every time you place an order on the **Trading** tab, MetaMask will pop up and ask you to confirm the blockchain transaction securely.

## 📂 Project Structure

```
Blockchain_PaperTrade/
├── blockchain/
│   └── BlockTrade.sol          # Solidity Smart Contract
├── server/
│   ├── routes/
│   │   ├── auth.js             # User Auth & State management
│   │   ├── market.js           # Yahoo Finance Live Polling
│   │   └── trade.js            # Trading & Order logic
│   ├── services/
│   │   ├── blockchain.js       # Local custom SHA-256 Ledger
│   │   └── optionsPricing.js   # Black-Scholes Greeks Engine
│   └── server.js               # Express entry point
└── client/
    ├── src/
    │   ├── components/         # All React Components (BrokerShell, Chart, Market, etc.)
    │   ├── services/
    │   │   ├── api.js          # Express Backend Interceptor
    │   │   └── web3.js         # Ethers.js MetaMask Contract Interface
    │   └── App.jsx             # Main Router & Global State
```

## ⚖️ Disclaimer

**This is a Paper Trading Simulator**. It connects to live markets for educational testing of financial modeling, interface design, algorithms, and blockchain auditing. No real monetary transactions ever take place. Simulated capital cannot be withdrawn.
