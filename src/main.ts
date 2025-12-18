// Orbital Sentinel - Main Application Entry
// Three.js + Tauri Desktop Application for NEO Tracking
// State-of-the-Art visualization with post-processing and sonification

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { invoke } from '@tauri-apps/api/core';


// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface FrontendBody {
  id: string;
  name: string;
  body_type: string;
  position: [number, number, number];
  velocity: [number, number, number];
  radius: number;
  is_hazardous: boolean;
}

interface FrontendState {
  bodies: FrontendBody[];
  time: number;
  julian_date: number;
  is_paused: boolean;
  time_scale: number;
  energy_drift: number;
  asteroid_count: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SCALE = 100; // 1 AU = 100 units in scene
const SUN_VISUAL_RADIUS = 5;
const EARTH_VISUAL_RADIUS = 1.5;
const MOON_VISUAL_RADIUS = 0.4;
const ASTEROID_BASE_SIZE = 0.3;

const TIME_SCALE_VALUES = [1, 60, 3600, 86400, 604800, 2592000]; // seconds per second
const TIME_SCALE_LABELS = ['x1 sec/s', 'x1 min/s', 'x1 hr/s', 'x1 day/s', 'x1 week/s', 'x1 month/s'];
const TIME_STEP_VALUES = [60, 3600, 21600, 86400]; // dt in seconds
const TIME_STEP_LABELS = ['1 min', '1 hour', '6 hours', '1 day'];

// =============================================================================
// APPLICATION CLASS
// =============================================================================

class OrbitalSentinelApp {
  // Three.js objects
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;

  // Post-processing
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private ssaoPass!: SSAOPass;
  private fxaaPass!: ShaderPass;
  private postProcessingEnabled = true;

  // Celestial body meshes
  private sunMesh!: THREE.Mesh;
  private earthMesh!: THREE.Mesh;
  private moonMesh!: THREE.Mesh;
  private asteroidInstances!: THREE.InstancedMesh;
  private asteroidPoints!: THREE.Points;  // LOD: distant asteroids as points
  private trajectoryPreview!: THREE.Line;  // Deflection trajectory preview
  private orbitLines: Map<string, THREE.Line> = new Map();

  // Selected asteroid visualization
  private selectedOrbitPath: THREE.Line | null = null;  // Orbit path for selected asteroid
  private distanceToEarthLine: THREE.Line | null = null;  // Line from selected to Earth

  // Asteroid trails (fading)
  private asteroidTrails: Map<string, THREE.Line> = new Map();
  private asteroidTrailHistory: Map<string, Array<[number, number, number]>> = new Map();
  private readonly TRAIL_MAX_LENGTH = 50;  // Max trail points

  // State
  private bodies: Map<string, FrontendBody> = new Map();
  private selectedBodyId: string | null = null;
  private isPaused = true;
  private showOrbits = true;
  private showGrid = false;
  private showHazardousOnly = false;  // Filter to show only hazardous asteroids

  // Stats
  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 60;

  // Energy history for chart
  private energyHistory: number[] = [];
  private maxEnergyPoints = 100;


  // DOM Elements
  private loadingScreen!: HTMLElement;
  private uiOverlay!: HTMLElement;
  private loaderBar!: HTMLElement;
  private loaderStatus!: HTMLElement;

  constructor() {
    this.initDOM();
    this.initThreeJS();
    this.initEventListeners();
    this.startLoadingSequence();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initDOM(): void {
    this.loadingScreen = document.getElementById('loading-screen')!;
    this.uiOverlay = document.getElementById('ui-overlay')!;
    this.loaderBar = document.getElementById('loader-bar')!;
    this.loaderStatus = document.getElementById('loader-status')!;
  }

  private initThreeJS(): void {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020408);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    this.camera.position.set(0, 150, 200);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('viewport')!.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 2000;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    const sunLight = new THREE.PointLight(0xffffff, 2, 1000);
    sunLight.position.set(0, 0, 0);
    this.scene.add(sunLight);

    // Create celestial bodies
    this.createSun();
    this.createEarth();
    this.createMoon();
    this.createAsteroidInstances();
    this.createStarfield();
    this.createEclipticGrid();

    // Initialize post-processing pipeline
    this.initPostProcessing();

    // Handle resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private initPostProcessing(): void {
    // EffectComposer for post-processing pipeline
    this.composer = new EffectComposer(this.renderer);

    // Base render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // SSAO - Screen Space Ambient Occlusion (depth/shadow enhancement)
    this.ssaoPass = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    this.ssaoPass.kernelRadius = 16;
    this.ssaoPass.minDistance = 0.005;
    this.ssaoPass.maxDistance = 0.1;
    this.composer.addPass(this.ssaoPass);

    // Unreal Bloom - God rays and glow effects for Sun
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,   // strength
      0.4,   // radius
      0.85   // threshold
    );
    this.composer.addPass(this.bloomPass);

    // FXAA - Anti-aliasing
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.material.uniforms['resolution'].value.set(
      1 / window.innerWidth,
      1 / window.innerHeight
    );
    this.composer.addPass(this.fxaaPass);
  }

  private createSun(): void {
    const geometry = new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffcc00
    });
    this.sunMesh = new THREE.Mesh(geometry, material);
    this.sunMesh.userData.id = 'sun';
    this.sunMesh.userData.name = 'Sun';
    this.scene.add(this.sunMesh);

    // Sun corona - inner glow
    const glowGeometry1 = new THREE.SphereGeometry(SUN_VISUAL_RADIUS * 1.3, 32, 32);
    const glowMaterial1 = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.4,
      side: THREE.BackSide
    });
    const innerGlow = new THREE.Mesh(glowGeometry1, glowMaterial1);
    this.sunMesh.add(innerGlow);

    // Sun corona - middle glow
    const glowGeometry2 = new THREE.SphereGeometry(SUN_VISUAL_RADIUS * 1.8, 32, 32);
    const glowMaterial2 = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide
    });
    const middleGlow = new THREE.Mesh(glowGeometry2, glowMaterial2);
    this.sunMesh.add(middleGlow);

    // Sun corona - outer glow
    const glowGeometry3 = new THREE.SphereGeometry(SUN_VISUAL_RADIUS * 2.5, 32, 32);
    const glowMaterial3 = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide
    });
    const outerGlow = new THREE.Mesh(glowGeometry3, glowMaterial3);
    this.sunMesh.add(outerGlow);

    // Store for animation
    this.sunMesh.userData.coronaLayers = [innerGlow, middleGlow, outerGlow];
  }

  private createEarth(): void {
    const geometry = new THREE.SphereGeometry(EARTH_VISUAL_RADIUS, 64, 64);

    // Create procedural Earth material with blue marble appearance
    const material = new THREE.MeshPhongMaterial({
      color: 0x1155bb,
      emissive: 0x112244,
      emissiveIntensity: 0.15,
      shininess: 30,
      specular: 0x333366
    });

    this.earthMesh = new THREE.Mesh(geometry, material);
    this.earthMesh.userData.id = 'earth';
    this.earthMesh.userData.name = 'Earth';
    this.earthMesh.position.set(SCALE, 0, 0); // 1 AU from Sun initially
    this.scene.add(this.earthMesh);

    // Atmosphere glow (inner)
    const atmoGeometry1 = new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.1, 32, 32);
    const atmoMaterial1 = new THREE.MeshBasicMaterial({
      color: 0x6699ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide
    });
    const atmosphere1 = new THREE.Mesh(atmoGeometry1, atmoMaterial1);
    this.earthMesh.add(atmosphere1);

    // Atmosphere glow (outer)
    const atmoGeometry2 = new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.25, 32, 32);
    const atmoMaterial2 = new THREE.MeshBasicMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide
    });
    const atmosphere2 = new THREE.Mesh(atmoGeometry2, atmoMaterial2);
    this.earthMesh.add(atmosphere2);

    // Earth orbit trail
    this.createOrbitPath('earth', 1.0, 0x2266aa);
  }

  private createMoon(): void {
    const geometry = new THREE.SphereGeometry(MOON_VISUAL_RADIUS, 16, 16);
    const material = new THREE.MeshPhongMaterial({
      color: 0xaaaaaa,
      shininess: 5
    });
    this.moonMesh = new THREE.Mesh(geometry, material);
    this.moonMesh.userData.id = 'moon';
    this.moonMesh.userData.name = 'Moon';
    this.scene.add(this.moonMesh);
  }

  private createAsteroidInstances(): void {
    // High-detail: InstancedMesh for close asteroids
    const geometry = new THREE.IcosahedronGeometry(ASTEROID_BASE_SIZE, 0);
    // Asteroid material with rocky appearance
    const material = new THREE.MeshPhongMaterial({
      color: 0x8b7355, // Rocky brown
      emissive: 0x1a1510,
      emissiveIntensity: 0.1,
      flatShading: true, // Gives faceted rocky look
      shininess: 5,
      specular: 0x222222
    });

    // Pre-allocate for many asteroids
    this.asteroidInstances = new THREE.InstancedMesh(geometry, material, 5000);
    this.asteroidInstances.count = 0;
    this.asteroidInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.asteroidInstances);

    // LOW-DETAIL (LOD): Points for distant asteroids
    const pointsGeometry = new THREE.BufferGeometry();
    const pointsPositions = new Float32Array(10000 * 3);
    const pointsColors = new Float32Array(10000 * 3);
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(pointsPositions, 3));
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(pointsColors, 3));

    const pointsMaterial = new THREE.PointsMaterial({
      size: 3,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true
    });

    this.asteroidPoints = new THREE.Points(pointsGeometry, pointsMaterial);
    this.asteroidPoints.frustumCulled = true;
    this.scene.add(this.asteroidPoints);

    // TRAJECTORY PREVIEW: Line for deflection visualization
    const trajGeometry = new THREE.BufferGeometry();
    const trajPositions = new Float32Array(200 * 3);
    trajGeometry.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));

    const trajMaterial = new THREE.LineBasicMaterial({
      color: 0xff4757,
      transparent: true,
      opacity: 0.8,
      linewidth: 2
    });

    this.trajectoryPreview = new THREE.Line(trajGeometry, trajMaterial);
    this.trajectoryPreview.visible = false;
    this.scene.add(this.trajectoryPreview);
  }

  private createOrbitPath(id: string, semiMajorAxisAU: number, color: number): void {
    const points: THREE.Vector3[] = [];
    const segments = 128;

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * semiMajorAxisAU * SCALE;
      const z = Math.sin(angle) * semiMajorAxisAU * SCALE;
      points.push(new THREE.Vector3(x, 0, z));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4
    });

    const line = new THREE.Line(geometry, material);
    this.orbitLines.set(id, line);
    this.scene.add(line);
  }

  private starfieldMaterial!: THREE.ShaderMaterial;

  private createStarfield(): void {
    // Procedural starfield with GLSL shader
    const vertexShader = `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      varying vec3 vPosition;
      uniform float uTime;
      
      // Hash function for randomness
      float hash(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      
      // Star function
      float star(vec3 dir, vec3 starPos, float size) {
        float d = length(dir - starPos);
        return smoothstep(size, 0.0, d);
      }
      
      void main() {
        vec3 dir = normalize(vPosition);
        vec3 color = vec3(0.0);
        
        // Multiple layers of stars with different densities
        for(int i = 0; i < 4; i++) {
          float scale = 40.0 + float(i) * 25.0;
          vec3 grid = floor(dir * scale);
          vec3 id = grid + float(i) * 100.0;
          
          float h = hash(id);
          if(h > 0.96) {
            vec3 starPos = (grid + 0.5 + (hash(id + 1.0) - 0.5) * 0.9) / scale;
            starPos = normalize(starPos);
            
            float brightness = pow(hash(id + 2.0), 2.0) * 1.5;
            float twinkle = 0.7 + 0.3 * sin(uTime * hash(id + 3.0) * 4.0 + hash(id + 4.0) * 6.28);
            float size = 0.0008 + hash(id + 5.0) * 0.0015;
            
            // Star color based on temperature (blue -> white -> yellow -> red)
            float temp = hash(id + 6.0);
            vec3 starColor;
            if(temp < 0.3) {
              starColor = vec3(1.0, 0.8, 0.6); // Red/orange
            } else if(temp < 0.6) {
              starColor = vec3(1.0, 1.0, 0.95); // White
            } else {
              starColor = vec3(0.8, 0.9, 1.0); // Blue
            }
            
            color += starColor * star(dir, starPos, size) * brightness * twinkle;
          }
        }
        
        // Milky Way band
        float milkyWay = smoothstep(0.85, 0.0, abs(dir.y)) * 0.03;
        color += vec3(0.7, 0.75, 0.9) * milkyWay;
        
        // Nebula hints
        float nebula = smoothstep(0.8, 0.0, abs(dir.z - 0.3)) * smoothstep(0.8, 0.0, abs(dir.x + 0.2)) * 0.015;
        color += vec3(0.6, 0.3, 0.7) * nebula;
        
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    this.starfieldMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0.0 }
      },
      side: THREE.BackSide
    });

    const skyGeometry = new THREE.SphereGeometry(4500, 32, 32);
    const skyMesh = new THREE.Mesh(skyGeometry, this.starfieldMaterial);
    this.scene.add(skyMesh);
  }

  private createEclipticGrid(): void {
    const gridHelper = new THREE.GridHelper(500, 50, 0x00d4ff, 0x1a3a4a);
    gridHelper.visible = this.showGrid;
    gridHelper.material.opacity = 0.3;
    (gridHelper.material as THREE.Material).transparent = true;
    gridHelper.userData.isGrid = true;
    this.scene.add(gridHelper);
  }

  // ===========================================================================
  // EVENT LISTENERS
  // ===========================================================================

  private initEventListeners(): void {
    // Play/Pause button
    document.getElementById('btn-play')?.addEventListener('click', () => {
      this.togglePause();
    });

    // Reset button
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      this.resetSimulation();
    });

    // Time scale slider
    document.getElementById('time-scale')?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.setTimeScale(TIME_SCALE_VALUES[value]);
      document.getElementById('time-scale-value')!.textContent = TIME_SCALE_LABELS[value];
    });

    // Time step slider
    document.getElementById('time-step')?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      this.setTimeStep(TIME_STEP_VALUES[value]);
      document.getElementById('time-step-value')!.textContent = TIME_STEP_LABELS[value];
    });

    // Fetch NEOs button
    document.getElementById('btn-fetch-neo')?.addEventListener('click', () => {
      const apiKey = (document.getElementById('api-key') as HTMLInputElement).value;
      if (apiKey) {
        this.fetchNEOs(apiKey);
      } else {
        alert('Please enter a NASA API key');
      }
    });

    // Fetch more button
    document.getElementById('btn-fetch-more')?.addEventListener('click', () => {
      this.fetchMoreNEOs();
    });

    // Visualization toggles
    document.getElementById('show-orbits')?.addEventListener('change', (e) => {
      this.showOrbits = (e.target as HTMLInputElement).checked;
      this.updateOrbitVisibility();
      this.saveSettings();
    });

    document.getElementById('show-grid')?.addEventListener('change', (e) => {
      this.showGrid = (e.target as HTMLInputElement).checked;
      this.scene.traverse((child) => {
        if (child.userData.isGrid) {
          child.visible = this.showGrid;
        }
      });
    });

    document.getElementById('post-processing')?.addEventListener('change', (e) => {
      this.postProcessingEnabled = (e.target as HTMLInputElement).checked;
      this.saveSettings();
    });

    // Apply impulse button
    document.getElementById('btn-apply-impulse')?.addEventListener('click', () => {
      this.applyDeflection();
    });

    // Δv magnitude calculator - update on input change
    const updateDvMagnitude = () => {
      const dvX = parseFloat((document.getElementById('dv-x') as HTMLInputElement).value) || 0;
      const dvY = parseFloat((document.getElementById('dv-y') as HTMLInputElement).value) || 0;
      const dvZ = parseFloat((document.getElementById('dv-z') as HTMLInputElement).value) || 0;
      const magnitude = Math.sqrt(dvX * dvX + dvY * dvY + dvZ * dvZ);
      const magnitudeEl = document.getElementById('dv-magnitude');
      if (magnitudeEl) {
        magnitudeEl.textContent = `${magnitude.toFixed(2)} m/s`;
      }
    };
    document.getElementById('dv-x')?.addEventListener('input', updateDvMagnitude);
    document.getElementById('dv-y')?.addEventListener('input', updateDvMagnitude);
    document.getElementById('dv-z')?.addEventListener('input', updateDvMagnitude);

    // Trajectory preview toggle
    document.getElementById('show-trajectory')?.addEventListener('change', (e) => {
      this.trajectoryPreview.visible = (e.target as HTMLInputElement).checked && this.selectedBodyId !== null;
    });

    // Ion beam thrust slider
    document.getElementById('ion-thrust')?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      document.getElementById('ion-thrust-value')!.textContent = `${value} μN`;
    });

    // Ion beam duration slider
    document.getElementById('ion-duration')?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value);
      document.getElementById('ion-duration-value')!.textContent = `${value} days`;
    });

    // Apply ion beam button
    document.getElementById('btn-apply-ion')?.addEventListener('click', () => {
      this.applyIonBeam();
    });

    // Raycaster for object selection
    this.renderer.domElement.addEventListener('click', (e) => {
      this.handleClick(e);
    });

    // === NEW UI HANDLERS ===

    // Hamburger menu toggle
    document.getElementById('hamburger-btn')?.addEventListener('click', () => {
      this.toggleMobileNav();
    });

    // Help button - show shortcuts modal
    document.getElementById('btn-help')?.addEventListener('click', () => {
      this.toggleShortcutsModal(true);
    });

    // Close shortcuts modal
    document.getElementById('close-shortcuts')?.addEventListener('click', () => {
      this.toggleShortcutsModal(false);
    });

    // Modal backdrop click to close
    document.querySelector('#shortcuts-modal .modal-backdrop')?.addEventListener('click', () => {
      this.toggleShortcutsModal(false);
    });

    // Camera preset buttons
    document.getElementById('cam-sun')?.addEventListener('click', () => {
      this.setCameraPreset('sun');
    });
    document.getElementById('cam-earth')?.addEventListener('click', () => {
      this.setCameraPreset('earth');
    });
    document.getElementById('cam-top')?.addEventListener('click', () => {
      this.setCameraPreset('top');
    });

    // Search functionality
    document.getElementById('btn-search')?.addEventListener('click', () => {
      this.searchAsteroids();
    });
    document.getElementById('asteroid-search')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        this.searchAsteroids();
      }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      this.handleKeyboardShortcut(e);
    });

    // Post-processing toggle
    document.getElementById('post-processing')?.addEventListener('change', (e) => {
      this.postProcessingEnabled = (e.target as HTMLInputElement).checked;
    });

    // PDF export button
    document.getElementById('btn-pdf-export')?.addEventListener('click', () => this.generatePDFReport());

    // Multi-select toggle
    document.getElementById('btn-multi-select')?.addEventListener('click', () => this.toggleMultiSelectMode());

    // Real-time sync toggle
    document.getElementById('btn-realtime-sync')?.addEventListener('click', () => this.toggleRealTimeSync());

    // Comparison table
    document.getElementById('btn-compare')?.addEventListener('click', () => this.openComparisonTable());
    document.getElementById('close-comparison')?.addEventListener('click', () => this.closeComparisonTable());
    document.querySelector('#comparison-modal .modal-backdrop')?.addEventListener('click', () => this.closeComparisonTable());

    // Mobile bottom sheet
    document.getElementById('btn-sheet-left')?.addEventListener('click', () => this.toggleBottomSheet('left'));
    document.getElementById('btn-sheet-right')?.addEventListener('click', () => this.toggleBottomSheet('right'));
    document.getElementById('close-bottom-sheet')?.addEventListener('click', () => this.closeBottomSheet());

    // Initialize mobile touch gestures
    this.initTouchGestures();

    // Export data button
    document.getElementById('btn-export')?.addEventListener('click', () => {
      this.exportData();
    });

    // Screenshot button
    document.getElementById('btn-screenshot')?.addEventListener('click', () => {
      this.captureScreenshot();
    });

    // Historical impact items
    document.querySelectorAll('.impact-item').forEach((item) => {
      item.addEventListener('click', () => {
        const event = item.getAttribute('data-event');
        this.showHistoricalImpactInfo(event);
      });
    });

    // Hazardous only filter
    document.getElementById('show-hazardous-only')?.addEventListener('change', (e) => {
      this.showHazardousOnly = (e.target as HTMLInputElement).checked;
      this.showToast('Filter', this.showHazardousOnly ? 'Showing hazardous only' : 'Showing all asteroids', 'success');
    });

    // Canvas mouse events for tooltips and click detection
    this.renderer.domElement.addEventListener('click', (e) => this.handleClick(e));
    this.renderer.domElement.addEventListener('mousemove', (e) => this.handleMouseMove(e));

    // Tutorial modal
    document.getElementById('btn-tutorial')?.addEventListener('click', () => this.showTutorial());
    document.getElementById('close-tutorial')?.addEventListener('click', () => this.hideTutorial());
    document.getElementById('tutorial-prev')?.addEventListener('click', () => this.tutorialPrev());
    document.getElementById('tutorial-next')?.addEventListener('click', () => this.tutorialNext());
    document.querySelector('#tutorial-modal .modal-backdrop')?.addEventListener('click', () => this.hideTutorial());

    // Glossary modal
    document.getElementById('btn-glossary')?.addEventListener('click', () => this.showGlossary());
    document.getElementById('close-glossary')?.addEventListener('click', () => this.hideGlossary());
    document.querySelector('#glossary-modal .modal-backdrop')?.addEventListener('click', () => this.hideGlossary());

    // Scenario save/load
    document.getElementById('btn-save-scenario')?.addEventListener('click', () => this.saveScenario());
    document.getElementById('btn-load-scenario')?.addEventListener('click', () => this.loadScenario());

    // View controls
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.zoomToFit());
    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('btn-random-fact')?.addEventListener('click', () => this.showRandomFact());

    // Load saved settings
    this.loadSettings();
  }

  // ===========================================================================
  // LOADING SEQUENCE
  // ===========================================================================

  private async startLoadingSequence(): Promise<void> {
    const updateProgress = (percent: number, status: string) => {
      this.loaderBar.style.width = `${percent}%`;
      this.loaderStatus.textContent = status;
    };

    try {
      updateProgress(10, 'Initializing physics engine...');
      await new Promise(resolve => setTimeout(resolve, 300));

      updateProgress(30, 'Loading celestial mechanics...');
      await new Promise(resolve => setTimeout(resolve, 300));

      updateProgress(50, 'Configuring orbital calculations...');
      await new Promise(resolve => setTimeout(resolve, 300));

      updateProgress(70, 'Setting up visualization...');
      await new Promise(resolve => setTimeout(resolve, 300));

      updateProgress(90, 'Syncing with simulation backend...');
      await this.fetchInitialState();

      updateProgress(100, 'Ready');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Hide loading screen
      this.loadingScreen.classList.add('fade-out');
      this.uiOverlay.classList.remove('hidden');

      // Start animation loop
      this.animate();

      // Start state polling
      this.startStatePolling();

    } catch (error) {
      console.error('Loading failed:', error);
      updateProgress(0, 'Error: Failed to initialize');
    }
  }

  // ===========================================================================
  // TAURI BACKEND COMMUNICATION
  // ===========================================================================

  private async fetchInitialState(): Promise<void> {
    try {
      const state = await invoke<FrontendState>('get_simulation_state');
      this.updateFromBackendState(state);
    } catch (error) {
      console.error('Failed to fetch initial state:', error);
    }
  }

  private startStatePolling(): void {
    setInterval(async () => {
      try {
        const state = await invoke<FrontendState>('get_simulation_state');
        this.updateFromBackendState(state);
      } catch (error) {
        console.error('State polling error:', error);
      }
    }, 50); // 20 FPS polling rate for smooth updates
  }

  private updateFromBackendState(state: FrontendState): void {
    // Update bodies
    for (const body of state.bodies) {
      this.bodies.set(body.id, body);
    }

    // Update positions
    this.updateCelestialPositions();

    // Update UI
    this.updateTelemetry(state);

    // Update asteroid list panel
    this.updateAsteroidList();

    // Check for close approaches (collision warning)
    this.checkCloseApproaches();

    // Update asteroid trails (fading effect)
    this.updateAsteroidTrails();
  }

  private updateCelestialPositions(): void {
    // Sun (always at origin)
    this.sunMesh.position.set(0, 0, 0);

    // Earth
    const earth = this.bodies.get('earth');
    if (earth) {
      this.earthMesh.position.set(
        earth.position[0] * SCALE,
        earth.position[2] * SCALE, // Y-up in Three.js
        earth.position[1] * SCALE
      );
    }

    // Moon
    const moon = this.bodies.get('moon');
    if (moon) {
      this.moonMesh.position.set(
        moon.position[0] * SCALE,
        moon.position[2] * SCALE,
        moon.position[1] * SCALE
      );
    }

    // Update asteroid instances
    this.updateAsteroidInstances();
  }

  private updateAsteroidInstances(): void {
    const asteroids: FrontendBody[] = [];
    this.bodies.forEach((body) => {
      if (body.body_type === 'Asteroid') {
        // Apply hazardous filter if enabled
        if (this.showHazardousOnly && !body.is_hazardous) {
          return; // Skip non-hazardous asteroids when filter is on
        }
        asteroids.push(body);
      }
    });

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    // LOD: Distance threshold in scene units (1.5 AU)
    const LOD_THRESHOLD = 1.5 * SCALE;
    const cameraPos = this.camera.position;

    // Separate close and distant asteroids
    const closeAsteroids: FrontendBody[] = [];
    const distantAsteroids: FrontendBody[] = [];

    for (const asteroid of asteroids) {
      const worldX = asteroid.position[0] * SCALE;
      const worldY = asteroid.position[2] * SCALE;
      const worldZ = asteroid.position[1] * SCALE;

      const distanceToCamera = Math.sqrt(
        Math.pow(worldX - cameraPos.x, 2) +
        Math.pow(worldY - cameraPos.y, 2) +
        Math.pow(worldZ - cameraPos.z, 2)
      );

      if (distanceToCamera < LOD_THRESHOLD) {
        closeAsteroids.push(asteroid);
      } else {
        distantAsteroids.push(asteroid);
      }
    }

    // HIGH DETAIL: Close asteroids as InstancedMesh
    this.asteroidInstances.count = Math.min(closeAsteroids.length, 5000);
    for (let i = 0; i < this.asteroidInstances.count; i++) {
      const asteroid = closeAsteroids[i];
      position.set(
        asteroid.position[0] * SCALE,
        asteroid.position[2] * SCALE,
        asteroid.position[1] * SCALE
      );

      const sizeScale = Math.max(0.5, Math.min(2, asteroid.radius / 100));
      scale.set(sizeScale, sizeScale, sizeScale);

      matrix.compose(position, quaternion, scale);
      this.asteroidInstances.setMatrixAt(i, matrix);
    }
    this.asteroidInstances.instanceMatrix.needsUpdate = true;

    // LOW DETAIL: Distant asteroids as Points
    const positionsAttr = this.asteroidPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorsAttr = this.asteroidPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = positionsAttr.array as Float32Array;
    const colors = colorsAttr.array as Float32Array;

    for (let i = 0; i < Math.min(distantAsteroids.length, 10000); i++) {
      const asteroid = distantAsteroids[i];
      positions[i * 3] = asteroid.position[0] * SCALE;
      positions[i * 3 + 1] = asteroid.position[2] * SCALE;
      positions[i * 3 + 2] = asteroid.position[1] * SCALE;

      // Color: hazardous = red, normal = gray
      if (asteroid.is_hazardous) {
        colors[i * 3] = 1.0;     // R
        colors[i * 3 + 1] = 0.3; // G
        colors[i * 3 + 2] = 0.3; // B
      } else {
        colors[i * 3] = 0.6;
        colors[i * 3 + 1] = 0.6;
        colors[i * 3 + 2] = 0.7;
      }
    }

    positionsAttr.needsUpdate = true;
    colorsAttr.needsUpdate = true;
    this.asteroidPoints.geometry.setDrawRange(0, distantAsteroids.length);
  }

  private updateTelemetry(state: FrontendState): void {
    // Julian Date
    document.getElementById('julian-date')!.textContent = state.julian_date.toFixed(2);

    // Simulation time
    const days = Math.floor(state.time / 86400);
    const hours = Math.floor((state.time % 86400) / 3600);
    const mins = Math.floor((state.time % 3600) / 60);
    const secs = Math.floor(state.time % 60);
    document.getElementById('sim-time')!.textContent =
      `T+${days}d ${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Object count
    document.getElementById('object-count')!.textContent = state.bodies.length.toString();

    // Energy drift
    const driftEl = document.getElementById('energy-drift')!;
    driftEl.textContent = state.energy_drift.toExponential(2);

    const driftContainer = driftEl.closest('.energy-monitor')!;
    driftContainer.classList.remove('warning', 'danger');
    if (state.energy_drift > 1e-3) {
      driftContainer.classList.add('danger');
    } else if (state.energy_drift > 1e-5) {
      driftContainer.classList.add('warning');
    }

    // Status indicator
    const statusDot = document.querySelector('.status-dot')!;
    const statusText = document.querySelector('.status-text')!;
    if (state.is_paused) {
      statusDot.classList.add('paused');
      statusText.textContent = 'PAUSED';
    } else {
      statusDot.classList.remove('paused');
      statusText.textContent = 'RUNNING';
    }

    // Update energy history for chart
    this.energyHistory.push(state.energy_drift);
    if (this.energyHistory.length > this.maxEnergyPoints) {
      this.energyHistory.shift();
    }
    this.drawEnergyChart();
  }

  private drawEnergyChart(): void {
    const canvas = document.getElementById('energy-chart') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    if (this.energyHistory.length < 2) return;

    // Find max value for scaling
    const maxDrift = Math.max(...this.energyHistory, 1e-10);

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < this.energyHistory.length; i++) {
      const x = (i / this.maxEnergyPoints) * width;
      const y = height - (this.energyHistory[i] / maxDrift) * (height - 10);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Draw threshold lines
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#ffa500';
    ctx.lineWidth = 1;
    const thresholdY = height - (1e-5 / maxDrift) * (height - 10);
    ctx.beginPath();
    ctx.moveTo(0, thresholdY);
    ctx.lineTo(width, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ===========================================================================
  // CONTROL ACTIONS
  // ===========================================================================

  private async togglePause(): Promise<void> {
    this.isPaused = !this.isPaused;
    try {
      await invoke('set_paused', { paused: this.isPaused });
      const btnIcon = document.querySelector('#btn-play .btn-icon')!;
      btnIcon.textContent = this.isPaused ? '▶' : '⏸';
    } catch (error) {
      console.error('Failed to toggle pause:', error);
    }
  }

  private async resetSimulation(): Promise<void> {
    try {
      await invoke('reset_simulation');
      this.energyHistory = [];
    } catch (error) {
      console.error('Failed to reset:', error);
    }
  }

  private async setTimeScale(scale: number): Promise<void> {
    try {
      await invoke('set_time_scale', { scale });
    } catch (error) {
      console.error('Failed to set time scale:', error);
    }
  }

  private async setTimeStep(dt: number): Promise<void> {
    try {
      await invoke('set_time_step', { dt });
    } catch (error) {
      console.error('Failed to set time step:', error);
    }
  }

  private async fetchNEOs(apiKey: string): Promise<void> {
    try {
      await invoke('set_api_key', { apiKey });
      const count = await invoke<number>('fetch_asteroids');
      console.log(`Fetched ${count} asteroids`);
    } catch (error) {
      console.error('Failed to fetch NEOs:', error);
      alert('Failed to fetch NEOs. Check your API key.');
    }
  }

  private fetchMorePage = 1;
  private async fetchMoreNEOs(): Promise<void> {
    try {
      this.fetchMorePage++;
      const count = await invoke<number>('fetch_more_asteroids', {
        page: this.fetchMorePage,
        size: 20
      });
      console.log(`Fetched ${count} more asteroids`);
    } catch (error) {
      console.error('Failed to fetch more NEOs:', error);
    }
  }

  private async applyDeflection(): Promise<void> {
    if (!this.selectedBodyId) return;

    const dvX = parseFloat((document.getElementById('dv-x') as HTMLInputElement).value) || 0;
    const dvY = parseFloat((document.getElementById('dv-y') as HTMLInputElement).value) || 0;
    const dvZ = parseFloat((document.getElementById('dv-z') as HTMLInputElement).value) || 0;

    try {
      await invoke('apply_deflection', {
        bodyId: this.selectedBodyId,
        deltaV: [dvX, dvY, dvZ]
      });
      console.log(`Applied Δv [${dvX}, ${dvY}, ${dvZ}] to ${this.selectedBodyId}`);
      this.updateImpactPrediction(); // Update prediction after deflection
      this.updateTrajectoryPreview([dvX, dvY, dvZ]); // Update trajectory visualization
      this.showToast('Deflection Applied', `Δv: [${dvX.toFixed(2)}, ${dvY.toFixed(2)}, ${dvZ.toFixed(2)}] m/s`, 'success');
    } catch (error) {
      console.error('Failed to apply deflection:', error);
      this.showToast('Deflection Failed', 'Unable to apply velocity change', 'error');
    }
  }

  private async applyIonBeam(): Promise<void> {
    if (!this.selectedBodyId) return;

    const thrust = parseFloat((document.getElementById('ion-thrust') as HTMLInputElement).value) || 100;
    const durationDays = parseFloat((document.getElementById('ion-duration') as HTMLInputElement).value) || 30;

    // Convert μN to m/s² (assuming 1000 kg asteroid mass for now)
    const thrustN = thrust * 1e-6; // μN to N
    const thrustAccel = thrustN / 1000.0; // m/s² (assuming 1000 kg)
    const durationSeconds = durationDays * 86400;

    // Get current velocity direction for thrust direction
    const body = this.bodies.get(this.selectedBodyId);
    if (!body) return;

    // Thrust in velocity direction (prograde/retrograde)
    const thrustDirection = body.velocity;

    try {
      await invoke('apply_ion_beam', {
        bodyId: this.selectedBodyId,
        thrustDirection: thrustDirection,
        thrustMagnitude: thrustAccel,
        duration: durationSeconds
      });
      console.log(`Applied ion beam: ${thrust} μN for ${durationDays} days to ${this.selectedBodyId}`);
      this.updateImpactPrediction();
    } catch (error) {
      console.error('Failed to apply ion beam:', error);
    }
  }

  private async updateImpactPrediction(): Promise<void> {
    if (!this.selectedBodyId) return;

    const body = this.bodies.get(this.selectedBodyId);
    if (!body || body.body_type !== 'Asteroid') return;

    try {
      const prediction = await invoke<{
        min_distance_km: number;
        time_to_closest_days: number;
        is_hazardous: boolean;
      } | null>('get_impact_prediction', { bodyId: this.selectedBodyId });

      const impactInfo = document.getElementById('impact-info')!;

      if (prediction) {
        const hazardousClass = prediction.is_hazardous ? 'hazardous' : '';
        impactInfo.innerHTML = `
          <div class="object-info">
            <div class="info-row">
              <span class="info-label">Min Distance</span>
              <span class="info-value ${hazardousClass}">${prediction.min_distance_km.toExponential(2)} km</span>
            </div>
            <div class="info-row">
              <span class="info-label">Time to Closest</span>
              <span class="info-value">${prediction.time_to_closest_days.toFixed(1)} days</span>
            </div>
            <div class="info-row">
              <span class="info-label">Hazard Level</span>
              <span class="info-value ${hazardousClass}">${prediction.is_hazardous ? '⚠️ POTENTIALLY HAZARDOUS' : '✓ SAFE'}</span>
            </div>
          </div>
        `;
      } else {
        impactInfo.innerHTML = '<div class="info-placeholder"><p>Unable to calculate approach</p></div>';
      }
    } catch (error) {
      console.error('Failed to fetch impact prediction:', error);
    }
  }

  // ===========================================================================
  // INTERACTION
  // ===========================================================================

  private handleClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Check main meshes first
    const objects = [this.sunMesh, this.earthMesh, this.moonMesh];
    const intersects = raycaster.intersectObjects(objects);

    if (intersects.length > 0) {
      const selected = intersects[0].object;
      this.selectBody(selected.userData.id, selected.userData.name);
      return;
    }

    // Check asteroids using proximity to ray
    // Since asteroids are small points, we need a larger tolerance
    raycaster.params.Points = { threshold: 5 };
    const pointIntersects = raycaster.intersectObject(this.asteroidPoints);

    if (pointIntersects.length > 0) {
      // Find the closest asteroid to the intersection point
      const hitPoint = pointIntersects[0].point;
      let closestAsteroid: FrontendBody | null = null;
      let closestDist = Infinity;

      this.bodies.forEach((body) => {
        if (body.body_type === 'Asteroid') {
          const asteroidPos = new THREE.Vector3(
            body.position[0] * SCALE,
            body.position[2] * SCALE,
            body.position[1] * SCALE
          );
          const dist = asteroidPos.distanceTo(hitPoint);
          if (dist < closestDist) {
            closestDist = dist;
            closestAsteroid = body;
          }
        }
      });

      if (closestAsteroid) {
        // Support multi-select mode
        if (this.multiSelectMode) {
          this.toggleAsteroidSelection((closestAsteroid as FrontendBody).id);
        } else {
          this.selectBody((closestAsteroid as FrontendBody).id, (closestAsteroid as FrontendBody).name);
        }
        return;
      }
    }

    // Also try proximity-based selection for any asteroid near the click ray
    const ray = raycaster.ray;
    let closestAsteroid: FrontendBody | null = null;
    let closestDist = 20; // Scene units threshold

    this.bodies.forEach((body) => {
      if (body.body_type === 'Asteroid') {
        const asteroidPos = new THREE.Vector3(
          body.position[0] * SCALE,
          body.position[2] * SCALE,
          body.position[1] * SCALE
        );
        // Distance from point to ray
        const dist = ray.distanceToPoint(asteroidPos);
        if (dist < closestDist) {
          closestDist = dist;
          closestAsteroid = body;
        }
      }
    });

    if (closestAsteroid) {
      this.selectBody((closestAsteroid as FrontendBody).id, (closestAsteroid as FrontendBody).name);
    }
  }

  private selectBody(id: string, name: string): void {
    this.selectedBodyId = id;

    const body = this.bodies.get(id);
    if (!body) return;

    // Update info display
    const infoDisplay = document.getElementById('selected-info')!;
    infoDisplay.innerHTML = `
      <div class="object-info">
        <div class="info-row">
          <span class="info-label">Name</span>
          <span class="info-value">${name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Type</span>
          <span class="info-value">${body.body_type}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Position (AU)</span>
          <span class="info-value">${body.position.map(p => p.toFixed(3)).join(', ')}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Velocity (km/s)</span>
          <span class="info-value">${body.velocity.map(v => v.toFixed(2)).join(', ')}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Radius</span>
          <span class="info-value">${body.radius.toFixed(0)} km</span>
        </div>
      </div>
    `;

    // Show deflection controls for asteroids
    if (body.body_type === 'Asteroid') {
      document.getElementById('deflection-controls')?.classList.remove('hidden');
      document.getElementById('deflection-placeholder')?.classList.add('hidden');

      // Update asteroid info panel
      this.updateAsteroidInfo(body);

      // Update orbit path and distance line visualization
      this.updateSelectedAsteroidVisualization(body);

      // Show toast notification
      this.showToast('Asteroid Selected', body.name, body.is_hazardous ? 'warning' : 'success');
    } else {
      document.getElementById('deflection-controls')?.classList.add('hidden');
      document.getElementById('deflection-placeholder')?.classList.remove('hidden');

      // Hide asteroid-specific panels
      document.getElementById('asteroid-details')?.classList.add('hidden');
      document.getElementById('asteroid-info')?.classList.remove('hidden');
      document.getElementById('torino-display')?.classList.add('hidden');
      document.getElementById('moid-display')?.classList.add('hidden');

      // Remove asteroid visualization
      if (this.selectedOrbitPath) {
        this.scene.remove(this.selectedOrbitPath);
        this.selectedOrbitPath.geometry.dispose();
        (this.selectedOrbitPath.material as THREE.Material).dispose();
        this.selectedOrbitPath = null;
      }
      if (this.distanceToEarthLine) {
        this.scene.remove(this.distanceToEarthLine);
        this.distanceToEarthLine.geometry.dispose();
        (this.distanceToEarthLine.material as THREE.Material).dispose();
        this.distanceToEarthLine = null;
      }
    }
  }

  private updateOrbitVisibility(): void {
    this.orbitLines.forEach((line) => {
      line.visible = this.showOrbits;
    });
  }

  // ===========================================================================
  // ANIMATION LOOP
  // ===========================================================================

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    // Update controls
    this.controls.update();

    // Update starfield shader time for twinkling
    if (this.starfieldMaterial) {
      this.starfieldMaterial.uniforms.uTime.value = performance.now() * 0.001;
    }

    // Render with post-processing
    if (this.postProcessingEnabled && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    // FPS counter
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
      document.getElementById('fps-counter')!.textContent = this.fps.toString();
    }

    // Update camera info
    const distance = this.camera.position.length() / SCALE;
    document.getElementById('camera-info')!.textContent =
      `Heliocentric | Zoom: ${distance.toFixed(2)} AU`;
  };

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update post-processing resolution
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (this.fxaaPass) {
      this.fxaaPass.material.uniforms['resolution'].value.set(
        1 / window.innerWidth,
        1 / window.innerHeight
      );
    }
  }

  // ===========================================================================
  // NEW UI HANDLERS
  // ===========================================================================

  private toggleMobileNav(): void {
    const hamburger = document.getElementById('hamburger-btn');
    const mobileNav = document.getElementById('mobile-nav');

    hamburger?.classList.toggle('active');
    mobileNav?.classList.toggle('hidden');
    mobileNav?.classList.toggle('active');
  }

  private toggleShortcutsModal(show: boolean): void {
    const modal = document.getElementById('shortcuts-modal');
    if (show) {
      modal?.classList.remove('hidden');
    } else {
      modal?.classList.add('hidden');
    }
  }

  private setCameraPreset(preset: 'sun' | 'earth' | 'top'): void {
    const TRANSITION_DURATION = 1000;
    const startPos = this.camera.position.clone();
    const startTime = performance.now();

    let targetPos: THREE.Vector3;
    let targetLookAt: THREE.Vector3;

    switch (preset) {
      case 'sun':
        targetPos = new THREE.Vector3(0, 50, 150);
        targetLookAt = new THREE.Vector3(0, 0, 0);
        break;
      case 'earth':
        const earth = this.bodies.get('earth');
        if (earth) {
          const [x, y, z] = earth.position;
          targetPos = new THREE.Vector3(x * SCALE + 30, y * SCALE + 20, z * SCALE + 30);
          targetLookAt = new THREE.Vector3(x * SCALE, y * SCALE, z * SCALE);
        } else {
          targetPos = new THREE.Vector3(100, 50, 100);
          targetLookAt = new THREE.Vector3(100, 0, 0);
        }
        break;
      case 'top':
        targetPos = new THREE.Vector3(0, 500, 0);
        targetLookAt = new THREE.Vector3(0, 0, 0);
        break;
    }

    const animateCamera = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / TRANSITION_DURATION, 1);
      const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      this.camera.position.lerpVectors(startPos, targetPos, easeT);
      this.controls.target.lerp(targetLookAt, easeT * 0.1);
      this.controls.update();

      if (t < 1) {
        requestAnimationFrame(animateCamera);
      }
    };

    animateCamera();
    this.showToast('Camera', `Switched to ${preset.charAt(0).toUpperCase() + preset.slice(1)} view`, 'success');
  }

  private searchAsteroids(): void {
    const searchInput = document.getElementById('asteroid-search') as HTMLInputElement;
    const query = searchInput?.value.toLowerCase().trim();

    if (!query) {
      this.showToast('Search', 'Please enter a search term', 'warning');
      return;
    }

    // Search through bodies
    let found = false;
    this.bodies.forEach((body, id) => {
      if (body.name.toLowerCase().includes(query) || id.toLowerCase().includes(query)) {
        this.selectBody(id, body.name);

        // Focus camera on found object
        const [x, y, z] = body.position;
        this.camera.position.set(x * SCALE + 50, y * SCALE + 30, z * SCALE + 50);
        this.controls.target.set(x * SCALE, y * SCALE, z * SCALE);
        this.controls.update();

        this.showToast('Search', `Found: ${body.name}`, 'success');
        found = true;
      }
    });

    if (!found) {
      this.showToast('Search', `No results for "${query}"`, 'warning');
    }
  }

  private handleKeyboardShortcut(e: KeyboardEvent): void {
    // Ignore if typing in an input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    switch (e.key.toLowerCase()) {
      case ' ':
        e.preventDefault();
        this.togglePause();
        break;
      case 'r':
        this.resetSimulation();
        break;
      case '+':
      case '=':
        const timeScaleUp = document.getElementById('time-scale') as HTMLInputElement;
        if (timeScaleUp) {
          timeScaleUp.value = String(Math.min(parseInt(timeScaleUp.value) + 1, 6));
          timeScaleUp.dispatchEvent(new Event('input'));
        }
        break;
      case '-':
        const timeScaleDown = document.getElementById('time-scale') as HTMLInputElement;
        if (timeScaleDown) {
          timeScaleDown.value = String(Math.max(parseInt(timeScaleDown.value) - 1, 1));
          timeScaleDown.dispatchEvent(new Event('input'));
        }
        break;
      case '1':
        this.setCameraPreset('sun');
        break;
      case '2':
        this.setCameraPreset('earth');
        break;
      case '3':
        this.setCameraPreset('top');
        break;
      case '?':
        this.toggleShortcutsModal(true);
        break;
      case 'escape':
        this.toggleShortcutsModal(false);
        break;
      case 'o':
        const orbitsCheckbox = document.getElementById('show-orbits') as HTMLInputElement;
        if (orbitsCheckbox) {
          orbitsCheckbox.checked = !orbitsCheckbox.checked;
          orbitsCheckbox.dispatchEvent(new Event('change'));
          this.showToast('Orbits', orbitsCheckbox.checked ? 'Visible' : 'Hidden', 'success');
        }
        break;
      case 'g':
        const gridCheckbox = document.getElementById('show-grid') as HTMLInputElement;
        if (gridCheckbox) {
          gridCheckbox.checked = !gridCheckbox.checked;
          gridCheckbox.dispatchEvent(new Event('change'));
          this.showToast('Grid', gridCheckbox.checked ? 'Visible' : 'Hidden', 'success');
        }
        break;
      case 'f':
        this.zoomToFit();
        break;
      case 't':
        this.toggleTheme();
        break;
      case 'd':
        this.showRandomFact();
        break;
    }
  }

  private showToast(title: string, message: string, type: 'success' | 'warning' | 'error' | 'info' = 'success'): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    // Auto-remove after animation
    setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  private exportData(): void {
    if (this.bodies.size === 0) {
      this.showToast('Export', 'No data to export', 'warning');
      return;
    }

    // Prepare data for export
    const exportData: Array<{
      id: string;
      name: string;
      type: string;
      position_x: number;
      position_y: number;
      position_z: number;
      velocity_x: number;
      velocity_y: number;
      velocity_z: number;
      radius_km: number;
      is_hazardous: boolean;
    }> = [];

    this.bodies.forEach((body, id) => {
      exportData.push({
        id,
        name: body.name,
        type: body.body_type,
        position_x: body.position[0],
        position_y: body.position[1],
        position_z: body.position[2],
        velocity_x: body.velocity[0],
        velocity_y: body.velocity[1],
        velocity_z: body.velocity[2],
        radius_km: body.radius / 1000,
        is_hazardous: body.is_hazardous
      });
    });

    // Create CSV
    const headers = Object.keys(exportData[0]).join(',');
    const rows = exportData.map(row => Object.values(row).join(','));
    const csv = [headers, ...rows].join('\n');

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbital_sentinel_data_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.showToast('Export', `Exported ${exportData.length} objects to CSV`, 'success');
  }

  private captureScreenshot(): void {
    // Render scene first
    this.renderer.render(this.scene, this.camera);

    // Get canvas data
    const canvas = this.renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');

    // Create download link
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `orbital_sentinel_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();

    this.showToast('Screenshot', 'Image captured and downloaded', 'success');
  }

  private showHistoricalImpactInfo(event: string | null): void {
    const impactData: Record<string, { name: string; date: string; size: string; energy: string; location: string; description: string }> = {
      chelyabinsk: {
        name: 'Chelyabinsk Event',
        date: 'February 15, 2013',
        size: '~20 meters',
        energy: '~500 kilotons TNT',
        location: 'Chelyabinsk Oblast, Russia',
        description: 'Superbolide that exploded at ~30km altitude. Over 1,500 people injured by flying glass from shattered windows.'
      },
      tunguska: {
        name: 'Tunguska Event',
        date: 'June 30, 1908',
        size: '~60-80 meters',
        energy: '10-15 megatons TNT',
        location: 'Siberia, Russia',
        description: 'Largest impact event in recorded history. Flattened 2,000 km² of forest. No crater found - likely airburst.'
      },
      chicxulub: {
        name: 'Chicxulub Impact',
        date: '~66 million years ago',
        size: '~10 kilometers',
        energy: '~100 million megatons',
        location: 'Yucatán Peninsula, Mexico',
        description: 'Caused the Cretaceous-Paleogene extinction event. Wiped out 75% of species including non-avian dinosaurs.'
      }
    };

    const data = event ? impactData[event] : null;
    if (!data) return;

    this.showToast(data.name, `${data.date} • ${data.energy}`, 'warning');
  }

  private updateTorinoScale(
    probability: number,
    energy: number,
    distanceAU: number,
    radiusKm: number
  ): void {
    // Enhanced Torino scale calculation
    // Based on impact probability, kinetic energy, proximity, and size
    let level = 0;

    // Distance-based assessment (closer = higher level)
    const isClose = distanceAU < 0.05; // < 0.05 AU is concerning
    const isVeryClose = distanceAU < 0.01; // < 0.01 AU is very concerning

    // Size-based assessment
    const isLarge = radiusKm > 0.05; // > 50m can cause local damage
    const isVeryLarge = radiusKm > 0.5; // > 500m can cause regional damage
    const isMassive = radiusKm > 1.0; // > 1km can cause global effects

    // Base level from probability
    if (probability < 1e-6 && !isVeryClose) {
      level = 0; // No hazard
    } else if (probability < 1e-4 && !isClose) {
      level = 1; // Normal
    } else if (isVeryClose && isMassive) {
      // Very close + massive = high threat
      level = Math.min(10, 7 + Math.floor(probability * 6));
    } else if (isVeryClose && isVeryLarge) {
      level = Math.min(8, 5 + Math.floor(probability * 6));
    } else if (isClose && isLarge) {
      level = Math.min(6, 3 + Math.floor(Math.log10(energy + 1) / 4));
    } else if (probability < 1e-2) {
      level = Math.min(4, Math.floor(2 + Math.log10(energy + 1) / 5));
    } else if (probability < 0.5) {
      level = Math.min(7, Math.floor(4 + Math.log10(energy + 1) / 5));
    } else {
      level = Math.min(10, Math.floor(7 + probability * 6));
    }

    // Ensure level is valid
    level = Math.max(0, Math.min(10, Math.floor(level)));

    const torinoDescriptions: Record<number, string> = {
      0: 'No hazard - Likelihood of collision is zero',
      1: 'Normal - A routine discovery with no unusual concern',
      2: 'Meriting attention - A somewhat close but not unusual encounter',
      3: 'Meriting attention - Close encounter deserving attention',
      4: 'Meriting attention - Close encounter with 1%+ chance of collision',
      5: 'Threatening - Close encounter posing a serious threat',
      6: 'Threatening - Close encounter with large object, significant threat',
      7: 'Threatening - Extremely close encounter with large object',
      8: 'Certain collision - Localized destruction expected',
      9: 'Certain collision - Regional devastation expected',
      10: 'Certain collision - Global climatic catastrophe'
    };

    const torinoDisplay = document.getElementById('torino-display');
    const torinoValue = document.getElementById('torino-value');
    const torinoDescription = document.getElementById('torino-description');

    if (torinoDisplay && torinoValue && torinoDescription) {
      torinoDisplay.classList.remove('hidden');
      torinoValue.textContent = String(level);
      torinoDescription.textContent = torinoDescriptions[level] || 'Unknown';

      // Highlight active segment
      document.querySelectorAll('.torino-segment').forEach(seg => seg.classList.remove('active'));
      if (level === 0) {
        document.querySelector('.torino-segment.white')?.classList.add('active');
      } else if (level === 1) {
        document.querySelector('.torino-segment.green')?.classList.add('active');
      } else if (level <= 4) {
        document.querySelector('.torino-segment.yellow')?.classList.add('active');
      } else if (level <= 7) {
        document.querySelector('.torino-segment.orange')?.classList.add('active');
      } else {
        document.querySelector('.torino-segment.red')?.classList.add('active');
      }
    }
  }

  private calculateMOID(
    asteroidPos: [number, number, number],
    asteroidVel: [number, number, number],
    currentDistanceToEarth: number
  ): number {
    // Use actual current distance as primary MOID estimate
    // The current distance is a good approximation for MOID for NEOs

    // Calculate orbital velocity magnitude for better estimate
    const v = Math.sqrt(asteroidVel[0] ** 2 + asteroidVel[1] ** 2 + asteroidVel[2] ** 2);
    const r = Math.sqrt(asteroidPos[0] ** 2 + asteroidPos[1] ** 2 + asteroidPos[2] ** 2);

    // For near-Earth objects, MOID is approximately the minimum of:
    // 1. Current distance
    // 2. Estimated perihelion/aphelion intersection
    const velocityFactor = v / 0.017; // Typical NEO velocity ~0.017 AU/day

    // Adjust MOID estimate based on orbital geometry
    let moidEstimate = currentDistanceToEarth;

    // If the asteroid is moving towards Earth (closing), MOID could be smaller
    if (r < 1.5 && velocityFactor > 0.8) {
      moidEstimate *= 0.7; // Could get closer
    }

    return Math.max(0.0001, moidEstimate);
  }

  private updateAsteroidInfo(body: FrontendBody): void {
    const asteroidDetails = document.getElementById('asteroid-details');
    const asteroidInfo = document.getElementById('asteroid-info');
    const spectralType = document.getElementById('spectral-type');
    const estMass = document.getElementById('est-mass');
    const estDensity = document.getElementById('est-density');
    const wikiLink = document.getElementById('wiki-link') as HTMLAnchorElement;
    const moidAu = document.getElementById('moid-value');
    const moidLd = document.getElementById('moid-ld-value');
    const moidDisplay = document.getElementById('moid-display');

    if (asteroidDetails && asteroidInfo && spectralType && estMass && estDensity && wikiLink) {
      asteroidInfo.classList.add('hidden');
      asteroidDetails.classList.remove('hidden');

      // Determine spectral type with more variety (using hash of full name)
      const types = ['C-type (carbonaceous)', 'S-type (siliceous)', 'M-type (metallic)', 'X-type (unknown)', 'V-type (basaltic)'];
      const nameHash = body.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const typeIndex = nameHash % types.length;
      spectralType.textContent = types[typeIndex];

      // Estimate mass based on actual radius
      const radiusKm = body.radius / 1000;
      const densities = [1300, 2700, 5300, 2000, 3200]; // kg/m³ for different types
      const density = densities[typeIndex % densities.length];
      const volume = (4 / 3) * Math.PI * Math.pow(radiusKm * 1000, 3); // m³
      const mass = volume * density;

      estMass.textContent = mass > 1e12 ? `${(mass / 1e12).toExponential(2)} × 10¹² kg` : `${mass.toExponential(2)} kg`;
      estDensity.textContent = `${density} kg/m³`;

      // Wikipedia link (for named asteroids)
      const cleanName = body.name.replace(/\s*\(.*\)/, '').trim();
      if (cleanName && !cleanName.match(/^\d+$/)) {
        wikiLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanName)}_(asteroid)`;
        wikiLink.classList.remove('hidden');
      } else {
        wikiLink.classList.add('hidden');
      }
    }

    // Calculate and display actual distance-based MOID
    if (moidAu && moidLd && moidDisplay) {
      // Get Earth's current position
      const earth = this.bodies.get('earth');
      let distanceToEarth = 1.0; // AU default

      if (earth) {
        // Calculate actual current distance to Earth
        const dx = body.position[0] - earth.position[0];
        const dy = body.position[1] - earth.position[1];
        const dz = body.position[2] - earth.position[2];
        distanceToEarth = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      // Use position to calculate approximate MOID (simplified)
      const moid = this.calculateMOID(body.position, body.velocity, distanceToEarth);
      moidDisplay.classList.remove('hidden');
      moidAu.textContent = moid.toFixed(6);
      moidLd.textContent = (moid * 389.17).toFixed(2); // AU to Lunar Distance

      // Calculate actual kinetic energy (0.5 * m * v²)
      const radiusM = body.radius * 1000; // m
      const velocityMagnitude = Math.sqrt(
        body.velocity[0] ** 2 + body.velocity[1] ** 2 + body.velocity[2] ** 2
      );
      // Convert AU/day to m/s
      const vMetersPerSecond = velocityMagnitude * 1.496e11 / 86400;

      // Estimate mass (assuming average density 2000 kg/m³)
      const volumeM3 = (4 / 3) * Math.PI * radiusM ** 3;
      const massKg = volumeM3 * 2000;

      // Kinetic energy in Joules
      const kineticEnergy = 0.5 * massKg * vMetersPerSecond ** 2;

      // Calculate probability based on distance and time
      // Closer = higher probability (simplified model)
      const proximityFactor = Math.max(0, 1 - distanceToEarth / 0.1); // 0.1 AU = high risk zone
      const sizeFactor = Math.min(1, body.radius / 100); // Larger = more concerning
      const hazardFactor = body.is_hazardous ? 10 : 1;

      // Probability estimate: closer + larger + hazardous = higher
      const probability = Math.min(0.5, proximityFactor * sizeFactor * hazardFactor * 0.01);

      // Update Torino scale with actual calculated values
      this.updateTorinoScale(probability, kineticEnergy, distanceToEarth, body.radius);
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Find nearest asteroid for tooltip
    const ray = raycaster.ray;
    let closestAsteroid: FrontendBody | null = null;
    let closestDist = 15; // Scene units threshold

    this.bodies.forEach((body) => {
      if (body.body_type === 'Asteroid') {
        const asteroidPos = new THREE.Vector3(
          body.position[0] * SCALE,
          body.position[2] * SCALE,
          body.position[1] * SCALE
        );
        const dist = ray.distanceToPoint(asteroidPos);
        if (dist < closestDist) {
          closestDist = dist;
          closestAsteroid = body;
        }
      }
    });

    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
      if (closestAsteroid) {
        const ast = closestAsteroid as FrontendBody;
        tooltip.innerHTML = `
          <div><strong>${ast.name}</strong></div>
          <div>Type: ${ast.body_type}</div>
          <div>Radius: ${ast.radius.toFixed(2)} km</div>
          <div>${ast.is_hazardous ? '⚠️ HAZARDOUS' : '✓ Safe'}</div>
        `;
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.classList.remove('hidden');
      } else {
        tooltip.classList.add('hidden');
      }
    }
  }

  private updateSelectedAsteroidVisualization(body: FrontendBody): void {
    const earth = this.bodies.get('earth');
    if (!earth) return;

    // Remove old visualization lines
    if (this.selectedOrbitPath) {
      this.scene.remove(this.selectedOrbitPath);
      this.selectedOrbitPath.geometry.dispose();
      (this.selectedOrbitPath.material as THREE.Material).dispose();
      this.selectedOrbitPath = null;
    }
    if (this.distanceToEarthLine) {
      this.scene.remove(this.distanceToEarthLine);
      this.distanceToEarthLine.geometry.dispose();
      (this.distanceToEarthLine.material as THREE.Material).dispose();
      this.distanceToEarthLine = null;
    }

    // Create distance line to Earth
    const asteroidPos = new THREE.Vector3(
      body.position[0] * SCALE,
      body.position[2] * SCALE,
      body.position[1] * SCALE
    );
    const earthPos = new THREE.Vector3(
      earth.position[0] * SCALE,
      earth.position[2] * SCALE,
      earth.position[1] * SCALE
    );

    const distanceLineGeometry = new THREE.BufferGeometry().setFromPoints([asteroidPos, earthPos]);
    const distanceLineMaterial = new THREE.LineDashedMaterial({
      color: body.is_hazardous ? 0xff4757 : 0x00d4ff,
      dashSize: 2,
      gapSize: 1,
      transparent: true,
      opacity: 0.6
    });

    this.distanceToEarthLine = new THREE.Line(distanceLineGeometry, distanceLineMaterial);
    this.distanceToEarthLine.computeLineDistances();
    this.scene.add(this.distanceToEarthLine);

    // Calculate approximate orbit path based on current position and velocity
    const orbitPoints: THREE.Vector3[] = [];
    const numPoints = 100;

    // Simple circular approximation around the Sun
    const r = Math.sqrt(body.position[0] ** 2 + body.position[1] ** 2 + body.position[2] ** 2);
    for (let i = 0; i <= numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const x = Math.cos(angle) * r * SCALE;
      const z = Math.sin(angle) * r * SCALE;
      orbitPoints.push(new THREE.Vector3(x, 0, z));
    }

    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: body.is_hazardous ? 0xff4757 : 0xffa500,
      transparent: true,
      opacity: 0.5
    });

    this.selectedOrbitPath = new THREE.Line(orbitGeometry, orbitMaterial);
    this.scene.add(this.selectedOrbitPath);
  }

  private updateAsteroidList(): void {
    const listContainer = document.getElementById('asteroid-list');
    const sortSelect = document.getElementById('asteroid-sort') as HTMLSelectElement;
    if (!listContainer) return;

    // Get Earth for distance calculations
    const earth = this.bodies.get('earth');
    if (!earth) return;

    // Collect asteroids with distances
    const asteroidData: { body: FrontendBody; distance: number }[] = [];
    this.bodies.forEach((body) => {
      if (body.body_type === 'Asteroid') {
        const dx = body.position[0] - earth.position[0];
        const dy = body.position[1] - earth.position[1];
        const dz = body.position[2] - earth.position[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        asteroidData.push({ body, distance });
      }
    });

    // Sort based on selection
    const sortBy = sortSelect?.value || 'distance';
    asteroidData.sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.body.name.localeCompare(b.body.name);
        case 'size': return b.body.radius - a.body.radius;
        case 'hazard': return (b.body.is_hazardous ? 1 : 0) - (a.body.is_hazardous ? 1 : 0);
        default: return a.distance - b.distance;
      }
    });

    // Limit to top 20 for performance
    const topAsteroids = asteroidData.slice(0, 20);

    // Generate list HTML
    if (topAsteroids.length === 0) {
      listContainer.innerHTML = `
        <div class="info-placeholder">
          <span class="placeholder-icon">📊</span>
          <p>No asteroids loaded</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = topAsteroids.map((item) => `
      <div class="asteroid-list-item ${item.body.is_hazardous ? 'hazardous' : ''} ${item.body.id === this.selectedBodyId ? 'selected' : ''}" 
           data-id="${item.body.id}" 
           data-name="${item.body.name}">
        <span class="asteroid-name" title="${item.body.name}">${item.body.name}</span>
        <span class="asteroid-distance">${item.distance.toFixed(3)} AU</span>
        ${item.body.is_hazardous ? '<span class="asteroid-hazard-badge">⚠️</span>' : ''}
      </div>
    `).join('');

    // Add click handlers
    listContainer.querySelectorAll('.asteroid-list-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const name = item.getAttribute('data-name');
        if (id && name) {
          this.selectBody(id, name);
        }
      });
    });
  }

  private checkCloseApproaches(): void {
    const earth = this.bodies.get('earth');
    if (!earth) return;

    let closestAsteroid: FrontendBody | null = null;
    let closestDistance = Infinity;

    this.bodies.forEach((body) => {
      if (body.body_type === 'Asteroid') {
        const dx = body.position[0] - earth.position[0];
        const dy = body.position[1] - earth.position[1];
        const dz = body.position[2] - earth.position[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestAsteroid = body;
        }
      }
    });

    // Show warning if asteroid is within 0.01 AU (about 4 lunar distances)
    const warningThreshold = 0.01;
    const existingWarning = document.querySelector('.collision-warning');

    if (closestAsteroid && closestDistance < warningThreshold) {
      const ast = closestAsteroid as FrontendBody;
      if (!existingWarning) {
        const warning = document.createElement('div');
        warning.className = 'collision-warning';
        warning.innerHTML = `
          <div class="collision-warning-title">⚠️ CLOSE APPROACH DETECTED</div>
          <div class="collision-warning-body">${ast.name} at ${(closestDistance * 149597870.7).toFixed(0)} km</div>
        `;
        document.body.appendChild(warning);
      } else {
        (existingWarning.querySelector('.collision-warning-body') as HTMLElement).textContent =
          `${ast.name} at ${(closestDistance * 149597870.7).toFixed(0)} km`;
      }
    } else if (existingWarning) {
      existingWarning.remove();
    }
  }

  // Tutorial handling
  private tutorialStep = 1;
  private readonly TUTORIAL_STEPS = 5;

  private showTutorial(): void {
    // Check localStorage for "don't show again"
    if (localStorage.getItem('orbital-sentinel-skip-tutorial') === 'true') {
      // Don't show automatically, but user explicitly clicked
    }

    this.tutorialStep = 1;
    this.updateTutorialUI();
    document.getElementById('tutorial-modal')?.classList.remove('hidden');

    // Create dots
    const dotsContainer = document.getElementById('tutorial-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      for (let i = 1; i <= this.TUTORIAL_STEPS; i++) {
        const dot = document.createElement('div');
        dot.className = `tutorial-dot ${i === 1 ? 'active' : ''}`;
        dot.dataset.step = String(i);
        dot.addEventListener('click', () => {
          this.tutorialStep = i;
          this.updateTutorialUI();
        });
        dotsContainer.appendChild(dot);
      }
    }
  }

  private hideTutorial(): void {
    document.getElementById('tutorial-modal')?.classList.add('hidden');

    // Save "don't show again" preference
    const checkbox = document.getElementById('dont-show-again') as HTMLInputElement;
    if (checkbox?.checked) {
      localStorage.setItem('orbital-sentinel-skip-tutorial', 'true');
    }
  }

  private tutorialPrev(): void {
    if (this.tutorialStep > 1) {
      this.tutorialStep--;
      this.updateTutorialUI();
    }
  }

  private tutorialNext(): void {
    if (this.tutorialStep < this.TUTORIAL_STEPS) {
      this.tutorialStep++;
      this.updateTutorialUI();
    } else {
      this.hideTutorial();
    }
  }

  private updateTutorialUI(): void {
    // Update slides
    document.querySelectorAll('.tutorial-slide').forEach((slide) => {
      slide.classList.remove('active');
      if ((slide as HTMLElement).dataset.step === String(this.tutorialStep)) {
        slide.classList.add('active');
      }
    });

    // Update dots
    document.querySelectorAll('.tutorial-dot').forEach((dot) => {
      dot.classList.remove('active');
      if ((dot as HTMLElement).dataset.step === String(this.tutorialStep)) {
        dot.classList.add('active');
      }
    });

    // Update buttons
    const prevBtn = document.getElementById('tutorial-prev') as HTMLButtonElement;
    const nextBtn = document.getElementById('tutorial-next') as HTMLButtonElement;

    if (prevBtn) prevBtn.disabled = this.tutorialStep === 1;
    if (nextBtn) {
      nextBtn.textContent = this.tutorialStep === this.TUTORIAL_STEPS ? 'Finish ✓' : 'Next →';
    }
  }

  // Glossary handling
  private showGlossary(): void {
    document.getElementById('glossary-modal')?.classList.remove('hidden');
  }

  private hideGlossary(): void {
    document.getElementById('glossary-modal')?.classList.add('hidden');
  }

  // Scenario save/load
  private savedScenarios: Map<string, { bodies: FrontendBody[]; timestamp: number }> = new Map();

  private saveScenario(): void {
    const name = prompt('Enter scenario name:', `Scenario ${new Date().toLocaleTimeString()}`);
    if (!name) return;

    const bodies = Array.from(this.bodies.values());
    this.savedScenarios.set(name, {
      bodies: JSON.parse(JSON.stringify(bodies)),
      timestamp: Date.now()
    });

    // Update dropdown
    this.updateScenarioList();
    this.showToast('Scenario Saved', `"${name}" saved successfully`, 'success');
  }

  private loadScenario(): void {
    const select = document.getElementById('scenario-list') as HTMLSelectElement;
    const scenarioName = select?.value;

    if (!scenarioName) {
      this.showToast('Load Scenario', 'Please select a scenario to load', 'warning');
      return;
    }

    const scenario = this.savedScenarios.get(scenarioName);
    if (scenario) {
      // Restore bodies
      this.bodies.clear();
      scenario.bodies.forEach((body) => {
        this.bodies.set(body.id, body);
      });

      this.showToast('Scenario Loaded', `"${scenarioName}" restored`, 'success');
    }
  }

  private updateScenarioList(): void {
    const select = document.getElementById('scenario-list') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = '<option value="">-- Saved Scenarios --</option>';
    this.savedScenarios.forEach((data, name) => {
      const option = document.createElement('option');
      option.value = name;
      const time = new Date(data.timestamp).toLocaleTimeString();
      option.textContent = `${name} (${time})`;
      select.appendChild(option);
    });
  }

  // =========================================================================
  // TRAJECTORY PREVIEW
  // =========================================================================

  private updateTrajectoryPreview(deltaV: [number, number, number]): void {
    if (!this.selectedBodyId) return;
    const body = this.bodies.get(this.selectedBodyId);
    if (!body || body.body_type !== 'Asteroid') return;

    // Calculate predicted trajectory after deflection
    const positions: THREE.Vector3[] = [];

    // Current position and velocity
    let x = body.position[0];
    let y = body.position[1];
    let z = body.position[2];
    let vx = body.velocity[0] + deltaV[0] * 0.00001; // Scale for visualization
    let vy = body.velocity[1] + deltaV[1] * 0.00001;
    let vz = body.velocity[2] + deltaV[2] * 0.00001;

    // Simple orbit projection (200 points over ~100 days)
    const dt = 1; // 1 day steps
    const GM_SUN = 0.0002959; // AU^3/day^2

    for (let i = 0; i < 200; i++) {
      // Store position
      positions.push(new THREE.Vector3(
        x * SCALE,
        z * SCALE, // Y-up in Three.js
        y * SCALE
      ));

      // Calculate gravitational acceleration (simplified 2-body)
      const r = Math.sqrt(x * x + y * y + z * z);
      const r3 = r * r * r;
      const ax = -GM_SUN * x / r3;
      const ay = -GM_SUN * y / r3;
      const az = -GM_SUN * z / r3;

      // Update velocity
      vx += ax * dt;
      vy += ay * dt;
      vz += az * dt;

      // Update position
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
    }

    // Update trajectory line geometry
    const positionArray = new Float32Array(positions.length * 3);
    positions.forEach((pos, i) => {
      positionArray[i * 3] = pos.x;
      positionArray[i * 3 + 1] = pos.y;
      positionArray[i * 3 + 2] = pos.z;
    });

    this.trajectoryPreview.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positionArray, 3)
    );
    this.trajectoryPreview.geometry.attributes.position.needsUpdate = true;
    this.trajectoryPreview.visible = true;
  }

  // =========================================================================
  // ZOOM TO FIT
  // =========================================================================

  private zoomToFit(): void {
    // Calculate bounding box of all asteroids
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    this.bodies.forEach((body) => {
      if (body.body_type === 'Asteroid') {
        const x = body.position[0] * SCALE;
        const y = body.position[2] * SCALE;
        const z = body.position[1] * SCALE;

        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    });

    if (minX === Infinity) {
      // No asteroids, zoom to inner solar system
      this.setCameraPreset('top');
      return;
    }

    // Calculate center and size
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    // Position camera to see all
    this.camera.position.set(centerX, size * 1.5, centerZ + size);
    this.controls.target.set(centerX, centerY, centerZ);
    this.controls.update();

    this.showToast('View', 'Zoomed to fit all asteroids', 'success');
  }

  // =========================================================================
  // THEME TOGGLE
  // =========================================================================

  private isDarkTheme = true;

  private toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;

    const root = document.documentElement;

    if (this.isDarkTheme) {
      root.style.setProperty('--color-bg-dark', '#0a0e14');
      root.style.setProperty('--color-bg-medium', '#0d1117');
      root.style.setProperty('--color-bg-panel', 'rgba(13, 17, 23, 0.92)');
      root.style.setProperty('--color-text-primary', '#e6edf3');
      root.style.setProperty('--color-text-secondary', '#8b949e');
      this.scene.background = new THREE.Color(0x0a0e14);
    } else {
      root.style.setProperty('--color-bg-dark', '#f0f4f8');
      root.style.setProperty('--color-bg-medium', '#e8ecef');
      root.style.setProperty('--color-bg-panel', 'rgba(245, 248, 250, 0.95)');
      root.style.setProperty('--color-text-primary', '#1a1a2e');
      root.style.setProperty('--color-text-secondary', '#4a4a6a');
      this.scene.background = new THREE.Color(0x1a1a2e);
    }

    // Save preference
    localStorage.setItem('orbital-sentinel-theme', this.isDarkTheme ? 'dark' : 'light');
    this.showToast('Theme', this.isDarkTheme ? 'Dark mode' : 'Light mode', 'success');
  }

  // =========================================================================
  // DID YOU KNOW FACTS
  // =========================================================================

  private readonly asteroidFacts = [
    "💫 The asteroid belt contains millions of objects, but their total mass is less than 4% of the Moon's mass.",
    "🌍 Earth is hit by about 100 tons of cosmic debris every day - mostly tiny dust particles.",
    "☄️ The Chicxulub impactor that killed the dinosaurs was about 10-15 km in diameter.",
    "🛡️ NASA's DART mission successfully changed an asteroid's orbit in 2022 - humanity's first planetary defense test.",
    "🔭 Over 32,000 near-Earth asteroids have been discovered as of 2024.",
    "⚡ Asteroids are remnants from the early solar system, over 4.6 billion years old.",
    "💎 Asteroid 16 Psyche may contain $10 quintillion worth of iron, nickel, and other metals.",
    "🌙 The largest asteroid, Ceres, is so big it's classified as a dwarf planet.",
    "🚀 Apophis will pass closer than some satellites on April 13, 2029.",
    "🔥 The Tunguska event in 1908 flattened 2,000 km² of Siberian forest."
  ];

  private showRandomFact(): void {
    const fact = this.asteroidFacts[Math.floor(Math.random() * this.asteroidFacts.length)];
    this.showToast('Did You Know?', fact, 'info');
  }

  // =========================================================================
  // SETTINGS PERSISTENCE
  // =========================================================================

  private loadSettings(): void {
    // Load theme
    const savedTheme = localStorage.getItem('orbital-sentinel-theme');
    if (savedTheme === 'light') {
      this.isDarkTheme = false;
      this.toggleTheme(); // Apply light theme
      this.isDarkTheme = false; // toggleTheme flips it
    }

    // Load other settings
    const showOrbits = localStorage.getItem('orbital-sentinel-show-orbits');
    if (showOrbits !== null) {
      this.showOrbits = showOrbits === 'true';
      (document.getElementById('show-orbits') as HTMLInputElement).checked = this.showOrbits;
    }

    const postProcessing = localStorage.getItem('orbital-sentinel-post-processing');
    if (postProcessing !== null) {
      this.postProcessingEnabled = postProcessing === 'true';
      (document.getElementById('post-processing') as HTMLInputElement).checked = this.postProcessingEnabled;
    }
  }

  private saveSettings(): void {
    localStorage.setItem('orbital-sentinel-show-orbits', String(this.showOrbits));
    localStorage.setItem('orbital-sentinel-post-processing', String(this.postProcessingEnabled));
  }

  // =========================================================================
  // MOBILE TOUCH GESTURES
  // =========================================================================

  private initTouchGestures(): void {
    const canvas = this.renderer.domElement;

    let lastTouchDistance = 0;

    // Pinch to zoom
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        lastTouchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const currentDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );

        const zoomDelta = (lastTouchDistance - currentDistance) * 0.5;
        this.camera.position.multiplyScalar(1 + zoomDelta / 500);
        this.controls.update();

        lastTouchDistance = currentDistance;
      }
    }, { passive: true });

    // Swipe to change camera preset
    let touchStartX = 0;
    let touchStartY = 0;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Swipe detection (horizontal swipe > 100px)
        if (Math.abs(dx) > 100 && Math.abs(dy) < 50) {
          if (dx > 0) {
            // Swipe right - next camera preset
            this.cycleCamera(1);
          } else {
            // Swipe left - previous camera preset
            this.cycleCamera(-1);
          }
        }
      }
    }, { passive: true });
  }

  private currentCameraIndex = 0;
  private readonly cameraPresets = ['sun', 'earth', 'top'];

  private cycleCamera(direction: number): void {
    this.currentCameraIndex = (this.currentCameraIndex + direction + 3) % 3;
    this.setCameraPreset(this.cameraPresets[this.currentCameraIndex] as 'sun' | 'earth' | 'top');
    this.showToast('Camera', `${this.cameraPresets[this.currentCameraIndex].toUpperCase()} view`, 'info');
  }

  // =========================================================================
  // PDF REPORT EXPORT
  // =========================================================================

  private async generatePDFReport(): Promise<void> {
    if (!this.selectedBodyId) {
      this.showToast('PDF Export', 'Please select an asteroid first', 'warning');
      return;
    }

    const body = this.bodies.get(this.selectedBodyId);
    if (!body || body.body_type !== 'Asteroid') {
      this.showToast('PDF Export', 'Please select an asteroid', 'warning');
      return;
    }

    // Calculate distance to Earth
    const earth = this.bodies.get('earth');
    let distanceToEarth = 0;
    if (earth) {
      const dx = body.position[0] - earth.position[0];
      const dy = body.position[1] - earth.position[1];
      const dz = body.position[2] - earth.position[2];
      distanceToEarth = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // Generate PDF content as a downloadable text report
    const reportContent = `
================================================================================
                        ORBITAL SENTINEL - ASTEROID REPORT
================================================================================

Generated: ${new Date().toLocaleString()}

--------------------------------------------------------------------------------
ASTEROID IDENTIFICATION
--------------------------------------------------------------------------------
Name: ${body.name}
ID: ${body.id}
Classification: ${body.is_hazardous ? 'POTENTIALLY HAZARDOUS ASTEROID (PHA)' : 'Near-Earth Object (NEO)'}

--------------------------------------------------------------------------------
PHYSICAL PROPERTIES
--------------------------------------------------------------------------------
Radius: ${body.radius.toFixed(2)} km
Estimated Mass: ${((body.radius ** 3) * 3000 * 4.18879).toExponential(2)} kg (estimated from radius)

--------------------------------------------------------------------------------
ORBITAL POSITION
--------------------------------------------------------------------------------
Position (AU): [${body.position[0].toFixed(6)}, ${body.position[1].toFixed(6)}, ${body.position[2].toFixed(6)}]
Velocity (AU/day): [${body.velocity[0].toFixed(6)}, ${body.velocity[1].toFixed(6)}, ${body.velocity[2].toFixed(6)}]
Distance to Earth: ${distanceToEarth.toFixed(6)} AU (${(distanceToEarth * 149597870.7).toFixed(0)} km)

--------------------------------------------------------------------------------
HAZARD ASSESSMENT
--------------------------------------------------------------------------------
Hazardous Status: ${body.is_hazardous ? '⚠️ POTENTIALLY HAZARDOUS' : '✓ SAFE'}
MOID: ${(distanceToEarth * 0.1).toFixed(4)} AU (estimated)

--------------------------------------------------------------------------------
NOTES
--------------------------------------------------------------------------------
This report was generated by Orbital Sentinel simulation software.
For official hazard assessment, refer to NASA's CNEOS or ESA's NEO Coordination Centre.

================================================================================
                              END OF REPORT
================================================================================
`;

    // Create and download file
    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asteroid_report_${body.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    this.showToast('PDF Export', `Report for ${body.name} downloaded`, 'success');
  }

  // =========================================================================
  // MULTIPLE SELECTION
  // =========================================================================

  private selectedAsteroids: Set<string> = new Set();
  private multiSelectMode = false;

  private toggleMultiSelectMode(): void {
    this.multiSelectMode = !this.multiSelectMode;
    if (!this.multiSelectMode) {
      this.selectedAsteroids.clear();
    }
    this.showToast('Selection Mode', this.multiSelectMode ? 'Multi-select: ON' : 'Multi-select: OFF', 'info');
  }

  private toggleAsteroidSelection(id: string): void {
    if (this.selectedAsteroids.has(id)) {
      this.selectedAsteroids.delete(id);
    } else {
      this.selectedAsteroids.add(id);
    }
    this.updateSelectionVisualization();
  }

  private updateSelectionVisualization(): void {
    // Update visual indicators for selected asteroids
    this.showToast('Selected', `${this.selectedAsteroids.size} asteroid(s) selected`, 'info');
  }

  // =========================================================================
  // REAL-TIME DATE SYNC
  // =========================================================================

  private realTimeSyncEnabled = false;
  private realTimeSyncInterval: number | null = null;

  private toggleRealTimeSync(): void {
    this.realTimeSyncEnabled = !this.realTimeSyncEnabled;

    if (this.realTimeSyncEnabled) {
      // Sync to current date
      this.syncToRealTime();
      // Update every second
      this.realTimeSyncInterval = window.setInterval(() => this.syncToRealTime(), 1000);
      this.showToast('Real-Time Sync', 'Synced to current date/time', 'success');
    } else {
      if (this.realTimeSyncInterval) {
        clearInterval(this.realTimeSyncInterval);
        this.realTimeSyncInterval = null;
      }
      this.showToast('Real-Time Sync', 'Disabled', 'info');
    }
  }

  private syncToRealTime(): void {
    const now = new Date();
    // Calculate Julian Date
    const jd = Math.floor(now.getTime() / 86400000) + 2440587.5;

    // Update telemetry display
    const julianDateEl = document.getElementById('julian-date');
    if (julianDateEl) {
      julianDateEl.textContent = jd.toFixed(2);
    }
  }

  // =========================================================================
  // ASTEROID TRAILS (Fading)
  // =========================================================================

  private updateAsteroidTrails(): void {
    // Update trail history for each asteroid
    this.bodies.forEach((body, id) => {
      if (body.body_type !== 'Asteroid') return;

      // Get or create history
      let history = this.asteroidTrailHistory.get(id);
      if (!history) {
        history = [];
        this.asteroidTrailHistory.set(id, history);
      }

      // Add current position
      history.push([body.position[0], body.position[1], body.position[2]]);

      // Limit length
      if (history.length > this.TRAIL_MAX_LENGTH) {
        history.shift();
      }

      // Update or create trail line
      let trailLine = this.asteroidTrails.get(id);

      if (history.length > 1) {
        const points: THREE.Vector3[] = history.map(pos =>
          new THREE.Vector3(pos[0] * SCALE, pos[2] * SCALE, pos[1] * SCALE)
        );

        if (!trailLine) {
          // Create new trail line with gradient
          const geometry = new THREE.BufferGeometry().setFromPoints(points);

          // Create colors array for fading effect
          const colors = new Float32Array(points.length * 3);
          for (let i = 0; i < points.length; i++) {
            const alpha = i / points.length; // Fade from 0 to 1
            colors[i * 3] = 1.0 * alpha;     // R
            colors[i * 3 + 1] = 0.5 * alpha; // G
            colors[i * 3 + 2] = 0.0;         // B
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

          const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.6
          });

          trailLine = new THREE.Line(geometry, material);
          this.asteroidTrails.set(id, trailLine);
          this.scene.add(trailLine);
        } else {
          // Update existing trail
          const positions = new Float32Array(points.length * 3);
          const colors = new Float32Array(points.length * 3);

          for (let i = 0; i < points.length; i++) {
            positions[i * 3] = points[i].x;
            positions[i * 3 + 1] = points[i].y;
            positions[i * 3 + 2] = points[i].z;

            const alpha = i / points.length;
            colors[i * 3] = 1.0 * alpha;
            colors[i * 3 + 1] = 0.5 * alpha;
            colors[i * 3 + 2] = 0.0;
          }

          trailLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          trailLine.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          trailLine.geometry.attributes.position.needsUpdate = true;
          trailLine.geometry.attributes.color.needsUpdate = true;
        }
      }
    });
  }

  // =========================================================================
  // COMPARISON TABLE
  // =========================================================================

  private openComparisonTable(): void {
    const modal = document.getElementById('comparison-modal');
    if (!modal) return;

    // Get asteroids to compare (selected + multi-selected)
    const asteroidsToCompare: FrontendBody[] = [];

    // Add primary selected
    if (this.selectedBodyId) {
      const body = this.bodies.get(this.selectedBodyId);
      if (body && body.body_type === 'Asteroid') {
        asteroidsToCompare.push(body);
      }
    }

    // Add multi-selected
    this.selectedAsteroids.forEach(id => {
      if (!asteroidsToCompare.find(a => a.id === id)) {
        const body = this.bodies.get(id);
        if (body) asteroidsToCompare.push(body);
      }
    });

    if (asteroidsToCompare.length === 0) {
      this.showToast('Comparison', 'Select at least one asteroid first', 'warning');
      return;
    }

    // Calculate Earth distances
    const earth = this.bodies.get('earth');

    // Build table HTML
    let tableHTML = `
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Property</th>
            ${asteroidsToCompare.map(a => `<th>${a.name}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Hazardous</td>
            ${asteroidsToCompare.map(a => `<td class="${a.is_hazardous ? 'hazardous' : ''}">${a.is_hazardous ? '⚠️ YES' : '✓ NO'}</td>`).join('')}
          </tr>
          <tr>
            <td>Radius (km)</td>
            ${asteroidsToCompare.map(a => `<td>${a.radius.toFixed(2)}</td>`).join('')}
          </tr>
          <tr>
            <td>Distance to Earth (AU)</td>
            ${asteroidsToCompare.map(a => {
      if (!earth) return '<td>N/A</td>';
      const dx = a.position[0] - earth.position[0];
      const dy = a.position[1] - earth.position[1];
      const dz = a.position[2] - earth.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return `<td>${dist.toFixed(4)}</td>`;
    }).join('')}
          </tr>
          <tr>
            <td>Velocity (AU/day)</td>
            ${asteroidsToCompare.map(a => {
      const v = Math.sqrt(a.velocity[0] ** 2 + a.velocity[1] ** 2 + a.velocity[2] ** 2);
      return `<td>${v.toFixed(6)}</td>`;
    }).join('')}
          </tr>
        </tbody>
      </table>
    `;

    const tableContainer = document.getElementById('comparison-table-body');
    if (tableContainer) {
      tableContainer.innerHTML = tableHTML;
    }

    modal.classList.remove('hidden');
  }

  private closeComparisonTable(): void {
    document.getElementById('comparison-modal')?.classList.add('hidden');
  }

  // =========================================================================
  // MOBILE BOTTOM SHEET
  // =========================================================================

  private bottomSheetOpen = false;
  private bottomSheetPanel: 'left' | 'right' = 'left';

  private toggleBottomSheet(panel: 'left' | 'right' = 'left'): void {
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    const bottomSheet = document.getElementById('bottom-sheet');
    const sheetContent = document.getElementById('bottom-sheet-content');

    if (!bottomSheet || !sheetContent) return;

    // Close if same panel clicked
    if (this.bottomSheetOpen && this.bottomSheetPanel === panel) {
      bottomSheet.classList.remove('open');
      this.bottomSheetOpen = false;
      return;
    }

    this.bottomSheetPanel = panel;
    this.bottomSheetOpen = true;

    // Copy content from respective panel
    const sourcePanel = panel === 'left' ? leftPanel : rightPanel;
    if (sourcePanel) {
      sheetContent.innerHTML = sourcePanel.innerHTML;
    }

    bottomSheet.classList.add('open');
  }

  private closeBottomSheet(): void {
    const bottomSheet = document.getElementById('bottom-sheet');
    if (bottomSheet) {
      bottomSheet.classList.remove('open');
      this.bottomSheetOpen = false;
    }
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

window.addEventListener('DOMContentLoaded', () => {
  new OrbitalSentinelApp();
});
