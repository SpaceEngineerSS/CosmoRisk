// User preferences, kept in localStorage. Storage can be unavailable; the
// app must work with the defaults in that case.

import type { DistanceUnit } from './units';
import { bus } from './store';

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Lang = 'en' | 'tr';
export type Theme = 'dark' | 'light';

export interface Settings {
  lang: Lang;
  theme: Theme;
  quality: Quality;
  unit: DistanceUnit;
  labels: boolean;
  planetOrbits: boolean;
  grid: boolean;
  reduceMotion: boolean;
  seenIntro: boolean;
}

const KEY = 'cosmorisk.settings.v3';

function defaults(): Settings {
  const lang: Lang = (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  return {
    lang,
    theme: 'dark',
    quality: 'auto',
    unit: 'km',
    labels: true,
    planetOrbits: true,
    grid: false,
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    seenIntro: false,
  };
}

function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...JSON.parse(raw) };
  } catch {
    /* storage blocked */
  }
  return base;
}

export const settings: Settings = load();

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  bus.emit('settings', undefined);
}
