# Regulatory Rules & Effective-Dated Configuration Map (`RULES.md`)

All regulatory parameters live in `shared-engine/src/sebiRegulatoryConfig.ts` (and are mirrored into the `RegulatoryConfig` table in Prisma with admin-approval audit logs in Phase 8).

## Effective-Dated Config Entries

| Config Key | Effective From | Current Value | Verification Status | Source |
| :--- | :--- | :--- | :--- | :--- |
| `stt.eq_delivery` | `2026-04-01` | `0.1%` (Buy & Sell) | VERIFIED | Finance Act, 2026 |
| `stt.eq_intraday` | `2026-04-01` | `0.025%` (Sell only) | VERIFIED | Finance Act, 2026 |
| `stt.fno_futures` | `2026-04-01` | `0.05%` (Sell only) | VERIFIED | Finance Act, 2026 |
| `stt.fno_options_sell` | `2026-04-01` | `0.15%` (Sell premium) | VERIFIED | Finance Act, 2026 |
| `stt.fno_options_exercise` | `2026-04-01` | `0.15%` (Intrinsic value) | VERIFIED | Finance Act, 2026 |
| `ctt.mcx_non_agri_futures` | `2026-04-01` | `0.01%` (Sell only) | `TO VERIFY` | Finance Act / MCX Circular |
| `ctt.mcx_non_agri_options_sell` | `2026-04-01` | `0.05%` (Sell premium) | `TO VERIFY` | Finance Act / MCX Circular |
| `sebi.turnover_fee` | `2024-01-01` | `0.0001%` (₹10/Cr B&S) | VERIFIED | SEBI Fee Regulations |
| `gst.rate` | `2017-07-01` | `18%` on Brok+Exch+SEBI | VERIFIED | CGST / IGST Act |
| `stamp_duty.eq_delivery` | `2020-07-01` | `0.015%` (Buy only) | VERIFIED | Indian Stamp Act, 1899 |
| `stamp_duty.eq_intraday` | `2020-07-01` | `0.003%` (Buy only) | VERIFIED | Indian Stamp Act, 1899 |
| `stamp_duty.fno_futures` | `2020-07-01` | `0.002%` (Buy only) | VERIFIED | Indian Stamp Act, 1899 |
| `stamp_duty.fno_options` | `2020-07-01` | `0.003%` (Buy premium) | VERIFIED | Indian Stamp Act, 1899 |
| `stamp_duty.mcx_futures` | `2020-07-01` | `0.002%` (Buy only) | VERIFIED | Indian Stamp Act, 1899 |
| `exchange.nse_eq` | `2024-10-01` | `0.00297%` | `TO VERIFY` | NSE True-to-Label Circular |
| `exchange.bse_eq` | `2024-10-01` | `0.00375%` | `TO VERIFY` | BSE True-to-Label Circular |
| `exchange.nse_futures` | `2024-10-01` | `0.00173%` | `TO VERIFY` | NSE F&O Circular |
| `exchange.nse_options` | `2024-10-01` | `0.03503%` (on premium) | `TO VERIFY` | NSE F&O Circular |
| `exchange.bse_options` | `2024-10-01` | `0.0325%` (on premium) | `TO VERIFY` | BSE F&O Circular |
| `exchange.mcx_futures` | `2024-10-01` | `0.0021%` | `TO VERIFY` | MCX Circular |
| `dp.sell_charge_per_scrip` | `2025-01-01` | `₹15.93` (incl. GST placeholder) | `TO VERIFY` | CDSL / Partner DP Tariff |
| `brokerage.default_plan` | `2026-01-01` | CNC ₹0; MIS/FUT min(₹20, 0.03%); OPT ₹20 flat | PLACEHOLDER | Approved default plan |
| `fno.weekly_indices` | `2024-11-20` | NSE: `NIFTY`, BSE: `SENSEX` | VERIFIED | `SEBI/HO/MRD/TPD/P/CIR/2024/132` |
| `fno.upfront_option_premium` | `2025-02-01` | `100%` | VERIFIED | `SEBI/HO/MRD/TPD/P/CIR/2024/132` |
| `fno.expiry_day_calendar_spread_benefit` | `2025-02-01` | `false` | VERIFIED | `SEBI/HO/MRD/TPD/P/CIR/2024/132` |
| `fno.expiry_day_short_option_extra_elm_pct` | `2024-11-20` | `2%` | VERIFIED | `SEBI/HO/MRD/TPD/P/CIR/2024/132` |
| `mis.auto_square_off_ist` | `2024-01-01` | `15:15` (Equity/F&O) | VERIFIED | Broker RMS Standard |
