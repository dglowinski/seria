// Talks to Claude. Two ways in, picked by where the page runs:
//  - inside claude.ai: the viewer's own Claude ("sample"), no key needed;
//  - anywhere else: the official Anthropic SDK with the user's API key, sent
//    straight from the browser.
//
// The rest of the app never depends on an answer: every caller has a rule-based
// path for when Claude is off, slow or fails.

import { runtime, inViewer } from '../platform.js';
import { getSettings, DEFAULT_MODEL } from '../store.js';
import { SYSTEM_PROMPT, OUTPUT_SCHEMA } from './prompts.js';

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Models that can hand a declined request to another model on the server.
const FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5|fable-5-2)$/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** How Claude is connected right now. */
export function aiStatus() {
  const s = getSettings();
  if (!s.aiOn) return { kind: 'off', label: 'Claude is switched off' };
  if (runtime.sample) return { kind: 'viewer', label: 'Claude, through your claude.ai account' };
  if (inViewer && !runtime.settled) return { kind: 'wait', label: 'Checking for Claude…' };
  if (!inViewer && s.apiKey) return { kind: 'api', label: `Claude API · ${s.model || DEFAULT_MODEL}` };
  return { kind: 'none', label: 'Built-in coach (Claude not connected)' };
}

export const aiReady = () => ['viewer', 'api'].includes(aiStatus().kind);

let sdkPromise = null;
const loadSdk = () => (sdkPromise = sdkPromise || import('../../vendor/anthropic-sdk.js').then((m) => m.default));

function fromSdkError(Anthropic, e) {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', 'Cancelled.');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Claude rejected the API key. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('auth', 'This API key is not allowed to use that model.');
  if (e instanceof Anthropic.NotFoundError) return new AiError('config', 'Claude does not know that model. Pick another one in Settings.');
  if (e instanceof Anthropic.RateLimitError) return new AiError('busy', 'Claude is rate limited right now. Try again in a minute.');
  if (e instanceof Anthropic.BadRequestError) return new AiError('config', `Claude did not accept the request: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout', 'Claude took too long to answer.');
  if (e instanceof Anthropic.APIConnectionError) return new AiError('offline', 'Could not reach Claude. Check the connection.');
  if (e instanceof Anthropic.APIError) return new AiError('server', `Claude had a problem (${e.status || 'error'}). Try again later.`);
  return new AiError('unknown', e?.message || 'Something went wrong talking to Claude.');
}

const VIEWER_TEXT = {
  cancelled: ['cancelled', 'Cancelled.'],
  not_granted: ['auth', 'Claude is not allowed for this page. You can allow it in the page permissions.'],
  sampling_disabled: ['auth', 'Claude is not available for this account.'],
  not_declared: ['auth', 'Claude is not available on this page.'],
  capability_disabled: ['auth', 'Claude is not available in this view.'],
  capability_removed: ['auth', 'Claude is not available in this view.'],
  rate_limited: ['busy', 'Claude is busy or your usage limit is reached. Try again later.'],
  session_expired: ['auth', 'Sign in to claude.ai again to use Claude here.'],
  refused: ['refused', 'Claude declined that request.'],
  prompt_too_large: ['config', 'Too much history to send at once.'],
  invalid_json: ['format', 'Claude answered in a form the app could not read.'],
  empty_completion: ['format', 'Claude gave an empty answer.'],
};

async function askApi(userText, { effort, signal, timeoutMs }) {
  const s = getSettings();
  const Anthropic = await loadSdk();
  const model = s.model || DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: s.apiKey,
    baseURL: s.baseUrl || undefined,
    dangerouslyAllowBrowser: true, // the key is the user's own and stays on their device
    maxRetries: 1,
    timeout: timeoutMs,
  });
  const params = {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
    output_config: { effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  };
  let res;
  try {
    res = FALLBACK_MODELS.test(model)
      ? await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal })
      : await client.messages.create(params, { signal });
  } catch (e) {
    throw fromSdkError(Anthropic, e);
  }
  if (res.stop_reason === 'refusal') throw new AiError('refused', 'Claude declined that request.');
  if (res.stop_reason === 'max_tokens') throw new AiError('format', 'Claude ran out of room before finishing its answer.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new AiError('format', 'Claude answered in a form the app could not read.'); }
}

async function askViewer(userText, { tier, signal }) {
  const input = `${SYSTEM_PROMPT}\n\n---\nRequest data (JSON):\n${userText}\n\n---\nReply with only one JSON object, no other text, that matches this JSON Schema exactly (every field present, null or [] where a part does not apply):\n${JSON.stringify(OUTPUT_SCHEMA)}`;
  try {
    return await runtime.sample.json(input, { modelTier: tier, cache: false, signal });
  } catch (e) {
    const [code, message] = VIEWER_TEXT[e?.code] || ['server', 'Claude had a problem. Try again later.'];
    throw new AiError(code, message);
  }
}

/**
 * Send one request and get the structured answer back.
 * @param {string} userText JSON request built in prompts.js
 * @param {{quick?: boolean, signal?: AbortSignal}} [opts] quick: a short mid-workout check
 */
export async function ask(userText, opts = {}) {
  const status = aiStatus();
  const quick = !!opts.quick;
  let out;
  if (status.kind === 'viewer') out = await askViewer(userText, { tier: quick ? 'quick' : 'default', signal: opts.signal });
  else if (status.kind === 'api') out = await askApi(userText, { effort: quick ? 'low' : 'medium', signal: opts.signal, timeoutMs: quick ? 45000 : 120000 });
  else throw new AiError('off', 'Claude is not connected.');
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
  };
}

/** A tiny real request, for the "Test connection" button. */
export async function testConnection() {
  const out = await ask(JSON.stringify({
    mode: 'interview', profile_so_far: {}, equipment: [], available_exercises: [], current_plan: null, conversation: [],
    user_message: 'Connection test from the settings screen. Reply with a three-word greeting in "message" and leave everything else empty.',
  }), { quick: true });
  return out.message || 'Connected.';
}
