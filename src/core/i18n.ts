// Minimal i18n: flat key -> string tables, {name} placeholders.

import en from './locales/en';
import tr from './locales/tr';
import { settings, type Lang } from './settings';
import { bus } from './store';
import { setNumberLocale } from './units';

export type Key = keyof typeof en;

const tables: Record<Lang, Record<Key, string>> = { en, tr };

let current: Lang = settings.lang;
setNumberLocale(current);

export function lang(): Lang {
  return current;
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = tables[current][key] ?? en[key] ?? key;
  if (vars) {
    for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  }
  return s;
}

export function setLang(l: Lang) {
  current = l;
  setNumberLocale(l);
  document.documentElement.lang = l;
  applyI18n(document.body);
  bus.emit('lang', undefined);
}

/** Fill static markup: data-i18n (text), -ph (placeholder), -title, -aria. */
export function applyI18n(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  });
}
