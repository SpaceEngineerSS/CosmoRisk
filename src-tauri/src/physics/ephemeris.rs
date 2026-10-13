//! Planet and Moon positions.
//!
//! Earth comes from a truncated VSOP87B series (sub-arcsecond, a few hundred
//! km), because close-approach geometry depends on it more than on anything
//! else. The other planets use the JPL "Keplerian Elements for Approximate
//! Positions of the Major Planets" (E. M. Standish, Table 1, valid 1800–2050),
//! good to some arcseconds — plenty for perturbations and display. The Moon
//! uses mean lunar elements plus the largest periodic terms. None of this is a
//! substitute for a JPL DE ephemeris; it is a fast, self-contained model.

use super::constants::*;
use super::kepler::{solve_kepler, wrap_angle};
use super::vec3::Vec3;
use super::vsop87_earth;

/// Massive bodies the engine knows about, in a fixed order. The same order is
/// used in the binary frame sent to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Planet {
    Mercury,
    Venus,
    Earth,
    Moon,
    Mars,
    Jupiter,
    Saturn,
    Uranus,
    Neptune,
}

pub const PLANETS: [Planet; 9] = [
    Planet::Mercury,
    Planet::Venus,
    Planet::Earth,
    Planet::Moon,
    Planet::Mars,
    Planet::Jupiter,
    Planet::Saturn,
    Planet::Uranus,
    Planet::Neptune,
];
pub const N_PLANETS: usize = PLANETS.len();
pub const IDX_EARTH: usize = 2;
pub const IDX_MOON: usize = 3;

impl Planet {
    pub fn id(self) -> &'static str {
        match self {
            Planet::Mercury => "mercury",
            Planet::Venus => "venus",
            Planet::Earth => "earth",
            Planet::Moon => "moon",
            Planet::Mars => "mars",
            Planet::Jupiter => "jupiter",
            Planet::Saturn => "saturn",
            Planet::Uranus => "uranus",
            Planet::Neptune => "neptune",
        }
    }

    /// GM in AU^3/day^2.
    pub fn gm(self) -> f64 {
        let earth = GM_SUN / MASS_RATIO_EARTH;
        match self {
            Planet::Mercury => GM_SUN / MASS_RATIO_MERCURY,
            Planet::Venus => GM_SUN / MASS_RATIO_VENUS,
            Planet::Earth => earth,
            Planet::Moon => earth / EARTH_MOON_RATIO,
            Planet::Mars => GM_SUN / MASS_RATIO_MARS,
            Planet::Jupiter => GM_SUN / MASS_RATIO_JUPITER,
            Planet::Saturn => GM_SUN / MASS_RATIO_SATURN,
            Planet::Uranus => GM_SUN / MASS_RATIO_URANUS,
            Planet::Neptune => GM_SUN / MASS_RATIO_NEPTUNE,
        }
    }

    /// Mean radius in km (for display).
    pub fn radius_km(self) -> f64 {
        match self {
            Planet::Mercury => 2_439.7,
            Planet::Venus => 6_051.8,
            Planet::Earth => EARTH_RADIUS_KM,
            Planet::Moon => MOON_RADIUS_KM,
            Planet::Mars => 3_389.5,
            Planet::Jupiter => 69_911.0,
            Planet::Saturn => 58_232.0,
            Planet::Uranus => 25_362.0,
            Planet::Neptune => 24_622.0,
        }
    }
}

pub fn gm_table() -> [f64; N_PLANETS] {
    let mut out = [0.0; N_PLANETS];
    for (k, p) in PLANETS.iter().enumerate() {
        out[k] = p.gm();
    }
    out
}

/// Standish table rows: a, e, I, L, long.peri, long.node and their rates per
/// Julian century. Angles in degrees.
struct Row {
    el: [f64; 6],
    rate: [f64; 6],
}

const MERCURY: Row = Row {
    el: [
        0.38709927,
        0.20563593,
        7.00497902,
        252.25032350,
        77.45779628,
        48.33076593,
    ],
    rate: [
        0.00000037,
        0.00001906,
        -0.00594749,
        149472.67411175,
        0.16047689,
        -0.12534081,
    ],
};
const VENUS: Row = Row {
    el: [
        0.72333566,
        0.00677672,
        3.39467605,
        181.97909950,
        131.60246718,
        76.67984255,
    ],
    rate: [
        0.00000390,
        -0.00004107,
        -0.00078890,
        58517.81538729,
        0.00268329,
        -0.27769418,
    ],
};
const EM_BARY: Row = Row {
    el: [
        1.00000261,
        0.01671123,
        -0.00001531,
        100.46457166,
        102.93768193,
        0.0,
    ],
    rate: [
        0.00000562,
        -0.00004392,
        -0.01294668,
        35999.37244981,
        0.32327364,
        0.0,
    ],
};
const MARS: Row = Row {
    el: [
        1.52371034,
        0.09339410,
        1.84969142,
        -4.55343205,
        -23.94362959,
        49.55953891,
    ],
    rate: [
        0.00001847,
        0.00007882,
        -0.00813131,
        19140.30268499,
        0.44441088,
        -0.29257343,
    ],
};
const JUPITER: Row = Row {
    el: [
        5.20288700,
        0.04838624,
        1.30439695,
        34.39644051,
        14.72847983,
        100.47390909,
    ],
    rate: [
        -0.00011607,
        -0.00013253,
        -0.00183714,
        3034.74612775,
        0.21252668,
        0.20469106,
    ],
};
const SATURN: Row = Row {
    el: [
        9.53667594,
        0.05386179,
        2.48599187,
        49.95424423,
        92.59887831,
        113.66242448,
    ],
    rate: [
        -0.00125060,
        -0.00050991,
        0.00193609,
        1222.49362201,
        -0.41897216,
        -0.28867794,
    ],
};
const URANUS: Row = Row {
    el: [
        19.18916464,
        0.04725744,
        0.77263783,
        313.23810451,
        170.95427630,
        74.01692503,
    ],
    rate: [
        -0.00196176,
        -0.00004397,
        -0.00242939,
        428.48202785,
        0.40805281,
        0.04240589,
    ],
};
const NEPTUNE: Row = Row {
    el: [
        30.06992276,
        0.00859048,
        1.77004347,
        -55.12002969,
        44.96476227,
        131.78422574,
    ],
    rate: [
        0.00026291,
        0.00005105,
        0.00035372,
        218.45945325,
        -0.32241464,
        -0.00508664,
    ],
};

/// Heliocentric J2000-ecliptic position of a Standish row at `jd`.
fn standish_position(row: &Row, jd: f64) -> Vec3 {
    let t = (jd - J2000) / JULIAN_CENTURY;
    let v = |k: usize| row.el[k] + row.rate[k] * t;
    let a = v(0);
    let e = v(1);
    let i = v(2).to_radians();
    let l = v(3);
    let varpi = v(4);
    let node = v(5).to_radians();
    let peri = (varpi.to_radians()) - node;
    let m = wrap_angle((l - varpi).to_radians());

    let ea = solve_kepler(m, e);
    let xp = a * (ea.cos() - e);
    let yp = a * (1.0 - e * e).sqrt() * ea.sin();

    let (so, co) = node.sin_cos();
    let (sw, cw) = peri.sin_cos();
    let (si, ci) = i.sin_cos();
    Vec3::new(
        (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
        (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
        (sw * si) * xp + (cw * si) * yp,
    )
}

/// Geocentric Moon position (AU, J2000 ecliptic). Mean elements with the main
/// perturbation terms (after P. Schlyter, "Computing planetary positions").
pub fn moon_geocentric(jd: f64) -> Vec3 {
    let d = jd - 2_451_543.5;
    let deg = |x: f64| x.to_radians();

    let n = 125.1228 - 0.052_953_808_3 * d;
    let i = 5.1454;
    let w = 318.0634 + 0.164_357_322_3 * d;
    let a = 60.2666; // Earth radii
    let e = 0.054_900;
    let m = 115.3654 + 13.064_992_950_9 * d;

    // Sun's mean anomaly and argument of perihelion (for perturbations)
    let ms = 356.0470 + 0.985_600_258_5 * d;
    let ws = 282.9404 + 4.70935e-5 * d;

    let ea = solve_kepler(wrap_angle(deg(m)), e);
    let xv = a * (ea.cos() - e);
    let yv = a * (1.0 - e * e).sqrt() * ea.sin();
    let v = yv.atan2(xv);
    let r = (xv * xv + yv * yv).sqrt();

    let (sn, cn) = deg(n).sin_cos();
    let (svw, cvw) = (v + deg(w)).sin_cos();
    let (si, ci) = deg(i).sin_cos();
    let xh = r * (cn * cvw - sn * svw * ci);
    let yh = r * (sn * cvw + cn * svw * ci);
    let zh = r * (svw * si);

    let mut lon = yh.atan2(xh).to_degrees();
    let mut lat = zh.atan2((xh * xh + yh * yh).sqrt()).to_degrees();
    let mut dist = r;

    // Perturbations
    let lm = n + w + m; // Moon mean longitude
    let ls = ws + ms; // Sun mean longitude
    let dm = lm - ls; // mean elongation
    let f = lm - n; // argument of latitude
    let (mr, msr, dr, fr) = (deg(m), deg(ms), deg(dm), deg(f));

    lon += -1.274 * (mr - 2.0 * dr).sin() + 0.658 * (2.0 * dr).sin()
        - 0.186 * msr.sin()
        - 0.059 * (2.0 * mr - 2.0 * dr).sin()
        - 0.057 * (mr - 2.0 * dr + msr).sin()
        + 0.053 * (mr + 2.0 * dr).sin()
        + 0.046 * (2.0 * dr - msr).sin()
        + 0.041 * (mr - msr).sin()
        - 0.035 * dr.sin()
        - 0.031 * (mr + msr).sin()
        - 0.015 * (2.0 * fr - 2.0 * dr).sin()
        + 0.011 * (mr - 4.0 * dr).sin();
    lat += -0.173 * (fr - 2.0 * dr).sin()
        - 0.055 * (mr - fr - 2.0 * dr).sin()
        - 0.046 * (mr + fr - 2.0 * dr).sin()
        + 0.033 * (fr + 2.0 * dr).sin()
        + 0.017 * (2.0 * mr + fr).sin();
    dist += -0.58 * (mr - 2.0 * dr).cos() - 0.46 * (2.0 * dr).cos();

    // Elements above are referred to the equinox of date; rotate to J2000.
    lon -= 3.82394e-5 * (jd - J2000);

    let (slon, clon) = lon.to_radians().sin_cos();
    let (slat, clat) = lat.to_radians().sin_cos();
    let r_au = dist * EARTH_RADIUS_KM / AU_KM;
    Vec3::new(r_au * clat * clon, r_au * clat * slon, r_au * slat)
}

/// Heliocentric Earth (AU, J2000 ecliptic) from VSOP87B.
pub fn earth_vsop87(jd: f64) -> Vec3 {
    let t = (jd - J2000) / 365_250.0;
    let eval = |series: &[&[(f64, f64, f64)]]| -> f64 {
        let mut sum = 0.0;
        let mut tp = 1.0;
        for terms in series {
            let mut s = 0.0;
            for &(a, b, c) in terms.iter() {
                s += a * (b + c * t).cos();
            }
            sum += s * tp;
            tp *= t;
        }
        sum
    };
    let l = eval(&vsop87_earth::L);
    let b = eval(&vsop87_earth::B);
    let r = eval(&vsop87_earth::R);
    let (sl, cl) = l.sin_cos();
    let (sb, cb) = b.sin_cos();
    Vec3::new(r * cb * cl, r * cb * sl, r * sb)
}

/// Heliocentric positions of all massive bodies at `jd`, in `PLANETS` order.
pub fn positions(jd: f64) -> [Vec3; N_PLANETS] {
    let moon_geo = moon_geocentric(jd);
    let earth = earth_vsop87(jd);
    [
        standish_position(&MERCURY, jd),
        standish_position(&VENUS, jd),
        earth,
        earth + moon_geo,
        standish_position(&MARS, jd),
        standish_position(&JUPITER, jd),
        standish_position(&SATURN, jd),
        standish_position(&URANUS, jd),
        standish_position(&NEPTUNE, jd),
    ]
}

/// Heliocentric velocity of a body by central difference (AU/day).
pub fn velocity(idx: usize, jd: f64) -> Vec3 {
    let h = 0.01;
    let a = positions(jd - h)[idx];
    let b = positions(jd + h)[idx];
    (b - a) * (1.0 / (2.0 * h))
}

/// Orbit samples for drawing a planet's path (AU). The Moon returns an empty
/// list: its orbit is drawn relative to Earth on the frontend.
pub fn orbit_path(idx: usize, jd: f64, samples: usize) -> Vec<f64> {
    let row = match PLANETS[idx] {
        Planet::Mercury => &MERCURY,
        Planet::Venus => &VENUS,
        Planet::Earth => &EM_BARY,
        Planet::Moon => return Vec::new(),
        Planet::Mars => &MARS,
        Planet::Jupiter => &JUPITER,
        Planet::Saturn => &SATURN,
        Planet::Uranus => &URANUS,
        Planet::Neptune => &NEPTUNE,
    };
    let t = (jd - J2000) / JULIAN_CENTURY;
    let a = row.el[0] + row.rate[0] * t;
    let period = 365.25 * a.powf(1.5);
    let mut out = Vec::with_capacity(samples * 3);
    for k in 0..samples {
        let p = standish_position(row, jd + period * k as f64 / samples as f64);
        out.extend_from_slice(&[p.x, p.y, p.z]);
    }
    out
}

/// Pre-computed ephemeris on a uniform time grid with cubic (Catmull-Rom)
/// interpolation. Building it once per propagation window is much cheaper
/// than solving nine Kepler equations at every integrator stage.
pub struct EphemerisTable {
    t0: f64,
    step: f64,
    data: Vec<[Vec3; N_PLANETS]>,
}

impl EphemerisTable {
    /// Grid spacing in days. At 0.25 d the cubic interpolation error stays
    /// below ~0.2 km for Earth and the Moon (it scales with the step^4).
    pub const STEP: f64 = 0.25;

    /// Table covering [t_a, t_b] (either order) with margin for the stencil.
    pub fn build(t_a: f64, t_b: f64) -> Self {
        let (lo, hi) = if t_a <= t_b { (t_a, t_b) } else { (t_b, t_a) };
        let step = Self::STEP;
        let t0 = (lo / step).floor() * step - 2.0 * step;
        let n = (((hi - t0) / step).ceil() as usize) + 4;
        let data = if n > 256 {
            use rayon::prelude::*;
            (0..n)
                .into_par_iter()
                .map(|k| positions(t0 + k as f64 * step))
                .collect()
        } else {
            (0..n).map(|k| positions(t0 + k as f64 * step)).collect()
        };
        Self { t0, step, data }
    }

    pub fn covers(&self, t: f64) -> bool {
        let s = (t - self.t0) / self.step;
        s >= 1.0 && s <= (self.data.len() as f64 - 3.0)
    }

    /// Interpolated positions of all bodies at `t`.
    pub fn at(&self, t: f64) -> [Vec3; N_PLANETS] {
        if !self.covers(t) {
            return positions(t);
        }
        let s = (t - self.t0) / self.step;
        let k = s.floor() as usize;
        let u = s - k as f64;
        let (p0, p1, p2, p3) = (
            &self.data[k - 1],
            &self.data[k],
            &self.data[k + 1],
            &self.data[k + 2],
        );
        // Catmull-Rom weights
        let u2 = u * u;
        let u3 = u2 * u;
        let w0 = -0.5 * u3 + u2 - 0.5 * u;
        let w1 = 1.5 * u3 - 2.5 * u2 + 1.0;
        let w2 = -1.5 * u3 + 2.0 * u2 + 0.5 * u;
        let w3 = 0.5 * u3 - 0.5 * u2;
        let mut out = [Vec3::ZERO; N_PLANETS];
        for j in 0..N_PLANETS {
            out[j] = p0[j] * w0 + p1[j] * w1 + p2[j] * w2 + p3[j] * w3;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn earth_at_j2000() {
        // JPL Horizons, Earth heliocentric ecliptic J2000 at 2000-01-01 12:00 TDB:
        // x = -0.17713509, y = 0.96724550, z = -4.0e-6 AU
        let p = positions(J2000)[IDX_EARTH];
        assert!((p.x + 0.177135).abs() < 3e-5, "{p:?}");
        assert!((p.y - 0.967245).abs() < 3e-5, "{p:?}");
        assert!(p.z.abs() < 1e-4);
    }

    #[test]
    fn moon_distance_is_reasonable() {
        for k in 0..40 {
            let jd = J2000 + k as f64 * 3.7;
            let km = moon_geocentric(jd).norm() * AU_KM;
            assert!((350_000.0..410_000.0).contains(&km), "jd={jd} dist={km}");
        }
    }

    #[test]
    fn table_matches_direct_evaluation() {
        let t0 = 2_461_300.0;
        let table = EphemerisTable::build(t0, t0 + 30.0);
        for k in 0..100 {
            let t = t0 + k as f64 * 0.2917;
            let a = table.at(t);
            let b = positions(t);
            for j in 0..N_PLANETS {
                let err_km = (a[j] - b[j]).norm() * AU_KM;
                // Earth and Moon matter for encounters; Mercury moves fastest.
                let tol = match j {
                    IDX_EARTH => 1.0,
                    IDX_MOON => 5.0,
                    _ => 50.0,
                };
                assert!(err_km < tol, "body {j} err {err_km} km");
            }
        }
    }
}
