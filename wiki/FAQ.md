# ❓ FAQ

## General

### What is CosmoRisk?
A desktop application for visualizing and simulating Near-Earth Objects (asteroids) using real NASA data.

### Is this free?
Yes! CosmoRisk is free and open source under the MIT license.

### What platforms are supported?
- Windows 10/11
- macOS 11+
- Linux (Ubuntu, Debian, etc.)

---

## Data & Accuracy

### Where does the asteroid data come from?
All data comes from NASA's NeoWs (Near Earth Object Web Service) API, which is maintained by NASA's Jet Propulsion Laboratory.

### How accurate is the simulation?
The simulation uses proper N-body gravitational physics and Velocity Verlet integration. However:
- Small perturbations may be simplified
- Very long-term predictions have inherent uncertainty
- This is an educational tool, not for operational use

### What is "Potentially Hazardous"?
An asteroid is classified as Potentially Hazardous if:
- MOID (Minimum Orbit Intersection Distance) < 0.05 AU
- Absolute magnitude H < 22 (diameter > ~140m)

---

## Technical

### Why do I need a NASA API key?
NASA requires API keys to track usage and prevent abuse. Keys are free and instant.

### Can I use this offline?
Partially. You need internet to fetch asteroid data, but once loaded, the simulation works offline.

### The app is slow, what can I do?
- Reduce number of asteroids loaded
- Lower time scale
- Close other GPU-intensive applications
- Your GPU may not support WebGL 2.0

### Build fails on Linux
Install dependencies:
```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

---

## Scientific

### What is the Torino Scale?
A 0-10 scale for categorizing asteroid impact threat:
- 0: No hazard
- 1: Normal discovery, low threat
- 2-4: Meriting concern
- 5-7: Threatening
- 8-10: Certain collision

### What deflection method is most realistic?
Currently, the **Kinetic Impactor** (proven by NASA's DART mission in 2022) is the most technologically ready.

### Can this simulate real deflection missions?
The physics are simplified for educational purposes. Real mission planning uses tools like NASA's CNEOS and ESA's NEO Coordination Centre.

---

## Support

### I found a bug!
Please report it: [GitHub Issues](https://github.com/SpaceEngineerSS/CosmoRisk/issues)

### I have a feature suggestion
Open a feature request: [GitHub Issues](https://github.com/SpaceEngineerSS/CosmoRisk/issues/new?template=feature_request.md)

### How can I contribute?
See [CONTRIBUTING.md](https://github.com/SpaceEngineerSS/CosmoRisk/blob/main/CONTRIBUTING.md)

---

[← NASA API](NASA-API) | [Back to Home →](Home)
