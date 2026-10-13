// Sun, planets and Moon at true scale, with screen-space markers so they are
// findable when they are far smaller than a pixel.

import * as THREE from 'three';
import type { PlanetInfo } from '../core/types';
import { AU_KM } from '../core/units';
import { MarkerLayer } from './markers';

export const PLANET_IDS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;
export const IDX_EARTH = 2;
export const IDX_MOON = 3;

const SUN_RADIUS_AU = 696_000 / AU_KM;
const OBLIQUITY = THREE.MathUtils.degToRad(23.4392911);

/** Muted, slightly desaturated tones; planets are context, not the subject. */
const TONES: Record<string, number> = {
  mercury: 0x9a958c,
  venus: 0xd8c9a3,
  earth: 0x7d9cc0,
  moon: 0xb0aca4,
  mars: 0xc0704f,
  jupiter: 0xc9ae8c,
  saturn: 0xd6c391,
  uranus: 0x9cc4c8,
  neptune: 0x6f88c9,
};

export interface Palette {
  orbit: THREE.Color;
  orbitEarth: THREE.Color;
  grid: THREE.Color;
  marker: THREE.Color;
}

export class Planets {
  readonly group = new THREE.Group();
  readonly sun: THREE.Mesh;
  readonly meshes: THREE.Mesh[] = [];
  readonly markers = new MarkerLayer(12, 5);
  readonly orbits = new THREE.Group();
  readonly moonOrbit: THREE.LineLoop;
  readonly grid = new THREE.Group();
  readonly positions: THREE.Vector3[] = PLANET_IDS.map(() => new THREE.Vector3());
  readonly sunLight: THREE.PointLight;
  private earthMatrix = new THREE.Matrix4();
  private tmpM = new THREE.Matrix4();
  private orbitMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
  private earthOrbitMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
  private gridMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false });
  private moonOrbitMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false });

  constructor() {
    // Sun: emissive sphere plus a soft sprite so it reads at any distance.
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS_AU, 48, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff1d6 }),
    );
    this.sun.name = 'sun';
    this.group.add(this.sun);

    this.sunLight = new THREE.PointLight(0xffffff, 2.6, 0, 0);
    this.group.add(this.sunLight);
    this.group.add(new THREE.AmbientLight(0xffffff, 0.06));

    for (const id of PLANET_IDS) {
      const mat = new THREE.MeshLambertMaterial({ color: TONES[id] });
      const seg = id === 'earth' ? 96 : 48;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg / 2), mat);
      mesh.name = id;
      mesh.matrixAutoUpdate = id !== 'earth';
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    const saturn = this.meshes[6];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.24, 2.27, 128, 1),
      new THREE.MeshBasicMaterial({ color: 0xcdbb8f, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    ring.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(26.7);
    saturn.add(ring);

    this.moonOrbit = new THREE.LineLoop(new THREE.BufferGeometry(), this.moonOrbitMaterial);
    this.group.add(this.orbits, this.moonOrbit, this.grid, this.markers.points);
    this.buildGrid();
  }

  async loadTextures(base: string, maxAniso: number) {
    const loader = new THREE.TextureLoader();
    const load = (url: string) =>
      new Promise<THREE.Texture>((res, rej) => loader.load(url, res, undefined, rej));
    const [earth, moon] = await Promise.allSettled([load(`${base}/earth.jpg`), load(`${base}/moon.jpg`)]);
    const apply = (r: PromiseSettledResult<THREE.Texture>, idx: number) => {
      if (r.status !== 'fulfilled') return;
      r.value.colorSpace = THREE.SRGBColorSpace;
      r.value.anisotropy = Math.min(8, maxAniso);
      const mat = this.meshes[idx].material as THREE.MeshLambertMaterial;
      mat.map = r.value;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    };
    apply(earth, IDX_EARTH);
    apply(moon, IDX_MOON);
  }

  setInfo(info: PlanetInfo[]) {
    // radii
    info.forEach((p, i) => {
      const r = p.radius_km / AU_KM;
      this.meshes[i].scale.setScalar(r);
    });
    // orbit polylines
    this.orbits.children.forEach((c) => (c as THREE.Line).geometry.dispose());
    this.orbits.clear();
    info.forEach((p, i) => {
      if (p.orbit.length < 9) return;
      const n = p.orbit.length / 3;
      const arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        arr[k * 3] = p.orbit[k * 3];
        arr[k * 3 + 1] = p.orbit[k * 3 + 2];
        arr[k * 3 + 2] = -p.orbit[k * 3 + 1];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const line = new THREE.LineLoop(g, i === IDX_EARTH ? this.earthOrbitMaterial : this.orbitMaterial);
      line.name = `orbit:${p.id}`;
      this.orbits.add(line);
    });
    this.markers.setCount(PLANET_IDS.length + 1);
    for (let i = 0; i <= PLANET_IDS.length; i++) this.markers.shapes[i] = i === PLANET_IDS.length ? 0 : 1;
  }

  setMoonOrbit(geo: number[]) {
    const n = geo.length / 3;
    const arr = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      arr[k * 3] = geo[k * 3];
      arr[k * 3 + 1] = geo[k * 3 + 2];
      arr[k * 3 + 2] = -geo[k * 3 + 1];
    }
    this.moonOrbit.geometry.dispose();
    this.moonOrbit.geometry = new THREE.BufferGeometry();
    this.moonOrbit.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  }

  private buildGrid() {
    const rings = [0.5, 1, 1.5, 2, 3, 5, 10, 20, 30];
    for (const r of rings) {
      const n = 256;
      const arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        arr[k * 3] = Math.cos(a) * r;
        arr[k * 3 + 2] = Math.sin(a) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      this.grid.add(new THREE.LineLoop(g, this.gridMaterial));
    }
    // vernal equinox direction
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 30, 0, 0]), 3));
    this.grid.add(new THREE.Line(g, this.gridMaterial));
    this.grid.visible = false;
  }

  setPalette(p: Palette, markerColors: THREE.Color[]) {
    this.orbitMaterial.color.copy(p.orbit);
    this.earthOrbitMaterial.color.copy(p.orbitEarth);
    this.moonOrbitMaterial.color.copy(p.orbit);
    this.gridMaterial.color.copy(p.grid);
    for (let i = 0; i <= PLANET_IDS.length; i++) {
      const c = markerColors[i] ?? p.marker;
      this.markers.colors[i * 3] = c.r;
      this.markers.colors[i * 3 + 1] = c.g;
      this.markers.colors[i * 3 + 2] = c.b;
    }
    this.markers.markStyle();
  }

  /** Planet positions (AU, ecliptic) and the TDB Julian date. */
  update(planets: Float64Array, jd: number, camera: THREE.PerspectiveCamera, viewportH: number) {
    for (let i = 0; i < PLANET_IDS.length; i++) {
      const v = this.positions[i].set(planets[i * 3], planets[i * 3 + 2], -planets[i * 3 + 1]);
      this.meshes[i].position.copy(v);
      this.markers.positions[i * 3] = v.x;
      this.markers.positions[i * 3 + 1] = v.y;
      this.markers.positions[i * 3 + 2] = v.z;
    }
    // Sun marker at the origin (last slot)
    const s = PLANET_IDS.length;
    this.markers.positions[s * 3] = this.markers.positions[s * 3 + 1] = this.markers.positions[s * 3 + 2] = 0;
    this.markers.markPositions();

    this.orientEarth(jd);
    this.orientMoon();
    this.moonOrbit.position.copy(this.positions[IDX_EARTH]);

    // Hide a marker once the body itself is bigger on screen than the marker.
    const k = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const camToEarth = camera.position.distanceTo(this.positions[IDX_EARTH]);
    for (let i = 0; i <= PLANET_IDS.length; i++) {
      const isSun = i === PLANET_IDS.length;
      const pos = isSun ? this.sun.position : this.positions[i];
      const radius = isSun ? SUN_RADIUS_AU : this.meshes[i].scale.x;
      const d = Math.max(1e-12, camera.position.distanceTo(pos));
      const px = (radius / d) * k * 2;
      let size = isSun ? 9 : i === IDX_EARTH ? 11 : 10;
      if (px > size * 0.6) size = 0;
      if (i === IDX_MOON && camToEarth > 0.08) size = 0; // only near Earth
      this.markers.sizes[i] = size;
    }
    const sz = this.markers.geometry.getAttribute('size') as THREE.BufferAttribute;
    sz.needsUpdate = true;
    this.moonOrbit.visible = camToEarth < 0.15;
  }

  private orientEarth(jd: number) {
    // Body frame (X = lon 0, Y = north pole, Z = lon 90W) -> ECEF -> ECI
    // (rotate by GMST) -> ecliptic (tilt) -> scene (Y up).
    const jdUt = jd - 69.184 / 86400;
    const gmst = THREE.MathUtils.degToRad((280.46061837 + 360.98564736629 * (jdUt - 2451545.0)) % 360);
    const c = Math.cos(gmst);
    const s = Math.sin(gmst);
    const ce = Math.cos(OBLIQUITY);
    const se = Math.sin(OBLIQUITY);
    // columns: images of body axes in ECI
    // body X -> (c, s, 0); body Y (north) -> (0,0,1); body Z -> -(east 90) = (s, -c, 0)
    const toEcl = (x: number, y: number, z: number) => [x, y * ce + z * se, -y * se + z * ce];
    const toScene = (v: number[]) => [v[0], v[2], -v[1]];
    const X = toScene(toEcl(c, s, 0));
    const Y = toScene(toEcl(0, 0, 1));
    const Z = toScene(toEcl(s, -c, 0));
    const e = this.meshes[IDX_EARTH];
    const r = e.scale.x;
    this.earthMatrix.set(
      X[0] * r, Y[0] * r, Z[0] * r, e.position.x,
      X[1] * r, Y[1] * r, Z[1] * r, e.position.y,
      X[2] * r, Y[2] * r, Z[2] * r, e.position.z,
      0, 0, 0, 1,
    );
    e.matrix.copy(this.earthMatrix);
    e.matrixWorldNeedsUpdate = true;
  }

  private orientMoon() {
    // Tidally locked: lon 0 of the lunar map faces Earth.
    const m = this.meshes[IDX_MOON];
    const toEarth = new THREE.Vector3().subVectors(this.positions[IDX_EARTH], this.positions[IDX_MOON]).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const z = new THREE.Vector3().crossVectors(toEarth, up).normalize();
    const y = new THREE.Vector3().crossVectors(z, toEarth).normalize();
    this.tmpM.makeBasis(toEarth, y, z);
    m.quaternion.setFromRotationMatrix(this.tmpM);
  }

  setOrbitsVisible(v: boolean) {
    this.orbits.visible = v;
  }

  setGridVisible(v: boolean) {
    this.grid.visible = v;
  }
}
