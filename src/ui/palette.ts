// Command palette (Ctrl+K): every action and every loaded object, one box.

import { animate } from 'motion';
import { t } from '../core/i18n';
import { settings } from '../core/settings';
import { state } from '../core/store';
import { esc } from './dom';
import { icon, type IconName } from './icons';

export interface Command {
  id: string;
  title: string;
  group: string;
  icon: IconName;
  keys?: string;
  run: () => void;
}

let el: HTMLElement | null = null;
let provider: () => Command[] = () => [];
let selectBodyFn: (id: string) => void = () => {};
let lookupFn: (q: string) => void = () => {};

export function configurePalette(cmds: () => Command[], onBody: (id: string) => void, onLookup: (q: string) => void) {
  provider = cmds;
  selectBodyFn = onBody;
  lookupFn = onLookup;
}

export function isPaletteOpen() {
  return el !== null;
}

export function closePalette() {
  if (!el) return;
  el.remove();
  document.querySelector('.scrim.palette-scrim')?.remove();
  el = null;
}

/** Cheap fuzzy score: all query chars in order, bonus for word starts. */
function score(q: string, s: string): number {
  if (!q) return 1;
  const a = s.toLowerCase();
  const direct = a.indexOf(q);
  if (direct >= 0) return 100 - direct;
  let i = 0;
  let sc = 0;
  for (const ch of q) {
    const k = a.indexOf(ch, i);
    if (k < 0) return 0;
    sc += k === i ? 3 : 1;
    if (k === 0 || a[k - 1] === ' ') sc += 2;
    i = k + 1;
  }
  return sc;
}

export function openPalette() {
  if (el) return closePalette();
  const opener = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'scrim palette-scrim';
  scrim.style.background = 'transparent';
  scrim.addEventListener('mousedown', () => close());
  el = document.createElement('div');
  el.className = 'palette';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('palette.title'));
  el.innerHTML = `<div class="search">${icon('search')}<input class="input" id="pal-q" placeholder="${esc(t('palette.ph'))}" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="pal-list"/></div>
    <div class="palette-list" id="pal-list" role="listbox"></div>`;
  document.body.append(scrim, el);
  const input = el.querySelector('input') as HTMLInputElement;
  const list = el.querySelector('#pal-list') as HTMLElement;
  let items: { title: string; group: string; icon: IconName; keys?: string; run: () => void }[] = [];
  let active = 0;

  const close = () => {
    closePalette();
    opener?.focus?.();
  };

  const build = () => {
    const q = input.value.trim().toLowerCase();
    const cmds = provider()
      .map((c) => ({ c, s: score(q, `${c.title} ${c.group}`) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 8 : 12)
      .map(({ c }) => ({ title: c.title, group: c.group, icon: c.icon, keys: c.keys, run: c.run }));
    const bodies = q
      ? state.bodies
          .map((b) => ({ b, s: Math.max(score(q, b.name), score(q, b.id)) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 8)
          .map(({ b }) => ({ title: b.name, group: t('palette.object'), icon: 'dot' as IconName, keys: undefined, run: () => selectBodyFn(b.id) }))
      : [];
    const lookup = q.length >= 3 ? [{ title: t('palette.lookup', { q: input.value.trim() }), group: 'JPL SBDB', icon: 'download' as IconName, keys: undefined, run: () => lookupFn(input.value.trim()) }] : [];
    items = [...bodies, ...cmds, ...lookup];
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items
          .map(
            (it, i) => `<div class="palette-item" role="option" data-i="${i}" aria-selected="${i === active}">${icon(it.icon)}
            <span class="label-t">${esc(it.title)}</span>${it.keys ? `<kbd>${esc(it.keys)}</kbd>` : ''}<span class="group">${esc(it.group)}</span></div>`,
          )
          .join('')
      : `<div class="empty">${esc(t('palette.none'))}</div>`;
  };

  const runActive = () => {
    const it = items[active];
    if (!it) return;
    close();
    it.run();
  };

  input.addEventListener('input', () => {
    active = 0;
    build();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      list.querySelectorAll('.palette-item').forEach((n, i) => n.setAttribute('aria-selected', String(i === active)));
      list.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  list.addEventListener('mousemove', (e) => {
    const n = (e.target as HTMLElement).closest<HTMLElement>('.palette-item');
    if (!n) return;
    const i = +n.dataset.i!;
    if (i !== active) {
      active = i;
      list.querySelectorAll('.palette-item').forEach((x, k) => x.setAttribute('aria-selected', String(k === active)));
    }
  });
  list.addEventListener('click', (e) => {
    const n = (e.target as HTMLElement).closest<HTMLElement>('.palette-item');
    if (n) {
      active = +n.dataset.i!;
      runActive();
    }
  });
  build();
  input.focus();
  if (!settings.reduceMotion) animate(el, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.14 });
}
