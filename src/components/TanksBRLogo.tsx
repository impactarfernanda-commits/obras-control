interface Props {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}

export function TanksBRLogo({ className, showWordmark = true, size = 32 }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="tbr-half">
            <rect x="0" y="0" width="24" height="48" />
          </clipPath>
        </defs>
        <circle cx="24" cy="24" r="22" fill="#62c191" />
        <g clipPath="url(#tbr-half)">
          <circle cx="24" cy="24" r="22" fill="#4496c9" />
        </g>
      </svg>
      {showWordmark && (
        <span
          className="font-display text-lg font-bold tracking-tight"
          style={{ fontFamily: "Fira Sans, sans-serif" }}
        >
          TanksBR
        </span>
      )}
    </div>
  );
}
