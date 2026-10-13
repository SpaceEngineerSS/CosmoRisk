// Impact risk: JPL Sentry numbers when available, and our own Monte Carlo.

import { api, errorText, onMcProgress } from '../core/bridge';
import { t, type Key } from '../core/i18n';
import { state } from '../core/store';
import type { RiskReport, SentryDetail } from '../core/types';
import { diameter, energy, expo, fmt, probability, speed } from '../core/units';
import { parseLooseDate, formatDate } from '../core/time';
import { actions, esc, html, raw } from './dom';
import { icon } from './icons';
import { drawMissHistogram } from './charts';
import { toast } from './toast';

export const riskResults = new Map<string, { report?: RiskReport; sentry?: SentryDetail | null }>();

let root: HTMLElement;
let id = '';
let samples = 1000;
let years = 10;
let mode: 'covariance' | 'isotropic' = 'covariance';
let running = false;

const TORINO_KEYS: Key[] = [
  'torino.0', 'torino.1', 'torino.2', 'torino.3', 'torino.4', 'torino.5', 'torino.6', 'torino.7', 'torino.8', 'torino.9', 'torino.10',
];

export function torinoText(level: number): string {
  return t(TORINO_KEYS[Math.max(0, Math.min(10, level))]);
}

export function mountRisk(host: HTMLElement, bodyId: string) {
  root = host;
  id = bodyId;
  render();
  actions(root, {
    samples: (el) => {
      samples = +el.dataset.v!;
      pressed('samples', el);
    },
    years: (el) => {
      years = +el.dataset.v!;
      pressed('years', el);
    },
    mode: (el) => {
      mode = el.dataset.v as typeof mode;
      pressed('mode', el);
      const iso = root.querySelector('#mc-iso') as HTMLElement;
      iso.hidden = mode !== 'isotropic';
    },
    run: () => run(),
    cancel: () => api.cancelMonteCarlo(),
  });
  const b = state.bodies[state.index.get(bodyId) ?? -1];
  if (b?.sentry && !riskResults.get(bodyId)?.sentry) loadSentry(bodyId);
}

function pressed(act: string, el: HTMLElement) {
  root.querySelectorAll(`[data-act="${act}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
}

function seg(act: string, opts: [string | number, string][], cur: string | number) {
  return `<div class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div>`;
}

function render() {
  const r = riskResults.get(id);
  const y = t('unit.yearShort');
  root.innerHTML = html`
    <div id="sentry-box">${raw(sentryHtml(r?.sentry))}</div>
    <div class="field" style="margin-top:6px"><span>${t('mc.samples')}</span>${raw(seg('samples', [[250, '250'], [1000, '1000'], [4000, '4000']], samples))}</div>
    <div class="field" style="margin-top:8px"><span>${t('mc.window')}</span>${raw(seg('years', [[5, `5 ${y}`], [10, `10 ${y}`], [30, `30 ${y}`]], years))}</div>
    <div class="field" style="margin-top:8px"><span>${t('mc.uncertainty')}</span>${raw(seg('mode', [['covariance', t('mc.mode.cov')], ['isotropic', t('mc.mode.iso')]], mode))}</div>
    <div class="field-row" id="mc-iso" style="margin-top:8px" ${mode === 'isotropic' ? '' : 'hidden'}>
      <label class="field"><span>σ ${t('mc.pos')} (km)</span><input class="input mono" id="mc-pos" type="number" min="0" step="100" value="1000" /></label>
      <label class="field"><span>σ ${t('mc.vel')} (m/s)</span><input class="input mono" id="mc-vel" type="number" min="0" step="0.01" value="0.05" /></label>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn primary" data-act="run" id="mc-run">${raw(icon('scatter'))}${t('mc.run')}</button>
      <button class="btn" data-act="cancel" id="mc-cancel" hidden>${raw(icon('stop'))}${t('common.cancel')}</button>
    </div>
    <div class="progress" id="mc-progress" hidden style="margin-top:8px"><i></i></div>
    <div id="mc-out">${raw(r?.report ? reportHtml(r.report) : `<p class="note" style="margin-top:8px">${esc(t('mc.hint'))}</p>`)}</div>`;
  if (r?.report) drawHist(r.report);
}

async function loadSentry(bodyId: string) {
  try {
    const s = await api.sentryDetail(bodyId);
    const r = riskResults.get(bodyId) ?? {};
    r.sentry = s;
    riskResults.set(bodyId, r);
  } catch {
    const r = riskResults.get(bodyId) ?? {};
    r.sentry = null;
    riskResults.set(bodyId, r);
  }
  if (id === bodyId && root.isConnected) {
    const box = root.querySelector('#sentry-box');
    if (box) box.innerHTML = sentryHtml(riskResults.get(bodyId)?.sentry);
  }
}

function sentryHtml(s: SentryDetail | null | undefined): string {
  if (!s) return '';
  if (s.removed) return `<div class="callout ok">${esc(t('sentry.removed', { date: s.removed.slice(0, 10) }))}</div>`;
  const top = [...s.impacts].sort((a, b) => b.ip - a.ip)[0];
  return `<div class="callout">
    <div style="font-weight:600;margin-bottom:6px">${esc(t('sentry.official'))}</div>
    <div class="risk-line" style="margin:4px 0">
      <span class="torino" data-level="${s.ts_max}">${s.ts_max}</span>
      <div class="desc">${esc(torinoText(s.ts_max))}</div>
    </div>
    <dl class="kv">
      <dt>${esc(t('sentry.ipCum'))}</dt><dd>${esc(probability(s.ip))}</dd>
      <dt>${esc(t('sentry.psCum'))}</dt><dd>${esc(fmt(s.ps_cum, 2))}</dd>
      <dt>${esc(t('sentry.nImp'))}</dt><dd>${s.impacts.length}</dd>
      ${top ? `<dt>${esc(t('sentry.topDate'))}</dt><dd>${esc(formatDate(parseLooseDate(top.date) ?? 0))}</dd>` : ''}
      ${s.energy_mt !== null ? `<dt>${esc(t('risk.energy'))}</dt><dd>${esc(energy(s.energy_mt))}</dd>` : ''}
    </dl>
    <div class="note" style="margin-top:6px">${esc(t('sentry.source', { date: s.computed.slice(0, 10) }))}</div>
  </div>`;
}

async function run() {
  if (running) return;
  running = true;
  const bodyId = id;
  const runBtn = root.querySelector('#mc-run') as HTMLButtonElement;
  const cancelBtn = root.querySelector('#mc-cancel') as HTMLElement;
  const prog = root.querySelector('#mc-progress') as HTMLElement;
  const bar = prog.querySelector('i') as HTMLElement;
  runBtn.disabled = true;
  cancelBtn.hidden = false;
  prog.hidden = false;
  bar.style.width = '0%';
  const unlisten = await onMcProgress((done, total) => {
    if (bar.isConnected) bar.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
  });
  try {
    const m =
      mode === 'covariance'
        ? ({ mode: 'covariance' } as const)
        : {
            mode: 'isotropic' as const,
            pos_km: +((root.querySelector('#mc-pos') as HTMLInputElement)?.value || 1000),
            vel_ms: +((root.querySelector('#mc-vel') as HTMLInputElement)?.value || 0.05),
          };
    const report = await api.monteCarlo(bodyId, samples, years, m);
    const r = riskResults.get(bodyId) ?? {};
    r.report = report;
    riskResults.set(bodyId, r);
    if (id === bodyId && root.isConnected) {
      (root.querySelector('#mc-out') as HTMLElement).innerHTML = reportHtml(report);
      drawHist(report);
    }
    if (report.mc.cancelled) toast(t('mc.cancelled'), 'warn');
  } catch (e) {
    toast(errorText(e), 'error', t('mc.failed'));
  } finally {
    unlisten();
    running = false;
    if (root.isConnected) {
      runBtn.disabled = false;
      cancelBtn.hidden = true;
      prog.hidden = true;
    }
  }
}

function reportHtml(r: RiskReport): string {
  const mc = r.mc;
  const ip = mc.impact_probability;
  const ipText = mc.impacts === 0 ? `< ${expo(mc.ip_high, 1)}` : probability(ip);
  const rows: [string, string][] = [
    [t('risk.samples'), `${mc.samples} · ${mc.method === 'covariance' ? t('mc.mode.cov') : mc.method === 'isotropic' ? t('mc.mode.iso') : mc.method}`],
    [t('risk.impacts'), `${mc.impacts}`],
    [t('risk.ci'), `${expo(mc.ip_low, 1)} – ${expo(mc.ip_high, 1)}`],
    [t('risk.minMiss'), isFinite(mc.min_km) ? `${fmt(mc.min_km, 0)} km` : '—'],
    [t('risk.medianMiss'), isFinite(mc.median_km) ? `${fmt(mc.median_km, 0)} km` : '—'],
    [t('risk.diameter'), diameter(r.diameter_km)],
    [t('risk.vinf'), speed(r.v_inf_kms)],
    [t('risk.energy'), energy(r.energy_mt)],
    [t('risk.palermo'), r.palermo === null ? '—' : fmt(r.palermo, 2)],
  ];
  return `
    <div class="risk-line">
      <span class="torino" data-level="${r.torino}" title="Torino">${r.torino}</span>
      <div class="desc"><b>${esc(t('risk.ip'))}: ${esc(ipText)}</b><br>${esc(torinoText(r.torino))}</div>
    </div>
    <canvas class="chart" id="mc-hist" aria-label="${esc(t('risk.histogram'))}"></canvas>
    <div class="note" style="margin:-4px 0 8px">${esc(t('risk.histogram'))}</div>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="note" style="margin-top:8px">${esc(mc.impacts === 0 ? t('risk.zeroNote', { n: mc.samples }) : t('risk.note'))}</p>`;
}

function drawHist(r: RiskReport) {
  const c = root.querySelector('#mc-hist') as HTMLCanvasElement | null;
  if (c) requestAnimationFrame(() => drawMissHistogram(c, r.mc.min_distances_km));
}
