// Coach tab: a chat that fills in the profile, shows its assumptions before
// building a plan, and takes typed or spoken answers. Speech lands in the text
// field first so it can be fixed before sending.
//
// The screen shows the conversation in progress, not the whole history: the
// last few messages, back to the last long pause. Earlier ones are a tap away.

import { html, useState, useEffect, useRef, useStore, useSignal, Dock, Icon, go, toast } from './kit.js';
import * as store from '../store.js';
import { buildAssumptions, missingFields } from '../domain/planner.js';
import { userSays, buildPlan, isBusy, onBusy, GREETING, canRestorePlan, restorePlan, recentCount } from '../ai/coach.js';
import { aiStatus, sourceName } from '../ai/ai.js';
import { useVoiceInput } from './voice.js';
import { ChangeCard } from './plan.js';

const STEP = 10; // "show earlier" brings back this many at a time

function Assumptions({ live }) {
  const state = store.getState();
  const rows = buildAssumptions(state.profile, state.equipment);
  const ready = !missingFields(state.profile).length;
  return html`<div class="panel card" data-testid="assumptions" style="border-radius:16px;padding:14px">
    <h4>What I am assuming</h4>
    <dl class="facts">${rows.map((r) => html`<dt>${r.label}</dt><dd>${r.value}</dd>`)}</dl>
    ${live && ready && html`
      <button class="cta" data-testid="build-plan" disabled=${isBusy()} onClick=${() => buildPlan()}>${state.plan ? 'Rebuild my plan' : 'Build my plan'}</button>
      <p class="small muted">Something off? Just tell me and I will update it first.${state.plan ? ' Rebuilding replaces the current plan; your history and your weights stay.' : ''}</p>`}
  </div>`;
}

export function CoachScreen() {
  const state = useStore();
  useSignal(onBusy);
  const [text, setText] = useState('');
  const [more, setMore] = useState(0); // earlier messages brought back by hand
  const [clearing, setClearing] = useState(false);
  const keep = useRef(null); // distance from the bottom to hold while earlier messages are added above
  const box = useRef(null);
  const busy = isBusy();
  const status = aiStatus();
  const { canSpeak, listening, toggle: toggleVoice, stop: stopVoice } = useVoiceInput(text, setText);

  // Scroll the page itself, so the newest message clears the composer docked at the bottom.
  useEffect(() => { window.scrollTo(0, document.documentElement.scrollHeight); }, [state.chat.length, busy]);
  // Earlier messages appear above the ones on screen, which stay where they are.
  useEffect(() => { if (keep.current != null) { window.scrollTo(0, document.documentElement.scrollHeight - keep.current); keep.current = null; } }, [more]);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`; } }, [text]);

  const send = (t) => {
    const msg = (t ?? text).trim();
    if (!msg || busy) return;
    stopVoice();
    setText('');
    setMore(0); // back to the conversation in progress
    setClearing(false);
    userSays(msg);
  };
  const earlier = () => { keep.current = document.documentElement.scrollHeight - window.scrollY; setMore(more + STEP); };
  const clear = () => { store.set({ chat: [] }); setMore(0); setClearing(false); toast('Chat cleared. Your plan and workouts are untouched'); };

  const all = state.chat;
  const shown = Math.min(all.length, recentCount(all) + more);
  const hidden = all.length - shown;
  const chat = all.slice(all.length - shown);
  const lastAssumptions = [...all].reverse().find((m) => m.kind === 'assumptions')?.id;
  const lastPlan = [...all].reverse().find((m) => m.kind === 'plan')?.id;
  // A rebuild can be taken back from the message that announced it, until a workout is done on the new plan.
  const undoAt = canRestorePlan(state) ? [...all].reverse().find((m) => m.kind === 'plan')?.id : null;
  const lastCoach = [...all].reverse().find((m) => m.role === 'coach' && m.kind !== 'notice');
  const chips = !busy && all[all.length - 1]?.role === 'coach' ? (lastCoach?.chips || []) : [];

  return html`
    <main class="main with-tabs" style="padding-bottom:calc(var(--tabs-h) + 150px + env(safe-area-inset-bottom, 0px))">
      <div class="spread">
        <div class="stack tight"><p class="eyebrow">Coach</p><h2>${state.plan ? 'Adjust your training' : 'How do you want to train?'}</h2></div>
        <small class="right">${state.plan ? 'Plan in place' : 'Setting up your plan'}</small>
      </div>
      <button class="row" style="padding:8px 12px" onClick=${() => go('prefs')}>
        <span class="small muted" data-testid="ai-status">${status.label}</span>
        <span class="small accent">${status.kind === 'none' ? 'Connect an AI' : 'Change'}</span>
      </button>
      ${all.length > 2 && html`<div class="chips" data-testid="chat-tools">
        ${hidden > 0 && html`<button class="chip" data-testid="chat-earlier" onClick=${earlier}>Show earlier messages (${hidden})</button>`}
        ${!clearing && html`<button class="chip" data-testid="chat-clear" onClick=${() => setClearing(true)}>Clear chat</button>`}
        ${clearing && html`<span class="small muted">Clear the whole chat? Your plan, workouts and weights stay.</span>
          <button class="chip accent" data-testid="chat-clear-yes" onClick=${clear}>Clear it</button>
          <button class="chip" onClick=${() => setClearing(false)}>Keep it</button>`}
      </div>`}
      <div class="chat" aria-live="polite">
        ${!all.length && html`<p class="bubble" data-role="coach">${GREETING}</p>`}
        ${chat.map((m) => html`
          ${m.text && html`<p class=${`bubble ${m.role === 'user' ? 'reply' : ''} ${m.kind === 'notice' ? 'notice' : ''}`} data-role=${m.role}>${m.text}${m.via && m.via !== 'rules' ? html`<span class="via">${sourceName(m.via)}</span>` : ''}</p>`}
          ${m.kind === 'assumptions' && m.id === lastAssumptions && html`<${Assumptions} live />`}
          ${m.kind === 'plan' && m.id === lastPlan && html`<button class="cta card" data-testid="open-plan" onClick=${() => go('plan')}>Open my plan</button>`}
          ${m.kind === 'plan' && m.replaced && m.id === undoAt && html`<button class="cta ghost card" data-testid="restore-plan" disabled=${busy} onClick=${() => { if (restorePlan()) toast('The old plan is back'); }}>Put the old plan back</button>`}
          ${m.kind === 'proposal' && (state.proposals.find((p) => p.id === m.proposalId)?.changes || []).map((c) => html`<${ChangeCard} key=${c.id} p=${{ id: m.proposalId }} c=${c} />`)}
        `)}
        ${busy && html`<p class="bubble" data-testid="thinking"><span class="dots"><span></span><span></span><span></span></span> Thinking…</p>`}
      </div>
    </main>
    <${Dock} aboveTabs>
      ${chips.length > 0 && html`<div class="chips" data-testid="quick-replies">${chips.map((c) => html`<button class="chip" onClick=${() => send(c)}>${c}</button>`)}</div>`}
      <form class="composer" onSubmit=${(e) => { e.preventDefault(); send(); }}>
        <textarea id="coach-input" ref=${box} rows="1" placeholder=${listening ? 'Listening… speak, then fix the text if needed' : 'Write your answer'} value=${text}
          onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}></textarea>
        ${canSpeak && html`<button type="button" class=${`round ${listening ? 'live' : ''}`} aria-label=${listening ? 'Stop recording' : 'Record voice'} aria-pressed=${listening} onClick=${toggleVoice}>
          <${Icon} name=${listening ? 'stop' : 'mic'} /></button>`}
        <button type="submit" class="round send" aria-label="Send" disabled=${busy || !text.trim()}><${Icon} name="send" /></button>
      </form>
    <//>`;
}
