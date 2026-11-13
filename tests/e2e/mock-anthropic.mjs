// A stand-in for api.anthropic.com, enough for the SDK to talk to: CORS
// preflight, POST /v1/messages, typed error bodies. It records what it gets so
// the test can check the request the app really sends.
import { createServer } from 'node:http';
import { canned, cannedLookup } from './canned.mjs';

export function startMockAnthropic(port) {
  const state = { requests: [], fail: null, delayMs: 0, failLookup: false, cutOffOnce: false };
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
      if (req.method !== 'POST' || url.pathname !== '/v1/messages') { res.writeHead(404, cors(req)).end('{}'); return; }
      const body = JSON.parse(raw || '{}');
      state.requests.push({ path: req.url, headers: req.headers, body });
      const json = (status, obj) => res.writeHead(status, { ...cors(req), 'content-type': 'application/json', 'request-id': 'req_mock' }).end(JSON.stringify(obj));
      if (state.fail === 401) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      if (state.fail === 529) return json(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
      // A machine lookup: the request carries the web search tool. The first answer
      // pauses mid-search, as the real API can; the follow-up finishes it.
      if ((body.tools || []).some((t) => /^web_search_/.test(t.type))) {
        if (state.failLookup) return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Web search is not enabled for this organization.' } });
        const look = cannedLookup(JSON.parse(body.messages[0].content));
        const search = [
          { type: 'server_tool_use', id: 'srvtoolu_mock', name: 'web_search', input: { query: 'machine' } },
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_mock', content: look.urls.map((url) => ({ type: 'web_search_result', url, title: 'Product page', encrypted_content: 'x', page_age: null })) },
        ];
        const paused = body.messages.length === 1;
        return json(200, {
          id: 'msg_lookup', type: 'message', role: 'assistant', model: body.model,
          content: paused ? search : [{ type: 'text', text: look.text, citations: null }],
          stop_reason: paused ? 'pause_turn' : 'end_turn', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        });
      }
      if (state.fail === 429) return json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'This request would exceed your organization\'s rate limit of 8,000 output tokens per minute.' } });
      if (state.cutOffOnce) {
        state.cutOffOnce = false;
        return json(200, { id: 'msg_cut', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '{"message": "Hel' }], stop_reason: 'max_tokens', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
      }
      const payload = JSON.parse(body.messages[body.messages.length - 1].content);
      const delay = payload.mode === 'in_session' ? state.delayMs : 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return json(200, {
        id: 'msg_mock', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: JSON.stringify(canned(payload)) }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      });
    });
  });
  return new Promise((ready) => server.listen(port, '127.0.0.1', () => ready({ server, state, url: `http://127.0.0.1:${port}` })));
}
