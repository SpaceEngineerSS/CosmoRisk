# Building

## Requirements

- Rust 1.77+ (stable)
- Node.js 20+
- Platform libraries for Tauri 2:
  - **Windows**: WebView2 (preinstalled on Windows 10 and 11) and the MSVC build tools.
  - **macOS**: Xcode command-line tools.
  - **Linux (Debian/Ubuntu)**:
    `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential libssl-dev`

## Develop

```sh
npm install
npm run tauri dev
```

Vite reloads the interface on save. Changes to Rust rebuild and restart the app. The development profile compiles dependencies with optimisation, so physics speed in dev is close to release.

## Check

```sh
npx tsc --noEmit                        # types
cd src-tauri
cargo test --release                    # physics and parsing tests
cargo clippy --all-targets -- -D warnings
```

CI runs all three on every push and pull request, on Ubuntu and Windows.

## Layout

```
src/                 frontend (TypeScript, no framework)
  core/              bridge to Rust, state, units, time, i18n, settings
  scene/             Three.js view: planets, asteroids, stars, markers
  ui/                panels, dialogs, palette, charts, exports
  styles/            design tokens and components
src-tauri/src/
  physics/           vectors, Kepler, ephemeris, VSOP87 table, propagator, risk
  data/              JPL clients, disk cache
  sim.rs             running simulation and binary frame
  commands.rs        everything the frontend can call
public/              star catalogue, textures
docs/                this documentation
```

## Release

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and `CITATION.cff`.
2. Add a section to `CHANGELOG.md`.
3. Tag and push: `git tag v3.0.0 && git push origin v3.0.0`.

The release workflow builds the installers with `tauri-action` and attaches them to a draft GitHub release, with the notes taken from the changelog:

- Windows: MSI and NSIS
- macOS: universal DMG
- Linux: AppImage and .deb

Review the draft and publish it.

The installers are unsigned. Signing needs certificates, which you configure as repository secrets; see the Tauri distribution guide.
