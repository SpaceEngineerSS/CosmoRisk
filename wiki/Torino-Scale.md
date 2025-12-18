# 🎯 Torino Scale

The **Torino Scale** is a method for categorizing asteroid impact threat, ranging from 0 (no hazard) to 10 (certain global catastrophe).

## Official Definition

The Torino Scale was adopted by the International Astronomical Union (IAU) in 1999 and is maintained by NASA's Center for Near Earth Object Studies (CNEOS).

> **Reference:** [NASA CNEOS Torino Scale](https://cneos.jpl.nasa.gov/sentry/torino_scale.html)

---

## Color-Coded Categories

| Level | Color | Category | Description |
|-------|-------|----------|-------------|
| **0** | ⬜ White | No Hazard | Object will not collide or is too small to matter |
| **1** | 🟩 Green | Normal | Routine discovery, very unlikely to cause damage |
| **2-4** | 🟨 Yellow | Meriting Attention | Close approach warranting monitoring |
| **5-7** | 🟧 Orange | Threatening | Significant threat requiring contingency planning |
| **8-10** | 🟥 Red | Certain Collision | Impact certain, local to global consequences |

---

## CosmoRisk Implementation

### Energy Thresholds

We convert kinetic energy from Joules to Megatons TNT for classification:

```
1 Megaton TNT = 4.184 × 10¹⁵ Joules
```

| Energy Range | Classification | Example Event |
|--------------|----------------|---------------|
| < 1 kiloton | Harmless | Burns up in atmosphere |
| 1 kt - 1 MT | Local Damage | Chelyabinsk 2013 (~500 kt) |
| 1 - 100 MT | Regional | Tunguska 1908 (~15 MT) |
| 100 - 1000 MT | National | Large city destruction |
| 1 - 100 GT | Global Effects | Nuclear winter potential |
| > 100 GT | Extinction Level | Chicxulub (~100 million MT) |

### Probability × Energy Matrix

The Torino level is determined by combining:
1. **Impact Probability** (P)
2. **Kinetic Energy** (E)
3. **MOID** (Potentially Hazardous threshold: < 0.05 AU)

| Probability | Harmless | Local | Regional | National | Global | Extinction |
|-------------|----------|-------|----------|----------|--------|------------|
| P < 10⁻⁷ | 0 | 0 | 0 | 0 | 0 | 0 |
| 10⁻⁷ < P < 10⁻⁶ | 0 | 0-1 | 1 | 1 | 1 | 1 |
| 10⁻⁶ < P < 10⁻⁴ | 0 | 1 | 1 | 2 | 3 | 4 |
| 10⁻⁴ < P < 10⁻² | 0 | 2 | 3 | 4 | 5 | 6 |
| 10⁻² < P < 0.5 | 0 | 4 | 5 | 6 | 7 | 8 |
| 0.5 < P < 0.99 | 0 | 5 | 6 | 7 | 8 | 9 |
| P > 0.99 | 0 | 8 | 8 | 9 | 10 | 10 |

---

## Kinetic Energy Calculation

```
E = ½ × m × v²
```

Where:
- `m` = asteroid mass (kg)
- `v` = relative velocity to Earth (m/s)

### Mass Estimation

```
m = ρ × V = ρ × (4/3)πr³
```

| Spectral Type | Density (kg/m³) |
|---------------|-----------------|
| C-type (carbonaceous) | 1,300 |
| S-type (siliceous) | 2,700 |
| M-type (metallic) | 5,300 |

---

## Limitations

> [!WARNING]
> CosmoRisk's Torino Scale is a **simplified educational model**.

### What We Include
- ✅ Energy-based damage thresholds
- ✅ Probability from Monte Carlo or proximity
- ✅ MOID-based PHA classification
- ✅ Size-to-energy conversion

### What We Don't Include
- ❌ Precise orbital uncertainty propagation
- ❌ Keyhole passage analysis
- ❌ Multi-apparition orbital refinement
- ❌ Official Sentry/NEOCC probability calculations

---

## Official Resources

For official impact risk assessments, consult:

| Agency | System | URL |
|--------|--------|-----|
| NASA | Sentry | [cneos.jpl.nasa.gov/sentry](https://cneos.jpl.nasa.gov/sentry/) |
| ESA | NEOCC | [neo.ssa.esa.int](https://neo.ssa.esa.int/) |

---

## References

1. Morrison, D., Chapman, C.R., Steel, D., Binzel, R.P. (2004). "Impacts and the Public: Communicating the Nature of the Impact Hazard"
2. NASA CNEOS. "Torino Impact Hazard Scale" - [cneos.jpl.nasa.gov](https://cneos.jpl.nasa.gov/sentry/torino_scale.html)
3. Chesley, S.R., et al. (2002). "Quantifying the Risk Posed by Potential Earth Impacts"

---

[← Physics Engine](Physics-Engine) | [Next: Deflection Methods →](Deflection-Methods)
