// Deflection planner: pick a method, preview the effect on the closest
// approach, then commit it to the simulation.

import { afterBodyChange } from './inspector';
import { api, errorText } from '../core/bridge';
import { t } from '../core/i18n';
import { settings } from '../core/settings';
import type { Deflection, DeflectionPlan, Rtn } from '../core/types';
import { distance, fmt, velocityChange } from '../core/units';
import { formatDate } from '../core/time';
import { actions, esc, html, raw } from './dom';
import { icon } from './icons';
import { drawBPlane } from './charts';
import { confirmDialog } from './modal';
import { toast } from './toast';

type Method = Deflection['method'];
type Dir = 'prograde' | 'retrograde' | 'radial' | 'normal';

export const plans = new Map<string, { deflection: Deflection; plan: DeflectionPlan }>();

let root: HTMLElement;
let id = '';
let method: Method = 'kinetic_impactor';
let dir: Dir = 'retrograde';
let years = 10;
let busy = false;

const DIRS: Record<Dir, Rtn> = {
  prograde: [0, 1, 0],
  retrograde: [0, -1, 0],
  radial: [1, 0, 0],
  normal: [0, 0, 1],
};

const values: Record<string, number> = {
  ki_mass: 580,
  ki_speed: 6.1,
  ki_beta: 3.6,
  dv: 0.01,
  ib_thrust: 0.2,
  ib_eff: 0.8,
  ib_days: 365,
  gt_mass: 20000,
  gt_hover: 150,
  gt_days: 3650,
};

export function mountDeflection(host: HTMLElement, bodyId: string) {
  root = host;
  id = bodyId;
  render();
  actions(root, {
    method: (el) => {
      method = el.dataset.v as Method;
      render();
    },
    dir: (el) => {
      dir = el.dataset.v as Dir;
      root.querySelectorAll('[data-act="dir"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    },
    years: (el) => {
      years = +el.dataset.v!;
      root.querySelectorAll('[data-act="years"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    },
    preview: () => preview(),
    apply: () => apply(),
  });
  root.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.dataset.k) values[inp.dataset.k] = +inp.value;
  });
}

function num(k: string, label: string, step: number, min = 0) {
  return `<label class="field"><span>${esc(label)}</span><input class="input mono" type="number" data-k="${k}" step="${step}" min="${min}" value="${values[k]}" /></label>`;
}

function fields(): string {
  switch (method) {
    case 'kinetic_impactor':
      return `<div class="field-row three">${num('ki_mass', t('dfl.scMass'), 10, 1)}${num('ki_speed', t('dfl.impSpeed'), 0.1, 0.1)}${num('ki_beta', 'β', 0.1, 1)}</div>
        <p class="note">${esc(t('dfl.ki.note'))}</p>`;
    case 'impulse':
      return `<div class="field-row" style="grid-template-columns:1fr">${num('dv', t('dfl.dv'), 0.001)}</div>`;
    case 'ion_beam':
      return `<div class="field-row three">${num('ib_thrust', t('dfl.thrust'), 0.01)}${num('ib_eff', t('dfl.eff'), 0.05)}${num('ib_days', t('dfl.days'), 30, 1)}</div>
        <p class="note">${esc(t('dfl.ib.note'))}</p>`;
    case 'gravity_tractor':
      return `<div class="field-row three">${num('gt_mass', t('dfl.scMass'), 500, 1)}${num('gt_hover', t('dfl.hover'), 10, 10)}${num('gt_days', t('dfl.days'), 30, 1)}</div>
        <p class="note">${esc(t('dfl.gt.note'))}</p>`;
  }
}

function render() {
  const m: [Method, string][] = [
    ['kinetic_impactor', t('dfl.m.ki')],
    ['ion_beam', t('dfl.m.ib')],
    ['gravity_tractor', t('dfl.m.gt')],
    ['impulse', 'Δv'],
  ];
  const d: [Dir, string][] = [
    ['retrograde', t('dfl.d.retro')],
    ['prograde', t('dfl.d.pro')],
    ['radial', t('dfl.d.radial')],
    ['normal', t('dfl.d.normal')],
  ];
  const y = t('unit.yearShort');
  const plan = plans.get(id);
  root.innerHTML = html`
    <div class="field"><span>${t('dfl.method')}</span>
      <div class="seg">${raw(m.map(([v, l]) => `<button data-act="method" data-v="${v}" aria-pressed="${v === method}">${esc(l)}</button>`).join(''))}</div></div>
    <div style="margin-top:8px">${raw(fields())}</div>
    <div class="field" style="margin-top:6px"><span>${t('dfl.direction')}</span>
      <div class="seg">${raw(d.map(([v, l]) => `<button data-act="dir" data-v="${v}" aria-pressed="${v === dir}">${esc(l)}</button>`).join(''))}</div></div>
    <div class="field" style="margin-top:8px"><span>${t('dfl.window')}</span>
      <div class="seg">${raw([5, 10, 25, 50].map((v) => `<button data-act="years" data-v="${v}" aria-pressed="${v === years}">${v} ${esc(y)}</button>`).join(''))}</div></div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn" data-act="preview" id="dfl-preview">${raw(icon('deflect'))}${t('dfl.preview')}</button>
      <button class="btn primary" data-act="apply" id="dfl-apply">${raw(icon('check'))}${t('dfl.apply')}</button>
    </div>
    <div class="progress" id="dfl-busy" hidden style="margin-top:8px"><i></i></div>
    <div id="dfl-out">${raw(plan ? planHtml(plan.plan) : `<p class="note" style="margin-top:8px">${esc(t('dfl.hint'))}</p>`)}</div>`;
  if (plan) drawPlan(plan.plan);
}

function current(): Deflection {
  const rtn = DIRS[dir];
  const v = values;
  switch (method) {
    case 'kinetic_impactor':
      return { method, mass_kg: v.ki_mass, speed_kms: v.ki_speed, beta: v.ki_beta, rtn };
    case 'impulse':
      return { method, dv_ms: v.dv, rtn };
    case 'ion_beam':
      return { method, thrust_n: v.ib_thrust, efficiency: v.ib_eff, days: v.ib_days, rtn };
    case 'gravity_tractor':
      return { method, mass_kg: v.gt_mass, hover_m: v.gt_hover, days: v.gt_days, rtn };
  }
}

function setBusy(b: boolean) {
  busy = b;
  const bar = root.querySelector('#dfl-busy') as HTMLElement | null;
  if (bar) {
    bar.hidden = !b;
    bar.classList.toggle('indeterminate', b);
  }
  root.querySelectorAll<HTMLButtonElement>('#dfl-preview, #dfl-apply').forEach((x) => (x.disabled = b));
}

async function preview() {
  if (busy) return;
  const bodyId = id;
  const deflection = current();
  setBusy(true);
  try {
    const plan = await api.planDeflection(bodyId, deflection, years);
    plans.set(bodyId, { deflection, plan });
    if (id === bodyId && root.isConnected) {
      (root.querySelector('#dfl-out') as HTMLElement).innerHTML = planHtml(plan);
      drawPlan(plan);
    }
  } catch (e) {
    toast(errorText(e), 'error', t('dfl.failed'));
  } finally {
    if (root.isConnected) setBusy(false);
  }
}

async function apply() {
  if (busy) return;
  const deflection = current();
  const ok = await confirmDialog(t('dfl.confirm.title'), t('dfl.confirm.body'), t('dfl.apply'));
  if (!ok) return;
  setBusy(true);
  try {
    const dv = await api.applyDeflection(id, deflection);
    toast(t('dfl.applied', { dv: velocityChange(dv) }), 'ok');
    plans.delete(id);
    await afterBodyChange();
    if (root.isConnected) render();
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    if (root.isConnected) setBusy(false);
  }
}

function planHtml(p: DeflectionPlan): string {
  const u = settings.unit;
  const before = p.miss_before_km;
  const after = p.miss_after_km;
  const change = before !== null && after !== null ? after - before : null;
  let verdict = '';
  if (p.baseline.impact && !p.deflected.impact) verdict = `<div class="callout ok">${esc(t('dfl.saved'))}</div>`;
  else if (p.deflected.impact) verdict = `<div class="callout bad">${esc(t('dfl.stillImpact'))}</div>`;
  return `
    <div class="metrics">
      <div class="metric"><div class="k">Δv</div><div class="v">${esc(velocityChange(p.dv_ms))}</div></div>
      <div class="metric"><div class="k">${esc(t('dfl.target'))}</div><div class="v">${esc(p.target_jd ? formatDate(p.target_jd) : '—')}</div></div>
      <div class="metric"><div class="k">${esc(t('dfl.before'))}</div><div class="v">${esc(distance(before, u))}</div></div>
      <div class="metric"><div class="k">${esc(t('dfl.after'))}</div><div class="v">${esc(distance(after, u))}</div></div>
    </div>
    ${verdict}
    ${change !== null ? `<p class="hint">${esc(t(change >= 0 ? 'dfl.change.up' : 'dfl.change.down', { km: fmt(Math.abs(change), 0) }))}</p>` : ''}
    ${p.accel_ms2 !== null ? `<p class="note">${esc(t('dfl.accel', { a: p.accel_ms2.toExponential(2), days: fmt(p.duration_days ?? 0, 0) }))}</p>` : ''}
    <canvas class="chart square" id="dfl-bplane" aria-label="${esc(t('dfl.bplane'))}"></canvas>
    <p class="note">${esc(t('dfl.bplane.note'))}</p>`;
}

function drawPlan(p: DeflectionPlan) {
  const c = root.querySelector('#dfl-bplane') as HTMLCanvasElement | null;
  if (!c) return;
  const before = p.baseline.closest;
  const after =
    p.target_jd !== null
      ? p.deflected.encounters.filter((e) => Math.abs(e.jd - p.target_jd!) < 60).sort((a, b) => a.dist_km - b.dist_km)[0] ?? p.deflected.closest
      : p.deflected.closest;
  requestAnimationFrame(() => drawBPlane(c, before, after ?? null));
}
