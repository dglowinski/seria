// App shell: top bar, the current screen, the tab bar, and start-up.

import { render } from '../vendor/preact-htm.js';
import { html, useEffect, useStore, useRoute, useSignal, Icon, Toast, go, back, parseHash, toast } from './ui/kit.js';
import * as store from './store.js';
import { initRuntime, askPersistence, inViewer } from './platform.js';
import { startCloud, cloud, onCloud } from './cloud.js';
import { PlanScreen, DayScreen, ReviewScreen } from './ui/plan.js';
import { CoachScreen } from './ui/coachview.js';
import { HistoryScreen, SessionScreen } from './ui/history.js';
import { EquipmentScreen } from './ui/equipment.js';
import { PrefsScreen, RulesScreen, APP_VERSION } from './ui/prefs.js';
import { Workout } from './ui/workout.js';
import { WeightsScreen } from './ui/weights.js';
import { retryPending, reviewEquipment, isBusy, reviewRunning, levelWithRecords } from './ai/coach.js';

const TABS = [['plan', 'Plan'], ['coach', 'Coach'], ['history', 'History'], ['equipment', 'Equipment']];
const TAB_OF = { plan: 'plan', day: 'plan', review: 'plan', weights: 'plan', coach: 'coach', history: 'history', session: 'history', equipment: 'equipment' };
const SUB_TITLE = { day: 'Session', review: 'What changed', weights: 'Weights', session: 'Workout', prefs: 'Settings', rules: 'Training rules' };
const PARENT = { day: 'plan', review: 'plan', weights: 'plan', session: 'history', prefs: 'plan', rules: 'prefs' };

function Screen({ route }) {
  switch (route.name) {
    case 'day': return html`<${DayScreen} dayId=${route.param} />`;
    case 'review': return html`<${ReviewScreen} />`;
    case 'weights': return html`<${WeightsScreen} />`;
    case 'coach': return html`<${CoachScreen} />`;
    case 'history': return html`<${HistoryScreen} />`;
    case 'session': return html`<${SessionScreen} sessionId=${route.param} />`;
    case 'equipment': return html`<${EquipmentScreen} />`;
    case 'prefs': return html`<${PrefsScreen} />`;
    case 'rules': return html`<${RulesScreen} />`;
    default: return html`<${PlanScreen} />`;
  }
}

function App() {
  const state = useStore();
  const route = useRoute();
  useSignal(onCloud);
  const active = store.activeSession(state);

  // A workout in progress is where the user wants to be after a reload.
  const ready = !inViewer || cloud.started;
  useEffect(() => { if (ready && store.activeSession() && parseHash().name !== 'workout') go('workout'); }, [ready]);

  // A review of the last workout that could not be had (no connection, page closed) is asked for again:
  // once the app is up, and whenever the phone comes back online.
  useEffect(() => {
    if (!ready) return undefined;
    // First the plan is brought level with the workouts on record, in case a rebuild left a workout's results out of it.
    levelWithRecords();
    const t = setTimeout(retryPending, 1500);
    window.addEventListener('online', retryPending);
    return () => { clearTimeout(t); window.removeEventListener('online', retryPending); };
  }, [ready]);

  // Equipment taken off the list: once the user leaves the Equipment tab, the plan swaps what can no longer be done.
  useEffect(() => { if (ready && route.name !== 'equipment' && route.name !== 'workout') reviewEquipment(); }, [ready, route.name, state.equipment]);

  // Inside claude.ai, hold the app until the cloud copy is in, so nothing typed early can overwrite it.
  if (inViewer && !cloud.started) {
    return html`<main class="main"><div class="empty"><p class="brand">Seria<i>.</i></p><p class="muted" data-testid="loading">Loading your training data…</p></div></main>`;
  }
  if (route.name === 'workout' && active) return html`<${Workout} /><${Toast} />`;
  // No workout to show. Unless a move to the summary is already under way, fall back to the plan.
  if (route.name === 'workout' && parseHash().name === 'workout') go('plan', '', { replace: true });

  const sub = SUB_TITLE[route.name];
  return html`
    <header class="top">
      ${sub ? html`<div class="top-title">
          <button class="icon-btn" aria-label="Back" onClick=${() => back(PARENT[route.name])}><${Icon} name="back" /></button><b>${sub}</b>
        </div>` : html`<a class="brand" href="#plan" style="text-decoration:none;color:inherit" aria-label="Seria, go to plan">Seria<i>.</i></a>`}
      <div class="top-title">
        ${inViewer && cloud.status === 'error' && html`<small>Cloud copy is behind</small>`}
        ${active && html`<button class="chip accent" data-testid="resume" onClick=${() => go('workout')}>Resume workout</button>`}
        ${route.name !== 'prefs' && html`<button class="icon-btn" aria-label="Settings" onClick=${() => go('prefs')}><${Icon} name="gear" /></button>`}
      </div>
    </header>
    <${Screen} route=${route} />
    <nav class="tabs" aria-label="Main"><div class="tabs-in">
      ${TABS.map(([id, label]) => html`<button class=${TAB_OF[route.name] === id ? 'on' : ''} aria-current=${TAB_OF[route.name] === id ? 'page' : undefined} onClick=${() => go(id)}>
        <${Icon} name=${id} /><span>${label}</span></button>`)}
    </div></nav>
    <${Toast} />`;
}

const UPDATED = 'seria.updated';

/**
 * Offline support, and new versions. The offline copy answers first, so a new
 * release used to show only on the second start after it: one refresh still
 * ran the old code. Now the page loads the new version by itself as soon as it
 * is ready. It waits while a workout is on, the coach is answering, or
 * something is being typed, and then loads at the next quiet moment.
 */
function startOffline() {
  const sw = navigator.serviceWorker;
  const had = !!sw.controller; // none on the very first visit: that is an install, not an update
  let ready = false;
  const typing = () => { const el = document.activeElement; return !!el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !!el.value; };
  const load = () => {
    if (!ready || store.activeSession() || isBusy() || reviewRunning() || typing()) return;
    ready = false;
    try { sessionStorage.setItem(UPDATED, '1'); } catch { /* the note is only a courtesy */ }
    location.reload();
  };
  sw.addEventListener('controllerchange', () => { if (had) { ready = true; load(); } });
  window.addEventListener('hashchange', load);
  // Coming back to the app is a good moment to look for a new version, and to load one that waited.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    load();
    sw.getRegistration().then((reg) => reg?.update()).catch(() => {});
  });
  sw.register('./sw.js').catch(() => {});
}

const boot = () => {
  render(html`<${App} />`, document.getElementById('app'));
  initRuntime().then(startCloud);
  askPersistence();
  // Offline support, only where a service worker can run and is wanted.
  const wantSw = !inViewer && 'serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw'));
  if (wantSw) startOffline();
  try { if (sessionStorage.getItem(UPDATED)) { sessionStorage.removeItem(UPDATED); setTimeout(() => toast(`Updated to Seria ${APP_VERSION}`), 400); } } catch { /* no note then */ }
};

// Inside claude.ai the viewer may hand over a newer version of the page; state is in storage, so just start.
if (window.claude?.hot?.ready) window.claude.hot.ready(boot); else boot();
