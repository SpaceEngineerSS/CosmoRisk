# Contributing

Thanks for taking an interest. Bug reports, physics corrections and translations are the most useful contributions.

## Getting set up

See [docs/building.md](docs/building.md). In short:

```sh
npm install
npm run tauri dev
```

## Before you open a pull request

Run the same checks as CI:

```sh
npx tsc --noEmit
cd src-tauri
cargo test --release
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

- **Physics changes need a test.** If you change the model, show that it still reproduces a known result: compare against JPL Horizons or CAD, the way `apophis_2029_flyby` in `src-tauri/src/physics/propagate.rs` does.
- **Keep the frontend dependency-light.** It is plain TypeScript with Three.js and Motion. Please discuss before adding a framework.
- **All visible text goes through the locale files** in `src/core/locales/`. If you add a string, add it in English; a Turkish version is welcome too.
- Match the existing style: small modules, comments that explain *why*, no dead code.

## Reporting bugs

Use the bug report template. The most helpful things to include are:

- the object designation
- the simulation date
- what you expected
- for wrong numbers, the JPL value you compared against

## Translations

Copy `src/core/locales/en.ts` to a new file, translate the values, and register it in `src/core/i18n.ts` and the settings dialog. The TypeScript compiler will tell you if a key is missing.

## Code of conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
