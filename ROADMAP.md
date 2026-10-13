# Roadmap

What I would like to add next, roughly in order. Nothing here is a promise.

## Near term (3.x)

- **Yarkovsky drift** for objects where JPL publishes A1/A2 parameters. Apophis needs it for the 2029 keyhole question.
- **Line-of-variations sampling** in the Monte Carlo, so that probabilities of 10⁻⁶ become reachable.
- **Comets.** Hyperbolic and near-parabolic orbits are rejected at the moment.
- **Signed installers** for Windows and macOS.
- More languages. The string tables are in `src/core/locales/`; a new language is one file.

## Later

- An optional JPL DE440 ephemeris file for higher accuracy.
- Earth oblateness (J2) and relativity in the force model.
- A "mission" mode: launch windows and transfer Δv for an impactor, not just the Δv at the asteroid.
- Impact-effects estimates (crater size, blast radius) for the impact point.

## Not planned

- A web version. CosmoRisk depends on the native engine for speed and offline use.
- Mobile apps.

Ideas and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
