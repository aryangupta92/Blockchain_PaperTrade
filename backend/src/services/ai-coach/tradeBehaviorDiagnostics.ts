import { AccountMode, D, roundPaise, ZERO } from '@broker/shared';
import { getPrisma } from '../../infrastructure/database';
import { getTaxPnlReport } from '../taxAndContractReportsService';
import { getAccountByMode } from '../accountService';

export interface PracticeMissionStatus {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  progressText: string;
  targetNav: string;
}

export interface TradingDiagnosticsReport {
  accountMode: AccountMode;
  totalTrades: number;
  closedRoundTrips: number;
  winRatePct: number;
  avgWinINR: string;
  avgLossINR: string;
  rewardToRiskRatio: number;
  grossRealizedPnl: string;
  totalChargesPaid: string;
  netRealizedPnl: string;
  chargesDragPct: number;
  stopLossUsagePct: number;
  maxTradesInSingleDay: number;
  revengeTradeFlags: number;
  readinessScore: number; // 0 to 100 DEMO -> REAL readiness score
  strengths: string[];
  improvements: string[];
  nextStepAdvice: string;
}

/**
 * Automatically verifies the beginner's Hands-On Practice Missions against their REAL Prisma DB state!
 */
export async function evaluatePracticeMissions(userId: string): Promise<PracticeMissionStatus[]> {
  const prisma = getPrisma();
  const demo = await getAccountByMode(userId, 'DEMO');

  const [demoBalanceSet, cncBuys, riskConfiguredOrMis, backtestCount, completedModules] = await Promise.all([
    prisma.ledgerEntry.count({ where: { accountId: demo.id, entryType: { in: ['DEMO_SET', 'DEMO_RESET'] } } }),
    prisma.trade.count({ where: { accountId: demo.id, product: 'CNC', side: 'BUY' } }),
    prisma.order.count({
      where: {
        accountId: demo.id,
        OR: [{ product: 'MIS' }, { orderType: { in: ['SL', 'SL_M', 'BO', 'CO', 'SUPER'] } }],
      },
    }),
    prisma.backtestRun.count({ where: { userId } }),
    prisma.userLearningProgress.count({ where: { userId, status: 'COMPLETED' } }),
  ]);

  const hasRiskLimit = demo.maxDailyLoss != null || demo.maxOrderValue != null;

  return [
    {
      id: 'mission-1-demo-fund',
      title: 'Mission 1: Fund Your DEMO Account',
      description: 'Go to Funds & Ledger in DEMO mode and set a realistic starting virtual capital (e.g., ₹2,00,000).',
      completed: demoBalanceSet > 0,
      progressText: demoBalanceSet > 0 ? 'Completed — DEMO virtual capital funded & sealed on Blockchain' : 'Pending — Set DEMO balance (₹1,000–₹1Cr)',
      targetNav: 'funds',
    },
    {
      id: 'mission-2-first-cnc',
      title: 'Mission 2: Execute Your First Equity Delivery (CNC) Trade',
      description: 'Buy any NSE/BSE equity or ETF in CNC mode and inspect its itemized Finance Act 2026 charges & Blockchain proof.',
      completed: cncBuys > 0,
      progressText: cncBuys > 0 ? `Completed (${cncBuys} CNC buy trade(s) logged)` : 'Pending — Place 1 CNC BUY in DEMO',
      targetNav: 'equity',
    },
    {
      id: 'mission-3-risk-discipline',
      title: 'Mission 3: Practice Risk Control (MIS / Stop-Loss / Daily Limit)',
      description: 'Place an intraday MIS or Stop-Loss/Super order OR configure a Max Daily Loss cap in Positions & Holdings.',
      completed: riskConfiguredOrMis > 0 || hasRiskLimit,
      progressText: riskConfiguredOrMis > 0 || hasRiskLimit ? 'Completed — Risk discipline active' : 'Pending — Use SL/MIS or set Max Daily Loss',
      targetNav: 'positions',
    },
    {
      id: 'mission-4-backtest',
      title: 'Mission 4: Run a Zero-Bias Historical Backtest',
      description: 'Open Strategy Lab & Backtest, pick or build a rule set, and verify Net Return after Indian charges.',
      completed: backtestCount > 0,
      progressText: backtestCount > 0 ? `Completed (${backtestCount} backtest run(s) saved)` : 'Pending — Run 1 historical backtest',
      targetNav: 'strategy-lab',
    },
    {
      id: 'mission-5-academy',
      title: 'Mission 5: Complete at Least 2 Indian Market Academy Modules',
      description: 'Pass the interactive quizzes in the Academy tab to prove mastery of SEBI & Indian market mechanics.',
      completed: completedModules >= 2,
      progressText: `${completedModules}/2 modules completed`,
      targetNav: 'ai-coach',
    },
  ];
}

/**
 * Analyzes the user's ACTUAL trade history & behavior in DEMO or REAL mode
 * to produce objective, SEBI-compliant performance coaching (zero stock tips!).
 */
export async function generateTradingDiagnostics(
  userId: string,
  mode: AccountMode
): Promise<TradingDiagnosticsReport> {
  const prisma = getPrisma();
  const account = await getAccountByMode(userId, mode);
  const [taxReport, orders, trades] = await Promise.all([
    getTaxPnlReport(userId, mode),
    prisma.order.findMany({
      where: { accountId: account.id, epoch: account.resetEpoch },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.trade.findMany({
      where: { accountId: account.id, epoch: account.resetEpoch },
      orderBy: { executedAt: 'asc' },
    }),
  ]);

  const legs = taxReport.realizedLegs;
  const wins = legs.filter((l) => Number(l.grossPnl) > 0);
  const losses = legs.filter((l) => Number(l.grossPnl) <= 0);
  const winRatePct = legs.length > 0 ? Number(((wins.length / legs.length) * 100).toFixed(2)) : 0;

  const avgWin = wins.length
    ? roundPaise(wins.reduce((s, l) => s.plus(D(l.grossPnl)), ZERO).div(wins.length))
    : ZERO;
  const avgLoss = losses.length
    ? roundPaise(losses.reduce((s, l) => s.plus(D(l.grossPnl).abs()), ZERO).div(losses.length))
    : ZERO;
  const rewardToRiskRatio = avgLoss.gt(0) ? Number(avgWin.div(avgLoss).toFixed(2)) : avgWin.gt(0) ? 3 : 0;

  const gross = D(taxReport.summary.grossRealizedPnl);
  const charges = D(taxReport.summary.totalCharges);
  const chargesDragPct = gross.gt(0) ? Number(charges.div(gross).mul(100).toFixed(2)) : charges.gt(0) ? 100 : 0;

  // Stop-loss discipline: % of orders that used SL / SL_M / BO / CO / SUPER
  const slOrders = orders.filter((o) => ['SL', 'SL_M', 'BO', 'CO', 'SUPER'].includes(o.orderType)).length;
  const stopLossUsagePct = orders.length > 0 ? Number(((slOrders / orders.length) * 100).toFixed(1)) : 0;

  // Overtrading check: max trades in a single IST calendar day
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const istDay = new Date(t.executedAt.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    byDay.set(istDay, (byDay.get(istDay) ?? 0) + 1);
  }
  const maxTradesInSingleDay = byDay.size ? Math.max(...byDay.values()) : 0;

  // Revenge-trading heuristic: entering a new trade within 5 minutes of a losing realized leg
  let revengeTradeFlags = 0;
  for (const loss of losses) {
    const lossMs = new Date(loss.closedAt).getTime();
    const rapidReentry = trades.some((t) => {
      const diff = t.executedAt.getTime() - lossMs;
      return diff > 1000 && diff <= 5 * 60 * 1000;
    });
    if (rapidReentry) revengeTradeFlags++;
  }

  // Strengths, Improvements & Readiness Score (0–100)
  const strengths: string[] = [];
  const improvements: string[] = [];
  let score = 20;

  if (trades.length === 0) {
    improvements.push(`No trades placed in ${mode} yet. Start with Mission 1 & 2 in DEMO to build a track record.`);
  } else {
    if (trades.length >= 10) {
      score += 15;
      strengths.push(`Built an active practice sample (${trades.length} executed trades).`);
    } else {
      improvements.push(`Sample size is small (${trades.length} trades). Practice at least 20+ disciplined DEMO trades before transitioning to REAL.`);
    }

    if (Number(taxReport.summary.netRealizedPnl) > 0) {
      score += 20;
      strengths.push(`Net positive realized P&L after full Indian statutory charges (₹${taxReport.summary.netRealizedPnl}).`);
    } else if (legs.length > 0) {
      improvements.push('Net realized P&L is currently negative. Review losing setups and cut losers earlier.');
    }

    if (rewardToRiskRatio >= 1.5) {
      score += 15;
      strengths.push(`Healthy Reward-to-Risk ratio (${rewardToRiskRatio}:1).`);
    } else if (legs.length > 0) {
      improvements.push(`Reward-to-Risk ratio is ${rewardToRiskRatio}:1. Aim for ≥1.5:1 so winners comfortably outweigh losers.`);
    }

    if (chargesDragPct <= 20 && gross.gt(0)) {
      score += 15;
      strengths.push(`Controlled statutory charges drag (${chargesDragPct}% of gross profit).`);
    } else if (charges.gt(0)) {
      improvements.push(`High statutory fee drag (${chargesDragPct}% of gross profit). Reduce low-conviction scalping; Finance Act 2026 STT rewards higher-timeframe selectivity.`);
    }

    if (stopLossUsagePct >= 30 || account.maxDailyLoss != null) {
      score += 15;
      strengths.push('Active risk protection via Stop-Loss orders or Max Daily Loss limit.');
    } else {
      improvements.push('Very low Stop-Loss order usage. Use SL, CO, BO, or SUPER orders (with trailing SL) and configure a Max Daily Loss cap.');
    }

    if (maxTradesInSingleDay > 12) {
      score -= 10;
      improvements.push(`Overtrading alert: ${maxTradesInSingleDay} trades in a single day. High trade frequency compounds STT & brokerage drag.`);
    }
    if (revengeTradeFlags > 0) {
      score -= 10;
      improvements.push(`Revenge-trading risk: ${revengeTradeFlags} rapid re-entries within 5 minutes after a loss. Pause 15 minutes after any stop-loss hit.`);
    }
  }

  const readinessScore = Math.max(0, Math.min(100, score));
  const nextStepAdvice =
    readinessScore >= 75
      ? 'Strong process discipline! Keep tracking at least 30+ consistent DEMO trades across different market regimes before allocating small REAL capital.'
      : readinessScore >= 45
        ? 'Making solid progress. Focus on the top improvement items above, backtest your setups in Strategy Lab, and tighten Stop-Loss discipline.'
        : 'Stay in DEMO learning mode. Complete the 6 Academy modules, use the 1% Risk position sizing rule, and practice structured setups before considering REAL funds.';

  return {
    accountMode: mode,
    totalTrades: trades.length,
    closedRoundTrips: legs.length,
    winRatePct,
    avgWinINR: avgWin.toFixed(2),
    avgLossINR: avgLoss.toFixed(2),
    rewardToRiskRatio,
    grossRealizedPnl: taxReport.summary.grossRealizedPnl,
    totalChargesPaid: taxReport.summary.totalCharges,
    netRealizedPnl: taxReport.summary.netRealizedPnl,
    chargesDragPct,
    stopLossUsagePct,
    maxTradesInSingleDay,
    revengeTradeFlags,
    readinessScore,
    strengths,
    improvements,
    nextStepAdvice,
  };
}
