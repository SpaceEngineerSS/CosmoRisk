// Settings, scenarios, help and the first-run note.

import { open as openDialog, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { refreshBodies, selectBody } from '../app';
import { api, errorText } from '../core/bridge';
import { setLang, t } from '../core/i18n';
import { settings, updateSettings, type Lang, type Quality, type Theme } from '../core/settings';
import { formatDate } from '../core/time';
import type { DistanceUnit } from '../core/units';
import { esc, html, raw } from './dom';
import { icon } from './icons';
import { confirmDialog, openModal, promptText } from './modal';
import { exportCsv } from './export';
import { toast } from './toast';

const REPO = 'https://github.com/SpaceEngineerSS/CosmoRisk';

function seg<T extends string>(name: string, opts: [T, string][], cur: T) {
  return `<div class="seg" data-setting="${name}">${opts
    .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`)
    .join('')}</div>`;
}

export function openSettings() {
  const m = openModal({
    title: t('settings.title'),
    body: html`
      <div class="settings-grid">
        <label>${t('settings.lang')}</label>${raw(seg<Lang>('lang', [['en', 'English'], ['tr', 'Türkçe']], settings.lang))}
        <label>${t('settings.theme')}</label>${raw(seg<Theme>('theme', [['dark', t('settings.theme.dark')], ['light', t('settings.theme.light')]], settings.theme))}
        <label>${t('settings.quality')}</label>${raw(
          seg<Quality>('quality', [['auto', t('settings.q.auto')], ['low', t('settings.q.low')], ['medium', t('settings.q.medium')], ['high', t('settings.q.high')]], settings.quality),
        )}
        <label>${t('settings.units')}</label>${raw(seg<DistanceUnit>('unit', [['km', 'km'], ['ld', t('settings.unit.ld')], ['au', 'AU']], settings.unit))}
        <label>${t('settings.motion')}</label>
        <label class="check"><input type="checkbox" data-bool="reduceMotion" ${settings.reduceMotion ? 'checked' : ''}/>${t('settings.motion.reduce')}</label>
      </div>
      <p class="note" style="margin-top:14px">${t('settings.quality.note')}</p>`,
    footer: `<button class="btn" data-close>${esc(t('common.done'))}</button>`,
  });
  m.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg button');
    if (!b) return;
    const segEl = b.parentElement!;
    const key = segEl.dataset.setting!;
    const v = b.dataset.v!;
    segEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (key === 'lang') {
      updateSettings({ lang: v as Lang });
      setLang(v as Lang);
      m.close();
      openSettings();
      return;
    }
    updateSettings({ [key]: v } as Partial<typeof settings>);
  });
  m.body.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.dataset.bool) updateSettings({ [inp.dataset.bool]: inp.checked } as Partial<typeof settings>);
  });
}

// ---------------------------------------------------------------- scenarios

export async function openScenarios() {
  const m = openModal({
    title: t('sc.title'),
    wide: true,
    body: `<div id="sc-body">${esc(t('common.loading'))}</div>`,
    footer: html`
      <button class="btn" id="sc-import">${raw(icon('upload'))}${t('sc.import')}</button>
      <button class="btn" id="sc-export">${raw(icon('download'))}${t('sc.export')}</button>
      <button class="btn" id="sc-csv">${raw(icon('report'))}${t('sc.csv')}</button>
      <span style="flex:1"></span>
      <button class="btn primary" id="sc-save">${raw(icon('save'))}${t('sc.save')}</button>`,
  });
  const body = m.body.querySelector('#sc-body') as HTMLElement;

  const refresh = async () => {
    const list = await api.listScenarios().catch(() => []);
    if (!list.length) {
      body.innerHTML = `<div class="empty">${icon('folder')}${esc(t('sc.empty'))}</div>`;
      return;
    }
    body.innerHTML = `<div class="table-rows">${list
      .map(
        (s) => `<div class="trow" style="grid-template-columns: minmax(0,1fr) 110px 80px auto; cursor:default">
          <div class="t1">${esc(s.name)}</div>
          <div class="t2">${esc(formatDate(s.jd))}</div>
          <div class="t2">${esc(t('sc.objects', { n: s.objects }))}</div>
          <div class="btn-row" style="flex-wrap:nowrap">
            <button class="btn sm" data-load="${esc(s.name)}">${esc(t('sc.load'))}</button>
            <button class="btn sm ghost icon" data-del="${esc(s.name)}" aria-label="${esc(t('common.delete'))}">${icon('trash')}</button>
          </div></div>`,
      )
      .join('')}</div>`;
  };
  body.addEventListener('click', async (e) => {
    const el = e.target as HTMLElement;
    const load = el.closest<HTMLElement>('[data-load]')?.dataset.load;
    const del = el.closest<HTMLElement>('[data-del]')?.dataset.del;
    if (load) {
      try {
        await api.loadScenario(load);
        selectBody(null);
        await refreshBodies();
        toast(t('sc.loaded', { name: load }), 'ok');
        m.close();
      } catch (err) {
        toast(errorText(err), 'error');
      }
    } else if (del) {
      if (await confirmDialog(t('sc.delete.title'), t('sc.delete.body', { name: del }), t('common.delete'), true)) {
        await api.deleteScenario(del).catch((err) => toast(errorText(err), 'error'));
        refresh();
      }
    }
  });
  m.root.querySelector('#sc-save')!.addEventListener('click', async () => {
    const name = await promptText(t('sc.save'), t('sc.name'), `${t('sc.default')} ${new Date().toISOString().slice(0, 10)}`, t('sc.save'));
    if (!name) return;
    try {
      await api.saveScenario(name);
      toast(t('sc.saved', { name }), 'ok');
      refresh();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  });
  m.root.querySelector('#sc-export')!.addEventListener('click', async () => {
    try {
      const path = await save({ title: t('sc.export'), defaultPath: 'cosmorisk-scenario.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;
      const name = path.split(/[\\/]/).pop()!.replace(/\.json$/i, '');
      await api.writeText(path, await api.exportScenario(name));
      toast(t('export.saved', { path }), 'ok');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  });
  m.root.querySelector('#sc-import')!.addEventListener('click', async () => {
    try {
      const path = await openDialog({ title: t('sc.import'), multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path || Array.isArray(path)) return;
      const name = await api.importScenario(await api.readText(path));
      selectBody(null);
      await refreshBodies();
      toast(t('sc.loaded', { name }), 'ok');
      m.close();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  });
  m.root.querySelector('#sc-csv')!.addEventListener('click', () => exportCsv());
  refresh();
}

// --------------------------------------------------------------------- help

const SHORTCUTS: [string, string][] = [
  ['Space', 'help.k.play'],
  ['[  ]  or  −  +', 'help.k.rate'],
  ['R', 'help.k.reverse'],
  ['N', 'help.k.now'],
  ['1 · 2 · 3', 'help.k.views'],
  ['F', 'help.k.focus'],
  ['L · O · G', 'help.k.toggles'],
  ['Ctrl K', 'help.k.palette'],
  ['Esc', 'help.k.escape'],
  ['↑ ↓ Enter', 'help.k.list'],
];

export function openHelp(version: string) {
  const m = openModal({
    title: t('help.title'),
    wide: true,
    body: html`
      <h3>${t('help.what')}</h3>
      <p>${t('help.what.body')}</p>
      <h3>${t('help.start')}</h3>
      <p>${t('help.start.body')}</p>
      <h3>${t('help.keys')}</h3>
      <div class="shortcut-list">${raw(SHORTCUTS.map(([k, d]) => `<span><kbd>${esc(k)}</kbd></span><span>${esc(t(d as never))}</span>`).join(''))}</div>
      <h3>${t('help.model')}</h3>
      <p>${t('help.model.body')}</p>
      <h3>${t('help.data')}</h3>
      <p>${t('help.data.body')}</p>
      <p class="note">CosmoRisk ${version} · MIT · © Mehmet Gümüş</p>`,
    footer: html`
      <button class="btn" data-link="${REPO}">${raw(icon('external'))}GitHub</button>
      <button class="btn" data-link="${REPO}/tree/main/docs">${raw(icon('external'))}${t('help.docs')}</button>
      <span style="flex:1"></span>
      <button class="btn primary" data-close>${t('common.done')}</button>`,
  });
  m.root.querySelectorAll<HTMLElement>('[data-link]').forEach((b) =>
    b.addEventListener('click', () => openUrl(b.dataset.link!).catch((e) => toast(errorText(e), 'error'))),
  );
}

export function maybeShowIntro() {
  if (settings.seenIntro) return;
  const m = openModal({
    title: t('intro.title'),
    body: html`<p>${t('intro.p1')}</p><p>${t('intro.p2')}</p><p class="note">${t('intro.p3')}</p>`,
    footer: html`<button class="btn" data-close>${t('intro.later')}</button><button class="btn primary" id="intro-go">${raw(icon('download'))}${t('intro.go')}</button>`,
    onClose: () => updateSettings({ seenIntro: true }),
  });
  m.root.querySelector('#intro-go')!.addEventListener('click', async () => {
    m.close();
    const { loadPreset } = await import('../app');
    loadPreset('pha', 1000);
  });
}
