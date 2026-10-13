//! Physical constants. The engine works in AU, days and AU/day, which keeps
//! numbers close to 1 and lets us use the Gaussian gravitational constant
//! directly.

/// Gaussian gravitational constant k (AU^1.5 / day).
pub const GAUSS_K: f64 = 0.017_202_098_95;
/// GM of the Sun in AU^3/day^2 (= k^2).
pub const GM_SUN: f64 = GAUSS_K * GAUSS_K;

/// Astronomical unit in km.
pub const AU_KM: f64 = 149_597_870.7;
/// Seconds per day.
pub const DAY_S: f64 = 86_400.0;
/// 1 AU/day expressed in km/s.
pub const AU_PER_DAY_KMS: f64 = AU_KM / DAY_S;

/// Julian date of the J2000.0 epoch.
pub const J2000: f64 = 2_451_545.0;
/// Days per Julian century.
pub const JULIAN_CENTURY: f64 = 36_525.0;

/// Sun / body mass ratios (IAU 2009 / DE430 values).
pub const MASS_RATIO_MERCURY: f64 = 6_023_597.400_017;
pub const MASS_RATIO_VENUS: f64 = 408_523.718_658;
pub const MASS_RATIO_EARTH: f64 = 332_946.048_166;
pub const MASS_RATIO_MARS: f64 = 3_098_703.590_291;
pub const MASS_RATIO_JUPITER: f64 = 1_047.348_625;
pub const MASS_RATIO_SATURN: f64 = 3_497.901_768;
pub const MASS_RATIO_URANUS: f64 = 22_902.981_613;
pub const MASS_RATIO_NEPTUNE: f64 = 19_412.237_346;
/// Earth / Moon mass ratio.
pub const EARTH_MOON_RATIO: f64 = 81.300_569;

/// Earth mean equatorial radius in km.
pub const EARTH_RADIUS_KM: f64 = 6_378.137;
/// Earth radius in AU.
pub const EARTH_RADIUS_AU: f64 = EARTH_RADIUS_KM / AU_KM;
/// Moon mean radius in km.
pub const MOON_RADIUS_KM: f64 = 1_737.4;
/// Escape velocity at Earth's surface, km/s.
pub const EARTH_ESCAPE_KMS: f64 = 11.186;

/// Joules per megaton of TNT.
pub const MEGATON_J: f64 = 4.184e15;

/// Difference TDB - UTC in seconds (TAI-UTC = 37 s + 32.184 s). Good to well
/// under a second until the next leap second, which is all a visualiser needs.
pub const TDB_MINUS_UTC_S: f64 = 69.184;
