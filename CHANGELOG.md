# Changelog

All notable changes are listed here. Dates are in ISO format.

## [3.0.0] - 2026-10-13

A rewrite. Most of the 2.x physics was either approximate or wrong, so it was replaced rather than patched.

### Engine
- Earth from VSOP87, the other planets from JPL's Keplerian approximations, and the Moon from a perturbed lunar theory, all evaluated at the simulation date. In 2.x the planets were frozen at J2000.
- Asteroids are integrated as test particles under the Sun, eight planets and the Moon, with indirect terms. The RK4 step size adapts during encounters. The duplicate "phantom Moon" is gone.
- Catalogue orbits are propagated from their epoch to the simulation date. In 2.x they were placed at the epoch's mean anomaly, regardless of date.
- The time rate now works as labelled. In 2.x, "1 day/s" actually ran at about 250 days/s.
- The Apophis 2029 flyby is reproduced to within ~100 km and ~20 s of JPL.
- Earth impacts are detected inside integration steps.

### Risk and deflection
- The Monte Carlo samples the JPL orbit covariance, runs in parallel off the UI thread, can be cancelled, and reports a 95 % interval. In 2.x it always failed: its random generator produced NaN.
- Impact energy, Torino and Palermo (Chesley 2002 background) are computed in Rust from real encounter speeds. The unit errors in 2.x had inflated energies by a factor of about 10⁶.
- New flyby search, with a side-by-side comparison against JPL CAD.
- Ion beam and gravity tractor are continuous thrust instead of an instant kick. A deflection preview shows the change in miss distance and the shift on the target plane.

### Data
- Switched from NASA NeoWs (API key required) to the JPL SSD APIs (no key): SBDB, SBDB Query, CAD and Sentry.
- Catalogue, Sentry list and scenarios are stored on disk, so the app works offline.

### Interface
- New design: a "mission control" layout, IBM Plex type, a custom icon set, and night and paper themes.
- True-scale Sun, planets and Moon. The Earth texture rotates with sidereal time. The background uses the real Yale Bright Star Catalogue.
- Command palette, inspector with numbered sections, timeline showing flyby markers.
- English and Turkish.
- Graphics tiers with automatic step-down, render-on-demand, frame interpolation and binary frame transport. The GPU memory leak from the 2.x trails is gone.
- Fixed everything in the 2.x interface that did not work: the double click handler, off-by-one sliders, mobile panels, theme persistence, the hidden Monte Carlo panel, and the unreachable comparison table.
- Strict CSP; external text is escaped.
- Files are saved through the system save dialog.

### Project
- Removed unused dependencies (React Three Fiber, drei, zustand, Tone.js, postprocessing) and template files.
- Release workflow builds real installers for Windows, macOS and Linux.
- New documentation in `docs/`.

## [2.0.1] - 2025-12-18
- Energy-based Torino scale, documentation updates.

## [2.0.0] - 2025-12-17
- Multi-platform builds, deflection methods, Monte Carlo panel (see the 3.0.0 notes for what was wrong with it).

## [1.0.0] - 2024-12-18
- First public version.
