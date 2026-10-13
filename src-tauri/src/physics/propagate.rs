//! Numerical propagation of small bodies.
//!
//! Asteroids are treated as massless test particles in a heliocentric frame.
//! The force model is the Sun plus the eight planets and the Moon as point
//! masses, including the indirect term that appears because the frame is
//! centred on the Sun rather than the barycentre. Integration is classical
//! RK4 with a step size picked from the local dynamical time scales, so steps
//! shrink automatically during planetary encounters.

use super::constants::*;
use super::ephemeris::{gm_table, EphemerisTable, IDX_EARTH, IDX_MOON, N_PLANETS};
use super::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// Continuous low thrust applied along a direction fixed in the body's
/// radial / transverse / normal frame. Used for ion beam and gravity tractor.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Thrust {
    /// Acceleration magnitude, AU/day^2.
    pub accel: f64,
    /// Direction in RTN components (unit vector).
    pub rtn: [f64; 3],
    pub start: f64,
    pub end: f64,
}

impl Thrust {
    #[inline]
    fn accel_at(&self, r: Vec3, v: Vec3, t: f64) -> Vec3 {
        let (lo, hi) = if self.start <= self.end { (self.start, self.end) } else { (self.end, self.start) };
        if t < lo || t > hi {
            return Vec3::ZERO;
        }
        rtn_to_inertial(r, v, self.rtn) * self.accel
    }
}

/// Convert a vector given in radial/transverse/normal components to the
/// inertial frame.
pub fn rtn_to_inertial(r: Vec3, v: Vec3, c: [f64; 3]) -> Vec3 {
    let rh = r.unit();
    let nh = r.cross(v).unit();
    let th = nh.cross(rh);
    rh * c[0] + th * c[1] + nh * c[2]
}

pub struct Propagator<'a> {
    pub table: &'a EphemerisTable,
    gm: [f64; N_PLANETS],
}

/// Result of one integrator step, handed to observers.
pub struct Step {
    pub t0: f64,
    pub t1: f64,
    pub r0: Vec3,
    pub r1: Vec3,
    pub v1: Vec3,
    /// Heliocentric Earth position at t0 and t1.
    pub e0: Vec3,
    pub e1: Vec3,
}

impl Step {
    /// Closest approach to Earth inside this step, treating relative motion as
    /// linear. Steps near Earth are short, so this is accurate to metres.
    pub fn earth_min(&self) -> (f64, f64) {
        let p0 = self.r0 - self.e0;
        let p1 = self.r1 - self.e1;
        let dp = p1 - p0;
        let dd = dp.norm2();
        let s = if dd > 0.0 { (-(p0.dot(dp)) / dd).clamp(0.0, 1.0) } else { 0.0 };
        ((p0 + dp * s).norm(), self.t0 + s * (self.t1 - self.t0))
    }
}

impl<'a> Propagator<'a> {
    pub fn new(table: &'a EphemerisTable) -> Self {
        Self { table, gm: gm_table() }
    }

    /// Sun-only force model, for testing the integrator in isolation.
    #[cfg(test)]
    pub fn sun_only(table: &'a EphemerisTable) -> Self {
        Self { table, gm: [0.0; N_PLANETS] }
    }

    #[inline]
    pub fn accel(&self, r: Vec3, pp: &[Vec3; N_PLANETS]) -> Vec3 {
        let r2 = r.norm2();
        let rn = r2.sqrt();
        let mut a = r * (-GM_SUN / (r2 * rn));
        for j in 0..N_PLANETS {
            let d = pp[j] - r;
            let d2 = d.norm2();
            let dn = d2.sqrt();
            let p2 = pp[j].norm2();
            let pn = p2.sqrt();
            a += d * (self.gm[j] / (d2 * dn)) - pp[j] * (self.gm[j] / (p2 * pn));
        }
        a
    }

    /// Step size (days, positive) from the local time scales.
    pub fn suggest_step(&self, r: Vec3, v: Vec3, t: f64) -> f64 {
        let rn = r.norm();
        let mut h = rn.powf(1.5) / GAUSS_K / 60.0;
        let pp = self.table.at(t);
        for &j in &[IDX_EARTH, IDX_MOON] {
            let d = (r - pp[j]).norm();
            if d < 0.2 {
                let pv = (self.table.at(t + 0.01)[j] - self.table.at(t - 0.01)[j]) * 50.0;
                let vrel = (v - pv).norm().max(1e-6);
                let tc = d / vrel;
                let tg = (d * d * d / self.gm[j]).sqrt();
                h = h.min(tc.min(tg) / 40.0);
            }
        }
        for j in 0..N_PLANETS {
            if j == IDX_EARTH || j == IDX_MOON {
                continue;
            }
            let d = (r - pp[j]).norm();
            let tg = (d * d * d / self.gm[j]).sqrt();
            h = h.min((tg / 40.0).max(d / v.norm().max(1e-6) / 40.0));
        }
        h.clamp(1e-6, 2.0)
    }

    fn rk4(&self, r: Vec3, v: Vec3, t: f64, h: f64, thrust: Option<&Thrust>) -> (Vec3, Vec3) {
        let p0 = self.table.at(t);
        let pm = self.table.at(t + 0.5 * h);
        let p1 = self.table.at(t + h);
        let f = |r: Vec3, v: Vec3, tt: f64, pp: &[Vec3; N_PLANETS]| -> Vec3 {
            let mut a = self.accel(r, pp);
            if let Some(th) = thrust {
                a += th.accel_at(r, v, tt);
            }
            a
        };
        let k1v = f(r, v, t, &p0);
        let k1r = v;
        let k2v = f(r + k1r * (0.5 * h), v + k1v * (0.5 * h), t + 0.5 * h, &pm);
        let k2r = v + k1v * (0.5 * h);
        let k3v = f(r + k2r * (0.5 * h), v + k2v * (0.5 * h), t + 0.5 * h, &pm);
        let k3r = v + k2v * (0.5 * h);
        let k4v = f(r + k3r * h, v + k3v * h, t + h, &p1);
        let k4r = v + k3v * h;
        let r1 = r + (k1r + k2r * 2.0 + k3r * 2.0 + k4r) * (h / 6.0);
        let v1 = v + (k1v + k2v * 2.0 + k3v * 2.0 + k4v) * (h / 6.0);
        (r1, v1)
    }

    /// Propagate from `t0` to `t1` (forwards or backwards). `observe` sees
    /// every step and may return `false` to stop early (e.g. on impact).
    /// Returns the final state and the time actually reached.
    pub fn advance<F>(&self, mut r: Vec3, mut v: Vec3, t0: f64, t1: f64, thrust: Option<&Thrust>, mut observe: F) -> (Vec3, Vec3, f64)
    where
        F: FnMut(&Step) -> bool,
    {
        let dir = if t1 >= t0 { 1.0 } else { -1.0 };
        let mut t = t0;
        let mut guard = 0usize;
        while (t1 - t) * dir > 1e-12 {
            let h = self.suggest_step(r, v, t).min((t1 - t).abs()) * dir;
            let (r1, v1) = self.rk4(r, v, t, h, thrust);
            if !r1.is_finite() || !v1.is_finite() {
                break;
            }
            let step = Step {
                t0: t,
                t1: t + h,
                r0: r,
                r1,
                v1,
                e0: self.table.at(t)[IDX_EARTH],
                e1: self.table.at(t + h)[IDX_EARTH],
            };
            r = r1;
            v = v1;
            t += h;
            if !observe(&step) {
                break;
            }
            guard += 1;
            if guard > 5_000_000 {
                break;
            }
        }
        (r, v, t)
    }

    /// Earth's heliocentric velocity at `t` (AU/day).
    pub fn earth_velocity(&self, t: f64) -> Vec3 {
        (self.table.at(t + 0.01)[IDX_EARTH] - self.table.at(t - 0.01)[IDX_EARTH]) * 50.0
    }
}

/// One close approach to Earth.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Encounter {
    pub jd: f64,
    pub dist_au: f64,
    pub dist_km: f64,
    /// Geocentric speed at closest approach, km/s.
    pub v_rel_kms: f64,
    /// Hyperbolic excess speed, km/s.
    pub v_inf_kms: f64,
    /// Approximate target-plane coordinates (km): xi, zeta.
    pub b_plane_km: [f64; 2],
    /// Gravitational capture radius of Earth for this v_inf (km).
    pub capture_radius_km: f64,
    pub impact: bool,
}

/// Collects Earth encounters below a distance threshold while propagating.
pub struct EncounterScanner {
    pub threshold_au: f64,
    pub encounters: Vec<Encounter>,
    pub closest: Option<Encounter>,
    prev: Option<(f64, f64, f64)>, // (d at end, seg min d, seg min t) of last step
    prev_prev_d: Option<f64>,
    pub impacted: bool,
}

impl EncounterScanner {
    pub fn new(threshold_au: f64) -> Self {
        Self { threshold_au, encounters: Vec::new(), closest: None, prev: None, prev_prev_d: None, impacted: false }
    }

    /// Feed one step. Returns false once the body has hit Earth.
    pub fn observe(&mut self, prop: &Propagator, step: &Step, v_at: impl Fn(f64) -> Vec3) -> bool {
        let (dmin, tmin) = step.earth_min();
        let d_end = (step.r1 - step.e1).norm();

        if dmin < EARTH_RADIUS_AU {
            let enc = self.make(prop, step, tmin, dmin, &v_at, true);
            self.push(enc);
            self.impacted = true;
            return false;
        }

        // Local minimum: interior minimum of this segment, or the previous
        // step ended at a minimum.
        let interior = tmin > step.t0.min(step.t1) && tmin < step.t0.max(step.t1);
        if interior && dmin < self.threshold_au {
            let enc = self.make(prop, step, tmin, dmin, &v_at, false);
            self.push(enc);
        } else if let (Some((d_prev, _, t_prev)), Some(dpp)) = (self.prev, self.prev_prev_d) {
            if d_prev < dpp && d_prev <= d_end && d_prev < self.threshold_au && !interior {
                let enc = self.make(prop, step, t_prev, d_prev, &v_at, false);
                self.push(enc);
            }
        }

        if let Some(c) = &self.closest {
            if dmin < c.dist_au {
                let enc = self.make(prop, step, tmin, dmin, &v_at, false);
                self.closest = Some(enc);
            }
        } else {
            self.closest = Some(self.make(prop, step, tmin, dmin, &v_at, false));
        }

        self.prev_prev_d = self.prev.map(|p| p.0);
        self.prev = Some((d_end, dmin, step.t1));
        true
    }

    fn push(&mut self, enc: Encounter) {
        // Merge with an encounter found a moment earlier (same pass).
        if let Some(last) = self.encounters.last_mut() {
            if (last.jd - enc.jd).abs() < 2.0 {
                if enc.dist_au < last.dist_au {
                    *last = enc;
                }
                return;
            }
        }
        self.encounters.push(enc);
    }

    fn make(&self, prop: &Propagator, step: &Step, t: f64, d: f64, v_at: &impl Fn(f64) -> Vec3, impact: bool) -> Encounter {
        let s = if (step.t1 - step.t0).abs() > 0.0 { (t - step.t0) / (step.t1 - step.t0) } else { 0.0 };
        let r = step.r0 + (step.r1 - step.r0) * s;
        let e = step.e0 + (step.e1 - step.e0) * s;
        let ve = prop.earth_velocity(t);
        let vrel = v_at(t) - ve;
        let vrel_kms = vrel.norm() * AU_PER_DAY_KMS;
        let gm_e = GM_SUN / MASS_RATIO_EARTH;
        let vinf2 = vrel.norm2() - 2.0 * gm_e / d.max(EARTH_RADIUS_AU);
        let vinf = vinf2.max(1e-12).sqrt();
        let vinf_kms = vinf * AU_PER_DAY_KMS;

        // Target plane: eta along v_rel, zeta opposite Earth's velocity projected
        // into the plane, xi completes the triad.
        let eta = vrel.unit();
        let ve_perp = ve - eta * ve.dot(eta);
        let zeta = (-ve_perp).unit();
        let xi = eta.cross(zeta);
        let p = r - e;
        let focus = (1.0 + 2.0 * gm_e / (d.max(EARTH_RADIUS_AU) * vinf * vinf)).sqrt();
        let bx = p.dot(xi) * focus * AU_KM;
        let bz = p.dot(zeta) * focus * AU_KM;
        let capture = EARTH_RADIUS_KM * (1.0 + (EARTH_ESCAPE_KMS / vinf_kms.max(0.01)).powi(2)).sqrt();

        Encounter {
            jd: t,
            dist_au: d,
            dist_km: d * AU_KM,
            v_rel_kms: vrel_kms,
            v_inf_kms: vinf_kms,
            b_plane_km: [bx, bz],
            capture_radius_km: capture,
            impact,
        }
    }
}

/// Propagate one trajectory and collect its Earth encounters.
pub fn scan_encounters(
    table: &EphemerisTable,
    r: Vec3,
    v: Vec3,
    t0: f64,
    t1: f64,
    thrust: Option<&Thrust>,
    threshold_au: f64,
) -> EncounterScanner {
    let prop = Propagator::new(table);
    let mut scanner = EncounterScanner::new(threshold_au);
    let mut last_v = (t0, v);
    let mut cur_v = (t0, v);
    prop.advance(r, v, t0, t1, thrust, |step| {
        last_v = cur_v;
        cur_v = (step.t1, step.v1);
        let (ta, va) = last_v;
        let (tb, vb) = cur_v;
        let v_at = |t: f64| {
            if (tb - ta).abs() < 1e-15 {
                vb
            } else {
                va + (vb - va) * ((t - ta) / (tb - ta))
            }
        };
        scanner.observe(&prop, step, v_at)
    });
    scanner
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::ephemeris::positions;
    use crate::physics::kepler::Elements;

    #[test]
    fn two_body_energy_is_conserved_over_a_year() {
        // Eccentric NEO-like orbit, Sun only: tests the integrator itself.
        let el = Elements { a: 1.2, e: 0.6, i: 0.1, node: 1.0, peri: 2.0, m: 0.5, epoch: 2_461_000.5 };
        let (r, v) = el.state_at(el.epoch, GM_SUN);
        let table = EphemerisTable::build(el.epoch, el.epoch + 366.0);
        let prop = Propagator::sun_only(&table);
        let e0 = 0.5 * v.norm2() - GM_SUN / r.norm();
        let (r1, v1, _) = prop.advance(r, v, el.epoch, el.epoch + 365.25, None, |_| true);
        let e1 = 0.5 * v1.norm2() - GM_SUN / r1.norm();
        assert!(((e1 - e0) / e0).abs() < 1e-8, "drift {}", (e1 - e0) / e0);
        // and the position matches the analytic two-body solution
        let (ra, _) = el.state_at(el.epoch + 365.25, GM_SUN);
        assert!((r1 - ra).norm() * AU_KM < 50.0, "position error {} km", (r1 - ra).norm() * AU_KM);
    }

    #[test]
    fn earth_is_not_lost_from_table() {
        let t = 2_461_300.0;
        let table = EphemerisTable::build(t, t + 1.0);
        let a = table.at(t)[IDX_EARTH];
        let b = positions(t)[IDX_EARTH];
        assert!((a - b).norm() < 1e-9);
    }

    #[test]
    fn apophis_2029_flyby() {
        // SBDB orbit 220 for 99942 Apophis (epoch 2461200.5 TDB, full precision).
        let deg = |x: f64| x.to_radians();
        let el = Elements {
            a: 0.9223592206975018,
            e: 0.1911492279663492,
            i: deg(3.340996879880978),
            node: deg(203.8936514240762),
            peri: deg(126.6795706895841),
            m: deg(175.3304026592739),
            epoch: 2_461_200.5,
        };
        let (r, v) = el.state_at(el.epoch, GM_SUN);
        let t_end = 2_462_245.0; // a few days after the flyby
        let table = EphemerisTable::build(el.epoch, t_end);
        let scan = scan_encounters(&table, r, v, el.epoch, t_end, None, 0.05);
        let c = scan.closest.expect("closest approach");
        // JPL CAD: 2029-Apr-13 21:46 TDB (JD 2462240.4071), 38,011 km, 7.42 km/s.
        // This engine gets ~37,900 km within a minute of the JPL time.
        assert!((c.jd - 2_462_240.4071).abs() < 0.01, "date {}", c.jd);
        assert!((c.dist_km - 38_011.0).abs() < 1_500.0, "distance {} km", c.dist_km);
        assert!((c.v_rel_kms - 7.42).abs() < 0.1, "v_rel {}", c.v_rel_kms);
        assert!(!scan.impacted);
    }
}
