// Regression tests for the import UI error surfacing.
//
// Live bug: the deployed reprocess showed only "Network error during reprocess."
// The real cause was a serverless FUNCTION TIMEOUT — a non-JSON HTTP 504 platform
// page. The client did res.json() (which threw) and fell into the catch, so every
// server-side failure masqueraded as a client network error. These pure tests lock
// in that a responded-but-failed call surfaces the real status/reason, and that
// ONLY a rejected fetch is reported as a network error.

import test from 'node:test';
import assert from 'node:assert/strict';

import { apiFailureMessage, networkErrorMessage } from '../lib/api-error';

test('prefers the structured JSON error our handlers emit', () => {
  const body = JSON.stringify({ ok: false, error: '3 income Order Item ID(s) have no matching order; reprocess rolled back.' });
  const msg = apiFailureMessage('Reprocess', 422, 'Unprocessable Entity', body);
  assert.equal(msg, '3 income Order Item ID(s) have no matching order; reprocess rolled back.');
});

test('a non-JSON 504 timeout page is reported as a server timeout, NOT a network error', () => {
  const html = '<html><head><title>504: Gateway Timeout</title></head><body>An error occurred with your deployment: FUNCTION_INVOCATION_TIMEOUT</body></html>';
  const msg = apiFailureMessage('Reprocess', 504, 'Gateway Timeout', html);
  assert.match(msg, /timed out on the server \(HTTP 504\)/);
  assert.match(msg, /Nothing was changed/);
  assert.doesNotMatch(msg, /Network error/i);
});

test('FUNCTION_INVOCATION_TIMEOUT text is caught even if status is not 504', () => {
  const body = 'An error occurred: the function timed out.';
  const msg = apiFailureMessage('Reprocess', 500, 'Internal Server Error', body);
  assert.match(msg, /timed out on the server/);
});

test('a body-size rejection (413) is explained, not masked', () => {
  const msg = apiFailureMessage('Import', 413, 'Payload Too Large', 'Request Entity Too Large');
  assert.match(msg, /too large/i);
  assert.match(msg, /HTTP 413/);
});

test('auth failures (401/403) tell the operator to sign in as owner', () => {
  assert.match(apiFailureMessage('Reprocess', 401, '', ''), /not authorised \(HTTP 401\)/);
  assert.match(apiFailureMessage('Reprocess', 403, '', ''), /not authorised \(HTTP 403\)/);
});

test('an unstructured 500 still shows the status and a body snippet (never "network error")', () => {
  const msg = apiFailureMessage('Reprocess', 500, 'Internal Server Error', 'Something broke deep in the stack');
  assert.match(msg, /HTTP 500/);
  assert.match(msg, /Something broke/);
  assert.doesNotMatch(msg, /Network error/i);
});

test('only a rejected fetch is reported as a true network error', () => {
  const msg = networkErrorMessage('Reprocess', new TypeError('Failed to fetch'));
  assert.match(msg, /^Network error during reprocess/);
  assert.match(msg, /Failed to fetch/);
  assert.match(msg, /nothing was changed/i);
});
