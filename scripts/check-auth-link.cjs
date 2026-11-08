const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'lib', 'auth-link.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRecord = { exports: {} };
new Function('exports', 'module', compiled)(moduleRecord.exports, moduleRecord);
const { parseAuthLink } = moduleRecord.exports;

assert.deepEqual(
  parseAuthLink('https://app.example/auth/accept-invite?code=invite-code'),
  { kind: 'code', code: 'invite-code' },
);
assert.deepEqual(
  parseAuthLink('new-app://auth/accept-invite#access_token=access&refresh_token=refresh'),
  { kind: 'session', accessToken: 'access', refreshToken: 'refresh' },
);
assert.deepEqual(
  parseAuthLink('https://app.example/auth/accept-invite?error=access_denied'),
  { kind: 'error', message: 'access_denied' },
);
assert.deepEqual(parseAuthLink('https://app.example/auth/accept-invite'), { kind: 'invalid' });

console.log('Auth invitation link parsing checks passed.');
