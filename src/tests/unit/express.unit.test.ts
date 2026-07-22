/**
 * Strategy: unit-test the Express `errorHandler` mapping of repository errors to HTTP responses,
 * focused on the review A10 fix — `InvalidDocumentIdError` maps to HTTP 400 with a stable public
 * error name and machine-readable `reason`, and the raw (possibly malicious) id is never reflected
 * in the response body. The handler is a plain `(err, req, res, next)` function, so a minimal `res`
 * spy is sufficient — no real Express app or server is needed.
 *
 * Verification points:
 *   1. InvalidDocumentIdError → 400, body `{ error, reason }`, raw id NOT echoed;
 *   2. ValidationError still → 400 (ordering regression guard — the new branch sits after it);
 *   3. an unmapped error falls through to a generic 500.
 */
import { errorHandler } from '../../express/index.js';
import { InvalidDocumentIdError, ValidationError } from '../../core/Errors.js';

function createRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  // Express `res.status()` returns `res` for chaining; `res.json()` likewise.
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const noopNext = jest.fn();

describe('express errorHandler', () => {
  it('maps InvalidDocumentIdError to 400 with a stable name + reason, without echoing the raw id', () => {
    const res = createRes();
    const err = new InvalidDocumentIdError(
      'document id must be a single path segment and cannot contain "/" (received "a/b/c").',
      'contains_slash',
    );

    errorHandler(err, {} as never, res as never, noopNext as never);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ error: 'InvalidDocumentIdError', reason: 'contains_slash' });
    // The raw, caller-supplied id must never be reflected back to the client.
    expect(JSON.stringify(body)).not.toContain('a/b/c');
  });

  it('still maps ValidationError to 400 (the InvalidDocumentIdError branch sits after it)', () => {
    const res = createRes();
    const err = new ValidationError([
      { code: 'custom', path: ['name'], message: 'Required' },
    ] as never);

    errorHandler(err, {} as never, res as never, noopNext as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe('ValidationError');
  });

  it('falls through to a generic 500 for an unmapped error', () => {
    const res = createRes();
    errorHandler(new Error('boom'), {} as never, res as never, noopNext as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toBe('InternalServerError');
  });
});
