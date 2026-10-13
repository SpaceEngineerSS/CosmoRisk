// All loaded small bodies as one point layer.

import * as THREE from 'three';
import type { BodyInfo } from '../core/types';
import { MarkerLayer } from './markers';

export interface AsteroidPalette {
  normal: THREE.Color;
  pha: THREE.Color;
  sentry: THREE.Color;
  deflected: THREE.Color;
  impacted: THREE.Color;
  selected: THREE.Color;
  hover: THREE.Color;
}

export class Asteroids {
  readonly layer = new MarkerLayer(256, 20);
  private bodies: BodyInfo[] = [];
  private palette!: AsteroidPalette;
  private selected = -1;
  private hovered = -1;
  private visible: boolean[] = [];
  filter: 'all' | 'pha' | 'sentry' = 'all';

  setPalette(p: AsteroidPalette) {
    this.palette = p;
    this.restyle();
  }

  setBodies(list: BodyInfo[]) {
    this.bodies = list;
    this.layer.resize(list.length);
    this.layer.setCount(list.length);
    this.restyle();
  }

  setSelected(index: number) {
    this.selected = index;
    this.restyle();
  }

  setHovered(index: number) {
    if (index === this.hovered) return;
    this.hovered = index;
    this.restyle();
  }

  isVisible(i: number) {
    return this.visible[i] ?? false;
  }

  restyle() {
    if (!this.palette) return;
    const L = this.layer;
    this.visible = new Array(this.bodies.length);
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      let c = this.palette.normal;
      let size = 2.6;
      if (b.pha) {
        c = this.palette.pha;
        size = 3.4;
      }
      if (b.sentry) {
        c = this.palette.sentry;
        size = 3.8;
      }
      if (b.deflected || b.thrusting) c = this.palette.deflected;
      if (b.impacted !== null) {
        c = this.palette.impacted;
        size = 5;
      }
      // Larger bodies get slightly larger dots (log scale, capped)
      size += Math.min(1.6, Math.max(0, Math.log10(b.diameter_km * 10 + 1)));
      let shape = 0;
      const shown = this.filter === 'all' || (this.filter === 'pha' && b.pha) || (this.filter === 'sentry' && b.sentry);
      if (!shown) size = 0;
      if (i === this.hovered) {
        c = this.palette.hover;
        size = Math.max(size, 6);
      }
      if (i === this.selected) {
        c = this.palette.selected;
        size = 16;
        shape = 2;
      }
      this.visible[i] = size > 0;
      L.colors[i * 3] = c.r;
      L.colors[i * 3 + 1] = c.g;
      L.colors[i * 3 + 2] = c.b;
      L.sizes[i] = size;
      L.shapes[i] = shape;
    }
    L.markStyle();
  }

  /** Positions in AU, ecliptic frame, interleaved xyz. */
  update(pos: Float64Array | Float32Array, n: number) {
    const P = this.layer.positions;
    const m = Math.min(n, this.layer.count);
    for (let i = 0; i < m; i++) {
      P[i * 3] = pos[i * 3];
      P[i * 3 + 1] = pos[i * 3 + 2];
      P[i * 3 + 2] = -pos[i * 3 + 1];
    }
    this.layer.markPositions();
  }

  scenePosition(i: number, out: THREE.Vector3) {
    const P = this.layer.positions;
    return out.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  }
}
