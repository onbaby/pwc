import { forwardRef } from "react";
import qrcode from "qrcode-generator";
import { fmtDay } from "../format.ts";

/** A QR code as an SVG path (one dark module per square), with the standard 4-module quiet zone. */
export function QrPath({ text, x, y, size }: { text: string; x: number; y: number; size: number }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / (n + 8);
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${x + (c + 4) * cell} ${y + (r + 4) * cell}h${cell}v${cell}h${-cell}z`;
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#FFFFFF" />
      <path d={d} fill="#1C1C1C" shapeRendering="crispEdges" />
    </g>
  );
}

/**
 * The back-of-bag label for retail (grocery) bags: roast date up front, and a QR code that opens the bag's own page
 * ("how fresh is this bag?") with a subscription roasted to order. Drawn as one SVG so it can be downloaded for print.
 */
export const BagLabel = forwardRef<SVGSVGElement, { url: string; lot: string; roast: string; roastDate: number }>(function BagLabel({ url, lot, roast, roastDate }, ref) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 420" width="320" height="420" role="img" aria-label={`Bag label for lot ${lot}: roasted ${fmtDay(roastDate)}, with a QR code`} style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <rect x="0.5" y="0.5" width="319" height="419" rx="14" fill="#FBF6F1" stroke="#E9DFD6" />
      <rect x="0" y="0" width="320" height="64" rx="14" fill="#643A2B" />
      <rect x="0" y="40" width="320" height="24" fill="#643A2B" />
      <text x="20" y="32" fontSize="20" fontWeight="600" fill="#FBF6F1">Classic Cup</text>
      <text x="20" y="52" fontSize="12" fill="#FBF6F1" opacity="0.85">Small-batch roasted in Athens, GA</text>
      <text x="20" y="94" fontSize="18" fontWeight="600" fill="#1C1C1C">{roast}</text>
      <text x="20" y="122" fontSize="12" fill="#6B5A50">ROASTED ON</text>
      <text x="20" y="146" fontSize="22" fontWeight="600" fill="#643A2B">{fmtDay(roastDate)}</text>
      <text x="20" y="168" fontSize="12" fill="#6B5A50">Best within 2–4 weeks of roasting</text>
      <QrPath text={url} x={20} y={186} size={150} />
      <text x="184" y="212" fontSize="14" fontWeight="600" fill="#1C1C1C">How fresh is</text>
      <text x="184" y="230" fontSize="14" fontWeight="600" fill="#1C1C1C">this bag?</text>
      <text x="184" y="256" fontSize="12" fill="#1C1C1C">Scan to see. Then get</text>
      <text x="184" y="272" fontSize="12" fill="#1C1C1C">it roasted to order,</text>
      <text x="184" y="288" fontSize="12" fill="#1C1C1C">at your door 5 days</text>
      <text x="184" y="304" fontSize="12" fill="#1C1C1C">after roasting, timed</text>
      <text x="184" y="320" fontSize="12" fill="#1C1C1C">to when you run out.</text>
      <line x1="20" y1="356" x2="300" y2="356" stroke="#E9DFD6" />
      <text x="20" y="380" fontSize="11" fill="#6B5A50">Lot {lot}</text>
      <text x="20" y="398" fontSize="11" fill="#6B5A50">12 oz · whole bean</text>
      <text x="300" y="398" fontSize="11" fill="#6B5A50" textAnchor="end">No app needed</text>
    </svg>
  );
});

/** Save an SVG element as a file (for the print shop). */
export function downloadSvg(el: SVGSVGElement | null, filename: string): void {
  if (!el) return;
  const blob = new Blob([new XMLSerializer().serializeToString(el)], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
