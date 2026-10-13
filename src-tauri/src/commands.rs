//! Tauri commands: the whole API surface the frontend talks to.

use crate::data::cache::{ScenarioInfo, Store};
use crate::data::jpl::{self, CatalogPreset, CloseApproach, SentryDetail, SentryEntry};
use crate::data::ObjectRecord;
use crate::physics::constants::*;
use crate::physics::ephemeris::{self, EphemerisTable, IDX_EARTH, IDX_MOON, PLANETS};
use crate::physics::kepler::Elements;
use crate::physics::propagate::{rtn_to_inertial, scan_encounters, Encounter, Thrust};
use crate::physics::risk::{self, McProgress, MonteCarloResult, Uncertainty};
use crate::physics::Vec3;
use crate::sim::{now_jd, Scenario, Sim, SimEvent};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub sim: Arc<RwLock<Sim>>,
    pub store: Mutex<Option<Store>>,
    pub mc_cancel: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sim: Arc::new(RwLock::new(Sim::new())),
            store: Mutex::new(None),
            mc_cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    fn with_store<T>(&self, f: impl FnOnce(&Store) -> Result<T, String>) -> Result<T, String> {
        let guard = self.store.lock();
        match guard.as_ref() {
            Some(s) => f(s),
            None => Err("Storage is not available".into()),
        }
    }
}

type Res<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Frame and body lists
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_frame(state: State<AppState>) -> Response {
    Response::new(state.sim.read().encode_frame())
}

#[derive(Serialize)]
pub struct BodyInfo {
    pub id: String,
    pub name: String,
    pub pha: bool,
    pub neo: bool,
    pub sentry: bool,
    pub h: Option<f64>,
    pub diameter_km: f64,
    pub diameter_estimated: bool,
    pub orbit_class: Option<String>,
    pub moid_au: Option<f64>,
    pub a: f64,
    pub e: f64,
    pub i_deg: f64,
    pub impacted: Option<f64>,
    pub deflected: bool,
    pub thrusting: bool,
}

#[tauri::command]
pub fn get_bodies(state: State<AppState>) -> (u32, Vec<BodyInfo>) {
    let s = state.sim.read();
    let list = s
        .bodies
        .iter()
        .map(|b| BodyInfo {
            id: b.rec.id.clone(),
            name: b.rec.name.clone(),
            pha: b.rec.pha,
            neo: b.rec.neo,
            sentry: b.rec.sentry,
            h: b.rec.h,
            diameter_km: b.rec.effective_diameter_km(),
            diameter_estimated: b.rec.diameter_km.is_none(),
            orbit_class: b.rec.orbit_class.clone(),
            moid_au: b.rec.moid_au,
            a: b.rec.elements.a,
            e: b.rec.elements.e,
            i_deg: b.rec.elements.i.to_degrees(),
            impacted: b.impacted,
            deflected: b.delta_v_ms > 0.0,
            thrusting: b.thrust.is_some(),
        })
        .collect();
    (s.version, list)
}

#[derive(Serialize)]
pub struct PlanetInfo {
    pub id: &'static str,
    pub radius_km: f64,
    /// Orbit polyline, flattened xyz in AU (empty for the Moon).
    pub orbit: Vec<f64>,
}

#[tauri::command]
pub fn get_planets(state: State<AppState>) -> Vec<PlanetInfo> {
    let jd = state.sim.read().jd;
    PLANETS
        .iter()
        .enumerate()
        .map(|(k, p)| PlanetInfo {
            id: p.id(),
            radius_km: p.radius_km(),
            orbit: ephemeris::orbit_path(k, jd, 360),
        })
        .collect()
}

#[derive(Serialize)]
pub struct BodyDetail {
    pub record: ObjectRecord,
    pub position_au: [f64; 3],
    pub velocity_kms: [f64; 3],
    pub speed_kms: f64,
    pub earth_distance_km: f64,
    pub earth_speed_kms: f64,
    pub sun_distance_au: f64,
    /// Osculating elements now (a AU, e, i deg, node deg, peri deg, M deg, period days).
    pub osculating: Option<[f64; 7]>,
    pub mass_kg: f64,
    pub density: f64,
    pub diameter_km: f64,
    pub delta_v_ms: f64,
    pub thrust: Option<Thrust>,
    pub impacted: Option<f64>,
}

#[tauri::command]
pub fn get_body_detail(state: State<AppState>, id: String) -> Res<BodyDetail> {
    let s = state.sim.read();
    let b = s.body(&id).ok_or("Object not found")?;
    let pp = ephemeris::positions(s.jd);
    let ve = ephemeris::velocity(IDX_EARTH, s.jd);
    let osc = Elements::from_state(b.r, b.v, GM_SUN, s.jd).map(|el| {
        [
            el.a,
            el.e,
            el.i.to_degrees(),
            el.node.to_degrees(),
            el.peri.to_degrees(),
            el.m.to_degrees(),
            el.period(GM_SUN),
        ]
    });
    let density = risk::density_for_spectral(b.rec.spectral.as_deref());
    Ok(BodyDetail {
        record: ObjectRecord {
            covariance: None,
            ..b.rec.clone()
        },
        position_au: b.r.to_array(),
        velocity_kms: (b.v * AU_PER_DAY_KMS).to_array(),
        speed_kms: b.v.norm() * AU_PER_DAY_KMS,
        earth_distance_km: (b.r - pp[IDX_EARTH]).norm() * AU_KM,
        earth_speed_kms: (b.v - ve).norm() * AU_PER_DAY_KMS,
        sun_distance_au: b.r.norm(),
        osculating: osc,
        mass_kg: b.mass_kg(),
        density,
        diameter_km: b.rec.effective_diameter_km(),
        delta_v_ms: b.delta_v_ms,
        thrust: b.thrust,
        impacted: b.impacted,
    })
}

/// Current osculating orbit of a body, flattened xyz (AU).
#[tauri::command]
pub fn get_orbit_path(state: State<AppState>, id: String, samples: Option<usize>) -> Res<Vec<f64>> {
    let s = state.sim.read();
    let b = s.body(&id).ok_or("Object not found")?;
    let el = Elements::from_state(b.r, b.v, GM_SUN, s.jd).ok_or("Orbit is not elliptic")?;
    let n = samples.unwrap_or(256).clamp(32, 2048);
    let mut out = Vec::with_capacity(n * 3);
    for k in 0..n {
        // Sample uniformly in eccentric anomaly: denser near perihelion than
        // true-anomaly sampling would be for very eccentric orbits.
        let ea = std::f64::consts::TAU * k as f64 / n as f64;
        let nu = 2.0 * (((1.0 + el.e) / (1.0 - el.e)).sqrt() * (ea / 2.0).tan()).atan();
        let p = el.position_at_true_anomaly(nu);
        out.extend_from_slice(&p.to_array());
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_paused(state: State<AppState>, paused: bool) {
    state.sim.write().paused = paused;
}

/// Simulated days per real second. Clamped to +-10 years per second.
#[tauri::command]
pub fn set_rate(state: State<AppState>, days_per_second: f64) {
    if days_per_second.is_finite() {
        state.sim.write().rate = days_per_second.clamp(-3652.5, 3652.5);
    }
}

/// Move the clock. Up to 60 years away the current states (including any
/// deflection) are integrated there; beyond that the catalogue orbits are
/// re-placed with two-body motion.
#[tauri::command]
pub async fn set_date(state: State<'_, AppState>, jd: f64) -> Res<()> {
    if !(2_378_496.5..=2_524_593.5).contains(&jd) {
        return Err("Date must be between 1800 and 2200".into());
    }
    let sim = state.sim.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (jd0, version, states, records) = {
            let s = sim.read();
            (
                s.jd,
                s.version,
                s.snapshot(),
                s.bodies.iter().map(|b| b.rec.clone()).collect::<Vec<_>>(),
            )
        };
        if (jd - jd0).abs() <= 60.0 * 365.25 {
            let results = crate::sim::propagate_batch(&states, jd0, jd);
            let mut s = sim.write();
            if !s.apply_batch(version, jd0, jd, results) {
                return Err("The simulation changed during the jump; try again".to_string());
            }
        } else {
            let placed = crate::sim::place_records(&records, jd);
            let mut s = sim.write();
            if s.version != version {
                return Err("The simulation changed during the jump; try again".to_string());
            }
            s.jd = jd;
            for (b, (r, v)) in s.bodies.iter_mut().zip(placed) {
                b.r = r;
                b.v = v;
                b.thrust = None;
                b.impacted = None;
                b.delta_v_ms = 0.0;
            }
            s.version = s.version.wrapping_add(1);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Res<f64> {
    let jd = now_jd();
    set_date(state.clone(), jd).await?;
    let mut s = state.sim.write();
    s.rate = 1.0 / DAY_S;
    s.paused = false;
    Ok(jd)
}

#[tauri::command]
pub fn reset_simulation(state: State<AppState>) {
    let mut s = state.sim.write();
    let version = s.version;
    *s = Sim::new();
    s.version = version.wrapping_add(1);
}

#[tauri::command]
pub fn remove_bodies(state: State<AppState>, ids: Vec<String>) {
    let mut s = state.sim.write();
    s.bodies.retain(|b| !ids.contains(&b.rec.id));
    s.version = s.version.wrapping_add(1);
}

#[tauri::command]
pub fn take_events(state: State<AppState>) -> (u32, Vec<SimEvent>) {
    let mut s = state.sim.write();
    let events = std::mem::take(&mut s.events);
    (s.event_seq, events)
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct LoadResult {
    pub added: usize,
    pub total_in_sim: usize,
    pub available: usize,
    pub ids: Vec<String>,
}

fn persist_catalog(state: &AppState) {
    let records: Vec<ObjectRecord> = state
        .sim
        .read()
        .bodies
        .iter()
        .map(|b| b.rec.clone())
        .collect();
    let _ = state.with_store(|st| st.save_catalog(&records));
}

#[tauri::command]
pub async fn load_catalog(
    state: State<'_, AppState>,
    preset: CatalogPreset,
    limit: usize,
    offset: Option<usize>,
) -> Res<LoadResult> {
    let (records, available) = jpl::query_catalog(preset, limit, offset.unwrap_or(0)).await?;
    let ids: Vec<String> = records.iter().map(|r| r.id.clone()).collect();
    let sim = state.sim.clone();
    let added = tauri::async_runtime::spawn_blocking(move || sim.write().add_records(records))
        .await
        .map_err(|e| e.to_string())?;
    persist_catalog(&state);
    Ok(LoadResult {
        added,
        total_in_sim: state.sim.read().bodies.len(),
        available,
        ids,
    })
}

#[tauri::command]
pub async fn load_object(state: State<'_, AppState>, designation: String) -> Res<String> {
    let mut rec = jpl::sbdb_object(&designation).await?;
    // Mark Sentry objects so the UI can offer the official numbers.
    if let Ok(detail) = jpl::sentry_object(&rec.id).await {
        rec.sentry = detail.removed.is_none() && detail.ip > 0.0;
    }
    let id = rec.id.clone();
    let sim = state.sim.clone();
    tauri::async_runtime::spawn_blocking(move || sim.write().add_records(vec![rec]))
        .await
        .map_err(|e| e.to_string())?;
    persist_catalog(&state);
    Ok(id)
}

#[derive(Serialize)]
pub struct CacheInfo {
    pub objects: usize,
    pub saved_unix: u64,
}

#[tauri::command]
pub fn cached_catalog_info(state: State<AppState>) -> Option<CacheInfo> {
    state
        .with_store(|st| Ok(st.load_catalog()))
        .ok()
        .flatten()
        .map(|(objs, t)| CacheInfo {
            objects: objs.len(),
            saved_unix: t,
        })
}

#[tauri::command]
pub async fn restore_cached_catalog(state: State<'_, AppState>) -> Res<usize> {
    let (records, _) = state.with_store(|st| {
        st.load_catalog()
            .ok_or_else(|| "No saved catalogue".to_string())
    })?;
    let sim = state.sim.clone();
    tauri::async_runtime::spawn_blocking(move || sim.write().add_records(records))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upcoming_close_approaches(days: u32, dist_max_au: f64) -> Res<Vec<CloseApproach>> {
    jpl::close_approaches(
        None,
        "now",
        &format!("+{}", days.clamp(1, 3650)),
        dist_max_au.clamp(0.0005, 0.5),
    )
    .await
}

#[tauri::command]
pub async fn object_close_approaches(designation: String, years: u32) -> Res<Vec<CloseApproach>> {
    jpl::close_approaches(
        Some(&designation),
        "now",
        &format!("+{}", years.clamp(1, 150) * 365),
        0.2,
    )
    .await
}

#[derive(Serialize)]
pub struct SentryList {
    pub items: Vec<SentryEntry>,
    pub fetched_unix: u64,
    /// True when JPL could not be reached and an older copy is shown.
    pub stale: bool,
}

/// Sentry list, cached on disk for a day because the endpoint is slow.
#[tauri::command]
pub async fn sentry_list(state: State<'_, AppState>, refresh: bool) -> Res<SentryList> {
    let cached = state.with_store(|st| Ok(st.load_sentry())).ok().flatten();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Some((t, items)) = &cached {
        if !refresh && now.saturating_sub(*t) < 86_400 {
            return Ok(SentryList {
                items: items.clone(),
                fetched_unix: *t,
                stale: false,
            });
        }
    }
    match jpl::sentry_list().await {
        Ok(items) => {
            let _ = state.with_store(|st| st.save_sentry(&items));
            Ok(SentryList {
                items,
                fetched_unix: now,
                stale: false,
            })
        }
        Err(e) => match cached {
            Some((t, items)) => Ok(SentryList {
                items,
                fetched_unix: t,
                stale: true,
            }),
            None => Err(e),
        },
    }
}

#[tauri::command]
pub async fn sentry_detail(designation: String) -> Res<SentryDetail> {
    jpl::sentry_object(&designation).await
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct ScanSummary {
    pub encounters: Vec<Encounter>,
    pub closest: Option<Encounter>,
    pub impact: bool,
    pub from_jd: f64,
    pub to_jd: f64,
}

fn summarize(
    table: &EphemerisTable,
    r: Vec3,
    v: Vec3,
    t0: f64,
    t1: f64,
    thrust: Option<&Thrust>,
) -> ScanSummary {
    let scan = scan_encounters(table, r, v, t0, t1, thrust, 0.05);
    ScanSummary {
        impact: scan.impacted,
        closest: scan.closest,
        encounters: scan.encounters,
        from_jd: t0,
        to_jd: t1,
    }
}

#[tauri::command]
pub async fn scan_approaches(
    state: State<'_, AppState>,
    id: String,
    years: f64,
) -> Res<ScanSummary> {
    let (r, v, t0, thrust) = {
        let s = state.sim.read();
        let b = s.body(&id).ok_or("Object not found")?;
        if b.impacted.is_some() {
            return Err("This object has already hit Earth in the simulation".into());
        }
        (b.r, b.v, s.jd, b.thrust)
    };
    let t1 = t0 + years.clamp(0.1, 100.0) * 365.25;
    tauri::async_runtime::spawn_blocking(move || {
        let table = EphemerisTable::build(t0, t1);
        summarize(&table, r, v, t0, t1, thrust.as_ref())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Deflection methods. Directions are RTN unit vectors (radial,
/// transverse/along-track, normal) relative to the asteroid's orbit.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum Deflection {
    Impulse {
        dv_ms: f64,
        rtn: [f64; 3],
    },
    KineticImpactor {
        mass_kg: f64,
        speed_kms: f64,
        beta: f64,
        rtn: [f64; 3],
    },
    IonBeam {
        thrust_n: f64,
        efficiency: f64,
        days: f64,
        rtn: [f64; 3],
    },
    GravityTractor {
        mass_kg: f64,
        hover_m: f64,
        days: f64,
        rtn: [f64; 3],
    },
}

enum Effect {
    Impulse(f64, [f64; 3]),
    Thrust(Thrust),
}

const MS2_TO_AU_D2: f64 = DAY_S * DAY_S / (AU_KM * 1000.0);

fn unit3(c: [f64; 3]) -> [f64; 3] {
    let n = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
    if n > 0.0 {
        [c[0] / n, c[1] / n, c[2] / n]
    } else {
        [0.0, 1.0, 0.0]
    }
}

fn effect_of(d: &Deflection, mass_kg: f64, radius_m: f64, jd: f64) -> Res<Effect> {
    let m = mass_kg.max(1.0);
    Ok(match *d {
        Deflection::Impulse { dv_ms, rtn } => {
            Effect::Impulse(dv_ms.clamp(-1000.0, 1000.0), unit3(rtn))
        }
        Deflection::KineticImpactor {
            mass_kg: sc,
            speed_kms,
            beta,
            rtn,
        } => {
            let dv =
                beta.clamp(1.0, 10.0) * sc.clamp(1.0, 1e7) * speed_kms.clamp(0.1, 100.0) * 1000.0
                    / m;
            Effect::Impulse(dv, unit3(rtn))
        }
        Deflection::IonBeam {
            thrust_n,
            efficiency,
            days,
            rtn,
        } => {
            let a = thrust_n.clamp(0.0, 100.0) * efficiency.clamp(0.0, 1.0) / m;
            Effect::Thrust(Thrust {
                accel: a * MS2_TO_AU_D2,
                rtn: unit3(rtn),
                start: jd,
                end: jd + days.clamp(1.0, 36_525.0),
            })
        }
        Deflection::GravityTractor {
            mass_kg: sc,
            hover_m,
            days,
            rtn,
        } => {
            let d = radius_m + hover_m.clamp(10.0, 10_000.0);
            let a = 6.674_30e-11 * sc.clamp(1.0, 1e6) / (d * d);
            Effect::Thrust(Thrust {
                accel: a * MS2_TO_AU_D2,
                rtn: unit3(rtn),
                start: jd,
                end: jd + days.clamp(1.0, 36_525.0),
            })
        }
    })
}

#[derive(Serialize)]
pub struct DeflectionPlan {
    /// Equivalent velocity change, m/s (for continuous methods: a * duration).
    pub dv_ms: f64,
    pub accel_ms2: Option<f64>,
    pub duration_days: Option<f64>,
    pub baseline: ScanSummary,
    pub deflected: ScanSummary,
    pub target_jd: Option<f64>,
    pub miss_before_km: Option<f64>,
    pub miss_after_km: Option<f64>,
}

#[tauri::command]
pub async fn plan_deflection(
    state: State<'_, AppState>,
    id: String,
    deflection: Deflection,
    years: f64,
) -> Res<DeflectionPlan> {
    let (r, v, t0, thrust, mass, radius_m) = {
        let s = state.sim.read();
        let b = s.body(&id).ok_or("Object not found")?;
        (
            b.r,
            b.v,
            s.jd,
            b.thrust,
            b.mass_kg(),
            b.rec.effective_diameter_km() * 500.0,
        )
    };
    let effect = effect_of(&deflection, mass, radius_m, t0)?;
    let t1 = t0 + years.clamp(0.1, 100.0) * 365.25;
    tauri::async_runtime::spawn_blocking(move || {
        let table = EphemerisTable::build(t0, t1);
        let baseline = summarize(&table, r, v, t0, t1, thrust.as_ref());
        let (deflected, dv_ms, accel, dur) = match &effect {
            Effect::Impulse(dv, rtn) => {
                let dvec = rtn_to_inertial(r, v, *rtn) * (dv / 1000.0 / AU_PER_DAY_KMS);
                (
                    summarize(&table, r, v + dvec, t0, t1, thrust.as_ref()),
                    dv.abs(),
                    None,
                    None,
                )
            }
            Effect::Thrust(th) => {
                let a_ms2 = th.accel / MS2_TO_AU_D2;
                let days = th.end - th.start;
                (
                    summarize(&table, r, v, t0, t1, Some(th)),
                    a_ms2 * days * DAY_S,
                    Some(a_ms2),
                    Some(days),
                )
            }
        };
        let target = baseline.closest.clone();
        let after = target.as_ref().and_then(|t| {
            deflected
                .encounters
                .iter()
                .filter(|e| (e.jd - t.jd).abs() < 60.0)
                .min_by(|a, b| a.dist_km.partial_cmp(&b.dist_km).unwrap())
                .cloned()
                .or_else(|| deflected.closest.clone())
        });
        DeflectionPlan {
            dv_ms,
            accel_ms2: accel,
            duration_days: dur,
            target_jd: target.as_ref().map(|t| t.jd),
            miss_before_km: target.as_ref().map(|t| t.dist_km),
            miss_after_km: after.map(|a| a.dist_km),
            baseline,
            deflected,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_deflection(state: State<AppState>, id: String, deflection: Deflection) -> Res<f64> {
    let mut s = state.sim.write();
    let jd = s.jd;
    let k = s.index_of(&id).ok_or("Object not found")?;
    let (mass, radius_m) = {
        let b = &s.bodies[k];
        (b.mass_kg(), b.rec.effective_diameter_km() * 500.0)
    };
    if s.bodies[k].impacted.is_some() {
        return Err("This object has already hit Earth in the simulation".into());
    }
    let effect = effect_of(&deflection, mass, radius_m, jd)?;
    let b = &mut s.bodies[k];
    let dv = match effect {
        Effect::Impulse(dv, rtn) => {
            let dvec = rtn_to_inertial(b.r, b.v, rtn) * (dv / 1000.0 / AU_PER_DAY_KMS);
            b.v += dvec;
            dv.abs()
        }
        Effect::Thrust(th) => {
            let dv = th.accel / MS2_TO_AU_D2 * (th.end - th.start) * DAY_S;
            b.thrust = Some(th);
            dv
        }
    };
    b.delta_v_ms += dv;
    s.version = s.version.wrapping_add(1);
    Ok(dv)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum McMode {
    /// Use the JPL covariance if the object has one.
    Covariance,
    Isotropic {
        pos_km: f64,
        vel_ms: f64,
    },
}

#[derive(Serialize)]
pub struct RiskReport {
    pub mc: MonteCarloResult,
    pub diameter_km: f64,
    pub mass_kg: f64,
    pub v_inf_kms: f64,
    pub energy_mt: f64,
    pub torino: u8,
    pub palermo: Option<f64>,
    pub nominal_closest: Option<Encounter>,
}

#[derive(Clone, Serialize)]
struct McProgressEvent {
    done: usize,
    total: usize,
}

#[tauri::command]
pub async fn run_monte_carlo(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    samples: usize,
    years: f64,
    mode: McMode,
) -> Res<RiskReport> {
    // Catalogue presets come without covariance; fetch it on demand.
    let needs_cov = matches!(mode, McMode::Covariance)
        && state
            .sim
            .read()
            .body(&id)
            .map(|b| b.rec.covariance.is_none())
            .unwrap_or(false);
    if needs_cov {
        if let Ok(full) = jpl::sbdb_object(&id).await {
            let mut s = state.sim.write();
            if let Some(k) = s.index_of(&id) {
                let b = &mut s.bodies[k];
                b.rec.covariance = full.covariance;
                if b.rec.diameter_km.is_none() && full.diameter_km.is_some() {
                    b.rec.diameter_km = full.diameter_km;
                    b.rec.diameter_estimated = false;
                }
                b.rec.spectral = b.rec.spectral.clone().or(full.spectral);
                b.rec.albedo = b.rec.albedo.or(full.albedo);
            }
        }
    }
    let (r, v, t0, thrust, cov, mass, diameter) = {
        let s = state.sim.read();
        let b = s.body(&id).ok_or("Object not found")?;
        if b.impacted.is_some() {
            return Err("This object has already hit Earth in the simulation".into());
        }
        (
            b.r,
            b.v,
            s.jd,
            b.thrust,
            b.rec.covariance.clone(),
            b.mass_kg(),
            b.rec.effective_diameter_km(),
        )
    };
    let samples = samples.clamp(16, 20_000);
    let years = years.clamp(0.1, 50.0);
    let cancel = state.mc_cancel.clone();
    cancel.store(false, Ordering::Relaxed);
    let done = Arc::new(AtomicUsize::new(0));
    let finished = Arc::new(AtomicBool::new(false));

    // Progress reporter
    {
        let (app, done, finished) = (app.clone(), done.clone(), finished.clone());
        std::thread::spawn(move || {
            while !finished.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "mc-progress",
                    McProgressEvent {
                        done: done.load(Ordering::Relaxed),
                        total: samples,
                    },
                );
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
        });
    }

    let seed = id
        .bytes()
        .fold(0xC05_u64, |h, b| h.wrapping_mul(31).wrapping_add(b as u64));
    let result = tauri::async_runtime::spawn_blocking(move || {
        let uncertainty = match (&mode, &cov) {
            (McMode::Covariance, Some(c)) => Uncertainty::Covariance(c),
            (McMode::Covariance, None) => Uncertainty::Isotropic {
                pos_km: 1000.0,
                vel_ms: 0.05,
            },
            (McMode::Isotropic { pos_km, vel_ms }, _) => Uncertainty::Isotropic {
                pos_km: pos_km.clamp(0.0, 1e7),
                vel_ms: vel_ms.clamp(0.0, 1000.0),
            },
        };
        let mc = risk::monte_carlo(
            r,
            v,
            t0,
            years,
            samples,
            uncertainty,
            thrust.as_ref(),
            seed,
            McProgress {
                done: &done,
                cancel: &cancel,
            },
        );
        let table = EphemerisTable::build(t0, t0 + years * 365.25);
        let nominal = summarize(&table, r, v, t0, t0 + years * 365.25, thrust.as_ref());
        finished.store(true, Ordering::Relaxed);
        (mc, nominal)
    })
    .await
    .map_err(|e| e.to_string())?;

    let (mc, nominal) = result;
    let v_inf = nominal
        .closest
        .as_ref()
        .map(|c| c.v_inf_kms)
        .unwrap_or(15.0);
    let energy = risk::impact_energy_mt(mass, v_inf);
    let years_to = mc
        .impact_dates
        .first()
        .map(|jd| (jd - t0) / 365.25)
        .unwrap_or(years);
    Ok(RiskReport {
        torino: risk::torino(mc.impact_probability, energy),
        palermo: risk::palermo(mc.impact_probability, energy, years_to),
        diameter_km: diameter,
        mass_kg: mass,
        v_inf_kms: v_inf,
        energy_mt: energy,
        nominal_closest: nominal.closest,
        mc,
    })
}

#[tauri::command]
pub fn cancel_monte_carlo(state: State<AppState>) {
    state.mc_cancel.store(true, Ordering::Relaxed);
}

#[derive(Serialize)]
pub struct EnergyEstimate {
    pub energy_mt: f64,
    pub torino: u8,
    pub palermo: Option<f64>,
}

/// Torino/Palermo for an arbitrary probability (used with Sentry numbers).
#[tauri::command]
pub fn assess(
    diameter_km: f64,
    density: f64,
    v_inf_kms: f64,
    ip: f64,
    years_to_impact: f64,
) -> EnergyEstimate {
    let e = risk::impact_energy_mt(risk::mass_kg(diameter_km, density), v_inf_kms);
    EnergyEstimate {
        energy_mt: e,
        torino: risk::torino(ip, e),
        palermo: risk::palermo(ip, e, years_to_impact),
    }
}

// ---------------------------------------------------------------------------
// Scenarios and files
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_scenario(
    state: State<AppState>,
    name: String,
    notes: Option<String>,
) -> Res<ScenarioInfo> {
    let sc = Scenario::capture(&state.sim.read(), &name, notes.as_deref().unwrap_or(""));
    state.with_store(|st| st.save_scenario(&sc))
}

#[tauri::command]
pub fn list_scenarios(state: State<AppState>) -> Vec<ScenarioInfo> {
    state
        .with_store(|st| Ok(st.list_scenarios()))
        .unwrap_or_default()
}

#[tauri::command]
pub fn load_scenario(state: State<AppState>, name: String) -> Res<()> {
    let sc = state.with_store(|st| st.load_scenario(&name))?;
    sc.restore(&mut state.sim.write());
    Ok(())
}

#[tauri::command]
pub fn delete_scenario(state: State<AppState>, name: String) -> Res<()> {
    state.with_store(|st| st.delete_scenario(&name))
}

#[tauri::command]
pub fn export_scenario(state: State<AppState>, name: String) -> Res<String> {
    let sc = Scenario::capture(&state.sim.read(), &name, "");
    serde_json::to_string_pretty(&sc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_scenario(state: State<AppState>, json: String) -> Res<String> {
    let sc: Scenario =
        serde_json::from_str(&json).map_err(|e| format!("Not a CosmoRisk scenario: {e}"))?;
    let name = sc.name.clone();
    sc.restore(&mut state.sim.write());
    Ok(name)
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Res<()> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not save file: {e}"))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Res<String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("File is too large".into());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read file: {e}"))
}

/// Raw binary write. The target path travels percent-encoded in the
/// `x-path` header; the body is the file content.
#[tauri::command]
pub fn write_binary_file(request: Request<'_>) -> Res<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary body".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|h| h.to_str().ok())
        .map(percent_decode)
        .ok_or("Missing path")?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save file: {e}"))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The Moon's path around Earth for half a month either side of now, so the
/// unavoidable gap (the orbit precesses) sits opposite the Moon.
#[tauri::command]
pub fn moon_orbit(state: State<AppState>) -> Vec<f64> {
    let jd = state.sim.read().jd;
    let mut out = Vec::with_capacity(3 * 121);
    for k in 0..=120 {
        let t = jd + 27.321_661 * (k as f64 / 120.0 - 0.5);
        let p = ephemeris::positions(t);
        out.extend_from_slice(&(p[IDX_MOON] - p[IDX_EARTH]).to_array());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decoding() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cm%C3%BC%5Cx.png"),
            "C:\\Users\\mü\\x.png"
        );
        assert_eq!(percent_decode("plain"), "plain");
    }

    #[test]
    fn kinetic_impactor_dv() {
        // DART-like: 580 kg at 6.1 km/s, beta 3.6 into a 4.3e9 kg body -> ~3 mm/s
        let Effect::Impulse(dv, _) = effect_of(
            &Deflection::KineticImpactor {
                mass_kg: 580.0,
                speed_kms: 6.1,
                beta: 3.6,
                rtn: [0.0, 1.0, 0.0],
            },
            4.3e9,
            80.0,
            0.0,
        )
        .unwrap() else {
            panic!()
        };
        assert!(dv > 0.002 && dv < 0.004, "{dv}");
    }
}
