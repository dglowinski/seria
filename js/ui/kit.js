// Shared UI pieces: store hook, routing, sheet, icons, small formatters.

import { html, useState, useEffect, useRef, useCallback, useMemo } from '../../vendor/preact-htm.js';
import * as store from '../store.js';

export { html, useState, useEffect, useRef, useCallback, useMemo };

/** Small cross-screen notes that do not belong in saved state. */
export const flags = { justFinished: null };

/** Re-render when app state or device settings change. */
export function useStore() {
  useSignal(store.subscribe);
  return store.getState();
}

/**
 * Re-render on an outside signal, given its subscribe function. Subscribing
 * happens a moment after the first render, so render once more right away in
 * case the signal fired in between.
 */
export function useSignal(subscribe) {
  const [, bump] = useState(0);
  useEffect(() => {
    const off = subscribe(() => bump((n) => n + 1));
    bump((n) => n + 1);
    return off;
  }, []);
}

// ---------------------------------------------------------------- routing
// Views are plain #names so the phone's back button walks through the app.

export function parseHash() {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '');
  const [name, ...rest] = h.split('-');
  return { name: name || 'plan', param: rest.join('-') };
}
export function go(name, param = '', { replace = false } = {}) {
  const h = `#${name}${param ? `-${param}` : ''}`;
  if (location.hash === h) return;
  if (replace) location.replace(h); else location.hash = h;
  window.scrollTo(0, 0);
}
export function back(fallback = 'plan') {
  if (history.length > 1) history.back(); else go(fallback);
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---------------------------------------------------------------- formatters

export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export const restText = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min` : `${sec} s`);
export function dateText(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- pieces

const PATHS = {
  plan: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 13h3M8 16.5h6',
  coach: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10h8M8 13h5',
  history: 'M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
  equipment: 'M3 12h18M6 8v8M18 8v8M3.5 10v4M20.5 10v4',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.1-1.2L14.2 3h-4.4l-.3 2.7a7 7 0 0 0-2.1 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.1 1.2l.3 2.7h4.4l.3-2.7a7 7 0 0 0 2.1-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  back: 'M15 5l-7 7 7 7',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  send: 'M5 12h13M12 5l7 7-7 7',
  stop: 'M7 7h10v10H7z',
  close: 'M6 6l12 12M18 6L6 18',
};
export const Icon = ({ name }) => html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d=${PATHS[name]} /></svg>`;

/** Bottom sheet. Tapping the dark area closes it. */
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="veil" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
        <div class="spread">
          <h3>${title}</h3>
          <button class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="close" /></button>
        </div>
        ${children}
      </div>
    </div>`;
}

/** The one main action, docked at the bottom within thumb reach. */
export function Dock({ aboveTabs, children }) {
  return html`<div class=${`dock${aboveTabs ? ' above-tabs' : ''}`}><div class="dock-in">${children}</div></div>`;
}

let toastTimer = null;
let toastSet = null;
export function toast(text) {
  if (!toastSet) return;
  toastSet(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastSet(''), 2600);
}
export function Toast() {
  const [text, setText] = useState('');
  useEffect(() => { toastSet = setText; return () => { toastSet = null; }; }, []);
  return text ? html`<div class="toast" role="status">${text}</div>` : null;
}

/** Number field that keeps what the user types until it is a real number. */
export function NumberInput({ value, onChange, step = 1, min = 0, wide, label, id, placeholder }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const last = useRef(value);
  // A value changed from outside (a +1 button) shows at once, in the same render.
  const outside = value !== last.current;
  const shown = outside ? (value == null ? '' : String(value)) : text;
  useEffect(() => {
    if (outside) { last.current = value; setText(shown); }
  }, [value]);
  const commit = (raw) => {
    setText(raw);
    const n = parseFloat(String(raw).replace(',', '.'));
    if (Number.isFinite(n) && n >= min) { last.current = n; onChange(n); }
  };
  return html`<input id=${id} class=${`num${wide ? ' wide' : ''}`} type="text" inputmode="decimal" autocomplete="off" aria-label=${label} placeholder=${placeholder}
    value=${shown} onInput=${(e) => commit(e.target.value)} onFocus=${(e) => e.target.select()} data-step=${step} />`;
}
