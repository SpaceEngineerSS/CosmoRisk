//! Data sources. Everything comes from the JPL Solar System Dynamics APIs,
//! which are public and need no API key:
//!
//! * SBDB Query API  - bulk orbital elements for catalogue presets
//! * SBDB API        - one object with physical data and orbit covariance
//! * CAD API         - close approaches to Earth
//! * Sentry API      - JPL's impact monitoring list

pub mod cache;
pub mod jpl;

use crate::physics::kepler::Elements;
use crate::physics::risk::Covariance;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One small body as the app knows it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectRecord {
    /// Stable id (primary designation).
    pub id: String,
    /// Display name, e.g. "99942 Apophis (2004 MN4)".
    pub name: String,
    pub elements: Elements,
    pub h: Option<f64>,
    pub diameter_km: Option<f64>,
    /// True when the diameter is derived from H with an assumed albedo.
    pub diameter_estimated: bool,
    pub albedo: Option<f64>,
    pub pha: bool,
    pub neo: bool,
    pub orbit_class: Option<String>,
    pub moid_au: Option<f64>,
    /// JPL orbit condition code (0 = best, 9 = worst).
    pub condition_code: Option<u8>,
    pub spectral: Option<String>,
    pub rotation_h: Option<f64>,
    pub covariance: Option<Covariance>,
    /// True if the object is on the Sentry impact-monitoring list.
    pub sentry: bool,
    /// Where the record came from ("SBDB query", "SBDB").
    pub source: String,
}

impl ObjectRecord {
    /// Best available diameter (km), filling in from H when missing.
    pub fn effective_diameter_km(&self) -> f64 {
        if let Some(d) = self.diameter_km {
            return d;
        }
        match self.h {
            Some(h) => crate::physics::risk::diameter_from_h(h, self.albedo.unwrap_or(0.14)),
            None => 0.1,
        }
    }
}

/// JPL APIs return numbers as strings, numbers or null.
pub(crate) fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub(crate) fn text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub(crate) fn flag(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::String(s) => matches!(s.as_str(), "Y" | "y" | "true" | "1"),
        _ => false,
    }
}
