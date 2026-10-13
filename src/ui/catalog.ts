// Left rail: loaded catalogue, upcoming close approaches, Sentry list.

import { animate } from 'motion';
import { ctx, isBusy, loadDesignation, loadPreset, refreshBodies, removeBodies, selectBody } from '../app';
import { api, errorText } from '../core/bridge';
import { t, type Key } from '../core/i18n';
import { settings } from '../core/settings';
import { bus, state } from '../core/store';
import type { BodyInfo, CatalogPreset, CloseApproach, SentryEntry } from '../core/types';
import { diameter, distance, expo, fmt, LD_KM, AU_KM } from '../core/units';
import { formatDate, parseLooseDate } from '../core/time';
import { $, actions, debounce, esc, html, raw } from './dom';
import { icon } from './icons';
import { confirmDialog } from './modal';
import { toast } from './toast';

type Tab = 'catalog' | 'approaches' | 'sentry';
type Sort = 'name' | 'size' | 'moid';

const ROW = 30;

let root: HTMLElement;
let tab: Tab = 'catalog';
let sort: Sort = 'size';
let filterText = '';
let filterKind: 'all' | 'pha' | 'sentry' = 'all';
let rows: BodyInfo[] = [];

let approaches: CloseApproach[] | null = null;
let approachDays = 60;
let approachLd = 5;
let sentry: SentryEntry[] | null = null;
let sentryError = '';
let approachError = '';

export function mountCatalog(host: HTMLElement) {
  root = host;
  render();
  actions(root, {
    tab: (el) => {
      tab = el.dataset.tab as Tab;
      render();
      if (tab === 'approaches' && !approaches) fetchApproaches();
      if (tab === 'sentry' && !sentry) fetchSentry();
    },
    load: () => {
      const preset = ($('#cat-preset', root) as HTMLSelectElement).value as CatalogPreset;
      const limit = +($('#cat-limit', root) as HTMLSelectElement).value;
      loadPreset(preset, limit);
    },
    lookup: () => lookup(),
    restore: async () => {
      try {
        await api.restoreCache();
        await refreshBodies();
      } catch (e) {
        toast(errorText(e), 'error');
      }
    },
    sort: (el) => {
      sort = el.dataset.sort as Sort;
      updateRows();
      renderHead();
    },
    kind: (el) => {
      filterKind = el.dataset.kind as typeof filterKind;
      if (ctx.view) {
        ctx.view.asteroids.filter = filterKind;
        ctx.view.asteroids.restyle();
        ctx.view.invalidate();
      }
      root.querySelectorAll('[data-act="kind"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      updateRows();
    },
    clear: async () => {
      if (!state.bodies.length) return;
      const ok = await confirmDialog(t('cat.clearTitle'), t('cat.clearBody', { n: state.bodies.length }), t('cat.clear'), true);
      if (ok) removeBodies(state.bodies.map((b) => b.id));
    },
    'appr-days': (el) => {
      approachDays = +el.dataset.v!;
      fetchApproaches();
    },
    'appr-ld': (el) => {
      approachLd = +el.dataset.v!;
      fetchApproaches();
    },
    'appr-refresh': () => fetchApproaches(),
    'sentry-refresh': () => fetchSentry(),
    'open-des': (el) => loadDesignation(el.dataset.des!),
    'pick-row': (el) => selectBody(el.dataset.id!, true),
  });

  bus.on('bodies', () => {
    updateRows();
    renderCounts();
    renderRestore();
  });
  bus.on('select', () => paintRows());
  bus.on('busy', ({ key }) => {
    if (key === 'catalog' || key === 'lookup') renderBusy();
  });
  bus.on('lang', () => render());
}

function render() {
  root.innerHTML = html`
    <div class="tabs" role="tablist">
      ${raw(tabBtn('catalog', 'cat.tab.catalog', 'list'))}
      ${raw(tabBtn('approaches', 'cat.tab.approaches', 'approach'))}
      ${raw(tabBtn('sentry', 'cat.tab.sentry', 'warning'))}
    </div>
    <div class="progress" id="cat-busy" hidden><i></i></div>
    <div class="pane" id="cat-pane"></div>`;
  const pane = $('#cat-pane', root);
  if (tab === 'catalog') renderCatalog(pane);
  else if (tab === 'approaches') renderApproaches(pane);
  else renderSentry(pane);
  renderBusy();
  renderCounts();
}

function tabBtn(id: Tab, key: Key, ic: Parameters<typeof icon>[0]) {
  return `<button class="tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="${tab === id}">${icon(ic)}<span>${esc(t(key))}</span>${
    id === 'catalog' ? '<span class="count" id="cat-count"></span>' : ''
  }</button>`;
}

function renderBusy() {
  const b = root.querySelector('#cat-busy') as HTMLElement | null;
  if (!b) return;
  const busy = isBusy('catalog') || isBusy('lookup') || isBusy('approaches') || isBusy('sentry');
  b.hidden = !busy;
  b.classList.toggle('indeterminate', busy);
  root.querySelectorAll<HTMLButtonElement>('[data-act="load"], [data-act="lookup"]').forEach((x) => (x.disabled = busy));
}

function renderCounts() {
  const c = root.querySelector('#cat-count');
  if (c) c.textContent = state.bodies.length ? String(state.bodies.length) : '';
}

// ---------------------------------------------------------------- catalogue

function renderCatalog(pane: HTMLElement) {
  pane.innerHTML = html`
    <div class="block">
      <div class="field-row" style="grid-template-columns: 1fr 86px">
        <label class="field"><span>${t('cat.preset')}</span>
          <select class="select" id="cat-preset">
            <option value="pha">${t('cat.preset.pha')}</option>
            <option value="large_neo">${t('cat.preset.large')}</option>
            <option value="neo">${t('cat.preset.neo')}</option>
          </select>
        </label>
        <label class="field"><span>${t('cat.limit')}</span>
          <select class="select" id="cat-limit">
            <option>250</option><option selected>1000</option><option>2500</option><option>5000</option>
          </select>
        </label>
      </div>
      <button class="btn primary wide" data-act="load">${raw(icon('download'))}${t('cat.load')}</button>
      <div class="field" style="margin-top:10px">
        <span>${t('cat.lookup')}</span>
        <div class="input-group">
          <input class="input" id="cat-lookup" placeholder="${t('cat.lookup.ph')}" spellcheck="false" autocomplete="off" />
          <button class="btn icon" data-act="lookup" aria-label="${t('cat.lookup')}">${raw(icon('plus'))}</button>
        </div>
      </div>
      <div id="cat-restore"></div>
    </div>
    <div class="block" style="padding-bottom:8px">
      <div class="search">${raw(icon('search'))}<input class="input" id="cat-filter" placeholder="${t('cat.filter.ph')}" value="${filterText}" spellcheck="false" autocomplete="off" /></div>
      <div class="seg" style="margin-top:8px" role="group">
        <button data-act="kind" data-kind="all" aria-pressed="${filterKind === 'all'}">${t('cat.kind.all')}</button>
        <button data-act="kind" data-kind="pha" aria-pressed="${filterKind === 'pha'}">PHA</button>
        <button data-act="kind" data-kind="sentry" aria-pressed="${filterKind === 'sentry'}">Sentry</button>
      </div>
    </div>
    <div class="list-head" id="cat-head"></div>
    <div class="scroll list" id="cat-scroll" tabindex="0" aria-label="${t('cat.tab.catalog')}"><div id="cat-spacer"></div></div>
    <div class="foot"><span id="cat-foot"></span><span class="sp"></span>
      <button class="btn ghost sm icon" data-act="clear" title="${t('cat.clear')}" aria-label="${t('cat.clear')}">${raw(icon('trash'))}</button>
    </div>`;

  const lookupInput = $('#cat-lookup', pane) as HTMLInputElement;
  lookupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookup();
  });
  const filterInput = $('#cat-filter', pane) as HTMLInputElement;
  filterInput.addEventListener(
    'input',
    debounce(() => {
      filterText = filterInput.value;
      updateRows();
    }, 120),
  );
  const scroll = $('#cat-scroll', pane);
  scroll.addEventListener('scroll', () => paintRows(), { passive: true });
  scroll.addEventListener('keydown', onListKey);
  new ResizeObserver(() => paintRows()).observe(scroll);
  renderHead();
  renderRestore();
  updateRows();
}

async function renderRestore() {
  const host = root.querySelector('#cat-restore') as HTMLElement | null;
  if (!host) return;
  if (state.bodies.length) {
    host.innerHTML = '';
    return;
  }
  const info = await api.cachedInfo().catch(() => null);
  if (!info || !info.objects || state.bodies.length) {
    host.innerHTML = '';
    return;
  }
  const when = new Date(info.saved_unix * 1000).toLocaleDateString(settings.lang === 'tr' ? 'tr-TR' : 'en-GB');
  host.innerHTML = html`<div class="callout" style="margin-bottom:0">${t('cat.restore.text', { n: info.objects, date: when })}
    <div style="margin-top:8px"><button class="btn sm" data-act="restore">${raw(icon('refresh'))}${t('cat.restore')}</button></div></div>`;
}

function lookup() {
  const input = root.querySelector('#cat-lookup') as HTMLInputElement | null;
  const v = input?.value.trim();
  if (!v) return;
  loadDesignation(v).then((id) => {
    if (id && input) input.value = '';
  });
}

function renderHead() {
  const h = root.querySelector('#cat-head');
  if (!h) return;
  h.innerHTML = html`
    <button data-act="sort" data-sort="name" data-active="${sort === 'name'}">${t('cat.col.name')}</button>
    <button class="r" data-act="sort" data-sort="size" data-active="${sort === 'size'}">${t('cat.col.size')}</button>
    <button class="r" data-act="sort" data-sort="moid" data-active="${sort === 'moid'}">MOID</button>`;
}

function updateRows() {
  const q = filterText.trim().toLowerCase();
  rows = state.bodies.filter((b) => {
    if (filterKind === 'pha' && !b.pha) return false;
    if (filterKind === 'sentry' && !b.sentry) return false;
    if (q && !b.name.toLowerCase().includes(q) && !b.id.toLowerCase().includes(q)) return false;
    return true;
  });
  const cmpName = (a: BodyInfo, b: BodyInfo) => a.name.localeCompare(b.name, undefined, { numeric: true });
  if (sort === 'name') rows.sort(cmpName);
  else if (sort === 'size') rows.sort((a, b) => b.diameter_km - a.diameter_km || cmpName(a, b));
  else rows.sort((a, b) => (a.moid_au ?? 9) - (b.moid_au ?? 9) || cmpName(a, b));

  const spacer = root.querySelector('#cat-spacer') as HTMLElement | null;
  if (spacer) spacer.style.height = `${rows.length * ROW}px`;
  const foot = root.querySelector('#cat-foot');
  if (foot) foot.textContent = t('cat.foot', { shown: rows.length, total: state.bodies.length });
  paintRows(true);
}

let painted = { from: -1, to: -1, n: -1, sel: '' };

function paintRows(force = false) {
  const scroll = root.querySelector('#cat-scroll') as HTMLElement | null;
  if (!scroll) return;
  if (!rows.length) {
    scroll.querySelectorAll('.row, .empty').forEach((r) => r.remove());
    scroll.insertAdjacentHTML(
      'beforeend',
      `<div class="empty">${icon('orbit')}${esc(state.bodies.length ? t('cat.empty.filter') : t('cat.empty'))}</div>`,
    );
    painted = { from: -1, to: -1, n: 0, sel: '' };
    return;
  }
  scroll.querySelector('.empty')?.remove();
  const from = Math.max(0, Math.floor(scroll.scrollTop / ROW) - 4);
  const to = Math.min(rows.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / ROW) + 4);
  const sel = state.selected ?? '';
  if (!force && painted.from === from && painted.to === to && painted.n === rows.length && painted.sel === sel) return;
  painted = { from, to, n: rows.length, sel };
  const unit = settings.unit;
  let out = '';
  for (let i = from; i < to; i++) {
    const b = rows[i];
    const mark = b.impacted !== null ? 'impact' : b.sentry ? 'sentry' : b.deflected || b.thrusting ? 'deflected' : b.pha ? 'pha' : '';
    const moid = b.moid_au === null ? '—' : unit === 'au' ? fmt(b.moid_au, 3) : unit === 'ld' ? fmt((b.moid_au * AU_KM) / LD_KM, 1) : expo(b.moid_au * AU_KM, 1);
    out += `<div class="row" role="option" data-act="pick-row" data-id="${esc(b.id)}" aria-selected="${b.id === sel}" style="top:${i * ROW}px">
      <div class="name"><i class="mark ${mark}"></i><span title="${esc(b.name)}">${esc(b.name)}</span></div>
      <div class="v${b.diameter_estimated ? ' dim' : ''}">${esc(diameter(b.diameter_km))}</div>
      <div class="v">${esc(moid)}</div></div>`;
  }
  scroll.querySelectorAll('.row').forEach((r) => r.remove());
  scroll.insertAdjacentHTML('beforeend', out);
}

function onListKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  e.preventDefault();
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.id === state.selected);
  if (e.key === 'ArrowDown') i = Math.min(rows.length - 1, i + 1);
  else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
  if (i < 0) i = 0;
  selectBody(rows[i].id, e.key === 'Enter');
  const scroll = e.currentTarget as HTMLElement;
  const y = i * ROW;
  if (y < scroll.scrollTop) scroll.scrollTop = y;
  else if (y + ROW > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = y + ROW - scroll.clientHeight;
}

// --------------------------------------------------------------- approaches

async function fetchApproaches() {
  approachError = '';
  approaches = approaches ?? null;
  bus.emit('busy', { key: 'approaches', busy: true });
  const pane = root.querySelector('#cat-pane') as HTMLElement | null;
  if (tab === 'approaches' && pane) renderApproaches(pane);
  try {
    approaches = await api.upcoming(approachDays, (approachLd * LD_KM) / AU_KM);
  } catch (e) {
    approachError = errorText(e);
    approaches = [];
  } finally {
    bus.emit('busy', { key: 'approaches', busy: false });
    const p = root.querySelector('#cat-pane') as HTMLElement | null;
    if (tab === 'approaches' && p) renderApproaches(p);
    renderBusy();
  }
}

function renderApproaches(pane: HTMLElement) {
  const daysOpts = [
    [30, '30 d'],
    [60, '60 d'],
    [365, t('unit.year1')],
  ] as const;
  const ldOpts = [1, 5, 20];
  const list = approaches ?? [];
  pane.innerHTML = html`
    <div class="block">
      <div class="field-row">
        <div class="field"><span>${t('appr.window')}</span>
          <div class="seg">${raw(daysOpts.map(([v, l]) => `<button data-act="appr-days" data-v="${v}" aria-pressed="${approachDays === v}">${esc(l)}</button>`).join(''))}</div>
        </div>
        <div class="field"><span>${t('appr.within')}</span>
          <div class="seg">${raw(ldOpts.map((v) => `<button data-act="appr-ld" data-v="${v}" aria-pressed="${approachLd === v}">${v} LD</button>`).join(''))}</div>
        </div>
      </div>
      <div class="note">${t('appr.note')}</div>
    </div>
    <div class="scroll table-rows" id="appr-list"></div>
    <div class="foot"><span>${approaches ? t('appr.foot', { n: list.length }) : ''}</span><span class="sp"></span>
      <button class="btn ghost sm icon" data-act="appr-refresh" aria-label="${t('common.refresh')}">${raw(icon('refresh'))}</button></div>`;
  const host = $('#appr-list', pane);
  if (approachError) {
    host.innerHTML = `<div class="empty">${icon('warning')}${esc(approachError)}</div>`;
    return;
  }
  if (!approaches) {
    host.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
    return;
  }
  if (!list.length) {
    host.innerHTML = `<div class="empty">${icon('approach')}${esc(t('appr.none'))}</div>`;
    return;
  }
  host.innerHTML = list
    .map((a) => {
      const jd = parseLooseDate(a.date) ?? a.jd;
      return `<div class="trow" style="grid-template-columns: 76px minmax(0,1fr) 62px" data-act="open-des" data-des="${esc(a.des)}" title="${esc(t('appr.open'))}">
        <div class="t2">${esc(formatDate(jd))}</div>
        <div class="t1">${esc(a.name)}</div>
        <div class="t2 r">${esc(distance(a.dist_au * AU_KM, settings.unit === 'au' ? 'au' : 'ld'))}</div></div>`;
    })
    .join('');
  if (!settings.reduceMotion) {
    animate(Array.from(host.children).slice(0, 18) as HTMLElement[], { opacity: [0, 1], x: [-6, 0] }, { duration: 0.18, delay: (i: number) => i * 0.015 });
  }
}

// ------------------------------------------------------------------- sentry

async function fetchSentry() {
  sentryError = '';
  bus.emit('busy', { key: 'sentry', busy: true });
  renderBusy();
  try {
    sentry = await api.sentryList();
  } catch (e) {
    sentryError = errorText(e);
    sentry = [];
  } finally {
    bus.emit('busy', { key: 'sentry', busy: false });
    const p = root.querySelector('#cat-pane') as HTMLElement | null;
    if (tab === 'sentry' && p) renderSentry(p);
    renderBusy();
  }
}

function renderSentry(pane: HTMLElement) {
  pane.innerHTML = html`
    <div class="block"><div class="note">${t('sentry.note')}</div></div>
    <div class="list-head" style="grid-template-columns: minmax(0,1fr) 70px 44px 24px">
      <span>${t('cat.col.name')}</span><span class="r">${t('sentry.ip')}</span><span class="r">PS</span><span class="r">TS</span>
    </div>
    <div class="scroll table-rows" id="sentry-list"></div>
    <div class="foot"><span>${sentry ? t('sentry.foot', { n: sentry.length }) : ''}</span><span class="sp"></span>
      <button class="btn ghost sm icon" data-act="sentry-refresh" aria-label="${t('common.refresh')}">${raw(icon('refresh'))}</button></div>`;
  const host = $('#sentry-list', pane);
  if (sentryError) {
    host.innerHTML = `<div class="empty">${icon('warning')}${esc(sentryError)}</div>`;
    return;
  }
  if (!sentry) {
    host.innerHTML = `<div class="empty">${esc(t('common.loading'))}</div>`;
    return;
  }
  // Render the top 400 by Palermo; the full list is thousands of tiny objects.
  host.innerHTML = sentry
    .slice(0, 400)
    .map(
      (s) => `<div class="trow" style="grid-template-columns: minmax(0,1fr) 70px 44px 24px" data-act="open-des" data-des="${esc(s.des)}">
        <div><div class="t1">${esc(s.name)}</div><div class="t2">${esc(s.range)} · ${esc(s.diameter_km !== null ? diameter(s.diameter_km) : '—')}</div></div>
        <div class="t2 r">${esc(expo(s.ip, 1))}</div>
        <div class="t2 r">${esc(fmt(s.ps_cum, 2))}</div>
        <div class="t2 r">${s.ts_max}</div></div>`,
    )
    .join('');
}
