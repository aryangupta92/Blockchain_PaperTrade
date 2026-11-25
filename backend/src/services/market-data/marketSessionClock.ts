import { resolveRegulatoryConfig } from '@broker/shared';

export type ExchangeSessionPhase =
  | 'PRE_OPEN'
  | 'OPEN'
  | 'POST_CLOSE'
  | 'CLOSED'
  | 'WEEKEND'
  | 'HOLIDAY'
  | 'SPECIAL_SESSION';

export interface MarketSessionSnapshot {
  istTime: string;
  istDate: string;
  weekday: boolean;
  equityAndFno: {
    phase: ExchangeSessionPhase;
    isTradable: boolean;
    amoAllowed: boolean;
    hoursIST: string;
  };
  commoditiesMcx: {
    phase: ExchangeSessionPhase;
    isTradable: boolean;
    amoAllowed: boolean;
    hoursIST: string;
  };
  holidayName: string | null;
}

// Effective-dated NSE/BSE holiday calendar (admin-updatable via Regulatory Watch in Phase 8)
// Marked TO_VERIFY annually against official NSE/BSE circulars.
const HOLIDAYS_2026: Record<string, string> = {
  '2026-01-26': 'Republic Day',
  '2026-03-03': 'Holi (TO_VERIFY)',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-08-15': 'Independence Day',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-12-25': 'Christmas',
};

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function getMarketSession(now = new Date()): MarketSessionSnapshot {
  const cfg = resolveRegulatoryConfig(now).tradingHours.value;
  // Convert to IST (+05:30)
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const istDate = ist.toISOString().slice(0, 10);
  const weekday = day >= 1 && day <= 5;
  const holidayName = HOLIDAYS_2026[istDate] || null;

  let eqPhase: ExchangeSessionPhase = 'CLOSED';
  let mcxPhase: ExchangeSessionPhase = 'CLOSED';

  if (holidayName) {
    eqPhase = 'HOLIDAY';
    mcxPhase = 'HOLIDAY';
  } else if (!weekday) {
    eqPhase = 'WEEKEND';
    mcxPhase = 'WEEKEND';
  } else {
    const preOpenStart = parseHm(cfg.equityPreOpenStartIST);
    const eqOpen = parseHm(cfg.equityOpenIST);
    const eqClose = parseHm(cfg.equityCloseIST);
    const postCloseEnd = parseHm(cfg.equityPostCloseEndIST);

    if (mins >= preOpenStart && mins < eqOpen) eqPhase = 'PRE_OPEN';
    else if (mins >= eqOpen && mins <= eqClose) eqPhase = 'OPEN';
    else if (mins > eqClose && mins <= postCloseEnd) eqPhase = 'POST_CLOSE';
    else eqPhase = 'CLOSED';

    const mcxOpen = parseHm(cfg.mcxOpenIST);
    const mcxClose = parseHm(cfg.mcxCloseIST);
    mcxPhase = mins >= mcxOpen && mins <= mcxClose ? 'OPEN' : 'CLOSED';
  }

  return {
    istTime: ist.toISOString().replace('Z', '+05:30'),
    istDate,
    weekday,
    equityAndFno: {
      phase: eqPhase,
      isTradable: eqPhase === 'OPEN',
      amoAllowed: eqPhase !== 'OPEN',
      hoursIST: `${cfg.equityOpenIST}–${cfg.equityCloseIST} IST`,
    },
    commoditiesMcx: {
      phase: mcxPhase,
      isTradable: mcxPhase === 'OPEN',
      amoAllowed: mcxPhase !== 'OPEN',
      hoursIST: `${cfg.mcxOpenIST}–${cfg.mcxCloseIST} IST`,
    },
    holidayName,
  };
}
