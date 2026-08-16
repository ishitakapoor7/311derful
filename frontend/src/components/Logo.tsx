interface LogoProps {
  /** Height of the mark in px. The wordmark scales with it. */
  size?: number
  withWordmark?: boolean
}

/**
 * The 311derful mark, rebuilt as inline SVG so it stays crisp at any size and
 * needs no asset pipeline. If you'd rather ship the original raster, drop it at
 * frontend/public/logo.png and swap the <svg> for an <img>.
 */
export function Logo({ size = 30, withWordmark = true }: LogoProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.34 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        role="img"
        aria-label="311derful"
        style={{ display: 'block', flexShrink: 0 }}
      >
        <defs>
          <clipPath id="logo-clip">
            <rect width="64" height="64" rx="15" />
          </clipPath>
        </defs>
        <g clipPath="url(#logo-clip)">
          <rect width="64" height="64" fill="#1a1a22" />
          <rect y="52" width="64" height="12" fill="#6455c0" />
          <rect x="17" y="11" width="30" height="4.5" rx="2.25" fill="#3d3d49" />
          <text
            x="32"
            y="43"
            textAnchor="middle"
            fill="#ffffff"
            fontFamily="'Inter', system-ui, Helvetica, Arial, sans-serif"
            fontSize="25"
            fontWeight="800"
            letterSpacing="-0.5"
          >
            311
          </text>
        </g>
      </svg>
      {withWordmark && (
        <span
          style={{
            fontSize: size * 0.72,
            fontWeight: 800,
            letterSpacing: '-0.035em',
            color: 'var(--ink)',
          }}
        >
          311derful
        </span>
      )}
    </span>
  )
}
