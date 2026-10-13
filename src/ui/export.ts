// Files the user can take away: screenshots, object reports, catalogue CSV.

import { save } from '@tauri-apps/plugin-dialog';
import { ctx } from '../app';
import { api, errorText } from '../core/bridge';
import { t } from '../core/i18n';
import { state } from '../core/store';
import { formatDate, formatDateTime } from '../core/time';
import { AU_KM, diameter, energy, fmt, mass, probability, speed, velocityChange } from '../core/units';
import { lastDetail, results } from './inspector';
import { plans } from './deflect';
import { riskResults, torinoText } from './risk';
import { toast } from './toast';

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function safe(s: string) {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'object';
}

export async function saveScreenshot() {
  if (!ctx.view) return;
  try {
    const path = await save({
      title: t('export.screenshot'),
      defaultPath: `cosmorisk-${stamp()}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!path) return;
    const blob = await ctx.view.screenshot();
    await api.writeBinary(path, new Uint8Array(await blob.arrayBuffer()));
    toast(t('export.saved', { path }), 'ok');
  } catch (e) {
    toast(errorText(e), 'error', t('export.failed'));
  }
}

export async function exportCsv() {
  if (!state.bodies.length) {
    toast(t('export.nothing'), 'warn');
    return;
  }
  try {
    const path = await save({
      title: t('export.csv'),
      defaultPath: `cosmorisk-catalogue-${stamp()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!path) return;
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ['designation,name,pha,sentry,orbit_class,a_au,e,i_deg,H,diameter_km,diameter_estimated,moid_au,impacted_jd,deflected'];
    for (const b of state.bodies) {
      lines.push(
        [
          q(b.id), q(b.name), b.pha, b.sentry, q(b.orbit_class ?? ''), b.a.toFixed(6), b.e.toFixed(6), b.i_deg.toFixed(4),
          b.h ?? '', b.diameter_km.toFixed(4), b.diameter_estimated, b.moid_au ?? '', b.impacted ?? '', b.deflected,
        ].join(','),
      );
    }
    await api.writeText(path, lines.join('\n') + '\n');
    toast(t('export.saved', { path }), 'ok');
  } catch (e) {
    toast(errorText(e), 'error', t('export.failed'));
  }
}

/** Markdown report of the selected object with whatever analysis has been run. */
export async function exportReport() {
  const d = lastDetail;
  if (!d || !state.selected) return;
  const id = state.selected;
  const rec = d.record;
  const r = results.get(id);
  const risk = riskResults.get(id);
  const plan = plans.get(id);
  const jd = state.frame?.jd ?? 0;
  const L: string[] = [];
  L.push(`# ${rec.name}`, '');
  L.push(`CosmoRisk report · simulation time ${formatDateTime(jd)} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  L.push('## Object', '');
  L.push('| | |', '|---|---|');
  L.push(`| Designation | ${rec.id} |`);
  L.push(`| Orbit class | ${rec.orbit_class ?? '—'} |`);
  L.push(`| Flags | ${[rec.neo && 'NEO', rec.pha && 'PHA', rec.sentry && 'Sentry'].filter(Boolean).join(', ') || '—'} |`);
  L.push(`| Diameter | ${diameter(d.diameter_km)}${rec.diameter_estimated ? ' (estimated from H)' : ''} |`);
  L.push(`| Absolute magnitude H | ${rec.h ?? '—'} |`);
  L.push(`| Mass (estimate) | ${mass(d.mass_kg)} at ${fmt(d.density, 0)} kg/m³ |`);
  L.push(`| Orbit source | ${rec.source}, epoch ${formatDate(rec.elements.epoch)} |`, '');
  L.push('## State at simulation time', '');
  L.push(`- Distance from Earth: ${fmt(d.earth_distance_km, 0)} km (${fmt(d.earth_distance_km / AU_KM, 5)} AU)`);
  L.push(`- Speed relative to Earth: ${speed(d.earth_speed_kms)}`);
  L.push(`- Distance from Sun: ${fmt(d.sun_distance_au, 4)} AU`);
  if (d.osculating) {
    const [a, e, i, node, peri, m, per] = d.osculating;
    L.push(`- Osculating orbit: a = ${fmt(a, 5)} AU, e = ${fmt(e, 5)}, i = ${fmt(i, 3)}°, Ω = ${fmt(node, 3)}°, ω = ${fmt(peri, 3)}°, M = ${fmt(m, 3)}°, P = ${fmt(per, 1)} d`);
  }
  if (d.delta_v_ms > 0) L.push(`- Velocity change applied in this simulation: ${velocityChange(d.delta_v_ms)}`);
  L.push('');
  if (r?.scan) {
    L.push(`## Earth encounters within 0.05 AU, next ${r.scanYears ?? '?'} years (CosmoRisk propagation)`, '');
    if (!r.scan.encounters.length) L.push('None found.');
    else {
      L.push('| Date (UTC) | Distance (km) | Distance (LD) | v_rel (km/s) |', '|---|---:|---:|---:|');
      for (const e of r.scan.encounters) {
        L.push(`| ${formatDateTime(e.jd)} | ${fmt(e.dist_km, 0)} | ${fmt(e.dist_km / 384400, 2)} | ${fmt(e.v_rel_kms, 2)} |`);
      }
    }
    L.push('');
  }
  if (r?.cad?.length) {
    L.push('## JPL close-approach data (CAD)', '');
    L.push('| Date | Distance (AU) | v_rel (km/s) |', '|---|---:|---:|');
    for (const c of r.cad) L.push(`| ${c.date} | ${c.dist_au.toFixed(6)} | ${fmt(c.v_rel_kms, 2)} |`);
    L.push('');
  }
  if (risk?.sentry && !risk.sentry.removed) {
    const s = risk.sentry;
    L.push('## JPL Sentry', '');
    L.push(`- Cumulative impact probability: ${probability(s.ip)}`);
    L.push(`- Cumulative Palermo scale: ${fmt(s.ps_cum, 2)}`);
    L.push(`- Maximum Torino scale: ${s.ts_max} — ${torinoText(s.ts_max)}`);
    L.push(`- Computed: ${s.computed}`, '');
  }
  if (risk?.report) {
    const rep = risk.report;
    L.push('## Monte Carlo (CosmoRisk)', '');
    L.push(`- Method: ${rep.mc.method === 'covariance' ? 'JPL orbit covariance' : rep.mc.method === 'isotropic' ? 'isotropic scatter' : rep.mc.method}, ${rep.mc.samples} samples over ${rep.mc.years} years`);
    L.push(`- Impacts: ${rep.mc.impacts} → P = ${probability(rep.mc.impact_probability)} (95% interval ${rep.mc.ip_low.toExponential(2)} – ${rep.mc.ip_high.toExponential(2)})`);
    L.push(`- Impact energy if it hits: ${energy(rep.energy_mt)} (v∞ = ${fmt(rep.v_inf_kms, 2)} km/s)`);
    L.push(`- Torino ${rep.torino}, Palermo ${rep.palermo === null ? '—' : fmt(rep.palermo, 2)}`, '');
  }
  if (plan) {
    const p = plan.plan;
    L.push('## Deflection preview', '');
    L.push(`- Method: ${plan.deflection.method.replace('_', ' ')}, Δv ≈ ${velocityChange(p.dv_ms)}`);
    L.push(`- Target encounter: ${p.target_jd ? formatDateTime(p.target_jd) : '—'}`);
    L.push(`- Miss distance: ${p.miss_before_km === null ? '—' : fmt(p.miss_before_km, 0)} km → ${p.miss_after_km === null ? '—' : fmt(p.miss_after_km, 0)} km`, '');
  }
  L.push('---', '');
  L.push('Numbers come from CosmoRisk\'s own model (VSOP87/Standish planets, RK4 propagation, no non-gravitational forces). For authoritative values use JPL Sentry and CNEOS.');
  try {
    const path = await save({
      title: t('export.report'),
      defaultPath: `${safe(rec.name)}-${stamp()}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!path) return;
    await api.writeText(path, L.join('\n') + '\n');
    toast(t('export.saved', { path }), 'ok');
  } catch (e) {
    toast(errorText(e), 'error', t('export.failed'));
  }
}
