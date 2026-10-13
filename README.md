# CosmoRisk

A desktop simulator for near-Earth asteroids. It loads real orbits from NASA/JPL, moves them under the gravity of the Sun, the planets and the Moon, finds when they pass Earth, estimates the chance of a hit, and lets you try pushing them out of the way.

![CosmoRisk with the potentially hazardous asteroids loaded and 99942 Apophis selected](docs/img/screens/overview.png)

I started CosmoRisk as a visual toy. Version 3 is a rewrite with one goal: the numbers on screen should be right. As a check, the engine reproduces the April 2029 Apophis flyby within about 100 km and 20 seconds of JPL's solution:

| 99942 Apophis, 2029 | JPL CAD | CosmoRisk 3 |
|---|---:|---:|
| Closest approach (UTC) | 2029-04-13 21:46 | 2029-04-13 21:44 |
| Distance from Earth's centre | 38,011 km | 37,917 km |
| Relative speed | 7.42 km/s | 7.43 km/s |

![Apophis passing between Earth and the Moon's orbit on 13 April 2029](docs/img/screens/apophis-2029.png)

## What it does

- **Real data, no key.** Catalogue sets (potentially hazardous asteroids, NEOs larger than about 1 km) come from the JPL Small-Body Database, along with physical data and the orbit covariance for single objects. Upcoming close approaches come from JPL CAD, and the impact-monitoring list from JPL Sentry. Everything is cached, so the app also works offline.
- **Physics you can check.** Earth's position comes from VSOP87, the other planets from JPL's Keplerian approximations, and the Moon from a perturbed lunar theory. Asteroids are integrated with RK4 under the Sun, eight planets and the Moon, and the step size shrinks automatically during close encounters.
- **Flyby search.** Lists every pass within 0.05 AU of Earth for the next 10–100 years and puts it next to JPL's own numbers.
- **Impact probability.** Monte Carlo sampling of the real JPL orbit covariance, reported with a 95 % interval and with Torino and Palermo ratings. For objects on JPL's Sentry list, the official assessment is shown beside it.
- **Deflection.** Kinetic impactor (DART-style β), ion beam shepherd and gravity tractor. Preview shows the new miss distance and the shift on the target plane before you commit.
- **Runs on modest hardware.** Rendering drops to on-demand when nothing moves. Low, medium and high graphics tiers are picked automatically from your GPU, and the app steps down by itself if the frame rate falls. With 1,000 asteroids, one physics step takes about 1.5 ms.
- English and Turkish interface, a dark "night" theme and a light "paper" theme, a keyboard-first command palette (Ctrl K), saved scenarios, and Markdown reports and CSV exports.

## Install

Installers for Windows, macOS and Linux are on the [releases page](https://github.com/SpaceEngineerSS/CosmoRisk/releases). The builds are not code-signed yet, so Windows SmartScreen and macOS Gatekeeper will ask before running them.

To build it yourself you need Rust (1.77 or newer) and Node.js 20:

```sh
git clone https://github.com/SpaceEngineerSS/CosmoRisk.git
cd CosmoRisk
npm install
npm run tauri dev      # development
npm run tauri build    # installer for your platform
```

On Linux you also need the WebKitGTK development packages. [docs/building.md](docs/building.md) has the details.

## Using it

1. Click **Load from JPL** with *Potentially hazardous* selected. It takes a few seconds the first time.
2. Click any dot, or type a name in the command palette (Ctrl K). Apophis, Bennu and 2024 YR4 are good ones to start with.
3. In the inspector, **Find flybys** shows upcoming passes. **Run Monte Carlo** estimates the impact probability. **Deflection → Preview** shows what a push would change.
4. Space runs the clock, and `[` `]` (or `−` `+`) change its speed.

The full guide is in [docs/](docs/README.md). [docs/tr/](docs/tr/README.md) has a Turkish version.

## Limits

This is a careful simulator, not a replacement for JPL's tools. The main limits:

- Non-gravitational forces (the Yarkovsky effect), relativity and asteroid–asteroid perturbations are not modelled.
- The planetary ephemeris is analytic, not a JPL DE file.
- After a deep close approach such as Apophis in 2029, trajectories become chaotic, so passes decades later should be read as indicative only.

[docs/physics.md](docs/physics.md) gives the details and the error budget.

## Documentation

- [Getting started](docs/getting-started.md)
- [The interface](docs/interface.md)
- [Physics model](docs/physics.md)
- [Impact risk: Monte Carlo, Torino, Palermo](docs/risk.md)
- [Deflection methods](docs/deflection.md)
- [Data sources and caching](docs/data-sources.md)
- [Building and releasing](docs/building.md)
- [FAQ](docs/faq.md)

## Citing

If CosmoRisk is useful in your work, see [CITATION.cff](CITATION.cff).

## License

MIT, see [LICENSE](LICENSE). The data belongs to its providers: orbital and physical data come from NASA/JPL SSD/CNEOS, the stars from the Yale Bright Star Catalogue (Hoffleit & Warren, 5th ed.), the Earth texture is NASA Visible Earth "Blue Marble", and the Moon texture is from NASA's Lunar Reconnaissance Orbiter (LROC).

Mehmet Gümüş · [spacegumus.com.tr](https://spacegumus.com.tr) · [@SpaceEngineerSS](https://github.com/SpaceEngineerSS)
