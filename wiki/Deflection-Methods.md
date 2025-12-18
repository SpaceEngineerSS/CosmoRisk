# 🛡️ Deflection Methods

CosmoRisk supports three asteroid deflection techniques based on real planetary defense research.

## 1. Kinetic Impactor (DART-style)

**Principle:** High-velocity spacecraft collision transfers momentum to the asteroid.

```
Δv = (m_spacecraft / m_asteroid) × v_impact × (1 + β)
```

Where `β` (beta factor) accounts for ejecta momentum enhancement (typically 1-5).

### Usage
1. Select asteroid
2. Set impactor mass (kg)
3. Set impact velocity (km/s)
4. Set beta factor
5. Click "Apply Deflection"

### Real-World Example
- **DART Mission (2022)**: NASA's test on Dimorphos
- Impactor: 570 kg at 6.6 km/s
- Result: 32-minute orbital period change

---

## 2. Ion Beam Deflection (IBS)

**Principle:** Continuous low-thrust beam slowly pushes asteroid over time.

```
Δv = F_thrust × t / m_asteroid
```

### Advantages
- No contact required
- Continuous adjustment
- Works over months/years

### Usage
1. Select asteroid
2. Set thrust magnitude (mN)
3. Set direction vector
4. Set duration (days)
5. Click "Apply Ion Beam"

---

## 3. Gravity Tractor

**Principle:** Spacecraft hovers near asteroid; mutual gravity slowly deflects both.

```
F = G × m_spacecraft × m_asteroid / r²
```

### Advantages
- No physical contact
- Works on rubble piles
- Very precise control

### Disadvantages
- Requires years of operation
- Limited to small deflections

### Parameters
- Spacecraft mass: 1,000 - 20,000 kg
- Hover distance: 50 - 200 m
- Lead angle: 0° - 45°

---

## Deflection Planning

### Lead Time Requirements

| Δv Required | Lead Time | Deflection @ Earth |
|-------------|-----------|---------------------|
| 1 cm/s | 10 years | ~1 Earth diameter |
| 1 mm/s | 20 years | ~1 Earth diameter |
| 10 cm/s | 1 year | ~1 Earth diameter |

**Key Insight:** Early detection = smaller required Δv!

### Mission Considerations

| Factor | Impact |
|--------|--------|
| Asteroid size | Larger = harder to deflect |
| Density | Unknown for most NEOs |
| Rotation | Affects gravity tractor positioning |
| Orbit uncertainty | Monte Carlo analysis needed |

---

## Comparison

| Method | Speed | Precision | Technology Readiness |
|--------|-------|-----------|---------------------|
| Kinetic Impactor | Fast | Low | TRL 9 (DART proven) |
| Ion Beam | Slow | High | TRL 4-5 |
| Gravity Tractor | Very Slow | Very High | TRL 3-4 |

---

[← Physics Engine](Physics-Engine) | [Next: NASA API →](NASA-API)
