// The 3D view: renderer, camera, quality tiers, picking, labels and camera
// moves. Scene units are AU; Y is ecliptic north.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality, Theme } from '../core/settings';
import { Asteroids } from './asteroids';
import { Planets, PLANET_IDS, IDX_EARTH } from './planets';
import { Sky } from './sky';

export type Focus = { kind: 'sun' } | { kind: 'planet'; index: number } | { kind: 'body'; index: number };
export type Tier = 'low' | 'medium' | 'high';

export interface PickResult {
  kind: 'body' | 'planet' | 'sun';
  index: number;
}

interface Label {
  el: HTMLDivElement;
  text: string;
  visible: boolean;
}

const THEMES = {
  dark: {
    background: 0x07080a,
    orbit: 0x8d8a83,
    orbitEarth: 0x8fb0d4,
    grid: 0x5b5953,
    marker: 0xcfcac0,
    sun: 0xffd27a,
    normal: 0x9d998f,
    pha: 0xffb000,
    sentry: 0xff5a4e,
    deflected: 0x6fbf8a,
    impacted: 0xff5a4e,
    selected: 0xffb000,
    hover: 0xffffff,
    selOrbit: 0xffb000,
  },
  light: {
    background: 0xf1eee7,
    orbit: 0x6f6b62,
    orbitEarth: 0x2f5e8f,
    grid: 0x9a958a,
    marker: 0x2b2924,
    sun: 0xb36b00,
    normal: 0x55524b,
    pha: 0xb36b00,
    sentry: 0xc8332a,
    deflected: 0x2e7d4f,
    impacted: 0xc8332a,
    selected: 0xb36b00,
    hover: 0x000000,
    selOrbit: 0xb36b00,
  },
};

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly planets = new Planets();
  readonly asteroids = new Asteroids();
  readonly sky = new Sky();
  tier: Tier = 'medium';

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private selOrbit: THREE.Line;
  private selOrbitMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
  private needsRender = true;
  private focus: Focus = { kind: 'sun' };
  private focusPos = new THREE.Vector3();
  private tween: { t0: number; dur: number; fromTarget: THREE.Vector3; fromOffset: THREE.Vector3; toDist: number; dir: THREE.Vector3 } | null = null;
  private labels = new Map<string, Label>();
  private labelLayer: HTMLElement;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private width = 1;
  private height = 1;
  reduceMotion = false;
  labelsOn = true;

  constructor(private host: HTMLElement, canvas: HTMLCanvasElement, labelLayer: HTMLElement) {
    this.labelLayer = labelLayer;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(45, 1, 1e-8, 5000);
    this.camera.position.set(0.0, 1.6, 2.6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 1.1;
    this.controls.minDistance = 2e-6;
    this.controls.maxDistance = 400;
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => (this.tween = null));

    this.selOrbit = new THREE.Line(new THREE.BufferGeometry(), this.selOrbitMat);
    this.selOrbit.visible = false;
    this.selOrbit.renderOrder = 4;

    this.scene.add(this.sky.group, this.planets.group, this.asteroids.layer.points, this.selOrbit);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  // ---------------------------------------------------------------- quality

  /** Pick a starting tier from what the GPU reports. */
  detectTier(): Tier {
    const gl = this.renderer.getContext();
    let name = '';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    } catch {
      /* ignore */
    }
    if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
    if (/nvidia|geforce|rtx|radeon rx|apple m\d|arc a/.test(name)) return 'high';
    if (/intel|uhd|iris|mali|adreno/.test(name)) return 'medium';
    return 'medium';
  }

  setQuality(q: Quality) {
    const tier: Tier = q === 'auto' ? this.detectTier() : q;
    this.applyTier(tier);
  }

  applyTier(tier: Tier) {
    this.tier = tier;
    const dpr = window.devicePixelRatio || 1;
    const pr = tier === 'low' ? 1 : tier === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pr);
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (tier !== 'low') {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (tier === 'high') {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.35, 0.92);
        composer.addPass(this.bloom);
      }
      composer.addPass(new OutputPass());
      this.composer = composer;
    }
    this.resize();
    for (const l of [this.asteroids.layer, this.planets.markers]) l.setPixelRatio(pr);
    this.sky.setPixelRatio(pr);
    this.invalidate();
  }

  // ------------------------------------------------------------------ theme

  setTheme(theme: Theme) {
    const p = THEMES[theme];
    const c = (x: number) => new THREE.Color(x);
    this.scene.background = c(p.background);
    this.planets.setPalette(
      { orbit: c(p.orbit), orbitEarth: c(p.orbitEarth), grid: c(p.grid), marker: c(p.marker), ink: theme === 'light' ? 1.9 : 1 },
      [...PLANET_IDS.map((id) => (id === 'earth' ? c(p.orbitEarth) : c(p.marker))), c(p.sun)],
    );
    this.asteroids.setPalette({
      normal: c(p.normal),
      pha: c(p.pha),
      sentry: c(p.sentry),
      deflected: c(p.deflected),
      impacted: c(p.impacted),
      selected: c(p.selected),
      hover: c(p.hover),
    });
    this.selOrbitMat.color.set(p.selOrbit);
    this.sky.setInk(theme === 'light');
    if (this.bloom) this.bloom.strength = theme === 'light' ? 0 : 0.55;
    this.invalidate();
  }

  // ----------------------------------------------------------------- sizing

  resize() {
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(r.width));
    this.height = Math.max(1, Math.floor(r.height));
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
    if (this.bloom) this.bloom.resolution.set(this.width / 2, this.height / 2);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate() {
    this.needsRender = true;
  }

  // ------------------------------------------------------------- selection

  setSelectedOrbit(path: number[] | null) {
    if (!path || path.length < 9) {
      this.selOrbit.visible = false;
      this.invalidate();
      return;
    }
    const n = path.length / 3;
    const arr = new Float32Array((n + 1) * 3);
    for (let k = 0; k <= n; k++) {
      const j = (k % n) * 3;
      arr[k * 3] = path[j];
      arr[k * 3 + 1] = path[j + 2];
      arr[k * 3 + 2] = -path[j + 1];
    }
    this.selOrbit.geometry.dispose();
    this.selOrbit.geometry = new THREE.BufferGeometry();
    this.selOrbit.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.selOrbit.visible = true;
    this.invalidate();
  }

  // ----------------------------------------------------------------- camera

  private positionOf(f: Focus, out: THREE.Vector3): THREE.Vector3 {
    if (f.kind === 'sun') return out.set(0, 0, 0);
    if (f.kind === 'planet') return out.copy(this.planets.positions[f.index]);
    return this.asteroids.scenePosition(f.index, out);
  }

  getFocus(): Focus {
    return this.focus;
  }

  /** Keep the focus on a different index after the body list changed. */
  remapFocus(index: number | null) {
    if (this.focus.kind !== 'body') return;
    this.focus = index === null ? { kind: 'sun' } : { kind: 'body', index };
  }

  flyTo(f: Focus, distance?: number) {
    this.focus = f;
    const target = this.positionOf(f, new THREE.Vector3());
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    let dist = distance;
    if (dist === undefined) {
      if (f.kind === 'sun') dist = 2.8;
      else if (f.kind === 'planet') dist = f.index === IDX_EARTH ? 0.006 : Math.max(this.planets.meshes[f.index].scale.x * 12, 0.002);
      else dist = 0.08;
    }
    const dir = offset.lengthSq() > 0 ? offset.clone().normalize() : new THREE.Vector3(0, 0.5, 1).normalize();
    if (this.reduceMotion) {
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.focusPos.copy(target);
      this.invalidate();
      return;
    }
    this.tween = { t0: performance.now(), dur: 950, fromTarget: this.controls.target.clone(), fromOffset: offset, toDist: dist, dir };
    this.invalidate();
  }

  /** Called every animation frame after positions are updated. */
  followFocus() {
    const p = this.positionOf(this.focus, this.v);
    if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.controls.target.lerpVectors(tw.fromTarget, p, e);
      // Distance interpolates in log space so huge zooms feel even.
      const d0 = Math.max(1e-9, tw.fromOffset.length());
      const d = Math.exp(Math.log(d0) + (Math.log(tw.toDist) - Math.log(d0)) * e);
      const dir = this.w.copy(tw.fromOffset).normalize().lerp(tw.dir, e).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
      if (u >= 1) this.tween = null;
      this.focusPos.copy(p);
      this.invalidate();
      return;
    }
    const delta = this.w.subVectors(p, this.focusPos);
    if (delta.lengthSq() > 0) {
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.focusPos.copy(p);
      this.invalidate();
    }
  }

  cameraDistanceTo(p: THREE.Vector3) {
    return this.camera.position.distanceTo(p);
  }

  // ---------------------------------------------------------------- picking

  /** Nearest marker to a screen point within `radius` CSS pixels. */
  pick(clientX: number, clientY: number, radius = 10): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: PickResult | null = null;
    let bestD = radius * radius;
    const proj = this.v;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const test = (p: THREE.Vector3, r: PickResult) => {
      proj.copy(p).project(cam);
      if (proj.z > 1 || proj.z < -1) return;
      const sx = (proj.x * 0.5 + 0.5) * this.width;
      const sy = (-proj.y * 0.5 + 0.5) * this.height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    };
    const n = this.asteroids.layer.count;
    const P = this.asteroids.layer.positions;
    const tmp = this.w;
    for (let i = 0; i < n; i++) {
      if (!this.asteroids.isVisible(i)) continue;
      tmp.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      test(tmp, { kind: 'body', index: i });
    }
    // planets take precedence when equally close: test them after with a bias
    bestD *= 0.8;
    PLANET_IDS.forEach((_, i) => test(this.planets.positions[i], { kind: 'planet', index: i }));
    test(new THREE.Vector3(0, 0, 0), { kind: 'sun', index: -1 });
    return best;
  }

  // ----------------------------------------------------------------- labels

  setLabel(key: string, text: string | null) {
    let l = this.labels.get(key);
    if (!text) {
      if (l) {
        l.el.remove();
        this.labels.delete(key);
      }
      return;
    }
    if (!l) {
      const el = document.createElement('div');
      el.className = 'label';
      this.labelLayer.appendChild(el);
      l = { el, text: '', visible: false };
      this.labels.set(key, l);
    }
    if (l.text !== text) {
      l.el.textContent = text;
      l.text = text;
    }
    l.el.dataset.kind = key.split(':')[0];
  }

  private placeLabels() {
    const cam = this.camera;
    for (const [key, l] of this.labels) {
      const [kind, ref] = key.split(':');
      let p: THREE.Vector3 | null = null;
      if (kind === 'sun') p = this.v.set(0, 0, 0);
      else if (kind === 'planet') {
        const i = +ref;
        if (this.planets.markers.sizes[i] === 0 && i === 3) p = null;
        else p = this.v.copy(this.planets.positions[i]);
      } else if (kind === 'body' || kind === 'hover') {
        const i = +ref;
        if (i < this.asteroids.layer.count) p = this.asteroids.scenePosition(i, this.v);
      }
      let show = this.labelsOn || kind === 'body' || kind === 'hover';
      if (p) {
        p.project(cam);
        show = show && p.z < 1 && p.z > -1 && Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.94;
        if (show) {
          const sx = (p.x * 0.5 + 0.5) * this.width;
          const sy = (-p.y * 0.5 + 0.5) * this.height;
          l.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
        }
      } else show = false;
      if (show !== l.visible) {
        l.el.style.display = show ? 'block' : 'none';
        l.visible = show;
      }
    }
  }

  // ----------------------------------------------------------------- render

  /** Returns true if a frame was drawn. */
  render(force = false): boolean {
    const moved = this.controls.update();
    if (!force && !moved && !this.needsRender) return false;
    this.needsRender = false;
    this.sky.follow(this.camera);
    this.placeLabels();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    return true;
  }

  /** PNG of the current view (drawn fresh, so the buffer is valid). */
  async screenshot(): Promise<Blob> {
    this.render(true);
    return new Promise((res, rej) =>
      this.renderer.domElement.toBlob((b) => (b ? res(b) : rej(new Error('capture failed'))), 'image/png'),
    );
  }

  viewport() {
    return { width: this.width, height: this.height };
  }
}
