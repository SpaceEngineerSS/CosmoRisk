// App-level actions shared by every panel. Panels call these instead of
// talking to the backend directly, so state stays consistent.

import { api, errorText } from './core/bridge';
import { t } from './core/i18n';
import { bus, select, setBodies, state } from './core/store';
import type { CatalogPreset } from './core/types';
import type { View } from './scene/view';
import { toast } from './ui/toast';

export const ctx = {
  view: null as View | null,
};

/** Simulated days per real second, slowest to fastest. */
export const RATES = [1 / 86400, 1 / 1440, 1 / 24, 0.25, 1, 7, 30.4375, 365.25];

export function rateLabel(rate: number): string {
  const a = Math.abs(rate);
  const sign = rate < 0 ? '−' : '';
  if (a === 0) return '0';
  const exact = (x: number) => Math.abs(a - x) / x < 1e-6;
  if (exact(1 / 86400)) return `${sign}${t('rate.realtime')}`;
  if (exact(1 / 1440)) return `${sign}1 ${t('unit.min')}/s`;
  if (exact(1 / 24)) return `${sign}1 ${t('unit.hour')}/s`;
  if (exact(0.25)) return `${sign}6 ${t('unit.hour')}/s`;
  if (exact(1)) return `${sign}1 ${t('unit.day')}/s`;
  if (exact(7)) return `${sign}1 ${t('unit.week')}/s`;
  if (exact(30.4375)) return `${sign}1 ${t('unit.month')}/s`;
  if (exact(365.25)) return `${sign}1 ${t('unit.year')}/s`;
  return `${sign}${a.toPrecision(3)} ${t('unit.day')}/s`;
}

const busyKeys = new Set<string>();
export function setBusy(key: string, busy: boolean) {
  if (busy) busyKeys.add(key);
  else busyKeys.delete(key);
  bus.emit('busy', { key, busy });
}
export function isBusy(key: string) {
  return busyKeys.has(key);
}

export async function refreshBodies() {
  const [version, list] = await api.bodies();
  const prevSel = state.selected;
  setBodies(version, list);
  // keep the camera on the same object if its index moved
  if (ctx.view && prevSel) {
    const i = state.index.get(prevSel);
    ctx.view.remapFocus(i ?? null);
  }
}

export async function loadPreset(preset: CatalogPreset, limit: number) {
  if (isBusy('catalog')) return;
  setBusy('catalog', true);
  try {
    const r = await api.loadCatalog(preset, limit);
    await refreshBodies();
    toast(t('toast.loaded', { added: r.added, total: r.total_in_sim, available: r.available }), 'ok');
  } catch (e) {
    toast(errorText(e), 'error', t('toast.loadFailed'));
  } finally {
    setBusy('catalog', false);
  }
}

/** Load a single object from SBDB and select it. */
export async function loadDesignation(des: string, opts: { fly?: boolean } = {}) {
  const key = `obj:${des}`;
  if (isBusy(key)) return;
  setBusy(key, true);
  setBusy('lookup', true);
  try {
    const id = await api.loadObject(des);
    await refreshBodies();
    selectBody(id, opts.fly ?? true);
    return id;
  } catch (e) {
    toast(errorText(e), 'error', t('toast.lookupFailed', { des }));
  } finally {
    setBusy(key, false);
    setBusy('lookup', false);
  }
}

export function selectBody(id: string | null, fly = false) {
  select(id);
  const view = ctx.view;
  if (!view) return;
  const i = id ? state.index.get(id) : undefined;
  view.asteroids.setSelected(i ?? -1);
  if (fly && i !== undefined) view.flyTo({ kind: 'body', index: i });
  view.invalidate();
}

export function focusSun() {
  ctx.view?.flyTo({ kind: 'sun' });
}

export function focusEarth() {
  ctx.view?.flyTo({ kind: 'planet', index: 2 });
}

export function focusSelected() {
  const i = state.selected ? state.index.get(state.selected) : undefined;
  if (i !== undefined) ctx.view?.flyTo({ kind: 'body', index: i });
}

// ------------------------------------------------------------------ clock

export async function setPaused(paused: boolean) {
  await api.setPaused(paused);
}

export async function togglePause() {
  await setPaused(!(state.frame?.paused ?? true));
}

export async function setRate(r: number) {
  await api.setRate(r);
}

export async function stepRate(dir: 1 | -1) {
  const cur = state.frame?.rate ?? 1;
  const sign = cur < 0 ? -1 : 1;
  const a = Math.abs(cur);
  let k = RATES.findIndex((x) => x >= a * 0.999);
  if (k < 0) k = RATES.length - 1;
  k = Math.max(0, Math.min(RATES.length - 1, k + dir));
  await api.setRate(sign * RATES[k]);
}

export async function reverse() {
  await api.setRate(-(state.frame?.rate ?? 1));
}

export async function jumpTo(jd: number) {
  try {
    await api.setDate(jd);
    await refreshBodies();
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export async function syncNow() {
  try {
    await api.syncNow();
    await refreshBodies();
    toast(t('toast.synced'), 'ok');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export async function resetSim() {
  await api.reset();
  selectBody(null);
  await refreshBodies();
}

export async function removeBodies(ids: string[]) {
  await api.remove(ids);
  if (state.selected && ids.includes(state.selected)) selectBody(null);
  await refreshBodies();
}
