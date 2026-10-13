//! Two-body orbits: Keplerian elements <-> Cartesian state.

use super::vec3::Vec3;
use serde::{Deserialize, Serialize};
use std::f64::consts::{PI, TAU};

/// Heliocentric osculating elements, J2000 ecliptic frame.
/// Distances in AU, angles in radians, epoch as a TDB Julian date.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Elements {
    pub a: f64,
    pub e: f64,
    pub i: f64,
    pub node: f64,
    pub peri: f64,
    pub m: f64,
    pub epoch: f64,
}

impl Elements {
    /// Build from perihelion-based elements (the form JPL uses for covariances).
    pub fn from_perihelion(
        e: f64,
        q: f64,
        tp: f64,
        node: f64,
        peri: f64,
        i: f64,
        epoch: f64,
        mu: f64,
    ) -> Option<Self> {
        if !(0.0..1.0).contains(&e) || q <= 0.0 {
            return None;
        }
        let a = q / (1.0 - e);
        let n = (mu / (a * a * a)).sqrt();
        Some(Self {
            a,
            e,
            i,
            node,
            peri,
            m: wrap_angle(n * (epoch - tp)),
            epoch,
        })
    }

    /// Mean motion in rad/day.
    pub fn mean_motion(&self, mu: f64) -> f64 {
        (mu / (self.a * self.a * self.a)).sqrt()
    }

    /// Orbital period in days.
    pub fn period(&self, mu: f64) -> f64 {
        TAU / self.mean_motion(mu)
    }

    pub fn is_valid(&self) -> bool {
        self.a.is_finite()
            && self.a > 0.0
            && (0.0..1.0).contains(&self.e)
            && self.i.is_finite()
            && self.node.is_finite()
            && self.peri.is_finite()
            && self.m.is_finite()
            && self.epoch.is_finite()
    }

    /// State vector at `jd`, propagating the mean anomaly on the two-body orbit.
    pub fn state_at(&self, jd: f64, mu: f64) -> (Vec3, Vec3) {
        let m = self.m + self.mean_motion(mu) * (jd - self.epoch);
        self.state_with_mean_anomaly(m, mu)
    }

    /// Position on the orbit for a given true anomaly (used to draw orbits).
    pub fn position_at_true_anomaly(&self, nu: f64) -> Vec3 {
        let p = self.a * (1.0 - self.e * self.e);
        let r = p / (1.0 + self.e * nu.cos());
        self.perifocal_to_ecliptic(Vec3::new(r * nu.cos(), r * nu.sin(), 0.0))
    }

    pub fn state_with_mean_anomaly(&self, m: f64, mu: f64) -> (Vec3, Vec3) {
        let e = self.e;
        let ea = solve_kepler(wrap_angle(m), e);
        let (sin_e, cos_e) = ea.sin_cos();
        let b = self.a * (1.0 - e * e).sqrt();
        let r = self.a * (1.0 - e * cos_e);
        let x = self.a * (cos_e - e);
        let y = b * sin_e;
        let n = self.mean_motion(mu);
        let edot = n / (1.0 - e * cos_e);
        let vx = -self.a * sin_e * edot;
        let vy = b * cos_e * edot;
        debug_assert!(r > 0.0);
        (
            self.perifocal_to_ecliptic(Vec3::new(x, y, 0.0)),
            self.perifocal_to_ecliptic(Vec3::new(vx, vy, 0.0)),
        )
    }

    fn perifocal_to_ecliptic(&self, p: Vec3) -> Vec3 {
        let (so, co) = self.node.sin_cos();
        let (sw, cw) = self.peri.sin_cos();
        let (si, ci) = self.i.sin_cos();
        let r11 = co * cw - so * sw * ci;
        let r12 = -co * sw - so * cw * ci;
        let r21 = so * cw + co * sw * ci;
        let r22 = -so * sw + co * cw * ci;
        let r31 = sw * si;
        let r32 = cw * si;
        Vec3::new(
            r11 * p.x + r12 * p.y,
            r21 * p.x + r22 * p.y,
            r31 * p.x + r32 * p.y,
        )
    }

    /// Osculating elements from a heliocentric state. Returns `None` for
    /// parabolic/hyperbolic or degenerate states.
    pub fn from_state(r: Vec3, v: Vec3, mu: f64, epoch: f64) -> Option<Self> {
        let rn = r.norm();
        if rn <= 0.0 || !r.is_finite() || !v.is_finite() {
            return None;
        }
        let h = r.cross(v);
        let hn = h.norm();
        if hn <= 0.0 {
            return None;
        }
        let energy = 0.5 * v.norm2() - mu / rn;
        if energy >= 0.0 {
            return None;
        }
        let a = -mu / (2.0 * energy);
        let evec = v.cross(h) * (1.0 / mu) - r * (1.0 / rn);
        let e = evec.norm();
        let i = (h.z / hn).clamp(-1.0, 1.0).acos();
        let nvec = Vec3::new(-h.y, h.x, 0.0);
        let nn = nvec.norm();

        let node = if nn > 1e-14 {
            wrap_angle(nvec.y.atan2(nvec.x))
        } else {
            0.0
        };
        let peri = if e > 1e-12 {
            if nn > 1e-14 {
                let mut w = (nvec.dot(evec) / (nn * e)).clamp(-1.0, 1.0).acos();
                if evec.z < 0.0 {
                    w = TAU - w;
                }
                w
            } else {
                // Equatorial orbit: measure from x axis
                let mut w = evec.y.atan2(evec.x);
                if h.z < 0.0 {
                    w = TAU - w;
                }
                wrap_angle(w)
            }
        } else {
            0.0
        };

        // True anomaly -> eccentric -> mean
        let nu = if e > 1e-12 {
            let mut nu = (evec.dot(r) / (e * rn)).clamp(-1.0, 1.0).acos();
            if r.dot(v) < 0.0 {
                nu = TAU - nu;
            }
            nu
        } else if nn > 1e-14 {
            let mut u = (nvec.dot(r) / (nn * rn)).clamp(-1.0, 1.0).acos();
            if r.z < 0.0 {
                u = TAU - u;
            }
            u
        } else {
            wrap_angle(r.y.atan2(r.x))
        };
        let ea = 2.0 * (((1.0 - e) / (1.0 + e)).sqrt() * (nu / 2.0).tan()).atan();
        let m = wrap_angle(ea - e * ea.sin());

        Some(Self {
            a,
            e,
            i,
            node,
            peri,
            m,
            epoch,
        })
    }
}

/// Solve Kepler's equation M = E - e sin E for elliptic orbits.
/// Newton iterations with a starting guess that converges for all e < 1.
pub fn solve_kepler(m: f64, e: f64) -> f64 {
    let m = wrap_angle_pm(m);
    let mut ea = if e < 0.8 {
        m + e * m.sin()
    } else if m >= 0.0 {
        PI
    } else {
        -PI
    };
    for _ in 0..60 {
        let f = ea - e * ea.sin() - m;
        let fp = 1.0 - e * ea.cos();
        let d = f / fp;
        ea -= d;
        if d.abs() < 1e-14 {
            break;
        }
    }
    ea
}

/// Wrap to [0, 2π).
pub fn wrap_angle(x: f64) -> f64 {
    let r = x.rem_euclid(TAU);
    if r >= TAU {
        0.0
    } else {
        r
    }
}

/// Wrap to [-π, π).
pub fn wrap_angle_pm(x: f64) -> f64 {
    (x + PI).rem_euclid(TAU) - PI
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::constants::GM_SUN;

    #[test]
    fn kepler_converges_for_high_eccentricity() {
        for &e in &[0.0, 0.1, 0.5, 0.9, 0.97, 0.999] {
            for k in 0..64 {
                let m = -PI + k as f64 * TAU / 64.0;
                let ea = solve_kepler(m, e);
                let back = ea - e * ea.sin();
                assert!((wrap_angle_pm(back - m)).abs() < 1e-10, "e={e} m={m}");
            }
        }
    }

    #[test]
    fn elements_round_trip() {
        let el = Elements {
            a: 1.458,
            e: 0.2229,
            i: 0.189,
            node: 5.31,
            peri: 3.12,
            m: 1.09,
            epoch: 2461200.5,
        };
        let (r, v) = el.state_at(el.epoch, GM_SUN);
        let back = Elements::from_state(r, v, GM_SUN, el.epoch).unwrap();
        assert!((back.a - el.a).abs() < 1e-10);
        assert!((back.e - el.e).abs() < 1e-10);
        assert!((back.i - el.i).abs() < 1e-10);
        assert!((wrap_angle_pm(back.node - el.node)).abs() < 1e-9);
        assert!((wrap_angle_pm(back.peri - el.peri)).abs() < 1e-9);
        assert!((wrap_angle_pm(back.m - el.m)).abs() < 1e-9);
    }

    #[test]
    fn perihelion_form_matches_mean_anomaly_form() {
        let mu = GM_SUN;
        let el = Elements {
            a: 0.9224,
            e: 0.1911,
            i: 0.0583,
            node: 3.5586,
            peri: 2.2110,
            m: 0.0,
            epoch: 2461000.5,
        };
        let tp = el.epoch - 10.0;
        let from_q = Elements::from_perihelion(
            el.e,
            el.a * (1.0 - el.e),
            tp,
            el.node,
            el.peri,
            el.i,
            el.epoch,
            mu,
        )
        .unwrap();
        let expected_m = el.mean_motion(mu) * 10.0;
        assert!((from_q.m - expected_m).abs() < 1e-12);
    }
}
