// Typed wrappers around the Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  BodyDetail,
  BodyInfo,
  CatalogPreset,
  CloseApproach,
  Deflection,
  DeflectionPlan,
  Frame,
  LoadResult,
  PlanetInfo,
  RiskReport,
  ScanSummary,
  ScenarioInfo,
  SentryDetail,
  SentryEntry,
  SimEvent,
} from './types';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Turn whatever a command rejected with into a readable message. */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function parseFrame(buf: ArrayBuffer): Frame {
  const dv = new DataView(buf);
  const nPlanets = dv.getUint32(28, true);
  const nBodies = dv.getUint32(32, true);
  const head = 40;
  return {
    jd: dv.getFloat64(0, true),
    rate: dv.getFloat64(8, true),
    version: dv.getUint32(16, true),
    eventSeq: dv.getUint32(20, true),
    paused: dv.getUint32(24, true) !== 0,
    stepMs: dv.getFloat32(36, true),
    planets: new Float64Array(buf, head, nPlanets * 3),
    bodies: new Float64Array(buf, head + nPlanets * 24, nBodies * 3),
    received: performance.now(),
  };
}

export const api = {
  async frame(): Promise<Frame> {
    const buf = await invoke<ArrayBuffer>('get_frame');
    return parseFrame(buf);
  },
  bodies: () => invoke<[number, BodyInfo[]]>('get_bodies'),
  planets: () => invoke<PlanetInfo[]>('get_planets'),
  detail: (id: string) => invoke<BodyDetail>('get_body_detail', { id }),
  orbitPath: (id: string, samples = 256) => invoke<number[]>('get_orbit_path', { id, samples }),
  moonOrbit: () => invoke<number[]>('moon_orbit'),

  setPaused: (paused: boolean) => invoke<void>('set_paused', { paused }),
  setRate: (daysPerSecond: number) => invoke<void>('set_rate', { daysPerSecond }),
  setDate: (jd: number) => invoke<void>('set_date', { jd }),
  syncNow: () => invoke<number>('sync_now'),
  reset: () => invoke<void>('reset_simulation'),
  remove: (ids: string[]) => invoke<void>('remove_bodies', { ids }),
  takeEvents: () => invoke<[number, SimEvent[]]>('take_events'),

  loadCatalog: (preset: CatalogPreset, limit: number, offset = 0) =>
    invoke<LoadResult>('load_catalog', { preset, limit, offset }),
  loadObject: (designation: string) => invoke<string>('load_object', { designation }),
  cachedInfo: () => invoke<{ objects: number; saved_unix: number } | null>('cached_catalog_info'),
  restoreCache: () => invoke<number>('restore_cached_catalog'),
  upcoming: (days: number, distMaxAu: number) =>
    invoke<CloseApproach[]>('upcoming_close_approaches', { days, distMaxAu }),
  objectApproaches: (designation: string, years: number) =>
    invoke<CloseApproach[]>('object_close_approaches', { designation, years }),
  sentryList: (refresh = false) =>
    invoke<{ items: SentryEntry[]; fetched_unix: number; stale: boolean }>('sentry_list', { refresh }),
  sentryDetail: (designation: string) => invoke<SentryDetail>('sentry_detail', { designation }),

  scan: (id: string, years: number) => invoke<ScanSummary>('scan_approaches', { id, years }),
  planDeflection: (id: string, deflection: Deflection, years: number) =>
    invoke<DeflectionPlan>('plan_deflection', { id, deflection, years }),
  applyDeflection: (id: string, deflection: Deflection) => invoke<number>('apply_deflection', { id, deflection }),
  monteCarlo: (
    id: string,
    samples: number,
    years: number,
    mode: { mode: 'covariance' } | { mode: 'isotropic'; pos_km: number; vel_ms: number },
  ) => invoke<RiskReport>('run_monte_carlo', { id, samples, years, mode }),
  cancelMonteCarlo: () => invoke<void>('cancel_monte_carlo'),

  saveScenario: (name: string, notes?: string) => invoke<ScenarioInfo>('save_scenario', { name, notes }),
  listScenarios: () => invoke<ScenarioInfo[]>('list_scenarios'),
  loadScenario: (name: string) => invoke<void>('load_scenario', { name }),
  deleteScenario: (name: string) => invoke<void>('delete_scenario', { name }),
  exportScenario: (name: string) => invoke<string>('export_scenario', { name }),
  importScenario: (json: string) => invoke<string>('import_scenario', { json }),

  writeText: (path: string, contents: string) => invoke<void>('write_text_file', { path, contents }),
  readText: (path: string) => invoke<string>('read_text_file', { path }),
  writeBinary: (path: string, bytes: Uint8Array) =>
    invoke<void>('write_binary_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } }),
};

export function onMcProgress(cb: (done: number, total: number) => void): Promise<UnlistenFn> {
  return listen<{ done: number; total: number }>('mc-progress', (e) => cb(e.payload.done, e.payload.total));
}
