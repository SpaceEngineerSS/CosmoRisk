// CosmoRisk frontend entry: boots the view, wires panels and runs the frame loop.

import '@fontsource/ibm-plex-sans-condensed/latin-400.css';
import '@fontsource/ibm-plex-sans-condensed/latin-ext-400.css';
import '@fontsource/ibm-plex-sans-condensed/latin-500.css';
import '@fontsource/ibm-plex-sans-condensed/latin-ext-500.css';
import '@fontsource/ibm-plex-sans-condensed/latin-600.css';
import '@fontsource/ibm-plex-sans-condensed/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import './styles/tokens.css';
import './styles/app.css';

import { animate } from 'motion';
import {
  ctx,
  focusEarth,
  focusSelected,
  focusSun,
  loadDesignation,
  loadPreset,
  refreshBodies,
  reverse,
  selectBody,
  setPaused,
  stepRate,
  syncNow,
  resetSim,
} from './app';
import { api, errorText, inTauri } from './core/bridge';
import { applyI18n, t, type Key } from './core/i18n';
import { settings, updateSettings } from './core/settings';
import { bus, state } from './core/store';
import type { Frame } from './core/types';
import { View } from './scene/view';
import { PLANET_IDS } from './scene/planets';
import { mountCatalog } from './ui/catalog';
import { mountChrome, showImpacts, updateHud, versionLabel } from './ui/chrome';
import { maybeShowIntro, openHelp, openScenarios, openSettings } from './ui/dialogs';
import { $, actions } from './ui/dom';
import { exportCsv, exportReport, saveScreenshot } from './ui/export';
import { icon, type IconName } from './ui/icons';
import { mountInspector } from './ui/inspector';
import { closeTopModal, confirmDialog, isModalOpen } from './ui/modal';
import { configurePalette, isPaletteOpen, openPalette, type Command } from './ui/palette';
import { mountTimeline } from './ui/timeline';
import { toast } from './ui/toast';

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// ------------------------------------------------------------------ splash

function splash(step: string, progress: number) {
  $('#splash-step').textContent = step;
  ($('#splash-bar') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
}

function hideSplash() {
  const s = $('#splash');
  if (settings.reduceMotion) return s.remove();
  animate(s, { opacity: [1, 0] }, { duration: 0.25 }).then(() => s.remove());
}

// ------------------------------------------------------------------- setup

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
}

function fillIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon as IconName);
  });
}

async function boot() {
  applyTheme();
  fillIcons();
  applyI18n(document.body);
  document.documentElement.lang = settings.lang;
  versionLabel(VERSION);
  splash(t('boot.renderer'), 0.1);

  if (!inTauri) {
    splash(t('boot.noTauri'), 1);
    return;
  }

  const view = new View($('#view'), $('#canvas') as HTMLCanvasElement, $('#labels'));
  ctx.view = view;
  view.reduceMotion = settings.reduceMotion;
  view.setQuality(settings.quality);
  view.setTheme(settings.theme);
  view.labelsOn = settings.labels;
  view.planets.setOrbitsVisible(settings.planetOrbits);
  view.planets.setGridVisible(settings.grid);

  splash(t('boot.stars'), 0.3);
  await view.sky.load('/data/stars.bin').catch((e) => console.warn('stars', e));

  splash(t('boot.engine'), 0.55);
  const maxAniso = view.renderer.capabilities.getMaxAnisotropy();
  view.planets.loadTextures('/textures', maxAniso).then(() => view.invalidate());
  const [planets, moon, frame] = await Promise.all([api.planets(), api.moonOrbit(), api.frame()]);
  state.planets = planets;
  view.planets.setInfo(planets);
  view.planets.setMoonOrbit(moon);
  planetJd = frame.jd;
  moonJd = frame.jd;
  setLabels();
  onFrame(frame);
  await refreshBodies();

  splash(t('boot.ui'), 0.85);
  mountChrome();
  mountCatalog($('#rail-left'));
  mountInspector($('#rail-right'));
  mountTimeline($('#timeline'));
  wireInput(view);
  wireCommands();
  bus.on('settings', onSettings);
  bus.on('lang', setLabels);
  bus.on('bodies', (list) => {
    view.asteroids.setBodies(list);
    const i = state.selected ? state.index.get(state.selected) : undefined;
    view.asteroids.setSelected(i ?? -1);
    setLabels();
    view.invalidate();
  });
  bus.on('select', () => setLabels());
  view.asteroids.setBodies(state.bodies);

  splash(t('boot.ready'), 1);
  hideSplash();
  requestAnimationFrame(loop);
  maybeShowIntro();
}

let bodyLabel: string | null = null;
let hoverLabel: string | null = null;

function setLabels() {
  const view = ctx.view;
  if (!view) return;
  PLANET_IDS.forEach((id, i) => view.setLabel(`planet:${i}`, t(`planet.${id}` as Key)));
  view.setLabel('sun:0', t('view.sun'));
  if (bodyLabel) view.setLabel(bodyLabel, null);
  bodyLabel = null;
  const i = state.selected ? state.index.get(state.selected) : undefined;
  if (i !== undefined) {
    bodyLabel = `body:${i}`;
    view.setLabel(bodyLabel, state.bodies[i].name);
  }
  view.invalidate();
}

function setHoverLabel(i: number) {
  const view = ctx.view!;
  if (hoverLabel) view.setLabel(hoverLabel, null);
  hoverLabel = null;
  if (i >= 0 && state.bodies[i] && state.bodies[i].id !== state.selected) {
    hoverLabel = `hover:${i}`;
    view.setLabel(hoverLabel, state.bodies[i].name);
  }
  view.invalidate();
}

function onSettings() {
  const view = ctx.view;
  if (!view) return;
  applyTheme();
  view.reduceMotion = settings.reduceMotion;
  view.setTheme(settings.theme);
  if (settings.quality !== appliedQuality) {
    appliedQuality = settings.quality;
    view.setQuality(settings.quality);
  }
  view.labelsOn = settings.labels;
  view.planets.setOrbitsVisible(settings.planetOrbits);
  view.planets.setGridVisible(settings.grid);
  view.invalidate();
}
let appliedQuality = settings.quality;

// -------------------------------------------------------------- frame loop

let inFlight = false;
let lastRequest = 0;
let planetJd = 0;
let moonJd = 0;
let eventSeq = -1;
let interp = { planets: new Float64Array(0), bodies: new Float64Array(0) };
let frames = 0;
let fpsT0 = performance.now();
let fps = 60;
let slowSeconds = 0;

function onFrame(f: Frame) {
  state.prevFrame = state.frame;
  state.frame = f;
  if (eventSeq < 0) eventSeq = f.eventSeq;
  bus.emit('frame', f);
}

async function requestFrame() {
  inFlight = true;
  lastRequest = performance.now();
  try {
    const f = await api.frame();
    onFrame(f);
    if (f.version !== state.version) await refreshBodies();
    if (f.eventSeq !== eventSeq) {
      eventSeq = f.eventSeq;
      const [, events] = await api.takeEvents();
      if (events.length) {
        showImpacts(events);
        await refreshBodies();
      }
    }
    // Planet orbit lines and the Moon's orbit drift slowly; refresh occasionally.
    if (Math.abs(f.jd - planetJd) > 365) {
      planetJd = f.jd;
      api.planets().then((p) => ctx.view?.planets.setInfo(p));
    }
    if (Math.abs(f.jd - moonJd) > 2) {
      moonJd = f.jd;
      api.moonOrbit().then((m) => ctx.view?.planets.setMoonOrbit(m));
    }
  } catch (e) {
    console.error('frame', e);
  } finally {
    inFlight = false;
  }
}

function lerpInto(out: Float64Array, a: Float64Array, b: Float64Array, u: number): Float64Array {
  if (out.length !== b.length) out = new Float64Array(b.length);
  if (a.length !== b.length || u >= 1) {
    out.set(b);
    return out;
  }
  for (let i = 0; i < b.length; i++) out[i] = a[i] + (b[i] - a[i]) * u;
  return out;
}

function loop(now: number) {
  requestAnimationFrame(loop);
  const view = ctx.view!;
  const f = state.frame;
  const running = f ? !f.paused : false;
  const interval = running ? 33 : 250;
  if (!inFlight && now - lastRequest > interval) requestFrame();
  if (!f) return;

  // Interpolate between the last two frames, one frame interval behind.
  const p = state.prevFrame;
  let u = 1;
  let jd = f.jd;
  if (running && p && p.version === f.version) {
    const span = Math.max(1, f.received - p.received);
    u = Math.min(1, (now - f.received) / span);
    jd = p.jd + (f.jd - p.jd) * u;
  }
  interp.planets = lerpInto(interp.planets, p?.planets ?? f.planets, f.planets, running ? u : 1);
  interp.bodies = lerpInto(interp.bodies, p && p.version === f.version ? p.bodies : f.bodies, f.bodies, running ? u : 1);

  const { height } = view.viewport();
  view.planets.update(interp.planets, jd, view.camera, height);
  view.asteroids.update(interp.bodies, interp.bodies.length / 3);
  view.followFocus();
  if (running) view.invalidate();
  const drawn = view.render();

  // FPS and adaptive quality while the scene is animating
  if (drawn) frames++;
  if (now - fpsT0 >= 1000) {
    fps = (frames * 1000) / (now - fpsT0);
    frames = 0;
    fpsT0 = now;
    if (running && settings.quality === 'auto') {
      slowSeconds = fps < 45 ? slowSeconds + 1 : 0;
      if (slowSeconds >= 3 && view.tier !== 'low') {
        view.applyTier(view.tier === 'high' ? 'medium' : 'low');
        slowSeconds = 0;
        toast(t('toast.qualityDown', { tier: t(`settings.q.${view.tier}` as Key) }), 'info');
      }
    }
  }
  updateHud(running ? fps : 0, f.stepMs);
}

// ------------------------------------------------------------------- input

function wireInput(view: View) {
  const canvas = view.renderer.domElement;
  const viewEl = $('#view');
  let down: { x: number; y: number; t: number } | null = null;
  let hoverQueued = false;
  let lastMove = { x: 0, y: 0 };

  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4 || e.button !== 0) return;
    const hit = view.pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 18 : 10);
    if (!hit) return;
    if (hit.kind === 'body') selectBody(state.bodies[hit.index].id, false);
    else if (hit.kind === 'planet') view.flyTo({ kind: 'planet', index: hit.index });
    else view.flyTo({ kind: 'sun' });
  });
  canvas.addEventListener('dblclick', (e) => {
    const hit = view.pick(e.clientX, e.clientY, 12);
    if (hit?.kind === 'body') selectBody(state.bodies[hit.index].id, true);
  });
  canvas.addEventListener('pointermove', (e) => {
    lastMove = { x: e.clientX, y: e.clientY };
    if (hoverQueued || e.buttons) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      const hit = view.pick(lastMove.x, lastMove.y, 8);
      const idx = hit?.kind === 'body' ? hit.index : -1;
      view.asteroids.setHovered(idx);
      viewEl.dataset.hover = String(!!hit);
      setHoverLabel(idx);
    });
  });
  canvas.addEventListener('pointerleave', () => {
    view.asteroids.setHovered(-1);
    setHoverLabel(-1);
    viewEl.dataset.hover = 'false';
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.matches('input, textarea, select, [contenteditable]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key === 'Escape') {
      if (isPaletteOpen() || isModalOpen()) return; // handled there
      if (closeDrawer()) return;
      if (state.selected) selectBody(null);
      return;
    }
    if (typing || isModalOpen() || isPaletteOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const handled = (() => {
      switch (k) {
        case ' ':
          setPaused(!(state.frame?.paused ?? true));
          return true;
        case '[':
          stepRate(-1);
          return true;
        case ']':
          stepRate(1);
          return true;
        case 'r':
        case 'R':
          reverse();
          return true;
        case 'n':
        case 'N':
          syncNow();
          return true;
        case '1':
          focusSun();
          return true;
        case '2':
          focusEarth();
          return true;
        case '3':
        case 'f':
        case 'F':
          focusSelected();
          return true;
        case 'l':
        case 'L':
          updateSettings({ labels: !settings.labels });
          return true;
        case 'o':
        case 'O':
          updateSettings({ planetOrbits: !settings.planetOrbits });
          return true;
        case 'g':
        case 'G':
          updateSettings({ grid: !settings.grid });
          return true;
        case '?':
          openHelp(VERSION);
          return true;
      }
      return false;
    })();
    if (handled) e.preventDefault();
  });

  // Escape closes modals even when focus is elsewhere
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen() && !isPaletteOpen()) closeTopModal();
  });
}

// ---------------------------------------------------------------- commands

function closeDrawer(): boolean {
  const app = $('#app');
  if (app.dataset.drawer) {
    delete app.dataset.drawer;
    return true;
  }
  return false;
}

function toggleDrawer(side: 'left' | 'right') {
  const app = $('#app');
  app.dataset.drawer = app.dataset.drawer === side ? '' : side;
  if (!app.dataset.drawer) delete app.dataset.drawer;
}

function wireCommands() {
  actions($('.top'), {
    palette: () => openPalette(),
    scenarios: () => openScenarios(),
    screenshot: () => saveScreenshot(),
    settings: () => openSettings(),
    help: () => openHelp(VERSION),
    'drawer-left': () => toggleDrawer('left'),
    'drawer-right': () => toggleDrawer('right'),
  });
  // close drawers when an object is picked on narrow screens
  bus.on('select', () => {
    if (window.innerWidth <= 1080 && $('#app').dataset.drawer === 'left') closeDrawer();
  });

  const cmds = (): Command[] => {
    const g = (k: Key) => t(k);
    const paused = state.frame?.paused ?? true;
    return [
      { id: 'play', title: paused ? t('tl.play') : t('tl.pause'), group: g('palette.g.time'), icon: paused ? 'play' : 'pause', keys: 'Space', run: () => setPaused(!paused) },
      { id: 'faster', title: t('tl.faster'), group: g('palette.g.time'), icon: 'faster', keys: ']', run: () => stepRate(1) },
      { id: 'slower', title: t('tl.slower'), group: g('palette.g.time'), icon: 'slower', keys: '[', run: () => stepRate(-1) },
      { id: 'reverse', title: t('tl.reverse'), group: g('palette.g.time'), icon: 'reverse', keys: 'R', run: () => reverse() },
      { id: 'now', title: t('tl.now.title'), group: g('palette.g.time'), icon: 'now', keys: 'N', run: () => syncNow() },
      { id: 'sun', title: t('view.sun'), group: g('palette.g.view'), icon: 'sun', keys: '1', run: () => focusSun() },
      { id: 'earth', title: t('view.earth'), group: g('palette.g.view'), icon: 'earth', keys: '2', run: () => focusEarth() },
      { id: 'sel', title: t('view.selected'), group: g('palette.g.view'), icon: 'reticle', keys: 'F', run: () => focusSelected() },
      { id: 'labels', title: t('view.labels'), group: g('palette.g.view'), icon: 'tag', keys: 'L', run: () => updateSettings({ labels: !settings.labels }) },
      { id: 'orbits', title: t('view.orbits'), group: g('palette.g.view'), icon: 'orbit', keys: 'O', run: () => updateSettings({ planetOrbits: !settings.planetOrbits }) },
      { id: 'grid', title: t('view.grid'), group: g('palette.g.view'), icon: 'grid', keys: 'G', run: () => updateSettings({ grid: !settings.grid }) },
      { id: 'theme', title: t('palette.theme'), group: g('palette.g.view'), icon: 'layers', run: () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'pha', title: t('palette.loadPha'), group: g('palette.g.data'), icon: 'download', run: () => loadPreset('pha', 1000) },
      { id: 'large', title: t('palette.loadLarge'), group: g('palette.g.data'), icon: 'download', run: () => loadPreset('large_neo', 1000) },
      { id: 'apophis', title: t('insp.quick.apophis'), group: g('palette.g.data'), icon: 'search', run: () => loadDesignation('99942') },
      { id: 'csv', title: t('export.csv'), group: g('palette.g.data'), icon: 'report', run: () => exportCsv() },
      { id: 'report', title: t('insp.report'), group: g('palette.g.data'), icon: 'report', run: () => exportReport() },
      { id: 'shot', title: t('top.screenshot'), group: g('palette.g.data'), icon: 'camera', run: () => saveScreenshot() },
      { id: 'scen', title: t('top.scenarios'), group: g('palette.g.data'), icon: 'folder', run: () => openScenarios() },
      { id: 'settings', title: t('top.settings'), group: g('palette.g.app'), icon: 'sliders', run: () => openSettings() },
      { id: 'help', title: t('top.help'), group: g('palette.g.app'), icon: 'help', keys: '?', run: () => openHelp(VERSION) },
      {
        id: 'reset',
        title: t('palette.reset'),
        group: g('palette.g.app'),
        icon: 'trash',
        run: async () => {
          if (await confirmDialog(t('palette.reset'), t('palette.reset.body'), t('palette.reset.ok'), true)) resetSim();
        },
      },
    ];
  };
  configurePalette(cmds, (id) => selectBody(id, true), (q) => loadDesignation(q));
}

boot().catch((e) => {
  console.error(e);
  splash(`${t('boot.failed')}: ${errorText(e)}`, 1);
});
