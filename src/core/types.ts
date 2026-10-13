// Shapes of the data the Rust side sends. Keep in sync with src-tauri/src/commands.rs.

export type Vec3 = [number, number, number];

export interface Elements {
  a: number;
  e: number;
  i: number;
  node: number;
  peri: number;
  m: number;
  epoch: number;
}

export interface ObjectRecord {
  id: string;
  name: string;
  elements: Elements;
  h: number | null;
  diameter_km: number | null;
  diameter_estimated: boolean;
  albedo: number | null;
  pha: boolean;
  neo: boolean;
  orbit_class: string | null;
  moid_au: number | null;
  condition_code: number | null;
  spectral: string | null;
  rotation_h: number | null;
  sentry: boolean;
  source: string;
}

export interface BodyInfo {
  id: string;
  name: string;
  pha: boolean;
  neo: boolean;
  sentry: boolean;
  h: number | null;
  diameter_km: number;
  diameter_estimated: boolean;
  orbit_class: string | null;
  moid_au: number | null;
  a: number;
  e: number;
  i_deg: number;
  impacted: number | null;
  deflected: boolean;
  thrusting: boolean;
}

export interface PlanetInfo {
  id: string;
  radius_km: number;
  orbit: number[];
}

export interface Thrust {
  accel: number;
  rtn: Vec3;
  start: number;
  end: number;
}

export interface BodyDetail {
  record: ObjectRecord;
  position_au: Vec3;
  velocity_kms: Vec3;
  speed_kms: number;
  earth_distance_km: number;
  earth_speed_kms: number;
  sun_distance_au: number;
  osculating: [number, number, number, number, number, number, number] | null;
  mass_kg: number;
  density: number;
  diameter_km: number;
  delta_v_ms: number;
  thrust: Thrust | null;
  impacted: number | null;
}

export interface Encounter {
  jd: number;
  dist_au: number;
  dist_km: number;
  v_rel_kms: number;
  v_inf_kms: number;
  b_plane_km: [number, number];
  capture_radius_km: number;
  impact: boolean;
}

export interface ScanSummary {
  encounters: Encounter[];
  closest: Encounter | null;
  impact: boolean;
  from_jd: number;
  to_jd: number;
}

export interface CloseApproach {
  des: string;
  name: string;
  jd: number;
  date: string;
  dist_au: number;
  dist_min_au: number;
  dist_max_au: number;
  v_rel_kms: number;
  h: number | null;
}

export interface SentryEntry {
  des: string;
  name: string;
  ip: number;
  ps_cum: number;
  ps_max: number;
  ts_max: number;
  n_imp: number;
  range: string;
  diameter_km: number | null;
  h: number | null;
  v_inf_kms: number | null;
  last_obs: string;
}

export interface SentryImpact {
  date: string;
  ip: number;
  ps: number;
  ts: number;
  energy_mt: number | null;
}

export interface SentryDetail {
  des: string;
  ip: number;
  ps_cum: number;
  ts_max: number;
  energy_mt: number | null;
  mass_kg: number | null;
  v_imp_kms: number | null;
  v_inf_kms: number | null;
  method: string;
  computed: string;
  impacts: SentryImpact[];
  removed: string | null;
}

export interface MonteCarloResult {
  samples: number;
  impacts: number;
  impact_probability: number;
  ip_low: number;
  ip_high: number;
  method: string;
  years: number;
  impact_dates: number[];
  min_distances_km: number[];
  min_km: number;
  median_km: number;
  cancelled: boolean;
}

export interface RiskReport {
  mc: MonteCarloResult;
  diameter_km: number;
  mass_kg: number;
  v_inf_kms: number;
  energy_mt: number;
  torino: number;
  palermo: number | null;
  nominal_closest: Encounter | null;
}

export type Rtn = Vec3;

export type Deflection =
  | { method: 'impulse'; dv_ms: number; rtn: Rtn }
  | { method: 'kinetic_impactor'; mass_kg: number; speed_kms: number; beta: number; rtn: Rtn }
  | { method: 'ion_beam'; thrust_n: number; efficiency: number; days: number; rtn: Rtn }
  | { method: 'gravity_tractor'; mass_kg: number; hover_m: number; days: number; rtn: Rtn };

export interface DeflectionPlan {
  dv_ms: number;
  accel_ms2: number | null;
  duration_days: number | null;
  baseline: ScanSummary;
  deflected: ScanSummary;
  target_jd: number | null;
  miss_before_km: number | null;
  miss_after_km: number | null;
}

export interface LoadResult {
  added: number;
  total_in_sim: number;
  available: number;
  ids: string[];
}

export interface ScenarioInfo {
  name: string;
  saved_unix: number;
  objects: number;
  jd: number;
}

export type SimEvent = { kind: 'impact'; id: string; name: string; jd: number; v_kms: number };

export type CatalogPreset = 'pha' | 'large_neo' | 'neo';

/** Parsed binary frame (see Sim::encode_frame). */
export interface Frame {
  jd: number;
  rate: number;
  version: number;
  eventSeq: number;
  paused: boolean;
  stepMs: number;
  planets: Float64Array;
  bodies: Float64Array;
  received: number;
}
