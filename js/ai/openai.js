// Talks to OpenAI with the official SDK, straight from the browser, using the
// user's own API key. Same prompt, same answer format and same checks as the
// Claude path; only the transport differs.

import { getSettings, DEFAULT_OPENAI_MODEL } from '../store.js';
import { SYSTEM_PROMPT, OUTPUT_SCHEMA, LOOKUP_SYSTEM } from './prompts.js';
import { AiError, providerSays, ROOM } from './errors.js';

let sdkPromise = null;
const loadSdk = () => (sdkPromise = sdkPromise || import('../../vendor/openai-sdk.js').then((m) => m.default));

// Older and chat-tuned models do not take a reasoning setting.
const NO_REASONING = /^(gpt-3|gpt-4|chatgpt)|chat-latest$/;

/** The request body. Exported so tests can check it without a network. */
export function openaiParams(model, userText, quick) {
  const params = {
    model,
    instructions: SYSTEM_PROMPT,
    input: userText,
    text: { format: { type: 'json_schema', name: 'seria_coach', schema: OUTPUT_SCHEMA, strict: true } },
    max_output_tokens: quick ? ROOM.quick : ROOM.normal,
    store: false, // do not keep the conversation on OpenAI's side
  };
  if (!NO_REASONING.test(model)) params.reasoning = { effort: quick ? 'low' : 'medium' };
  return params;
}

function fromSdkError(OpenAI, e) {
  if (e instanceof AiError) return e;
  if (e instanceof OpenAI.APIUserAbortError) return new AiError('cancelled', 'Cancelled.');
  if (e instanceof OpenAI.AuthenticationError) return new AiError('auth', 'OpenAI rejected the API key. Check it in Settings.');
  if (e instanceof OpenAI.PermissionDeniedError) return new AiError('auth', 'This API key is not allowed to use that model.');
  if (e instanceof OpenAI.NotFoundError) return new AiError('config', 'OpenAI does not know that model. Pick another one in Settings.');
  if (e instanceof OpenAI.RateLimitError) {
    // A 429 has several causes, and "try again later" only fits one of them. Say which.
    const said = providerSays(e);
    if (e.code === 'insufficient_quota' || e.type === 'insufficient_quota' || /quota|billing/i.test(said)) {
      return new AiError('auth', `OpenAI says this account has no credit to spend${said ? `: “${said}”` : '.'} Buy credit or raise the spend limit at platform.openai.com.`);
    }
    return new AiError('busy', `OpenAI turned the request down as over a limit${said ? `: “${said}”` : '.'} If this account is new, it needs bought credit before this model works properly. Also check the spend limit on the key's project.`);
  }
  if (e instanceof OpenAI.BadRequestError) return new AiError('config', `OpenAI did not accept the request: ${e.message}`);
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new AiError('timeout', 'OpenAI took too long to answer.');
  if (e instanceof OpenAI.APIConnectionError) return new AiError('offline', 'Could not reach OpenAI. Check the connection.');
  if (e instanceof OpenAI.APIError) return new AiError('server', `OpenAI had a problem (${e.status || 'error'}). Try again later.`);
  return new AiError('unknown', e?.message || 'Something went wrong talking to OpenAI.');
}

export async function askOpenAI(userText, { quick, signal, timeoutMs }) {
  const s = getSettings();
  const OpenAI = await loadSdk();
  const model = s.openaiModel || DEFAULT_OPENAI_MODEL;
  const client = new OpenAI({
    apiKey: s.openaiKey,
    baseURL: s.openaiBaseUrl || undefined,
    dangerouslyAllowBrowser: true, // the key is the user's own and stays on their device
    maxRetries: quick ? 1 : 2, // the SDK waits as long as OpenAI asks before trying again
    timeout: timeoutMs,
  });
  const params = openaiParams(model, userText, quick);
  let res;
  let retriedPlain = false;
  try {
    res = await client.responses.create(params, { signal });
  } catch (e) {
    // A model that turns down the reasoning setting gets one more try without it.
    const aboutReasoning = params.reasoning && e instanceof OpenAI.BadRequestError && /reasoning/i.test(`${e.param || ''} ${e.message || ''}`);
    if (!aboutReasoning) throw fromSdkError(OpenAI, e);
    const { reasoning, ...plain } = params;
    retriedPlain = true;
    try { res = await client.responses.create(plain, { signal }); } catch (e2) { throw fromSdkError(OpenAI, e2); }
  }
  // Cut off for lack of room: ask once more with twice as much.
  if (res.status === 'incomplete' && res.incomplete_details?.reason === 'max_output_tokens') {
    const { reasoning, ...rest } = params;
    const bigger = { ...rest, ...(reasoning && !retriedPlain ? { reasoning } : {}), max_output_tokens: params.max_output_tokens * 2 };
    try { res = await client.responses.create(bigger, { signal }); } catch (e) { throw fromSdkError(OpenAI, e); }
  }
  const refused = (res.output || []).some((item) => item.type === 'message' && (item.content || []).some((c) => c.type === 'refusal'));
  if (refused || res.incomplete_details?.reason === 'content_filter') throw new AiError('refused', 'OpenAI declined that request.');
  if (res.status === 'incomplete') throw new AiError('format', 'OpenAI ran out of room before finishing its answer.');
  if (res.status === 'failed' || res.error) throw new AiError('server', 'OpenAI had a problem. Try again later.');
  try { return JSON.parse(res.output_text); } catch { throw new AiError('format', 'OpenAI answered in a form the app could not read.'); }
}

/**
 * Look machines up on the web with OpenAI's own search tool. Returns the text
 * of the answer and every address it cited, so the caller can check that a
 * quoted source is real.
 */
export async function lookupOpenAI(userText, { signal }) {
  const s = getSettings();
  const OpenAI = await loadSdk();
  const model = s.openaiModel || DEFAULT_OPENAI_MODEL;
  const client = new OpenAI({ apiKey: s.openaiKey, baseURL: s.openaiBaseUrl || undefined, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
  let res;
  try {
    res = await client.responses.create({ model, instructions: LOOKUP_SYSTEM, input: userText, tools: [{ type: 'web_search' }], max_output_tokens: ROOM.normal, store: false }, { signal });
  } catch (e) {
    throw fromSdkError(OpenAI, e);
  }
  const urls = new Set();
  for (const item of res.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) for (const a of part.annotations || []) if (a?.type === 'url_citation' && a.url) urls.add(a.url);
  }
  return { text: res.output_text || '', urls: [...urls] };
}
