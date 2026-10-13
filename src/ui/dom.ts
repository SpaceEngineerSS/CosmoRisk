// Small DOM helpers. All dynamic text goes through `esc` or textContent;
// names and designations come from external services and are not trusted.

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
}

export function $$(sel: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(sel));
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export class Raw {
  constructor(public html: string) {}
}
export const raw = (html: string) => new Raw(html);

export function html(strings: TemplateStringsArray, ...vals: unknown[]): string {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v instanceof Raw) out += v.html;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.html : esc(x))).join('');
    else out += esc(v);
    out += strings[i + 1];
  }
  return out;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | undefined> = {},
  inner = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  if (inner) e.innerHTML = inner;
  return e;
}

/** Set text only when it changed; avoids layout churn in per-frame updates. */
export function setText(e: HTMLElement, s: string) {
  if (e.textContent !== s) e.textContent = s;
}

export function on<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | Document | Window,
  type: K,
  fn: (ev: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
) {
  target.addEventListener(type, fn as EventListener, opts);
  return () => target.removeEventListener(type, fn as EventListener, opts);
}

/** Delegate clicks on [data-act] elements inside root. */
export function actions(root: HTMLElement, handlers: Record<string, (el: HTMLElement, ev: MouseEvent) => void>) {
  root.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !root.contains(t) || t.hasAttribute('disabled')) return;
    const fn = handlers[t.dataset.act!];
    if (fn) {
      ev.preventDefault();
      fn(t, ev);
    }
  });
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let id = 0;
  return (...a: A) => {
    clearTimeout(id);
    id = window.setTimeout(() => fn(...a), ms);
  };
}
