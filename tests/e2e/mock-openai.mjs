// A stand-in for api.openai.com, enough for the official SDK's Responses API:
// CORS preflight, POST /v1/responses, error bodies. It records what it gets so
// the test can check the request the app really sends.
import { createServer } from 'node:http';
import { canned, cannedLookup } from './canned.mjs';

export function startMockOpenAI(port) {
  const state = { requests: [], fail: null, delayMs: 0, rejectReasoning: false, cutOffOnce: false };
  const cors = (req) => ({
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-max-age': '600',
  });
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)).end(); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      const json = (status, obj) => res.writeHead(status, { ...cors(req), 'content-type': 'application/json', 'x-request-id': 'req_mock' }).end(JSON.stringify(obj));
      if (req.method !== 'POST' || url.pathname !== '/v1/responses') return json(404, { error: { message: 'Not found', type: 'invalid_request_error' } });
      const body = JSON.parse(raw || '{}');
      state.requests.push({ path: req.url, headers: req.headers, body });
      if (state.fail === 401) return json(401, { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } });
      if (state.fail === 429) return json(429, { error: { message: 'Rate limit reached for gpt-6.1-sol in organization org-AbC123xyz on tokens per min (TPM): Limit 10000, Used 0, Requested 12000. Please try again in 12s.', type: 'tokens', param: null, code: 'rate_limit_exceeded' } });
      if (state.fail === 'quota') return json(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' } });
      if (state.cutOffOnce) {
        state.cutOffOnce = false;
        return json(200, { id: 'resp_cut', object: 'response', created_at: 0, status: 'incomplete', model: body.model, error: null, incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
      }
      if (state.rejectReasoning && body.reasoning) return json(400, { error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", type: 'invalid_request_error', param: 'reasoning.effort', code: 'unsupported_parameter' } });
      if ((body.tools || []).some((t) => t.type === 'web_search')) {
        const look = cannedLookup(JSON.parse(body.input));
        return json(200, {
          id: 'resp_lookup', object: 'response', created_at: 0, status: 'completed', model: body.model, error: null, incomplete_details: null,
          output: [
            { id: 'ws_mock', type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'machine' } },
            { id: 'msg_lookup', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: look.text, annotations: look.urls.map((url) => ({ type: 'url_citation', url, title: 'Product page', start_index: 0, end_index: 1 })) }] },
          ],
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        });
      }
      const payload = JSON.parse(body.input);
      const delay = payload.mode === 'in_session' ? state.delayMs : 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return json(200, {
        id: 'resp_mock', object: 'response', created_at: 0, status: 'completed', model: body.model, error: null, incomplete_details: null,
        output: [{ id: 'msg_mock', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(canned(payload)), annotations: [] }] }],
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      });
    });
  });
  return new Promise((ready) => server.listen(port, '127.0.0.1', () => ready({ server, state, url: `http://127.0.0.1:${port}` })));
}
