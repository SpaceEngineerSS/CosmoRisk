// Background stars from the Yale Bright Star Catalogue (9,096 stars to
// about magnitude 6.5), placed on a sphere that follows the camera.

import * as THREE from 'three';

const vert = /* glsl */ `
  attribute float mag;
  attribute vec3 color;
  uniform float pixelRatio;
  uniform float magLimit;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    float b = clamp((magLimit - mag) / (magLimit + 1.5), 0.0, 1.0);
    vAlpha = 0.25 + 0.75 * b;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // push to the far plane
    gl_PointSize = (1.0 + 3.2 * b * b) * pixelRatio;
  }
`;

const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float dim;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    float a = exp(-r * 3.0) * vAlpha * dim;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/** Rough B-V colour index to RGB. */
function bvToRgb(bv: number): [number, number, number] {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  let r: number, g: number, b: number;
  if (t < 0.0) {
    r = 0.62 + 0.38 * (t + 0.4) / 0.4;
    g = 0.72 + 0.28 * (t + 0.4) / 0.4;
    b = 1.0;
  } else if (t < 0.6) {
    r = 1.0;
    g = 1.0 - 0.12 * t / 0.6;
    b = 1.0 - 0.35 * t / 0.6;
  } else {
    r = 1.0;
    g = 0.88 - 0.3 * (t - 0.6) / 1.4;
    b = 0.65 - 0.45 * (t - 0.6) / 1.4;
  }
  return [r, g, b];
}

export class Sky {
  readonly group = new THREE.Group();
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { pixelRatio: { value: 1 }, magLimit: { value: 6.5 }, dim: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.group.renderOrder = -10;
  }

  async load(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`stars: HTTP ${res.status}`);
    const data = new Float32Array(await res.arrayBuffer());
    const n = data.length / 5;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const R = 100;
    for (let i = 0; i < n; i++) {
      const x = data[i * 5];
      const y = data[i * 5 + 1];
      const z = data[i * 5 + 2];
      // ecliptic -> scene (Y up)
      pos[i * 3] = x * R;
      pos[i * 3 + 1] = z * R;
      pos[i * 3 + 2] = -y * R;
      mag[i] = data[i * 5 + 3];
      const [r, g, b] = bvToRgb(data[i * 5 + 4]);
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
    const pts = new THREE.Points(geo, this.material);
    pts.frustumCulled = false;
    pts.renderOrder = -10;
    this.group.add(pts);
  }

  setPixelRatio(pr: number) {
    this.material.uniforms.pixelRatio.value = pr;
  }

  /** Light theme draws stars as ink dots. */
  setInk(ink: boolean) {
    this.material.blending = ink ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.material.uniforms.dim.value = ink ? 0.55 : 1;
    this.material.fragmentShader = ink ? frag.replace('vec4(vColor, a)', 'vec4(vec3(0.16, 0.15, 0.13), a)') : frag;
    this.material.needsUpdate = true;
  }

  follow(camera: THREE.Camera) {
    this.group.position.copy(camera.position);
  }
}
