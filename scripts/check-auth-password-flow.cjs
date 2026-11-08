const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTypeScriptModule(relativePath) {
  const file = path.join(__dirname, '..', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function('exports', 'module', compiled)(moduleRecord.exports, moduleRecord);
  return moduleRecord.exports;
}

const { AuthRequestTimeoutError, withAuthRequestTimeout } = loadTypeScriptModule('lib/auth-request.ts');
const { INVITE_ACCEPT_PATH, bypassesGymAccessGuard } = loadTypeScriptModule('lib/auth-route-guard.ts');
const { formatSafeAuthFailure, toSafeAuthFailure } = loadTypeScriptModule('lib/auth-failure.ts');
const { canSetPasswordFromAuthCallback, destinationAfterIncompleteAuthCallback } = loadTypeScriptModule('lib/password-setup.ts');

async function run() {
  assert.equal(await withAuthRequestTimeout(async () => 'saved', 20), 'saved');
  await assert.rejects(
    () => withAuthRequestTimeout(async () => { throw new Error('request failed'); }, 20),
    /request failed/,
  );
  await assert.rejects(
    () => withAuthRequestTimeout(() => new Promise(() => {}), 10),
    AuthRequestTimeoutError,
  );

  assert.equal(bypassesGymAccessGuard(INVITE_ACCEPT_PATH), true);
  assert.equal(bypassesGymAccessGuard('/(tabs)'), false);
  assert.equal(canSetPasswordFromAuthCallback(null, 'coach-1'), false);
  assert.equal(canSetPasswordFromAuthCallback('coach-1', null), false);
  assert.equal(canSetPasswordFromAuthCallback('coach-1', 'coach-2'), false);
  assert.equal(canSetPasswordFromAuthCallback('coach-1', 'coach-1'), true);
  assert.equal(destinationAfterIncompleteAuthCallback(null), '/sign-in');
  assert.equal(destinationAfterIncompleteAuthCallback('coach-1'), '/(tabs)');
  assert.equal(
    formatSafeAuthFailure(toSafeAuthFailure('Password save', { code: 'session_not_found', status: 401 })),
    'Password save failed. Code: session_not_found · Status: 401 You can try again.',
  );
  assert.equal(
    formatSafeAuthFailure(toSafeAuthFailure('Session validation', new AuthRequestTimeoutError(), true)),
    'Session validation failed. Request timed out You can try again.',
  );
  console.log('Auth password success, failure, timeout, and no-membership guard checks passed.');
}

void run();
