# 📦 Installation

## Prerequisites

Before installing CosmoRisk, ensure you have:

| Requirement | Version | Note |
|-------------|---------|------|
| Node.js | 18+ | [Download](https://nodejs.org/) |
| Rust | 1.70+ | [Install](https://rustup.rs/) |
| NASA API Key | - | [Get Free Key](https://api.nasa.gov/) |

## Quick Install (Pre-built Binaries)

Download the latest release for your platform:

### Windows
```
CosmoRisk_2.0.0_x64.msi
```

### macOS
```
CosmoRisk_2.0.0_x64.dmg
```

### Linux
```
CosmoRisk_2.0.0_amd64.AppImage
CosmoRisk_2.0.0_amd64.deb
```

📥 [Download from Releases](https://github.com/SpaceEngineerSS/CosmoRisk/releases)

---

## Build from Source

### 1. Clone Repository
```bash
git clone https://github.com/SpaceEngineerSS/CosmoRisk.git
cd CosmoRisk
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
```bash
npm run tauri dev
```

### 4. Build for Production
```bash
npm run tauri build
```

Output files will be in `src-tauri/target/release/bundle/`

---

## Linux Additional Dependencies

For Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

---

## Troubleshooting

### "npm ci failed"
Make sure you have Node.js 18+ installed:
```bash
node --version
```

### "Rust not found"
Install Rust via rustup:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### macOS: "App can't be opened"
Right-click the app → Open → Click "Open" in the dialog.

---

[← Back to Home](Home) | [Next: Getting Started →](Getting-Started)
