// App state. One plain object, saved to the browser's local storage on every
// change so nothing is lost on reload. When the page runs inside claude.ai the
// same state is also mirrored to the cloud (see cloud.js).
//
// Device settings (API key, sound...) live under a second key and are never
// exported or synced.

import { emptyProfile } from './domain/planner.js';
import { emptyEquipment } from './domain/catalog.js';

const KEY = 'seria.state.v1';
const SETTINGS_KEY = 'seria.settings.v1';
export const SCHEMA = 1;
const CHAT_CAP = 80;
const PROPOSAL_CAP = 40;

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Default. Best balance for coaching.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster and cheaper.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest.' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'Most capable, costs the most.' },
];

export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
export const OPENAI_MODELS = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'Default. Close to the top model, much cheaper.' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'Most capable, costs the most.' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', note: 'Faster and cheaper.' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'Fastest and cheapest.' },
];

export const emptyState = () => ({
  schema: SCHEMA,
  updatedAt: 0,
  erasedAt: 0,
  profile: emptyProfile(),
  equipment: emptyEquipment(),
  plan: null,
  weights: {},
  sessions: [],
  deletedSessions: [],
  activeSessionId: null,
  chat: [],
  proposals: [],
});

export const defaultSettings = () => ({
  provider: 'anthropic', // or 'openai'
  apiKey: '', model: DEFAULT_MODEL, baseUrl: '', aiOn: true,
  openaiKey: '', openaiModel: DEFAULT_OPENAI_MODEL, openaiBaseUrl: '',
  sound: true, vibrate: true, keepAwake: true,
});

function read(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/** Fill in anything missing so older or partial data still loads. */
export function hydrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.profile = { ...base.profile, ...(raw.profile || {}) };
  s.equipment = { items: { ...(raw.equipment?.items || {}) }, custom: [...(raw.equipment?.custom || [])] };
  for (const k of ['sessions', 'deletedSessions', 'chat', 'proposals']) if (!Array.isArray(s[k])) s[k] = [];
  if (!s.weights || typeof s.weights !== 'object') s.weights = {};
  s.schema = SCHEMA;
  if (s.activeSessionId && !s.sessions.some((x) => x.id === s.activeSessionId && x.status === 'active')) s.activeSessionId = null;
  return s;
}

let state = hydrate(read(KEY));
let settings = { ...defaultSettings(), ...(read(SETTINGS_KEY) || {}) };
let storageOk = true;
const listeners = new Set();
const changeHooks = new Set();

export const getState = () => state;
export const getSettings = () => settings;
export const storageWorks = () => storageOk;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Called with (state, info) after every change that should reach the cloud. */
export function onChange(fn) { changeHooks.add(fn); return () => changeHooks.delete(fn); }

function emit() { for (const fn of listeners) fn(); }

/**
 * Change state. `patch` is an object of top-level keys, or a function that
 * gets the current state and returns one. info.sessions lists changed session
 * ids so the cloud mirror writes only those.
 */
export function set(patch, info = {}) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  if (!p) return state;
  state = { ...state, ...p, updatedAt: info.keepTime ? state.updatedAt : Date.now() };
  if (state.chat.length > CHAT_CAP) state.chat = state.chat.slice(-CHAT_CAP);
  if (state.proposals.length > PROPOSAL_CAP) state.proposals = state.proposals.slice(-PROPOSAL_CAP);
  storageOk = write(KEY, state);
  emit();
  if (!info.fromCloud) for (const fn of changeHooks) fn(state, info);
  return state;
}

export function setSettings(patch) {
  settings = { ...settings, ...patch };
  write(SETTINGS_KEY, settings);
  emit();
}

/** Replace everything (import, cloud pull, reset). */
export function replaceState(next, info = {}) {
  state = hydrate(next);
  storageOk = write(KEY, state);
  emit();
  if (!info.fromCloud) for (const fn of changeHooks) fn(state, { all: true });
}

// ---------------------------------------------------------------- sessions

export const activeSession = (s = state) => s.sessions.find((x) => x.id === s.activeSessionId) || null;
export const sessionById = (id, s = state) => s.sessions.find((x) => x.id === id) || null;
export const doneSessions = (s = state) => s.sessions.filter((x) => x.status === 'done').sort((a, b) => b.startedAt - a.startedAt);

export function putSession(session, extra = {}) {
  const exists = state.sessions.some((x) => x.id === session.id);
  const sessions = exists ? state.sessions.map((x) => (x.id === session.id ? session : x)) : [...state.sessions, session];
  const activeSessionId = session.status === 'active' ? session.id : (state.activeSessionId === session.id ? null : state.activeSessionId);
  return set({ sessions, activeSessionId, ...extra }, { sessions: [session.id] });
}

export function removeSession(id) {
  return set({
    sessions: state.sessions.filter((x) => x.id !== id),
    deletedSessions: [...new Set([...state.deletedSessions, id])].slice(-500),
    activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    proposals: state.proposals.filter((p) => p.sessionId !== id),
  }, { removed: [id] });
}

// ---------------------------------------------------------------- chat, proposals

let n = 0;
export const newId = (p) => `${p}-${Date.now().toString(36)}${(n++).toString(36)}`;

export function say(role, text, extra = {}) {
  const msg = { id: newId('m'), role, text, at: Date.now(), ...extra };
  set({ chat: [...state.chat, msg] });
  return msg;
}

export function addProposal(p) {
  const proposal = { id: newId('p'), createdAt: Date.now(), ...p, changes: p.changes.map((c) => ({ status: 'open', ...c })) };
  // A newer review of the same session or kind replaces the open one.
  const rest = state.proposals.filter((x) => !(x.mode === proposal.mode && x.sessionId === proposal.sessionId && x.changes.every((c) => c.status === 'open')));
  set({ proposals: [...rest, proposal] });
  return proposal;
}

export function markChange(proposalId, changeId, status, extra = {}) {
  set({
    proposals: state.proposals.map((p) => (p.id !== proposalId ? p : { ...p, changes: p.changes.map((c) => (c.id === changeId ? { ...c, status } : c)) })),
    ...extra,
  });
}

export const openChanges = (s = state) => s.proposals.flatMap((p) => p.changes.filter((c) => c.status === 'open').map((c) => ({ p, c })));

// ---------------------------------------------------------------- backup

export function exportData() {
  return JSON.stringify({ app: 'seria', exportedAt: new Date().toISOString(), state }, null, 2);
}

export function importData(text) {
  const parsed = JSON.parse(text);
  const incoming = parsed?.app === 'seria' ? parsed.state : parsed;
  if (!incoming || typeof incoming !== 'object' || !('profile' in incoming) || !Array.isArray(incoming.sessions)) {
    throw new Error('This file is not a Seria backup.');
  }
  replaceState({ ...incoming, updatedAt: Date.now() });
}

export function resetAll() {
  const gone = state.sessions.map((x) => x.id);
  replaceState({ ...emptyState(), updatedAt: Date.now(), erasedAt: Date.now(), deletedSessions: [...new Set([...state.deletedSessions, ...gone])].slice(-500) });
}
