// Top bar readouts, viewport tools, HUD and the impact banner.

import { ctx, focusEarth, focusSelected, focusSun, rateLabel, selectBody } from '../app';
import { t } from '../core/i18n';
import { settings, updateSettings } from '../core/settings';
import { bus, state } from '../core/store';
import type { SimEvent } from '../core/types';
import { formatDate, formatDateTime, formatTime } from '../core/time';
import { AU_KM, LD_KM, fmt, sig } from '../core/units';
import { $, actions, esc, html, raw, setText } from './dom';
import { icon } from './icons';
import { PLANET_IDS } from '../scene/planets';

let topDate: HTMLElement, topTime: HTMLElement, topRate: HTMLElement, topObjects: HTMLElement, topStatus: HTMLElement;
let hudFocus: HTMLElement, hudDist: HTMLElement, hudPerf: HTMLElement, scaleLabel: HTMLElement, scaleBar: HTMLElement;
let lastHud = 0;

export function mountChrome() {
  topDate = $('#clock-date');
  topTime = $('#clock-time');
  topRate = $('#top-rate');
  topObjects = $('#top-objects');
  topStatus = $('#top-status');
  hudFocus = $('#hud-focus');
  hudDist = $('#hud-dist');
  hudPerf = $('#hud-perf');
  scaleLabel = $('#scalebar-label');
  scaleBar = $('#scalebar-bar');
  renderTools();
  renderLegend();
  bus.on('lang', () => {
    renderTools();
    renderLegend();
    lastStatus = null;
  });
  bus.on('settings', renderTools);
  bus.on('bodies', (list) => setText(topObjects, String(list.length)));
  bus.on('frame', updateTop);

  actions($('#view-tools'), {
    'view-sun': () => focusSun(),
    'view-earth': () => focusEarth(),
    'view-sel': () => focusSelected(),
    'tog-labels': () => updateSettings({ labels: !settings.labels }),
    'tog-orbits': () => updateSettings({ planetOrbits: !settings.planetOrbits }),
    'tog-grid': () => updateSettings({ grid: !settings.grid }),
  });
}

function renderTools() {
  const host = $('#view-tools');
  const b = (act: string, ic: Parameters<typeof icon>[0], label: string, pressed?: boolean) =>
    `<button class="btn icon" data-act="${act}" title="${esc(label)}" aria-label="${esc(label)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${icon(ic)}</button>`;
  host.innerHTML =
    b('view-sun', 'sun', `${t('view.sun')} (1)`) +
    b('view-earth', 'earth', `${t('view.earth')} (2)`) +
    b('view-sel', 'reticle', `${t('view.selected')} (3 / F)`) +
    '<div class="sep"></div>' +
    b('tog-labels', 'tag', `${t('view.labels')} (L)`, settings.labels) +
    b('tog-orbits', 'orbit', `${t('view.orbits')} (O)`, settings.planetOrbits) +
    b('tog-grid', 'grid', `${t('view.grid')} (G)`, settings.grid);
}

function renderLegend() {
  $('#legend').innerHTML = html`
    <span><i></i>${t('legend.neo')}</span>
    <span><i class="pha"></i>PHA</span>
    <span><i class="sentry"></i>Sentry</span>
    <span><i class="deflected"></i>${t('legend.deflected')}</span>`;
}

let lastStatus: string | null = null;

function updateTop() {
  const f = state.frame;
  if (!f) return;
  setText(topDate, formatDate(f.jd));
  setText(topTime, formatTime(f.jd, Math.abs(f.rate) < 0.01));
  setText(topRate, rateLabel(f.rate));
  const st = f.paused ? 'paused' : 'run';
  if (st !== lastStatus) {
    lastStatus = st;
    topStatus.dataset.state = st;
    topStatus.textContent = f.paused ? t('status.paused') : t('status.running');
  }
}

/** HUD text: focus name, camera distance, scale bar, render stats. Called from the render loop. */
export function updateHud(fps: number, simMs: number) {
  const now = performance.now();
  if (now - lastHud < 250) return;
  lastHud = now;
  const view = ctx.view;
  if (!view) return;
  const f = view.getFocus();
  let name = t('view.sun');
  if (f.kind === 'planet') name = t(`planet.${PLANET_IDS[f.index]}` as never);
  if (f.kind === 'body') name = state.bodies[f.index]?.name ?? '';
  setText(hudFocus, name);
  const dist = view.camera.position.distanceTo(view.controls.target);
  setText(hudDist, `${t('hud.camera')} ${humanDist(dist * AU_KM)}`);

  // scale bar: pick a round length that spans ~80-160 px at the target distance
  const { height } = view.viewport();
  const worldPerPx = (2 * dist * Math.tan((view.camera.fov * Math.PI) / 360)) / height;
  const target = worldPerPx * 120 * AU_KM; // km for 120 px
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= target * 0.66) ?? pow * 10;
  const px = nice / AU_KM / worldPerPx;
  scaleBar.style.width = `${Math.round(px)}px`;
  setText(scaleLabel, humanDist(nice));
  setText(hudPerf, `${view.tier.toUpperCase()} · ${fps > 0 ? `${fmt(fps, 0)} FPS · ${t('hud.physics')} ${fmt(simMs, 1)} ms` : t('hud.idle')}`);
}

function humanDist(km: number): string {
  if (km < 1e6) return `${sig(km, 2)} km`;
  if (km < 0.05 * AU_KM) return `${sig(km / LD_KM, 2)} LD`;
  return `${sig(km / AU_KM, 2)} AU`;
}

// ------------------------------------------------------------- impacts

export function showImpacts(events: SimEvent[]) {
  const banner = $('#impact-banner');
  const last = events.filter((e) => e.kind === 'impact').pop();
  if (!last) return;
  banner.hidden = false;
  banner.innerHTML = html`<b>${t('impact.title')}</b><span>${t('impact.body', { name: last.name, date: formatDateTime(last.jd), v: fmt(last.v_kms, 1) })}</span>
    <button class="btn sm" id="impact-show">${raw(icon('reticle'))}${t('impact.show')}</button>
    <button class="btn sm ghost icon" id="impact-close" aria-label="${t('common.close')}">${raw(icon('close'))}</button>`;
  $('#impact-close', banner).onclick = () => (banner.hidden = true);
  $('#impact-show', banner).onclick = () => {
    selectBody(last.id, true);
    banner.hidden = true;
  };
}

export function versionLabel(v: string) {
  setText($('#brand-ver'), v);
}
