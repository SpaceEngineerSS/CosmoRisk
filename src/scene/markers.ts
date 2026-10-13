// Screen-space markers: constant pixel size regardless of distance, so tiny
// bodies stay visible at solar-system scale. One draw call per layer.

import * as THREE from 'three';

const vert = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  attribute float shape;
  uniform float pixelRatio;
  varying vec3 vColor;
  varying float vShape;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vColor = color;
    vShape = shape;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * pixelRatio;
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vShape;
  uniform float opacity;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float aa = fwidth(r) * 1.2;
    float a;
    if (vShape > 1.5) {
      // ring with a centre dot (selection)
      float ring = smoothstep(0.80 + aa, 0.80, r) * smoothstep(0.62 - aa, 0.62, r);
      float dot = smoothstep(0.24 + aa, 0.24, r);
      a = max(ring, dot);
    } else if (vShape > 0.5) {
      // hollow ring (planets)
      a = smoothstep(1.0, 1.0 - aa, r) * smoothstep(0.55 - aa, 0.55, r);
    } else {
      a = smoothstep(1.0, 1.0 - aa * 1.5, r);
    }
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a * opacity);
  }
`;

export class MarkerLayer {
  readonly points: THREE.Points;
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  positions = new Float32Array(0);
  colors = new Float32Array(0);
  sizes = new Float32Array(0);
  shapes = new Float32Array(0);
  count = 0;

  constructor(capacity: number, renderOrder = 10) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { pixelRatio: { value: 1 }, opacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions move every frame; culling is the GPU's job
    this.points.renderOrder = renderOrder;
    this.resize(capacity);
  }

  resize(capacity: number) {
    if (capacity <= this.positions.length / 3 && this.positions.length > 0) {
      this.count = Math.min(this.count, capacity);
      return;
    }
    const cap = Math.max(16, Math.ceil(capacity * 1.25));
    this.positions = new Float32Array(cap * 3);
    this.colors = new Float32Array(cap * 3);
    this.sizes = new Float32Array(cap);
    this.shapes = new Float32Array(cap);
    this.geometry.dispose();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('shape', new THREE.BufferAttribute(this.shapes, 1));
  }

  setCount(n: number) {
    this.count = n;
    this.geometry.setDrawRange(0, n);
  }

  markPositions() {
    const a = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    a.clearUpdateRanges();
    a.addUpdateRange(0, this.count * 3);
    a.needsUpdate = true;
  }

  markStyle() {
    for (const k of ['color', 'size', 'shape']) {
      (this.geometry.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  setPixelRatio(pr: number) {
    this.material.uniforms.pixelRatio.value = pr;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
