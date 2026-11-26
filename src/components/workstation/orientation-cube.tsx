"use client";

/** Isometric orientation cube with radiological letters (S/I/R/L/A/P). */
export function OrientationCube({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 46"
      className={className}
      aria-label="Orientation cube"
      role="img"
    >
      {/* wireframe */}
      <g stroke="#9db0c3" strokeWidth="1.1" fill="none" opacity="0.9">
        {/* hexagon outline */}
        <path d="M22 3 L37 12 L37 31 L22 40 L7 31 L7 12 Z" />
        {/* inner edges */}
        <path d="M22 3 L22 21.5 L37 12 M22 21.5 L7 12 M22 21.5 L22 40 M22 21.5 L37 31 M22 21.5 L7 31" />
      </g>
      {/* subtle face fills */}
      <path d="M22 3 L37 12 L22 21.5 L7 12 Z" fill="#94a3b8" opacity="0.14" />
      <path d="M22 21.5 L37 31 L22 40 L7 31 Z" fill="#94a3b8" opacity="0.07" />

      {/* letters */}
      <g fill="#dbe5ee" fontSize="6.5" fontFamily="ui-monospace, monospace" fontWeight="600">
        <text x="22" y="9.4" textAnchor="middle">S</text>
        <text x="22" y="37.5" textAnchor="middle">I</text>
        <text x="33.5" y="23" textAnchor="middle">R</text>
        <text x="10.5" y="23" textAnchor="middle">L</text>
        <text x="22" y="16.8" textAnchor="middle" fill="#7c8ea3">A</text>
        <text x="22" y="31.5" textAnchor="middle" fill="#7c8ea3">P</text>
      </g>
    </svg>
  );
}
