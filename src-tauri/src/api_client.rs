// NASA NeoWs API Client
// Fetches Near-Earth Object data from NASA's API

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::physics_engine::{OrbitalElements, AU};
use std::f64::consts::PI;

const NEOWS_BASE_URL: &str = "https://api.nasa.gov/neo/rest/v1";

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeoWsResponse {
    pub links: Option<Links>,
    pub element_count: Option<i32>,
    pub near_earth_objects: Option<HashMap<String, Vec<NeoObject>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Links {
    pub next: Option<String>,
    pub prev: Option<String>,
    #[serde(rename = "self")]
    pub self_link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeoObject {
    pub id: String,
    pub neo_reference_id: Option<String>,
    pub name: String,
    pub nasa_jpl_url: Option<String>,
    pub absolute_magnitude_h: Option<f64>,
    pub estimated_diameter: Option<EstimatedDiameter>,
    pub is_potentially_hazardous_asteroid: Option<bool>,
    pub close_approach_data: Option<Vec<CloseApproachData>>,
    pub orbital_data: Option<OrbitalData>,
    pub is_sentry_object: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstimatedDiameter {
    pub kilometers: Option<DiameterRange>,
    pub meters: Option<DiameterRange>,
    pub miles: Option<DiameterRange>,
    pub feet: Option<DiameterRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiameterRange {
    pub estimated_diameter_min: f64,
    pub estimated_diameter_max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseApproachData {
    pub close_approach_date: Option<String>,
    pub close_approach_date_full: Option<String>,
    pub epoch_date_close_approach: Option<i64>,
    pub relative_velocity: Option<RelativeVelocity>,
    pub miss_distance: Option<MissDistance>,
    pub orbiting_body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelativeVelocity {
    pub kilometers_per_second: Option<String>,
    pub kilometers_per_hour: Option<String>,
    pub miles_per_hour: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissDistance {
    pub astronomical: Option<String>,
    pub lunar: Option<String>,
    pub kilometers: Option<String>,
    pub miles: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitalData {
    pub orbit_id: Option<String>,
    pub orbit_determination_date: Option<String>,
    pub first_observation_date: Option<String>,
    pub last_observation_date: Option<String>,
    pub data_arc_in_days: Option<i32>,
    pub observations_used: Option<i32>,
    pub orbit_uncertainty: Option<String>,
    pub minimum_orbit_intersection: Option<String>,
    pub jupiter_tisserand_invariant: Option<String>,
    pub epoch_osculation: Option<String>,
    pub eccentricity: Option<String>,
    pub semi_major_axis: Option<String>,
    pub inclination: Option<String>,
    pub ascending_node_longitude: Option<String>,
    pub orbital_period: Option<String>,
    pub perihelion_distance: Option<String>,
    pub perihelion_argument: Option<String>,
    pub aphelion_distance: Option<String>,
    pub perihelion_time: Option<String>,
    pub mean_anomaly: Option<String>,
    pub mean_motion: Option<String>,
    pub equinox: Option<String>,
    pub orbit_class: Option<OrbitClass>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitClass {
    pub orbit_class_type: Option<String>,
    pub orbit_class_description: Option<String>,
    pub orbit_class_range: Option<String>,
}

// =============================================================================
// BROWSE API RESPONSE
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowseResponse {
    pub links: Option<Links>,
    pub page: Option<PageInfo>,
    pub near_earth_objects: Vec<NeoObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub size: i32,
    pub total_elements: i32,
    pub total_pages: i32,
    pub number: i32,
}

// =============================================================================
// PROCESSED ASTEROID DATA
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedAsteroid {
    pub id: String,
    pub name: String,
    pub orbital_elements: OrbitalElements,
    pub estimated_diameter_m: f64,
    pub estimated_mass_kg: f64,  // NEW: estimated mass
    pub is_potentially_hazardous: bool,
    pub absolute_magnitude: f64,
    pub orbit_class: String,
    pub close_approaches: Vec<ProcessedCloseApproach>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedCloseApproach {
    pub date: String,
    pub miss_distance_km: f64,
    pub velocity_km_s: f64,
    pub orbiting_body: String,
}

/// Estimate asteroid density based on spectral/orbit class
/// References: Carry (2012), DeMeo & Carry (2013)
fn estimate_density(orbit_class: &str) -> f64 {
    match orbit_class.to_uppercase().as_str() {
        // NEA orbital classes - use mixed default
        "AMO" | "APO" | "ATE" | "IEO" => 2000.0,
        
        // Spectral-based estimates
        s if s.contains('C') => 1700.0,   // C-type: carbonaceous
        s if s.contains('B') => 1500.0,   // B-type: primitive
        s if s.contains('D') => 1200.0,   // D-type: organic-rich
        s if s.contains('P') => 1300.0,   // P-type: primitive
        s if s.contains('S') => 2700.0,   // S-type: silicaceous
        s if s.contains('Q') => 2500.0,   // Q-type: ordinary chondrite
        s if s.contains('V') => 3200.0,   // V-type: basaltic (Vesta-like)
        s if s.contains('M') => 4000.0,   // M-type: metallic
        s if s.contains('X') => 3500.0,   // X-type: unknown metal-rich
        
        _ => 2000.0  // Default rubble pile average
    }
}

/// Calculate mass from diameter and density
fn estimate_mass(diameter_m: f64, orbit_class: &str) -> f64 {
    let density = estimate_density(orbit_class);
    let radius = diameter_m / 2.0;
    let volume = (4.0 / 3.0) * std::f64::consts::PI * radius.powi(3);
    density * volume
}

impl NeoObject {
    /// Convert NASA API response to our internal format
    pub fn to_processed(&self) -> Option<ProcessedAsteroid> {
        let orbital_data = self.orbital_data.as_ref()?;
        
        // Parse orbital elements (convert from string to f64)
        let semi_major_axis_au = orbital_data.semi_major_axis.as_ref()
            .and_then(|s| s.parse::<f64>().ok())?;
        let eccentricity = orbital_data.eccentricity.as_ref()
            .and_then(|s| s.parse::<f64>().ok())?;
        let inclination_deg = orbital_data.inclination.as_ref()
            .and_then(|s| s.parse::<f64>().ok())?;
        let ascending_node_deg = orbital_data.ascending_node_longitude.as_ref()
            .and_then(|s| s.parse::<f64>().ok())?;
        let perihelion_arg_deg = orbital_data.perihelion_argument.as_ref()
            .and_then(|s| s.parse::<f64>().ok())?;
        let mean_anomaly_deg = orbital_data.mean_anomaly.as_ref()
            .and_then(|s| s.parse::<f64>().ok())?;
        let epoch = orbital_data.epoch_osculation.as_ref()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(2460000.5);

        let orbital_elements = OrbitalElements {
            semi_major_axis: semi_major_axis_au * AU, // Convert to meters
            eccentricity,
            inclination: inclination_deg * PI / 180.0,
            longitude_ascending_node: ascending_node_deg * PI / 180.0,
            argument_perihelion: perihelion_arg_deg * PI / 180.0,
            mean_anomaly: mean_anomaly_deg * PI / 180.0,
            epoch,
        };

        // Get estimated diameter
        let diameter = self.estimated_diameter.as_ref()
            .and_then(|d| d.meters.as_ref())
            .map(|m| (m.estimated_diameter_min + m.estimated_diameter_max) / 2.0)
            .unwrap_or(100.0);

        // Process close approaches
        let close_approaches = self.close_approach_data.as_ref()
            .map(|approaches| {
                approaches.iter().filter_map(|ca| {
                    Some(ProcessedCloseApproach {
                        date: ca.close_approach_date.clone().unwrap_or_default(),
                        miss_distance_km: ca.miss_distance.as_ref()
                            .and_then(|m| m.kilometers.as_ref())
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0.0),
                        velocity_km_s: ca.relative_velocity.as_ref()
                            .and_then(|v| v.kilometers_per_second.as_ref())
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0.0),
                        orbiting_body: ca.orbiting_body.clone().unwrap_or_else(|| "Earth".to_string()),
                    })
                }).collect()
            })
            .unwrap_or_default();

        Some(ProcessedAsteroid {
            id: self.id.clone(),
            name: self.name.clone(),
            orbital_elements,
            estimated_diameter_m: diameter,
            estimated_mass_kg: estimate_mass(diameter, &orbital_data.orbit_class.as_ref()
                .and_then(|c| c.orbit_class_type.clone())
                .unwrap_or_else(|| "Unknown".to_string())),
            is_potentially_hazardous: self.is_potentially_hazardous_asteroid.unwrap_or(false),
            absolute_magnitude: self.absolute_magnitude_h.unwrap_or(0.0),
            orbit_class: orbital_data.orbit_class.as_ref()
                .and_then(|c| c.orbit_class_type.clone())
                .unwrap_or_else(|| "Unknown".to_string()),
            close_approaches,
        })
    }
}

// =============================================================================
// API CLIENT
// =============================================================================

pub struct NeoWsClient {
    api_key: String,
    client: reqwest::Client,
}

impl NeoWsClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Fetch NEOs that approach Earth in a date range
    pub async fn fetch_feed(&self, start_date: &str, end_date: &str) -> Result<Vec<ProcessedAsteroid>, String> {
        let url = format!(
            "{}/feed?start_date={}&end_date={}&api_key={}",
            NEOWS_BASE_URL, start_date, end_date, self.api_key
        );

        let response = self.client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned status: {}", response.status()));
        }

        let data: NeoWsResponse = response.json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let mut asteroids = Vec::new();
        if let Some(neo_map) = data.near_earth_objects {
            for (_date, neos) in neo_map {
                for neo in neos {
                    if let Some(processed) = neo.to_processed() {
                        asteroids.push(processed);
                    }
                }
            }
        }

        Ok(asteroids)
    }

    /// Browse all NEOs with pagination
    pub async fn browse(&self, page: i32, size: i32) -> Result<(Vec<ProcessedAsteroid>, i32), String> {
        let url = format!(
            "{}/neo/browse?page={}&size={}&api_key={}",
            NEOWS_BASE_URL, page, size, self.api_key
        );

        let response = self.client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned status: {}", response.status()));
        }

        let data: BrowseResponse = response.json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let total_pages = data.page.map(|p| p.total_pages).unwrap_or(1);
        let asteroids: Vec<ProcessedAsteroid> = data.near_earth_objects
            .into_iter()
            .filter_map(|neo| neo.to_processed())
            .collect();

        Ok((asteroids, total_pages))
    }

    /// Fetch a specific NEO by ID
    pub async fn fetch_neo(&self, neo_id: &str) -> Result<ProcessedAsteroid, String> {
        let url = format!(
            "{}/neo/{}?api_key={}",
            NEOWS_BASE_URL, neo_id, self.api_key
        );

        let response = self.client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned status: {}", response.status()));
        }

        let neo: NeoObject = response.json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        neo.to_processed().ok_or_else(|| "Failed to process NEO data".to_string())
    }
}

// =============================================================================
// CACHE MANAGER
// =============================================================================

use std::sync::Arc;
use parking_lot::RwLock;

#[allow(dead_code)]
pub struct CacheManager {
    asteroids: Arc<RwLock<Vec<ProcessedAsteroid>>>,
    last_fetch: Arc<RwLock<Option<std::time::Instant>>>,
    cache_duration: std::time::Duration,
}

impl CacheManager {
    pub fn new() -> Self {
        Self {
            asteroids: Arc::new(RwLock::new(Vec::new())),
            last_fetch: Arc::new(RwLock::new(None)),
            cache_duration: std::time::Duration::from_secs(3600), // 1 hour cache
        }
    }

    pub fn get_asteroids(&self) -> Vec<ProcessedAsteroid> {
        self.asteroids.read().clone()
    }

    pub fn set_asteroids(&self, asteroids: Vec<ProcessedAsteroid>) {
        *self.asteroids.write() = asteroids;
        *self.last_fetch.write() = Some(std::time::Instant::now());
    }

    #[allow(dead_code)]
    pub fn is_cache_valid(&self) -> bool {
        if let Some(last) = *self.last_fetch.read() {
            last.elapsed() < self.cache_duration
        } else {
            false
        }
    }

    #[allow(dead_code)]
    pub fn asteroid_count(&self) -> usize {
        self.asteroids.read().len()
    }
}

impl Default for CacheManager {
    fn default() -> Self {
        Self::new()
    }
}
