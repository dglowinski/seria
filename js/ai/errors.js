// One error shape for every AI provider, so callers branch on `code` only.
export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** The provider's own words, trimmed for a phone screen. Status prefix and ids are dropped. */
export function providerSays(e) {
  const raw = String(e?.error?.message || e?.message || '').replace(/^\d{3}\s+/, '').replace(/\b(org|proj|req)[-_][A-Za-z0-9]+\b/g, 'your account').replace(/\s+/g, ' ').trim();
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
}

// Room for the answer, in tokens. Providers count this reserved room against the
// per-minute limit before the request runs, so it is kept close to what the
// answers really need. A cut-off answer is asked for once more with double.
export const ROOM = { quick: 4000, normal: 8000 };
