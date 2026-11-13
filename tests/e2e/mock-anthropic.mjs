// A stand-in for api.anthropic.com, enough for the SDK to talk to: CORS
// preflight, POST /v1/messages, typed error bodies. It records what it gets so
// the test can check the request the app really sends.
import { createServer } from 'node:http';
import { canned } from './canned.mjs';

export function startMockAnthropic(port) {
  const state = { requests: [], fail: null, delayMs: 0 };
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
