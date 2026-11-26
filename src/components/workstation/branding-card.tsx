"use client";

const DOTS = [
  { cx: 30, cy: 96, r: 2.4, o: 0.85, d: "0s" },
  { cx: 62, cy: 78, r: 1.8, o: 0.55, d: "0.6s" },
  { cx: 92, cy: 102, r: 2.8, o: 0.9, d: "1.1s" },
  { cx: 118, cy: 70, r: 1.6, o: 0.4, d: "1.7s" },
  { cx: 150, cy: 88, r: 2.2, o: 0.75, d: "0.3s" },
  { cx: 178, cy: 66, r: 1.9, o: 0.5, d: "1.4s" },
  { cx: 205, cy: 96, r: 2.6, o: 0.85, d: "0.9s" },
  { cx: 232, cy: 74, r: 1.7, o: 0.45, d: "2s" },
  { cx: 258, cy: 100, r: 2.3, o: 0.8, d: "0.5s" },
  { cx: 285, cy: 72, r: 1.9, o: 0.55, d: "1.2s" },
  { cx: 312, cy: 94, r: 2.5, o: 0.85, d: "1.8s" },
  { cx: 338, cy: 76, r: 1.6, o: 0.4, d: "0.7s" },
  { cx: 362, cy: 98, r: 2.2, o: 0.7, d: "1.5s" },
  { cx: 46, cy: 60, r: 1.5, o: 0.35, d: "2.2s" },
  { cx: 138, cy: 52, r: 1.4, o: 0.3, d: "1.9s" },
  { cx: 226, cy: 56, r: 1.5, o: 0.35, d: "0.8s" },
  { cx: 305, cy: 58, r: 1.4, o: 0.3, d: "1.6s" },
  { cx: 375, cy: 62, r: 1.6, o: 0.4, d: "0.4s" },
];

export function BrandingCard() {
  return (
    <div
      aria-hidden="true"
      className="relative h-36 shrink-0 overflow-hidden rounded-2xl border border-[#253548] bg-[#0f1a28]"
    >
      <svg
        viewBox="0 0 400 144"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id="waveA" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0" />
            <stop offset="35%" stopColor="#2dd4bf" stopOpacity="0.7" />
            <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="waveB" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0" />
            <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="0.45" r="0.65">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="400" height="144" fill="url(#glow)" />

        <g className="wave-path">
          <path
            d="M-10 92 Q 60 58 130 88 T 270 84 T 410 90"
            fill="none"
            stroke="url(#waveA)"
            strokeWidth="2.2"
          />
        </g>
        <path
          d="M-10 108 Q 70 82 150 104 T 300 100 T 410 106"
          fill="none"
          stroke="url(#waveB)"
          strokeWidth="1.6"
          opacity="0.7"
        />
        <path
          d="M-10 76 Q 80 46 160 72 T 320 66 T 410 74"
          fill="none"
          stroke="url(#waveB)"
          strokeWidth="1.1"
          opacity="0.35"
        />

        {DOTS.map((dot, i) => (
          <circle
            key={i}
            className="wave-dot"
            style={{ animationDelay: dot.d }}
            cx={dot.cx}
            cy={dot.cy}
            r={dot.r}
            fill={i % 3 === 0 ? "#38bdf8" : "#2dd4bf"}
            opacity={dot.o}
          />
        ))}
      </svg>

      <div className="absolute bottom-0 left-0 p-4">
        <p className="text-[15px] leading-6 text-[#8fa3b8]">AI for</p>
        <p className="-mt-0.5 text-[19px] font-bold leading-7 text-white">
          a healthier tomorrow
        </p>
        <p className="mt-0.5 text-[11px] text-[#5a6e82]">Boali Hospital</p>
      </div>
    </div>
  );
}
