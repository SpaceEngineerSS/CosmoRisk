# Orbital Sentinel - Complete Project Roadmap

Bu döküman, Orbital Sentinel uygulamasının tam açıklamasını ve gelecek geliştirmeler için yol haritasını içerir.

**Son Güncelleme:** 18.12.2025  
**Geliştirici:** Mehmet Gümüş ([@SpaceEngineerSS](https://github.com/SpaceEngineerSS))

---

## 📋 Proje Özeti

**Orbital Sentinel**, NASA'nın gerçek NEO (Near-Earth Object) verilerini kullanarak asteroid yörüngelerini simüle eden ve olası çarpma senaryolarında saptırma stratejilerini test etmeye olanak tanıyan bir masaüstü uygulamasıdır.

| Özellik | Değer |
|---------|-------|
| **Platform** | Windows/Mac/Linux (Tauri v2) |
| **Backend** | Rust (physics engine, API client) |
| **Frontend** | TypeScript + Three.js |
| **Veri Kaynağı** | NASA NeoWs API |
| **FPS** | 53-62 (10,000+ asteroid ile) |
| **Versiyon** | 2.0.0 |

---

## 🏗️ Mimari Yapı

```
CosmoRisk/
├── src/                          # Frontend
│   ├── main.ts                   # Three.js 3D sahne + Tauri IPC (~2900 satır)
│   └── styles.css                # Sci-Fi temalı CSS (~1800 satır)
├── src-tauri/
│   └── src/
│       ├── lib.rs                # Tauri entry point
│       ├── physics_engine.rs     # N-Body fizik motoru (~1200 satır)
│       ├── api_client.rs         # NASA API client
│       └── state_manager.rs      # State + Tauri commands
├── index.html                    # UI layout (~670 satır)
├── README.md                     # Proje dokümantasyonu
├── CHANGELOG.md                  # Değişiklik günlüğü
└── ROADMAP.md                    # Bu dosya
```

---

## ⚙️ Fizik Motoru Detayları

### Kullanılan Algoritmalar

| Algoritma | Açıklama |
|-----------|----------|
| **Velocity Verlet** | Symplectic integrator - enerji korunumu sağlar |
| **N-Body Gravity** | Güneş, Dünya, Ay ve asteroidler arası çekim |
| **J2 Perturbation** | Dünya'nın yassılığından kaynaklanan yörünge sapması |
| **Solar Radiation Pressure** | Güneş ışınlarının asteroid üzerindeki etkisi |
| **Yarkovsky Effect** | Termal radyasyon kuvveti |
| **Poynting-Robertson** | Güneş radyasyonu sürüklenmesi |
| **Jupiter/Mars Perturbation** | Dev gezegen etkileri |
| **Monte Carlo Impact** | İstatistiksel çarpma olasılığı analizi |

### Fiziksel Sabitler

```rust
G = 6.67430e-11       // Gravitational constant (m³/kg·s²)
AU = 1.495978707e11   // Astronomical Unit (m)
MU_SUN = 1.32712e20   // Sun's gravitational parameter
J2_EARTH = 1.08263e-3 // Earth oblateness coefficient
```

---

## 🎮 Kullanıcı Arayüzü

### Sol Panel - Kontroller
- **Time Control**: Play/Pause, Time Scale (0.1x - 100x), Time Step (1dk - 1 gün)
- **Data Source**: NASA API Key girişi, Fetch NEOs butonu
- **Visualization**: Orbit paths, Grid, Post-processing toggle
- **Asteroidler Listesi**: Sıralama ve filtreleme

### Sağ Panel - Bilgi & Analiz
- **Selected Object**: Seçili cismin pozisyon, hız, yarıçap bilgileri
- **Torino Scale**: 0-10 tehlike seviyesi görselleştirmesi
- **MOID Calculator**: Minimum Orbit Intersection Distance
- **Asteroid Info**: Spektral tip, kütle, yoğunluk
- **Deflection Control**: 
  - Kinetic Impactor: Δv XYZ ile anlık itki
  - Ion Beam: μN thrust ile uzun süreli itki
- **Impact Prediction**: Min mesafe, yaklaşma süresi, tehlike durumu
- **Energy Conservation**: ΔE grafı
- **Historical Impacts**: Geçmiş çarpma olayları

### Üst Bar - Telemetri
- Julian Date, Simülasyon zamanı, Cisim sayısı, Enerji sapması, FPS

### Alt Bar
- Kamera bilgisi, Integrator tipi, Kamera preset butonları

---

## 🎨 Görsel Özellikler

| Özellik | Açıklama |
|---------|----------|
| **Sun Corona** | 3 katmanlı glow (iç/orta/dış) |
| **Earth** | Blue marble + çift katmanlı atmosfer |
| **Asteroids** | Rocky brown malzeme, faceted shading, LOD |
| **Trails** | 50-noktalı fading gradient izler |
| **Distance Lines** | Asteroid → Dünya mesafe çizgisi |
| **Orbit Paths** | Seçili asteroid için yörünge |
| **Post-Processing** | SSAO, Bloom, FXAA |

---

## 🎓 Eğitim Özellikleri

| Özellik | İçerik |
|---------|--------|
| **Tutorial** | 5 adımlı interaktif onboarding |
| **Glossary** | 12 bilimsel terim (NEO, PHA, MOID, Torino, vb.) |
| **Did You Know** | 10 asteroid fakti |
| **Historical Impacts** | Chicxulub, Tunguska, Chelyabinsk |
| **What-If Scenarios** | Simülasyon durumu kaydet/yükle |

---

## 📱 Mobil UX

| Özellik | Uygulama |
|---------|----------|
| **Pinch-to-Zoom** | 2 parmak zoom gesture |
| **Swipe Camera** | Yatay swipe ile kamera değişimi |
| **Bottom Sheet** | Panel içeriği kopyalama (70vh) |
| **Mobile Navigation** | 3 butonlu alt navigasyon |
| **Hamburger Menu** | Sol taraftan kayar panel |

---

## ⌨️ Klavye Kısayolları

| Tuş | Aksiyon |
|-----|---------|
| Space | Play/Pause |
| R | Reset |
| +/- | Hızlandır/Yavaşlat |
| 1/2/3 | Kamera presetleri |
| O | Orbit görünürlük |
| G | Grid görünürlük |
| F | Zoom to Fit |
| T | Tema değiştir |
| D | Random fact |
| ? | Kısayollar modal |

---

## 🔧 Tauri Komutları (API)

| Komut | Parametre | Açıklama |
|-------|-----------|----------|
| `get_simulation_state` | - | Tüm simülasyon durumunu döner |
| `set_paused` | `paused: bool` | Simülasyonu durdur/başlat |
| `set_time_scale` | `scale: f64` | Zaman hızını ayarla |
| `set_time_step` | `dt: f64` | Fizik adımını ayarla |
| `reset_simulation` | - | Simülasyonu sıfırla |
| `fetch_asteroids` | - | NASA'dan asteroid verisi çek |
| `apply_deflection` | `body_id, delta_v[3]` | Kinetic impactor uygula |
| `apply_ion_beam` | `body_id, direction[3], magnitude, duration` | Ion beam uygula |
| `get_impact_prediction` | `body_id` | Dünya yaklaşım tahmini al |

---

## 📊 Başarı Kriterleri

| Kriter | Hedef | Durum |
|--------|-------|-------|
| Enerji korunumu | ΔE < 1e-5 (100 yıl) | ✅ Başarılı |
| Performans | 60 FPS (10k asteroid) | ✅ 53-62 FPS |
| API entegrasyonu | NASA NeoWs | ✅ Çalışıyor |
| Kinetic impactor | Δv uygulama | ✅ Tamamlandı |
| Ion beam | Sürekli itki | ✅ Tamamlandı |
| Impact prediction | Mesafe/süre tahmini | ✅ Tamamlandı |
| Monte Carlo | İstatistiksel analiz | ✅ Tamamlandı |
| Tutorial | 5 adımlı eğitim | ✅ Tamamlandı |
| Mobile UX | Touch gestures | ✅ Tamamlandı |
| Asteroid Trails | Fading izler | ✅ Tamamlandı |
| Comparison Table | Yan yana karşılaştırma | ✅ Tamamlandı |

---

## 🚀 Çalıştırma

```powershell
# Development
cd c:\Users\mehme\Desktop\CosmoRisk
npm run tauri dev

# Production Build
npm run tauri build
```

---

## 🔮 Gelecek Geliştirmeler (Optional)

1. **Relativistic Precession** - Einstein gravite etkileri
2. **Real Ephemeris Data** - JPL Horizons entegrasyonu
3. **VR/AR Support** - Immersive visualization
4. **Trajectory Optimization** - Optimal Δv hesaplama

---

## 👨‍💻 Geliştirici

Bu proje **Mehmet Gümüş** tarafından geliştirilmiştir.

- 🌐 Website: [spacegumus.com.tr](https://spacegumus.com.tr)
- 🐙 GitHub: [@SpaceEngineerSS](https://github.com/SpaceEngineerSS)

---

*Son Güncelleme: 18.12.2025*
