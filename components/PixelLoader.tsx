"use client";

import { useEffect, useState } from "react";

// 3x3 grid, one wavefront: the middle row lights first, top/bottom rows
// trail by one 90ms beat — reads as a chevron sweeping right. The 650ms
// loop is shorter than the full sweep, so two wavefronts are always
// mid-flight. Concept adapted from beautifui.dev's pixel-grid loader,
// rebuilt against Fantis's own CSS variables (no Tailwind in this app).
const DELAYS = [1, 2, 3, 0, 1, 2, 1, 2, 3].map((step) => step * 90);

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export default function PixelLoader({
  label,
  showElapsed = false,
  tone = "default",
}: {
  label: string;
  showElapsed?: boolean;
  tone?: "default" | "onAccent";
}) {
  const elapsed = useElapsed();
  return (
    <span className={`pixelloader ${tone === "onAccent" ? "on-accent" : ""}`}>
      <span className="pixelloadergrid" aria-hidden>
        {DELAYS.map((d, i) => (
          <span key={i} className="pixelloadercell" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span className="pixelloaderlabel">{label}</span>
      {showElapsed && <span className="pixelloaderelapsed">{elapsed}</span>}
    </span>
  );
}
