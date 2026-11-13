// One error shape for every AI provider, so callers branch on `code` only.
export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
