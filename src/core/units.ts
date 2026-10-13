// Unit conversion and number formatting. One place for all of it.

import * as THREE from 'three';

export const AU_KM = 149_597_870.7;
export const LD_KM = 384_400;
export const EARTH_RADIUS_KM = 6378.137;

export type DistanceUnit = 'km' | 'ld' | 'au';

/**
 * Engine coordinates are heliocentric ecliptic J2000 in AU (x toward the
 * vernal equinox, z to the ecliptic north pole). The scene uses Y up, so
 * ecliptic north maps to +Y and the ecliptic plane is the XZ plane.
 */
export function eclToScene(x: number, y: number, z: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, z, -y);
}

export function writeScene(arr: Float32Array, i: number, x: number, y: number, z: number): void {
  arr[i] = x;
  arr[i + 1] = z;
  arr[i + 2] = -y;
}

let locale = 'en';
export function setNumberLocale(l: string) {
  locale = l === 'tr' ? 'tr-TR' : 'en-GB';
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Significant-figure formatting that switches to scientific notation for extremes. */
export function sig(n: number | null | undefined, s = 3): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e6 || a < 1e-3) return expo(n, s - 1);
  const digits = Math.max(0, s - 1 - Math.floor(Math.log10(a)));
  return n.toLocaleString(locale, { maximumFractionDigits: digits });
}

/** 1.23×10⁻⁵ */
export function expo(n: number, digits = 2): string {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0';
  const [m, e] = n.toExponential(digits).split('e');
  const sup = e.replace('+', '').replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);
  const mant = Number(m).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${mant}×10${sup}`;
}

export function distance(km: number | null | undefined, unit: DistanceUnit): string {
  if (km === null || km === undefined || !isFinite(km)) return '—';
  switch (unit) {
    case 'ld':
      return `${sig(km / LD_KM, 3)} LD`;
    case 'au':
      return `${sig(km / AU_KM, 4)} AU`;
    default:
      return km >= 1e7 ? `${expo(km, 2)} km` : `${fmt(km, 0)} km`;
  }
}

export function diameter(km: number): string {
  if (!isFinite(km)) return '—';
  return km < 1 ? `${fmt(km * 1000, 0)} m` : `${sig(km, 3)} km`;
}

export function mass(kg: number): string {
  if (!isFinite(kg)) return '—';
  return `${expo(kg, 1)} kg`;
}

export function energy(mt: number): string {
  if (!isFinite(mt)) return '—';
  if (mt < 1e-3) return `${sig(mt * 1e6, 3)} t TNT`;
  if (mt < 1) return `${sig(mt * 1e3, 3)} kt`;
  if (mt >= 1e6) return `${expo(mt, 1)} Mt`;
  return `${sig(mt, 3)} Mt`;
}

export function probability(p: number): string {
  if (!isFinite(p)) return '—';
  if (p === 0) return '0';
  if (p >= 1e-3) return `${fmt(p * 100, p >= 0.1 ? 1 : 2)} %`;
  return expo(p, 1);
}

export function speed(kms: number): string {
  return `${fmt(kms, 2)} km/s`;
}

export function velocityChange(ms: number): string {
  if (!isFinite(ms)) return '—';
  if (Math.abs(ms) < 0.01) return `${fmt(ms * 1000, 2)} mm/s`;
  if (Math.abs(ms) < 1) return `${fmt(ms * 100, 2)} cm/s`;
  return `${fmt(ms, 2)} m/s`;
}

export function angleDeg(d: number): string {
  return `${fmt(d, 2)}°`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
