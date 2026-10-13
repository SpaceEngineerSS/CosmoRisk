// Right rail: everything about the selected object.

import { ctx, focusSelected, loadDesignation, loadPreset, refreshBodies, removeBodies, selectBody } from '../app';
import { api, errorText } from '../core/bridge';
import { t, type Key } from '../core/i18n';
import { settings } from '../core/settings';
import { bus, state } from '../core/store';
import type { BodyDetail, CloseApproach, ScanSummary } from '../core/types';
import { AU_KM, angleDeg, diameter, distance, fmt, mass, sig, speed, velocityChange } from '../core/units';
import { formatDate, formatDateTime, formatTime, parseLooseDate } from '../core/time';
import { $, actions, esc, html, raw, setText } from './dom';
import { icon } from './icons';
import { mountDeflection } from './deflect';
import { mountRisk } from './risk';
import { exportReport } from './export';
import { toast } from './toast';

export interface Results {
  scan?: ScanSummary;
  scanYears?: number;
  cad?: CloseApproach[];
}
export const results = new Map<string, Results>();
export let lastDetail: BodyDetail | null = null;

let root: HTMLElement;
let pollTimer = 0;
let orbitTimer = 0;
const open: Record<string, boolean> = { state: true, orbit: true, physical: false, approaches: true, risk: true, deflect: false };
let scanYears = 25;
let scanning = false;

export function mountInspector(host: HTMLElement) {
  root = host;
  render();
  actions(root, {
    toggle: (el) => {
      const sec = el.closest('.sec') as HTMLElement;
      const k = sec.dataset.key!;
      open[k] = !open[k];
      sec.dataset.open = String(open[k]);
      el.setAttribute('aria-expanded', String(open[k]));
    },
    focus: () => focusSelected(),
    deselect: () => selectBody(null),
    remove: () => state.selected && removeBodies([state.selected]),
    report: () => exportReport(),
    'scan-years': (el) => {
      scanYears = +el.dataset.v!;
      root.querySelectorAll('[data-act="scan-years"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    },
    scan: () => runScan(),
    cad: () => runCad(),
    jump: (el) => {
      const jd = +el.dataset.jd!;
      import('../app').then((m) => m.jumpTo(jd - 1));
    },
    'quick-pha': () => loadPreset('pha', 1000),
    'quick-apophis': () => loadDesignation('99942'),
    'quick-yr4': () => loadDesignation('2024 YR4'),
  });

  bus.on('select', () => render());
  bus.on('bodies', () => {
    if (state.selected) refreshDetail();
  });
  bus.on('lang', () => render());
  bus.on('settings', () => render());
}

function sec(key: string, n: string, title: Key, body: string): string {
  return `<section class="sec" data-key="${key}" data-open="${open[key]}">
    <button class="sec-h" data-act="toggle" aria-expanded="${open[key]}"><span class="sec-n">${n}</span><span class="sec-t">${esc(t(title))}</span>${icon('chevron')}</button>
    <div class="sec-b" id="sec-${key}">${body}</div></section>`;
}

function render() {
  clearTimeout(pollTimer);
  lastDetail = null;
  if (!state.selected) {
    ctx.view?.setSelectedOrbit(null);
    root.innerHTML = html`
      <div class="scroll">
        <div class="insp-head">
          <div class="insp-kicker">${t('insp.nothing.kicker')}</div>
          <div class="insp-name">${t('insp.nothing.title')}</div>
          <p class="hint">${t('insp.nothing.body')}</p>
        </div>
        <div class="block">
          <div class="btn-row" style="flex-direction:column">
            <button class="btn" data-act="quick-pha">${raw(icon('download'))}${t('insp.quick.pha')}</button>
            <button class="btn" data-act="quick-apophis">${raw(icon('search'))}${t('insp.quick.apophis')}</button>
            <button class="btn" data-act="quick-yr4">${raw(icon('search'))}${t('insp.quick.yr4')}</button>
          </div>
        </div>
        <div class="block"><p class="note">${t('insp.nothing.foot')}</p></div>
      </div>`;
    return;
  }
  const i = state.index.get(state.selected);
  const b = i !== undefined ? state.bodies[i] : null;
  if (!b) return;
  root.innerHTML = html`
    <div class="scroll" id="insp-scroll">
      <div class="insp-head">
        <div class="insp-kicker"><span>${b.orbit_class ?? 'NEO'}</span><span>·</span><span class="mono">${b.id}</span></div>
        <div class="insp-name">${b.name}</div>
        <div class="insp-tags" id="insp-tags"></div>
        <div class="insp-actions">
          <button class="btn sm" data-act="focus">${raw(icon('reticle'))}${t('insp.focus')}</button>
          <button class="btn sm" data-act="report">${raw(icon('report'))}${t('insp.report')}</button>
          <span style="flex:1"></span>
          <button class="btn sm icon ghost" data-act="remove" title="${t('insp.remove')}" aria-label="${t('insp.remove')}">${raw(icon('trash'))}</button>
          <button class="btn sm icon ghost" data-act="deselect" title="${t('common.close')}" aria-label="${t('common.close')}">${raw(icon('close'))}</button>
        </div>
      </div>
      ${raw(sec('state', '01', 'insp.sec.state', '<dl class="kv" id="kv-state"></dl>'))}
      ${raw(sec('orbit', '02', 'insp.sec.orbit', '<dl class="kv" id="kv-orbit"></dl>'))}
      ${raw(sec('physical', '03', 'insp.sec.physical', '<dl class="kv" id="kv-phys"></dl><p class="note" id="phys-note"></p>'))}
      ${raw(sec('approaches', '04', 'insp.sec.approaches', approachesBody()))}
      ${raw(sec('risk', '05', 'insp.sec.risk', '<div id="risk-host"></div>'))}
      ${raw(sec('deflect', '06', 'insp.sec.deflect', '<div id="deflect-host"></div>'))}
    </div>`;
  renderTags();
  mountRisk($('#risk-host', root), b.id);
  mountDeflection($('#deflect-host', root), b.id);
  renderScan();
  refreshDetail();
  refreshOrbit();
  schedulePoll();
}

function renderTags() {
  const host = root.querySelector('#insp-tags');
  const b = state.selected ? state.bodies[state.index.get(state.selected) ?? -1] : null;
  if (!host || !b) return;
  const tags: string[] = [];
  if (b.neo) tags.push(`<span class="tag">NEO</span>`);
  if (b.pha) tags.push(`<span class="tag pha" title="${esc(t('tag.pha.title'))}">PHA</span>`);
  if (b.sentry) tags.push(`<span class="tag sentry" title="${esc(t('tag.sentry.title'))}">Sentry</span>`);
  if (b.deflected || b.thrusting) tags.push(`<span class="tag ok">${esc(t('tag.deflected'))}</span>`);
  if (b.impacted !== null) tags.push(`<span class="tag impact">${esc(t('tag.impacted'))}</span>`);
  host.innerHTML = tags.join('');
}

function approachesBody() {
  const opts = [10, 25, 50, 100];
  return `<div class="field"><span>${esc(t('scan.horizon'))}</span>
      <div class="seg">${opts.map((v) => `<button data-act="scan-years" data-v="${v}" aria-pressed="${scanYears === v}">${v} ${esc(t('unit.yearShort'))}</button>`).join('')}</div></div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn primary" data-act="scan">${icon('approach')}${esc(t('scan.run'))}</button>
      <button class="btn" data-act="cad" title="${esc(t('scan.jpl.title'))}">${icon('external')}${esc(t('scan.jpl'))}</button>
    </div>
    <div class="progress" id="scan-busy" hidden style="margin-top:8px"><i></i></div>
    <div id="scan-out"></div>`;
}

// --------------------------------------------------------------- live data

function schedulePoll() {
  clearTimeout(pollTimer);
  clearTimeout(orbitTimer);
  if (!state.selected) return;
  pollTimer = window.setTimeout(async () => {
    await refreshDetail();
    schedulePoll();
  }, state.frame?.paused ? 1500 : 400);
  // The osculating orbit drifts slowly; refresh it now and then while running.
  if (!state.frame?.paused) orbitTimer = window.setTimeout(refreshOrbit, 2000);
}

async function refreshOrbit() {
  const id = state.selected;
  if (!id || !ctx.view) return;
  try {
    const path = await api.orbitPath(id, 512);
    if (state.selected === id) ctx.view.setSelectedOrbit(path);
  } catch {
    ctx.view.setSelectedOrbit(null);
  }
}

export async function refreshDetail() {
  const id = state.selected;
  if (!id) return;
  let d: BodyDetail;
  try {
    d = await api.detail(id);
  } catch {
    return;
  }
  if (state.selected !== id) return;
  lastDetail = d;
  const u = settings.unit;
  const kvState = root.querySelector('#kv-state') as HTMLElement | null;
  if (kvState) {
    kvState.innerHTML = kv([
      [t('kv.earthDist'), distance(d.earth_distance_km, u)],
      [t('kv.earthSpeed'), speed(d.earth_speed_kms)],
      [t('kv.sunDist'), `${fmt(d.sun_distance_au, 4)} AU`],
      [t('kv.helioSpeed'), speed(d.speed_kms)],
      ...(d.delta_v_ms > 0 ? ([[t('kv.dvApplied'), velocityChange(d.delta_v_ms)]] as [string, string][]) : []),
      ...(d.thrust ? ([[t('kv.thrustUntil'), formatDate(d.thrust.end)]] as [string, string][]) : []),
      ...(d.impacted ? ([[t('kv.impactedAt'), formatDateTime(d.impacted)]] as [string, string][]) : []),
    ]);
  }
  const kvOrbit = root.querySelector('#kv-orbit') as HTMLElement | null;
  if (kvOrbit && d.osculating) {
    const [a, e, i, node, peri, , period] = d.osculating;
    const rec = d.record;
    kvOrbit.innerHTML = kv([
      [t('kv.a'), `${fmt(a, 4)} AU`],
      [t('kv.e'), fmt(e, 4)],
      [t('kv.i'), angleDeg(i)],
      [t('kv.q'), `${fmt(a * (1 - e), 4)} AU`],
      [t('kv.Q'), `${fmt(a * (1 + e), 4)} AU`],
      [t('kv.period'), `${fmt(period, 1)} d · ${fmt(period / 365.25, 2)} ${t('unit.yearShort')}`],
      [t('kv.node'), angleDeg(node)],
      [t('kv.peri'), angleDeg(peri)],
      [t('kv.moid'), rec.moid_au !== null ? distance(rec.moid_au * AU_KM, u) : '—'],
      [t('kv.cc'), rec.condition_code !== null ? `${rec.condition_code}` : '—'],
      [t('kv.epoch'), formatDate(rec.elements.epoch)],
      [t('kv.source'), rec.source],
    ]);
  }
  const kvPhys = root.querySelector('#kv-phys') as HTMLElement | null;
  if (kvPhys) {
    const rec = d.record;
    kvPhys.innerHTML = kv([
      [t('kv.diameter'), `${diameter(d.diameter_km)}${rec.diameter_estimated ? ` (${t('kv.est')})` : ''}`],
      [t('kv.H'), rec.h !== null ? fmt(rec.h, 2) : '—'],
      [t('kv.albedo'), rec.albedo !== null ? fmt(rec.albedo, 3) : '—'],
      [t('kv.spectral'), rec.spectral ?? '—'],
      [t('kv.rotation'), rec.rotation_h !== null ? `${sig(rec.rotation_h, 4)} h` : '—'],
      [t('kv.density'), `${fmt(d.density, 0)} kg/m³ (${t('kv.assumed')})`],
      [t('kv.mass'), `${mass(d.mass_kg)} (${t('kv.est')})`],
    ]);
    const note = root.querySelector('#phys-note');
    if (note) note.textContent = rec.diameter_estimated ? t('phys.note.estimated') : t('phys.note');
  }
  renderTags();
}

function kv(rows: [string, string][]): string {
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

// ---------------------------------------------------------------- scanning

async function runScan() {
  const id = state.selected;
  if (!id || scanning) return;
  scanning = true;
  const busy = root.querySelector('#scan-busy') as HTMLElement;
  busy.hidden = false;
  busy.classList.add('indeterminate');
  try {
    const scan = await api.scan(id, scanYears);
    const r = results.get(id) ?? {};
    r.scan = scan;
    r.scanYears = scanYears;
    results.set(id, r);
    state.scan = { id, scan };
    bus.emit('scan', state.scan);
    if (state.selected === id) renderScan();
  } catch (e) {
    toast(errorText(e), 'error', t('scan.failed'));
  } finally {
    scanning = false;
    const b = root.querySelector('#scan-busy') as HTMLElement | null;
    if (b) b.hidden = true;
  }
}

async function runCad() {
  const id = state.selected;
  if (!id) return;
  const busy = root.querySelector('#scan-busy') as HTMLElement;
  busy.hidden = false;
  busy.classList.add('indeterminate');
  try {
    const cad = await api.objectApproaches(id, Math.min(scanYears, 100));
    const r = results.get(id) ?? {};
    r.cad = cad.filter((c) => c.dist_au <= 0.05);
    results.set(id, r);
    if (state.selected === id) renderScan();
  } catch (e) {
    toast(errorText(e), 'error', t('scan.jplFailed'));
  } finally {
    const b = root.querySelector('#scan-busy') as HTMLElement | null;
    if (b) b.hidden = true;
  }
}

function renderScan() {
  const out = root.querySelector('#scan-out') as HTMLElement | null;
  const id = state.selected;
  if (!out || !id) return;
  const r = results.get(id);
  if (!r?.scan && !r?.cad) {
    out.innerHTML = `<p class="note" style="margin-top:8px">${esc(t('scan.hint'))}</p>`;
    return;
  }
  const u = settings.unit;
  let s = '';
  if (r.scan) {
    const scan = r.scan;
    if (scan.closest) {
      const c = scan.closest;
      s += `<div class="metrics">
        <div class="metric"><div class="k">${esc(t('scan.closest'))}</div><div class="v">${esc(distance(c.dist_km, u))}</div></div>
        <div class="metric"><div class="k">${esc(t('scan.when'))}</div><div class="v">${esc(formatDate(c.jd))}<small> ${esc(formatTime(c.jd))}</small></div></div>
      </div>`;
    }
    if (scan.impact) s += `<div class="callout bad">${esc(t('scan.impact'))}</div>`;
    if (!scan.encounters.length) {
      s += `<p class="note">${esc(t('scan.none', { years: r.scanYears ?? scanYears }))}</p>`;
    } else {
      s += `<div class="enc-list">${scan.encounters
        .map(
          (e) => `<div class="enc-row${e.impact ? ' impact' : ''}" data-act="jump" data-jd="${e.jd}" title="${esc(t('scan.jumpTo'))}">
            <span>${esc(formatDate(e.jd))}</span><span>${esc(speed(e.v_rel_kms))}</span><span class="d">${esc(distance(e.dist_km, u))}</span></div>`,
        )
        .join('')}</div>`;
    }
  }
  if (r.cad) {
    s += `<h4 class="note" style="margin:12px 0 4px; text-transform:uppercase; letter-spacing:.1em">${esc(t('scan.compare'))}</h4>`;
    if (!r.cad.length) s += `<p class="note">${esc(t('scan.jplNone'))}</p>`;
    else {
      s += `<div class="compare"><span class="h">${esc(t('scan.date'))}</span><span class="h num">JPL</span><span class="h num">CosmoRisk</span>`;
      for (const c of r.cad) {
        const jd = parseLooseDate(c.date) ?? c.jd;
        const ours = r.scan?.encounters.find((e) => Math.abs(e.jd - jd) < 3);
        s += `<span class="mono">${esc(formatDate(jd))}</span><span class="num">${esc(distance(c.dist_au * AU_KM, u))}</span><span class="num">${esc(ours ? distance(ours.dist_km, u) : '—')}</span>`;
      }
      s += `</div><p class="note">${esc(t('scan.compareNote'))}</p>`;
    }
  }
  out.innerHTML = s;
}

// keep tags/list in sync after actions elsewhere
export async function afterBodyChange() {
  await refreshBodies();
  await refreshDetail();
  refreshOrbit();
}

export function setText2(id: string, v: string) {
  const e = root.querySelector(id) as HTMLElement | null;
  if (e) setText(e, v);
}
