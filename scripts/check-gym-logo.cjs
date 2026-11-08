const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'lib', 'gym-logo.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRecord = { exports: {} };
new Function('exports', 'module', compiled)(moduleRecord.exports, moduleRecord);
const { normalizeGymLogoUrl, shouldRenderGymLogo } = moduleRecord.exports;

assert.equal(normalizeGymLogoUrl(null), null);
assert.equal(normalizeGymLogoUrl('   '), null);
assert.equal(normalizeGymLogoUrl('not a URL'), null);
assert.equal(normalizeGymLogoUrl('file:///private/logo.png'), null);
assert.equal(normalizeGymLogoUrl('https://images.example/grau.png'), 'https://images.example/grau.png');
assert.equal(normalizeGymLogoUrl('http://images.example/grau.png'), null);
assert.equal(shouldRenderGymLogo('https://images.example/grau.png', false), true);
assert.equal(shouldRenderGymLogo('https://images.example/grau.png', true), false);

console.log('Gym logo URL and fallback checks passed.');
