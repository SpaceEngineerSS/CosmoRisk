// Physics Engine - Orbital Mechanics Simulation
// Implements N-Body gravity, Velocity Verlet integrator, and perturbations

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

// =============================================================================
// PHYSICAL CONSTANTS (SI Units)
// =============================================================================

/// Gravitational constant (m³/(kg·s²))
pub const G: f64 = 6.67430e-11;

/// Astronomical Unit in meters
pub const AU: f64 = 1.495978707e11;

/// Sun's gravitational parameter μ = G * M_sun (m³/s²)
pub const MU_SUN: f64 = 1.32712440018e20;

/// Earth's gravitational parameter μ = G * M_earth (m³/s²)
pub const MU_EARTH: f64 = 3.986004418e14;

/// Moon's gravitational parameter μ = G * M_moon (m³/s²)
pub const MU_MOON: f64 = 4.9048695e12;

/// Sun mass (kg)
pub const MASS_SUN: f64 = 1.989e30;

/// Earth mass (kg)
pub const MASS_EARTH: f64 = 5.972e24;

/// Moon mass (kg)
pub const MASS_MOON: f64 = 7.342e22;

/// Earth's J2 coefficient (oblateness perturbation)
pub const J2_EARTH: f64 = 1.08263e-3;

/// Earth's equatorial radius (m)
pub const R_EARTH: f64 = 6.378137e6;

/// Solar radiation pressure at 1 AU (N/m²)
pub const SOLAR_PRESSURE_1AU: f64 = 4.56e-6;

/// Speed of light (m/s)
pub const C: f64 = 299792458.0;

/// Stefan-Boltzmann constant (W/m²·K⁴)
pub const STEFAN_BOLTZMANN: f64 = 5.670374419e-8;

/// Solar luminosity (W)
pub const SOLAR_LUMINOSITY: f64 = 3.828e26;

/// Thermal conductivity for regolith (W/m·K) - Vokrouhlický (2000)
pub const THERMAL_CONDUCTIVITY: f64 = 0.01;

/// Specific heat capacity (J/kg·K)
pub const SPECIFIC_HEAT: f64 = 680.0;

/// Surface emissivity for asteroids
pub const SURFACE_EMISSIVITY: f64 = 0.9;

/// Poynting-Robertson radiation pressure efficiency (Q_pr)
pub const PR_EFFICIENCY: f64 = 1.0;

/// Yarkovsky effect coefficient (m²/s per meter diameter)
/// Based on literature: typical da/dt ≈ 10^-4 AU/Myr for D=1km asteroid
/// Converted to acceleration: α ≈ 3 × 10^-15 m/s² for 1km asteroid at 1 AU
/// Formula: a_yarkovsky = YARKOVSKY_COEFFICIENT / (D * r²)
/// where D is diameter in meters, r is heliocentric distance in AU
pub const YARKOVSKY_COEFFICIENT: f64 = 3.0e-12;

/// Asteroid density by spectral type (kg/m³)
/// References: Carry (2012), DeMeo & Carry (2013)
pub mod asteroid_density {
    pub const C_TYPE: f64 = 1700.0;  // Carbonaceous
    pub const S_TYPE: f64 = 2700.0;  // Silicaceous  
    pub const M_TYPE: f64 = 4000.0;  // Metallic
    pub const DEFAULT: f64 = 2000.0; // Rubble pile average
}

// =============================================================================
// 3D VECTOR MATHEMATICS
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Vector3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vector3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    pub fn magnitude(&self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }

    pub fn normalize(&self) -> Self {
        let mag = self.magnitude();
        if mag > 1e-15 {
            Self {
                x: self.x / mag,
                y: self.y / mag,
                z: self.z / mag,
            }
        } else {
            Self::zero()
        }
    }

    pub fn dot(&self, other: &Vector3) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(&self, other: &Vector3) -> Vector3 {
        Vector3 {
            x: self.y * other.z - self.z * other.y,
            y: self.z * other.x - self.x * other.z,
            z: self.x * other.y - self.y * other.x,
        }
    }

    pub fn scale(&self, s: f64) -> Self {
        Self {
            x: self.x * s,
            y: self.y * s,
            z: self.z * s,
        }
    }

    pub fn add(&self, other: &Vector3) -> Vector3 {
        Vector3 {
            x: self.x + other.x,
            y: self.y + other.y,
            z: self.z + other.z,
        }
    }

    pub fn sub(&self, other: &Vector3) -> Vector3 {
        Vector3 {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }
}

// =============================================================================
// STATE VECTOR (Position + Velocity)
// =============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StateVector {
    pub position: Vector3,  // meters (SI)
    pub velocity: Vector3,  // m/s (SI)
}

impl StateVector {
    pub fn new(position: Vector3, velocity: Vector3) -> Self {
        Self { position, velocity }
    }

    pub fn zero() -> Self {
        Self {
            position: Vector3::zero(),
            velocity: Vector3::zero(),
        }
    }
}

// =============================================================================
// KEPLERIAN ORBITAL ELEMENTS
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitalElements {
    /// Semi-major axis (meters or AU depending on context)
    pub semi_major_axis: f64,
    /// Eccentricity (0-1 for elliptical)
    pub eccentricity: f64,
    /// Inclination (radians)
    pub inclination: f64,
    /// Longitude of ascending node (radians)
    pub longitude_ascending_node: f64,
    /// Argument of perihelion (radians)
    pub argument_perihelion: f64,
    /// Mean anomaly (radians)
    pub mean_anomaly: f64,
    /// Epoch (Julian Date)
    pub epoch: f64,
}

impl OrbitalElements {
    /// Convert orbital elements to Cartesian state vector
    /// Uses heliocentric coordinates with mu = MU_SUN
    pub fn to_state_vector(&self, mu: f64) -> StateVector {
        // Convert from AU to meters if semi_major_axis is in AU
        let a = self.semi_major_axis;
        let e = self.eccentricity;
        let i = self.inclination;
        let omega_big = self.longitude_ascending_node; // Ω
        let omega_small = self.argument_perihelion;     // ω
        let m = self.mean_anomaly;

        // Solve Kepler's equation to get Eccentric Anomaly (Newton-Raphson)
        let eccentric_anomaly = solve_kepler_equation(m, e);

        // Calculate True Anomaly
        let cos_e = eccentric_anomaly.cos();
        let sin_e = eccentric_anomaly.sin();
        let true_anomaly = 2.0 * ((1.0 + e).sqrt() * (eccentric_anomaly / 2.0).sin())
            .atan2((1.0 - e).sqrt() * (eccentric_anomaly / 2.0).cos());

        // Distance from focus
        let r = a * (1.0 - e * cos_e);

        // Position in orbital plane (perifocal frame)
        let cos_nu = true_anomaly.cos();
        let sin_nu = true_anomaly.sin();
        let x_orb = r * cos_nu;
        let y_orb = r * sin_nu;

        // Velocity in orbital plane
        let sqrt_mu_p = (mu / (a * (1.0 - e * e))).sqrt();
        let vx_orb = -sqrt_mu_p * sin_nu;
        let vy_orb = sqrt_mu_p * (e + cos_nu);

        // Rotation matrices to convert from perifocal to inertial (ECI/Heliocentric)
        let cos_omega = omega_big.cos();
        let sin_omega = omega_big.sin();
        let cos_w = omega_small.cos();
        let sin_w = omega_small.sin();
        let cos_i = i.cos();
        let sin_i = i.sin();

        // Combined rotation matrix elements
        let r11 = cos_omega * cos_w - sin_omega * sin_w * cos_i;
        let r12 = -cos_omega * sin_w - sin_omega * cos_w * cos_i;
        let r21 = sin_omega * cos_w + cos_omega * sin_w * cos_i;
        let r22 = -sin_omega * sin_w + cos_omega * cos_w * cos_i;
        let r31 = sin_w * sin_i;
        let r32 = cos_w * sin_i;

        // Transform position to inertial frame
        let position = Vector3::new(
            r11 * x_orb + r12 * y_orb,
            r21 * x_orb + r22 * y_orb,
            r31 * x_orb + r32 * y_orb,
        );

        // Transform velocity to inertial frame
        let velocity = Vector3::new(
            r11 * vx_orb + r12 * vy_orb,
            r21 * vx_orb + r22 * vy_orb,
            r31 * vx_orb + r32 * vy_orb,
        );

        StateVector { position, velocity }
    }
}

/// Solve Kepler's equation M = E - e*sin(E) using Newton-Raphson
fn solve_kepler_equation(mean_anomaly: f64, eccentricity: f64) -> f64 {
    let mut e_anom = mean_anomaly; // Initial guess
    let tolerance = 1e-12;
    let max_iterations = 50;

    for _ in 0..max_iterations {
        let f = e_anom - eccentricity * e_anom.sin() - mean_anomaly;
        let f_prime = 1.0 - eccentricity * e_anom.cos();
        let delta = f / f_prime;
        e_anom -= delta;

        if delta.abs() < tolerance {
            break;
        }
    }

    e_anom
}

// =============================================================================
// CELESTIAL BODY
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CelestialBody {
    pub id: String,
    pub name: String,
    pub mass: f64,             // kg
    pub radius: f64,           // meters
    pub state: StateVector,
    pub body_type: BodyType,
    /// For SRP calculation: cross-sectional area (m²)
    pub cross_section_area: f64,
    /// For SRP: reflectivity coefficient (0-2, 1 = perfect absorber)
    pub reflectivity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BodyType {
    Star,
    Planet,
    Moon,
    Asteroid,
    Spacecraft,
}

impl CelestialBody {
    pub fn sun() -> Self {
        Self {
            id: "sun".to_string(),
            name: "Sun".to_string(),
            mass: MASS_SUN,
            radius: 6.96e8,
            state: StateVector::zero(),
            body_type: BodyType::Star,
            cross_section_area: 0.0,
            reflectivity: 0.0,
        }
    }

    pub fn earth(julian_date: f64) -> Self {
        // Simplified: Earth at 1 AU on x-axis for epoch J2000
        // In production, use JPL ephemeris
        let mean_anomaly = 2.0 * PI * ((julian_date - 2451545.0) / 365.25);
        let elements = OrbitalElements {
            semi_major_axis: AU,
            eccentricity: 0.0167,
            inclination: 0.0,
            longitude_ascending_node: 0.0,
            argument_perihelion: 102.9_f64.to_radians(),
            mean_anomaly,
            epoch: julian_date,
        };

        Self {
            id: "earth".to_string(),
            name: "Earth".to_string(),
            mass: MASS_EARTH,
            radius: R_EARTH,
            state: elements.to_state_vector(MU_SUN),
            body_type: BodyType::Planet,
            cross_section_area: 0.0,
            reflectivity: 0.0,
        }
    }

    pub fn moon(earth_state: &StateVector, julian_date: f64) -> Self {
        // Simplified: Moon orbiting Earth
        let mean_anomaly = 2.0 * PI * ((julian_date - 2451545.0) / 27.3);
        let moon_distance = 3.844e8; // meters
        let moon_velocity = 1022.0; // m/s orbital velocity

        let pos = earth_state.position.add(&Vector3::new(
            moon_distance * mean_anomaly.cos(),
            moon_distance * mean_anomaly.sin(),
            0.0,
        ));

        let vel = earth_state.velocity.add(&Vector3::new(
            -moon_velocity * mean_anomaly.sin(),
            moon_velocity * mean_anomaly.cos(),
            0.0,
        ));

        Self {
            id: "moon".to_string(),
            name: "Moon".to_string(),
            mass: MASS_MOON,
            radius: 1.7374e6,
            state: StateVector::new(pos, vel),
            body_type: BodyType::Moon,
            cross_section_area: 0.0,
            reflectivity: 0.0,
        }
    }
}

// =============================================================================
// VELOCITY VERLET INTEGRATOR (Symplectic)
// =============================================================================

pub struct VelocityVerletIntegrator {
    /// Time step in seconds
    pub dt: f64,
    /// Enable J2 perturbation
    pub enable_j2: bool,
    /// Enable Solar Radiation Pressure
    pub enable_srp: bool,
    /// Enable Yarkovsky thermal recoil effect (scientific mode)
    pub enable_yarkovsky: bool,
}

impl VelocityVerletIntegrator {
    pub fn new(dt: f64) -> Self {
        Self {
            dt,
            enable_j2: true,
            enable_srp: true,
            enable_yarkovsky: true, // Scientific mode default on
        }
    }

    /// Step the simulation forward by dt
    /// Uses Velocity Verlet: x(t+dt) = x(t) + v(t)*dt + 0.5*a(t)*dt²
    ///                       v(t+dt) = v(t) + 0.5*(a(t) + a(t+dt))*dt
    pub fn step(&self, bodies: &mut [CelestialBody], sun_position: &Vector3) {
        let n = bodies.len();
        let dt = self.dt;
        let _dt_half = dt * 0.5;  // Reserved for future use
        let dt_sq_half = dt * dt * 0.5;

        // Store initial accelerations
        let mut accelerations: Vec<Vector3> = vec![Vector3::zero(); n];

        // Calculate initial accelerations for all bodies
        for i in 0..n {
            if bodies[i].body_type == BodyType::Star {
                continue; // Sun doesn't move in heliocentric
            }
            accelerations[i] = self.calculate_acceleration(&bodies[i], bodies, sun_position);
        }

        // Update positions: x(t+dt) = x(t) + v(t)*dt + 0.5*a(t)*dt²
        for i in 0..n {
            if bodies[i].body_type == BodyType::Star {
                continue;
            }
            let v = &bodies[i].state.velocity;
            let a = &accelerations[i];

            bodies[i].state.position = bodies[i].state.position
                .add(&v.scale(dt))
                .add(&a.scale(dt_sq_half));
        }

        // Calculate new accelerations at new positions
        let mut new_accelerations: Vec<Vector3> = vec![Vector3::zero(); n];
        for i in 0..n {
            if bodies[i].body_type == BodyType::Star {
                continue;
            }
            new_accelerations[i] = self.calculate_acceleration(&bodies[i], bodies, sun_position);
        }

        // Update velocities: v(t+dt) = v(t) + 0.5*(a(t) + a(t+dt))*dt
        for i in 0..n {
            if bodies[i].body_type == BodyType::Star {
                continue;
            }
            let avg_accel = accelerations[i].add(&new_accelerations[i]).scale(0.5);
            bodies[i].state.velocity = bodies[i].state.velocity.add(&avg_accel.scale(dt));
        }
    }

    /// Calculate total acceleration on a body from all gravitational sources + perturbations
    fn calculate_acceleration(
        &self,
        body: &CelestialBody,
        all_bodies: &[CelestialBody],
        sun_position: &Vector3,
    ) -> Vector3 {
        let mut total_accel = Vector3::zero();

        // N-Body gravitational acceleration
        for other in all_bodies {
            if other.id == body.id {
                continue;
            }

            let r_vec = other.state.position.sub(&body.state.position);
            let r = r_vec.magnitude();

            if r > 1e-10 {
                // a = G*M_other / r² in direction of r_vec
                let mu = G * other.mass;
                let accel_mag = mu / (r * r);
                total_accel = total_accel.add(&r_vec.normalize().scale(accel_mag));
            }
        }

        // J2 Perturbation (if body is near Earth)
        if self.enable_j2 {
            // Find Earth in the bodies
            if let Some(earth) = all_bodies.iter().find(|b| b.id == "earth") {
                let j2_accel = self.calculate_j2_perturbation(body, earth);
                total_accel = total_accel.add(&j2_accel);
            }
        }

        // Solar Radiation Pressure
        if self.enable_srp && body.cross_section_area > 0.0 {
            let srp_accel = self.calculate_srp(body, sun_position);
            total_accel = total_accel.add(&srp_accel);
        }

        // Yarkovsky thermal recoil effect (Scientific Mode)
        if self.enable_yarkovsky {
            let yarkovsky_accel = self.calculate_yarkovsky(body, sun_position);
            total_accel = total_accel.add(&yarkovsky_accel);
        }

        total_accel
    }

    /// J2 perturbation from Earth's oblateness
    fn calculate_j2_perturbation(&self, body: &CelestialBody, earth: &CelestialBody) -> Vector3 {
        let r_vec = body.state.position.sub(&earth.state.position);
        let r = r_vec.magnitude();

        // Only apply J2 within reasonable distance from Earth (e.g., < 1 million km)
        if r > 1e9 || r < R_EARTH {
            return Vector3::zero();
        }

        let r2 = r * r;
        let r5 = r2 * r2 * r;
        let re2 = R_EARTH * R_EARTH;
        let z = r_vec.z;
        let z2 = z * z;

        let factor = -1.5 * J2_EARTH * MU_EARTH * re2 / r5;

        let ax = factor * r_vec.x * (1.0 - 5.0 * z2 / r2);
        let ay = factor * r_vec.y * (1.0 - 5.0 * z2 / r2);
        let az = factor * r_vec.z * (3.0 - 5.0 * z2 / r2);

        Vector3::new(ax, ay, az)
    }

    /// Solar Radiation Pressure acceleration
    fn calculate_srp(&self, body: &CelestialBody, sun_position: &Vector3) -> Vector3 {
        let r_vec = body.state.position.sub(sun_position);
        let r = r_vec.magnitude();

        if r < 1e-10 {
            return Vector3::zero();
        }

        // Pressure at distance r (inverse square law from 1 AU)
        let pressure = SOLAR_PRESSURE_1AU * (AU * AU) / (r * r);

        // Force = P * A * (1 + reflectivity)
        // Acceleration = Force / mass
        let mass = body.mass.max(1.0); // Prevent division by zero
        let cr = 1.0 + body.reflectivity;
        let accel_mag = pressure * body.cross_section_area * cr / mass;

        // Direction: away from Sun
        r_vec.normalize().scale(accel_mag)
    }

    /// Yarkovsky thermal recoil effect - Detailed Vokrouhlický Model
    /// Causes slow drift in semi-major axis due to anisotropic thermal emission
    /// Reference: Vokrouhlický et al. (2000), SwRI
    /// Formula: a_Y ≈ (4/9) * (ε * σ * T⁴) / (ρ * c * D) in tangential direction
    fn calculate_yarkovsky(&self, body: &CelestialBody, sun_position: &Vector3) -> Vector3 {
        // Only apply to asteroids
        if body.body_type != BodyType::Asteroid {
            return Vector3::zero();
        }

        let r_vec = body.state.position.sub(sun_position);
        let r = r_vec.magnitude();
        let r_au = r / AU;

        if r < 1e-10 || r_au < 0.1 {
            return Vector3::zero();
        }

        // Diameter in meters (radius * 2)
        let diameter = body.radius * 2.0;
        if diameter < 1.0 {
            return Vector3::zero();
        }

        // Calculate subsolar temperature at distance r
        // T = (L_sun / (16 * π * σ * r²))^0.25
        let subsolar_temp = (SOLAR_LUMINOSITY / (16.0 * std::f64::consts::PI * STEFAN_BOLTZMANN * r * r)).powf(0.25);

        // Estimate density from body mass and radius
        let volume = (4.0 / 3.0) * std::f64::consts::PI * body.radius.powi(3);
        let density = if volume > 0.0 { body.mass / volume } else { asteroid_density::DEFAULT };
        let density = density.max(1000.0).min(8000.0); // Clamp to realistic range

        // Yarkovsky acceleration magnitude (simplified Rubincam model)
        // a_Y ≈ (4/9) * (ε * σ * T⁴) / (ρ * c * D)
        let temp_term = SURFACE_EMISSIVITY * STEFAN_BOLTZMANN * subsolar_temp.powi(4);
        let accel_mag = (4.0 / 9.0) * temp_term / (density * C * diameter);

        // Apply in tangential direction (prograde orbit = outward drift)
        // This causes secular drift in semi-major axis
        let radial = r_vec.normalize();
        
        // Tangential direction: perpendicular to radial in orbital plane
        let tangent = Vector3::new(-radial.y, radial.x, 0.0).normalize();

        tangent.scale(accel_mag)
    }

    /// Poynting-Robertson Drag (for small dust particles)
    /// Reference: Burns, Lamy & Soter (1979)
    /// Causes orbital decay due to velocity-dependent radiation force
    #[allow(dead_code)]
    fn calculate_poynting_robertson(&self, body: &CelestialBody, sun_position: &Vector3) -> Vector3 {
        // Only meaningful for very small particles (< 1 meter radius)
        if body.radius > 1.0 {
            return Vector3::zero();
        }

        let r_vec = body.state.position.sub(sun_position);
        let r = r_vec.magnitude();
        
        if r < 1e-10 {
            return Vector3::zero();
        }

        // Calculate β ratio: radiation pressure / gravity
        // β = (3 * L * Q) / (16 * π * G * M * c * ρ * s)
        let volume = (4.0 / 3.0) * std::f64::consts::PI * body.radius.powi(3);
        let density = if volume > 0.0 { body.mass / volume } else { asteroid_density::DEFAULT };
        let particle_size = body.radius * 2.0;
        
        let beta = (3.0 * SOLAR_LUMINOSITY * PR_EFFICIENCY) / 
            (16.0 * std::f64::consts::PI * G * MASS_SUN * C * density * particle_size);

        // Radial component (radiation pressure outward)
        let radial = r_vec.normalize();
        let r2 = r * r;
        let rad_accel = beta * MU_SUN / r2;

        // Tangential component (P-R drag) - velocity-dependent, opposes motion
        let v = body.state.velocity;
        let v_radial = radial.scale(v.dot(&radial));
        let v_tangent = v.sub(&v_radial);
        let v_tangent_mag = v_tangent.magnitude();
        
        if v_tangent_mag < 1e-10 {
            return radial.scale(rad_accel);
        }
        
        let pr_drag_mag = beta * MU_SUN * v_tangent_mag / (r2 * C);
        let pr_drag = v_tangent.normalize().scale(-pr_drag_mag);

        // Net acceleration: radial (outward) + tangential drag (inward spiral)
        radial.scale(rad_accel).add(&pr_drag)
    }

    /// Gravity Tractor deflection method
    /// Based on: NASA Near-Earth Object Survey and Deflection Analysis of Alternatives (2007)
    /// A spacecraft hovers near the asteroid, using gravitational attraction to slowly
    /// deflect its trajectory over months/years
    pub fn calculate_gravity_tractor(
        &self,
        asteroid: &CelestialBody,
        spacecraft_mass: f64,      // kg (typically 1000-20000 kg)
        hover_distance: f64,       // meters from asteroid surface
        lead_angle: f64,           // radians (angle ahead of asteroid along orbit)
    ) -> (Vector3, f64) {
        // Total distance from asteroid center
        let standoff = asteroid.radius + hover_distance;
        
        // Gravitational force: F = G * m_asteroid * m_spacecraft / r²
        // This force acts on the asteroid as well (Newton's 3rd law)
        let _force_mag = G * asteroid.mass * spacecraft_mass / (standoff * standoff);
        
        // Acceleration on asteroid: a = F / m_asteroid = G * m_spacecraft / r²
        let accel_mag = G * spacecraft_mass / (standoff * standoff);
        
        // Direction: spacecraft leads asteroid in orbit, so the force
        // pulls asteroid slightly forward (increases orbital energy)
        // Convert asteroid velocity direction to acceleration direction
        let v_norm = asteroid.state.velocity.normalize();
        
        // Apply lead angle rotation (simplified - just scale down based on angle)
        let direction = v_norm.scale(lead_angle.cos());
        
        // Time to deflect by 1 Earth radius at different lead times
        // Δx = 0.5 * a * t² → t = sqrt(2*Δx/a)
        let earth_radius = 6.371e6; // meters
        let deflection_time_days = (2.0 * earth_radius / accel_mag).sqrt() / 86400.0;
        
        (direction.scale(accel_mag), deflection_time_days)
    }

    /// Jupiter gravitational perturbation
    /// Jupiter's gravity significantly affects asteroid orbits, especially
    /// near mean-motion resonances (3:1, 5:2, 2:1 with Jupiter)
    pub fn calculate_jupiter_perturbation(
        &self,
        body: &CelestialBody,
        julian_date: f64,
    ) -> Vector3 {
        // Jupiter orbital parameters (J2000 epoch)
        const JUPITER_SEMI_MAJOR: f64 = 5.2044 * AU;
        const JUPITER_ECCENTRICITY: f64 = 0.0489;
        const JUPITER_PERIOD_DAYS: f64 = 4332.59; // Days
        const JUPITER_MASS: f64 = 1.898e27; // kg

        // Calculate Jupiter's approximate position
        let days_since_j2000 = julian_date - 2451545.0;
        let mean_anomaly = 2.0 * std::f64::consts::PI * (days_since_j2000 / JUPITER_PERIOD_DAYS);
        
        // Simplified eccentric anomaly (first-order approximation)
        let ecc_anomaly = mean_anomaly + JUPITER_ECCENTRICITY * mean_anomaly.sin();
        
        // True anomaly
        let true_anomaly = 2.0 * ((1.0 + JUPITER_ECCENTRICITY).sqrt() * (ecc_anomaly / 2.0).tan())
            .atan2((1.0 - JUPITER_ECCENTRICITY).sqrt());
        
        // Orbital radius
        let r_jupiter = JUPITER_SEMI_MAJOR * (1.0 - JUPITER_ECCENTRICITY * JUPITER_ECCENTRICITY) 
            / (1.0 + JUPITER_ECCENTRICITY * true_anomaly.cos());
        
        // Jupiter position (in ecliptic plane for simplicity)
        let jupiter_pos = Vector3::new(
            r_jupiter * true_anomaly.cos(),
            r_jupiter * true_anomaly.sin(),
            0.0
        );

        // Calculate gravitational acceleration toward Jupiter
        let r_vec = jupiter_pos.sub(&body.state.position);
        let r = r_vec.magnitude();
        
        if r < 1e6 {
            return Vector3::zero();
        }

        let mu_jupiter = G * JUPITER_MASS;
        let accel_mag = mu_jupiter / (r * r);
        
        r_vec.normalize().scale(accel_mag)
    }

    /// Mars gravitational perturbation (smaller effect, but included for completeness)
    pub fn calculate_mars_perturbation(
        &self,
        body: &CelestialBody,
        julian_date: f64,
    ) -> Vector3 {
        // Mars orbital parameters
        const MARS_SEMI_MAJOR: f64 = 1.524 * AU;
        const MARS_ECCENTRICITY: f64 = 0.0934;
        const MARS_PERIOD_DAYS: f64 = 686.97;
        const MARS_MASS: f64 = 6.39e23; // kg

        let days_since_j2000 = julian_date - 2451545.0;
        let mean_anomaly = 2.0 * std::f64::consts::PI * (days_since_j2000 / MARS_PERIOD_DAYS);
        let ecc_anomaly = mean_anomaly + MARS_ECCENTRICITY * mean_anomaly.sin();
        let true_anomaly = 2.0 * ((1.0 + MARS_ECCENTRICITY).sqrt() * (ecc_anomaly / 2.0).tan())
            .atan2((1.0 - MARS_ECCENTRICITY).sqrt());
        
        let r_mars = MARS_SEMI_MAJOR * (1.0 - MARS_ECCENTRICITY * MARS_ECCENTRICITY) 
            / (1.0 + MARS_ECCENTRICITY * true_anomaly.cos());
        
        let mars_pos = Vector3::new(
            r_mars * true_anomaly.cos(),
            r_mars * true_anomaly.sin(),
            0.0
        );

        let r_vec = mars_pos.sub(&body.state.position);
        let r = r_vec.magnitude();
        
        if r < 1e6 {
            return Vector3::zero();
        }

        let mu_mars = G * MARS_MASS;
        let accel_mag = mu_mars / (r * r);
        
        r_vec.normalize().scale(accel_mag)
    }
}

// =============================================================================
// MONTE CARLO IMPACT PROBABILITY
// =============================================================================

/// Result of a Monte Carlo impact probability simulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonteCarloResult {
    /// Number of simulation runs
    pub num_runs: u32,
    /// Number of impacts detected
    pub num_impacts: u32,
    /// Impact probability (0.0 - 1.0)
    pub impact_probability: f64,
    /// Mean closest approach distance (km)
    pub mean_moid: f64,
    /// Standard deviation of closest approach (km)
    pub std_moid: f64,
    /// Minimum closest approach seen (km)
    pub min_moid: f64,
    /// Palermo Scale value
    pub palermo_scale: f64,
}

/// Monte Carlo simulation for impact probability
/// Uses statistical sampling of orbital uncertainty to estimate collision probability
pub fn monte_carlo_impact_probability(
    asteroid: &CelestialBody,
    position_uncertainty: f64,     // 3-sigma position uncertainty (meters)
    velocity_uncertainty: f64,     // 3-sigma velocity uncertainty (m/s)
    num_runs: u32,                 // Number of Monte Carlo samples (typically 1000-10000)
    simulation_days: f64,          // How far to propagate (days)
    earth_radius: f64,             // Earth collision radius (meters)
) -> MonteCarloResult {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut impacts = 0u32;
    let mut moid_sum = 0.0f64;
    let mut moid_sq_sum = 0.0f64;
    let mut min_moid = f64::MAX;
    
    // Simple pseudo-random number generator (for deterministic testing)
    let mut hasher = DefaultHasher::new();
    asteroid.id.hash(&mut hasher);
    let mut seed = hasher.finish();
    
    let next_random = |s: &mut u64| -> f64 {
        // LCG parameters (Numerical Recipes)
        *s = s.wrapping_mul(1103515245).wrapping_add(12345);
        ((*s >> 16) as f64) / 32768.0 * 2.0 - 1.0  // Range: -1 to 1
    };
    
    // Box-Muller transform for Gaussian distribution
    let gaussian = |s: &mut u64, sigma: f64| -> f64 {
        let u1 = (next_random(s) + 1.0) / 2.0;  // 0 to 1
        let u2 = (next_random(s) + 1.0) / 2.0;
        let u1 = u1.max(1e-10);  // Avoid log(0)
        sigma * (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    };
    
    // Earth orbital parameters for approximate position
    let earth_a = AU;
    let earth_period = 365.25 * 86400.0; // seconds
    
    for _run in 0..num_runs {
        // Sample position from Gaussian distribution (3-sigma = position_uncertainty)
        let sigma_pos = position_uncertainty / 3.0;
        let perturbed_pos = Vector3::new(
            asteroid.state.position.x + gaussian(&mut seed, sigma_pos),
            asteroid.state.position.y + gaussian(&mut seed, sigma_pos),
            asteroid.state.position.z + gaussian(&mut seed, sigma_pos),
        );
        
        // Sample velocity
        let sigma_vel = velocity_uncertainty / 3.0;
        let perturbed_vel = Vector3::new(
            asteroid.state.velocity.x + gaussian(&mut seed, sigma_vel),
            asteroid.state.velocity.y + gaussian(&mut seed, sigma_vel),
            asteroid.state.velocity.z + gaussian(&mut seed, sigma_vel),
        );
        
        // Simple 2-body propagation to find closest approach to Earth
        let mut pos = perturbed_pos;
        let mut vel = perturbed_vel;
        let dt = 3600.0; // 1 hour timestep
        let steps = (simulation_days * 86400.0 / dt) as usize;
        
        let mut closest_approach = f64::MAX;
        
        for step in 0..steps {
            // Simple Kepler orbit for asteroid (around Sun at origin)
            let r = pos.magnitude();
            if r < 1e6 { break; } // Too close to Sun
            
            let accel_mag = MU_SUN / (r * r);
            let accel = pos.normalize().scale(-accel_mag);
            
            // Velocity Verlet half step
            vel = vel.add(&accel.scale(dt / 2.0));
            pos = pos.add(&vel.scale(dt));
            
            // Full acceleration at new position
            let r_new = pos.magnitude();
            if r_new < 1e6 { break; }
            let accel_new = pos.normalize().scale(-MU_SUN / (r_new * r_new));
            vel = vel.add(&accel_new.scale(dt / 2.0));
            
            // Calculate Earth's approximate position
            let t = step as f64 * dt;
            let earth_angle = 2.0 * std::f64::consts::PI * t / earth_period;
            let earth_pos = Vector3::new(
                earth_a * earth_angle.cos(),
                earth_a * earth_angle.sin(),
                0.0,
            );
            
            // Distance to Earth
            let dist_to_earth = pos.sub(&earth_pos).magnitude();
            if dist_to_earth < closest_approach {
                closest_approach = dist_to_earth;
            }
            
            // Check for impact
            if dist_to_earth < earth_radius {
                impacts += 1;
                break;
            }
        }
        
        // Convert to km for statistics
        let moid_km = closest_approach / 1000.0;
        moid_sum += moid_km;
        moid_sq_sum += moid_km * moid_km;
        if moid_km < min_moid {
            min_moid = moid_km;
        }
    }
    
    let impact_probability = impacts as f64 / num_runs as f64;
    let mean_moid = moid_sum / num_runs as f64;
    let variance = (moid_sq_sum / num_runs as f64) - (mean_moid * mean_moid);
    let std_moid = variance.max(0.0).sqrt();
    
    // Calculate Palermo Scale
    // PS = log10(Pi) - log10(fB * Δt)
    // where fB is background impact frequency (~10^-8 per year)
    // and Δt is the time window in years
    let years = simulation_days / 365.25;
    let background_rate = 1e-8 * years;
    let palermo_scale = if impact_probability > 0.0 {
        (impact_probability / background_rate).log10()
    } else {
        -10.0 // Very low probability
    };
    
    MonteCarloResult {
        num_runs,
        num_impacts: impacts,
        impact_probability,
        mean_moid,
        std_moid,
        min_moid,
        palermo_scale,
    }
}

// =============================================================================
// ENERGY CALCULATIONS (for drift monitoring)
// =============================================================================

/// Calculate total mechanical energy of the system
pub fn calculate_total_energy(bodies: &[CelestialBody]) -> f64 {
    let mut kinetic = 0.0;
    let mut potential = 0.0;

    for body in bodies {
        // Kinetic energy: 0.5 * m * v²
        let v = body.state.velocity.magnitude();
        kinetic += 0.5 * body.mass * v * v;
    }

    // Potential energy: -G * m1 * m2 / r for each pair
    for i in 0..bodies.len() {
        for j in (i + 1)..bodies.len() {
            let r_vec = bodies[i].state.position.sub(&bodies[j].state.position);
            let r = r_vec.magnitude();
            if r > 1e-10 {
                potential -= G * bodies[i].mass * bodies[j].mass / r;
            }
        }
    }

    kinetic + potential
}

// =============================================================================
// SIMULATION STATE
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationState {
    pub bodies: Vec<CelestialBody>,
    pub time: f64,             // Simulation time in seconds since epoch
    pub julian_date: f64,      // Current Julian Date
    pub dt: f64,               // Time step
    pub time_scale: f64,       // Speed multiplier (1.0 = real-time)
    pub is_paused: bool,
    pub total_energy: f64,     // For drift monitoring
    pub initial_energy: f64,   // Reference energy at start
}

impl SimulationState {
    pub fn new(julian_date: f64) -> Self {
        let mut bodies = vec![CelestialBody::sun()];
        let earth = CelestialBody::earth(julian_date);
        let moon = CelestialBody::moon(&earth.state, julian_date);
        bodies.push(earth);
        bodies.push(moon);

        let initial_energy = calculate_total_energy(&bodies);

        Self {
            bodies,
            time: 0.0,
            julian_date,
            dt: 3600.0, // 1 hour default
            time_scale: 86400.0, // 1 day per second
            is_paused: true,
            total_energy: initial_energy,
            initial_energy,
        }
    }

    /// Add an asteroid from orbital elements
    pub fn add_asteroid(&mut self, id: &str, name: &str, elements: OrbitalElements, estimated_diameter: f64) {
        let state = elements.to_state_vector(MU_SUN);
        
        // Estimate mass from diameter (assuming density of 2000 kg/m³)
        let radius = estimated_diameter / 2.0;
        let volume = (4.0 / 3.0) * PI * radius.powi(3);
        let mass = 2000.0 * volume;

        let body = CelestialBody {
            id: id.to_string(),
            name: name.to_string(),
            mass,
            radius,
            state,
            body_type: BodyType::Asteroid,
            cross_section_area: PI * radius * radius,
            reflectivity: 0.1,
        };

        self.bodies.push(body);
    }

    /// Apply a delta-v impulse to a body (kinetic impactor)
    pub fn apply_impulse(&mut self, body_id: &str, delta_v: Vector3) {
        if let Some(body) = self.bodies.iter_mut().find(|b| b.id == body_id) {
            body.state.velocity = body.state.velocity.add(&delta_v);
        }
    }

    /// Apply continuous ion beam thrust (small Δv over time)
    /// thrust_acceleration in m/s², duration in seconds
    pub fn apply_ion_beam(&mut self, body_id: &str, thrust_direction: Vector3, thrust_magnitude: f64, duration: f64) {
        if let Some(body) = self.bodies.iter_mut().find(|b| b.id == body_id) {
            // Δv = a * t where a = thrust_magnitude
            let delta_v = thrust_direction.normalize().scale(thrust_magnitude * duration);
            body.state.velocity = body.state.velocity.add(&delta_v);
        }
    }

    /// Calculate minimum distance from Earth for an asteroid (impact prediction)
    /// Returns (min_distance_km, time_to_min_distance_days)
    pub fn calculate_earth_approach(&self, asteroid_id: &str) -> Option<(f64, f64)> {
        let asteroid = self.bodies.iter().find(|b| b.id == asteroid_id)?;
        let earth = self.bodies.iter().find(|b| b.id == "earth")?;

        // Current distance
        let r_vec = asteroid.state.position.sub(&earth.state.position);
        let current_distance = r_vec.magnitude();

        // Relative velocity for approach estimation
        let v_rel = asteroid.state.velocity.sub(&earth.state.velocity);
        let v_rel_mag = v_rel.magnitude();

        // Simple time to closest approach (assuming linear motion)
        let r_dot_v = r_vec.dot(&v_rel);
        let time_to_closest = if v_rel_mag > 1e-10 {
            -r_dot_v / (v_rel_mag * v_rel_mag)
        } else {
            0.0
        };

        // Estimate minimum distance
        let min_distance = if time_to_closest > 0.0 {
            let closest_pos = r_vec.add(&v_rel.scale(time_to_closest));
            closest_pos.magnitude()
        } else {
            current_distance
        };

        Some((min_distance / 1000.0, time_to_closest / 86400.0)) // km, days
    }

    /// Adaptive time stepping: reduce dt when bodies are close
    pub fn calculate_adaptive_dt(&self, base_dt: f64) -> f64 {
        let mut min_dt = base_dt;

        // Check distances between all bodies
        for i in 0..self.bodies.len() {
            for j in (i + 1)..self.bodies.len() {
                let r_vec = self.bodies[i].state.position.sub(&self.bodies[j].state.position);
                let distance = r_vec.magnitude();

                // If very close (within 10 Earth radii), reduce time step
                if distance < R_EARTH * 100.0 {
                    let factor = (distance / (R_EARTH * 100.0)).max(0.01);
                    min_dt = min_dt.min(base_dt * factor);
                }
            }
        }

        // Ensure dt doesn't go below 1 second or above base_dt
        min_dt.max(1.0).min(base_dt)
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kepler_equation_circular() {
        // For circular orbit e=0, E = M
        let e = solve_kepler_equation(1.0, 0.0);
        assert!((e - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_kepler_equation_eccentric() {
        // Test with known values
        let e = solve_kepler_equation(0.5, 0.5);
        // Verify: E - 0.5*sin(E) should equal 0.5
        let check = e - 0.5 * e.sin();
        assert!((check - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_circular_orbit_energy_conservation() {
        // Create a simple 2-body Sun-Earth system
        let julian_date = 2451545.0; // J2000
        let mut state = SimulationState::new(julian_date);
        
        // Remove moon for simpler test
        state.bodies.retain(|b| b.id != "moon");

        let integrator = VelocityVerletIntegrator {
            dt: 3600.0, // 1 hour
            enable_j2: false,
            enable_srp: false,
        };

        let initial_energy = calculate_total_energy(&state.bodies);

        // Run for 100 steps
        let sun_pos = Vector3::zero();
        for _ in 0..100 {
            integrator.step(&mut state.bodies, &sun_pos);
        }

        let final_energy = calculate_total_energy(&state.bodies);
        let drift = ((final_energy - initial_energy) / initial_energy).abs();

        // Energy drift should be very small for symplectic integrator
        assert!(drift < 1e-6, "Energy drift too high: {}", drift);
    }

    #[test]
    fn test_vector3_operations() {
        let v1 = Vector3::new(1.0, 2.0, 3.0);
        let v2 = Vector3::new(4.0, 5.0, 6.0);

        // Addition
        let sum = v1.add(&v2);
        assert!((sum.x - 5.0).abs() < 1e-10);
        assert!((sum.y - 7.0).abs() < 1e-10);
        assert!((sum.z - 9.0).abs() < 1e-10);

        // Dot product
        let dot = v1.dot(&v2);
        assert!((dot - 32.0).abs() < 1e-10);

        // Cross product
        let cross = v1.cross(&v2);
        assert!((cross.x - (-3.0)).abs() < 1e-10);
        assert!((cross.y - 6.0).abs() < 1e-10);
        assert!((cross.z - (-3.0)).abs() < 1e-10);
    }
}
