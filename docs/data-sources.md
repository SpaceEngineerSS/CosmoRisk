# Data sources

Everything comes from the public NASA/JPL Solar System Dynamics APIs. None of them needs an API key.

| Use | Endpoint | Notes |
|---|---|---|
| Catalogue sets | `sbdb_query.api` | Full-precision elements, H, diameter, albedo, PHA flag, MOID, orbit class, spectral type, rotation. Sorted by H, up to 5,000 per request. |
| Single object | `sbdb.api?phys-par=1&cov=mat&full-prec=1` | Elements, physical parameters, orbit covariance. |
| Close approaches | `cad.api` | Upcoming flybys (left rail) and the per-object comparison with our flyby search. |
| Impact monitoring | `sentry.api` | The risk list and per-object details. |

Requests go out from the Rust side with a descriptive User-Agent. CosmoRisk handles three failure cases:

- Rate limiting (HTTP 429/503) produces a clear message.
- Timeouts are 45 s, or 150 s for the full Sentry list.
- Error messages never contain request URLs.

## Caching and offline use

All of this lives in the app data directory:

- **Catalogue.** Every change to the loaded set is saved to `catalog.json`. On the next start the left rail offers to restore it, with no network needed.
- **Sentry list.** Kept for 24 hours in `sentry.json`. If JPL cannot be reached, the last copy is shown and marked as offline.
- **Scenarios.** Saved in `scenarios/` as JSON. A scenario holds the clock, every object's current state and record, and any thrust or Δv you applied. You can export a scenario to share it and import it on another machine.

| OS | App data directory |
|---|---|
| Windows | `%APPDATA%\com.cosmorisk.app` |
| macOS | `~/Library/Application Support/com.cosmorisk.app` |
| Linux | `~/.local/share/com.cosmorisk.app` |

## Bundled data

- **Stars**: the Yale Bright Star Catalogue (5th revised edition), 9,096 stars down to about magnitude 6.5. They are converted to J2000 ecliptic unit vectors with magnitude and B−V colour in `public/data/stars.bin`.
- **Earth texture**: NASA Visible Earth, *Blue Marble: Land Surface, Shallow Water, and Shaded Topography*, 2048×1024.
- **Moon texture**: NASA SVS, LRO colour mosaic, 1024×512.
- **Earth ephemeris**: VSOP87B (Bretagnon & Francou 1988), as generated Rust tables.

## Exports

- **Screenshot**: a PNG of the 3D view.
- **Report**: Markdown with the object's data and every analysis you ran in the session, ready to paste into notes or an issue.
- **Catalogue CSV**: one row per loaded object, with designation, flags, elements, size and MOID.
