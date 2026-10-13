// Accessible modal dialogs: focus trap, Escape to close, focus returns to
// the element that opened them.

import { animate } from 'motion';
import { settings } from '../core/settings';
import { t } from '../core/i18n';
import { esc } from './dom';
import { icon } from './icons';

export interface ModalOptions {
  title: string;
  body: string;
  footer?: string;
  wide?: boolean;
  onClose?: () => void;
}

export interface ModalHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

const stack: ModalHandle[] = [];

export function isModalOpen() {
  return stack.length > 0;
}

export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function openModal(opts: ModalOptions): ModalHandle {
  const opener = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  scrim.innerHTML = `
    <div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <div class="modal-h">
        <h2 id="${id}">${esc(opts.title)}</h2>
        <button class="btn ghost icon" data-close aria-label="${esc(t('common.close'))}">${icon('close')}</button>
      </div>
      <div class="modal-b">${opts.body}</div>
      ${opts.footer ? `<div class="modal-f">${opts.footer}</div>` : ''}
    </div>`;
  document.body.appendChild(scrim);
  const modal = scrim.firstElementChild as HTMLElement;
  const body = modal.querySelector('.modal-b') as HTMLElement;

  let closed = false;
  const handle: ModalHandle = {
    root: modal,
    body,
    close: () => {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      document.removeEventListener('keydown', onKey, true);
      const done = () => {
        scrim.remove();
        opener?.focus?.();
        opts.onClose?.();
      };
      if (settings.reduceMotion) done();
      else animate(scrim, { opacity: [1, 0] }, { duration: 0.12 }).then(done);
    },
  };

  const focusables = () =>
    Array.from(modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
      (e) => !e.hasAttribute('disabled') && e.offsetParent !== null,
    );

  const onKey = (e: KeyboardEvent) => {
    if (stack[stack.length - 1] !== handle) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handle.close();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) handle.close();
  });
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => handle.close()));

  stack.push(handle);
  if (!settings.reduceMotion) {
    animate(scrim, { opacity: [0, 1] }, { duration: 0.14 });
    animate(modal, { opacity: [0, 1], y: [10, 0] }, { duration: 0.2, ease: [0.2, 0, 0, 1] });
  }
  requestAnimationFrame(() => {
    const auto = modal.querySelector<HTMLElement>('[autofocus]') ?? focusables()[1] ?? focusables()[0];
    auto?.focus();
  });
  return handle;
}

/** Small promise-based prompt for a single text value. */
export function promptText(title: string, label: string, value = '', okLabel?: string): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = openModal({
      title,
      body: `<label class="field"><span>${esc(label)}</span><input class="input" id="prompt-input" autofocus value="${esc(value)}" /></label>`,
      footer: `<button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn primary" id="prompt-ok">${esc(okLabel ?? t('common.ok'))}</button>`,
      onClose: () => resolve(result),
    });
    const input = m.body.querySelector('input') as HTMLInputElement;
    const ok = () => {
      result = input.value.trim() || null;
      m.close();
    };
    m.root.querySelector('#prompt-ok')!.addEventListener('click', ok);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok();
    });
    requestAnimationFrame(() => input.select());
  });
}

export function confirmDialog(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title,
      body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="confirm-ok">${esc(okLabel)}</button>`,
      onClose: () => resolve(result),
    });
    m.root.querySelector('#confirm-ok')!.addEventListener('click', () => {
      result = true;
      m.close();
    });
  });
}
