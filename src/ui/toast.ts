import { animate } from 'motion';
import { settings } from '../core/settings';
import { t } from '../core/i18n';
import { $, esc } from './dom';
import { icon } from './icons';

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';

const MAX = 4;

export function toast(message: string, kind: ToastKind = 'info', title?: string, ms?: number) {
  const host = $('#toasts');
  while (host.children.length >= MAX) host.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<div class="msg">${title ? `<b>${esc(title)}</b>` : ''}${esc(message)}</div>
    <button class="btn ghost sm icon" aria-label="${esc(t('common.close'))}">${icon('close')}</button>`;
  host.appendChild(el);
  const close = () => {
    if (!el.isConnected) return;
    if (settings.reduceMotion) return el.remove();
    animate(el, { opacity: [1, 0], x: [0, 12] }, { duration: 0.16 }).then(() => el.remove());
  };
  el.querySelector('button')!.addEventListener('click', close);
  if (!settings.reduceMotion) {
    animate(el, { opacity: [0, 1], y: [8, 0] }, { duration: 0.2, ease: [0.2, 0, 0, 1] });
  }
  const life = ms ?? (kind === 'error' ? 9000 : kind === 'warn' ? 6000 : 3500);
  let timer = window.setTimeout(close, life);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => (timer = window.setTimeout(close, 2000)));
}
