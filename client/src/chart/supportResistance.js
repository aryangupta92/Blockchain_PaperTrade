/**
 * chart/supportResistance.js
 * ---------------------------------------------------------------------------
 * Auto-detects support and resistance levels from OHLCV candle data using the
 * pivot-point method, then clusters nearby pivots into zones.
 */

/**
 * findPivotSR - finds local high/low pivots over a lookback window.
 * @param {Array} candles - [{open, high, low, close, time, volume}]
 * @param {number} lookback - bars each side to qualify as pivot (default: 10)
 * @returns {Array} levels - [{price, type, strength, touchCount, idx}]
 */
export function findPivotSR(candles, lookback = 10) {
  if (!candles || candles.length < lookback * 2 + 1) return [];

  const rawLevels = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const high = candles[i].high;
    const low = candles[i].low;

    const maxHigh = Math.max(...window.map(c => c.high));
    const minLow = Math.min(...window.map(c => c.low));

    if (high === maxHigh) {
      rawLevels.push({ price: high, type: 'resistance', idx: i });
    }
    if (low === minLow) {
      rawLevels.push({ price: low, type: 'support', idx: i });
    }
  }

  return clusterLevels(rawLevels, 0.002);
}

function clusterLevels(rawLevels, tolerance = 0.002) {
  const clusters = [];

  for (const raw of rawLevels) {
    const match = clusters.find(c =>
      c.type === raw.type &&
      Math.abs(c.price - raw.price) / Math.max(c.price, 1e-9) < tolerance
    );
    if (match) {
      match.touchCount++;
      match.price = (match.price * (match.touchCount - 1) + raw.price) / match.touchCount;
      match.idx = raw.idx; // keep latest
    } else {
      clusters.push({ price: raw.price, type: raw.type, idx: raw.idx, touchCount: 1 });
    }
  }

  for (const c of clusters) {
    c.strength = c.touchCount >= 3 ? 3 : c.touchCount >= 2 ? 2 : 1;
  }

  return clusters
    .filter(c => c.touchCount >= 2)
    .sort((a, b) => b.touchCount - a.touchCount)
    .slice(0, 12);
}

/**
 * buildSRZones - pairs nearby same-type levels into zone objects for rendering.
 * Standalone levels (not paired) become single-line zones.
 */
export function buildSRZones(levels) {
  const zones = [];
  const used = new Set();

  for (let i = 0; i < levels.length; i++) {
    if (used.has(i)) continue;
    let paired = false;
    for (let j = i + 1; j < levels.length; j++) {
      if (used.has(j)) continue;
      if (levels[i].type !== levels[j].type) continue;
      const spread = Math.abs(levels[i].price - levels[j].price) / Math.max(levels[i].price, 1e-9);
      if (spread < 0.005) {
        zones.push({
          price1: levels[i].price,
          price2: levels[j].price,
          type: levels[i].type,
          label: levels[i].type === 'support' ? 'First Support Region' : 'First Resistance Region',
          strength: Math.max(levels[i].strength, levels[j].strength),
          touchCount: levels[i].touchCount + levels[j].touchCount,
        });
        used.add(i);
        used.add(j);
        paired = true;
        break;
      }
    }
    if (!paired && !used.has(i)) {
      zones.push({
        price1: levels[i].price,
        price2: null,
        type: levels[i].type,
        label: levels[i].type === 'support' ? 'Support' : 'Resistance',
        strength: levels[i].strength,
        touchCount: levels[i].touchCount,
      });
      used.add(i);
    }
  }

  return zones;
}

/**
 * Convenience: returns { levels, zones } computed from candles.
 */
export function computeSR(candles, lookback = 10) {
  const levels = findPivotSR(candles, lookback);
  const zones = buildSRZones(levels);
  return { levels, zones };
}
