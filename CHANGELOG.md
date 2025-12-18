# Changelog

All notable changes to CosmoRisk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 18.12.2025

### Added - Branding & Polish
- CosmoRisk branding throughout application
- Animated loading screen with SVG logo
- "Track. Analyze. Defend." tagline
- About modal with developer info (Mehmet Gümüş)
- Settings modal with API key storage
- Distance unit preferences (AU/km/LD)

### Added - Visualization Enhancements
- 3-layer Sun corona with animated glow (inner/middle/outer)
- Earth blue marble appearance with dual-layer atmosphere
- Rocky brown asteroid material with faceted shading
- 50-point fading asteroid trails with gradient effect
- Distance lines from selected asteroid to Earth
- Selected asteroid orbit path visualization
- Collision warning banner with pulse animation

### Added - Analysis Tools
- Torino Scale (0-10) impact hazard assessment with energy-based classification:
  - Kinetic energy conversion: Joules → Megatons TNT
  - Energy thresholds: harmless (<1 kt), local (1 kt-1 MT), regional (1-100 MT), national (100-1000 MT), global (1-100 GT), extinction (>100 GT)
  - Probability × Energy matrix for accurate threat levels
  - NASA CNEOS reference integration
  - Display shows asteroid diameter and energy in MT/GT format
- MOID Calculator with real distance-based calculations
- Spectral type analysis (C/S/M/X/V)
- Side-by-side asteroid comparison table modal
- Asteroid info panel with Wikipedia links
- Historical impact events (Chicxulub, Tunguska, etc.)

### Added - Educational Features
- 5-step interactive onboarding tutorial
- 12-term scientific glossary modal
- 10 "Did You Know" asteroid facts
- What-If scenario save/load functionality

### Added - Mobile UX
- Pinch-to-zoom gesture support
- Swipe camera change (left/right)
- Mobile bottom sheet for panel content
- 3-button mobile bottom navigation
- Touch gesture improvements

### Added - Settings & Controls
- Dark/Light theme toggle (T key)
- Settings persistence via localStorage
- Zoom-to-fit all asteroids (F key)
- Real-time date sync option
- Multiple asteroid selection mode
- Show hazardous only filter

### Added - Export & Sharing
- Text report generation for selected asteroid
- Enhanced CSV data export
- Screenshot capture (PNG)

### Added - Physics Engine
- Monte Carlo impact probability simulation
- Jupiter perturbation calculations
- Mars perturbation calculations
- Trajectory preview after deflection (200-point projection)
- **Moon perturbation calculations** for close Earth approaches

### Fixed - 18.12.2025 (v2.0.1)
- **3D Orbit Visualization** - Orbits now correctly rendered in 3D using full Keplerian elements (inclination, RAAN, argument of perihelion)
- **MOID Calculation** - Replaced simplified distance-based approximation with proper orbital element sampling (72×72 points)
- **Trajectory Preview** - Added Jupiter gravitational perturbation and Solar Radiation Pressure to deflection preview
- **Splash Screen** - Replaced emoji-based animation with elegant minimal SVG orbit animation

### Changed
- Increased click detection threshold to 20 for better UX
- Enhanced asteroid LOD system
- Improved tooltip hover detection
- Replaced "Scientific Mode" with "Show Hazardous Only" filter

### Fixed
- Trajectory preview now updates after deflection
- Tooltip positioning and visibility
- Mobile panel responsiveness

---

## [1.0.0] - 2024-12-18

### Added
- Initial release
- Three.js visualization with procedural starfield
- N-body physics simulation (Velocity Verlet integrator)
- NASA NeoWs API integration
- Real-time asteroid tracking
- Kinetic impactor deflection simulation
- Ion beam deflection simulation
- J2 Earth oblateness perturbation
- Solar Radiation Pressure effects
- Yarkovsky thermal recoil effect
- Energy conservation monitoring
- Impact prediction display
- Tauri desktop application framework
- Comprehensive mobile UI with hamburger menu
- Keyboard shortcuts
- Toast notification system
- Camera presets (Sun, Earth, Top-down view)
- Search functionality for asteroids
- Post-processing toggle (Bloom, SSAO, FXAA)

---

## Developer

**Mehmet Gümüş**
- Website: [spacegumus.com.tr](https://spacegumus.com.tr)
- GitHub: [@SpaceEngineerSS](https://github.com/SpaceEngineerSS)
