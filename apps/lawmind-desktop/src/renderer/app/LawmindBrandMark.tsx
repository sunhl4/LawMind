import { useId } from "react";

export function LawmindBrandMark({ size = 28 }: { size?: number }) {
  const rawId = useId().replace(/:/g, "");
  const inkId = `lm-mark-ink-${rawId}`;
  const brassId = `lm-mark-brass-${rawId}`;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={inkId} x1="7" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2c3038" />
          <stop offset="1" stopColor="#12141a" />
        </linearGradient>
        <linearGradient id={brassId} x1="8" y1="8" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e6cc94" />
          <stop offset=".42" stopColor="#c4a06e" />
          <stop offset="1" stopColor="#8a6540" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.2" fill={`url(#${inkId})`} />
      <rect
        x="1.35"
        y="1.35"
        width="29.3"
        height="29.3"
        rx="6.1"
        fill="none"
        stroke="#c4a06e"
        strokeOpacity=".5"
        strokeWidth=".7"
      />
      <path fill={`url(#${brassId})`} d="M6.15 22.85V9.2h2.55v10.95h5.55v2.7H6.15z" />
      <path
        fill={`url(#${brassId})`}
        d="M15.35 22.85V9.2h2.5l2.2 6.2 2.2-6.2h2.5v13.65h-2.35v-7.7l-2.35 5.55-2.35-5.55v7.7h-2.35z"
      />
    </svg>
  );
}
