// Small canvas charts drawn with the current theme's colours.

import type { Encounter } from '../core/types';
import { EARTH_RADIUS_KM, LD_KM, sig } from '../core/units';

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function setup(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 120;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = `10px ${css('--font-data')}`;
  return { g, w, h };
}

/**
 * Histogram of closest-approach distances on a log axis, in lunar distances.
 * Impacts (distance < Earth radius) are drawn as a red bar at the left edge.
 */
export function drawMissHistogram(canvas: HTMLCanvasElement, distancesKm: number[]) {
  const { g, w, h } = setup(canvas);
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const fg = css('--fg-2');
  const line = css('--line-2');
  const accent = css('--accent');
  const bad = css('--bad');
  if (!distancesKm.length) return;
  const ld = distancesKm.map((d) => Math.max(1e-3, d / LD_KM));
  let lo = Math.floor(Math.log10(Math.min(...ld)));
  let hi = Math.ceil(Math.log10(Math.max(...ld)));
  if (hi - lo < 2) {
    lo -= 1;
    hi += 1;
  }
  const bins = 40;
  const counts = new Array(bins).fill(0);
  for (const v of ld) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((Math.log10(v) - lo) / (hi - lo)) * bins)));
    counts[k]++;
  }
  const max = Math.max(...counts);
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const earthLd = EARTH_RADIUS_KM / LD_KM;
  // axis
  g.strokeStyle = line;
  g.beginPath();
  g.moveTo(pad.l, h - pad.b + 0.5);
  g.lineTo(w - pad.r, h - pad.b + 0.5);
  g.stroke();
  g.fillStyle = fg;
  g.textAlign = 'center';
  for (let e = lo; e <= hi; e++) {
    const x = pad.l + ((e - lo) / (hi - lo)) * pw;
    g.fillRect(Math.round(x), h - pad.b, 1, 4);
    g.textAlign = e === lo ? 'left' : e === hi ? 'right' : 'center';
    const label = e === 0 ? '1' : `10${e < 0 ? '⁻' : ''}${'⁰¹²³⁴⁵⁶⁷⁸⁹'[Math.abs(e)]}`;
    g.fillText(e === hi ? `${label} LD` : label, x, h - 4);
  }
  // Earth radius marker
  const xe = pad.l + ((Math.log10(earthLd) - lo) / (hi - lo)) * pw;
  if (xe > pad.l && xe < w - pad.r) {
    g.strokeStyle = bad;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(Math.round(xe) + 0.5, pad.t);
    g.lineTo(Math.round(xe) + 0.5, h - pad.b);
    g.stroke();
    g.setLineDash([]);
  }
  // bars
  const bw = pw / bins;
  for (let k = 0; k < bins; k++) {
    if (!counts[k]) continue;
    const bh = Math.max(1, (counts[k] / max) * ph);
    const x0 = pad.l + k * bw;
    const center = Math.pow(10, lo + ((k + 0.5) / bins) * (hi - lo));
    g.fillStyle = center < earthLd ? bad : accent;
    g.globalAlpha = 0.85;
    g.fillRect(x0 + 0.5, h - pad.b - bh, Math.max(1, bw - 1), bh);
  }
  g.globalAlpha = 1;
}

/**
 * Target-plane (b-plane) view: Earth's capture disc and the encounter points
 * before and after deflection.
 */
export function drawBPlane(canvas: HTMLCanvasElement, before: Encounter | null, after: Encounter | null) {
  const { g, w, h } = setup(canvas);
  const fg = css('--fg-2');
  const fg0 = css('--fg-0');
  const line = css('--line');
  const accent = css('--accent');
  const ok = css('--ok');
  const bad = css('--bad');
  const cx = w / 2;
  const cy = h / 2;
  const pts = [before, after].filter(Boolean) as Encounter[];
  const capture = pts[0]?.capture_radius_km ?? EARTH_RADIUS_KM;
  const extent = Math.max(capture * 3, ...pts.map((p) => Math.hypot(p.b_plane_km[0], p.b_plane_km[1]) * 1.25));
  const s = (Math.min(w, h) / 2 - 14) / extent;

  // grid
  g.strokeStyle = line;
  g.beginPath();
  g.moveTo(0, cy + 0.5);
  g.lineTo(w, cy + 0.5);
  g.moveTo(cx + 0.5, 0);
  g.lineTo(cx + 0.5, h);
  g.stroke();
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.fillText('ξ', w - 12, cy - 4);
  g.fillText('ζ', cx + 4, 10);

  // capture disc and physical Earth
  g.strokeStyle = bad;
  g.setLineDash([3, 3]);
  g.beginPath();
  g.arc(cx, cy, capture * s, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = fg0;
  g.globalAlpha = 0.18;
  g.beginPath();
  g.arc(cx, cy, Math.max(2, EARTH_RADIUS_KM * s), 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  // A is drawn hollow and labelled on the left, B filled on the right, so
  // both stay readable when a small push barely moves the point.
  const dot = (e: Encounter, color: string, label: string, hollow: boolean) => {
    const x = Math.round(cx + e.b_plane_km[0] * s);
    const y = Math.round(cy - e.b_plane_km[1] * s);
    if (hollow) {
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.strokeRect(x - 4.5, y - 4.5, 9, 9);
      g.lineWidth = 1;
      g.fillStyle = color;
      g.textAlign = 'right';
      g.fillText(label, x - 8, y + 3);
    } else {
      g.fillStyle = color;
      g.fillRect(x - 2.5, y - 2.5, 5, 5);
      g.textAlign = 'left';
      g.fillText(label, x + 8, y + 3);
    }
  };
  if (before) dot(before, accent, 'A', true);
  if (after) dot(after, ok, 'B', false);
  if (before && after) {
    g.strokeStyle = fg;
    g.setLineDash([2, 2]);
    g.beginPath();
    g.moveTo(cx + before.b_plane_km[0] * s, cy - before.b_plane_km[1] * s);
    g.lineTo(cx + after.b_plane_km[0] * s, cy - after.b_plane_km[1] * s);
    g.stroke();
    g.setLineDash([]);
  }
  // scale
  g.fillStyle = fg;
  g.textAlign = 'right';
  g.fillText(`±${sig(extent, 2)} km`, w - 6, h - 6);
}
