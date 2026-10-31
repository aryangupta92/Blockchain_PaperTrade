import { useId } from 'react';

// BlockTrade mark: ascending candles + a golden breakout arrow on an indigo tile.
export default function BrandLogo({ size = 34, className = '', title = 'BlockTrade' }) {
  const uid = useId().replace(/:/g, '');
  const grad = `bt-logo-${uid}`;
  const glow = `bt-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#7c5cf0" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <radialGradient id={glow} cx="0.22" cy="0.18" r="0.75">
          <stop stopColor="#fff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="40" height="40" rx="11" fill={`url(#${grad})`} />
      <rect width="40" height="40" rx="11" fill={`url(#${glow})`} />
      <rect x="1" y="1" width="38" height="38" rx="10" fill="none" stroke="#fff" strokeOpacity="0.16" />

      <g stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.34">
        <line x1="11.5" y1="20" x2="11.5" y2="32.5" />
        <line x1="20" y1="16" x2="20" y2="32.5" />
        <line x1="28.5" y1="12" x2="28.5" y2="32.5" />
      </g>

      <g fill="#fff">
        <rect x="9" y="23" width="5" height="6.5" rx="1.4" fillOpacity="0.62" />
        <rect x="17.5" y="19" width="5" height="10.5" rx="1.4" fillOpacity="0.82" />
        <rect x="26" y="14" width="5" height="15.5" rx="1.4" />
      </g>

      <path
        d="M9.5 17.5 L16.5 13 L22 15 L30.5 7.5"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M26.5 7.5 H30.5 V11.5"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
