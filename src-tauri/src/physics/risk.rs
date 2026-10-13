//! Impact energy, Torino and Palermo scales, and Monte Carlo impact
//! probability.

use super::constants::*;
use super::ephemeris::EphemerisTable;
use super::kepler::Elements;
use super::propagate::{scan_encounters, Propagator, Thrust};
use super::vec3::Vec3;
use rand::rngs::SmallRng;
use rand::SeedableRng;
use rand_distr::{Distribution, StandardNormal};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Diameter (km) from absolute magnitude H and geometric albedo.
pub fn diameter_from_h(h: f64, albedo: f64) -> f64 {
    1329.0 / albedo.sqrt() * 10f64.powf(-h / 5.0)
}

/// Bulk density guess (kg/m^3) from a spectral class string.
pub fn density_for_spectral(spec: Option<&str>) -> f64 {
    let s = match spec {
        Some(s) if !s.is_empty() => s.trim().to_uppercase(),
        _ => return 2_000.0,
    };
    match s.chars().next().unwrap_or(' ') {
        'C' | 'B' | 'G' | 'F' => 1_400.0,
        'D' | 'P' | 'T' => 1_200.0,
        'S' | 'Q' | 'K' | 'L' | 'A' | 'O' | 'R' => 2_600.0,
        'V' => 3_200.0,
        'M' => 4_500.0,
        'X' | 'E' => 2_800.0,
        _ => 2_000.0,
    }
}

/// Mass in kg for a sphere of diameter `d_km` and density `rho`.
pub fn mass_kg(d_km: f64, rho: f64) -> f64 {
    let r = d_km * 500.0; // km -> m, halved
    rho * 4.0 / 3.0 * std::f64::consts::PI * r * r * r
}

/// Impact speed (km/s) from hyperbolic excess speed.
pub fn impact_speed_kms(v_inf_kms: f64) -> f64 {
    (v_inf_kms * v_inf_kms + EARTH_ESCAPE_KMS * EARTH_ESCAPE_KMS).sqrt()
}

/// Kinetic energy at impact in megatons TNT.
pub fn impact_energy_mt(mass_kg: f64, v_inf_kms: f64) -> f64 {
    let v = impact_speed_kms(v_inf_kms) * 1000.0;
    0.5 * mass_kg * v * v / MEGATON_J
}

/// Palermo scale. `years_to_impact` is the time from now to the potential
/// impact; the background frequency follows Chesley et al. (2002):
/// f_B = 0.03 E^-0.8 per year with E in megatons.
pub fn palermo(ip: f64, energy_mt: f64, years_to_impact: f64) -> Option<f64> {
    if ip <= 0.0 || energy_mt <= 0.0 {
        return None;
    }
    let fb = 0.03 * energy_mt.powf(-0.8);
    Some((ip / (fb * years_to_impact.max(1.0 / 365.25))).log10())
}

/// Torino scale from impact probability and energy.
///
/// Boundaries are our digitisation of the Torino chart (Binzel 2000,
/// Morrison et al. 2004): energy classes local < 1e3 Mt, regional < 1e5 Mt,
/// global above; the 0/1 and 1/2 diagonals follow lines of constant
/// log10(P) + 0.8 log10(E), the same slope as the Palermo background rate.
pub fn torino(ip: f64, energy_mt: f64) -> u8 {
    if ip <= 0.0 || energy_mt < 1.0 {
        return 0;
    }
    let le = energy_mt.log10();
    let class = if le < 3.0 { 0 } else if le < 5.0 { 1 } else { 2 };
    if ip >= 0.99 {
        return [8, 9, 10][class];
    }
    if ip >= 0.01 {
        return match class {
            0 => 3,
            1 => if ip < 0.1 { 4 } else { 5 },
            _ => if ip < 0.1 { 6 } else { 7 },
        };
    }
    let h = ip.log10() + 0.8 * le;
    if h < -2.0 {
        0
    } else if h < 0.0 {
        1
    } else {
        2
    }
}

/// 6x6 covariance of (e, q, tp, node, peri, i), JPL ordering and units
/// (au, TDB days, degrees).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Covariance {
    pub epoch: f64,
    /// Nominal values at `epoch` in the same order/units.
    pub nominal: [f64; 6],
    pub matrix: [[f64; 6]; 6],
}

impl Covariance {
    fn cholesky(&self) -> Option<[[f64; 6]; 6]> {
        let a = &self.matrix;
        let mut l = [[0.0; 6]; 6];
        for i in 0..6 {
            for j in 0..=i {
                let mut s = a[i][j];
                for k in 0..j {
                    s -= l[i][k] * l[j][k];
                }
                if i == j {
                    if s <= 0.0 {
                        // Covariances from JPL are positive definite but can be
                        // ill-conditioned; nudge the diagonal.
                        if s > -1e-30 {
                            l[i][j] = 1e-20;
                            continue;
                        }
                        return None;
                    }
                    l[i][j] = s.sqrt();
                } else {
                    l[i][j] = s / l[j][j];
                }
            }
        }
        Some(l)
    }

    fn sample_elements(&self, l: &[[f64; 6]; 6], rng: &mut SmallRng) -> Option<Elements> {
        let mut z = [0.0; 6];
        for zi in z.iter_mut() {
            *zi = StandardNormal.sample(rng);
        }
        let mut x = self.nominal;
        for i in 0..6 {
            for k in 0..=i {
                x[i] += l[i][k] * z[k];
            }
        }
        Elements::from_perihelion(x[0], x[1], x[2], x[3].to_radians(), x[4].to_radians(), x[5].to_radians(), self.epoch, GM_SUN)
    }

    pub fn nominal_elements(&self) -> Option<Elements> {
        let x = self.nominal;
        Elements::from_perihelion(x[0], x[1], x[2], x[3].to_radians(), x[4].to_radians(), x[5].to_radians(), self.epoch, GM_SUN)
    }
}

/// How the virtual asteroids are generated.
pub enum Uncertainty<'a> {
    /// Sample the JPL orbit covariance, propagate to `now` and shift by the
    /// difference between the simulator's state and the nominal orbit (which
    /// carries any deflection the user applied).
    Covariance(&'a Covariance),
    /// Isotropic Gaussian scatter around the current state (1-sigma, km and m/s).
    Isotropic { pos_km: f64, vel_ms: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonteCarloResult {
    pub samples: usize,
    pub impacts: usize,
    pub impact_probability: f64,
    /// 95% Wilson interval on the impact probability.
    pub ip_low: f64,
    pub ip_high: f64,
    pub method: String,
    pub years: f64,
    /// Julian dates of impacting samples (sorted).
    pub impact_dates: Vec<f64>,
    /// Closest approach of every sample, km (for the histogram).
    pub min_distances_km: Vec<f64>,
    pub min_km: f64,
    pub median_km: f64,
    pub cancelled: bool,
}

pub struct McProgress<'a> {
    pub done: &'a AtomicUsize,
    pub cancel: &'a AtomicBool,
}

#[allow(clippy::too_many_arguments)]
pub fn monte_carlo(
    r_now: Vec3,
    v_now: Vec3,
    t_now: f64,
    years: f64,
    samples: usize,
    uncertainty: Uncertainty,
    thrust: Option<&Thrust>,
    seed: u64,
    progress: McProgress,
) -> MonteCarloResult {
    let t_end = t_now + years * 365.25;
    let (method, starts): (String, Vec<(Vec3, Vec3)>) = match uncertainty {
        Uncertainty::Covariance(cov) => {
            let table = EphemerisTable::build(cov.epoch.min(t_now), cov.epoch.max(t_now));
            let prop = Propagator::new(&table);
            let l = match cov.cholesky() {
                Some(l) => l,
                None => return empty_result(samples, years, "covariance not positive definite"),
            };
            let nominal = match cov.nominal_elements() {
                Some(n) => n,
                None => return empty_result(samples, years, "invalid nominal orbit"),
            };
            let (nr, nv) = nominal.state_at(cov.epoch, GM_SUN);
            let (nr_now, nv_now, _) = prop.advance(nr, nv, cov.epoch, t_now, None, |_| true);
            let dr = r_now - nr_now;
            let dv = v_now - nv_now;

            let mut rng = SmallRng::seed_from_u64(seed);
            let elements: Vec<Elements> = (0..samples)
                .filter_map(|_| cov.sample_elements(&l, &mut rng))
                .collect();
            let starts = elements
                .par_iter()
                .map(|el| {
                    if progress.cancel.load(Ordering::Relaxed) {
                        return (r_now, v_now);
                    }
                    let (r, v) = el.state_at(cov.epoch, GM_SUN);
                    let (r1, v1, _) = prop.advance(r, v, cov.epoch, t_now, None, |_| true);
                    (r1 + dr, v1 + dv)
                })
                .collect();
            ("JPL orbit covariance".to_string(), starts)
        }
        Uncertainty::Isotropic { pos_km, vel_ms } => {
            let mut rng = SmallRng::seed_from_u64(seed);
            let sp = pos_km / AU_KM;
            let sv = vel_ms / 1000.0 / AU_PER_DAY_KMS;
            let mut g = || -> f64 { StandardNormal.sample(&mut rng) };
            let starts = (0..samples)
                .map(|_| {
                    (
                        r_now + Vec3::new(g(), g(), g()) * sp,
                        v_now + Vec3::new(g(), g(), g()) * sv,
                    )
                })
                .collect();
            ("Isotropic scatter".to_string(), starts)
        }
    };

    let table = EphemerisTable::build(t_now, t_end);
    let outcomes: Vec<Option<(f64, Option<f64>)>> = starts
        .par_iter()
        .map(|&(r, v)| {
            if progress.cancel.load(Ordering::Relaxed) {
                return None;
            }
            let scan = scan_encounters(&table, r, v, t_now, t_end, thrust, 0.0);
            progress.done.fetch_add(1, Ordering::Relaxed);
            let min_km = scan.closest.as_ref().map(|c| c.dist_km).unwrap_or(f64::INFINITY);
            let impact = if scan.impacted { scan.encounters.last().map(|e| e.jd) } else { None };
            Some((min_km, impact))
        })
        .collect();

    let cancelled = progress.cancel.load(Ordering::Relaxed);
    let done: Vec<(f64, Option<f64>)> = outcomes.into_iter().flatten().collect();
    let n = done.len();
    let mut impact_dates: Vec<f64> = done.iter().filter_map(|o| o.1).collect();
    impact_dates.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut dists: Vec<f64> = done.iter().map(|o| o.0).filter(|d| d.is_finite()).collect();
    dists.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let k = impact_dates.len();
    let ip = if n > 0 { k as f64 / n as f64 } else { 0.0 };
    let (lo, hi) = wilson(k, n);

    MonteCarloResult {
        samples: n,
        impacts: k,
        impact_probability: ip,
        ip_low: lo,
        ip_high: hi,
        method,
        years,
        impact_dates,
        min_km: dists.first().copied().unwrap_or(f64::NAN),
        median_km: if dists.is_empty() { f64::NAN } else { dists[dists.len() / 2] },
        min_distances_km: dists,
        cancelled,
    }
}

fn empty_result(samples: usize, years: f64, why: &str) -> MonteCarloResult {
    MonteCarloResult {
        samples: 0,
        impacts: 0,
        impact_probability: 0.0,
        ip_low: 0.0,
        ip_high: 0.0,
        method: format!("failed: {why}"),
        years,
        impact_dates: Vec::new(),
        min_distances_km: Vec::new(),
        min_km: f64::NAN,
        median_km: f64::NAN,
        cancelled: samples == 0,
    }
}

/// 95% Wilson score interval for k successes in n trials.
pub fn wilson(k: usize, n: usize) -> (f64, f64) {
    if n == 0 {
        return (0.0, 1.0);
    }
    let z = 1.959_964;
    let n = n as f64;
    let p = k as f64 / n;
    let den = 1.0 + z * z / n;
    let centre = (p + z * z / (2.0 * n)) / den;
    let half = z * ((p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt()) / den;
    ((centre - half).max(0.0), (centre + half).min(1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn energy_of_a_140m_stony_asteroid() {
        let m = mass_kg(0.14, 2600.0);
        let e = impact_energy_mt(m, 15.0);
        // ~3.7e9 kg at 18.7 km/s -> roughly 150-170 Mt
        assert!(e > 100.0 && e < 250.0, "{e}");
    }

    #[test]
    fn torino_regions() {
        assert_eq!(torino(0.0, 1e4), 0);
        assert_eq!(torino(1e-3, 0.5), 0);
        assert_eq!(torino(1e-9, 10.0), 0);
        assert_eq!(torino(1e-4, 1e4), 1); // -4 + 3.2 = -0.8
        assert_eq!(torino(1e-3, 1e5), 2); // -3 + 4.0 = 1.0
        assert_eq!(torino(0.995, 50.0), 8);
        assert_eq!(torino(0.995, 1e6), 10);
        assert_eq!(torino(0.05, 1e4), 4);
    }

    #[test]
    fn palermo_background_is_zero() {
        let e: f64 = 100.0;
        let years = 10.0;
        let fb = 0.03 * e.powf(-0.8);
        let ps = palermo(fb * years, e, years).unwrap();
        assert!(ps.abs() < 1e-12);
    }

    #[test]
    fn wilson_interval_contains_estimate() {
        let (lo, hi) = wilson(3, 1000);
        assert!(lo < 0.003 && hi > 0.003);
        let (lo0, hi0) = wilson(0, 1000);
        assert!(lo0 < 1e-12);
        assert!(hi0 > 0.0 && hi0 < 0.01);
    }

    #[test]
    fn isotropic_monte_carlo_returns_finite_numbers() {
        let el = Elements { a: 1.3, e: 0.3, i: 0.1, node: 1.0, peri: 2.0, m: 0.5, epoch: 2_461_300.5 };
        let (r, v) = el.state_at(el.epoch, GM_SUN);
        let done = AtomicUsize::new(0);
        let cancel = AtomicBool::new(false);
        let res = monte_carlo(
            r,
            v,
            el.epoch,
            1.0,
            32,
            Uncertainty::Isotropic { pos_km: 1000.0, vel_ms: 0.1 },
            None,
            7,
            McProgress { done: &done, cancel: &cancel },
        );
        assert_eq!(res.samples, 32);
        assert!(res.min_km.is_finite() && res.min_km > 0.0);
        assert!(res.impact_probability.is_finite());
    }
}
