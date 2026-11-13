// The one door to an AI model. Picks the provider and hands back a checked
// answer. Three ways in:
//  - inside claude.ai: the viewer's own Claude, no key;
//  - stand-alone with Claude: the Anthropic SDK and the user's key;
//  - stand-alone with OpenAI: the OpenAI SDK and the user's key.
//
// The rest of the app never depends on an answer: every caller has a rule-based
// path for when the model is off, slow or fails.

import { runtime, inViewer } from '../platform.js';
import { getSettings, DEFAULT_MODEL, DEFAULT_OPENAI_MODEL } from '../store.js';
import { askClaudeApi, askViewer, lookupClaude } from './claude.js';
import { askOpenAI, lookupOpenAI } from './openai.js';
import { lookupRequest, parseLookup } from './prompts.js';
import { AiError } from './errors.js';

export { AiError };

// How a plan, a suggestion or a chat reply is labelled, by where it came from.
const SOURCE_NAME = { claude: 'Claude', openai: 'OpenAI', rules: 'the training rules' };
export const sourceName = (source) => SOURCE_NAME[source] || 'the AI coach';

/** What is connected right now. `source` is stored with what the model produces. */
export function aiStatus() {
  const s = getSettings();
  if (!s.aiOn) return { kind: 'off', label: 'The AI coach is switched off' };
  if (runtime.sample) return { kind: 'viewer', source: 'claude', label: 'Claude, through your claude.ai account' };
  if (inViewer && !runtime.settled) return { kind: 'wait', label: 'Checking for Claude…' };
  if (!inViewer && s.provider === 'openai' && s.openaiKey) return { kind: 'openai', source: 'openai', label: `OpenAI API · ${s.openaiModel || DEFAULT_OPENAI_MODEL}` };
  if (!inViewer && s.provider !== 'openai' && s.apiKey) return { kind: 'api', source: 'claude', label: `Claude API · ${s.model || DEFAULT_MODEL}` };
  return { kind: 'none', label: 'Built-in coach (no AI connected)' };
}

export const aiReady = () => !!aiStatus().source;
/** 'claude' or 'openai' when a model is connected, else 'rules'. */
export const aiSource = () => aiStatus().source || 'rules';
export const aiName = () => sourceName(aiStatus().source);

/**
 * Send one request and get the structured answer back.
 * @param {string} userText JSON request built in prompts.js
 * @param {{quick?: boolean, signal?: AbortSignal}} [opts] quick: a short mid-workout check
 */
export async function ask(userText, opts = {}) {
  const status = aiStatus();
  const quick = !!opts.quick;
  const timeoutMs = quick ? 45000 : 120000;
  let out;
  if (status.kind === 'viewer') out = await askViewer(userText, { tier: quick ? 'quick' : 'default', signal: opts.signal });
  else if (status.kind === 'api') out = await askClaudeApi(userText, { effort: quick ? 'low' : 'medium', signal: opts.signal, timeoutMs });
  else if (status.kind === 'openai') out = await askOpenAI(userText, { quick, signal: opts.signal, timeoutMs });
  else throw new AiError('off', 'No AI model is connected.');
  return tidy(out);
}

/** Never trust the shape blindly: fill the gaps so callers can read every field. */
export function tidy(out) {
  const o = out && typeof out === 'object' ? out : {};
  return {
    message: typeof o.message === 'string' ? o.message.trim() : '',
    questions: Array.isArray(o.questions) ? o.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3) : [],
    profile: o.profile && typeof o.profile === 'object' ? o.profile : null,
    ready_for_plan: o.ready_for_plan === true,
    plan: o.plan && typeof o.plan === 'object' && Array.isArray(o.plan.days) ? o.plan : null,
    changes: Array.isArray(o.changes) ? o.changes.filter((c) => c && typeof c === 'object') : [],
    equipment: o.equipment && typeof o.equipment === 'object' ? o.equipment : null,
    schedule: o.schedule && typeof o.schedule === 'object' && typeof o.schedule.first_session_id === 'string' ? o.schedule : null,
  };
}

/** A tiny real request, for the "Test the connection" button. */
export async function testConnection() {
  const out = await ask(JSON.stringify({
    mode: 'interview', profile_so_far: {}, equipment: [], available_exercises: [], current_plan: null, conversation: [],
    user_message: 'Connection test from the settings screen. Reply with a three-word greeting in "message" and leave everything else empty.',
  }), { quick: true });
  return out.message || 'Connected.';
}

/** Web search is only there when the app talks to an API itself. Inside claude.ai the model cannot browse. */
export const canLookUp = () => ['api', 'openai'].includes(aiStatus().kind);

/**
 * Find the named machines on the web.
 * @param {{ref: string, name: string, vendor?: string, model?: string}[]} machines
 * @returns {Promise<{found: object[], urls: string[]}>}
 */
export async function lookUpMachines(machines, opts = {}) {
  const kind = aiStatus().kind;
  const request = lookupRequest(machines);
  let out;
  if (kind === 'api') out = await lookupClaude(request, opts);
  else if (kind === 'openai') out = await lookupOpenAI(request, opts);
  else throw new AiError('off', 'This connection cannot search the web.');
  return { found: parseLookup(out.text), urls: out.urls };
}
