# 🔬 Physics Engine

CosmoRisk uses a scientifically accurate physics simulation based on established celestial mechanics.

## Integrator

We use the **Velocity Verlet** algorithm for numerical integration:

```
x(t+dt) = x(t) + v(t)·dt + ½·a(t)·dt²
v(t+dt) = v(t) + ½·(a(t) + a(t+dt))·dt
```

**Why Velocity Verlet?**
- Symplectic (conserves energy)
- 2nd order accuracy
- Stable for orbital mechanics
- Used by NASA/JPL

## Gravitational Model

### N-Body Gravity
```
F = G · m₁ · m₂ / r²
```

Where:
- `G = 6.67430 × 10⁻¹¹ m³/(kg·s²)`
- `m₁, m₂` = masses of bodies
- `r` = distance between centers

### Included Perturbations

| Effect | Description |
|--------|-------------|
| Solar Gravity | Central force from Sun |
| Earth Gravity | For lunar/geocentric objects |
| Jupiter Perturbation | Major asteroid belt influence |
| Mars Perturbation | Inner solar system effects |
| J2 Oblateness | Earth's equatorial bulge |
| Solar Radiation Pressure | Light momentum transfer |

## Constants

| Constant | Value | Unit |
|----------|-------|------|
| G (Gravitational) | 6.67430 × 10⁻¹¹ | m³/(kg·s²) |
| AU (Astronomical Unit) | 1.495978707 × 10¹¹ | m |
| Solar Mass | 1.98892 × 10³⁰ | kg |
| Earth Mass | 5.972 × 10²⁴ | kg |
| Speed of Light | 299792458 | m/s |

## Orbital Elements

Asteroids are defined using Keplerian orbital elements:

| Element | Symbol | Description |
|---------|--------|-------------|
| Semi-major axis | a | Orbit size |
| Eccentricity | e | Orbit shape (0=circle, 1=parabola) |
| Inclination | i | Tilt from ecliptic |
| Longitude of Ascending Node | Ω | Orientation of ascending point |
| Argument of Perihelion | ω | Orientation of closest approach |
| Mean Anomaly | M | Position in orbit |

## Kepler's Equation

To convert orbital elements to position:

```
E - e·sin(E) = M
```

Solved using Newton-Raphson iteration.

## References

1. NASA JPL Solar System Dynamics
2. Velocity Verlet: Swope et al. (1982)
3. Orbital Mechanics: Vallado (2007)
4. Asteroid Densities: Carry (2012)

---

[← Keyboard Shortcuts](Keyboard-Shortcuts) | [Next: Deflection Methods →](Deflection-Methods)
