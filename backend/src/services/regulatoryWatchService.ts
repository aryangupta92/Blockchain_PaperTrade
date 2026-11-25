import { resolveRegulatoryConfig } from '@broker/shared';
import { getPrisma } from '../infrastructure/database';
import { blockchainService } from './blockchainAuditService';
import { getMarketSession } from './market-data/marketSessionClock';
import { getMasterIndex } from './market-data/instrumentMaster';

export const OFFICIAL_REGULATORY_SOURCES = [
  {
    id: 'sebi-circulars',
    authority: 'SEBI',
    url: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0',
    scope: 'F&O framework, peak margin, upfront premium, MTF, KYC/AML, risk disclosures',
  },
  {
    id: 'nse-circulars',
    authority: 'NSE',
    url: 'https://www.nseindia.com/resources/exchange-communication-circulars',
    scope: 'Lot sizes, freeze quantities, VaR/ELM margin files, F&O ban list, holidays, transaction fees',
  },
  {
    id: 'bse-circulars',
    authority: 'BSE',
    url: 'https://www.bseindia.com/markets/MarketInfo/NoticesCirculars.aspx',
    scope: 'SENSEX/BANKEX derivatives, equity scrip groups, transaction charges, holidays',
  },
  {
    id: 'mcx-circulars',
    authority: 'MCX',
    url: 'https://www.mcxindia.com/circulars',
    scope: 'Commodity lot sizes, seasonal DST trading hours (23:30 / 23:55 IST), CTT & margins',
  },
  {
    id: 'incometax-finance-act',
    authority: 'Income Tax Dept / Finance Act',
    url: 'https://incometaxindia.gov.in',
    scope: 'STT / CTT rates, capital gains (STCG/LTCG), stamp duty amendments',
  },
];

/** Seed approved baseline effective-dated regulatory rules into Prisma (idempotent). */
export async function seedBaselineRegulatoryConfigs() {
  const prisma = getPrisma();
  const snap = resolveRegulatoryConfig();
  const entries = [
    snap.stt,
    snap.exchangeCharges,
    snap.sebiTurnoverFeePct,
    snap.stampDuty,
    snap.gstPct,
    snap.dpSellChargePerScripExclGst,
    snap.brokerage,
    snap.fnoRules,
    snap.tradingHours,
  ];

  for (const e of entries) {
    await prisma.regulatoryConfig.upsert({
      where: {
        configKey_effectiveFrom: {
          configKey: e.key,
          effectiveFrom: e.effectiveFrom,
        },
      },
      create: {
        configKey: e.key,
        effectiveFrom: e.effectiveFrom,
        payloadJson: JSON.stringify(e.value),
        verification: e.verification,
        citation: e.citation,
        status: 'APPROVED',
        approvedBy: 'SYSTEM_BASELINE',
        approvedAt: new Date(),
      },
      update: {},
    });
  }
}

export async function createRegulatoryDraft(params: {
  configKey: string;
  effectiveFrom: string;
  payload: unknown;
  verification: 'VERIFIED' | 'TO_VERIFY' | 'PLACEHOLDER';
  citation: string;
  proposedBy: string;
  ipAddress?: string;
}) {
  const prisma = getPrisma();
  const draft = await prisma.regulatoryConfig.upsert({
    where: {
      configKey_effectiveFrom: {
        configKey: params.configKey,
        effectiveFrom: params.effectiveFrom,
      },
    },
    create: {
      configKey: params.configKey,
      effectiveFrom: params.effectiveFrom,
      payloadJson: JSON.stringify(params.payload),
      verification: params.verification,
      citation: params.citation,
      status: 'DRAFT',
    },
    update: {
      payloadJson: JSON.stringify(params.payload),
      verification: params.verification,
      citation: params.citation,
      status: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: params.proposedBy,
      action: 'REGULATORY_DRAFT_CREATED',
      entity: 'RegulatoryConfig',
      entityId: draft.id,
      details: JSON.stringify({
        configKey: draft.configKey,
        effectiveFrom: draft.effectiveFrom,
        citation: draft.citation,
      }),
      ipAddress: params.ipAddress,
    },
  });

  return {
    ...draft,
    payload: JSON.parse(draft.payloadJson),
  };
}

/**
 * Admin-only approval gate: NEVER auto-apply regulatory changes.
 * Approving marks status APPROVED, logs AuditLog, and seals a SHA-256 Blockchain Governance Block.
 */
export async function approveRegulatoryDraft(params: {
  configId: string;
  adminUserId: string;
  adminEmail: string;
  effectiveFrom?: string;
  ipAddress?: string;
}) {
  const prisma = getPrisma();
  const existing = await prisma.regulatoryConfig.findUnique({ where: { id: params.configId } });
  if (!existing) {
    const err = new Error('Regulatory draft not found.') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (existing.status !== 'DRAFT') {
    const err = new Error(`Config entry is already in status ${existing.status}.`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const approved = await prisma.$transaction(async (tx) => {
    // Supersede earlier approved entries of the exact same key that have an earlier effectiveFrom if desired,
    // while keeping historical effective-dated rows intact for auditability.
    const row = await tx.regulatoryConfig.update({
      where: { id: existing.id },
      data: {
        status: 'APPROVED',
        ...(params.effectiveFrom ? { effectiveFrom: params.effectiveFrom } : {}),
        approvedBy: params.adminEmail,
        approvedAt: now,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: params.adminUserId,
        action: 'REGULATORY_CONFIG_APPROVED',
        entity: 'RegulatoryConfig',
        entityId: row.id,
        details: JSON.stringify({
          configKey: row.configKey,
          effectiveFrom: row.effectiveFrom,
          citation: row.citation,
          approvedBy: params.adminEmail,
        }),
        ipAddress: params.ipAddress,
      },
    });

    return row;
  });

  // Seal governance approval on SHA-256 Blockchain
  const block = await blockchainService.appendAndPersist({
    recordId: approved.id,
    kind: 'REGULATORY_CONFIG_APPROVAL',
    accountMode: 'SYSTEM',
    accountId: 'REGULATORY_GOVERNANCE',
    userId: params.adminUserId,
    metadata: {
      configKey: approved.configKey,
      effectiveFrom: approved.effectiveFrom,
      citation: approved.citation,
      approvedBy: params.adminEmail,
    },
  });

  return {
    config: { ...approved, payload: JSON.parse(approved.payloadJson) },
    blockchainProof: {
      blockIndex: block.index,
      hash: block.hash,
      timestamp: block.timestamp,
    },
  };
}

export async function rejectRegulatoryDraft(params: {
  configId: string;
  adminUserId: string;
  reason?: string;
  ipAddress?: string;
}) {
  const prisma = getPrisma();
  const existing = await prisma.regulatoryConfig.findUnique({ where: { id: params.configId } });
  if (!existing) {
    const err = new Error('Regulatory draft not found.') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const updated = await prisma.regulatoryConfig.update({
    where: { id: existing.id },
    data: { status: 'REJECTED' },
  });

  await prisma.auditLog.create({
    data: {
      userId: params.adminUserId,
      action: 'REGULATORY_CONFIG_REJECTED',
      entity: 'RegulatoryConfig',
      entityId: updated.id,
      details: JSON.stringify({ configKey: updated.configKey, reason: params.reason || 'Rejected by admin' }),
      ipAddress: params.ipAddress,
    },
  });

  return updated;
}

/**
 * Regulatory Watch daily scanner:
 * Inspects current scrip master lot sizes + pending TO_VERIFY items and opens DRAFT review items.
 * Never auto-applies changes without admin approval.
 */
export async function runRegulatoryWatchScan(triggeredBy: string) {
  await seedBaselineRegulatoryConfigs();
  const prisma = getPrisma();
  const master = await getMasterIndex();

  const findings: Array<{ configKey: string; summary: string; draftCreated: boolean }> = [];

  // 1. Check live NIFTY & SENSEX lot sizes from daily scrip master
  const niftyFut = master.list.find(
    (i) => i.segment === 'FNO' && i.instrumentKind === 'FUTURES' && i.tradingSymbol.startsWith('NIFTY-')
  );
  const sensexFut = master.list.find(
    (i) => i.segment === 'FNO' && i.instrumentKind === 'FUTURES' && i.tradingSymbol.startsWith('SENSEX-')
  );

  const today = new Date().toISOString().slice(0, 10);
  if (niftyFut || sensexFut) {
    const lotPayload = {
      NIFTY: niftyFut?.lotSize ?? null,
      SENSEX: sensexFut?.lotSize ?? null,
      observedAt: new Date().toISOString(),
    };
    const existingLot = await prisma.regulatoryConfig.findFirst({
      where: { configKey: 'exchange.benchmark_lot_sizes', effectiveFrom: today },
    });
    if (!existingLot) {
      await prisma.regulatoryConfig.create({
        data: {
          configKey: 'exchange.benchmark_lot_sizes',
          effectiveFrom: today,
          payloadJson: JSON.stringify(lotPayload),
          verification: 'VERIFIED',
          citation: 'Daily Exchange Scrip Master Synchronization',
          status: 'DRAFT',
        },
      });
      findings.push({
        configKey: 'exchange.benchmark_lot_sizes',
        summary: `Observed benchmark lot sizes (NIFTY=${lotPayload.NIFTY ?? 'n/a'}, SENSEX=${lotPayload.SENSEX ?? 'n/a'}) — queued as DRAFT for admin approval.`,
        draftCreated: true,
      });
    }
  }

  // 2. Flag all TO_VERIFY configs needing official circular confirmation
  const toVerify = await prisma.regulatoryConfig.findMany({
    where: { verification: 'TO_VERIFY', status: 'APPROVED' },
  });
  for (const row of toVerify) {
    findings.push({
      configKey: row.configKey,
      summary: `Marked TO_VERIFY (${row.citation}) — confirm against latest official exchange/SEBI circular.`,
      draftCreated: false,
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: triggeredBy === 'SCHEDULER' ? null : triggeredBy,
      action: 'REGULATORY_WATCH_SCAN',
      entity: 'RegulatoryConfig',
      details: JSON.stringify({ findingsCount: findings.length, scannedSources: OFFICIAL_REGULATORY_SOURCES.length }),
    },
  });

  return {
    scannedAt: new Date().toISOString(),
    sourcesMonitored: OFFICIAL_REGULATORY_SOURCES.length,
    findings,
  };
}

/** User-facing "What's Changed" regulatory notice feed (approved items only). */
export async function getWhatsChangedNotices() {
  await seedBaselineRegulatoryConfigs();
  const prisma = getPrisma();
  const approved = await prisma.regulatoryConfig.findMany({
    where: { status: 'APPROVED' },
    orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }],
    take: 30,
  });

  return approved.map((row) => ({
    id: row.id,
    configKey: row.configKey,
    effectiveFrom: row.effectiveFrom,
    verification: row.verification,
    citation: row.citation,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    payload: JSON.parse(row.payloadJson),
  }));
}

let watchTimer: NodeJS.Timeout | null = null;
let lastScanDate: string | null = null;

export function startRegulatoryWatchScheduler() {
  if (watchTimer) return;
  seedBaselineRegulatoryConfigs().catch(() => {});
  watchTimer = setInterval(() => {
    const session = getMarketSession();
    const hhmm = session.istTime.slice(11, 16);
    if (session.weekday && hhmm === '07:30' && lastScanDate !== session.istDate) {
      lastScanDate = session.istDate;
      runRegulatoryWatchScan('SCHEDULER').catch(() => {});
    }
  }, 60_000);
  watchTimer.unref?.();
}
