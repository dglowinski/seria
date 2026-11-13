// Cloud copy of the data, used when the page runs inside claude.ai.
//
// The browser copy stays the working copy, so saving a set never waits on the
// network. Changes are pushed a moment later. On start the two copies are
// merged: the newer main record wins, and sessions are combined one by one.
//
// Layout in the viewer's private space:
//   data/users/<id>/main                 profile, plan, equipment, weights, chat
//   data/users/<id>/main/sessions/<sid>  one record per workout

import { runtime } from './platform.js';
import { getState, replaceState, onChange } from './store.js';

export const cloud = { status: 'off', lastSync: 0, error: '', started: false };
const listeners = new Set();
export const onCloud = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setStatus(status, error = '') {
  if (status === 'synced' && cloud.status !== 'synced') cloud.lastSync = Date.now();
  cloud.status = status; cloud.error = error;
  for (const fn of listeners) fn(cloud);
}

const MAIN_KEYS = ['schema', 'updatedAt', 'erasedAt', 'profile', 'equipment', 'plan', 'weights', 'deletedSessions', 'activeSessionId', 'chat', 'proposals'];
const plain = (o) => JSON.parse(JSON.stringify(o));
const mainDoc = (s) => plain(Object.fromEntries(MAIN_KEYS.map((k) => [k, s[k]])));

let mainRef = null;
let sessionsCol = null;
let dirtyMain = false;
const dirtySessions = new Set();
const removed = new Set();
let timer = null;
let running = false;
let hooked = false;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'unavailable', message: 'timeout' }), ms))]);

/** Combine the browser copy with the cloud copy. Exported for tests. */
export function mergeStates(local, remoteMain, remoteSessions) {
  const deleted = new Set([...(local.deletedSessions || []), ...(remoteMain?.deletedSessions || [])]);
  const byId = new Map();
  const push = new Set();
  const drop = new Set();
  for (const s of remoteSessions) {
    if (!s?.id) continue;
    if (deleted.has(s.id)) drop.add(s.id); else byId.set(s.id, s);
  }
  for (const s of local.sessions || []) {
    if (deleted.has(s.id)) continue;
    const r = byId.get(s.id);
    if (!r || (s.updatedAt || 0) > (r.updatedAt || 0)) { byId.set(s.id, s); push.add(s.id); }
  }
  // A device with nothing on it never replaces a cloud copy that has a plan,
  // whatever the clocks say. The one exception is a deliberate "Erase everything".
  const localEmpty = !local.plan && !(local.sessions || []).length;
  const erasedSince = (local.erasedAt || 0) > (remoteMain?.updatedAt || 0);
  const adoptRemote = !!remoteMain && localEmpty && !!remoteMain.plan && !erasedSince;
  const remoteNewer = !!remoteMain && (adoptRemote || (remoteMain.updatedAt || 0) > (local.updatedAt || 0));
  const main = remoteNewer ? remoteMain : local;
  const state = {
    ...Object.fromEntries(MAIN_KEYS.map((k) => [k, main[k]])),
    deletedSessions: [...deleted],
    sessions: [...byId.values()].sort((a, b) => a.startedAt - b.startedAt),
  };
  return { state, pushMain: !remoteNewer && (local.updatedAt || 0) > 0, pushSessions: push, dropSessions: drop };
}

export async function startCloud() {
  try {
    if (!runtime.db || !runtime.uid) { setStatus('off'); return; }
    try {
      mainRef = runtime.db.doc(`data/users/${runtime.uid}/main`);
      sessionsCol = mainRef.collection('sessions');
    } catch { mainRef = null; setStatus('off'); return; }
    if (!hooked) { hooked = true; onChange(queue); }
    await pull();
  } finally {
    // The app waits for this before it lets the user change anything.
    cloud.started = true;
    setStatus(cloud.status, cloud.error);
  }
}

export async function pull() {
  if (!mainRef) return;
  setStatus('loading');
  try {
    const [mainSnap, sessSnap] = await withTimeout(Promise.all([mainRef.get(), sessionsCol.limit(1000).get()]), 12000);
    const merged = mergeStates(getState(), mainSnap.exists ? mainSnap.data() : null, sessSnap.docs.map((d) => d.data()));
    replaceState(merged.state, { fromCloud: true });
    if (merged.pushMain) dirtyMain = true;
    merged.pushSessions.forEach((id) => dirtySessions.add(id));
    merged.dropSessions.forEach((id) => removed.add(id));
    setStatus('synced');
    if (dirtyMain || dirtySessions.size || removed.size) schedule(300);
  } catch (e) {
    setStatus('error', e?.code || 'unavailable');
  }
}

function queue(state, info = {}) {
  dirtyMain = true;
  (info.sessions || []).forEach((id) => dirtySessions.add(id));
  (info.removed || []).forEach((id) => { removed.add(id); dirtySessions.delete(id); });
  if (info.all) state.sessions.forEach((s) => dirtySessions.add(s.id));
  schedule(1500);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

async function flush() {
  if (!mainRef) return;
  if (running) { schedule(1000); return; }
  running = true;
  setStatus('saving');
  const state = getState();
  const sessions = [...dirtySessions];
  const gone = [...removed];
  const hadMain = dirtyMain;
  dirtyMain = false; dirtySessions.clear(); removed.clear();
  try {
    // One write at a time per record, as the store asks.
    for (const id of sessions) {
      const s = state.sessions.find((x) => x.id === id);
      if (s) await sessionsCol.doc(id).set(plain(s));
    }
    for (const id of gone) await sessionsCol.doc(id).delete();
    if (hadMain) await mainRef.set(mainDoc(state));
    setStatus('synced');
  } catch (e) {
    if (hadMain) dirtyMain = true;
    sessions.forEach((id) => dirtySessions.add(id));
    gone.forEach((id) => removed.add(id));
    const code = e?.code || 'unavailable';
    setStatus('error', code);
    // A full store or a withdrawn grant will not fix itself; anything else gets one later try.
    if (!['quota_exceeded', 'revoked', 'not_granted', 'invalid_argument'].includes(code)) schedule(30000);
  } finally {
    running = false;
  }
}

export function syncNow() {
  if (!mainRef) return;
  if (dirtyMain || dirtySessions.size || removed.size) flush(); else pull();
}

export const CLOUD_TEXT = {
  off: 'Saved on this device',
  loading: 'Loading your cloud copy…',
  saving: 'Saving to the cloud…',
  synced: 'Saved to the cloud',
  error: 'Cloud copy is behind. Your data is safe on this device.',
};
