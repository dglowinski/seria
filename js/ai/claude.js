// Talks to Claude. Two transports, picked in ai.js by where the page runs:
//  - inside claude.ai: the viewer's own Claude ("sample"), no key needed;
//  - anywhere else: the official Anthropic SDK with the user's API key, sent
//    straight from the browser.

import { runtime } from '../platform.js';
import { getSettings, DEFAULT_MODEL } from '../store.js';
import { SYSTEM_PROMPT, OUTPUT_SCHEMA, LOOKUP_SYSTEM } from './prompts.js';
import { AiError, providerSays, ROOM } from './errors.js';

// Models that can hand a declined request to another model on the server.
const FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5|fable-5-2)$/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let sdkPromise = null;
const loadSdk = () => (sdkPromise = sdkPromise || import('../../vendor/anthropic-sdk.js').then((m) => m.default));

function fromSdkError(Anthropic, e) {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', 'Cancelled.');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Claude rejected the API key. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('auth', 'This API key is not allowed to use that model.');
  if (e instanceof Anthropic.NotFoundError) return new AiError('config', 'Claude does not know that model. Pick another one in Settings.');
  if (e instanceof Anthropic.RateLimitError) {
    const said = providerSays(e);
    return new AiError('busy', `Claude turned the request down as over a limit${said ? `: “${said}”` : '.'} Wait a minute and try again. On a new account the per-minute limits are low; they rise as the account is used.`);
  }
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

export async function askClaudeApi(userText, { effort, signal, timeoutMs }) {
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
  const room = effort === 'low' ? ROOM.quick : ROOM.normal;
  const params = {
    model,
    max_tokens: room,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
    output_config: { effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
  };
  const send = (p) => (FALLBACK_MODELS.test(model)
    ? client.beta.messages.create({ ...p, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal })
    : client.messages.create(p, { signal }));
  let res;
  try {
    res = await send(params);
    // Cut off for lack of room: ask once more with twice as much.
    if (res.stop_reason === 'max_tokens') res = await send({ ...params, max_tokens: room * 2 });
  } catch (e) {
    throw fromSdkError(Anthropic, e);
  }
  if (res.stop_reason === 'refusal') throw new AiError('refused', 'Claude declined that request.');
  if (res.stop_reason === 'max_tokens') throw new AiError('format', 'Claude ran out of room before finishing its answer.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new AiError('format', 'Claude answered in a form the app could not read.'); }
}

export async function askViewer(userText, { tier, signal }) {
  const input = `${SYSTEM_PROMPT}\n\n---\nRequest data (JSON):\n${userText}\n\n---\nReply with only one JSON object, no other text, that matches this JSON Schema exactly (every field present, null or [] where a part does not apply):\n${JSON.stringify(OUTPUT_SCHEMA)}`;
  try {
    return await runtime.sample.json(input, { modelTier: tier, cache: false, signal });
  } catch (e) {
    const [code, message] = VIEWER_TEXT[e?.code] || ['server', 'Claude had a problem. Try again later.'];
    throw new AiError(code, message);
  }
}

/**
 * Look machines up on the web with Claude's own search tool. Returns the text
 * of the answer and every address the search really returned, so the caller
 * can check that a quoted source is real.
 */
export async function lookupClaude(userText, { signal }) {
  const s = getSettings();
  const Anthropic = await loadSdk();
  const model = s.model || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: s.apiKey, baseURL: s.baseUrl || undefined, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
  // Haiku takes the basic search tool; the other models take the newer one.
  const tool = { type: /haiku/.test(model) ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 8 };
  const first = { role: 'user', content: userText };
  let messages = [first];
  const urls = new Set();
  let text = '';
  try {
    for (let turn = 0; turn < 4; turn++) {
      const res = await client.messages.create({ model, max_tokens: ROOM.normal, system: LOOKUP_SYSTEM, messages, tools: [tool], output_config: { effort: 'low' } }, { signal });
      if (res.stop_reason === 'refusal') throw new AiError('refused', 'Claude declined that request.');
      for (const block of res.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) for (const r of block.content) if (r?.url) urls.add(r.url);
        if (block.type === 'text') {
          text += block.text;
          for (const c of block.citations || []) if (c?.url) urls.add(c.url);
        }
      }
      // A long search can pause; send the turn back as it is and the server carries on.
      if (res.stop_reason !== 'pause_turn') break;
      messages = [first, { role: 'assistant', content: res.content }];
    }
  } catch (e) {
    throw fromSdkError(Anthropic, e);
  }
  return { text, urls: [...urls] };
}
