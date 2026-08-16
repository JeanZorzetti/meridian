import { useEffect, useMemo, useRef } from "react";
import { animate, svg } from "animejs";

/**
 * Signature element: a net-worth curve that draws itself on load.
 * SVG line + faint mint area fill, Catmull-Rom smoothed, terminal-grade.
 */

const DEFAULT_SERIES = [58, 61, 60, 66, 72, 70, 78, 85, 83, 96, 108, 128];
const MONTHS = ["JAN", "MAR", "MAY", "JUL", "SEP", "NOV"];

const W = 560;
const H = 260;
const PAD_X = 6;
const PAD_TOP = 22;
const PAD_BOT = 30;

function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return "";
  const d = [`M ${pts[0].x},${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
  }
  return d.join(" ");
}

export default function NetWorthChart({
  data = DEFAULT_SERIES,
}: {
  data?: number[];
}) {
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);

  const { linePath, areaPath, last } = useMemo(() => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const innerH = H - PAD_TOP - PAD_BOT;
    const pts = data.map((v, i) => ({
      x: PAD_X + (i / (data.length - 1)) * (W - PAD_X * 2),
      y: PAD_TOP + (1 - (v - min) / span) * innerH,
    }));
    const line = smoothPath(pts);
    const area = `${line} L ${pts[pts.length - 1].x},${H - PAD_BOT} L ${pts[0].x},${H - PAD_BOT} Z`;
    return { linePath: line, areaPath: area, last: pts[pts.length - 1] };
  }, [data]);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // paths render in their final state via markup

    if (areaRef.current) areaRef.current.style.opacity = "0";
    if (dotRef.current) dotRef.current.style.opacity = "0";

    const [drawable] = svg.createDrawable(line);
    animate(drawable, {
      draw: ["0 0", "0 1"],
      duration: 1900,
      ease: "inOutQuad",
    });
    if (areaRef.current) {
      animate(areaRef.current, {
        opacity: [0, 1],
        duration: 900,
        delay: 850,
        ease: "outQuad",
      });
    }
    if (dotRef.current) {
      animate(dotRef.current, {
        r: [0, 4],
        opacity: [0, 1],
        duration: 500,
        delay: 1750,
        ease: "outBack",
      });
    }
  }, [linePath]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label="Net worth trending upward over the last twelve months"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="nw-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3ecf8e" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#3ecf8e" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path ref={areaRef} d={areaPath} fill="url(#nw-area)" />
      <path
        ref={lineRef}
        d={linePath}
        fill="none"
        stroke="#3ecf8e"
        strokeWidth="1.75"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle ref={dotRef} cx={last.x} cy={last.y} r="4" fill="#3ecf8e" />
      <circle cx={last.x} cy={last.y} r="4" fill="#3ecf8e" opacity="0.28">
        <animate
          attributeName="r"
          values="4;9;4"
          dur="2.6s"
          begin="2.2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.28;0;0.28"
          dur="2.6s"
          begin="2.2s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

export { MONTHS };
