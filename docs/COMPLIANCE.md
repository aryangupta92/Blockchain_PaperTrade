# SEBI & Indian Market Regulatory Compliance Register (`COMPLIANCE.md`)

> **Principle:** Regulatory compliance overrides product convenience. Every limit, tax, margin rule, and risk disclosure is stored as **effective-dated configuration** and cited below.

---

## 1. Mandatory Licensing & Going-Live Checklist (REAL Mode)

Operating a live **REAL** trading account for public users in India requires:
1. **SEBI Stock Broker Registration** (or an authorized partnership / white-label / AP / execution routing integration with a SEBI-registered Stock Broker holding NSE/BSE/MCX membership).
2. **Clearing Membership / Clearing Corporation Integration** (NCL, ICCL, MCXCCL) for upfront margin reporting, peak-margin snapshots, and T+1 / expiry settlements.
3. **Depository Participant (DP) Registration** (CDSL / NSDL) + **eDIS / DDPI** authorization for equity delivery debits.
4. **KYC / AML / CKYC / KRA Compliance** (SEBI Master Circular on KYC & PMLA) prior to activating REAL trading or accepting deposits.
5. **Exchange Market-Data Redistribution License** (NSE Data & Analytics / BSE / MCX vendor agreements) before distributing live market feeds to multiple end users.
6. **Charting Library Commercial License** (TradingView Advanced Charts commercial agreement when transitioning from open-source Lightweight Charts).
7. **DPDP Act (Digital Personal Data Protection Act, India)** consent, data minimization, encryption at rest/in transit, and audit trails.

> Until all items above are executed, `RealExecutionBroker` runs through a clearly marked **Mock Adapter** and must not transmit live retail orders on behalf of third parties.

---

## 2. Implemented Regulatory Rules & Citations

| Rule Area | Summary | Official Citation / Basis | Status |
| :--- | :--- | :--- | :--- |
| **STT (Effective 1 Apr 2026)** | EQ Delivery 0.1% B&S; EQ Intraday 0.025% S; Futures 0.05% S; Options 0.15% S (premium) & 0.15% on exercise. | Finance Act, 2026 (effective 2026-04-01) | Verified |
| **SEBI Turnover Fee** | 0.0001% (₹10/crore) on buy & sell across EQ, F&O, Commodities. | SEBI (Payment of Fees) Regulations | Verified |
| **Stamp Duty** | Buy-side only: EQ Delivery 0.015%, EQ Intraday 0.003%, Futures 0.002%, Options 0.003% (premium), Commodity Futures 0.002%. | Indian Stamp Act, 1899 (Unified Rates) | Verified |
| **GST** | 18% on (Brokerage + Exchange Transaction Charges + SEBI Turnover Fee). | CGST / IGST Act | Verified |
| **Weekly Index Expiries** | Restricted to 1 benchmark index per exchange (NSE: NIFTY 50; BSE: SENSEX). | `SEBI/HO/MRD/TPD/P/CIR/2024/132` (Oct 1, 2024) | Verified |
| **F&O Minimum Contract Value** | ₹15–20 lakh notional contract value at introduction; dynamic lot sizes from daily exchange scrip master. | `SEBI/HO/MRD/TPD/P/CIR/2024/132` | Verified |
| **Upfront Option Premium** | 100% of option premium collected upfront from option buyers. | `SEBI/HO/MRD/TPD/P/CIR/2024/132` (effective Feb 1, 2025) | Verified |
| **Expiry-Day Calendar Spreads** | Calendar spread margin benefit removed on expiry day of near-month contract. | `SEBI/HO/MRD/TPD/P/CIR/2024/132` (effective Feb 1, 2025) | Verified |
| **Expiry-Day Short Option ELM** | Additional +2% Extreme Loss Margin on short index options on expiry day. | `SEBI/HO/MRD/TPD/P/CIR/2024/132` | Verified |
| **Peak Margin & Intraday Leverage** | Upfront VaR + ELM per scrip (no hardcoded flat 5x); intraday peak snapshots simulated. | SEBI Peak Margin Circulars (`SEBI/HO/MRD2/DCAP/CIR/P/2020/127` & updates) | Verified |
| **Equity Settlement** | T+1 rolling settlement; no delivery short selling; T1 holdings tracking. | SEBI T+1 Settlement Circular | Verified |
| **Exchange Transaction Charges & IPFT** | True-to-label uniform exchange fees per segment/group. | SEBI True-to-Label Circular (2024) & NSE/BSE/MCX circulars | `TO VERIFY` exact current bps |
| **Currency Derivatives (ETCD)** | Mandatory underlying contracted forex exposure for retail/participants. | RBI A.P. (DIR Series) & Exchange Circulars (Apr 2024) | Deferred / Gated |

---

## 3. Mandatory User Risk Disclosures

The platform surfaces SEBI-mandated disclosures during onboarding, account switching, and F&O order placement:
1. **Derivatives Risk Disclosure (SEBI Circular `SEBI/HO/MIRSD/MIRSD-PoD-1/P/CIR/2023/73`):**
   - *"9 out of 10 individual traders in equity Futures and Options Segment incurred net losses."*
   - *"On an average, loss makers registered net trading loss close to ₹50,000."*
   - *"Over and above the net trading losses incurred, loss makers expended an additional 28% of net trading losses as transaction costs."*
2. **Demo Trading Disclaimer:**
   - *"DEMO mode uses virtual funds and simulated execution on live market prices. Demo results do not guarantee real trading outcomes. Statutory charges and brokerage are simulated identically to real trading for educational accuracy."*
