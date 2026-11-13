// Voice input for a text field. Speech is added after whatever is already
// typed, and stays editable. Shared by the coach chat and the equipment sheet.

import { useState, useEffect, useRef, useSignal, toast } from './kit.js';
import { createVoice, voiceKind, onRuntime } from '../platform.js';

const VOICE_ERRORS = {
  not_granted: 'The microphone is blocked for this page. You can still type.',
  'no-speech': 'I did not hear anything.',
  unavailable: 'Dictation is not available here. You can still type.',
  rate_limited: 'Dictation is busy. Try again in a moment.',
};

/**
 * @param {string} text the field's current text
 * @param {(t: string) => void} setText
 * @returns {{canSpeak: boolean, listening: boolean, toggle: () => void, stop: () => void}}
 */
export function useVoiceInput(text, setText) {
  useSignal(onRuntime); // dictation inside claude.ai arrives a moment after start-up
  const [listening, setListening] = useState(false);
  const voice = useRef(null);
  const base = useRef('');
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => () => voice.current?.dispose(), []);

  const stop = () => { if (voice.current?.isActive()) voice.current.stop(); };
  const toggle = () => {
    if (listening) { stop(); return; }
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
    base.current = latest.current.trim() ? `${latest.current.trimEnd()} ` : '';
    voice.current.start(); // called straight from the tap, as browsers require
  };
  return { canSpeak: !!voiceKind(), listening, toggle, stop };
}
