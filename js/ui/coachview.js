// Coach tab: a chat that fills in the profile, shows its assumptions before
// building a plan, and takes typed or spoken answers. Speech lands in the text
// field first so it can be fixed before sending.

import { html, useState, useEffect, useRef, useStore, useSignal, Dock, Icon, go, toast } from './kit.js';
import * as store from '../store.js';
import { buildAssumptions, missingFields } from '../domain/planner.js';
import { userSays, buildPlan, isBusy, onBusy, GREETING } from '../ai/coach.js';
import { aiStatus } from '../ai/claude.js';
import { createVoice, voiceKind, onRuntime } from '../platform.js';
import { ChangeCard } from './plan.js';

const VOICE_ERRORS = {
  not_granted: 'The microphone is blocked for this page. You can still type.',
  'no-speech': 'I did not hear anything.',
  unavailable: 'Dictation is not available here. You can still type.',
  rate_limited: 'Dictation is busy. Try again in a moment.',
};

function Assumptions({ live }) {
  const state = store.getState();
  const rows = buildAssumptions(state.profile, state.equipment);
  const ready = !missingFields(state.profile).length;
  return html`<div class="panel card" data-testid="assumptions" style="border-radius:16px;padding:14px">
    <h4>What I am assuming</h4>
    <dl class="facts">${rows.map((r) => html`<dt>${r.label}</dt><dd>${r.value}</dd>`)}</dl>
    ${live && ready && html`
      <button class="cta" data-testid="build-plan" disabled=${isBusy()} onClick=${() => buildPlan()}>${state.plan ? 'Rebuild my plan' : 'Build my plan'}</button>
      <p class="small muted">Something off? Just tell me and I will update it first.${state.plan ? ' Rebuilding replaces the current week; your history stays.' : ''}</p>`}
  </div>`;
}

export function CoachScreen() {
  const state = useStore();
  useSignal(onBusy);
  useSignal(onRuntime);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const voice = useRef(null);
  const base = useRef('');
  const box = useRef(null);
  const busy = isBusy();
  const status = aiStatus();
  const canSpeak = !!voiceKind();

  // Scroll the page itself, so the newest message clears the composer docked at the bottom.
  useEffect(() => { window.scrollTo(0, document.documentElement.scrollHeight); }, [state.chat.length, busy]);
  useEffect(() => () => voice.current?.dispose(), []);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`; } }, [text]);

  const stopVoice = () => { if (voice.current?.isActive()) voice.current.stop(); };
  const send = (t) => {
    const msg = (t ?? text).trim();
    if (!msg || busy) return;
    stopVoice();
    setText('');
    userSays(msg);
  };
  const toggleVoice = () => {
    if (listening) { stopVoice(); return; }
    if (!voice.current) {
      voice.current = createVoice({
        onText: (final, live) => setText(`${base.current}${`${final}${live}`.trimStart()}`),
        onState: (st, reason) => {
          setListening(st !== 'idle');
          if (st === 'idle' && VOICE_ERRORS[reason]) toast(VOICE_ERRORS[reason]);
        },
      });
    }
    if (!voice.current) { toast(VOICE_ERRORS.unavailable); return; }
    base.current = text.trim() ? `${text.trimEnd()} ` : '';
    voice.current.start();
  };

  const chat = state.chat;
  const lastAssumptions = [...chat].reverse().find((m) => m.kind === 'assumptions')?.id;
  const lastCoach = [...chat].reverse().find((m) => m.role === 'coach' && m.kind !== 'notice');
  const chips = !busy && chat[chat.length - 1]?.role === 'coach' ? (lastCoach?.chips || []) : [];

  return html`
    <main class="main with-tabs" style="padding-bottom:calc(var(--tabs-h) + 150px + env(safe-area-inset-bottom, 0px))">
      <div class="spread">
        <div class="stack tight"><p class="eyebrow">Coach</p><h2>${state.plan ? 'Adjust your training' : 'How do you want to train?'}</h2></div>
        <small class="right">${state.plan ? 'Plan in place' : 'Setting up your plan'}</small>
      </div>
      <button class="row" style="padding:8px 12px" onClick=${() => go('prefs')}>
        <span class="small muted" data-testid="ai-status">${status.label}</span>
        <span class="small accent">${status.kind === 'none' ? 'Connect Claude' : 'Change'}</span>
      </button>
      <div class="chat" aria-live="polite">
        <p class="bubble" data-role="coach">${GREETING}</p>
        ${chat.map((m) => html`
          ${m.text && html`<p class=${`bubble ${m.role === 'user' ? 'reply' : ''} ${m.kind === 'notice' ? 'notice' : ''}`} data-role=${m.role}>${m.text}${m.via === 'claude' ? html`<span class="via">Claude</span>` : ''}</p>`}
          ${m.kind === 'assumptions' && html`<${Assumptions} live=${m.id === lastAssumptions} />`}
          ${m.kind === 'plan' && html`<button class="cta card" data-testid="open-plan" onClick=${() => go('plan')}>Open my plan</button>`}
          ${m.kind === 'proposal' && (state.proposals.find((p) => p.id === m.proposalId)?.changes || []).map((c) => html`<${ChangeCard} p=${{ id: m.proposalId }} c=${c} />`)}
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
