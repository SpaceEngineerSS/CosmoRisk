// Application state and a tiny typed event bus.

import type { BodyInfo, Frame, PlanetInfo, ScanSummary } from './types';

type Events = {
  frame: Frame;
  bodies: BodyInfo[];
  select: string | null;
  hover: string | null;
  settings: void;
  lang: void;
  scan: { id: string; scan: ScanSummary } | null;
  busy: { key: string; busy: boolean };
};

type Handler<T> = (payload: T) => void;

class Bus {
  private map = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(k: K, fn: Handler<Events[K]>): () => void {
    if (!this.map.has(k)) this.map.set(k, new Set());
    this.map.get(k)!.add(fn);
    return () => this.map.get(k)!.delete(fn);
  }

  emit<K extends keyof Events>(k: K, payload: Events[K]): void {
    this.map.get(k)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus:${String(k)}]`, e);
      }
    });
  }
}

export const bus = new Bus();

export const state = {
  frame: null as Frame | null,
  prevFrame: null as Frame | null,
  version: 0,
  bodies: [] as BodyInfo[],
  index: new Map<string, number>(),
  planets: [] as PlanetInfo[],
  selected: null as string | null,
  hovered: null as string | null,
  /** Encounter scan for the selected object, shown on the timeline. */
  scan: null as { id: string; scan: ScanSummary } | null,
};

export function setBodies(version: number, list: BodyInfo[]) {
  state.version = version;
  state.bodies = list;
  state.index = new Map(list.map((b, i) => [b.id, i]));
  if (state.selected && !state.index.has(state.selected)) {
    select(null);
  }
  bus.emit('bodies', list);
}

export function select(id: string | null) {
  if (state.selected === id) return;
  state.selected = id;
  if (state.scan && state.scan.id !== id) {
    state.scan = null;
    bus.emit('scan', null);
  }
  bus.emit('select', id);
}

export function selectedBody(): BodyInfo | null {
  if (!state.selected) return null;
  const i = state.index.get(state.selected);
  return i === undefined ? null : state.bodies[i];
}
