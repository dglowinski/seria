// What the page can do where it is running.
//
// Two homes:
//  - "web": any static host, added to the phone's home screen. Data stays in
//    the browser. Claude is reached with the user's own API key.
//  - "viewer": opened inside claude.ai as an Artifact. The page gets cloud
//    storage, Claude and dictation from the viewer, with no key to enter.
//
// Everything here degrades to "not available" instead of failing.

export const inViewer = typeof window !== 'undefined' && typeof window.claude?.use === 'function';

export const runtime = {
  kind: inViewer ? 'viewer' : 'web',
  settled: !inViewer,
  sample: null, db: null, uid: null, dictation: null, downloads: null,
};

const listeners = new Set();
export const onRuntime = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(runtime); };

async function cap(name) {
  try { return await window.claude.use(name); } catch { return null; }
}

/** Ask the viewer for its capabilities. Resolves when all have answered. */
export async function initRuntime() {
  if (!inViewer) return runtime;
  const grab = async (name, after) => {
    const ns = await cap(name);
    if (after) await after(ns); else runtime[name] = ns;
    emit();
  };
  await Promise.all([
    grab('sample'),
    grab('dictation'),
    grab('downloads'),
    grab('db'),
    grab('user', async (user) => {
      try { runtime.uid = user ? await user.id() : null; } catch { runtime.uid = null; }
    }),
  ]);
  runtime.settled = true;
  emit();
  return runtime;
}

// ---------------------------------------------------------------- voice

const WebSpeech = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export function voiceKind() {
  if (runtime.dictation) return 'viewer';
  if (!inViewer && WebSpeech) return 'web';
  return null;
}

/**
 * Speech to text. Words are handed to onText(finalText, liveGuess); the caller
 * puts them in an editable field. start() must be called straight from a tap.
 */
export function createVoice({ onText, onState }) {
  const kind = voiceKind();
  let finals = '';
  let active = false;
  const state = (st, reason) => { active = st !== 'idle'; onState(st, reason); };

  if (kind === 'viewer') {
    const d = runtime.dictation;
    const offs = [
      d.onPartial(({ text }) => onText(finals, text)),
      d.onFinal(({ text }) => { finals += text; onText(finals, ''); }),
      d.onState(({ state: st, reason }) => state(st === 'idle' ? 'idle' : 'listening', reason)),
    ];
    return {
      kind,
      start() { finals = ''; state('listening'); d.start().catch((e) => state('idle', e?.code || 'upstream_error')); },
      stop() { d.stop().catch(() => {}); },
      isActive: () => active,
      dispose() { offs.forEach((off) => off()); if (active) d.stop().catch(() => {}); },
    };
  }

  if (kind === 'web') {
    let rec = null;
    return {
      kind,
      start() {
        finals = '';
        rec = new WebSpeech();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.continuous = true;
        rec.onresult = (ev) => {
          let live = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finals += r[0].transcript; else live += r[0].transcript;
          }
          onText(finals, live);
        };
        rec.onerror = (ev) => state('idle', ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'not_granted' : ev.error);
        rec.onend = () => { if (active) state('idle', 'stopped'); };
        try { rec.start(); state('listening'); } catch { state('idle', 'upstream_error'); }
      },
      stop() { try { rec?.stop(); } catch { /* already stopped */ } },
      isActive: () => active,
      dispose() { try { rec?.abort(); } catch { /* nothing to stop */ } },
    };
  }

  return null;
}

// ---------------------------------------------------------------- sound, buzz, screen

let audio = null;

/** Browsers only allow sound after a tap, so call this from one. */
export function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = audio || new Ctx();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no sound on this device */ }
}

export function beep() {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    [[880, 0], [880, 0.22], [1175, 0.44]].forEach(([freq, at]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.connect(gain); gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.35, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      osc.start(t + at); osc.stop(t + at + 0.2);
    });
  } catch { /* ignore */ }
}

export function buzz(pattern = [220, 120, 220]) {
  try { navigator.vibrate?.(pattern); } catch { /* not allowed here */ }
}

let lock = null;
let wantLock = false;

/** Keep the screen on during a workout, where the browser lets us. */
export async function keepAwake(on) {
  wantLock = on;
  try {
    if (on && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener?.('release', () => { lock = null; });
    } else if (!on && lock) {
      const l = lock; lock = null; await l.release();
    }
  } catch { lock = null; }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (wantLock && document.visibilityState === 'visible') keepAwake(true); });
}

// ---------------------------------------------------------------- files

/** Hand the user a file. Returns true when it was offered. */
export async function saveFile(filename, text) {
  if (runtime.downloads) {
    try { await runtime.downloads.save({ filename, data: text }); return true; } catch { return false; }
  }
  if (inViewer) return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

export async function askPersistence() {
  try { if (!inViewer && navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* fine */ }
  return false;
}

export const isStandalone = () => {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
};
