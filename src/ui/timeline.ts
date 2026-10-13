// Bottom strip: transport controls, a time axis with encounter markers,
// and a date field for jumping.

import { jumpTo, rateLabel, reverse, setPaused, stepRate, syncNow } from '../app';
import { t } from '../core/i18n';
import { bus, state } from '../core/store';
import { dateToJd, formatDate, inputValueToJd, jdToDate, jdToInputValue } from '../core/time';
import { confirmDialog } from './modal';
import { $, actions, esc, html, raw, setText } from './dom';
import { icon } from './icons';
import { distance } from '../core/units';
import { settings } from '../core/settings';

let root: HTMLElement;
let axisFrom = 0;
let axisTo = 0;
let lastPaused: boolean | null = null;
let lastRate = NaN;

export function mountTimeline(host: HTMLElement) {
  root = host;
  render();
  actions(root, {
    play: () => setPaused(!(state.frame?.paused ?? true)),
    slower: () => stepRate(-1),
    faster: () => stepRate(1),
    reverse: () => reverse(),
    now: () => confirmJump(() => syncNow()),
    go: () => go(),
    enc: (el) => confirmJump(() => jumpTo(+el.dataset.jd! - 1)),
  });
  bus.on('lang', render);
  bus.on('scan', () => drawAxis(true));
  bus.on('frame', update);
}

function render() {
  root.innerHTML = html`
    <div class="transport">
      <button class="btn ghost icon" data-act="reverse" title="${t('tl.reverse')} (R)" aria-label="${t('tl.reverse')}">${raw(icon('reverse'))}</button>
      <button class="btn ghost icon" data-act="slower" title="${t('tl.slower')} ([)" aria-label="${t('tl.slower')}">${raw(icon('slower'))}</button>
      <button class="btn icon play" data-act="play" id="tl-play" title="${t('tl.play')} (Space)" aria-label="${t('tl.play')}">${raw(icon('play'))}</button>
      <button class="btn ghost icon" data-act="faster" title="${t('tl.faster')} (])" aria-label="${t('tl.faster')}">${raw(icon('faster'))}</button>
      <div class="rate"><span class="v" id="tl-rate">—</span><span class="k">${t('tl.rate')}</span></div>
    </div>
    <div class="track">
      <div class="track-axis" id="tl-axis"></div>
      <div class="track-meta"><span id="tl-from"></span><span id="tl-hint"></span><span id="tl-to"></span></div>
    </div>
    <div class="timeline-right">
      <input class="input mono" type="datetime-local" id="tl-date" aria-label="${t('tl.date')}" />
      <button class="btn" data-act="go">${t('tl.go')}</button>
      <button class="btn" data-act="now" title="${t('tl.now.title')} (N)">${raw(icon('now'))}${t('tl.now')}</button>
    </div>`;
  const input = $('#tl-date', root) as HTMLInputElement;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  lastPaused = null;
  lastRate = NaN;
  axisFrom = axisTo = 0;
  if (state.frame) update();
}

async function confirmJump(fn: () => void) {
  if (state.bodies.some((b) => b.deflected || b.thrusting)) {
    const ok = await confirmDialog(t('tl.jump.title'), t('tl.jump.body'), t('tl.jump.ok'));
    if (!ok) return;
  }
  fn();
}

function go() {
  const v = ($('#tl-date', root) as HTMLInputElement).value;
  const jd = inputValueToJd(v);
  if (jd !== null) confirmJump(() => jumpTo(jd));
}

function update() {
  const f = state.frame;
  if (!f) return;
  if (f.paused !== lastPaused) {
    lastPaused = f.paused;
    const b = $('#tl-play', root);
    b.innerHTML = icon(f.paused ? 'play' : 'pause');
    b.title = `${f.paused ? t('tl.play') : t('tl.pause')} (Space)`;
    b.setAttribute('aria-label', f.paused ? t('tl.play') : t('tl.pause'));
    b.classList.toggle('primary', f.paused);
  }
  if (f.rate !== lastRate) {
    lastRate = f.rate;
    setText($('#tl-rate', root), rateLabel(f.rate));
  }
  const input = $('#tl-date', root) as HTMLInputElement;
  if (document.activeElement !== input && f.paused) {
    const v = jdToInputValue(f.jd);
    if (input.value !== v) input.value = v;
  }
  drawAxis(false);
}

function drawAxis(force: boolean) {
  const f = state.frame;
  if (!f) return;
  const axis = $('#tl-axis', root);
  const scan = state.scan?.scan;
  let from = axisFrom;
  let to = axisTo;
  if (scan) {
    from = scan.from_jd;
    to = scan.to_jd;
  } else if (force || !(f.jd >= axisFrom && f.jd <= axisTo) || to - from < 1) {
    // Re-anchor on the current year, two years wide.
    const d = jdToDate(f.jd);
    const jd0 = dateToJd(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
    from = jd0;
    to = jd0 + 2 * 365.25;
  }
  if (force || from !== axisFrom || to !== axisTo) {
    axisFrom = from;
    axisTo = to;
    buildTicks(axis, from, to);
    setText($('#tl-from', root), formatDate(from));
    setText($('#tl-to', root), formatDate(to));
    setText($('#tl-hint', root), scan ? t('tl.hint.scan') : '');
  }
  let now = axis.querySelector('.now') as HTMLElement | null;
  if (!now) {
    now = document.createElement('i');
    now.className = 'now';
    axis.appendChild(now);
  }
  const u = (f.jd - from) / (to - from);
  now.style.left = `${Math.max(0, Math.min(1, u)) * 100}%`;
  now.style.display = u < 0 || u > 1 ? 'none' : '';
}

function buildTicks(axis: HTMLElement, from: number, to: number) {
  const span = to - from;
  let out = '';
  const d0 = jdToDate(from);
  const years = span / 365.25;
  const step = years > 40 ? 10 : years > 15 ? 5 : years > 6 ? 2 : 1;
  const pos = (jd: number) => `${(((jd - from) / span) * 100).toFixed(3)}%`;
  for (let y = d0.getUTCFullYear(); ; y++) {
    const jd = dateToJd(new Date(Date.UTC(y, 0, 1)));
    if (jd > to) break;
    if (jd < from) continue;
    const major = y % step === 0;
    out += `<i class="tick${major ? ' major' : ''}" style="left:${pos(jd)}"></i>`;
    if (major) out += `<span class="tick-label" style="left:${pos(jd)}">${y}</span>`;
    if (years <= 3) {
      for (let m = 1; m < 12; m++) {
        const jm = dateToJd(new Date(Date.UTC(y, m, 1)));
        if (jm > from && jm < to) out += `<i class="tick" style="left:${pos(jm)}"></i>`;
      }
    }
  }
  const scan = state.scan?.scan;
  if (scan) {
    for (const e of scan.encounters) {
      if (e.jd < from || e.jd > to) continue;
      const cls = e.impact ? 'impact' : e.dist_km < 384400 ? 'close' : '';
      const title = `${formatDate(e.jd)} · ${distance(e.dist_km, settings.unit)}`;
      out += `<button class="enc ${cls}" data-act="enc" data-jd="${e.jd}" style="left:${pos(e.jd)}" title="${esc(title)}" aria-label="${esc(title)}"></button>`;
    }
  }
  axis.innerHTML = out;
}
