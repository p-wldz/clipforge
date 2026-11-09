import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, errorLogEntry, errorStatus, publicError } from '../dist/core/errors.js';

test('structured application errors retain a safe user message, code and recovery hint', () => {
  const error = new AppError('Provider is not configured.', 'KEY_MISSING', 'Set the key and retry.', 401);
  assert.equal(errorStatus(error), 401);
  assert.deepEqual(publicError(error), {
    error: 'Provider is not configured.',
    code: 'KEY_MISSING',
    hint: 'Set the key and retry.',
  });
});

test('ordinary errors do not expose stack traces through the dashboard API', () => {
  assert.deepEqual(publicError(new Error('Bad request')), { error: 'Bad request', code: 'UNEXPECTED' });
  assert.equal(errorStatus(new Error('Bad request')), 400);
});

test('dashboard error logs are concise and omit secrets or stack traces', () => {
  const record = JSON.parse(
    errorLogEntry({
      requestId: 'req-123',
      method: 'POST',
      path: '/api/settings',
      error: new AppError('Provider is not configured.', 'KEY_MISSING'),
    }),
  );
  assert.deepEqual(record, {
    at: record.at,
    scope: 'dashboard',
    requestId: 'req-123',
    method: 'POST',
    path: '/api/settings',
    code: 'KEY_MISSING',
    error: 'Provider is not configured.',
  });
});
