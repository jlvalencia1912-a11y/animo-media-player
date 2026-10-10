interface LogoProps {
  size?: number;
  showWordmark?: boolean;
}

export function Logo({ size = 36, showWordmark = true }: LogoProps) {
  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-label="Animo Media Player logo"
        role="img"
      >
        <defs>
          <linearGradient id="amp-grad" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="50%" stopColor="#7c6cf5" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="16" fill="#12121c" />
        <rect
          x="2"
          y="2"
          width="60"
          height="60"
          rx="16"
          stroke="url(#amp-grad)"
          strokeWidth="2"
        />
        {/* Waveform bars forming a subtle "A" silhouette */}
        <rect x="14" y="26" width="5" height="14" rx="2.5" fill="url(#amp-grad)" opacity="0.75" />
        <rect x="22" y="18" width="5" height="28" rx="2.5" fill="url(#amp-grad)" />
        <rect x="30" y="10" width="5" height="44" rx="2.5" fill="url(#amp-grad)" />
        <rect x="38" y="18" width="5" height="28" rx="2.5" fill="url(#amp-grad)" />
        <rect x="46" y="26" width="5" height="14" rx="2.5" fill="url(#amp-grad)" opacity="0.75" />
      </svg>
      {showWordmark && (
        <div className="leading-tight">
          <div className="gradient-text font-display text-lg font-semibold tracking-tight">
            Animo
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Media Player
          </div>
        </div>
      )}
    </div>
  );
}
