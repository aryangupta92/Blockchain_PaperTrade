import { useState } from 'react';

interface BlockTradeLogoProps {
  size?: number;
  showWordmark?: boolean;
  showTagline?: boolean;
}

/**
 * Official BlockTrade Emblem & Wordmark:
 * Uses the studio isometric BT-Candlestick-Breakout icon with crisp rounded bezel
 * and falls back gracefully to the inline SVG mark if needed.
 */
export function BlockTradeLogo({
  size = 34,
  showWordmark = true,
  showTagline = false,
}: BlockTradeLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const iconSrc = size >= 44 ? '/blocktrade-icon-192.png' : '/blocktrade-icon-64.png';
  const radius = Math.max(8, Math.round(size * 0.24));

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size >= 40 ? 12 : 9 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          overflow: 'hidden',
          flexShrink: 0,
          background: '#0b0f17',
          border: '1.5px solid rgba(16, 185, 129, 0.45)',
          boxShadow: '0 2px 10px rgba(16, 185, 129, 0.22), 0 0 0 1px rgba(56, 189, 248, 0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!imgFailed ? (
          <img
            src={iconSrc}
            alt="BlockTrade Logo"
            width={size}
            height={size}
            onError={() => setImgFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <img
            src="/favicon.svg"
            alt="BlockTrade Logo"
            width={size}
            height={size}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        )}
      </div>

      {showWordmark && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: size >= 40 ? 22 : 17,
              letterSpacing: '-0.03em',
              color: 'var(--text-primary)',
            }}
          >
            Block
            <span
              style={{
                background: 'linear-gradient(95deg, #10b981 0%, #38bdf8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Trade
            </span>
          </span>
          {showTagline && (
            <span
              className="mono"
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '0.12em',
                color: 'var(--text-muted)',
                marginTop: 3,
              }}
            >
              SHA-256 VERIFIED INDIAN MARKETS
            </span>
          )}
        </div>
      )}
    </div>
  );
}
