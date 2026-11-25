import { AccountMode, D, roundPaise, ZERO } from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { getAccountByMode } from './accountService';

function toIstDate(dt: Date): string {
  return new Date(dt.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Broker-Grade Daily Contract Notes (grouped by IST trade date) for BOTH DEMO & REAL.
 * Includes full line-by-line statutory levies, net pay-in/pay-out obligation, and Blockchain hashes.
 */
export async function getDailyContractNotes(userId: string, mode: AccountMode, dateFilter?: string) {
  const acc = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  const trades = await prisma.trade.findMany({
    where: { accountId: acc.id, epoch: acc.resetEpoch },
    include: { instrument: true, chargeBreakdown: true },
    orderBy: { executedAt: 'asc' },
  });

  const byDate = new Map<string, typeof trades>();
  for (const t of trades) {
    const istDay = toIstDate(t.executedAt);
    if (dateFilter && istDay !== dateFilter) continue;
    const list = byDate.get(istDay) || [];
    list.push(t);
    byDate.set(istDay, list);
  }

  const notes = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([tradeDate, dayTrades]) => {
      let grossBuy = ZERO;
      let grossSell = ZERO;
      let brokerage = ZERO;
      let sttOrCtt = ZERO;
      let exchangeTxn = ZERO;
      let sebiFee = ZERO;
      let stampDuty = ZERO;
      let dpCharges = ZERO;
      let gst = ZERO;
      let totalCharges = ZERO;

      for (const t of dayTrades) {
        const tv = D(t.turnover);
        if (t.side === 'BUY') grossBuy = grossBuy.plus(tv);
        else grossSell = grossSell.plus(tv);

        const cb = t.chargeBreakdown;
        if (cb) {
          brokerage = brokerage.plus(D(cb.brokerage));
          sttOrCtt = sttOrCtt.plus(D(cb.sttOrCtt));
          exchangeTxn = exchangeTxn.plus(D(cb.exchangeTransactionCharge));
          sebiFee = sebiFee.plus(D(cb.sebiTurnoverFee));
          stampDuty = stampDuty.plus(D(cb.stampDuty));
          dpCharges = dpCharges.plus(D(cb.dpChargeExclGst));
          gst = gst.plus(D(cb.gst));
          totalCharges = totalCharges.plus(D(cb.totalCharges));
        }
      }

      // Net obligation: Sell Value - Buy Value - Total Charges (+ve = Receivable, -ve = Payable)
      const netObligation = roundPaise(grossSell.minus(grossBuy).minus(totalCharges));

      return {
        contractNoteNumber: `CN-${mode}-${tradeDate.replace(/-/g, '')}-${acc.id.slice(0, 6).toUpperCase()}`,
        tradeDate,
        accountMode: mode,
        tradeCount: dayTrades.length,
        totals: {
          grossBuyValue: roundPaise(grossBuy).toFixed(2),
          grossSellValue: roundPaise(grossSell).toFixed(2),
          brokerage: roundPaise(brokerage).toFixed(2),
          sttOrCtt: roundPaise(sttOrCtt).toFixed(2),
          exchangeTransactionCharge: roundPaise(exchangeTxn).toFixed(2),
          sebiTurnoverFee: roundPaise(sebiFee).toFixed(2),
          stampDuty: roundPaise(stampDuty).toFixed(2),
          dpChargeExclGst: roundPaise(dpCharges).toFixed(2),
          gst: roundPaise(gst).toFixed(2),
          totalCharges: roundPaise(totalCharges).toFixed(2),
          netObligation: netObligation.toFixed(2),
        },
        trades: dayTrades.map((t) => ({
          id: t.id,
          executedAt: t.executedAt.toISOString(),
          symbol: t.instrument.symbol,
          exchange: t.instrument.exchange,
          segment: t.instrument.segment,
          product: t.product,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          turnover: t.turnover,
          totalCharges: t.chargeBreakdown?.totalCharges ?? '0.00',
          blockchainHash: t.blockchainHash,
        })),
      };
    });

  return {
    accountMode: mode,
    epoch: acc.resetEpoch,
    count: notes.length,
    contractNotes: notes,
  };
}

interface FifoLot {
  qty: number;
  price: string;
  executedAt: Date;
}

/**
 * FIFO Realized & Indian Tax-Ready P&L Report (applies identically to DEMO & REAL).
 * Classifies realized P&L by Indian Income Tax Act heads:
 *  - Equity/ETF Delivery CNC: STCG (<365d) vs LTCG (>=365d)
 *  - Equity/ETF Intraday MIS: Speculative Business Income
 *  - F&O & MCX Commodities: Non-Speculative Business Income (with ICAI turnover)
 */
export async function getTaxPnlReport(userId: string, mode: AccountMode) {
  const acc = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  const trades = await prisma.trade.findMany({
    where: { accountId: acc.id, epoch: acc.resetEpoch },
    include: { instrument: true, chargeBreakdown: true },
    orderBy: { executedAt: 'asc' },
  });

  const longQueues = new Map<string, FifoLot[]>();
  const shortQueues = new Map<string, FifoLot[]>();

  let deliveryStcg = ZERO;
  let deliveryLtcg = ZERO;
  let intradaySpeculative = ZERO;
  let derivativesNonSpeculative = ZERO;
  let derivativesIcaiTurnover = ZERO;

  const chargesTotals = {
    brokerage: ZERO,
    sttOrCtt: ZERO,
    exchangeTransactionCharge: ZERO,
    sebiTurnoverFee: ZERO,
    stampDuty: ZERO,
    dpChargeExclGst: ZERO,
    gst: ZERO,
    totalCharges: ZERO,
  };

  const realizedLegs: Array<{
    symbol: string;
    segment: string;
    product: string;
    taxHead: 'STCG' | 'LTCG' | 'SPECULATIVE_INTRADAY' | 'NON_SPECULATIVE_DERIVATIVES';
    closedQty: number;
    buyPrice: string;
    sellPrice: string;
    grossPnl: string;
    closedAt: string;
  }> = [];

  for (const t of trades) {
    if (t.chargeBreakdown) {
      chargesTotals.brokerage = chargesTotals.brokerage.plus(D(t.chargeBreakdown.brokerage));
      chargesTotals.sttOrCtt = chargesTotals.sttOrCtt.plus(D(t.chargeBreakdown.sttOrCtt));
      chargesTotals.exchangeTransactionCharge = chargesTotals.exchangeTransactionCharge.plus(D(t.chargeBreakdown.exchangeTransactionCharge));
      chargesTotals.sebiTurnoverFee = chargesTotals.sebiTurnoverFee.plus(D(t.chargeBreakdown.sebiTurnoverFee));
      chargesTotals.stampDuty = chargesTotals.stampDuty.plus(D(t.chargeBreakdown.stampDuty));
      chargesTotals.dpChargeExclGst = chargesTotals.dpChargeExclGst.plus(D(t.chargeBreakdown.dpChargeExclGst));
      chargesTotals.gst = chargesTotals.gst.plus(D(t.chargeBreakdown.gst));
      chargesTotals.totalCharges = chargesTotals.totalCharges.plus(D(t.chargeBreakdown.totalCharges));
    }

    const key = `${t.instrument.symbol}|${t.product}`;
    const isDelivery = (t.instrument.segment === 'EQ' || t.instrument.segment === 'ETF') && t.product === 'CNC';
    const isIntradayEq = (t.instrument.segment === 'EQ' || t.instrument.segment === 'ETF') && t.product === 'MIS';

    const recordMatch = (buyPx: string, sellPx: string, qty: number, openDt: Date) => {
      const pnl = roundPaise(D(sellPx).minus(D(buyPx)).mul(qty));
      const holdDays = (t.executedAt.getTime() - openDt.getTime()) / (86400 * 1000);
      let taxHead: 'STCG' | 'LTCG' | 'SPECULATIVE_INTRADAY' | 'NON_SPECULATIVE_DERIVATIVES';

      if (isDelivery) {
        if (holdDays >= 365) {
          taxHead = 'LTCG';
          deliveryLtcg = deliveryLtcg.plus(pnl);
        } else {
          taxHead = 'STCG';
          deliveryStcg = deliveryStcg.plus(pnl);
        }
      } else if (isIntradayEq) {
        taxHead = 'SPECULATIVE_INTRADAY';
        intradaySpeculative = intradaySpeculative.plus(pnl);
      } else {
        taxHead = 'NON_SPECULATIVE_DERIVATIVES';
        derivativesNonSpeculative = derivativesNonSpeculative.plus(pnl);
        derivativesIcaiTurnover = derivativesIcaiTurnover.plus(pnl.abs());
      }

      realizedLegs.push({
        symbol: t.instrument.symbol,
        segment: t.instrument.segment,
        product: t.product,
        taxHead,
        closedQty: qty,
        buyPrice: buyPx,
        sellPrice: sellPx,
        grossPnl: pnl.toFixed(2),
        closedAt: t.executedAt.toISOString(),
      });
    };

    let rem = t.quantity;
    if (t.side === 'BUY') {
      // First cover any open FIFO short lots
      const shorts = shortQueues.get(key) || [];
      while (rem > 0 && shorts.length > 0) {
        const head = shorts[0];
        const match = Math.min(rem, head.qty);
        recordMatch(t.price, head.price, match, head.executedAt);
        head.qty -= match;
        rem -= match;
        if (head.qty === 0) shorts.shift();
      }
      shortQueues.set(key, shorts);
      if (rem > 0) {
        const longs = longQueues.get(key) || [];
        longs.push({ qty: rem, price: t.price, executedAt: t.executedAt });
        longQueues.set(key, longs);
      }
    } else {
      // SELL: first close any open FIFO long lots
      const longs = longQueues.get(key) || [];
      while (rem > 0 && longs.length > 0) {
        const head = longs[0];
        const match = Math.min(rem, head.qty);
        recordMatch(head.price, t.price, match, head.executedAt);
        head.qty -= match;
        rem -= match;
        if (head.qty === 0) longs.shift();
      }
      longQueues.set(key, longs);
      if (rem > 0) {
        const shorts = shortQueues.get(key) || [];
        shorts.push({ qty: rem, price: t.price, executedAt: t.executedAt });
        shortQueues.set(key, shorts);
      }
    }
  }

  const grossRealizedPnl = roundPaise(
    deliveryStcg.plus(deliveryLtcg).plus(intradaySpeculative).plus(derivativesNonSpeculative)
  );
  const netRealizedPnl = roundPaise(grossRealizedPnl.minus(chargesTotals.totalCharges));

  return {
    accountMode: mode,
    epoch: acc.resetEpoch,
    totalTrades: trades.length,
    summary: {
      grossRealizedPnl: grossRealizedPnl.toFixed(2),
      totalCharges: roundPaise(chargesTotals.totalCharges).toFixed(2),
      netRealizedPnl: netRealizedPnl.toFixed(2),
    },
    taxBuckets: {
      equityDeliverySTCG: roundPaise(deliveryStcg).toFixed(2),
      equityDeliveryLTCG: roundPaise(deliveryLtcg).toFixed(2),
      intradaySpeculativeBusinessIncome: roundPaise(intradaySpeculative).toFixed(2),
      derivativesNonSpeculativeIncome: roundPaise(derivativesNonSpeculative).toFixed(2),
      derivativesIcaiTurnover: roundPaise(derivativesIcaiTurnover).toFixed(2),
    },
    chargesBreakdown: {
      brokerage: roundPaise(chargesTotals.brokerage).toFixed(2),
      sttOrCtt: roundPaise(chargesTotals.sttOrCtt).toFixed(2),
      exchangeTransactionCharge: roundPaise(chargesTotals.exchangeTransactionCharge).toFixed(2),
      sebiTurnoverFee: roundPaise(chargesTotals.sebiTurnoverFee).toFixed(2),
      stampDuty: roundPaise(chargesTotals.stampDuty).toFixed(2),
      dpChargeExclGst: roundPaise(chargesTotals.dpChargeExclGst).toFixed(2),
      gst: roundPaise(chargesTotals.gst).toFixed(2),
      totalCharges: roundPaise(chargesTotals.totalCharges).toFixed(2),
    },
    realizedLegs,
  };
}

export async function exportReportCsv(userId: string, mode: AccountMode, type: 'trades' | 'ledger' | 'tax-pnl'): Promise<string> {
  const acc = await getAccountByMode(userId, mode);
  const prisma = getPrisma();

  if (type === 'trades') {
    const trades = await prisma.trade.findMany({
      where: { accountId: acc.id, epoch: acc.resetEpoch },
      include: { instrument: true, chargeBreakdown: true },
      orderBy: { executedAt: 'asc' },
    });
    const header = ['ExecutedAt', 'AccountMode', 'Symbol', 'Exchange', 'Segment', 'Product', 'Side', 'Qty', 'Price', 'Turnover', 'Brokerage', 'STT_CTT', 'ExchangeTxn', 'SEBIFee', 'StampDuty', 'DPCharge', 'GST', 'TotalCharges', 'BlockchainHash'];
    const rows = trades.map((t) => [
      t.executedAt.toISOString(), mode, t.instrument.symbol, t.instrument.exchange, t.instrument.segment,
      t.product, t.side, t.quantity, t.price, t.turnover,
      t.chargeBreakdown?.brokerage ?? '0.00', t.chargeBreakdown?.sttOrCtt ?? '0.00',
      t.chargeBreakdown?.exchangeTransactionCharge ?? '0.00', t.chargeBreakdown?.sebiTurnoverFee ?? '0.00',
      t.chargeBreakdown?.stampDuty ?? '0.00', t.chargeBreakdown?.dpChargeExclGst ?? '0.00',
      t.chargeBreakdown?.gst ?? '0.00', t.chargeBreakdown?.totalCharges ?? '0.00', t.blockchainHash ?? '',
    ]);
    return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  }

  if (type === 'ledger') {
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: acc.id, epoch: acc.resetEpoch },
      orderBy: { createdAt: 'asc' },
    });
    const header = ['CreatedAt', 'AccountMode', 'Epoch', 'EntryType', 'Description', 'Debit', 'Credit', 'RunningBalance', 'ReferenceId'];
    const rows = entries.map((e) => [
      e.createdAt.toISOString(), mode, e.epoch, e.entryType, e.description, e.debit, e.credit, e.runningBalance, e.referenceId ?? '',
    ]);
    return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  }

  const tax = await getTaxPnlReport(userId, mode);
  const header = ['ClosedAt', 'Symbol', 'Segment', 'Product', 'TaxHead', 'ClosedQty', 'BuyPrice', 'SellPrice', 'GrossPnl'];
  const rows = tax.realizedLegs.map((l) => [
    l.closedAt, l.symbol, l.segment, l.product, l.taxHead, l.closedQty, l.buyPrice, l.sellPrice, l.grossPnl,
  ]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}
