// App shell: top bar, the current screen, the tab bar, and start-up.

import { render } from '../vendor/preact-htm.js';
import { html, useEffect, useStore, useRoute, useSignal, Icon, Toast, go, back, parseHash } from './ui/kit.js';
import * as store from './store.js';
import { initRuntime, askPersistence, inViewer } from './platform.js';
import { startCloud, cloud, onCloud } from './cloud.js';
import { PlanScreen, DayScreen, ReviewScreen } from './ui/plan.js';
import { CoachScreen } from './ui/coachview.js';
import { HistoryScreen, SessionScreen } from './ui/history.js';
import { EquipmentScreen } from './ui/equipment.js';
import { PrefsScreen, RulesScreen } from './ui/prefs.js';
import { Workout } from './ui/workout.js';

const TABS = [['plan', 'Plan'], ['coach', 'Coach'], ['history', 'History'], ['equipment', 'Equipment']];
const TAB_OF = { plan: 'plan', day: 'plan', review: 'plan', coach: 'coach', history: 'history', session: 'history', equipment: 'equipment' };
const SUB_TITLE = { day: 'Day', review: 'Proposed changes', session: 'Workout', prefs: 'Settings', rules: 'Training rules' };
const PARENT = { day: 'plan', review: 'plan', session: 'history', prefs: 'plan', rules: 'prefs' };

function Screen({ route }) {
  switch (route.name) {
    case 'day': return html`<${DayScreen} dayId=${route.param} />`;
    case 'review': return html`<${ReviewScreen} />`;
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

const boot = () => {
  render(html`<${App} />`, document.getElementById('app'));
  initRuntime().then(startCloud);
  askPersistence();
  // Offline support, only where a service worker can run and is wanted.
  const wantSw = !inViewer && 'serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw'));
  if (wantSw) navigator.serviceWorker.register('./sw.js').catch(() => {});
};

// Inside claude.ai the viewer may hand over a newer version of the page; state is in storage, so just start.
if (window.claude?.hot?.ready) window.claude.hot.ready(boot); else boot();
