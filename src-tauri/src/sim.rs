//! The running simulation: a set of small bodies advanced in a background
//! thread, plus the binary frame the frontend reads every animation frame.

use crate::data::ObjectRecord;
use crate::physics::constants::*;
use crate::physics::ephemeris::{self, EphemerisTable, IDX_EARTH, N_PLANETS};
use crate::physics::kepler::Elements;
use crate::physics::propagate::{Propagator, Thrust};
use crate::physics::risk;
use crate::physics::Vec3;
use parking_lot::RwLock;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Current time as a TDB Julian date.
pub fn now_jd() -> f64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    2_440_587.5 + (secs + TDB_MINUS_UTC_S) / DAY_S
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimBody {
    pub rec: ObjectRecord,
    /// Heliocentric position (AU) and velocity (AU/day).
    pub r: Vec3,
    pub v: Vec3,
    pub thrust: Option<Thrust>,
    /// Julian date of an Earth impact, if one happened in the simulation.
    pub impacted: Option<f64>,
    /// Sum of all applied velocity changes, m/s.
    pub delta_v_ms: f64,
}

impl SimBody {
    pub fn mass_kg(&self) -> f64 {
        risk::mass_kg(self.rec.effective_diameter_km(), risk::density_for_spectral(self.rec.spectral.as_deref()))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SimEvent {
    Impact { id: String, name: String, jd: f64, v_kms: f64 },
}

pub struct Sim {
    pub jd: f64,
    /// Simulated days per real second (negative runs backwards).
    pub rate: f64,
    pub paused: bool,
    pub bodies: Vec<SimBody>,
    /// Bumped whenever the body list or a body's static data changes.
    pub version: u32,
    pub events: Vec<SimEvent>,
    pub event_seq: u32,
    /// Wall time of the last physics update, ms.
    pub step_ms: f32,
}

impl Sim {
    pub fn new() -> Self {
        Self {
            jd: now_jd(),
            rate: 1.0,
            paused: true,
            bodies: Vec::new(),
            version: 1,
            events: Vec::new(),
            event_seq: 0,
            step_ms: 0.0,
        }
    }

    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.bodies.iter().position(|b| b.rec.id == id)
    }

    pub fn body(&self, id: &str) -> Option<&SimBody> {
        self.bodies.iter().find(|b| b.rec.id == id)
    }

    /// Insert or replace records, placing them at the current date.
    /// Returns how many were new.
    pub fn add_records(&mut self, records: Vec<ObjectRecord>) -> usize {
        let placed = place_records(&records, self.jd);
        let mut added = 0;
        for (rec, (r, v)) in records.into_iter().zip(placed) {
            if !r.is_finite() || !v.is_finite() {
                continue;
            }
            match self.index_of(&rec.id) {
                Some(k) => {
                    // Keep user modifications (deflection), refresh the data.
                    let b = &mut self.bodies[k];
                    let keep_state = b.delta_v_ms > 0.0 || b.thrust.is_some();
                    let cov = rec.covariance.clone().or_else(|| b.rec.covariance.clone());
                    let sentry = rec.sentry || b.rec.sentry;
                    b.rec = rec;
                    b.rec.covariance = cov;
                    b.rec.sentry = sentry;
                    if !keep_state {
                        b.r = r;
                        b.v = v;
                    }
                }
                None => {
                    self.bodies.push(SimBody { rec, r, v, thrust: None, impacted: None, delta_v_ms: 0.0 });
                    added += 1;
                }
            }
        }
        self.version = self.version.wrapping_add(1);
        added
    }

    pub fn push_event(&mut self, e: SimEvent) {
        self.events.push(e);
        if self.events.len() > 64 {
            self.events.remove(0);
        }
        self.event_seq = self.event_seq.wrapping_add(1);
    }

    /// Binary frame for the renderer. Layout (little endian):
    ///   f64 jd, f64 rate, u32 version, u32 event_seq, u32 flags,
    ///   u32 n_planets, u32 n_bodies, f32 step_ms,
    ///   f64[3 * n_planets] planet positions (AU),
    ///   f64[3 * n_bodies] body positions (AU)
    pub fn encode_frame(&self) -> Vec<u8> {
        let n = self.bodies.len();
        let mut out = Vec::with_capacity(40 + 24 * (N_PLANETS + n));
        out.extend_from_slice(&self.jd.to_le_bytes());
        out.extend_from_slice(&self.rate.to_le_bytes());
        out.extend_from_slice(&self.version.to_le_bytes());
        out.extend_from_slice(&self.event_seq.to_le_bytes());
        out.extend_from_slice(&(self.paused as u32).to_le_bytes());
        out.extend_from_slice(&(N_PLANETS as u32).to_le_bytes());
        out.extend_from_slice(&(n as u32).to_le_bytes());
        out.extend_from_slice(&self.step_ms.to_le_bytes());
        for p in ephemeris::positions(self.jd) {
            for c in p.to_array() {
                out.extend_from_slice(&c.to_le_bytes());
            }
        }
        for b in &self.bodies {
            for c in b.r.to_array() {
                out.extend_from_slice(&c.to_le_bytes());
            }
        }
        out
    }
}

impl Default for Sim {
    fn default() -> Self {
        Self::new()
    }
}

/// Place catalogue orbits at `jd`. Close to the orbit epoch we integrate with
/// planetary perturbations; far from it we fall back to two-body motion,
/// which is what the elements alone can honestly give.
pub fn place_records(records: &[ObjectRecord], jd: f64) -> Vec<(Vec3, Vec3)> {
    const NUMERIC_SPAN_DAYS: f64 = 800.0;
    let near: Vec<f64> = records
        .iter()
        .map(|r| r.elements.epoch)
        .filter(|e| (e - jd).abs() <= NUMERIC_SPAN_DAYS)
        .collect();
    let table = if near.is_empty() {
        None
    } else {
        let lo = near.iter().cloned().fold(jd, f64::min);
        let hi = near.iter().cloned().fold(jd, f64::max);
        Some(EphemerisTable::build(lo, hi))
    };
    records
        .par_iter()
        .map(|rec| {
            let el: &Elements = &rec.elements;
            match &table {
                Some(t) if (el.epoch - jd).abs() <= NUMERIC_SPAN_DAYS => {
                    let (r, v) = el.state_at(el.epoch, GM_SUN);
                    let prop = Propagator::new(t);
                    let (r1, v1, _) = prop.advance(r, v, el.epoch, jd, None, |_| true);
                    (r1, v1)
                }
                _ => el.state_at(jd, GM_SUN),
            }
        })
        .collect()
}

/// One body's state as handed to the integrator.
pub type BodyState = (Vec3, Vec3, Option<Thrust>, bool);
/// Result: new state and, if the body hit Earth, (jd, impact speed km/s).
pub type StepResult = (Vec3, Vec3, Option<(f64, f64)>);

/// Advance many bodies from `jd0` to `jd1` in parallel, stopping each one
/// at Earth impact.
pub fn propagate_batch(states: &[BodyState], jd0: f64, jd1: f64) -> Vec<StepResult> {
    let table = EphemerisTable::build(jd0, jd1);
    let prop = Propagator::new(&table);
    states
        .par_iter()
        .map(|&(r, v, thrust, impacted)| {
            if impacted {
                return (r, v, None);
            }
            let mut hit: Option<(f64, f64)> = None;
            let (r1, v1, _) = prop.advance(r, v, jd0, jd1, thrust.as_ref(), |st| {
                let (d, t) = st.earth_min();
                if d < EARTH_RADIUS_AU {
                    let ve = prop.earth_velocity(t);
                    hit = Some((t, (st.v1 - ve).norm() * AU_PER_DAY_KMS));
                    return false;
                }
                true
            });
            if let Some((t, _)) = hit {
                // Pin the body to Earth's surface at the impact point.
                let e = table.at(t)[IDX_EARTH];
                let dir = (r1 - e).unit();
                return (e + dir * EARTH_RADIUS_AU, v1, hit);
            }
            (r1, v1, None)
        })
        .collect()
}

impl Sim {
    pub fn snapshot(&self) -> Vec<BodyState> {
        self.bodies.iter().map(|b| (b.r, b.v, b.thrust, b.impacted.is_some())).collect()
    }

    /// Write integrated states back. Returns false if the simulation changed
    /// underneath (bodies added/removed, clock moved) and nothing was applied.
    pub fn apply_batch(&mut self, version: u32, jd0: f64, jd1: f64, results: Vec<StepResult>) -> bool {
        if self.version != version || self.jd != jd0 || self.bodies.len() != results.len() {
            return false;
        }
        let forward = jd1 >= jd0;
        let mut events = Vec::new();
        for (b, (r, v, hit)) in self.bodies.iter_mut().zip(results) {
            if b.impacted.is_some() {
                continue;
            }
            b.r = r;
            b.v = v;
            if let Some(th) = &b.thrust {
                let past = if forward { jd1 > th.end.max(th.start) } else { jd1 < th.start.min(th.end) };
                if past {
                    b.thrust = None;
                }
            }
            if let Some((t, vk)) = hit {
                b.impacted = Some(t);
                events.push(SimEvent::Impact { id: b.rec.id.clone(), name: b.rec.name.clone(), jd: t, v_kms: vk });
            }
        }
        self.jd = jd1;
        if !events.is_empty() {
            self.version = self.version.wrapping_add(1);
            for e in events {
                self.push_event(e);
            }
        }
        true
    }
}

/// Background thread that advances the simulation in real time.
pub fn spawn_loop(sim: Arc<RwLock<Sim>>) {
    std::thread::Builder::new()
        .name("cosmorisk-physics".into())
        .spawn(move || {
            let frame = Duration::from_micros(16_667);
            let mut last = Instant::now();
            loop {
                let start = Instant::now();
                let real_dt = start.duration_since(last).as_secs_f64().min(0.1);
                last = start;

                // Snapshot under a short read lock, integrate without any lock.
                let snapshot = {
                    let s = sim.read();
                    if s.paused || s.rate == 0.0 {
                        None
                    } else {
                        Some((s.jd, s.rate * real_dt, s.version, s.snapshot()))
                    }
                };

                if let Some((jd0, adv, version, states)) = snapshot {
                    let jd1 = jd0 + adv;
                    let results = propagate_batch(&states, jd0, jd1);
                    let mut s = sim.write();
                    if s.apply_batch(version, jd0, jd1, results) {
                        s.step_ms = start.elapsed().as_secs_f32() * 1000.0;
                    }
                }

                let spent = start.elapsed();
                if spent < frame {
                    std::thread::sleep(frame - spent);
                }
            }
        })
        .expect("physics thread");
}

/// A saved simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scenario {
    pub name: String,
    pub app_version: String,
    pub jd: f64,
    pub rate: f64,
    pub objects: Vec<SimBody>,
    #[serde(default)]
    pub notes: String,
}

impl Scenario {
    pub fn capture(sim: &Sim, name: &str, notes: &str) -> Self {
        Self {
            name: name.to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            jd: sim.jd,
            rate: sim.rate,
            objects: sim.bodies.clone(),
            notes: notes.to_string(),
        }
    }

    pub fn restore(self, sim: &mut Sim) {
        sim.jd = self.jd;
        sim.rate = self.rate;
        sim.paused = true;
        sim.bodies = self.objects;
        sim.version = sim.version.wrapping_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_layout_is_stable() {
        let s = Sim::new();
        let f = s.encode_frame();
        assert_eq!(f.len(), 40 + 24 * N_PLANETS);
        let jd = f64::from_le_bytes(f[0..8].try_into().unwrap());
        assert!((jd - s.jd).abs() < 1e-9);
    }

    #[test]
    fn now_is_after_2025() {
        assert!(now_jd() > 2_460_676.5);
    }
}
